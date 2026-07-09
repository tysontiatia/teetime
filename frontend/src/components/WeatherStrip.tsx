import { useEffect, useMemo, useState } from 'react';
import type { WeatherPoint } from '../types';
import { formatTime12h, hourInUtah } from '../lib/time';
import { fetchHourlyWeather, pickNearestHour } from '../lib/weather';

type Props = {
  lat?: number;
  lng?: number;
  dateYmd: string;
  highlightTimeIso?: string | null;
  compact?: boolean;
  /** `onDark` = white text on photo overlay; `subtle` = one-line meta on white card (finder). */
  compactTheme?: 'onDark' | 'subtle';
};

export function WeatherStrip({ lat, lng, dateYmd, highlightTimeIso, compact, compactTheme = 'onDark' }: Props) {
  const [points, setPoints] = useState<WeatherPoint[] | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      void (async () => {
        if (lat == null || lng == null) return;
        setStatus('loading');
        try {
          const data = await fetchHourlyWeather({ lat, lng, dateYmd });
          if (cancelled) return;
          setPoints(data);
          setStatus('idle');
        } catch {
          if (cancelled) return;
          setPoints(null);
          setStatus('error');
        }
      })();
    };

    // Finder cards mount many strips — defer so tee-time fetches and first paint win.
    if (compact && typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(() => !cancelled && run(), { timeout: 2500 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    if (compact) {
      const t = window.setTimeout(() => !cancelled && run(), 400);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [compact, dateYmd, lat, lng]);

  const highlight = useMemo(() => {
    if (!points || !highlightTimeIso) return null;
    return pickNearestHour(points, highlightTimeIso);
  }, [highlightTimeIso, points]);

  const slice = useMemo(() => {
    if (!points) return [];
    // keep it simple: daytime hours for golf
    return points.filter((p) => {
      const h = hourInUtah(p.timeIso);
      return h >= 6 && h <= 20;
    });
  }, [points]);

  if (lat == null || lng == null) return null;

  if (compact) {
    const subtle = compactTheme === 'subtle';
    const loadColor = subtle ? 'var(--subtle)' : 'rgba(255,255,255,0.9)';
    const errColor = subtle ? 'var(--subtle)' : 'rgba(255,255,255,0.85)';
    const okColor = subtle ? 'var(--muted)' : 'rgba(255,255,255,0.92)';
    if (status === 'loading') return <span style={{ fontSize: 12, color: loadColor }}>…</span>;
    if (status === 'error' || !highlight) return <span style={{ fontSize: 12, color: errColor }}>—</span>;
    return (
      <span style={{ fontSize: 12, color: okColor }}>
        {Math.round(highlight.tempF)}° · {Math.round(highlight.windMph)} mph
        {!subtle ? ` · ${Math.round(highlight.precipProb)}%` : null}
      </span>
    );
  }

  if (status === 'loading') {
    return <p className="section-muted weather-status">Loading forecast…</p>;
  }
  if (status === 'error' || !slice.length) {
    return <p className="section-muted weather-status">Forecast unavailable.</p>;
  }

  return (
    <div className="weather-strip">
      <div className="weather-strip-meta">
        {highlight ? (
          <span>
            Near tee time · {Math.round(highlight.tempF)}° · {Math.round(highlight.windMph)} mph ·{' '}
            {Math.round(highlight.precipProb)}% rain
          </span>
        ) : (
          <span>Hourly forecast · temp · wind · rain chance</span>
        )}
      </div>
      <div className="weather-scroll">
        <div className="weather-hours">
          {slice.slice(0, 15).map((p) => {
            const isOn = highlight != null && hourInUtah(p.timeIso) === hourInUtah(highlight.timeIso);
            const precip = Math.round(p.precipProb);
            return (
              <div key={p.timeIso} className={`weather-hour${isOn ? ' is-on' : ''}`}>
                <span className="wh-t">{formatTime12h(p.timeIso).replace(' ', '').toLowerCase()}</span>
                <span className="wh-temp">{Math.round(p.tempF)}°</span>
                <span className="wh-wind">{Math.round(p.windMph)} mph</span>
                <span className={`wh-rain${precip >= 40 ? ' is-wet' : ''}`}>{precip}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
