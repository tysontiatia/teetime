# Handoff: course pipeline and national rollout (18 Nov 2026)

Read this before changing anything. It describes what is live, what is in
progress, and the rules the owner has set.

## Where things stand

- **Branch:** `course-pipeline-fixes` (local only, not pushed). It holds the
  in-progress Cursor UI work (`fbeda34`, unreviewed) plus the pipeline work on top.
- **Live Worker** (`api.tee-time.io`): deployed from this branch by hand with
  Wrangler. Current version `739768c6-4a76-47f1-9507-4512e8dbe808`.
- **Live site (Cloudflare Pages):** still the old `main` frontend. The new Find UI
  in `frontend/src/stay/` is **not** deployed (14 lint errors block CI; favorites,
  plans, alerts and pricing pages are unfinished).
- **Database:** migrations through `20261119000000_course_index.sql` are applied.

## ⚠️ Do not

- **Do not push to `main`.** CI deploys `main` (Pages + Worker) and would replace
  the live Worker with the old one, undoing the fixes below. Merge this branch
  through a pull request instead, after the owner reviews the UI preview.
- **Do not deploy Pages** until the UI is finished and reviewed.
- **Do not overwrite existing course fields** from the 18Birdies index. Only blank
  fields are filled; booking fields (`platform`, `booking_url`, vendor ids,
  `booking_status`) are never touched by the index.
- **Do not publish 18Birdies' user ratings, review counts, difficulty or pace
  scores, or emails.** Only factual data (address, phone, website, holes, par,
  yardage, tees with course rating/slope, coordinates).
- **Do not call Google Places for courses that are not public**, or before trying
  the course website's og:image.
- **Utah stays on manual approval.** New Utah courses are hidden `pending` stubs.

## What changed today (all live on the Worker)

1. **Google spend:** photo job records failures and backs off (stops for good on
   `NOT_FOUND`); no second Place Details call on save; photos only for public
   courses, og:image first.
2. **Time zones:** each course's zone comes from its coordinates (`worker/courseTimezone.js`).
   Exact zones are computed in Node with `geo-tz` and stamped with `timezone_pin`;
   the Worker trusts a stamped zone and falls back to `tz-lookup`. The poller uses
   each course's own clock for golf hours, the 8:00 release burst, and "today".
3. **Poller CPU:** a minute-by-minute time conversion pushed runs past the 30 s
   CPU limit; it is now direct. Duplicate tee times and mixed event rows no longer
   make Postgres reject whole batches.
4. **Course reads:** full pagination, fail loudly, never a partial list
   (`fetchAllRows` in `worker/courseAdmin.js`). Public reads use the
   `course_registry_public` view.
5. **Catalog split:** `/v1/courses/index` (list fields), `/v1/courses/:slug` and
   `?slugs=` (full records), `/v1/coverage`. `/v1/courses` still serves every full
   record for the old frontend, with vendor ids like `clubcaddie_apikey` removed
   (they are also in each public booking URL, so nothing needs rotating).

## National course index (in progress)

- Source: 18Birdies export in `~/Documents/USA Courses/` (66 state files + retry
  file; 15,025 clubs, 18,341 course layouts).
- Table `course_index`: one row per club + layout. Code: `worker/courseIndex.js`
  (cleaning + matching), `scripts/load-course-index.mjs`,
  `scripts/match-course-index.mjs`, `scripts/queue-course-crawl.mjs`,
  `worker/courseIndexCrawl.js` (15-minute crawl into hidden QA stubs).
- Every script is a dry run unless given `--apply`, and backs up before writing
  to `data/backups/` (gitignored).
- **Utah:** loaded and matched. 108 of 112 existing courses linked, blank fields
  filled (tees, yardage, par, holes, phone). 5 new public clubs queued for the
  crawl (Mulligan's South Jordan, ParOne Skyridge, Granite View, Green River
  State Park, Central Valley). Rejected: Red Ledges par-3 listing, Timpanogos
  Pasture duplicate, Hubbard (Hill AFB, military).

## Owner's decisions (rules)

- Import automatically: Public, Municipal (incl. "City/Minu", "city/miui"),
  Semi-Private. To QA: Resort, Others, blank. Drop: Private, Military.
- Matching: 18Birdies club id first, then name + ZIP, then name within ~1 km;
  anything else to review.
- Auto-publish (from the second state on): only after real tee times on two
  checks on different days and a vendor name match; daily "went live" list with
  one-click unpublish.
- Phone-only courses: allowed for bookable types, never in default tee-time results.
- Polling: tiers by visitor state plus on-demand fetches cached 5–10 minutes.
- "Top rated" replaced by a curated `featured` list and an "Open this weekend" row.

## Next steps

1. Owner approves the Utah stubs in booking QA (local admin works:
   `npm run dev` → `localhost:5173/app/admin/courses/qa`).
2. **Required before any non-Mountain state:** fix the remaining `America/Denver`
   uses, listed in `docs/ROLLOUT.md` (booking-window check first).
3. Pick the second state; run load → match → queue there, with auto-publish on.
4. State-based polling and on-demand caching.
5. UI: fix lint, finish pages, show a load error instead of the stale 74-course
   fallback, open a PR for a preview, merge after review.

## Verify / roll back

- Tests: `npm test` (worker, 200+ tests). Frontend: `cd frontend && npx tsc -b && npm run build`.
- Worker rollback: `npx wrangler rollback <version>` (`npx wrangler deployments list --config worker/wrangler.toml`).
- 18 Nov migrations: `supabase/rollback/20261118_course_pipeline_rollback.sql`.
- Time-zone backfill: `node scripts/backfill-course-timezones.mjs --restore data/backups/<file>`.
- Utah index match: restore `data/backups/registry-before-index-match-UT-*.json`.
- Migrations are applied with `npx supabase@2.122.1 db push --linked` (v3 rejects
  `[inbucket]` in `supabase/config.toml`) using `SUPABASE_ACCESS_TOKEN` from
  `worker/.dev.vars`. Always `--dry-run` first.
