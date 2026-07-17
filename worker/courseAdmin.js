/**
 * Admin course catalog API — registry + course_catalog + course_rates writes.
 */

const PLATFORM_ID_FIELDS = {
  foreup: ['schedule_id', 'booking_class_id'],
  foreup_login: ['schedule_id', 'booking_class_id'],
  chronogolf: ['club_id', 'course_id'],
  chronogolf_slc: ['club_id', 'course_id', 'affiliation_type_id'],
  membersports: ['golf_club_id', 'golf_course_id'],
  trutee: ['trutee_org_slug', 'trutee_course_id'],
  teeitup: ['facility_id', 'teeitup_course_id', 'teeitup_alias'],
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
  'facility_id',
  'teeitup_course_id',
  'teeitup_alias',
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
    return out;
  }

  if (host.includes('tenfore')) {
    out.platform = 'tenfore';
    return out;
  }

  return out;
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
  if (scheduleId) out.booking_class_id = await pickForeUpBookingClass(html, scheduleId);
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
  return rows.map((r) => r.record).filter(Boolean);
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
  const platform = record.platform;
  if (!platform) warnings.push('No platform set — poller will not run.');
  if (platform === 'trutee' || platform === 'golfpay' || platform === 'tenfore') {
    warnings.push(`${platform} is booking-link-only today — live inventory not polled yet.`);
  }
  if (platform === 'foreup' && !record.schedule_id) {
    warnings.push('ForeUp requires schedule_id for live tee times.');
  }
  if (platform === 'chronogolf_slc' && (!record.club_id || !record.course_id || !record.affiliation_type_id)) {
    warnings.push('Chronogolf SLC needs club_id, course_id, and affiliation_type_id.');
  }
  if (platform === 'teeitup' && (!record.facility_id || !record.teeitup_course_id)) {
    warnings.push('TeeItUp needs facility_id (deep link) and teeitup_course_id (poller mapping hash).');
  }
  return warnings;
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

      if (path === '/admin/courses' && request.method === 'GET') {
        const admin = await requireAdmin(env, request);
        if (admin.error) return corsResponse({ error: admin.error }, admin.status);

        const rows = await fetchRegistryCourses(env);
        const list = rows.map((r) => {
          const rec = r.record || {};
          return {
            slug: r.slug,
            name: rec.name || r.slug,
            area: rec.area || null,
            platform: rec.platform || null,
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
