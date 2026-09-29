-- Apply after role-codes-migration.sql and role-codes-finalize.sql.
alter table public.tickets drop constraint tickets_status_check;
alter table public.tickets drop constraint valid_times;
alter table public.tickets
  add column status_reason text check (status_reason is null or length(status_reason) <= 1000),
  add constraint tickets_status_check check (status in ('queued','active','paused','done','partial','cancelled')),
  add constraint valid_times check (
    (status='queued' and started_at is null and ended_at is null) or
    (status in ('active','paused') and started_at is not null and ended_at is null) or
    (status in ('done','partial') and started_at is not null and ended_at is not null and ended_at >= started_at) or
    (status='cancelled' and ended_at is not null and (started_at is null or ended_at >= started_at))
  );

create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id),
  event_type text not null check (event_type in ('created','imported','started','paused','resumed','completed','partial','cancelled','edited')),
  actor_role text not null,
  actor_username text not null,
  reason text,
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index ticket_events_ticket_time_idx on public.ticket_events(ticket_id,created_at desc);
alter table public.ticket_events enable row level security;
revoke all on public.ticket_events from public, anon, authenticated;

create or replace function public.capture_ticket_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare event_name text;
begin
  event_name := nullif(current_setting('app.ticket_event_type',true),'');
  insert into public.ticket_events(ticket_id,event_type,actor_role,actor_username,reason,before_state,after_state)
  values(
    new.id,
    coalesce(event_name,case when tg_op='INSERT' then 'created' else 'edited' end),
    coalesce(nullif(current_setting('app.ticket_actor_role',true),''),'system'),
    coalesce(nullif(current_setting('app.ticket_actor_username',true),''),'system'),
    nullif(current_setting('app.ticket_reason',true),''),
    case when tg_op='INSERT' then null else to_jsonb(old)-'created_by' end,
    to_jsonb(new)-'created_by'
  );
  return new;
end; $$;
revoke all on function public.capture_ticket_event() from public, anon, authenticated;
create trigger ticket_event_after_change after insert or update on public.tickets
for each row execute function public.capture_ticket_event();

-- Existing tickets predate the audit trigger; mark their original state as imported.
insert into public.ticket_events(ticket_id,event_type,actor_role,actor_username,after_state,created_at)
select id,'imported','system','ก่อนเปิดประวัติ',to_jsonb(t)-'created_by',created_at
from public.tickets t;

create or replace function public.get_ticket_history(p_ticket_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'event_type',event_type,'actor_role',actor_role,'actor_username',actor_username,
    'reason',reason,'before_state',before_state,'after_state',after_state,'created_at',created_at
  ) order by created_at desc,id desc),'[]'::jsonb)
  from public.ticket_events where ticket_id=p_ticket_id;
$$;
revoke all on function public.get_ticket_history(uuid) from public, authenticated;
grant execute on function public.get_ticket_history(uuid) to anon;

create or replace function public.get_dashboard_state() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'people', coalesce((select jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'active',active) order by display_name) from public.staff), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by name) from public.job_types), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id',id,'ticket_no',ticket_no,'job_type_id',job_type_id,'assignee_id',assignee_id,'description',description,'status',status,'status_reason',status_reason,'started_at',started_at,'ended_at',ended_at,'created_at',created_at,'fg_code',fg_code,'fg_name',fg_name,'requested_qty',requested_qty,'bom_version',bom_version,'materials',materials) order by created_at desc) from public.tickets), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('profile_id',profile_id,'job_type_id',job_type_id,'level',level)) from public.skill_ratings), '[]'::jsonb)
  );
$$;

create or replace function public.create_bom_ticket_as_supervisor(
  p_username text,p_code text,p_ticket_no text,p_job_type_id uuid,p_assignee_id uuid,
  p_description text,p_fg_code text,p_fg_name text,p_requested_qty numeric,
  p_bom_version text,p_materials jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare line jsonb;
begin
  if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
  if not exists(select 1 from public.staff where id=p_assignee_id and active) then raise exception 'Staff is inactive'; end if;
  if not exists(select 1 from public.job_types where id=p_job_type_id and active) then raise exception 'Job is inactive'; end if;
  if length(trim(p_ticket_no)) not between 1 and 80 then raise exception 'Invalid ticket number'; end if;
  if length(coalesce(p_description,'')) > 1000 then raise exception 'Description too long'; end if;
  if length(trim(coalesce(p_fg_code,''))) not between 1 and 80 or length(trim(coalesce(p_fg_name,''))) not between 1 and 300 then raise exception 'Invalid FG'; end if;
  if p_requested_qty is null or p_requested_qty <= 0 or p_requested_qty > 1000000 then raise exception 'Invalid requested quantity'; end if;
  if p_bom_version !~ '^[0-9a-f]{64}$' then raise exception 'Invalid BOM version'; end if;
  if jsonb_typeof(p_materials) is distinct from 'array' or jsonb_array_length(p_materials) not between 1 and 30 then raise exception 'Invalid BOM lines'; end if;
  for line in select value from jsonb_array_elements(p_materials) loop
    if length(trim(coalesce(line->>'pk_code',''))) not between 1 and 80
       or length(trim(coalesce(line->>'pk_name',''))) not between 1 and 300
       or length(trim(coalesce(line->>'unit',''))) not between 1 and 30
       or (line->>'qty_per_unit')::numeric <= 0
       or (line->>'required_qty')::numeric <> round((line->>'qty_per_unit')::numeric * p_requested_qty, 4)
    then raise exception 'Invalid BOM line'; end if;
  end loop;
  perform set_config('app.ticket_actor_role','supervisor',true);
  perform set_config('app.ticket_actor_username',p_username,true);
  perform set_config('app.ticket_event_type','created',true);
  insert into public.tickets(ticket_no,job_type_id,assignee_id,description,fg_code,fg_name,requested_qty,bom_version,materials)
  values(trim(p_ticket_no),p_job_type_id,p_assignee_id,coalesce(trim(p_description),''),trim(p_fg_code),trim(p_fg_name),p_requested_qty,p_bom_version,p_materials);
end; $$;

create or replace function public.start_ticket_as_operator(p_username text,p_code text,p_ticket_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_role_code('operator',p_username,p_code) then raise exception 'Operator access required'; end if;
  perform set_config('app.ticket_actor_role','operator',true);
  perform set_config('app.ticket_actor_username',p_username,true);
  perform set_config('app.ticket_event_type','started',true);
  update public.tickets set status='active',started_at=clock_timestamp(),status_reason=null
  where id=p_ticket_id and status='queued';
  if not found then raise exception 'Ticket is unavailable or already started'; end if;
end; $$;

create or replace function public.finish_ticket_as_operator(p_username text,p_code text,p_ticket_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_role_code('operator',p_username,p_code) then raise exception 'Operator access required'; end if;
  perform set_config('app.ticket_actor_role','operator',true);
  perform set_config('app.ticket_actor_username',p_username,true);
  perform set_config('app.ticket_event_type','completed',true);
  update public.tickets set status='done',ended_at=clock_timestamp(),status_reason=null
  where id=p_ticket_id and status='active';
  if not found then raise exception 'Ticket is unavailable or already finished'; end if;
end; $$;

create or replace function public.pause_ticket_as_operator(p_username text,p_code text,p_ticket_id uuid,p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_role_code('operator',p_username,p_code) then raise exception 'Operator access required'; end if;
  if length(trim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Reason required'; end if;
  perform set_config('app.ticket_actor_role','operator',true);
  perform set_config('app.ticket_actor_username',p_username,true);
  perform set_config('app.ticket_event_type','paused',true);
  perform set_config('app.ticket_reason',trim(p_reason),true);
  update public.tickets set status='paused',status_reason=trim(p_reason)
  where id=p_ticket_id and status='active';
  if not found then raise exception 'Only active tickets can be paused'; end if;
end; $$;

create or replace function public.resume_ticket_as_operator(p_username text,p_code text,p_ticket_id uuid,p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_role_code('operator',p_username,p_code) then raise exception 'Operator access required'; end if;
  if length(coalesce(p_reason,'')) > 1000 then raise exception 'Reason too long'; end if;
  perform set_config('app.ticket_actor_role','operator',true);
  perform set_config('app.ticket_actor_username',p_username,true);
  perform set_config('app.ticket_event_type','resumed',true);
  perform set_config('app.ticket_reason',coalesce(trim(p_reason),''),true);
  update public.tickets set status='active',status_reason=null
  where id=p_ticket_id and status='paused';
  if not found then raise exception 'Only paused tickets can resume'; end if;
end; $$;

create or replace function public.mark_ticket_partial_as_operator(p_username text,p_code text,p_ticket_id uuid,p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_role_code('operator',p_username,p_code) then raise exception 'Operator access required'; end if;
  if length(trim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Reason required'; end if;
  perform set_config('app.ticket_actor_role','operator',true);
  perform set_config('app.ticket_actor_username',p_username,true);
  perform set_config('app.ticket_event_type','partial',true);
  perform set_config('app.ticket_reason',trim(p_reason),true);
  update public.tickets set status='partial',ended_at=clock_timestamp(),status_reason=trim(p_reason)
  where id=p_ticket_id and status in ('active','paused');
  if not found then raise exception 'Only started tickets can be marked partial'; end if;
end; $$;

create or replace function public.cancel_ticket_as_supervisor(p_username text,p_code text,p_ticket_id uuid,p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
  if length(trim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Reason required'; end if;
  perform set_config('app.ticket_actor_role','supervisor',true);
  perform set_config('app.ticket_actor_username',p_username,true);
  perform set_config('app.ticket_event_type','cancelled',true);
  perform set_config('app.ticket_reason',trim(p_reason),true);
  update public.tickets set status='cancelled',ended_at=clock_timestamp(),status_reason=trim(p_reason)
  where id=p_ticket_id and status in ('queued','active','paused');
  if not found then raise exception 'Only open tickets can be cancelled'; end if;
end; $$;

create or replace function public.edit_ticket_as_supervisor(
  p_username text,p_code text,p_ticket_id uuid,p_ticket_no text,p_job_type_id uuid,
  p_assignee_id uuid,p_description text,p_requested_qty numeric,p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare old_ticket public.tickets%rowtype; new_materials jsonb;
begin
  if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
  if length(trim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Reason required'; end if;
  if length(trim(coalesce(p_ticket_no,''))) not between 1 and 80 then raise exception 'Invalid ticket number'; end if;
  if length(coalesce(p_description,'')) > 1000 then raise exception 'Description too long'; end if;
  select * into old_ticket from public.tickets where id=p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if p_assignee_id is distinct from old_ticket.assignee_id
     and not exists(select 1 from public.staff where id=p_assignee_id and active) then raise exception 'Staff is inactive'; end if;
  if p_job_type_id is distinct from old_ticket.job_type_id
     and not exists(select 1 from public.job_types where id=p_job_type_id and active) then raise exception 'Job is inactive'; end if;
  if old_ticket.fg_code is not null then
    if p_requested_qty is null or p_requested_qty <= 0 or p_requested_qty > 1000000
       or p_requested_qty <> round(p_requested_qty,3) then raise exception 'Invalid requested quantity'; end if;
    select jsonb_agg(jsonb_set(line,'{required_qty}',to_jsonb(round((line->>'qty_per_unit')::numeric*p_requested_qty,4))) order by ordinality)
    into new_materials from jsonb_array_elements(old_ticket.materials) with ordinality as x(line,ordinality);
  end if;
  if trim(p_ticket_no)=old_ticket.ticket_no and p_job_type_id=old_ticket.job_type_id
     and p_assignee_id=old_ticket.assignee_id and coalesce(trim(p_description),'')=old_ticket.description
     and (old_ticket.fg_code is null or p_requested_qty=old_ticket.requested_qty)
  then raise exception 'No changes to save'; end if;
  perform set_config('app.ticket_actor_role','supervisor',true);
  perform set_config('app.ticket_actor_username',p_username,true);
  perform set_config('app.ticket_event_type','edited',true);
  perform set_config('app.ticket_reason',trim(p_reason),true);
  update public.tickets set ticket_no=trim(p_ticket_no),job_type_id=p_job_type_id,
    assignee_id=p_assignee_id,description=coalesce(trim(p_description),''),
    requested_qty=case when old_ticket.fg_code is null then null else p_requested_qty end,
    materials=case when old_ticket.fg_code is null then null else new_materials end
  where id=p_ticket_id;
end; $$;

revoke all on function public.pause_ticket_as_operator(text,text,uuid,text),
  public.resume_ticket_as_operator(text,text,uuid,text),public.mark_ticket_partial_as_operator(text,text,uuid,text),
  public.cancel_ticket_as_supervisor(text,text,uuid,text),
  public.edit_ticket_as_supervisor(text,text,uuid,text,uuid,uuid,text,numeric,text)
from public, authenticated;
grant execute on function public.pause_ticket_as_operator(text,text,uuid,text),
  public.resume_ticket_as_operator(text,text,uuid,text),public.mark_ticket_partial_as_operator(text,text,uuid,text),
  public.cancel_ticket_as_supervisor(text,text,uuid,text),
  public.edit_ticket_as_supervisor(text,text,uuid,text,uuid,uuid,text,numeric,text)
to anon;
