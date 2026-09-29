-- Apply after bom-migration.sql. No plaintext passwords belong in this file.
-- activate_role_codes rotates the legacy shared code after deployment.
insert into public.app_settings(key,value) values('supervisor_username','Admin')
on conflict(key) do update set value=excluded.value;
insert into public.app_settings(key,value) values('operator_username','pkbcl01')
on conflict(key) do update set value=excluded.value;

create or replace function public.check_role_code(p_role text,p_username text,p_code text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case p_role
    when 'supervisor' then coalesce(
      (select p_username = (select value from public.app_settings where key='supervisor_username')
        and value = extensions.crypt(p_code,value)
       from public.app_settings where key='supervisor_code'),false)
    when 'operator' then coalesce(
      (select p_username = (select value from public.app_settings where key='operator_username')
        and value = extensions.crypt(p_code,value)
       from public.app_settings where key='operator_code'),false)
    else false end;
$$;
revoke all on function public.check_role_code(text,text,text) from public, anon, authenticated;

create or replace function public.verify_role_code(p_role text,p_username text,p_code text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.check_role_code(p_role,p_username,p_code);
$$;
revoke all on function public.verify_role_code(text,text,text) from public, authenticated;
grant execute on function public.verify_role_code(text,text,text) to anon;

create or replace function public.activate_role_codes(p_legacy_code text,p_supervisor_code text,p_operator_code text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists(select 1 from public.app_settings where key in ('supervisor_code','operator_code'))
     or not public.check_edit_code(p_legacy_code) then raise exception 'Role setup unavailable'; end if;
  if length(p_supervisor_code) not between 8 and 128 or length(p_operator_code) not between 8 and 128
     or p_supervisor_code = p_operator_code then raise exception 'Invalid role codes'; end if;
  insert into public.app_settings(key,value) values
    ('supervisor_code',extensions.crypt(p_supervisor_code,extensions.gen_salt('bf'))),
    ('operator_code',extensions.crypt(p_operator_code,extensions.gen_salt('bf')));
  delete from public.app_settings where key='edit_code';
end; $$;
revoke all on function public.activate_role_codes(text,text,text) from public, authenticated;
grant execute on function public.activate_role_codes(text,text,text) to anon;

create or replace function public.add_staff_as_supervisor(p_username text,p_code text,p_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
  insert into public.staff(display_name) values(trim(p_name));
end; $$;
create or replace function public.set_staff_active_as_supervisor(p_username text,p_code text,p_staff_id uuid,p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
  update public.staff set active=p_active where id=p_staff_id;
  if not found then raise exception 'Staff not found'; end if;
end; $$;
create or replace function public.add_job_as_supervisor(p_username text,p_code text,p_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
  insert into public.job_types(name) values(trim(p_name));
end; $$;
create or replace function public.set_job_active_as_supervisor(p_username text,p_code text,p_job_id uuid,p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
  update public.job_types set active=p_active where id=p_job_id;
  if not found then raise exception 'Job not found'; end if;
end; $$;
create or replace function public.set_skill_rating_as_supervisor(p_username text,p_code text,p_staff_id uuid,p_job_id uuid,p_level smallint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
  insert into public.skill_ratings(profile_id,job_type_id,level,updated_at)
  values(p_staff_id,p_job_id,p_level,clock_timestamp())
  on conflict(profile_id,job_type_id) do update set level=excluded.level,updated_at=excluded.updated_at;
end; $$;

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
  insert into public.tickets(ticket_no,job_type_id,assignee_id,description,fg_code,fg_name,requested_qty,bom_version,materials)
  values(trim(p_ticket_no),p_job_type_id,p_assignee_id,coalesce(trim(p_description),''),trim(p_fg_code),trim(p_fg_name),p_requested_qty,p_bom_version,p_materials);
end; $$;

create or replace function public.start_ticket_as_operator(p_username text,p_code text,p_ticket_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_role_code('operator',p_username,p_code) then raise exception 'Operator access required'; end if;
  update public.tickets set status='active',started_at=clock_timestamp() where id=p_ticket_id and status='queued';
  if not found then raise exception 'Ticket is unavailable or already started'; end if;
end; $$;
create or replace function public.finish_ticket_as_operator(p_username text,p_code text,p_ticket_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_role_code('operator',p_username,p_code) then raise exception 'Operator access required'; end if;
  update public.tickets set status='done',ended_at=clock_timestamp() where id=p_ticket_id and status='active';
  if not found then raise exception 'Ticket is unavailable or already finished'; end if;
end; $$;

revoke all on function public.add_staff_as_supervisor(text,text,text), public.set_staff_active_as_supervisor(text,text,uuid,boolean),
  public.add_job_as_supervisor(text,text,text), public.set_job_active_as_supervisor(text,text,uuid,boolean),
  public.set_skill_rating_as_supervisor(text,text,uuid,uuid,smallint),
  public.create_bom_ticket_as_supervisor(text,text,text,uuid,uuid,text,text,text,numeric,text,jsonb),
  public.start_ticket_as_operator(text,text,uuid), public.finish_ticket_as_operator(text,text,uuid)
from public, authenticated;
grant execute on function public.add_staff_as_supervisor(text,text,text), public.set_staff_active_as_supervisor(text,text,uuid,boolean),
  public.add_job_as_supervisor(text,text,text), public.set_job_active_as_supervisor(text,text,uuid,boolean),
  public.set_skill_rating_as_supervisor(text,text,uuid,uuid,smallint),
  public.create_bom_ticket_as_supervisor(text,text,text,uuid,uuid,text,text,text,numeric,text,jsonb),
  public.start_ticket_as_operator(text,text,uuid), public.finish_ticket_as_operator(text,text,uuid)
to anon;

-- The old write RPCs become unusable as soon as activate_role_codes deletes edit_code.
-- Revoke direct access as additional defense after both roles are activated.
revoke all on function public.verify_edit_code(text),
  public.add_staff(text,text),public.set_staff_active(text,uuid,boolean),
  public.add_job(text,text),public.set_job_active(text,uuid,boolean),
  public.set_skill_rating(text,uuid,uuid,smallint),
  public.create_ticket_with_code(text,text,uuid,uuid,text),
  public.create_bom_ticket_with_code(text,text,uuid,uuid,text,text,text,numeric,text,jsonb),
  public.start_ticket_with_code(text,uuid),public.finish_ticket_with_code(text,uuid)
from anon;
