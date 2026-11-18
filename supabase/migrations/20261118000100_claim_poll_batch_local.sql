-- Per-course "today" for the poll claim.
--
-- claim_availability_poll_batch took one Mountain Time date for every course.
-- Outside Mountain Time that is wrong for part of each day: an East Coast
-- course's "today" starts two hours earlier, Hawaii's three to four hours later,
-- so hot/warm tiers and the 14-day window were off by a day around midnight.
--
-- The worker now sends the courses it wants polled (only those inside their own
-- golf hours) with each course's local date. Tiers, alert priority, and the
-- window are measured from that date. The old function is left in place so a
-- worker deployed before this migration keeps polling.

create or replace function public.claim_availability_poll_batch_local(
  p_courses     jsonb,          -- [{"slug": "...", "today": "YYYY-MM-DD"}, ...]
  p_max_offset  int default 14, -- 1 claims hot dates (today, tomorrow) only
  p_batch_size  int default 10,
  p_now         timestamptz default now()
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
  with courses as (
    select c.slug, c.today
    from jsonb_to_recordset(coalesce(p_courses, '[]'::jsonb)) as c(slug text, today date)
    where c.slug is not null and c.today is not null
  ),
  due as (
    select
      s.course_slug,
      s.play_date,
      (s.play_date - c.today) as day_offset,
      exists (
        select 1
        from public.notification_preferences np
        join public.course_catalog cc on cc.name = np.course_id
        where np.active = true
          and cc.slug = s.course_slug
          and (
            (np.target_date is not null and np.target_date = s.play_date)
            or (
              np.target_date is null
              and np.look_ahead_days is not null
              and s.play_date >= c.today
              and s.play_date <= c.today + np.look_ahead_days
            )
          )
      ) as has_alert
    from public.availability_poll_schedule s
    join courses c on c.slug = s.course_slug
    where s.play_date >= c.today
      and (s.play_date - c.today) <= least(greatest(p_max_offset, 0), 14)
      and (
        case
          when (s.play_date - c.today) <= 1 then
            s.last_polled_at is null or p_now - s.last_polled_at > interval '5 minutes'
          when (s.play_date - c.today) <= 6 then
            s.last_polled_at is null or p_now - s.last_polled_at > interval '15 minutes'
          else
            s.last_polled_at is null or p_now - s.last_polled_at > interval '60 minutes'
        end
      )
    order by
      day_offset asc,
      has_alert desc,
      s.last_polled_at nulls first,
      s.last_polled_at asc
    limit p_batch_size
    for update of s skip locked
  )
  update public.availability_poll_schedule s
  set last_polled_at = p_now
  from due d
  where s.course_slug = d.course_slug
    and s.play_date = d.play_date
  returning s.course_slug, s.play_date, p_now;
end;
$$;

comment on function public.claim_availability_poll_batch_local(jsonb, integer, integer, timestamptz) is
  'Claim due (course, date) poll rows using each course''s local date. Hot dates first, then alert targets, then oldest last_polled_at. SKIP LOCKED for concurrent ticks.';

revoke all on function public.claim_availability_poll_batch_local(jsonb, integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_availability_poll_batch_local(jsonb, integer, integer, timestamptz)
  to service_role;
