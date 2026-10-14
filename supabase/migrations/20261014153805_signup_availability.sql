-- Registration starts closed; operators can reopen it through the settings API.
insert into public.app_settings(key,value) values('signup_enabled','false'::jsonb)
on conflict(key) do update set value=excluded.value;

-- Serialize member admission against the operator's ON/OFF update.
-- Only the trusted signup API can call this; direct operator creation is separate.
create or replace function public.register_self_signup(new_user_id uuid,new_username text,new_character_name text)
returns void language plpgsql security invoker set search_path='' as $$
declare enabled jsonb;
begin
 select value into enabled from public.app_settings where key='signup_enabled' for share;
 if enabled is distinct from 'true'::jsonb then
  raise exception '현재 회원가입이 중단되어 있습니다. 운영자의 가입 안내를 기다려주세요.';
 end if;
 insert into public.profiles(id,username,character_name,sport,points,role)
 values(new_user_id,new_username,new_character_name,null,500,'member');
 insert into public.point_logs(user_id,amount,type,description)
 values(new_user_id,500,'welcome','가입 시작 포인트');
end $$;
revoke all on function public.register_self_signup(uuid,text,text) from public,anon,authenticated;
grant execute on function public.register_self_signup(uuid,text,text) to service_role;
