# Local development & SDLC

This guide explains how to develop and test Tee-Time **without deploying to production** for every change.

## Environments

| Environment | URL | Auth | Worker | LaunchDarkly |
|---|---|---|---|---|
| **Local** | `http://localhost:5173/app/` (port is fixed) | Yes (after Supabase URL setup) | Optional local (`wrangler dev`) or production | `test` |
| **PR preview** | `https://<hash>.utah-tee-times.pages.dev` | Yes (after Supabase wildcard) | Production worker (read APIs) | `test` |
| **Production** | `https://tee-time.io` | Yes | Production worker | `production` |

## Quick start (local)

```bash
# Terminal 1 — React app with hot reload
npm run dev

# Terminal 2 (optional) — local Worker API
npm run dev:worker
```

Open **http://localhost:5173/app/**

Optional: copy `frontend/.env.example` → `frontend/.env.local` and set:

```bash
VITE_WORKER_URL=http://127.0.0.1:8787
VITE_LAUNCHDARKLY_CLIENT_SIDE_ID=6a4e663319d3db0a5e25b9d1
```

If you skip `VITE_WORKER_URL`, the app uses the **production Worker** for tee-time fetches (fine for UI work).

## Google OAuth in local & preview

OAuth flow:

1. App calls Supabase `signInWithOAuth` with `redirectTo: <origin>/auth/callback.html`
2. Google → Supabase (`https://nmwlebcvezybfwertlzs.supabase.co/auth/v1/callback`) — **fixed, no change needed in Google Console**
3. Supabase redirects back to your app's `/auth/callback.html`
4. Callback page stores the session and sends you to `/app/`

**You only need to allowlist redirect URLs in Supabase** (not Google) for each environment origin.

### One-time Supabase setup

Supabase Dashboard → **Authentication** → **URL Configuration** → **Redirect URLs**

Add (wildcards cover the OAuth callback and any query/hash Supabase appends):

```
http://localhost:5173/**
http://127.0.0.1:5173/**
https://tee-time.io/**
https://*.utah-tee-times.pages.dev/**
```

**Important:** Vite is pinned to port **5173** (`strictPort: true`). If you were on `localhost:5175`, Supabase rejected the redirect and sent you to the **Site URL** (`https://tee-time.io`) instead — that’s the bug you saw.

If wildcards are not accepted, add the exact callback URL:

```
http://localhost:5173/auth/callback.html
```

If preview sign-in fails, add that preview origin’s callback URL too.

**Site URL** can stay `https://tee-time.io`.

### What works locally after setup

| Feature | Local | Notes |
|---|---|---|
| Browse tee times | ✅ | Uses Worker (prod or `wrangler dev`) |
| Google sign-in | ✅ | Requires Supabase redirect URLs above |
| Saved courses / alerts | ✅ | Same Supabase project as prod |
| Course photos | ✅ | Via production Worker `/place-photo` |
| Phone SMS verify | ⚠️ | Needs `wrangler dev` + Twilio secrets |
| Notification cron | ❌ | Worker cron only runs in Cloudflare |

For most feature work, **local + production Worker** is enough. Use `npm run dev:worker` when changing Worker routes.

## SDLC workflow

```
feature branch → local dev (npm run dev) → open PR
    → CI lint/build → Cloudflare preview deploy
    → merge to main → production deploy
    → LaunchDarkly flag rollout in production
```

### PR checks

Every pull request runs lint + build (no deploy).

### Preview deploys

Every pull request deploys a **Cloudflare Pages preview** URL. Test the full built app without touching production.

### Production deploy

Merging to `main` deploys Pages + Worker automatically.

## LaunchDarkly by environment

- **Local / preview:** `test` environment (`6a4e663319d3db0a5e25b9d1`)
- **Production:** `production` environment (`6a4e663319d3db0a5e25b9d2`) — set via `VITE_LAUNCHDARKLY_CLIENT_SIDE_ID` in the production build

Ship new features behind flags (default OFF in production), then enable via the LaunchDarkly dashboard without redeploying.

## Catalog changes

Local dev serves `public/courses.json` from your repo (not production). Edit `public/courses.json`, refresh the browser — no deploy needed to test catalog changes.
