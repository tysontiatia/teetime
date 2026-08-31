import { MARKETS, SITE, fetchRegistryCourses } from './_lib/seoCatalog.js';

function loc(path, changefreq, priority) {
  return `  <url>
    <loc>${SITE}${path}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

export async function onRequestGet(context) {
  let courses = [];
  try {
    courses = await fetchRegistryCourses(context.env);
  } catch {
    courses = [];
  }

  // Public URLs only — never /app/admin or account.
  const urls = [
    loc('/', 'daily', '1.0'),
    loc('/app/', 'hourly', '0.9'),
    loc('/app/feed/', 'hourly', '0.8'),
    loc('/tee-times', 'daily', '0.8'),
    ...MARKETS.map((m) => loc(`/tee-times/${m.slug}`, 'daily', '0.8')),
    ...courses
      .filter((c) => c.slug && !String(c.slug).startsWith('admin'))
      .map((c) => loc(`/app/course/${encodeURIComponent(c.slug)}/`, 'daily', '0.6')),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
