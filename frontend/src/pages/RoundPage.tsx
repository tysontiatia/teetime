import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  aggregateVotes,
  fetchRoundBySlug,
  fetchRoundOptions,
  fetchVotesForRound,
  fetchVotersForRound,
  upsertVote,
  upsertVoterName,
  voteForVoter,
  votersByKey,
  type DbRoundOption,
  type DbRoundVote,
  type DbRoundVoter,
} from '../lib/roundsApi';
import { getOrCreateVoterKey } from '../lib/voterKey';
import { formatDateShort, formatTime12h } from '../lib/time';
import type { Course } from '../types';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { copyTextToClipboard } from '../lib/clipboard';
import { absoluteRoundUrl } from '../lib/shareUrl';
import { supabase } from '../lib/supabase';

function score(in_: number, maybe: number, out: number) {
  return in_ * 3 + maybe * 1 - out * 2;
}

function groupOptionsByCourse(opts: DbRoundOption[], coursesById: Map<string, Course>) {
  const order: string[] = [];
  const by = new Map<string, DbRoundOption[]>();
  for (const o of opts) {
    const cid = o.course_id ?? '';
    if (!by.has(cid)) {
      by.set(cid, []);
      order.push(cid);
    }
    by.get(cid)!.push(o);
  }
  return order.map((cid) => ({
    courseId: cid || null,
    label: cid
      ? (() => {
          const c = coursesById.get(cid);
          return c ? `${c.name} (${c.city})` : opts.find((x) => x.course_id === cid)?.course_name ?? cid;
        })()
      : 'Courses',
    rows: by.get(cid)!,
  }));
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
  const [options, setOptions] = useState<DbRoundOption[]>([]);
  const [votes, setVotes] = useState<DbRoundVote[]>([]);
  const [voters, setVoters] = useState<DbRoundVoter[]>([]);
  const [voteBusy, setVoteBusy] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [nameInput, setNameInput] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  const voterKey = useMemo(() => getOrCreateVoterKey(), []);

  const loadAll = useCallback(async () => {
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
    const [opts, v, vr] = await Promise.all([
      fetchRoundOptions(round.id),
      fetchVotesForRound(round.id),
      fetchVotersForRound(round.id),
    ]);
    setOptions(opts);
    setVotes(v);
    setVoters(vr);
    const names = votersByKey(vr);
    setNameInput(names.get(voterKey) ?? '');
    setLoading(false);
  }, [slug, voterKey]);

  const refreshVotes = useCallback(async () => {
    if (!roundId) return;
    const [v, vr] = await Promise.all([fetchVotesForRound(roundId), fetchVotersForRound(roundId)]);
    setVotes(v);
    setVoters(vr);
  }, [roundId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!roundId) return;
    const channel = supabase
      .channel(`round-live-${roundId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'round_option_votes', filter: `round_id=eq.${roundId}` },
        () => {
          void refreshVotes();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'round_voters', filter: `round_id=eq.${roundId}` },
        () => {
          void refreshVotes();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roundId, refreshVotes]);

  const countsByOption = useMemo(() => aggregateVotes(votes), [votes]);
  const myVotes = useMemo(() => voteForVoter(votes, voterKey), [votes, voterKey]);
  const nameByKey = useMemo(() => votersByKey(voters), [voters]);

  const sections = useMemo(
    () => groupOptionsByCourse(options, coursesById),
    [options, coursesById],
  );

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
    await refreshVotes();
  };

  const onSaveName = async () => {
    if (!roundId) return;
    setNameBusy(true);
    setNameMsg(null);
    const res = await upsertVoterName({ roundId, voterKey, displayName: nameInput });
    setNameBusy(false);
    if (!res.ok) {
      setNameMsg(res.message);
      return;
    }
    setNameMsg('Saved');
    window.setTimeout(() => setNameMsg(null), 2000);
    await refreshVotes();
  };

  const onCopy = async () => {
    if (!slug) return;
    const url = absoluteRoundUrl(slug.trim().toLowerCase());
    const ok = await copyTextToClipboard(url);
    setCopyHint(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopyHint('idle'), 2200);
  };

  const bookingUrls = useMemo(() => {
    const u = new Map<string, string>();
    for (const o of options) {
      const cid = o.course_id;
      if (cid && o.booking_url) u.set(cid, o.booking_url);
      else if (cid) {
        const c = coursesById.get(cid);
        if (c?.bookingUrl) u.set(cid, c.bookingUrl);
      }
    }
    return [...u.entries()];
  }, [options, coursesById]);

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
          <div className="pill">Group vote</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>{title}</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', color: 'var(--muted)' }}>
            {playDate ? <span className="pill">{formatDateShort(playDate)}</span> : null}
            <span className="pill">
              {options.length} time{options.length === 1 ? '' : 's'} · {sections.length} course{sections.length === 1 ? '' : 's'}
            </span>
            {voters.length > 0 ? <span className="pill">{voters.length} voter{voters.length === 1 ? '' : 's'}</span> : null}
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
            Your vote list →
          </Link>
        </div>
      </div>

      {err ? (
        <p style={{ marginTop: 10, color: '#9a3412', fontSize: 14 }}>
          {err}
        </p>
      ) : null}

      <div
        style={{
          marginTop: 12,
          padding: '12px 14px',
          borderRadius: 14,
          border: '1px solid var(--border)',
          background: 'rgba(255,255,255,0.75)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'flex-end',
          maxWidth: 720,
        }}
      >
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: 'var(--subtle)', marginBottom: 6 }}>Your name</label>
          <input
            className="input"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="e.g. Tyler"
            maxLength={60}
          />
        </div>
        <button className="btn btn-primary" type="button" disabled={nameBusy} onClick={() => void onSaveName()}>
          {nameBusy ? 'Saving…' : 'Save name'}
        </button>
        {nameMsg ? <span style={{ fontSize: 13, color: nameMsg === 'Saved' ? 'var(--green-2)' : '#9a3412' }}>{nameMsg}</span> : null}
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
        <strong style={{ color: 'var(--ink)' }}>Votes update live</strong> for everyone with this link (enable Realtime on <code style={{ fontSize: 13 }}>round_option_votes</code> &{' '}
        <code style={{ fontSize: 13 }}>round_voters</code> in Supabase if needed). One vote per time per browser — change anytime. Re-check availability before booking.
      </p>

      {bookingUrls.length > 0 ? (
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {bookingUrls.map(([cid, url]) => {
            const c = coursesById.get(cid);
            return (
              <a key={cid} className="btn btn-primary" href={url} target="_blank" rel="noreferrer" style={{ fontSize: 14 }}>
                Book {c?.name ?? 'course'} →
              </a>
            );
          })}
        </div>
      ) : null}

      <div style={{ marginTop: 18, display: 'grid', gap: 20 }}>
        {sections.map((sec) => (
          <div key={sec.courseId ?? 'x'}>
            <div style={{ fontSize: 13, fontWeight: 950, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              {sec.label}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {sec.rows.map((o) => {
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
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
                      Votes:{' '}
                      {[...votes]
                        .filter((v) => v.option_id === o.id)
                        .map((v) => nameByKey.get(v.voter_key) ?? 'Someone')
                        .filter((n, i, a) => a.indexOf(n) === i)
                        .join(', ') || '—'}
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
        ))}
      </div>
    </div>
  );
}
