-- ─────────────────────────────────────────────────────────────
-- TeeItUp course seed — 5 Aspira (Utah State Parks) courses + Hideout (Monticello).
--
-- Idempotent: safe to re-run. Inserts course_catalog first (course_registry.slug
-- has a FK to it), then the authoritative runtime record into course_registry.
-- Production loadCourses() + /v1/courses read the registry, so these appear in the
-- catalog and become pollable (platform=teeitup) once applied.
--
-- Slugs equal slugFromCourseName(name) so slot storage keys line up:
--   "Soldier Hollow Gold (Midway)" -> soldier-hollow-gold-midway
--
-- NOTE: lat/lng/address are best-effort; enrich rating/reviews/photo_reference via
-- the admin portal Places lookup. facility_id = numeric (query + deep link),
-- teeitup_course_id = mongo courseId hash (poller mapping). Prices shown are the
-- non-Utah-resident rate (resident rates are login-gated).
-- ─────────────────────────────────────────────────────────────

insert into public.course_catalog (slug, name, holes) values
  ('soldier-hollow-gold-midway',   'Soldier Hollow Gold (Midway)',   18),
  ('soldier-hollow-silver-midway', 'Soldier Hollow Silver (Midway)', 18),
  ('wasatch-mountain-midway',      'Wasatch Mountain (Midway)',      18),
  ('wasatch-lake-midway',          'Wasatch Lake (Midway)',          18),
  ('palisade-sterling',            'Palisade (Sterling)',            18),
  ('hideout-golf-club-monticello', 'Hideout Golf Club (Monticello)', 18)
on conflict (slug) do update
  set name = excluded.name,
      holes = excluded.holes;

insert into public.course_registry (slug, record) values
  ('soldier-hollow-gold-midway', '{
    "name": "Soldier Hollow Gold (Midway)",
    "area": "Heber Valley",
    "platform": "teeitup",
    "facility_id": "17073",
    "teeitup_course_id": "5e208551241fa20100d28007",
    "booking_url": "https://aspira-management-company.book-v2.teeitup.golf/?course=17073",
    "holes": 18,
    "timezone": "America/Denver",
    "lat": 40.4353,
    "lng": -111.4938,
    "address": "1370 W Soldier Hollow Ln, Midway, UT 84049, USA",
    "website": "https://stateparks.utah.gov/golf/soldier-hollow/"
  }'::jsonb),
  ('soldier-hollow-silver-midway', '{
    "name": "Soldier Hollow Silver (Midway)",
    "area": "Heber Valley",
    "platform": "teeitup",
    "facility_id": "17072",
    "teeitup_course_id": "5e2084980b4f950100421968",
    "booking_url": "https://aspira-management-company.book-v2.teeitup.golf/?course=17072",
    "holes": 18,
    "timezone": "America/Denver",
    "lat": 40.4353,
    "lng": -111.4938,
    "address": "1370 W Soldier Hollow Ln, Midway, UT 84049, USA",
    "website": "https://stateparks.utah.gov/golf/soldier-hollow/"
  }'::jsonb),
  ('wasatch-mountain-midway', '{
    "name": "Wasatch Mountain (Midway)",
    "area": "Heber Valley",
    "platform": "teeitup",
    "facility_id": "17070",
    "teeitup_course_id": "5e209e580b4f950100421b7d",
    "booking_url": "https://aspira-management-company.book-v2.teeitup.golf/?course=17070",
    "holes": 18,
    "timezone": "America/Denver",
    "lat": 40.5205,
    "lng": -111.4796,
    "address": "975 Golf Course Dr, Midway, UT 84049, USA",
    "website": "https://stateparks.utah.gov/golf/wasatch/"
  }'::jsonb),
  ('wasatch-lake-midway', '{
    "name": "Wasatch Lake (Midway)",
    "area": "Heber Valley",
    "platform": "teeitup",
    "facility_id": "17067",
    "teeitup_course_id": "5e20827c6312b90100616f93",
    "booking_url": "https://aspira-management-company.book-v2.teeitup.golf/?course=17067",
    "holes": 18,
    "timezone": "America/Denver",
    "lat": 40.5205,
    "lng": -111.4796,
    "address": "975 Golf Course Dr, Midway, UT 84049, USA",
    "website": "https://stateparks.utah.gov/golf/wasatch/"
  }'::jsonb),
  ('palisade-sterling', '{
    "name": "Palisade (Sterling)",
    "area": "Sanpete County",
    "platform": "teeitup",
    "facility_id": "6847",
    "teeitup_course_id": "54f14df70c8ad60378b046ad",
    "booking_url": "https://aspira-management-company.book-v2.teeitup.golf/?course=6847",
    "holes": 18,
    "timezone": "America/Denver",
    "lat": 39.2149,
    "lng": -111.6386,
    "address": "2200 E Palisade Rd, Sterling, UT 84665, USA",
    "website": "https://stateparks.utah.gov/golf/palisade/"
  }'::jsonb),
  ('hideout-golf-club-monticello', '{
    "name": "Hideout Golf Club (Monticello)",
    "area": "San Juan County",
    "platform": "teeitup",
    "facility_id": "17083",
    "teeitup_course_id": "5e20917b0b4f950100421a54",
    "teeitup_alias": "hideout-golf-club",
    "booking_url": "https://hideout-golf-club.book.teeitup.com/?course=17083",
    "holes": 18,
    "timezone": "America/Denver",
    "lat": 37.8632,
    "lng": -109.3496,
    "address": "648 S Hideout Way, Monticello, UT 84535, USA",
    "website": "https://www.hideoutgolf.com/"
  }'::jsonb)
on conflict (slug) do update
  set record = excluded.record;
