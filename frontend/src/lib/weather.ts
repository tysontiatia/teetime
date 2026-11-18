import type { WeatherPoint } from '../types';
import { getWorkerBaseUrl } from './env';

const WEATHER_TTL_MS = 12 * 60 * 1000;
const weatherCache = new Map<string, { fetchedAt: number; points: WeatherPoint[] }>();
const weatherInflight = new Map<string, Promise<WeatherPoint[]>>();

const MAX_OPEN_METEO = 3;
let openMeteoInFlight = 0;
const openMeteoWaiters: Array<() => void> = [];

function weatherCacheKey(lat: number, lng: number, dateYmd: string): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)},${dateYmd}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function acquireOpenMeteo(): Promise<void> {
  if (openMeteoInFlight < MAX_OPEN_METEO) {
    openMeteoInFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    openMeteoWaiters.push(() => {
      openMeteoInFlight += 1;
      resolve();
    });
  });
}

function releaseOpenMeteo() {
  openMeteoInFlight = Math.max(0, openMeteoInFlight - 1);
  const next = openMeteoWaiters.shift();
  if (next) next();
}

function fetchSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** Queued, timed, and retried so a burst of course cards cannot drop weather on 429s or a hung radio. */
async function fetchOpenMeteo(url: URL): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await acquireOpenMeteo();
    try {
      const res = await fetch(url.toString(), { signal: fetchSignal(8000) });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new Error('weather_http');
      lastError = new Error('weather_fetch_failed');
    } catch (err) {
      if (err instanceof Error && err.message === 'weather_http') throw err;
      lastError = err;
    } finally {
      releaseOpenMeteo();
    }
    if (attempt < 2) await delay(350 * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error('weather_fetch_failed');
}

async function fetchHourlyWeatherUncached(params: { lat: number; lng: number; dateYmd: string }): Promise<WeatherPoint[]> {
  const { lat, lng, dateYmd } = params;
  const url = new URL(`${getWorkerBaseUrl()}/v1/weather`);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  url.searchParams.set('date', dateYmd);
  const data = (await fetchOpenMeteo(url)) as { points?: WeatherPoint[] };
  return Array.isArray(data?.points) ? data.points : [];
}

// Minimal weather adapter using Open-Meteo (no API key).
// We only need: temp, wind, precip prob (hourly) for a date.
// Cached + in-flight dedupe so the finder grid does not N× the same network work.
export function readHourlyWeatherCache(lat: number, lng: number, dateYmd: string): WeatherPoint[] | null {
  const hit = weatherCache.get(weatherCacheKey(lat, lng, dateYmd));
  if (!hit || hit.points.length === 0 || Date.now() - hit.fetchedAt >= WEATHER_TTL_MS) return null;
  return hit.points;
}

export async function fetchHourlyWeather(params: {
  lat: number;
  lng: number;
  dateYmd: string; // YYYY-MM-DD
}): Promise<WeatherPoint[]> {
  const key = weatherCacheKey(params.lat, params.lng, params.dateYmd);
  const cached = readHourlyWeatherCache(params.lat, params.lng, params.dateYmd);
  if (cached) return cached;

  let req = weatherInflight.get(key);
  if (!req) {
    req = fetchHourlyWeatherUncached(params).then((points) => {
      if (points.length === 0) throw new Error('weather_empty');
      weatherCache.set(key, { fetchedAt: Date.now(), points });
      return points;
    });
    weatherInflight.set(key, req);
  }

  try {
    return await req;
  } finally {
    weatherInflight.delete(key);
  }
}

/** Single-day high/low snapshot for a lat/lng (Open-Meteo). */
export type DayOutlook = {
  highF: number;
  lowF: number;
  maxWindMph: number;
  maxPrecipProb: number;
};

/** @deprecated Prefer DayOutlook — kept for older call sites. */
export type WasatchDayOutlook = DayOutlook;

const OUTLOOK_TTL_MS = WEATHER_TTL_MS;
const outlookCache = new Map<string, { fetchedAt: number; data: DayOutlook }>();
const outlookInflight = new Map<string, Promise<DayOutlook>>();

const WASATCH_LAT = 40.7608;
const WASATCH_LNG = -111.891;

function outlookCacheKey(lat: number, lng: number, dateYmd: string): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)},${dateYmd}`;
}

async function fetchDayOutlookUncached(params: {
  lat: number;
  lng: number;
  dateYmd: string;
}): Promise<DayOutlook> {
  const { lat, lng, dateYmd } = params;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('timezone', 'America/Denver');
  url.searchParams.set('start_date', dateYmd);
  url.searchParams.set('end_date', dateYmd);
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,wind_speed_10m_max,precipitation_probability_max');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');

  const data = (await fetchOpenMeteo(url)) as {
    daily?: {
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      wind_speed_10m_max?: number[];
      precipitation_probability_max?: number[];
    };
  };
  const hi = data.daily?.temperature_2m_max?.[0];
  const lo = data.daily?.temperature_2m_min?.[0];
  const wind = data.daily?.wind_speed_10m_max?.[0];
  const pop = data.daily?.precipitation_probability_max?.[0];
  if (typeof hi !== 'number' || typeof lo !== 'number') throw new Error('outlook_parse_failed');
  return {
    highF: hi,
    lowF: lo,
    maxWindMph: typeof wind === 'number' ? wind : 0,
    maxPrecipProb: typeof pop === 'number' ? pop : 0,
  };
}

export async function fetchDayOutlook(params: {
  lat: number;
  lng: number;
  dateYmd: string;
}): Promise<DayOutlook> {
  const key = outlookCacheKey(params.lat, params.lng, params.dateYmd);
  const hit = outlookCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < OUTLOOK_TTL_MS) {
    return hit.data;
  }

  let req = outlookInflight.get(key);
  if (!req) {
    req = fetchDayOutlookUncached(params).then((data) => {
      outlookCache.set(key, { fetchedAt: Date.now(), data });
      return data;
    });
    outlookInflight.set(key, req);
  }

  try {
    return await req;
  } finally {
    outlookInflight.delete(key);
  }
}

/** Salt Lake / Wasatch Front day outlook (legacy helper). */
export async function fetchWasatchDayOutlook(dateYmd: string): Promise<DayOutlook> {
  return fetchDayOutlook({ lat: WASATCH_LAT, lng: WASATCH_LNG, dateYmd });
}

export type DatedOutlook = DayOutlook & { dateYmd: string };

const rangeCache = new Map<string, { fetchedAt: number; data: DatedOutlook[] }>();
const rangeInflight = new Map<string, Promise<DatedOutlook[]>>();

function rememberOutlook(lat: number, lng: number, row: DatedOutlook) {
  outlookCache.set(outlookCacheKey(lat, lng, row.dateYmd), {
    fetchedAt: Date.now(),
    data: {
      highF: row.highF,
      lowF: row.lowF,
      maxWindMph: row.maxWindMph,
      maxPrecipProb: row.maxPrecipProb,
    },
  });
}

/** Inclusive daily outlook for a date window. One Open-Meteo request. */
export async function fetchOutlookRange(params: {
  lat: number;
  lng: number;
  startYmd: string;
  endYmd: string;
}): Promise<DatedOutlook[]> {
  const { lat, lng, startYmd, endYmd } = params;
  const key = `${lat.toFixed(3)},${lng.toFixed(3)},${startYmd},${endYmd}`;
  const hit = rangeCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < OUTLOOK_TTL_MS) return hit.data;

  let req = rangeInflight.get(key);
  if (!req) {
    req = (async () => {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', String(lat));
      url.searchParams.set('longitude', String(lng));
      url.searchParams.set('timezone', 'America/Denver');
      url.searchParams.set('start_date', startYmd);
      url.searchParams.set('end_date', endYmd);
      url.searchParams.set(
        'daily',
        'temperature_2m_max,temperature_2m_min,wind_speed_10m_max,precipitation_probability_max',
      );
      url.searchParams.set('temperature_unit', 'fahrenheit');
      url.searchParams.set('wind_speed_unit', 'mph');

      const data = (await fetchOpenMeteo(url)) as {
        daily?: {
          time?: string[];
          temperature_2m_max?: number[];
          temperature_2m_min?: number[];
          wind_speed_10m_max?: number[];
          precipitation_probability_max?: number[];
        };
      };
      const times = data.daily?.time ?? [];
      const rows: DatedOutlook[] = [];
      for (let i = 0; i < times.length; i++) {
        const hi = data.daily?.temperature_2m_max?.[i];
        const lo = data.daily?.temperature_2m_min?.[i];
        if (typeof hi !== 'number' || typeof lo !== 'number') continue;
        const wind = data.daily?.wind_speed_10m_max?.[i];
        const pop = data.daily?.precipitation_probability_max?.[i];
        const row: DatedOutlook = {
          dateYmd: times[i]!.slice(0, 10),
          highF: hi,
          lowF: lo,
          maxWindMph: typeof wind === 'number' ? wind : 0,
          maxPrecipProb: typeof pop === 'number' ? pop : 0,
        };
        rows.push(row);
        rememberOutlook(lat, lng, row);
      }
      if (!rows.length) throw new Error('outlook_parse_failed');
      rangeCache.set(key, { fetchedAt: Date.now(), data: rows });
      return rows;
    })();
    rangeInflight.set(key, req);
  }

  try {
    return await req;
  } finally {
    rangeInflight.delete(key);
  }
}

const weatherRefreshListeners = new Set<() => void>();

export function subscribeWeatherRefresh(listener: () => void): () => void {
  weatherRefreshListeners.add(listener);
  return () => {
    weatherRefreshListeners.delete(listener);
  };
}

/** Drop cached forecasts so a pull-to-refresh can retry requests that failed earlier. */
export function invalidateWeatherCaches(): void {
  weatherCache.clear();
  outlookCache.clear();
  rangeCache.clear();
  for (const listener of weatherRefreshListeners) listener();
}

export function pickNearestHour(points: WeatherPoint[], startsAtIso: string) {
  const target = new Date(startsAtIso).getTime();
  let best: WeatherPoint | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const p of points) {
    const t = new Date(p.timeIso).getTime();
    const d = Math.abs(t - target);
    if (d < bestDelta) {
      best = p;
      bestDelta = d;
    }
  }
  return best;
}

