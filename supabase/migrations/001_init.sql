create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  character_name text not null,
  sport text,
  avatar_url text,
  points integer not null default 0 check (points >= 0),
  role text not null default 'member' check (role in ('member','admin')),
  locker_limit integer not null default 20 check (locker_limit > 0),
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  price integer not null check (price >= 0),
  image_url text,
  category text not null default '기타',
  stock integer check (stock is null or stock >= 0),
  purchase_limit integer check (purchase_limit is null or purchase_limit > 0),
  is_active boolean not null default true,
  is_consumable boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0 and quantity <= 99),
  created_at timestamptz not null default now(),
  unique(user_id, product_id)
);

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  product_image_url text,
  purchased_at timestamptz not null default now(),
  used_at timestamptz
);

create table public.point_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount <> 0),
  type text not null,
  description text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  attendance_date date not null,
  reward integer not null check (reward >= 0),
  created_at timestamptz not null default now(),
  unique(user_id, attendance_date)
);

create table public.training_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  training_date date not null,
  reward integer not null check (reward >= 0),
  created_at timestamptz not null default now()
);

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete restrict,
  receiver_id uuid not null references public.profiles(id) on delete restrict,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index point_logs_user_created_idx on public.point_logs(user_id, created_at desc);
create index inventory_user_used_idx on public.inventory(user_id, used_at);
create index training_user_date_idx on public.training_logs(user_id, training_date);
create index transfers_sender_idx on public.transfers(sender_id, created_at desc);
create index transfers_receiver_idx on public.transfers(receiver_id, created_at desc);

insert into public.app_settings(key,value) values
  ('site_name','"NATIONAL TRAINING CENTER"'::jsonb),
  ('currency_name','"P"'::jsonb),
  ('welcome_points','1000'::jsonb),
  ('attendance_reward','100'::jsonb),
  ('training_reward','150'::jsonb),
  ('daily_training_limit','3'::jsonb),
  ('locker_limit','20'::jsonb)
on conflict (key) do nothing;

insert into public.products(name,description,price,category,stock,purchase_limit) values
  ('스포츠 드링크','훈련 후 수분 보충을 위한 시원한 이온 음료.',300,'음료',null,null),
  ('프로틴 바','식사 사이에 가볍게 챙기는 고단백 간식.',450,'식품',18,3),
  ('귤 아이스크림','매점 냉동고 맨 아래 칸의 인기 상품.',600,'식품',7,null),
  ('세탁실 우선권','혼잡 시간에도 세탁기 한 대를 우선 사용할 수 있다.',1000,'생활용품',null,1),
  ('야간 외출권','운영진 확인 후 지정된 시간 동안 외출할 수 있다.',3000,'티켓',4,1),
  ('컨디션 회복 키트','테이핑과 쿨링 패치가 들어 있는 응급 회복 세트.',850,'훈련용품',12,2);

create or replace function public.current_is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.cart_items enable row level security;
alter table public.inventory enable row level security;
alter table public.point_logs enable row level security;
alter table public.attendance enable row level security;
alter table public.training_logs enable row level security;
alter table public.transfers enable row level security;
alter table public.app_settings enable row level security;

create policy "authenticated profiles are visible" on public.profiles for select to authenticated using (true);
create policy "authenticated products are visible" on public.products for select to authenticated using (true);
create policy "own cart is visible" on public.cart_items for select to authenticated using (user_id = auth.uid());
create policy "own cart can be added" on public.cart_items for insert to authenticated with check (user_id = auth.uid());
create policy "own cart can be changed" on public.cart_items for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own cart can be removed" on public.cart_items for delete to authenticated using (user_id = auth.uid());
create policy "own inventory is visible" on public.inventory for select to authenticated using (user_id = auth.uid());
create policy "own point logs are visible" on public.point_logs for select to authenticated using (user_id = auth.uid());
create policy "own attendance is visible" on public.attendance for select to authenticated using (user_id = auth.uid());
create policy "own training is visible" on public.training_logs for select to authenticated using (user_id = auth.uid());
create policy "related transfers are visible" on public.transfers for select to authenticated using (sender_id = auth.uid() or receiver_id = auth.uid());
create policy "settings are visible" on public.app_settings for select to authenticated using (true);

create or replace function public.setting_int(setting_key text, fallback integer)
returns integer language sql stable security definer set search_path = public
as $$ select coalesce((select (value #>> '{}')::integer from public.app_settings where key = setting_key), fallback) $$;

create or replace function public.daily_checkin()
returns void language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid(); today date := (now() at time zone 'Asia/Seoul')::date; reward_amount integer := public.setting_int('attendance_reward',100);
begin
  if uid is null then raise exception '로그인이 필요합니다.'; end if;
  insert into public.attendance(user_id,attendance_date,reward) values(uid,today,reward_amount);
  update public.profiles set points = points + reward_amount where id = uid;
  if reward_amount > 0 then insert into public.point_logs(user_id,amount,type,description) values(uid,reward_amount,'attendance','일일 출석'); end if;
exception when unique_violation then raise exception '오늘은 이미 출석했습니다.';
end $$;

create or replace function public.complete_training()
returns void language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid(); today date := (now() at time zone 'Asia/Seoul')::date; reward_amount integer := public.setting_int('training_reward',150); daily_limit integer := public.setting_int('daily_training_limit',3); completed integer;
begin
  if uid is null then raise exception '로그인이 필요합니다.'; end if;
  perform 1 from public.profiles where id = uid for update;
  select count(*) into completed from public.training_logs where user_id = uid and training_date = today;
  if completed >= daily_limit then raise exception '오늘 가능한 훈련을 모두 완료했습니다.'; end if;
  insert into public.training_logs(user_id,training_date,reward) values(uid,today,reward_amount);
  update public.profiles set points = points + reward_amount where id = uid;
  if reward_amount > 0 then insert into public.point_logs(user_id,amount,type,description) values(uid,reward_amount,'training','훈련 완료'); end if;
end $$;

create or replace function public.transfer_points(receiver_id uuid, transfer_amount integer)
returns void language plpgsql security definer set search_path = public
as $$
declare sender uuid := auth.uid(); receiver_name text; sender_name text;
begin
  if sender is null then raise exception '로그인이 필요합니다.'; end if;
  if receiver_id = sender then raise exception '자기 자신에게 양도할 수 없습니다.'; end if;
  if transfer_amount <= 0 then raise exception '양도 포인트를 확인해주세요.'; end if;
  perform 1 from public.profiles where id in (sender,receiver_id) order by id for update;
  select character_name into sender_name from public.profiles where id = sender;
  select character_name into receiver_name from public.profiles where id = receiver_id;
  if receiver_name is null then raise exception '받을 캐릭터를 찾을 수 없습니다.'; end if;
  update public.profiles set points = points - transfer_amount where id = sender and points >= transfer_amount;
  if not found then raise exception '포인트가 부족합니다.'; end if;
  update public.profiles set points = points + transfer_amount where id = receiver_id;
  insert into public.transfers(sender_id,receiver_id,amount) values(sender,receiver_id,transfer_amount);
  insert into public.point_logs(user_id,amount,type,description,actor_id) values
    (sender,-transfer_amount,'transfer_out',receiver_name || '에게 양도',sender),
    (receiver_id,transfer_amount,'transfer_in',sender_name || '에게 받음',sender);
end $$;

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
  insert into public.inventory(user_id,product_id,product_name,product_image_url)
    select uid,p.id,p.name,p.image_url from public.cart_items c join public.products p on p.id=c.product_id cross join lateral generate_series(1,c.quantity) where c.user_id=uid;
  if total > 0 then insert into public.point_logs(user_id,amount,type,description) values(uid,-total,'purchase',summary); end if;
  delete from public.cart_items where user_id=uid;
end $$;

create or replace function public.use_inventory_item(inventory_item_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.inventory set used_at=now() where id=inventory_item_id and user_id=auth.uid() and used_at is null;
  if not found then raise exception '사용할 수 없는 아이템입니다.'; end if;
end $$;

create or replace function public.admin_adjust_points(target_user_id uuid, point_delta integer, log_description text, admin_actor_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if point_delta = 0 then raise exception '조정할 포인트를 입력해주세요.'; end if;
  update public.profiles set points = points + point_delta where id = target_user_id and points + point_delta >= 0;
  if not found then raise exception '대상을 찾을 수 없거나 잔액보다 많이 차감할 수 없습니다.'; end if;
  insert into public.point_logs(user_id,amount,type,description,actor_id) values(target_user_id,point_delta,'admin',coalesce(nullif(log_description,''),'운영진 조정'),admin_actor_id);
end $$;

revoke all on function public.daily_checkin() from public;
revoke all on function public.complete_training() from public;
revoke all on function public.transfer_points(uuid,integer) from public;
revoke all on function public.purchase_cart() from public;
revoke all on function public.use_inventory_item(uuid) from public;
grant execute on function public.daily_checkin() to authenticated;
grant execute on function public.complete_training() to authenticated;
grant execute on function public.transfer_points(uuid,integer) to authenticated;
grant execute on function public.purchase_cart() to authenticated;
grant execute on function public.use_inventory_item(uuid) to authenticated;
revoke all on function public.admin_adjust_points(uuid,integer,text,uuid) from public;
grant execute on function public.admin_adjust_points(uuid,integer,text,uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-images','product-images',true,5242880,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "public product images" on storage.objects for select using (bucket_id='product-images');
create policy "admins upload product images" on storage.objects for insert to authenticated with check (bucket_id='product-images' and public.current_is_admin());
create policy "admins update product images" on storage.objects for update to authenticated using (bucket_id='product-images' and public.current_is_admin());
create policy "admins delete product images" on storage.objects for delete to authenticated using (bucket_id='product-images' and public.current_is_admin());
