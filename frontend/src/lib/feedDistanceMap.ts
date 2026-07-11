import type { Course } from '../types';

export function courseDistanceMap(courses: Course[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const course of courses) {
    if (typeof course.distanceMi === 'number') {
      map.set(course.id, course.distanceMi);
    }
  }
  return map;
}
