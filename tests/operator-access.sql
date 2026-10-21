-- Run as postgres. Every setting/role change is rolled back.
begin;
do $$
declare member_id uuid; operator_id uuid; denied boolean; visible integer;
begin
  select id into member_id from public.profiles where role='member' limit 1;
  select id into operator_id from public.profiles where role='admin' limit 1;
  if member_id is null or operator_id is null then raise exception 'Test requires a member and an admin'; end if;
  update public.app_settings set value='false'::jsonb where key='operator_only_access';
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true);
  set local role authenticated;
  if not store_private.store_access_allowed() then raise exception 'OFF blocked a member'; end if;
  perform store_private.enforce_store_access();
  reset role;

  update public.app_settings set value='true'::jsonb where key='operator_only_access';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated','user_metadata',jsonb_build_object('role','admin'))::text,true);
  set local role authenticated;
  if store_private.store_access_allowed() then raise exception 'Metadata forged operator access'; end if;
  denied := false;
  begin perform store_private.enforce_store_access(); exception when sqlstate 'PT403' then denied:=true; end;
  if not denied then raise exception 'Member Data API requests were not blocked'; end if;
  select count(*) into visible from public.profiles;
  if visible<>0 then raise exception 'Member RLS still exposes profiles'; end if;
  select count(*) into visible from public.products;
  if visible<>0 then raise exception 'Member RLS still exposes products'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub',operator_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',operator_id,'role','authenticated')::text,true);
  set local role authenticated;
  if not store_private.store_access_allowed() then raise exception 'ON blocked admin'; end if;
  perform store_private.enforce_store_access();
  reset role;
  update public.profiles set role='staff' where id=operator_id;
  set local role authenticated;
  if not store_private.store_access_allowed() then raise exception 'ON blocked staff'; end if;
  perform store_private.enforce_store_access();
  reset role;

  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  denied := false;
  begin perform store_private.enforce_store_access(); exception when sqlstate 'PT403' then denied:=true; end;
  if not denied then raise exception 'Anonymous Data API requests were not blocked'; end if;
  reset role;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  set local role service_role;
  perform store_private.enforce_store_access();
  denied:=false;
  begin
    perform public.register_self_signup(gen_random_uuid(),'access-test','검증');
  exception when others then
    if sqlerrm like '현재 회원가입이 중단%' then denied:=true; else raise; end if;
  end;
  if not denied then raise exception 'Signup was allowed in operator-only mode'; end if;
  reset role;

  update public.app_settings set value='false'::jsonb where key='operator_only_access';
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true);
  set local role authenticated;
  perform store_private.enforce_store_access();
  select count(*) into visible from public.profiles;
  if visible=0 then raise exception 'Reopening failed'; end if;
  reset role;
end;
$$;
select true as operator_only_on_off_roles_rls_signup_checks_passed;
rollback;
