begin;
do $$
declare tid uuid; job uuid; person uuid; st text; code text:=gen_random_uuid()::text; blocked boolean; n int;
begin
 update public.app_settings set value='qa-delete-supervisor' where key='supervisor_username';
 update public.app_settings set value=extensions.crypt(code,extensions.gen_salt('bf')) where key='supervisor_code';
 update public.app_settings set value='qa-delete-operator' where key='operator_username';
 update public.app_settings set value=extensions.crypt(code,extensions.gen_salt('bf')) where key='operator_code';
 select id into job from public.job_types where active limit 1;
 select id into person from public.staff where active limit 1;
 foreach st in array array['queued','active','paused','done','partial','cancelled'] loop
 tid:=gen_random_uuid();
 perform set_config('app.ticket_event_type','created',true);
 insert into public.tickets(id,ticket_no,job_type_id,assignee_id,status,started_at,ended_at,materials)
 values(tid,'QA-DELETE-'||tid,job,person,st,case when st<>'queued' then now()-interval '5 minutes' end,case when st in ('done','partial','cancelled') then now() end,'[]');
 blocked:=false;
 begin perform public.set_ticket_deleted_as_supervisor('qa-delete-operator',code,tid,'QA',true); exception when others then if sqlerrm='Supervisor access required' then blocked:=true; else raise; end if; end;
 if not blocked then raise exception 'FAIL operator deletion'; end if;
 blocked:=false;
 begin perform public.set_ticket_deleted_as_supervisor('qa-delete-supervisor',code,tid,' ',true); exception when others then if sqlerrm='Reason required' then blocked:=true; else raise; end if; end;
 if not blocked then raise exception 'FAIL reason'; end if;
 perform public.set_ticket_deleted_as_supervisor('qa-delete-supervisor',code,tid,'QA delete',true);
 if exists(select 1 from jsonb_array_elements(public.get_dashboard_state()->'tickets') t where t->>'id'=tid::text) then raise exception 'FAIL dashboard exclusion'; end if;
 if not exists(select 1 from jsonb_array_elements(public.get_deleted_tickets_as_supervisor('qa-delete-supervisor',code)) t where t->>'id'=tid::text) then raise exception 'FAIL trash'; end if;
 blocked:=false;
 begin update public.tickets set description='stale edit' where id=tid; exception when others then if sqlerrm like 'ใบเบิกถูกลบแล้ว%' then blocked:=true; else raise; end if; end;
 if not blocked then raise exception 'FAIL stale update'; end if;
 perform public.set_ticket_deleted_as_supervisor('qa-delete-supervisor',code,tid,'QA restore',false);
 if not exists(select 1 from jsonb_array_elements(public.get_dashboard_state()->'tickets') t where t->>'id'=tid::text and t->>'status'=st) then raise exception 'FAIL restore'; end if;
 select count(*) into n from public.ticket_events where ticket_id=tid and event_type in ('deleted','restored') and actor_username='qa-delete-supervisor';
 if n<>2 then raise exception 'FAIL audit'; end if;
 end loop;
 blocked:=false;
 begin perform public.get_deleted_tickets_as_supervisor('qa-delete-operator',code); exception when others then if sqlerrm='Supervisor access required' then blocked:=true; else raise; end if; end;
 if not blocked then raise exception 'FAIL trash auth'; end if;
 raise notice 'PASS: six statuses, supervisor auth, reason, dashboard exclusion, trash, stale edits, restore and audit';
end $$;
rollback;
