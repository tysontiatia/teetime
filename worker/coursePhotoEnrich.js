/**
 * Copies one course photo into Supabase Storage.
 * A course is looked up once: a stored photo id is downloaded, a stored place
 * id gets one Place Details call, and a course with neither gets one text
 * search. photos_fetched_at is set after that attempt so later passes do not
 * ask Google again. A failed download stays unstamped and retries the copy.
 */

import { courseNameMatchTokens, courseNamesLikelyDuplicate } from './courseAdmin.js';

const BATCH_SIZE = 10;

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

export function placeFactsFromDetails(result) {
  if (!result || typeof result !== 'object') return null;
  const rating = Number(result.rating);
  const reviewCount = Number(result.user_ratings_total ?? result.userRatingCount);
  return {
    rating: Number.isFinite(rating) ? rating : null,
    review_count: Number.isFinite(reviewCount) ? reviewCount : null,
    photo_reference: firstPhotoReference(result.photos),
    phone: String(result.formatted_phone_number || result.nationalPhoneNumber || '').trim(),
  };
}

/** One Place Details call for the stored rating, review count, photo id, and phone. */
async function placeFactsForPlace(placeId, apiKey, { phone = false } = {}) {
  const fields = ['rating', 'user_ratings_total', 'photos'];
  if (phone) fields.push('formatted_phone_number');
  const url =
    'https://maps.googleapis.com/maps/api/place/details/json' +
    `?place_id=${encodeURIComponent(placeId)}` +
    `&fields=${fields.join(',')}` +
    `&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.status !== 'OK') return null;
  return placeFactsFromDetails(data.result);
}

/** Place Details for the photo id only. Null means the lookup failed and should be retried. */
async function photoReferenceForPlace(placeId, apiKey) {
  const url =
    'https://maps.googleapis.com/maps/api/place/details/json' +
    `?place_id=${encodeURIComponent(placeId)}&fields=photos&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.status !== 'OK') return null;
  return firstPhotoReference(data.result?.photos);
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
 * Null means the request failed and should be retried.
 */
async function searchPhotoOnce(record, apiKey) {
  const name = String(record?.name || '').trim();
  if (!name) return { photo_reference: '', place_id: '' };
  const lat = Number(record?.lat);
  const lng = Number(record?.lng);
  const body = { textQuery: name, pageSize: 5 };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    body.locationBias = {
      circle: { center: { latitude: lat, longitude: lng }, radius: 20000 },
    };
  }
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.photos',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) return null;
  const candidates = (data.places || []).map((place) => ({
    name: place.displayName?.text || '',
    photo_reference: firstPhotoReference(place.photos),
    place_id: String(place.id || '').replace(/^places\//, ''),
    lat: place.location?.latitude,
    lng: place.location?.longitude,
  }));
  const best = choosePhotoCandidate(name, candidates, { lat, lng });
  if (!best) return { photo_reference: '', place_id: '' };
  return { photo_reference: best.photo_reference, place_id: best.place_id };
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

async function fetchPendingCatalogRows(env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/course_catalog` +
      `?select=slug,name,photo_storage_url` +
      `&photo_storage_url=is.null` +
      `&photos_fetched_at=is.null` +
      `&order=created_at.asc&limit=${BATCH_SIZE}`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return [];
  return res.json();
}

async function fetchCoursesMissingPhotos(env) {
  const rows = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/course_catalog?select=slug,name,photos_fetched_at&photo_storage_url=is.null&order=slug`,
      { headers: { ...sbHeaders(env), Range: `${from}-${from + 999}` } },
    );
    if (!res.ok) break;
    const batch = await res.json().catch(() => []);
    if (!Array.isArray(batch) || batch.length === 0) break;
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

async function enrichOne(env, row, { alreadyLookedUp = false } = {}) {
  let record = (await fetchRegistryRecord(env, row.slug)) || {};
  if (!record.name && row.name) record = { ...record, name: row.name };
  const stamp = new Date().toISOString();
  let photoRef = String(record.photo_reference || '').trim();
  if (!photoRef && !alreadyLookedUp) {
    if (record.google_place_id) {
      const lookedUp = await photoReferenceForPlace(record.google_place_id, env.GOOGLE_PLACES_KEY);
      if (lookedUp == null) return 'retry';
      photoRef = lookedUp;
      if (photoRef) {
        record = { ...record, photo_reference: photoRef };
        await patchRegistryRecord(env, row.slug, record);
      }
    } else {
      const found = await searchPhotoOnce(record, env.GOOGLE_PLACES_KEY);
      if (found == null) return 'retry';
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
    await patchCatalog(env, row.slug, { photos_fetched_at: stamp });
    return 'none';
  }

  const photoRes = await fetch(photoMediaUrl(photoRef, env.GOOGLE_PLACES_KEY));
  if (!photoRes.ok) return 'retry';
  const photoBuffer = await photoRes.arrayBuffer();
  const type = photoRes.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) return 'retry';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const storagePath = `${row.slug}.${ext}`;
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
  if (!uploadRes.ok) return 'retry';

  await patchCatalog(env, row.slug, {
    photo_storage_path: storagePath,
    photo_storage_url: `${env.SUPABASE_URL}/storage/v1/object/public/course-photos/${storagePath}`,
    photos_fetched_at: stamp,
  });
  return 'copied';
}

async function catalogPhotoUrl(env, slug) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/course_catalog?slug=eq.${encodeURIComponent(slug)}&select=photo_storage_url`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return '';
  const rows = await res.json().catch(() => []);
  return rows?.[0]?.photo_storage_url || '';
}

/** Saves the Google rating, review count, phone, and photo once. Skips anything already stored. */
export async function savePlaceSnapshot(env, slug, record) {
  if (!env.GOOGLE_PLACES_KEY || !env.SUPABASE_SERVICE_KEY || !record) return record;
  const next = { ...record };
  const needsPhotoRef = !String(next.photo_reference || '').trim();
  const needsRating = Boolean(next.google_place_id) && (next.rating == null || next.review_count == null);
  const needsPhone = Boolean(next.google_place_id) && !String(next.phone_number || '').trim();
  let alreadyLookedUp = !needsPhotoRef;
  if (next.google_place_id && (needsRating || needsPhotoRef || needsPhone)) {
    const facts = await placeFactsForPlace(next.google_place_id, env.GOOGLE_PLACES_KEY, { phone: needsPhone });
    if (!facts) return next;
    alreadyLookedUp = true;
    if (needsRating && facts.rating != null) next.rating = facts.rating;
    if (needsRating && facts.review_count != null) next.review_count = facts.review_count;
    if (needsPhotoRef && facts.photo_reference) next.photo_reference = facts.photo_reference;
    if (needsPhone && facts.phone) next.phone_number = facts.phone;
    await patchRegistryRecord(env, slug, next);
  }
  if (!(await catalogPhotoUrl(env, slug))) {
    await enrichOne(env, { slug, name: next.name }, { alreadyLookedUp });
  }
  return next;
}

/**
 * One lookup each for courses that were saved before a photo id was kept.
 * A stored photo id is only downloaded. Anything else gets one name search,
 * then the result is stored so it is not searched again.
 */
export async function fillMissingCoursePhotos(env) {
  if (!env.GOOGLE_PLACES_KEY || !env.SUPABASE_SERVICE_KEY) {
    return { error: 'photos_not_configured' };
  }
  const rows = await fetchCoursesMissingPhotos(env);
  const counts = { checked: rows.length, filled: 0, none: 0, failed: 0 };
  const filled = [];
  for (const row of rows) {
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
      if (!String(record.photo_reference || '').trim()) {
        const found = await searchPhotoOnce(record, env.GOOGLE_PLACES_KEY);
        if (found == null) {
          counts.failed += 1;
          await sleep(200);
          continue;
        }
        const next = { ...record };
        if (found.photo_reference) next.photo_reference = found.photo_reference;
        if (!next.google_place_id && found.place_id) next.google_place_id = found.place_id;
        if (next.photo_reference !== record.photo_reference || next.google_place_id !== record.google_place_id) {
          await patchRegistryRecord(env, row.slug, next);
        }
      }
      const outcome = await enrichOne(env, row, { alreadyLookedUp: true });
      if (outcome === 'copied') {
        counts.filled += 1;
        filled.push(row.name || row.slug);
      } else if (outcome === 'none') {
        counts.none += 1;
      } else {
        counts.failed += 1;
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
    try {
      await enrichOne(env, row);
    } catch {
      // Leave photos_fetched_at untouched so this row is retried next tick.
    }
    await sleep(300);
  }
}
