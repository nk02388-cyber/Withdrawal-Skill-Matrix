alter table public.staff add column photo_data text;
create or replace function public.validate_staff_photo(p_photo text) returns void language plpgsql set search_path=public,pg_temp as $$
declare image_bytes bytea;
begin
 if p_photo is null then return; end if;
 if length(p_photo)>100000 or p_photo !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$' then raise exception 'รูปภาพไม่ถูกต้องหรือมีขนาดใหญ่เกินไป'; end if;
 image_bytes:=decode(substr(p_photo,24),'base64');
 if octet_length(image_bytes)<4 or substring(image_bytes from 1 for 3)<>decode('ffd8ff','hex') or substring(image_bytes from octet_length(image_bytes)-1 for 2)<>decode('ffd9','hex') then raise exception 'รูปภาพต้องเป็น JPEG'; end if;
end; $$;
revoke all on function public.validate_staff_photo(text) from public,anon,authenticated;
create or replace function public.add_staff_with_photo_as_supervisor(p_username text,p_code text,p_name text,p_photo text default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare staff_id uuid;
begin
 if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 100 then raise exception 'กรุณาระบุชื่อพนักงานไม่เกิน 100 ตัวอักษร'; end if;
 perform public.validate_staff_photo(p_photo);
 insert into public.staff(display_name,photo_data) values(trim(p_name),p_photo) returning id into staff_id;
 return staff_id;
end; $$;
create or replace function public.set_staff_photo_as_supervisor(p_username text,p_code text,p_staff_id uuid,p_photo text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
 if p_photo is null then raise exception 'กรุณาเลือกรูปภาพ'; end if;
 perform public.validate_staff_photo(p_photo);
 update public.staff set photo_data=p_photo where id=p_staff_id;
 if not found then raise exception 'ไม่พบพนักงาน'; end if;
end; $$;
revoke all on function public.add_staff_with_photo_as_supervisor(text,text,text,text),public.set_staff_photo_as_supervisor(text,text,uuid,text) from public,authenticated;
grant execute on function public.add_staff_with_photo_as_supervisor(text,text,text,text),public.set_staff_photo_as_supervisor(text,text,uuid,text) to anon;
create or replace function public.get_dashboard_state() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'people', coalesce((select jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'active',active,'photo_data',photo_data) order by display_name) from public.staff), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by name) from public.job_types), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id',id,'ticket_no',ticket_no,'job_type_id',job_type_id,'assignee_id',assignee_id,'description',description,'status',status,'status_reason',status_reason,'started_at',started_at,'ended_at',ended_at,'created_at',created_at,'fg_code',fg_code,'fg_name',fg_name,'requested_qty',requested_qty,'bom_version',bom_version,'materials',materials) order by created_at desc) from public.tickets where deleted_at is null), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('profile_id',profile_id,'job_type_id',job_type_id,'level',level)) from public.skill_ratings), '[]'::jsonb)
  );
$$;

