import { readFileSync, writeFileSync } from 'fs';

const courses = JSON.parse(readFileSync('./public/courses.json', 'utf8'));

function extractCity(name) {
  const match = name.match(/\(([^)]+)\)$/);
  return match ? match[1] : '';
}

function getState(name) {
  if (name.includes('(WY)')) return 'Wyoming';
  return 'Utah';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function geocode(course) {
  const city = extractCity(course.name);
  const state = getState(course.name);
  // Strip parenthetical city from course name for cleaner search
  const courseName = course.name.replace(/\s*\([^)]+\)$/, '').trim();
  const query = `${courseName}, ${city}, ${state}`;

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'UtahTeeTimes/1.0 (personal project)' }
    });
    const data = await res.json();
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), query };
    }
    return { lat: null, lng: null, query };
  } catch {
    return { lat: null, lng: null, query };
  }
}

const results = [];

for (let i = 0; i < courses.length; i++) {
  const course = courses[i];
  const { lat, lng, query } = await geocode(course);
  course.lat = lat;
  course.lng = lng;

  const status = lat ? '✓' : '✗ MISSING';
  console.log(`[${i + 1}/${courses.length}] ${status}  ${course.name}  →  ${lat}, ${lng}`);
  if (!lat) results.push(course.name);

  await sleep(1100); // Nominatim rate limit: 1 req/sec
}

writeFileSync('./public/courses.json', JSON.stringify(courses, null, 2));
console.log('\nDone. Missing coordinates:', results.length ? results.join(', ') : 'none');
