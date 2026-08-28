import { useEffect, useState } from 'react';
import { formatDateShort } from '../lib/time';
import { fetchDayOutlook, type DayOutlook } from '../lib/weather';
import { WeatherGlyph } from './WeatherGlyph';
import { weatherKindFromPrecip, WX_RAIN_SHOW_PCT } from '../lib/weatherKind';

type Props = {
  dateYmd: string;
  lat: number;
  lng: number;
  /** Short place label for accessibility (e.g. St. George, Near you). */
  regionLabel: string;
};

/** Compact day summary — glyph + high/low; rain % only when cloud or rain. */
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
  const rainPct = Math.round(Math.max(0, Math.min(100, outlook.maxPrecipProb)));
  const showRainPct = rainPct >= WX_RAIN_SHOW_PCT;

  return (
    <div
      className={`day-outlook day-outlook--${kind}`}
      aria-label={`Weather for ${regionLabel}, ${formatDateShort(dateYmd)}: high ${high}, low ${low}, wind ${wind}${
        showRainPct ? `, rain ${rainPct}%` : ''
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
      {showRainPct ? (
        <span className="day-outlook-rain">
          <span className="day-outlook-sep" aria-hidden>
            ·
          </span>
          {rainPct}%
        </span>
      ) : null}
    </div>
  );
}
