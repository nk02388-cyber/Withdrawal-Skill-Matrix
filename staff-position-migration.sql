alter table public.staff add column position text not null default '' check(length(position)<=100);
create function public.add_staff_profile_as_supervisor(p_username text,p_code text,p_name text,p_position text,p_photo text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare staff_id uuid;
begin
 if not check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required';end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 100 or length(coalesce(p_position,''))>100 then raise exception 'กรอกชื่อและตำแหน่งไม่เกิน 100 ตัวอักษร';end if;
 perform validate_staff_photo(p_photo);
 insert into staff(display_name,position,photo_data) values(trim(p_name),trim(coalesce(p_position,'')),p_photo) returning id into staff_id;
 insert into management_events(event_type,actor_username,actor_role,after_state) values('staff_added',p_username,'supervisor',jsonb_build_object('display_name',trim(p_name),'position',trim(coalesce(p_position,''))));
 return staff_id;
end;$$;
create function public.edit_staff_profile_as_supervisor(p_username text,p_code text,p_staff_id uuid,p_name text,p_position text,p_expected jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.staff%rowtype;before_value jsonb;
begin
 if not check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required';end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 100 or length(coalesce(p_position,''))>100 then raise exception 'กรอกชื่อและตำแหน่งไม่เกิน 100 ตัวอักษร';end if;
 select * into s from staff where id=p_staff_id for update;
 if not found then raise exception 'ไม่พบพนักงาน';end if;
 if p_expected is distinct from jsonb_build_array(s.display_name,s.position) then raise exception 'ข้อมูลพนักงานเปลี่ยนแล้ว กรุณาปิดหน้าต่างและโหลดใหม่';end if;
 before_value:=jsonb_build_object('display_name',s.display_name,'position',s.position);
 update staff set display_name=trim(p_name),position=trim(coalesce(p_position,'')) where id=p_staff_id;
 insert into management_events(event_type,actor_username,actor_role,before_state,after_state) values('staff_edited',p_username,'supervisor',before_value,jsonb_build_object('display_name',trim(p_name),'position',trim(coalesce(p_position,''))));
end;$$;
revoke all on function public.add_staff_profile_as_supervisor(text,text,text,text,text),public.edit_staff_profile_as_supervisor(text,text,uuid,text,text,jsonb) from public,anon,authenticated;
do $$ declare d text;begin
 d:=pg_get_functiondef('public.perform_work_action(text,text,text,uuid,text,jsonb)'::regprocedure);
 d:=replace(d,'''start_ticket_as_operator''','''add_staff_profile_as_supervisor'',''edit_staff_profile_as_supervisor'',''start_ticket_as_operator''');execute d;
 d:=pg_get_functiondef('public.get_dashboard_state()'::regprocedure);
 d:=replace(d,'''photo_data'',s.photo_data','''photo_data'',s.photo_data,''position'',s.position');
 if position('''position'',s.position' in d)=0 then raise exception 'Dashboard position extension failed';end if;execute d;
end $$;
notify pgrst,'reload schema';
