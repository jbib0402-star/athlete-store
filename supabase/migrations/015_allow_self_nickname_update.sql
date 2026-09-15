create or replace function public.update_my_character_name(new_character_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cleaned text := regexp_replace(btrim(coalesce(new_character_name, '')), '\s+', ' ', 'g');
begin
  if uid is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if cleaned = '' then
    raise exception '닉네임을 입력해주세요.';
  end if;

  if char_length(cleaned) > 30 then
    raise exception '닉네임은 30자 이하로 입력해주세요.';
  end if;

  update public.profiles
  set character_name = cleaned
  where id = uid;

  if not found then
    raise exception '프로필을 찾을 수 없습니다.';
  end if;

  return cleaned;
end;
$$;

revoke all on function public.update_my_character_name(text) from public;
grant execute on function public.update_my_character_name(text) to authenticated;
