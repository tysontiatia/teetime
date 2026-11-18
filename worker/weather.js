/**
 * Hourly forecast for a course day. Open-Meteo is the usual source. When that
 * host does not answer, the US National Weather Service fills in.
 */

const NWS_HEADERS = {
  'User-Agent': 'Tee-Time/1.0 (https://tee-time.io)',
  Accept: 'application/geo+json',
};

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function wallTimeToIso(wall, utcOffsetSeconds) {
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall) ? `${wall}:00` : wall;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(normalized)) return null;
  const clock = normalized.slice(0, 19);
  if (utcOffsetSeconds != null) {
    const asUtc = Date.parse(`${clock}Z`);
    if (!Number.isFinite(asUtc)) return null;
    return new Date(asUtc - utcOffsetSeconds * 1000).toISOString();
  }
  const parsed = Date.parse(clock);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function pointsFromOpenMeteo(data) {
  const offset = typeof data?.utc_offset_seconds === 'number' ? data.utc_offset_seconds : null;
  const time = data?.hourly?.time ?? [];
  const temp = data?.hourly?.temperature_2m ?? [];
  const wind = data?.hourly?.wind_speed_10m ?? [];
  const pop = data?.hourly?.precipitation_probability ?? [];
  const points = [];
  for (let i = 0; i < time.length; i++) {
    const timeIso = wallTimeToIso(time[i] ?? '', offset);
    const tempF = typeof temp[i] === 'number' ? temp[i] : Number.NaN;
    if (!timeIso || !Number.isFinite(tempF)) continue;
    points.push({
      timeIso,
      tempF,
      windMph: typeof wind[i] === 'number' ? wind[i] : 0,
      precipProb: typeof pop[i] === 'number' ? pop[i] : 0,
    });
  }
  return points;
}

export function pointsFromNwsPeriods(periods, dateYmd) {
  if (!Array.isArray(periods)) return [];
  const points = [];
  for (const period of periods) {
    const start = typeof period?.startTime === 'string' ? period.startTime : '';
    if (!start.startsWith(dateYmd)) continue;
    const temp = Number(period.temperature);
    if (!Number.isFinite(temp)) continue;
    const tempF = period.temperatureUnit === 'C' ? (temp * 9) / 5 + 32 : temp;
    const windMatch = String(period.windSpeed || '').match(/\d+/);
    const precip = Number(period.probabilityOfPrecipitation?.value);
    const instant = new Date(start);
    if (Number.isNaN(instant.getTime())) continue;
    points.push({
      timeIso: instant.toISOString(),
      tempF,
      windMph: windMatch ? Number(windMatch[0]) : 0,
      precipProb: Number.isFinite(precip) ? precip : 0,
    });
  }
  return points;
}

async function openMeteoPoints(lat, lng, dateYmd) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('start_date', dateYmd);
  url.searchParams.set('end_date', dateYmd);
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,wind_speed_10m');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');
  const res = await fetch(url, { signal: timeoutSignal(3500) });
  if (!res.ok) return [];
  return pointsFromOpenMeteo(await res.json());
}

async function nwsPoints(lat, lng, dateYmd) {
  const pointsUrl = `https://api.weather.gov/points/${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  const pointsRes = await fetch(pointsUrl, { headers: NWS_HEADERS, signal: timeoutSignal(8000) });
  if (!pointsRes.ok) return [];
  const pointsBody = await pointsRes.json();
  const hourlyUrl = pointsBody?.properties?.forecastHourly;
  if (!hourlyUrl) return [];
  const hourlyRes = await fetch(hourlyUrl, { headers: NWS_HEADERS, signal: timeoutSignal(8000) });
  if (!hourlyRes.ok) return [];
  const hourly = await hourlyRes.json();
  return pointsFromNwsPeriods(hourly?.properties?.periods, dateYmd);
}

function firstPoints(requests) {
  return new Promise((resolve) => {
    let pending = requests.length;
    if (pending === 0) {
      resolve([]);
      return;
    }
    for (const request of requests) {
      request.then(
        (points) => {
          if (points?.length) {
            resolve(points);
            return;
          }
          pending -= 1;
          if (pending === 0) resolve([]);
        },
        () => {
          pending -= 1;
          if (pending === 0) resolve([]);
        },
      );
    }
  });
}

export async function courseWeatherPoints({ lat, lng, date }) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  const dateYmd = String(date || '');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    return null;
  }
  const points = await firstPoints([
    openMeteoPoints(latitude, longitude, dateYmd),
    nwsPoints(latitude, longitude, dateYmd),
  ]);
  return points.length ? points : null;
}
