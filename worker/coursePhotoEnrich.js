/**
 * Copies one course photo into Supabase Storage.
 * A stored photo id is downloaded, a stored place id gets one Place Details
 * call for its photo, and a course with neither gets one text search.
 *
 * Every attempt is recorded on course_catalog:
 * - a copy, or "Google has no photo", stamps photos_fetched_at and stops;
 * - a place Google no longer knows (NOT_FOUND) is stamped place_not_found and stops;
 * - anything else counts an attempt and waits longer before the next one,
 *   then gives up after MAX_PHOTO_ATTEMPTS;
 * - a key or quota error ends the batch without counting against the course.
 *
 * Only public courses get a photo: QA stubs are checked again a day later and
 * never cost a Google call. The course website's share image (og:image, saved
 * by the crawler as photo_candidate_url) is tried before any Places lookup.
 */

import { courseNameMatchTokens, courseNamesLikelyDuplicate, isPublicRegistryRecord } from './courseAdmin.js';

const BATCH_SIZE = 10;
export const MAX_PHOTO_ATTEMPTS = 6;
const RETRY_BASE_MS = 30 * 60 * 1000;
const STOP_PAUSE_MS = 60 * 60 * 1000;
const NOT_PUBLIC_PAUSE_MS = 24 * 60 * 60 * 1000;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function sbHeaders(env, json = false) {
  const h = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function firstPhotoReference(photos) {
  const photo = Array.isArray(photos) ? photos[0] : null;
  if (!photo || typeof photo !== 'object') return '';
  return String(photo.photo_reference || photo.name || '').trim();
}

/**
 * Legacy Places status → what the photo job should do next.
 * ok: use the answer. gone: the place id is dead, stop for good.
 * stop: the key or quota is the problem, end the batch. retry: try later.
 */
export function classifyPlacesStatus(status) {
  if (status === 'OK') return 'ok';
  if (status === 'NOT_FOUND' || status === 'INVALID_REQUEST' || status === 'ZERO_RESULTS') return 'gone';
  if (status === 'OVER_QUERY_LIMIT' || status === 'REQUEST_DENIED') return 'stop';
  return 'retry';
}

/** HTTP status from the new Places API (Text Search, Photo media) → next step. */
export function classifyPlacesHttp(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429 || status === 401 || status === 403) return 'stop';
  return 'retry';
}

/** Wait after the nth failed attempt: 30 min, 1 h, 2 h, 4 h, 8 h. */
export function photoRetryDelayMs(attempts) {
  return RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);
}

/**
 * The course_catalog patch that records a failed attempt.
 * `previousAttempts` is the count before this attempt.
 */
export function photoFailurePatch(previousAttempts, result, now = new Date()) {
  const at = now.toISOString();
  if (result === 'gone') {
    return { photos_fetched_at: at, photo_failed_reason: 'place_not_found', photo_next_attempt_at: null };
  }
  if (result === 'stop') {
    return { photo_next_attempt_at: new Date(now.getTime() + STOP_PAUSE_MS).toISOString() };
  }
  if (result === 'not_public') {
    return { photo_next_attempt_at: new Date(now.getTime() + NOT_PUBLIC_PAUSE_MS).toISOString() };
  }
  const attempts = (Number(previousAttempts) || 0) + 1;
  if (attempts >= MAX_PHOTO_ATTEMPTS) {
    return {
      photo_attempts: attempts,
      photos_fetched_at: at,
      photo_failed_reason: 'gave_up',
      photo_next_attempt_at: null,
    };
  }
  return {
    photo_attempts: attempts,
    photo_next_attempt_at: new Date(now.getTime() + photoRetryDelayMs(attempts)).toISOString(),
  };
}

/** Place Details for the photo id only. */
async function photoReferenceForPlace(placeId, apiKey) {
  const url =
    'https://maps.googleapis.com/maps/api/place/details/json' +
    `?place_id=${encodeURIComponent(placeId)}&fields=photos&key=${encodeURIComponent(apiKey)}`;
  let res;
  try {
    res = await fetch(url);
  } catch {
    return { status: 'retry', photo_reference: '' };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) return { status: 'retry', photo_reference: '' };
  const status = classifyPlacesStatus(data.status);
  return { status, photo_reference: status === 'ok' ? firstPhotoReference(data.result?.photos) : '' };
}

function distanceKm(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Prefer the listing that is this course, then one that has a photo.
 * A closer pin with the same name and no photo loses to the photo a short
 * distance away. A campground that only shares the first word does not win.
 */
export function choosePhotoCandidate(courseName, places, origin = {}) {
  let best = null;
  let bestRank = null;
  const lat = Number(origin.lat);
  const lng = Number(origin.lng);
  const ours = new Set(courseNameMatchTokens(courseName));
  for (const place of places || []) {
    const placeName = String(place?.name || '');
    if (!courseNamesLikelyDuplicate(courseName, placeName)) continue;
    const distance = distanceKm(lat, lng, place.lat, place.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && distance > 30) continue;
    const extra = courseNameMatchTokens(placeName).filter((token) => !ours.has(token)).length;
    const rank = [extra, place.photo_reference ? 0 : 1, distance];
    const better =
      !bestRank ||
      rank[0] < bestRank[0] ||
      (rank[0] === bestRank[0] && rank[1] < bestRank[1]) ||
      (rank[0] === bestRank[0] && rank[1] === bestRank[1] && rank[2] < bestRank[2]);
    if (better) {
      best = place;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * One Text Search for a course that has no stored place.
 * Photos are included in the same Pro request as the name.
 */
async function searchPhotoOnce(record, apiKey) {
  const name = String(record?.name || '').trim();
  if (!name) return { status: 'ok', photo_reference: '', place_id: '' };
  const lat = Number(record?.lat);
  const lng = Number(record?.lng);
  const body = { textQuery: name, pageSize: 5 };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    body.locationBias = {
      circle: { center: { latitude: lat, longitude: lng }, radius: 20000 },
    };
  }
  let res;
  try {
    res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.photos',
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 'retry', photo_reference: '', place_id: '' };
  }
  const status = classifyPlacesHttp(res.status);
  const data = await res.json().catch(() => null);
  if (status !== 'ok' || !data) return { status: status === 'ok' ? 'retry' : status, photo_reference: '', place_id: '' };
  const candidates = (data.places || []).map((place) => ({
    name: place.displayName?.text || '',
    photo_reference: firstPhotoReference(place.photos),
    place_id: String(place.id || '').replace(/^places\//, ''),
    lat: place.location?.latitude,
    lng: place.location?.longitude,
  }));
  const best = choosePhotoCandidate(name, candidates, { lat, lng });
  if (!best) return { status: 'ok', photo_reference: '', place_id: '' };
  return { status: 'ok', photo_reference: best.photo_reference, place_id: best.place_id };
}

function photoMediaUrl(photoRef, apiKey) {
  if (/^places\/[^/]+\/photos\//.test(photoRef)) {
    return `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=800&key=${encodeURIComponent(apiKey)}`;
  }
  return (
    'https://maps.googleapis.com/maps/api/place/photo?maxwidth=800' +
    `&photo_reference=${encodeURIComponent(photoRef)}&key=${encodeURIComponent(apiKey)}`
  );
}

async function fetchPendingCatalogRows(env, now = new Date()) {
  // Without the attempt columns (migration not applied) this returns no rows,
  // which pauses the cron instead of calling Google in a loop.
  const due = encodeURIComponent(now.toISOString());
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/course_catalog` +
      `?select=slug,name,photo_storage_url,photo_attempts` +
      `&photo_storage_url=is.null` +
      `&photos_fetched_at=is.null` +
      `&or=(photo_next_attempt_at.is.null,photo_next_attempt_at.lte.${due})` +
      `&order=photo_next_attempt_at.asc.nullsfirst,created_at.asc&limit=${BATCH_SIZE}`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) {
    console.error('[photos] pending rows query failed', res.status, (await res.text()).slice(0, 200));
    return [];
  }
  return res.json();
}

async function fetchCoursesMissingPhotos(env) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/course_catalog` +
        `?select=slug,name,photos_fetched_at,photo_attempts,photo_next_attempt_at` +
        `&photo_storage_url=is.null&order=slug`,
      { headers: { ...sbHeaders(env), Range: `${from}-${from + 999}` } },
    );
    if (!res.ok) throw new Error(`course_catalog read failed (${res.status}) after ${rows.length} rows`);
    const batch = await res.json().catch(() => null);
    if (!Array.isArray(batch)) throw new Error(`course_catalog read returned no rows array after ${rows.length} rows`);
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

async function fetchRegistryRecord(env, slug) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/course_registry?slug=eq.${encodeURIComponent(slug)}&select=record`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0]?.record || null;
}

async function patchCatalog(env, slug, fields) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/course_catalog?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: sbHeaders(env, true),
    body: JSON.stringify(fields),
  });
}

async function patchRegistryRecord(env, slug, record) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/course_registry?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(env, true), Prefer: 'return=minimal' },
    body: JSON.stringify({ record }),
  });
}

/**
 * One copy attempt. Returns { result } where result is
 * copied | none | retry | gone | stop. The caller records failures.
 */
/** Store an image response for a course and record the stored URL. */
async function storePhoto(env, slug, photoRes, stamp) {
  const type = photoRes.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) return false;
  const photoBuffer = await photoRes.arrayBuffer();
  if (photoBuffer.byteLength < 2_000 || photoBuffer.byteLength > MAX_PHOTO_BYTES) return false;
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const storagePath = `${slug}.${ext}`;
  const uploadRes = await fetch(`${env.SUPABASE_URL}/storage/v1/object/course-photos/${storagePath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      apikey: env.SUPABASE_SERVICE_KEY,
      'Content-Type': type,
      'x-upsert': 'true',
    },
    body: photoBuffer,
  });
  if (!uploadRes.ok) return false;
  await patchCatalog(env, slug, {
    photo_storage_path: storagePath,
    photo_storage_url: `${env.SUPABASE_URL}/storage/v1/object/public/course-photos/${storagePath}`,
    photos_fetched_at: stamp,
    photo_next_attempt_at: null,
    photo_failed_reason: null,
  });
  return true;
}

/** The course website's share image, saved by the crawler. No Google call. */
async function tryWebsitePhoto(env, slug, record, stamp) {
  const url = String(record.photo_candidate_url || '').trim();
  if (!/^https?:\/\//i.test(url)) return false;
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { Accept: 'image/*' } });
  } catch {
    res = null;
  }
  if (res?.ok && (await storePhoto(env, slug, res, stamp))) return true;
  // Do not try the same image again; fall through to Places.
  const { photo_candidate_url: _tried, ...rest } = record;
  await patchRegistryRecord(env, slug, { ...rest, photo_candidate_failed: url });
  return false;
}

async function enrichOne(env, row, { alreadyLookedUp = false } = {}) {
  let record = (await fetchRegistryRecord(env, row.slug)) || {};
  if (!record.name && row.name) record = { ...record, name: row.name };
  const stamp = new Date().toISOString();
  // QA stubs and hidden courses never cost a Places call.
  if (!isPublicRegistryRecord(record)) return { result: 'not_public' };
  if (await tryWebsitePhoto(env, row.slug, record, stamp)) return { result: 'copied' };
  if (record.photo_candidate_url) {
    record = { ...record, photo_candidate_failed: record.photo_candidate_url };
    delete record.photo_candidate_url;
  }
  let photoRef = String(record.photo_reference || '').trim();
  if (!photoRef && !alreadyLookedUp) {
    if (record.google_place_id) {
      const lookedUp = await photoReferenceForPlace(record.google_place_id, env.GOOGLE_PLACES_KEY);
      if (lookedUp.status !== 'ok') return { result: lookedUp.status };
      photoRef = lookedUp.photo_reference;
      if (photoRef) {
        record = { ...record, photo_reference: photoRef };
        await patchRegistryRecord(env, row.slug, record);
      }
    } else {
      const found = await searchPhotoOnce(record, env.GOOGLE_PLACES_KEY);
      if (found.status !== 'ok') return { result: found.status };
      photoRef = found.photo_reference;
      const next = { ...record };
      if (photoRef) next.photo_reference = photoRef;
      if (!next.google_place_id && found.place_id) next.google_place_id = found.place_id;
      if (next.photo_reference !== record.photo_reference || next.google_place_id !== record.google_place_id) {
        record = next;
        await patchRegistryRecord(env, row.slug, record);
      }
    }
  }
  if (!photoRef) {
    await patchCatalog(env, row.slug, { photos_fetched_at: stamp, photo_next_attempt_at: null });
    return { result: 'none' };
  }

  let photoRes;
  try {
    photoRes = await fetch(photoMediaUrl(photoRef, env.GOOGLE_PLACES_KEY));
  } catch {
    return { result: 'retry' };
  }
  if (!photoRes.ok) {
    const result = classifyPlacesHttp(photoRes.status);
    // 400/404: the photo id expired. Drop it so the next attempt asks for a fresh one.
    if (result === 'retry' && (photoRes.status === 400 || photoRes.status === 404)) {
      const { photo_reference: _expired, ...rest } = record;
      await patchRegistryRecord(env, row.slug, rest);
    }
    return { result };
  }
  if (!(await storePhoto(env, row.slug, photoRes, stamp))) return { result: 'retry' };
  return { result: 'copied' };
}

/** Writes the attempt count / backoff / give-up for a failed attempt. */
async function recordOutcome(env, row, outcome) {
  if (outcome.result === 'copied' || outcome.result === 'none') return;
  await patchCatalog(env, row.slug, photoFailurePatch(row.photo_attempts, outcome.result));
}

async function catalogPhotoRow(env, slug) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/course_catalog?slug=eq.${encodeURIComponent(slug)}` +
      `&select=photo_storage_url,photo_attempts`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return rows?.[0] || null;
}

/**
 * Copies a photo for a course that was just saved. Discovery already stored a
 * photo id from its Nearby Search, so this is normally a download with no
 * Places lookup. It used to buy a second Place Details call for rating and
 * phone; that call is gone.
 */
export async function copyNewCoursePhoto(env, slug, record) {
  if (!env.GOOGLE_PLACES_KEY || !env.SUPABASE_SERVICE_KEY || !record) return;
  const row = await catalogPhotoRow(env, slug);
  if (!row || row.photo_storage_url) return;
  const outcome = await enrichOne(env, { slug, name: record.name });
  await recordOutcome(env, { slug, photo_attempts: row.photo_attempts }, outcome);
}

/**
 * One lookup each for courses that were saved before a photo id was kept.
 * A stored photo id is only downloaded. Anything else gets one name search,
 * then the result is stored so it is not searched again. Courses that are
 * waiting out a backoff, or that the photo job already gave up on, are skipped.
 */
export async function fillMissingCoursePhotos(env) {
  if (!env.GOOGLE_PLACES_KEY || !env.SUPABASE_SERVICE_KEY) {
    return { error: 'photos_not_configured' };
  }
  const rows = await fetchCoursesMissingPhotos(env);
  const counts = { checked: rows.length, filled: 0, none: 0, failed: 0, waiting: 0 };
  const filled = [];
  const now = Date.now();
  for (const row of rows) {
    const nextAt = Date.parse(row.photo_next_attempt_at || '');
    if (Number.isFinite(nextAt) && nextAt > now) {
      counts.waiting += 1;
      continue;
    }
    try {
      const record = await fetchRegistryRecord(env, row.slug);
      if (!record?.name) {
        counts.failed += 1;
        await sleep(200);
        continue;
      }
      if (row.photos_fetched_at && !String(record.photo_reference || '').trim()) {
        counts.none += 1;
        continue;
      }
      let outcome = null;
      if (!String(record.photo_reference || '').trim()) {
        const found = await searchPhotoOnce(record, env.GOOGLE_PLACES_KEY);
        if (found.status !== 'ok') {
          outcome = { result: found.status };
        } else {
          const next = { ...record };
          if (found.photo_reference) next.photo_reference = found.photo_reference;
          if (!next.google_place_id && found.place_id) next.google_place_id = found.place_id;
          if (next.photo_reference !== record.photo_reference || next.google_place_id !== record.google_place_id) {
            await patchRegistryRecord(env, row.slug, next);
          }
        }
      }
      if (!outcome) outcome = await enrichOne(env, row, { alreadyLookedUp: true });
      await recordOutcome(env, row, outcome);
      if (outcome.result === 'not_public') {
        counts.waiting += 1;
      } else if (outcome.result === 'copied') {
        counts.filled += 1;
        filled.push(row.name || row.slug);
      } else if (outcome.result === 'none') {
        counts.none += 1;
      } else {
        counts.failed += 1;
      }
      if (outcome.result === 'stop') {
        counts.stopped = 'Google refused the key or quota. Stopped early.';
        break;
      }
    } catch {
      counts.failed += 1;
    }
    await sleep(200);
  }
  return { counts, filled };
}

export async function handleCoursePhotoEnrichPoll(env) {
  if (!env.GOOGLE_PLACES_KEY || !env.SUPABASE_SERVICE_KEY) return;

  const rows = await fetchPendingCatalogRows(env);
  for (const row of rows) {
    let outcome;
    try {
      outcome = await enrichOne(env, row);
    } catch {
      outcome = { result: 'retry' };
    }
    try {
      await recordOutcome(env, row, outcome);
    } catch {
      // Recording failed; the row is retried next tick, the same as before.
    }
    if (outcome.result === 'stop') {
      console.error('[photos] Google refused the key or quota; ending this batch');
      break;
    }
    await sleep(300);
  }
}
