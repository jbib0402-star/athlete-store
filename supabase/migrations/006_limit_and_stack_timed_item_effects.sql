create or replace function public.use_inventory_item(inventory_item_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  duration_hours integer;
  item_product_id uuid;
  item_name text;
  item_effect_text text;
  active_timed_count integer;
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

  select count(*) into active_timed_count
  from public.inventory
  where user_id = uid
    and effect_duration_hours is not null
    and effect_expires_at is not null
    and effect_expires_at > now();

  if active_timed_count >= 3 then
    raise exception '건강을 위해 더 이상 시간제 아이템을 사용할 수 없습니다! 시간제 아이템은 최대 3개까지 동시에 사용할 수 있습니다.';
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
  set used_at = now(),
      effect_expires_at = next_expires
  where id = inventory_item_id and user_id = uid and used_at is null;
end $$;

revoke all on function public.use_inventory_item(uuid) from public;
grant execute on function public.use_inventory_item(uuid) to authenticated;
