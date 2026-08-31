#!/usr/bin/env node
/**
 * Recategorize course_registry.platform from the booking URL.
 * Same rules as POST /admin/courses/reclassify-platforms.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/reclassify-course-platforms.mjs [--dry-run]
 */

import { loadDotEnv } from './lib/courses-json.mjs';
import { nextRecordPlatform } from '../worker/courseAdmin.js';

loadDotEnv();

const dryRun = process.argv.includes('--dry-run');
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://nmwlebcvezybfwertlzs.supabase.co';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY;

if (!SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_KEY in .env (or use the admin Recategorize button after deploy).');
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

const res = await fetch(`${SUPABASE_URL}/rest/v1/course_registry?select=slug,record&order=slug`, {
  headers,
});
if (!res.ok) {
  console.error('fetch failed:', await res.text());
  process.exit(1);
}

const rows = await res.json();
const updated = [];
for (const row of rows) {
  const rec = row.record && typeof row.record === 'object' ? row.record : {};
  const next = nextRecordPlatform(rec);
  if (!next.changed) continue;
  updated.push({ slug: row.slug, from: rec.platform || null, to: next.platform, name: rec.name });
  if (dryRun) continue;
  const put = await fetch(`${SUPABASE_URL}/rest/v1/course_registry?on_conflict=slug`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ slug: row.slug, record: { ...rec, platform: next.platform } }),
  });
  if (!put.ok) {
    console.error(`upsert ${row.slug} failed:`, await put.text());
    process.exit(1);
  }
}

console.log(dryRun ? 'Dry run — no writes.' : 'Wrote registry updates.');
console.log(`scanned ${rows.length}, would update ${updated.length}`);
for (const row of updated) {
  console.log(`  ${row.slug}: ${row.from || '(empty)'} → ${row.to}`);
}
