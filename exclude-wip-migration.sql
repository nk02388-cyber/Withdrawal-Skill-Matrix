-- Move excluded WIP out of active picking while preserving its recorded data.
begin;
create or replace function public.has_wip_materials(p_lines jsonb) returns boolean
language sql immutable set search_path=public,pg_temp as $$
  select exists(select 1 from jsonb_array_elements(coalesce(p_lines,'[]')) l
    where trim(coalesce(l->>'pk_code','')) like '5%');
$$;
revoke all on function public.has_wip_materials(jsonb) from public,anon,authenticated;
alter table public.tickets add column if not exists excluded_wip_materials jsonb not null default '[]';
alter table public.tickets add column if not exists excluded_wip_cases jsonb not null default '[]';
alter table public.saved_production_formulas add column if not exists excluded_wip_lines jsonb not null default '[]';

do $$
declare ticket record; kept jsonb; removed jsonb; old_cases jsonb; fulfilled boolean;
  guard_definition text; migration_guard text;
begin
  -- Closed-ticket protection rejects changing the material plan. For this
  -- transaction only, permit the postgres migration session to move WIP intact.
  -- The original guard is restored before commit; other sessions never see it.
  guard_definition:=pg_get_functiondef('public.guard_ticket_picks()'::regprocedure);
  migration_guard:=regexp_replace(guard_definition,'\mbegin\M',E'begin\n  if session_user = ''postgres'' and current_setting(''app.exclude_wip_migration'',true) = ''true'' then\n    if new.materials is distinct from (select coalesce(jsonb_agg(l order by n),''[]''::jsonb) from jsonb_array_elements(old.materials) with ordinality a(l,n) where trim(l->>''pk_code'') not like ''5%'') then raise exception ''WIP migration must preserve every non-WIP line''; end if;\n    if new.excluded_wip_materials is distinct from old.excluded_wip_materials || (select coalesce(jsonb_agg(l order by n),''[]''::jsonb) from jsonb_array_elements(old.materials) with ordinality a(l,n) where trim(l->>''pk_code'') like ''5%'') then raise exception ''WIP migration must archive original quantities''; end if;\n    return new;\n  end if;\n','i');
  if migration_guard=guard_definition then raise exception 'Closed-ticket guard pattern unavailable'; end if;
  execute migration_guard;
  perform set_config('app.exclude_wip_migration','true',true);
  perform set_config('app.ticket_actor_role','system',true);
  perform set_config('app.ticket_actor_username','system',true);
  perform set_config('app.ticket_event_type','edited',true);
  perform set_config('app.ticket_reason','แยกรหัสขึ้นต้นด้วย 5 (WIP) ออกจากรายการเบิกบรรจุภัณฑ์ เก็บข้อมูลเดิมไว้',true);
  for ticket in select * from public.tickets where public.has_wip_materials(materials) for update loop
    select coalesce(jsonb_agg(l order by n) filter(where trim(l->>'pk_code') not like '5%'),'[]'),
      coalesce(jsonb_agg(l order by n) filter(where trim(l->>'pk_code') like '5%'),'[]')
      into kept,removed from jsonb_array_elements(ticket.materials) with ordinality a(l,n);
    select coalesce(jsonb_agg(to_jsonb(c)),'[]') into old_cases from public.material_cases c
      where c.ticket_id=ticket.id and trim(ticket.materials->c.line_index->>'pk_code') like '5%';
    -- Resolve status only when every remaining material is confirmed and fulfilled.
    fulfilled:=jsonb_array_length(kept)>0 and not exists(
      select 1 from jsonb_array_elements(ticket.materials) with ordinality a(l,n)
      where trim(l->>'pk_code') not like '5%' and (
        nullif(l->>'confirmed_at','') is null or jsonb_typeof(l->'actual_qty') is distinct from 'number'
        or (abs((l->>'actual_qty')::numeric-(l->>'required_qty')::numeric)>1 and not exists(
          select 1 from public.material_cases c where c.ticket_id=ticket.id and c.line_index=n-1
          and c.status='resolved' and c.fingerprint::jsonb=jsonb_build_array(l->>'pk_code',
            (l->>'required_qty')::numeric,(l->>'actual_qty')::numeric,l->>'confirmed_at')))));
    -- Retain old WIP cases in an unused index range; remap remaining cases safely.
    update public.material_cases set line_index=line_index+1000000
      where ticket_id=ticket.id and line_index<jsonb_array_length(ticket.materials);
    update public.material_cases c set line_index=(select count(*)::integer-1
      from jsonb_array_elements(ticket.materials) with ordinality a(l,n)
      where n<=c.line_index-1000000+1 and trim(l->>'pk_code') not like '5%')
      where c.ticket_id=ticket.id and c.line_index between 1000000 and 1000000+jsonb_array_length(ticket.materials)-1
      and trim(ticket.materials->(c.line_index-1000000)->>'pk_code') not like '5%';
    update public.tickets set materials=kept,
      excluded_wip_materials=excluded_wip_materials||removed,
      excluded_wip_cases=excluded_wip_cases||old_cases,
      status=case when ticket.status='partial' and fulfilled then 'done' else ticket.status end,
      status_reason=case when ticket.status='partial' and fulfilled then 'เบิกครบ — ไม่รวมรายการ WIP' else status_reason end
      where id=ticket.id;
  end loop;
  execute guard_definition;
  perform set_config('app.exclude_wip_migration','false',true);
end; $$;

update public.saved_production_formulas f set
  excluded_wip_lines=excluded_wip_lines||(select coalesce(jsonb_agg(l),'[]') from jsonb_array_elements(f.lines) l where trim(l->>'pk_code') like '5%'),
  lines=(select coalesce(jsonb_agg(l order by n),'[]') from jsonb_array_elements(f.lines) with ordinality a(l,n) where trim(l->>'pk_code') not like '5%')
  where public.has_wip_materials(lines);
update public.saved_production_formulas set source_sha256=encode(extensions.digest(convert_to(fg_code||fg_name||base_qty::text||lines::text,'UTF8'),'sha256'),'hex')
  where jsonb_array_length(excluded_wip_lines)>0;

-- Enforce the same policy even if an older browser or direct RPC submits WIP.
alter table public.tickets add constraint tickets_no_wip_materials check(not public.has_wip_materials(materials));
alter table public.saved_production_formulas add constraint saved_formulas_no_wip_materials check(not public.has_wip_materials(lines));
notify pgrst,'reload schema';
commit;
