# Backlog

Tracked work that is intentionally deferred. Newest first.

## Batched Finder reads (phase 1 done)

Finder uses **`GET /v1/tee-times?ids=`** (snapshot batch, ≤20 slugs). The Worker
**live-fills** miss/stale/empty rows from vendors in that same request so the
browser mostly sees 1–2 calls instead of a per-course waterfall. Freshness is
tiered to match poller claim lag; overnight Find trusts last evening's non-empty
snapshot while the poller sleeps. Client still falls back only when a slug is
missing or `live_failed`. Course detail still uses `/v1/availability`.

**Poller:** each 5-minute tick claims hot dates (today+tomorrow) first in a large
batch, then a small warm/cold residual; vendor polls run with concurrency 8 so
hot snapshots approach the 5-minute target instead of 15–20+ minutes.

**Later:** migrate CoursePage to batch-of-1; stronger poller runtime for
Cloudflare/captcha vendors (CPS, TenFore).

## Per-course timezone (BLOCKER for out-of-state courses)

**Do this before adding any course outside Utah / Mountain Time.**

The availability pipeline currently hardcodes `America/Denver` everywhere:

- `worker/availabilityPoll.js` → `const MT = 'America/Denver'` drives `mtParts`,
  `wallClockToUtcInstant`, `playStartsAtIso`, `rawTimeToLocalTime`, and golf-hours gating.
- `worker/index.js` → `utcIsoToMtLocal()` (TeeItUp normalizer) hardcodes `America/Denver`.
- `frontend/src/lib/teeTimeInstant.ts` → defaults to `UTAH_TEE_TIMEZONE`.

A course in Pacific/Arizona/etc. would store and display tee times off by ≥1 hour.

**Fix:** thread `course.timezone` (field already exists on the record, currently
unused) through the poller storage + normalizers, defaulting to `America/Denver`
so existing Utah courses are unchanged. Also revisit the Utah-only search
centroids (`utahZipCentroids.json`) and default map anchor for real multi-state search.

## Promote booking-link-only platforms to live inventory

`tenfore` (1 — The Ranches) is deep-link only.
API exists (`https://swan.tenfore.golf/api`, vanity `theranches` → `golfCourseID` 16515,
`TeeTimes/Search?golfCourseIds=…`) but **TeeTimes/Search requires Google reCAPTCHA
Enterprise** (`X-Recaptcha-Token` / `X-Recaptcha-Action`). No viable worker path without
a browser captcha solve or TenFore cooperation. Keep booking-link-only until that changes.

`cps` (1 — Glenmoor) is deep-link only today. Club Prophet Online Res has a working
tee-times JSON API (`…/onlineres/onlineapi/api/v1/onlinereservation/TeeTimes`) with a
short-lived client-credentials token, but **API calls outside a cleared browser hit
Cloudflare managed challenge**. Deep links use case-sensitive `Date` / `Player` / `Hole`
/ `CourseId` query params.

**Done:** `trutee` (4 St. George munis) — Convex public query
`teetimes/publicTeeTimes:getSingleCourseTeeTimes` via `https://backend.trutee.app/api/query`.

**Done:** `golfpay` (Barn Golf Club) — public `GET https://golfpay.co/api/tee-times?course_id=&date=`.
Requires `golfpay_course_id` (`_gshcid`). Skips `is_online_block` placeholder rows.
Upstream is slow (often 15–25s); worker uses a 30s fetch timeout.

`foreup_login` is a genuine auth-gated variant (no courses use it currently —
Purple Sage was reclassified to plain `foreup` once confirmed public). If a truly
login-gated ForeUp course is added later, polling it needs secure per-course
service credentials.
