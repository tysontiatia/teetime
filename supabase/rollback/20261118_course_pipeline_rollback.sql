-- Undo the three 18 Nov 2026 migrations. Not a migration: `supabase db push`
-- never runs files in this folder. Run it by hand only to roll back.
--
-- Roll back the Worker first (npx wrangler rollback <previous version id>);
-- the old Worker does not use any of these objects, so it keeps working either way.

begin;

-- 20261118000200_course_registry_public_view.sql
drop view if exists public.course_registry_public;

-- 20261118000100_claim_poll_batch_local.sql (the old claim function is untouched)
drop function if exists public.claim_availability_poll_batch_local(jsonb, integer, integer, timestamptz);

-- 20261118000000_course_photo_attempts.sql (photos_fetched_at predates it and stays)
drop index if exists public.course_catalog_photo_queue_idx;
alter table public.course_catalog
  drop column if exists photo_attempts,
  drop column if exists photo_next_attempt_at,
  drop column if exists photo_failed_reason;

-- Remove them from migration history so a later `db push` would re-apply them.
delete from supabase_migrations.schema_migrations
 where version in ('20261118000000', '20261118000100', '20261118000200');

commit;
