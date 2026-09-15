alter table public.products
  add column if not exists special_type text not null default 'standard';

alter table public.products
  drop constraint if exists products_special_type_check;

alter table public.products
  add constraint products_special_type_check
  check (special_type in ('standard','lottery'));

alter table public.products
  add column if not exists lottery_daily_limit integer not null default 3;

alter table public.products
  drop constraint if exists products_lottery_daily_limit_check;

alter table public.products
  add constraint products_lottery_daily_limit_check
  check (lottery_daily_limit between 1 and 20);

alter table public.products
  add column if not exists lottery_prizes jsonb not null default '[{"label":"꽝","points":0,"chance":50},{"label":"100P 당첨!","points":100,"chance":30},{"label":"300P 당첨!","points":300,"chance":15},{"label":"500P 당첨!","points":500,"chance":4},{"label":"1000P 당첨!","points":1000,"chance":1}]'::jsonb;

create table if not exists public.lottery_plays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  inventory_id uuid references public.inventory(id) on delete set null,
  result_label text not null,
  reward_points integer not null default 0 check (reward_points >= 0),
  played_at timestamptz not null default now()
);

create index if not exists lottery_plays_user_product_played_idx
  on public.lottery_plays(user_id, product_id, played_at desc);

alter table public.lottery_plays enable row level security;

drop policy if exists lottery_plays_read_own on public.lottery_plays;
create policy lottery_plays_read_own
  on public.lottery_plays
  for select
  using (user_id = auth.uid());

create or replace function public.play_lottery(inventory_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  inv_product_id uuid;
  inv_product_name text;
  product_type text;
  daily_limit integer;
  prizes jsonb;
  plays_today integer;
  total_chance numeric;
  pick_value numeric;
  selected_prize jsonb;
  selected_label text;
  selected_points integer;
  attempt_no integer;
begin
  if uid is null then raise exception '로그인이 필요합니다.'; end if;

  perform 1 from public.profiles where id = uid for update;
  if not found then raise exception '사용자 정보를 찾을 수 없습니다.'; end if;

  select i.product_id, i.product_name, p.special_type, p.lottery_daily_limit, p.lottery_prizes
    into inv_product_id, inv_product_name, product_type, daily_limit, prizes
  from public.inventory i
  join public.products p on p.id = i.product_id
  where i.id = inventory_item_id
    and i.user_id = uid
    and i.used_at is null
  for update of i;

  if not found then raise exception '사용할 수 없는 복권입니다.'; end if;
  if product_type <> 'lottery' then raise exception '복권 아이템이 아닙니다.'; end if;

  select count(*) into plays_today
  from public.lottery_plays
  where user_id = uid
    and product_id = inv_product_id
    and (played_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date;

  if plays_today >= daily_limit then
    raise exception '오늘의 응모 횟수를 모두 사용했습니다! 일일복권은 공정한 이용을 위해 하루 최대 %회까지 참여할 수 있습니다. 내일 다시 행운을 시험해보세요!', daily_limit;
  end if;

  if prizes is null or jsonb_typeof(prizes) <> 'array' or jsonb_array_length(prizes) = 0 then
    raise exception '복권 당첨 설정이 비어 있습니다. 운영진에게 문의해주세요.';
  end if;

  select coalesce(sum(greatest(0, (entry->>'chance')::numeric)), 0)
    into total_chance
  from jsonb_array_elements(prizes) as entry;

  if total_chance <= 0 then
    raise exception '복권 당첨 확률 설정을 확인해주세요.';
  end if;

  pick_value := random() * total_chance;

  select prize into selected_prize
  from (
    select prize,
           ord,
           sum(greatest(0, (prize->>'chance')::numeric)) over (order by ord) as cumulative
    from jsonb_array_elements(prizes) with ordinality as p(prize, ord)
  ) weighted
  where cumulative >= pick_value
  order by ord
  limit 1;

  if selected_prize is null then
    selected_prize := prizes->(jsonb_array_length(prizes) - 1);
  end if;

  selected_points := greatest(0, coalesce((selected_prize->>'points')::integer, 0));
  selected_label := nullif(trim(selected_prize->>'label'), '');
  if selected_label is null then
    selected_label := case when selected_points > 0 then selected_points || 'P 당첨!' else '꽝' end;
  end if;

  update public.inventory
  set used_at = now(), effect_expires_at = null
  where id = inventory_item_id and user_id = uid and used_at is null;

  insert into public.lottery_plays(user_id, product_id, inventory_id, result_label, reward_points)
  values(uid, inv_product_id, inventory_item_id, selected_label, selected_points);

  if selected_points > 0 then
    update public.profiles set points = points + selected_points where id = uid;
    insert into public.point_logs(user_id, amount, type, description)
    values(uid, selected_points, 'lottery', inv_product_name || ' · ' || selected_label);
  end if;

  attempt_no := plays_today + 1;

  return jsonb_build_object(
    'product_name', inv_product_name,
    'result_label', selected_label,
    'reward_points', selected_points,
    'attempt_no', attempt_no,
    'daily_limit', daily_limit
  );
end;
$$;

revoke all on function public.play_lottery(uuid) from public;
grant execute on function public.play_lottery(uuid) to authenticated;
