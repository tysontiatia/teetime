import { useMemo, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Course } from '../types';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { formatDateShort, formatTime12h } from '../lib/time';
import { copyTextToClipboard } from '../lib/clipboard';

type SharePayload = {
  v?: number;
  snapshotAt?: string;
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

function formatSnapshot(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export function SharePage() {
  const loc = useLocation();
  const { courses } = useCourseCatalog();
  const payload = useMemo(() => decodeHash(loc.hash), [loc.hash]);
  const coursesById = useMemo(() => new Map<string, Course>(courses.map((c) => [c.id, c])), [courses]);
  const [copyHint, setCopyHint] = useState<'idle' | 'ok' | 'fail'>('idle');

  const onCopyThisLink = useCallback(async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const ok = await copyTextToClipboard(url);
    setCopyHint(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopyHint('idle'), 2200);
  }, []);

  if (!payload || !payload.courseId) {
    return (
      <div className="container">
        <div style={{ padding: 18, borderRadius: 18, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.8)' }}>
          <div className="pill">Share</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            Invalid or empty link
          </h2>
          <p style={{ color: 'var(--muted)' }}>
            Open a plan link from Tee-Time (or ask the host to send it again). Later this can become a saved round at a short URL.
          </p>
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
        <div style={{ minWidth: 0 }}>
          <div className="pill">Share link</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            {course ? `${course.name} (${course.city})` : payload.courseId}
          </h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="pill">{formatDateShort(payload.date)}</span>
            <span className="pill">
              {options.length} option{options.length === 1 ? '' : 's'}
            </span>
            {payload.snapshotAt ? <span className="pill">Snapshot · {formatSnapshot(payload.snapshotAt)}</span> : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" type="button" onClick={() => void onCopyThisLink()}>
            {copyHint === 'ok' ? 'Copied!' : copyHint === 'fail' ? 'Copy failed' : 'Copy link'}
          </button>
          <Link to="/plan" className="btn btn-primary">
            Back to plan →
          </Link>
        </div>
      </div>

      <p
        style={{
          marginTop: 12,
          padding: '12px 14px',
          borderRadius: 14,
          border: '1px solid var(--border)',
          background: 'rgba(255,255,255,0.65)',
          color: 'var(--muted)',
          fontSize: 14,
          lineHeight: 1.5,
          maxWidth: 900,
        }}
      >
        <strong style={{ color: 'var(--ink)' }}>Votes here are a lightweight mock</strong> (not saved yet). Treat this page as the shared shortlist — confirm times are still open before booking.
      </p>

      <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.85)', overflow: 'hidden' }}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)', fontWeight: 900 }}>Vote (mock)</div>
        <div style={{ padding: 14, display: 'grid', gap: 10 }}>
          {options.map((o, idx) => (
            <div key={`${o.startsAt}-${idx}`} style={{ border: '1px solid rgba(26,46,26,0.12)', borderRadius: 16, padding: 12, background: '#fff' }}>
              <div style={{ fontWeight: 950, letterSpacing: '-0.02em' }}>
                {formatTime12h(o.startsAt)}{' '}
                <span style={{ color: 'var(--muted)', fontWeight: 800 }}>
                  · {o.players}p · {o.holes}h{typeof o.price === 'number' ? ` · $${o.price}` : ''}
                </span>
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn"
                  type="button"
                  style={{
                    padding: '8px 10px',
                    borderRadius: 999,
                    background: 'rgba(45,122,58,0.10)',
                    borderColor: 'rgba(45,122,58,0.18)',
                    color: 'var(--green-2)',
                  }}
                >
                  In
                </button>
                <button className="btn" type="button" style={{ padding: '8px 10px', borderRadius: 999 }}>
                  If needed
                </button>
                <button
                  className="btn"
                  type="button"
                  style={{
                    padding: '8px 10px',
                    borderRadius: 999,
                    background: 'rgba(234,88,12,0.10)',
                    borderColor: 'rgba(234,88,12,0.18)',
                    color: '#9a3412',
                  }}
                >
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
          For stored votes and a short link, use <strong style={{ color: 'var(--ink)' }}>Publish live round</strong> on the plan page — it opens <code style={{ fontSize: 13 }}>/round/…</code> backed by Supabase.
        </p>
      </div>
    </div>
  );
}
