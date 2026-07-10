import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchRecentOpenings, type FeedItem } from '../lib/feedApi';
import { parseCourseTitle } from '../lib/courseRecord';
import { coursePhotoUrl } from '../lib/coursePhotoUrl';
import { formatDateShort, formatReopenedAgo, formatTime12h } from '../lib/time';
import { useCourseCatalog } from '../state/CourseCatalogContext';

type PlayersFilter = 1 | 2 | 3 | 4;
type HoursFilter = 6 | 12 | 24;

function feedTimeLabel(item: FeedItem): string {
  if (item.play_starts_at) return formatTime12h(item.play_starts_at);
  const m = item.starts_at_local.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return item.starts_at_local;
  const h = Number(m[1]);
  const mm = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mm} ${ampm}`;
}

function feedDetectedLabel(item: FeedItem): string {
  const base = formatReopenedAgo(item.detected_at);
  if (item.event_type === 'reopened' && base.startsWith('Opened')) {
    return base.replace(/^Opened/, 'Reopened');
  }
  if (item.event_type === 'reopened' && base === 'Just opened') return 'Just reopened';
  return base;
}

function formatPrice(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${Math.round(cents / 100)}`;
}

export function FeedPage() {
  const { recordsBySlug } = useCourseCatalog();
  const [hours, setHours] = useState<HoursFilter>(6);
  const [minPlayers, setMinPlayers] = useState<PlayersFilter>(2);
  const [openOnly, setOpenOnly] = useState(true);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchRecentOpenings({
        hours,
        min_players: minPlayers,
        open_only: openOnly,
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

  return (
    <div className="container feed-page">
      <div className="feed-page-card">
        <div className="pill">Recent openings</div>
        <h2 className="feed-page-title">Fresh tee times</h2>
        <p className="feed-page-lede">
          Tee times we&apos;ve detected opening or reopening across Utah courses. Updated every few minutes — not a live booking feed, but the same signal that powers alerts.
        </p>

        <div className="feed-filters" role="group" aria-label="Feed filters">
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

        {loading && items.length === 0 && !err ? (
          <p className="feed-page-status">Loading openings…</p>
        ) : !loading && items.length === 0 && !err ? (
          <p className="feed-page-status">
            No openings in the last {hours} hours matching {minPlayers} player{minPlayers !== 1 ? 's' : ''}.
            {openOnly ? ' Try turning off “Still available only” or widen the window.' : ' Widen the window or check back after the next poll cycle.'}
          </p>
        ) : (
          <ul className="feed-list">
            {items.map((item) => {
              const record = recordsBySlug.get(item.course_slug);
              const { short, city } = parseCourseTitle(item.course_name);
              const photo = record ? coursePhotoUrl(record) : undefined;
              const price = formatPrice(item.price_cents);
              const courseHref = `/course/${item.course_slug}?date=${item.play_date}&players=${minPlayers}&holes=${item.holes}`;

              return (
                <li key={item.id} className={`feed-item${item.still_open ? '' : ' is-gone'}`}>
                  <Link to={courseHref} className="feed-item-link">
                    {photo ? (
                      <img className="feed-item-photo" src={photo} alt="" loading="lazy" />
                    ) : (
                      <div className="feed-item-photo feed-item-photo--placeholder" aria-hidden>
                        ⛳
                      </div>
                    )}
                    <div className="feed-item-body">
                      <div className="feed-item-top">
                        <span className={`feed-item-badge feed-item-badge--${item.event_type}`}>
                          {item.event_type === 'reopened' ? 'Reopened' : 'New'}
                        </span>
                        <span className="feed-item-detected">{feedDetectedLabel(item)}</span>
                      </div>
                      <div className="feed-item-course">
                        {short}
                        {city ? <span className="feed-item-city"> · {city}</span> : null}
                      </div>
                      <div className="feed-item-detail">
                        <strong>{feedTimeLabel(item)}</strong>
                        <span className="feed-item-sep">·</span>
                        {formatDateShort(item.play_date)}
                        {price ? (
                          <>
                            <span className="feed-item-sep">·</span>
                            {price}
                          </>
                        ) : null}
                        {item.spots_open != null ? (
                          <>
                            <span className="feed-item-sep">·</span>
                            {item.spots_open} spot{item.spots_open !== 1 ? 's' : ''}
                          </>
                        ) : null}
                      </div>
                      {!item.still_open ? (
                        <div className="feed-item-gone">May no longer be available</div>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <Link to="/" className="btn btn-ghost" style={{ marginTop: 18 }}>
          Browse all courses →
        </Link>
      </div>
    </div>
  );
}
