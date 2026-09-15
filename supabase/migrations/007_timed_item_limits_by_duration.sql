alter table public.products
  drop constraint if exists products_effect_duration_hours_check;

alter table public.products
  add constraint products_effect_duration_hours_check
  check (effect_duration_hours is null or effect_duration_hours in (6,8,24));

create or replace function public.use_inventory_item(inventory_item_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  duration_hours integer;
  item_product_id uuid;
  item_name text;
  item_effect_text text;
  active_same_duration integer;
  used_today_24 integer;
  stack_until timestamptz;
  next_expires timestamptz;
begin
  if uid is null then raise exception '로그인이 필요합니다.'; end if;

  perform 1 from public.profiles where id = uid for update;

  select effect_duration_hours, product_id, product_name, effect_text
    into duration_hours, item_product_id, item_name, item_effect_text
  from public.inventory
  where id = inventory_item_id and user_id = uid and used_at is null
  for update;

  if not found then raise exception '사용할 수 없는 아이템입니다.'; end if;

  if duration_hours is null then
    update public.inventory
    set used_at = now(), effect_expires_at = null
    where id = inventory_item_id and user_id = uid and used_at is null;
    return;
  end if;

  if duration_hours = 6 then
    select count(*) into active_same_duration
    from public.inventory
    where user_id = uid
      and effect_duration_hours = 6
      and effect_expires_at is not null
      and effect_expires_at > now();

    if active_same_duration >= 3 then
      raise exception '선수의 컨디션과 건강 보호를 위해 6시간 효과 아이템은 동시에 최대 3개까지만 사용할 수 있습니다. 현재 효과가 일부 종료된 뒤 다시 이용해주세요.';
    end if;
  elsif duration_hours = 8 then
    select count(*) into active_same_duration
    from public.inventory
    where user_id = uid
      and effect_duration_hours = 8
      and effect_expires_at is not null
      and effect_expires_at > now();

    if active_same_duration >= 2 then
      raise exception '선수의 컨디션과 건강 보호를 위해 8시간 효과 아이템은 동시에 최대 2개까지만 사용할 수 있습니다. 현재 효과가 일부 종료된 뒤 다시 이용해주세요.';
    end if;
  elsif duration_hours = 24 then
    select count(*) into used_today_24
    from public.inventory
    where user_id = uid
      and effect_duration_hours = 24
      and used_at is not null
      and (used_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date;

    if used_today_24 >= 1 then
      raise exception '선수의 컨디션과 건강 보호를 위해 24시간 효과 아이템은 하루에 1개만 사용할 수 있습니다. 충분한 회복 후 다음 날 다시 이용해주세요.';
    end if;
  else
    raise exception '지원하지 않는 효과 지속시간입니다.';
  end if;

  select max(effect_expires_at) into stack_until
  from public.inventory
  where user_id = uid
    and effect_duration_hours is not null
    and effect_expires_at is not null
    and effect_expires_at > now()
    and (
      (item_product_id is not null and product_id = item_product_id)
      or
      (item_product_id is null and product_id is null and product_name = item_name
        and effect_duration_hours = duration_hours
        and effect_text is not distinct from item_effect_text)
    );

  next_expires := greatest(coalesce(stack_until, now()), now()) + make_interval(hours => duration_hours);

  update public.inventory
  set used_at = now(), effect_expires_at = next_expires
  where id = inventory_item_id and user_id = uid and used_at is null;
end $$;

revoke all on function public.use_inventory_item(uuid) from public;
grant execute on function public.use_inventory_item(uuid) to authenticated;
