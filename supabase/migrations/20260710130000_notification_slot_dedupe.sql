-- Slot-level alert dedupe: track which tee times were included in each send.

alter table public.notification_log
  add column if not exists notified_slot_keys text[] not null default '{}';

alter table public.notification_log
  add column if not exists notify_reason text
    check (notify_reason is null or notify_reason in ('event', 'backstop'));

comment on column public.notification_log.notified_slot_keys is
  'Slot keys (HH:MM:SS|holes) included in this send — used to avoid duplicate alerts for the same tee time.';

create index if not exists idx_notification_log_slot_dedupe
  on public.notification_log (user_id, course_id, target_date, channel, sent_at desc);
