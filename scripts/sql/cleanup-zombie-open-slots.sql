-- Close open slots that have not been seen by the poller recently.
-- Safe after partial-fetch deadlock fix: aged missing inventory should be closed.
-- Does NOT insert tee_time_slot_events (avoids flooding the feed with bulk closes).

-- Preview
select course_slug,
       play_date,
       count(*) as zombie_open
from public.tee_time_slots
where status = 'open'
  and last_seen_at is not null
  and last_seen_at < now() - interval '40 minutes'
group by course_slug, play_date
order by zombie_open desc;

-- Apply
update public.tee_time_slots
set status = 'closed',
    closed_at = now(),
    last_polled_at = now(),
    updated_at = now()
where status = 'open'
  and last_seen_at is not null
  and last_seen_at < now() - interval '40 minutes';

-- Finish orphaned poll runs stuck in 'running'
update public.availability_poll_runs
set status = 'failed',
    finished_at = coalesce(finished_at, now()),
    error_summary = coalesce(error_summary, 'cleanup: marked stuck running run as failed')
where status = 'running'
  and started_at < now() - interval '30 minutes';
