# Google OAuth branding (Tee-Time)

Goal: Google’s account picker should show **Tee-Time** / **tee-time.io** (or `auth.tee-time.io`), not `nmwlebcvezybfwertlzs.supabase.co`.

## Why it looks wrong today

Sign-in goes: App → Google → **Supabase Auth callback** (`*.supabase.co/auth/v1/callback`) → back to `tee-time.io/auth/callback.html`.

Google labels “continue to …” with the **OAuth redirect host** (Supabase) unless you brand the consent screen and ideally use a **custom Auth domain**.

## Step A — Google Cloud branding (do this first)

1. Open [Google Auth Platform → Branding](https://console.cloud.google.com/auth/branding) for the project that owns the Tee-Time OAuth client.
2. Set:
   - **App name:** `Tee-Time`
   - **User support email:** your ops address (e.g. `support@tee-time.io`)
   - **App logo:** square Tee-Time mark (≥120×120)
   - **App domain / home page:** `https://tee-time.io`
   - **Privacy / Terms:** `https://tee-time.io/privacy.html`, `https://tee-time.io/terms.html`
3. **Authorized domains:** add `tee-time.io` (verify ownership in [Search Console](https://search.google.com/search-console) if asked). Keep the Supabase project host if listed.
4. **Audience:** Production / publish the app (not Internal-only) so all golfers see branded UI.
5. Submit **brand verification** if Google prompts — can take a few business days.

After this, many users see the **app name** with less emphasis on the ugly host. The `*.supabase.co` host may still appear until Step B.

## Step B — Custom Auth domain (best fix for the URL)

Use Supabase **Custom Domains** so the redirect host is yours, e.g. `auth.tee-time.io`.

1. Supabase Dashboard → **Project Settings** → **Custom Domains** (requires a paid plan tier that includes this).
2. Add `auth.tee-time.io` and follow their DNS instructions (usually a CNAME to Supabase at Cloudflare).
3. In **Google Cloud → Credentials → OAuth 2.0 Client**:
   - **Authorized redirect URIs** must include:  
     `https://auth.tee-time.io/auth/v1/callback`  
     (keep the old `https://nmwlebcvezybfwertlzs.supabase.co/auth/v1/callback` until cutover is verified).
4. Point the app / Supabase client at the custom Auth URL if Supabase shows a new API URL (or keep Project URL if they only remap Auth — follow the dashboard copy).
5. Update any hardcoded `https://nmwlebcvezybfwertlzs.supabase.co` in:
   - `frontend/src/lib/env.ts` (or env vars)
   - `public/auth/callback.html`
   - `public/index.html` (landing auth)
   - `worker/wrangler.toml` `SUPABASE_URL` if Auth issuer changes
6. Smoke-test: Sign in with Google → account chooser should say **continue to auth.tee-time.io**.

## Product rules (locked)

| Action | Anonymous | Signed in (Google preferred) |
|--------|-----------|------------------------------|
| Search / compare tee times | Yes (soft IP abuse limits only) | Yes |
| Openings feed | Yes | Yes |
| Email alerts, saved courses, share/plan rounds | Sign-in required | Yes |

Do **not** gate first search behind Google. Abuse is handled by Worker rate limits on `/v1/availability`, `/v1/feed`, vendor proxies, and Places.

## Related

- Local / preview redirect allowlist: [DEVELOPMENT.md](./DEVELOPMENT.md#google-oauth-in-local--preview)
- Supabase: [Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
