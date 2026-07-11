import { Link } from 'react-router-dom';
import type { FeedItem } from '../lib/feedApi';
import type { CourseRecord } from '../lib/courseRecord';
import { buildBookingUrl } from '../lib/bookingUrl';
import { coursePhotoUrl } from '../lib/coursePhotoUrl';
import { parseCourseTitle } from '../lib/courseRecord';
import {
  feedActivityBadgeLabel,
  feedChipDetectedShort,
  feedPlayWhenWithSpots,
  formatFeedPrice,
  isFeedHotOpening,
} from '../lib/feedDisplay';

type Props = {
  item: FeedItem;
  record?: CourseRecord;
  minPlayers: number;
};

export function FeedActivityCard({ item, record, minPlayers }: Props) {
  const { short } = parseCourseTitle(item.course_name);
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
  const detectedShort = feedChipDetectedShort(item);
  const badgeLabel = feedActivityBadgeLabel(item);
  const playWhen = feedPlayWhenWithSpots(item);

  const className = `feed-activity-card${hot ? ' feed-activity-card--hot' : ''}${!item.still_open ? ' is-gone' : ''}`;

  const inner = (
    <>
      <div className="feed-activity-card-photo-wrap">
        {photo ? (
          <img className="feed-activity-card-photo" src={photo} alt="" loading="lazy" />
        ) : (
          <div className="feed-activity-card-photo feed-activity-card-photo--fallback" aria-hidden />
        )}
      </div>
      <div className="feed-activity-card-body">
        <div className="feed-activity-card-top">
          <span className={`feed-activity-badge feed-activity-badge--${hot ? 'live' : item.event_type === 'reopened' ? 'reopened' : 'new'}`}>
            {badgeLabel}
          </span>
          <span className={`feed-activity-ago${hot ? ' feed-activity-ago--hot' : ''}`}>{detectedShort}</span>
        </div>
        <div className="feed-activity-course">{short}</div>
        <div className="feed-activity-meta">
          <span className="feed-activity-when">{playWhen}</span>
          {price ? <span className="feed-activity-price">{price}</span> : null}
        </div>
      </div>
    </>
  );

  if (bookingUrl) {
    return (
      <a
        className={className}
        href={bookingUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Book ${short}, ${playWhen}, detected ${detectedShort}`}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link to={courseHref} className={className} aria-label={`View ${short}, ${playWhen}`}>
      {inner}
    </Link>
  );
}
