create table public.competency_catalog(id uuid primary key default gen_random_uuid(),category text not null,name text not null unique,sort_order integer not null,target_foreman integer not null default 5,target_admin integer not null default 5);
create table public.competency_ratings(staff_id uuid references public.staff(id),competency_id uuid references public.competency_catalog(id),level integer not null check(level between 1 and 5),primary key(staff_id,competency_id));
alter table public.competency_catalog enable row level security;
alter table public.competency_ratings enable row level security;
revoke all on public.competency_catalog,public.competency_ratings from anon,authenticated;
insert into public.job_types(name) select 'Warehouse packing' where not exists(select 1 from public.job_types where lower(name)='warehouse packing');
insert into public.competency_catalog(category,name,sort_order) values ('ทักษะด้านเอกสาร','ความเข้าใจในใบ PO / ใบส่งของ',1),
('ทักษะด้านเอกสาร','ความเข้าใจในใบรับ–เบิก packing',2),
('ทักษะด้านเอกสาร','ความเข้าใจใน COA (Certificate of Analysis)',3),
('ทักษะด้านเอกสาร','ความเข้าใจใน Stock Card',4),
('ทักษะด้านเอกสาร','ความเข้าใจใน WI / SOP ที่เกี่ยวข้องกับงานคลัง',5),
('ทักษะด้านเอกสาร','ความเข้าใจในการบันทึกข้อมูลให้ถูกต้องและครบถ้วน',6),
('ทักษะด้านเอกสาร','ความเข้าใจในการตรวจสอบเอกสารย้อนหลัง / Traceability',7),
('ทักษะด้านขั้นตอนการทำงาน','ความเข้าใจในการรับ packing',8),
('ทักษะด้านขั้นตอนการทำงาน','ความเข้าใจในการตรวจสอบสถานะวัตถุดิบ HOLD / ทำลาย',9),
('ทักษะด้านขั้นตอนการทำงาน','ความเข้าใจในการจัดเก็บ / Location',10),
('ทักษะด้านขั้นตอนการทำงาน','เข้าใจหลัก FIFO',11),
('ทักษะด้านขั้นตอนการทำงาน','ความเข้าใจในการเบิก Packing',12),
('ทักษะด้านขั้นตอนการทำงาน','ความเข้าใจในการตรวจนับ Stock',13),
('ทักษะด้านขั้นตอนการทำงาน','ความเข้าใจในการ GMP / 5S / Safety',14),
('ทักษะด้านขั้นตอนการทำงาน','การทำงานร่วมกับผู้อื่น',15),
('ทักษะด้านขั้นตอนการทำงาน','มีความรับผิดชอบต่อการทำงาน',16),
('ทักษะด้านเครื่องมือ','เครื่องมือในการรับ–ตรวจสอบ (เครื่องชั่งน้ำหนัก, เครื่องวัดอุณหภูมิ และอื่น ๆ)',17),
('ทักษะด้านเครื่องมือ','เครื่องมือในการเคลื่อนย้าย (Forklift, Hand Pallet Truck และอื่น ๆ)',18),
('ทักษะด้านเครื่องมือ','ระบบและอุปกรณ์ IT (Computer / PC, Printer, Dashboard)',19),
('ทักษะด้านเครื่องมือ','อุปกรณ์ Safety (Safety Shoes, ถังดับเพลิง, Safety Helmet)',20);
create function public.get_competency_state() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$ select jsonb_build_object('catalog',(select jsonb_agg(to_jsonb(c) order by sort_order) from competency_catalog c),'ratings',coalesce((select jsonb_agg(to_jsonb(r)) from competency_ratings r),'[]'::jsonb)); $$;
grant execute on function public.get_competency_state() to anon,authenticated;
create function public.set_competency_as_supervisor(p_username text,p_code text,p_staff_id uuid,p_competency_id uuid,p_level integer,p_expected integer) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare old_level integer;s staff%rowtype;c competency_catalog%rowtype;
begin
 if not check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required';end if;
 if p_level is null or p_level not between 0 and 5 then raise exception 'คะแนนต้องอยู่ระหว่าง 1–5 หรือ 0 เพื่อล้างคะแนน';end if;
 select * into s from staff where id=p_staff_id for update;if not found then raise exception 'ไม่พบพนักงาน';end if;
 select * into c from competency_catalog where id=p_competency_id;if not found then raise exception 'ไม่พบทักษะ';end if;
 select level into old_level from competency_ratings where staff_id=p_staff_id and competency_id=p_competency_id;
 if old_level is distinct from p_expected then raise exception 'คะแนนเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่';end if;
 if p_level=0 then delete from competency_ratings where staff_id=p_staff_id and competency_id=p_competency_id;
 else insert into competency_ratings values(p_staff_id,p_competency_id,p_level) on conflict(staff_id,competency_id) do update set level=excluded.level;end if;
 insert into management_events(event_type,actor_username,actor_role,before_state,after_state) values('competency_assessed',p_username,'supervisor',jsonb_build_object('employee',s.display_name,'competency',c.name,'level',old_level),jsonb_build_object('employee',s.display_name,'competency',c.name,'level',nullif(p_level,0)));
end;$$;
revoke all on function public.set_competency_as_supervisor(text,text,uuid,uuid,integer,integer) from public,anon,authenticated;
do $$ declare d text;begin d:=pg_get_functiondef('public.perform_work_action(text,text,text,uuid,text,jsonb)'::regprocedure);d:=replace(d,'''start_ticket_as_operator''','''set_competency_as_supervisor'',''start_ticket_as_operator''');execute d;end $$;
notify pgrst,'reload schema';
