-- Switch this project from individual accounts to public viewing + shared edit code.
-- The edit code hash is installed separately; never commit the plain code.
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.app_settings (
  key text primary key,
  value text not null
);

alter table public.tickets drop constraint tickets_assignee_id_fkey;
alter table public.tickets add constraint tickets_assignee_id_fkey foreign key (assignee_id) references public.staff(id);
alter table public.tickets alter column created_by drop not null;
alter table public.skill_ratings drop constraint skill_ratings_profile_id_fkey;
alter table public.skill_ratings add constraint skill_ratings_profile_id_fkey foreign key (profile_id) references public.staff(id) on delete cascade;

alter table public.staff enable row level security;
alter table public.app_settings enable row level security;
revoke all on public.profiles, public.job_types, public.tickets, public.skill_ratings, public.staff, public.app_settings from anon;

create or replace function public.check_edit_code(p_code text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select value = extensions.crypt(p_code, value) from public.app_settings where key='edit_code'), false);
$$;
revoke all on function public.check_edit_code(text) from public, anon, authenticated;

create or replace function public.get_dashboard_state() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'people', coalesce((select jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'active',active) order by display_name) from public.staff), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by name) from public.job_types), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id',id,'ticket_no',ticket_no,'job_type_id',job_type_id,'assignee_id',assignee_id,'description',description,'status',status,'started_at',started_at,'ended_at',ended_at,'created_at',created_at) order by created_at desc) from public.tickets), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('profile_id',profile_id,'job_type_id',job_type_id,'level',level)) from public.skill_ratings), '[]'::jsonb)
  );
$$;
revoke all on function public.get_dashboard_state() from public, authenticated;
grant execute on function public.get_dashboard_state() to anon;

create or replace function public.verify_edit_code(p_code text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.check_edit_code(p_code);
$$;
revoke all on function public.verify_edit_code(text) from public, authenticated;
grant execute on function public.verify_edit_code(text) to anon;

create or replace function public.add_staff(p_code text, p_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_edit_code(p_code) then raise exception 'Invalid edit code'; end if;
  insert into public.staff(display_name) values(trim(p_name));
end; $$;
create or replace function public.set_staff_active(p_code text,p_staff_id uuid,p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_edit_code(p_code) then raise exception 'Invalid edit code'; end if;
  update public.staff set active=p_active where id=p_staff_id;
  if not found then raise exception 'Staff not found'; end if;
end; $$;
create or replace function public.add_job(p_code text,p_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_edit_code(p_code) then raise exception 'Invalid edit code'; end if;
  insert into public.job_types(name) values(trim(p_name));
end; $$;
create or replace function public.set_job_active(p_code text,p_job_id uuid,p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_edit_code(p_code) then raise exception 'Invalid edit code'; end if;
  update public.job_types set active=p_active where id=p_job_id;
  if not found then raise exception 'Job not found'; end if;
end; $$;
create or replace function public.set_skill_rating(p_code text,p_staff_id uuid,p_job_id uuid,p_level smallint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_edit_code(p_code) then raise exception 'Invalid edit code'; end if;
  insert into public.skill_ratings(profile_id,job_type_id,level,updated_at)
  values(p_staff_id,p_job_id,p_level,clock_timestamp())
  on conflict(profile_id,job_type_id) do update set level=excluded.level,updated_at=excluded.updated_at;
end; $$;
create or replace function public.create_ticket_with_code(p_code text,p_ticket_no text,p_job_type_id uuid,p_assignee_id uuid,p_description text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_edit_code(p_code) then raise exception 'Invalid edit code'; end if;
  if not exists(select 1 from public.staff where id=p_assignee_id and active) then raise exception 'Staff is inactive'; end if;
  if not exists(select 1 from public.job_types where id=p_job_type_id and active) then raise exception 'Job is inactive'; end if;
  insert into public.tickets(ticket_no,job_type_id,assignee_id,description)
  values(trim(p_ticket_no),p_job_type_id,p_assignee_id,coalesce(trim(p_description),''));
end; $$;
create or replace function public.start_ticket_with_code(p_code text,p_ticket_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_edit_code(p_code) then raise exception 'Invalid edit code'; end if;
  update public.tickets set status='active',started_at=clock_timestamp() where id=p_ticket_id and status='queued';
  if not found then raise exception 'Ticket is unavailable or already started'; end if;
end; $$;
create or replace function public.finish_ticket_with_code(p_code text,p_ticket_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.check_edit_code(p_code) then raise exception 'Invalid edit code'; end if;
  update public.tickets set status='done',ended_at=clock_timestamp() where id=p_ticket_id and status='active';
  if not found then raise exception 'Ticket is unavailable or already finished'; end if;
end; $$;

revoke all on function public.add_staff(text,text), public.set_staff_active(text,uuid,boolean),
  public.add_job(text,text), public.set_job_active(text,uuid,boolean), public.set_skill_rating(text,uuid,uuid,smallint),
  public.create_ticket_with_code(text,text,uuid,uuid,text), public.start_ticket_with_code(text,uuid), public.finish_ticket_with_code(text,uuid)
from public, authenticated;
grant execute on function public.add_staff(text,text), public.set_staff_active(text,uuid,boolean),
  public.add_job(text,text), public.set_job_active(text,uuid,boolean), public.set_skill_rating(text,uuid,uuid,smallint),
  public.create_ticket_with_code(text,text,uuid,uuid,text), public.start_ticket_with_code(text,uuid), public.finish_ticket_with_code(text,uuid)
to anon;

-- Retire former account-based write endpoints.
revoke all on function public.start_ticket(uuid), public.finish_ticket(uuid) from authenticated;
