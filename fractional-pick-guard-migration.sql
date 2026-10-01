do $$ declare d text;begin
 d:=pg_get_functiondef('public.guard_ticket_picks()'::regprocedure);
 if position('(x->>''actual_qty'')::numeric < (x->>''required_qty'')::numeric' in d)=0 then raise exception 'Expected guard not found';end if;
 d:=replace(d,'(x->>''actual_qty'')::numeric < (x->>''required_qty'')::numeric','(x->>''required_qty'')::numeric - (x->>''actual_qty'')::numeric >= 1');execute d;
end $$;
