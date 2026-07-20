-- Clear Supabase Security Advisor WARN items that are safe to fix without
-- changing product behavior (round share-link voting RLS left intentionally).

-- ── 1. Pin search_path on trigger / helper functions ─────────────────
alter function public.set_round_option_votes_updated_at() set search_path = public;
alter function public.set_round_voters_updated_at() set search_path = public;
alter function public.profiles_phone_verification_enforcement() set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.touch_course_rates_updated_at() set search_path = public;
alter function public.touch_course_registry_updated_at() set search_path = public;

-- ── 2. SECURITY DEFINER RPCs must not be callable by anon/authenticated ──
-- claim_availability_poll_batch: worker-only (service_role). A later CREATE OR
-- REPLACE may have restored default PUBLIC execute grants.
revoke all on function public.claim_availability_poll_batch(date, date, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_availability_poll_batch(date, date, integer, timestamptz)
  to service_role;

-- handle_new_user: auth.users trigger only — not a public RPC.
revoke all on function public.handle_new_user()
  from public, anon, authenticated;
