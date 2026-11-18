/**
 * National course index (18Birdies export): cleaning and matching.
 *
 * Pure functions only, shared by the loader and matcher scripts and testable
 * without a database. One index row is one club + one course layout, keyed
 * `{club uuid}:{course slug}`. 18Birdies "courses" are scorecard layouts, not
 * tee sheets: Stonebridge lists six nine-hole rotations that book as one
 * course, while Wasatch's Lake and Mountain book separately. So matching works
 * at the club first, then lines up registry courses with layouts inside it.
 *
 * Only factual data leaves this module: address, phone, website, holes, par,
 * yardage, tees (with USGA rating and slope), coordinates. 18Birdies' user
 * ratings, review counts, difficulty and pace scores, and staff emails are
 * dropped here and never stored.
 */

import { slugFromCourseName } from './courseAdmin.js';

const CLUB_ID_RE = /\/club\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** Retry entries the scrape saved without a state (from the import notes). */
export const RETRY_STATE_OVERRIDES = Object.freeze({ Trinitas: 'CA', Dougusta: 'IA', 'West Union': 'IA' });

/** Course directories and social pages: kept for reference, never crawled or matched on. */
export const DIRECTORY_HOSTS = Object.freeze([
  'facebook.com',
  'worldgolf.com',
  'igolf.com',
  'golflink.com',
  'golfadvisor.com',
  'google.com',
  'golfnow.com',
  'oobgolf.com',
  'customscorecards.com',
]);

/** Hosts shared by many clubs: crawl, but match on the full path, never the domain. */
export const SHARED_HOSTS = Object.freeze(['clubcorp.com', 'thevillages.com', 'golfthevillages.com']);

const AUTO_MEMBERSHIP = new Set(['public', 'municipal', 'city/minu', 'city/miui', 'semi-private', 'semi private']);
const REVIEW_MEMBERSHIP = new Set(['resort', 'others', '']);
const DROP_MEMBERSHIP = new Set(['private', 'military']);

function hostMatches(host, list) {
  return list.find((d) => host === d || host.endsWith(`.${d}`)) || null;
}

export function clubIdFromUrl(url) {
  return CLUB_ID_RE.exec(String(url || ''))?.[1]?.toLowerCase() || '';
}

/** auto: import without asking. review: import to QA. drop: never import. */
export function membershipBucket(membership) {
  const key = String(membership ?? '').trim().toLowerCase();
  if (AUTO_MEMBERSHIP.has(key)) return 'auto';
  if (DROP_MEMBERSHIP.has(key)) return 'drop';
  if (REVIEW_MEMBERSHIP.has(key)) return 'review';
  return 'review';
}

/**
 * A usable website, or '' when the value is not one.
 * Repairs scrape junk (".htmlOpera.HTML/Shell/Open/Command", "http://http://"),
 * adds a missing scheme, drops bare-IP hosts and plain text, and strips
 * utm_*, fbclid and gclid while keeping real query params (?course=, ?id=).
 * `kind` is own | directory | shared | none.
 */
export function cleanWebsite(raw) {
  let value = String(raw ?? '').trim();
  if (!value) return { website: '', kind: 'none', host: '' };
  value = value.replace(/(?:Opera|Chrome|Firefox|Safari|IE)\.HTML\/Shell\/Open\/Command$/i, '');
  value = value.replace(/^(https?:\/\/)+(https?:\/\/)/i, '$2');
  if (!/^https?:\/\//i.test(value)) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?|:)/i.test(value)) return { website: '', kind: 'none', host: '' };
    value = `https://${value}`;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return { website: '', kind: 'none', host: '' };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.includes('.') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { website: '', kind: 'none', host: '' };
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || key === 'fbclid' || key === 'gclid') url.searchParams.delete(key);
  }
  url.hash = '';
  const website = url.toString();
  if (hostMatches(host, DIRECTORY_HOSTS)) return { website, kind: 'directory', host };
  if (hostMatches(host, SHARED_HOSTS)) return { website, kind: 'shared', host };
  return { website, kind: 'own', host };
}

/** Five-digit ZIP from "84790", "84790-1234", "84790-", "IA 50595-7425", or a ZIP that lost its leading 0. */
export function cleanZip(raw) {
  const value = String(raw ?? '').trim();
  const five = /(?:^|\D)(\d{5})(?:-\d{0,4})?\s*$/.exec(value);
  if (five) return five[1];
  if (/^\d{4}$/.test(value)) return `0${value}`;
  return '';
}

/** "(801) 555-0100" from any US format, or '' when it is not a 10-digit number. */
export function cleanPhone(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return '';
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Green-fee text, or '' for "NC" (no charge listed) and empty values. Kept in the index only. */
export function cleanFee(raw) {
  const value = String(raw ?? '').trim();
  if (!value || /^nc$/i.test(value) || value === '0') return '';
  return value;
}

function cleanState(raw) {
  const value = String(raw ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : '';
}

/** City only when the source clearly gives one ("City, ST"); otherwise unknown (''). */
export function cleanCity(rowCity, clubAddress) {
  const fromRow = /^([^,\d][^,]*?),\s*([A-Z]{2})$/.exec(String(rowCity ?? '').replace(/,\s*,/g, ',').trim());
  if (fromRow) return fromRow[1].trim();
  const fromAddress = /,\s*([^,\d][^,]*?),\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?\s*$/.exec(
    String(clubAddress ?? '').replace(/,\s*,/g, ',').trim(),
  );
  return fromAddress ? fromAddress[1].trim() : '';
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Tees as [{name, gender, yards, rating, slope}]; rating and slope are USGA course values. */
export function cleanTees(rawTees) {
  const out = [];
  for (const tee of Array.isArray(rawTees) ? rawTees : []) {
    if (!Array.isArray(tee)) continue;
    const [name, gender, yards, rating, slope] = tee;
    const y = finiteNumber(yards);
    if (!name || !y || y < 500 || y > 9000) continue;
    const entry = { name: String(name).trim(), gender: gender === 'F' ? 'F' : 'M', yards: Math.round(y) };
    const r = finiteNumber(rating);
    const s = finiteNumber(slope);
    if (r && r >= 20 && r <= 85) entry.rating = r;
    if (s && s >= 55 && s <= 155) entry.slope = Math.round(s);
    out.push(entry);
  }
  return out;
}

function coursePar(course) {
  const holes = Array.isArray(course?.holes) ? course.holes : [];
  const count = Number(course?.holeCount) || holes.length;
  if (!holes.length || holes.length !== count) return null;
  let par = 0;
  for (const hole of holes) {
    const p = Number(Array.isArray(hole) ? hole[0] : null);
    if (!Number.isInteger(p) || p < 3 || p > 6) return null;
    par += p;
  }
  return par;
}

function courseYardage(course, tees) {
  const named = tees.find((t) => t.name === course?.ydsTee && t.gender === 'M') || tees.find((t) => t.name === course?.ydsTee);
  if (named) return named.yards;
  return tees.length ? Math.max(...tees.map((t) => t.yards)) : null;
}

/** "Name (City)", the registry's display convention. */
export function displayName(name, city) {
  const base = String(name || '').replace(/\s*\|\s*/g, ' - ').replace(/\s+/g, ' ').trim();
  return city ? `${base} (${city})` : base;
}

/**
 * Merge the state files with the retry file and drop broken rows.
 * - A row with club: null is replaced by the retry entry with the same club
 *   id, or the same name when its URL is broken (the Colorado Par 3 rows).
 * - Clubs that appear twice (state file and _extra file) keep the fuller copy.
 */
export function mergeSourceRows(stateRows, retryRows) {
  const retryById = new Map();
  const retryByName = new Map();
  for (const entry of retryRows || []) {
    if (!entry?.club) continue;
    const id = clubIdFromUrl(entry.url);
    if (id) retryById.set(id, entry);
    retryByName.set(normalizeListName(entry.listName || entry.club.name), entry);
  }
  const byId = new Map();
  let replaced = 0;
  let unresolved = 0;
  for (const row of stateRows || []) {
    let entry = row;
    if (!entry?.club) {
      // The Colorado Par 3 rows have a broken URL and split the name across
      // listName ("Columbine Country Club") and city ("Par 3 Course").
      entry =
        retryById.get(clubIdFromUrl(row?.url)) ||
        retryByName.get(normalizeListName(row?.listName)) ||
        retryByName.get(normalizeListName(`${row?.listName || ''} ${row?.city || ''}`));
      if (!entry?.club) {
        unresolved += 1;
        continue;
      }
      replaced += 1;
    }
    const id = clubIdFromUrl(entry.url);
    if (!id) {
      unresolved += 1;
      continue;
    }
    const prev = byId.get(id);
    if (!prev || richness(entry) > richness(prev)) byId.set(id, entry);
  }
  return { rows: [...byId.values()], replaced, unresolved };
}

function normalizeListName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function richness(entry) {
  const club = entry?.club || {};
  return (entry?.courses?.length || 0) * 10 + Object.values(club).filter((v) => v != null && v !== '').length;
}

/** Index rows (one per course layout) for one merged source entry. */
export function indexRowsForEntry(entry) {
  const club = entry.club;
  const clubId = clubIdFromUrl(entry.url);
  const clubName = String(club.name || entry.listName || '').replace(/\s*\|\s*/g, ' - ').replace(/\s+/g, ' ').trim();
  // club.state first (a border club can sit in a neighbour's file), then the
  // retry entry's state, the known retry gaps, and finally the file it came from.
  const state =
    cleanState(club.state) || cleanState(entry.state) || RETRY_STATE_OVERRIDES[clubName] || cleanState(entry.file_state) || '';
  const city = cleanCity(entry.city, club.address);
  const zip = cleanZip(club.post);
  const street = String(club.addr1 || '').trim();
  const address = [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const site = cleanWebsite(club.web);
  const lat = finiteNumber(club.lat);
  const lng = finiteNumber(club.lng);
  const base = {
    club_id: clubId,
    club_name: clubName,
    source_url: String(entry.url || ''),
    state,
    city,
    zip,
    address,
    lat: lat && Math.abs(lat) <= 90 ? lat : null,
    lng: lng && Math.abs(lng) <= 180 ? lng : null,
    phone: cleanPhone(club.phone),
    website: site.kind === 'own' || site.kind === 'shared' ? site.website : '',
    website_kind: site.kind,
    website_host: site.host,
    directory_url: site.kind === 'directory' ? site.website : '',
    membership: String(club.membership ?? '').trim(),
    bookable: membershipBucket(club.membership),
    fee_text: cleanFee(club.fee),
    club_holes: finiteNumber(club.totalHoleCount ?? club.holeCount),
  };
  const courses = Array.isArray(entry.courses) && entry.courses.length ? entry.courses : [{ name: clubName, holeCount: club.holeCount }];
  const seen = new Map();
  return courses.map((course, position) => {
    let slug = slugFromCourseName(course?.name || clubName) || 'course';
    const n = (seen.get(slug) || 0) + 1;
    seen.set(slug, n);
    if (n > 1) slug = `${slug}-${n}`;
    const tees = cleanTees(course?.tees);
    const holes = finiteNumber(course?.holeCount);
    return {
      ...base,
      course_key: `${clubId}:${slug}`,
      course_slug: slug,
      course_name: String(course?.name || '').trim(),
      course_position: position,
      course_count: courses.length,
      holes: holes && holes >= 3 && holes <= 36 ? holes : null,
      par: coursePar(course),
      yardage: courseYardage(course, tees),
      tees,
      layout_kind: layoutKind(course?.name, courses.length),
    };
  });
}

/**
 * main: a distinct course. rotation: a pairing of nines ("Lake/Mountain",
 * "Sunrise to Sagebrush"). short: par 3, executive, 6/9-hole loop.
 */
export function layoutKind(courseName, courseCount) {
  const name = String(courseName || '');
  if (courseCount <= 1) return 'main';
  if (/\bpar[\s-]*3\b|executive|short course|pitch|footgolf|practice|academy|\b[3-9][\s-]*holes?\b|\(\s*9 holes?\s*\)/i.test(name)) {
    return 'short';
  }
  if (/\s(?:to|\/|&)\s|^[a-z]+\s*\/\s*[a-z]+$/i.test(name) || /\w\/\w/.test(name)) return 'rotation';
  return 'main';
}

// ── Matching ────────────────────────────────────────────────────────────

const NAME_STOPWORDS = new Set([
  'golf', 'course', 'courses', 'club', 'country', 'the', 'at', 'and', 'resort', 'spa', 'a', 'of', 'cc', 'gc',
  'center', 'centre', 'and', 'inc', 'llc',
]);
const NAME_ABBREVIATIONS = { mt: 'mount', mtn: 'mountain', ft: 'fort', st: 'saint', ste: 'sainte', champ: 'championship', intl: 'international' };
const SHORT_SIGNAL = new Set(['par', '3', 'short', 'executive', 'pitch', '6', '9', '12']);

/**
 * Name words for matching. Registry names end in "(City)", which is dropped;
 * any other parentheses are kept ("Mulligan's Golf (Creekside) (Ogden)" keeps
 * Creekside, "Promontory - The Hills (par 3)" keeps par 3). Index names have
 * no city suffix, so nothing is dropped from them.
 */
export function nameTokens(name, { registry = false } = {}) {
  let s = String(name || '');
  if (registry) s = s.replace(/\(([^()]*)\)\s*$/, ' ');
  s = s
    .toLowerCase()
    .replace(/['’]s\b/g, 's')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ');
  return s
    .split(' ')
    .filter(Boolean)
    .map((t) => NAME_ABBREVIATIONS[t] || t)
    .filter((t) => !NAME_STOPWORDS.has(t));
}

/**
 * strong: same words (spacing aside), or one name's words all in the other with
 * two or more words or one distinctive word (6+ letters). weak: a single 4–5
 * letter word in common ("ogden"), only trusted within ~1 km. null: no match.
 */
export function nameStrength(a, b) {
  if (!a.length || !b.length) return null;
  if (a.join('') === b.join('')) return 'strong';
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const pool = new Set(longer);
  if (!shorter.every((t) => pool.has(t))) return null;
  if (shorter.length >= 2 || shorter[0].length >= 6) return 'strong';
  if (shorter[0].length >= 4) return 'weak';
  return null;
}

/**
 * How well a registry course's name fits an index club, including its layouts:
 * "Wasatch Lake" fits club "Wasatch Mountain State Park" + layout "Lake Course".
 */
export function clubNameStrength(registryName, clubName, courseNames = []) {
  const reg = nameTokens(registryName, { registry: true });
  const club = nameTokens(clubName);
  const direct = nameStrength(reg, club);
  if (direct === 'strong') return direct;
  for (const courseName of courseNames) {
    const layout = nameTokens(courseName);
    const pool = new Set([...club, ...layout]);
    if (reg.length >= 2 && reg.every((t) => pool.has(t)) && reg.some((t) => club.includes(t)) && reg.some((t) => layout.includes(t) && !club.includes(t))) {
      return 'strong';
    }
  }
  return direct;
}

/** Kept for callers that only need yes/no. */
export function namesMatch(registryName, clubName, courseNames = []) {
  return clubNameStrength(registryName, clubName, courseNames) != null;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every((v) => v != null && Number.isFinite(Number(v)))) return Infinity;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function registryZip(record) {
  return /\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/.exec(String(record?.address || ''))?.[1] || '';
}

const SHORT_NAME_RE = /\bpar[\s-]*3\b|executive|short course|pitch|\b[3-9][\s-]*holes?\b|\(\s*9 holes?\s*\)/i;

/** A club listed only for its par-3 or short course (Red Ledges' separate Par 3 listing). */
export function isShortClub(club) {
  return SHORT_NAME_RE.test(club.club_name) || club.rows.every((r) => SHORT_NAME_RE.test(r.course_name || ''));
}

/** Closed per its own name ("(Permanently closed) Frank Skull Golf Course"). */
export function isClosedClub(club) {
  return /permanently closed|\(closed\)|^closed\b/i.test(club.club_name);
}

const METHOD_RANK = { club_id: 0, name_zip: 1, name_near: 2 };

/**
 * Link index clubs to registry courses in one state.
 *
 * Order (from the import plan): an 18Birdies club id already stored on the
 * registry record; then a strong name match with the same ZIP; then a name
 * match within ~1 km of the pin (a weak one-word match only counts here).
 * A strong name match farther away, or the same street address under another
 * name, goes to review.
 *
 * When two index clubs claim one registry course (18Birdies lists some par-3
 * courses as their own club), the better match wins: club id, then name+ZIP,
 * then near; then a full club over a par-3-only listing. The other claimant
 * goes to review, never to "new", so it cannot become a duplicate.
 *
 * @param clubs     [{ club_id, club_name, zip, lat, lng, rows: [index rows] }]
 * @param registry  [{ slug, record }]
 */
export function matchClubsToRegistry(clubs, registry, { nearKm = 1.0, reviewKm = 30 } = {}) {
  const claims = new Map(); // slug → [{club, method}]
  const reviews = [];
  const claim = (slug, club, method) => {
    if (!claims.has(slug)) claims.set(slug, []);
    claims.get(slug).push({ club, method });
  };
  const byStoredId = new Map();
  for (const row of registry) {
    const id = String(row.record?.birdies_club_id || '').toLowerCase();
    if (id) byStoredId.set(id, [...(byStoredId.get(id) || []), row]);
  }
  for (const club of clubs) {
    const stored = byStoredId.get(club.club_id) || [];
    for (const row of stored) claim(row.slug, club, 'club_id');
    if (stored.length) continue;
    const courseNames = club.rows.map((r) => r.course_name);
    for (const row of registry) {
      const rec = row.record || {};
      if (rec.birdies_club_id) continue;
      const strength = clubNameStrength(rec.name, club.club_name, courseNames);
      const km = distanceKm(club.lat, club.lng, rec.lat, rec.lng);
      const zip = registryZip(rec);
      if (strength === 'strong' && zip && club.zip && zip === club.zip) claim(row.slug, club, 'name_zip');
      else if (strength && km <= nearKm) claim(row.slug, club, 'name_near');
      else if (strength === 'strong' && km <= reviewKm) {
        reviews.push({ club_id: club.club_id, slug: row.slug, reason: `Same name, ${Number.isFinite(km) ? `${km.toFixed(1)} km apart` : 'no pin on one side'}` });
      } else if (!strength && km <= 0.3 && sameStreet(rec.address, club.rows[0]?.address)) {
        reviews.push({ club_id: club.club_id, slug: row.slug, reason: 'Same street address, different name' });
      }
    }
  }
  const links = new Map();
  for (const [slug, list] of claims) {
    const ranked = [...list].sort(
      (a, b) => METHOD_RANK[a.method] - METHOD_RANK[b.method] || Number(isShortClub(a.club)) - Number(isShortClub(b.club)),
    );
    const [best, next] = ranked;
    const tie = next && next.club.club_id !== best.club.club_id && METHOD_RANK[next.method] === METHOD_RANK[best.method] && isShortClub(next.club) === isShortClub(best.club);
    if (tie) {
      for (const c of ranked) reviews.push({ club_id: c.club.club_id, slug, reason: `${slug} matches ${ranked.length} index clubs equally` });
      continue;
    }
    if (!links.has(best.club.club_id)) links.set(best.club.club_id, []);
    links.get(best.club.club_id).push({ slug, method: best.method });
    for (const other of ranked.slice(1)) {
      if (other.club.club_id === best.club.club_id) continue;
      reviews.push({ club_id: other.club.club_id, slug, reason: `Also matches ${slug}, which is linked to ${best.club.club_name}` });
    }
  }
  const linkedSlugs = new Set([...links.values()].flat().map((l) => l.slug));
  const reviewSlugs = new Set(reviews.map((r) => r.slug));
  const unmatchedRegistry = registry.filter((r) => !linkedSlugs.has(r.slug) && !reviewSlugs.has(r.slug)).map((r) => r.slug);
  return { links, reviews, unmatchedRegistry };
}

function sameStreet(a, b) {
  const norm = (s) => String(s || '').split(',')[0].toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y && /^\d+ /.test(x) && x === y);
}

/**
 * Inside a linked club, pair each registry course with the layout it books.
 *
 * - A layout whose own words (beyond the club's name) all appear in the
 *   registry name takes it: "Sand Hollow (Champ)" → "Sand Hollow Championship",
 *   "Lake Course" → "Wasatch Lake", "Pete Dye Canyon Course" is not
 *   "Pete Dye Course" unless every word fits.
 * - Par-3 and short layouts only take a registry course whose name says so.
 * - A registry name that names no layout ("Stonebridge") takes the club's main
 *   layout only when the club has exactly one; rotations of nines don't count.
 * - Otherwise ("Mountain Dell" books Canyon and Lake as one entry) there is no
 *   course link, so only club-level facts (phone, website) are filled.
 * @returns Map course_key → slug
 */
export function assignLayouts(clubRows, registryLinks, registryBySlug) {
  const out = new Map();
  const clubTokens = new Set(nameTokens(clubRows[0]?.club_name || ''));
  const mains = clubRows.filter((r) => r.layout_kind === 'main');
  const ownWords = (row) => {
    const all = nameTokens(row.course_name);
    const own = all.filter((t) => !clubTokens.has(t));
    // "Mountain Course" at "Wasatch Mountain State Park": no words beyond the
    // club's, so compare all of them (still one exact, unique fit).
    return own.length ? own : all;
  };
  const pending = [...registryLinks];
  // Named layouts first, so a fallback cannot take a layout another course names.
  for (const link of [...pending]) {
    const reg = new Set(nameTokens(registryBySlug.get(link.slug)?.record?.name || '', { registry: true }));
    const regSaysShort = [...reg].some((t) => SHORT_SIGNAL.has(t));
    const named = clubRows.filter((r) => {
      if (r.layout_kind === 'rotation' || out.has(r.course_key)) return false;
      // The registry's own words (beyond the club's) all appear in the layout:
      // "Painted Valley (Nicklaus)" ↔ "Jack Nicklaus(Painted Valley)", and
      // "Timpanogos Pasture" ↔ the par-3 "The Pasture Par3 Course". Naming the
      // layout outright is enough, even for a short course.
      const regOwn = [...reg].filter((t) => !clubTokens.has(t));
      const layout = new Set(nameTokens(r.course_name));
      if (regOwn.length > 0 && regOwn.every((t) => layout.has(t))) return true;
      // Or the layout's own words all appear in the registry name; a par-3 or
      // short layout only when the registry name says it is one.
      if (r.layout_kind === 'short' && !regSaysShort) return false;
      const own = ownWords(r);
      return own.length > 0 && own.every((t) => reg.has(t));
    });
    if (named.length === 1) {
      out.set(named[0].course_key, link.slug);
      pending.splice(pending.indexOf(link), 1);
    }
  }
  if (pending.length === 1 && mains.length === 1 && !out.has(mains[0].course_key) && ![...out.keys()].length) {
    out.set(mains[0].course_key, pending[0].slug);
  }
  return out;
}

/** Fields an index row may fill on an existing registry record, only where the record is blank. */
export function fillBlanks(record, row, { courseLinked }) {
  const patch = {};
  const blank = (v) => v === undefined || v === null || String(v).trim() === '';
  if (blank(record.phone_number) && row.phone) patch.phone_number = row.phone;
  if (blank(record.website) && row.website && row.website_kind === 'own') patch.website = row.website;
  if (courseLinked) {
    if (blank(record.holes) && (row.holes === 9 || row.holes === 18)) patch.holes = row.holes;
    if (blank(record.par) && row.par && row.par >= 27 && row.par <= 76) patch.par = row.par;
    if (blank(record.yardage) && row.yardage && row.yardage >= 1000 && row.yardage <= 8000) patch.yardage = row.yardage;
    if (!Array.isArray(record.tees) && row.tees?.length) patch.tees = row.tees;
  }
  return patch;
}

/** Disagreements worth a look, never written: name, street, website domain. */
export function differences(record, row) {
  const out = [];
  if (!clubNameStrength(record.name, row.club_name, [row.course_name])) out.push({ field: 'name', registry: record.name, index: row.club_name });
  const regHost = (() => {
    try {
      return new URL(record.website).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  if (regHost && row.website_host && row.website_kind === 'own' && regHost !== row.website_host) {
    out.push({ field: 'website', registry: record.website, index: row.website });
  }
  return out;
}
