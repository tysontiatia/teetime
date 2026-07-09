#!/usr/bin/env node
/**
 * Convert 32-column sheet rate cells -> course_rates upsert SQL.
 *
 * Usage:
 *   node scripts/sheet-rates-to-sql.mjs
 *   node scripts/sheet-rates-to-sql.mjs --csv path --out data/rates-upsert.sql
 *
 * Sparse rule: blank cell -> no row. Cart cells are bundled totals (price_includes_cart=true).
 * Apply after migration 20260709000000. Run output in Supabase SQL editor (service role).
 */

import { readFileSync, writeFileSync } from 'fs';
import { parseCsv } from './lib/parse-csv.mjs';

const RATE_COLUMNS = [
  { col: 'rate_weekday_9_green_fee', day_type: 'weekday', holes: 9, rider_type: 'walk', includes_cart: false },
  { col: 'rate_weekday_18_green_fee', day_type: 'weekday', holes: 18, rider_type: 'walk', includes_cart: false },
  { col: 'rate_weekday_9_with_cart', day_type: 'weekday', holes: 9, rider_type: 'cart', includes_cart: true },
  { col: 'rate_weekday_18_with_cart', day_type: 'weekday', holes: 18, rider_type: 'cart', includes_cart: true },
  { col: 'rate_weekend_9_green_fee', day_type: 'weekend', holes: 9, rider_type: 'walk', includes_cart: false },
  { col: 'rate_weekend_18_green_fee', day_type: 'weekend', holes: 18, rider_type: 'walk', includes_cart: false },
  { col: 'rate_weekend_9_with_cart', day_type: 'weekend', holes: 9, rider_type: 'cart', includes_cart: true },
  { col: 'rate_weekend_18_with_cart', day_type: 'weekend', holes: 18, rider_type: 'cart', includes_cart: true },
];

function sqlLiteral(value) {
  if (value == null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseDollars(raw) {
  const s = raw.trim().replace(/^\$/, '');
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseVerifiedAt(raw) {
  const s = raw?.trim();
  if (!s) return 'now()';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return `${sqlLiteral(s)}::timestamptz`;
  return 'now()';
}

function parseArgs(argv) {
  const csvIdx = argv.indexOf('--csv');
  const outIdx = argv.indexOf('--out');
  return {
    csvPath: csvIdx >= 0 ? argv[csvIdx + 1] : './data/course-catalog-enrichment.csv',
    outPath: outIdx >= 0 ? argv[outIdx + 1] : './data/rates-upsert.sql',
  };
}

const { csvPath, outPath } = parseArgs(process.argv.slice(2));
const parsed = parseCsv(readFileSync(csvPath, 'utf8'));
const header = parsed[0].map((h) => h.trim());
const slugIdx = header.indexOf('slug');
const ratesUpdatedIdx = header.indexOf('rates_updated_at');

/** @type {string[]} */
const inserts = [];
const skippedSlugs = [];
let rowCount = 0;

for (let i = 1; i < parsed.length; i++) {
  const line = parsed[i];
  const slug = line[slugIdx]?.trim();
  if (!slug) continue;
  const verifiedAt = parseVerifiedAt(line[ratesUpdatedIdx] ?? '');
  let emitted = 0;

  for (const spec of RATE_COLUMNS) {
    const idx = header.indexOf(spec.col);
    if (idx < 0) continue;
    const dollars = parseDollars(line[idx] ?? '');
    if (dollars == null) continue;

    inserts.push(
      `insert into public.course_rates (course_slug, day_type, holes, rider_type, resident, season, price_cents, price_includes_cart, source, verified_at) values (` +
        `${sqlLiteral(slug)}, ${sqlLiteral(spec.day_type)}, ${spec.holes}, ${sqlLiteral(spec.rider_type)}, null, 'standard', ` +
        `${dollars * 100}, ${spec.includes_cart ? 'true' : 'false'}, ` +
        `'sheet:course-catalog-enrichment', ${verifiedAt}) ` +
        `on conflict (course_slug, day_type, holes, rider_type, resident_key, season) do update set ` +
        `price_cents = excluded.price_cents, price_includes_cart = excluded.price_includes_cart, ` +
        `source = excluded.source, verified_at = excluded.verified_at;`,
    );
    emitted++;
    rowCount++;
  }

  if (emitted === 0) skippedSlugs.push(slug);
}

const out = [
  '-- course_rates upsert from sheet 8-cell rate columns',
  '-- Apply after 20260709000000_course_rates_schema.sql',
  `-- ${rowCount} rows across ${parsed.length - 1 - skippedSlugs.length} courses`,
  '',
  ...inserts,
  '',
  '-- Skipped (no numeric rate cells):',
  ...skippedSlugs.map((s) => `--   ${s}`),
  '',
].join('\n');

writeFileSync(outPath, out, 'utf8');
console.log(`Wrote ${rowCount} rate upserts -> ${outPath}`);
console.log(`Skipped ${skippedSlugs.length} courses with no rate cells.`);
