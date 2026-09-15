do $$
declare
  lottery_id uuid;
begin
  select id into lottery_id
  from public.products
  where name = '일일복권'
  order by created_at desc
  limit 1;

  if lottery_id is null then
    insert into public.products(
      name, description, price, image_url, category, stock, purchase_limit,
      is_active, is_consumable, effect_text, effect_duration_hours,
      special_type, lottery_daily_limit, lottery_prizes
    ) values (
      '일일복권',
      '하루에 최대 3회 이용할 수 있는 스크래치 복권.',
      100,
      null,
      '티켓',
      null,
      null,
      true,
      true,
      '',
      null,
      'lottery',
      3,
      '[{"label":"꽝","points":0,"chance":50},{"label":"100P 당첨!","points":100,"chance":30},{"label":"300P 당첨!","points":300,"chance":15},{"label":"500P 당첨!","points":500,"chance":4},{"label":"1000P 당첨!","points":1000,"chance":1}]'::jsonb
    ) returning id into lottery_id;
  else
    update public.products
    set special_type = 'lottery',
        lottery_daily_limit = 3,
        effect_text = '',
        effect_duration_hours = null
    where id = lottery_id;
  end if;

  update public.inventory i
  set product_id = lottery_id,
      used_at = null,
      effect_expires_at = null
  where i.product_name = '일일복권'
    and i.product_id is null
    and not exists (
      select 1 from public.lottery_plays lp where lp.inventory_id = i.id
    );
end $$;
