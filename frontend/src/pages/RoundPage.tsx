import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { profileDisplayNameFromUser } from '../lib/profileDisplayName';
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

/** Avatar chips — stay in the green brand range (no rainbow). */
const AVATAR_BG = ['var(--green-2)', 'var(--green)', '#2f5a36', '#3d7348'];

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

function panelStyle(): CSSProperties {
  return {
    border: '1px solid var(--border)',
    borderRadius: 18,
    background: 'rgba(255,255,255,0.88)',
    overflow: 'hidden',
  };
}

export function RoundPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
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

  /** Signed-in users: create voter row from profile (uses getSession user so this callback stays stable). */
  const ensureSignedInDisplay = useCallback(async (): Promise<boolean> => {
    if (!roundId) return true;
    const { data: auth } = await supabase.auth.getUser();
    const u = auth.user;
    if (!u?.id) return true;
    const vr = await fetchVotersForRound(roundId);
    const names = votersByKey(vr);
    if (names.get(voterKey)?.trim()) return true;
    const name = profileDisplayNameFromUser(u);
    const res = await upsertVoterName({ roundId, voterKey, displayName: name, userId: u.id });
    if (!res.ok) {
      setErr(res.message);
      return false;
    }
    setNameInput(name);
    await refreshVotes();
    return true;
  }, [roundId, voterKey, refreshVotes]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (loading || !roundId || !user?.id) return;
    void ensureSignedInDisplay();
  }, [loading, roundId, user?.id, ensureSignedInDisplay]);

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
  const hasGuestSavedName = !!nameByKey.get(voterKey)?.trim();
  /** Guests must save a display name once before voting (signed-in users use their account name only). */
  const guestVoteLocked = !user?.id && !hasGuestSavedName;

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
    if (!(await ensureSignedInDisplay())) return;
    if (!user?.id) {
      const vr = await fetchVotersForRound(roundId);
      if (!votersByKey(vr).get(voterKey)?.trim()) {
        setErr('Save your name before voting.');
        return;
      }
    }
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
    if (!(await ensureSignedInDisplay())) return;
    if (!user?.id) {
      const vr = await fetchVotersForRound(roundId);
      if (!votersByKey(vr).get(voterKey)?.trim()) {
        setErr('Save your name first.');
        return;
      }
    }
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

  const cardShell = {
    padding: 18,
    borderRadius: 18,
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.92)',
    textAlign: 'center' as const,
    color: 'var(--muted)',
  };

  if (loading) {
    return (
      <div className="container" style={{ padding: '24px 0' }}>
        <div style={cardShell}>Loading vote page…</div>
      </div>
    );
  }

  if (err && !roundId) {
    return (
      <div className="container" style={{ padding: '24px 0' }}>
        <div style={{ ...cardShell, textAlign: 'left' }}>
          <div className="pill">Shared round</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 28, letterSpacing: '-0.03em' }}>Could not open link</h2>
          <p style={{ color: 'var(--muted)' }}>{err}</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 14 }}>
            Back to finder →
          </Link>
        </div>
      </div>
    );
  }

  const dateBadge = playDate ? formatDateShort(playDate) : '';
  const holesLabel = sortedOptions[0] ? `${sortedOptions[0]!.holes} holes` : null;

  return (
    <div className="container" style={{ padding: '18px 0 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <Link to="/" className="pill">
            ← Tee times
          </Link>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            {heroName}
            {heroCity ? (
              <span style={{ color: 'var(--muted)', fontWeight: 700 }}>
                {' '}
                ({heroCity})
              </span>
            ) : null}
          </h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="pill">Shared round</span>
            {dateBadge ? <span className="pill">{dateBadge}</span> : null}
            {holesLabel ? <span className="pill">{holesLabel}</span> : null}
            {sortedOptions[0] && typeof sortedOptions[0]!.players === 'number' ? (
              <span className="pill">
                {sortedOptions[0]!.players} player{sortedOptions[0]!.players === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>
          <p style={{ marginTop: 10, fontSize: 14, color: 'var(--muted)', maxWidth: 640 }}>
            {hostPublicName ? (
              <>
                <strong style={{ color: 'var(--ink)' }}>{hostPublicName}</strong> shared these tee times
                {user?.id ? (
                  <> — you’re signed in; we use your Google account name for your votes.</>
                ) : (
                  <> — add your name and save it, then you can vote.</>
                )}
              </>
            ) : user?.id ? (
              <>You’re signed in — we use your Google account name for your votes. Pick a time.</>
            ) : (
              <>Add your name and save it so the group knows who voted — then you can vote.</>
            )}
          </p>
        </div>
        <button className="btn btn-ghost" type="button" onClick={() => void onCopy()} style={{ padding: '8px 14px', flexShrink: 0 }}>
          {copyHint === 'ok' ? 'Copied!' : copyHint === 'fail' ? 'Copy failed' : 'Copy link'}
        </button>
      </div>

      <div className="split-two" style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'minmax(0, 1.08fr) minmax(0, 1fr)', gap: 14 }}>
        <div style={panelStyle()}>
          <div
            style={{
              position: 'relative',
              minHeight: 220,
              background: heroPhoto
                ? `url(${heroPhoto}) center/cover`
                : 'linear-gradient(145deg, var(--green) 0%, var(--green-2) 55%, var(--green-3) 100%)',
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
                background: heroPhoto ? 'linear-gradient(to bottom, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0.52) 100%)' : undefined,
              }}
            />
            <div style={{ position: 'relative', zIndex: 1 }}>
              {dateBadge ? (
                <div style={{ marginBottom: 8 }}>
                  <span className="pill" style={{ background: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.35)', color: '#fff' }}>
                    {dateBadge}
                  </span>
                </div>
              ) : null}
              <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>{heroName}</div>
              {heroCity ? <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.82)', marginTop: 4 }}>{heroCity}</div> : null}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '14px 16px',
              borderTop: '1px solid var(--border)',
              background: '#fff',
            }}
          >
            <div style={{ display: 'flex' }}>
              {inviteAvatars.length === 0 ? (
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'var(--green-soft)',
                    border: '2px solid #fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 800,
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
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      marginLeft: i === 0 ? 0 : -8,
                      background: AVATAR_BG[i % AVATAR_BG.length],
                      border: '2px solid #fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#fff',
                    }}
                  >
                    {initialLetter(n)}
                  </div>
                ))
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1, lineHeight: 1.4 }}>
              {inviteAvatars.length === 0 ? 'Be the first to join this vote.' : `${inviteAvatars.length} in the group so far`}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {!user?.id ? (
            <div style={{ padding: 16, ...panelStyle(), background: '#fff' }}>
              <div style={{ fontWeight: 900, letterSpacing: '-0.02em', marginBottom: 6 }}>Your name</div>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
                Required before you vote — shown next to your picks so friends recognize you.
              </p>
              <input
                className="input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="First name or nickname"
                maxLength={60}
                required
                aria-required
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
                <p style={{ marginTop: 8, fontSize: 13, color: nameMsg === 'Saved' ? 'var(--green-2)' : '#9a3412' }}>{nameMsg}</p>
              ) : null}
            </div>
          ) : null}

          <div
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              border: '1px solid rgba(180,130,40,0.28)',
              background: 'rgba(255,251,235,0.95)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#92400e', lineHeight: 1.45 }}>
              <span aria-hidden>⏰</span>
              Times go fast — double-check availability before you book.
            </div>
          </div>

          <div style={{ padding: 16, borderRadius: 18, border: '1px solid var(--border)', background: 'rgba(248,250,248,0.75)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Pick your time
              </span>
            </div>

            {err ? (
              <p style={{ color: '#9a3412', fontSize: 13, marginBottom: 10 }}>{err}</p>
            ) : null}

            {guestVoteLocked ? (
              <p style={{ color: '#92400e', fontSize: 13, marginBottom: 10, lineHeight: 1.45 }}>
                Save your name above before you can vote on times.
              </p>
            ) : null}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                      <div style={{ fontSize: 20, fontWeight: 800, color: selected ? 'var(--green-2)' : 'var(--ink)', fontFamily: 'var(--font-display)' }}>{timeLabel}</div>
                      <div style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 700 }}>{o.price ? `$${o.price}` : '—'}</div>
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
                                background: AVATAR_BG[idx % AVATAR_BG.length],
                                color: '#fff',
                                fontSize: 9,
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {initialLetter(name)}
                            </div>
                            <span style={{ fontSize: 11, color: key === voterKey ? 'var(--green-2)' : 'var(--muted)', fontWeight: key === voterKey ? 700 : 600 }}>
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
                        disabled={!!voteBusy || guestVoteLocked}
                        onClick={() => void onVote(o.id, 'in')}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 800,
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
                        disabled={!!voteBusy || guestVoteLocked}
                        onClick={() => void onVote(o.id, 'maybe')}
                        style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: mine === 'maybe' ? 800 : 600 }}
                      >
                        {busy('maybe') ? '…' : `If needed (${c.maybe})`}
                      </button>
                      <button
                        className="btn"
                        type="button"
                        disabled={!!voteBusy || guestVoteLocked}
                        onClick={() => void onVote(o.id, 'out')}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 800,
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
            </div>

            <button
              type="button"
              className="btn"
              disabled={voteBusy === 'CANT' || options.length === 0 || guestVoteLocked}
              onClick={() => void onCantMakeRound()}
              style={{
                width: '100%',
                marginTop: 12,
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
          </div>

          {bookingUrls.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {bookingUrls.map(([cid, url]) => {
                const c = coursesById.get(cid);
                return (
                  <a key={cid} className="btn btn-primary" href={url} target="_blank" rel="noreferrer" style={{ width: '100%', textAlign: 'center', padding: '12px 16px' }}>
                    Book {c?.name ?? 'course'} →
                  </a>
                );
              })}
            </div>
          ) : null}

          <Link to="/" className="btn btn-ghost" style={{ textAlign: 'center', fontSize: 14 }}>
            Share another round →
          </Link>
        </div>
      </div>
    </div>
  );
}
