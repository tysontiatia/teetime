import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Course } from '../types';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { formatDateShort, formatTime12h } from '../lib/time';

type SharePayload = {
  courseId: string | null;
  date: string;
  options: Array<{ startsAt: string; holes: 9 | 18; players: 1 | 2 | 3 | 4; price?: number }>;
};

function decodeHash(hash: string): SharePayload | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  try {
    const json = decodeURIComponent(escape(atob(raw)));
    return JSON.parse(json) as SharePayload;
  } catch {
    return null;
  }
}

export function SharePage() {
  const loc = useLocation();
  const { courses } = useCourseCatalog();
  const payload = useMemo(() => decodeHash(loc.hash), [loc.hash]);
  const coursesById = useMemo(() => new Map<string, Course>(courses.map((c) => [c.id, c])), [courses]);

  if (!payload || !payload.courseId) {
    return (
      <div className="container">
        <div style={{ padding: 18, borderRadius: 18, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.8)' }}>
          <div className="pill">Share</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            Invalid or empty link
          </h2>
          <p style={{ color: 'var(--muted)' }}>Open this link from the same site so the course catalog loads. Later this can become a persisted round (`/round/:id`).</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 14 }}>
            Back to finder →
          </Link>
        </div>
      </div>
    );
  }

  const course = coursesById.get(payload.courseId) ?? null;
  const options = [...payload.options].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="pill">Share link</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            {course ? `${course.name} (${course.city})` : payload.courseId}
          </h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span className="pill">{formatDateShort(payload.date)}</span>
            <span className="pill">{options.length} option{options.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <Link to="/plan" className="btn btn-primary">
          Back to plan →
        </Link>
      </div>

      <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.85)', overflow: 'hidden' }}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)', fontWeight: 900 }}>Vote (mock)</div>
        <div style={{ padding: 14, display: 'grid', gap: 10 }}>
          {options.map((o, idx) => (
            <div key={idx} style={{ border: '1px solid rgba(26,46,26,0.12)', borderRadius: 16, padding: 12, background: '#fff' }}>
              <div style={{ fontWeight: 950, letterSpacing: '-0.02em' }}>
                {formatTime12h(o.startsAt)}{' '}
                <span style={{ color: 'var(--muted)', fontWeight: 800 }}>
                  · {o.players}p · {o.holes}h{typeof o.price === 'number' ? ` · $${o.price}` : ''}
                </span>
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" type="button" style={{ padding: '8px 10px', borderRadius: 999, background: 'rgba(45,122,58,0.10)', borderColor: 'rgba(45,122,58,0.18)', color: 'var(--green-2)' }}>
                  In
                </button>
                <button className="btn" type="button" style={{ padding: '8px 10px', borderRadius: 999 }}>
                  If needed
                </button>
                <button className="btn" type="button" style={{ padding: '8px 10px', borderRadius: 999, background: 'rgba(234,88,12,0.10)', borderColor: 'rgba(234,88,12,0.18)', color: '#9a3412' }}>
                  Out
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14, padding: 14, border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.7)' }}>
        <div style={{ fontWeight: 900 }}>Next step</div>
        <p style={{ color: 'var(--muted)', marginTop: 6 }}>
          When we add data plumbing, this becomes a real persisted “Round” record and your buddies’ votes are stored (no hash links).
        </p>
      </div>
    </div>
  );
}

