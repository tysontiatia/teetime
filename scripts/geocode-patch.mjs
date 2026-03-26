import { readFileSync, writeFileSync } from 'fs';

const courses = JSON.parse(readFileSync('./public/courses.json', 'utf8'));

// More specific queries for the ones that failed
const overrides = {
  'Bonneville (SLC)':                   'Bonneville Golf Course Salt Lake City Utah',
  'Carbon CC (Helper)':                  'Carbon Country Club Helper Utah golf',
  'Davis Park (Kaysville)':              'Davis Park Golf Course Kaysville Utah',
  'Forest Dale (SLC)':                   'Forest Dale Golf Course Salt Lake City Utah',
  'Glendale (SLC)':                      'Glendale Golf Course Salt Lake City Utah',
  'Meadow Brook (SLC)':                  'Meadow Brook Golf Course Murray Utah',
  'Mountain Dell (SLC)':                 'Mountain Dell Golf Course Salt Lake City Utah',
  'Nibley Park (SLC)':                   'Nibley Park Golf Course Salt Lake City Utah',
  'Old Mill (SLC)':                      'Old Mill Golf Course Sandy Utah',
  'Park City Golf Club (Park City)':     'Park City Municipal Golf Course Park City Utah',
  'Rose Park (SLC)':                     'Rose Park Golf Course Salt Lake City Utah',
  'Sand Hollow Championship (Hurricane)':'Sand Hollow Resort Golf Course Hurricane Utah',
  'Sand Hollow Links (Hurricane)':       'Sand Hollow Resort Hurricane Utah',
  'SunRiver Golf Club (St. George)':     'SunRiver Golf Club St George Utah',
  'The Oaks at Spanish Fork (Spanish Fork)': 'The Oaks Golf Course Spanish Fork Utah',
  'Timpanogos Championship (Provo)':     'Timpanogos Golf Course Provo Utah',
  'Timpanogos Pasture (Provo)':          'Timpanogos Golf Provo Utah',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'UtahTeeTimes/1.0 (personal project)' } });
  const data = await res.json();
  return data.length > 0 ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : null;
}

const missing = [];

for (const course of courses) {
  if (course.lat !== null) continue;
  const query = overrides[course.name];
  if (!query) continue;

  const result = await geocode(query);
  if (result) {
    course.lat = result.lat;
    course.lng = result.lng;
    console.log(`✓  ${course.name}  →  ${result.lat}, ${result.lng}`);
  } else {
    missing.push(course.name);
    console.log(`✗  ${course.name}  — still missing`);
  }
  await sleep(1100);
}

writeFileSync('./public/courses.json', JSON.stringify(courses, null, 2));
console.log('\nStill missing:', missing.length ? missing.join(', ') : 'none');
