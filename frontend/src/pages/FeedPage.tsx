import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchRecentOpenings, type FeedItem } from '../lib/feedApi';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { useOpeningsPreview } from '../state/OpeningsPreviewContext';
import { FeedOpeningCard } from '../components/FeedOpeningCard';
import { buildFeedScope, feedScopeLabel, filterFeedItems } from '../lib/feedScope';
import { countFeedHotOpenings, feedMinutesSinceDetected, FEED_JUST_DETECTED_MINUTES, sortFeedItemsByUrgency } from '../lib/feedDisplay';
import { courseDistanceMap } from '../lib/feedDistanceMap';

type PlayersFilter = 1 | 2 | 3 | 4;
type HoursFilter = 6 | 12 | 24;

function clampPlayers(n: number): PlayersFilter {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

export function FeedPage() {
  const { recordsBySlug, courses, userLocation, loading: catalogLoading } = useCourseCatalog();
  const { setMinPlayers: syncPreviewPlayers } = useOpeningsPreview();
  const [sp, setSp] = useSearchParams();
  const urlPlayers = clampPlayers(Number(sp.get('players') || 2));
  const fetchAllUtah = sp.get('scope') === 'all';
  const locationQuery = sp.get('q') || '';

  const [hours, setHours] = useState<HoursFilter>(6);
  const [minPlayers, setMinPlayers] = useState<PlayersFilter>(urlPlayers);
  const [openOnly, setOpenOnly] = useState(true);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const setFetchScope = useCallback(
    (scope: 'nearby' | 'all') => {
      const next = new URLSearchParams(sp);
      if (scope === 'all') next.set('scope', 'all');
      else next.delete('scope');
      setSp(next, { replace: true });
    },
    [sp, setSp],
  );

  useEffect(() => {
    setMinPlayers(urlPlayers);
  }, [urlPlayers]);

  useEffect(() => {
    syncPreviewPlayers(minPlayers);
  }, [minPlayers, syncPreviewPlayers]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchRecentOpenings({
        hours,
        min_players: minPlayers,
        open_only: openOnly,
        limit: 80,
      });
      setItems(data.items);
      setGeneratedAt(data.meta.generated_at);
    } catch {
      setErr('Could not load recent openings. If you are running the worker locally, set VITE_WORKER_URL in frontend/.env.local.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [hours, minPlayers, openOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const feedScopeResult = useMemo(
    () =>
      buildFeedScope(courses, userLocation, {
        fetchAllUtah,
        locationQuery,
      }),
    [courses, userLocation, fetchAllUtah, locationQuery],
  );

  const scopeReady = feedScopeResult.scopeReady && !catalogLoading;

  const distanceMiBySlug = useMemo(() => courseDistanceMap(courses), [courses]);

  const filteredItems = useMemo(() => {
    if (feedScopeResult.isRegional && !scopeReady) return [];
    return filterFeedItems(items, feedScopeResult.slugAllowlist);
  }, [items, feedScopeResult.slugAllowlist, feedScopeResult.isRegional, scopeReady]);

  const scopedItems = useMemo(
    () => sortFeedItemsByUrgency(filteredItems, distanceMiBySlug),
    [filteredItems, distanceMiBySlug],
  );

  const hotCount = useMemo(() => countFeedHotOpenings(scopedItems), [scopedItems]);

  const justDetected = useMemo(
    () => scopedItems.filter((item) => feedMinutesSinceDetected(item) <= FEED_JUST_DETECTED_MINUTES),
    [scopedItems],
  );

  const earlierToday = useMemo(
    () => scopedItems.filter((item) => feedMinutesSinceDetected(item) > FEED_JUST_DETECTED_MINUTES),
    [scopedItems],
  );

  const scopeLabel = useMemo(() => feedScopeLabel(feedScopeResult.scope), [feedScopeResult.scope]);
  const statewideHiddenCount =
    scopeReady && feedScopeResult.isRegional ? items.length - filteredItems.length : 0;

  const partyLabel = useMemo(
    () => `${minPlayers} player${minPlayers !== 1 ? 's' : ''}`,
    [minPlayers],
  );

  return (
    <div className="container feed-page">
      <div className="feed-page-card">
        <div className="pill">Recent openings</div>
        <h1 className="feed-page-title">Fresh tee times</h1>
        <p className="feed-page-lede">
          Cancellations and new releases we&apos;ve detected. Same signal that powers alerts, usually within a few minutes of our poll cycle.
          {' '}
          Showing <strong>{scopeLabel.toLowerCase()}</strong> first
          {hotCount > 0 ? (
            <>
              {' '}
              with <strong>{hotCount} live</strong>.
            </>
          ) : (
            '.'
          )}
        </p>

        <div className="feed-filters" role="group" aria-label="Feed filters">
          <div className="feed-filter-group">
            <span className="feed-filter-label">Area</span>
            <div className="seg feed-filter-seg">
              <button
                type="button"
                className={!fetchAllUtah ? 'on' : ''}
                onClick={() => setFetchScope('nearby')}
              >
                Nearby
              </button>
              <button
                type="button"
                className={fetchAllUtah ? 'on' : ''}
                onClick={() => setFetchScope('all')}
              >
                All Utah
              </button>
            </div>
          </div>
          <div className="feed-filter-group">
            <span className="feed-filter-label">Window</span>
            <div className="seg feed-filter-seg">
              {([6, 12, 24] as HoursFilter[]).map((h) => (
                <button
                  key={h}
                  type="button"
                  className={hours === h ? 'on' : ''}
                  onClick={() => setHours(h)}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>
          <div className="feed-filter-group">
            <span className="feed-filter-label">Party</span>
            <div className="seg feed-filter-seg">
              {([1, 2, 3, 4] as PlayersFilter[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={minPlayers === p ? 'on' : ''}
                  onClick={() => setMinPlayers(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <label className="feed-open-only">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
            />
            Still available only
          </label>
          <button className="btn feed-refresh-btn" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {generatedAt ? (
          <p className="feed-meta mono">
            Last fetched {new Date(generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            {' · '}
            auto-refresh 60s
          </p>
        ) : null}

        {err ? <p className="feed-page-err">{err}</p> : null}

        {loading && scopedItems.length === 0 && !err ? (
          <p className="feed-page-status">Loading openings…</p>
        ) : !loading && scopedItems.length === 0 && !err ? (
          <div className="feed-page-status">
            <p>
              No openings {scopeLabel.toLowerCase()} in the last {hours} hours for {partyLabel}.
              {openOnly ? ' Try turning off “Still available only” or widen the window.' : ' Widen the window or check back after the next poll cycle.'}
            </p>
            {!fetchAllUtah && statewideHiddenCount > 0 ? (
              <button type="button" className="btn btn-primary feed-scope-expand" onClick={() => setFetchScope('all')}>
                See {statewideHiddenCount} opening{statewideHiddenCount !== 1 ? 's' : ''} statewide →
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {justDetected.length > 0 ? (
              <section className="feed-section">
                <h2 className="feed-section-title">Just detected</h2>
                <ul className="feed-opening-grid">
                  {justDetected.map((item) => (
                    <li key={item.id}>
                      <FeedOpeningCard
                        item={item}
                        record={recordsBySlug.get(item.course_slug)}
                        minPlayers={minPlayers}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {earlierToday.length > 0 ? (
              <details className="feed-section feed-section-earlier" open={justDetected.length === 0}>
                <summary className="feed-section-title">
                  Earlier today
                  <span className="feed-section-count">{earlierToday.length}</span>
                </summary>
                <ul className="feed-opening-grid">
                  {earlierToday.map((item) => (
                    <li key={item.id}>
                      <FeedOpeningCard
                        item={item}
                        record={recordsBySlug.get(item.course_slug)}
                        minPlayers={minPlayers}
                      />
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {!fetchAllUtah && statewideHiddenCount > 0 ? (
              <p className="feed-scope-foot">
                <button type="button" className="feed-teaser-link feed-scope-more-btn" onClick={() => setFetchScope('all')}>
                  +{statewideHiddenCount} more statewide →
                </button>
              </p>
            ) : null}
          </>
        )}

        <Link to="/" className="btn btn-ghost feed-page-back">
          Browse all courses →
        </Link>
      </div>
    </div>
  );
}
