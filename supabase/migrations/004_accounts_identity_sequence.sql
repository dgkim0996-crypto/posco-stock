-- 001에서 초기 계좌 ID를 명시했으므로 identity 시퀀스를 현재 최댓값에 맞춘다.
select setval(
  pg_get_serial_sequence('public.accounts', 'id'),
  coalesce((select max(id) from public.accounts), 1),
  true
);
