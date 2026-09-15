alter table public.products
  add column if not exists effect_text text not null default '';

alter table public.products
  add column if not exists effect_duration_hours integer;

alter table public.products
  drop constraint if exists products_effect_duration_hours_check;

alter table public.products
  add constraint products_effect_duration_hours_check
  check (effect_duration_hours is null or effect_duration_hours in (6,12,24));

alter table public.inventory
  add column if not exists effect_text text;

alter table public.inventory
  add column if not exists effect_duration_hours integer;

alter table public.inventory
  add column if not exists effect_expires_at timestamptz;

create or replace function public.purchase_cart()
returns void language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid(); total integer; item_count integer; locker_count integer; locker_max integer; summary text;
begin
  if uid is null then raise exception '로그인이 필요합니다.'; end if;
  perform 1 from public.profiles where id = uid for update;
  perform 1 from public.products p join public.cart_items c on c.product_id = p.id where c.user_id = uid for update of p;
  select coalesce(sum(p.price*c.quantity),0),coalesce(sum(c.quantity),0),string_agg(p.name || ' ×' || c.quantity,', ')
    into total,item_count,summary from public.cart_items c join public.products p on p.id=c.product_id where c.user_id=uid;
  if item_count = 0 then raise exception '장바구니가 비어 있습니다.'; end if;
  if exists(select 1 from public.cart_items c join public.products p on p.id=c.product_id where c.user_id=uid and (not p.is_active or (p.stock is not null and p.stock<c.quantity))) then raise exception '품절되었거나 판매가 중단된 상품이 있습니다.'; end if;
  if exists(select 1 from public.cart_items c join public.products p on p.id=c.product_id where c.user_id=uid and p.purchase_limit is not null and (select count(*) from public.inventory i where i.user_id=uid and i.product_id=p.id)+c.quantity>p.purchase_limit) then raise exception '구매 제한을 초과한 상품이 있습니다.'; end if;
  select count(*) into locker_count from public.inventory where user_id=uid and used_at is null;
  select coalesce(locker_limit,public.setting_int('locker_limit',20)) into locker_max from public.profiles where id=uid;
  if locker_count + item_count > locker_max then raise exception '보관함 공간이 부족합니다.'; end if;
  update public.profiles set points=points-total where id=uid and points>=total;
  if not found then raise exception '포인트가 부족합니다.'; end if;
  update public.products p set stock=p.stock-q.qty from (select product_id,sum(quantity)::integer qty from public.cart_items where user_id=uid group by product_id) q where p.id=q.product_id and p.stock is not null;
  insert into public.inventory(user_id,product_id,product_name,product_image_url,effect_text,effect_duration_hours)
    select uid,p.id,p.name,p.image_url,nullif(p.effect_text,''),p.effect_duration_hours
    from public.cart_items c join public.products p on p.id=c.product_id
    cross join lateral generate_series(1,c.quantity) where c.user_id=uid;
  if total > 0 then insert into public.point_logs(user_id,amount,type,description) values(uid,-total,'purchase',summary); end if;
  delete from public.cart_items where user_id=uid;
end $$;

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
  if uid is null then raise exception '로그인이 필요합니다.'; end if;
  perform 1 from public.profiles where id = uid for update;
  if not found then raise exception '사용자 정보를 찾을 수 없습니다.'; end if;
  select * into product_row from public.products where id = target_product_id for update;
  if not found then raise exception '상품을 찾을 수 없습니다.'; end if;
  if not product_row.is_active then raise exception '현재 판매 중인 상품이 아닙니다.'; end if;
  if product_row.stock is not null and product_row.stock < 1 then raise exception '품절된 상품입니다.'; end if;
  select count(*) into owned_count from public.inventory where user_id = uid and product_id = target_product_id;
  if product_row.purchase_limit is not null and owned_count + 1 > product_row.purchase_limit then raise exception '이 상품의 개인 구매 제한을 초과합니다.'; end if;
  select count(*) into locker_count from public.inventory where user_id = uid and used_at is null;
  select coalesce(locker_limit, public.setting_int('locker_limit', 20)) into locker_max from public.profiles where id = uid;
  if locker_count + 1 > locker_max then raise exception '보관함 공간이 부족합니다.'; end if;
  update public.profiles set points = points - product_row.price where id = uid and points >= product_row.price;
  if not found then raise exception '포인트가 부족합니다.'; end if;
  if product_row.stock is not null then update public.products set stock = stock - 1 where id = product_row.id; end if;
  insert into public.inventory(user_id, product_id, product_name, product_image_url, effect_text, effect_duration_hours)
  values(uid, product_row.id, product_row.name, product_row.image_url, nullif(product_row.effect_text,''), product_row.effect_duration_hours);
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
  if sender_id is null then raise exception '로그인이 필요합니다.'; end if;
  if recipient_id is null then raise exception '선물 받을 캐릭터를 선택해주세요.'; end if;
  if sender_id = recipient_id then raise exception '자기 자신에게는 선물할 수 없습니다.'; end if;
  perform 1 from public.profiles where id in (sender_id, recipient_id) order by id for update;
  select character_name into sender_name from public.profiles where id = sender_id;
  select character_name, coalesce(locker_limit, public.setting_int('locker_limit', 20)) into recipient_name, recipient_locker_limit from public.profiles where id = recipient_id;
  if sender_name is null then raise exception '보내는 사용자 정보를 찾을 수 없습니다.'; end if;
  if recipient_name is null then raise exception '선물 받을 캐릭터를 찾을 수 없습니다.'; end if;
  select * into product_row from public.products where id = target_product_id for update;
  if not found then raise exception '상품을 찾을 수 없습니다.'; end if;
  if not product_row.is_active then raise exception '현재 판매 중인 상품이 아닙니다.'; end if;
  if product_row.stock is not null and product_row.stock < 1 then raise exception '품절된 상품입니다.'; end if;
  select count(*) into recipient_locker_count from public.inventory where user_id = recipient_id and used_at is null;
  if recipient_locker_count + 1 > recipient_locker_limit then raise exception '상대방의 보관함 공간이 부족합니다.'; end if;
  select count(*) into recipient_owned_count from public.inventory where user_id = recipient_id and product_id = target_product_id;
  if product_row.purchase_limit is not null and recipient_owned_count + 1 > product_row.purchase_limit then raise exception '상대방이 이 상품의 개인 구매 제한에 도달했습니다.'; end if;
  update public.profiles set points = points - product_row.price where id = sender_id and points >= product_row.price;
  if not found then raise exception '포인트가 부족합니다.'; end if;
  if product_row.stock is not null then update public.products set stock = stock - 1 where id = product_row.id; end if;
  insert into public.inventory(user_id, product_id, product_name, product_image_url, gift_from_user_id, gift_from_name, effect_text, effect_duration_hours)
  values(recipient_id, product_row.id, product_row.name, product_row.image_url, sender_id, sender_name, nullif(product_row.effect_text,''), product_row.effect_duration_hours);
  if product_row.price > 0 then
    insert into public.point_logs(user_id, amount, type, description, actor_id)
    values(sender_id, -product_row.price, 'gift', recipient_name || '에게 ' || product_row.name || ' 선물', sender_id);
  end if;
end;
$$;

create or replace function public.use_inventory_item(inventory_item_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  duration_hours integer;
begin
  select effect_duration_hours into duration_hours
  from public.inventory
  where id=inventory_item_id and user_id=auth.uid() and used_at is null
  for update;

  if not found then raise exception '사용할 수 없는 아이템입니다.'; end if;

  update public.inventory
  set used_at = now(),
      effect_expires_at = case
        when duration_hours is not null then now() + make_interval(hours => duration_hours)
        else null
      end
  where id=inventory_item_id and user_id=auth.uid() and used_at is null;
end $$;

revoke all on function public.purchase_cart() from public;
revoke all on function public.purchase_product(uuid) from public;
revoke all on function public.gift_product(uuid, uuid) from public;
revoke all on function public.use_inventory_item(uuid) from public;
grant execute on function public.purchase_cart() to authenticated;
grant execute on function public.purchase_product(uuid) to authenticated;
grant execute on function public.gift_product(uuid, uuid) to authenticated;
grant execute on function public.use_inventory_item(uuid) to authenticated;
