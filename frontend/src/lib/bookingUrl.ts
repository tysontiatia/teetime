import type { CourseRecord } from './courseRecord';
import { courseTimezone } from './teeTimeInstant';
import { formatTime12h } from './time';

export type BookingLinkParams = {
  dateYmd: string;
  players: number;
  holes?: number;
  /** Optional selected tee time — only applied when the template includes `{time}`. */
  startsAtIso?: string | null;
};

function foreupDateUs(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return ymd;
  return `${m}-${d}-${y}`;
}

function applyTemplate(
  template: string,
  params: BookingLinkParams,
  timeZone?: string | null,
): string {
  const holes = String(params.holes === 9 ? 9 : 18);
  const time =
    params.startsAtIso != null && params.startsAtIso !== ''
      ? encodeURIComponent(formatTime12h(params.startsAtIso, courseTimezone(timeZone)))
      : '';
  return template
    .replace(/\{date\}/g, params.dateYmd)
    .replace(/\{date_us\}/g, foreupDateUs(params.dateYmd))
    .replace(/\{players\}/g, String(Math.min(Math.max(params.players || 1, 1), 4)))
    .replace(/\{holes\}/g, holes)
    .replace(/\{time\}/g, time);
}

type ForeUpIds = {
  facilityId: string | null;
  scheduleId: string | null;
  host: string;
};

/** Parse facility / schedule IDs from a ForeUp booking URL or template. */
function parseForeUpIds(url: string, scheduleFromRecord?: string | null): ForeUpIds {
  const hostMatch = url.match(/https?:\/\/([^/]+)/i);
  const host = hostMatch?.[1] || 'foreupsoftware.com';
  const path = url.split('#')[0] || url;

  const facilitySchedule = path.match(/\/booking\/(\d+)\/(\d+)/);
  if (facilitySchedule) {
    return {
      facilityId: facilitySchedule[1]!,
      scheduleId: scheduleFromRecord || facilitySchedule[2]!,
      host,
    };
  }

  const indexFacility = path.match(/\/booking\/index\/(\d+)/);
  if (indexFacility) {
    return {
      facilityId: indexFacility[1]!,
      scheduleId: scheduleFromRecord || null,
      host,
    };
  }

  const facilityOnly = path.match(/\/booking\/(\d+)(?:\/?#|$|\?)/);
  if (facilityOnly) {
    return {
      facilityId: facilityOnly[1]!,
      scheduleId: scheduleFromRecord || null,
      host,
    };
  }

  return { facilityId: null, scheduleId: scheduleFromRecord || null, host };
}

/**
 * ForeUp SPA only auto-selects a class when BOTH `schedule_id` and
 * `booking_class_id` are present as URL search params (before the hash).
 * Without them it stays on the membership / booking-class list.
 */
function ensureForeUpDateOnTeeSheet(
  url: string,
  params: BookingLinkParams,
  scheduleId?: string | null,
  bookingClassId?: string | null,
): string {
  const dateUs = foreupDateUs(params.dateYmd);
  const players = String(Math.min(Math.max(params.players || 1, 1), 4));
  const holes = String(params.holes === 9 ? 9 : 18);

  // Drop any existing hash; rebuild as clean #/teetimes
  const beforeHash = url.trim().replace(/#.*$/, '').replace(/\/$/, '');

  try {
    const u = new URL(beforeHash);
    u.searchParams.set('date', dateUs);
    u.searchParams.set('players', players);
    u.searchParams.set('holes', holes);
    if (scheduleId) u.searchParams.set('schedule_id', scheduleId);
    if (bookingClassId) u.searchParams.set('booking_class_id', bookingClassId);
    return `${u.toString().replace(/\/$/, '')}#/teetimes`;
  } catch {
    const q = new URLSearchParams({
      date: dateUs,
      players,
      holes,
    });
    if (scheduleId) q.set('schedule_id', scheduleId);
    if (bookingClassId) q.set('booking_class_id', bookingClassId);
    const sep = beforeHash.includes('?') ? '&' : '?';
    return `${beforeHash}${sep}${q.toString()}#/teetimes`;
  }
}

/**
 * ForeUp's `/booking/index/{facility}` page is the booking-class picker.
 * Deep-link to `/booking/{facility}/{schedule}#/teetimes` and pass
 * schedule_id + booking_class_id so the SPA skips the class chooser.
 */
function buildForeUpTeeSheetUrl(
  source: BookingSource,
  params: BookingLinkParams,
): string | null {
  const bookingUrl = (source.booking_url || source.bookingUrl || '').trim();
  const templateOverride = (source.booking_url_template || '').trim();
  const scheduleId = source.schedule_id != null ? String(source.schedule_id).trim() : '';
  const bookingClassId =
    source.booking_class_id != null ? String(source.booking_class_id).trim() : '';

  const parseFrom = templateOverride || bookingUrl;
  const ids = parseForeUpIds(parseFrom, scheduleId || null);
  const resolvedSchedule = ids.scheduleId || scheduleId || null;
  const resolvedClass = bookingClassId || null;

  // Best path: facility + schedule → skip the booking-class picker.
  if (ids.facilityId && resolvedSchedule) {
    const sheet = `https://${ids.host}/index.php/booking/${ids.facilityId}/${resolvedSchedule}`;
    return ensureForeUpDateOnTeeSheet(sheet, params, resolvedSchedule, resolvedClass);
  }

  // Explicit tee-sheet template (not /booking/index/) when we lack a schedule id.
  if (templateOverride && !/\/booking\/index\//i.test(templateOverride)) {
    let sheet = templateOverride;
    if (sheet.includes('{')) {
      sheet = applyTemplate(sheet, params, source.timezone);
    }
    return ensureForeUpDateOnTeeSheet(sheet, params, resolvedSchedule, resolvedClass);
  }

  if (ids.facilityId) {
    const sheet = `https://${ids.host}/index.php/booking/${ids.facilityId}`;
    return ensureForeUpDateOnTeeSheet(sheet, params, resolvedSchedule, resolvedClass);
  }

  if (bookingUrl && /foreupsoftware\.com/i.test(bookingUrl) && !/\/booking\/index\//i.test(bookingUrl)) {
    return ensureForeUpDateOnTeeSheet(bookingUrl, params, resolvedSchedule, resolvedClass);
  }

  return bookingUrl || null;
}

/**
 * Numeric `/club/{id}` URLs 308 to a slug and drop the query string, so
 * deep-link params never arrive. Prefer catalog slug URLs; remap known IDs.
 */
const CHRONOGOLF_CLUB_SLUGS: Record<string, string> = {
  '14158': 'bonneville-golf-course',
  '14180': 'forest-dale-golf-course',
  '14185': 'glendale-golf-course',
  '14203': 'mountain-dell-golf-club',
  '14207': 'nibley-park-golf-course',
  '14222': 'rose-park-golf-course',
  '14225': 'sand-hollow-resort',
  '14257': 'the-ledges-golf-club',
};

function chronogolfClubBase(url: string): string {
  const cleaned = url.replace(/[?#].*$/, '').replace(/\/$/, '');
  // Drop trailing /booking so deep-links land on the club tee-sheet SPA.
  const withoutBooking = cleaned.replace(/\/booking$/i, '');
  const m = withoutBooking.match(/^(https?:\/\/(?:www\.)?chronogolf\.com\/club\/)(\d+)$/i);
  if (!m) return withoutBooking;
  const slug = CHRONOGOLF_CLUB_SLUGS[m[2]!];
  return slug ? `${m[1]}${slug}` : withoutBooking;
}

/**
 * Chronogolf's club overview ignores date/players alone. Jump to the tee sheet
 * with step=teetimes (+ holes / groupSize) the way the booking SPA expects.
 */
function buildChronogolfTeeTimesUrl(
  source: BookingSource,
  params: BookingLinkParams,
): string | null {
  const bookingUrl = (source.booking_url || source.bookingUrl || '').trim();
  const templateOverride = (source.booking_url_template || '').trim();

  // Explicit templates with placeholders win (rare; prefer booking_url otherwise).
  if (templateOverride.includes('{')) {
    return applyTemplate(templateOverride, params, source.timezone);
  }

  const base = chronogolfClubBase(bookingUrl || templateOverride);
  if (!base) return null;

  const players = String(Math.min(Math.max(params.players || 1, 1), 4));
  const holes = String(params.holes === 9 ? 9 : 18);
  // Keep coursesIds empty. Filling catalog course_id (e.g. Rose Park 16310)
  // makes Chronogolf show "released shortly" instead of the live sheet.
  const courseId = '';

  try {
    const u = new URL(base);
    u.searchParams.set('date', params.dateYmd);
    u.searchParams.set('players', players);
    u.searchParams.set('step', 'teetimes');
    u.searchParams.set('holes', holes);
    u.searchParams.set('coursesIds', courseId);
    u.searchParams.set('deals', 'false');
    u.searchParams.set('groupSize', players);
    return u.toString();
  } catch {
    const q = new URLSearchParams({
      date: params.dateYmd,
      players,
      step: 'teetimes',
      holes,
      coursesIds: courseId,
      deals: 'false',
      groupSize: players,
    });
    return `${base}?${q.toString()}`;
  }
}

/**
 * MemberSports reads the tee sheet date from the `teeSheetDate` path segment on
 * `/tee-sheet-linked/...` (not from query params on `/tee-times/...`).
 */
function parseMemberSportsIds(
  url: string,
  source: Pick<BookingSource, 'golf_club_id' | 'golf_course_id'>,
): { clubId: string; courseId: string; configType: string } | null {
  const fromUrl = url.match(
    /membersports\.com\/(?:tee-times|tee-sheet-linked|book-tee-time)\/(\d+)\/(\d+)(?:\/(\d+))?/i,
  );
  const clubId =
    source.golf_club_id != null && String(source.golf_club_id).trim()
      ? String(source.golf_club_id).trim()
      : fromUrl?.[1] ?? '';
  const courseId =
    source.golf_course_id != null && String(source.golf_course_id).trim()
      ? String(source.golf_course_id).trim()
      : fromUrl?.[2] ?? '';
  const configType = fromUrl?.[3] ?? '0';
  if (!clubId || !courseId) return null;
  return { clubId, courseId, configType };
}

function buildMemberSportsTeeTimesUrl(
  source: BookingSource,
  params: BookingLinkParams,
): string | null {
  const bookingUrl = (source.booking_url || source.bookingUrl || '').trim();
  const ids = parseMemberSportsIds(bookingUrl, source);
  if (!ids) return bookingUrl || null;
  return `https://app.membersports.com/tee-sheet-linked/${ids.clubId}/${ids.courseId}/${ids.configType}/0/false/${params.dateYmd}`;
}

function buildTruteeBookingUrl(source: BookingSource, params: BookingLinkParams): string | null {
  const orgSlug =
    source.trutee_org_slug != null && String(source.trutee_org_slug).trim()
      ? String(source.trutee_org_slug).trim()
      : '';
  const courseKey =
    source.trutee_course_id != null && String(source.trutee_course_id).trim()
      ? String(source.trutee_course_id).trim()
      : '';
  let base = (source.booking_url || source.bookingUrl || '').trim();
  if (!base && orgSlug && courseKey) {
    base = `https://trutee.app/courses/o/${orgSlug}?course=${encodeURIComponent(courseKey)}`;
  }
  if (!base) return null;

  const players = String(Math.min(Math.max(params.players || 1, 1), 4));
  const holes = String(params.holes === 9 ? 9 : 18);
  try {
    const u = new URL(base.split('#')[0] || base);
    if (courseKey) u.searchParams.set('course', courseKey);
    u.searchParams.set('date', params.dateYmd);
    u.searchParams.set('players', players);
    u.searchParams.set('holes', holes);
    return u.toString();
  } catch {
    return base;
  }
}

function buildTeeItUpBookingUrl(source: BookingSource, params: BookingLinkParams): string | null {
  const facilityId =
    source.facility_id != null && String(source.facility_id).trim()
      ? String(source.facility_id).trim()
      : '';
  // Tenant booking host varies (book-v2.teeitup.golf vs book.teeitup.com); use the
  // stored booking_url as the base. The widget reads course, date, golfers, holes.
  let base = (source.booking_url || source.bookingUrl || '').trim();
  if (!base && facilityId) {
    base = `https://aspira-management-company.book-v2.teeitup.golf/?course=${facilityId}`;
  }
  if (!base) return null;
  try {
    const u = new URL(base.split('#')[0] || base);
    if (facilityId) u.searchParams.set('course', facilityId);
    u.searchParams.set('date', params.dateYmd);
    u.searchParams.set('golfers', String(Math.min(Math.max(params.players || 1, 1), 4)));
    if (params.holes === 9 || params.holes === 18) {
      u.searchParams.set('holes', String(params.holes));
    } else {
      u.searchParams.delete('holes');
    }
    return u.toString();
  } catch {
    return base;
  }
}

function buildGolfPayBookingUrl(source: BookingSource, params: BookingLinkParams): string | null {
  const base = (source.booking_url || source.bookingUrl || '').trim();
  if (!base) return null;
  const players = String(Math.min(Math.max(params.players || 1, 1), 4));
  try {
    const u = new URL(base.split('#')[0] || base);
    u.searchParams.set('date', params.dateYmd);
    u.searchParams.set('players', players);
    if (params.holes === 9 || params.holes === 18) {
      u.searchParams.set('holes', String(params.holes));
    }
    if (!u.searchParams.has('sort')) u.searchParams.set('sort', 'lowest_price');
    return u.toString();
  } catch {
    return base;
  }
}

/**
 * Club Prophet Online Res v5 — param names are case-sensitive (Date, Player, Hole, CourseId).
 * https://onlinehelp.cps.golf/ … Passing Search Values from an External Site
 */
function buildCpsBookingUrl(source: BookingSource, params: BookingLinkParams): string | null {
  const tenant =
    source.cps_tenant != null && String(source.cps_tenant).trim()
      ? String(source.cps_tenant).trim()
      : '';
  let base = (source.booking_url || source.bookingUrl || '').trim();
  if (!base && tenant) {
    base = `https://${tenant}.cps.golf/onlineresweb/search-teetime`;
  }
  if (!base) return null;
  const players = Math.min(Math.max(params.players || 1, 1), 4);
  try {
    const u = new URL(base.split('#')[0] || base);
    u.searchParams.set('Date', params.dateYmd);
    u.searchParams.set('Player', String(players));
    if (params.holes === 9 || params.holes === 18) {
      u.searchParams.set('Hole', String(params.holes));
    } else {
      u.searchParams.set('Hole', 'Any');
    }
    const courseId =
      source.cps_course_id != null && String(source.cps_course_id).trim()
        ? String(source.cps_course_id).trim()
        : u.searchParams.get('CourseId') || '';
    if (courseId) u.searchParams.set('CourseId', courseId);
    if (!u.searchParams.has('TeeOffTimeMin')) u.searchParams.set('TeeOffTimeMin', '0');
    if (!u.searchParams.has('TeeOffTimeMax')) u.searchParams.set('TeeOffTimeMax', '23');
    return u.toString();
  } catch {
    return base;
  }
}

function defaultTemplate(
  record: Pick<CourseRecord, 'platform' | 'booking_url'>,
): string | null {
  const base = record.booking_url?.trim();
  if (!base) return null;
  return base;
}

function ymdToQuick18Date(ymd: string): string {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}

function quick18TenantFromSource(source: BookingSource): string {
  const explicit = source.quick18_tenant != null ? String(source.quick18_tenant).trim() : '';
  if (explicit) return explicit.replace(/[^a-z0-9-]/gi, '').toLowerCase();
  for (const raw of [source.booking_url, source.bookingUrl]) {
    try {
      const host = new URL(String(raw || '').trim()).hostname.toLowerCase();
      const m = host.match(/^([a-z0-9-]+)\.(quick18|play18)\.com$/i);
      if (m) return m[1]!.toLowerCase();
    } catch {
      /* ignore bad URLs */
    }
  }
  return '';
}

/**
 * Quick18 only honors `teedate=YYYYMMDD` on GET. Course / players / time-of-day
 * are POST body fields and are ignored as query params.
 */
function quick18SheetHostFromSource(source: BookingSource): string {
  for (const raw of [source.booking_url, source.bookingUrl]) {
    try {
      const host = new URL(String(raw || '').trim()).hostname.toLowerCase();
      if (/^[a-z0-9-]+\.(quick18|play18)\.com$/i.test(host)) return host;
    } catch {
      /* ignore bad URLs */
    }
  }
  const tenant = quick18TenantFromSource(source);
  return tenant ? `${tenant}.quick18.com` : '';
}

function buildQuick18BookingUrl(source: BookingSource, params: BookingLinkParams): string | null {
  const host = quick18SheetHostFromSource(source);
  const ymd = ymdToQuick18Date(params.dateYmd);
  const base = (source.booking_url || source.bookingUrl || '').trim();
  if (host && ymd) {
    return `https://${host}/teetimes/searchmatrix?teedate=${ymd}`;
  }
  if (!base || !ymd) return base || null;
  try {
    const u = new URL(base.split('#')[0] || base);
    u.searchParams.set('teedate', ymd);
    return u.toString();
  } catch {
    return base;
  }
}

function golfWithAccessSlugFromSource(source: BookingSource): string {
  const explicit = source.golfwithaccess_slug != null ? String(source.golfwithaccess_slug).trim() : '';
  if (explicit) return explicit.toLowerCase();
  const base = (source.booking_url || source.bookingUrl || '').trim();
  try {
    const path = new URL(base).pathname;
    return path.match(/\/course\/([a-z0-9-]+)(?:\/|$)/i)?.[1]?.toLowerCase() || '';
  } catch {
    return '';
  }
}

function buildGolfWithAccessBookingUrl(source: BookingSource, params: BookingLinkParams): string | null {
  const slug = golfWithAccessSlugFromSource(source);
  const base = (source.booking_url || source.bookingUrl || '').trim();
  const href = base || (slug ? `https://golfwithaccess.com/course/${slug}/reserve-tee-time` : '');
  if (!href) return null;
  const players = String(Math.min(Math.max(params.players || 1, 1), 4));
  try {
    const u = new URL(href.split('#')[0] || href);
    if (params.dateYmd) u.searchParams.set('date', params.dateYmd);
    u.searchParams.set('players', players);
    if (!u.searchParams.has('startAt')) u.searchParams.set('startAt', '0');
    if (!u.searchParams.has('endAt')) u.searchParams.set('endAt', '24');
    if (!u.searchParams.has('view')) u.searchParams.set('view', 'time');
    if (!u.searchParams.has('payMode')) u.searchParams.set('payMode', 'dollars');
    return u.toString();
  } catch {
    return base || null;
  }
}

function ymdToClubCaddieDate(ymd: string): string {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}

function buildClubCaddieBookingUrl(source: BookingSource, params: BookingLinkParams): string | null {
  const base = (source.booking_url || source.bookingUrl || '').trim();
  if (!base) return null;
  const players = String(Math.min(Math.max(params.players || 1, 1), 4));
  const us = ymdToClubCaddieDate(params.dateYmd);
  try {
    const u = new URL(base.split('#')[0] || base);
    if (us) u.searchParams.set('date', us);
    u.searchParams.set('player', players);
    if (!u.searchParams.has('ratetype')) u.searchParams.set('ratetype', 'any');
    u.searchParams.delete('Interaction');
    return u.toString();
  } catch {
    return base;
  }
}

function buildTeeSnapBookingUrl(source: BookingSource, params: BookingLinkParams): string | null {
  const base = (source.booking_url || source.bookingUrl || '').trim();
  if (!base) return null;
  const players = String(Math.min(Math.max(params.players || 1, 1), 4));
  const holes = params.holes === 9 ? '9' : '18';
  try {
    const u = new URL(base.split('#')[0] || base);
    if (params.dateYmd) u.searchParams.set('teedate', params.dateYmd);
    u.searchParams.set('players', players);
    u.searchParams.set('holes', holes);
    if (!u.searchParams.has('cart')) u.searchParams.set('cart', 'no');
    return u.toString();
  } catch {
    return base;
  }
}

export type BookingSource = {
  booking_url?: string | null;
  bookingUrl?: string | null;
  booking_url_template?: string | null;
  platform?: string | null;
  schedule_id?: string | number | null;
  booking_class_id?: string | number | null;
  course_id?: string | number | null;
  golf_course_id?: string | number | null;
  golf_club_id?: string | number | null;
  trutee_org_slug?: string | null;
  trutee_course_id?: string | null;
  facility_id?: string | number | null;
  teeitup_course_id?: string | null;
  cps_tenant?: string | null;
  cps_course_id?: string | null;
  quick18_tenant?: string | null;
  quick18_course_id?: string | null;
  golfwithaccess_slug?: string | null;
  golfwithaccess_course_id?: string | null;
  clubcaddie_apikey?: string | null;
  clubcaddie_course_id?: string | null;
  teesnap_tenant?: string | null;
  teesnap_course_id?: string | null;
  /** IANA timezone for `{time}` template formatting. */
  timezone?: string | null;
};

/**
 * Build an outbound vendor booking URL with date / players / holes when the
 * platform (or catalog template) supports it. Falls back to the bare booking URL.
 */
export function buildBookingUrl(
  source: BookingSource | CourseRecord | null | undefined,
  params: BookingLinkParams,
): string | null {
  if (!source) return null;

  const bookingUrl =
    ('booking_url' in source && source.booking_url?.trim()) ||
    ('bookingUrl' in source && source.bookingUrl?.trim()) ||
    null;

  const platform = ('platform' in source && source.platform) || undefined;
  const templateOverride =
    ('booking_url_template' in source && source.booking_url_template?.trim()) || null;
  const scheduleId =
    'schedule_id' in source && source.schedule_id != null ? String(source.schedule_id) : null;
  const bookingClassId =
    'booking_class_id' in source && source.booking_class_id != null
      ? String(source.booking_class_id)
      : null;
  const courseId =
    'course_id' in source && source.course_id != null ? String(source.course_id) : null;
  const golfCourseId =
    'golf_course_id' in source && source.golf_course_id != null
      ? String(source.golf_course_id)
      : null;
  const golfClubId =
    'golf_club_id' in source && source.golf_club_id != null ? String(source.golf_club_id) : null;
  const truteeOrgSlug =
    'trutee_org_slug' in source && source.trutee_org_slug != null
      ? String(source.trutee_org_slug)
      : null;
  const truteeCourseId =
    'trutee_course_id' in source && source.trutee_course_id != null
      ? String(source.trutee_course_id)
      : null;
  const facilityId =
    'facility_id' in source && source.facility_id != null ? String(source.facility_id) : null;
  const teeitupCourseId =
    'teeitup_course_id' in source && source.teeitup_course_id != null
      ? String(source.teeitup_course_id)
      : null;
  const cpsTenant =
    'cps_tenant' in source && source.cps_tenant != null ? String(source.cps_tenant) : null;
  const cpsCourseId =
    'cps_course_id' in source && source.cps_course_id != null ? String(source.cps_course_id) : null;
  const quick18Tenant =
    'quick18_tenant' in source && source.quick18_tenant != null
      ? String(source.quick18_tenant)
      : null;
  const quick18CourseId =
    'quick18_course_id' in source && source.quick18_course_id != null
      ? String(source.quick18_course_id)
      : null;
  const golfwithaccessSlug =
    'golfwithaccess_slug' in source && source.golfwithaccess_slug != null
      ? String(source.golfwithaccess_slug)
      : null;
  const golfwithaccessCourseId =
    'golfwithaccess_course_id' in source && source.golfwithaccess_course_id != null
      ? String(source.golfwithaccess_course_id)
      : null;
  const clubcaddieApiKey =
    'clubcaddie_apikey' in source && source.clubcaddie_apikey != null
      ? String(source.clubcaddie_apikey)
      : null;
  const clubcaddieCourseId =
    'clubcaddie_course_id' in source && source.clubcaddie_course_id != null
      ? String(source.clubcaddie_course_id)
      : null;
  const teesnapTenant =
    'teesnap_tenant' in source && source.teesnap_tenant != null ? String(source.teesnap_tenant) : null;
  const teesnapCourseId =
    'teesnap_course_id' in source && source.teesnap_course_id != null
      ? String(source.teesnap_course_id)
      : null;
  const timeZone =
    'timezone' in source && source.timezone != null ? String(source.timezone) : null;

  const bookingSource: BookingSource = {
    booking_url: bookingUrl,
    booking_url_template: templateOverride,
    platform,
    schedule_id: scheduleId,
    booking_class_id: bookingClassId,
    course_id: courseId,
    golf_course_id: golfCourseId,
    golf_club_id: golfClubId,
    trutee_org_slug: truteeOrgSlug,
    trutee_course_id: truteeCourseId,
    facility_id: facilityId,
    teeitup_course_id: teeitupCourseId,
    cps_tenant: cpsTenant,
    cps_course_id: cpsCourseId,
    quick18_tenant: quick18Tenant,
    quick18_course_id: quick18CourseId,
    golfwithaccess_slug: golfwithaccessSlug,
    golfwithaccess_course_id: golfwithaccessCourseId,
    clubcaddie_apikey: clubcaddieApiKey,
    clubcaddie_course_id: clubcaddieCourseId,
    teesnap_tenant: teesnapTenant,
    teesnap_course_id: teesnapCourseId,
    timezone: timeZone,
  };

  if (platform === 'foreup' || platform === 'foreup_login') {
    return buildForeUpTeeSheetUrl(bookingSource, params) || bookingUrl;
  }

  if (platform === 'chronogolf' || platform === 'chronogolf_slc') {
    return buildChronogolfTeeTimesUrl(bookingSource, params) || bookingUrl;
  }

  if (platform === 'membersports') {
    return buildMemberSportsTeeTimesUrl(bookingSource, params) || bookingUrl;
  }

  if (platform === 'trutee') {
    return buildTruteeBookingUrl(bookingSource, params) || bookingUrl;
  }

  if (platform === 'golfpay') {
    return buildGolfPayBookingUrl(bookingSource, params) || bookingUrl;
  }

  if (platform === 'cps') {
    return buildCpsBookingUrl(bookingSource, params) || bookingUrl;
  }

  if (platform === 'teeitup') {
    return buildTeeItUpBookingUrl(bookingSource, params) || bookingUrl;
  }

  if (platform === 'quick18' || /\.(quick18|play18)\.com/i.test(bookingUrl || '')) {
    return buildQuick18BookingUrl(bookingSource, params) || bookingUrl;
  }

  if (platform === 'golfwithaccess' || /golfwithaccess\.com/i.test(bookingUrl || '')) {
    return buildGolfWithAccessBookingUrl(bookingSource, params) || bookingUrl;
  }

  if (platform === 'clubcaddie' || /clubcaddie\.com/i.test(bookingUrl || '')) {
    return buildClubCaddieBookingUrl(bookingSource, params) || bookingUrl;
  }

  if (platform === 'teesnap' || /teesnap\.(net|com)/i.test(bookingUrl || '')) {
    return buildTeeSnapBookingUrl(bookingSource, params) || bookingUrl;
  }

  if (!bookingUrl) return null;

  const template = templateOverride || defaultTemplate({ platform: platform || '', booking_url: bookingUrl });
  if (!template) return bookingUrl;

  if (template.includes('{')) {
    return applyTemplate(template, params, timeZone);
  }
  return template;
}
