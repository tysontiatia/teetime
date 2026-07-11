import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { fetchRoundsForUser, type DbRound } from '../lib/roundsApi';
import { formatDateShort } from '../lib/time';
import { absoluteRoundUrl } from '../lib/shareUrl';
import { copyTextToClipboard } from '../lib/clipboard';

export function PlanPage() {
  const { user, loading: authLoading } = useAuth();
  const [rounds, setRounds] = useState<DbRound[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [copyId, setCopyId] = useState<string | null>(null);
  const [copyErr, setCopyErr] = useState<string | null>(null);

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

  return (
    <div className="container plan-page">
      <div className="plan-page-card">
        <div className="pill">Shared rounds</div>
        <h2 className="plan-page-title">Your vote links</h2>
        <p className="plan-page-lede">
          Rounds you <strong style={{ color: 'var(--ink)' }}>host</strong> (Share on the finder or course page) and rounds you{' '}
          <strong style={{ color: 'var(--ink)' }}>join</strong> while signed in appear here. Anyone with the link can vote. Guests don&apos;t need an account.
        </p>

        {authLoading ? (
          <p className="plan-page-status">Loading account…</p>
        ) : !user ? (
          <p className="plan-page-status">
            <strong style={{ color: 'var(--ink)' }}>Sign in</strong> with Google in the header to create share links and see them listed here.
          </p>
        ) : loading ? (
          <p className="plan-page-status">Loading your rounds…</p>
        ) : loadErr ? (
          <p className="plan-page-err" style={{ marginTop: 14 }}>
            {loadErr}
          </p>
        ) : rounds.length === 0 ? (
          <p className="plan-page-status">No rounds here yet. Host one from the finder, or open a friend’s vote link while signed in to save it to this list.</p>
        ) : (
          <ul className="plan-round-list">
            {rounds.map((r) => {
              const slug = r.share_slug?.trim();
              if (!slug) return null;
              const title = r.title?.trim() || 'Golf round';
              const dateLabel = r.play_date ? formatDateShort(r.play_date) : '—';
              const voteUrl = absoluteRoundUrl(slug);
              const hosted = r.organizer_id === user.id;
              return (
                <li key={r.id} className="plan-round-item">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
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
                    <Link className="btn btn-primary" to={`/round/${slug}`} style={{ padding: '10px 14px' }}>
                      Open vote
                    </Link>
                    <button className="btn" type="button" onClick={() => void onCopy(slug, r.id)} style={{ padding: '10px 14px' }}>
                      {copyId === r.id ? 'Copied' : 'Copy link'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {copyErr ? <p className="plan-page-err">{copyErr}</p> : null}

        <Link to="/" className="btn btn-ghost" style={{ marginTop: 18 }}>
          Browse tee times →
        </Link>
      </div>
    </div>
  );
}
