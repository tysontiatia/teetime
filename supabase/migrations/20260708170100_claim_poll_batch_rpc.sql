-- Atomic batch claim for availability poller.
-- Single statement: lock due rows (SKIP LOCKED), update last_polled_at, return claimed set.
-- Tier intervals match worker/availabilityPoll.js (derived from play_date - today_mt).

create or replace function public.claim_availability_poll_batch(
  p_today_mt      date,
  p_max_play_date date,
  p_batch_size    int default 10,
  p_now           timestamptz default now()
)
returns table (
  course_slug text,
  play_date   date,
  claimed_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select s.course_slug, s.play_date
    from public.availability_poll_schedule s
    where s.play_date >= p_today_mt
      and s.play_date <= p_max_play_date
      and (s.play_date - p_today_mt) <= 14
      and (
        case
          when (s.play_date - p_today_mt) <= 1 then
            s.last_polled_at is null or p_now - s.last_polled_at > interval '5 minutes'
          when (s.play_date - p_today_mt) <= 6 then
            s.last_polled_at is null or p_now - s.last_polled_at > interval '15 minutes'
          else
            s.last_polled_at is null or p_now - s.last_polled_at > interval '60 minutes'
        end
      )
    order by s.last_polled_at nulls first, s.last_polled_at asc
    limit p_batch_size
    for update skip locked
  )
  update public.availability_poll_schedule s
  set last_polled_at = p_now
  from due d
  where s.course_slug = d.course_slug
    and s.play_date = d.play_date
  returning s.course_slug, s.play_date, p_now;
end;
$$;

comment on function public.claim_availability_poll_batch is
  'Claim up to p_batch_size due (course, play_date) rows atomically. Concurrent cron ticks cannot claim the same row.';

revoke all on function public.claim_availability_poll_batch(date, date, int, timestamptz) from public;
grant execute on function public.claim_availability_poll_batch(date, date, int, timestamptz) to service_role;
