create table if not exists public.training_game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  training_date date not null,
  direction_sequence text[] not null,
  submitted_answers text[],
  score integer,
  status text not null default 'active' check (status in ('active','completed','failed','expired','abandoned')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finished_at timestamptz
);

create index if not exists training_game_sessions_user_date_idx
  on public.training_game_sessions(user_id, training_date, started_at desc);

alter table public.training_game_sessions enable row level security;

create or replace function public.start_agility_training()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Seoul')::date;
  daily_limit integer := public.setting_int('daily_training_limit', 3);
  completed integer := 0;
  directions text[] := array['left','up','right','down'];
  seq text[] := array[]::text[];
  session_id uuid;
  expires timestamptz := now() + interval '2 minutes';
  i integer;
begin
  if uid is null then raise exception '로그인이 필요합니다.'; end if;

  perform 1 from public.profiles where id = uid for update;
  select count(*) into completed
  from public.training_logs
  where user_id = uid and training_date = today;

  if completed >= daily_limit then
    raise exception '오늘 가능한 훈련을 모두 완료했습니다.';
  end if;

  update public.training_game_sessions
  set status = case when expires_at < now() then 'expired' else 'abandoned' end,
      finished_at = now()
  where user_id = uid and status = 'active';

  for i in 1..10 loop
    seq := array_append(seq, directions[1 + floor(random() * 4)::integer]);
  end loop;

  insert into public.training_game_sessions(user_id, training_date, direction_sequence, expires_at)
  values(uid, today, seq, expires)
  returning id into session_id;

  return jsonb_build_object(
    'session_id', session_id,
    'sequence', to_jsonb(seq),
    'expires_at', expires,
    'total', 10,
    'required_correct', 7,
    'round_time_ms', 1400
  );
end $$;

create or replace function public.finish_agility_training(game_session_id uuid, answer_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row_data public.training_game_sessions%rowtype;
  answers_arr text[];
  score_value integer := 0;
  i integer;
  today date := (now() at time zone 'Asia/Seoul')::date;
  daily_limit integer := public.setting_int('daily_training_limit', 3);
  completed integer := 0;
  reward_amount integer := public.setting_int('training_reward', 150);
begin
  if uid is null then raise exception '로그인이 필요합니다.'; end if;
  if answer_payload is null or jsonb_typeof(answer_payload) <> 'array' or jsonb_array_length(answer_payload) <> 10 then
    raise exception '훈련 결과를 확인할 수 없습니다.';
  end if;

  select * into row_data
  from public.training_game_sessions
  where id = game_session_id and user_id = uid
  for update;

  if not found then raise exception '훈련 세션을 찾을 수 없습니다.'; end if;
  if row_data.status <> 'active' then raise exception '이미 종료된 훈련입니다.'; end if;

  if row_data.expires_at < now() then
    update public.training_game_sessions
    set status = 'expired', finished_at = now()
    where id = game_session_id;
    raise exception '훈련 시간이 초과되었습니다. 다시 시작해주세요.';
  end if;

  select array_agg(value order by ordinality)
  into answers_arr
  from jsonb_array_elements_text(answer_payload) with ordinality as t(value, ordinality);

  for i in 1..10 loop
    if answers_arr[i] = row_data.direction_sequence[i] then
      score_value := score_value + 1;
    end if;
  end loop;

  if score_value < 7 then
    update public.training_game_sessions
    set submitted_answers = answers_arr,
        score = score_value,
        status = 'failed',
        finished_at = now()
    where id = game_session_id;

    return jsonb_build_object(
      'success', false,
      'score', score_value,
      'total', 10,
      'required_correct', 7,
      'reward', 0
    );
  end if;

  perform 1 from public.profiles where id = uid for update;
  select count(*) into completed
  from public.training_logs
  where user_id = uid and training_date = today;

  if completed >= daily_limit then
    update public.training_game_sessions
    set submitted_answers = answers_arr,
        score = score_value,
        status = 'failed',
        finished_at = now()
    where id = game_session_id;
    raise exception '오늘 가능한 훈련을 모두 완료했습니다.';
  end if;

  insert into public.training_logs(user_id, training_date, reward)
  values(uid, today, reward_amount);

  update public.profiles
  set points = points + reward_amount
  where id = uid;

  if reward_amount > 0 then
    insert into public.point_logs(user_id, amount, type, description)
    values(uid, reward_amount, 'training', '순발력 방향키 훈련 ' || score_value || '/10');
  end if;

  update public.training_game_sessions
  set submitted_answers = answers_arr,
      score = score_value,
      status = 'completed',
      finished_at = now()
  where id = game_session_id;

  return jsonb_build_object(
    'success', true,
    'score', score_value,
    'total', 10,
    'required_correct', 7,
    'reward', reward_amount
  );
end $$;

create or replace function public.complete_training()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception '순발력 미니게임을 완료한 뒤 훈련 보상을 받을 수 있습니다.';
end $$;

revoke all on function public.start_agility_training() from public;
revoke all on function public.finish_agility_training(uuid, jsonb) from public;
grant execute on function public.start_agility_training() to authenticated;
grant execute on function public.finish_agility_training(uuid, jsonb) to authenticated;
