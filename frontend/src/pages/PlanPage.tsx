import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { fetchRoundsForOrganizer, type DbRound } from '../lib/roundsApi';
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
      const rows = await fetchRoundsForOrganizer(user.id);
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
          When you use <strong style={{ color: 'var(--ink)' }}>Share</strong> on the finder or <strong style={{ color: 'var(--ink)' }}>Share times</strong> on a course (signed in), your rounds appear here. Anyone with the link can vote — no account needed on their side.
        </p>

        {authLoading ? (
          <p style={{ marginTop: 14, color: 'var(--muted)' }}>Loading account…</p>
        ) : !user ? (
          <p style={{ marginTop: 14, color: 'var(--muted)' }}>
            <strong style={{ color: 'var(--ink)' }}>Sign in</strong> with Google in the header to save rounds to this list. You can still share without signing in, but links will not be stored here.
          </p>
        ) : loading ? (
          <p style={{ marginTop: 14, color: 'var(--muted)' }}>Loading your rounds…</p>
        ) : loadErr ? (
          <p style={{ marginTop: 14, color: '#9a3412', fontSize: 14 }}>{loadErr}</p>
        ) : rounds.length === 0 ? (
          <p style={{ marginTop: 14, color: 'var(--muted)' }}>No shared rounds yet. Open the finder and tap Share on a course.</p>
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
                    <div style={{ fontWeight: 900, letterSpacing: '-0.02em' }}>{title}</div>
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
