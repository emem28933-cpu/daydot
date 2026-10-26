-- Daydot v0.6: DAY 할 일 기기 간 동기화
-- Supabase > SQL Editor 에서 전체를 한 번 실행하세요. (여러 번 실행해도 안전합니다)
-- 각 사용자는 자기 DAY 할 일만 읽고 쓸 수 있습니다. 친구에게는 공유되지 않습니다.

create table if not exists public.day_todos (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 150),
  note text not null default '' check (char_length(note) <= 2000),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists day_todos_user_idx on public.day_todos(user_id);

alter table public.day_todos enable row level security;

drop policy if exists day_todos_select on public.day_todos;
create policy day_todos_select on public.day_todos for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists day_todos_insert on public.day_todos;
create policy day_todos_insert on public.day_todos for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists day_todos_update on public.day_todos;
create policy day_todos_update on public.day_todos for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists day_todos_delete on public.day_todos;
create policy day_todos_delete on public.day_todos for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.day_todos from anon, public;
grant select, insert, update, delete on public.day_todos to authenticated;
