# Tee-Time.io

Universal tee time search for Utah golf courses. One set of filters, every course, every platform, every open slot.

Live at **[tee-time.io](https://tee-time.io)**

---

## What it does

- Searches 67 Utah courses simultaneously across ForeUp, Chronogolf, and MemberSports
- Filters by date, players (1–4), holes (9/18), and region
- **Near Me** tab sorts results by distance using browser geolocation
- Links directly to the course's booking page — nothing is booked automatically
- Saves favourite courses and syncs them across devices (requires account)
- **Notification alerts** — email via Resend when tee times match a **specific date** or a **weekly window** (open-ended, next *N* days)
- Google profile avatar shown in header for OAuth users
- Course cards show Google Places photos, ratings, and review counts
- Custom desktop calendar date picker (replaces native date input on screens ≥600px)
- Course detail panel with photo, address, rating, and all available times

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite in `frontend/`, served at **`/app/`**; `public/app.html` redirects legacy links |
| Landing page | `public/index.html` |
| Auth | Supabase (Google OAuth + email/password) |
| Database | Supabase PostgreSQL (profiles, saved courses, notification prefs, notification log) |
| API proxy | Cloudflare Worker (`worker/index.js`) |
| Notifications | Cron trigger on Worker → Resend email API |
| Email | Resend (verified domain: `tee-time.io`, from: `alerts@tee-time.io`) |
| Hosting | Cloudflare Pages (`utah-tee-times` project) |
| Domain | `tee-time.io` (Cloudflare DNS) |
| Analytics | PostHog |

---

## Auth & Access

The app is behind a two-step gate:

1. **Early access code** — users enter a code + survey answers on the landing page
2. **Supabase account** — after the code is verified, the auth modal opens (Google OAuth or email/password). The signup toggle is hidden unless the user came through the access code flow (prevents direct signup bypass).

Returning users with an active session are auto-redirected from the landing page to the app.

### Supabase project

- Project ref: `nmwlebcvezybfwertlzs`
- URL: `https://nmwlebcvezybfwertlzs.supabase.co`
- Auth providers: Google OAuth, email/password

### Database schema

```sql
profiles                    -- auto-created on signup via trigger
  id, display_name, phone, notify_via, created_at

saved_courses               -- user's starred courses
  id, user_id, course_id, created_at

notification_preferences    -- per-course alert config
  id, user_id, course_id,   -- course_id matches courses.json `name` (same as app `catalogName`)
  target_date,              -- set for “specific date”; null for weekly / open-ended
  look_ahead_days,           -- when target_date is null: scan each matching weekday for N days ahead
  players,                  -- number of players (1–4); also used for vendor APIs that need it
  days_of_week,             -- int[] (0=Sun … 6=Sat); used when target_date is null
  earliest_time, latest_time,  -- time window filter (HH:MM)
  min_spots,                -- minimum available spots
  active,                   -- toggle on/off
  created_at

notification_log            -- dedupe + cooldown (see migration 20260420000000)
  id, user_id, course_id, target_date (nullable), channel, times_found, sent_at
  -- specific-date: at most one meaningful send per (user, course, calendar date)
  -- weekly: same triple can send again after 24h (worker checks sent_at)
```

All tables have RLS enabled — users can only read/write their own rows.

---

## Notification system

Signed-in users set an alert from the 🔔 modal: **specific date** (one play day) or **weekly** (a weekday + time window, scanning `look_ahead_days` ahead, default 14). When the Worker cron finds matching inventory, it sends **email** (Resend) and/or **SMS** (Twilio) from the user’s profile **`notify_via`** / **`phone`**, and writes **`notification_log`** per channel.

### Flow

1. User taps 🔔 on a course card → modal opens (`NotificationModal`)
2. User chooses **Specific date** or **Weekly**, time window, players → row in `notification_preferences`
3. Cron on the **Worker** runs every **15 min** (6 AM–11 PM UTC): `*/15 6-23 * * *` in `worker/wrangler.toml`
4. Worker loads prefs: **`target_date` set and ≥ today** (within 14 days), **or** **`target_date` null** with **`look_ahead_days` set** (weekly / open-ended)
5. For weekly prefs, each run evaluates calendar dates in the lookahead window whose weekday is in `days_of_week`
6. Work is grouped by **`course_id` + calendar date** so tee times are fetched once per group (18 holes; `players` = max needed in that group for APIs that require it)
7. Filters slots by each user’s `earliest_time` / `latest_time` and `min_spots` / `players`
8. If there are matches: skip if **specific** and a log row already exists for that user+course+date **and channel**; skip if **weekly** and a log row for that triple exists with **`sent_at` within 24h**; otherwise send on each enabled channel (email / SMS) and **insert `notification_log`** (always with the **calendar `target_date`** evaluated, even for weekly prefs)

**Deploy:** changing `worker/index.js` requires **`cd worker && npx wrangler deploy`** — Cloudflare **Pages** deploys do not update the Worker.

### Empty state CTAs

When a course shows "No available tee times" or "Booking not yet open for this date", logged-in users see a **"🔔 Get notified when times open up"** link that opens the notification modal.

### Worker secrets (set via `wrangler secret put`)

- `SUPABASE_SERVICE_KEY` — Supabase service role key (bypasses RLS)
- `RESEND_API_KEY` — Resend API key for sending emails
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — Twilio REST API for SMS (`TWILIO_FROM_NUMBER` must be E.164, e.g. `+18015551234`, and a number or messaging service your account is allowed to send from). If any of these are missing, SMS alerts are skipped (email still works).

**SMS / Twilio checklist:** US A2P 10DLC or a **verified toll-free** sender is usually required for production traffic to US mobiles; check the Twilio console for registration status and error codes. After deploy, use **Workers → utah-tee-times → Logs** (or `wrangler tail`) when testing—failed sends log Twilio’s HTTP status and response body.

Account UI: **`/app/account`** — phone + **Alert channel** (`email` / `sms` / `both`).

---

## Booking platforms

| Platform | Endpoint | Courses | Notes |
|---|---|---|---|
| `foreup` | ForeUp public API | 37 | Requires `schedule_id`, optional `booking_class_id` |
| `chronogolf_slc` | Chronogolf club-specific API (`/marketplace/clubs/{id}/teetimes`) | 17 | Requires `club_id`, `course_id`, `affiliation_type_id`. All former `chronogolf` courses were migrated to this endpoint — the marketplace search endpoint (`/v2/teetimes`) returns "closed" for these clubs. |
| `chronogolf` | Chronogolf marketplace v2 (`/v2/teetimes`) | 0 in UT | Still supported in worker + React for other regions where the club endpoint is not used. |
| `membersports` | MemberSports POST API | 10 | Requires `golf_club_id`, `golf_course_id` |
| `foreup_login` | ForeUp (login-gated) | 1 | No worker proxy yet; React shows booking-site + roadmap copy until a JWT-aware path exists. |
| `golfpay` | — | 1 | No API support yet; booking link in UI + catalog. |
| `tenfore` | — | 1 | No API support yet; booking link in UI + catalog. |

The React app’s `frontend/src/lib/platformRegistry.ts` classifies platforms for UX (`live_inventory` vs `booking_link_only` vs `auth_gated_planned`); expand that file when you add a worker route.

The Cloudflare Worker proxies requests to each platform's API and returns results with CORS headers. Sessions for ForeUp and Chronogolf are cached in-memory for 30 minutes.

### Chronogolf note

All Chronogolf courses use the **club-specific** endpoint (`chronogolf_slc` platform), not the marketplace v2 search. The marketplace endpoint returns `{ "status": "closed" }` for these SLC-area clubs even when times are available. The club endpoint requires `club_id` (numeric), `course_id` (numeric, first course), and `affiliation_type_id`.

When the club endpoint returns `status: "closed"`, the app shows **"Booking not yet open for this date"** instead of a generic error.

---

## Course data (`courses.json`)

Each course entry contains:

```json
{
  "name": "Rose Park (SLC)",
  "area": "SALT LAKE CITY AREA",
  "platform": "chronogolf_slc",
  "club_id": "14222",
  "course_id": "16310",
  "affiliation_type_id": "57710",
  "booking_url": "https://www.chronogolf.com/club/14222",
  "lat": 40.7982542,
  "lng": -111.9261956,
  "photo_url": "https://lh3.googleusercontent.com/places/...",
  "rating": 3.6,
  "review_count": 205,
  "address": "1386 N Redwood Rd, Salt Lake City, UT 84116, USA"
}
```

Fields vary by platform. `lat`/`lng` are required for Near Me sorting. `photo_url`, `rating`, `review_count`, and `address` are fetched via Google Places API using `scripts/fetch-place-data.mjs` (requires `GOOGLE_PLACES_KEY` env var).

The root `courses.json` and `public/courses.json` must stay in sync. Always edit `public/courses.json` (the source of truth) and copy to root, or vice versa.

---

## Analytics (PostHog)

Events tracked:

| Event | Where | Data |
|---|---|---|
| `early_access_signup` | Landing page | email, code, discovery, frequency, WTP |
| `posthog.identify` | App on sign-in | email |
| `search_performed` | App | date, players, holes, region |
| `results_returned` | App | count, search_date, players |
| `course_saved` | App | course_name |
| `region_tab_switched` | App | region |
| `tee_time_clicked` | App | course, time, price |
| `outbound_booking_click` | App | course_name, time, price |

---

## File structure

```
tee-time/
├── public/
│   ├── index.html            ← Landing page (early access form + auth modal)
│   ├── app.html              ← Redirect to `/app/` (legacy `/app.html` URLs)
│   ├── _redirects            ← Cloudflare Pages SPA rules for `/app/*`
│   ├── auth/
│   │   └── callback.html     ← OAuth redirect handler
│   ├── courses.json          ← Master list of 67 courses (source of truth)
│   └── images/
│       ├── app-desktop.png
│       └── app-mobile.png
├── worker/
│   ├── index.js              ← Cloudflare Worker (CORS proxy + cron notification handler)
│   └── wrangler.toml         ← Worker config (cron trigger, env vars, secrets)
├── frontend/                 ← React SPA (build → merged into `deploy/app/`)
├── courses.json              ← Copy of public/courses.json (keep in sync)
├── scripts/
│   ├── fetch-place-data.mjs  ← Fetch Google Places photos/ratings for all courses
│   ├── fetch-place-patch.mjs ← Patch Google Places data for specific courses
│   ├── add-course-fields.mjs ← Add fields to courses
│   ├── geocode.mjs           ← Geocode courses via Google Maps
│   ├── geocode-patch.mjs     ← Patch geocoding for specific courses
│   ├── geocode-manual.mjs    ← Manual geocoding
│   └── build-pages.sh        ← `npm ci` + ESLint + Vite build + assemble `deploy/` for Pages
└── supabase/
    ├── config.toml
    └── migrations/
        ├── 20260416212118_initial_schema.sql
        ├── 20260416220000_notification_alerts.sql
        └── 20260420000000_notification_open_ended.sql
```

---

## Deploy

### GitHub CLI

Install (macOS): `brew install gh`, or from the repo root: `brew bundle install` (see `Brewfile`). Then authenticate once: `gh auth login`.

Re-run the latest failed deploy without pushing a commit:

```bash
gh run rerun --failed
```

List recent deploy runs: `gh run list --workflow deploy.yml -L 10`

### Worker

CI deploys the Worker with **`cloudflare/wrangler-action`** using `deploy --config worker/wrangler.toml` from the repo root (same API token pattern as Pages).

```bash
cd worker && npx wrangler deploy
```

GitHub **`CLOUDFLARE_API_TOKEN`** must allow **Workers Scripts → Edit** (and usually **Account → Workers Scripts → Read**). A **Pages-only** token will deploy the site but fail the Worker step.

Worker URL: `https://utah-tee-times.tysontiatia.workers.dev`

### Frontend (Cloudflare Pages)

The live bundle is **`public/`** (marketing, auth callback, static JSON) plus the **Vite build** copied to **`app/`** (React SPA at `https://tee-time.io/app/`). SPA fallbacks are listed in `public/_redirects` per route (not `/app/*`, so `/app/assets/*` is not rewritten to HTML). When you add new top-level client routes under `/app/`, add a matching line there. Assemble and deploy:

```bash
bash scripts/build-pages.sh
npx wrangler pages deploy deploy --project-name utah-tee-times
```

Optional Vite overrides at build time (defaults match production Supabase + worker): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WORKER_URL`. Local dev loads `courses.json` via Vite proxy to `tee-time.io`.

Production URL: `https://tee-time.io` (custom domain on Cloudflare Pages)

### Supabase migrations

```bash
supabase link --project-ref nmwlebcvezybfwertlzs
supabase db push
```

---

## Google OAuth setup

1. Google Cloud Console → APIs & Services → OAuth consent screen
   - App name: `Tee Time`
   - Authorised domain: `tee-time.io`
2. Create OAuth 2.0 Client ID (Web application)
   - Authorised redirect URI: `https://nmwlebcvezybfwertlzs.supabase.co/auth/v1/callback`
3. Paste Client ID + Secret into Supabase → Auth → Providers → Google

Supabase → Auth → URL Configuration → add `https://tee-time.io/auth/callback.html` to allowed redirect URLs.

---

## Key UI details

- **Mobile close**: Course detail panel has an X close button (`.cd-close`) at top-right for mobile users
- **Calendar**: Custom dropdown calendar for desktop (hides native `<input type="date">`). Matching calendar in notification modal.
- **Notification modal**: Time-of-day window is a `<select>` (any / morning / afternoon / evening), not per-minute pickers
- **Toast notifications**: Slide-up toasts for save/delete confirmations (auto-dismiss after 4.5s)
- **Avatar**: Google OAuth users see their profile photo in the header; fallback to first initial
- **Favourites**: Star button on course cards, stored in localStorage + synced to Supabase `saved_courses` for logged-in users
