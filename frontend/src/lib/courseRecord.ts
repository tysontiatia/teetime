import type { Course } from '../types';
import { coursePhotoUrl } from './coursePhotoUrl';
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
  /** @deprecated Expired CDN URLs — use photo_reference + worker /place-photo instead. */
  photo_url?: string;
  /** Stable Google Places photo id — proxied via worker with GOOGLE_PLACES_KEY. */
  photo_reference?: string;
  schedule_id?: string;
  booking_class_id?: string;
  course_ids?: number[];
  golf_club_id?: string;
  golf_course_id?: string;
  club_id?: string;
  course_id?: string;
  affiliation_type_id?: string;
  /** Trutee public booking (City of St. George munis, etc.). */
  trutee_org_slug?: string;
  trutee_course_id?: string;
  booking_window_days?: number;
  booking_opens_time?: string;
  timezone?: string;
  holes?: 9 | 18;
  par?: number;
  yardage?: number;
  walkability?: 'flat' | 'moderate' | 'hilly' | 'carts only';
  rate_notes?: string;
  twilight_discount?: boolean;
  rates_updated_at?: string;
  cancellation_policy?: string;
  editorial_note?: string;
  signature_hole?: string;
  history_blurb?: string;
  /** Course marketing site (distinct from platform booking_url). */
  website?: string;
  phone_number?: string;
  poll_tier?: 'hot' | 'warm' | 'cold';
  booking_url_template?: string;
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
    area: record.area,
    lat: record.lat,
    lng: record.lng,
    photoUrl: coursePhotoUrl(record),
    rating: record.rating,
    reviewCount: record.review_count,
    distanceMi,
    bookingUrl: record.booking_url,
    platform: record.platform,
    holes: record.holes === 9 || record.holes === 18 ? record.holes : undefined,
  };
}
