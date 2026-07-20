-- Search/read coverage must track successful vendor polls, not claim time.
-- claim_availability_poll_batch bumps last_polled_at when claiming work (including
-- failures). Using that for has_poll_coverage made empty failed polls mask live
-- fallback (seen with Skyway / wrong ForeUp booking_class_id).

alter table public.availability_poll_schedule
  add column if not exists last_success_at timestamptz;

comment on column public.availability_poll_schedule.last_polled_at is
  'Set when a poll batch claims this (course, date) — scheduling / lock cursor only.';

comment on column public.availability_poll_schedule.last_success_at is
  'Set only after a successful vendor fetch+diff. /v1/availability coverage + freshness use this.';

create index if not exists availability_poll_schedule_last_success_idx
  on public.availability_poll_schedule (last_success_at nulls first);

-- Backfill from slot rows only (proof a poll wrote inventory). Empty/failed claims
-- stay uncovered so search falls through to live until the next successful poll.
update public.availability_poll_schedule s
set last_success_at = sub.max_polled
from (
  select course_slug, play_date, max(last_polled_at) as max_polled
  from public.tee_time_slots
  where last_polled_at is not null
  group by course_slug, play_date
) sub
where s.course_slug = sub.course_slug
  and s.play_date = sub.play_date
  and s.last_success_at is null;
