create or replace function public.manage_work(p_username text,p_code text,p_role text,p_action text,p_args jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tickets%rowtype;before_value jsonb;after_value jsonb;s jsonb;l jsonb;fingerprint text;h jsonb;idx integer;
begin
 if p_role not in ('supervisor','clerk') or not check_role_code(p_role,p_username,p_code) then raise exception 'สิทธิ์ใช้งานไม่ถูกต้อง';end if;
 if coalesce(p_action,'') not in ('plan','case','settings','clerk_account','history') then raise exception 'ไม่รองรับการทำรายการ';end if;
 if p_role='clerk' and p_action not in ('case','history') then raise exception 'ธุรการจัดการได้เฉพาะเรื่องของขาด–เบิกเกิน';end if;
 if p_action='history' then
  return (select coalesce(jsonb_agg(x order by x->>'created_at' desc),'[]') from (
   select jsonb_build_object('id',e.id,'ticket_no',wt.ticket_no,'event_type',e.event_type,'actor_username',e.actor_username,'actor_role',e.actor_role,'reason',e.reason,'before_state',e.before_state,'after_state',e.after_state,'created_at',e.created_at) x from ticket_events e join tickets wt on wt.id=e.ticket_id
   union all select to_jsonb(e) from management_events e) q);
 end if;
 if p_action in ('plan','case') then
  select * into t from tickets where id=(p_args->>'ticket_id')::uuid for update;
  if not found or t.deleted_at is not null then raise exception 'ไม่พบใบเบิกที่ใช้งาน กรุณาโหลดข้อมูลใหม่';end if;
 end if;
 if p_action='plan' then
  if t.status in ('done','partial','cancelled') then raise exception 'วางแผนได้เฉพาะงานที่ยังเปิด';end if;
  if coalesce(p_args->>'priority','') not in ('normal','high','urgent') or not exists(select 1 from staff where id=(p_args->>'assignee_id')::uuid and active) then raise exception 'เลือกความเร่งด่วนและพนักงานให้ครบ';end if;
  if (p_args->'expected') is distinct from jsonb_build_array(t.planned_date,t.due_at,t.priority,t.assignee_id) then raise exception 'แผนงานเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่';end if;
  if nullif(p_args->>'planned_date','') is not null and nullif(p_args->>'due_at','') is not null and (p_args->>'due_at')::timestamptz < ((p_args->>'planned_date')::date::timestamp at time zone 'Asia/Bangkok') then raise exception 'กำหนดส่งต้องไม่ก่อนวันวางแผน';end if;
  before_value:=jsonb_build_object('planned_date',t.planned_date,'due_at',t.due_at,'priority',t.priority,'assignee_id',t.assignee_id);
  perform set_config('app.ticket_actor_role',p_role,true);perform set_config('app.ticket_actor_username',p_username,true);perform set_config('app.ticket_reason','ปรับแผนงาน',true);perform set_config('app.ticket_event_type','edited',true);
  update tickets set planned_date=nullif(p_args->>'planned_date','')::date,due_at=nullif(p_args->>'due_at','')::timestamptz,priority=p_args->>'priority',assignee_id=(p_args->>'assignee_id')::uuid where id=t.id;
  return 'true';
 elsif p_action='case' then
  idx:=(p_args->>'line_index')::integer;l:=t.materials->idx;
  if idx<0 or l is null or nullif(l->>'confirmed_at','') is null or jsonb_typeof(l->'actual_qty')<>'number' or (l->>'actual_qty')::numeric=(l->>'required_qty')::numeric then raise exception 'รายการนี้ไม่มีขาดหรือเกินที่ยืนยันแล้ว';end if;
  -- The browser supplies a canonical fingerprint. Validate every component on the server.
  s:=(p_args->>'fingerprint')::jsonb;
  if s->>0 is distinct from l->>'pk_code' or (s->>1)::numeric is distinct from (l->>'required_qty')::numeric or (s->>2)::numeric is distinct from (l->>'actual_qty')::numeric or s->>3 is distinct from l->>'confirmed_at' then raise exception 'ยอดเบิกเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่';end if;
  if coalesce(p_args->>'status','') not in ('open','following','resolved') or length(trim(coalesce(p_args->>'note',''))) not between 1 and 1000 then raise exception 'เลือกสถานะและระบุผลติดตามไม่เกิน 1000 ตัวอักษร';end if;
  select to_jsonb(c) into before_value from material_cases c where ticket_id=t.id and line_index=idx for update;
  if coalesce(p_args->>'expected_updated_at','')<>coalesce(before_value->>'updated_at','') then raise exception 'ผลติดตามเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่';end if;
  insert into material_cases values(t.id,idx,p_args->>'fingerprint',p_args->>'status',trim(p_args->>'note'),clock_timestamp(),p_username) on conflict(ticket_id,line_index) do update set fingerprint=excluded.fingerprint,status=excluded.status,note=excluded.note,updated_at=excluded.updated_at,updated_by=excluded.updated_by returning to_jsonb(material_cases.*) into after_value;
 elsif p_action='settings' then
  select settings into before_value from work_management_settings where id for update;s:=p_args->'settings';
  if before_value is distinct from p_args->'expected' then raise exception 'ตั้งค่าเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่';end if;
  if not coalesce((s->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and s->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and s->>'lunchStart' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and s->>'lunchEnd' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') and (s->>'start'<s->>'lunchStart' and s->>'lunchStart'<s->>'lunchEnd' and s->>'lunchEnd'<s->>'end'),false) then raise exception 'เวลาทำงานไม่ถูกต้อง';end if;
  if s ? 'reasonNames' then
   if jsonb_typeof(s->'reasonNames') is distinct from 'object' then raise exception 'ประเภทเหตุผลไม่ถูกต้อง';end if;
   for h in select value from jsonb_each(s->'reasonNames') loop if jsonb_typeof(h)<>'string' or length(trim(h#>>'{}')) not between 1 and 80 then raise exception 'ชื่อเหตุผลต้องมี 1–80 ตัวอักษร';end if;end loop;
   if exists(select 1 from jsonb_object_keys(s->'reasonNames') k where k not in ('stock_shortage','approved_extra','bom_difference','picking_error','other')) then raise exception 'รหัสเหตุผลไม่ถูกต้อง';end if;
  end if;
  if jsonb_typeof(s->'holidays') is distinct from 'array' or jsonb_array_length(s->'holidays')>366 then raise exception 'วันหยุดไม่ถูกต้อง';end if;
  for h in select value from jsonb_array_elements(s->'holidays') loop perform (h#>>'{}')::date;end loop;
  if not exists(select 1 from staff where id=(s->>'exceptionOwnerId')::uuid and active) then raise exception 'เลือกผู้รับผิดชอบที่เปิดใช้งาน';end if;
  select s||jsonb_build_object('exceptionOwnerName',display_name) into s from staff where id=(s->>'exceptionOwnerId')::uuid;
  update work_management_settings set settings=s,updated_at=clock_timestamp() where id;after_value:=s;
 elsif p_action='clerk_account' then
  if length(trim(coalesce(p_args->>'username',''))) not between 1 and 80 or length(coalesce(p_args->>'password','')) not between 6 and 128 then raise exception 'ชื่อผู้ใช้ 1–80 ตัวอักษร รหัสผ่าน 6–128 ตัวอักษร';end if;
  if exists(select 1 from app_settings where key in ('supervisor_username','operator_username') and value=trim(p_args->>'username')) then raise exception 'ชื่อผู้ใช้ซ้ำกับบัญชีทีม';end if;
  insert into app_settings(key,value) values('clerk_username',trim(p_args->>'username')),('clerk_code',extensions.crypt(p_args->>'password',extensions.gen_salt('bf'))) on conflict(key) do update set value=excluded.value;
  after_value:=jsonb_build_object('username',trim(p_args->>'username')); -- Never log the password/hash.
 end if;
 insert into management_events(ticket_no,event_type,actor_username,actor_role,reason,before_state,after_state) values(t.ticket_no,p_action,p_username,p_role,p_args->>'note',before_value,after_value);
 return 'true';
end;$$;

create or replace function public.capture_permanent_receipt() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 delete from management_events where ticket_no=old.ticket_no and event_type<>'purged';
 insert into management_events(ticket_no,event_type,actor_username,actor_role,reason) values(old.ticket_no,'purged',coalesce(nullif(current_setting('app.ticket_actor_username',true),''),'system'),'supervisor',nullif(current_setting('app.ticket_reason',true),''));return old;
end;$$;
