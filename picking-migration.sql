begin;
-- Keep actual picks beside their planned material line; old tickets stay unconfirmed.
create or replace function public.guard_ticket_picks() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare old_plan jsonb; new_plan jsonb; missing_count integer; short_count integer;
begin
  select jsonb_agg(x - 'actual_qty' - 'short_reason' - 'confirmed_at') into old_plan from jsonb_array_elements(coalesce(old.materials,'[]')) x;
  select jsonb_agg(x - 'actual_qty' - 'short_reason' - 'confirmed_at') into new_plan from jsonb_array_elements(coalesce(new.materials,'[]')) x;
  if old_plan is distinct from new_plan then
    if old.status in ('done','partial') and exists(select 1 from jsonb_array_elements(coalesce(old.materials,'[]')) x where x ? 'confirmed_at') then
      raise exception 'ใบที่ยืนยันเบิกจริงและปิดแล้วไม่สามารถเปลี่ยนจำนวนวัสดุได้';
    end if;
    new.materials := coalesce(new_plan,'[]');
  end if;
  if new.status in ('done','partial') and old.status is distinct from new.status then
    select count(*) filter(where not (x ? 'confirmed_at') or jsonb_typeof(x->'actual_qty') is distinct from 'number'),
      count(*) filter(where (x->>'actual_qty')::numeric < (x->>'required_qty')::numeric)
      into missing_count,short_count from jsonb_array_elements(coalesce(new.materials,'[]')) x;
    if missing_count > 0 then raise exception 'กรุณายืนยันจำนวนเบิกจริงทุกรายการก่อนปิดงาน'; end if;
    if new.status='done' and short_count > 0 then raise exception 'มีรายการขาด กรุณาปิดเป็นเบิกไม่ครบ'; end if;
    if new.status='partial' and jsonb_array_length(coalesce(new.materials,'[]')) > 0 and short_count=0 then raise exception 'ไม่มีรายการขาด กรุณาปิดเป็นเสร็จแล้ว'; end if;
  end if;
  return new;
end; $$;
revoke all on function public.guard_ticket_picks() from public,anon,authenticated;
create trigger ticket_picks_before_update before update on public.tickets for each row execute function public.guard_ticket_picks();

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
    if actual<0 or actual>required or actual<>round(actual,4) then raise exception 'จำนวนเบิกจริงต้องอยู่ระหว่าง 0 และจำนวนที่ต้องเบิก (ทศนิยมไม่เกิน 4 ตำแหน่ง)'; end if;
    if length(reason)>1000 or (actual<required and length(reason)=0) then raise exception 'กรุณาระบุเหตุผลของรายการที่เบิกขาด'; end if;
    if actual<required then shorts:=shorts+1; end if;
    result:=result || jsonb_build_array(line || jsonb_build_object('actual_qty',actual,'short_reason',case when actual<required then reason else '' end,'confirmed_at',clock_timestamp()));
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
notify pgrst,'reload schema';
commit;
