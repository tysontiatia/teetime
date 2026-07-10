-- Prioritize (course, date) pairs with active notification alerts when claiming poll work.

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
    select
      s.course_slug,
      s.play_date,
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
              and s.play_date >= p_today_mt
              and s.play_date <= p_today_mt + np.look_ahead_days
            )
          )
      ) as has_alert
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
    order by has_alert desc, s.last_polled_at nulls first, s.last_polled_at asc
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
