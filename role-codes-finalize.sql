-- Run only after activate_role_codes has succeeded.
revoke all on function public.activate_role_codes(text,text,text) from anon;
