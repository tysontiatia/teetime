#!/usr/bin/env node
/**
 * Find courses that point at the same tee sheet as another course, and the
 * sheet each one should use, by the vendor's own sheet names.
 *
 * Dry run (default): prints current → proposed per course. Writes nothing.
 *   node scripts/repair-shared-sheets.mjs
 * Apply the proposed changes (backs up every record it touches first):
 *   node scripts/repair-shared-sheets.mjs --apply
 *
 * Only ForeUp, TeeItUp and Chronogolf publish sheet names. Groups on other
 * vendors, and any course that cannot be matched to exactly one sheet, are
 * listed for a person and never changed.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { sharedName, sheetFields, sheetForName, listSheetsFor } from '../worker/vendorSheets.js';
import { loadDotEnv } from './lib/courses-json.mjs';

loadDotEnv();
loadDotEnv('./worker/.dev.vars');
const APPLY = process.argv.includes('--apply');
const URL_BASE = process.env.SUPABASE_URL || 'https://nmwlebcvezybfwertlzs.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) {
  console.error('Set SUPABASE_SERVICE_KEY in .env or worker/.dev.vars.');
  process.exit(1);
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const rows = [];
for (let from = 0; ; from += 1000) {
  const res = await fetch(`${URL_BASE}/rest/v1/course_registry?select=slug,record&order=slug`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
  if (!res.ok) throw new Error(`registry read failed: ${res.status}`);
  const batch = await res.json();
  rows.push(...batch);
  if (batch.length < 1000) break;
}

const SHEET_KEY = {
  foreup: (r) => r.schedule_id && `${r.platform}:${r.schedule_id}`,
  teeitup: (r) => r.facility_id && `${r.platform}:${r.facility_id}`,
  chronogolf_slc: (r) => r.club_id && `${r.platform}:${r.club_id}:${r.course_id || JSON.stringify(r.course_ids)}`,
  membersports: (r) => r.golf_course_id && `${r.platform}:${r.golf_club_id}:${r.golf_course_id}`,
  trutee: (r) => r.trutee_course_id && `${r.platform}:${r.trutee_course_id}`,
  golfrev: (r) => r.golfrev_course_id && `${r.platform}:${r.golfrev_course_id}`,
  golfpay: (r) => r.golfpay_course_id && `${r.platform}:${r.golfpay_course_id}`,
};
const groups = new Map();
for (const row of rows) {
  const rec = row.record || {};
  const key = SHEET_KEY[rec.platform]?.(rec);
  if (!key) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}
const shared = [...groups.entries()].filter(([, list]) => list.length > 1);

const changes = [];
const manual = [];
for (const [key, list] of shared) {
  const platform = list[0].record.platform;
  const { sheets, context } = await listSheetsFor(platform, list[0].record);
  if (!sheets.length) {
    manual.push({ key, courses: list.map((r) => r.slug), reason: `${platform}: sheet names not available` });
    continue;
  }
  const clubName = sharedName(list.map((r) => r.record.name));
  const picks = list.map((row) => ({ row, sheet: sheetForName(row.record.name, sheets, { clubName, registry: true }) }));
  const used = new Map();
  for (const p of picks) if (p.sheet) used.set(p.sheet.id, (used.get(p.sheet.id) || 0) + 1);
  for (const { row, sheet } of picks) {
    if (!sheet || used.get(sheet.id) > 1) {
      manual.push({ key, courses: [row.slug], reason: sheet ? `two courses fit "${sheet.name}"` : `no single sheet fits; sheets: ${sheets.map((s) => `${s.id} ${s.name}`).join(' | ')}` });
      continue;
    }
    const fields = await sheetFields(platform, sheet, context);
    const current = Object.fromEntries(Object.keys(fields).map((k) => [k, row.record[k] ?? null]));
    // Only a wrong sheet id is fixed. A course already on its own sheet is left
    // exactly as it is (its booking URL and class may carry deliberate params).
    const idField = fields.schedule_id ? 'schedule_id' : fields.facility_id ? 'facility_id' : 'course_id';
    if (String(current[idField] ?? '') !== String(fields[idField])) {
      changes.push({ slug: row.slug, name: row.record.name, platform, sheet: sheet.name, current, fields });
    }
  }
}

console.log(`${shared.length} tee sheets shared by 2+ courses\n`);
console.log(`Proposed fixes (${changes.length}):`);
for (const c of changes) {
  const idField = c.fields.schedule_id ? 'schedule_id' : c.fields.facility_id ? 'facility_id' : 'course_id';
  console.log(`  ${c.slug}\n      ${c.platform} ${idField}: ${c.current[idField] ?? '(none)'} → ${c.fields[idField]}   sheet "${c.sheet}"`);
}
console.log(`\nFor a person (${manual.length}):`);
for (const m of manual) console.log(`  ${m.courses.join(', ')}  [${m.key}] ${m.reason}`);

if (!APPLY) {
  console.log('\nDry run. Nothing written.');
  process.exit(0);
}
mkdirSync('data/backups', { recursive: true });
const backup = `data/backups/shared-sheet-repair-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backup, JSON.stringify(rows.filter((r) => changes.some((c) => c.slug === r.slug)), null, 2));
console.log(`\nBacked up ${changes.length} records to ${backup}`);
for (const c of changes) {
  const row = rows.find((r) => r.slug === c.slug);
  const record = { ...row.record, ...c.fields };
  const res = await fetch(`${URL_BASE}/rest/v1/course_registry?slug=eq.${encodeURIComponent(c.slug)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ record }),
  });
  if (!res.ok) throw new Error(`${c.slug}: ${res.status} ${await res.text()}`);
}
console.log(`Updated ${changes.length} courses. Undo: restore ${backup}.`);
