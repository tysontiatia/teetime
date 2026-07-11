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
import { buildBookingUrl } from '../lib/bookingUrl';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { copyTextToClipboard } from '../lib/clipboard';
import { absoluteRoundUrl } from '../lib/shareUrl';
import { supabase } from '../lib/supabase';

/** Avatar chip tones — CSS variables only for theme safety. */
const AVATAR_BG = ['var(--green-2)', 'var(--green)', 'var(--pine-deep)', 'var(--green-3)'];

function computeLeading(
  options: DbRoundOption[],
  countsByOption: Map<string, { in: number; maybe: number; out: number }>,
): { option: DbRoundOption; in: number; maybe: number } | null {
  let best: { option: DbRoundOption; in: number; maybe: number } | null = null;
  for (const o of options) {
    const c = countsByOption.get(o.id) ?? { in: 0, maybe: 0, out: 0 };
    if (c.in === 0 && c.maybe === 0) continue;
    const t = o.starts_at ? new Date(o.starts_at).getTime() : Number.POSITIVE_INFINITY;
    const bestT = best?.option.starts_at ? new Date(best.option.starts_at).getTime() : Number.POSITIVE_INFINITY;
    if (
      !best ||
      c.in > best.in ||
      (c.in === best.in && c.maybe > best.maybe) ||
      (c.in === best.in && c.maybe === best.maybe && t < bestT)
    ) {
      best = { option: o, in: c.in, maybe: c.maybe };
    }
  }
  return best;
}

function bookingUrlForOption(
  o: DbRoundOption,
  playDate: string | null,
  coursesById: Map<string, { bookingUrl?: string | null; platform?: string | null }>,
  recordsBySlug: Map<string, { bookingUrl?: string | null; platform?: string | null }>,
): string | null {
  const cid = o.course_id;
  if (!cid) return o.booking_url ?? null;
  const c = coursesById.get(cid);
  const record = recordsBySlug.get(cid);
  const enriched = buildBookingUrl(
    record ?? {
      bookingUrl: o.booking_url ?? c?.bookingUrl ?? null,
      platform: c?.platform ?? null,
    },
    {
      dateYmd: o.date || playDate || '',
      players: o.players || 2,
      holes: o.holes || 18,
      startsAtIso: o.starts_at,
    },
  );
  return enriched ?? o.booking_url ?? c?.bookingUrl ?? null;
}

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
  const { user } = useAuth();
  const { courses, recordsBySlug } = useCourseCatalog();
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

  const voterCount = useMemo(() => new Set(voters.map((v) => v.voter_key)).size, [voters]);

  const leading = useMemo(
    () => computeLeading(sortedOptions, countsByOption),
    [sortedOptions, countsByOption],
  );

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

  if (loading) {
    return (
      <div className="container round-page">
        <div className="round-page-card">
          <div className="round-card">Loading vote page…</div>
        </div>
      </div>
    );
  }

  if (err && !roundId) {
    return (
      <div className="container round-page">
        <div className="round-page-card">
          <div className="round-card is-left">
            <div className="pill">Shared round</div>
            <h2 className="round-title round-title-sm">Could not open link</h2>
            <p style={{ color: 'var(--muted)' }}>{err}</p>
            <Link to="/" className="btn btn-primary" style={{ marginTop: 14 }}>
              Back to finder →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const dateBadge = playDate ? formatDateShort(playDate) : '';
  const holesLabel = sortedOptions[0] ? `${sortedOptions[0]!.holes} holes` : null;
  const playersCount = sortedOptions[0] && typeof sortedOptions[0]!.players === 'number' ? sortedOptions[0]!.players : null;

  const contextMeta = [
    dateBadge,
    playersCount != null ? `${playersCount} player${playersCount === 1 ? '' : 's'}` : null,
    holesLabel,
    heroCity || null,
    voterCount > 0 ? `${voterCount} in group` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const guestDisplayName = nameByKey.get(voterKey)?.trim() ?? '';

  return (
    <div className="container round-page">
      <div className="round-page-card">
      <div className="round-topbar">
        <Link to="/" className="pill round-back">
          ← Tee times
        </Link>
        <button
          type="button"
          className={`round-copy-btn app-header-icon-btn${copyHint === 'ok' ? ' is-active' : ''}`}
          aria-label={copyHint === 'ok' ? 'Link copied' : copyHint === 'fail' ? 'Copy failed' : 'Copy round link'}
          title={copyHint === 'ok' ? 'Copied!' : copyHint === 'fail' ? 'Copy failed' : 'Copy link'}
          onClick={() => void onCopy()}
        >
          {copyHint === 'ok' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.9" />
              <path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>

      <header className="round-context">
        <span className="pill">Shared round</span>
        <h1 className="round-context-title">{heroName}</h1>
        {contextMeta ? <p className="round-context-meta">{contextMeta}</p> : null}
        <p className="round-lede round-lede-short">
          {hostPublicName ? (
            <>
              <strong style={{ color: 'var(--ink)' }}>{hostPublicName}</strong> shared these tee times.
              {user?.id ? '. Pick a time. Your account name shows on your votes.' : ' Add your name, then vote.'}
            </>
          ) : user?.id ? (
            <>Pick a time. Your account name shows on your votes.</>
          ) : (
            <>Add your name so the group knows who voted, then pick a time.</>
          )}
        </p>
      </header>

      <div className={`round-leading${leading ? ' has-leader' : ''}`} aria-live="polite">
        {leading ? (
          <>
            <div className="round-leading-main">
              <span className="round-leading-label">Leading</span>
              <span className="round-leading-time">
                {leading.option.starts_at
                  ? formatTime12h(leading.option.starts_at)
                  : leading.option.time_display ?? 'TBD'}
              </span>
            </div>
            <div className="round-leading-counts">
              {leading.in} in · {leading.maybe} maybe
            </div>
          </>
        ) : (
          <p className="round-leading-empty">No votes yet. Be the first to pick a time.</p>
        )}
      </div>

      {!user?.id ? (
        hasGuestSavedName ? (
          <div className="round-guest-banner is-saved">
            Voting as <strong>{guestDisplayName}</strong>
          </div>
        ) : (
          <div className="round-guest-banner">
            <div className="round-guest-banner-row">
              <input
                className="input round-guest-input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Your name"
                maxLength={60}
                required
                aria-required
                aria-label="Your name"
              />
              <button
                className="btn btn-primary round-guest-save"
                type="button"
                disabled={nameBusy || !nameInput.trim()}
                onClick={() => void onSaveName()}
              >
                {nameBusy ? '…' : 'Save'}
              </button>
            </div>
            {nameMsg ? (
              <p className={`round-name-msg${nameMsg === 'Saved' ? ' is-ok' : ' is-err'}`}>{nameMsg}</p>
            ) : null}
          </div>
        )
      ) : null}

      <div className="round-split">
        <div className="round-main">
          <div className="round-alert round-alert-compact">
            <span aria-hidden>⏰</span>
            <span>Times go fast. Double-check availability before you book.</span>
          </div>

          <div className="round-vote-panel">
            <div className="round-vote-heading">Pick your time</div>

            {err ? <p className="round-err">{err}</p> : null}

            {guestVoteLocked ? (
              <p className="round-warn">Save your name above before you can vote.</p>
            ) : null}

            <div className="round-options">
              {sortedOptions.map((o) => {
                const c = countsByOption.get(o.id) ?? { in: 0, maybe: 0, out: 0 };
                const mine = myVotes.get(o.id);
                const selected = mine === 'in';
                const tIso = o.starts_at ?? null;
                const timeLabel = tIso ? formatTime12h(tIso) : o.time_display;
                const inVoters = votersInForOption(votes, o.id, nameByKey);
                const busy = (s: string) => voteBusy === o.id + s;
                const playersNeeded = typeof o.players === 'number' && o.players > 0 ? o.players : null;
                const quorumMet = playersNeeded != null && inVoters.length >= playersNeeded;
                const bookHref = quorumMet
                  ? bookingUrlForOption(o, playDate, coursesById, recordsBySlug)
                  : null;

                return (
                  <div key={o.id} className={`round-option${selected ? ' is-selected' : ''}`}>
                    <div className="round-option-head">
                      <div className="round-option-time">{timeLabel}</div>
                      <div className="round-option-price">{o.price ? `$${o.price}` : '—'}</div>
                    </div>
                    <div className="round-option-tags">
                      {typeof o.players === 'number' ? (
                        <span className="pill round-pill-players">{o.players} players</span>
                      ) : null}
                      <span className="pill" style={{ fontSize: 11 }}>
                        {o.holes} holes
                      </span>
                    </div>
                    <div className="round-option-voters">
                      {inVoters.length === 0 ? (
                        <span style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No “in” votes yet</span>
                      ) : (
                        inVoters.map(({ key, name }, idx) => (
                          <div key={key} className={`round-voter-chip${key === voterKey ? ' is-self' : ''}`}>
                            <div
                              className="round-avatar round-avatar-sm"
                              style={{ background: AVATAR_BG[idx % AVATAR_BG.length] }}
                            >
                              {initialLetter(name)}
                            </div>
                            <span className="round-voter-name">{key === voterKey ? 'You' : name}</span>
                          </div>
                        ))
                      )}
                    </div>
                    {quorumMet ? (
                      <div className="round-quorum">
                        <p className="round-quorum-copy">
                          {inVoters.length} of {playersNeeded} in. Enough to fill this tee time. Have{' '}
                          <strong style={{ color: 'var(--ink)' }}>one person book</strong> on the course site, then everyone else joins that booking.
                        </p>
                        {bookHref ? (
                          <a
                            className="btn btn-primary round-quorum-book"
                            href={bookHref}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Book this time →
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="round-vote-actions">
                      <button
                        className={`btn round-vote-btn round-vote-btn-in${mine === 'in' ? ' is-on' : ''}`}
                        type="button"
                        disabled={!!voteBusy || guestVoteLocked}
                        onClick={() => void onVote(o.id, 'in')}
                      >
                        {busy('in') ? '…' : (
                          <>
                            In
                            {c.in > 0 ? <span className="round-vote-count">{c.in}</span> : null}
                          </>
                        )}
                      </button>
                      <button
                        className={`btn round-vote-btn round-vote-btn-maybe${mine === 'maybe' ? ' is-on' : ''}`}
                        type="button"
                        disabled={!!voteBusy || guestVoteLocked}
                        onClick={() => void onVote(o.id, 'maybe')}
                      >
                        {busy('maybe') ? '…' : (
                          <>
                            Maybe
                            {c.maybe > 0 ? <span className="round-vote-count">{c.maybe}</span> : null}
                          </>
                        )}
                      </button>
                      <button
                        className={`btn round-vote-btn round-vote-btn-out${mine === 'out' ? ' is-on' : ''}`}
                        type="button"
                        disabled={!!voteBusy || guestVoteLocked}
                        onClick={() => void onVote(o.id, 'out')}
                      >
                        {busy('out') ? '…' : (
                          <>
                            Out
                            {c.out > 0 ? <span className="round-vote-count">{c.out}</span> : null}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="btn round-cant-btn"
              disabled={voteBusy === 'CANT' || options.length === 0 || guestVoteLocked}
              onClick={() => void onCantMakeRound()}
            >
              <span style={{ fontSize: 14, color: 'var(--muted)' }}>Can’t make it this round</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{voteBusy === 'CANT' ? '…' : 'Mark out on all times'}</span>
            </button>
          </div>

          <Link to="/" className="btn btn-ghost round-share-another">
            Share another round →
          </Link>
        </div>

        <aside className="round-aside" aria-label="Round details">
          <div className="round-panel">
            <div
              className={`round-hero${heroPhoto ? ' has-photo' : ''}`}
              style={heroPhoto ? { backgroundImage: `url(${heroPhoto})` } : undefined}
            >
              {heroPhoto ? <div className="round-hero-scrim" aria-hidden /> : null}
              <div className="round-hero-body">
                {dateBadge ? (
                  <div style={{ marginBottom: 8 }}>
                    <span className="pill round-hero-pill">{dateBadge}</span>
                  </div>
                ) : null}
                <div className="round-hero-name">{heroName}</div>
                {heroCity ? <div className="round-hero-city">{heroCity}</div> : null}
              </div>
            </div>
            <div className="round-invite-bar">
              <div className="round-avatar-stack">
                {inviteAvatars.length === 0 ? (
                  <div className="round-avatar is-empty" aria-hidden>
                    ·
                  </div>
                ) : (
                  inviteAvatars.map((n, i) => (
                    <div
                      key={`${n}-${i}`}
                      className="round-avatar"
                      style={{ background: AVATAR_BG[i % AVATAR_BG.length], marginLeft: i === 0 ? 0 : undefined }}
                    >
                      {initialLetter(n)}
                    </div>
                  ))
                )}
              </div>
              <div className="round-invite-copy">
                {inviteAvatars.length === 0 ? 'Be the first to join this vote.' : `${voterCount} in the group`}
              </div>
            </div>
          </div>
        </aside>
      </div>
      </div>
    </div>
  );
}
