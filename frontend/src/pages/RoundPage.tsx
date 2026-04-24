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
  type DbRound,
  type DbRoundOption,
  type DbRoundVote,
  type DbRoundVoter,
} from '../lib/roundsApi';
import { getOrCreateVoterKey } from '../lib/voterKey';
import { formatDateShort, formatTime12h } from '../lib/time';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { copyTextToClipboard } from '../lib/clipboard';
import { absoluteRoundUrl } from '../lib/shareUrl';
import { supabase } from '../lib/supabase';

const CHIP_BG = ['#185FA5', '#3B6D11', '#993C1D', '#534AB7', '#2d7a3a', '#7c3aed'];

function initialLetter(name: string): string {
  const t = name.trim();
  return t ? t[0]!.toUpperCase() : '?';
}

function votersInForOption(votes: DbRoundVote[], optionId: string, nameByKey: Map<string, string>): { key: string; name: string }[] {
  const seen = new Set<string>();
  const out: { key: string; name: string }[] = [];
  for (const v of votes) {
    if (v.option_id !== optionId || v.status !== 'in') continue;
    if (seen.has(v.voter_key)) continue;
    seen.add(v.voter_key);
    out.push({ key: v.voter_key, name: nameByKey.get(v.voter_key) ?? 'Someone' });
  }
  return out;
}

export function RoundPage() {
  const { slug } = useParams<{ slug: string }>();
  const { courses } = useCourseCatalog();
  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [playDate, setPlayDate] = useState<string | null>(null);
  const [hostPublicName, setHostPublicName] = useState<string | null>(null);
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
    const round = (await fetchRoundBySlug(slug)) as DbRound | null;
    if (!round?.id) {
      setErr('This round link is invalid or expired.');
      setLoading(false);
      return;
    }
    setRoundId(round.id);
    setPlayDate(round.play_date);
    setHostPublicName(round.host_public_name ?? null);
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

  const sortedOptions = useMemo(() => {
    return [...options].sort((a, b) => {
      const ta = a.starts_at ? new Date(a.starts_at).getTime() : 0;
      const tb = b.starts_at ? new Date(b.starts_at).getTime() : 0;
      return ta - tb;
    });
  }, [options]);

  const primaryCourseId = sortedOptions[0]?.course_id ?? null;
  const heroCourse = primaryCourseId ? coursesById.get(primaryCourseId) ?? null : null;
  const heroName = heroCourse?.name ?? sortedOptions[0]?.course_name ?? 'Golf round';
  const heroCity = heroCourse?.city ?? '';
  const heroPhoto = heroCourse?.photoUrl;

  const inviteAvatars = useMemo(() => {
    const names = [...new Set(voters.map((v) => v.display_name).filter(Boolean))].slice(0, 4);
    return names;
  }, [voters]);

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

  const onCantMakeRound = async () => {
    if (!roundId || options.length === 0) return;
    setVoteBusy('CANT');
    for (const o of options) {
      const res = await upsertVote({ roundId, optionId: o.id, voterKey, status: 'out' });
      if (!res.ok) {
        setErr(res.message);
        setVoteBusy(null);
        return;
      }
    }
    setVoteBusy(null);
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

  const screen = {
    maxWidth: 400,
    margin: '0 auto',
    borderRadius: 20,
    overflow: 'hidden',
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.96)',
    boxShadow: '0 12px 40px rgba(26,46,26,0.12)',
  } as const;

  if (loading) {
    return (
      <div className="container" style={{ padding: '24px 12px' }}>
        <div style={{ ...screen, padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Loading vote page…</div>
      </div>
    );
  }

  if (err && !roundId) {
    return (
      <div className="container" style={{ padding: '24px 12px' }}>
        <div style={{ ...screen, padding: 22 }}>
          <div className="pill">Group vote</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 24 }}>Could not open link</h2>
          <p style={{ color: 'var(--muted)' }}>{err}</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 14 }}>
            Back to finder →
          </Link>
        </div>
      </div>
    );
  }

  const dateBadge = playDate ? formatDateShort(playDate) : '';

  return (
    <div className="container" style={{ padding: '18px 12px 48px' }}>
      <div style={screen}>
        <div
          style={{
            position: 'relative',
            minHeight: 148,
            background: heroPhoto ? `url(${heroPhoto}) center/cover` : '#2d4a3e',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: 16,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.55) 100%)',
            }}
          />
          <div style={{ position: 'relative', zIndex: 1 }}>
            {dateBadge ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'rgba(255,255,255,0.15)',
                  border: '0.5px solid rgba(255,255,255,0.35)',
                  borderRadius: 20,
                  padding: '4px 10px',
                  fontSize: 11,
                  color: '#fff',
                  marginBottom: 8,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80' }} />
                {dateBadge}
              </div>
            ) : null}
            <div style={{ fontSize: 19, fontWeight: 600, color: '#fff', lineHeight: 1.2 }}>{heroName}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)', marginTop: 4 }}>
              {[heroCity, sortedOptions[0] ? `${sortedOptions[0]!.holes} holes` : null].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            background: '#fff',
          }}
        >
          <div style={{ display: 'flex' }}>
            {inviteAvatars.length === 0 ? (
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'var(--green-soft)',
                  border: '2px solid #fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--green-2)',
                }}
              >
                ·
              </div>
            ) : (
              inviteAvatars.map((n, i) => (
                <div
                  key={`${n}-${i}`}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    marginLeft: i === 0 ? 0 : -6,
                    background: CHIP_BG[i % CHIP_BG.length],
                    border: '2px solid #fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.92)',
                  }}
                >
                  {initialLetter(n)}
                </div>
              ))
            )}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1, lineHeight: 1.35 }}>
            {hostPublicName ? (
              <>
                <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{hostPublicName}</strong> shared tee times — vote for a time
              </>
            ) : (
              <>
                <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>Your group</strong> is picking a tee time
              </>
            )}
          </div>
        </div>

        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: '#fffbeb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#854f0b' }}>
            <span aria-hidden>⏰</span>
            Times go fast — double-check availability before you book.
          </div>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: '#f6f7f6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Pick your time
            </span>
            <button className="btn btn-ghost" type="button" onClick={() => void onCopy()} style={{ padding: '4px 10px', fontSize: 12 }}>
              {copyHint === 'ok' ? 'Copied!' : copyHint === 'fail' ? 'Copy failed' : 'Copy link'}
            </button>
          </div>

          {err ? (
            <p style={{ color: '#9a3412', fontSize: 13 }}>{err}</p>
          ) : null}

          {sortedOptions.map((o) => {
            const c = countsByOption.get(o.id) ?? { in: 0, maybe: 0, out: 0 };
            const mine = myVotes.get(o.id);
            const selected = mine === 'in';
            const tIso = o.starts_at ?? null;
            const timeLabel = tIso ? formatTime12h(tIso) : o.time_display;
            const inVoters = votersInForOption(votes, o.id, nameByKey);
            const busy = (s: string) => voteBusy === o.id + s;

            return (
              <div
                key={o.id}
                style={{
                  background: '#fff',
                  border: selected ? '2px solid var(--green-2)' : '1px solid var(--border)',
                  borderRadius: 14,
                  padding: '14px 16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 20, fontWeight: 600, color: selected ? 'var(--green-2)' : 'var(--ink)' }}>{timeLabel}</div>
                  <div style={{ fontSize: 14, color: 'var(--muted)' }}>{o.price ? `$${o.price}` : '—'}</div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {typeof o.players === 'number' ? (
                    <span className="pill" style={{ fontSize: 11, background: 'rgba(233,245,234,0.9)', color: 'var(--green-2)' }}>
                      {o.players} players
                    </span>
                  ) : null}
                  <span className="pill" style={{ fontSize: 11 }}>
                    {o.holes} holes
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  {inVoters.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No “in” votes yet</span>
                  ) : (
                    inVoters.map(({ key, name }, idx) => (
                      <div
                        key={key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          background: key === voterKey ? 'rgba(233,245,234,0.95)' : 'rgba(248,250,248,0.95)',
                          borderRadius: 20,
                          padding: '3px 8px 3px 4px',
                          border: key === voterKey ? '1px solid rgba(45,122,58,0.35)' : '1px solid var(--border)',
                        }}
                      >
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: CHIP_BG[idx % CHIP_BG.length],
                            color: '#fff',
                            fontSize: 9,
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {initialLetter(name)}
                        </div>
                        <span style={{ fontSize: 11, color: key === voterKey ? 'var(--green-2)' : 'var(--muted)', fontWeight: key === voterKey ? 700 : 500 }}>
                          {key === voterKey ? 'You' : name}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="btn"
                    type="button"
                    disabled={!!voteBusy}
                    onClick={() => void onVote(o.id, 'in')}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      background: mine === 'in' ? 'rgba(45,122,58,0.22)' : 'rgba(45,122,58,0.10)',
                      borderColor: 'rgba(45,122,58,0.25)',
                      color: 'var(--green-2)',
                    }}
                  >
                    {busy('in') ? '…' : `In (${c.in})`}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={!!voteBusy}
                    onClick={() => void onVote(o.id, 'maybe')}
                    style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: mine === 'maybe' ? 700 : 600 }}
                  >
                    {busy('maybe') ? '…' : `If needed (${c.maybe})`}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={!!voteBusy}
                    onClick={() => void onVote(o.id, 'out')}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      background: mine === 'out' ? 'rgba(234,88,12,0.18)' : 'rgba(234,88,12,0.08)',
                      borderColor: 'rgba(234,88,12,0.22)',
                      color: '#9a3412',
                    }}
                  >
                    {busy('out') ? '…' : `Out (${c.out})`}
                  </button>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            className="btn"
            disabled={voteBusy === 'CANT' || options.length === 0}
            onClick={() => void onCantMakeRound()}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 14,
              background: '#fff',
              border: '1px solid var(--border)',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 14, color: 'var(--muted)' }}>Can’t make it this round</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{voteBusy === 'CANT' ? '…' : 'Mark out on all times'}</span>
          </button>

          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Your name (so the group knows it’s you)</div>
            <input
              className="input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="First name"
              maxLength={60}
              style={{ width: '100%' }}
            />
            <button
              className="btn btn-primary"
              type="button"
              disabled={nameBusy || !nameInput.trim()}
              onClick={() => void onSaveName()}
              style={{ width: '100%', marginTop: 10, padding: 12, borderRadius: 12 }}
            >
              {nameBusy ? 'Saving…' : 'Save name'}
            </button>
            {nameMsg ? (
              <p style={{ marginTop: 8, fontSize: 12, color: nameMsg === 'Saved' ? 'var(--green-2)' : '#9a3412' }}>{nameMsg}</p>
            ) : null}
          </div>

          {bookingUrls.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {bookingUrls.map(([cid, url]) => {
                const c = coursesById.get(cid);
                return (
                  <a key={cid} className="btn btn-primary" href={url} target="_blank" rel="noreferrer" style={{ width: '100%', textAlign: 'center' }}>
                    Book {c?.name ?? 'course'} →
                  </a>
                );
              })}
            </div>
          ) : null}

          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45, textAlign: 'center' }}>
            Votes can update live for everyone on this link when Realtime is enabled in Supabase for <code style={{ fontSize: 10 }}>round_option_votes</code> and{' '}
            <code style={{ fontSize: 10 }}>round_voters</code>.
          </p>

          <Link to="/" className="btn btn-ghost" style={{ width: '100%', textAlign: 'center', fontSize: 13 }}>
            Share another round →
          </Link>
        </div>
      </div>
    </div>
  );
}
