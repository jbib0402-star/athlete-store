alter table public.products add column if not exists is_gift_box boolean not null default false;
alter table public.inventory add column if not exists gift_image_path text;
-- Configure the existing costume box once; subsequent renames retain this setting.
update public.products set is_gift_box=true, is_consumable=true, effect_text='', effect_duration_hours=null
where name='코스튬 선물상자';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('costume-gifts','costume-gifts',false,10485760,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict(id) do nothing;

create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.can_view_costume_image(object_path text)
returns boolean language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.inventory where gift_image_path=object_path
    and user_id=auth.uid() and used_at is not null
  )
$$;
revoke all on function private.can_view_costume_image(text) from public,anon;
grant execute on function private.can_view_costume_image(text) to authenticated;
create policy "upload own costume gift" on storage.objects for insert to authenticated
with check (bucket_id='costume-gifts' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "read costume gift" on storage.objects for select to authenticated
using (bucket_id='costume-gifts' and (owner_id=auth.uid()::text or private.can_view_costume_image(name)));
create or replace function private.can_delete_costume_image(object_path text)
returns boolean language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null and split_part(object_path,'/',1)=auth.uid()::text
  and not exists(select 1 from public.inventory where gift_image_path=object_path)
$$;
revoke all on function private.can_delete_costume_image(text) from public,anon;
grant execute on function private.can_delete_costume_image(text) to authenticated;
create policy "cleanup unsent costume gift" on storage.objects for delete to authenticated
using(bucket_id='costume-gifts' and owner_id=auth.uid()::text and private.can_delete_costume_image(name));

create or replace function private.check_costume_inventory()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if exists(select 1 from public.products where id=new.product_id and is_gift_box) then
    if new.gift_from_user_id is null or new.gift_image_path is null then
      raise exception '코스튬 선물상자는 이미지를 첨부해 선물하기로만 보낼 수 있습니다.';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.check_costume_inventory() from public,anon,authenticated;
create trigger check_costume_inventory before insert on public.inventory
for each row execute function private.check_costume_inventory();

create or replace function private.check_costume_cart()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if exists(select 1 from public.products where id=new.product_id and is_gift_box) then
    raise exception '코스튬 선물상자는 선물 전용 상품입니다.';
  end if;
  return new;
end $$;
revoke all on function private.check_costume_cart() from public,anon,authenticated;
create trigger check_costume_cart before insert or update on public.cart_items
for each row execute function private.check_costume_cart();

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
  insert into public.inventory(user_id, product_id, product_name, product_image_url, gift_from_user_id, gift_from_name, effect_text, effect_duration_hours, gift_image_path)
  values(recipient_id, product_row.id, product_row.name, product_row.image_url, sender_id, sender_name, null, null, image_path);
  if product_row.price > 0 then
    insert into public.point_logs(user_id, amount, type, description, actor_id)
    values(sender_id, -product_row.price, 'gift', recipient_name || '에게 ' || product_row.name || ' 선물', sender_id);
  end if;
end;
$function$;

revoke all on function public.gift_costume_box(uuid,uuid,text) from public,anon;
grant execute on function public.gift_costume_box(uuid,uuid,text) to authenticated;

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
  return jsonb_build_object('path',item.gift_image_path,'name',item.product_name,'from',item.gift_from_name);
end $$;
revoke all on function public.open_costume_gift(uuid) from public,anon;
grant execute on function public.open_costume_gift(uuid) to authenticated;
