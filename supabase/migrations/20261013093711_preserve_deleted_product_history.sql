-- Keep lottery history when a shop product is removed.
alter table public.lottery_plays drop constraint lottery_plays_product_id_fkey;
alter table public.lottery_plays alter column product_id drop not null;
alter table public.lottery_plays add constraint lottery_plays_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;

-- Inventory snapshots remain identifiable and giftable after prize deletion.
create or replace function public.gift_gacha_item(inventory_item_id uuid,recipient_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare uid uuid:=auth.uid(); item public.inventory%rowtype; sender text; recipient_limit integer; count_items integer;
begin
 if uid is null then raise exception '로그인이 필요합니다.'; end if;
 if recipient_id is null or recipient_id=uid then raise exception '다른 캐릭터를 선택해주세요.'; end if;
 perform 1 from public.profiles where id in(uid,recipient_id) order by id for update;
 select character_name into sender from public.profiles where id=uid;
 if not found then raise exception '보내는 계정을 찾을 수 없습니다.'; end if;
 select locker_limit into recipient_limit from public.profiles where id=recipient_id;
 if not found then raise exception '받는 계정을 찾을 수 없습니다.'; end if;
 select * into item from public.inventory where id=inventory_item_id and user_id=uid and used_at is null for update;
 if not found or item.gacha_description is null then raise exception '선물할 수 있는 뽑기 아이템이 아닙니다.'; end if;
 select count(*) into count_items from public.inventory where user_id=recipient_id and used_at is null;
 if count_items>=recipient_limit then raise exception '상대방의 보관함 공간이 부족합니다.'; end if;
 update public.inventory set user_id=recipient_id,gift_from_user_id=uid,gift_from_name=sender,gift_notice_seen_at=null
 where id=item.id;
end $$;
revoke all on function public.gift_gacha_item(uuid,uuid) from public,anon;
grant execute on function public.gift_gacha_item(uuid,uuid) to authenticated;

