import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { fetchRoundsForUser, hideRoundFromMyList, type DbRound } from '../lib/roundsApi';
import { formatDateShort, todayYmdUtah } from '../lib/time';
import { absoluteRoundUrl } from '../lib/shareUrl';
import { copyTextToClipboard } from '../lib/clipboard';

function RoundListItem({
  round,
  userId,
  busyId,
  copyId,
  onCopy,
  onRemove,
}: {
  round: DbRound;
  userId: string;
  busyId: string | null;
  copyId: string | null;
  onCopy: (slug: string, id: string) => void;
  onRemove: (id: string) => void;
}) {
  const slug = round.share_slug?.trim();
  if (!slug) return null;
  const title = round.title?.trim() || 'Golf round';
  const dateLabel = round.play_date ? formatDateShort(round.play_date) : '—';
  const voteUrl = absoluteRoundUrl(slug);
  const hosted = round.organizer_id === userId;
  const busy = busyId === round.id;

  return (
    <li className="plan-round-item">
      <div className="plan-round-item-body">
        <div className="plan-round-item-topline">
          <div className="plan-round-item-title">{title}</div>
          <span className={`pill${hosted ? ' plan-pill-hosted' : ' plan-pill-joined'}`}>
            {hosted ? 'You hosted' : 'You joined'}
          </span>
        </div>
        <div className="plan-round-item-meta">Play {dateLabel}</div>
        <div className="plan-round-item-url" title={voteUrl}>
          {voteUrl}
        </div>
      </div>
      <div className="plan-round-item-actions">
        <Link className="btn btn-primary plan-round-action-btn" to={`/round/${slug}`}>
          Open vote
        </Link>
        <button className="btn plan-round-action-btn" type="button" onClick={() => onCopy(slug, round.id)}>
          {copyId === round.id ? 'Copied' : 'Copy link'}
        </button>
        <button
          className="btn plan-round-action-btn plan-round-remove"
          type="button"
          disabled={busy}
          onClick={() => onRemove(round.id)}
        >
          {busy ? '…' : 'Remove'}
        </button>
      </div>
    </li>
  );
}

export function PlanPage() {
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const [rounds, setRounds] = useState<DbRound[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [copyId, setCopyId] = useState<string | null>(null);
  const [copyErr, setCopyErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);

  const todayYmd = todayYmdUtah();

  const { upcoming, past } = useMemo(() => {
    const up: DbRound[] = [];
    const pa: DbRound[] = [];
    for (const r of rounds) {
      if (r.play_date && r.play_date < todayYmd) pa.push(r);
      else up.push(r);
    }
    return { upcoming: up, past: pa };
  }, [rounds, todayYmd]);

  const load = useCallback(async () => {
    if (!user?.id) {
      setRounds([]);
      return;
    }
    setLoading(true);
    setLoadErr(null);
    setCopyErr(null);
    try {
      const rows = await fetchRoundsForUser(user.id);
      setRounds(rows);
    } catch {
      setLoadErr('Could not load your shared rounds.');
      setRounds([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCopy = async (slug: string, id: string) => {
    setCopyErr(null);
    const url = absoluteRoundUrl(slug);
    const ok = await copyTextToClipboard(url);
    setCopyId(id);
    window.setTimeout(() => setCopyId((c) => (c === id ? null : c)), 2000);
    if (!ok) setCopyErr('Clipboard blocked. Open the vote page and copy from the address bar.');
  };

  const onRemove = async (id: string) => {
    if (!user?.id) return;
    setBusyId(id);
    setFlash(null);
    const res = await hideRoundFromMyList(user.id, id);
    setBusyId(null);
    if (!res.ok) {
      setCopyErr(res.message);
      return;
    }
    setRounds((prev) => prev.filter((r) => r.id !== id));
    setFlash('Removed from your list. The vote link still works for anyone who has it.');
    window.setTimeout(() => setFlash(null), 4000);
  };

  return (
    <div className="container plan-page">
      <div className="plan-page-card">
        <div className="pill">Shared rounds</div>
        <h2 className="plan-page-title">Your vote links</h2>
        <p className="plan-page-lede">
          Rounds you <strong>host</strong> or <strong>join</strong> while signed in. Past play dates drop out of the
          main list automatically. Remove hides a round for you only — the vote link stays live.
        </p>

        {authLoading ? (
          <p className="plan-page-status">Loading account…</p>
        ) : !user ? (
          <div className="plan-page-signed-out">
            <p className="plan-page-status">
              Sign in to host vote links and see rounds you join. Google sign-in is free.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => void signInWithGoogle()}>
              Continue with Google
            </button>
          </div>
        ) : loading ? (
          <p className="plan-page-status">Loading your rounds…</p>
        ) : loadErr ? (
          <p className="plan-page-err">{loadErr}</p>
        ) : upcoming.length === 0 && past.length === 0 ? (
          <p className="plan-page-status">
            No rounds here yet. Host one from search, or open a friend’s vote link while signed in to save it.
          </p>
        ) : (
          <>
            {upcoming.length === 0 ? (
              <p className="plan-page-status">No upcoming rounds. Past ones are below when you expand them.</p>
            ) : (
              <ul className="plan-round-list">
                {upcoming.map((r) => (
                  <RoundListItem
                    key={r.id}
                    round={r}
                    userId={user.id}
                    busyId={busyId}
                    copyId={copyId}
                    onCopy={(slug, id) => void onCopy(slug, id)}
                    onRemove={(id) => void onRemove(id)}
                  />
                ))}
              </ul>
            )}

            {past.length > 0 ? (
              <div className="plan-past">
                <button
                  type="button"
                  className="plan-past-toggle"
                  aria-expanded={pastOpen}
                  onClick={() => setPastOpen((v) => !v)}
                >
                  {pastOpen ? 'Hide' : 'Show'} past ({past.length})
                </button>
                {pastOpen ? (
                  <ul className="plan-round-list plan-round-list--past">
                    {past.map((r) => (
                      <RoundListItem
                        key={r.id}
                        round={r}
                        userId={user.id}
                        busyId={busyId}
                        copyId={copyId}
                        onCopy={(slug, id) => void onCopy(slug, id)}
                        onRemove={(id) => void onRemove(id)}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        {flash ? <p className="plan-page-flash">{flash}</p> : null}
        {copyErr ? <p className="plan-page-err">{copyErr}</p> : null}

        <Link to="/" className="btn btn-ghost plan-page-browse">
          Browse tee times →
        </Link>
      </div>
    </div>
  );
}
