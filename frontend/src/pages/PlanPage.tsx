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
    if (!ok) setCopyErr('Clipboard blocked — open the vote page and copy from the address bar.');
  };

  return (
    <div className="container">
      <div style={{ padding: 18, borderRadius: 18, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.8)' }}>
        <div className="pill">Shared rounds</div>
        <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
          Your vote links
        </h2>
        <p style={{ color: 'var(--muted)', maxWidth: 640, lineHeight: 1.55 }}>
          Rounds you <strong style={{ color: 'var(--ink)' }}>host</strong> (Share on the finder or course page) and rounds you <strong style={{ color: 'var(--ink)' }}>join</strong> while signed in appear here. Anyone with the link can vote — guests don’t need an account.
        </p>

        {authLoading ? (
          <p style={{ marginTop: 14, color: 'var(--muted)' }}>Loading account…</p>
        ) : !user ? (
          <p style={{ marginTop: 14, color: 'var(--muted)' }}>
            <strong style={{ color: 'var(--ink)' }}>Sign in</strong> with Google in the header to create share links and see them listed here.
          </p>
        ) : loading ? (
          <p style={{ marginTop: 14, color: 'var(--muted)' }}>Loading your rounds…</p>
        ) : loadErr ? (
          <p style={{ marginTop: 14, color: '#9a3412', fontSize: 14 }}>{loadErr}</p>
        ) : rounds.length === 0 ? (
          <p style={{ marginTop: 14, color: 'var(--muted)' }}>
            No rounds here yet. Host one from the finder, or open a friend’s vote link while signed in to save it to this list.
          </p>
        ) : (
          <ul style={{ margin: '18px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
            {rounds.map((r) => {
              const slug = r.share_slug?.trim();
              if (!slug) return null;
              const title = r.title?.trim() || 'Golf round';
              const dateLabel = r.play_date ? formatDateShort(r.play_date) : '—';
              return (
                <li
                  key={r.id}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: 14,
                    borderRadius: 14,
                    border: '1px solid var(--border)',
                    background: '#fff',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontWeight: 900, letterSpacing: '-0.02em' }}>{title}</div>
                      <span
                        className="pill"
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          background: r.organizer_id === user.id ? 'rgba(233,245,234,0.95)' : 'rgba(248,250,248,0.95)',
                          color: r.organizer_id === user.id ? 'var(--green-2)' : 'var(--muted)',
                        }}
                      >
                        {r.organizer_id === user.id ? 'You hosted' : 'You joined'}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                      Play {dateLabel}
                      <span aria-hidden> · </span>
                      <span style={{ fontSize: 12, wordBreak: 'break-all' }}>{absoluteRoundUrl(slug)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Link className="btn btn-primary" to={`/round/${slug}`} style={{ padding: '8px 14px' }}>
                      Open vote
                    </Link>
                    <button className="btn" type="button" onClick={() => void onCopy(slug, r.id)} style={{ padding: '8px 14px' }}>
                      {copyId === r.id ? 'Copied' : 'Copy link'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {copyErr ? (
          <p style={{ marginTop: 12, color: '#9a3412', fontSize: 14 }}>{copyErr}</p>
        ) : null}

        <Link to="/" className="btn btn-ghost" style={{ marginTop: 18 }}>
          Browse tee times →
        </Link>
      </div>
    </div>
  );
}
