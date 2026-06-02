import { applyPlaceMetadata, findPlaceByQuery, loadCourses, sleep, writeCourses } from './lib/courses-json.mjs';

const API_KEY = process.env.GOOGLE_PLACES_KEY;
if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_KEY env var.');
  process.exit(1);
}

const courses = loadCourses();

const overrides = {
  'Barn Golf Club (Ogden)': 'Barn Golf Club Ogden Utah',
  'Bear Lake (Garden City)': 'Bear Lake Golf Course Garden City Utah',
  'Bonneville (SLC)': 'Bonneville Golf Course Salt Lake City Utah',
  'Bountiful Ridge (Bountiful)': 'Bountiful Ridge Golf Course Bountiful Utah',
  'Dinaland (Vernal)': 'Dinaland Golf Course Vernal Utah',
  'Dixie Red Hills (St. George)': 'Dixie Red Hills Golf Course St George Utah',
};

for (const course of courses) {
  const query = overrides[course.name];
  if (!query) continue;

  const place = await findPlaceByQuery(query, course.lat, course.lng, API_KEY);
  if (!place) {
    console.log(`✗  ${course.name}  — still not found`);
    await sleep(300);
    continue;
  }

  applyPlaceMetadata(course, place);
  console.log(`✓  ${course.name}  →  ★${course.rating ?? '?'}  (${course.review_count ?? 0} reviews)`);
  await sleep(300);
}

writeCourses(courses);
console.log('\nDone.');
