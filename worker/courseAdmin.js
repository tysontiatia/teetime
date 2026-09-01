/**
 * Admin course catalog API — registry + course_catalog + course_rates writes.
 */

const PLATFORM_ID_FIELDS = {
  foreup: ['schedule_id', 'booking_class_id'],
  foreup_login: ['schedule_id', 'booking_class_id'],
  chronogolf: ['club_id', 'course_id', 'course_ids'],
  chronogolf_slc: ['club_id', 'course_id', 'course_ids', 'affiliation_type_id'],
  membersports: ['golf_club_id', 'golf_course_id'],
  trutee: ['trutee_org_slug', 'trutee_course_id'],
  golfpay: ['golfpay_course_id'],
  cps: ['cps_tenant', 'cps_course_id'],
  teeitup: ['facility_id', 'teeitup_course_id', 'teeitup_alias'],
  quick18: ['quick18_tenant', 'quick18_course_id'],
  golfwithaccess: ['golfwithaccess_course_id', 'golfwithaccess_slug'],
  clubcaddie: ['clubcaddie_course_id', 'clubcaddie_apikey'],
};

const ALL_PLATFORM_FIELDS = [
  'schedule_id',
  'booking_class_id',
  'club_id',
  'course_id',
  'affiliation_type_id',
  'golf_club_id',
  'golf_course_id',
  'course_ids',
  'trutee_org_slug',
  'trutee_course_id',
  'golfpay_course_id',
  'cps_tenant',
  'cps_course_id',
  'facility_id',
  'teeitup_course_id',
  'teeitup_alias',
  'quick18_tenant',
  'quick18_course_id',
  'golfwithaccess_course_id',
  'golfwithaccess_slug',
  'clubcaddie_course_id',
  'clubcaddie_apikey',
];

const RATE_SPECS = [
  { key: 'rate_weekday_walk_9', day_type: 'weekday', holes: 9, rider_type: 'walk', includes_cart: false },
  { key: 'rate_weekday_walk_18', day_type: 'weekday', holes: 18, rider_type: 'walk', includes_cart: false },
  { key: 'rate_weekday_cart_9', day_type: 'weekday', holes: 9, rider_type: 'cart', includes_cart: true },
  { key: 'rate_weekday_cart_18', day_type: 'weekday', holes: 18, rider_type: 'cart', includes_cart: true },
  { key: 'rate_weekend_walk_9', day_type: 'weekend', holes: 9, rider_type: 'walk', includes_cart: false },
  { key: 'rate_weekend_walk_18', day_type: 'weekend', holes: 18, rider_type: 'walk', includes_cart: false },
  { key: 'rate_weekend_cart_9', day_type: 'weekend', holes: 9, rider_type: 'cart', includes_cart: true },
  { key: 'rate_weekend_cart_18', day_type: 'weekend', holes: 18, rider_type: 'cart', includes_cart: true },
];

export function slugFromCourseName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const IMPORT_NAME_STOPWORDS = new Set([
  'golf',
  'course',
  'club',
  'country',
  'the',
  'at',
  'and',
  'resort',
  'spa',
  'a',
  'of',
  'cc',
]);

/** City label from "Name (City)" display names. */
export function extractCityFromCourseName(name) {
  const m = String(name || '').match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : '';
}

export function normalizeCityKey(city) {
  let s = String(city || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const aliases = [
    [/\bsalt lake city\b/g, 'slc'],
    [/\bnorth salt lake\b/g, 'n salt lake'],
    [/\beagle mountain\b/g, 'eagle mtn'],
    [/\bheber city\b/g, 'heber'],
    [/\bst george\b/g, 'st george'],
    [/\bwest valley city\b/g, 'west valley'],
    [/\bsaratoga springs\b/g, 'saratoga springs'],
    [/\bstansbury park\b/g, 'stansbury'],
  ];
  for (const [re, to] of aliases) s = s.replace(re, to);
  return s.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function tokenizeCourseName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !IMPORT_NAME_STOPWORDS.has(t));
}

/** Significant name tokens with city words removed (avoids "St. George" false matches). */
export function courseNameMatchTokens(fullName) {
  const city = extractCityFromCourseName(fullName);
  const base = String(fullName || '').replace(/\([^)]*\)\s*$/, '').trim();
  const raw = tokenizeCourseName(base);
  if (!city) return raw;
  const cityToks = new Set(tokenizeCourseName(city));
  const filtered = raw.filter((t) => !cityToks.has(t));
  // Facility name is the city (e.g. Cedar Hills) — keep tokens so we can still match.
  if (filtered.length === 0 && raw.length > 0) return raw;
  return filtered;
}

export function normalizeCourseBaseKey(fullName) {
  return courseNameMatchTokens(fullName).join('');
}

export function citiesCompatible(a, b) {
  const na = normalizeCityKey(a);
  const nb = normalizeCityKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

export function inferCourseState(record) {
  const addr = String(record?.address || '');
  const area = String(record?.area || '');
  const tz = String(record?.timezone || '').trim();
  if (/\bAZ\b/.test(addr) || /^Arizona\b/i.test(area) || tz === 'America/Phoenix') return 'AZ';
  if (/\bID\b/.test(addr) || /^Idaho\b/i.test(area) || tz === 'America/Boise') return 'ID';
  if (/\bUT\b/.test(addr) || /\bUtah\b/i.test(area)) return 'UT';
  // Legacy Utah area labels without "Utah" still use Denver.
  if (tz === 'America/Denver') return 'UT';
  return null;
}

/**
 * True when import name likely refers to an existing catalog course in the same state.
 * Prefers token-subset matches after stripping city words; falls back to compact base keys.
 */
export function courseNamesLikelyDuplicate(importName, existingName) {
  const ta = courseNameMatchTokens(importName);
  const tb = courseNameMatchTokens(existingName);
  if (ta.length && tb.length) {
    const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    const setL = new Set(longer);
    if (shorter.every((t) => setL.has(t))) {
      if (shorter.length >= 2) return true;
      if (shorter[0] && shorter[0].length >= 4) return true;
    }
  }
  const ka = normalizeCourseBaseKey(importName);
  const kb = normalizeCourseBaseKey(existingName);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const minLen = Math.min(ka.length, kb.length);
  if (minLen >= 10 && (ka.startsWith(kb) || kb.startsWith(ka))) return true;
  return false;
}

export function locationsCompatibleForImport(importRecord, existingRecord) {
  const importCity =
    extractCityFromCourseName(importRecord?.name) ||
    String(importRecord?.address || '')
      .split(',')[1]
      ?.trim() ||
    '';
  const existingCity = extractCityFromCourseName(existingRecord?.name);
  if (citiesCompatible(importCity, existingCity)) return true;
  const addr = String(existingRecord?.address || '').toLowerCase();
  const cityKey = normalizeCityKey(importCity);
  if (cityKey && cityKey.length >= 4 && addr.includes(cityKey)) return true;
  // First word of multi-word cities (e.g. "Washington" in full address).
  const first = cityKey.split(/\s+/)[0];
  if (first && first.length >= 5 && addr.includes(first)) return true;
  return false;
}

export function parseBookingUrl(rawUrl) {
  const out = { booking_url: String(rawUrl || '').trim(), platform: null, hints: {} };
  if (!out.booking_url) return out;

  let u;
  try {
    u = new URL(out.booking_url);
  } catch {
    return out;
  }

  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  if (host.includes('foreupsoftware.com')) {
    out.platform = 'foreup';
    // ForeUp tee-sheet deep links are /booking/{facility}/{schedule_id}#/teetimes.
    // The SECOND path segment is the schedule_id the times API needs; the first is
    // the facility/course_id. Do NOT treat the second segment as booking_class_id
    // (that is a query param, defaulting to 0). /booking/index/{facility} is the
    // class-picker page and carries no schedule_id, so leave it for manual entry.
    const facilitySchedule = path.match(/\/booking\/(\d+)\/(\d+)/);
    if (facilitySchedule) out.hints.schedule_id = facilitySchedule[2];
    return out;
  }

  if (host.includes('chronogolf.com')) {
    const clubMatch = path.match(/\/club\/([^/?#]+)/);
    if (clubMatch) out.hints.club_id = clubMatch[1];
    const courseMatch = path.match(/\/courses\/(\d+)/);
    if (courseMatch) out.hints.course_id = courseMatch[1];
    out.platform = 'chronogolf';
    return out;
  }

  if (host.includes('trutee.app')) {
    out.platform = 'trutee';
    const orgMatch = path.match(/\/courses\/o\/([^/?#]+)/);
    if (orgMatch) out.hints.trutee_org_slug = orgMatch[1];
    const courseParam = u.searchParams.get('course');
    if (courseParam) out.hints.trutee_course_id = courseParam;
    return out;
  }

  if (host.includes('membersports.com') || host.includes('app.membersports.com')) {
    out.platform = 'membersports';
    return out;
  }

  if (host.includes('teeitup')) {
    out.platform = 'teeitup';
    const facility = u.searchParams.get('course');
    if (facility) out.hints.facility_id = facility;
    // Tenant alias is the subdomain label (…book-v2.teeitup.golf / …book.teeitup.com).
    const label = host.split('.')[0];
    if (label && label !== 'book' && label !== 'www') out.hints.teeitup_alias = label;
    return out;
  }

  if (host.includes('golfpay.co')) {
    out.platform = 'golfpay';
    const gshcid = u.searchParams.get('_gshcid');
    if (gshcid) out.hints.golfpay_course_id = gshcid;
    return out;
  }

  if (host.endsWith('cps.golf') || host.includes('.cps.golf')) {
    out.platform = 'cps';
    const tenant = host.split('.')[0];
    if (tenant && tenant !== 'www') out.hints.cps_tenant = tenant;
    const courseId = u.searchParams.get('CourseId') || u.searchParams.get('CourseID');
    if (courseId) out.hints.cps_course_id = courseId;
    return out;
  }

  if (host.includes('tenfore')) {
    out.platform = 'tenfore';
    return out;
  }

  if (host.includes('golfnow')) {
    out.platform = 'golfnow';
    return out;
  }

  if (host.includes('ezlinksgolf') || host.endsWith('ezlinks.com') || host.includes('.ezlinks.com')) {
    out.platform = 'ezlinks';
    return out;
  }

  if (host.includes('teesnap')) {
    out.platform = 'teesnap';
    return out;
  }

  if (host.includes('clubessential')) {
    out.platform = 'clubessentials';
    return out;
  }

  if (host.includes('teeoff.com')) {
    out.platform = 'teeoff';
    return out;
  }

  if (host.includes('golfrev.com')) {
    out.platform = 'golfrev';
    const courseId = u.searchParams.get('courseid') || u.searchParams.get('courseId');
    if (courseId) out.hints.golfrev_course_id = courseId;
    return out;
  }

  if (host.includes('sagacitygolf.com')) {
    out.platform = 'sagacity';
    return out;
  }

  if (host.includes('quick18.com') || host.includes('play18.com')) {
    out.platform = 'quick18';
    const label = host.split('.')[0];
    if (label && label !== 'www') out.hints.quick18_tenant = label;
    return out;
  }

  if (host.includes('golfwithaccess.com')) {
    out.platform = 'golfwithaccess';
    const pathMatch = String(path || '').match(/\/course\/([a-z0-9-]+)(?:\/|$)/i);
    if (pathMatch) out.hints.golfwithaccess_slug = pathMatch[1].toLowerCase();
    return out;
  }

  if (host.includes('clubcaddie.com')) {
    out.platform = 'clubcaddie';
    const keyMatch = String(path || '').match(/\/webapi\/view\/([a-z0-9]+)(?:\/|$)/i);
    if (keyMatch) out.hints.clubcaddie_apikey = keyMatch[1].toLowerCase();
    return out;
  }

  if (host.includes('rguest.com') || host.includes('onagilysys.com')) {
    out.platform = 'rguest';
    return out;
  }

  if (host.includes('totaleintegrated.net')) {
    out.platform = 'totaleintegrated';
    return out;
  }

  if (host.includes('clubhouseonline')) {
    out.platform = 'clubhouseonline';
    return out;
  }

  if (host.includes('golfscape.com')) {
    out.platform = 'golfscape';
    return out;
  }

  if (host.includes('fareharbor.com')) {
    out.platform = 'fareharbor';
    return out;
  }

  if (host.includes('easyteegolf.com')) {
    out.platform = 'easyteegolf';
    return out;
  }

  if (host.includes('myvscloud.com')) {
    out.platform = 'vscloud';
    return out;
  }

  if (host.includes('prophetservices.com')) {
    out.platform = 'prophetservices';
    return out;
  }

  if (host.includes('valorclubs.com')) {
    out.platform = 'valorclubs';
    return out;
  }

  if (host.includes('floatinggreensoftware.com')) {
    out.platform = 'floatinggreen';
    return out;
  }

  return out;
}

const LIVE_ADAPTER_PLATFORMS = new Set([
  'foreup',
  'foreup_login',
  'chronogolf',
  'chronogolf_slc',
  'membersports',
  'teeitup',
  'trutee',
  'golfpay',
  'quick18',
  'golfwithaccess',
  'clubcaddie',
]);

/**
 * Persist decision: booking URL names the vendor unless the row is already a live adapter.
 */
export function nextRecordPlatform(record) {
  const current = String(record?.platform || '').trim();
  if (LIVE_ADAPTER_PLATFORMS.has(current)) {
    return { platform: current, changed: false, reason: 'live' };
  }
  const url = String(record?.booking_url || '').trim();
  if (!url) {
    return { platform: current, changed: false, reason: 'no_url' };
  }
  const suggested = parseBookingUrl(url).platform;
  if (!suggested) {
    return { platform: current, changed: false, reason: 'unknown_host' };
  }
  if (suggested === current) {
    return { platform: current, changed: false, reason: 'already' };
  }
  return { platform: suggested, from: current || null, changed: true, reason: 'url' };
}

/** Apply a URL recategorize: platform, live-ready status, and vendor hints. */
export function recordAfterPlatformReclassify(rec, next) {
  const parsed = parseBookingUrl(String(rec?.booking_url || ''));
  const out = { ...rec, platform: next.platform };
  if (parsed.hints?.quick18_tenant) out.quick18_tenant = parsed.hints.quick18_tenant;
  if (parsed.hints?.golfwithaccess_slug) out.golfwithaccess_slug = parsed.hints.golfwithaccess_slug;
  if (parsed.hints?.clubcaddie_apikey) out.clubcaddie_apikey = parsed.hints.clubcaddie_apikey;
  if (LIVE_ADAPTER_PLATFORMS.has(next.platform)) {
    const status = String(rec?.booking_status || '').trim();
    if (!status || status === 'unsupported' || status === 'pending') {
      out.booking_status = 'ready';
    }
  }
  return out;
}

async function reclassifyRegistryPlatforms(env, { dryRun }) {
  const rows = await fetchRegistryCourses(env);
  const updated = [];
  for (const row of rows) {
    const rec = row.record && typeof row.record === 'object' ? row.record : {};
    const next = nextRecordPlatform(rec);
    if (!next.changed) continue;
    updated.push({
      slug: row.slug,
      name: rec.name || row.slug,
      from: rec.platform || null,
      to: next.platform,
    });
    if (!dryRun) {
      const written = await upsertRegistry(env, row.slug, recordAfterPlatformReclassify(rec, next));
      if (written.error) {
        return { error: written.error, detail: written.detail, status: written.status, updated };
      }
    }
  }
  return {
    dry_run: Boolean(dryRun),
    updated,
    counts: { scanned: rows.length, updated: updated.length },
  };
}

function stripPlatformFields(record, platform) {
  const keep = new Set(PLATFORM_ID_FIELDS[platform] || []);
  for (const key of ALL_PLATFORM_FIELDS) {
    if (!keep.has(key)) delete record[key];
  }
}

const FOREUP_UA = 'TeeTimeIO/1.0 (+https://tee-time.io)';

async function fetchForeUpBookingPage(bookingUrl) {
  try {
    const pageUrl = bookingUrl.split('#')[0];
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': FOREUP_UA, Referer: 'https://foreupsoftware.com/' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Extract course metadata from the ForeUp booking page's embedded COURSE object. */
function parseForeUpCourseMeta(html) {
  const start = html.indexOf('COURSE = {');
  if (start === -1) return null;
  const slice = html.slice(start, start + 2500);
  const pick = (key) => {
    const m = slice.match(new RegExp(`"${key}":"([^"]*)"`));
    if (!m || m[1] === '') return null;
    // Embedded JSON escapes forward slashes (http:\/\/…); unescape for real values.
    return m[1].replace(/\\\//g, '/').replace(/\\"/g, '"');
  };
  const num = (key) => {
    const v = pick(key);
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const address = pick('address');
  const city = pick('city');
  const state = pick('state');
  const postal = pick('postal');
  const website = pick('website');
  const tail = [city, [state, postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const fullAddress = [address, tail].filter(Boolean).join(', ');
  return {
    name: pick('name'),
    address: fullAddress || address || null,
    lat: num('latitude_centroid'),
    lng: num('longitude_centroid') != null ? num('longitude_centroid') : num('longitude_centrod'),
    phone_number: pick('phone'),
    website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
  };
}

/** Read the hole count for a specific schedule (teesheet) from the ForeUp page. */
function parseForeUpScheduleHoles(html, scheduleId) {
  const m = html.match(new RegExp(`"teesheet_id":"${scheduleId}"[\\s\\S]*?"holes":"(\\d+)"`));
  if (!m) return null;
  const n = Number(m[1]);
  return n === 9 || n === 18 ? n : null;
}

/** True when the times API accepts this booking class publicly (not permission-gated). */
async function foreupClassUsable(scheduleId, classId) {
  try {
    const d = new Date(Date.now() + 3 * 86400000);
    const date = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
    const u = new URL('https://foreupsoftware.com/index.php/api/booking/times');
    u.searchParams.set('time', 'all');
    u.searchParams.set('date', date);
    u.searchParams.set('holes', 'all');
    u.searchParams.set('players', '0');
    u.searchParams.set('booking_class', String(classId));
    u.searchParams.set('schedule_id', String(scheduleId));
    u.searchParams.append('schedule_ids[]', String(scheduleId));
    const res = await fetch(u.toString(), {
      headers: {
        'User-Agent': FOREUP_UA,
        Referer: 'https://foreupsoftware.com/',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data);
  } catch {
    return false;
  }
}

/**
 * ForeUp deep links only jump to the selected date when a public booking_class_id
 * is in the URL. A schedule can expose several classes (e.g. "Public" vs
 * "Members" — the latter returns a permissions error). Rank public-looking
 * classes first, then validate each against the times API and return the first
 * that is publicly bookable.
 */
async function pickForeUpBookingClass(html, scheduleId) {
  const re =
    /"booking_class_id":"(\d+)","teesheet_id":"(\d+)","active":"(\d)","hidden":"(\d)"[^]*?"name":"([^"]*)"/g;
  const all = [];
  let m;
  while ((m = re.exec(html))) {
    all.push({ classId: m[1], teesheet: m[2], active: m[3], hidden: m[4], name: m[5] });
  }
  if (all.length === 0) return null;

  let candidates = all.filter(
    (c) => c.teesheet === String(scheduleId) && c.active === '1' && c.hidden === '0',
  );
  if (candidates.length === 0) candidates = all.filter((c) => c.active === '1' && c.hidden === '0');
  if (candidates.length === 0) candidates = all;

  const rank = (name) => {
    const n = (name || '').toLowerCase();
    if (/member|league|senior|junior|employee|staff/.test(n)) return 0;
    if (/public/.test(n)) return 4;
    if (/online|guest|non.?resident|book a tee|reservation|tee time/.test(n)) return 3;
    return 2;
  };
  candidates.sort((a, b) => rank(b.name) - rank(a.name));

  for (const c of candidates) {
    if (await foreupClassUsable(scheduleId, c.classId)) return c.classId;
  }
  return candidates[0].classId;
}

/** Fetch the ForeUp booking page once and derive booking_class_id + course metadata. */
async function enrichForeUpFromPage(bookingUrl, scheduleId) {
  const out = { booking_class_id: null, meta: null };
  if (!bookingUrl) return out;
  const html = await fetchForeUpBookingPage(bookingUrl);
  if (!html) return out;
  out.meta = parseForeUpCourseMeta(html);
  if (out.meta && scheduleId) {
    const holes = parseForeUpScheduleHoles(html, scheduleId);
    if (holes) out.meta.holes = holes;
  }
  if (scheduleId) out.booking_class_id = await pickForeUpBookingClass(html, scheduleId);
  return out;
}

/**
 * Catalog `holes` means "9-only" or "18-only" for Find filtering.
 * Chronogolf `course.holes` is the physical layout. `bookableHoles` is unreliable:
 * Forest Dale lists [9,18] but public 18 slots are restricted/unpriced; Copper Club
 * lists the same and actually sells priced 18. Prefer a single unambiguous bookable
 * value, otherwise fall back to layout (conservative). Clear `holes` manually when a
 * layout-9 club is verified to sell 18.
 */
export function catalogHolesFromChronogolfCourse(course) {
  const bookable = Array.isArray(course?.bookableHoles)
    ? [...new Set(course.bookableHoles.map(Number).filter((n) => n === 9 || n === 18))]
    : [];
  if (bookable.length === 1) return bookable[0];
  const layout = Number(course?.holes);
  return layout === 9 || layout === 18 ? layout : null;
}

/**
 * Chronogolf club pages embed __NEXT_DATA__ with numeric club/course ids and
 * defaultAffiliationTypeId. Marketplace v2 `/teetimes?course_ids=` often returns
 * status=closed for these clubs; the club teetimes API (chronogolf_slc shape) works.
 */
async function enrichChronogolfFromPage(bookingUrl) {
  const out = {
    club_id: null,
    course_id: null,
    course_ids: null,
    affiliation_type_id: null,
    booking_url: null,
    use_club_teetimes: false,
    meta: null,
  };
  if (!bookingUrl) return out;
  let pageUrl = String(bookingUrl).trim();
  try {
    const u = new URL(pageUrl);
    // Prefer the club overview URL (strip /booking and query).
    const clubMatch = u.pathname.match(/^(\/club\/[^/]+)/i);
    if (clubMatch) {
      u.pathname = clubMatch[1];
      u.search = '';
      u.hash = '';
      pageUrl = u.toString().replace(/\/$/, '');
    }
  } catch {
    /* keep raw */
  }

  let html;
  try {
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'TeeTimeIO/1.0 (+https://tee-time.io)',
        Accept: 'text/html',
        Referer: 'https://www.chronogolf.com/',
      },
    });
    if (!res.ok) return out;
    html = await res.text();
  } catch {
    return out;
  }

  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return out;
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return out;
  }
  const club = data?.props?.pageProps?.club;
  if (!club) return out;

  const slug = club.slug != null ? String(club.slug).trim() : '';
  if (slug) {
    out.booking_url = `https://www.chronogolf.com/club/${slug}`;
  }

  const numericClubId = Number(club.id);
  if (Number.isFinite(numericClubId) && numericClubId > 0) {
    out.club_id = String(numericClubId);
  } else if (slug) {
    out.club_id = slug;
  }

  const clubCourses = Array.isArray(club.courses) ? club.courses : [];
  const hasEighteen = clubCourses.some((c) => Number(c?.holes) === 18);
  // Multi-layout clubs (Mountain Dell) expose a 9-only companion sheet — skip it when
  // the club also has full 18-hole layouts so course_ids fans out Canyon + Lake only.
  const courseIds = clubCourses
    .filter((c) => !hasEighteen || Number(c?.holes) === 18)
    .map((c) => Number(c?.id))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (courseIds.length) {
    out.course_ids = courseIds;
    out.course_id = String(courseIds[0]);
  }

  const aff = Number(club.defaultAffiliationTypeId);
  if (Number.isFinite(aff) && aff > 0) {
    out.affiliation_type_id = String(aff);
    out.use_club_teetimes = Boolean(out.club_id && out.course_id);
  }

  out.meta = {
    name: club.name || null,
    address: club.address
      ? [club.address.address1, club.address.city, [club.address.stateCode, club.address.zipCode].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', ')
      : null,
    phone_number: club.phone || null,
    website: club.website || null,
    holes: catalogHolesFromChronogolfCourse(club.courses?.[0]),
  };
  return out;
}

function parseDollars(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function sbHeaders(env, json = false) {
  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
  if (json) h['Content-Type'] = 'application/json';
  if (json) h.Prefer = 'return=representation';
  return h;
}

export async function getUserIdFromAccessToken(env, request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return { error: 'missing_auth', status: 401 };
  }
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: auth,
      apikey: env.SUPABASE_ANON_KEY || '',
    },
  });
  if (!res.ok) return { error: 'invalid_session', status: 401 };
  const u = await res.json();
  if (!u?.id) return { error: 'invalid_session', status: 401 };
  return { userId: u.id };
}

export async function requireAdmin(env, request) {
  if (!env.SUPABASE_SERVICE_KEY) {
    return { error: 'admin_not_configured', status: 503 };
  }
  const auth = await getUserIdFromAccessToken(env, request);
  if (auth.error) return auth;

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${auth.userId}&select=is_admin`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return { error: 'profile_lookup_failed', status: 500 };
  const rows = await res.json();
  if (!rows[0]?.is_admin) return { error: 'forbidden', status: 403 };
  return { userId: auth.userId };
}

/** Join auth.users + profiles into the admin signup list (newest first). */
export function mapAdminUsers(authUsers, profiles) {
  const byId = new Map((profiles || []).filter((p) => p?.id).map((p) => [p.id, p]));
  const seen = new Set();
  const users = [];

  for (const u of authUsers || []) {
    if (!u?.id) continue;
    seen.add(u.id);
    const p = byId.get(u.id) || {};
    const meta = u.user_metadata || {};
    users.push({
      id: u.id,
      email: u.email || null,
      display_name: p.display_name || meta.full_name || meta.name || null,
      created_at: u.created_at || p.created_at || null,
      last_sign_in_at: u.last_sign_in_at || null,
      is_admin: Boolean(p.is_admin),
      phone: p.phone || null,
      notify_via: p.notify_via || null,
      provider: u.app_metadata?.provider || null,
    });
  }

  for (const p of profiles || []) {
    if (!p?.id || seen.has(p.id)) continue;
    users.push({
      id: p.id,
      email: null,
      display_name: p.display_name || null,
      created_at: p.created_at || null,
      last_sign_in_at: null,
      is_admin: Boolean(p.is_admin),
      phone: p.phone || null,
      notify_via: p.notify_via || null,
      provider: null,
    });
  }

  users.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return users;
}

async function fetchAllProfiles(env) {
  const profiles = [];
  const pageSize = 1000;
  let from = 0;
  for (let i = 0; i < 50; i += 1) {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/profiles?select=id,display_name,phone,notify_via,is_admin,created_at&order=created_at.desc`,
      {
        headers: {
          ...sbHeaders(env),
          Range: `${from}-${from + pageSize - 1}`,
        },
      },
    );
    if (!res.ok) return { error: 'profiles_lookup_failed', status: 500 };
    const batch = (await supabaseJson(res)) || [];
    if (!Array.isArray(batch)) return { error: 'profiles_lookup_failed', status: 500 };
    profiles.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return { profiles };
}

async function fetchAllAuthUsers(env) {
  const users = [];
  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const res = await fetch(
      `${env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      { headers: sbHeaders(env) },
    );
    if (!res.ok) return { error: 'users_lookup_failed', status: 500 };
    const data = await supabaseJson(res);
    const batch = Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);
    if (batch.length < perPage) break;
  }
  return { users };
}

async function supabaseJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function fetchRegistryCourses(env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/course_registry?select=slug,record,updated_at&order=slug`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return [];
  const rows = await supabaseJson(res);
  if (!Array.isArray(rows)) return [];
  return rows;
}

export function registryRowsToCourses(rows) {
  return withDerivedState(
    rows
      .map((r) => r.record)
      .filter((rec) => isPublicRegistryRecord(rec)),
  );
}

/**
 * Registry records carry a postal address but no state column, so coverage copy
 * ("live in Utah and Idaho") had nothing to read and silently fell back to Utah.
 * Address is authoritative; timezone only breaks ties for rows missing a ZIP.
 */
const ADDRESS_STATE_RE = /\b([A-Z]{2})[\s,]+\d{5}(?:-\d{4})?\b/;
// Only zones that pin down a single state. America/Denver covers UT, WY, CO, and MT,
// so guessing Utah from it would mislabel every neighbour we expand into.
const TIMEZONE_STATE = {
  'America/Boise': 'ID',
  'America/Phoenix': 'AZ',
};

export function deriveCourseState(rec) {
  if (!rec) return null;
  const existing = String(rec.state || '').trim().toUpperCase();
  if (existing.length === 2) return existing;
  const m = ADDRESS_STATE_RE.exec(String(rec.address || ''));
  if (m) return m[1];
  return TIMEZONE_STATE[String(rec.timezone || '')] || null;
}

export function withDerivedState(courses) {
  if (!Array.isArray(courses)) return courses;
  return courses.map((rec) => {
    const state = deriveCourseState(rec);
    return state ? { ...rec, state } : rec;
  });
}

/** Public Find: hide closed, private, and unfinished QA stubs; keep legacy Utah rows with a platform. */
export function isPublicRegistryRecord(rec) {
  if (!rec) return false;
  const status = String(rec.booking_status || '').trim();
  if (status === 'closed' || status === 'private' || status === 'pending') return false;
  if (status === 'ready' || status === 'phone' || status === 'unsupported') return true;
  // Legacy rows without booking_status: only publish when a platform is set.
  return Boolean(String(rec.platform || '').trim());
}

export async function fetchMergedCourse(env, slug) {
  const [regRes, catRes, ratesRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/course_registry?slug=eq.${encodeURIComponent(slug)}&select=slug,record,updated_at`, {
      headers: sbHeaders(env),
    }),
    fetch(`${env.SUPABASE_URL}/rest/v1/course_catalog?slug=eq.${encodeURIComponent(slug)}&select=*`, {
      headers: sbHeaders(env),
    }),
    fetch(`${env.SUPABASE_URL}/rest/v1/course_rates_expanded?course_slug=eq.${encodeURIComponent(slug)}&select=*`, {
      headers: sbHeaders(env),
    }),
  ]);

  const regRows = (await supabaseJson(regRes)) || [];
  const catRows = (await supabaseJson(catRes)) || [];
  const ratesRows = (await supabaseJson(ratesRes)) || [];

  return {
    slug,
    record: regRows[0]?.record || null,
    registry_updated_at: regRows[0]?.updated_at || null,
    catalog: catRows[0] || null,
    rates: ratesRows[0] || null,
  };
}

export async function placesLookup(env, { query, lat, lng }) {
  if (!env.GOOGLE_PLACES_KEY) {
    return { error: 'places_not_configured', status: 503 };
  }
  const q = String(query || '').trim();
  if (!q) return { error: 'missing_query', status: 400 };

  let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&key=${env.GOOGLE_PLACES_KEY}`;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url += `&location=${lat},${lng}&radius=50000`;
  }

  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) {
    return { error: 'not_found', status: 404 };
  }

  const place = data.results[0];
  const ref = place.photos?.[0]?.photo_reference;
  return {
    name: place.name,
    address: place.formatted_address,
    lat: place.geometry?.location?.lat,
    lng: place.geometry?.location?.lng,
    rating: place.rating ?? null,
    review_count: place.user_ratings_total ?? null,
    website: place.website ?? null,
    phone_number: place.formatted_phone_number ?? null,
    photo_reference: ref ?? null,
  };
}

/** Places Details by place_id — returns website/phone (Text Search often omits these). */
export async function placesDetails(env, { place_id }) {
  if (!env.GOOGLE_PLACES_KEY) {
    return { error: 'places_not_configured', status: 503 };
  }
  const placeId = String(place_id || '').trim();
  if (!placeId) return { error: 'missing_place_id', status: 400 };

  const fields = [
    'name',
    'formatted_address',
    'geometry',
    'rating',
    'user_ratings_total',
    'website',
    'formatted_phone_number',
    'international_phone_number',
    'photos',
  ].join(',');
  const url =
    `https://maps.googleapis.com/maps/api/place/details/json` +
    `?place_id=${encodeURIComponent(placeId)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&key=${env.GOOGLE_PLACES_KEY}`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.result) {
    return { error: data.status === 'NOT_FOUND' ? 'not_found' : 'places_details_failed', status: 404, detail: data.status };
  }

  const place = data.result;
  const ref = place.photos?.[0]?.photo_reference;
  return {
    place_id: placeId,
    name: place.name,
    address: place.formatted_address,
    lat: place.geometry?.location?.lat,
    lng: place.geometry?.location?.lng,
    rating: place.rating ?? null,
    review_count: place.user_ratings_total ?? null,
    website: place.website ?? null,
    phone_number: place.formatted_phone_number || place.international_phone_number || null,
    photo_reference: ref ?? null,
  };
}

function buildCatalogRow(slug, record, prepaid) {
  const holes = record.holes === 9 || record.holes === 18 ? record.holes : null;
  return {
    slug,
    name: record.name,
    holes,
    par: record.par ?? null,
    yardage: record.yardage ?? null,
    walkability: record.walkability ?? null,
    rate_notes: record.rate_notes ?? null,
    twilight_discount: Boolean(record.twilight_discount),
    rates_updated_at: record.rates_updated_at || null,
    booking_window_days: record.booking_window_days ?? null,
    booking_opens_time: record.booking_opens_time ?? null,
    cancellation_policy: record.cancellation_policy ?? null,
    editorial_note: record.editorial_note ?? null,
    signature_hole: record.signature_hole ?? null,
    history_blurb: record.history_blurb ?? null,
    editorial_photo_url: record.editorial_photo_url ?? null,
    booking_url_template: record.booking_url_template ?? null,
    prepaid: Boolean(prepaid),
    updated_at: new Date().toISOString(),
  };
}

function syncRecordFromCatalogFields(record, catalogRow) {
  const merged = { ...record };
  for (const key of [
    'holes',
    'par',
    'yardage',
    'walkability',
    'rate_notes',
    'twilight_discount',
    'rates_updated_at',
    'booking_window_days',
    'booking_opens_time',
    'cancellation_policy',
    'editorial_note',
    'signature_hole',
    'history_blurb',
    'editorial_photo_url',
    'booking_url_template',
  ]) {
    if (catalogRow[key] !== undefined && catalogRow[key] !== null) {
      merged[key] = catalogRow[key];
    }
  }
  merged.name = catalogRow.name || merged.name;
  return merged;
}

async function upsertCatalog(env, row) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/course_catalog?on_conflict=slug`, {
    method: 'POST',
    headers: { ...sbHeaders(env, true), Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const err = await res.text();
    return { error: 'catalog_upsert_failed', detail: err, status: 500 };
  }
  return { ok: true };
}

async function upsertRegistry(env, slug, record) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/course_registry?on_conflict=slug`, {
    method: 'POST',
    headers: { ...sbHeaders(env, true), Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ slug, record }),
  });
  if (!res.ok) {
    const err = await res.text();
    return { error: 'registry_upsert_failed', detail: err, status: 500 };
  }
  return { ok: true };
}

async function upsertRates(env, slug, rates, verifiedAt) {
  if (!rates || typeof rates !== 'object') return { ok: true, count: 0 };

  const verified = verifiedAt || new Date().toISOString().slice(0, 10);
  let count = 0;

  for (const spec of RATE_SPECS) {
    const dollars = parseDollars(rates[spec.key]);
    if (dollars == null) continue;

    const row = {
      course_slug: slug,
      day_type: spec.day_type,
      holes: spec.holes,
      rider_type: spec.rider_type,
      season: 'standard',
      price_cents: dollars * 100,
      price_includes_cart: spec.includes_cart,
      source: 'admin-portal',
      verified_at: verified,
    };

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/course_rates?on_conflict=course_slug,day_type,holes,rider_type,resident_key,season`,
      {
        method: 'POST',
        headers: { ...sbHeaders(env, true), Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(row),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      return { error: 'rates_upsert_failed', detail: err, status: 500 };
    }
    count++;
  }

  return { ok: true, count };
}

function getPlatformWarnings(record) {
  const warnings = [];
  const status = String(record.booking_status || '').trim();
  if (status === 'closed') {
    warnings.push('Marked closed — hidden from public Find.');
    return warnings;
  }
  if (status === 'private') {
    warnings.push('Private / members-only — hidden from public Find.');
    return warnings;
  }
  if (status === 'phone') {
    warnings.push('Phone / in-person only — no online booking URL.');
    return warnings;
  }
  if (status === 'unsupported' || record.platform === 'other') {
    warnings.push('Unsupported booking platform — booking-link-only until we add an adapter.');
    return warnings;
  }
  const platform = record.platform;
  if (!platform) warnings.push('No platform set — poller will not run.');
  if (platform === 'chronogolf' && !(Array.isArray(record.course_ids) && record.course_ids.length)) {
    warnings.push('Chronogolf needs course_ids (marketplace course id) for live tee times — re-Parse the club URL.');
  }
  if (platform === 'tenfore' || platform === 'cps' || platform === 'golfnow' || platform === 'ezlinks' || platform === 'teesnap' || platform === 'clubessentials' || platform === 'lightspeed' || platform === 'teeoff' || platform === 'golfrev' || platform === 'sagacity' || platform === 'play18') {
    warnings.push(`${platform} is booking-link-only today — live inventory not polled yet.`);
  } else if (platform && !['foreup', 'chronogolf', 'chronogolf_slc', 'membersports', 'teeitup', 'trutee', 'golfpay', 'foreup_login', 'quick18', 'golfwithaccess', 'clubcaddie'].includes(platform)) {
    warnings.push(`${platform} is booking-link-only today — live inventory not polled yet.`);
  }
  if (
    platform === 'quick18' &&
    !record.quick18_tenant &&
    !/\.(quick18|play18)\.com/i.test(String(record.booking_url || ''))
  ) {
    warnings.push('Quick18 needs a tenant subdomain (papago.quick18.com or *.play18.com) for live tee times.');
  }
  if (
    platform === 'golfwithaccess' &&
    !record.golfwithaccess_slug &&
    !record.golfwithaccess_course_id &&
    !/golfwithaccess\.com\/course\//i.test(String(record.booking_url || ''))
  ) {
    warnings.push('GolfWithAccess needs a /course/{slug}/reserve-tee-time booking URL for live tee times.');
  }
  if (
    platform === 'clubcaddie' &&
    !record.clubcaddie_apikey &&
    !/clubcaddie\.com\/webapi\/view\//i.test(String(record.booking_url || ''))
  ) {
    warnings.push('ClubCaddie needs a /webapi/view/{apikey}/slots booking URL for live tee times.');
  }
  if (platform === 'golfpay' && !record.golfpay_course_id) {
    warnings.push('GolfPay needs golfpay_course_id (_gshcid) for live tee times.');
  }
  if (platform === 'trutee' && !record.trutee_course_id) {
    warnings.push('Trutee needs trutee_course_id for live tee times.');
  }
  if (platform === 'foreup' && !record.schedule_id) {
    warnings.push('ForeUp requires schedule_id for live tee times.');
  }
  if (platform === 'chronogolf_slc' && (!record.club_id || !record.course_id || !record.affiliation_type_id)) {
    warnings.push('Chronogolf club teetimes need club_id, course_id, and affiliation_type_id — re-Parse the club URL.');
  }
  if (platform === 'teeitup' && (!record.facility_id || !record.teeitup_course_id)) {
    warnings.push('TeeItUp needs facility_id (deep link) and teeitup_course_id (poller mapping hash).');
  }
  return warnings;
}

const IMPORT_BATCH_MAX = 300;

async function fetchExistingCourseIndex(env) {
  const [regRes, catRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/course_registry?select=slug,record`, { headers: sbHeaders(env) }),
    fetch(`${env.SUPABASE_URL}/rest/v1/course_catalog?select=slug,name`, { headers: sbHeaders(env) }),
  ]);
  const bySlug = new Map();
  const byPlaceId = new Map();

  const catRows = await supabaseJson(catRes);
  const regRows = await supabaseJson(regRes);

  if (Array.isArray(catRows)) {
    for (const row of catRows) {
      const slug = row?.slug;
      if (!slug) continue;
      bySlug.set(slug, {
        slug,
        name: row.name || slug,
        address: '',
        area: '',
        timezone: '',
        google_place_id: '',
      });
    }
  }

  if (Array.isArray(regRows)) {
    for (const row of regRows) {
      const slug = row?.slug;
      if (!slug) continue;
      const rec = row.record && typeof row.record === 'object' ? row.record : {};
      const prev = bySlug.get(slug) || {
        slug,
        name: slug,
        address: '',
        area: '',
        timezone: '',
        google_place_id: '',
      };
      const merged = {
        slug,
        name: rec.name || prev.name || slug,
        address: rec.address || prev.address || '',
        area: rec.area || prev.area || '',
        timezone: rec.timezone || prev.timezone || '',
        google_place_id: String(rec.google_place_id || prev.google_place_id || '').trim(),
      };
      bySlug.set(slug, merged);
      if (merged.google_place_id) byPlaceId.set(merged.google_place_id, merged);
    }
  }

  return { bySlug, byPlaceId, list: [...bySlug.values()] };
}

function findImportDuplicate(index, slug, record) {
  if (index.bySlug.has(slug)) {
    const hit = index.bySlug.get(slug);
    return { reason: 'exists', matched_slug: hit.slug, matched_name: hit.name };
  }
  const placeId = String(record.google_place_id || '').trim();
  if (placeId && index.byPlaceId.has(placeId)) {
    const hit = index.byPlaceId.get(placeId);
    return { reason: 'place_id', matched_slug: hit.slug, matched_name: hit.name };
  }
  const importState = inferCourseState(record);
  if (!importState || !record.name) return null;
  for (const existing of index.list) {
    if (inferCourseState(existing) !== importState) continue;
    if (!locationsCompatibleForImport(record, existing)) continue;
    if (!courseNamesLikelyDuplicate(record.name, existing.name)) continue;
    return { reason: 'name_match', matched_slug: existing.slug, matched_name: existing.name };
  }
  return null;
}

function rememberImportedInIndex(index, slug, record) {
  const entry = {
    slug,
    name: record.name || slug,
    address: record.address || '',
    area: record.area || '',
    timezone: record.timezone || '',
    google_place_id: String(record.google_place_id || '').trim(),
  };
  index.bySlug.set(slug, entry);
  index.list.push(entry);
  if (entry.google_place_id) index.byPlaceId.set(entry.google_place_id, entry);
}

function normalizeImportStubRecord(raw) {
  const name = String(raw?.name || '').trim();
  const area = String(raw?.area || '').trim();
  const address = String(raw?.address || '').trim();
  const phone = String(raw?.phone_number || '').trim();
  const website = String(raw?.website || '').trim();
  const timezone = String(raw?.timezone || '').trim() || 'America/Denver';
  const placeId = String(raw?.google_place_id || '').trim();
  const record = {
    name,
    area,
    platform: '',
    booking_url: '',
    timezone,
    booking_status: 'pending',
  };
  if (address) record.address = address;
  if (phone) record.phone_number = phone;
  if (website) record.website = website;
  if (placeId) record.google_place_id = placeId;
  return record;
}

export async function saveCourse(env, { slug, record, prepaid, rates, isNew }) {
  if (!slug || !record?.name) {
    return { error: 'missing_slug_or_name', status: 400 };
  }

  const cleanRecord = { ...record };
  if (cleanRecord.platform) {
    stripPlatformFields(cleanRecord, cleanRecord.platform);
  }

  const catalogRow = buildCatalogRow(slug, cleanRecord, prepaid);
  const syncedRecord = syncRecordFromCatalogFields(cleanRecord, catalogRow);

  if (isNew) {
    const seedRes = await fetch(`${env.SUPABASE_URL}/rest/v1/course_catalog`, {
      method: 'POST',
      headers: { ...sbHeaders(env, true), Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({ slug, name: syncedRecord.name }),
    });
    if (!seedRes.ok && seedRes.status !== 409) {
      const err = await seedRes.text();
      return { error: 'catalog_seed_failed', detail: err, status: 500 };
    }
  }

  const cat = await upsertCatalog(env, catalogRow);
  if (cat.error) return cat;

  const reg = await upsertRegistry(env, slug, syncedRecord);
  if (reg.error) return reg;

  const rateResult = await upsertRates(env, slug, rates, syncedRecord.rates_updated_at);
  if (rateResult.error) return rateResult;

  return {
    ok: true,
    slug,
    rates_written: rateResult.count,
    platform_warnings: getPlatformWarnings(syncedRecord),
  };
}

function corsResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Content-Type': 'application/json',
    },
  });
}

export function createCourseAdminHandlers({ invalidateCoursesCache }) {
  return {
    async handleAdminRequest(request, env, path) {
      if (path === '/admin/parse-booking-url' && request.method === 'POST') {
        const admin = await requireAdmin(env, request);
        if (admin.error) return corsResponse({ error: admin.error }, admin.status);

        let body;
        try {
          body = await request.json();
        } catch {
          return corsResponse({ error: 'invalid_body' }, 400);
        }
        const parsed = parseBookingUrl(body.url);
        if (parsed.platform === 'foreup' && parsed.hints.schedule_id) {
          const enr = await enrichForeUpFromPage(body.url, parsed.hints.schedule_id);
          if (enr.booking_class_id && !parsed.hints.booking_class_id) {
            parsed.hints.booking_class_id = enr.booking_class_id;
          }
          if (enr.meta) parsed.meta = enr.meta;
        }
        if (parsed.platform === 'chronogolf' || parsed.platform === 'chronogolf_slc') {
          const enr = await enrichChronogolfFromPage(body.url || parsed.booking_url);
          if (enr.club_id) parsed.hints.club_id = enr.club_id;
          if (enr.course_id) parsed.hints.course_id = enr.course_id;
          if (enr.affiliation_type_id) parsed.hints.affiliation_type_id = enr.affiliation_type_id;
          if (enr.course_ids?.length) {
            parsed.hints.course_ids = enr.course_ids.join(',');
          }
          if (enr.booking_url) parsed.booking_url = enr.booking_url;
          // Club teetimes API (same as Utah SLC Chronogolf) — required for live inventory.
          if (enr.use_club_teetimes) parsed.platform = 'chronogolf_slc';
          if (enr.meta) parsed.meta = { ...(parsed.meta || {}), ...enr.meta };
        }
        return corsResponse(parsed);
      }

      if (path === '/admin/places/lookup' && request.method === 'POST') {
        const admin = await requireAdmin(env, request);
        if (admin.error) return corsResponse({ error: admin.error }, admin.status);

        let body;
        try {
          body = await request.json();
        } catch {
          return corsResponse({ error: 'invalid_body' }, 400);
        }
        const result = await placesLookup(env, body);
        if (result.error) return corsResponse({ error: result.error }, result.status);
        return corsResponse(result);
      }

      if (path === '/admin/places/details' && request.method === 'POST') {
        const admin = await requireAdmin(env, request);
        if (admin.error) return corsResponse({ error: admin.error }, admin.status);

        let body;
        try {
          body = await request.json();
        } catch {
          return corsResponse({ error: 'invalid_body' }, 400);
        }
        const result = await placesDetails(env, body);
        if (result.error) {
          return corsResponse({ error: result.error, detail: result.detail || null }, result.status);
        }
        return corsResponse(result);
      }

      if (path === '/admin/users' && request.method === 'GET') {
        const admin = await requireAdmin(env, request);
        if (admin.error) return corsResponse({ error: admin.error }, admin.status);

        const [authResult, profileResult] = await Promise.all([
          fetchAllAuthUsers(env),
          fetchAllProfiles(env),
        ]);
        if (authResult.error) return corsResponse({ error: authResult.error }, authResult.status);
        if (profileResult.error) return corsResponse({ error: profileResult.error }, profileResult.status);

        const users = mapAdminUsers(authResult.users, profileResult.profiles);
        return corsResponse({ users, count: users.length });
      }

      if (path === '/admin/courses' && request.method === 'GET') {
        const admin = await requireAdmin(env, request);
        if (admin.error) return corsResponse({ error: admin.error }, admin.status);

        const rows = await fetchRegistryCourses(env);
        const list = rows.map((r) => {
          const rec = r.record || {};
          const bookingUrl = String(rec.booking_url || '').trim();
          return {
            slug: r.slug,
            name: rec.name || r.slug,
            area: rec.area || null,
            platform: rec.platform || null,
            booking_url: bookingUrl || null,
            booking_status: rec.booking_status || null,
            booking_status_note: rec.booking_status_note || null,
            updated_at: r.updated_at,
            has_rates: false,
          };
        });

        const ratesRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/course_rates?select=course_slug&season=eq.standard`,
          { headers: sbHeaders(env) },
        );
        if (ratesRes.ok) {
          const rateRows = (await supabaseJson(ratesRes)) || [];
          const withRates = new Set(rateRows.map((x) => x.course_slug));
          for (const item of list) {
            item.has_rates = withRates.has(item.slug);
          }
        }

        return corsResponse({ courses: list });
      }

      if (path === '/admin/courses/reclassify-platforms' && request.method === 'POST') {
        const admin = await requireAdmin(env, request);
        if (admin.error) return corsResponse({ error: admin.error }, admin.status);

        let body = {};
        try {
          const text = await request.text();
          if (text) body = JSON.parse(text);
        } catch {
          return corsResponse({ error: 'invalid_body' }, 400);
        }

        const dryRun = Boolean(body.dry_run);
        const result = await reclassifyRegistryPlatforms(env, { dryRun });
        if (result.error) return corsResponse(result, result.status);
        if (!dryRun && result.counts.updated > 0) invalidateCoursesCache?.();
        return corsResponse(result);
      }

      if (path === '/admin/courses/import' && request.method === 'POST') {
        const admin = await requireAdmin(env, request);
        if (admin.error) return corsResponse({ error: admin.error }, admin.status);

        let body;
        try {
          body = await request.json();
        } catch {
          return corsResponse({ error: 'invalid_body' }, 400);
        }

        const rows = Array.isArray(body.rows) ? body.rows : null;
        if (!rows) return corsResponse({ error: 'missing_rows' }, 400);
        if (rows.length > IMPORT_BATCH_MAX) {
          return corsResponse(
            {
              error: 'batch_too_large',
              max: IMPORT_BATCH_MAX,
              detail: `This import has ${rows.length} courses; max is ${IMPORT_BATCH_MAX} per request.`,
            },
            400,
          );
        }

        const dryRun = Boolean(body.dry_run);
        const existing = await fetchExistingCourseIndex(env);
        const created = [];
        const skipped = [];
        const errors = [];

        for (const row of rows) {
          const record = normalizeImportStubRecord(row?.record || row);
          const slug = String(row?.slug || '').trim() || slugFromCourseName(record.name || '');
          if (!slug || !record.name) {
            errors.push({ slug: slug || null, error: 'missing_slug_or_name' });
            continue;
          }
          const dup = findImportDuplicate(existing, slug, record);
          if (dup) {
            skipped.push({
              slug,
              name: record.name,
              reason: dup.reason,
              matched_slug: dup.matched_slug,
              matched_name: dup.matched_name,
            });
            continue;
          }
          if (dryRun) {
            created.push({ slug, name: record.name, dry_run: true });
            rememberImportedInIndex(existing, slug, record);
            continue;
          }

          const result = await saveCourse(env, {
            slug,
            record,
            prepaid: false,
            rates: {},
            isNew: true,
          });
          if (result.error) {
            errors.push({ slug, name: record.name, error: result.error, detail: result.detail || null });
            continue;
          }
          created.push({ slug, name: record.name });
          rememberImportedInIndex(existing, slug, record);
        }

        if (!dryRun && created.length > 0) {
          invalidateCoursesCache?.();
        }

        return corsResponse({
          dry_run: dryRun,
          created,
          skipped,
          errors,
          counts: {
            created: created.length,
            skipped: skipped.length,
            errors: errors.length,
          },
        });
      }

      const courseMatch = path.match(/^\/admin\/courses\/([^/]+)$/);
      if (courseMatch) {
        const slug = decodeURIComponent(courseMatch[1]);

        if (request.method === 'GET') {
          const admin = await requireAdmin(env, request);
          if (admin.error) return corsResponse({ error: admin.error }, admin.status);

          const merged = await fetchMergedCourse(env, slug);
          if (!merged.record && !merged.catalog) {
            return corsResponse({ error: 'not_found' }, 404);
          }
          return corsResponse(merged);
        }

        if (request.method === 'PUT') {
          const admin = await requireAdmin(env, request);
          if (admin.error) return corsResponse({ error: admin.error }, admin.status);

          let body;
          try {
            body = await request.json();
          } catch {
            return corsResponse({ error: 'invalid_body' }, 400);
          }

          const result = await saveCourse(env, {
            slug,
            record: body.record,
            prepaid: body.prepaid,
            rates: body.rates,
            isNew: false,
          });
          if (result.error) return corsResponse(result, result.status);
          invalidateCoursesCache?.();
          return corsResponse(result);
        }
      }

      if (path === '/admin/courses' && request.method === 'POST') {
        const admin = await requireAdmin(env, request);
        if (admin.error) return corsResponse({ error: admin.error }, admin.status);

        let body;
        try {
          body = await request.json();
        } catch {
          return corsResponse({ error: 'invalid_body' }, 400);
        }

        const slug = body.slug || slugFromCourseName(body.record?.name || '');
        if (!slug) return corsResponse({ error: 'invalid_slug' }, 400);

        const existing = await fetchMergedCourse(env, slug);
        if (existing.record || existing.catalog) {
          return corsResponse({ error: 'slug_exists', slug }, 409);
        }

        const result = await saveCourse(env, {
          slug,
          record: body.record,
          prepaid: body.prepaid,
          rates: body.rates,
          isNew: true,
        });
        if (result.error) return corsResponse(result, result.status);
        invalidateCoursesCache?.();
        return corsResponse({ ...result, slug }, 201);
      }

      return null;
    },

    async handlePublicCourses(env) {
      const rows = await fetchRegistryCourses(env);
      if (rows.length > 0) {
        return corsResponse(registryRowsToCourses(rows));
      }
      const res = await fetch('https://tee-time.io/courses.json');
      if (!res.ok) return corsResponse({ error: 'courses_unavailable' }, 502);
      return corsResponse(await res.json());
    },
  };
}
