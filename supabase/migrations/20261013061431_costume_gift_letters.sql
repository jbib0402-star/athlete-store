alter table public.inventory add column gift_letter text
  constraint inventory_gift_letter_length check (char_length(gift_letter) <= 2000);

-- New RPC keeps older clients' image-only gift endpoint compatible.
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
  recipient_locker_limit integer;
  recipient_locker_count integer;
  recipient_owned_count integer;
  product_row public.products%rowtype;
begin
  if sender_id is null then raise exception '로그인이 필요합니다.'; end if;
  if char_length(coalesce(letter_text,'')) > 2000 then raise exception '편지는 2,000자 이하로 작성해주세요.'; end if;
  if recipient_id is null then raise exception '선물 받을 캐릭터를 선택해주세요.'; end if;
  if sender_id = recipient_id then raise exception '자기 자신에게는 선물할 수 없습니다.'; end if;
  perform 1 from public.profiles where id in (sender_id, recipient_id) order by id for update;
  select character_name into sender_name from public.profiles where id = sender_id;
  select character_name, coalesce(locker_limit, public.setting_int('locker_limit', 20)) into recipient_name, recipient_locker_limit from public.profiles where id = recipient_id;
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
  select count(*) into recipient_locker_count from public.inventory where user_id = recipient_id and used_at is null;
  if recipient_locker_count + 1 > recipient_locker_limit then raise exception '상대방의 보관함 공간이 부족합니다.'; end if;
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

revoke all on function public.gift_costume_box_letter(uuid,uuid,text,text) from public,anon;
grant execute on function public.gift_costume_box_letter(uuid,uuid,text,text) to authenticated;

create or replace function public.open_costume_gift(inventory_item_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare item public.inventory%rowtype;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  select * into item from public.inventory where id=inventory_item_id and user_id=auth.uid() for update;
  if not found or item.gift_image_path is null then raise exception '선물상자를 찾을 수 없습니다.'; end if;
  if item.used_at is null then
    update public.inventory set used_at=now() where id=item.id;
  end if;
  return jsonb_build_object('path',item.gift_image_path,'name',item.product_name,'from',item.gift_from_name,'letter',item.gift_letter);
end $$;
revoke all on function public.open_costume_gift(uuid) from public,anon;
grant execute on function public.open_costume_gift(uuid) to authenticated;

notify pgrst, 'reload schema';
