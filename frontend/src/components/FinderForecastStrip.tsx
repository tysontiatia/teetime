import { useEffect, useMemo, useState } from 'react';
import { shiftYmd, todayYmdUtah } from '../lib/time';
import { fetchOutlookRange, type DatedOutlook } from '../lib/weather';
import { WX_RAIN_SHOW_PCT } from '../lib/weatherKind';
import { useTheme, type ResolvedTheme } from '../state/ThemeContext';
import { WeatherGlyph } from './WeatherGlyph';

const STRIP_DAYS = 5;

/** Today starts the strip. A later day keeps one earlier day in view, never before today. */
function windowStart(selected: string, today: string): string {
  if (selected <= today) return today;
  const prev = shiftYmd(selected, -1);
  return prev < today ? today : prev;
}

function weekdayOf(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString('en-US', { weekday: 'short' });
}

/** Cold to warm. Light stops stay readable on cream; dark stops stay bright on the night paper. */
const TEMP_STOPS: Record<ResolvedTheme, { t: number; c: [number, number, number] }[]> = {
  light: [
    { t: 32, c: [29, 111, 168] },
    { t: 46, c: [14, 140, 176] },
    { t: 55, c: [180, 83, 9] },
    { t: 68, c: [194, 65, 12] },
    { t: 82, c: [180, 35, 24] },
  ],
  dark: [
    { t: 32, c: [90, 200, 250] },
    { t: 46, c: [125, 180, 255] },
    { t: 55, c: [245, 197, 66] },
    { t: 68, c: [255, 159, 10] },
    { t: 82, c: [255, 69, 58] },
  ],
};

function tempColor(f: number, theme: ResolvedTheme): string {
  const stops = TEMP_STOPS[theme];
  const clamped = Math.min(stops[stops.length - 1]!.t, Math.max(stops[0]!.t, f));
  let i = 0;
  while (i < stops.length - 1 && clamped > stops[i + 1]!.t) i += 1;
  const a = stops[i]!;
  const b = stops[Math.min(i + 1, stops.length - 1)]!;
  const t = a.t === b.t ? 0 : (clamped - a.t) / (b.t - a.t);
  const mix = a.c.map((channel, n) => Math.round(channel + (b.c[n]! - channel) * t));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

function RangeCapsule({
  low,
  high,
  weekMin,
  weekMax,
  theme,
}: {
  low: number;
  high: number;
  weekMin: number;
  weekMax: number;
  theme: ResolvedTheme;
}) {
  const span = weekMax - weekMin;
  const left = span < 1 ? 0 : ((low - weekMin) / span) * 100;
  const width = span < 1 ? 100 : Math.max(14, ((high - low) / span) * 100);
  const clampedWidth = Math.min(width, 100 - left);
  return (
    <span className="finder-forecast-track" aria-hidden>
      <span
        className="finder-forecast-fill"
        style={{
          left: `${left}%`,
          width: `${clampedWidth}%`,
          background: `linear-gradient(90deg, ${tempColor(low, theme)}, ${tempColor(high, theme)})`,
        }}
      />
    </span>
  );
}

export function FinderForecastStrip({
  dateYmd,
  lat,
  lng,
  onSelect,
}: {
  dateYmd: string;
  lat: number;
  lng: number;
  onSelect: (ymd: string) => void;
}) {
  const { resolved: theme } = useTheme();
  const today = todayYmdUtah();
  const days = useMemo(() => {
    const start = windowStart(dateYmd, today);
    return Array.from({ length: STRIP_DAYS }, (_, i) => shiftYmd(start, i));
  }, [dateYmd, today]);
  const startYmd = days[0]!;
  const endYmd = days[days.length - 1]!;

  const [rows, setRows] = useState<Record<string, DatedOutlook> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    fetchOutlookRange({ lat, lng, startYmd, endYmd })
      .then((list) => {
        if (cancelled) return;
        const map: Record<string, DatedOutlook> = {};
        for (const row of list) map[row.dateYmd] = row;
        setRows(map);
      })
      .catch(() => {
        if (!cancelled) setRows({});
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, startYmd, endYmd]);

  const loaded = days.map((ymd) => rows?.[ymd]).filter((row): row is DatedOutlook => Boolean(row));
  const weekMin = loaded.length ? Math.min(...loaded.map((row) => row.lowF)) : 0;
  const weekMax = loaded.length ? Math.max(...loaded.map((row) => row.highF)) : 0;

  return (
    <div className="finder-forecast" role="group" aria-label="Choose a day">
      {days.map((ymd) => {
        const row = rows?.[ymd];
        const selected = ymd === dateYmd;
        const label = ymd === today ? 'Today' : weekdayOf(ymd);
        const rain = row ? Math.round(row.maxPrecipProb) : null;
        const wet = rain != null && rain >= WX_RAIN_SHOW_PCT;
        const high = row ? Math.round(row.highF) : null;
        const low = row ? Math.round(row.lowF) : null;
        return (
          <button
            key={ymd}
            type="button"
            className={`finder-forecast-day${selected ? ' is-selected' : ''}`}
            aria-pressed={selected}
            aria-label={
              row
                ? `${label}, high ${high}°, low ${low}°${wet ? `, ${rain}% rain` : ''}`
                : label
            }
            onClick={() => onSelect(ymd)}
          >
            <span className="finder-forecast-when">{label}</span>
            {row ? (
              <>
                <span className="finder-forecast-icon">
                  <WeatherGlyph precipProb={row.maxPrecipProb} />
                  {wet ? <span className="finder-forecast-rain">{rain}%</span> : null}
                </span>
                <span className="finder-forecast-temp">{high}°</span>
                <RangeCapsule low={row.lowF} high={row.highF} weekMin={weekMin} weekMax={weekMax} theme={theme} />
                <span className="finder-forecast-low">{low}°</span>
              </>
            ) : (
              <span className="finder-forecast-pending" aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  );
}
