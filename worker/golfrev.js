/**
 * GolfRev (Cybergolf) public tee sheet.
 * Booking URLs are `/go/tee_times/?htc={htc}&courseid={id}`. Live inventory is
 * GET `/go/tee_times/teetime_table_html.asp` (no session). Cards show a price
 * range when 9 and 18 holes are both offered; a single price is treated as 18.
 */

const GR_UA = 'TeeTimeIO/1.0 (+https://tee-time.io)';
const GR_ORIGIN = 'https://www.golfrev.com';
const ID_RE = /^\d{1,10}$/;

export function ymdToGolfRevDate(ymd) {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

export function golfRevCourseId(course) {
  const explicit = course?.golfrev_course_id != null ? String(course.golfrev_course_id).trim() : '';
  if (ID_RE.test(explicit)) return explicit;
  for (const raw of [course?.booking_url, course?.booking_url_template]) {
    const id = idsFromUrl(raw).courseId;
    if (id) return id;
  }
  return '';
}

export function golfRevHtc(course) {
  const explicit = course?.golfrev_htc != null ? String(course.golfrev_htc).trim() : '';
  if (ID_RE.test(explicit)) return explicit;
  for (const raw of [course?.booking_url, course?.booking_url_template]) {
    const id = idsFromUrl(raw).htc;
    if (id) return id;
  }
  return '';
}

export function idsFromUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    if (!/golfrev\.com$/i.test(u.hostname)) return { courseId: '', htc: '' };
    const courseId = String(u.searchParams.get('courseid') || u.searchParams.get('courseId') || '').trim();
    const htc = String(u.searchParams.get('htc') || '').trim();
    return {
      courseId: ID_RE.test(courseId) ? courseId : '',
      htc: ID_RE.test(htc) ? htc : '',
    };
  } catch {
    return { courseId: '', htc: '' };
  }
}

export function courseHasGolfRev(course) {
  if (String(course?.platform || '') === 'golfrev') return true;
  return Boolean(golfRevCourseId(course) && golfRevHtc(course));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDollar(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${Math.round(n)}`;
}

export function golfRevClockToRaw(ymd, hour, minute) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return '';
  return `${ymd} ${pad2(h)}:${pad2(m)}`;
}

/** Card with `$21.00 - $42.00` → 9h at min, 18h at max. Single price → 18h. */
export function parseGolfRevTeeTimesHtml(html, dateYmd) {
  const source = String(html || '');
  if (!/showBooking\s*\(/i.test(source)) return [];
  const cards = source.split(/showBooking\s*\(/i).slice(1);
  const best = new Map();
  for (const card of cards) {
    const head = card.match(/^\s*'(\d{4}-\d{2}-\d{2})'\s*,\s*\d+\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*,\s*(\d+)/);
    if (!head) continue;
    const date = head[1];
    if (dateYmd && date !== dateYmd) continue;
    const rawTime = golfRevClockToRaw(date, head[2], head[3]);
    if (!rawTime) continue;
    const text = stripTags(card);
    const spotsFromLabel = Number(text.match(/(\d+)\s*players?/i)?.[1]);
    const spotsClick = Number(head[4]);
    const spots = Number.isFinite(spotsFromLabel) && spotsFromLabel > 0 ? spotsFromLabel : spotsClick;
    if (!Number.isFinite(spots) || spots <= 0) continue;
    const prices = [...text.matchAll(/\$(\d+(?:\.\d{2})?)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0);
    const unique = [...new Set(prices.map((n) => Math.round(n * 100) / 100))].sort((a, b) => a - b);
    const holePrices =
      unique.length >= 2
        ? [
            { holes: 9, price: unique[0] },
            { holes: 18, price: unique[unique.length - 1] },
          ]
        : unique.length === 1
          ? [{ holes: 18, price: unique[0] }]
          : [];
    for (const hp of holePrices) {
      const formatted = formatDollar(hp.price);
      if (!formatted) continue;
      const key = `${rawTime}|${hp.holes}`;
      const row = { rawTime, spots, price: formatted, holes: hp.holes };
      const prev = best.get(key);
      if (!prev || spots > (prev.spots || 0)) best.set(key, row);
    }
  }
  return [...best.values()].sort((a, b) => {
    if (a.rawTime !== b.rawTime) return a.rawTime < b.rawTime ? -1 : 1;
    return a.holes - b.holes;
  });
}

export function normalizeGolfRevTimesWorker(_course, data) {
  if (Array.isArray(data?.times)) return data.times;
  if (typeof data?.html === 'string') {
    return parseGolfRevTeeTimesHtml(data.html, data.date);
  }
  return [];
}

export function buildGolfRevBookingUrl(course, date, players) {
  const base = String(course?.booking_url || '').trim();
  const courseId = golfRevCourseId(course);
  const htc = golfRevHtc(course);
  const us = ymdToGolfRevDate(date);
  const playersNum = Math.min(Math.max(parseInt(String(players), 10) || 1, 1), 4);
  const href = base || (courseId && htc ? `${GR_ORIGIN}/go/tee_times/?htc=${htc}&courseid=${courseId}&r=1` : '');
  if (!href) return null;
  try {
    const u = new URL(href.split('#')[0] || href);
    if (courseId) u.searchParams.set('courseid', courseId);
    if (htc) u.searchParams.set('htc', htc);
    if (us) u.searchParams.set('startdate', us);
    u.searchParams.set('r', '1');
    u.searchParams.delete('startDate');
    if (playersNum) u.searchParams.set('players', String(playersNum));
    return u.toString();
  } catch {
    return href;
  }
}

function jsonResponse(body, status = 200) {
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

export async function handleGolfRev(params, fetchImpl = fetch) {
  const date = String(params.date || '').trim();
  const courseId = String(params.course_id || params.golfrev_course_id || '').trim();
  const htc = String(params.htc || params.golfrev_htc || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !ID_RE.test(courseId) || !ID_RE.test(htc)) {
    return jsonResponse({ error: 'missing_params' });
  }

  const url =
    `${GR_ORIGIN}/go/tee_times/teetime_table_html.asp` +
    `?c=${encodeURIComponent(courseId)}&s=${encodeURIComponent(date)}` +
    `&h=${encodeURIComponent(htc)}&specials=&reset=yes&snapshot=no`;
  let text;
  try {
    const res = await fetchImpl(url, {
      headers: {
        'User-Agent': GR_UA,
        Accept: 'text/html,application/xhtml+xml',
        Referer: `${GR_ORIGIN}/go/tee_times/?htc=${htc}&courseid=${courseId}&r=1`,
      },
    });
    if (!res.ok) {
      return jsonResponse({ error: 'upstream_error', status: res.status });
    }
    text = await res.text();
  } catch {
    return jsonResponse({ error: 'upstream_error' });
  }

  const times = parseGolfRevTeeTimesHtml(text, date);
  return jsonResponse({ date, course_id: courseId, htc, times });
}
