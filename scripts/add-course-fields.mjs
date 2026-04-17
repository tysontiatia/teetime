import { readFileSync, writeFileSync } from 'fs';

const courses = JSON.parse(readFileSync('./public/courses.json', 'utf8'));

for (const course of courses) {
  if (!('description' in course)) course.description = null;
  if (!('par'         in course)) course.par         = null;
  if (!('holes'       in course)) course.holes        = null;
  if (!('walkable'    in course)) course.walkable     = null;
}

writeFileSync('./public/courses.json', JSON.stringify(courses, null, 2));
console.log(`Updated ${courses.length} courses.`);
