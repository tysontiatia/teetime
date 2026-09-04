-- Run once in the Supabase SQL editor before `npm run sync:coordinates`.
-- course_catalog currently has no lat/lng columns; course_registry.record does.
alter table public.course_catalog
  add column if not exists lat double precision,
  add column if not exists lng double precision;
