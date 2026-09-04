# Tee-Time.io Brand & Product Reference

**Version:** 2.0
**Last updated:** August 2026
**For:** product, design, content, and any AI agent generating Tee-Time.io material

> **This file describes what actually ships.** Version 1.0 of this document specified
> fonts and colors that were never in the codebase (Familjen Grotesk was listed as
> already loaded when the app was running Sora). Everything below is verified against
> `frontend/src/index.css`, `public/index.html`, and the live `/v1/courses` API.
>
> **If you change a token, run `npm run brand:check`.** It fails the build when the
> marketing page and the app disagree.

---

## I. Product

**Name:** Tee-Time.io
**Tagline (in code, use this one):** "Every tee time. One search."
**Mission:** Live tee time finder and booking utility for municipal golf.

### Core value

> "One link beats forty group texts."

### The three products — always capitalized, never "the Find feature"

1. **Find** — search live availability across tracked courses
2. **Alerts** — email when a matching tee time opens
3. **Plan** — share a vote link, lock a round with your group

### Where we're live

**Do not hardcode coverage.** Utah and Idaho are live as of this writing, but the
landing page and app both derive states and counts from the catalog at runtime.

| Source | What it gives you |
|---|---|
| `GET /v1/courses` | Every public course, each with a derived `state` |
| `setCoverage()` in `public/index.html` | Landing pills, hero subhead, trust strip |
| `formatLiveMarkets()` in `frontend/src/lib/serviceArea.ts` | In-app coverage copy |

A state counts as live at **5+ courses** (`LIVE_MARKET_MIN_COURSES`). That threshold
exists to keep one-off imports and bad geocodes out of marketing claims.

To get current numbers for a social post, ask the API — don't copy a number from here:

```bash
curl -s https://api.tee-time.io/v1/courses \
  | python3 -c "import sys,json,collections;r=json.load(sys.stdin);print(collections.Counter(c.get('state') for c in r))"
```

---

## II. Visual system

Dark is the default on every surface. Light remains fully supported and users can
switch in the app; the preference persists in `localStorage` under `tt-theme`.

### Tokens

These are the real variable names. Use `var(--token)`, not raw hex, in product code.

| Token | Dark (default) | Light | Role |
|---|---|---|---|
| `--paper` | `#0B120E` | `#FBFBF8` | Page background |
| `--ink` | `#EEF2EC` | `#141E19` | Primary text |
| `--ink-2` | `#9DAA9F` | `#4C5A53` | Body copy |
| `--ink-3` | `#7C8B82` | `#8A958F` | Meta, captions, labels |
| `--fairway` | `#C6F24E` | `#C6F24E` | Primary action, live state, prices |
| `--fairway-ink` | `#0B120E` | `#0B120E` | Text **on** lime |
| `--pine` | `#3F8F68` | `#1E4D3B` | Secondary green |
| `--pine-deep` | `#2F6B4E` | `#143528` | Accent text on light |
| `--green-soft` | `#1B2A20` | `#F0FADB` | Tinted fills |
| `--card` | `#121B15` | `#FFFFFF` | Cards, rows, panels |
| `--card-2` | `#16211A` | `#F5F4EF` | Nested surfaces |
| `--sand` | `#121B15` | `#EFECE3` | Muted background |
| `--line` | `#22302A` | `#E4E2DA` | Borders |
| `--border-strong` | `#2E3D35` | `#D4D1C8` | Emphasized borders |

Lime is a signal, not a surface — keep it near 10% of the screen. `--fairway-ink` is
only ever used as text sitting **on** lime; anything on `--green-soft` uses
`--pine-deep` in light and `--fairway` in dark.

### Typography

- **Display:** Familjen Grotesk, 600–700, tracking −0.035 to −0.05em → `var(--font-display)`
- **UI and body:** Schibsted Grotesk, 400/500/600, line-height 1.5 → `var(--font)`
- **Data:** IBM Plex Mono for times, prices, counts, and uppercase labels (track +0.14em) → `var(--font-mono)`

Every time, price, and count renders in mono. That's the "scoreboard" idea made literal.

### Geometry

| Thing | Value |
|---|---|
| Buttons, chips, pills | `999px` |
| Cards, panels | `var(--radius)` — 18px |
| Inputs, tee-time chips | `var(--radius-sm)` — 12px |
| Logo mark corner | 11.4px on a 48×48 mark (~24%) |

---

## III. Logo

Asset details and regeneration commands live in [`public/brand/README.md`](../public/brand/README.md).

The **logo** palette is deliberately not the UI palette:

| Name | Hex | Use |
|---|---|---|
| Logo lime | `#C9F542` | The mark's tile only — never in UI |
| Logo forest | `#1E4620` | The mark on light backgrounds — never in UI |
| Wordmark accent | `var(--wordmark-accent)` | The ".io" — `#4C7A22` on cream, lime on ink |

The ".io" is the one logo colour that is themed, because lime fails contrast on cream
and `#4C7A22` disappears on ink. Use the token, never either hex directly.

Don't recolor the tile or flag, don't set the wordmark in anything but the display
face, don't place the mark on a photo without a solid tile behind it, and don't
stretch, rotate, outline, or shadow it. Clear space is half the mark's width.

---

## IV. Voice

Dry, useful, competitive. Golf branding defaults to crests, script, and hushed
prestige — go the other way.

1. Lead with the fact, then the joke. Never reverse it.
2. Short sentences.
3. Real numbers, no hedging.
4. No clichés: "elevate your game," "the 19th hole," "Fore-get," exclamation marks.

### House style

- **Times:** `6:50 AM`. Lowercase "am" only mid-sentence.
- **Numbers:** always numerals — `187 courses`, `$30`, `93 open`.
- **Money:** `$30`, not `$30.00`.
- **Products:** Find, Alerts, Plan.

### Say this

- "A 7:30 just opened at Bonneville. 4 players, $50."
- "93 open this morning. Pro shops called: zero."
- "One link beats forty group texts."
- "The mountain west is live."

### Not this

- "Elevate your golfing experience."
- "Unlock premium access to exclusive tee times!"
- "The ultimate all-in-one golf platform."

---

## V. Components

**Buttons** — fully round. Primary is lime with `--fairway-ink` text. Secondary is
border-only. Disabled drops to a muted panel with `--ink-3` text.

**Filter chips** — fully round; active fills lime, inactive is a bordered panel.

**Tee-time chips** — `--radius-sm`, mono time above a `players · holes · price`
detail line. The soonest slot gets a lime border and a 12% lime wash. Booked slots
get a strikethrough time at 45% opacity.

**Cards** — `--card` background, 1px `--line` border, `--radius`, headings in the
display face.

**Search** — the fields read **When · Players · Where**, action at the end, on both the
landing page and the app finder. The landing page is the first search a visitor sees and
the app is the second; if the order differs, the product feels like two products. Labels
are uppercase 11px with `0.1em` tracking. Collapsing to one column keeps the same order.

---

## VI. Photography

Real municipal golf, shot in early light. The course photos *are* the product — on a
dark background they carry the page, so don't wash them out.

- 16:10 crop, horizon in the upper third
- Morning or twilight; keep the sky
- Shot from tee or green, mountains in frame where you have them
- Unpeopled — no stock models in polos
- Ink gradient scrim for text overlay
- Never filters, vignettes, duotones, or lime tints

---

## VII. Where things live

| What | Where |
|---|---|
| Token source of truth | `frontend/src/index.css` and `public/index.html`, inside `brand:tokens:*` markers |
| Sync check | `npm run brand:check` (also runs in `scripts/build-pages.sh`) |
| Logo assets | `public/brand/` |
| Marketing page | `public/index.html` (static, served at `/`) |
| App | `frontend/src/` (Vite, served at `/app/`) |
| Coverage derivation | `worker/courseAdmin.js` → `deriveCourseState()`, `frontend/src/lib/serviceArea.ts` |
| Catalog data audit | `npm run courses:audit` — strays, duplicates, unenriched records |
| Google OAuth branding | [`docs/GOOGLE_OAUTH_BRANDING.md`](./GOOGLE_OAUTH_BRANDING.md) |

The marketing page and the app can't share a stylesheet without a blocking runtime
request, so tokens are duplicated inside marker comments and `brand:check` asserts
they stay identical. Add a token to one file, add it to both.

---

## VIII. For AI agents

1. **Never hardcode a course count or a state name** in copy. Read the API or use the
   derivation helpers. This is the single most common way this brand goes stale.
2. **Use tokens, not hex.** A raw hex in a component is a bug.
3. Match the house style on times, numbers, and product names.
4. Lime is a signal. If a mockup is more than ~10% lime, cut it back.
5. Dark is the default. Check both themes before calling a change done.
6. When this document and the code disagree, **the code is right** — fix the document.
