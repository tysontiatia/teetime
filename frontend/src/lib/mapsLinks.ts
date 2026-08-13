import type { Course } from '../types';

export type MapsCourse = Pick<Course, 'catalogName' | 'name' | 'city' | 'state' | 'lat' | 'lng'>;

function placeQuery(course: MapsCourse): string {
  const place = [course.city, course.state].filter(Boolean).join(', ');
  return [course.catalogName || course.name, place].filter(Boolean).join(', ');
}

function destinationParam(course: MapsCourse): string {
  if (typeof course.lat === 'number' && typeof course.lng === 'number') {
    return `${course.lat},${course.lng}`;
  }
  return placeQuery(course);
}

/** Opens Google Maps for this course (reviews live on the place page). No API key — uses search by coordinates or name. */
export function googleMapsPlaceUrl(course: MapsCourse): string {
  const base = 'https://www.google.com/maps/search/?api=1';
  return `${base}&query=${encodeURIComponent(destinationParam(course))}`;
}

/** Google Maps directions to the course. */
export function googleMapsDirectionsUrl(course: MapsCourse): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationParam(course))}`;
}

/** Apple Maps directions to the course (opens Maps app on iOS / macOS when available). */
export function appleMapsDirectionsUrl(course: MapsCourse): string {
  const daddr = encodeURIComponent(destinationParam(course));
  const label = encodeURIComponent(course.catalogName || course.name || 'Golf course');
  return `https://maps.apple.com/?daddr=${daddr}&q=${label}&dirflg=d`;
}

/** Mobile, touch, or installed PWA — offer Google vs Apple Maps instead of opening one immediately. */
export function shouldOfferMapsChoice(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || Boolean(nav.standalone);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.matchMedia('(max-width: 720px)').matches;
  const mobileUa = /Android|iPhone|iPad|iPod/i.test(nav.userAgent || '');
  return standalone || coarse || narrow || mobileUa;
}
