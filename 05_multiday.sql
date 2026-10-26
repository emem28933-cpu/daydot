-- Daydot v0.13: 여러 날 일정 (종료일)
-- Supabase > SQL Editor 에서 전체를 한 번 실행하세요. (여러 번 실행해도 안전합니다)
alter table public.events add column if not exists end_date date;

alter table public.events drop constraint if exists events_end_after_start;
alter table public.events add constraint events_end_after_start
  check (end_date is null or end_date >= event_date);
