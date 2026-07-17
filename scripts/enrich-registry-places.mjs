#!/usr/bin/env node
/**
 * Enrich course_registry records with Google Places metadata (photo_reference,
 * rating, review_count, website, phone_number). Photos on the site are driven by
 * record.photo_reference -> worker /place-photo, so seeded courses stay imageless
 * until this runs.
 *
 * Usage:
 *   GOOGLE_PLACES_KEY=... SUPABASE_SERVICE_KEY=... \
 *     node scripts/enrich-registry-places.mjs [--platform=teeitup] [--slug=foo] \
 *     [--force] [--dry-run]
 *
 * Both keys can live in repo-root .env (gitignored):
 *   GOOGLE_PLACES_KEY=...
 *   SUPABASE_URL=https://nmwlebcvezybfwertlzs.supabase.co
 *   SUPABASE_SERVICE_KEY=your_service_role_key
 *
 * Flags:
 *   --platform=<p>  only courses with record.platform === p
 *   --slug=<s>      only this slug (repeatable)
 *   --force         re-fetch even if photo_reference already set
 *   --dry-run       print what would change; write nothing
 */

import { findPlace, loadDotEnv, sleep } from './lib/courses-json.mjs';

loadDotEnv();

const API_KEY = process.env.GOOGLE_PLACES_KEY;
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://nmwlebcvezybfwertlzs.supabase.co';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const platformArg = args.find((a) => a.startsWith('--platform='))?.split('=')[1] || null;
const slugArgs = args.filter((a) => a.startsWith('--slug=')).map((a) => a.split('=')[1]);

if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_KEY (add to .env or pass GOOGLE_PLACES_KEY=...).');
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_KEY (Supabase Dashboard → Settings → API → service_role).');
  process.exit(1);
}

function sbHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    ...extra,
  };
}

async function fetchRegistry() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/course_registry?select=slug,record&order=slug`,
    { headers: sbHeaders() },
  );
  if (!res.ok) throw new Error(`registry read: ${res.status} ${await res.text()}`);
  return res.json();
}

async function upsertRecord(slug, record) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/course_registry?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ record }),
  });
  if (!res.ok) throw new Error(`registry patch ${slug}: ${res.status} ${await res.text()}`);
}

const rows = await fetchRegistry();

let considered = 0;
let updated = 0;
let missing = 0;
let skipped = 0;

for (const row of rows) {
  const record = row.record;
  if (!record) continue;
  if (platformArg && record.platform !== platformArg) continue;
  if (slugArgs.length && !slugArgs.includes(row.slug)) continue;
  considered++;

  if (record.photo_reference && !force) {
    console.log(`•  ${row.slug}  — already has photo_reference (use --force to refresh)`);
    skipped++;
    continue;
  }
  if (typeof record.lat !== 'number' || typeof record.lng !== 'number') {
    console.log(`⚠  ${row.slug}  — no coordinates, skipping`);
    skipped++;
    continue;
  }

  const place = await findPlace(record.name, record.lat, record.lng, API_KEY);
  await sleep(300);
  if (!place) {
    console.log(`✗  ${row.slug}  — no Places match`);
    missing++;
    continue;
  }

  const next = { ...record };
  const ref = place.photos?.[0]?.photo_reference;
  if (ref) next.photo_reference = ref;
  if (place.rating != null) next.rating = place.rating;
  if (place.user_ratings_total != null) next.review_count = place.user_ratings_total;
  if (place.website && !next.website) next.website = place.website;
  if (place.formatted_phone_number && !next.phone_number) next.phone_number = place.formatted_phone_number;
  delete next.photo_url;

  const label = `★${next.rating ?? '?'} (${next.review_count ?? 0} reviews, ${ref ? 'photo saved' : 'NO photo'})`;
  if (dryRun) {
    console.log(`would update  ${row.slug}  →  ${label}`);
    updated++;
    continue;
  }
  await upsertRecord(row.slug, next);
  console.log(`✓  ${row.slug}  →  ${label}`);
  updated++;
}

console.log(
  `\nDone. considered ${considered}, ${dryRun ? 'would update' : 'updated'} ${updated}, ` +
    `no-match ${missing}, skipped ${skipped}.`,
);
if (!dryRun && updated > 0) {
  console.log('Photos are served live via the worker /place-photo proxy — no redeploy needed.');
}
