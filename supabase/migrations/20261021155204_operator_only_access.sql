insert into public.app_settings(key,value) values('operator_only_access','false'::jsonb)
on conflict(key) do nothing;

create schema if not exists store_private;
revoke all on schema store_private from public;
grant usage on schema store_private to anon, authenticated, service_role, authenticator;

-- Lookup privileges remain internal. Never trust user-editable metadata roles.
create function store_private.store_access_allowed()
returns boolean language sql stable security definer set search_path = ''
as $$
  select not exists(select 1 from public.app_settings where key='operator_only_access' and value='true'::jsonb)
    or exists(select 1 from public.profiles where id=(select auth.uid()) and role in ('admin','staff'));
$$;
revoke all on function store_private.store_access_allowed() from public;
grant execute on function store_private.store_access_allowed() to anon, authenticated, service_role;

-- PostgREST invokes this before SELECTs, writes and SECURITY DEFINER RPCs.
create function store_private.enforce_store_access()
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  if (select auth.jwt()->>'role')='service_role' then return; end if;
  if not store_private.store_access_allowed() then
    raise sqlstate 'PT403' using message='현재 운영진만 접속할 수 있습니다. 운영진의 이용 안내를 기다려주세요.';
  end if;
end;
$$;
revoke all on function store_private.enforce_store_access() from public;
grant execute on function store_private.enforce_store_access() to anon, authenticated, service_role;

-- Restrictive policies supplement existing policies rather than granting access.
-- These also protect authenticated Realtime and Storage operations.
do $$
declare target record;
begin
  for target in
    select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relrowsecurity and c.relkind in ('r','p') and
      (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
  loop
    execute format('create policy operator_only_access_guard on %I.%I as restrictive for all to anon,authenticated using ((select store_private.store_access_allowed())) with check ((select store_private.store_access_allowed()))',target.nspname,target.relname);
  end loop;
end;
$$;

-- Preserve signup preference but serialize signup against either closure toggle.
create or replace function public.register_self_signup(new_user_id uuid,new_username text,new_character_name text)
returns void language plpgsql security invoker set search_path = ''
as $$
declare enabled jsonb; restricted jsonb;
begin
  perform 1 from public.app_settings where key in ('operator_only_access','signup_enabled') order by key for share;
  select value into enabled from public.app_settings where key='signup_enabled';
  select value into restricted from public.app_settings where key='operator_only_access';
  if enabled is distinct from 'true'::jsonb or restricted='true'::jsonb then
    raise exception '현재 회원가입이 중단되어 있습니다. 운영자의 가입 안내를 기다려주세요.';
  end if;
  insert into public.profiles(id,username,character_name,sport,points,role)
  values(new_user_id,new_username,new_character_name,null,500,'member');
  insert into public.point_logs(user_id,amount,type,description)
  values(new_user_id,500,'welcome','가입 시작 포인트');
end;
$$;
revoke all on function public.register_self_signup(uuid,text,text) from public,anon,authenticated;
grant execute on function public.register_self_signup(uuid,text,text) to service_role;

alter role authenticator set pgrst.db_pre_request='store_private.enforce_store_access';
notify pgrst,'reload schema';
notify pgrst,'reload config';
