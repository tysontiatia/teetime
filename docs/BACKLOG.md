# Backlog

Tracked work that is intentionally deferred. Newest first.

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

`trutee` (4 UT courses), `golfpay` (1), `tenfore` (1) are deep-link only.
Each needs a poller fetch+normalize adapter (same recipe as the TeeItUp adapter).
Main unknown per platform is the vendor's tee-times JSON API + auth model.

`foreup_login` is a genuine auth-gated variant (no courses use it currently —
Purple Sage was reclassified to plain `foreup` once confirmed public). If a truly
login-gated ForeUp course is added later, polling it needs secure per-course
service credentials.
