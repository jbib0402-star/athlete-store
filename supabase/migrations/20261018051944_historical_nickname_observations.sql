-- Preserve only names tied to an account by stored IDs. Activity dates are
-- observations, not reconstructed rename timestamps.
create table public.nickname_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  sources text[] not null,
  unique(user_id, nickname)
);
alter table public.nickname_observations enable row level security;
revoke all on table public.nickname_observations from public, anon, authenticated, service_role;
grant select on table public.nickname_observations to service_role;

with unambiguous_transfers as (
  select sender_id, amount, created_at, (array_agg(distinct receiver_id))[1] as receiver_id
  from public.transfers
  group by sender_id, amount, created_at
  having count(distinct receiver_id) = 1
), observations as (
  select gift_from_user_id as user_id, gift_from_name as nickname,
    purchased_at as observed_at, 'gift'::text as source
  from public.inventory
  where gift_from_user_id is not null and gift_from_name is not null
  union all
  select actor_id, left(description, char_length(description) - char_length('에게 받음')),
    created_at, 'transfer'
  from public.point_logs
  where type = 'transfer_in' and actor_id is not null and description like '%에게 받음'
  union all
  select t.receiver_id, left(l.description, char_length(l.description) - char_length('에게 양도')),
    l.created_at, 'transfer'
  from public.point_logs l
  join unambiguous_transfers t on t.sender_id = l.user_id and t.amount = -l.amount and t.created_at = l.created_at
  where l.type = 'transfer_out' and l.description like '%에게 양도'
)
insert into public.nickname_observations(user_id, nickname, first_seen, last_seen, sources)
select o.user_id, o.nickname, min(o.observed_at), max(o.observed_at), array_agg(distinct o.source order by o.source)
from observations o join public.profiles p on p.id = o.user_id
where o.nickname <> p.character_name and btrim(o.nickname) <> ''
group by o.user_id, o.nickname;

create view public.member_nickname_records with (security_invoker = true) as
select id, user_id, old_name, new_name, created_at, 'change'::text as record_kind,
  null::text as nickname, null::timestamptz as first_seen, null::timestamptz as last_seen, null::text[] as sources
from public.nickname_history
union all
select id, user_id, null::text, null::text, last_seen, 'observation'::text,
  nickname, first_seen, last_seen, sources
from public.nickname_observations;
revoke all on public.member_nickname_records from public, anon, authenticated, service_role;
grant select on public.member_nickname_records to service_role;
