import type { CourseRecord } from './courseRecord';
import type { ParseBookingUrlResult } from './courseAdminApi';
import { getPlatformCapability, platformDisplayName, detectPlatformFromBookingUrl } from './platformRegistry';

export type BookingStatus = 'pending' | 'ready' | 'phone' | 'unsupported' | 'private' | 'closed';

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Needs booking',
  ready: 'Has booking',
  phone: 'Phone / in-person',
  unsupported: 'Unsupported platform',
  private: 'Private / members-only',
  closed: 'Closed',
};

/** Apply parse-booking-url result onto a course record (hints + optional meta). */
export function applyParsedBookingUrl(
  record: CourseRecord,
  parsed: ParseBookingUrlResult,
  pastedUrl: string,
): CourseRecord {
  const hints = parsed.hints || {};
  const next: CourseRecord = {
    ...record,
    booking_url: parsed.booking_url || pastedUrl,
  };
  if (parsed.platform) {
    next.platform = parsed.platform;
  } else {
    const fromHost = detectPlatformFromBookingUrl(parsed.booking_url || pastedUrl);
    if (fromHost) next.platform = fromHost;
  }
  if (next.platform) {
    const status = bookingStatusFromPlatform(next.platform);
    if (status) next.booking_status = status;
  }
  if (hints.schedule_id) next.schedule_id = hints.schedule_id;
  if (hints.booking_class_id) next.booking_class_id = hints.booking_class_id;
  if (hints.club_id) next.club_id = hints.club_id;
  if (hints.course_id) next.course_id = hints.course_id;
  if (hints.affiliation_type_id) next.affiliation_type_id = hints.affiliation_type_id;
  if (hints.course_ids) {
    const ids = String(hints.course_ids)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length) next.course_ids = ids;
  }
  if (hints.trutee_org_slug) next.trutee_org_slug = hints.trutee_org_slug;
  if (hints.trutee_course_id) next.trutee_course_id = hints.trutee_course_id;
  if (hints.golfpay_course_id) next.golfpay_course_id = hints.golfpay_course_id;
  if (hints.cps_tenant) next.cps_tenant = hints.cps_tenant;
  if (hints.cps_course_id) next.cps_course_id = hints.cps_course_id;
  if (hints.facility_id) next.facility_id = hints.facility_id;
  if (hints.teeitup_alias) next.teeitup_alias = hints.teeitup_alias;
  if (hints.quick18_tenant) next.quick18_tenant = hints.quick18_tenant;
  if (hints.quick18_course_id) next.quick18_course_id = hints.quick18_course_id;
  if (hints.golfwithaccess_slug) next.golfwithaccess_slug = hints.golfwithaccess_slug;
  if (hints.golfwithaccess_course_id) next.golfwithaccess_course_id = hints.golfwithaccess_course_id;
  if (hints.clubcaddie_apikey) next.clubcaddie_apikey = hints.clubcaddie_apikey;
  if (hints.clubcaddie_course_id) next.clubcaddie_course_id = hints.clubcaddie_course_id;
  if (hints.teesnap_tenant) next.teesnap_tenant = hints.teesnap_tenant;
  if (hints.teesnap_course_id) next.teesnap_course_id = hints.teesnap_course_id;

  const meta = parsed.meta;
  if (meta) {
    if (meta.name && !next.name.trim()) next.name = meta.name;
    if (meta.address && !next.address) next.address = meta.address;
    if (meta.lat != null && next.lat == null) next.lat = meta.lat;
    if (meta.lng != null && next.lng == null) next.lng = meta.lng;
    if (meta.phone_number && !next.phone_number) next.phone_number = meta.phone_number;
    if (meta.website && !next.website) next.website = meta.website;
    if ((meta.holes === 9 || meta.holes === 18) && next.holes == null) next.holes = meta.holes;
  }
  return next;
}

/**
 * Live adapter → ready (supported). Known vendor without live inventory → unsupported.
 * Unknown host → null (caller should ask).
 */
export function bookingStatusFromPlatform(platform: string | null | undefined): 'ready' | 'unsupported' | null {
  const key = String(platform || '').trim();
  if (!key) return null;
  return getPlatformCapability(key) === 'live_inventory' ? 'ready' : 'unsupported';
}

export function parseDetectionMessage(platform: string | null | undefined): string {
  const key = String(platform || '').trim();
  if (!key) {
    return 'Could not detect the vendor from this URL — pick one from the list, or mark Other.';
  }
  const name = platformDisplayName(key);
  if (getPlatformCapability(key) === 'live_inventory') {
    return `${name} — live tee times. We’ll poll this course.`;
  }
  return `${name} — no live adapter yet. Marked unsupported; the booking link still works in Find.`;
}

export function externalHttpUrl(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

type BookingFields = {
  booking_status?: string | null;
  platform?: string | null;
  booking_url?: string | null;
};

/** Resolve explicit status, or infer ready vs pending for legacy Utah rows. */
export function resolveBookingStatus(c: BookingFields): BookingStatus {
  const raw = String(c.booking_status || '').trim();
  if (
    raw === 'ready' ||
    raw === 'phone' ||
    raw === 'unsupported' ||
    raw === 'private' ||
    raw === 'closed' ||
    raw === 'pending'
  ) {
    return raw;
  }
  if (String(c.platform || '').trim() && String(c.booking_url || '').trim()) return 'ready';
  return 'pending';
}

export function needsBookingRecord(c: BookingFields): boolean {
  return resolveBookingStatus(c) === 'pending';
}

export function isPublicCourseRecord(record: {
  booking_status?: string | null;
  platform?: string | null;
} | null | undefined): boolean {
  if (!record) return false;
  const status = resolveBookingStatus(record);
  if (status === 'closed' || status === 'private' || status === 'pending') return false;
  if (status === 'ready' || status === 'phone' || status === 'unsupported') return true;
  return Boolean(String(record.platform || '').trim());
}
