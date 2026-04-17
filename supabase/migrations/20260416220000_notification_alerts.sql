-- ─────────────────────────────────────────────────────────────
-- Notification alerts: add target_date + players, notification_log
-- ─────────────────────────────────────────────────────────────

-- Add target_date and players to notification_preferences
alter table public.notification_preferences
  add column if not exists target_date date,
  add column if not exists players int not null default 1;

-- Log of sent notifications (prevents duplicate sends)
create table if not exists public.notification_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  course_id  text not null,
  target_date date not null,
  channel    text not null check (channel in ('email', 'sms')),
  times_found int not null default 0,
  sent_at    timestamptz not null default now(),
  unique (user_id, course_id, target_date, channel)
);

alter table public.notification_log enable row level security;

create policy "users can view their own notification log"
  on public.notification_log for select
  using (auth.uid() = user_id);
