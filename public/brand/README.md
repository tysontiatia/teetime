# Tee-Time.io logo assets

## Files (site root)

- `logo-icon-dark.svg` — lime square (#C9F542), dark tee (#0F140E). Use on dark backgrounds.
- `logo-icon-light.svg` — forest square (#1E4620), lime tee. Use on light/cream backgrounds.
- `favicon.svg` — auto-switches between the two via `prefers-color-scheme`. Drop in as-is.
- `logo-glyph.svg` — bare tee, `fill: currentColor`. For inline use (buttons, empty states, loading marks) where it should inherit text color.

## Google OAuth / Google Cloud Branding

Upload a **PNG** (SVG is rejected). Use the light icon so it reads on Google’s white account picker:

| File | Size | Use |
|------|------|-----|
| [`logo-google-oauth-120.png`](./logo-google-oauth-120.png) | 120×120 | Minimum Google branding upload |
| [`logo-google-oauth-512.png`](./logo-google-oauth-512.png) | 512×512 | Preferred / high-res |

Regenerate from the SVG:

```bash
rsvg-convert -w 120 -h 120 public/logo-icon-light.svg -o public/brand/logo-google-oauth-120.png
rsvg-convert -w 512 -h 512 public/logo-icon-light.svg -o public/brand/logo-google-oauth-512.png
```

## Header usage

Pair the icon with the HTML wordmark:

```html
<img src="/logo-icon-light.svg" alt="" class="logo-icon is-light" width="26" height="26" />
<img src="/logo-icon-dark.svg" alt="" class="logo-icon is-dark" width="26" height="26" />
```

In the app, swap with `html[data-theme='dark']` (user theme preference), not only `prefers-color-scheme`.

## Favicon

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
```

Keep a `favicon.ico` or 32px PNG fallback for legacy browsers if you care about them.

## Brand colors

- Lime: `#C9F542`
- Forest: `#1E4620`
- Ink (dark surfaces): `#0F140E`
- Wordmark accent on light backgrounds (".io"): `#4C7A22` — lime fails contrast on cream, use this instead.

## Geometry

48×48 viewBox, square corner radius 11.4 (~24% — matches iOS-style superellipse feel at small sizes). The glyph is a single closed path; scales clean to 16px.
