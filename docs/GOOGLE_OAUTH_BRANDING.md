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
   - **App logo:** square Tee-Time mark (≥120×120 PNG). Use `public/brand/logo-google-oauth-512.png` (exported from `logo-icon-light.svg`).
   - **App domain / home page:** `https://tee-time.io`
   - **Privacy / Terms:** `https://tee-time.io/privacy.html`, `https://tee-time.io/terms.html`
3. **Authorized domains:** add `tee-time.io` (verify ownership in [Search Console](https://search.google.com/search-console) if asked). Keep the Supabase project host if listed.
4. **Audience:** Production / publish the app (not Internal-only) so all golfers see branded UI.
5. Submit **brand verification** if Google prompts — can take a few business days.

After this, many users see the **app name** with less emphasis on the ugly host. The `*.supabase.co` host may still appear until Step B.

## Step B — Custom Auth domain (best fix for the URL)

Use Supabase **Custom Domains** so the redirect host is yours: `auth.tee-time.io`.

**Automated helper:** from the repo root, after logging into the Supabase CLI as the **Tee-Time project owner**:

```bash
supabase logout && supabase login   # use the Tee-Time ops account, not a personal side org
./scripts/setup-auth-custom-domain.sh
```

That script walks: Cloudflare CNAME → `supabase domains create/reverify/activate` → Google redirect URI reminder.

### Manual checklist

1. Supabase Dashboard (project `nmwlebcvezybfwertlzs`) → **Settings → General → Custom Domains**  
   Requires a **paid plan** + Custom Domains add-on. Enable the add-on if prompted.
2. Cloudflare DNS for `tee-time.io` (DNS only / grey cloud):
   - `CNAME auth` → `nmwlebcvezybfwertlzs.supabase.co`
   - Plus whatever `_acme-challenge` TXT Supabase prints
3. Google Cloud → OAuth client → **Authorized redirect URIs** add:  
   `https://auth.tee-time.io/auth/v1/callback`  
   (keep `https://nmwlebcvezybfwertlzs.supabase.co/auth/v1/callback`)
4. Run activate (CLI or dashboard). Auth starts advertising `auth.tee-time.io` immediately.
5. Optional: set app `VITE_SUPABASE_URL=https://auth.tee-time.io` (defaults can stay on the project URL; both work after activate).
6. Smoke-test Sign in with Google → chooser should say **continue to auth.tee-time.io**.

### Privilege note

Custom domain CLI calls return **403** if you’re logged into a Supabase org that doesn’t own Tee-Time. Check with `supabase projects list` — you must see ref `nmwlebcvezybfwertlzs`.

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
