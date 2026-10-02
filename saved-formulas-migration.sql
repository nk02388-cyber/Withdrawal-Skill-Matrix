-- Reusable production formulas. Ticket material snapshots remain independent.
begin;
create table if not exists public.saved_production_formulas (
  fg_code text primary key,
  fg_name text not null,
  base_qty numeric not null,
  lines jsonb not null,
  source_sha256 text not null,
  created_at timestamptz not null default now(),
  created_by text not null
);
alter table public.saved_production_formulas enable row level security;
revoke all on public.saved_production_formulas from public,anon,authenticated;

create or replace function public.get_saved_production_formulas() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('fg_code',fg_code,'fg_name',fg_name,
    'base_qty',base_qty,'lines',lines,'source_sha256',source_sha256,'created_at',created_at)
    order by fg_code),'[]'::jsonb) from public.saved_production_formulas;
$$;
revoke all on function public.get_saved_production_formulas() from public,authenticated;
grant execute on function public.get_saved_production_formulas() to anon;

create or replace function public.save_production_formula_as_supervisor(
  p_username text,p_code text,p_fg_code text,p_fg_name text,p_base_qty numeric,p_lines jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare line jsonb; item_code text; seen text[]:='{}'; normalized jsonb:='[]';
  rate numeric; fg text:=upper(trim(coalesce(p_fg_code,''))); version text;
begin
  if not public.check_role_code('supervisor',p_username,p_code) then raise exception 'Supervisor access required'; end if;
  if fg !~ '^[A-Z0-9/._-]{1,80}$' or length(trim(coalesce(p_fg_name,''))) not between 1 and 300
    or p_base_qty is null or p_base_qty='NaN'::numeric or p_base_qty<=0 or p_base_qty>1000000
    or p_base_qty<>round(p_base_qty,3) then raise exception 'Invalid formula details'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Invalid formula materials'; end if;
  if jsonb_array_length(p_lines) not between 1 and 30 then raise exception 'Formula requires 1-30 materials'; end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    item_code:=upper(trim(coalesce(line->>'pk_code','')));
    rate:=(line->>'qty_per_unit')::numeric;
    if item_code !~ '^[A-Z0-9/._-]{1,80}$' or item_code=any(seen)
      or length(trim(coalesce(line->>'pk_name',''))) not between 1 and 300
      or length(trim(coalesce(line->>'unit',''))) not between 1 and 30
      or rate is null or rate='NaN'::numeric or rate<=0 or rate>1000000000
      then raise exception 'Invalid or duplicate formula material'; end if;
    seen:=array_append(seen,item_code);
    normalized:=normalized||jsonb_build_array(jsonb_build_object('pk_code',item_code,
      'pk_name',trim(line->>'pk_name'),'unit',trim(line->>'unit'),'qty_per_unit',rate,'source','bom'));
  end loop;
  version:=encode(extensions.digest(convert_to(fg||trim(p_fg_name)||p_base_qty::text||normalized::text,'UTF8'),'sha256'),'hex');
  insert into public.saved_production_formulas(fg_code,fg_name,base_qty,lines,source_sha256,created_by)
  values(fg,trim(p_fg_name),p_base_qty,normalized,version,p_username);
  return jsonb_build_object('fg_code',fg,'fg_name',trim(p_fg_name),'base_qty',p_base_qty,
    'lines',normalized,'source_sha256',version);
exception when unique_violation then raise exception 'Formula code already saved';
end; $$;
revoke all on function public.save_production_formula_as_supervisor(text,text,text,text,numeric,jsonb) from public,authenticated;
grant execute on function public.save_production_formula_as_supervisor(text,text,text,text,numeric,jsonb) to anon;
notify pgrst,'reload schema';
commit;
