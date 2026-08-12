import type { CSSProperties } from 'react';

function Shimmer({ style, className }: { style?: CSSProperties; className?: string }) {
  return (
    <div
      className={className ? `skeleton-shimmer ${className}` : 'skeleton-shimmer'}
      style={{
        borderRadius: 10,
        minHeight: 12,
        ...style,
      }}
    />
  );
}

export function CourseCardSkeleton() {
  return (
    <article className="mp-course" aria-hidden>
      <div className="mp-course-media">
        <div className="mp-course-photo">
          <div className="mp-photo-fallback" style={{ opacity: 0.45 }} />
          <div className="mp-course-scrim">
            <div className="mp-course-scrim-main">
              <Shimmer style={{ width: '58%', height: 18, background: 'rgba(255,255,255,0.35)' }} />
              <Shimmer style={{ width: '42%', height: 12, marginTop: 8, background: 'rgba(255,255,255,0.25)' }} />
            </div>
          </div>
        </div>
        <div className="tee-strip tee-strip-skeleton">
          <CourseCardTimesSkeleton />
        </div>
      </div>
    </article>
  );
}

/**
 * Placeholders sized to `.tee-chip.tee-chip--compact` via shared CSS
 * (`--mp-tee-chip-width` / `--mp-tee-chip-height` + border + radius-sm).
 */
export function CourseCardTimesSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="tee-chip-skeleton skeleton-shimmer"
          style={{ opacity: 1 - i * 0.08 }}
          aria-hidden
        />
      ))}
    </>
  );
}
