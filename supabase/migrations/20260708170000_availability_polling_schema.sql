-- ─────────────────────────────────────────────────────────────
-- Availability polling — Phase 1 schema
--
-- Architecture notes (do not regress):
-- • Closed slots stay rows (status = 'closed') until play time passes, then
--   expire; never DELETE on close — cancellation → reopen detection requires
--   remembering the slot existed.
-- • Delete expired slot rows only after ~90 days past play_starts_at.
-- • tee_time_slot_events are append-only and retained forever (price/demand history).
-- • Poll tier (hot/warm/cold) is DERIVED in the worker from days_until in
--   America/Denver — do not store tier columns; midnight promotion is free.
-- • Cron is a UTC heartbeat (*/5 * * * *); golf hours, burst windows, and
--   overnight lull are gated inside the handler in America/Denver.
-- • Concurrent ticks claim work via atomic UPDATE on last_polled_at (Phase 2).
-- ─────────────────────────────────────────────────────────────

-- ── Kill switch ───────────────────────────────────────────────
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_config is
  'Worker-readable config; flip polling_enabled without a deploy.';

insert into public.app_config (key, value)
values ('polling_enabled', 'true'::jsonb)
on conflict (key) do nothing;

alter table public.app_config enable row level security;
-- No anon/authenticated policies — service role only.

-- ── Booking-window burst dedupe (once per course per MT calendar day) ──
alter table public.course_catalog
  add column if not exists last_booking_burst_poll_on date;

comment on column public.course_catalog.last_booking_burst_poll_on is
  'America/Denver date when the 8:00 AM booking-window burst last ran for this course.';

-- ── Current inventory snapshot ────────────────────────────────
create table if not exists public.tee_time_slots (
  id               uuid primary key default gen_random_uuid(),
  course_slug      text not null,
  play_date        date not null,
  starts_at_local  time not null,
  play_starts_at   timestamptz not null,
  holes            smallint not null check (holes in (9, 18)),
  status           text not null default 'open'
                     check (status in ('open', 'closed', 'expired')),
  price_cents      integer,
  spots_open       integer,
  platform         text,
  first_opened_at  timestamptz not null default now(),
  closed_at        timestamptz,
  last_seen_at     timestamptz not null default now(),
  last_polled_at   timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (course_slug, play_date, starts_at_local, holes)
);

comment on table public.tee_time_slots is
  'Mutable current tee-time inventory per course/date/time/holes.';

comment on column public.tee_time_slots.status is
  'open = bookable; closed = missing from latest poll (likely booked) — KEEP ROW;
   expired = play time passed. Do NOT delete on close.';

comment on column public.tee_time_slots.spots_open is
  'Open spots when platform returns real capacity (ForeUp, MemberSports).
   NULL when unknown or pre-filtered (Chronogolf SLC) — read path must not hide.';

comment on column public.tee_time_slots.play_starts_at is
  'Absolute tee time in timestamptz (America/Denver wall clock). Used for expiry.';

create index if not exists tee_time_slots_course_date_status_idx
  on public.tee_time_slots (course_slug, play_date, status);

create index if not exists tee_time_slots_play_starts_at_idx
  on public.tee_time_slots (play_starts_at)
  where status in ('open', 'closed');

-- ── Immutable event log (retain forever) ──────────────────────
create table if not exists public.tee_time_slot_events (
  id              uuid primary key default gen_random_uuid(),
  slot_id         uuid references public.tee_time_slots (id) on delete set null,
  course_slug     text not null,
  play_date       date not null,
  starts_at_local time not null,
  holes           smallint not null check (holes in (9, 18)),
  event_type      text not null
                    check (event_type in ('opened', 'closed', 'reopened', 'price_changed')),
  price_cents     integer,
  spots_open      integer,
  old_price_cents integer,
  new_price_cents integer,
  poll_run_id     uuid,
  created_at      timestamptz not null default now()
);

comment on table public.tee_time_slot_events is
  'Append-only availability history. Never delete rows — powers reopened badges and price insights.';

create index if not exists tee_time_slot_events_course_date_idx
  on public.tee_time_slot_events (course_slug, play_date, created_at desc);

create index if not exists tee_time_slot_events_type_created_idx
  on public.tee_time_slot_events (event_type, created_at desc);

-- ── Poll schedule: last_polled_at only (tier derived in worker) ──
create table if not exists public.availability_poll_schedule (
  course_slug    text not null,
  play_date      date not null,
  last_polled_at timestamptz,
  created_at     timestamptz not null default now(),
  primary key (course_slug, play_date)
);

comment on table public.availability_poll_schedule is
  'Per (course, date) poll cursor. Tier = f(play_date - today_MT); due when
   now() - last_polled_at > interval(derived_tier). Claim via atomic UPDATE
   SET last_polled_at = now() WHERE last_polled_at < threshold RETURNING *.';

create index if not exists availability_poll_schedule_last_polled_idx
  on public.availability_poll_schedule (last_polled_at nulls first);

-- ── Poll run observability (day-one tuning) ───────────────────
create table if not exists public.availability_poll_runs (
  id               uuid primary key default gen_random_uuid(),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'running'
                     check (status in (
                       'running', 'ok', 'partial', 'failed',
                       'skipped_kill_switch', 'skipped_off_hours'
                     )),
  courses_claimed  integer not null default 0,
  courses_ok       integer not null default 0,
  courses_failed   integer not null default 0,
  slots_upserted   integer not null default 0,
  events_written   integer not null default 0,
  error_summary    text
);

comment on table public.availability_poll_runs is
  'One row per cron heartbeat execution that attempted polling.';

create table if not exists public.availability_poll_run_courses (
  id            uuid primary key default gen_random_uuid(),
  poll_run_id   uuid not null references public.availability_poll_runs (id) on delete cascade,
  course_slug   text not null,
  play_date     date not null,
  status        text not null
                  check (status in ('ok', 'failed', 'skipped')),
  slots_written integer not null default 0,
  events_written integer not null default 0,
  latency_ms    integer,
  error_message text,
  unique (poll_run_id, course_slug, play_date)
);

create index if not exists availability_poll_run_courses_run_idx
  on public.availability_poll_run_courses (poll_run_id);

-- ── RLS: public read on slots/events; ops tables service-only ──
alter table public.tee_time_slots enable row level security;
alter table public.tee_time_slot_events enable row level security;
alter table public.availability_poll_schedule enable row level security;
alter table public.availability_poll_runs enable row level security;
alter table public.availability_poll_run_courses enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tee_time_slots'
      and policyname = 'tee_time_slots are readable by everyone'
  ) then
    create policy "tee_time_slots are readable by everyone"
      on public.tee_time_slots for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tee_time_slot_events'
      and policyname = 'tee_time_slot_events are readable by everyone'
  ) then
    create policy "tee_time_slot_events are readable by everyone"
      on public.tee_time_slot_events for select
      to anon, authenticated
      using (true);
  end if;
end $$;
