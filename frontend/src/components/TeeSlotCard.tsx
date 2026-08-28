import type { MouseEvent } from 'react';
import { formatReopenedAgo, formatTime12h } from '../lib/time';
import { pickNearestHour } from '../lib/weather';
import { slotWeatherBits, weatherKindFromPrecip, WX_RAIN_SHOW_PCT } from '../lib/weatherKind';
import type { WeatherPoint } from '../types';
import { WeatherGlyph } from './WeatherGlyph';

function splitTime12h(label: string): { clock: string; meridiem: string } {
  const m = label.match(/^(.*)\s+(AM|PM)$/i);
  if (!m) return { clock: label, meridiem: '' };
  return { clock: m[1]!, meridiem: m[2]!.toUpperCase() };
}

export function TeeSlotCard({
  startsAt,
  timeZone,
  price,
  spots,
  holes,
  reopenedAt,
  weatherPoints,
  selected = false,
  className,
  onClick,
}: {
  startsAt: string;
  timeZone: string;
  price?: number;
  spots?: number;
  holes: 9 | 18;
  reopenedAt?: string;
  weatherPoints?: WeatherPoint[] | null;
  selected?: boolean;
  className?: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const timeLabel = formatTime12h(startsAt, timeZone);
  const { clock, meridiem } = splitTime12h(timeLabel);
  const priceLabel = typeof price === 'number' ? `$${Math.round(price)}` : null;
  const reopenLabel = reopenedAt ? formatReopenedAgo(reopenedAt) : null;
  const wx = weatherPoints ? pickNearestHour(weatherPoints, startsAt) : null;
  const wxBits = slotWeatherBits(wx);
  const precip = wxBits?.rainPct ?? 0;
  const wxKind = weatherKindFromPrecip(precip);
  const showRainPct = (wxBits?.rainPct ?? 0) >= WX_RAIN_SHOW_PCT;
  const ariaLabel = [
    timeLabel,
    priceLabel,
    wxBits
      ? showRainPct
        ? `${wxBits.temp}, ${wxBits.rainPct}% rain`
        : wxBits.temp
      : null,
    reopenLabel ? `reopened ${reopenLabel}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      className={`tee-slot-card${selected ? ' is-sel' : ''}${reopenedAt ? ' is-reopened' : ''}${
        className ? ` ${className}` : ''
      }`}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <span className="tee-slot-card-top">
        <span className="tee-slot-card-time">
          <span className="tee-slot-card-clock">{clock}</span>
          {meridiem ? <span className="tee-slot-card-meridiem">{meridiem}</span> : null}
          {reopenLabel ? (
            <span className="tee-slot-card-new" title={reopenLabel}>
              New
            </span>
          ) : null}
        </span>
        {priceLabel ? (
          <span className="tee-slot-card-price">{priceLabel}</span>
        ) : (
          <span className="tee-slot-card-price is-muted">—</span>
        )}
      </span>
      {wxBits ? (
        <span className={`tee-slot-card-wx tee-slot-card-wx--${wxKind}`}>
          <WeatherGlyph precipProb={precip} />
          <span className="tee-slot-card-wx-temp">{wxBits.temp}</span>
          {showRainPct ? <span className="tee-slot-card-wx-rain">{wxBits.rainPct}%</span> : null}
        </span>
      ) : (
        <span className="tee-slot-card-wx is-empty" aria-hidden>
          &nbsp;
        </span>
      )}
      <span className="tee-slot-card-meta">
        {typeof spots === 'number' ? (
          <span title={`${spots} spot${spots === 1 ? '' : 's'}`}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M3.5 19c.8-3 2.8-4.5 5.5-4.5S13.7 16 14.5 19"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            {spots}
          </span>
        ) : null}
        <span title={`${holes} holes`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 21V5l9 4.5L6 14" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
          {holes}
        </span>
      </span>
    </button>
  );
}
