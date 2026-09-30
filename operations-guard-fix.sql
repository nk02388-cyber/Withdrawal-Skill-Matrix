-- Cause codes are pick-result metadata, not a change to the material plan.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.guard_ticket_picks()'::regprocedure);
 definition:=replace(definition,'- ''confirmed_at''','- ''confirmed_at'' - ''reason_code''');
 execute definition;
end $$;
