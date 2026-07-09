-- Phantom churn gate: courses with high closed/reopened oscillation in last 24h.
-- Run in Supabase SQL editor after polling has been live.
-- Ugly Chronogolf reopened ≈ closed → prioritize diff hardening (3b) before 1b.

select course_slug,
       count(*) filter (where event_type = 'closed') as closed,
       count(*) filter (where event_type = 'reopened') as reopened
from tee_time_slot_events
where created_at > now() - interval '1 day'
group by course_slug
having count(*) filter (where event_type = 'closed') > 0
order by count(*) filter (where event_type = 'reopened') desc;
