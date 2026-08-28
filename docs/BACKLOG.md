# Backlog

Tracked work that is intentionally deferred. Newest first.

## Outbound booking click analytics

Stamp campaign params on vendor booking URLs at click/send time (not on stored
catalog `booking_url`s) so courses/vendors can attribute traffic: e.g.
`utm_source=tee-time`, `utm_medium` by surface (find / course / alert / share).
ForeUp hash routes (`#/teetimes`) need query params *before* the hash.

UTMs only show up in the destination’s analytics, and many tee-sheet SPAs drop
unknown params. Don’t treat this as Tee-Time’s own metrics.

Better first step we already half-have: log outbound clicks on our side
(`onOpenedBooking` on the slot sheet) by course, vendor, and surface. Conversion
(completed booking) still needs a vendor partnership or affiliate ID.

`rel="noreferrer"` on Book links currently strips referrer, so UTMs would beat
referrer for partner reports if they survive.

## Batched Finder reads (phase 1 done)

Finder uses **`GET /v1/tee-times?ids=`** (≤20 slugs). The Worker **always
live-fills** every requested course from vendors in that request (snapshots are
fallback only when a vendor call fails). Filter in Find still applies: selected
**holes** and **players** — booking tee sheets often show 9+18 and 1-spot times
together, which can look like “missing” inventory on our side.
Course detail uses the same batch-of-1 path.

**Poller:** each 5-minute tick claims hot dates (today+tomorrow) first in a large
batch, then a small warm/cold residual; vendor polls run with concurrency 8 so
alerts stay near-live.

**Done:** Find opt-in **Any holes** (`holes=any`) merges 9+18 client-side; default
remains 18. Find keeps chips painted across refetch and shows a Checking badge
while a course is pending.

**Later:** stronger poller runtime for Cloudflare/captcha vendors (CPS, TenFore);
fix TeeItUp courses returning upstream 404; optional Worker `holes=any` batch
(and 18-first paint) if Any feels slow under load.

## Per-course timezone — DONE

Threaded `course.timezone` (default `America/Denver`) through poller storage,
batch live-fill, TeeItUp normalizers, and frontend display / time-of-day filters.
Find ZIP search uses Utah centroids first, then catalog address ZIPs for other
states; `cityFromAddress` parses any US state.

**Still needed before bulk out-of-state:** add courses with correct `timezone` in
admin; optional nationwide ZIP centroid file if catalog ZIP fallback is thin.

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
