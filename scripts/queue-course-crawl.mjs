#!/usr/bin/env node
/**
 * Queue new clubs from course_index for the Worker's booking-link crawl.
 *
 * One row per club is queued: its main layout (most holes, first listed).
 * The other layouts of the club are marked "grouped"; the crawl links them to
 * the same stub.
 *
 * Preview (default): crawls each club's website from this machine and prints
 * the QA stub it would create. Reads only; writes nothing.
 *   node scripts/queue-course-crawl.mjs --state UT
 * Queue for the Worker (it crawls a few every 15 minutes):
 *   node scripts/queue-course-crawl.mjs --state UT --apply
 */

import { buildIndexStub } from '../worker/courseIndexCrawl.js';
import { findImportDuplicate, fetchExistingCourseIndex } from '../worker/courseAdmin.js';
import { discoverWebsite } from '../worker/stateDiscovery.js';
import { loadDotEnv } from './lib/courses-json.mjs';

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
const env = {
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://nmwlebcvezybfwertlzs.supabase.co',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
};
if (!env.SUPABASE_SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_KEY in .env or worker/.dev.vars.');
  process.exit(1);
}
const headers = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };

const res = await fetch(
  `${env.SUPABASE_URL}/rest/v1/course_index?select=*&state=eq.${STATE}&match_status=eq.new&crawl_status=is.null&order=club_id,course_position`,
  { headers },
);
if (!res.ok) throw new Error(`course_index read failed: ${res.status} ${await res.text()}`);
const rows = await res.json();
const byClub = new Map();
for (const row of rows) byClub.set(row.club_id, [...(byClub.get(row.club_id) || []), row]);
const picks = [...byClub.values()].map((layouts) => {
  const primary = [...layouts].sort(
    (a, b) => (a.layout_kind === 'main' ? 0 : 1) - (b.layout_kind === 'main' ? 0 : 1) || (b.holes || 0) - (a.holes || 0) || a.course_position - b.course_position,
  )[0];
  return { primary, layouts };
});
console.log(`${STATE}: ${picks.length} new clubs to crawl (${rows.length} layouts)\n`);

if (!APPLY) {
  const existing = await fetchExistingCourseIndex(env);
  for (const { primary, layouts } of picks) {
    const hit = primary.website ? await discoverWebsite(primary.website) : null;
    const { slug, record } = buildIndexStub(primary, layouts, hit);
    const dup = findImportDuplicate(existing, slug, record);
    console.log(`${record.name}  [${slug}]`);
    console.log(`  site:    ${primary.website || '(none)'} → ${hit ? hit.support : 'no website'}`);
    console.log(`  booking: ${record.platform || '-'} ${record.booking_url || ''}`);
    console.log(`  facts:   ${[record.holes && `${record.holes} holes`, record.par && `par ${record.par}`, record.yardage && `${record.yardage} yd`, record.phone_number].filter(Boolean).join(' · ') || '-'}`);
    if (record.photo_candidate_url) console.log(`  photo:   ${record.photo_candidate_url}`);
    console.log(`  note:    ${record.booking_status_note || '-'}`);
    if (dup) console.log(`  ⚠ duplicate of ${dup.matched_name} (${dup.matched_slug}, ${dup.reason}): would go to review`);
    console.log('');
  }
  console.log('Preview only. Nothing written. Pass --apply to queue these for the Worker.');
  process.exit(0);
}

const now = new Date().toISOString();
const patch = async (filter, body) => {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/course_index?${filter}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ ...body, updated_at: now }),
  });
  if (!r.ok) throw new Error(`queue write failed: ${r.status} ${await r.text()}`);
};
for (const { primary, layouts } of picks) {
  await patch(`course_key=eq.${encodeURIComponent(primary.course_key)}`, { crawl_status: 'queued', crawl_next_at: null, crawl_attempts: 0 });
  for (const other of layouts) {
    if (other.course_key !== primary.course_key) await patch(`course_key=eq.${encodeURIComponent(other.course_key)}`, { crawl_status: 'grouped' });
  }
}
console.log(`Queued ${picks.length} clubs. The Worker crawls up to 3 every 15 minutes.`);
