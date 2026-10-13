-- Collection identity survives deletion of the original catalog prize.
alter table public.inventory add column gacha_collection_key text;
update public.inventory set gacha_collection_key=coalesce(gacha_prize_id::text,
 'snapshot:'||md5(product_name||'|'||coalesce(product_image_url,'')))
where gacha_prize_id is not null or gacha_description is not null;

create table public.gacha_collection (
 user_id uuid not null references public.profiles(id) on delete cascade,
 prize_key text not null,
 name text not null,
 image_url text,
 description text not null default '',
 received_count integer not null default 1 check(received_count>0),
 first_received_at timestamptz not null default now(),
 last_received_at timestamptz not null default now(),
 primary key(user_id,prize_key)
);
alter table public.gacha_collection enable row level security;
revoke all on public.gacha_collection from anon,authenticated;
grant select on public.gacha_collection to authenticated;
grant all on public.gacha_collection to service_role;
create policy "read own gacha collection" on public.gacha_collection for select to authenticated
using ((select auth.uid())=user_id);

-- Recover existing draws, used items, and items currently held by gift recipients.
with events as (
 select d.user_id,coalesce(d.prize_id::text,i.gacha_collection_key,
   'snapshot:'||md5(coalesce(d.result->>'name','잡동사니')||'|'||coalesce(d.result->>'image_url',''))) as prize_key,
   coalesce(d.result->>'name','잡동사니') as name,d.result->>'image_url' as image_url,
   coalesce(d.result->>'description','') as description,d.created_at as received_at
 from public.gacha_draws d left join public.inventory i on i.id=(d.result->>'inventory_id')::uuid
 union all
 select i.user_id,i.gacha_collection_key,i.product_name,i.product_image_url,coalesce(i.gacha_description,''),i.purchased_at
 from public.inventory i where i.gacha_collection_key is not null
 and not exists(select 1 from public.gacha_draws d where d.user_id=i.user_id and d.result->>'inventory_id'=i.id::text)
), totals as (
 select user_id,prize_key,count(*)::integer as received_count,min(received_at) as first_received_at,max(received_at) as last_received_at
 from events group by user_id,prize_key
), latest as (
 select distinct on(user_id,prize_key) user_id,prize_key,name,image_url,description
 from events order by user_id,prize_key,received_at desc
)
insert into public.gacha_collection(user_id,prize_key,name,image_url,description,received_count,first_received_at,last_received_at)
select t.user_id,t.prize_key,l.name,l.image_url,l.description,t.received_count,t.first_received_at,t.last_received_at
from totals t join latest l using(user_id,prize_key);

create or replace function private.set_gacha_collection_key()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.gacha_collection_key is null and (new.gacha_prize_id is not null or new.gacha_description is not null) then
  new.gacha_collection_key:=coalesce(new.gacha_prize_id::text,
    'snapshot:'||md5(new.product_name||'|'||coalesce(new.product_image_url,'')));
 end if;
 return new;
end $$;
revoke all on function private.set_gacha_collection_key() from public,anon,authenticated;
create trigger set_gacha_collection_key before insert or update of gacha_prize_id,gacha_description
on public.inventory for each row execute function private.set_gacha_collection_key();

create or replace function private.record_gacha_collection()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.gacha_collection_key is null then return new; end if;
 if tg_op='UPDATE' then
  if old.user_id=new.user_id then return new; end if;
 end if;
 insert into public.gacha_collection(user_id,prize_key,name,image_url,description,first_received_at,last_received_at)
 values(new.user_id,new.gacha_collection_key,new.product_name,new.product_image_url,
   coalesce(new.gacha_description,''),now(),now())
 on conflict(user_id,prize_key) do update set
   received_count=public.gacha_collection.received_count+1,
   name=excluded.name,image_url=excluded.image_url,description=excluded.description,last_received_at=excluded.last_received_at;
 return new;
end $$;
revoke all on function private.record_gacha_collection() from public,anon,authenticated;
create trigger record_gacha_collection after insert or update of user_id on public.inventory
for each row execute function private.record_gacha_collection();
