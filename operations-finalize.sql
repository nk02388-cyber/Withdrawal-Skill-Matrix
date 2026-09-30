-- Apply only after deploying the frontend that calls perform_work_action.
-- Prevent legacy direct writes from bypassing actor and cause validation.
do $$ declare f record; begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname ~ '_as_(operator|supervisor)$'
 and p.proname<>'get_deleted_tickets_as_supervisor' loop
   execute format('revoke all on function %s from public,anon,authenticated',f.oid::regprocedure);
 end loop;
end $$;
