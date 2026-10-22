#!/usr/bin/env node
/**
 * Find public golf courses and their booking vendor.
 *
 * One website:
 *   node scripts/discover-courses.mjs --url https://bountifulridgegolf.com/
 *
 * Check the crawler against courses already in public/courses.json:
 *   node scripts/discover-courses.mjs --catalog --limit 20
 *
 * Discover a state from OpenStreetMap golf courses, skip courses already on
 * tee-time.io, then ask Google for a place id and a website when the map
 * does not have one.
 *   node scripts/discover-courses.mjs --state UT
 *
 * The JSON file's import_rows load on /app/admin/courses/import. Nothing is
 * written to the database from this script. The same flow is on
 * /app/admin/courses/discover.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { platformsCompatible, shouldImport, toImportRecord } from '../worker/bookingDiscovery.js';
import { discoverWebsite, inspectDiscoveredCourse, prepareStateDiscovery } from '../worker/stateDiscovery.js';
import { loadCourses, loadDotEnv } from './lib/courses-json.mjs';

loadDotEnv();

const LIVE_CATALOG_URL = process.env.COURSE_CATALOG_URL || 'https://api.tee-time.io/v1/courses';

function argValue(name) {
  const flag = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (flag) return flag.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return '';
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

function printHit(hit) {
  const platform = hit.platform || '—';
  console.log(`${hit.support}  ${platform}  ${hit.booking_url || '(no booking url)'}`);
  if (hit.note) console.log(`  ${hit.note}`);
  if (hit.evidence_page) console.log(`  evidence: ${hit.via || 'page'} on ${hit.evidence_page}`);
  const hints = Object.entries(hit.hints || {}).filter(([, value]) => value != null && String(value) !== '');
  if (hints.length) console.log(`  ${hints.map(([key, value]) => `${key}=${value}`).join(' ')}`);
}

async function runUrl(url) {
  console.log(url);
  const hit = await discoverWebsite(url);
  printHit(hit);
}

async function runCatalog() {
  const limit = Number(argValue('limit') || 0);
  const concurrency = Number(argValue('concurrency') || 3);
  const courses = loadCourses().filter((course) => course.website);
  const slice = limit > 0 ? courses.slice(0, limit) : courses;
  console.log(`Checking ${slice.length} course websites…`);
  const counts = { match: 0, mismatch: 0, missing: 0, fetch_failed: 0 };
  const rows = await mapPool(slice, concurrency, async (course) => {
    const hit = await discoverWebsite(course.website);
    const expected = course.platform || '';
    let verdict = 'missing';
    if (hit.support === 'fetch_failed') verdict = 'fetch_failed';
    else if (hit.platform && platformsCompatible(hit.platform, expected)) verdict = 'match';
    else if (hit.platform) verdict = 'mismatch';
    counts[verdict] += 1;
    const line = `${verdict.padEnd(12)} ${expected.padEnd(16)} ${(hit.platform || '—').padEnd(16)} ${course.name}`;
    if (verdict !== 'match') console.log(line);
    return {
      name: course.name,
      website: course.website,
      expected_platform: expected,
      expected_booking_url: course.booking_url || '',
      ...hit,
      verdict,
    };
  });
  const outPath = argValue('out') || 'data/candidates/catalog-check.json';
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ discovered_at: new Date().toISOString(), counts, courses: rows }, null, 2));
  console.log(`\nmatch ${counts.match}  mismatch ${counts.mismatch}  missing ${counts.missing}  fetch_failed ${counts.fetch_failed}`);
  console.log(`Wrote ${outPath}`);
}

async function loadLiveCatalog() {
  const res = await fetch(LIVE_CATALOG_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Live catalog returned ${res.status} from ${LIVE_CATALOG_URL}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error('Live catalog was empty');
  return data;
}

async function runState(state) {
  const apiKey = process.env.GOOGLE_PLACES_KEY || '';
  if (!apiKey) {
    console.error('Set GOOGLE_PLACES_KEY in .env to search a state.');
    process.exit(1);
  }
  const concurrency = Number(argValue('concurrency') || 3);
  if (!/^[A-Z]{2}$/.test(state)) {
    console.error('Pass a two-letter state code, for example UT.');
    process.exit(1);
  }

  console.log('Loading the live tee-time.io catalog…');
  const catalog = await loadLiveCatalog();
  console.log(`${catalog.length} courses on the site`);
  console.log(`Loading golf courses in ${state} from OpenStreetMap…`);
  const prepared = await prepareStateDiscovery(state, catalog);
  console.log(`${prepared.map_count} courses on the map`);
  console.log(`${prepared.known.length} already cataloged, ${prepared.pending.length} to look up…`);

  const discovered = await mapPool(prepared.pending, concurrency, (course) =>
    inspectDiscoveredCourse(course, apiKey, catalog, process.env),
  );
  const all = [...prepared.known, ...discovered];
  const importRows = all.filter(shouldImport).map(toImportRecord);
  const summary = {};
  for (const course of all) summary[course.support] = (summary[course.support] || 0) + 1;

  const outPath = argValue('out') || `data/candidates/${state}.json`;
  mkdirSync(dirname(outPath), { recursive: true });
  const payload = {
    discovered_at: new Date().toISOString(),
    state,
    source: 'openstreetmap',
    summary,
    catalog_matched: prepared.matched,
    catalog_missing: prepared.missing,
    courses: all,
    import_rows: importRows,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(summary);
  console.log(
    `Catalog in ${state}: ${prepared.catalog_in_state}, matched ${prepared.matched}, not on the map ${prepared.missing.length}`,
  );
  for (const name of prepared.missing) console.log(`  not on the map: ${name}`);
  console.log(`Wrote ${all.length} courses (${importRows.length} import rows) to ${outPath}`);
  console.log('Review the file, then load it on /app/admin/courses/import.');
}

const url = argValue('url');
const state = argValue('state').trim().toUpperCase();
const catalog = process.argv.includes('--catalog');

if (!url && !state && !catalog) {
  console.error('Pass --url, --catalog, or --state XX. See the comment at the top of this file.');
  process.exit(1);
}

if (url) await runUrl(url);
else if (catalog) await runCatalog();
else await runState(state);
