#!/usr/bin/env node
/**
 * Sync lat/lng into course_catalog from course_registry.record, matched by slug.
 * course_registry already has coordinates for ~475/483 courses (from the original
 * CSV import); course_catalog has none. photos-cache.mjs needs them on course_catalog
 * to geocode-bias its Places text search.
 *
 * Requires `lat`/`lng` (double precision) columns on course_catalog — run once:
 *   alter table public.course_catalog
 *     add column if not exists lat double precision,
 *     add column if not exists lng double precision;
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/sync-coordinates.mjs [--dry-run]
 */

import { loadDotEnv } from './lib/courses-json.mjs';

loadDotEnv();

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://nmwlebcvezybfwertlzs.supabase.co';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY;

if (!SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_KEY in .env (Supabase → Settings → API → service_role)');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function fetchAll(table, select) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}&order=slug`, { headers });
  if (!res.ok) throw new Error(`fetch ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const [registryRows, catalogRows] = await Promise.all([
  fetchAll('course_registry', 'slug,record'),
  fetchAll('course_catalog', 'slug,lat,lng'),
]);

const catalogBySlug = new Map(catalogRows.map((c) => [c.slug, c]));

let updated = 0;
let alreadySynced = 0;
let noCoordsInRegistry = 0;
let notInCatalog = 0;

for (const { slug, record } of registryRows) {
  const catalog = catalogBySlug.get(slug);
  if (!catalog) {
    notInCatalog++;
    console.log(`✗  ${slug}  — not in course_catalog`);
    continue;
  }

  const lat = record?.lat;
  const lng = record?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    noCoordsInRegistry++;
    console.log(`⚠️  ${slug}  — no coordinates in course_registry`);
    continue;
  }

  if (catalog.lat === lat && catalog.lng === lng) {
    alreadySynced++;
    continue;
  }

  if (dryRun) {
    console.log(`would update  ${slug}  →  ${lat}, ${lng}`);
    updated++;
    continue;
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/course_catalog?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ lat, lng }),
  });
  if (!res.ok) {
    console.log(`❌ ${slug}  — patch failed: ${res.status} ${await res.text()}`);
    continue;
  }

  console.log(`✓  ${slug}  →  ${lat}, ${lng}`);
  updated++;
}

console.log(
  `\nDone! Updated: ${updated}  Already synced: ${alreadySynced}  No coords in registry: ${noCoordsInRegistry}  Not in catalog: ${notInCatalog}`,
);
