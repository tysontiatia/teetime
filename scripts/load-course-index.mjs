#!/usr/bin/env node
/**
 * Load the 18Birdies export into course_index (one row per club + layout).
 *
 * Dry run (default): reads and cleans the files, prints counts, writes nothing.
 *   node scripts/load-course-index.mjs
 *   node scripts/load-course-index.mjs --state UT
 * Load into Supabase (upserts on course_key; never touches match columns):
 *   node scripts/load-course-index.mjs --state UT --apply
 *
 * --dir defaults to ~/Documents/USA Courses. Reads every
 * *_golf_courses_18birdies.json plus retry_failed_pages_golf_courses_18birdies.json.
 * Reads SUPABASE_SERVICE_KEY from .env or worker/.dev.vars for --apply.
 */

import { readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { indexRowsForEntry, mergeSourceRows } from '../worker/courseIndex.js';
import { timezonePinKey } from '../worker/courseTimezone.js';
import { loadDotEnv } from './lib/courses-json.mjs';
import { exactTimezoneFor } from './lib/exactTimezone.mjs';

loadDotEnv();
loadDotEnv('./worker/.dev.vars');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : '';
}

const DIR = arg('dir') || join(homedir(), 'Documents', 'USA Courses');
const STATE = arg('state').trim().toUpperCase();
const APPLY = process.argv.includes('--apply');
const RETRY_FILE = 'retry_failed_pages_golf_courses_18birdies.json';

const STATE_CODES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  new_hampshire: 'NH', new_jersey: 'NJ', new_mexico: 'NM', new_york: 'NY', north_carolina: 'NC', north_dakota: 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', rhode_island: 'RI', south_carolina: 'SC',
  south_dakota: 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  west_virginia: 'WV', wisconsin: 'WI', wyoming: 'WY', district_of_columbia: 'DC',
};

/** "new_hampshire_extra_golf_courses_18birdies.json" → "NH". */
function stateFromFileName(file) {
  const key = file.replace(/_golf_courses_18birdies\.json$/, '').replace(/_extra$/, '');
  const code = STATE_CODES[key];
  if (!code) throw new Error(`No state for file ${file}`);
  return code;
}

/** Every cleaned index row from the export, optionally for one state. */
export function loadIndexRows(dir = DIR, state = STATE) {
  const files = readdirSync(dir).filter((f) => f.endsWith('_golf_courses_18birdies.json') && f !== RETRY_FILE);
  // Each row remembers its file's state: about 2,800 clubs have a blank club.state.
  const stateRows = files.flatMap((f) =>
    JSON.parse(readFileSync(join(dir, f), 'utf8')).map((row) => ({ ...row, file_state: stateFromFileName(f) })),
  );
  const retryRows = JSON.parse(readFileSync(join(dir, RETRY_FILE), 'utf8'));
  const merged = mergeSourceRows(stateRows, retryRows);
  const rows = [];
  for (const entry of merged.rows) {
    for (const row of indexRowsForEntry(entry)) {
      if (state && row.state !== state) continue;
      const timezone = exactTimezoneFor(row.lat, row.lng);
      rows.push({ ...row, timezone, timezone_pin: timezone ? timezonePinKey(row.lat, row.lng) : null });
    }
  }
  return { files: files.length, sourceRows: stateRows.length, replaced: merged.replaced, unresolved: merged.unresolved, clubs: merged.rows.length, rows };
}

const DB_COLUMNS = [
  'course_key', 'club_id', 'course_slug', 'course_name', 'course_position', 'course_count', 'layout_kind',
  'club_name', 'source_url', 'state', 'city', 'zip', 'address', 'lat', 'lng', 'timezone', 'timezone_pin',
  'phone', 'website', 'website_kind', 'website_host', 'directory_url', 'membership', 'bookable', 'fee_text',
  'club_holes', 'holes', 'par', 'yardage', 'tees',
];

function count(rows, key) {
  const out = {};
  for (const row of rows) out[row[key] || '(blank)'] = (out[row[key] || '(blank)'] || 0) + 1;
  return out;
}

async function upsert(rows) {
  const url = process.env.SUPABASE_URL || 'https://nmwlebcvezybfwertlzs.supabase.co';
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_KEY is required for --apply');
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500).map((row) => {
      const out = {};
      for (const col of DB_COLUMNS) out[col] = row[col] ?? null;
      out.updated_at = new Date().toISOString();
      return out;
    });
    const res = await fetch(`${url}/rest/v1/course_index?on_conflict=course_key`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(part),
    });
    if (!res.ok) throw new Error(`course_index upsert failed at row ${i}: ${res.status} ${await res.text()}`);
    written += part.length;
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = loadIndexRows();
  const { rows } = result;
  const clubs = new Set(rows.map((r) => r.club_id));
  console.log(`${result.files} state files, ${result.sourceRows} source rows`);
  console.log(`retry merge: ${result.replaced} null-club rows replaced, ${result.unresolved} unresolved`);
  console.log(`${STATE || 'all states'}: ${clubs.size} clubs, ${rows.length} course rows`);
  console.log('bookable:', count(rows, 'bookable'));
  console.log('layouts:', count(rows, 'layout_kind'));
  console.log('website:', count(rows, 'website_kind'));
  console.log(
    'missing:',
    { state: rows.filter((r) => !r.state).length, pin: rows.filter((r) => r.lat == null).length, city: rows.filter((r) => !r.city).length, zip: rows.filter((r) => !r.zip).length, timezone: rows.filter((r) => !r.timezone).length },
  );
  if (!STATE) console.log('states:', Object.keys(count(rows, 'state')).length);
  if (APPLY) {
    const written = await upsert(rows);
    console.log(`Upserted ${written} rows into course_index.`);
  } else {
    console.log('\nDry run. Pass --apply to load.');
  }
}
