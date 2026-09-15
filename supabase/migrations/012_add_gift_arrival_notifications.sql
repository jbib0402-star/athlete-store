alter table public.inventory
  add column if not exists gift_notice_seen_at timestamptz;

update public.inventory
set gift_notice_seen_at = now()
where gift_from_name is not null
  and gift_notice_seen_at is null;

create index if not exists inventory_unseen_gift_idx
  on public.inventory(user_id, purchased_at)
  where gift_from_name is not null and gift_notice_seen_at is null;

create or replace function public.mark_gift_notice_seen(inventory_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inventory
  set gift_notice_seen_at = coalesce(gift_notice_seen_at, now())
  where id = inventory_item_id
    and user_id = auth.uid()
    and gift_from_name is not null;
end;
$$;

revoke all on function public.mark_gift_notice_seen(uuid) from public;
grant execute on function public.mark_gift_notice_seen(uuid) to authenticated;
