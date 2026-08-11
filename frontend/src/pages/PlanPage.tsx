import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { fetchRoundsForUser, hideRoundFromMyList, type DbRound } from '../lib/roundsApi';
import { formatDateShort, todayYmdUtah } from '../lib/time';
import { absoluteRoundUrl } from '../lib/shareUrl';
import { copyTextToClipboard } from '../lib/clipboard';
import { CoursePhoto } from '../components/CoursePhoto';
import { PlanIcon } from '../components/icons/AppIcons';
import { SignedOutGate } from '../components/SignedOutGate';
import { useIsCompactShell } from '../hooks/useMediaQuery';

function RoundListItem({
  round,
  userId,
  busyId,
  copyId,
  menuOpen,
  photoUrl,
  onToggleMenu,
  onCopy,
  onRemove,
}: {
  round: DbRound;
  userId: string;
  busyId: string | null;
  copyId: string | null;
  menuOpen: boolean;
  photoUrl?: string;
  onToggleMenu: () => void;
  onCopy: (slug: string, id: string) => void;
  onRemove: (id: string) => void;
}) {
  const slug = round.share_slug?.trim();
  if (!slug) return null;
  const title = round.title?.trim() || 'Golf round';
  const dateLabel = round.play_date ? formatDateShort(round.play_date) : 'Date TBD';
  const hosted = round.organizer_id === userId;
  const busy = busyId === round.id;

  return (
    <li className="plan-round-card">
      <div className="plan-round-card-main">
        <Link to={`/round/${slug}`} className="plan-round-card-link">
          <div className="plan-round-thumb" aria-hidden>
            <CoursePhoto
              src={photoUrl}
              height={56}
              className="plan-round-thumb-photo"
              style={{ height: '100%' }}
            />
          </div>
          <div className="plan-round-body">
            <div className="plan-round-title">{title}</div>
            <div className="plan-round-meta">
              <span className={`plan-round-badge${hosted ? ' is-hosted' : ' is-joined'}`}>
                {hosted ? 'Hosted' : 'Joined'}
              </span>
              <span>Play {dateLabel}</span>
            </div>
            <div className="plan-round-cta">Open →</div>
          </div>
        </Link>
        <div className="plan-round-menu" data-plan-menu={round.id}>
          <button
            type="button"
            className="plan-round-menu-btn"
            aria-label={`Actions for ${title}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            disabled={busy}
            onClick={onToggleMenu}
          >
            <span aria-hidden>⋯</span>
          </button>
          {menuOpen ? (
            <div className="plan-round-menu-panel" role="menu">
              <button type="button" role="menuitem" disabled={busy} onClick={() => onCopy(slug, round.id)}>
                {copyId === round.id ? 'Copied' : 'Copy link'}
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                disabled={busy}
                onClick={() => onRemove(round.id)}
              >
                {busy ? '…' : 'Remove'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function PlanPage() {
  const { user } = useAuth();
  const isCompact = useIsCompactShell();
  const { courses } = useCourseCatalog();
  const [rounds, setRounds] = useState<DbRound[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [copyId, setCopyId] = useState<string | null>(null);
  const [copyErr, setCopyErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const todayYmd = todayYmdUtah();

  const courseById = useMemo(() => {
    const m = new Map<string, (typeof courses)[number]>();
    for (const c of courses) m.set(c.id, c);
    return m;
  }, [courses]);

  const { upcoming, past } = useMemo(() => {
    const up: DbRound[] = [];
    const pa: DbRound[] = [];
    for (const r of rounds) {
      if (r.play_date && r.play_date < todayYmd) pa.push(r);
      else up.push(r);
    }
    return { upcoming: up, past: pa };
  }, [rounds, todayYmd]);

  useEffect(() => {
    if (!menuOpenId) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(`[data-plan-menu="${menuOpenId}"]`)) return;
      setMenuOpenId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpenId]);

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
    setMenuOpenId(null);
    setCopyErr(null);
    const url = absoluteRoundUrl(slug);
    const ok = await copyTextToClipboard(url);
    setCopyId(id);
    window.setTimeout(() => setCopyId((c) => (c === id ? null : c)), 2000);
    if (!ok) setCopyErr('Clipboard blocked. Open the vote page and copy from the address bar.');
  };

  const onRemove = async (id: string) => {
    if (!user?.id) return;
    setMenuOpenId(null);
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

  if (!user) {
    /* Compact shell: AppShell opens the auth modal over Find instead of this page. */
    if (isCompact) return null;
    return (
      <SignedOutGate returnTo="/plan">
        Host vote links and see rounds you join. If you&apos;re new to Tee-Time, we&apos;ll create an account for you.
      </SignedOutGate>
    );
  }

  const renderRound = (r: DbRound) => {
    const photoUrl = r.course_id ? courseById.get(r.course_id)?.photoUrl : undefined;
    return (
      <RoundListItem
        key={r.id}
        round={r}
        userId={user.id}
        busyId={busyId}
        copyId={copyId}
        menuOpen={menuOpenId === r.id}
        photoUrl={photoUrl}
        onToggleMenu={() => setMenuOpenId(menuOpenId === r.id ? null : r.id)}
        onCopy={(slug, id) => void onCopy(slug, id)}
        onRemove={(id) => void onRemove(id)}
      />
    );
  };

  return (
    <div className="container hub-page">
      <div className="hub-page-card">
        <div className="plan-page-head">
          <h1 className="hub-page-title">Plan</h1>
          <p className="hub-page-lede plan-page-head-lede">
            Rounds you host or join — share a vote link and lock a time together.
          </p>
        </div>

        {loading ? (
          <p className="plan-page-status">Loading your rounds…</p>
        ) : loadErr ? (
          <p className="plan-page-err">{loadErr}</p>
        ) : upcoming.length === 0 && past.length === 0 ? (
          <div className="plan-page-empty">
            <p className="plan-page-status">
              No rounds yet. Plan one from Find, or open a friend&apos;s vote link while signed in.
            </p>
            <div className="plan-page-empty-actions">
              <Link to="/" className="btn">
                Browse Find
              </Link>
            </div>
          </div>
        ) : (
          <>
            {upcoming.length === 0 ? (
              <div className="plan-page-empty plan-page-empty--inline">
                <p className="plan-page-status">No upcoming rounds.</p>
                <div className="plan-page-empty-actions">
                  <Link to="/" className="btn">
                    Browse Find
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="plan-round-list">{upcoming.map(renderRound)}</ul>
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
                {pastOpen ? <ul className="plan-round-list plan-round-list--past">{past.map(renderRound)}</ul> : null}
              </div>
            ) : null}
          </>
        )}

        {flash ? <p className="plan-page-flash">{flash}</p> : null}
        {copyErr ? <p className="plan-page-err">{copyErr}</p> : null}

        <div className="plan-create-bar">
          <Link to="/" className="btn btn-primary plan-create-btn">
            <PlanIcon size={16} />
            Plan a round
          </Link>
        </div>
      </div>
    </div>
  );
}
