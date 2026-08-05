import { Link } from 'react-router-dom';
import type { Course, TeeTime } from '../types';
import type { CourseRecord } from '../lib/courseRecord';
import { formatReopenedAgo, formatTime12h } from '../lib/time';
import type { InventorySource } from '../hooks/useTimesByCourseMap';
import { CoursePhoto } from './CoursePhoto';
import { CourseCardTimesSkeleton } from './CourseCardSkeleton';
import { buildBookingUrl } from '../lib/bookingUrl';
import { useCourseHourlyWeather } from '../hooks/useCourseHourlyWeather';
import { pickNearestHour } from '../lib/weather';
import { WeatherGlyph, chipWeatherLabel, weatherKindFromPrecip } from './WeatherGlyph';

function walkabilityLabel(v: CourseRecord['walkability']): string | null {
  if (!v) return null;
  if (v === 'carts only') return 'Carts only';
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function metaLine(course: Course, record: CourseRecord | undefined): string {
  const parts: string[] = [];
  if (course.city) parts.push(course.city);
  if (typeof course.distanceMi === 'number') parts.push(`${course.distanceMi.toFixed(1)} mi`);
  if (record?.par) parts.push(`Par ${record.par}`);
  const walk = record ? walkabilityLabel(record.walkability) : null;
  if (walk) parts.push(walk);
  return parts.join(' · ');
}

function PlayersIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 19c.8-3 2.8-4.5 5.5-4.5S13.7 16 14.5 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14.8 19c.5-2.2 1.8-3.3 3.7-3.3 1.5 0 2.7.7 3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function HolesIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 21V5l9 4.5L6 14" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

type Props = {
  course: Course;
  record?: CourseRecord;
  times?: TeeTime[];
  detailHref: string;
  timesPending?: boolean;
  outOfScope?: boolean;
  inventorySource?: InventorySource;
  variant?: 'inventory' | 'comingSoon';
  /** True while the finder batch is still fetching — keeps layout calm. */
  batchLoading?: boolean;
  /** Finder search date — used to enrich “Open site” booking links. */
  dateYmd?: string;
  players?: number;
  holes?: number;
  onAlert: () => void;
  onSearchAllUtah?: () => void;
  onShare?: () => void;
  shareBusy?: boolean;
  shareDisabled?: boolean;
};

export function CourseMarketplaceCard({
  course,
  record,
  times = [],
  detailHref,
  timesPending = false,
  outOfScope = false,
  inventorySource,
  variant = 'inventory',
  batchLoading = false,
  dateYmd,
  players = 2,
  holes = 18,
  onAlert,
  onSearchAllUtah,
  onShare,
  shareBusy = false,
  shareDisabled = true,
}: Props) {
  const comingSoon = variant === 'comingSoon';
  const top = times.slice(0, 4);
  const hasTimes = !comingSoon && times.length > 0;
  const hotId = top[0]?.id;
  const isLive = inventorySource === 'live';
  const priceHint = times.find((t) => typeof t.price === 'number')?.price;
  const meta = metaLine(course, record);
  // Don't dim mid-batch — wait until the full check finishes so the grid doesn't thrash.
  const isEmpty = comingSoon || (!hasTimes && !timesPending && !batchLoading);

  const weatherPoints = useCourseHourlyWeather(course.lat, course.lng, dateYmd, hasTimes);

  let badgeLabel: string;
  let showPulse = false;
  if (comingSoon) {
    badgeLabel = 'Coming soon';
  } else if (timesPending || (batchLoading && !hasTimes)) {
    badgeLabel = 'Checking…';
  } else if (hasTimes) {
    badgeLabel = `${times.length} open`;
    showPulse = isLive;
  } else if (outOfScope) {
    badgeLabel = 'Nearby only';
  } else {
    badgeLabel = 'No tee times';
  }

  const showSkeletonFooter = timesPending || (batchLoading && !hasTimes && !comingSoon);
  const openSiteHref =
    dateYmd != null
      ? buildBookingUrl(record ?? { bookingUrl: course.bookingUrl, platform: course.platform }, {
          dateYmd,
          players,
          holes,
        })
      : course.bookingUrl;

  return (
    <article className={`mp-course${isEmpty ? ' is-empty' : ''}`}>
      <div className="mp-course-media">
        <div className="mp-course-photo">
          <Link to={detailHref} className="mp-course-photo-link" aria-label={`${course.name} details`}>
            {course.photoUrl ? (
              <CoursePhoto src={course.photoUrl} height={240} style={{ height: '100%' }} />
            ) : (
              <div className="mp-photo-fallback" aria-hidden />
            )}
            <div className="mp-course-scrim">
              <div className="mp-course-scrim-main">
                <div className="course-name">{course.name}</div>
                <div className="course-meta">
                  {typeof course.rating === 'number' ? (
                    <span className="course-rating">
                      <span className="star-gold" aria-hidden>
                        ★
                      </span>{' '}
                      {course.rating.toFixed(1)}
                      {typeof course.reviewCount === 'number' ? (
                        <span> ({course.reviewCount.toLocaleString()})</span>
                      ) : null}
                    </span>
                  ) : null}
                  {typeof course.rating === 'number' && meta ? (
                    <span className="sep" aria-hidden>
                      ·
                    </span>
                  ) : null}
                  {meta || null}
                </div>
              </div>
              {typeof priceHint === 'number' ? <div className="mp-course-price">from ${priceHint}</div> : null}
            </div>
          </Link>

          <span className={`badge-live${showPulse ? ' is-live' : ''}${isEmpty ? ' is-muted' : ''}`}>
            {showPulse ? <span className="pulse" aria-hidden /> : null}
            {badgeLabel}
          </span>

          <div className="mp-course-actions">
            <button
              type="button"
              className={`mp-icon-btn${isEmpty ? ' is-emphasis' : ''}`}
              aria-label={`Tee time alerts for ${course.name}`}
              title="Tee time alerts"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onAlert();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M18 9a6 6 0 10-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9ZM10 20a2.2 2.2 0 004 0"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {!comingSoon ? (
              <button
                type="button"
                className="mp-icon-btn"
                aria-label={`Share vote link for ${course.name}`}
                title="Share times"
                disabled={shareDisabled || shareBusy}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onShare?.();
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 3v11M8.5 6.5L12 3l3.5 3.5"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M5 12v6.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V12"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ) : null}
          </div>
        </div>

        {hasTimes ? (
          <div className="tee-strip">
            {top.map((t) => {
              const bookHref =
                dateYmd != null
                  ? buildBookingUrl(record ?? { bookingUrl: course.bookingUrl, platform: course.platform }, {
                      dateYmd,
                      players,
                      holes,
                      startsAtIso: t.startsAt,
                    })
                  : null;
              const wx = weatherPoints ? pickNearestHour(weatherPoints, t.startsAt) : null;
              const wxLabel = chipWeatherLabel(wx);
              const precip = wx?.precipProb ?? 0;
              const wet = precip >= 45;
              const wxKind = weatherKindFromPrecip(precip);
              const chipClass = `tee-chip tee-chip--rich${t.id === hotId ? ' hot' : ''}${wet ? ' is-wet' : ''}`;
              const timeLabel = formatTime12h(t.startsAt);
              const chipBody = (
                <>
                  <span className="tee-chip-top">
                    <span className="t">{timeLabel}</span>
                    {wxLabel ? (
                      <span className={`tee-chip-wx tee-chip-wx--${wxKind}`}>
                        <WeatherGlyph precipProb={precip} />
                        {wxLabel}
                      </span>
                    ) : (
                      <span className="tee-chip-wx tee-chip-wx--placeholder" aria-hidden>
                        ···
                      </span>
                    )}
                  </span>
                  <span className="tee-chip-meta">
                    {typeof t.spots === 'number' ? (
                      <span className="tee-chip-meta-item" title={`${t.spots} spot${t.spots === 1 ? '' : 's'}`}>
                        <PlayersIcon />
                        {t.spots}
                      </span>
                    ) : null}
                    <span className="tee-chip-meta-item" title={`${t.holes} holes`}>
                      <HolesIcon />
                      {t.holes}
                    </span>
                  </span>
                  {t.reopenedAt ? (
                    <span className="p reopened">{formatReopenedAgo(t.reopenedAt)}</span>
                  ) : typeof t.price === 'number' ? (
                    <span className="p">${t.price}</span>
                  ) : (
                    <span className="p p-muted">—</span>
                  )}
                </>
              );
              if (bookHref) {
                return (
                  <a
                    key={t.id}
                    href={bookHref}
                    target="_blank"
                    rel="noreferrer"
                    className={chipClass}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Book ${formatTime12h(t.startsAt)} at ${course.name}`}
                  >
                    {chipBody}
                  </a>
                );
              }
              return (
                <Link
                  key={t.id}
                  to={detailHref}
                  className={chipClass}
                  onClick={(e) => e.stopPropagation()}
                >
                  {chipBody}
                </Link>
              );
            })}
            {times.length > top.length ? (
              <Link to={detailHref} className="tee-chip tee-chip--rich more" onClick={(e) => e.stopPropagation()}>
                +{times.length - top.length}
              </Link>
            ) : null}
          </div>
        ) : showSkeletonFooter ? (
          <div className="tee-strip tee-strip-skeleton" aria-hidden>
            <CourseCardTimesSkeleton />
          </div>
        ) : (
          <div className="tee-strip tee-strip-empty">
            {comingSoon ? (
              <>
                <span className="tee-empty-msg">Live tee times coming soon</span>
                <div className="tee-empty-actions">
                  <button type="button" className="tee-empty-action" onClick={onAlert}>
                    Notify me
                  </button>
                  {openSiteHref ? (
                    <a
                      className="tee-empty-action"
                      href={openSiteHref}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open site →
                    </a>
                  ) : (
                    <Link to={detailHref} className="tee-empty-action">
                      Details →
                    </Link>
                  )}
                </div>
              </>
            ) : outOfScope ? (
              <>
                <span className="tee-empty-msg">Outside nearby search</span>
                <button type="button" className="tee-empty-action" onClick={onSearchAllUtah}>
                  Search all Utah
                </button>
              </>
            ) : (
              <>
                <span className="tee-empty-msg">No tee times for these filters</span>
                <button type="button" className="tee-empty-action" onClick={onAlert}>
                  Notify me
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
