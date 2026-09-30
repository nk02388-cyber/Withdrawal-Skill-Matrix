-- Reserve every document number, including numbers in grouped/deleted work.
create or replace function public.withdrawal_document_refs(p_number text,p_fg text)
returns text[] language plpgsql immutable set search_path=public,pg_temp as $$
declare refs text[];
begin
  select array_agg(ref order by position) into refs
  from regexp_split_to_table(trim(p_number),'[,，[:space:]]+') with ordinality as parts(ref,position)
  where ref<>'';
  if p_fg is null and p_number !~ '[,，]' and exists(select 1 from unnest(refs) ref where ref !~ '[0-9]') then
    return array[trim(p_number)];
  end if;
  return coalesce(refs,array[]::text[]);
end; $$;
create table public.withdrawal_document_numbers(
  document_key text primary key,
  ticket_id uuid not null references public.tickets(id) on delete cascade
);
alter table public.withdrawal_document_numbers enable row level security;
revoke all on public.withdrawal_document_numbers from public,anon,authenticated;
insert into public.withdrawal_document_numbers(document_key,ticket_id)
select lower(ref),t.id from public.tickets t cross join lateral unnest(public.withdrawal_document_refs(t.ticket_no,t.fg_code)) ref;
create or replace function public.reserve_withdrawal_document_numbers()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare refs text[];
begin
  refs:=public.withdrawal_document_refs(new.ticket_no,new.fg_code);
  if cardinality(refs)=0 then raise exception 'กรุณาระบุเลขที่ใบเบิก'; end if;
  if cardinality(refs)<>(select count(distinct lower(ref)) from unnest(refs) ref) then
    raise exception 'มีเลขที่ใบเบิกซ้ำในช่องนี้ กรุณาตรวจสอบ';
  end if;
  delete from public.withdrawal_document_numbers where ticket_id=new.id;
  begin
    insert into public.withdrawal_document_numbers(document_key,ticket_id)
    select lower(ref),new.id from unnest(refs) ref;
  exception when unique_violation then
    raise exception 'เลขที่ใบเบิกบางใบมีอยู่แล้ว กรุณาตรวจสอบแต่ละเลขที่' using errcode='23505',constraint='tickets_ticket_no_key';
  end;
  return new;
end; $$;
revoke all on function public.withdrawal_document_refs(text,text) from public,anon,authenticated;
revoke all on function public.reserve_withdrawal_document_numbers() from public,anon,authenticated;
create trigger reserve_withdrawal_document_numbers after insert or update of ticket_no,fg_code on public.tickets
for each row execute function public.reserve_withdrawal_document_numbers();
