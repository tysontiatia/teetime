#!/usr/bin/env node
/**
 * Export a fillable CSV for course detail / course_catalog enrichment.
 *
 * Usage:
 *   node scripts/export-course-catalog-csv.mjs
 *   node scripts/export-course-catalog-csv.mjs --out data/my-draft.csv
 *
 * Join key: slug (derived from name — do not edit unless correcting a mismatch).
 * Reference columns (area, platform) are for your spreadsheet; not imported to DB.
 *
 * Re-run export after editing courses.json to pick up any fields already on records.
 * After filling the CSV: npm run import:catalog-csv
 * Rates: npm run rates:sql → apply data/rates-upsert.sql in Supabase
 * Catalog policy/editorial: npm run catalog:sql → apply data/catalog-upsert.sql
 */

import { writeFileSync } from 'fs';
import { loadCourses } from './lib/courses-json.mjs';

const ENRICHMENT_COLUMNS = [
  'holes',
  'par',
  'yardage',
  'walkability',
  'rate_weekday_walk',
  'rate_weekend_walk',
  'cart_fee',
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
];

const REFERENCE_COLUMNS = ['area', 'platform'];

const ALL_COLUMNS = ['slug', 'name', ...REFERENCE_COLUMNS, ...ENRICHMENT_COLUMNS];

function slugFromCourseName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function csvCell(value) {
  if (value == null || value === '') return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowToCsv(row) {
  return ALL_COLUMNS.map((col) => csvCell(row[col])).join(',');
}

function pickEnrichment(course) {
  const out = {};
  for (const col of ENRICHMENT_COLUMNS) {
    if (col === 'timezone' && course.timezone == null) {
      out[col] = '';
      continue;
    }
    if (col === 'poll_tier' && course.poll_tier == null) {
      out[col] = '';
      continue;
    }
    if (col === 'twilight_discount') {
      if (course.twilight_discount === true) out[col] = 'true';
      else if (course.twilight_discount === false) out[col] = 'false';
      else out[col] = '';
      continue;
    }
    const v = course[col];
    out[col] = v == null ? '' : v;
  }
  return out;
}

function parseArgs(argv) {
  const outIdx = argv.indexOf('--out');
  return {
    outPath: outIdx >= 0 ? argv[outIdx + 1] : './data/course-catalog-enrichment.csv',
  };
}

const { outPath } = parseArgs(process.argv.slice(2));
const courses = loadCourses();

const rows = courses.map((course) => ({
  slug: slugFromCourseName(course.name),
  name: course.name,
  area: course.area ?? '',
  platform: course.platform ?? '',
  ...pickEnrichment(course),
}));

rows.sort((a, b) => a.name.localeCompare(b.name));

const lines = [
  ALL_COLUMNS.join(','),
  ...rows.map(rowToCsv),
  '',
];

writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`Wrote ${rows.length} courses → ${outPath}`);
console.log('Fill enrichment columns, then: node scripts/import-course-catalog-csv.mjs');
