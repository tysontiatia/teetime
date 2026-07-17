/**
 * Cloudflare Pages Function: rich link previews for course pages.
 *
 * Course pages are shared straight from the address bar (/app/course/:slug),
 * which is the same path the SPA is served on — so we can't redirect (it would
 * loop). Instead we let the normal SPA shell render via context.next() and use
 * HTMLRewriter to inject per-course Open Graph tags into it. Humans get the
 * unchanged SPA; unfurlers read the injected tags.
 *
 * Never hard-fails: any error returns the untouched shell (baseline site card).
 *
 * NOTE: wrangler resolves this ./functions dir relative to the CWD where
 * `wrangler pages deploy` runs (repo root in CI), not the deployed asset dir.
 */

const SITE = 'https://tee-time.io';
const DEFAULTS = {
  SUPABASE_URL: 'https://nmwlebcvezybfwertlzs.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5td2xlYmN2ZXp5YmZ3ZXJ0bHpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNTUzMjcsImV4cCI6MjA5MTkzMTMyN30.N8Q8T6Mf9_AdzysqgD46tOYMnmB8xTNerU9q7GM7Rlg',
  WORKER_URL: 'https://utah-tee-times.tysontiatia.workers.dev',
};

function shortAndCity(fullName) {
  const m = String(fullName || '').match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) return { short: m[1].trim(), city: m[2].trim() };
  return { short: String(fullName || '').trim(), city: '' };
}

function cityFromAddress(address) {
  const m = String(address || '').match(/,\s*([^,]+?),\s*UT\b/i);
  return m ? m[1].trim() : '';
}

async function sbGet(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function onRequestGet(context) {
  const env = { ...DEFAULTS, ...context.env };
  const res = await context.next();

  // Only transform the HTML shell; pass redirects, assets, etc. straight through.
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/html')) return res;

  try {
    const params = context.params || {};
    const parts = Array.isArray(params.slug) ? params.slug : [params.slug];
    const raw = (parts.find(Boolean) || '').toLowerCase();
    const slug = raw.replace(/[^a-z0-9-]/g, '').slice(0, 80);
    if (!slug) return res;

    const reg = await sbGet(env, `course_registry?slug=eq.${slug}&select=record`);
    const record = Array.isArray(reg) && reg[0]?.record ? reg[0].record : null;
    if (!record) return res;

    const { short, city: nameCity } = shortAndCity(record.name);
    const city = nameCity || cityFromAddress(record.address);
    const title = `${short} tee times · tee-time.io`;
    const ogTitle = `${short}${city ? ` · ${city}` : ''} — tee times`;
    const ogDescription = `Live tee-time availability at ${short}${city ? `, ${city}` : ''}. Compare open slots and prices, then book direct — on tee-time.io.`;
    const ogUrl = `${SITE}/app/course/${slug}/`;
    const ogImage = record.photo_reference
      ? `${env.WORKER_URL}/place-photo?reference=${encodeURIComponent(record.photo_reference)}&maxwidth=1200`
      : null;

    const rewriter = new HTMLRewriter()
      .on('title', { element: (el) => el.setInnerContent(title) })
      .on('meta[property="og:url"]', { element: (el) => el.setAttribute('content', ogUrl) })
      .on('meta[property="og:title"]', { element: (el) => el.setAttribute('content', ogTitle) })
      .on('meta[property="og:description"]', { element: (el) => el.setAttribute('content', ogDescription) })
      .on('meta[name="twitter:title"]', { element: (el) => el.setAttribute('content', ogTitle) })
      .on('meta[name="twitter:description"]', { element: (el) => el.setAttribute('content', ogDescription) });

    if (ogImage) {
      const esc = ogImage.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      rewriter
        .on('meta[name="twitter:card"]', { element: (el) => el.setAttribute('content', 'summary_large_image') })
        .on('head', {
          element: (el) => {
            el.append(`<meta property="og:image" content="${esc}" />`, { html: true });
            el.append(`<meta name="twitter:image" content="${esc}" />`, { html: true });
          },
        });
    }

    const out = rewriter.transform(res);
    const headers = new Headers(out.headers);
    headers.set('Cache-Control', 'public, max-age=300');
    return new Response(out.body, { status: out.status, headers });
  } catch {
    return res;
  }
}
