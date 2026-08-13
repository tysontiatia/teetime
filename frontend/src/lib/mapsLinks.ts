import type { Course } from '../types';

/** Opens Google Maps for this course (reviews live on the place page). No API key — uses search by coordinates or name. */
export function googleMapsPlaceUrl(
  course: Pick<Course, 'catalogName' | 'name' | 'city' | 'state' | 'lat' | 'lng'>,
): string {
  const base = 'https://www.google.com/maps/search/?api=1';
  if (typeof course.lat === 'number' && typeof course.lng === 'number') {
    return `${base}&query=${encodeURIComponent(`${course.lat},${course.lng}`)}`;
  }
  const place = [course.city, course.state].filter(Boolean).join(', ');
  const q = [course.catalogName, place].filter(Boolean).join(' ');
  return `${base}&query=${encodeURIComponent(q)}`;
}
