alter table public.inventory
  add column if not exists gift_from_user_id uuid references public.profiles(id) on delete set null;

alter table public.inventory
  add column if not exists gift_from_name text;

create or replace function public.purchase_product(target_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  product_row public.products%rowtype;
  locker_count integer;
  locker_max integer;
  owned_count integer;
begin
  if uid is null then
    raise exception '로그인이 필요합니다.';
  end if;

  perform 1 from public.profiles where id = uid for update;
  if not found then
    raise exception '사용자 정보를 찾을 수 없습니다.';
  end if;

  select * into product_row
  from public.products
  where id = target_product_id
  for update;

  if not found then
    raise exception '상품을 찾을 수 없습니다.';
  end if;
  if not product_row.is_active then
    raise exception '현재 판매 중인 상품이 아닙니다.';
  end if;
  if product_row.stock is not null and product_row.stock < 1 then
    raise exception '품절된 상품입니다.';
  end if;

  select count(*) into owned_count
  from public.inventory
  where user_id = uid and product_id = target_product_id;

  if product_row.purchase_limit is not null and owned_count + 1 > product_row.purchase_limit then
    raise exception '이 상품의 개인 구매 제한을 초과합니다.';
  end if;

  select count(*) into locker_count
  from public.inventory
  where user_id = uid and used_at is null;

  select coalesce(locker_limit, public.setting_int('locker_limit', 20))
    into locker_max
  from public.profiles
  where id = uid;

  if locker_count + 1 > locker_max then
    raise exception '보관함 공간이 부족합니다.';
  end if;

  update public.profiles
  set points = points - product_row.price
  where id = uid and points >= product_row.price;

  if not found then
    raise exception '포인트가 부족합니다.';
  end if;

  if product_row.stock is not null then
    update public.products set stock = stock - 1 where id = product_row.id;
  end if;

  insert into public.inventory(user_id, product_id, product_name, product_image_url)
  values(uid, product_row.id, product_row.name, product_row.image_url);

  if product_row.price > 0 then
    insert into public.point_logs(user_id, amount, type, description)
    values(uid, -product_row.price, 'purchase', product_row.name || ' 바로 구매');
  end if;
end;
$$;

create or replace function public.gift_product(target_product_id uuid, recipient_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender_id uuid := auth.uid();
  sender_name text;
  recipient_name text;
  recipient_locker_limit integer;
  recipient_locker_count integer;
  recipient_owned_count integer;
  product_row public.products%rowtype;
begin
  if sender_id is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if recipient_id is null then
    raise exception '선물 받을 캐릭터를 선택해주세요.';
  end if;
  if sender_id = recipient_id then
    raise exception '자기 자신에게는 선물할 수 없습니다.';
  end if;

  perform 1
  from public.profiles
  where id in (sender_id, recipient_id)
  order by id
  for update;

  select character_name into sender_name from public.profiles where id = sender_id;
  select character_name, coalesce(locker_limit, public.setting_int('locker_limit', 20))
    into recipient_name, recipient_locker_limit
  from public.profiles
  where id = recipient_id;

  if sender_name is null then
    raise exception '보내는 사용자 정보를 찾을 수 없습니다.';
  end if;
  if recipient_name is null then
    raise exception '선물 받을 캐릭터를 찾을 수 없습니다.';
  end if;

  select * into product_row
  from public.products
  where id = target_product_id
  for update;

  if not found then
    raise exception '상품을 찾을 수 없습니다.';
  end if;
  if not product_row.is_active then
    raise exception '현재 판매 중인 상품이 아닙니다.';
  end if;
  if product_row.stock is not null and product_row.stock < 1 then
    raise exception '품절된 상품입니다.';
  end if;

  select count(*) into recipient_locker_count
  from public.inventory
  where user_id = recipient_id and used_at is null;

  if recipient_locker_count + 1 > recipient_locker_limit then
    raise exception '상대방의 보관함 공간이 부족합니다.';
  end if;

  select count(*) into recipient_owned_count
  from public.inventory
  where user_id = recipient_id and product_id = target_product_id;

  if product_row.purchase_limit is not null and recipient_owned_count + 1 > product_row.purchase_limit then
    raise exception '상대방이 이 상품의 개인 구매 제한에 도달했습니다.';
  end if;

  update public.profiles
  set points = points - product_row.price
  where id = sender_id and points >= product_row.price;

  if not found then
    raise exception '포인트가 부족합니다.';
  end if;

  if product_row.stock is not null then
    update public.products set stock = stock - 1 where id = product_row.id;
  end if;

  insert into public.inventory(
    user_id, product_id, product_name, product_image_url, gift_from_user_id, gift_from_name
  ) values (
    recipient_id, product_row.id, product_row.name, product_row.image_url, sender_id, sender_name
  );

  if product_row.price > 0 then
    insert into public.point_logs(user_id, amount, type, description, actor_id)
    values(sender_id, -product_row.price, 'gift', recipient_name || '에게 ' || product_row.name || ' 선물', sender_id);
  end if;
end;
$$;

revoke all on function public.purchase_product(uuid) from public;
revoke all on function public.gift_product(uuid, uuid) from public;
grant execute on function public.purchase_product(uuid) to authenticated;
grant execute on function public.gift_product(uuid, uuid) to authenticated;
