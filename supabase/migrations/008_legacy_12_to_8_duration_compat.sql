create or replace function public.normalize_legacy_timed_duration()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.effect_duration_hours = 12 then
    new.effect_duration_hours := 8;
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_legacy_timed_duration_trigger on public.products;
create trigger normalize_legacy_timed_duration_trigger
before insert or update of effect_duration_hours on public.products
for each row execute function public.normalize_legacy_timed_duration();
