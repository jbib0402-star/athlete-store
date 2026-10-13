-- Remove only the daily gacha cap; preserve atomic draws, stock, funds, locker limits and retry protection.
CREATE OR REPLACE FUNCTION public.gacha_daily_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare completed integer;
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
 select count(*) into completed from public.gacha_draws where user_id=auth.uid() and draw_date=(now() at time zone 'Asia/Seoul')::date;
 return jsonb_build_object('count',completed,'limit',null,'remaining',null,'unlimited',true);
end $function$;

CREATE OR REPLACE FUNCTION public.draw_gacha(target_product_id uuid, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); p public.products%rowtype; prize public.gacha_prizes%rowtype;
 locker_count integer; locker_max integer; total_weight bigint; roll numeric; item_id uuid; payload jsonb;
begin
 if uid is null then raise exception '로그인이 필요합니다.'; end if;
 if request_key is null then raise exception '뽑기 요청을 확인해주세요.'; end if;
 select coalesce(locker_limit,20) into locker_max from public.profiles where id=uid for update;
 if not found then raise exception '계정을 찾을 수 없습니다.'; end if;
 select result into payload from public.gacha_draws d where d.user_id=uid and d.request_key=draw_gacha.request_key;
 if found then return payload || public.gacha_daily_status(); end if;
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
end $function$;

revoke all on function public.gacha_daily_status() from public,anon;
grant execute on function public.gacha_daily_status() to authenticated;
revoke all on function public.draw_gacha(uuid,uuid) from public,anon;
grant execute on function public.draw_gacha(uuid,uuid) to authenticated;
