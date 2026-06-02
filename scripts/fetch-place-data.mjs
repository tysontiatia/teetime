import { applyPlaceMetadata, findPlace, loadCourses, sleep, writeCourses } from './lib/courses-json.mjs';

const API_KEY = process.env.GOOGLE_PLACES_KEY;
if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_KEY env var. Run with: GOOGLE_PLACES_KEY=your_key node scripts/fetch-place-data.mjs');
  process.exit(1);
}

const courses = loadCourses();

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

  const place = await findPlace(course.name, course.lat, course.lng, API_KEY);
  if (!place) {
    console.log(`✗  ${course.name}  — not found`);
    course.rating = null;
    course.review_count = null;
    delete course.photo_reference;
    delete course.photo_url;
    course.address = null;
    failed++;
    await sleep(300);
    continue;
  }

  applyPlaceMetadata(course, place);
  console.log(`✓  ${course.name}  →  ★${course.rating ?? '?'}  (${course.review_count ?? 0} reviews)`);
  fetched++;
  await sleep(300);
}

writeCourses(courses);
console.log(`\nDone. Fetched: ${fetched}  Skipped: ${skipped}  Failed: ${failed}`);
