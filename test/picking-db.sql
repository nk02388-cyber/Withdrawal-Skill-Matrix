-- All fixtures, audit rows and temporary role values are rolled back.
begin;
do $$
<<qa>>
declare id uuid:=gen_random_uuid(); t public.tickets%rowtype; code text:=gen_random_uuid()::text; blocked boolean; n integer;
begin
  update public.app_settings set value='test-picking-transaction' where key='operator_username';
  update public.app_settings set value=extensions.crypt(code,extensions.gen_salt('bf')) where key='operator_code';
  insert into public.tickets(id,ticket_no,job_type_id,assignee_id,status,started_at,materials)
    values(id,'QA-ROLLBACK-'||id,(select j.id from public.job_types j where active limit 1),(select s.id from public.staff s where active limit 1),'active',now(),
    '[{"pk_code":"QA-1","pk_name":"QA only","unit":"ชิ้น","required_qty":10},{"pk_code":"QA-2","pk_name":"QA only","unit":"ม้วน","required_qty":0.8888}]');
  select * into t from public.tickets where tickets.id=qa.id;
  blocked:=false;
  begin perform public.confirm_ticket_picks_as_operator('wrong','wrong',id,t.materials,t.status,'[]',null); exception when others then if sqlerrm='Operator access required' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'FAIL auth'; end if;
  blocked:=false;
  begin perform public.finish_ticket_as_operator('test-picking-transaction',code,id); exception when others then if sqlerrm like 'กรุณายืนยัน%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'FAIL legacy completion bypass'; end if;
  blocked:=false;
  begin perform public.confirm_ticket_picks_as_operator('test-picking-transaction',code,id,t.materials,t.status,'[{"actual_qty":8},{"actual_qty":0.8888}]',null); exception when others then if sqlerrm like 'กรุณาระบุเหตุผล%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'FAIL shortage reason'; end if;
  blocked:=false;
  begin perform public.confirm_ticket_picks_as_operator('test-picking-transaction',code,id,t.materials,t.status,'[{"actual_qty":11},{"actual_qty":0.8888}]',null); exception when others then if sqlerrm like 'กรุณาระบุเหตุผล%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'FAIL overpick'; end if;
  perform public.confirm_ticket_picks_as_operator('test-picking-transaction',code,id,t.materials,t.status,'[{"actual_qty":8,"short_reason":"สินค้าไม่พอ"},{"actual_qty":0.8888}]',null);
  blocked:=false;
  begin perform public.confirm_ticket_picks_as_operator('test-picking-transaction',code,id,t.materials,t.status,'[{"actual_qty":10},{"actual_qty":0.8888}]',null); exception when others then if sqlerrm like 'ใบเบิกถูกแก้ไข%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'FAIL stale overwrite'; end if;
  select * into t from public.tickets where tickets.id=qa.id;
  blocked:=false;
  begin perform public.confirm_ticket_picks_as_operator('test-picking-transaction',code,id,t.materials,t.status,'[{"actual_qty":8,"short_reason":"สินค้าไม่พอ"},{"actual_qty":0.8888}]','done'); exception when others then if sqlerrm like 'มีรายการขาด%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'FAIL shortage done'; end if;
  perform public.confirm_ticket_picks_as_operator('test-picking-transaction',code,id,t.materials,t.status,'[{"actual_qty":8,"short_reason":"สินค้าไม่พอ"},{"actual_qty":0.8888}]','partial');
  select * into t from public.tickets where tickets.id=qa.id;
  if t.status<>'partial' or t.ended_at is null or (t.materials->0->>'actual_qty')::numeric<>8 then raise exception 'FAIL partial persisted'; end if;
  select count(*) into n from public.ticket_events e where e.ticket_id=qa.id and e.after_state->'materials'->0->>'actual_qty'='8';
  if n<2 then raise exception 'FAIL audit'; end if;
  blocked:=false;
  begin update public.tickets set materials=jsonb_set(materials,'{0,required_qty}','20') where tickets.id=qa.id; exception when others then if sqlerrm like 'ใบที่ยืนยัน%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'FAIL closed plan changed'; end if;
end; $$;
select 'PASS: auth, legacy guard, bounds, shortage reason, concurrency, atomic partial, audit, closed plan protection' as test_result;
rollback;

