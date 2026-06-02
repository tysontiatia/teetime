import { applyPlaceMetadata, findPlace, loadCourses, loadDotEnv, sleep, writeCourses } from './lib/courses-json.mjs';

loadDotEnv();

const API_KEY = process.env.GOOGLE_PLACES_KEY || process.env.RESEND_API_KEY;
if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_KEY env var (add to .env, or set RESEND_API_KEY if misnamed).');
  console.error('Run: GOOGLE_PLACES_KEY=your_key node scripts/refresh-photo-references.mjs');
  process.exit(1);
}

const courses = loadCourses();
let updated = 0;
let missing = 0;
let skipped = 0;

for (const course of courses) {
  if (typeof course.lat !== 'number' || typeof course.lng !== 'number') {
    console.log(`⚠  ${course.name}  — no coordinates, skipping`);
    skipped++;
    continue;
  }

  const place = await findPlace(course.name, course.lat, course.lng, API_KEY);
  if (!place) {
    console.log(`✗  ${course.name}  — not found`);
    delete course.photo_reference;
    delete course.photo_url;
    missing++;
    await sleep(300);
    continue;
  }

  applyPlaceMetadata(course, place);
  const ref = course.photo_reference ? 'photo ref saved' : 'no photo';
  console.log(`✓  ${course.name}  →  ★${course.rating ?? '?'}  (${course.review_count ?? 0} reviews, ${ref})`);
  updated++;
  await sleep(300);
}

writeCourses(courses);
console.log(`\nDone. Updated: ${updated}  Missing: ${missing}  Skipped: ${skipped}`);
console.log('Next: wrangler secret put GOOGLE_PLACES_KEY  (if not set on the worker yet)');
console.log('Then deploy worker + Pages so /place-photo can serve images.');
