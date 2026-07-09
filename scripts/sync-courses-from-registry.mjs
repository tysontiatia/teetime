#!/usr/bin/env node
/**
 * Export course_registry from Supabase → public/courses.json + courses.json
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/sync-courses-from-registry.mjs
 */

import { writeFileSync } from 'fs';
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

const res = await fetch(`${SUPABASE_URL}/rest/v1/course_registry?select=slug,record&order=slug`, {
  headers: {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  },
});

if (!res.ok) {
  console.error('fetch failed:', await res.text());
  process.exit(1);
}

const rows = await res.json();
if (!Array.isArray(rows) || rows.length === 0) {
  console.error('No rows in course_registry — run backfill first.');
  process.exit(1);
}

const courses = rows.map((r) => r.record).filter(Boolean);
const json = JSON.stringify(courses, null, 2);
writeFileSync('./public/courses.json', json);
writeFileSync('./courses.json', json);
console.log(`Wrote ${courses.length} courses to public/courses.json and courses.json`);
