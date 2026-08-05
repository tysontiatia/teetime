import type { WeatherPoint } from '../types';

export type WeatherKind = 'sun' | 'cloud' | 'rain';

export function weatherKindFromPrecip(precipProb: number): WeatherKind {
  if (precipProb >= 45) return 'rain';
  if (precipProb >= 20) return 'cloud';
  return 'sun';
}

export function chipWeatherLabel(point: WeatherPoint | null | undefined): string | null {
  if (!point || !Number.isFinite(point.tempF)) return null;
  return `${Math.round(point.tempF)}°`;
}
