import { readFileSync, writeFileSync } from 'fs';

const API_KEY = process.env.GOOGLE_PLACES_KEY;
if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_KEY env var. Run with: GOOGLE_PLACES_KEY=your_key node scripts/fetch-place-data.mjs');
  process.exit(1);
}

const courses = JSON.parse(readFileSync('./public/courses.json', 'utf8'));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findPlace(name, lat, lng) {
  const query = encodeURIComponent(`${name} golf course Utah`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&location=${lat},${lng}&radius=8000&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) return null;
  return data.results[0];
}

async function getPhotoUrl(photoReference) {
  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoReference}&key=${API_KEY}`;
  const res = await fetch(url, { redirect: 'follow' });
  return res.url;
}

let fetched = 0;
let skipped = 0;
let failed = 0;

for (const course of courses) {
  if (course.rating !== undefined && course.rating !== null) {
    skipped++;
    continue;
  }
  if (!course.lat) {
    console.log(`⚠  ${course.name}  — no coordinates, skipping`);
    skipped++;
    continue;
  }

  const place = await findPlace(course.name, course.lat, course.lng);
  if (!place) {
    console.log(`✗  ${course.name}  — not found`);
    course.rating = null;
    course.review_count = null;
    course.photo_url = null;
    course.address = null;
    failed++;
    await sleep(300);
    continue;
  }

  course.rating      = place.rating ?? null;
  course.review_count = place.user_ratings_total ?? null;
  course.address     = place.formatted_address ?? null;

  if (place.photos?.[0]?.photo_reference) {
    course.photo_url = await getPhotoUrl(place.photos[0].photo_reference);
    await sleep(200);
  } else {
    course.photo_url = null;
  }

  console.log(`✓  ${course.name}  →  ★${course.rating ?? '?'}  (${course.review_count ?? 0} reviews)`);
  fetched++;
  await sleep(300);
}

writeFileSync('./public/courses.json', JSON.stringify(courses, null, 2));
console.log(`\nDone. Fetched: ${fetched}  Skipped: ${skipped}  Failed: ${failed}`);
