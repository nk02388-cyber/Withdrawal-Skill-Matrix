-- Apply after ticket-events-migration.sql. Stock catalog comes from PK WMS.
-- Catalog selection is checked in the browser against PK WMS's latest snapshot;
-- this database validates the submitted shape and records its snapshot metadata.
create or replace function public.create_withdrawal_ticket_as_supervisor(
  p_username text,p_code text,p_ticket_no text,p_job_type_id uuid,p_assignee_id uuid,
  p_description text,p_fg_code text,p_fg_name text,p_requested_qty numeric,
  p_bom_version text,p_bom_materials jsonb,p_stock_lines jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare line jsonb; has_bom boolean; seen_codes text[] := '{}'; line_code text;
begin
  if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
  if not exists(select 1 from public.staff where id=p_assignee_id and active) then raise exception 'Staff is inactive'; end if;
  if not exists(select 1 from public.job_types where id=p_job_type_id and active) then raise exception 'Job is inactive'; end if;
  if length(trim(coalesce(p_ticket_no,''))) not between 1 and 80 then raise exception 'Invalid ticket number'; end if;
  if length(coalesce(p_description,'')) > 1000 then raise exception 'Description too long'; end if;
  if jsonb_typeof(p_bom_materials) is distinct from 'array' then raise exception 'Invalid BOM lines'; end if;
  if jsonb_typeof(p_stock_lines) is distinct from 'array' then raise exception 'Invalid stock lines'; end if;
  if jsonb_array_length(p_bom_materials) > 30 or jsonb_array_length(p_stock_lines) > 30
    or jsonb_array_length(p_bom_materials)+jsonb_array_length(p_stock_lines) > 40
  then raise exception 'Too many material lines'; end if;
  has_bom := nullif(trim(coalesce(p_fg_code,'')),'') is not null;
  if has_bom then
    if length(trim(p_fg_code)) > 80 or length(trim(coalesce(p_fg_name,''))) not between 1 and 300
       or p_requested_qty is null or p_requested_qty <= 0 or p_requested_qty > 1000000
       or p_requested_qty <> round(p_requested_qty,3)
       or coalesce(p_bom_version,'') !~ '^[0-9a-f]{64}$'
       or jsonb_array_length(p_bom_materials)=0 then raise exception 'Invalid BOM selection'; end if;
  elsif jsonb_array_length(p_stock_lines)=0 or jsonb_array_length(p_bom_materials)<>0
     or p_requested_qty is not null or nullif(trim(coalesce(p_fg_name,'')),'') is not null
     or nullif(trim(coalesce(p_bom_version,'')),'') is not null
  then raise exception 'A BOM or a stock line is required'; end if;

  for line in select value from jsonb_array_elements(p_bom_materials) loop
    line_code := upper(trim(coalesce(line->>'pk_code','')));
    if line_code !~ '^[A-Z0-9/._-]{1,80}$'
       or length(trim(coalesce(line->>'pk_name',''))) not between 1 and 300
       or length(trim(coalesce(line->>'unit',''))) not between 1 and 30
       or (line->>'qty_per_unit')::numeric <= 0
       or (line->>'required_qty')::numeric <> round((line->>'qty_per_unit')::numeric*p_requested_qty,4)
    then raise exception 'Invalid BOM line'; end if;
    if not line_code=any(seen_codes) then seen_codes := array_append(seen_codes,line_code); end if;
  end loop;
  for line in select value from jsonb_array_elements(p_stock_lines) loop
    line_code := upper(trim(coalesce(line->>'pk_code','')));
    if line->>'source' <> 'stock'
       or line_code !~ '^[A-Z0-9/._-]{1,80}$'
       or length(trim(coalesce(line->>'pk_name',''))) not between 1 and 300
       or length(trim(coalesce(line->>'unit',''))) not between 1 and 30
       or coalesce((line->>'required_qty')::numeric,0) <= 0
       or (line->>'required_qty')::numeric > 1000000000
       or (line->>'required_qty')::numeric <> round((line->>'required_qty')::numeric,4)
       or coalesce((line->>'stock_snapshot_id')::bigint,0) <= 0
       or length(trim(coalesce(line->>'stock_report_date',''))) not between 1 and 120
       or nullif(line->>'stock_snapshot_saved_at','') is null
       or line_code=any(seen_codes) then raise exception 'Invalid or duplicate stock line'; end if;
    seen_codes := array_append(seen_codes,line_code);
  end loop;
  perform set_config('app.ticket_actor_role','supervisor',true);
  perform set_config('app.ticket_actor_username',p_username,true);
  perform set_config('app.ticket_event_type','created',true);
  insert into public.tickets(ticket_no,job_type_id,assignee_id,description,fg_code,fg_name,requested_qty,bom_version,materials)
  values(trim(p_ticket_no),p_job_type_id,p_assignee_id,coalesce(trim(p_description),''),
    case when has_bom then trim(p_fg_code) else null end,
    case when has_bom then trim(p_fg_name) else null end,
    case when has_bom then p_requested_qty else null end,
    case when has_bom then p_bom_version else null end,
    p_bom_materials || p_stock_lines);
end; $$;
revoke all on function public.create_withdrawal_ticket_as_supervisor(text,text,text,uuid,uuid,text,text,text,numeric,text,jsonb,jsonb) from public, authenticated;
grant execute on function public.create_withdrawal_ticket_as_supervisor(text,text,text,uuid,uuid,text,text,text,numeric,text,jsonb,jsonb) to anon;

-- Keep manually selected stock quantities when a supervisor changes FG quantity.
create or replace function public.edit_ticket_as_supervisor(
  p_username text,p_code text,p_ticket_id uuid,p_ticket_no text,p_job_type_id uuid,
  p_assignee_id uuid,p_description text,p_requested_qty numeric,p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare old_ticket public.tickets%rowtype; new_materials jsonb;
begin
  if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
  if length(trim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Reason required'; end if;
  if length(trim(coalesce(p_ticket_no,''))) not between 1 and 80 then raise exception 'Invalid ticket number'; end if;
  if length(coalesce(p_description,'')) > 1000 then raise exception 'Description too long'; end if;
  select * into old_ticket from public.tickets where id=p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if p_assignee_id is distinct from old_ticket.assignee_id
     and not exists(select 1 from public.staff where id=p_assignee_id and active) then raise exception 'Staff is inactive'; end if;
  if p_job_type_id is distinct from old_ticket.job_type_id
     and not exists(select 1 from public.job_types where id=p_job_type_id and active) then raise exception 'Job is inactive'; end if;
  new_materials := old_ticket.materials;
  if old_ticket.fg_code is not null then
    if p_requested_qty is null or p_requested_qty <= 0 or p_requested_qty > 1000000
       or p_requested_qty <> round(p_requested_qty,3) then raise exception 'Invalid requested quantity'; end if;
    select jsonb_agg(case when line->>'source'='stock' then line
      else jsonb_set(line,'{required_qty}',to_jsonb(round((line->>'qty_per_unit')::numeric*p_requested_qty,4)))
      end order by ordinality) into new_materials
    from jsonb_array_elements(old_ticket.materials) with ordinality as x(line,ordinality);
  elsif p_requested_qty is not null then raise exception 'This ticket has no FG quantity'; end if;
  if trim(p_ticket_no)=old_ticket.ticket_no and p_job_type_id=old_ticket.job_type_id
     and p_assignee_id=old_ticket.assignee_id and coalesce(trim(p_description),'')=old_ticket.description
     and (old_ticket.fg_code is null or p_requested_qty=old_ticket.requested_qty)
  then raise exception 'No changes to save'; end if;
  perform set_config('app.ticket_actor_role','supervisor',true);
  perform set_config('app.ticket_actor_username',p_username,true);
  perform set_config('app.ticket_event_type','edited',true);
  perform set_config('app.ticket_reason',trim(p_reason),true);
  update public.tickets set ticket_no=trim(p_ticket_no),job_type_id=p_job_type_id,
    assignee_id=p_assignee_id,description=coalesce(trim(p_description),''),
    requested_qty=case when old_ticket.fg_code is null then null else p_requested_qty end,
    materials=new_materials
  where id=p_ticket_id;
end; $$;
notify pgrst, 'reload schema';
