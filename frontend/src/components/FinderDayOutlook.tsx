import { useEffect, useState } from 'react';
import { formatDateShort } from '../lib/time';
import { fetchDayOutlook, type DayOutlook } from '../lib/weather';
import { WeatherGlyph } from './WeatherGlyph';
import { weatherKindFromPrecip } from '../lib/weatherKind';

type Props = {
  dateYmd: string;
  lat: number;
  lng: number;
  /** Short place label for accessibility (e.g. St. George, Near you). */
  regionLabel: string;
};

/** Compact day summary — glyph + high/low only; detail stays in the aria-label. */
export function FinderDayOutlook({ dateYmd, lat, lng, regionLabel }: Props) {
  const [outlook, setOutlook] = useState<DayOutlook | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOutlook(null);
    const run = () => {
      void (async () => {
        try {
          const o = await fetchDayOutlook({ lat, lng, dateYmd });
          if (!cancelled) setOutlook(o);
        } catch {
          if (!cancelled) setOutlook(null);
        }
      })();
    };
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(() => !cancelled && run(), { timeout: 2000 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const t = window.setTimeout(() => !cancelled && run(), 120);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [dateYmd, lat, lng]);

  if (!outlook) return null;

  const kind = weatherKindFromPrecip(outlook.maxPrecipProb);
  const high = Math.round(outlook.highF);
  const low = Math.round(outlook.lowF);
  const wind = Math.round(outlook.maxWindMph);
  const rain = outlook.maxPrecipProb > 0 ? Math.round(outlook.maxPrecipProb) : null;

  return (
    <div
      className={`day-outlook day-outlook--${kind}`}
      aria-label={`Weather for ${regionLabel}, ${formatDateShort(dateYmd)}: high ${high}, low ${low}, wind ${wind}${
        rain != null ? `, rain ${rain}%` : ''
      }`}
    >
      <WeatherGlyph precipProb={outlook.maxPrecipProb} className="day-outlook-glyph" />
      <span className="day-outlook-temps">
        <span className="day-outlook-high">{high}°</span>
        <span className="day-outlook-slash" aria-hidden>
          /
        </span>
        <span className="day-outlook-low">{low}°</span>
      </span>
    </div>
  );
}
