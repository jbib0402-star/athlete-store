-- Run as postgres. All profile and history writes are rolled back.
begin;
do $$
declare
  target uuid;
  original_name text;
  before_count integer;
  after_count integer;
begin
  select id, character_name into target, original_name from public.profiles order by created_at limit 1 for update;
  if target is null then raise exception 'A profile is required for this rollback test'; end if;
  select count(*) into before_count from public.nickname_history where user_id = target;
  perform set_config('request.jwt.claim.sub', target::text, true);
  set local role authenticated;
  perform public.update_my_character_name('닉네임 기록 검증 A');
  reset role;
  select count(*) into after_count from public.nickname_history where user_id = target;
  if after_count <> before_count + 1 then raise exception 'Rename was not logged'; end if;
  if not exists (select 1 from public.nickname_history where user_id = target and old_name = original_name and new_name = '닉네임 기록 검증 A' and created_at >= transaction_timestamp()) then
    raise exception 'Old name, new name or timestamp is incorrect';
  end if;
  set local role authenticated;
  perform public.update_my_character_name('닉네임 기록 검증 A');
  reset role;
  select count(*) into after_count from public.nickname_history where user_id = target;
  if after_count <> before_count + 1 then raise exception 'Same-name save generated an extra row'; end if;
  set local role authenticated;
  perform public.update_my_character_name('닉네임 기록 검증 B');
  reset role;
  if not exists (select 1 from public.nickname_history where user_id = target and old_name = '닉네임 기록 검증 A' and new_name = '닉네임 기록 검증 B') then
    raise exception 'Repeated changes were not tracked';
  end if;
  if has_table_privilege('authenticated', 'public.nickname_history', 'SELECT') or
     has_table_privilege('authenticated', 'public.nickname_history', 'INSERT') or
     has_table_privilege('anon', 'public.nickname_history', 'SELECT') then
    raise exception 'History is accessible to ordinary clients';
  end if;
  if not has_table_privilege('service_role', 'public.nickname_history', 'SELECT') then
    raise exception 'Server cannot read history';
  end if;
end;
$$;
select true as rename_audit_permissions_and_same_name_checks_passed;
rollback;
