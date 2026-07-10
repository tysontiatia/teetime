import { useCallback, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Course } from '../types';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { formatDateShort, formatTime12h } from '../lib/time';
import { copyTextToClipboard } from '../lib/clipboard';
import { buildBookingUrl } from '../lib/bookingUrl';

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

type LocalVote = 'in' | 'maybe' | 'out';

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

function optionKey(o: ShareOption & { courseId: string }): string {
  return `${o.courseId}:${o.startsAt}`;
}

function courseDetailHref(courseId: string, date: string, players: number, holes: number): string {
  const q = new URLSearchParams({
    date,
    players: String(players),
    holes: String(holes),
  });
  return `/course/${courseId}?${q.toString()}`;
}

function readLocalVotes(storageKey: string): Record<string, LocalVote> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LocalVote>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function SharePage() {
  const loc = useLocation();
  const { courses, recordsBySlug } = useCourseCatalog();
  const payload = useMemo(() => decodeHash(loc.hash), [loc.hash]);
  const coursesById = useMemo(() => new Map<string, Course>(courses.map((c) => [c.id, c])), [courses]);
  const [copyHint, setCopyHint] = useState<'idle' | 'ok' | 'fail'>('idle');

  const hashKey = loc.hash || '';
  const voteStorageKey = hashKey ? `tt-snapshot-votes:${hashKey}` : '';
  const [localVotes, setLocalVotes] = useState<Record<string, LocalVote>>(() =>
    voteStorageKey ? readLocalVotes(voteStorageKey) : {},
  );

  const normalized = useMemo(() => (payload ? normalizeSnapshot(payload) : null), [payload]);

  const onCopyThisLink = useCallback(async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const ok = await copyTextToClipboard(url);
    setCopyHint(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopyHint('idle'), 2200);
  }, []);

  const setVote = useCallback(
    (key: string, status: LocalVote) => {
      setLocalVotes((prev) => {
        const next = { ...prev, [key]: status };
        if (voteStorageKey) {
          try {
            window.localStorage.setItem(voteStorageKey, JSON.stringify(next));
          } catch {
            /* quota / private mode */
          }
        }
        return next;
      });
    },
    [voteStorageKey],
  );

  if (!payload || !normalized) {
    return (
      <div className="container share-page">
        <div className="share-card">
          <div className="pill">Archived link</div>
          <h2 className="share-title share-title-sm">Could not open this snapshot</h2>
          <p style={{ color: 'var(--muted)', lineHeight: 1.55, maxWidth: 640 }}>
            This URL is missing data or uses an old format. New vote links look like{' '}
            <code className="share-code">/round/your-link</code> and save everyone&apos;s votes in real time.
          </p>
          <div className="share-upgrade-actions" style={{ marginTop: 14 }}>
            <Link to="/" className="btn btn-primary">
              Browse tee times →
            </Link>
            <Link to="/plan" className="btn btn-ghost">
              Shared rounds
            </Link>
          </div>
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
  const primaryCourse = courseIds.length === 1 ? coursesById.get(courseIds[0]!) ?? null : null;

  return (
    <div className="container share-page">
      <div className="share-header">
        <div style={{ minWidth: 0 }}>
          <Link to="/" className="pill">
            ← Tee times
          </Link>
          <h2 className="share-title">{title}</h2>
          <div className="share-meta">
            <span className="pill">Archived snapshot</span>
            <span className="pill">{formatDateShort(payload.date)}</span>
            <span className="pill">
              {courseIds.length} course{courseIds.length === 1 ? '' : 's'} · {options.length} time{options.length === 1 ? '' : 's'}
            </span>
            {payload.snapshotAt ? <span className="pill">Saved {formatSnapshot(payload.snapshotAt)}</span> : null}
          </div>
        </div>
        <div className="share-actions">
          <button className="btn btn-ghost" type="button" onClick={() => void onCopyThisLink()}>
            {copyHint === 'ok' ? 'Copied!' : copyHint === 'fail' ? 'Copy failed' : 'Copy link'}
          </button>
        </div>
      </div>

      <p className="share-note">
        <strong style={{ color: 'var(--ink)' }}>This is an older snapshot link.</strong> Times were frozen when the host
        shared it — confirm availability before booking. Votes you tap below are saved <em>on this device only</em>; your
        group won&apos;t see them unless you create a live vote link.
      </p>

      {primaryCourse ? (
        <div className="share-hero-wrap round-panel">
          <div
            className={`round-hero${primaryCourse.photoUrl ? ' has-photo' : ''}`}
            style={primaryCourse.photoUrl ? { backgroundImage: `url(${primaryCourse.photoUrl})` } : undefined}
          >
            {primaryCourse.photoUrl ? <div className="round-hero-scrim" aria-hidden /> : null}
            <div className="round-hero-body">
              <div className="round-hero-name">{primaryCourse.name}</div>
              {primaryCourse.city ? <div className="round-hero-city">{primaryCourse.city}</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="share-panel">
        <div className="share-panel-head">
          <div>
            <div className="share-panel-title">Times in this snapshot</div>
            <p className="share-panel-sub">Mark what works for you locally, or open a course to check live inventory.</p>
          </div>
        </div>
        <div className="share-options">
          {options.map((o, idx) => {
            const key = optionKey(o);
            const mine = localVotes[key];
            const selected = mine === 'in';
            const course = coursesById.get(o.courseId);
            const record = recordsBySlug.get(o.courseId);
            const cname = course?.name ?? o.courseId;
            const detailHref = courseDetailHref(o.courseId, payload.date, o.players, o.holes);
            const bookingHref = buildBookingUrl(
              record ?? { bookingUrl: course?.bookingUrl ?? null, platform: course?.platform ?? null },
              {
                dateYmd: payload.date,
                players: o.players,
                holes: o.holes,
                startsAtIso: o.startsAt,
              },
            );

            return (
              <div key={`${key}-${idx}`} className={`share-option round-option${selected ? ' is-selected' : ''}`}>
                {courseIds.length > 1 ? <div className="share-option-course">{cname}</div> : null}
                <div className="share-option-head">
                  <div>
                    <div className="share-option-time">{formatTime12h(o.startsAt)}</div>
                    <div className="share-option-meta">
                      {o.players} player{o.players === 1 ? '' : 's'} · {o.holes} holes
                      {typeof o.price === 'number' ? ` · $${o.price}` : ''}
                    </div>
                  </div>
                </div>
                <div className="share-option-links">
                  <Link className="btn" to={detailHref}>
                    Course details
                  </Link>
                  {bookingHref ? (
                    <a className="btn btn-primary" href={bookingHref} target="_blank" rel="noreferrer">
                      Book →
                    </a>
                  ) : null}
                </div>
                <div className="round-vote-actions" style={{ marginTop: 12 }}>
                  <button
                    className={`btn round-vote-btn round-vote-btn-in${mine === 'in' ? ' is-on' : ''}`}
                    type="button"
                    onClick={() => setVote(key, 'in')}
                  >
                    In
                  </button>
                  <button
                    className={`btn round-vote-btn round-vote-btn-maybe${mine === 'maybe' ? ' is-on' : ''}`}
                    type="button"
                    onClick={() => setVote(key, 'maybe')}
                  >
                    If needed
                  </button>
                  <button
                    className={`btn round-vote-btn round-vote-btn-out${mine === 'out' ? ' is-on' : ''}`}
                    type="button"
                    onClick={() => setVote(key, 'out')}
                  >
                    Out
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="share-upgrade">
        <div className="share-upgrade-title">Want everyone to vote together?</div>
        <p className="share-upgrade-copy">
          Create a <strong style={{ color: 'var(--ink)' }}>live vote link</strong> from the finder or a course page —
          friends pick times, votes sync in real time, and links show up under Shared rounds when you&apos;re signed in.
          Live links use <code className="share-code">/round/…</code>, not this archived format.
        </p>
        <div className="share-upgrade-actions">
          <Link to="/" className="btn btn-primary">
            Browse tee times →
          </Link>
          <Link to="/plan" className="btn btn-ghost">
            Shared rounds
          </Link>
        </div>
      </div>
    </div>
  );
}
