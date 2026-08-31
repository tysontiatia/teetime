import { SITE, MARKETS, escapeHtml } from './seoCatalog.js';

const FAQS = [
  {
    q: 'Is Tee-Time free?',
    a: 'Yes. Searching, comparing live times, and opening the course booking page are free. Alerts use a Google sign-in. We do not add a booking markup.',
  },
  {
    q: 'Do I book on Tee-Time or the course site?',
    a: 'You book on the course’s own tee sheet (ForeUp, Chronogolf, and others). Tee-Time finds the open times and sends you there.',
  },
  {
    q: 'How fresh are the tee times?',
    a: 'We refresh tracked courses every few minutes during golf hours. Openings and cancellations usually show up within that window.',
  },
  {
    q: 'Which states are live?',
    a: 'Arizona, Utah, and Idaho are live. Colorado and Nevada are next.',
  },
];

export function renderTeeTimesHtml({ title, description, canonical, h1, lede, courses, market, findHref }) {
  const list = (courses || [])
    .map(
      (c) =>
        `<li><a href="${SITE}/app/course/${escapeHtml(c.slug)}/">${escapeHtml(c.name)}</a>${
          c.city ? ` <span class="city">${escapeHtml(c.city)}</span>` : ''
        }</li>`,
    )
    .join('\n');

  const marketLinks = MARKETS.map(
    (m) =>
      `<li><a href="/tee-times/${m.slug}">${escapeHtml(m.name)} tee times</a></li>`,
  ).join('\n');

  const faqHtml = FAQS.map(
    (f) =>
      `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`,
  ).join('\n');

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  const placeLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    url: canonical,
    description,
    isPartOf: { '@type': 'WebSite', name: 'Tee-Time', url: SITE },
  };

  const count = courses?.length || 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <script type="application/ld+json">${JSON.stringify(placeLd).replace(/</g, '\\u003c')}</script>
  <script type="application/ld+json">${JSON.stringify(faqLd).replace(/</g, '\\u003c')}</script>
  <style>
    :root { --paper:#FBFBF8; --ink:#141E19; --ink-2:#4C5A53; --pine:#1E4D3B; --line:#E4E2DA; --card:#fff; }
    html[data-theme='dark'] { --paper:#0B120E; --ink:#F3F1EA; --ink-2:#B5B8B0; --pine:#C6F24E; --line:#243028; --card:#141C17; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Georgia, serif; background: var(--paper); color: var(--ink); line-height: 1.5; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 28px 20px 64px; }
    a { color: var(--pine); }
    .kicker { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-2); }
    h1 { font-size: clamp(1.8rem, 4vw, 2.4rem); letter-spacing: -0.03em; margin: 8px 0 12px; }
    .lede { color: var(--ink-2); margin: 0 0 20px; }
    .btn { display: inline-block; background: var(--pine); color: #FBFBF8; text-decoration: none; padding: 10px 16px; border-radius: 999px; font-weight: 700; }
    html[data-theme='dark'] .btn { color: #0B120E; }
    ul.courses { padding: 0; margin: 16px 0 28px; list-style: none; }
    ul.courses li { padding: 10px 0; border-top: 1px solid var(--line); }
    .city { color: var(--ink-2); font-size: 14px; text-transform: capitalize; }
    details { border-top: 1px solid var(--line); padding: 12px 0; }
    summary { cursor: pointer; font-weight: 700; }
    .markets { display: flex; flex-wrap: wrap; gap: 8px 16px; list-style: none; padding: 0; }
    footer { margin-top: 40px; color: var(--ink-2); font-size: 14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <p class="kicker"><a href="/">Tee-Time.io</a> · Live inventory</p>
    <h1>${escapeHtml(h1)}</h1>
    <p class="lede">${escapeHtml(lede)}</p>
    <p><a class="btn" href="${escapeHtml(findHref)}">Search live times</a></p>
    ${
      count
        ? `<h2>${count} course${count === 1 ? '' : 's'} we track here</h2>
    <ul class="courses">${list}</ul>`
        : `<p>We’re still mapping this area. <a href="/app/">Open Find</a> to search nearby.</p>`
    }
    <h2>Questions</h2>
    ${faqHtml}
    <h2>More cities</h2>
    <ul class="markets">${marketLinks}</ul>
    <footer>
      <p><a href="/">Home</a> · <a href="/app/">Find</a> · <a href="/app/feed/">Openings</a> · <a href="/privacy.html">Privacy</a></p>
      ${market ? `<p>Live in ${escapeHtml(market.state === 'AZ' ? 'Arizona' : market.state === 'ID' ? 'Idaho' : 'Utah')} public courses. Book on the course site.</p>` : ''}
    </footer>
  </div>
</body>
</html>`;
}
