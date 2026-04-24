import type { WeatherPoint } from '../types';

const WEATHER_TTL_MS = 12 * 60 * 1000;
const weatherCache = new Map<string, { fetchedAt: number; points: WeatherPoint[] }>();
const weatherInflight = new Map<string, Promise<WeatherPoint[]>>();

function weatherCacheKey(lat: number, lng: number, dateYmd: string): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)},${dateYmd}`;
}

async function fetchHourlyWeatherUncached(params: { lat: number; lng: number; dateYmd: string }): Promise<WeatherPoint[]> {
  const { lat, lng, dateYmd } = params;

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('start_date', dateYmd);
  url.searchParams.set('end_date', dateYmd);
  url.searchParams.set('hourly', ['temperature_2m', 'precipitation_probability', 'wind_speed_10m'].join(','));
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('weather_fetch_failed');
  const data = (await res.json()) as {
    hourly?: {
      time?: string[];
      temperature_2m?: number[];
      wind_speed_10m?: number[];
      precipitation_probability?: number[];
    };
  };

  const time: string[] = data.hourly?.time ?? [];
  const temp: number[] = data.hourly?.temperature_2m ?? [];
  const wind: number[] = data.hourly?.wind_speed_10m ?? [];
  const pop: number[] = data.hourly?.precipitation_probability ?? [];

  const points: WeatherPoint[] = [];
  for (let i = 0; i < time.length; i++) {
    points.push({
      timeIso: new Date(time[i]).toISOString(),
      tempF: typeof temp[i] === 'number' ? temp[i] : Number.NaN,
      windMph: typeof wind[i] === 'number' ? wind[i] : Number.NaN,
      precipProb: typeof pop[i] === 'number' ? pop[i] : 0,
    });
  }
  return points.filter((p) => Number.isFinite(p.tempF) && Number.isFinite(p.windMph));
}

// Minimal weather adapter using Open-Meteo (no API key).
// We only need: temp, wind, precip prob (hourly) for a date.
// Cached + in-flight dedupe so the finder grid does not N× the same network work.
export async function fetchHourlyWeather(params: {
  lat: number;
  lng: number;
  dateYmd: string; // YYYY-MM-DD
}): Promise<WeatherPoint[]> {
  const key = weatherCacheKey(params.lat, params.lng, params.dateYmd);
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < WEATHER_TTL_MS) {
    return hit.points;
  }

  let req = weatherInflight.get(key);
  if (!req) {
    req = fetchHourlyWeatherUncached(params).then((points) => {
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

/** Single-day snapshot near Salt Lake (one request for the whole finder). */
export type WasatchDayOutlook = {
  highF: number;
  lowF: number;
  maxWindMph: number;
  maxPrecipProb: number;
};

const OUTLOOK_TTL_MS = WEATHER_TTL_MS;
const outlookCache = new Map<string, { fetchedAt: number; data: WasatchDayOutlook }>();
const outlookInflight = new Map<string, Promise<WasatchDayOutlook>>();

const WASATCH_LAT = 40.7608;
const WASATCH_LNG = -111.891;

async function fetchWasatchDayOutlookUncached(dateYmd: string): Promise<WasatchDayOutlook> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(WASATCH_LAT));
  url.searchParams.set('longitude', String(WASATCH_LNG));
  url.searchParams.set('timezone', 'America/Denver');
  url.searchParams.set('start_date', dateYmd);
  url.searchParams.set('end_date', dateYmd);
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,wind_speed_10m_max,precipitation_probability_max');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('outlook_fetch_failed');
  const data = (await res.json()) as {
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

export async function fetchWasatchDayOutlook(dateYmd: string): Promise<WasatchDayOutlook> {
  const hit = outlookCache.get(dateYmd);
  if (hit && Date.now() - hit.fetchedAt < OUTLOOK_TTL_MS) {
    return hit.data;
  }

  let req = outlookInflight.get(dateYmd);
  if (!req) {
    req = fetchWasatchDayOutlookUncached(dateYmd).then((data) => {
      outlookCache.set(dateYmd, { fetchedAt: Date.now(), data });
      return data;
    });
    outlookInflight.set(dateYmd, req);
  }

  try {
    return await req;
  } finally {
    outlookInflight.delete(dateYmd);
  }
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

