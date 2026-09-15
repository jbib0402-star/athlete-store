create or replace function public.purchase_lottery(target_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  product_row public.products%rowtype;
  owned_count integer;
  plays_today integer;
  inventory_id uuid;
  result jsonb;
begin
  if uid is null then raise exception '로그인이 필요합니다.'; end if;

  perform 1 from public.profiles where id = uid for update;
  if not found then raise exception '사용자 정보를 찾을 수 없습니다.'; end if;

  select * into product_row
  from public.products
  where id = target_product_id
  for update;

  if not found then raise exception '상품을 찾을 수 없습니다.'; end if;
  if not product_row.is_active then raise exception '현재 판매 중인 상품이 아닙니다.'; end if;
  if product_row.special_type <> 'lottery' then raise exception '복권 상품이 아닙니다.'; end if;
  if product_row.stock is not null and product_row.stock < 1 then raise exception '품절된 상품입니다.'; end if;

  select count(*) into plays_today
  from public.lottery_plays
  where user_id = uid
    and product_id = target_product_id
    and (played_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date;

  if plays_today >= product_row.lottery_daily_limit then
    raise exception '오늘의 응모 횟수를 모두 사용했습니다! 일일복권은 공정한 이용을 위해 하루 최대 %회까지 참여할 수 있습니다. 내일 다시 행운을 시험해보세요!', product_row.lottery_daily_limit;
  end if;

  select count(*) into owned_count
  from public.inventory
  where user_id = uid and product_id = target_product_id;

  if product_row.purchase_limit is not null and owned_count + 1 > product_row.purchase_limit then
    raise exception '이 상품의 개인 구매 제한을 초과합니다.';
  end if;

  update public.profiles
  set points = points - product_row.price
  where id = uid and points >= product_row.price;
  if not found then raise exception '포인트가 부족합니다.'; end if;

  if product_row.stock is not null then
    update public.products set stock = stock - 1 where id = product_row.id;
  end if;

  insert into public.inventory(user_id, product_id, product_name, product_image_url, effect_text, effect_duration_hours)
  values(uid, product_row.id, product_row.name, product_row.image_url, null, null)
  returning id into inventory_id;

  if product_row.price > 0 then
    insert into public.point_logs(user_id, amount, type, description)
    values(uid, -product_row.price, 'purchase', product_row.name || ' 바로 구매');
  end if;

  select public.play_lottery(inventory_id) into result;
  return result;
end;
$$;

revoke all on function public.purchase_lottery(uuid) from public;
grant execute on function public.purchase_lottery(uuid) to authenticated;
