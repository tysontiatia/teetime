/**
 * State discovery shared by the CLI and the admin panel.
 * OpenStreetMap lists the courses. The live registry decides which are new.
 * Google and the booking crawler run only for courses that are not already listed.
 */

import {
  applyVendorEnrichment,
  crawlBookingSite,
  teeItUpFacilityIdFromHtml,
  looksBlocked,
  outcomeFromCrawl,
  shouldImport,
  toImportRecord,
} from './bookingDiscovery.js';
import {
  courseNameMatchTokens,
  courseNamesLikelyDuplicate,
  enrichChronogolfFromPage,
  enrichForeUpFromPage,
  locationsCompatibleForImport,
} from './courseAdmin.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// south, west, north, east. Used when the state outline service is down.
const STATE_BBOX = {
  AL: [30.14, -88.48, 35.01, -84.89], AK: [51.2, -179.15, 71.4, -129.98],
  AZ: [31.33, -114.82, 37.0, -109.04], AR: [33.0, -94.62, 36.5, -89.64],
  CA: [32.53, -124.48, 42.01, -114.13], CO: [36.99, -109.06, 41.0, -102.04],
  CT: [40.95, -73.73, 42.05, -71.79], DE: [38.45, -75.79, 39.84, -75.05],
  DC: [38.79, -77.12, 38.99, -76.91], FL: [24.4, -87.63, 31.0, -80.03],
  GA: [30.36, -85.61, 35.0, -80.84], HI: [18.91, -160.25, 22.24, -154.81],
  ID: [41.99, -117.24, 49.0, -111.04], IL: [36.97, -91.51, 42.51, -87.02],
  IN: [37.77, -88.1, 41.76, -84.78], IA: [40.38, -96.64, 43.5, -90.14],
  KS: [36.99, -102.05, 40.0, -94.59], KY: [36.5, -89.57, 39.15, -81.96],
  LA: [28.93, -94.04, 33.02, -88.82], ME: [43.06, -71.08, 47.46, -66.95],
  MD: [37.91, -79.49, 39.72, -75.05], MA: [41.24, -73.51, 42.89, -69.93],
  MI: [41.7, -90.42, 48.31, -82.41], MN: [43.5, -97.24, 49.38, -89.49],
  MS: [30.17, -91.66, 35.0, -88.1], MO: [35.99, -95.77, 40.61, -89.1],
  MT: [44.36, -116.05, 49.0, -104.04], NE: [40.0, -104.05, 43.0, -95.31],
  NV: [35.0, -120.01, 42.0, -114.04], NH: [42.7, -72.56, 45.31, -70.7],
  NJ: [38.93, -75.56, 41.36, -73.89], NM: [31.33, -109.05, 37.0, -103.0],
  NY: [40.5, -79.76, 45.02, -71.86], NC: [33.84, -84.32, 36.59, -75.46],
  ND: [45.94, -104.05, 49.0, -96.55], OH: [38.4, -84.82, 42.33, -80.52],
  OK: [33.62, -103.0, 37.0, -94.43], OR: [41.99, -124.57, 46.29, -116.46],
  PA: [39.72, -80.52, 42.27, -74.69], RI: [41.15, -71.86, 42.02, -71.12],
  SC: [32.05, -83.35, 35.22, -78.54], SD: [42.48, -104.06, 45.95, -96.44],
  TN: [34.98, -90.31, 36.68, -81.65], TX: [25.84, -106.65, 36.5, -93.51],
  UT: [36.99, -114.05, 42.0, -109.04], VT: [42.73, -73.44, 45.02, -71.46],
  VA: [36.54, -83.68, 39.47, -75.24], WA: [45.54, -124.85, 49.0, -116.92],
  WV: [37.2, -82.64, 40.64, -77.72], WI: [42.49, -92.89, 47.08, -86.25],
  WY: [40.99, -111.06, 45.01, -104.05],
};

export function stateFromAddress(address) {
  return /\b([A-Z]{2})[\s,]+\d{5}(?:-\d{4})?\b/.exec(String(address || ''))?.[1] || '';
}

function timezoneForState(state) {
  if (state === 'ID') return 'America/Boise';
  if (state === 'AZ') return 'America/Phoenix';
  if (state === 'NV' || state === 'CA' || state === 'OR' || state === 'WA') return 'America/Los_Angeles';
  return 'America/Denver';
}

function cityFromAddress(address) {
  const parts = String(address || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 3].replace(/\d/g, '').trim();
  return '';
}

function displayName(placeName, city) {
  const name = String(placeName || '').trim();
  const label = String(city || '').trim();
  if (!name) return label;
  if (!label) return name;
  if (new RegExp(`\\(${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*$`, 'i').test(name)) return name;
  return `${name} (${label})`;
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

function sameCourseName(candidateName, existingName) {
  const expand = (token) => (token === 'mt' ? 'mount' : token);
  const a = courseNameMatchTokens(candidateName).map(expand);
  const b = courseNameMatchTokens(existingName).map(expand);
  if (!a.length || !b.length) return null;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!shorter.every((token) => longer.includes(token))) return null;
  if (shorter.length >= 2 || shorter[0].length >= 6) return 'strong';
  if (shorter[0].length >= 4) return 'weak';
  return null;
}

const STREET_WORDS = {
  e: 'east',
  w: 'west',
  n: 'north',
  s: 'south',
  rd: 'road',
  st: 'street',
  ave: 'avenue',
  blvd: 'boulevard',
  dr: 'drive',
  ln: 'lane',
  ct: 'court',
  cir: 'circle',
  hwy: 'highway',
  pkwy: 'parkway',
  pl: 'place',
  ter: 'terrace',
};

function streetLine(address) {
  const parts = String(address || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const tokens = parts[0]
    ? parts[0]
        .toLowerCase()
        .replace(/\./g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => STREET_WORDS[token] || token)
    : [];
  const number = tokens.find((token) => /^\d+$/.test(token)) || '';
  const name = tokens.filter((token) => token !== number).join(' ');
  const city = (parts[1] || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
  return { number, name, city };
}

export function matchAddressToCatalog(address, catalog, course) {
  const target = streetLine(address);
  if (!target.number || target.name.length < 5 || !Array.isArray(catalog)) return null;
  const hits = catalog.filter((existing) => {
    const other = streetLine(existing?.address);
    if (other.number !== target.number || other.name !== target.name) return false;
    if (target.city && other.city && target.city !== other.city) return false;
    return true;
  });
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  let best = hits[0];
  let bestDistance = Infinity;
  for (const hit of hits) {
    const distance = distanceKm(course?.lat, course?.lng, hit.lat, hit.lng);
    if (distance < bestDistance) {
      best = hit;
      bestDistance = distance;
    }
  }
  return best;
}

function websiteHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function matchWebsiteToCatalog(website, course, catalog) {
  const host = websiteHost(website);
  if (!host || !Array.isArray(catalog)) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const existing of catalog) {
    if (websiteHost(existing?.website) !== host) continue;
    const distance = distanceKm(course?.lat, course?.lng, existing.lat, existing.lng);
    if (distance > 2 || distance >= bestDistance) continue;
    best = existing;
    bestDistance = distance;
  }
  return best;
}

export function matchPlaceToCatalog(place, course, catalog) {
  if (!place?.name || !Array.isArray(catalog)) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const existing of catalog) {
    if (!existing?.name) continue;
    if (place.place_id && existing.google_place_id && place.place_id === existing.google_place_id) return existing;
    const strength = sameCourseName(place.name, existing.name);
    if (!strength) continue;
    const distance = Math.min(
      distanceKm(place.lat, place.lng, existing.lat, existing.lng),
      distanceKm(course?.lat, course?.lng, existing.lat, existing.lng),
    );
    const closeEnough =
      strength === 'strong'
        ? distance <= 30 ||
          locationsCompatibleForImport(
            { name: place.name, address: place.formatted_address || course?.address || '' },
            existing,
          )
        : distance <= 1;
    if (!closeEnough || distance >= bestDistance) continue;
    best = existing;
    bestDistance = distance;
  }
  return best;
}

export function matchCatalog(candidate, courses) {
  const byAddress = matchAddressToCatalog(candidate.address, courses, candidate);
  if (byAddress) return byAddress;
  const state = stateFromAddress(candidate.address) || candidate.state || '';
  for (const existing of courses) {
    if (candidate.google_place_id && existing.google_place_id && candidate.google_place_id === existing.google_place_id) {
      return existing;
    }
    const existingState = stateFromAddress(existing.address);
    if (state && existingState && state !== existingState) continue;
    const strength = sameCourseName(candidate.osm_name || candidate.name, existing.name);
    if (!strength) continue;
    const near = distanceKm(candidate.lat, candidate.lng, existing.lat, existing.lng);
    const closeEnough =
      strength === 'strong' ? near <= 30 || locationsCompatibleForImport(candidate, existing) : near <= 1;
    if (closeEnough) return existing;
  }
  return null;
}

async function fetchPage(url) {
  const started = { url, finalUrl: url, status: 0, html: '', error: null };
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    started.status = res.status;
    started.finalUrl = res.url || url;
    const type = res.headers.get('content-type') || '';
    if (!/html|xml|text\/plain/i.test(type) && type) return started;
    started.html = (await res.text()).slice(0, 1_500_000);
    started.blocked = looksBlocked(started.html, started.status);
    return started;
  } catch (err) {
    started.error = err?.name === 'TimeoutError' ? 'timeout' : err?.message || 'fetch_failed';
    return started;
  }
}

async function enrichHit(hit) {
  if (!hit?.platform) return hit;
  if (hit.platform === 'foreup') {
    const enrichment = await enrichForeUpFromPage(hit.booking_url, hit.hints?.schedule_id || '');
    return applyVendorEnrichment(hit, enrichment);
  }
  if (hit.platform === 'chronogolf' || hit.platform === 'chronogolf_slc') {
    const enrichment = await enrichChronogolfFromPage(hit.booking_url);
    return applyVendorEnrichment(hit, enrichment);
  }
  if (hit.platform === 'teeitup' && !String(hit.hints?.facility_id || '').trim()) {
    const page = await fetchPage(hit.booking_url);
    const facilityId = teeItUpFacilityIdFromHtml(page.html);
    if (facilityId) return applyVendorEnrichment(hit, { facility_id: facilityId });
  }
  return hit;
}

/** Prefer the same-site page that linked the tee sheet, such as /golf. */
function linkedCourseWebsite(start, hit) {
  const evidence = String(hit?.evidence_page || '').trim();
  if (!start) return evidence;
  if (!evidence) return start;
  try {
    const startUrl = new URL(start);
    const evidenceUrl = new URL(evidence);
    const startHost = startUrl.hostname.replace(/^www\./, '').toLowerCase();
    const evidenceHost = evidenceUrl.hostname.replace(/^www\./, '').toLowerCase();
    const path = evidenceUrl.pathname.replace(/\/+$/, '');
    if (startHost === evidenceHost && path && path !== '/') return evidenceUrl.toString();
  } catch {
    return start;
  }
  return start;
}

export async function discoverWebsite(website) {
  const crawl = await crawlBookingSite(website, fetchPage);
  const best = crawl.best ? await enrichHit(crawl.best) : outcomeFromCrawl(crawl);
  const facts = crawl.facts || {};
  return {
    ...best,
    holes: best.holes || facts.holes,
    par: facts.par,
    yardage: facts.yardage,
    editorial_note: facts.editorial_note || '',
    phone_number: facts.phone || '',
    page_text: crawl.page_text || '',
    pages_fetched: (crawl.fetched || []).map((page) => page.finalUrl || page.url),
  };
}

function normalizeWebsite(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function isNotAPlayableCourse(name, tags) {
  const golf = String(tags.golf || '').toLowerCase();
  if (['miniature', 'disc_golf', 'driving_range', 'indoor'].includes(golf)) return true;
  if (/disc golf|mini(?:ature)? golf|topgolf|simulator|indoor golf|golf lounge/i.test(name)) return true;
  if (/driving range/i.test(name) && !/golf course|golf club/i.test(name)) return true;
  return false;
}

// mail.ru is current. The public instance is often full. The French mirror
// answers quickly but its copy of the map can be months old. A 400 from one
// mirror is a rate limit or a rejected heavy query, so the next mirror is tried.
// A mirror that times out or returns a gateway error is skipped for the rest of
// the search once another mirror has answered.
const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const OVERPASS_TIMEOUT_MS = 32_000;
// A statewide box for California is large enough that Overpass returns 502/504.
// Tiles at or under this span answer in one request.
const MAX_TILE_DEGREES = 5.5;

const boundaryCache = new Map();

function ringContains(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonContains(polygon, lng, lat) {
  if (!Array.isArray(polygon?.[0]) || !ringContains(polygon[0], lng, lat)) return false;
  return polygon.slice(1).every((hole) => !ringContains(hole, lng, lat));
}

function geometryContains(geometry, lng, lat) {
  if (geometry?.type === 'Polygon') return polygonContains(geometry.coordinates, lng, lat);
  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => polygonContains(polygon, lng, lat));
  }
  return false;
}

async function fetchStateBoundary(state) {
  if (boundaryCache.has(state)) return boundaryCache.get(state);
  const fallback = STATE_BBOX[state];
  let boundary = fallback
    ? { south: fallback[0], west: fallback[1], north: fallback[2], east: fallback[3], geometry: null }
    : null;
  const name = STATE_NAMES[state];
  if (name) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
        format: 'jsonv2',
        polygon_geojson: '1',
        polygon_threshold: '0.001',
        country: 'United States',
        state: name,
      })}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'teetime-course-discovery/0.1 (golf course catalog; https://tee-time.io)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const rows = await res.json();
        const row = (rows || []).find(
          (item) => item.addresstype === 'state' && String(item.name || '').toLowerCase() === name.toLowerCase(),
        );
        const box = row?.boundingbox;
        if (row?.geojson && Array.isArray(box) && box.length === 4) {
          const area = boundsForOverpass(box[0], box[2], box[1], box[3], fallback);
          if (area) boundary = { ...area, geometry: row.geojson };
        }
      }
    } catch {
      // The box above still limits the search.
    }
  }
  if (!boundary) throw new Error(`No map outline for ${state}.`);
  if (boundary.geometry) boundaryCache.set(state, boundary);
  return boundary;
}

export function boundsForOverpass(south, west, north, east, fallback) {
  const values = [south, west, north, east].map(Number);
  const fallbackBox = Array.isArray(fallback)
    ? { south: fallback[0], west: fallback[1], north: fallback[2], east: fallback[3] }
    : null;
  if (!values.every(Number.isFinite) || values[0] >= values[2]) return fallbackBox;
  // A state that crosses the date line is reported as the whole world.
  // Padding that box past ±180 is what makes OpenStreetMap return 400.
  if (values[3] - values[1] >= 350) return fallbackBox;
  return {
    south: Math.max(-90, values[0] - 0.05),
    west: Math.max(-180, values[1] - 0.05),
    north: Math.min(90, values[2] + 0.05),
    east: Math.min(180, values[3] + 0.05),
  };
}

function searchBoxes(boundary) {
  const south = Number(boundary.south);
  const west = Number(boundary.west);
  const north = Number(boundary.north);
  const east = Number(boundary.east);
  if (![south, west, north, east].every(Number.isFinite) || south >= north) return [];
  if (west <= east) return [{ south, west, north, east }];
  return [
    { south, west, north, east: 180 },
    { south, west: -180, north, east },
  ];
}

function golfQuery(box) {
  return `[out:json][timeout:25];
nwr["leisure"="golf_course"](${box.south},${box.west},${box.north},${box.east});
out tags center;`;
}

/** Split a map box so each Overpass query stays small enough to finish. */
export function tileSearchBox(box) {
  const south = Number(box.south);
  const west = Number(box.west);
  const north = Number(box.north);
  const east = Number(box.east);
  const latSpan = north - south;
  const lngSpan = east - west;
  const latSteps = Math.max(1, Math.ceil(latSpan / MAX_TILE_DEGREES - 1e-9));
  const lngSteps = Math.max(1, Math.ceil(lngSpan / MAX_TILE_DEGREES - 1e-9));
  if (latSteps === 1 && lngSteps === 1) return [{ south, west, north, east }];
  const tiles = [];
  for (let latIndex = 0; latIndex < latSteps; latIndex += 1) {
    const tileSouth = south + (latSpan * latIndex) / latSteps;
    const tileNorth = latIndex === latSteps - 1 ? north : south + (latSpan * (latIndex + 1)) / latSteps;
    for (let lngIndex = 0; lngIndex < lngSteps; lngIndex += 1) {
      const tileWest = west + (lngSpan * lngIndex) / lngSteps;
      const tileEast = lngIndex === lngSteps - 1 ? east : west + (lngSpan * (lngIndex + 1)) / lngSteps;
      tiles.push({ south: tileSouth, west: tileWest, north: tileNorth, east: tileEast });
    }
  }
  return tiles;
}

function overpassSession() {
  return { preferred: '', failed: new Set() };
}

function overpassOrder(session) {
  const healthy = OVERPASS_ENDPOINTS.filter((endpoint) => !session.failed.has(endpoint));
  const pool = healthy.length ? healthy : OVERPASS_ENDPOINTS;
  if (session.preferred && pool.includes(session.preferred)) {
    return [session.preferred, ...pool.filter((endpoint) => endpoint !== session.preferred)];
  }
  return pool;
}

async function fetchOverpass(query, session) {
  let lastStatus = 0;
  for (const endpoint of overpassOrder(session)) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'teetime-course-discovery/0.1 (golf course catalog)',
          Accept: 'application/json',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) {
        lastStatus = res.status;
        if (endpoint !== session.preferred) session.failed.add(endpoint);
        continue;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        lastStatus = 502;
        if (endpoint !== session.preferred) session.failed.add(endpoint);
        continue;
      }
      if (data.remark || !Array.isArray(data.elements)) {
        lastStatus = 502;
        if (endpoint !== session.preferred) session.failed.add(endpoint);
        continue;
      }
      session.preferred = endpoint;
      session.failed.delete(endpoint);
      return data;
    } catch {
      lastStatus = lastStatus || 504;
      if (endpoint !== session.preferred) session.failed.add(endpoint);
    }
  }
  throw new Error(
    lastStatus
      ? `OpenStreetMap returned ${lastStatus}. Try again in a minute.`
      : 'OpenStreetMap is unavailable right now. Try again in a minute.',
  );
}

async function fetchGolfElements(box, session, depth = 0) {
  try {
    const data = await fetchOverpass(golfQuery(box), session);
    return data.elements || [];
  } catch (error) {
    const latSpan = box.north - box.south;
    const lngSpan = box.east - box.west;
    if (depth >= 2 || (latSpan < 2.5 && lngSpan < 2.5)) throw error;
    const midLat = box.south + latSpan / 2;
    const midLng = box.west + lngSpan / 2;
    const quarters = [
      { south: box.south, west: box.west, north: midLat, east: midLng },
      { south: box.south, west: midLng, north: midLat, east: box.east },
      { south: midLat, west: box.west, north: box.north, east: midLng },
      { south: midLat, west: midLng, north: box.north, east: box.east },
    ];
    const elements = [];
    for (const quarter of quarters) elements.push(...(await fetchGolfElements(quarter, session, depth + 1)));
    return elements;
  }
}

export async function fetchOsmGolfCourses(state) {
  const boundary = await fetchStateBoundary(state);
  const seen = new Set();
  const elements = [];
  const session = overpassSession();
  for (const box of searchBoxes(boundary)) {
    for (const tile of tileSearchBox(box)) {
      for (const el of await fetchGolfElements(tile, session)) {
        const key = `${el.type || 'n'}:${el.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        elements.push(el);
      }
    }
  }
  const courses = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const osmName = String(tags.name || '').trim();
    if (!osmName || isNotAPlayableCourse(osmName, tags)) continue;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (boundary.geometry && !geometryContains(boundary.geometry, lng, lat)) continue;
    const duplicate = courses.some(
      (course) =>
        courseNamesLikelyDuplicate(course.osm_name, osmName) && distanceKm(course.lat, course.lng, lat, lng) < 1,
    );
    if (duplicate) continue;
    const city = tags['addr:city'] || '';
    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
    courses.push({
      osm_name: osmName,
      name: displayName(osmName, city),
      city,
      state,
      address: [street, city, tags['addr:state'] || state, tags['addr:postcode']].filter(Boolean).join(', '),
      lat,
      lng,
      website: normalizeWebsite(tags.website || tags['contact:website'] || ''),
      phone_number: tags.phone || tags['contact:phone'] || '',
      holes: tags.holes === '9' || tags.holes === '18' ? Number(tags.holes) : undefined,
    });
  }
  return courses;
}

async function findGolfPlaceAt(lat, lng, apiKey) {
  if (!apiKey || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.primaryType,places.photos',
    },
    body: JSON.stringify({
      includedTypes: ['golf_course'],
      maxResultCount: 5,
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 1000,
        },
      },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const place of data.places || []) {
    const placeName = place.displayName?.text || '';
    if (!placeName || isNotAPlayableCourse(placeName, {})) continue;
    const placeLat = place.location?.latitude;
    const placeLng = place.location?.longitude;
    const distance = distanceKm(lat, lng, placeLat, placeLng);
    if (distance > 1 || distance >= bestDistance) continue;
    bestDistance = distance;
    best = {
      place_id: String(place.id || '').replace(/^places\//, ''),
      name: placeName,
      formatted_address: place.formattedAddress || '',
      business_status: place.businessStatus || '',
      lat: placeLat,
      lng: placeLng,
      photo_name: place.photos?.[0]?.name || '',
    };
  }
  return best;
}

async function findPlaceNear(name, lat, lng, apiKey) {
  if (!apiKey) return null;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.photos',
    },
    body: JSON.stringify({
      textQuery: name,
      pageSize: 5,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 8000,
        },
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const place of data.places || []) {
    const placeName = place.displayName?.text || '';
    if (!courseNamesLikelyDuplicate(name, placeName)) continue;
    const distance = distanceKm(lat, lng, place.location?.latitude, place.location?.longitude);
    if (distance > 15 || distance >= bestDistance) continue;
    bestDistance = distance;
    best = place;
  }
  if (!best) return null;
  return {
    place_id: String(best.id || '').replace(/^places\//, ''),
    formatted_address: best.formattedAddress || '',
    business_status: best.businessStatus || '',
    photo_name: best.photos?.[0]?.name || '',
  };
}

async function placesDetails(placeId, apiKey) {
  if (!apiKey || !placeId) return null;
  const fields = 'name,website,formatted_phone_number,formatted_address,geometry,business_status,place_id,photos';
  const url =
    'https://maps.googleapis.com/maps/api/place/details/json' +
    `?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') return null;
  return data.result || null;
}

export async function prepareStateDiscovery(state, catalog) {
  const mapped = await fetchOsmGolfCourses(state);
  const catalogHere = (catalog || []).filter((course) => stateFromAddress(course.address) === state);
  const known = [];
  const pending = [];
  for (const course of mapped) {
    const existing = matchCatalog(course, catalog || []);
    if (!existing) {
      pending.push(course);
      continue;
    }
    known.push({
      name: course.name,
      osm_name: course.osm_name,
      catalog_match: existing.name,
      lat: course.lat,
      lng: course.lng,
      website: existing.website || course.website || '',
      platform: existing.platform || null,
      booking_url: existing.booking_url || '',
      support: 'catalog_match',
      booking_status: existing.booking_status || '',
      note: 'Already on tee-time.io.',
    });
  }
  const matchedNames = new Set(known.map((course) => course.catalog_match));
  return {
    state,
    map_count: mapped.length,
    catalog_in_state: catalogHere.length,
    matched: matchedNames.size,
    known,
    missing: catalogHere.filter((course) => !matchedNames.has(course.name)).map((course) => course.name),
    pending,
  };
}

const PIN_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const pinMemory = new Map();

function pinKey(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

function pinFresh(at) {
  const time = Date.parse(at || '');
  return Number.isFinite(time) && Date.now() - time < PIN_CACHE_MS;
}

function pinHeaders(env, json = false) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

async function loadPinCache(env, key) {
  const remembered = pinMemory.get(key);
  if (remembered && pinFresh(remembered.nearby_at)) return remembered;
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/places_pin_cache?pin_key=eq.${encodeURIComponent(key)}&select=nearby,text_place,details,nearby_at,details_at`,
      { headers: pinHeaders(env) },
    );
    if (!res.ok) return null;
    const row = (await res.json())?.[0];
    if (!row || !pinFresh(row.nearby_at)) return null;
    pinMemory.set(key, row);
    return row;
  } catch {
    return null;
  }
}

async function savePinCache(env, key, patch) {
  if (!key) return;
  const next = { ...(pinMemory.get(key) || {}), ...patch, pin_key: key };
  pinMemory.set(key, next);
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_KEY) return;
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/places_pin_cache?on_conflict=pin_key`, {
      method: 'POST',
      headers: { ...pinHeaders(env, true), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        pin_key: key,
        nearby: next.nearby ?? null,
        text_place: next.text_place ?? null,
        details: next.details ?? null,
        nearby_at: next.nearby_at,
        details_at: next.details_at ?? null,
      }),
    });
  } catch {
    // The search still works when the cache table is unavailable.
  }
}

function withMapNameNote(note, mapName, googleName) {
  if (!mapName || !googleName || sameCourseName(mapName, googleName)) return note || '';
  const prefix = `Map name ${mapName}.`;
  return note ? `${prefix} ${note}` : prefix;
}

export async function inspectDiscoveredCourse(course, apiKey, catalog = [], env = null) {
  const mapName = course.osm_name || course.name;
  const key = pinKey(course.lat, course.lng);
  const cached = key ? await loadPinCache(env, key) : null;
  let place = null;
  let namedPlace = null;
  if (cached && pinFresh(cached.nearby_at)) {
    place = cached.nearby || null;
    const textPlace = cached.text_place || null;
    namedPlace =
      place ||
      (textPlace ? { ...textPlace, name: mapName, lat: course.lat, lng: course.lng } : null);
  } else {
    place = (await findGolfPlaceAt(course.lat, course.lng, apiKey)) || null;
    const textPlace = place ? null : await findPlaceNear(mapName, course.lat, course.lng, apiKey);
    namedPlace =
      place ||
      (textPlace ? { ...textPlace, name: mapName, lat: course.lat, lng: course.lng } : null);
    await savePinCache(env, key, {
      nearby: place,
      text_place: textPlace,
      nearby_at: new Date().toISOString(),
    });
  }
  const known = matchPlaceToCatalog(place, course, catalog);
  if (known) {
    return {
      osm_name: mapName,
      name: displayName(place.name, course.city || cityFromAddress(known.address || course.address)),
      address: course.address || known.address || '',
      city: course.city || '',
      state: course.state || '',
      lat: course.lat,
      lng: course.lng,
      google_place_id: place.place_id || '',
      website: known.website || course.website || '',
      phone_number: course.phone_number || '',
      catalog_match: known.name,
      source: 'openstreetmap',
      platform: known.platform || null,
      booking_url: known.booking_url || '',
      support: 'catalog_match',
      booking_status: known.booking_status || '',
      note: `Already on tee-time.io as ${known.name}.`,
      import_row: null,
    };
  }

  let phone = course.phone_number || '';
  let address = place?.formatted_address || course.address || '';
  let currentName = place?.name || mapName;
  const byNearbyAddress = matchAddressToCatalog(address, catalog, course);
  if (byNearbyAddress) {
    return {
      osm_name: mapName,
      name: displayName(currentName, course.city || cityFromAddress(byNearbyAddress.address || address)),
      address: byNearbyAddress.address || address,
      city: course.city || '',
      state: course.state || '',
      lat: course.lat,
      lng: course.lng,
      google_place_id: namedPlace?.place_id || '',
      website: byNearbyAddress.website || course.website || '',
      phone_number: phone,
      catalog_match: byNearbyAddress.name,
      source: 'openstreetmap',
      platform: byNearbyAddress.platform || null,
      booking_url: byNearbyAddress.booking_url || '',
      support: 'catalog_match',
      booking_status: byNearbyAddress.booking_status || '',
      note: `Already on tee-time.io as ${byNearbyAddress.name}.`,
      import_row: null,
    };
  }

  // Nearby Search already paid for the current name and address. Place Details
  // (phone and website) is the extra charge, so only ask for it when the map
  // site is missing or will not load.
  const mapWebsite = course.website || '';
  let website = '';
  let classified = null;
  let photoReference = namedPlace?.photo_name || '';
  if (mapWebsite) {
    const hit = await discoverWebsite(mapWebsite);
    if (hit.support !== 'fetch_failed') {
      website = linkedCourseWebsite(mapWebsite, hit);
      classified = hit;
      if (!phone && hit.phone_number) phone = hit.phone_number;
    }
  }
  const cachedDetails = cached && pinFresh(cached.details_at) ? cached.details : undefined;
  if (!website && namedPlace?.place_id) {
    let details = cachedDetails;
    if (!details) {
      details = await placesDetails(namedPlace.place_id, apiKey);
      if (details) await savePinCache(env, key, { details, details_at: new Date().toISOString() });
    }
    if (details?.name) currentName = details.name;
    if (details?.formatted_phone_number) phone = details.formatted_phone_number;
    if (details?.formatted_address) address = details.formatted_address;
    if (details?.website) website = details.website;
    const detailPhoto = details?.photos?.[0]?.photo_reference || '';
    if (detailPhoto) photoReference = detailPhoto;
    const byAddress = matchAddressToCatalog(address, catalog, course);
    if (byAddress) {
      return {
        osm_name: mapName,
        name: displayName(currentName, course.city || cityFromAddress(byAddress.address || address)),
        address: byAddress.address || address,
        city: course.city || '',
        state: course.state || '',
        lat: course.lat,
        lng: course.lng,
        google_place_id: namedPlace?.place_id || '',
        website: byAddress.website || website || course.website || '',
        phone_number: phone || course.phone_number || '',
        catalog_match: byAddress.name,
        source: 'openstreetmap',
        platform: byAddress.platform || null,
        booking_url: byAddress.booking_url || '',
        support: 'catalog_match',
        booking_status: byAddress.booking_status || '',
        note: `Already on tee-time.io as ${byAddress.name}.`,
        import_row: null,
      };
    }
    if (website) {
      const hit = await discoverWebsite(website);
      if (hit.support !== 'fetch_failed') {
        website = linkedCourseWebsite(website, hit);
        classified = hit;
        if (!phone && hit.phone_number) phone = hit.phone_number;
      }
    }
  }
  const city = course.city || cityFromAddress(address);
  const foundState = stateFromAddress(address) || course.state || '';
  const base = {
    osm_name: mapName,
    name: displayName(currentName, city),
    address,
    city,
    state: foundState,
    area: `${STATE_NAMES[foundState] || foundState}${city ? ` · ${city}` : ''}`,
    lat: course.lat,
    lng: course.lng,
    google_place_id: namedPlace?.place_id || '',
    ...(photoReference ? { photo_reference: photoReference } : {}),
    phone_number: phone,
    website,
    timezone: timezoneForState(foundState),
    catalog_match: null,
    source: 'openstreetmap',
  };
  if (course.holes === 9 || course.holes === 18) base.holes = course.holes;
  if (place?.business_status === 'CLOSED_PERMANENTLY') {
    classified = {
      ...base,
      platform: null,
      booking_url: '',
      hints: {},
      support: 'closed',
      booking_status: 'closed',
      note: 'Places marks this closed.',
    };
  } else if (!classified && !base.website) {
    classified = {
      ...base,
      platform: null,
      booking_url: '',
      hints: {},
      support: 'no_website',
      booking_status: 'pending',
      note: 'No website on the map or in Places.',
    };
  } else if (!classified) {
    classified = {
      ...base,
      platform: null,
      booking_url: '',
      hints: {},
      support: 'fetch_failed',
      booking_status: 'pending',
      note: 'Website did not load.',
    };
  } else {
    classified = { ...base, ...classified, website: base.website || classified.website };
  }
  classified.note = withMapNameNote(classified.note, mapName, currentName);
  const sameSite = matchWebsiteToCatalog(classified.website, course, catalog);
  if (sameSite) {
    classified = {
      ...classified,
      catalog_match: sameSite.name,
      support: 'catalog_match',
      platform: sameSite.platform || classified.platform || null,
      booking_url: sameSite.booking_url || classified.booking_url || '',
      booking_status: sameSite.booking_status || classified.booking_status || '',
      note: `Already on tee-time.io as ${sameSite.name}.`,
    };
  }
  const importRow = shouldImport(classified) ? toImportRecord(classified) : null;
  return { ...classified, import_row: importRow };
}
