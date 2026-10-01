do $$ declare d text;signature text;begin
 foreach signature in array array['public.confirm_ticket_picks_as_operator(text,text,uuid,jsonb,text,jsonb,text)','public.edit_ticket_picks_as_supervisor(text,text,uuid,jsonb,text,jsonb,text)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if position('if actual<required then shorts:=shorts+1; end if;' in d)=0 then raise exception 'Expected shortage rule not found in %',signature;end if;
  d:=replace(d,'if actual<required then shorts:=shorts+1; end if;','if required-actual>=1 then shorts:=shorts+1; end if;');execute d;
 end loop;
end $$;
notify pgrst,'reload schema';
