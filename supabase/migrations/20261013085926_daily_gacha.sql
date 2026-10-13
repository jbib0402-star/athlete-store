alter table public.products add column is_gacha boolean not null default false;
create table public.gacha_prizes(
 id uuid primary key default gen_random_uuid(), slug text not null unique,
 name text not null check(char_length(name) between 1 and 80),
 description text not null check(char_length(description)<=1000),
 image_url text not null, weight integer not null default 1 check(weight between 1 and 1000000),
 is_active boolean not null default true, created_at timestamptz not null default now()
);
alter table public.gacha_prizes enable row level security;
revoke all on public.gacha_prizes from anon,authenticated;
grant select on public.gacha_prizes to authenticated;
create policy gacha_visible_prizes on public.gacha_prizes for select to authenticated using(is_active);
alter table public.inventory add column gacha_prize_id uuid references public.gacha_prizes(id) on delete set null;
alter table public.inventory add column gacha_description text;

create table public.gacha_draws(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 product_id uuid references public.products(id) on delete set null,
 prize_id uuid references public.gacha_prizes(id) on delete set null,
 request_key uuid not null, result jsonb not null,
 draw_date date not null default (now() at time zone 'Asia/Seoul')::date,
 created_at timestamptz not null default now(), unique(user_id,request_key)
);
create index gacha_draws_daily on public.gacha_draws(user_id,draw_date);
alter table public.gacha_draws enable row level security;
revoke all on public.gacha_draws from anon,authenticated;
grant select on public.gacha_draws to authenticated;
create policy own_gacha_draws on public.gacha_draws for select to authenticated using(user_id=(select auth.uid()));

create or replace function public.gacha_daily_status()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare completed integer;
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
 select count(*) into completed from public.gacha_draws where user_id=auth.uid() and draw_date=(now() at time zone 'Asia/Seoul')::date;
 return jsonb_build_object('count',completed,'limit',5,'remaining',greatest(0,5-completed));
end $$;
revoke all on function public.gacha_daily_status() from public,anon;
grant execute on function public.gacha_daily_status() to authenticated;

create or replace function public.draw_gacha(target_product_id uuid,request_key uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare uid uuid:=auth.uid(); p public.products%rowtype; prize public.gacha_prizes%rowtype;
 completed integer; locker_count integer; locker_max integer; total_weight bigint; roll numeric; item_id uuid; payload jsonb;
begin
 if uid is null then raise exception '로그인이 필요합니다.'; end if;
 if request_key is null then raise exception '뽑기 요청을 확인해주세요.'; end if;
 select coalesce(locker_limit,20) into locker_max from public.profiles where id=uid for update;
 if not found then raise exception '계정을 찾을 수 없습니다.'; end if;
 select result into payload from public.gacha_draws d where d.user_id=uid and d.request_key=draw_gacha.request_key;
 if found then return payload || public.gacha_daily_status(); end if;
 select count(*) into completed from public.gacha_draws where user_id=uid and draw_date=(now() at time zone 'Asia/Seoul')::date;
 if completed>=5 then raise exception '오늘 뽑기 5회를 모두 사용했어요. 내일 다시 만나요!'; end if;
 select * into p from public.products where id=target_product_id for update;
 if not found or not p.is_gacha or not p.is_active then raise exception '현재 이용할 수 없는 뽑기입니다.'; end if;
 if p.stock is not null and p.stock<1 then raise exception '뽑기가 품절되었어요.'; end if;
 select count(*) into locker_count from public.inventory where user_id=uid and used_at is null;
 if locker_count>=locker_max then raise exception '보관함 공간이 부족해요. 아이템을 사용하거나 선물한 뒤 다시 뽑아주세요.'; end if;
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
end $$;
revoke all on function public.draw_gacha(uuid,uuid) from public,anon;
grant execute on function public.draw_gacha(uuid,uuid) to authenticated;

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
 if not found or item.gacha_prize_id is null then raise exception '선물할 수 있는 뽑기 아이템이 아닙니다.'; end if;
 select count(*) into count_items from public.inventory where user_id=recipient_id and used_at is null;
 if count_items>=recipient_limit then raise exception '상대방의 보관함 공간이 부족합니다.'; end if;
 update public.inventory set user_id=recipient_id,gift_from_user_id=uid,gift_from_name=sender,gift_notice_seen_at=null
 where id=item.id;
end $$;
revoke all on function public.gift_gacha_item(uuid,uuid) from public,anon;
grant execute on function public.gift_gacha_item(uuid,uuid) to authenticated;

create or replace function private.check_gacha_cart()
returns trigger language plpgsql set search_path=''
as $$
begin
 if exists(select 1 from public.products where id=new.product_id and is_gacha) then raise exception '뽑기는 바로 구매만 가능합니다.'; end if;
 return new;
end $$;
revoke all on function private.check_gacha_cart() from public,anon,authenticated;
create trigger check_gacha_cart before insert or update on public.cart_items for each row execute function private.check_gacha_cart();
create or replace function private.check_gacha_purchase()
returns trigger language plpgsql set search_path=''
as $$
begin
 if exists(select 1 from public.products where id=new.product_id and is_gacha) then raise exception '뽑기는 전용 뽑기 버튼을 이용해주세요.'; end if;
 return new;
end $$;
revoke all on function private.check_gacha_purchase() from public,anon,authenticated;
create trigger check_gacha_purchase before insert on public.inventory for each row execute function private.check_gacha_purchase();

insert into public.store_categories(name,sort_order)
select '랜덤 뽑기',coalesce(max(sort_order),0)+1 from public.store_categories
on conflict(name) do nothing;
insert into public.products(name,description,price,image_url,category,is_consumable,is_gacha)
values('수상한 잡동사니 뽑기','먹을거리부터 정체불명의 잡동사니까지! 무엇이 나올지 모르는 귀여운 도트 뽑기. 1인 하루 5회 · 한국시간 자정 초기화 · 중복 당첨 가능.',100,'/gacha/chosen-duck.png','랜덤 뽑기',false,true);

insert into public.gacha_prizes(slug,name,description,image_url,weight) values
('sports-drink','미지근한 이온음료','분명 냉장고에서 나왔는데 이상하게 미지근하다. 갈증은 일단 해결해준다.','/gacha/sports-drink.png',1),
('fish-bread','마지막 한 입 남은 붕어빵','누가 먼저 먹었는지는 묻지 말자. 마지막 한 입이 제일 맛있다는 말도 있으니까.','/gacha/fish-bread.png',1),
('giant-orange','초대형 귤','두 손으로 들어야 하는 귤. 하나만 까도 옆방 선수까지 나눠 먹을 수 있을 것 같다.','/gacha/giant-orange.png',1),
('single-sock','한쪽만 있는 양말','짝을 찾고 있다. 당신의 인연보다 이 양말의 반쪽이 먼저 나타날지도 모른다.','/gacha/single-sock.png',1),
('slippers','호텔 슬리퍼','어느 호텔에서 왔는지는 비밀. 잠깐 신는 순간만큼은 호캉스 기분이다.','/gacha/slippers.png',1),
('tiny-fan','손바닥만 한 선풍기','작지만 제법 당당하게 바람을 보낸다. 코끝 정도는 시원해질 수 있다.','/gacha/tiny-fan.png',1),
('nameless-towel','이름이 지워진 수건','이름표가 깨끗하게 비어 있다. 오늘부터 당신 이름을 적어도 될 것 같다.','/gacha/nameless-towel.png',1),
('chocolate-medal','금메달 모양 초콜릿','메달을 깨물어도 혼나지 않는 드문 기회. 금보다 달콤하다.','/gacha/chocolate-medal.png',1),
('training-notebook','누군가의 운동일지','첫 장부터 마지막 장까지 “내일부터 진짜 한다”라고 적혀 있다. 필체에는 의지가 넘친다.','/gacha/training-notebook.png',1),
('rubber-chicken','비명을 지르는 고무닭','한 번 누르면 당신 대신 소리를 질러준다. 야간에는 사용을 자제하자.','/gacha/rubber-chicken.png',1),
('staring-pebble','눈빛이 부담스러운 돌멩이','분명 돌멩이인데 자꾸 당신을 쳐다보는 것 같다. 눈싸움에서는 한 번도 진 적이 없다.','/gacha/staring-pebble.png',1),
('mystery-key','정체불명의 열쇠','무언가를 열 수 있을 것 같다. 문제는 그 무언가를 아무도 모른다는 것이다.','/gacha/mystery-key.png',1),
('plastic-crown','순금처럼 보이는 플라스틱 왕관','멀리서 보면 왕족, 가까이서 보면 문구점. 착용자의 자신감만큼은 진짜다.','/gacha/plastic-crown.png',1),
('space-plan','우주 정복 계획서','첫 단계는 “일단 밥을 먹는다”. 그 뒤의 계획은 매우 장대하지만 구체적이지 않다.','/gacha/space-plan.png',1),
('shop-certificate','명예 매점장 임명장','그럴듯한 직함이 생겼다. 실제 운영 권한이나 할인 혜택은 전혀 없다.','/gacha/shop-certificate.png',1),
('chosen-duck','당신을 선택한 오리 인형','많은 사람 중에서 굳이 당신을 골랐다고 한다. 이유를 물으면 꽥, 하고 답한다.','/gacha/chosen-duck.png',1),
('lucky-cap','평생의 행운을 담았다는 병뚜껑','작은 병뚜껑에 큰 기대를 담았다. 행운의 실제 효과는 확인되지 않았다.','/gacha/lucky-cap.png',1),
('folded-receipt','잘 접힌 영수증','누군가 아주 정성스럽게 접어 놓았다. 펼쳐 봐도 특별한 비밀은 없다.','/gacha/folded-receipt.png',1);
notify pgrst,'reload schema';
