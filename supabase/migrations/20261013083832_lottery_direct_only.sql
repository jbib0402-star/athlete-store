create or replace function private.check_lottery_direct_cart()
returns trigger language plpgsql set search_path=''
as $$
begin
  if exists(select 1 from public.products where id=new.product_id and special_type='lottery') then
    raise exception '일일 복권은 바로 구매만 가능합니다.';
  end if;
  return new;
end $$;
revoke all on function private.check_lottery_direct_cart() from public,anon,authenticated;
create trigger check_lottery_direct_cart before insert or update on public.cart_items
for each row execute function private.check_lottery_direct_cart();

create or replace function private.check_lottery_no_gift()
returns trigger language plpgsql set search_path=''
as $$
begin
  if new.gift_from_user_id is not null and exists(select 1 from public.products where id=new.product_id and special_type='lottery') then
    raise exception '일일 복권은 선물할 수 없습니다. 바로 구매를 이용해주세요.';
  end if;
  return new;
end $$;
revoke all on function private.check_lottery_no_gift() from public,anon,authenticated;
create trigger check_lottery_no_gift before insert on public.inventory
for each row execute function private.check_lottery_no_gift();

-- No points were charged for these cart entries.
delete from public.cart_items c using public.products p where c.product_id=p.id and p.special_type='lottery';

CREATE OR REPLACE FUNCTION public.purchase_cart()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); total integer; item_count integer; locker_count integer; locker_max integer; summary text;
begin
  if uid is null then raise exception '로그인이 필요합니다.'; end if;
  if exists(select 1 from public.cart_items c join public.products p on p.id=c.product_id where c.user_id=uid and p.special_type='lottery') then raise exception '일일 복권은 바로 구매만 가능합니다. 장바구니에서 복권을 빼주세요.'; end if;
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
end $function$
;

notify pgrst,'reload schema';
