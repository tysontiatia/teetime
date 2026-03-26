import { readFileSync, writeFileSync } from 'fs';

const courses = JSON.parse(readFileSync('./public/courses.json', 'utf8'));

const manual = {
  'Carbon CC (Helper)':               { lat: 39.6843, lng: -110.8578 },
  'Davis Park (Kaysville)':           { lat: 40.9794, lng: -111.9359 },
  'Meadow Brook (SLC)':               { lat: 40.6463, lng: -111.8218 },
  'Nibley Park (SLC)':                { lat: 40.7106, lng: -111.8691 },
  'Old Mill (SLC)':                   { lat: 40.6354, lng: -111.8121 },
  'Park City Golf Club (Park City)':  { lat: 40.6443, lng: -111.4966 },
  'SunRiver Golf Club (St. George)':  { lat: 37.0475, lng: -113.5477 },
  'The Oaks at Spanish Fork (Spanish Fork)': { lat: 40.1091, lng: -111.6726 },
};

for (const course of courses) {
  if (course.lat !== null) continue;
  const coords = manual[course.name];
  if (coords) {
    course.lat = coords.lat;
    course.lng = coords.lng;
    console.log(`✓  ${course.name}  →  ${coords.lat}, ${coords.lng}`);
  }
}

writeFileSync('./public/courses.json', JSON.stringify(courses, null, 2));

const stillMissing = courses.filter(c => c.lat === null);
console.log('\nStill null:', stillMissing.length ? stillMissing.map(c => c.name).join(', ') : 'none — all done!');
