import type { WeatherPoint } from '../types';

// Minimal weather adapter using Open-Meteo (no API key).
// We only need: temp, wind, precip prob (hourly) for a date.
export async function fetchHourlyWeather(params: {
  lat: number;
  lng: number;
  dateYmd: string; // YYYY-MM-DD
}): Promise<WeatherPoint[]> {
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
  const data = (await res.json()) as any;

  const time: string[] = data?.hourly?.time ?? [];
  const temp: number[] = data?.hourly?.temperature_2m ?? [];
  const wind: number[] = data?.hourly?.wind_speed_10m ?? [];
  const pop: number[] = data?.hourly?.precipitation_probability ?? [];

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

