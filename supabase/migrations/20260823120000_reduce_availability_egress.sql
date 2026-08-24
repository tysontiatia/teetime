-- Cut Supabase egress from availability polling:
-- • Inventory is worker-only (anon key is in the public bundle; public SELECT
--   let anyone page through tee_time_slots / tee_time_slot_events).
-- • prune_availability_history expires past slots, drops old rows, and trims
--   poll-run logs so snapshots stay small.

-- ── Public inventory dumps were a quota footgun ──────────────────────
drop policy if exists "tee_time_slots are readable by everyone" on public.tee_time_slots;
drop policy if exists "tee_time_slot_events are readable by everyone" on public.tee_time_slot_events;

-- Finder / feed / poller already read these via the Worker (service_role).
-- RLS stays on; anon and authenticated have no policies → no REST access.

create index if not exists tee_time_slot_events_created_at_idx
  on public.tee_time_slot_events (created_at);

create index if not exists tee_time_slots_expired_play_starts_idx
  on public.tee_time_slots (play_starts_at)
  where status = 'expired';

create or replace function public.prune_availability_history(
  p_event_keep interval default interval '90 days',
  p_slot_keep interval default interval '90 days',
  p_run_keep interval default interval '14 days',
  p_limit int default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired int := 0;
  v_slots_deleted int := 0;
  v_events_deleted int := 0;
  v_runs_deleted int := 0;
begin
  with due as (
    select id
    from public.tee_time_slots
    where status in ('open', 'closed')
      and play_starts_at < now()
    limit p_limit
  )
  update public.tee_time_slots s
  set
    status = 'expired',
    updated_at = now()
  from due d
  where s.id = d.id;
  get diagnostics v_expired = row_count;

  with doomed as (
    select id
    from public.tee_time_slots
    where status = 'expired'
      and play_starts_at < now() - p_slot_keep
    limit p_limit
  )
  delete from public.tee_time_slots s
  using doomed d
  where s.id = d.id;
  get diagnostics v_slots_deleted = row_count;

  with doomed as (
    select id
    from public.tee_time_slot_events
    where created_at < now() - p_event_keep
    limit p_limit
  )
  delete from public.tee_time_slot_events e
  using doomed d
  where e.id = d.id;
  get diagnostics v_events_deleted = row_count;

  with doomed as (
    select id
    from public.availability_poll_runs
    where started_at < now() - p_run_keep
    limit p_limit
  )
  delete from public.availability_poll_runs r
  using doomed d
  where r.id = d.id;
  get diagnostics v_runs_deleted = row_count;

  return jsonb_build_object(
    'expired', v_expired,
    'slots_deleted', v_slots_deleted,
    'events_deleted', v_events_deleted,
    'runs_deleted', v_runs_deleted
  );
end;
$$;

comment on function public.prune_availability_history(interval, interval, interval, integer) is
  'Expire past tee times, delete slots/events past retention, trim poll-run logs. Batched via p_limit.';

revoke all on function public.prune_availability_history(interval, interval, interval, integer)
  from public, anon, authenticated;
grant execute on function public.prune_availability_history(interval, interval, interval, integer)
  to service_role;
