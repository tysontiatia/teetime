/**
 * Background maintenance: fills lat/lng + caches a Supabase Storage photo for
 * course_catalog rows that don't have one yet (fresh CSV import stubs, or any
 * course an admin saved without running "Places lookup"). Runs a small batch
 * per cron tick — see index.js scheduled() — so a large import can't blow a
 * single invocation's subrequest/time budget.
 *
 * A course with no Google Places match still gets photos_fetched_at stamped
 * so it isn't re-queried (and re-billed) every tick; RETRY_COOLDOWN_MS gives
 * it an occasional second chance in case the listing shows up later.
 */

const BATCH_SIZE = 10;
const RETRY_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function sbHeaders(env, json = false) {
  const h = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stateFromAddress(address) {
  return /\b([A-Z]{2})[\s,]+\d{5}(?:-\d{4})?\b/.exec(String(address || ''))?.[1] || '';
}

async function findPlace(name, lat, lng, apiKey, state) {
  const query = [name, 'golf course', state].filter(Boolean).join(' ');
  let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url += `&location=${lat},${lng}&radius=8000`;
  }
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) return null;
  return data.results[0];
}

async function fetchPendingCatalogRows(env) {
  const cutoff = new Date(Date.now() - RETRY_COOLDOWN_MS).toISOString();
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/course_catalog` +
      `?select=slug,name,lat,lng,photo_storage_url` +
      `&photo_storage_url=is.null` +
      `&or=(photos_fetched_at.is.null,photos_fetched_at.lt.${cutoff})` +
      `&order=created_at.asc&limit=${BATCH_SIZE}`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return [];
  return res.json();
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

async function enrichOne(env, row) {
  const record = (await fetchRegistryRecord(env, row.slug)) || {};
  let lat = Number.isFinite(row.lat) ? row.lat : record.lat;
  let lng = Number.isFinite(row.lng) ? row.lng : record.lng;

  const place = await findPlace(row.name, lat, lng, env.GOOGLE_PLACES_KEY, stateFromAddress(record.address));
  const stamp = new Date().toISOString();

  if (!place) {
    await patchCatalog(env, row.slug, { photos_fetched_at: stamp });
    return;
  }

  const placeLat = place.geometry?.location?.lat;
  const placeLng = place.geometry?.location?.lng;
  if (!Number.isFinite(lat) && Number.isFinite(placeLat)) lat = placeLat;
  if (!Number.isFinite(lng) && Number.isFinite(placeLng)) lng = placeLng;

  const nextRecord = { ...record };
  const photoRef = place.photos?.[0]?.photo_reference;
  if (photoRef) nextRecord.photo_reference = photoRef;
  if (place.rating != null) nextRecord.rating = place.rating;
  if (place.user_ratings_total != null) nextRecord.review_count = place.user_ratings_total;
  if (place.website && !nextRecord.website) nextRecord.website = place.website;
  if (place.formatted_phone_number && !nextRecord.phone_number) nextRecord.phone_number = place.formatted_phone_number;
  if (place.place_id && !nextRecord.google_place_id) nextRecord.google_place_id = place.place_id;
  if (place.formatted_address && !nextRecord.address) nextRecord.address = place.formatted_address;
  if (Number.isFinite(lat)) nextRecord.lat = lat;
  if (Number.isFinite(lng)) nextRecord.lng = lng;
  await patchRegistryRecord(env, row.slug, nextRecord);

  const catalogUpdates = {};
  if (Number.isFinite(lat)) catalogUpdates.lat = lat;
  if (Number.isFinite(lng)) catalogUpdates.lng = lng;

  if (!photoRef) {
    catalogUpdates.photos_fetched_at = stamp;
    await patchCatalog(env, row.slug, catalogUpdates);
    return;
  }

  const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${env.GOOGLE_PLACES_KEY}`;
  const photoRes = await fetch(photoUrl);
  if (!photoRes.ok) {
    catalogUpdates.photos_fetched_at = stamp;
    await patchCatalog(env, row.slug, catalogUpdates);
    return;
  }
  const photoBuffer = await photoRes.arrayBuffer();

  const storagePath = `${row.slug}.jpg`;
  const uploadRes = await fetch(`${env.SUPABASE_URL}/storage/v1/object/course-photos/${storagePath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'image/jpeg' },
    body: photoBuffer,
  });
  if (!uploadRes.ok) {
    catalogUpdates.photos_fetched_at = stamp;
    await patchCatalog(env, row.slug, catalogUpdates);
    return;
  }

  catalogUpdates.photo_storage_path = storagePath;
  catalogUpdates.photo_storage_url = `${env.SUPABASE_URL}/storage/v1/object/public/course-photos/${storagePath}`;
  catalogUpdates.photos_fetched_at = stamp;
  await patchCatalog(env, row.slug, catalogUpdates);
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
