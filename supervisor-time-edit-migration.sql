-- Apply after stock-withdrawal-migration.sql. Existing edit RPC remains available
-- for older clients; this version changes ticket details and times atomically.
create or replace function public.edit_ticket_with_times_as_supervisor(
  p_username text,p_code text,p_ticket_id uuid,p_ticket_no text,p_job_type_id uuid,
  p_assignee_id uuid,p_description text,p_requested_qty numeric,
  p_started_at timestamptz,p_ended_at timestamptz,p_reason text
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

  if (p_started_at is not null and p_started_at > clock_timestamp())
     or (p_ended_at is not null and p_ended_at > clock_timestamp())
  then raise exception 'Work time cannot be in the future'; end if;
  if old_ticket.status='queued' and (p_started_at is not null or p_ended_at is not null)
  then raise exception 'Queued ticket cannot have work times'; end if;
  if old_ticket.status in ('active','paused') and (p_started_at is null or p_ended_at is not null)
  then raise exception 'Open ticket needs a start time and no end time'; end if;
  if old_ticket.status in ('done','partial') and (p_started_at is null or p_ended_at is null)
  then raise exception 'Closed ticket needs start and end times'; end if;
  if old_ticket.status='cancelled' and (p_ended_at is null or (old_ticket.started_at is null) <> (p_started_at is null))
  then raise exception 'Cancelled ticket needs an end time; start presence cannot change'; end if;
  if p_started_at is not null and p_ended_at is not null and p_ended_at < p_started_at
  then raise exception 'End time cannot be before start time'; end if;

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
     and p_started_at is not distinct from old_ticket.started_at
     and p_ended_at is not distinct from old_ticket.ended_at
  then raise exception 'No changes to save'; end if;

  perform set_config('app.ticket_actor_role','supervisor',true);
  perform set_config('app.ticket_actor_username',p_username,true);
  perform set_config('app.ticket_event_type','edited',true);
  perform set_config('app.ticket_reason',trim(p_reason),true);
  update public.tickets set ticket_no=trim(p_ticket_no),job_type_id=p_job_type_id,
    assignee_id=p_assignee_id,description=coalesce(trim(p_description),''),
    requested_qty=case when old_ticket.fg_code is null then null else p_requested_qty end,
    materials=new_materials,started_at=p_started_at,ended_at=p_ended_at
  where id=p_ticket_id;
end; $$;

revoke all on function public.edit_ticket_with_times_as_supervisor(text,text,uuid,text,uuid,uuid,text,numeric,timestamptz,timestamptz,text)
from public, authenticated;
grant execute on function public.edit_ticket_with_times_as_supervisor(text,text,uuid,text,uuid,uuid,text,numeric,timestamptz,timestamptz,text)
to anon;
notify pgrst, 'reload schema';
