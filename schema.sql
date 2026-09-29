-- Run once in the Supabase SQL editor, or apply as a migration.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null default 'worker' check (role in ('worker','admin')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.job_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no text not null unique check (length(trim(ticket_no)) between 1 and 80),
  job_type_id uuid not null references public.job_types(id),
  assignee_id uuid not null references public.profiles(id),
  description text not null default '' check (length(description) <= 1000),
  status text not null default 'queued' check (status in ('queued','active','done')),
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint valid_times check (
    (status = 'queued' and started_at is null and ended_at is null) or
    (status = 'active' and started_at is not null and ended_at is null) or
    (status = 'done' and started_at is not null and ended_at is not null and ended_at >= started_at)
  )
);

create table public.skill_ratings (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  job_type_id uuid not null references public.job_types(id) on delete cascade,
  level smallint not null check (level between 0 and 4),
  assessed_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (profile_id, job_type_id)
);

create index tickets_assignee_status_idx on public.tickets(assignee_id,status);
create index tickets_created_at_idx on public.tickets(created_at desc);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles(id,email,display_name)
  values(new.id,new.email,coalesce(nullif(new.raw_user_meta_data->>'display_name',''),split_part(new.email,'@',1)));
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.profiles where id=auth.uid() and active);
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.profiles where id=auth.uid() and active and role='admin');
$$;

alter table public.profiles enable row level security;
alter table public.job_types enable row level security;
alter table public.tickets enable row level security;
alter table public.skill_ratings enable row level security;

create policy profiles_read on public.profiles for select to authenticated
using (id=auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy jobs_read on public.job_types for select to authenticated
using (public.is_active() and (active or public.is_admin()));
create policy jobs_admin_insert on public.job_types for insert to authenticated
with check (public.is_admin());
create policy jobs_admin_update on public.job_types for update to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy tickets_read on public.tickets for select to authenticated
using (public.is_active() and (assignee_id=auth.uid() or public.is_admin()));
create policy tickets_admin_insert on public.tickets for insert to authenticated
with check (public.is_admin() and created_by=auth.uid());
create policy tickets_admin_update on public.tickets for update to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy skills_read on public.skill_ratings for select to authenticated
using (public.is_active() and (profile_id=auth.uid() or public.is_admin()));
create policy skills_admin_insert on public.skill_ratings for insert to authenticated
with check (public.is_admin());
create policy skills_admin_update on public.skill_ratings for update to authenticated
using (public.is_admin()) with check (public.is_admin());

create or replace function public.start_ticket(p_ticket_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_active() then raise exception 'Account is not active'; end if;
  update public.tickets set status='active',started_at=clock_timestamp()
  where id=p_ticket_id and status='queued' and (assignee_id=auth.uid() or public.is_admin());
  if not found then raise exception 'Ticket is unavailable or already started'; end if;
end; $$;

create or replace function public.finish_ticket(p_ticket_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_active() then raise exception 'Account is not active'; end if;
  update public.tickets set status='done',ended_at=clock_timestamp()
  where id=p_ticket_id and status='active' and (assignee_id=auth.uid() or public.is_admin());
  if not found then raise exception 'Ticket is unavailable or already finished'; end if;
end; $$;

revoke all on function public.start_ticket(uuid) from public, anon;
revoke all on function public.finish_ticket(uuid) from public, anon;
grant execute on function public.start_ticket(uuid), public.finish_ticket(uuid) to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_active(), public.is_admin() from public, anon;
grant execute on function public.is_active(), public.is_admin() to authenticated;
