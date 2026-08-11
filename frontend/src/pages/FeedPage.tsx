import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchRecentOpenings, type FeedItem } from '../lib/feedApi';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { useOpeningsPreview } from '../state/OpeningsPreviewContext';
import { FeedOpeningRow } from '../components/FeedOpeningRow';
import { buildFeedScope, feedScopeLabel, filterFeedItems } from '../lib/feedScope';
import { sortFeedItemsByUrgency } from '../lib/feedDisplay';
import { courseDistanceMap } from '../lib/feedDistanceMap';
import type { FetchRadiusMi } from '../types';
import { DEFAULT_FETCH_RADIUS_MI, parseFetchRadiusMi } from '../lib/timesFetchScope';

type PlayersFilter = 1 | 2 | 3 | 4;

const FEED_HOURS = 6;

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
  const radiusMi = parseFetchRadiusMi(sp.get('radius'));

  const [minPlayers, setMinPlayers] = useState<PlayersFilter>(urlPlayers);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const setRadiusMode = useCallback(
    (value: FetchRadiusMi | 'all') => {
      const next = new URLSearchParams(sp);
      if (value === 'all') {
        next.set('scope', 'all');
        next.delete('radius');
      } else {
        next.delete('scope');
        if (value === DEFAULT_FETCH_RADIUS_MI) next.delete('radius');
        else next.set('radius', String(value));
      }
      setSp(next, { replace: true });
    },
    [sp, setSp],
  );

  const setParty = useCallback(
    (players: PlayersFilter) => {
      setMinPlayers(players);
      const next = new URLSearchParams(sp);
      next.set('players', String(players));
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
        hours: FEED_HOURS,
        min_players: minPlayers,
        open_only: true,
        limit: 80,
      });
      setItems(data.items);
      setGeneratedAt(data.meta.generated_at);
    } catch {
      setErr('Could not load openings. Try again in a moment.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [minPlayers]);

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
        radiusMi,
      }),
    [courses, userLocation, fetchAllUtah, locationQuery, radiusMi],
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

  const scopeLabel = useMemo(() => feedScopeLabel(feedScopeResult.scope), [feedScopeResult.scope]);
  const statewideHiddenCount =
    scopeReady && feedScopeResult.isRegional ? items.length - filteredItems.length : 0;
  const radiusSelectValue: string = fetchAllUtah ? 'all' : String(radiusMi);

  return (
    <div className="container hub-page feed-page">
      <div className="hub-page-card">
        <header className="feed-page-head">
          <h1 className="hub-page-title">Openings</h1>
          <p className="hub-page-lede feed-page-head-lede">
            Fresh cancellations and releases · last {FEED_HOURS} hours
            {generatedAt ? (
              <>
                {' '}
                · updated{' '}
                {new Date(generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                {loading ? '…' : ''}
              </>
            ) : null}
          </p>
        </header>

        <div className="feed-filters" role="group" aria-label="Openings filters">
          <label className="sort-control radius-control feed-radius-control">
            <span className="visually-hidden">Search radius</span>
            <select
              value={radiusSelectValue}
              aria-label="Search radius"
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'all') setRadiusMode('all');
                else setRadiusMode(Number(v) as FetchRadiusMi);
              }}
            >
              <option value="15">Within 15 mi</option>
              <option value="25">Within 25 mi</option>
              <option value="50">Within 50 mi</option>
              <option value="all">Statewide</option>
            </select>
          </label>
          <div className="seg feed-filter-seg" role="group" aria-label="Players">
            {([1, 2, 3, 4] as PlayersFilter[]).map((p) => (
              <button
                key={p}
                type="button"
                className={minPlayers === p ? 'on' : ''}
                onClick={() => setParty(p)}
                aria-label={`${p} player${p !== 1 ? 's' : ''}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {err ? <p className="feed-page-err">{err}</p> : null}

        {loading && scopedItems.length === 0 && !err ? (
          <p className="feed-page-status">Loading openings…</p>
        ) : !loading && scopedItems.length === 0 && !err ? (
          <div className="feed-page-empty">
            <p className="feed-page-status">
              Nothing fresh {scopeLabel.toLowerCase()} right now.
            </p>
            <div className="feed-page-empty-actions">
              {!fetchAllUtah && radiusMi < 50 ? (
                <button type="button" className="btn btn-primary" onClick={() => setRadiusMode(50)}>
                  Within 50 mi
                </button>
              ) : null}
              {!fetchAllUtah && statewideHiddenCount > 0 ? (
                <button type="button" className="btn btn-primary" onClick={() => setRadiusMode('all')}>
                  See {statewideHiddenCount} statewide →
                </button>
              ) : null}
              <Link to="/" className="btn">
                Browse Find
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ul className="feed-opening-list">
              {scopedItems.map((item) => (
                <li key={item.id}>
                  <FeedOpeningRow
                    item={item}
                    record={recordsBySlug.get(item.course_slug)}
                    minPlayers={minPlayers}
                  />
                </li>
              ))}
            </ul>
            {!fetchAllUtah && statewideHiddenCount > 0 ? (
              <p className="feed-scope-foot">
                <button type="button" className="feed-scope-more-btn" onClick={() => setRadiusMode('all')}>
                  +{statewideHiddenCount} more statewide →
                </button>
              </p>
            ) : null}
          </>
        )}

        {scopedItems.length > 0 ? (
          <Link to="/" className="btn btn-ghost feed-page-back">
            Browse Find →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
