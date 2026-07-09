import { Link } from 'react-router-dom';
import type { Course, TeeTime } from '../types';
import type { CourseRecord } from '../lib/courseRecord';
import { formatReopenedAgo, formatTime12h } from '../lib/time';
import { CoursePhoto } from './CoursePhoto';
import { CourseCardTimesSkeleton } from './CourseCardSkeleton';

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

type Props = {
  course: Course;
  record?: CourseRecord;
  times: TeeTime[];
  detailHref: string;
  timesPending: boolean;
  outOfScope: boolean;
  onAlert: () => void;
  onSearchAllUtah: () => void;
  onShare: () => void;
  shareBusy: boolean;
  shareDisabled: boolean;
};

export function CourseMarketplaceCard({
  course,
  record,
  times,
  detailHref,
  timesPending,
  outOfScope,
  onAlert,
  onSearchAllUtah,
  onShare,
  shareBusy,
  shareDisabled,
}: Props) {
  const top = times.slice(0, 4);
  const hasTimes = times.length > 0;
  const hotId = top[0]?.id;

  return (
    <article className="mp-course">
      <div className="mp-course-photo">
        <Link to={detailHref} style={{ display: 'block', height: '100%' }} aria-label={`${course.name} details`}>
          {course.photoUrl ? (
            <CoursePhoto src={course.photoUrl} height={280} style={{ height: '100%' }} />
          ) : (
            <div className="mp-photo-fallback" aria-hidden />
          )}
        </Link>
        <span className="badge-live">
          {hasTimes ? (
            <>
              <span className="pulse" aria-hidden />
              {times.length} time{times.length === 1 ? '' : 's'}
            </>
          ) : timesPending ? (
            <>Loading…</>
          ) : outOfScope ? (
            <>Not loaded</>
          ) : (
            <>No times</>
          )}
        </span>
        <button
          type="button"
          className="btn-bell"
          aria-label={`Tee time alerts for ${course.name}`}
          title="Tee time alerts"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAlert();
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M18 9a6 6 0 10-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9ZM10 20a2.2 2.2 0 004 0"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <Link to={detailHref} style={{ display: 'block' }}>
        <div className="course-head">
          <span className="course-name">{course.name}</span>
          {typeof course.rating === 'number' ? (
            <span className="course-rating">
              ★ {course.rating.toFixed(1)}
              {typeof course.reviewCount === 'number' ? (
                <span> ({course.reviewCount.toLocaleString()})</span>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="course-meta">{metaLine(course, record)}</div>
      </Link>

      {hasTimes ? (
        <div className="tee-strip">
          {top.map((t) => (
            <Link
              key={t.id}
              to={detailHref}
              className={`tee-chip${t.id === hotId ? ' hot' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="t">{formatTime12h(t.startsAt).replace(' ', '').toLowerCase()}</span>
              {t.reopenedAt ? (
                <span className="p" style={{ color: 'var(--fairway-ink)' }}>
                  {formatReopenedAgo(t.reopenedAt)}
                </span>
              ) : (
                <span className="p">{typeof t.price === 'number' ? `$${t.price}` : '—'}</span>
              )}
            </Link>
          ))}
          {times.length > top.length ? (
            <Link to={detailHref} className="tee-chip more">
              +{times.length - top.length}
            </Link>
          ) : null}
        </div>
      ) : timesPending ? (
        <CourseCardTimesSkeleton />
      ) : outOfScope ? (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: '1px dashed var(--line)', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.45 }}>
            Outside your nearby search. Load all Utah or open the course page.
          </p>
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            <button type="button" className="btn btn-primary" onClick={onSearchAllUtah}>
              Search all Utah
            </button>
            <Link to={detailHref} className="btn">
              Course page →
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: '1px dashed var(--line)', background: '#F6FCE8', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>
            Nothing for this filter set — get notified when something opens.
          </p>
          <button type="button" className="btn btn-primary" style={{ marginTop: 10, width: '100%' }} onClick={onAlert}>
            Get notified
          </button>
        </div>
      )}

      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid var(--line)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <Link to={detailHref} className="btn btn-ghost" style={{ padding: '8px 10px', color: 'var(--ink-3)' }}>
          Details →
        </Link>
        <button
          className="btn btn-primary"
          type="button"
          disabled={shareDisabled || shareBusy}
          onClick={onShare}
          style={{ padding: '10px 16px', borderRadius: 12, fontWeight: 600, fontSize: 14 }}
          aria-label={`Share vote link for ${course.name}`}
        >
          {shareBusy ? '…' : 'Share'}
        </button>
      </div>
    </article>
  );
}
