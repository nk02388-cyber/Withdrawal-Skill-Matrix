do $$ declare d text;signature text;begin
 foreach signature in array array['public.start_ticket_as_operator(text,text,uuid)','public.finish_ticket_as_operator(text,text,uuid)','public.resume_ticket_as_operator(text,text,uuid,text)','public.confirm_ticket_picks_as_operator(text,text,uuid,jsonb,text,jsonb,text)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  d:=replace(replace(replace(d,'_as_operator','_as_supervisor'),'''operator''','''supervisor'''),'Operator access required','Supervisor access required');
  d:=replace(d,'status=''queued'';','status=''queued'' and deleted_at is null;');
  d:=replace(d,'status=''active'';','status=''active'' and deleted_at is null;');
  d:=replace(d,'status=''paused'';','status=''paused'' and deleted_at is null;');
  d:=replace(d,'if not found or t.status not in','if not found or t.deleted_at is not null or t.status not in');
  execute d;
 end loop;
 d:=pg_get_functiondef('public.perform_work_action(text,text,text,uuid,text,jsonb)'::regprocedure);
 d:=replace(d,'''start_ticket_as_operator''','''start_ticket_as_supervisor'',''finish_ticket_as_supervisor'',''resume_ticket_as_supervisor'',''confirm_ticket_picks_as_supervisor'',''start_ticket_as_operator''');
 d:=replace(d,'if p_action=''finish_ticket_as_operator'' and','if p_action in (''finish_ticket_as_operator'',''finish_ticket_as_supervisor'') and');
 d:=replace(d,'''confirm_ticket_picks_as_operator'',''edit_ticket_picks_as_supervisor''','''confirm_ticket_picks_as_operator'',''confirm_ticket_picks_as_supervisor'',''edit_ticket_picks_as_supervisor''');
 execute d;
end $$;
revoke all on function public.start_ticket_as_supervisor(text,text,uuid),public.finish_ticket_as_supervisor(text,text,uuid),public.resume_ticket_as_supervisor(text,text,uuid,text),public.confirm_ticket_picks_as_supervisor(text,text,uuid,jsonb,text,jsonb,text) from public,anon,authenticated;
notify pgrst,'reload schema';
