import { googleMapsPlaceUrl } from '../lib/mapsLinks';
import type { Course } from '../types';

type Props = {
  course: Pick<Course, 'catalogName' | 'name' | 'city' | 'state' | 'lat' | 'lng' | 'rating' | 'reviewCount'>;
  /** When embedded under a Reviews tab, skip the section h2. */
  hideHeading?: boolean;
};

/** Stored rating plus a Maps link. Does not fetch Google reviews. */
export function CourseReviewsSection({ course, hideHeading = false }: Props) {
  const href = googleMapsPlaceUrl(course);
  const heading = hideHeading ? null : <h2>Reviews</h2>;
  const count =
    typeof course.reviewCount === 'number' ? `${course.reviewCount.toLocaleString()} Google reviews` : null;

  return (
    <div className="section">
      {heading}
      {typeof course.rating === 'number' ? (
        <p className="reviews-head-meta">
          Google rating {course.rating.toFixed(1)}
          {count ? ` · ${count}` : ''}
        </p>
      ) : null}
      <p className="section-muted">
        <a className="detail-text-link" href={href} target="_blank" rel="noreferrer">
          Read reviews on Google Maps →
        </a>
      </p>
    </div>
  );
}
