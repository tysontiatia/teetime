import { readFileSync, writeFileSync, existsSync } from 'fs';

/** Load GOOGLE_PLACES_KEY from repo-root `.env` if present (gitignored). */
export function loadDotEnv(path = './.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] == null) process.env[key] = val;
  }
}

export function loadCourses(path = './public/courses.json') {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Keep root + public catalogs in sync (Pages serves public/). */
export function writeCourses(courses) {
  const json = JSON.stringify(courses, null, 2);
  writeFileSync('./public/courses.json', json);
  writeFileSync('./courses.json', json);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function findPlaceByQuery(query, lat, lng, apiKey) {
  let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url += `&location=${lat},${lng}&radius=8000`;
  }
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) return null;
  return data.results[0];
}

/**
 * `region` should be the course's own state — a hardcoded one mis-biases every course
 * outside it, which is how out-of-state courses end up matched to same-named clubs
 * thousands of miles away. Omit it and the lat/lng bias carries the search.
 */
export async function findPlace(name, lat, lng, apiKey, region) {
  const query = [name, 'golf course', region].filter(Boolean).join(' ');
  return findPlaceByQuery(query, lat, lng, apiKey);
}

/** `515 Duncan Ave, Jersey City, NJ 07306, USA` → `NJ` */
export function stateFromAddress(address) {
  return /\b([A-Z]{2})[\s,]+\d{5}(?:-\d{4})?\b/.exec(String(address || ''))?.[1] || '';
}

export function applyPlaceMetadata(course, place) {
  course.rating = place.rating ?? null;
  course.review_count = place.user_ratings_total ?? null;
  course.address = place.formatted_address ?? null;

  const ref = place.photos?.[0]?.photo_reference;
  if (ref) {
    course.photo_reference = ref;
  } else {
    delete course.photo_reference;
  }
  delete course.photo_url;
}
