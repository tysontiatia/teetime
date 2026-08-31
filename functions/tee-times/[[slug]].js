import {
  SITE,
  marketBySlug,
  fetchRegistryCourses,
  coursesForMarket,
} from '../_lib/seoCatalog.js';
import { renderTeeTimesHtml } from '../_lib/teeTimesPage.js';

export async function onRequestGet(context) {
  const parts = context.params?.slug;
  const raw = Array.isArray(parts) ? parts[0] : parts;
  const market = marketBySlug(raw);
  if (!market) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  let rows = [];
  try {
    rows = await fetchRegistryCourses(context.env);
  } catch {
    rows = [];
  }
  const courses = coursesForMarket(rows, market);
  const findHref = `/app/?q=${encodeURIComponent(market.q)}`;
  const label = market.kind === 'state' ? market.name : `${market.name}, ${market.state === 'AZ' ? 'Arizona' : market.state === 'ID' ? 'Idaho' : 'Utah'}`;

  const html = renderTeeTimesHtml({
    title: `${market.name} tee times · live public courses · tee-time.io`,
    description: market.blurb,
    canonical: `${SITE}/tee-times/${market.slug}`,
    h1: `Live tee times in ${label}`,
    lede: market.blurb,
    courses,
    market,
    findHref,
  });

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    },
  });
}
