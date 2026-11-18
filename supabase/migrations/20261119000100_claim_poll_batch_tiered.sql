-- Tiered poll claim: refresh intervals and per-course priority come from the worker.
--
-- At 640 live courses the poller reached only ~1,400 of ~9,600 course-dates a day:
-- it claimed 60 per 5-minute run and asked for every date every 5–60 minutes.
-- Find fetches live when someone searches, so the poller now keeps a reasonable
-- snapshot instead: today/tomorrow every p_hot_minutes, the rest of the week every
-- p_warm_minutes, and days 7–14 only for alert targets, every p_far_minutes.
--
-- p_courses: [{"slug": "...", "today": "YYYY-MM-DD", "priority": 0|1|2}, ...]
-- priority 0 polls first within a tier (busy states), 2 last.
-- claim_availability_poll_batch_local stays for a worker deployed before this.

create or replace function public.claim_availability_poll_batch_tiered(
  p_courses         jsonb,
  p_max_offset      int default 14,
  p_batch_size      int default 60,
  p_now             timestamptz default now(),
  p_hot_minutes     int default 20,
  p_warm_minutes    int default 60,
  p_far_minutes     int default 180,
  p_far_alert_only  boolean default true
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
    select c.slug, c.today, coalesce(c.priority, 1) as priority
    from jsonb_to_recordset(coalesce(p_courses, '[]'::jsonb)) as c(slug text, today date, priority int)
    where c.slug is not null and c.today is not null
  ),
  candidates as (
    select
      s.course_slug,
      s.play_date,
      s.last_polled_at,
      c.priority,
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
  ),
  due as (
    select d.course_slug, d.play_date, d.day_offset, d.has_alert, d.priority, d.last_polled_at
    from candidates d
    where case
            when d.day_offset <= 1 then
              d.last_polled_at is null or p_now - d.last_polled_at > make_interval(mins => p_hot_minutes)
            when d.day_offset <= 6 then
              d.last_polled_at is null or p_now - d.last_polled_at > make_interval(mins => p_warm_minutes)
            else
              (not p_far_alert_only or d.has_alert)
              and (d.last_polled_at is null or p_now - d.last_polled_at > make_interval(mins => p_far_minutes))
          end
    order by
      least(d.day_offset, 2) asc,      -- today/tomorrow, then this week, then later
      d.has_alert desc,
      d.priority asc,
      d.day_offset asc,
      d.last_polled_at nulls first,
      d.last_polled_at asc
    limit p_batch_size
  ),
  locked as (
    select s.course_slug, s.play_date
    from public.availability_poll_schedule s
    join due d on d.course_slug = s.course_slug and d.play_date = s.play_date
    for update of s skip locked
  )
  update public.availability_poll_schedule s
  set last_polled_at = p_now
  from locked l
  where s.course_slug = l.course_slug
    and s.play_date = l.play_date
  returning s.course_slug, s.play_date, p_now;
end;
$$;

comment on function public.claim_availability_poll_batch_tiered(jsonb, integer, integer, timestamptz, integer, integer, integer, boolean) is
  'Claim due (course, date) poll rows with worker-set refresh intervals and per-course priority. Today/tomorrow first, then alerts, then priority. SKIP LOCKED for concurrent ticks.';

revoke all on function public.claim_availability_poll_batch_tiered(jsonb, integer, integer, timestamptz, integer, integer, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_availability_poll_batch_tiered(jsonb, integer, integer, timestamptz, integer, integer, integer, boolean)
  to service_role;
