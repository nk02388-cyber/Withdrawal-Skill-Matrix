alter table public.tickets add column deleted_at timestamptz;
alter table public.ticket_events drop constraint ticket_events_event_type_check;
alter table public.ticket_events add constraint ticket_events_event_type_check check(event_type in ('created','imported','started','paused','resumed','completed','partial','cancelled','edited','deleted','restored'));
create or replace function public.set_ticket_deleted_as_supervisor(p_username text,p_code text,p_ticket_id uuid,p_reason text,p_deleted boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
 if length(trim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Reason required'; end if;
 perform set_config('app.ticket_actor_role','supervisor',true);
 perform set_config('app.ticket_actor_username',p_username,true);
 perform set_config('app.ticket_event_type',case when p_deleted then 'deleted' else 'restored' end,true);
 perform set_config('app.ticket_reason',trim(p_reason),true);
 update public.tickets set deleted_at=case when p_deleted then clock_timestamp() else null end
 where id=p_ticket_id and (deleted_at is not null) is distinct from p_deleted;
 if not found then raise exception 'ใบเบิกถูกลบหรือกู้คืนแล้ว กรุณาโหลดข้อมูลใหม่'; end if;
end; $$;
revoke all on function public.set_ticket_deleted_as_supervisor(text,text,uuid,text,boolean) from public,authenticated;
grant execute on function public.set_ticket_deleted_as_supervisor(text,text,uuid,text,boolean) to anon;
create or replace function public.guard_deleted_ticket() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if old.deleted_at is not null and (new.deleted_at is not null or current_setting('app.ticket_event_type',true) is distinct from 'restored') then raise exception 'ใบเบิกถูกลบแล้ว กรุณากู้คืนก่อนแก้ไข'; end if;
 return new;
end; $$;
revoke all on function public.guard_deleted_ticket() from public,anon,authenticated;
create trigger ticket_deleted_before_update before update on public.tickets for each row execute function public.guard_deleted_ticket();
create or replace function public.get_deleted_tickets_as_supervisor(p_username text,p_code text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
 return coalesce((select jsonb_agg(to_jsonb(t)-'created_by' order by deleted_at desc) from public.tickets t where deleted_at is not null),'[]'::jsonb);
end; $$;
revoke all on function public.get_deleted_tickets_as_supervisor(text,text) from public,authenticated;
grant execute on function public.get_deleted_tickets_as_supervisor(text,text) to anon;
create or replace function public.get_dashboard_state() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'people', coalesce((select jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'active',active) order by display_name) from public.staff), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by name) from public.job_types), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id',id,'ticket_no',ticket_no,'job_type_id',job_type_id,'assignee_id',assignee_id,'description',description,'status',status,'status_reason',status_reason,'started_at',started_at,'ended_at',ended_at,'created_at',created_at,'fg_code',fg_code,'fg_name',fg_name,'requested_qty',requested_qty,'bom_version',bom_version,'materials',materials) order by created_at desc) from public.tickets where deleted_at is null), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('profile_id',profile_id,'job_type_id',job_type_id,'level',level)) from public.skill_ratings), '[]'::jsonb)
  );
$$;

