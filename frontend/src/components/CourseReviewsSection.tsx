import { useLayoutEffect, useRef, useState } from 'react';
import type { PlaceReview } from '../lib/placeReviews';
import { googleMapsPlaceUrl } from '../lib/mapsLinks';
import type { Course } from '../types';

type Props = {
  reviews: PlaceReview[];
  loading: boolean;
  mapsUrl?: string | null;
  course: Pick<Course, 'catalogName' | 'name' | 'city' | 'lat' | 'lng' | 'reviewCount' | 'rating'>;
  /** When embedded under a Reviews tab, skip the section h2. */
  hideHeading?: boolean;
};

function ReviewText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  return (
    <>
      <p ref={ref} className={`review-text${expanded ? '' : ' is-clamped'}`}>
        {text}
      </p>
      {overflows || expanded ? (
        <button type="button" className="review-text-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </>
  );
}

function StarRow({ rating, size = 'sm' }: { rating: number | null; size?: 'sm' | 'lg' }) {
  if (typeof rating !== 'number') return null;
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className={`review-stars review-stars--${size}`} aria-label={`${filled} out of 5 stars`}>
      {'★★★★★'.slice(0, filled)}
      <span className="review-stars-empty">{'★★★★★'.slice(filled)}</span>
    </span>
  );
}

export function CourseReviewsSection({ reviews, loading, mapsUrl, course, hideHeading = false }: Props) {
  const allReviewsHref = mapsUrl || googleMapsPlaceUrl(course);
  const heading = hideHeading ? null : <h2>Reviews</h2>;

  if (loading) {
    return (
      <div className="section">
        {heading}
        <p className="section-muted">Loading recent Google reviews…</p>
      </div>
    );
  }

  if (!reviews.length) {
    return (
      <div className="section">
        {heading}
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
    <div className="section reviews-section">
      {heading}
      {typeof course.rating === 'number' ? (
        <div className="reviews-summary" aria-label="Overall Google rating">
          <span className="reviews-summary-score">{course.rating.toFixed(1)}</span>
          <div className="reviews-summary-side">
            <p className="reviews-summary-label">Overall</p>
            <StarRow rating={course.rating} size="lg" />
            <p className="reviews-summary-count">
              {typeof course.reviewCount === 'number'
                ? `${course.reviewCount.toLocaleString()} Google reviews`
                : 'Google reviews'}
            </p>
          </div>
        </div>
      ) : (
        <p className="reviews-head-meta">Most recent from Google · up to 5</p>
      )}
      <ul className="reviews-list" aria-label="Recent reviews">
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
            {r.text ? <ReviewText text={r.text} /> : <p className="review-text is-empty">No written review.</p>}
          </li>
        ))}
      </ul>
      <a className="btn reviews-more-btn" href={allReviewsHref} target="_blank" rel="noreferrer">
        Read more on Google
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M7 17L17 7M17 7H9M17 7v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    </div>
  );
}
