do $$ declare d text;signature text;begin
 foreach signature in array array['public.confirm_ticket_picks_as_operator(text,text,uuid,jsonb,text,jsonb,text)','public.confirm_ticket_picks_as_supervisor(text,text,uuid,jsonb,text,jsonb,text)','public.edit_ticket_picks_as_supervisor(text,text,uuid,jsonb,text,jsonb,text)'] loop
 d:=pg_get_functiondef(signature::regprocedure);
 if position('required-actual>=1' in d)=0 or position('actual<>required and length(reason)=0' in d)=0 then raise exception 'Expected tolerance rules missing in %',signature;end if;
 d:=replace(d,'required-actual>=1','required-actual>1');
 d:=replace(d,'actual<>required and length(reason)=0','abs(actual-required)>1 and length(reason)=0');execute d;
 end loop;
 d:=pg_get_functiondef('public.guard_ticket_picks()'::regprocedure);
 if position('::numeric >= 1' in d)=0 then raise exception 'Expected guard rule missing';end if;
 d:=replace(d,'::numeric >= 1','::numeric > 1');execute d;
 d:=pg_get_functiondef('public.perform_work_action(text,text,text,uuid,text,jsonb)'::regprocedure);
 if position('(pick->>''actual_qty'')::numeric is distinct from (t.materials->i->>''required_qty'')::numeric' in d)=0 then raise exception 'Expected reason rule missing';end if;
 d:=replace(d,'(pick->>''actual_qty'')::numeric is distinct from (t.materials->i->>''required_qty'')::numeric','abs((pick->>''actual_qty'')::numeric - (t.materials->i->>''required_qty'')::numeric)>1');execute d;
end $$;
notify pgrst,'reload schema';
