-- Apply after no-login-migration.sql. BOM data is sourced from PK WMS and
-- snapshotted on each ticket so later formula edits do not rewrite history.
alter table public.tickets
  add column fg_code text,
  add column fg_name text,
  add column requested_qty numeric(14,3),
  add column bom_version text,
  add column materials jsonb;

alter table public.tickets
  add constraint tickets_requested_qty_positive check (requested_qty is null or requested_qty > 0),
  add constraint tickets_materials_array check (materials is null or jsonb_typeof(materials) = 'array');

create or replace function public.get_dashboard_state() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'people', coalesce((select jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'active',active) order by display_name) from public.staff), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by name) from public.job_types), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id',id,'ticket_no',ticket_no,'job_type_id',job_type_id,'assignee_id',assignee_id,'description',description,'status',status,'started_at',started_at,'ended_at',ended_at,'created_at',created_at,'fg_code',fg_code,'fg_name',fg_name,'requested_qty',requested_qty,'bom_version',bom_version,'materials',materials) order by created_at desc) from public.tickets), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('profile_id',profile_id,'job_type_id',job_type_id,'level',level)) from public.skill_ratings), '[]'::jsonb)
  );
$$;

create or replace function public.create_bom_ticket_with_code(
  p_code text, p_ticket_no text, p_job_type_id uuid, p_assignee_id uuid,
  p_description text, p_fg_code text, p_fg_name text, p_requested_qty numeric,
  p_bom_version text, p_materials jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare line jsonb;
begin
  if not public.check_edit_code(p_code) then raise exception 'Invalid edit code'; end if;
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

revoke all on function public.create_ticket_with_code(text,text,uuid,uuid,text) from anon;
revoke all on function public.create_bom_ticket_with_code(text,text,uuid,uuid,text,text,text,numeric,text,jsonb) from public, authenticated;
grant execute on function public.create_bom_ticket_with_code(text,text,uuid,uuid,text,text,text,numeric,text,jsonb) to anon;
