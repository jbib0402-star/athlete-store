-- Remove capacity checks instead of substituting a larger finite limit.
CREATE OR REPLACE FUNCTION public.purchase_product(target_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  product_row public.products%rowtype;
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
$function$;

CREATE OR REPLACE FUNCTION public.gift_product(target_product_id uuid, recipient_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sender_id uuid := auth.uid();
  sender_name text;
  recipient_name text;
  recipient_owned_count integer;
  product_row public.products%rowtype;
begin
  if sender_id is null then raise exception '로그인이 필요합니다.'; end if;
  if recipient_id is null then raise exception '선물 받을 캐릭터를 선택해주세요.'; end if;
  if sender_id = recipient_id then raise exception '자기 자신에게는 선물할 수 없습니다.'; end if;
  perform 1 from public.profiles where id in (sender_id, recipient_id) order by id for update;
  select character_name into sender_name from public.profiles where id = sender_id;
  select character_name into recipient_name from public.profiles where id = recipient_id;
  if sender_name is null then raise exception '보내는 사용자 정보를 찾을 수 없습니다.'; end if;
  if recipient_name is null then raise exception '선물 받을 캐릭터를 찾을 수 없습니다.'; end if;
  select * into product_row from public.products where id = target_product_id for update;
  if not found then raise exception '상품을 찾을 수 없습니다.'; end if;
  if not product_row.is_active then raise exception '현재 판매 중인 상품이 아닙니다.'; end if;
  if product_row.stock is not null and product_row.stock < 1 then raise exception '품절된 상품입니다.'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.purchase_cart()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := auth.uid(); total integer; item_count integer; summary text;
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
  update public.profiles set points=points-total where id=uid and points>=total;
  if not found then raise exception '포인트가 부족합니다.'; end if;
  update public.products p set stock=p.stock-q.qty from (select product_id,sum(quantity)::integer qty from public.cart_items where user_id=uid group by product_id) q where p.id=q.product_id and p.stock is not null;
  insert into public.inventory(user_id,product_id,product_name,product_image_url,effect_text,effect_duration_hours)
    select uid,p.id,p.name,p.image_url,nullif(p.effect_text,''),p.effect_duration_hours
    from public.cart_items c join public.products p on p.id=c.product_id
    cross join lateral generate_series(1,c.quantity) where c.user_id=uid;
  if total > 0 then insert into public.point_logs(user_id,amount,type,description) values(uid,-total,'purchase',summary); end if;
  delete from public.cart_items where user_id=uid;
end $function$;

CREATE OR REPLACE FUNCTION public.gift_costume_box(target_product_id uuid, recipient_id uuid, image_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sender_id uuid := auth.uid();
  sender_name text;
  recipient_name text;
  recipient_owned_count integer;
  product_row public.products%rowtype;
begin
  if sender_id is null then raise exception '로그인이 필요합니다.'; end if;
  if recipient_id is null then raise exception '선물 받을 캐릭터를 선택해주세요.'; end if;
  if sender_id = recipient_id then raise exception '자기 자신에게는 선물할 수 없습니다.'; end if;
  perform 1 from public.profiles where id in (sender_id, recipient_id) order by id for update;
  select character_name into sender_name from public.profiles where id = sender_id;
  select character_name into recipient_name from public.profiles where id = recipient_id;
  if sender_name is null then raise exception '보내는 사용자 정보를 찾을 수 없습니다.'; end if;
  if recipient_name is null then raise exception '선물 받을 캐릭터를 찾을 수 없습니다.'; end if;
  select * into product_row from public.products where id = target_product_id for update;
  if not found then raise exception '상품을 찾을 수 없습니다.'; end if;
  if not product_row.is_gift_box then raise exception '이미지 첨부 선물상자가 아닙니다.'; end if;
  if image_path is null or split_part(image_path, '/', 1) <> sender_id::text then
    raise exception '선물 이미지를 첨부해주세요.';
  end if;
  if not exists (select 1 from storage.objects where bucket_id='costume-gifts' and name=image_path
    and owner_id=sender_id::text and metadata->>'mimetype' in ('image/png','image/jpeg','image/webp','image/gif')) then
    raise exception '업로드한 선물 이미지를 확인해주세요.';
  end if;
  if not product_row.is_active then raise exception '현재 판매 중인 상품이 아닙니다.'; end if;
  if product_row.stock is not null and product_row.stock < 1 then raise exception '품절된 상품입니다.'; end if;
  select count(*) into recipient_owned_count from public.inventory where user_id = recipient_id and product_id = target_product_id;
  if product_row.purchase_limit is not null and recipient_owned_count + 1 > product_row.purchase_limit then raise exception '상대방이 이 상품의 개인 구매 제한에 도달했습니다.'; end if;
  update public.profiles set points = points - product_row.price where id = sender_id and points >= product_row.price;
  if not found then raise exception '포인트가 부족합니다.'; end if;
  if product_row.stock is not null then update public.products set stock = stock - 1 where id = product_row.id; end if;
  insert into public.inventory(user_id, product_id, product_name, product_image_url, gift_from_user_id, gift_from_name, effect_text, effect_duration_hours, gift_image_path)
  values(recipient_id, product_row.id, product_row.name, product_row.image_url, sender_id, sender_name, null, null, image_path);
  if product_row.price > 0 then
    insert into public.point_logs(user_id, amount, type, description, actor_id)
    values(sender_id, -product_row.price, 'gift', recipient_name || '에게 ' || product_row.name || ' 선물', sender_id);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.gift_product_choice(target_product_id uuid, recipient_id uuid, gift_choice text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cleaned_choice text := btrim(coalesce(gift_choice,''));
  sender_id uuid := auth.uid();
  sender_name text;
  recipient_name text;
  recipient_owned_count integer;
  product_row public.products%rowtype;
begin
  if sender_id is null then raise exception '로그인이 필요합니다.'; end if;
  if recipient_id is null then raise exception '선물 받을 캐릭터를 선택해주세요.'; end if;
  if sender_id = recipient_id then raise exception '자기 자신에게는 선물할 수 없습니다.'; end if;
  perform 1 from public.profiles where id in (sender_id, recipient_id) order by id for update;
  select character_name into sender_name from public.profiles where id = sender_id;
  select character_name into recipient_name from public.profiles where id = recipient_id;
  if sender_name is null then raise exception '보내는 사용자 정보를 찾을 수 없습니다.'; end if;
  if recipient_name is null then raise exception '선물 받을 캐릭터를 찾을 수 없습니다.'; end if;
  select * into product_row from public.products where id = target_product_id for update;
  if not found then raise exception '상품을 찾을 수 없습니다.'; end if;
  if coalesce(cardinality(product_row.gift_options),0)=0 or product_row.is_gift_box then
    raise exception '종류 선택을 지원하지 않는 상품입니다.';
  end if;
  if cleaned_choice='' or char_length(cleaned_choice)>30 or cleaned_choice ~ '[[:cntrl:]]' then
    raise exception '머리띠 종류를 1~30자로 입력해주세요.';
  end if;
  if not product_row.is_active then raise exception '현재 판매 중인 상품이 아닙니다.'; end if;
  if product_row.stock is not null and product_row.stock < 1 then raise exception '품절된 상품입니다.'; end if;
  select count(*) into recipient_owned_count from public.inventory where user_id = recipient_id and product_id = target_product_id;
  if product_row.purchase_limit is not null and recipient_owned_count + 1 > product_row.purchase_limit then raise exception '상대방이 이 상품의 개인 구매 제한에 도달했습니다.'; end if;
  update public.profiles set points = points - product_row.price where id = sender_id and points >= product_row.price;
  if not found then raise exception '포인트가 부족합니다.'; end if;
  if product_row.stock is not null then update public.products set stock = stock - 1 where id = product_row.id; end if;
  insert into public.inventory(user_id, product_id, product_name, product_image_url, gift_from_user_id, gift_from_name, effect_text, effect_duration_hours, gift_choice)
  values(recipient_id, product_row.id, product_row.name || ' · ' || cleaned_choice, product_row.image_url, sender_id, sender_name, nullif(product_row.effect_text,''), product_row.effect_duration_hours, cleaned_choice);
  if product_row.price > 0 then
    insert into public.point_logs(user_id, amount, type, description, actor_id)
    values(sender_id, -product_row.price, 'gift', recipient_name || '에게 ' || product_row.name || ' · ' || cleaned_choice || ' 선물', sender_id);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.gift_costume_box_letter(target_product_id uuid, recipient_id uuid, image_path text, letter_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sender_id uuid := auth.uid();
  sender_name text;
  recipient_name text;
  recipient_owned_count integer;
  product_row public.products%rowtype;
begin
  if sender_id is null then raise exception '로그인이 필요합니다.'; end if;
  if char_length(coalesce(letter_text,'')) > 2000 then raise exception '편지는 2,000자 이하로 작성해주세요.'; end if;
  if recipient_id is null then raise exception '선물 받을 캐릭터를 선택해주세요.'; end if;
  if sender_id = recipient_id then raise exception '자기 자신에게는 선물할 수 없습니다.'; end if;
  perform 1 from public.profiles where id in (sender_id, recipient_id) order by id for update;
  select character_name into sender_name from public.profiles where id = sender_id;
  select character_name into recipient_name from public.profiles where id = recipient_id;
  if sender_name is null then raise exception '보내는 사용자 정보를 찾을 수 없습니다.'; end if;
  if recipient_name is null then raise exception '선물 받을 캐릭터를 찾을 수 없습니다.'; end if;
  select * into product_row from public.products where id = target_product_id for update;
  if not found then raise exception '상품을 찾을 수 없습니다.'; end if;
  if not product_row.is_gift_box then raise exception '이미지 첨부 선물상자가 아닙니다.'; end if;
  if image_path is null or split_part(image_path, '/', 1) <> sender_id::text then
    raise exception '선물 이미지를 첨부해주세요.';
  end if;
  if not exists (select 1 from storage.objects where bucket_id='costume-gifts' and name=image_path
    and owner_id=sender_id::text and metadata->>'mimetype' in ('image/png','image/jpeg','image/webp','image/gif')) then
    raise exception '업로드한 선물 이미지를 확인해주세요.';
  end if;
  if not product_row.is_active then raise exception '현재 판매 중인 상품이 아닙니다.'; end if;
  if product_row.stock is not null and product_row.stock < 1 then raise exception '품절된 상품입니다.'; end if;
  select count(*) into recipient_owned_count from public.inventory where user_id = recipient_id and product_id = target_product_id;
  if product_row.purchase_limit is not null and recipient_owned_count + 1 > product_row.purchase_limit then raise exception '상대방이 이 상품의 개인 구매 제한에 도달했습니다.'; end if;
  update public.profiles set points = points - product_row.price where id = sender_id and points >= product_row.price;
  if not found then raise exception '포인트가 부족합니다.'; end if;
  if product_row.stock is not null then update public.products set stock = stock - 1 where id = product_row.id; end if;
  insert into public.inventory(user_id, product_id, product_name, product_image_url, gift_from_user_id, gift_from_name, effect_text, effect_duration_hours, gift_image_path, gift_letter)
  values(recipient_id, product_row.id, product_row.name, product_row.image_url, sender_id, sender_name, null, null, image_path, nullif(btrim(letter_text),''));
  if product_row.price > 0 then
    insert into public.point_logs(user_id, amount, type, description, actor_id)
    values(sender_id, -product_row.price, 'gift', recipient_name || '에게 ' || product_row.name || ' 선물', sender_id);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.draw_gacha(target_product_id uuid, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); p public.products%rowtype; prize public.gacha_prizes%rowtype;
 total_weight bigint; roll numeric; item_id uuid; payload jsonb;
begin
 if uid is null then raise exception '로그인이 필요합니다.'; end if;
 if request_key is null then raise exception '뽑기 요청을 확인해주세요.'; end if;
 perform 1 from public.profiles where id=uid for update;
 if not found then raise exception '계정을 찾을 수 없습니다.'; end if;
 select result into payload from public.gacha_draws d where d.user_id=uid and d.request_key=draw_gacha.request_key;
 if found then return payload || public.gacha_daily_status(); end if;
 select * into p from public.products where id=target_product_id for update;
 if not found or not p.is_gacha or not p.is_active then raise exception '현재 이용할 수 없는 뽑기입니다.'; end if;
 if p.stock is not null and p.stock<1 then raise exception '뽑기가 품절되었어요.'; end if;
 perform 1 from public.gacha_prizes where is_active order by id for share;
 select sum(weight) into total_weight from public.gacha_prizes where is_active;
 if total_weight is null or total_weight<1 then raise exception '뽑기 결과물이 아직 준비되지 않았어요.'; end if;
 roll:=random()*total_weight;
 select gp.* into prize from public.gacha_prizes gp join (
  select id,sum(weight) over(order by id) as cumulative from public.gacha_prizes where is_active
 ) pool on pool.id=gp.id where cumulative>roll order by cumulative limit 1;
 update public.profiles set points=points-p.price where id=uid and points>=p.price;
 if not found then raise exception '포인트가 부족합니다.'; end if;
 if p.stock is not null then update public.products set stock=stock-1 where id=p.id; end if;
 insert into public.inventory(user_id,product_id,product_name,product_image_url,gacha_prize_id,gacha_description)
 values(uid,null,prize.name,prize.image_url,prize.id,prize.description) returning id into item_id;
 if p.price>0 then insert into public.point_logs(user_id,amount,type,description) values(uid,-p.price,'purchase','잡동사니 뽑기 · '||prize.name); end if;
 payload:=jsonb_build_object('inventory_id',item_id,'name',prize.name,'description',prize.description,'image_url',prize.image_url);
 insert into public.gacha_draws(user_id,product_id,prize_id,request_key,result) values(uid,p.id,prize.id,request_key,payload);
 return payload || public.gacha_daily_status();
end $function$;

CREATE OR REPLACE FUNCTION public.gift_gacha_item(inventory_item_id uuid, recipient_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); item public.inventory%rowtype; sender text; begin
 if uid is null then raise exception '로그인이 필요합니다.'; end if;
 if recipient_id is null or recipient_id=uid then raise exception '다른 캐릭터를 선택해주세요.'; end if;
 perform 1 from public.profiles where id in(uid,recipient_id) order by id for update;
 select character_name into sender from public.profiles where id=uid;
 if not found then raise exception '보내는 계정을 찾을 수 없습니다.'; end if;
 perform 1 from public.profiles where id=recipient_id;
 if not found then raise exception '받는 계정을 찾을 수 없습니다.'; end if;
 select * into item from public.inventory where id=inventory_item_id and user_id=uid and used_at is null for update;
 if not found or item.gacha_description is null then raise exception '선물할 수 있는 뽑기 아이템이 아닙니다.'; end if;
 update public.inventory set user_id=recipient_id,gift_from_user_id=uid,gift_from_name=sender,gift_notice_seen_at=null
 where id=item.id;
end $function$;
