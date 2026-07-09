#!/usr/bin/env node
/**
 * Import course enrichment from the 32-column catalog CSV.
 *
 * Usage:
 *   node scripts/import-course-catalog-csv.mjs              # merge into courses.json
 *   node scripts/import-course-catalog-csv.mjs --sql        # print course_catalog upsert SQL
 *   node scripts/import-course-catalog-csv.mjs --csv path   # custom CSV path
 *
 * Rules:
 *   - Only non-empty CSV cells overwrite existing values (sparse merge).
 *   - website, phone_number, address (if JSON empty) -> courses.json
 *   - Rate matrix columns are NOT imported here — use scripts/sheet-rates-to-sql.mjs
 *   - prepaid + editorial/booking fields -> course_catalog via --sql
 *   - holes on course_catalog must be 9 or 18 (invalid values skipped for SQL only)
 */

import { readFileSync, writeFileSync } from 'fs';
import { loadCourses, writeCourses } from './lib/courses-json.mjs';
import { parseCsv, sqlLiteral } from './lib/parse-csv.mjs';

/** Merged into public/courses.json (+ root courses.json). */
const JSON_COLUMNS = [
  'holes',
  'par',
  'yardage',
  'walkability',
  'rate_notes',
  'twilight_discount',
  'rates_updated_at',
  'booking_window_days',
  'booking_opens_time',
  'cancellation_policy',
  'booking_url_template',
  'editorial_note',
  'signature_hole',
  'history_blurb',
  'editorial_photo_url',
  'timezone',
  'poll_tier',
  'website',
  'phone_number',
];

/** Upserted to course_catalog (--sql mode). Excludes JSON-only identity + poll fields. */
const CATALOG_COLUMNS = [
  'holes',
  'par',
  'yardage',
  'walkability',
  'rate_notes',
  'twilight_discount',
  'rates_updated_at',
  'booking_window_days',
  'booking_opens_time',
  'cancellation_policy',
  'booking_url_template',
  'editorial_note',
  'signature_hole',
  'history_blurb',
  'editorial_photo_url',
  'prepaid',
];

const CSV_HEADER_ALIASES = {
  Prepaid: 'prepaid',
};

function slugFromCourseName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeHeader(header) {
  return header.map((h) => CSV_HEADER_ALIASES[h.trim()] ?? h.trim());
}

function parseBool(raw) {
  const s = raw.trim();
  if (!s) return undefined;
  if (/^(true|1|yes)$/i.test(s)) return true;
  if (/^(false|0|no)$/i.test(s)) return false;
  return undefined;
}

function parseCellValue(col, raw) {
  const s = raw.trim();
  if (!s) return undefined;
  if (col === 'holes' || col === 'par' || col === 'yardage' || col === 'booking_window_days') {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  if (col === 'twilight_discount' || col === 'prepaid') {
    return parseBool(s);
  }
  return s;
}

function catalogHoles(holes) {
  if (holes === 9 || holes === 18) return holes;
  return undefined;
}

function parseArgs(argv) {
  const sql = argv.includes('--sql');
  const csvIdx = argv.indexOf('--csv');
  const outIdx = argv.indexOf('--out');
  return {
    sql,
    csvPath: csvIdx >= 0 ? argv[csvIdx + 1] : './data/course-catalog-enrichment.csv',
    outPath: outIdx >= 0 ? argv[outIdx + 1] : null,
  };
}

const { sql, csvPath, outPath } = parseArgs(process.argv.slice(2));
const parsed = parseCsv(readFileSync(csvPath, 'utf8'));
if (parsed.length < 2) {
  console.error('CSV empty or missing header');
  process.exit(1);
}

const header = normalizeHeader(parsed[0]);
const slugIdx = header.indexOf('slug');
const nameIdx = header.indexOf('name');
const addressIdx = header.indexOf('address');
if (slugIdx < 0 || nameIdx < 0) {
  console.error('CSV must include slug and name columns');
  process.exit(1);
}

/** @type {Map<string, Record<string, unknown>>} */
const bySlug = new Map();
for (let i = 1; i < parsed.length; i++) {
  const line = parsed[i];
  const slug = line[slugIdx]?.trim();
  if (!slug) continue;
  const patch = { slug, name: line[nameIdx]?.trim() ?? '' };
  for (const col of [...JSON_COLUMNS, ...CATALOG_COLUMNS.filter((c) => !JSON_COLUMNS.includes(c))]) {
    const idx = header.indexOf(col);
    if (idx < 0) continue;
    const val = parseCellValue(col, line[idx] ?? '');
    if (val !== undefined) patch[col] = val;
  }
  if (addressIdx >= 0) {
    const addr = line[addressIdx]?.trim();
    if (addr) patch._csv_address = addr;
  }
  bySlug.set(slug, patch);
}

if (sql) {
  const lines = [
    '-- course_catalog upsert from CSV (rates: run data/rates-upsert.sql separately)',
  ];
  for (const patch of bySlug.values()) {
    const cols = ['slug', 'name'];
    for (const col of CATALOG_COLUMNS) {
      if (patch[col] === undefined) continue;
      if (col === 'holes') {
        const h = catalogHoles(patch.holes);
        if (h === undefined) continue;
        patch.holes = h;
      }
      cols.push(col);
    }
    const values = cols.map((c) => sqlLiteral(patch[c]));
    const updates = cols
      .filter((c) => c !== 'slug' && c !== 'name')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ');
    if (updates.length === 0) {
      lines.push(
        `insert into public.course_catalog (slug, name) values (${sqlLiteral(patch.slug)}, ${sqlLiteral(patch.name)}) on conflict (slug) do update set updated_at = now();`,
      );
    } else {
      lines.push(
        `insert into public.course_catalog (${cols.join(', ')}) values (${values.join(', ')})` +
          ` on conflict (slug) do update set ${updates}, updated_at = now();`,
      );
    }
  }
  lines.push(`-- ${bySlug.size} rows`);
  const text = `${lines.join('\n')}\n`;
  if (outPath) {
    writeFileSync(outPath, text, 'utf8');
    console.log(`Wrote ${bySlug.size} catalog upserts -> ${outPath}`);
  } else {
    process.stdout.write(text);
  }
  process.exit(0);
}

const courses = loadCourses();
let updated = 0;
let unmatched = 0;
let addressFilled = 0;

for (const patch of bySlug.values()) {
  const course = courses.find((c) => slugFromCourseName(c.name) === patch.slug);
  if (!course) {
    unmatched++;
    console.warn(`No courses.json match for slug: ${patch.slug}`);
    continue;
  }
  let touched = false;
  for (const col of JSON_COLUMNS) {
    if (patch[col] === undefined) continue;
    if (col === 'holes' && patch[col] !== 9 && patch[col] !== 18) continue;
    course[col] = patch[col];
    touched = true;
  }
  if (patch._csv_address && !course.address) {
    course.address = patch._csv_address;
    addressFilled++;
    touched = true;
  }
  if (touched) updated++;
}

writeCourses(courses);
console.log(
  `Merged enrichment into courses.json: ${updated} courses updated, ${addressFilled} addresses filled (empty only), ${unmatched} unmatched.`,
);
console.log('Next: node scripts/sheet-rates-to-sql.mjs  then apply data/rates-upsert.sql in Supabase.');
