-- Replace __PHOTO_DATA__ with a JPEG produced by the upload UI. All fixtures roll back.
begin;
do $$
declare code text:=gen_random_uuid()::text; tid uuid; photo text:='__PHOTO_DATA__'; blocked boolean;
begin
 update public.app_settings set value='qa-photo-supervisor' where key='supervisor_username';
 update public.app_settings set value=extensions.crypt(code,extensions.gen_salt('bf')) where key='supervisor_code';
 update public.app_settings set value='qa-photo-operator' where key='operator_username';
 update public.app_settings set value=extensions.crypt(code,extensions.gen_salt('bf')) where key='operator_code';
 blocked:=false;
 begin perform public.add_staff_with_photo_as_supervisor('qa-photo-operator',code,'QA-PHOTO',photo); exception when others then if sqlerrm='Supervisor access required' then blocked:=true; else raise; end if; end;
 if not blocked then raise exception 'FAIL operator create'; end if;
 tid:=public.add_staff_with_photo_as_supervisor('qa-photo-supervisor',code,'QA-PHOTO-ROLLBACK',null);
 blocked:=false;
 begin perform public.set_staff_photo_as_supervisor('qa-photo-operator',code,tid,photo); exception when others then if sqlerrm='Supervisor access required' then blocked:=true; else raise; end if; end;
 if not blocked then raise exception 'FAIL operator photo'; end if;
 blocked:=false;
 begin perform public.set_staff_photo_as_supervisor('qa-photo-supervisor',code,tid,'data:image/svg+xml;base64,PHN2Zz4='); exception when others then blocked:=true; end;
 if not blocked then raise exception 'FAIL svg rejection'; end if;
 blocked:=false;
 begin perform public.set_staff_photo_as_supervisor('qa-photo-supervisor',code,tid,'data:image/jpeg;base64,'||repeat('A',100001)); exception when others then blocked:=true; end;
 if not blocked then raise exception 'FAIL size rejection'; end if;
 blocked:=false;
 begin perform public.set_staff_photo_as_supervisor('qa-photo-supervisor',code,tid,'data:image/jpeg;base64,AAAA'); exception when others then blocked:=true; end;
 if not blocked then raise exception 'FAIL non-JPEG rejection'; end if;
 perform public.set_staff_photo_as_supervisor('qa-photo-supervisor',code,tid,photo);
 if not exists(select 1 from jsonb_array_elements(public.get_dashboard_state()->'people') p where p->>'id'=tid::text and p->>'photo_data'=photo) then raise exception 'FAIL synced photo'; end if;
 tid:=public.add_staff_with_photo_as_supervisor('qa-photo-supervisor',code,'QA-PHOTO-CREATE-ROLLBACK',photo);
 if not exists(select 1 from public.staff where id=tid and photo_data=photo) then raise exception 'FAIL create with photo'; end if;
end $$;
rollback;
