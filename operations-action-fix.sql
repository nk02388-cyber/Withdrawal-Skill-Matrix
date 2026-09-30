-- New jobs must never inherit confirmed quantities from a client-supplied BOM.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.perform_work_action(text,text,text,uuid,text,jsonb)'::regprocedure);
 definition:=replace(definition,'args:=p_args||jsonb_build_object',
 'if p_action=''create_withdrawal_ticket_as_supervisor'' then
    p_args:=jsonb_set(p_args,''{p_bom_materials}'',coalesce((select jsonb_agg(line-''actual_qty''-''confirmed_at''-''short_reason''-''reason_code'') from jsonb_array_elements(p_args->''p_bom_materials'') line),''[]''));
    p_args:=jsonb_set(p_args,''{p_stock_lines}'',coalesce((select jsonb_agg(line-''actual_qty''-''confirmed_at''-''short_reason''-''reason_code'') from jsonb_array_elements(p_args->''p_stock_lines'') line),''[]''));
  end if;
  args:=p_args||jsonb_build_object');
 execute definition;
end $$;
