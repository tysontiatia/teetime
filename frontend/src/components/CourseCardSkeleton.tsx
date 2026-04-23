import type { CSSProperties } from 'react';

function Shimmer({ style }: { style?: CSSProperties }) {
  return (
    <div
      className="skeleton-shimmer"
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
    <div
      style={{
        background: 'rgba(255,255,255,0.9)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        boxShadow: '0 6px 18px rgba(0,0,0,0.05)',
      }}
    >
      <div style={{ height: 132, background: 'linear-gradient(180deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.08) 100%)' }} />

      <div style={{ padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Shimmer style={{ width: '88%', height: 18 }} />
            <Shimmer style={{ width: '95%', height: 12 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Shimmer style={{ width: 40, height: 36, borderRadius: 12 }} />
            <Shimmer style={{ width: 52, height: 36, borderRadius: 12 }} />
          </div>
        </div>

        <div className="times-grid" style={{ marginTop: 10 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Shimmer key={i} style={{ height: 52, borderRadius: 12 }} />
          ))}
        </div>

        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Shimmer style={{ width: 140, height: 34, borderRadius: 12 }} />
          <Shimmer style={{ width: 160, height: 14 }} />
        </div>
      </div>
    </div>
  );
}
