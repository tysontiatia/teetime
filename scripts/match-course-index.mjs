#!/usr/bin/env node
/**
 * Match the course index to existing courses for one state.
 *
 * Dry run (default): reads the export and the live registry, prints what would
 * be linked, filled, reviewed, imported, or dropped, and writes a report to
 * data/backups/. Writes nothing to the database.
 *   node scripts/match-course-index.mjs --state UT
 * Write links and fill-blanks (needs course_index loaded; backs up first):
 *   node scripts/match-course-index.mjs --state UT --apply
 *
 * Rules (from the import plan): 18Birdies club id first, then name + ZIP, then
 * name within ~1 km of the pin; anything else that looks related goes to
 * review. Existing courses only get blank fields filled; name, address and
 * website differences are listed, never written. Booking fields are never
 * touched.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { assignLayouts, differences, fillBlanks, isClosedClub, matchClubsToRegistry } from '../worker/courseIndex.js';
import { deriveCourseState } from '../worker/courseAdmin.js';
import { loadDotEnv } from './lib/courses-json.mjs';
import { loadIndexRows } from './load-course-index.mjs';

loadDotEnv();
loadDotEnv('./worker/.dev.vars');

const STATE = (() => {
  const i = process.argv.indexOf('--state');
  return i >= 0 ? String(process.argv[i + 1] || '').toUpperCase() : '';
})();
const APPLY = process.argv.includes('--apply');
if (!/^[A-Z]{2}$/.test(STATE)) {
  console.error('Pass --state XX, for example --state UT.');
  process.exit(1);
}
const URL_BASE = process.env.SUPABASE_URL || 'https://nmwlebcvezybfwertlzs.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) {
  console.error('Set SUPABASE_SERVICE_KEY in .env or worker/.dev.vars.');
  process.exit(1);
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function allRows(path) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
    if (!res.ok) throw new Error(`${path.split('?')[0]} read failed at ${from}: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

// ── Inputs ───────────────────────────────────────────────────────────
const { rows } = loadIndexRows(undefined, STATE);
const registryAll = await allRows('course_registry?select=slug,record&order=slug');
const registry = registryAll.filter((r) => deriveCourseState(r.record) === STATE);
const bySlug = new Map(registry.map((r) => [r.slug, r]));

const clubsById = new Map();
for (const row of rows) {
  if (!clubsById.has(row.club_id)) {
    clubsById.set(row.club_id, { club_id: row.club_id, club_name: row.club_name, zip: row.zip, lat: row.lat, lng: row.lng, rows: [] });
  }
  clubsById.get(row.club_id).rows.push(row);
}
const clubs = [...clubsById.values()];

// ── Match ────────────────────────────────────────────────────────────
const { links, reviews, unmatchedRegistry } = matchClubsToRegistry(clubs, registry);
const reviewByClub = new Map();
for (const r of reviews) reviewByClub.set(r.club_id, [...(reviewByClub.get(r.club_id) || []), r]);

const decisions = []; // per course row
const fills = []; // per registry course
const diffs = [];
for (const club of clubs) {
  const clubLinks = links.get(club.club_id) || [];
  const first = club.rows[0];
  if (clubLinks.length) {
    const assigned = assignLayouts(club.rows, clubLinks, bySlug);
    const linkedSlugs = new Set(assigned.values());
    const clubLevel = clubLinks.length === 1 && assigned.size === 0 ? clubLinks[0] : null;
    for (const row of club.rows) {
      const slug = assigned.get(row.course_key);
      const method = clubLinks.find((l) => l.slug === slug)?.method;
      if (slug) decisions.push({ row, status: 'linked', slug, method, note: 'Course linked' });
      else if (clubLevel) decisions.push({ row, status: 'linked', slug: clubLevel.slug, method: clubLevel.method, note: 'Club-level link (one registry course for several layouts)' });
      else if (row.layout_kind !== 'main') decisions.push({ row, status: 'linked', slug: clubLinks[0].slug, method: 'layout_of', note: `${row.layout_kind} layout of a linked club` });
      else decisions.push({ row, status: 'review', slug: null, note: 'Main layout at a linked club with no registry course of its own: separate tee sheet?' });
    }
    for (const link of clubLinks) {
      const reg = bySlug.get(link.slug);
      const courseRow = club.rows.find((r) => assigned.get(r.course_key) === link.slug);
      const patch = fillBlanks(reg.record, courseRow || first, { courseLinked: Boolean(courseRow) });
      const meta = { birdies_club_id: club.club_id };
      if (courseRow) meta.birdies_course_key = courseRow.course_key;
      fills.push({ slug: link.slug, name: reg.record.name, method: link.method, courseLinked: Boolean(courseRow), patch, meta, linkedSlugs: [...linkedSlugs] });
      for (const d of differences(reg.record, courseRow || first)) diffs.push({ slug: link.slug, ...d });
    }
    continue;
  }
  const clubReviews = reviewByClub.get(club.club_id) || [];
  for (const row of club.rows) {
    if (isClosedClub(club)) decisions.push({ row, status: 'dropped', note: 'Closed (per its 18Birdies name)' });
    else if (row.bookable === 'drop') decisions.push({ row, status: 'dropped', note: `${row.membership || 'Private'}: not imported` });
    else if (clubReviews.length) decisions.push({ row, status: 'review', slug: clubReviews[0].slug, note: clubReviews.map((r) => `${r.reason} (${r.slug})`).join('; ') });
    else if (row.bookable === 'review') decisions.push({ row, status: 'review', note: `${row.membership || 'No membership listed'}: needs a look before import` });
    else decisions.push({ row, status: 'new', note: 'New course' });
  }
}

// ── Report ───────────────────────────────────────────────────────────
const byStatus = {};
for (const d of decisions) byStatus[d.status] = (byStatus[d.status] || 0) + 1;
const clubStatus = (statuses) => clubs.filter((c) => decisions.some((d) => d.row.club_id === c.club_id && statuses.includes(d.status))).length;
const newClubs = clubs.filter((c) => decisions.filter((d) => d.row.club_id === c.club_id).every((d) => d.status === 'new'));
const fieldCounts = {};
for (const f of fills) for (const k of Object.keys(f.patch)) fieldCounts[k] = (fieldCounts[k] || 0) + 1;

console.log(`\n${STATE}: ${clubs.length} index clubs / ${rows.length} layouts vs ${registry.length} registry courses\n`);
console.log('Layouts by outcome:', byStatus);
console.log(`Clubs: linked ${links.size} | new ${newClubs.length} | with review items ${clubStatus(['review'])} | dropped (private/military) ${clubs.filter((c) => decisions.filter((d) => d.row.club_id === c.club_id).every((d) => d.status === 'dropped')).length}`);
console.log(`Registry courses linked: ${fills.length} (${fills.filter((f) => f.courseLinked).length} to a specific layout) | by method:`, fills.reduce((o, f) => ({ ...o, [f.method]: (o[f.method] || 0) + 1 }), {}));
console.log('Blank fields that would be filled:', fieldCounts);
console.log(`Registry courses not found in the index: ${unmatchedRegistry.length}`);
console.log(`Differences listed (not written): ${diffs.length}\n`);

const show = (title, list, fmt) => {
  console.log(`${title} (${list.length})`);
  for (const item of list.slice(0, 40)) console.log('  ' + fmt(item));
  if (list.length > 40) console.log(`  … ${list.length - 40} more in the report`);
  console.log('');
};
show('New clubs', newClubs, (c) => `${c.club_name} | ${c.rows[0].city || '?'} | ${c.rows[0].membership || '-'} | ${c.rows.length} layout(s) | ${c.rows[0].website || c.rows[0].directory_url || 'no site'}`);
show('Review', decisions.filter((d) => d.status === 'review'), (d) => `${d.row.club_name} / ${d.row.course_name} -> ${d.note}`);
show('Not found in the index', unmatchedRegistry, (slug) => `${slug} | ${bySlug.get(slug).record.booking_status || '(no status)'} | ${bySlug.get(slug).record.address || ''}`);
show('Differences', diffs, (d) => `${d.slug}: ${d.field} registry "${d.registry}" vs index "${d.index}"`);

mkdirSync('data/backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportPath = `data/backups/course-index-match-${STATE}-${stamp}.json`;
writeFileSync(reportPath, JSON.stringify({ state: STATE, byStatus, decisions: decisions.map((d) => ({ ...d, row: { course_key: d.row.course_key, club_name: d.row.club_name, course_name: d.row.course_name, city: d.row.city, membership: d.row.membership, website: d.row.website } })), fills, diffs, unmatchedRegistry }, null, 2));
console.log(`Report: ${reportPath}`);

if (!APPLY) {
  console.log('Dry run. Nothing written.');
  process.exit(0);
}

// ── Apply ────────────────────────────────────────────────────────────
const backupPath = `data/backups/registry-before-index-match-${STATE}-${stamp}.json`;
writeFileSync(backupPath, JSON.stringify(fills.map((f) => bySlug.get(f.slug)), null, 2));
console.log(`Backed up ${fills.length} registry records to ${backupPath}`);
const patch = async (path, body) => {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
};
for (const f of fills) {
  const record = { ...bySlug.get(f.slug).record, ...f.patch, ...f.meta };
  await patch(`course_registry?slug=eq.${encodeURIComponent(f.slug)}`, { record });
}
const now = new Date().toISOString();
for (const d of decisions) {
  await patch(`course_index?course_key=eq.${encodeURIComponent(d.row.course_key)}`, {
    registry_slug: d.slug || null,
    match_method: d.status === 'linked' ? d.method : null,
    match_status: d.status,
    match_note: d.note,
    matched_at: now,
    updated_at: now,
  });
}
console.log(`Wrote ${fills.length} registry records and ${decisions.length} index rows. Undo: restore ${backupPath}.`);
