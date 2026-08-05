import { weatherKindFromPrecip } from '../lib/weatherKind';

/** Compact sun / cloud / rain glyph for tee chips (no emoji). */
export function WeatherGlyph({
  precipProb,
  className,
}: {
  precipProb: number;
  className?: string;
}) {
  const kind = weatherKindFromPrecip(precipProb);
  const cls = ['wx-glyph', `wx-glyph--${kind}`, className].filter(Boolean).join(' ');

  if (kind === 'rain') {
    return (
      <svg className={cls} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M7 16a4.5 4.5 0 01.4-9 5.5 5.5 0 0110.4 1.8A3.8 3.8 0 0118 16H7z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M9 18.5v2M12 18v3M15 18.5v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'cloud') {
    return (
      <svg className={cls} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="9" cy="10" r="3.2" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12.5 15.5a3.6 3.6 0 10.2-7.1 4.4 4.4 0 018.2 1.5A3 3 0 0119.5 15.5h-7z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg className={cls} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.1 6.1l1.6 1.6M16.3 16.3l1.6 1.6M17.9 6.1l-1.6 1.6M7.7 16.3l-1.6 1.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
