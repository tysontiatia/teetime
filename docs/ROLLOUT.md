# National rollout checklist

Required before courses outside the Mountain West go live, and before each new
state after that. Utah stays on manual approval; auto-publish starts with the
next state.

## Before any state outside Mountain Time goes live

These still read the clock in `America/Denver`. Each one gives a Pacific,
Central, Eastern, Alaska, or Hawaii course the wrong "today" for part of the day.

- [ ] **Booking-window check (most urgent).** `worker/index.js` (ForeUp, the
      `isPastBookingWindow(... ymdInTimeZone('America/Denver'))` call) and
      `worker/golfwithaccess.js`. Between midnight Eastern and midnight Mountain,
      an East Coast course's next bookable day is judged against yesterday, so an
      empty sheet can be reported as "outside the booking window" or the reverse.
      Use the course's zone (`courseTimezoneFor`) for "today".
- [ ] **Alert email dates.** `worker/alertCopy.js` formats tee times and "today /
      tomorrow" in Mountain Time. Format in the course's zone.
- [ ] **Alert evaluation.** `worker/notifications.js` `mtTodayYmd()` (backstop
      dates, search watches, the 45-day log window). The poller already passes the
      course's date; make the fallbacks use the course's zone too.
- [ ] **Feed.** `worker/feedRead.js` "today" and time labels.
- [ ] **Availability reads.** `worker/availabilityRead.js` `MT_TZ` defaults and the
      date label at line ~524. Courses from `loadCourses` carry their zone, so this
      is the fallback for records without one.
- [ ] **Time helpers.** `worker/index.js` `utcIsoToMtLocal` and the Denver default
      at line ~1085: default to the course's zone, not Mountain.
- [ ] Re-run `node scripts/backfill-course-timezones.mjs` (dry run, then `--apply`)
      after each import, so every course has an exact zone stamped for its pin.

## Before the large course-index import

- [ ] Photo job only for public courses, website `og:image` first, Google last.
- [ ] Polling tiers by visitor state plus on-demand fetches cached 5–10 minutes.
- [ ] Phone-only courses: on the map and course pages, never in default results.
- [ ] Auto-publish only after real tee times on two checks on different days and a
      vendor name match; daily "went live" list with one-click unpublish.

## Site (Cloudflare Pages) deploy

- [ ] Fix the frontend lint errors in `src/stay/` (CI blocks the build on them).
- [ ] Review the new Find UI, then deploy Pages. That ships the app's switch to
      `/v1/courses/index`, per-course records, and server-only tee-time reads, and
      the landing page's switch to `/v1/coverage`.
- [ ] After Pages is live, remove the temporary `photo_reference: 'stored'` flag
      in `worker/index.js` `loadCourses`, then stop serving the full list from
      `/v1/courses` with no `slugs` (nothing new uses it).

## Rollback reference

| Change | Undo |
|---|---|
| Worker deploy | `npx wrangler rollback <previous version id>` (`npx wrangler deployments list --config worker/wrangler.toml`) |
| 18 Nov migrations | `supabase/rollback/20261118_course_pipeline_rollback.sql` |
| Time-zone backfill | `node scripts/backfill-course-timezones.mjs --restore data/backups/<file>` |
