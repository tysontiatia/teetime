import type { Course } from '../types';
import { slugFromCourseName } from './courseSlug';

/** One row from `public/courses.json` */
export type CourseRecord = {
  name: string;
  area: string;
  platform: string;
  booking_url: string;
  lat?: number;
  lng?: number;
  rating?: number;
  review_count?: number;
  address?: string;
  photo_url?: string;
  schedule_id?: string;
  booking_class_id?: string;
  course_ids?: number[];
  golf_club_id?: string;
  golf_course_id?: string;
  club_id?: string;
  course_id?: string;
  affiliation_type_id?: string;
};

/** "Bear Lake (Garden City)" → { short: "Bear Lake", city: "Garden City" } */
export function parseCourseTitle(fullName: string): { short: string; city: string } {
  const m = fullName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) return { short: m[1].trim(), city: m[2].trim() };
  return { short: fullName.trim(), city: '' };
}

export function recordToCourse(record: CourseRecord, distanceMi?: number): Course {
  const { short, city } = parseCourseTitle(record.name);
  return {
    id: slugFromCourseName(record.name),
    catalogName: record.name,
    name: short,
    city: city || record.area || 'Utah',
    lat: record.lat,
    lng: record.lng,
    photoUrl: record.photo_url,
    rating: record.rating,
    distanceMi,
    bookingUrl: record.booking_url,
    platform: record.platform,
  };
}
