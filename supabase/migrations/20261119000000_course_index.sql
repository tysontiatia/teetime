-- National course index from the 18Birdies export: one row per club + course
-- layout. Loaded by scripts/load-course-index.mjs and linked to existing
-- courses by scripts/match-course-index.mjs. Never read by the public site.
--
-- Only factual course data is stored. 18Birdies' user ratings, review counts,
-- difficulty and pace scores, and staff emails are dropped before loading.

create table if not exists public.course_index (
  course_key        text primary key,          -- '{club uuid}:{course slug}'
  club_id           uuid not null,             -- 18Birdies club id (from the club URL)
  course_slug       text not null,
  course_name       text,
  course_position   int not null default 0,
  course_count      int not null default 1,
  layout_kind       text not null default 'main'
                      check (layout_kind in ('main', 'rotation', 'short')),

  club_name         text not null,
  source            text not null default '18birdies',
  source_url        text,
  state             text,
  city              text,                      -- '' when the source did not clearly give one
  zip               text,
  address           text,
  lat               double precision,
  lng               double precision,
  timezone          text,                      -- exact zone for the pin (geo-tz)
  timezone_pin      text,

  phone             text,
  website           text,                      -- the course's own site, or a shared host
  website_kind      text check (website_kind in ('own', 'directory', 'shared', 'none')),
  website_host      text,
  directory_url     text,                      -- a directory or social page, never crawled

  membership        text,
  bookable          text not null check (bookable in ('auto', 'review', 'drop')),
  fee_text          text,
  club_holes        int,
  holes             int,
  par               int,
  yardage           int,
  tees              jsonb not null default '[]'::jsonb,  -- [{name, gender, yards, rating, slope}]

  -- Link to an existing course (set by the matcher, or a reviewer)
  registry_slug     text references public.course_registry (slug) on delete set null,
  match_method      text check (match_method in ('club_id', 'name_zip', 'name_near', 'layout_of', 'reviewer')),
  match_status      text not null default 'unmatched'
                      check (match_status in ('unmatched', 'linked', 'review', 'new', 'dropped', 'rejected')),
  match_note        text,
  matched_at        timestamptz,

  -- Booking-link crawl queue (filled in a later step)
  crawl_status      text,
  crawl_attempts    int not null default 0,
  crawl_next_at     timestamptz,
  crawl_result      jsonb,

  loaded_at         timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists course_index_club_idx on public.course_index (club_id);
create index if not exists course_index_state_idx on public.course_index (state, match_status);
create index if not exists course_index_registry_idx on public.course_index (registry_slug) where registry_slug is not null;
create index if not exists course_index_crawl_idx on public.course_index (crawl_next_at nulls first)
  where crawl_status in ('queued', 'retry');

comment on table public.course_index is
  'National course index (18Birdies export), one row per club + layout. Factual data only. Service role only.';

alter table public.course_index enable row level security;
revoke all on public.course_index from public, anon, authenticated;
grant select, insert, update, delete on public.course_index to service_role;
