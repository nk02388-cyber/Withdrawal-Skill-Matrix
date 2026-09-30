create or replace function public.confirm_ticket_picks_as_operator(
  p_username text,p_code text,p_ticket_id uuid,p_expected_materials jsonb,p_expected_status text,p_picks jsonb,p_close_status text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.tickets%rowtype; line jsonb; pick jsonb; result jsonb := '[]'; actual numeric; required numeric; reason text; shorts integer := 0; i integer;
begin
  if not public.check_role_code('operator',p_username,p_code) then raise exception 'Operator access required'; end if;
  select * into t from public.tickets where id=p_ticket_id for update;
  if not found or t.status not in ('active','paused') then raise exception 'บันทึกได้เฉพาะงานที่เริ่มแล้วหรือพักอยู่'; end if;
  if t.materials is distinct from p_expected_materials or t.status is distinct from p_expected_status then raise exception 'ใบเบิกถูกแก้ไขจากเครื่องอื่น กรุณาปิดฟอร์มแล้วเปิดใหม่'; end if;
  if p_close_status is not null and p_close_status not in ('done','partial') then raise exception 'Invalid close status'; end if;
  if p_close_status='done' and t.status<>'active' then raise exception 'กรุณากลับมาทำงานต่อก่อนจบงาน'; end if;
  if jsonb_typeof(p_picks) is distinct from 'array' or jsonb_array_length(p_picks)<>jsonb_array_length(t.materials) or jsonb_array_length(t.materials)=0 then raise exception 'กรุณายืนยันให้ครบทุกรายการ'; end if;
  for i in 0..jsonb_array_length(t.materials)-1 loop
    line:=t.materials->i; pick:=p_picks->i; required:=(line->>'required_qty')::numeric;
    if jsonb_typeof(pick->'actual_qty') is distinct from 'number' then raise exception 'กรุณาใส่จำนวนเบิกจริง'; end if;
    actual:=(pick->>'actual_qty')::numeric; reason:=trim(coalesce(pick->>'short_reason',''));
    if actual<0 or actual>1000000000 or actual<>round(actual,4) then raise exception 'จำนวนเบิกจริงต้องอยู่ระหว่าง 0 ถึง 1,000,000,000 (ทศนิยมไม่เกิน 4 ตำแหน่ง)'; end if;
    if length(reason)>1000 or (actual<>required and length(reason)=0) then raise exception 'กรุณาระบุเหตุผลของรายการที่เบิกขาดหรือเกิน'; end if;
    if actual<required then shorts:=shorts+1; end if;
    result:=result || jsonb_build_array(line || jsonb_build_object('actual_qty',actual,'short_reason',case when actual<>required then reason else '' end,'confirmed_at',clock_timestamp()));
  end loop;
  if p_close_status='done' and shorts>0 then raise exception 'มีรายการขาด กรุณาปิดเป็นเบิกไม่ครบ'; end if;
  if p_close_status='partial' and shorts=0 then raise exception 'ไม่มีรายการขาด กรุณาปิดเป็นเสร็จแล้ว'; end if;
  perform set_config('app.ticket_actor_role','operator',true);
  perform set_config('app.ticket_actor_username',p_username,true);
  perform set_config('app.ticket_event_type',case p_close_status when 'done' then 'completed' when 'partial' then 'partial' else 'edited' end,true);
  perform set_config('app.ticket_reason','ยืนยันจำนวนเบิกจริง '||jsonb_array_length(result)||' รายการ · ขาด '||shorts||' รายการ',true);
  update public.tickets set materials=result,status=coalesce(p_close_status,status),
    ended_at=case when p_close_status is not null then clock_timestamp() else ended_at end,
    status_reason=case when p_close_status='partial' then 'เบิกขาด '||shorts||' รายการ — ดูเหตุผลในรายการวัสดุ' when p_close_status='done' then null else status_reason end where id=t.id;
end; $$;
revoke all on function public.confirm_ticket_picks_as_operator(text,text,uuid,jsonb,text,jsonb,text) from public,authenticated;
grant execute on function public.confirm_ticket_picks_as_operator(text,text,uuid,jsonb,text,jsonb,text) to anon;
create or replace function public.edit_ticket_picks_as_supervisor(
  p_username text,p_code text,p_ticket_id uuid,p_expected_materials jsonb,p_expected_status text,p_picks jsonb,p_edit_reason text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.tickets%rowtype; line jsonb; pick jsonb; result jsonb := '[]'; actual numeric; required numeric; reason text; shorts integer := 0; i integer; target_status text;
begin
  if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
  select * into t from public.tickets where id=p_ticket_id for update;
  if not found or t.status not in ('active','paused','done','partial') then raise exception 'แก้ไขเบิกจริงได้เฉพาะงานที่เริ่มแล้วหรือปิดแล้ว'; end if;
  if t.materials is distinct from p_expected_materials or t.status is distinct from p_expected_status then raise exception 'ใบเบิกถูกแก้ไขจากเครื่องอื่น กรุณาปิดฟอร์มแล้วเปิดใหม่'; end if;
  if length(trim(coalesce(p_edit_reason,''))) not between 1 and 1000 then raise exception 'กรุณาระบุเหตุผลการแก้ไข'; end if;
  if jsonb_typeof(p_picks) is distinct from 'array' or jsonb_array_length(p_picks)<>jsonb_array_length(t.materials) or jsonb_array_length(t.materials)=0 then raise exception 'กรุณายืนยันให้ครบทุกรายการ'; end if;
  for i in 0..jsonb_array_length(t.materials)-1 loop
    line:=t.materials->i; pick:=p_picks->i; required:=(line->>'required_qty')::numeric;
    if jsonb_typeof(pick->'actual_qty') is distinct from 'number' then raise exception 'กรุณาใส่จำนวนเบิกจริง'; end if;
    actual:=(pick->>'actual_qty')::numeric; reason:=trim(coalesce(pick->>'short_reason',''));
    if actual<0 or actual>1000000000 or actual<>round(actual,4) then raise exception 'จำนวนเบิกจริงต้องอยู่ระหว่าง 0 ถึง 1,000,000,000 (ทศนิยมไม่เกิน 4 ตำแหน่ง)'; end if;
    if length(reason)>1000 or (actual<>required and length(reason)=0) then raise exception 'กรุณาระบุเหตุผลของรายการที่เบิกขาดหรือเกิน'; end if;
    if actual<required then shorts:=shorts+1; end if;
    result:=result || jsonb_build_array(line || jsonb_build_object('actual_qty',actual,'short_reason',case when actual<>required then reason else '' end,'confirmed_at',clock_timestamp()));
  end loop;
  target_status:=case when t.status in ('done','partial') then case when shorts>0 then 'partial' else 'done' end else t.status end;
  perform set_config('app.ticket_actor_role','supervisor',true);
  perform set_config('app.ticket_actor_username',p_username,true);
  perform set_config('app.ticket_event_type','edited',true);
  perform set_config('app.ticket_reason',trim(p_edit_reason),true);
  update public.tickets set materials=result,status=target_status,
    status_reason=case when t.status in ('done','partial') then case when shorts>0 then 'เบิกขาด '||shorts||' รายการ — ดูเหตุผลในรายการวัสดุ' else null end else status_reason end where id=t.id;
end; $$;
revoke all on function public.edit_ticket_picks_as_supervisor(text,text,uuid,jsonb,text,jsonb,text) from public,authenticated;
grant execute on function public.edit_ticket_picks_as_supervisor(text,text,uuid,jsonb,text,jsonb,text) to anon;
create or replace function public.rename_staff_as_supervisor(p_username text,p_code text,p_staff_id uuid,p_name text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 100 then raise exception 'กรุณาระบุชื่อพนักงานไม่เกิน 100 ตัวอักษร'; end if;
 update public.staff set display_name=trim(p_name) where id=p_staff_id;
 if not found then raise exception 'ไม่พบพนักงาน'; end if;
end; $$;
revoke all on function public.rename_staff_as_supervisor(text,text,uuid,text) from public,authenticated;
grant execute on function public.rename_staff_as_supervisor(text,text,uuid,text) to anon;
