-- Per-user “remove from my list” for Shared rounds (You tab).
-- Vote links stay live; only the list membership is hidden.

create table if not exists public.round_list_hides (
  user_id uuid not null references auth.users (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, round_id)
);

create index if not exists idx_round_list_hides_user_id on public.round_list_hides (user_id);

alter table public.round_list_hides enable row level security;

create policy "round_list_hides_select_own"
  on public.round_list_hides for select
  using (user_id = (select auth.uid()));

create policy "round_list_hides_insert_own"
  on public.round_list_hides for insert
  with check (user_id = (select auth.uid()));

create policy "round_list_hides_delete_own"
  on public.round_list_hides for delete
  using (user_id = (select auth.uid()));
