#!/usr/bin/env node

import { readFileSync } from 'fs';

function loadDotEnv() {
  try {
    const content = readFileSync('./.env', 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch (e) {}
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function findPlace(name, lat, lng, apiKey, state) {
  const query = [name, 'golf course', state].filter(Boolean).join(' ');
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}&location=${lat},${lng}&radius=8000`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) return null;
  return data.results[0];
}

function stateFromAddress(address) {
  return /\b([A-Z]{2})[\s,]+\d{5}(?:-\d{4})?\b/.exec(String(address || ''))?.[1] || '';
}

loadDotEnv();

const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!GOOGLE_PLACES_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars');
  process.exit(1);
}

let updated = 0, missing = 0, skipped = 0, errors = 0;
console.log('📸 Downloading and caching course photos...\n');

try {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/course_catalog?select=slug,name,photo_storage_url,lat,lng&order=name.asc`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
  });
  const courses = await res.json();

  if (!courses.length) { console.warn('No courses found'); process.exit(0); }
  console.log(`Found ${courses.length} courses\n`);

  const registryRes = await fetch(`${SUPABASE_URL}/rest/v1/course_registry?select=slug,record`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
  });
  const registryRows = await registryRes.json();
  const addressBySlug = new Map(registryRows.map(r => [r.slug, r.record?.address]));

  for (const dbCourse of courses) {
    if (dbCourse.photo_storage_url) {
      console.log(`⊘  ${dbCourse.name}  — cached`);
      skipped++;
      await sleep(100);
      continue;
    }

    if (!Number.isFinite(dbCourse.lat) || !Number.isFinite(dbCourse.lng)) {
      console.log(`⚠️  ${dbCourse.name}  — no coords`);
      skipped++;
      continue;
    }

    const place = await findPlace(dbCourse.name, dbCourse.lat, dbCourse.lng, GOOGLE_PLACES_KEY, stateFromAddress(addressBySlug.get(dbCourse.slug)));
    if (!place || !place.photos?.[0]?.photo_reference) {
      console.log(`✗  ${dbCourse.name}  — not found`);
      missing++;
      await sleep(300);
      continue;
    }

    const photoRef = place.photos[0].photo_reference;
    const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${GOOGLE_PLACES_KEY}`;
    
    let photoBuffer;
    try {
      const photoResponse = await fetch(photoUrl);
      photoBuffer = await photoResponse.arrayBuffer();
    } catch (e) {
      console.log(`❌ ${dbCourse.name}  — download error`);
      errors++;
      await sleep(300);
      continue;
    }

    const storagePath = `${dbCourse.slug}.jpg`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/course-photos/${storagePath}`;

    try {
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'image/jpeg' },
        body: photoBuffer,
      });
      if (!uploadRes.ok) throw new Error(`${uploadRes.status} ${await uploadRes.text()}`);
    } catch (e) {
      console.log(`❌ ${dbCourse.name}  — upload error: ${e.message}`);
      errors++;
      await sleep(300);
      continue;
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/course-photos/${storagePath}`;
    try {
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/course_catalog?slug=eq.${dbCourse.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
        body: JSON.stringify({ photo_storage_path: storagePath, photo_storage_url: publicUrl, photos_fetched_at: new Date().toISOString() }),
      });
      if (!patchRes.ok) throw new Error(`${patchRes.status} ${await patchRes.text()}`);
    } catch (e) {
      console.log(`❌ ${dbCourse.name}  — update error: ${e.message}`);
      errors++;
      await sleep(300);
      continue;
    }

    console.log(`✓  ${dbCourse.name}  (${photoBuffer.byteLength} bytes)`);
    updated++;
    await sleep(300);
  }
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

console.log(`\nDone! Updated: ${updated}  Missing: ${missing}  Skipped: ${skipped}  Errors: ${errors}`);
process.exit(errors > 0 ? 1 : 0);
