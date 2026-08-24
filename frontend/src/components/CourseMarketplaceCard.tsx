import { Link } from 'react-router-dom';
import type { Course, TeeTime } from '../types';
import type { CourseRecord } from '../lib/courseRecord';
import { formatReopenedAgo, formatTime12h } from '../lib/time';
import { courseTimezone } from '../lib/teeTimeInstant';
import type { InventorySource } from '../hooks/useTimesByCourseMap';
import type { HolesFilter } from '../lib/holesFilter';
import { CoursePhoto } from './CoursePhoto';
import { CourseCardTimesSkeleton } from './CourseCardSkeleton';
import { buildBookingUrl } from '../lib/bookingUrl';
import { formatCityState } from '../lib/courseRecord';
import { AlertsIcon, PlanIcon } from './icons/AppIcons';

/** Location meta — rating is shown separately as a muted trust signal. */
function metaLine(course: Course): string {
  const parts: string[] = [];
  const place = formatCityState(course.city, course.state);
  if (place) parts.push(place);
  if (typeof course.distanceMi === 'number') parts.push(`${course.distanceMi.toFixed(1)} mi`);
  return parts.join(' · ');
}

function RatingMark({ rating }: { rating: number }) {
  return (
    <span className="course-rating course-rating--muted">
      <span className="star-gold" aria-hidden>
        ★
      </span>{' '}
      {rating.toFixed(1)}
    </span>
  );
}

/** Tee-sheet style: two player silhouettes. */
function PlayersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="7.5" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M4.2 19c.7-3.1 2.7-4.6 4.8-4.6s4.1 1.5 4.8 4.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="16.2" cy="8.2" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M13.4 19c.5-2.3 1.8-3.4 3.5-3.4 1.4 0 2.5.7 3.2 2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Tee-sheet style: flagstick in a cup. */
function HolesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 20.5V4.5l10 4.2L7 13" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <ellipse cx="7" cy="20.5" rx="3.2" ry="1.2" stroke="currentColor" strokeWidth="1.5" />
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
  /** `bookingLink` = vendor site deep-link; `phone` = call / in-person only. */
  variant?: 'inventory' | 'bookingLink' | 'phone';
  /** Finder search date — used to enrich booking deep links. */
  dateYmd?: string;
  players?: number;
  holes?: HolesFilter;
  onAlert?: () => void;
  onSearchAllUtah?: () => void;
  onShare?: () => void;
  shareBusy?: boolean;
  shareDisabled?: boolean;
  /** Opens Book / Share instead of jumping straight to the vendor URL. */
  onSelectTime?: (time: TeeTime, bookHref: string | null) => void;
};

function telHref(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits ? `tel:${digits}` : null;
}

function websiteHref(url: string | undefined | null): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

export function CourseMarketplaceCard({
  course,
  record,
  times = [],
  detailHref,
  timesPending = false,
  outOfScope = false,
  variant = 'inventory',
  dateYmd,
  players = 2,
  holes = 18,
  onAlert,
  onSearchAllUtah,
  onShare,
  shareBusy = false,
  shareDisabled = true,
  onSelectTime,
}: Props) {
  const bookingLinkOnly = variant === 'bookingLink';
  const phoneOnly = variant === 'phone';
  const noLiveInventory = bookingLinkOnly || phoneOnly;
  const top = times.slice(0, 5);
  const hasTimes = !noLiveInventory && times.length > 0;
  const hotId = top[0]?.id;
  const meta = metaLine(course);
  const hasRating = typeof course.rating === 'number';
  const tz = courseTimezone(record?.timezone ?? course.timezone);
  // Grey the card only for live inventory with zero matching times — phone / booking-link
  // courses stay full-color (still bookable another way).
  const isNoMatches = !noLiveInventory && !hasTimes && !timesPending && !outOfScope;
  const moreCount = times.length > top.length ? times.length - top.length : 0;

  let badgeLabel: string;
  if (phoneOnly) {
    badgeLabel = 'Call to book';
  } else if (bookingLinkOnly) {
    badgeLabel = 'Book on site';
  } else if (timesPending) {
    badgeLabel = 'Checking';
  } else if (hasTimes) {
    badgeLabel = `${times.length} open`;
  } else if (outOfScope) {
    badgeLabel = 'Nearby only';
  } else {
    badgeLabel = 'No matches';
  }

  // Skeleton only while pending with no times yet — keep chips painted on refresh.
  const showSkeletonFooter = !noLiveInventory && timesPending && !hasTimes;
  const openSiteHref =
    dateYmd != null
      ? buildBookingUrl(record ?? { bookingUrl: course.bookingUrl, platform: course.platform, timezone: course.timezone }, {
          dateYmd,
          players,
          holes: holes === 9 ? 9 : 18,
        })
      : course.bookingUrl;
  const callHref = telHref(record?.phone_number);
  const siteHref = websiteHref(record?.website);

  return (
    <article className={`mp-course${isNoMatches ? ' is-empty' : ''}`}>
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
                {hasRating || meta ? (
                  <div className="course-meta">
                    {hasRating ? <RatingMark rating={course.rating!} /> : null}
                    {hasRating && meta ? (
                      <span className="sep" aria-hidden>
                        ·
                      </span>
                    ) : null}
                    {meta || null}
                  </div>
                ) : null}
              </div>
            </div>
          </Link>

          <span
            className={`badge-live${!hasTimes ? ' is-muted' : ''}${
              isNoMatches ? ' is-soldout' : ''
            }${timesPending ? ' is-pending' : ''}`}
            aria-label={timesPending ? 'Checking tee times' : undefined}
          >
            {badgeLabel}
          </span>

          <div className="mp-course-actions">
            {!noLiveInventory && onAlert ? (
              <button
                type="button"
                className={`mp-icon-btn${isNoMatches ? ' is-emphasis' : ''}`}
                aria-label={`Tee time alerts for ${course.name}`}
                title="Alerts"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAlert();
                }}
              >
                <AlertsIcon />
              </button>
            ) : null}
            {!noLiveInventory ? (
              <button
                type="button"
                className="mp-icon-btn mp-icon-btn--share"
                aria-label={`Plan a round at ${course.name}`}
                title="Plan a round"
                disabled={shareDisabled || shareBusy}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onShare?.();
                }}
              >
                <PlanIcon />
              </button>
            ) : null}
          </div>
        </div>

        {hasTimes ? (
          <div
            className={`tee-strip tee-strip--discover${moreCount > 0 ? ' has-more' : ''}${
              top.length >= 4 ? ' is-dense' : ''
            }`}
          >
            {top.map((t) => {
              const bookHref =
                dateYmd != null
                  ? buildBookingUrl(record ?? { bookingUrl: course.bookingUrl, platform: course.platform, timezone: course.timezone }, {
                      dateYmd,
                      players,
                      holes: t.holes === 9 || t.holes === 18 ? t.holes : holes === 9 ? 9 : 18,
                      startsAtIso: t.startsAt,
                    })
                  : null;
              const chipClass = `tee-chip tee-chip--compact${t.id === hotId ? ' hot' : ''}${
                t.reopenedAt ? ' is-reopened' : ''
              }`;
              const timeLabel = formatTime12h(t.startsAt, tz);
              const spots = typeof t.spots === 'number' ? t.spots : null;
              const priceLabel = typeof t.price === 'number' ? `$${Math.round(t.price)}` : null;
              const reopenLabel = t.reopenedAt ? formatReopenedAgo(t.reopenedAt) : null;
              const availParts = [
                spots != null ? `${spots} spot${spots === 1 ? '' : 's'}` : null,
                `${t.holes} holes`,
                priceLabel,
                reopenLabel,
              ].filter(Boolean);
              const availTitle = availParts.join(' · ');
              const chipBody = (
                <>
                  {reopenLabel ? (
                    <span className="tee-chip-new" title={reopenLabel}>
                      New
                    </span>
                  ) : null}
                  <span className="t">{timeLabel}</span>
                  <span className="tee-chip-sheet" title={availTitle || undefined}>
                    {spots != null ? (
                      <span className="tee-chip-sheet-item">
                        <PlayersIcon />
                        {spots}
                      </span>
                    ) : null}
                    <span className="tee-chip-sheet-item">
                      <HolesIcon />
                      {t.holes}
                    </span>
                  </span>
                  {priceLabel ? <span className="p">{priceLabel}</span> : null}
                </>
              );
              const chooseLabel = `${timeLabel} at ${course.name}${availTitle ? `, ${availTitle}` : ''}`;
              if (onSelectTime) {
                return (
                  <button
                    key={`${t.id}-${t.holes}`}
                    type="button"
                    className={chipClass}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTime(t, bookHref);
                    }}
                    aria-label={chooseLabel}
                  >
                    {chipBody}
                  </button>
                );
              }
              if (bookHref) {
                return (
                  <a
                    key={`${t.id}-${t.holes}`}
                    href={bookHref}
                    target="_blank"
                    rel="noreferrer"
                    className={chipClass}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Book ${chooseLabel}`}
                  >
                    {chipBody}
                  </a>
                );
              }
              return (
                <Link
                  key={`${t.id}-${t.holes}`}
                  to={detailHref}
                  className={chipClass}
                  onClick={(e) => e.stopPropagation()}
                >
                  {chipBody}
                </Link>
              );
            })}
            {moreCount > 0 ? (
              <Link
                to={detailHref}
                className="tee-chip tee-chip--compact more"
                onClick={(e) => e.stopPropagation()}
                aria-label={`View ${moreCount} more tee times at ${course.name}`}
                title="View all times"
              >
                +{moreCount}
              </Link>
            ) : null}
          </div>
        ) : showSkeletonFooter ? (
          <div className="tee-strip tee-strip-skeleton" aria-hidden>
            <CourseCardTimesSkeleton />
          </div>
        ) : (
          <div className="tee-strip tee-strip-empty">
            {phoneOnly ? (
              <div className="tee-empty-actions tee-empty-actions--booking">
                {callHref && record?.phone_number ? (
                  <a
                    className="tee-empty-action tee-empty-action--primary"
                    href={callHref}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Call ${course.name} pro shop at ${record.phone_number.trim()}`}
                  >
                    Call pro shop
                  </a>
                ) : (
                  <Link to={detailHref} className="tee-empty-action tee-empty-action--primary">
                    View details
                  </Link>
                )}
                {siteHref ? (
                  <a
                    className="tee-empty-action tee-empty-action--secondary"
                    href={siteHref}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Website
                  </a>
                ) : null}
              </div>
            ) : bookingLinkOnly ? (
              <div className="tee-empty-actions tee-empty-actions--booking">
                {openSiteHref ? (
                  <a
                    className="tee-empty-action tee-empty-action--primary"
                    href={openSiteHref}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Book on site
                  </a>
                ) : (
                  <Link to={detailHref} className="tee-empty-action tee-empty-action--primary">
                    View details
                  </Link>
                )}
                {callHref && record?.phone_number ? (
                  <a
                    className="tee-empty-action tee-empty-action--secondary"
                    href={callHref}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Call ${course.name} pro shop at ${record.phone_number.trim()}`}
                  >
                    Call
                  </a>
                ) : null}
              </div>
            ) : outOfScope ? (
              <>
                <span className="tee-empty-msg">Outside search radius</span>
                <button type="button" className="tee-empty-action tee-empty-action--primary" onClick={onSearchAllUtah}>
                  Try Statewide
                </button>
              </>
            ) : (
              <button type="button" className="tee-empty-action tee-empty-action--primary" onClick={onAlert}>
                <AlertsIcon size={15} strokeWidth={1.8} />
                Alert me
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
