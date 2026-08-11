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
  const className = `feed-opening-card${!item.still_open ? ' is-gone' : ''}${hot ? ' is-hot' : ''}`;

  const metaParts = [
    formatDateShort(item.play_date),
    spots,
    price,
    detectedShort,
  ].filter(Boolean);

  return (
    <article className={className}>
      <div className="feed-opening-card-main">
        <Link to={courseHref} className="feed-opening-card-link">
          <div className="feed-opening-thumb" aria-hidden>
            <CoursePhoto src={photo} height={56} className="feed-opening-thumb-photo" style={{ height: '100%' }} />
          </div>
          <div className="feed-opening-body">
            <div className="feed-opening-time">{feedTimeLabel(item)}</div>
            <div className="feed-opening-course">
              <span className="feed-opening-name">{short}</span>
              {city ? <span className="feed-opening-city">{city}</span> : null}
            </div>
            <div className="feed-opening-meta">
              {metaParts.map((part, i) => (
                <span key={`${part}-${i}`}>
                  {i > 0 ? <span className="feed-opening-sep" aria-hidden>
                    ·
                  </span> : null}
                  <span className={hot && part === detectedShort ? 'feed-opening-ago is-hot' : undefined}>
                    {part}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </Link>
        {bookingUrl ? (
          <a
            className="btn btn-primary feed-opening-book"
            href={bookingUrl}
            target="_blank"
            rel="noreferrer"
          >
            Book
          </a>
        ) : (
          <Link to={courseHref} className="btn feed-opening-book">
            View
          </Link>
        )}
      </div>
    </article>
  );
}
