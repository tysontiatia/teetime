import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  aggregateVotes,
  fetchRoundBySlug,
  fetchRoundOptions,
  fetchVotesForRound,
  upsertVote,
  voteForVoter,
  type DbRoundOption,
  type DbRoundVote,
} from '../lib/roundsApi';
import { getOrCreateVoterKey } from '../lib/voterKey';
import { formatDateShort, formatTime12h } from '../lib/time';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { copyTextToClipboard } from '../lib/clipboard';
import { absoluteRoundUrl } from '../lib/shareUrl';

function score(in_: number, maybe: number, out: number) {
  return in_ * 3 + maybe * 1 - out * 2;
}

export function RoundPage() {
  const { slug } = useParams<{ slug: string }>();
  const { courses } = useCourseCatalog();
  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [playDate, setPlayDate] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [options, setOptions] = useState<DbRoundOption[]>([]);
  const [votes, setVotes] = useState<DbRoundVote[]>([]);
  const [voteBusy, setVoteBusy] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<'idle' | 'ok' | 'fail'>('idle');

  const voterKey = useMemo(() => getOrCreateVoterKey(), []);

  const load = useCallback(async () => {
    if (!slug?.trim()) {
      setErr('Missing round link.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    const round = await fetchRoundBySlug(slug);
    if (!round?.id) {
      setErr('This round link is invalid or expired.');
      setLoading(false);
      return;
    }
    setRoundId(round.id);
    setTitle(round.title);
    setPlayDate(round.play_date);
    setCourseId(round.course_id);
    const [opts, v] = await Promise.all([fetchRoundOptions(round.id), fetchVotesForRound(round.id)]);
    setOptions(opts);
    setVotes(v);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const countsByOption = useMemo(() => aggregateVotes(votes), [votes]);
  const myVotes = useMemo(() => voteForVoter(votes, voterKey), [votes, voterKey]);

  const course = courseId ? coursesById.get(courseId) ?? null : null;

  const bestOptionId = useMemo(() => {
    let best: { id: string; s: number } | null = null;
    for (const o of options) {
      const c = countsByOption.get(o.id) ?? { in: 0, maybe: 0, out: 0 };
      const s = score(c.in, c.maybe, c.out);
      if (!best || s > best.s) best = { id: o.id, s };
    }
    return best?.id ?? null;
  }, [options, countsByOption]);

  const onVote = async (optionId: string, status: 'in' | 'maybe' | 'out') => {
    if (!roundId) return;
    setVoteBusy(optionId + status);
    const res = await upsertVote({ roundId, optionId, voterKey, status });
    setVoteBusy(null);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    await load();
  };

  const onCopy = async () => {
    if (!slug) return;
    const url = absoluteRoundUrl(slug.trim().toLowerCase());
    const ok = await copyTextToClipboard(url);
    setCopyHint(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopyHint('idle'), 2200);
  };

  if (loading) {
    return (
      <div className="container">
        <p style={{ color: 'var(--muted)', padding: 24 }}>Loading round…</p>
      </div>
    );
  }

  if (err && !roundId) {
    return (
      <div className="container">
        <div style={{ padding: 18, borderRadius: 18, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.85)' }}>
          <div className="pill">Round</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 28 }}>Could not open round</h2>
          <p style={{ color: 'var(--muted)' }}>{err}</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 14 }}>
            Back to finder →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="pill">Live round</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>{title}</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', color: 'var(--muted)' }}>
            {playDate ? <span className="pill">{formatDateShort(playDate)}</span> : null}
            <span className="pill">
              {options.length} option{options.length === 1 ? '' : 's'}
            </span>
            {bestOptionId ? (
              <span className="pill" style={{ background: 'var(--green-soft)', color: 'var(--green-2)', borderColor: 'rgba(45,122,58,0.22)' }}>
                Suggested pick highlighted
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" type="button" onClick={() => void onCopy()}>
            {copyHint === 'ok' ? 'Copied!' : copyHint === 'fail' ? 'Copy failed' : 'Copy link'}
          </button>
          <Link to="/plan" className="btn btn-primary">
            Your plan →
          </Link>
        </div>
      </div>

      {err ? (
        <p style={{ marginTop: 10, color: '#9a3412', fontSize: 14 }}>
          {err}
        </p>
      ) : null}

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
        <strong style={{ color: 'var(--ink)' }}>Votes are saved for this link.</strong> Each browser gets one vote per time (change by tapping another choice). Availability can still change — confirm before booking.
      </p>

      {course?.bookingUrl ? (
        <a className="btn btn-primary" href={course.bookingUrl} target="_blank" rel="noreferrer" style={{ marginTop: 12, display: 'inline-flex' }}>
          Open booking site →
        </a>
      ) : null}

      <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
        {options.map((o) => {
          const c = countsByOption.get(o.id) ?? { in: 0, maybe: 0, out: 0 };
          const mine = myVotes.get(o.id);
          const isBest = bestOptionId === o.id;
          const tIso = o.starts_at ?? null;
          const timeLabel = tIso ? formatTime12h(tIso) : o.time_display;
          const busy = (s: string) => voteBusy === o.id + s;

          return (
            <div
              key={o.id}
              style={{
                border: '1px solid rgba(26,46,26,0.12)',
                borderRadius: 16,
                padding: 14,
                background: isBest ? 'rgba(233,245,234,0.85)' : '#fff',
              }}
            >
              <div style={{ fontWeight: 950, letterSpacing: '-0.02em' }}>
                {timeLabel}{' '}
                <span style={{ color: 'var(--muted)', fontWeight: 800 }}>
                  · {o.players}p · {o.holes}h{o.price ? ` · $${o.price}` : ''}
                </span>
                {isBest ? (
                  <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 950, color: 'var(--green-2)' }}>Top score</span>
                ) : null}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  className="btn"
                  type="button"
                  disabled={!!voteBusy}
                  onClick={() => void onVote(o.id, 'in')}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 999,
                    background: mine === 'in' ? 'rgba(45,122,58,0.22)' : 'rgba(45,122,58,0.10)',
                    borderColor: 'rgba(45,122,58,0.22)',
                    color: 'var(--green-2)',
                    fontWeight: 800,
                  }}
                >
                  {busy('in') ? '…' : `In (${c.in})`}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={!!voteBusy}
                  onClick={() => void onVote(o.id, 'maybe')}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 999,
                    fontWeight: mine === 'maybe' ? 800 : 600,
                    borderColor: mine === 'maybe' ? 'var(--border)' : 'var(--border)',
                    background: mine === 'maybe' ? 'rgba(26,46,26,0.06)' : undefined,
                  }}
                >
                  {busy('maybe') ? '…' : `If needed (${c.maybe})`}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={!!voteBusy}
                  onClick={() => void onVote(o.id, 'out')}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 999,
                    background: mine === 'out' ? 'rgba(234,88,12,0.18)' : 'rgba(234,88,12,0.10)',
                    borderColor: 'rgba(234,88,12,0.22)',
                    color: '#9a3412',
                    fontWeight: 800,
                  }}
                >
                  {busy('out') ? '…' : `Out (${c.out})`}
                </button>
                <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 4 }}>score {score(c.in, c.maybe, c.out)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
