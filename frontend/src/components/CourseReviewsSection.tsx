import type { PlaceReview } from '../lib/placeReviews';
import { googleMapsPlaceUrl } from '../lib/mapsLinks';
import type { Course } from '../types';

type Props = {
  reviews: PlaceReview[];
  loading: boolean;
  mapsUrl?: string | null;
  course: Pick<Course, 'catalogName' | 'name' | 'city' | 'lat' | 'lng' | 'reviewCount'>;
};

function StarRow({ rating }: { rating: number | null }) {
  if (typeof rating !== 'number') return null;
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="review-stars" aria-label={`${filled} out of 5 stars`}>
      {'★★★★★'.slice(0, filled)}
      <span className="review-stars-empty">{'★★★★★'.slice(filled)}</span>
    </span>
  );
}

export function CourseReviewsSection({ reviews, loading, mapsUrl, course }: Props) {
  const allReviewsHref = mapsUrl || googleMapsPlaceUrl(course);

  if (loading) {
    return (
      <div className="section">
        <h2>Reviews</h2>
        <p className="section-muted">Loading recent Google reviews…</p>
      </div>
    );
  }

  if (!reviews.length) {
    return (
      <div className="section">
        <h2>Reviews</h2>
        <p className="section-muted">
          Recent Google reviews aren’t available right now.{' '}
          <a className="detail-text-link" href={allReviewsHref} target="_blank" rel="noreferrer">
            See reviews on Google Maps →
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="reviews-head">
        <h2>Reviews</h2>
        <p className="reviews-head-meta">Most recent from Google · up to 5</p>
      </div>
      <ul className="reviews-list">
        {reviews.map((r, i) => (
          <li key={`${r.author}-${r.time ?? i}`} className="review-card">
            <div className="review-card-top">
              {r.profilePhotoUrl ? (
                <img className="review-avatar" src={r.profilePhotoUrl} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <span className="review-avatar review-avatar-fallback" aria-hidden>
                  {(r.author || '?').charAt(0).toUpperCase()}
                </span>
              )}
              <div className="review-card-meta">
                {r.authorUrl ? (
                  <a className="review-author" href={r.authorUrl} target="_blank" rel="noreferrer">
                    {r.author}
                  </a>
                ) : (
                  <span className="review-author">{r.author}</span>
                )}
                <div className="review-card-sub">
                  <StarRow rating={r.rating} />
                  {r.relativeTime ? <span className="review-when">{r.relativeTime}</span> : null}
                </div>
              </div>
            </div>
            {r.text ? <p className="review-text">{r.text}</p> : <p className="review-text is-empty">No written review.</p>}
          </li>
        ))}
      </ul>
      <a className="detail-text-link reviews-more" href={allReviewsHref} target="_blank" rel="noreferrer">
        {typeof course.reviewCount === 'number'
          ? `See all ${course.reviewCount.toLocaleString()} reviews on Google →`
          : 'See all reviews on Google →'}
      </a>
    </div>
  );
}
