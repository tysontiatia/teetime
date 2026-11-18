-- A Find search the user wants watched: place, date, party, and time of day.
-- Matched by the alert poller when any course in range opens a fitting tee time.

create table if not exists public.search_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  active boolean not null default true,
  target_date date,
  look_ahead_days int,
  players int not null default 2 check (players between 1 and 4),
  holes text not null default 'any' check (holes in ('any', '9', '18')),
  earliest_time time not null default '00:00',
  latest_time time not null default '23:59',
  place_label text not null,
  anchor_lat double precision,
  anchor_lng double precision,
  radius_mi int,
  scope text not null default 'radius' check (scope in ('radius', 'all')),
  created_at timestamptz not null default now()
);

create index if not exists idx_search_watches_active
  on public.search_watches (active, target_date);

alter table public.search_watches enable row level security;

create policy "search_watches_select_own"
  on public.search_watches for select
  using (user_id = (select auth.uid()));

create policy "search_watches_insert_own"
  on public.search_watches for insert
  with check (user_id = (select auth.uid()));

create policy "search_watches_update_own"
  on public.search_watches for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "search_watches_delete_own"
  on public.search_watches for delete
  using (user_id = (select auth.uid()));
