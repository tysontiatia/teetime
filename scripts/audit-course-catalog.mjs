#!/usr/bin/env node
/**
 * Audits the live course catalog for data faults that quietly corrupt coverage copy,
 * search results, and course pages. Reads the public /v1/courses endpoint, so it needs
 * no credentials — run it before and after a course import.
 *
 * Checks:
 *   stray-state         derived state has too few courses to be a real market, so it is
 *                       usually a bad Google Places match rather than a new region
 *   duplicate-booking   two far-apart records share one booking target; one is stale.
 *                       Sibling courses at one club legitimately share a tee sheet, so
 *                       only pairs beyond DUPLICATE_MAX_MILES are flagged.
 *   placeholder-booking an aggregator booking_url lost its course identifier, so it lands
 *                       on the platform's home page instead of a tee sheet. A club's own
 *                       domain root is a valid booking page and is not flagged.
 *   unverified          no google_place_id / timezone / booking_status — never enriched
 *   missing-coords      no usable lat/lng, so distance sort and "near me" skip it
 *
 * Usage:
 *   node scripts/audit-course-catalog.mjs [--json] [--worker=https://…]
 *
 * Exits 1 when anything is flagged, so it can gate a deploy.
 */

const DEFAULT_WORKER = 'https://utah-tee-times.tysontiatia.workers.dev';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const workerUrl = (args.find((a) => a.startsWith('--worker='))?.split('=')[1] || DEFAULT_WORKER).replace(/\/$/, '');

/** Mirrors deriveCourseState() in worker/courseAdmin.js and stateOf() on the landing page. */
const ADDRESS_STATE_RE = /\b([A-Z]{2})[\s,]+\d{5}(?:-\d{4})?\b/;
const TIMEZONE_STATE = { 'America/Boise': 'ID', 'America/Phoenix': 'AZ' };

/** Below this a state reads as an import error, not a market. Matches the app + landing. */
const LIVE_MARKET_MIN_COURSES = 5;

/** Two courses on one tee sheet farther apart than this are different clubs. */
const DUPLICATE_MAX_MILES = 25;

function milesBetween(a, b) {
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 7917.5 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function stateOf(course) {
  const explicit = String(course.state || '').trim().toUpperCase();
  if (explicit.length === 2) return explicit;
  const fromAddress = ADDRESS_STATE_RE.exec(String(course.address || ''))?.[1];
  if (fromAddress) return fromAddress;
  return TIMEZONE_STATE[course.timezone] || '';
}

function label(course) {
  return `${course.name || '(unnamed)'}${course.slug ? ` [${course.slug}]` : ''}`;
}

const res = await fetch(`${workerUrl}/v1/courses`);
if (!res.ok) {
  console.error(`Failed to load catalog: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const courses = await res.json();
if (!Array.isArray(courses)) {
  console.error('Unexpected catalog shape: expected an array of courses.');
  process.exit(1);
}

const findings = [];

// stray-state: states with a handful of courses are almost always mis-geocoded records.
const byState = new Map();
for (const c of courses) {
  const st = stateOf(c);
  if (!byState.has(st)) byState.set(st, []);
  byState.get(st).push(c);
}
for (const [st, list] of [...byState.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (!st) {
    for (const c of list) {
      findings.push({ kind: 'stray-state', course: label(c), detail: 'no state from state/address/timezone' });
    }
    continue;
  }
  if (list.length >= LIVE_MARKET_MIN_COURSES) continue;
  for (const c of list) {
    findings.push({
      kind: 'stray-state',
      course: label(c),
      detail: `${st} has only ${list.length} course${list.length === 1 ? '' : 's'} — ${c.address || 'no address'}`,
    });
  }
}

// placeholder-booking: on these hosts the course identifier lives in the path, so a bare
// domain means the identifier was dropped. Club-owned domains book fine from their root.
const IDENTIFIER_IN_PATH_HOSTS = ['foreupsoftware.com', 'chronogolf.com', 'membersports.com'];
for (const c of courses) {
  const url = String(c.booking_url || '');
  if (!url) continue;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    findings.push({ kind: 'placeholder-booking', course: label(c), detail: `booking_url is unparseable: ${url}` });
    continue;
  }
  const needsPath = IDENTIFIER_IN_PATH_HOSTS.some(
    (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`),
  );
  if (needsPath && parsed.pathname.replace(/\/+$/, '') === '' && !parsed.search && !parsed.hash) {
    findings.push({
      kind: 'placeholder-booking',
      course: label(c),
      detail: `booking_url has no course identifier: ${url}`,
    });
  }
}

// duplicate-booking: one tee sheet claimed by records too far apart to be the same club.
const byBooking = new Map();
for (const c of courses) {
  const key = c.booking_url || [c.platform, c.schedule_id, c.booking_class_id].filter(Boolean).join('|');
  if (!key) continue;
  if (!byBooking.has(key)) byBooking.set(key, []);
  byBooking.get(key).push(c);
}
for (const [key, list] of byBooking) {
  if (list.length < 2) continue;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const miles = milesBetween(list[i], list[j]);
      if (miles !== null && miles <= DUPLICATE_MAX_MILES) continue;
      findings.push({
        kind: 'duplicate-booking',
        course: `${label(list[i])} + ${label(list[j])}`,
        detail:
          miles === null
            ? `share one booking target, distance unknown (${key})`
            : `share one booking target ${Math.round(miles)} mi apart (${key})`,
      });
    }
  }
}

// unverified / missing-coords: records that never completed enrichment.
for (const c of courses) {
  const gaps = [];
  if (!c.google_place_id) gaps.push('google_place_id');
  if (!c.timezone) gaps.push('timezone');
  if (!c.booking_status) gaps.push('booking_status');
  if (gaps.length === 3) {
    findings.push({ kind: 'unverified', course: label(c), detail: `missing ${gaps.join(', ')}` });
  }
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
    findings.push({ kind: 'missing-coords', course: label(c), detail: 'no usable lat/lng' });
  }
}

if (asJson) {
  console.log(JSON.stringify({ total: courses.length, findings }, null, 2));
} else {
  const live = [...byState.entries()]
    .filter(([st, l]) => st && l.length >= LIVE_MARKET_MIN_COURSES)
    .sort((a, b) => b[1].length - a[1].length);
  console.log(`Catalog: ${courses.length} records`);
  console.log(`Live markets: ${live.map(([st, l]) => `${st}=${l.length}`).join(' ') || 'none'}`);
  console.log('');

  if (findings.length === 0) {
    console.log('No issues found.');
  } else {
    const grouped = new Map();
    for (const f of findings) {
      if (!grouped.has(f.kind)) grouped.set(f.kind, []);
      grouped.get(f.kind).push(f);
    }
    for (const [kind, list] of grouped) {
      console.log(`${kind} (${list.length}):`);
      for (const f of list) console.log(`  • ${f.course} — ${f.detail}`);
      console.log('');
    }
    console.log('Fix in Supabase course_registry (admin UI at /app/admin/courses), then re-run.');
  }
}

process.exit(findings.length > 0 ? 1 : 0);
