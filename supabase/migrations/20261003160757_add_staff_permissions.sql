-- Staff can operate the store; only the server's admin-only action changes roles.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('member', 'staff', 'admin'));

-- Keep privileged lookups outside the exposed public schema.
create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.current_is_store_operator()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'staff')
  );
$$;
revoke all on function private.current_is_store_operator() from public, anon;
grant execute on function private.current_is_store_operator() to authenticated;

alter policy "admins upload product images" on storage.objects
  with check (bucket_id = 'product-images' and private.current_is_store_operator());
alter policy "admins update product images" on storage.objects
  using (bucket_id = 'product-images' and private.current_is_store_operator())
  with check (bucket_id = 'product-images' and private.current_is_store_operator());
alter policy "admins delete product images" on storage.objects
  using (bucket_id = 'product-images' and private.current_is_store_operator());

-- Point adjustments must pass the API's operator check.
revoke all on function public.admin_adjust_points(uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_adjust_points(uuid, integer, text, uuid) to service_role;
