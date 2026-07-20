import { Link } from 'react-router-dom';
import type { FeedItem } from '../lib/feedApi';
import type { CourseRecord } from '../lib/courseRecord';
import { buildBookingUrl } from '../lib/bookingUrl';
import { coursePhotoUrl } from '../lib/coursePhotoUrl';
import { parseCourseTitle } from '../lib/courseRecord';
import { formatDateShort } from '../lib/time';
import {
  feedChipDetectedShort,
  feedSpotsLabel,
  feedTimeLabel,
  formatFeedPrice,
  isFeedHotOpening,
} from '../lib/feedDisplay';
import { CoursePhoto } from './CoursePhoto';

type Props = {
  item: FeedItem;
  record?: CourseRecord;
  minPlayers: number;
};

export function FeedOpeningRow({ item, record, minPlayers }: Props) {
  const { short, city } = parseCourseTitle(item.course_name);
  const photo = record ? coursePhotoUrl(record, 240) : undefined;
  const price = formatFeedPrice(item.price_cents);
  const spots = feedSpotsLabel(item.spots_open);
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
  const className = `feed-opening-row${!item.still_open ? ' is-gone' : ''}${hot ? ' feed-opening-row--hot' : ''}`;

  return (
    <article className={className}>
      <Link to={courseHref} className="feed-opening-row-main">
        <div className="feed-opening-row-thumb" aria-hidden>
          <CoursePhoto src={photo} height={64} className="feed-opening-row-photo" style={{ height: '100%' }} />
        </div>
        <div className="feed-opening-row-text">
          <div className="feed-opening-row-course">
            <span className="feed-opening-row-name">{short}</span>
            {city ? <span className="feed-opening-row-city">{city}</span> : null}
          </div>
          <div className="feed-opening-row-detail">
            <strong>{feedTimeLabel(item)}</strong>
            <span className="feed-opening-sep">·</span>
            {formatDateShort(item.play_date)}
            {spots ? (
              <>
                <span className="feed-opening-sep">·</span>
                {spots}
              </>
            ) : null}
            {price ? (
              <>
                <span className="feed-opening-sep">·</span>
                <span className="feed-opening-row-price">{price}</span>
              </>
            ) : null}
          </div>
        </div>
      </Link>
      <div className="feed-opening-row-aside">
        <span className={`feed-opening-row-ago${hot ? ' feed-opening-row-ago--hot' : ''}`}>{detectedShort}</span>
        {bookingUrl ? (
          <a
            className="btn btn-primary feed-opening-row-book"
            href={bookingUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            Book
          </a>
        ) : (
          <Link to={courseHref} className="btn btn-ghost feed-opening-row-book">
            View
          </Link>
        )}
      </div>
    </article>
  );
}
