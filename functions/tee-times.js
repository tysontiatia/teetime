import { MARKETS, SITE, escapeHtml } from './_lib/seoCatalog.js';
import { renderTeeTimesHtml } from './_lib/teeTimesPage.js';

export async function onRequestGet() {
  const courses = MARKETS.map((m) => ({
    slug: m.slug,
    name: `${m.name} tee times`,
    city: m.kind === 'state' ? 'statewide' : m.state,
    href: `/tee-times/${m.slug}`,
  }));

  let html = renderTeeTimesHtml({
    title: 'Live golf tee times by city · tee-time.io',
    description:
      'Find live public-course tee times in Arizona, Utah, and Idaho. City pages list the courses we track. Search once and book on the course site.',
    canonical: `${SITE}/tee-times`,
    h1: 'Live tee times by city',
    lede: 'Arizona, Utah, and Idaho are live. Pick a city for the courses we track, then search open Saturday mornings in Find.',
    courses: [],
    market: null,
    findHref: '/app/',
  });

  const list = courses
    .map(
      (c) =>
        `<li><a href="${escapeHtml(c.href)}">${escapeHtml(c.name)}</a> <span class="city">${escapeHtml(c.city)}</span></li>`,
    )
    .join('\n');

  html = html.replace(
    '<p>We’re still mapping this area. <a href="/app/">Open Find</a> to search nearby.</p>',
    `<h2>Where we’re live</h2>\n    <ul class="courses">${list}</ul>`,
  );

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    },
  });
}
