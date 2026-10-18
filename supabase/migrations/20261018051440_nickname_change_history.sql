-- Audit future changes only; previous names were not stored.
create table public.nickname_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  old_name text not null,
  new_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint nickname_history_actual_change check (old_name is distinct from new_name)
);

create index nickname_history_user_created_idx
  on public.nickname_history(user_id, created_at desc, id desc);
alter table public.nickname_history enable row level security;
-- Read through the server API after fresh operator authorization only.
-- The existing nickname RPC runs as its owner; ordinary clients cannot forge logs.
revoke all on table public.nickname_history from public, anon, authenticated, service_role;
grant select, insert on table public.nickname_history to service_role;

create function public.record_nickname_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.nickname_history(user_id, old_name, new_name)
  values (new.id, old.character_name, new.character_name);
  return new;
end;
$$;
revoke all on function public.record_nickname_change() from public, anon, authenticated;
grant execute on function public.record_nickname_change() to service_role;

create trigger record_profile_nickname_change
after update of character_name on public.profiles
for each row
when (old.character_name is distinct from new.character_name)
execute function public.record_nickname_change();
