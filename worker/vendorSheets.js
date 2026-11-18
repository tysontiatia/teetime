/**
 * The tee sheets behind one vendor account, and which one a course books.
 *
 * Many clubs and cities run several courses on one vendor account: Mulligan's
 * has two ForeUp schedules, Anaheim has two TeeItUp facilities, Sand Hollow has
 * two Chronogolf courses. A crawl finds one booking link and used to take the
 * first sheet on it, so separate courses ended up sharing one sheet (and one
 * course's tee times showed under another's name).
 *
 * Supported here (they publish sheet names): ForeUp, TeeItUp, Chronogolf.
 * Other vendors expose one course per link as far as the crawler can see; the
 * crawl leaves a QA note when 18Birdies lists more layouts than were found.
 */

import { enrichForeUpFromPage, fetchForeUpBookingPage } from './courseAdmin.js';
import { nameStrength, nameTokens } from './courseIndex.js';

const TEEITUP_FACILITIES = 'https://phx-api-be-east-1b.kenna.io/facilities';

/** ForeUp's SCHEDULES list from a booking page: [{ id, name, holes, online }]. */
export function parseForeUpSchedules(html) {
  const m = /SCHEDULES\s*=\s*(\[[\s\S]*?\]);/.exec(String(html || ''));
  if (!m) return [];
  let list;
  try {
    list = JSON.parse(m[1]);
  } catch {
    return [];
  }
  return (Array.isArray(list) ? list : [])
    .map((s) => ({
      id: String(s?.teesheet_id || '').trim(),
      name: String(s?.title || '').trim(),
      holes: Number(s?.holes) || null,
      online: String(s?.online_booking ?? '1') === '1',
    }))
    .filter((s) => /^\d+$/.test(s.id));
}

export function foreUpFacilityId(bookingUrl) {
  return /\/booking\/(\d+)(?:\/|$|#|\?)/.exec(String(bookingUrl || ''))?.[1] || '';
}

/** Online ForeUp sheets for the facility in this booking URL. */
export async function listForeUpSheets(bookingUrl) {
  const html = await fetchForeUpBookingPage(bookingUrl);
  return parseForeUpSchedules(html).filter((s) => s.online);
}

/** TeeItUp facilities for an alias: [{ id, name }]. */
export async function listTeeItUpSheets(alias) {
  if (!alias) return [];
  try {
    const res = await fetch(TEEITUP_FACILITIES, {
      headers: { 'x-be-alias': alias, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data) ? data : data?.facilities || [];
    return list
      .map((f) => ({ id: String(f?.id || '').trim(), name: String(f?.name || '').trim() }))
      .filter((f) => /^\d+$/.test(f.id));
  } catch {
    return [];
  }
}

export function teeItUpAliasFromUrl(bookingUrl) {
  try {
    const host = new URL(String(bookingUrl || '')).hostname.toLowerCase();
    return /^([a-z0-9-]+)\.book\.teeitup\.(?:com|golf)$/.exec(host)?.[1] || '';
  } catch {
    return '';
  }
}

/** Chronogolf club courses: { club_id, affiliation_type_id, sheets: [{ id, name, holes }] }. */
export async function listChronogolfSheets(bookingUrl) {
  const out = { club_id: null, affiliation_type_id: null, sheets: [] };
  const m = /\/club\/([^/?#]+)/i.exec(String(bookingUrl || ''));
  if (!m) return out;
  try {
    const res = await fetch(`https://www.chronogolf.com/club/${m[1]}`, {
      headers: { 'User-Agent': 'TeeTimeIO/1.0 (+https://tee-time.io)', Accept: 'text/html', Referer: 'https://www.chronogolf.com/' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return out;
    const html = await res.text();
    const data = JSON.parse(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] || 'null');
    const club = data?.props?.pageProps?.club;
    if (!club) return out;
    out.club_id = Number(club.id) > 0 ? String(club.id) : null;
    out.affiliation_type_id = Number(club.defaultAffiliationTypeId) > 0 ? String(club.defaultAffiliationTypeId) : null;
    out.sheets = (club.courses || [])
      .map((c) => ({ id: String(c?.id || '').trim(), name: String(c?.name || '').trim(), holes: Number(c?.holes) || null }))
      .filter((c) => /^\d+$/.test(c.id));
  } catch {
    // An empty list means "could not tell"; callers keep what they had.
  }
  return out;
}

/**
 * The one sheet a course name books, or null when none or several fit.
 * `clubName` is the shared part ("Sand Hollow", "Mulligan's Golf and Game");
 * sheet names often leave it out ("Links", "The Meadow- Par 3 Course").
 */
export function sheetForName(courseName, sheets, { clubName = '', registry = false } = {}) {
  const target = nameTokens(courseName, { registry });
  if (!target.length || !sheets?.length) return null;
  const club = new Set(nameTokens(clubName));
  const targetOwn = target.filter((t) => !club.has(t));
  const fits = sheets.filter((sheet) => {
    const words = nameTokens(sheet.name);
    if (!words.length) return false;
    if (nameStrength(target, words) === 'strong') return true;
    const sheetOwn = words.filter((t) => !club.has(t));
    const inSheet = new Set(words);
    const inTarget = new Set(target);
    if (targetOwn.length && targetOwn.every((t) => inSheet.has(t))) return true;
    return sheetOwn.length > 0 && sheetOwn.every((t) => inTarget.has(t));
  });
  return fits.length === 1 ? fits[0] : null;
}

/** Shared words of several names, e.g. the club part of course names on one account. */
export function sharedName(names) {
  const lists = names.map((n) => nameTokens(n, { registry: true })).filter((l) => l.length);
  if (!lists.length) return '';
  return lists[0].filter((t) => lists.every((l) => l.includes(t))).join(' ');
}

/**
 * Booking fields for one sheet on a vendor.
 * ForeUp needs a booking class per schedule, read from its page.
 */
export async function sheetFields(platform, sheet, context) {
  if (platform === 'foreup') {
    const facility = context.facilityId;
    const url = `https://foreupsoftware.com/index.php/booking/${facility}/${sheet.id}#teetimes`;
    const enriched = await enrichForeUpFromPage(url, sheet.id).catch(() => null);
    const fields = { schedule_id: sheet.id, booking_url: url };
    if (enriched?.booking_class_id) fields.booking_class_id = String(enriched.booking_class_id);
    if (sheet.holes === 9 || sheet.holes === 18) fields.holes = sheet.holes;
    return fields;
  }
  if (platform === 'teeitup') {
    return { facility_id: sheet.id, booking_url: `https://${context.alias}.book.teeitup.com/?course=${sheet.id}` };
  }
  if (platform === 'chronogolf_slc' || platform === 'chronogolf') {
    const fields = { course_id: sheet.id, course_ids: [Number(sheet.id)] };
    if (context.clubId) fields.club_id = context.clubId;
    if (context.affiliationTypeId) fields.affiliation_type_id = context.affiliationTypeId;
    return fields;
  }
  return null;
}

/** Every sheet on the account behind a course's booking link, with what is needed to book each. */
export async function listSheetsFor(platform, record) {
  if (platform === 'foreup') {
    const facilityId = foreUpFacilityId(record.booking_url);
    return { sheets: facilityId ? await listForeUpSheets(record.booking_url) : [], context: { facilityId } };
  }
  if (platform === 'teeitup') {
    const alias = String(record.teeitup_alias || '').trim() || teeItUpAliasFromUrl(record.booking_url);
    return { sheets: await listTeeItUpSheets(alias), context: { alias } };
  }
  if (platform === 'chronogolf_slc' || platform === 'chronogolf') {
    const club = await listChronogolfSheets(record.booking_url);
    return { sheets: club.sheets, context: { clubId: club.club_id || record.club_id, affiliationTypeId: club.affiliation_type_id || record.affiliation_type_id } };
  }
  return { sheets: [], context: {} };
}
