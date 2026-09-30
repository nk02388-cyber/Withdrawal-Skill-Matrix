alter table public.tickets add column pause_intervals jsonb not null default '[]',add column documents jsonb not null default '[]';
alter table public.ticket_events add column actor_staff_id uuid references public.staff(id),add column actor_display_name text;
-- Preserve unknown per-document quantities rather than divide historical totals.
-- Metadata backfill is atomic and must not create user-edit events or alter deleted work.
alter table public.tickets disable trigger user;
update public.tickets t set documents=(select jsonb_agg(jsonb_build_object('number',ref,'quantity',case when cardinality(public.withdrawal_document_refs(t.ticket_no,t.fg_code))=1 then t.requested_qty else null end) order by ordinal) from unnest(public.withdrawal_document_refs(t.ticket_no,t.fg_code)) with ordinality as x(ref,ordinal));
alter table public.tickets enable trigger user;
create table public.work_standards(
  job_type_id uuid not null references public.job_types(id),fg_code text not null default '',
  setup_minutes numeric not null check(setup_minutes between 0 and 100000),
  minutes_per_line numeric not null check(minutes_per_line between 0 and 100000),
  minutes_per_1000_fg numeric not null check(minutes_per_1000_fg between 0 and 100000),
  updated_at timestamptz not null default now(),updated_by text not null,
  primary key(job_type_id,fg_code),check(setup_minutes+minutes_per_line+minutes_per_1000_fg>0)
);
alter table public.work_standards enable row level security;
revoke all on public.work_standards from public,anon,authenticated;
create or replace function public.set_work_standard_as_supervisor(p_username text,p_code text,p_job_id uuid,p_fg_code text,p_setup numeric,p_line numeric,p_fg numeric) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
 if not exists(select 1 from public.job_types where id=p_job_id and active) then raise exception 'กรุณาเลือกประเภทงานที่เปิดใช้งาน'; end if;
 if length(coalesce(p_fg_code,''))>80 then raise exception 'รหัสสินค้ายาวเกินกำหนด'; end if;
 insert into public.work_standards values(p_job_id,upper(trim(coalesce(p_fg_code,''))),p_setup,p_line,p_fg,clock_timestamp(),p_username)
 on conflict(job_type_id,fg_code) do update set setup_minutes=excluded.setup_minutes,minutes_per_line=excluded.minutes_per_line,minutes_per_1000_fg=excluded.minutes_per_1000_fg,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
end; $$;
create or replace function public.track_work_intervals() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare supplied jsonb; refs text[]; row jsonb; total numeric:=0; actor uuid;
begin
 if tg_op='UPDATE' then
   if new.requested_qty is distinct from old.requested_qty then
     select jsonb_agg(case when line->>'source'='stock' then line else line-'actual_qty'-'confirmed_at'-'short_reason'-'reason_code' end order by ordinal) into new.materials from jsonb_array_elements(new.materials) with ordinality as x(line,ordinal);
   end if;
   new.pause_intervals:=old.pause_intervals;
   if old.status<>'paused' and new.status='paused' then
     new.pause_intervals:=new.pause_intervals||jsonb_build_array(jsonb_build_object('start',clock_timestamp(),'end',null));
   elsif old.status='paused' and new.status<>'paused' then
     select coalesce(jsonb_agg(case when p->>'end' is null then p||jsonb_build_object('end',coalesce(new.ended_at,clock_timestamp())) else p end),'[]') into new.pause_intervals from jsonb_array_elements(new.pause_intervals) p;
   end if;
 end if;
 supplied:=nullif(current_setting('app.work_documents',true),'')::jsonb;
 refs:=public.withdrawal_document_refs(new.ticket_no,new.fg_code);
 if supplied is not null then
   if jsonb_typeof(supplied)<>'array' or jsonb_array_length(supplied)<>cardinality(refs) then raise exception 'จำนวนใบในรายละเอียดไม่ตรงกับเลขที่ใบเบิก'; end if;
   if (select count(distinct upper(trim(p->>'number'))) from jsonb_array_elements(supplied) p)<>cardinality(refs) then raise exception 'เลขที่ใบเบิกว่างหรือซ้ำกัน'; end if;
   for row in select value from jsonb_array_elements(supplied) loop
     if not exists(select 1 from unnest(refs) r where upper(r)=upper(trim(row->>'number'))) then raise exception 'เลขที่ในรายละเอียดไม่ตรงกับใบเบิก'; end if;
     if new.fg_code is not null then
       if jsonb_typeof(row->'quantity') is distinct from 'number' or (row->>'quantity')::numeric<=0 or (row->>'quantity')::numeric>1000000 or (row->>'quantity')::numeric<>round((row->>'quantity')::numeric,3) then raise exception 'กรุณากรอกจำนวนผลิตรายใบให้ครบ'; end if;
       total:=total+(row->>'quantity')::numeric;
     end if;
   end loop;
   if new.fg_code is not null and total is distinct from new.requested_qty then raise exception 'ยอดรวมจำนวนผลิตไม่ตรงกับรายใบ'; end if;
   new.documents:=supplied;
 elsif tg_op='UPDATE' and (new.ticket_no is distinct from old.ticket_no or new.requested_qty is distinct from old.requested_qty) then
   select jsonb_agg(jsonb_build_object('number',r,'quantity',case when cardinality(refs)=1 then new.requested_qty else null end)) into new.documents from unnest(refs) r;
 end if;
 return new;
end; $$;
create trigger track_work_intervals before insert or update on public.tickets for each row execute function public.track_work_intervals();
create or replace function public.capture_ticket_event() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare event_name text; actor uuid; actor_name text;
begin
 event_name:=nullif(current_setting('app.ticket_event_type',true),'');
 actor:=nullif(current_setting('app.work_actor_id',true),'')::uuid;
 if actor is not null then select display_name into actor_name from public.staff where id=actor; end if;
 insert into public.ticket_events(ticket_id,event_type,actor_role,actor_username,actor_staff_id,actor_display_name,reason,before_state,after_state)
 values(new.id,coalesce(event_name,case when tg_op='INSERT' then 'created' else 'edited' end),coalesce(nullif(current_setting('app.ticket_actor_role',true),''),'system'),coalesce(nullif(current_setting('app.ticket_actor_username',true),''),'system'),actor,actor_name,nullif(current_setting('app.ticket_reason',true),''),case when tg_op='INSERT' then null else to_jsonb(old)-'created_by' end,to_jsonb(new)-'created_by');
 return new;
end; $$;
-- Existing confirmed-pick validation remains authoritative; add structured causes.
do $$ declare f record; definition text; begin
 for f in select p.oid from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname in ('confirm_ticket_picks_as_operator','edit_ticket_picks_as_supervisor') loop
   definition:=pg_get_functiondef(f.oid);
   definition:=replace(definition,'''confirmed_at'',clock_timestamp()', '''confirmed_at'',clock_timestamp(),''reason_code'',pick->>''reason_code''');
   execute definition;
 end loop;
end $$;
create or replace function public.perform_work_action(p_username text,p_code text,p_role text,p_actor_id uuid,p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare allowed text[]:=array['start_ticket_as_operator','finish_ticket_as_operator','pause_ticket_as_operator','resume_ticket_as_operator','mark_ticket_partial_as_operator','confirm_ticket_picks_as_operator','create_withdrawal_ticket_as_supervisor','edit_ticket_with_times_as_supervisor','edit_ticket_picks_as_supervisor','cancel_ticket_as_supervisor','set_ticket_deleted_as_supervisor','add_staff_with_photo_as_supervisor','rename_staff_as_supervisor','set_staff_photo_as_supervisor','set_staff_active_as_supervisor','add_job_as_supervisor','set_job_active_as_supervisor','set_skill_rating_as_supervisor','set_work_standard_as_supervisor'];
 proc record; expressions text:=''; i integer; args jsonb; result jsonb; pick jsonb; t public.tickets%rowtype;
begin
 if not p_action=any(allowed) or p_role not in ('operator','supervisor') or right(p_action,length('_as_'||p_role))<>'_as_'||p_role then raise exception 'สิทธิ์ไม่ตรงกับการทำรายการ'; end if;
 if not public.check_role_code(p_role,p_username,p_code) then raise exception 'สิทธิ์ใช้งานไม่ถูกต้อง'; end if;
 if p_role='operator' and not exists(select 1 from public.staff where id=p_actor_id and active) then raise exception 'กรุณาระบุผู้ทำรายการที่เปิดใช้งาน'; end if;
 if jsonb_typeof(p_args) is distinct from 'object' then raise exception 'ข้อมูลไม่ถูกต้อง'; end if;
 args:=p_args||jsonb_build_object('p_username',p_username,'p_code',p_code);
 if p_args ? 'p_ticket_id' then
   select * into t from public.tickets where id=(p_args->>'p_ticket_id')::uuid for update;
   if not found then raise exception 'ไม่พบงาน'; end if;
 end if;
 if p_action in ('confirm_ticket_picks_as_operator','edit_ticket_picks_as_supervisor') then
   i:=0;
   for pick in select value from jsonb_array_elements(p_args->'p_picks') loop
     if (pick->>'actual_qty')::numeric is distinct from (t.materials->i->>'required_qty')::numeric and coalesce(pick->>'reason_code','') not in ('stock_shortage','approved_extra','bom_difference','picking_error','other') then raise exception 'กรุณาเลือกประเภทเหตุผลของรายการขาดหรือเกิน'; end if;
     i:=i+1;
   end loop;
 end if;
 if p_action='finish_ticket_as_operator' and jsonb_array_length(coalesce(t.materials,'[]'))>0 then raise exception 'กรุณาบันทึกยอดเบิกจริงให้ครบผ่านปุ่มจบงาน'; end if;
 perform set_config('app.work_actor_id',coalesce(p_actor_id::text,''),true);
 perform set_config('app.work_documents',coalesce((p_args->'p_documents')::text,''),true);
 if p_action='create_withdrawal_ticket_as_supervisor' and nullif(p_args->>'p_fg_code','') is not null and not(p_args ? 'p_documents') then raise exception 'กรุณาระบุจำนวนผลิตรายใบ'; end if;
 select p.oid,p.proargnames,p.proargtypes,p.pronargs,p.prorettype into proc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=p_action;
 for i in 1..proc.pronargs loop
   if i>1 then expressions:=expressions||','; end if;
   if proc.proargtypes[i-1]='jsonb'::regtype then expressions:=expressions||format('($1->%L)',proc.proargnames[i]);
   else expressions:=expressions||format('($1->>%L)::%s',proc.proargnames[i],format_type(proc.proargtypes[i-1],null)); end if;
 end loop;
 if proc.prorettype='void'::regtype then execute format('select public.%I(%s)',p_action,expressions) using args;result:='true';
 else execute format('select to_jsonb(public.%I(%s))',p_action,expressions) into result using args; end if;
 return result;
end; $$;
revoke all on function public.perform_work_action(text,text,text,uuid,text,jsonb) from public,authenticated;
grant execute on function public.perform_work_action(text,text,text,uuid,text,jsonb) to anon;
create or replace function public.get_dashboard_state() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('people',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'display_name',s.display_name,'active',s.active,'photo_data',s.photo_data)) from public.staff s),'[]'),'jobs',coalesce((select jsonb_agg(to_jsonb(j)) from public.job_types j),'[]'),'tickets',coalesce((select jsonb_agg(to_jsonb(t)-'created_by' order by t.created_at desc) from public.tickets t where deleted_at is null),'[]'),'skills',coalesce((select jsonb_agg(jsonb_build_object('profile_id',profile_id,'job_type_id',job_type_id,'level',level)) from public.skill_ratings),'[]'),'standards',coalesce((select jsonb_agg(to_jsonb(s)) from public.work_standards s),'[]'));
$$;
create or replace function public.get_ticket_history(p_ticket_id uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(e) order by created_at desc),'[]') from public.ticket_events e where ticket_id=p_ticket_id;
$$;
revoke all on function public.track_work_intervals(),public.capture_ticket_event(),public.set_work_standard_as_supervisor(text,text,uuid,text,numeric,numeric,numeric) from public,anon,authenticated;
notify pgrst,'reload schema';
