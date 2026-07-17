/**
 * Cloudflare Pages Function: rich link previews for shared round invites.
 *
 * Messaging apps (iMessage, WhatsApp, Slack…) fetch the pasted URL and read
 * Open Graph tags from the raw HTML — they don't run the SPA's JS. This function
 * intercepts /round/:slug, fetches the round from Supabase (public read, same as
 * the voter page), and returns a tiny HTML doc with per-round og:* tags plus an
 * instant client redirect into the app so humans land on the voting page.
 *
 * Never throws to the client: any failure falls back to the default site card so
 * the human link still works.
 *
 * NOTE: wrangler resolves this directory as ./functions relative to the CWD where
 * `wrangler pages deploy` runs (repo root in CI) — it is NOT read from inside the
 * deployed asset directory. Keep this at the repo root.
 */

const SITE = 'https://tee-time.io';
const DEFAULTS = {
  SUPABASE_URL: 'https://nmwlebcvezybfwertlzs.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5td2xlYmN2ZXp5YmZ3ZXJ0bHpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNTUzMjcsImV4cCI6MjA5MTkzMTMyN30.N8Q8T6Mf9_AdzysqgD46tOYMnmB8xTNerU9q7GM7Rlg',
  WORKER_URL: 'https://utah-tee-times.tysontiatia.workers.dev',
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

async function sbGet(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) return null;
  return res.json();
}

function page({ appPath, title, ogTitle, ogDescription, ogImage, ogUrl }) {
  const imageTags = ogImage
    ? `\n  <meta property="og:image" content="${esc(ogImage)}" />\n  <meta name="twitter:image" content="${esc(ogImage)}" />\n  <meta name="twitter:card" content="summary_large_image" />`
    : `\n  <meta name="twitter:card" content="summary" />`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <link rel="canonical" href="${esc(SITE + appPath)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="tee-time.io" />
  <meta property="og:url" content="${esc(ogUrl)}" />
  <meta property="og:title" content="${esc(ogTitle)}" />
  <meta property="og:description" content="${esc(ogDescription)}" />
  <meta name="twitter:title" content="${esc(ogTitle)}" />
  <meta name="twitter:description" content="${esc(ogDescription)}" />${imageTags}
  <meta http-equiv="refresh" content="0;url=${esc(appPath)}" />
  <script>location.replace(${JSON.stringify(appPath)} + location.search + location.hash);</script>
</head>
<body style="font-family:system-ui,sans-serif;padding:2rem;color:#141E19;background:#FBFBF8">
  <p>Opening the round… <a href="${esc(appPath)}">Continue to tee-time.io</a></p>
</body>
</html>`;
}

export async function onRequestGet(context) {
  const env = { ...DEFAULTS, ...context.env };
  const params = context.params || {};
  const parts = Array.isArray(params.slug) ? params.slug : [params.slug];
  const raw = (parts.find(Boolean) || '').toLowerCase();
  const slug = raw.replace(/[^a-z0-9]/g, '').slice(0, 40);
  const appPath = `/app/round/${slug}/`;
  const ogUrl = `${SITE}/round/${slug}/`;

  // Default (site) card — used when the round can't be resolved.
  let view = {
    appPath,
    ogUrl,
    title: 'Golf round · tee-time.io',
    ogTitle: "You're invited to golf",
    ogDescription: 'Vote on tee times and lock in the round on tee-time.io.',
    ogImage: null,
  };

  try {
    if (slug) {
      const rounds = await sbGet(
        env,
        `rounds?share_slug=eq.${slug}&select=id,title,host_public_name,play_date,course_id&limit=1`,
      );
      const round = Array.isArray(rounds) ? rounds[0] : null;
      if (round) {
        const options = (await sbGet(
          env,
          `round_options?round_id=eq.${round.id}&select=course_id,course_name&order=starts_at.asc.nullslast&limit=25`,
        )) || [];
        const count = options.length;
        const courseSlug = round.course_id || options[0]?.course_id || '';

        let photoRef = '';
        if (courseSlug) {
          const reg = await sbGet(env, `course_registry?slug=eq.${courseSlug}&select=record`);
          photoRef = (Array.isArray(reg) && reg[0]?.record?.photo_reference) || '';
        }

        const host = String(round.host_public_name || '').trim();
        // round.title already encodes "Course — Date"; only synthesize when missing.
        const summary =
          String(round.title || '').trim() ||
          [String(options[0]?.course_name || 'a round of golf').trim(), fmtDate(round.play_date)]
            .filter(Boolean)
            .join(' · ');
        const countLabel = count ? `${count} tee time${count === 1 ? '' : 's'}` : 'tee times';

        view = {
          appPath,
          ogUrl,
          title: `${host ? `${host}'s` : 'Your'} golf round · tee-time.io`,
          ogTitle: host ? `${host} invited you to golf` : "You're invited to golf",
          ogDescription: `Vote on ${countLabel} · ${summary} — tap to pick what works.`,
          ogImage: photoRef
            ? `${env.WORKER_URL}/place-photo?reference=${encodeURIComponent(photoRef)}&maxwidth=1200`
            : null,
        };
      }
    }
  } catch {
    // fall back to the default site card
  }

  return new Response(page(view), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
