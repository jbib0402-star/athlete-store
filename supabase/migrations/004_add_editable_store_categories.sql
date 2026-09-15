create table if not exists public.store_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 30),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists store_categories_sort_idx on public.store_categories(sort_order, created_at);

alter table public.store_categories enable row level security;

drop policy if exists "categories are visible" on public.store_categories;
create policy "categories are visible" on public.store_categories for select to authenticated using (true);

insert into public.store_categories(name, sort_order) values
  ('식품', 10),
  ('음료', 20),
  ('훈련용품', 30),
  ('생활용품', 40),
  ('티켓', 50),
  ('기타', 60)
on conflict (name) do nothing;

with missing as (
  select distinct trim(p.category) as name
  from public.products p
  where trim(coalesce(p.category, '')) <> ''
    and not exists (
      select 1 from public.store_categories c where c.name = trim(p.category)
    )
), numbered as (
  select name, row_number() over(order by name) as rn from missing
), base as (
  select coalesce(max(sort_order), 0) as max_order from public.store_categories
)
insert into public.store_categories(name, sort_order)
select numbered.name, base.max_order + numbered.rn * 10
from numbered cross join base
on conflict (name) do nothing;
