/**
 * What the public course endpoints send to browsers.
 *
 * loadCourses() keeps full records for the poller and /v1/tee-times, which
 * resolve vendor ids on the server. Browsers get:
 *   /v1/courses/index   a small list for search, the map, and cards
 *   /v1/courses/:slug   one course's full public record
 *   /v1/courses?slugs=  full public records for a few courses at once
 *   /v1/coverage        state counts for coverage copy
 *   /v1/courses         every full public record (kept for the deployed site)
 */

/**
 * Never sent to browsers.
 * clubcaddie_apikey and golfrev_htc are vendor booking-widget ids. Both are also
 * inside the course's public booking_url, which the Book button opens, so this
 * keeps them out of bulk downloads rather than hiding them. timezone_pin is
 * internal bookkeeping for the exact time-zone backfill.
 */
export const PRIVATE_COURSE_FIELDS = Object.freeze(['clubcaddie_apikey', 'golfrev_htc', 'timezone_pin']);

/**
 * The index: enough for search (name, address, area, state), the map (pins),
 * result cards (photo, rating, holes, booking window), and the plain Book link.
 * Vendor ids, notes, rates, phone, and website come from /v1/courses/:slug.
 */
export const INDEX_COURSE_FIELDS = Object.freeze([
  'slug',
  'name',
  'address',
  'area',
  'state',
  'lat',
  'lng',
  'timezone',
  'photo_storage_url',
  'rating',
  'review_count',
  'platform',
  'holes',
  'booking_status',
  // Read by effectivePlatform() to tell live tee sheets from link-only courses.
  'booking_status_note',
  'booking_url',
  'booking_window_days',
  'booking_opens_time',
]);

/** A state counts as live at this many public courses (same as the site copy). */
export const LIVE_MARKET_MIN_COURSES = 5;

export const MAX_SLUGS_PER_REQUEST = 60;

const SLUG_RE = /^[a-z0-9-]{1,120}$/;

function present(value) {
  return value !== undefined && value !== null && value !== '';
}

/** A full course record with private fields removed. */
export function publicCourse(course) {
  if (!course || typeof course !== 'object') return course;
  const out = { ...course };
  for (const key of PRIVATE_COURSE_FIELDS) delete out[key];
  return out;
}

/** The index entry for a course: only INDEX_COURSE_FIELDS that have a value. */
export function indexCourse(course) {
  const out = {};
  for (const key of INDEX_COURSE_FIELDS) {
    if (present(course?.[key])) out[key] = course[key];
  }
  return out;
}

/** Valid, de-duplicated slugs from a comma-separated query value. */
export function parseSlugList(raw) {
  const seen = new Set();
  for (const part of String(raw || '').split(',')) {
    const slug = part.trim().toLowerCase();
    if (SLUG_RE.test(slug)) seen.add(slug);
  }
  return [...seen];
}

/**
 * Public courses per state, most first, and which states count as live.
 * Same rule as the landing page and serviceArea.ts: live at 5+ courses, and
 * if no state reaches that, the largest one, so the copy is never empty.
 */
export function coverageFromCourses(courses) {
  const counts = new Map();
  let total = 0;
  for (const course of courses || []) {
    total += 1;
    const state = String(course?.state || '').trim().toUpperCase();
    if (state.length === 2) counts.set(state, (counts.get(state) || 0) + 1);
  }
  const states = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([state, count]) => ({ state, courses: count }));
  let live = states.filter((s) => s.courses >= LIVE_MARKET_MIN_COURSES).map((s) => s.state);
  if (!live.length && states.length) live = [states[0].state];
  // Landing hero photo: the most-reviewed course with a stored photo (the page's old rule).
  let hero = null;
  for (const course of courses || []) {
    if (!course?.photo_storage_url) continue;
    if (!hero || (Number(course.review_count) || 0) > (Number(hero.review_count) || 0)) hero = course;
  }
  return {
    total_courses: total,
    states,
    live_states: live,
    live_min_courses: LIVE_MARKET_MIN_COURSES,
    hero: hero ? { slug: hero.slug, name: hero.name, photo_storage_url: hero.photo_storage_url } : null,
  };
}
