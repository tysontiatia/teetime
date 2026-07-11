import { Link } from 'react-router-dom';
import type { FeedItem } from '../lib/feedApi';
import type { CourseRecord } from '../lib/courseRecord';
import { buildBookingUrl } from '../lib/bookingUrl';
import { coursePhotoUrl } from '../lib/coursePhotoUrl';
import { parseCourseTitle } from '../lib/courseRecord';
import { formatDateShort } from '../lib/time';
import {
  feedChipDetectedShort,
  feedDetectedLabel,
  feedTimeLabel,
  formatFeedPrice,
  isFeedHotOpening,
  isFeedWarmOpening,
} from '../lib/feedDisplay';

type Props = {
  item: FeedItem;
  record?: CourseRecord;
  minPlayers: number;
  compact?: boolean;
};

export function FeedOpeningCard({ item, record, minPlayers, compact = false }: Props) {
  const { short, city } = parseCourseTitle(item.course_name);
  const photo = record ? coursePhotoUrl(record) : undefined;
  const price = formatFeedPrice(item.price_cents);
  const courseHref = `/course/${item.course_slug}?date=${item.play_date}&players=${minPlayers}&holes=${item.holes}`;
  const bookingUrl =
    record && item.still_open
      ? buildBookingUrl(record, {
          dateYmd: item.play_date,
          players: minPlayers,
          holes: item.holes,
          startsAtIso: item.play_starts_at,
        })
      : null;

  const hot = isFeedHotOpening(item);
  const warm = !hot && isFeedWarmOpening(item);
  const detectedShort = feedChipDetectedShort(item);

  if (compact) {
    const badgeKind = hot ? 'live' : warm ? 'recent' : item.event_type;
    const badgeLabel = hot ? 'Live' : warm ? 'Recent' : item.event_type === 'reopened' ? 'Reopened' : 'New';

    return (
      <Link
        to={courseHref}
        className={`feed-teaser-chip${hot ? ' feed-teaser-chip--hot' : ''}${warm ? ' feed-teaser-chip--warm' : ''}`}
      >
        <span className={`feed-teaser-chip-badge feed-teaser-chip-badge--${badgeKind}`}>
          {badgeLabel}
        </span>
        <span className="feed-teaser-chip-time">{feedTimeLabel(item)}</span>
        <span className="feed-teaser-chip-course">{short}</span>
        <span className={`feed-teaser-chip-detected${hot ? ' feed-teaser-chip-detected--hot' : ''}`}>
          {detectedShort}
        </span>
        {price ? <span className="feed-teaser-chip-price">{price}</span> : null}
      </Link>
    );
  }

  return (
    <article className={`feed-opening-card${item.still_open ? '' : ' is-gone'}${hot ? ' feed-opening-card--hot' : ''}`}>
      <Link to={courseHref} className="feed-opening-card-media">
        {photo ? (
          <img className="feed-opening-card-photo" src={photo} alt="" loading="lazy" />
        ) : (
          <div className="feed-opening-card-photo feed-opening-card-photo--fallback" aria-hidden />
        )}
        <div className="feed-opening-card-scrim">
          <div className="feed-opening-card-scrim-main">
            <span className={`feed-opening-badge feed-opening-badge--${hot ? 'live' : item.event_type}`}>
              {hot ? 'Live' : item.event_type === 'reopened' ? 'Reopened' : 'New'}
            </span>
            <div className="feed-opening-card-course">{short}</div>
            {city ? <div className="feed-opening-card-city">{city}</div> : null}
          </div>
          {price ? <div className="feed-opening-card-price">{price}</div> : null}
        </div>
      </Link>
      <div className="feed-opening-card-body">
        <div className="feed-opening-card-detail">
          <strong>{feedTimeLabel(item)}</strong>
          <span className="feed-opening-sep">·</span>
          {formatDateShort(item.play_date)}
          {item.spots_open != null ? (
            <>
              <span className="feed-opening-sep">·</span>
              {item.spots_open} spot{item.spots_open !== 1 ? 's' : ''}
            </>
          ) : null}
        </div>
        <div className={`feed-opening-card-meta${hot ? ' feed-opening-card-meta--hot' : ''}`}>{feedDetectedLabel(item)}</div>
        {!item.still_open ? (
          <div className="feed-opening-card-gone">May no longer be available</div>
        ) : null}
        <div className="feed-opening-card-actions">
          {bookingUrl ? (
            <a
              className="btn btn-primary feed-opening-book"
              href={bookingUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              Book now →
            </a>
          ) : null}
          <Link to={courseHref} className="btn btn-ghost feed-opening-view">
            View course
          </Link>
        </div>
      </div>
    </article>
  );
}
