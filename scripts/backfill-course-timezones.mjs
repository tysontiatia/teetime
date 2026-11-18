#!/usr/bin/env node
/**
 * Set every course_registry record's timezone from its coordinates, using
 * geo-tz's exact zone boundaries, and stamp `timezone_pin` so the Worker trusts
 * it until the pin moves.
 *
 * Discovery used to guess the zone from the state, so courses outside the
 * Mountain West were saved as America/Denver, and north Idaho as Boise.
 *
 * Dry run (default) prints what would change:
 *   node scripts/backfill-course-timezones.mjs
 * Write the changes:
 *   node scripts/backfill-course-timezones.mjs --apply
 *
 * Reads SUPABASE_SERVICE_KEY (and optionally SUPABASE_URL) from .env or worker/.dev.vars.
 * Re-run after bulk imports, or after courses are moved in admin.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { hasExactTimezone } from '../worker/courseTimezone.js';
import { loadDotEnv } from './lib/courses-json.mjs';
import { withExactTimezone } from './lib/exactTimezone.mjs';

loadDotEnv();
loadDotEnv('./worker/.dev.vars');

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://nmwlebcvezybfwertlzs.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const apply = process.argv.includes('--apply');

if (!KEY) {
  console.error('Set SUPABASE_SERVICE_KEY in .env or worker/.dev.vars.');
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function loadRegistry() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/course_registry?select=slug,record&order=slug`, {
      headers: { ...headers, Range: `${from}-${from + 999}` },
    });
    if (!res.ok) throw new Error(`course_registry read failed at row ${from}: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

async function patchRecord(slug, record) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/course_registry?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ record }),
  });
  if (!res.ok) throw new Error(`Failed ${slug}: ${res.status} ${await res.text()}`);
}

const restoreAt = process.argv.indexOf('--restore');
if (restoreAt >= 0) {
  const file = process.argv[restoreAt + 1];
  if (!file) {
    console.error('Pass the backup file: --restore data/backups/timezone-backfill-….json');
    process.exit(1);
  }
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  for (const { slug, record } of saved) await patchRecord(slug, record);
  console.log(`Restored ${saved.length} records from ${file}`);
  process.exit(0);
}

const rows = await loadRegistry();
const changes = [];
let noPin = 0;
let stampOnly = 0;
for (const row of rows) {
  const rec = row.record || {};
  if (hasExactTimezone(rec)) continue;
  const next = withExactTimezone(rec);
  if (!next) {
    noPin += 1;
    continue;
  }
  if (next.timezone === rec.timezone) stampOnly += 1;
  changes.push({ row, record: next, from: rec.timezone || '(none)', to: next.timezone });
}

const moved = changes.filter((c) => c.from !== c.to);
const byMove = new Map();
for (const change of moved) {
  const key = `${change.from} → ${change.to}`;
  byMove.set(key, (byMove.get(key) || 0) + 1);
}
console.log(
  `${rows.length} courses: ${moved.length} change zone, ${stampOnly} already right (stamp only), ` +
    `${noPin} without a usable pin (left as is)`,
);
for (const [move, count] of [...byMove].sort((a, b) => b[1] - a[1])) console.log(`  ${count}  ${move}`);
for (const change of moved.slice(0, 60)) console.log(`  ${change.row.slug}: ${change.from} → ${change.to}`);
if (moved.length > 60) console.log(`  … ${moved.length - 60} more`);

if (!apply) {
  console.log('\nDry run. Pass --apply to write.');
  process.exit(0);
}

// Keep every record exactly as it was before this run, so it can be put back with
//   node scripts/backfill-course-timezones.mjs --restore <backup file>
mkdirSync('data/backups', { recursive: true });
const backupPath = `data/backups/timezone-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backupPath, JSON.stringify(changes.map((c) => ({ slug: c.row.slug, record: c.row.record })), null, 2));
console.log(`Backed up ${changes.length} records to ${backupPath}`);

let written = 0;
for (const change of changes) {
  try {
    await patchRecord(change.row.slug, change.record);
  } catch (err) {
    console.error(`${err.message}\nStopped after ${written} writes. Undo with --restore ${backupPath}`);
    process.exit(1);
  }
  written += 1;
}
console.log(`Wrote ${written} records.`);
