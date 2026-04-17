import { readFileSync, writeFileSync } from 'fs';

const API_KEY = process.env.GOOGLE_PLACES_KEY;
if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_KEY env var.');
  process.exit(1);
}

const courses = JSON.parse(readFileSync('./public/courses.json', 'utf8'));

const overrides = {
  'Barn Golf Club (Ogden)':       'Barn Golf Club Ogden Utah',
  'Bear Lake (Garden City)':      'Bear Lake Golf Course Garden City Utah',
  'Bonneville (SLC)':             'Bonneville Golf Course Salt Lake City Utah',
  'Bountiful Ridge (Bountiful)':  'Bountiful Ridge Golf Course Bountiful Utah',
  'Dinaland (Vernal)':            'Dinaland Golf Course Vernal Utah',
  'Dixie Red Hills (St. George)': 'Dixie Red Hills Golf Course St George Utah',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findPlace(query, lat, lng) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lng}&radius=8000&key=${API_KEY}`;
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

for (const course of courses) {
  const query = overrides[course.name];
  if (!query) continue;

  const place = await findPlace(query, course.lat, course.lng);
  if (!place) {
    console.log(`✗  ${course.name}  — still not found`);
    await sleep(300);
    continue;
  }

  course.rating       = place.rating ?? null;
  course.review_count = place.user_ratings_total ?? null;
  course.address      = place.formatted_address ?? null;

  if (place.photos?.[0]?.photo_reference) {
    course.photo_url = await getPhotoUrl(place.photos[0].photo_reference);
    await sleep(200);
  } else {
    course.photo_url = null;
  }

  console.log(`✓  ${course.name}  →  ★${course.rating ?? '?'}  (${course.review_count ?? 0} reviews)`);
  await sleep(300);
}

writeFileSync('./public/courses.json', JSON.stringify(courses, null, 2));
console.log('\nDone.');
