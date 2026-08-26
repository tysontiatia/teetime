#!/usr/bin/env node
/**
 * Preview all Alert notification variants (email HTML + SMS + push copy).
 *
 *   npm run preview:notifications
 *   open docs/notification-previews/index.html
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAlertEmail,
  buildAlertPushMessage,
  buildAlertSmsBody,
  buildAlertSubject,
  describeAlertPreference,
} from '../worker/alertCopy.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs/notification-previews');
mkdirSync(outDir, { recursive: true });

const course = { name: 'The Ridge (West Valley)', platform: 'foreup' };
const playDate = '2026-08-28';
const players = 2;
const bookingUrl = 'https://foreupsoftware.com/index.php/booking/22131/9898#/teetimes';

const oneTimePref = {
  target_date: '2026-08-28',
  earliest_time: '05:00:00',
  latest_time: '11:59:00',
  players: 2,
  min_spots: 2,
};

const weeklyPref = {
  target_date: null,
  days_of_week: [5], // Friday
  look_ahead_days: 14,
  earliest_time: '12:00:00',
  latest_time: '16:59:00',
  players: 2,
  min_spots: 2,
};

const fixtures = [
  {
    id: 'onetime-morning-reopen',
    label: 'One-time · Morning · reopened 18',
    pref: oneTimePref,
    eventType: 'reopened',
    times: [{ rawTime: '11:51', price: '$55', spots: 2, holes: 18 }],
  },
  {
    id: 'onetime-morning-mixed',
    label: 'One-time · Morning · 18 + 9 same clock (Ridge)',
    pref: oneTimePref,
    eventType: 'reopened',
    times: [
      { rawTime: '11:40', price: '$55', spots: 2, holes: 18 },
      { rawTime: '11:40', price: '$28', spots: 2, holes: 9 },
    ],
  },
  {
    id: 'weekly-friday-afternoon',
    label: 'Weekly · Fridays · Afternoon',
    pref: weeklyPref,
    eventType: 'opened',
    times: [{ rawTime: '14:40', price: '$55', spots: 2, holes: 18 }],
  },
  {
    id: 'weekly-friday-multi',
    label: 'Weekly · Fridays · multiple afternoon times',
    pref: weeklyPref,
    eventType: 'opened',
    times: [
      { rawTime: '13:10', price: '$50', spots: 4, holes: 18 },
      { rawTime: '14:40', price: '$55', spots: 2, holes: 18 },
      { rawTime: '15:20', price: '$48', spots: 3, holes: 18 },
    ],
  },
  {
    id: 'onetime-allday',
    label: 'One-time · All day · backstop style',
    pref: {
      ...oneTimePref,
      earliest_time: '00:00:00',
      latest_time: '23:59:00',
    },
    eventType: 'opened',
    times: [{ rawTime: '07:30', price: '$42', spots: 4, holes: 18 }],
  },
];

const cards = [];

for (const fx of fixtures) {
  const alertSummary = describeAlertPreference(fx.pref, playDate);
  const subject = buildAlertSubject(course, fx.times, fx.eventType);
  const html = buildAlertEmail(course, fx.times, playDate, players, {
    eventType: fx.eventType,
    alertSummary,
    bookingUrl,
  });
  const sms = buildAlertSmsBody(
    course,
    fx.times,
    playDate,
    players,
    fx.eventType,
    bookingUrl,
    alertSummary,
  );
  const push = buildAlertPushMessage(
    course,
    fx.times,
    playDate,
    players,
    fx.eventType,
    alertSummary,
  );

  writeFileSync(join(outDir, `${fx.id}.html`), html);

  cards.push(`
    <section class="card">
      <h2>${fx.label}</h2>
      <dl>
        <dt>Alert context</dt><dd><code>${escape(alertSummary.summaryLine)}</code></dd>
        <dt>Email subject</dt><dd><code>${escape(subject)}</code></dd>
        <dt>Push title</dt><dd><code>${escape(push.title)}</code></dd>
        <dt>Push body</dt><dd><code>${escape(push.body)}</code></dd>
        <dt>SMS</dt><dd><pre>${escape(sms)}</pre></dd>
      </dl>
      <iframe src="./${fx.id}.html" title="${escape(fx.label)}"></iframe>
    </section>`);
}

function escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const index = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Tee-Time.io · Alert notification previews</title>
  <style>
    :root {
      --paper: #0B120E;
      --ink: #EEF2EC;
      --ink-2: #9DAA9F;
      --card: #121B15;
      --line: #22302A;
      --fairway: #C6F24E;
      --font: 'Schibsted Grotesk', system-ui, sans-serif;
      --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px 20px 64px;
      background: var(--paper);
      color: var(--ink);
      font-family: var(--font);
      line-height: 1.5;
    }
    h1 { font-size: 28px; letter-spacing: -0.035em; margin: 0 0 8px; }
    .lede { color: var(--ink-2); max-width: 52rem; margin: 0 0 28px; }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .card h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: -0.02em; }
    dl { margin: 0 0 16px; }
    dt { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-2); margin-top: 10px; }
    dd { margin: 4px 0 0; }
    code, pre {
      font-family: var(--font-mono);
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    iframe {
      width: 100%;
      max-width: 560px;
      height: 780px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #FBFBF8;
    }
    a { color: var(--fairway); }
  </style>
</head>
<body>
  <h1>Alert notification previews</h1>
  <p class="lede">
    Each email restates <strong>your Alert</strong> (one-time vs weekly, window, players),
    then shows the <strong>matched tee times</strong>.
    Re-run with <code>npm run preview:notifications</code>.
  </p>
  ${cards.join('\n')}
</body>
</html>`;

writeFileSync(join(outDir, 'index.html'), index);
console.log(`Wrote ${fixtures.length} email previews → ${outDir}/index.html`);
