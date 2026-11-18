-- The photo cron used to leave a failed lookup unstamped, so the same rows were
-- asked of Google every 15 minutes forever and blocked newer courses (the queue
-- takes the oldest rows first). These columns let the worker count attempts,
-- back off between them, and stop for good when Google says the place is gone.

alter table public.course_catalog
  add column if not exists photos_fetched_at timestamptz,
  add column if not exists photo_attempts integer not null default 0,
  add column if not exists photo_next_attempt_at timestamptz,
  add column if not exists photo_failed_reason text;

comment on column public.course_catalog.photo_attempts is
  'Failed photo copy attempts so far. The worker gives up after a fixed number.';
comment on column public.course_catalog.photo_next_attempt_at is
  'Earliest time the photo cron may try this course again. Null means now.';
comment on column public.course_catalog.photo_failed_reason is
  'Why the photo job stopped: place_not_found, gave_up, or null while it is still trying or after a copy.';

-- The cron reads pending rows by next attempt time.
create index if not exists course_catalog_photo_queue_idx
  on public.course_catalog (photo_next_attempt_at nulls first, created_at)
  where photo_storage_url is null and photos_fetched_at is null;
