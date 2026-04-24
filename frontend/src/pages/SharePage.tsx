import { useMemo, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Course } from '../types';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { formatDateShort, formatTime12h } from '../lib/time';
import { copyTextToClipboard } from '../lib/clipboard';

type ShareOption = {
  startsAt: string;
  holes: 9 | 18;
  players: 1 | 2 | 3 | 4;
  price?: number;
  courseId?: string;
};

type SharePayload = {
  v?: number;
  snapshotAt?: string;
  courseIds?: string[];
  courseId: string | null;
  date: string;
  options: ShareOption[];
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

function normalizeSnapshot(payload: SharePayload): Array<ShareOption & { courseId: string }> | null {
  if (!payload.date || !payload.options?.length) return null;
  const merged = payload.options.map((o) => ({
    ...o,
    courseId: o.courseId ?? payload.courseId ?? null,
  }));
  if (merged.some((o) => !o.courseId)) return null;
  return merged as Array<ShareOption & { courseId: string }>;
}

export function SharePage() {
  const loc = useLocation();
  const { courses } = useCourseCatalog();
  const payload = useMemo(() => decodeHash(loc.hash), [loc.hash]);
  const coursesById = useMemo(() => new Map<string, Course>(courses.map((c) => [c.id, c])), [courses]);
  const [copyHint, setCopyHint] = useState<'idle' | 'ok' | 'fail'>('idle');

  const normalized = useMemo(() => (payload ? normalizeSnapshot(payload) : null), [payload]);

  const onCopyThisLink = useCallback(async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const ok = await copyTextToClipboard(url);
    setCopyHint(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopyHint('idle'), 2200);
  }, []);

  if (!payload || !normalized) {
    return (
      <div className="container">
        <div style={{ padding: 18, borderRadius: 18, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.8)' }}>
          <div className="pill">Share</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            Invalid or empty link
          </h2>
          <p style={{ color: 'var(--muted)' }}>
            Open a plan link from Tee-Time (or ask the host to send it again). Multi-course snapshots need each time to include a course id (newer links).
          </p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 14 }}>
            Back to finder →
          </Link>
        </div>
      </div>
    );
  }

  const options = [...normalized].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const courseIds = [...new Set(options.map((o) => o.courseId))];
  const titleNames = courseIds.map((id) => coursesById.get(id)?.name ?? id);
  const title =
    titleNames.length > 2
      ? `${titleNames.slice(0, 2).join(' · ')} +${titleNames.length - 2}`
      : titleNames.join(' · ');

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="pill">Legacy snapshot</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            {title}
          </h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="pill">{formatDateShort(payload.date)}</span>
            <span className="pill">
              {courseIds.length} course{courseIds.length === 1 ? '' : 's'} · {options.length} time{options.length === 1 ? '' : 's'}
            </span>
            {payload.snapshotAt ? <span className="pill">Snapshot · {formatSnapshot(payload.snapshotAt)}</span> : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" type="button" onClick={() => void onCopyThisLink()}>
            {copyHint === 'ok' ? 'Copied!' : copyHint === 'fail' ? 'Copy failed' : 'Copy link'}
          </button>
          <Link to="/plan" className="btn btn-primary">
            Group vote →
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
        <strong style={{ color: 'var(--ink)' }}>Votes here are a lightweight mock</strong> (not saved). Treat this page as a frozen shortlist — confirm times are still open before booking.
      </p>

      <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.85)', overflow: 'hidden' }}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)', fontWeight: 900 }}>Vote (mock)</div>
        <div style={{ padding: 14, display: 'grid', gap: 10 }}>
          {options.map((o, idx) => {
            const cname = coursesById.get(o.courseId)?.name ?? o.courseId;
            return (
              <div key={`${o.courseId}-${o.startsAt}-${idx}`} style={{ border: '1px solid rgba(26,46,26,0.12)', borderRadius: 16, padding: 12, background: '#fff' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green-2)', marginBottom: 4 }}>{cname}</div>
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
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 14, padding: 14, border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.7)' }}>
        <div style={{ fontWeight: 900 }}>Prefer a real group vote?</div>
        <p style={{ color: 'var(--muted)', marginTop: 6 }}>
          This page is a frozen snapshot. For a single link where everyone votes and names stick, use <strong style={{ color: 'var(--ink)' }}>Create group vote link</strong> on the Group vote screen — it opens <code style={{ fontSize: 13 }}>/round/…</code>.
        </p>
      </div>
    </div>
  );
}
