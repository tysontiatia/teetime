#!/usr/bin/env node
/**
 * One-time backfill: public/courses.json → Supabase course_registry + course_catalog seed.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/backfill-course-registry.mjs
 *   node scripts/backfill-course-registry.mjs --dry-run
 */

import { readFileSync } from 'fs';
import { loadDotEnv } from './lib/courses-json.mjs';
import { slugFromCourseName } from '../worker/courseAdmin.js';

loadDotEnv();

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://nmwlebcvezybfwertlzs.supabase.co';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY;
const dryRun = process.argv.includes('--dry-run');

if (!SERVICE_KEY) {
  console.error(`
Missing Supabase service role key.

Add to repo-root .env (same folder as package.json):

  SUPABASE_URL=https://nmwlebcvezybfwertlzs.supabase.co
  SUPABASE_SERVICE_KEY=your_service_role_key_here

Get the key: Supabase Dashboard → Project Settings → API → service_role (secret).
Never commit this key or use it in the browser — worker/scripts only.

Also ensure migration 20260709120000_course_registry_admin.sql is applied first.
`);
  process.exit(1);
}

const courses = JSON.parse(readFileSync('./public/courses.json', 'utf8'));

function headers() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates',
  };
}

async function upsertCatalog(slug, name) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/course_catalog?on_conflict=slug`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ slug, name }),
  });
  if (!res.ok) throw new Error(`catalog ${slug}: ${await res.text()}`);
}

async function upsertRegistry(slug, record) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/course_registry?on_conflict=slug`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ slug, record }),
  });
  if (!res.ok) throw new Error(`registry ${slug}: ${await res.text()}`);
}

let ok = 0;
for (const course of courses) {
  const slug = slugFromCourseName(course.name);
  if (!slug) {
    console.warn('skip (no slug):', course.name);
    continue;
  }
  if (dryRun) {
    console.log('would upsert', slug, course.name);
    ok++;
    continue;
  }
  await upsertCatalog(slug, course.name);
  await upsertRegistry(slug, course);
  ok++;
  console.log('✓', slug);
}

console.log(`\nDone. ${ok} courses ${dryRun ? '(dry run)' : 'backfilled to course_registry'}.`);
