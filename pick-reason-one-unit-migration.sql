do $$ declare d text;signature text;begin
 foreach signature in array array['public.confirm_ticket_picks_as_operator(text,text,uuid,jsonb,text,jsonb,text)','public.confirm_ticket_picks_as_supervisor(text,text,uuid,jsonb,text,jsonb,text)','public.edit_ticket_picks_as_supervisor(text,text,uuid,jsonb,text,jsonb,text)'] loop
 d:=pg_get_functiondef(signature::regprocedure);
 if position('abs(actual-required)>1 and length(reason)=0' in d)=0 then raise exception 'Expected reason rule missing in %',signature;end if;
 d:=replace(d,'abs(actual-required)>1 and length(reason)=0','abs(actual-required)>=1 and length(reason)=0');execute d;
 end loop;
 d:=pg_get_functiondef('public.perform_work_action(text,text,text,uuid,text,jsonb)'::regprocedure);
 if position('abs((pick->>''actual_qty'')::numeric - (t.materials->i->>''required_qty'')::numeric)>1' in d)=0 then raise exception 'Expected category rule missing';end if;
 d:=replace(d,'abs((pick->>''actual_qty'')::numeric - (t.materials->i->>''required_qty'')::numeric)>1','abs((pick->>''actual_qty'')::numeric - (t.materials->i->>''required_qty'')::numeric)>=1');execute d;
end $$;
notify pgrst,'reload schema';
