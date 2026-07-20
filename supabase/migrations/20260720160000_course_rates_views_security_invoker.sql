-- Fix Supabase "Security Definer View" lint for course rate read models.
-- Views should enforce the querying user's privileges/RLS, not the owner's.
-- Underlying tables already allow public SELECT for anon/authenticated.

-- Unused legacy 3-column projection (not referenced by app code).
drop view if exists public.course_rates_legacy_flat;

-- Active UI/admin read model.
alter view public.course_rates_expanded set (security_invoker = true);

comment on view public.course_rates_expanded is
  'READ-ONLY UI read model at resident null, season=standard. Runs as security_invoker.';
