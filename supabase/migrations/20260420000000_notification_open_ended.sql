-- ─────────────────────────────────────────────────────────────
-- Open-ended notification alerts: look_ahead_days support
-- ─────────────────────────────────────────────────────────────

-- Add look_ahead_days to notification_preferences.
-- When set, this pref monitors any date within the next N days (target_date is null).
alter table public.notification_preferences
  add column if not exists look_ahead_days int;

-- Allow target_date to be null in notification_log (open-ended alerts log per date checked).
alter table public.notification_log
  alter column target_date drop not null;

-- Drop the "once ever" unique constraint so the worker can re-notify after 24h for open-ended alerts.
alter table public.notification_log
  drop constraint if exists notification_log_user_id_course_id_target_date_channel_key;

-- Index for efficient 24-hour cooldown queries.
create index if not exists idx_notification_log_cooldown
  on public.notification_log (user_id, course_id, target_date, sent_at desc);
