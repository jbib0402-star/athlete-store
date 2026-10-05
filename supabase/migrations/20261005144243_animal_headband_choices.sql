alter table public.products add column if not exists gift_options text[] not null default '{}';
alter table public.inventory add column if not exists gift_choice text;
update public.products set gift_options=array['고양이','강아지','토끼','여우','호랑이','곰']
where name='동물 머리띠';

create or replace function private.check_gift_choice()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.gift_from_user_id is not null
    and exists(select 1 from public.products where id=new.product_id and cardinality(gift_options)>0)
    and (new.gift_choice is null or btrim(new.gift_choice)='' or char_length(new.gift_choice)>30 or new.gift_choice ~ '[[:cntrl:]]') then
    raise exception '선물할 머리띠 종류를 선택해주세요.';
  end if;
  return new;
end $$;
revoke all on function private.check_gift_choice() from public,anon,authenticated;
create trigger check_gift_choice before insert on public.inventory
for each row execute function private.check_gift_choice();

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
  if coalesce(cardinality(product_row.gift_options),0)=0 or product_row.is_gift_box then
    raise exception '종류 선택을 지원하지 않는 상품입니다.';
  end if;
  if cleaned_choice='' or char_length(cleaned_choice)>30 or cleaned_choice ~ '[[:cntrl:]]' then
    raise exception '머리띠 종류를 1~30자로 입력해주세요.';
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
  insert into public.inventory(user_id, product_id, product_name, product_image_url, gift_from_user_id, gift_from_name, effect_text, effect_duration_hours, gift_choice)
  values(recipient_id, product_row.id, product_row.name || ' · ' || cleaned_choice, product_row.image_url, sender_id, sender_name, nullif(product_row.effect_text,''), product_row.effect_duration_hours, cleaned_choice);
  if product_row.price > 0 then
    insert into public.point_logs(user_id, amount, type, description, actor_id)
    values(sender_id, -product_row.price, 'gift', recipient_name || '에게 ' || product_row.name || ' · ' || cleaned_choice || ' 선물', sender_id);
  end if;
end;
$function$;

revoke all on function public.gift_product_choice(uuid,uuid,text) from public,anon;
grant execute on function public.gift_product_choice(uuid,uuid,text) to authenticated;
