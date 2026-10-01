-- Supervisor-only permanent removal, limited to a row already in trash.
create or replace function public.purge_ticket_as_supervisor(p_username text,p_code text,p_ticket_id uuid,p_expected_deleted_at timestamptz,p_confirm_number text,p_reason text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tickets%rowtype;
begin
 if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required';end if;
 select * into t from public.tickets where id=p_ticket_id for update;
 if not found then raise exception 'ไม่พบใบเบิกในถังขยะ กรุณาโหลดข้อมูลใหม่';end if;
 if t.deleted_at is null then raise exception 'ลบถาวรได้เฉพาะใบเบิกในถังขยะ';end if;
 if p_expected_deleted_at is distinct from t.deleted_at then raise exception 'ข้อมูลถังขยะเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่';end if;
 if trim(coalesce(p_confirm_number,''))<>t.ticket_no then raise exception 'พิมพ์เลขที่ใบเบิกให้ตรงเพื่อยืนยันลบถาวร';end if;
 if length(trim(coalesce(p_reason,'')))=0 or length(p_reason)>1000 then raise exception 'กรุณาระบุเหตุผลการลบถาวร ไม่เกิน 1000 ตัวอักษร';end if;
 delete from public.ticket_events where ticket_id=t.id;
 delete from public.tickets where id=t.id;
 -- withdrawal_document_numbers is removed by its ON DELETE CASCADE FK.
end; $$;
revoke all on function public.purge_ticket_as_supervisor(text,text,uuid,timestamptz,text,text) from public,anon,authenticated;
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.perform_work_action(text,text,text,uuid,text,jsonb)'::regprocedure);
 if position('''purge_ticket_as_supervisor''' in definition)=0 then
   definition:=replace(definition,'''set_work_standard_as_supervisor'']','''set_work_standard_as_supervisor'',''purge_ticket_as_supervisor'']');
   if position('''purge_ticket_as_supervisor''' in definition)=0 then raise exception 'Unable to add purge action';end if;
   execute definition;
 end if;
end $$;
