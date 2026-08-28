import type { WeatherPoint } from '../types';

export type WeatherKind = 'sun' | 'cloud' | 'rain';

/** Rain glyph + show rain %. Below this, sun + temp is enough. */
export const WX_RAIN_SHOW_PCT = 20;

export function weatherKindFromPrecip(precipProb: number): WeatherKind {
  return precipProb >= WX_RAIN_SHOW_PCT ? 'rain' : 'sun';
}

export function chipWeatherLabel(point: WeatherPoint | null | undefined): string | null {
  if (!point || !Number.isFinite(point.tempF)) return null;
  return `${Math.round(point.tempF)}°`;
}

/** Temp + rain chance for tee tiles. Rain % is the golf-relevant number. */
export function slotWeatherBits(point: WeatherPoint | null | undefined): {
  temp: string;
  rainPct: number;
} | null {
  if (!point || !Number.isFinite(point.tempF)) return null;
  const rain = Number.isFinite(point.precipProb) ? Math.round(Math.max(0, Math.min(100, point.precipProb))) : 0;
  return { temp: `${Math.round(point.tempF)}°`, rainPct: rain };
}
