/**
 * Copies a course photo we already know about into Supabase Storage.
 * Does not search Google by name. A course with no stored photo reference
 * or place id is stamped and left alone so this job does not bill Places
 * on every tick. RETRY_COOLDOWN_MS retries a failed copy after 30 days.
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

/** Place Details for the photo id only. Skips phone, website, and reviews. */
async function photoReferenceForPlace(placeId, apiKey) {
  const url =
    'https://maps.googleapis.com/maps/api/place/details/json' +
    `?place_id=${encodeURIComponent(placeId)}&fields=photo&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.status !== 'OK') return '';
  return data.result?.photos?.[0]?.photo_reference || '';
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
  const stamp = new Date().toISOString();
  let photoRef = String(record.photo_reference || '').trim();
  if (!photoRef && record.google_place_id) {
    photoRef = await photoReferenceForPlace(record.google_place_id, env.GOOGLE_PLACES_KEY);
    if (photoRef) await patchRegistryRecord(env, row.slug, { ...record, photo_reference: photoRef });
  }
  if (!photoRef) {
    await patchCatalog(env, row.slug, { photos_fetched_at: stamp });
    return;
  }

  const catalogUpdates = {};

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
