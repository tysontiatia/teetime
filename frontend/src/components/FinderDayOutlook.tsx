import { useEffect, useState } from 'react';
import { formatDateShort } from '../lib/time';
import { fetchWasatchDayOutlook } from '../lib/weather';

/** One Open-Meteo call for Salt Lake area — replaces per-card weather on the finder. */
export function FinderDayOutlook({ dateYmd }: { dateYmd: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      void (async () => {
        try {
          const o = await fetchWasatchDayOutlook(dateYmd);
          if (cancelled) return;
          const rain = o.maxPrecipProb > 0 ? ` · up to ${Math.round(o.maxPrecipProb)}% rain` : '';
          setText(
            `Wasatch area (${formatDateShort(dateYmd)}): high ${Math.round(o.highF)}° / low ${Math.round(o.lowF)}° · wind to ${Math.round(o.maxWindMph)} mph${rain}`
          );
        } catch {
          if (!cancelled) setText(null);
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
  }, [dateYmd]);

  if (!text) return null;

  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: '1px solid rgba(26,46,26,0.08)',
        fontSize: 13,
        color: 'var(--muted)',
        lineHeight: 1.45,
      }}
    >
      {text}
    </div>
  );
}
