-- What the public site, the poller, and alerts read (worker loadCourses).
--
-- Before this the worker pulled every course_registry row with its full record
-- every 60 seconds, then a second query for photo URLs, and filtered to public
-- courses in JavaScript. QA stubs from a state import would have multiplied that.
--
-- This view:
-- - keeps only rows the public site shows. The rule is the same as
--   isPublicRegistryRecord in worker/courseAdmin.js; keep the two in step.
-- - drops fields nothing public reads: photo_reference (about a third of the
--   bytes; pages use the stored photo) and google_place_id (admin only).
-- - adds photo_storage_url from course_catalog, replacing the second query.

create or replace view public.course_registry_public
with (security_invoker = true) as
select
  r.slug,
  (r.record - 'photo_reference' - 'google_place_id')
    || case
         when c.photo_storage_url is not null
           then jsonb_build_object('photo_storage_url', c.photo_storage_url)
         else '{}'::jsonb
       end as record
from public.course_registry r
left join public.course_catalog c on c.slug = r.slug
where case btrim(coalesce(r.record->>'booking_status', ''))
        when 'closed' then false
        when 'private' then false
        when 'pending' then false
        when 'ready' then true
        when 'phone' then true
        when 'unsupported' then true
        -- Legacy rows without booking_status: only publish when a platform is set.
        else btrim(coalesce(r.record->>'platform', '')) <> ''
      end;

comment on view public.course_registry_public is
  'Public courses for worker loadCourses: same filter as isPublicRegistryRecord, admin-only fields removed, stored photo URL joined.';

revoke all on public.course_registry_public from public, anon, authenticated;
grant select on public.course_registry_public to service_role;
