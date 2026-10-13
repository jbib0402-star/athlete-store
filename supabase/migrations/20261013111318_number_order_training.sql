-- Keep legacy timing sessions readable, but never select timing for new games.
alter table public.training_game_sessions drop constraint training_game_sessions_game_type_check;
alter table public.training_game_sessions add constraint training_game_sessions_game_type_check
 check(game_type in('direction','timing','target','numbers'));

create or replace function public.start_random_training()
returns jsonb language plpgsql security definer set search_path='' as $$
declare data jsonb; kind text; challenges jsonb:='[]'::jsonb; i integer;
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
 data:=public.start_agility_training();
 kind:=(array['direction','numbers','target'])[1+floor(random()*3)::integer];
 if kind='numbers' then
  select jsonb_agg(n order by random()) into challenges from generate_series(1,10) as n;
 else
  for i in 1..10 loop challenges:=challenges||to_jsonb(floor(random()*9)::integer); end loop;
 end if;
 update public.training_game_sessions set game_type=kind,game_payload=challenges
 where id=(data->>'session_id')::uuid and user_id=auth.uid();
 return data||jsonb_build_object('game_type',kind,'challenges',challenges,
  'round_time_ms',case kind when 'numbers' then 30000 when 'target' then 1800 else 1400 end,
  'required_correct',case when kind='numbers' then 10 else 7 end,
  'total_rounds',case when kind='numbers' then 1 else 10 end);
end $$;
revoke all on function public.start_random_training() from public,anon;
grant execute on function public.start_random_training() to authenticated;

CREATE OR REPLACE FUNCTION public.finish_random_training(game_session_id uuid, answer_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  row_data public.training_game_sessions%rowtype;
  answers_arr text[];
  score_value integer := 0;
  i integer;
  value_num numeric;
  position_num numeric;
  item_json jsonb;
  today date := (now() at time zone 'Asia/Seoul')::date;
  daily_limit integer := public.setting_int('daily_training_limit', 3);
  completed integer := 0;
  required_score integer := 7;
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
  if row_data.game_type = 'direction' then return public.finish_agility_training(game_session_id, answer_payload); end if;
  if row_data.game_type = 'numbers' then required_score := 10; end if;
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
    item_json := answer_payload->(i-1);
    if item_json = 'null'::jsonb then continue; end if;
    if jsonb_typeof(item_json) <> 'number' then raise exception '훈련 입력을 확인해주세요.'; end if;
    value_num := (item_json::text)::numeric;
    if value_num <> trunc(value_num) then raise exception '훈련 입력을 확인해주세요.'; end if;
    if row_data.game_type = 'numbers' then
      if value_num < 0 or value_num > 9 then raise exception '숫자 위치를 확인해주세요.'; end if;
      if (row_data.game_payload->value_num::integer)::text::integer = i then score_value := score_value + 1; end if;
    elsif row_data.game_type = 'target' then
      if value_num < 0 or value_num > 8 then raise exception '표적 위치를 확인해주세요.'; end if;
      if value_num = (row_data.game_payload->(i-1))::text::integer then score_value := score_value + 1; end if;
    elsif row_data.game_type = 'timing' then
      if value_num < 0 or value_num > 3000 then raise exception '정지 시간을 확인해주세요.'; end if;
      position_num := 100 - abs(100 - mod(value_num,1800)/9);
      if abs(position_num - (row_data.game_payload->(i-1))::text::integer) <= 12 then score_value := score_value + 1; end if;
    else raise exception '훈련 종류를 확인해주세요.';
    end if;
  end loop;

  if score_value < required_score then
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
      'required_correct', required_score,
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
    values(uid, reward_amount, 'training', (case when row_data.game_type='numbers' then '숫자 순서 터치 훈련 ' when row_data.game_type='timing' then '타이밍 스톱 훈련 ' else '표적 터치 훈련 ' end) || score_value || '/10');
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
    'required_correct', required_score,
    'reward', reward_amount
  );
end $function$
;
revoke all on function public.finish_random_training(uuid,jsonb) from public,anon;
grant execute on function public.finish_random_training(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
