-- Cursor for Alerts "Recent" unread / nav badge (when the user last viewed activity).
alter table public.profiles
  add column if not exists alerts_seen_at timestamptz;

comment on column public.profiles.alerts_seen_at is
  'When the user last viewed Alerts → Recent; used for unread badge.';
