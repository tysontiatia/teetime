import { useEffect, useMemo, useState } from 'react';
import type { WeatherPoint } from '../types';
import { formatTime12h } from '../lib/time';
import { fetchHourlyWeather, pickNearestHour } from '../lib/weather';

type Props = {
  lat?: number;
  lng?: number;
  dateYmd: string;
  highlightTimeIso?: string | null;
  compact?: boolean;
};

export function WeatherStrip({ lat, lng, dateYmd, highlightTimeIso, compact }: Props) {
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
      const h = new Date(p.timeIso).getHours();
      return h >= 6 && h <= 20;
    });
  }, [points]);

  if (lat == null || lng == null) return null;

  if (compact) {
    if (status === 'loading') return <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)' }}>Loading weather…</span>;
    if (status === 'error' || !highlight) return <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>Weather —</span>;
    return (
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.92)' }}>
        {Math.round(highlight.tempF)}° · {Math.round(highlight.windMph)} mph · {Math.round(highlight.precipProb)}%
      </span>
    );
  }

  return (
    <div
      style={{
        border: '1px solid rgba(26,46,26,0.12)',
        borderRadius: 16,
        padding: 12,
        background: 'rgba(255,255,255,0.8)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 900, letterSpacing: '-0.02em' }}>Weather (forecast)</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {status === 'loading' ? 'Loading…' : status === 'error' ? 'Unavailable' : 'Temp · Wind · Precip'}
        </div>
      </div>

      <div className="weather-scroll">
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8 }}>
          {slice.slice(0, 18).map((p) => {
            const isOn =
              highlight != null && new Date(p.timeIso).getHours() === new Date(highlight.timeIso).getHours();
            return (
              <div
                key={p.timeIso}
                style={{
                  border: '1px solid rgba(26,46,26,0.10)',
                  borderRadius: 14,
                  padding: 10,
                  background: isOn ? 'rgba(233,245,234,0.9)' : '#fff',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 950, color: isOn ? 'var(--green-2)' : 'var(--muted)' }}>
                  {formatTime12h(p.timeIso)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 950, marginTop: 2 }}>{Math.round(p.tempF)}°</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{Math.round(p.windMph)} mph</div>
                <div style={{ fontSize: 11, color: '#9a3412', fontWeight: 900, marginTop: 2 }}>{Math.round(p.precipProb)}%</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

