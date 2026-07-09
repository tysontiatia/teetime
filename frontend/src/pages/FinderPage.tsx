import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Course, SearchParams, SortBy, TeeTime, TimeOfDayPreset } from '../types';
import { matchesPreset, minutesSince, toYmd, formatDateShort } from '../lib/time';
import { sortFinderGridCourses, sortCourses } from '../lib/sort';
import {
  capabilityHint,
  filterWorkerCourses,
  getPlatformCapability,
  platformDisplayName,
} from '../lib/platformRegistry';
import { useAuth } from '../state/AuthContext';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { publishRoundFromPlan, planFromCourseVisibleTimes } from '../lib/roundsApi';
import { copyTextToClipboard } from '../lib/clipboard';
import { absoluteRoundUrl } from '../lib/shareUrl';
import { useTimesByCourseMap } from '../hooks/useTimesByCourseMap';
const MapView = lazy(() => import('../components/MapView').then((m) => ({ default: m.MapView })));
import { NotificationModal } from '../components/NotificationModal';
import { SignInToShareModal } from '../components/SignInToShareModal';
import { CourseCardSkeleton } from '../components/CourseCardSkeleton';
import { CourseMarketplaceCard } from '../components/CourseMarketplaceCard';
import { FinderDayOutlook } from '../components/FinderDayOutlook';
import { courseDetailQueryString } from '../lib/finderUrl';
import { buildTimesFetchScope, courseMatchesLocationQuery } from '../lib/timesFetchScope';

function clampPlayers(n: number): 1 | 2 | 3 | 4 {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

function clampHoles(n: number): 9 | 18 {
  return n === 9 ? 9 : 18;
}

function sortCoursesByDistanceThenName(a: Course, b: Course): number {
  const da = typeof a.distanceMi === 'number' ? a.distanceMi : Number.POSITIVE_INFINITY;
  const db = typeof b.distanceMi === 'number' ? b.distanceMi : Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return a.catalogName.localeCompare(b.catalogName);
}

function parseParams(sp: URLSearchParams): SearchParams {
  const date = sp.get('date') || toYmd(new Date());
  const players = clampPlayers(Number(sp.get('players') || 2));
  const holes = clampHoles(Number(sp.get('holes') || 18));
  const timeOfDay = (sp.get('tod') as TimeOfDayPreset) || 'any';
  const sortBy = (sp.get('sort') as SortBy) || 'distance';
  const locationQuery = sp.get('q') || '';
  const fetchScope: SearchParams['fetchScope'] = sp.get('scope') === 'all' ? 'all' : 'nearby';
  return { date, players, holes, timeOfDay, sortBy, locationQuery, fetchScope };
}

/** Worker refetch only when date or party size changes — not text search, sort, or time-of-day. */
const FETCH_PARAM_KEYS = new Set(['date', 'holes', 'players']);

export function FinderPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const params = useMemo(() => parseParams(sp), [sp]);
  const [locationDraft, setLocationDraft] = useState(() => params.locationQuery);

  /** Keep draft in sync when URL q changes externally (back button, shared link). */
  useEffect(() => {
    setLocationDraft(params.locationQuery);
  }, [params.locationQuery]);

  const commitLocationToUrl = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      const next = new URLSearchParams(sp);
      if (trimmed) next.set('q', trimmed);
      else next.delete('q');
      setSp(next, { replace: true });
    },
    [sp, setSp]
  );

  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(Date.now());
  const [view, setView] = useState<'list' | 'map'>('list');
  const [notifCourseId, setNotifCourseId] = useState<string | null>(null);
  const { user, loading: authLoading } = useAuth();

  const {
    courses,
    recordsBySlug,
    loading: catalogLoading,
    error: catalogError,
    userLocation,
    refresh: refreshCatalog,
  } = useCourseCatalog();

  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const fetchAllUtah = params.fetchScope === 'all';

  const setFetchScope = useCallback(
    (scope: 'nearby' | 'all') => {
      const next = new URLSearchParams(sp);
      if (scope === 'all') next.set('scope', 'all');
      else next.delete('scope');
      setSp(next, { replace: true });
    },
    [sp, setSp]
  );

  const workerCourses = useMemo(() => filterWorkerCourses(courses), [courses]);

  /** 18-hole search: skip true 9-only courses. 9-hole search: keep everyone. */
  const holesCompatibleCourses = useMemo(() => {
    if (params.holes === 9) return workerCourses;
    return workerCourses.filter((c) => c.holes !== 9);
  }, [workerCourses, params.holes]);

  const timesFetchScope = useMemo(
    () =>
      buildTimesFetchScope(holesCompatibleCourses, userLocation, {
        fetchAllUtah,
        locationQuery: params.locationQuery,
      }),
    [holesCompatibleCourses, userLocation, fetchAllUtah, params.locationQuery]
  );

  const fetchPool = timesFetchScope.fetchPool;

  const fetchSlugSet = useMemo(() => new Set(fetchPool.map((c) => c.id)), [fetchPool]);

  const searchPool = useMemo(() => {
    const q = locationDraft.trim();
    let pool = holesCompatibleCourses;
    if (q) {
      pool = pool.filter((c) => courseMatchesLocationQuery(c, q));
    } else if (!fetchAllUtah) {
      pool = pool.filter((c) => fetchSlugSet.has(c.id));
    }
    return pool;
  }, [holesCompatibleCourses, locationDraft, fetchAllUtah, fetchSlugSet]);

  const searchPendingCommit =
    locationDraft.trim() !== params.locationQuery.trim() && locationDraft.trim().length > 0;

  const {
    timesByCourse: rawTimesByCourse,
    loadingTimes,
    failedSlugs,
    attemptedSlugCount,
    pendingSlugs,
    loadedSlugCount,
  } = useTimesByCourseMap(
    fetchPool,
    recordsBySlug,
    params.date,
    params.holes,
    params.players,
    lastUpdatedAt ?? 0,
    catalogLoading
  );

  const showCatalogSkeleton = view === 'list' && !catalogError && catalogLoading;

  const fetchProgressLabel =
    loadingTimes && attemptedSlugCount > 0 ? ` · ${loadedSlugCount}/${attemptedSlugCount}` : '';

  const timesByCourse = useMemo(() => {
    const map = new Map<string, TeeTime[]>();
    for (const [courseId, list] of rawTimesByCourse) {
      const filtered = list.filter(
        (t) =>
          matchesPreset(t.startsAt, params.timeOfDay) &&
          (params.players === 1 || (t.spots != null && t.spots >= params.players))
      );
      filtered.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
      map.set(courseId, filtered);
    }
    return map;
  }, [rawTimesByCourse, params.timeOfDay, params.players]);

  const gridCourses = useMemo(() => {
    if (loadingTimes) {
      // Freeze card order while times stream in — re-sort once when the fetch batch finishes.
      return sortCourses([...searchPool], new Map(), 'distance');
    }
    return sortFinderGridCourses(searchPool, timesByCourse, params.sortBy);
  }, [loadingTimes, params.sortBy, searchPool, timesByCourse]);

  const withTimesCount = useMemo(
    () => gridCourses.filter((c) => (timesByCourse.get(c.id)?.length ?? 0) > 0).length,
    [gridCourses, timesByCourse]
  );

  const workerFetchTotalFailure =
    !loadingTimes && failedSlugs.length > 0 && failedSlugs.length === attemptedSlugCount && attemptedSlugCount > 0;
  const workerFetchPartialFailure = !loadingTimes && failedSlugs.length > 0 && !workerFetchTotalFailure;

  /** Same text search as live list, but over the full catalog (other states / platforms). */
  const queryAllCourses = useMemo(() => {
    const q = locationDraft.trim();
    if (!q) return courses;
    return courses.filter((c) => courseMatchesLocationQuery(c, q));
  }, [courses, locationDraft]);

  const bookingOnlyCourses = useMemo(() => {
    return queryAllCourses.filter((c) => getPlatformCapability(c.platform) !== 'live_inventory');
  }, [queryAllCourses]);

  const bookingOnlySorted = useMemo(
    () => [...bookingOnlyCourses].sort(sortCoursesByDistanceThenName),
    [bookingOnlyCourses]
  );

  const [showBookingOnly, setShowBookingOnly] = useState(true);
  const [shareBusyCourseId, setShareBusyCourseId] = useState<string | null>(null);
  const [shareFinderErr, setShareFinderErr] = useState<string | null>(null);
  const [signInToShareOpen, setSignInToShareOpen] = useState(false);
  const closeSignInToShare = useCallback(() => setSignInToShareOpen(false), []);

  const updatedLabel = useMemo(() => {
    const m = minutesSince(lastUpdatedAt);
    if (m == null) return '—';
    if (m === 0) return 'Updated just now';
    return `Updated ${m}m ago`;
  }, [lastUpdatedAt]);

  const shareCourseRound = useCallback(
    async (course: Course, courseTimes: TeeTime[]) => {
      if (courseTimes.length === 0) return;
      const uid = user?.id;
      if (!uid) {
        setSignInToShareOpen(true);
        return;
      }
      setShareBusyCourseId(course.id);
      setShareFinderErr(null);
      const planPayload = planFromCourseVisibleTimes(course, params.date, courseTimes, params.players);
      const host =
        (user?.user_metadata?.full_name as string | undefined) ||
        (user?.user_metadata?.name as string | undefined) ||
        user?.email?.split('@')[0] ||
        null;
      const res = await publishRoundFromPlan({
        plan: planPayload,
        coursesById,
        organizerId: uid,
        hostPublicName: host,
      });
      setShareBusyCourseId(null);
      if ('error' in res) {
        setShareFinderErr(res.error);
        return;
      }
      const url = absoluteRoundUrl(res.slug);
      const copied = await copyTextToClipboard(url);
      if (!copied) {
        setShareFinderErr('Vote page created — copy the link from the address bar on the next screen.');
      }
      nav(`/round/${res.slug}`);
    },
    [coursesById, nav, params.date, params.players, user],
  );

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(sp);
      if (value) next.set(key, value);
      else next.delete(key);
      setSp(next, { replace: true });
      if (FETCH_PARAM_KEYS.has(key)) {
        setLastUpdatedAt(Date.now());
      }
    },
    [sp, setSp]
  );

  const timeChip = (tod: TimeOfDayPreset, label: string) => (
    <button
      className={`chip${params.timeOfDay === tod ? ' on' : ''}`}
      onClick={() => setParam('tod', tod)}
      type="button"
    >
      {label}
    </button>
  );

  const runSearch = () => {
    commitLocationToUrl(locationDraft);
    setLastUpdatedAt(Date.now());
  };

  const resultCountLabel = catalogLoading
    ? 'Loading courses…'
    : loadingTimes
      ? `Loading times${fetchProgressLabel}…`
      : `${withTimesCount} with times · ${gridCourses.length} courses`;

  return (
    <div className="container">
      <div style={{ display: 'grid', gap: 0 }}>
        {catalogError ? (
          <div style={{ marginTop: 18, padding: 14, borderRadius: 14, border: '1px solid rgba(180,60,60,0.35)', background: 'rgba(254,242,242,0.9)', color: '#7f1d1d' }}>
            <strong>Could not load courses.</strong> {catalogError}
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-primary" onClick={() => void refreshCatalog()}>
                Try again
              </button>
            </div>
          </div>
        ) : null}

        {shareFinderErr ? (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: '1px solid rgba(180,60,60,0.35)', background: 'rgba(254,242,242,0.9)', color: '#7f1d1d', fontSize: 14 }}>
            {shareFinderErr}
          </div>
        ) : null}

        {workerFetchTotalFailure ? (
          <div style={{ marginTop: 14, padding: 14, borderRadius: 14, border: '1px solid rgba(180,60,60,0.4)', background: 'rgba(254,242,242,0.95)', color: '#7f1d1d', fontSize: 14, lineHeight: 1.5 }}>
            <strong>Could not load live tee times.</strong> Check your connection, then search again.
            <div style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-primary" onClick={() => setLastUpdatedAt(Date.now())}>
                Retry now
              </button>
            </div>
          </div>
        ) : workerFetchPartialFailure ? (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: '1px solid rgba(180,120,40,0.45)', background: 'rgba(255,251,235,0.95)', color: '#92400e', fontSize: 14, lineHeight: 1.5 }}>
            <strong>Some courses didn&apos;t refresh</strong> ({failedSlugs.length} of {attemptedSlugCount}). Results may be incomplete.
          </div>
        ) : null}

        <div className="search-zone">
          <div className="search-pill">
            <div className="sp-cell">
              <span className="sp-label">Where</span>
              <span className="sp-value">
                <input
                  value={locationDraft}
                  placeholder="Course, city, or zip"
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  aria-label="Location or course"
                  onChange={(e) => setLocationDraft(e.target.value)}
                  onBlur={() => commitLocationToUrl(locationDraft)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      runSearch();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </span>
            </div>
            <div className="sp-cell">
              <span className="sp-label">When</span>
              <span className="sp-value">
                <input
                  type="date"
                  value={params.date}
                  aria-label="Date"
                  onChange={(e) => setParam('date', e.target.value)}
                />
              </span>
            </div>
            <div className="sp-cell">
              <span className="sp-label">Players</span>
              <span className="sp-value">
                <select
                  aria-label="Players and holes"
                  value={`${params.players}-${params.holes}`}
                  onChange={(e) => {
                    const [p, h] = e.target.value.split('-');
                    const next = new URLSearchParams(sp);
                    next.set('players', p);
                    next.set('holes', h);
                    setSp(next, { replace: true });
                    setLastUpdatedAt(Date.now());
                  }}
                >
                  <option value="1-18">1 · 18 holes</option>
                  <option value="2-18">2 · 18 holes</option>
                  <option value="3-18">3 · 18 holes</option>
                  <option value="4-18">4 · 18 holes</option>
                  <option value="1-9">1 · 9 holes</option>
                  <option value="2-9">2 · 9 holes</option>
                  <option value="3-9">3 · 9 holes</option>
                  <option value="4-9">4 · 9 holes</option>
                </select>
              </span>
            </div>
            <button className="sp-go" type="button" aria-label="Search" onClick={runSearch}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="11" cy="11" r="7" stroke="#fff" strokeWidth="2.4" />
                <path d="M20 20l-3.5-3.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {searchPendingCommit ? (
            <div style={{ maxWidth: 860, margin: '8px auto 0', fontSize: 12, color: 'var(--ink-3)', textAlign: 'center' }}>
              Press Enter or search to load live times for this place.
            </div>
          ) : null}

          <div className="sp-mobile-filters">
            <div>
              <label className="sp-label" style={{ display: 'block', marginBottom: 4 }}>When</label>
              <input className="input" type="date" value={params.date} onChange={(e) => setParam('date', e.target.value)} />
            </div>
            <div>
              <label className="sp-label" style={{ display: 'block', marginBottom: 4 }}>Players</label>
              <select className="input" value={params.players} onChange={(e) => setParam('players', e.target.value)}>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </div>
            <div>
              <label className="sp-label" style={{ display: 'block', marginBottom: 4 }}>Holes</label>
              <select className="input" value={params.holes} onChange={(e) => setParam('holes', e.target.value)}>
                <option value="18">18</option>
                <option value="9">9</option>
              </select>
            </div>
          </div>
        </div>

        <div className="filter-row">
          {timeChip('any', 'Any time')}
          {timeChip('morning', 'Morning')}
          {timeChip('afternoon', 'Afternoon')}
          {timeChip('evening', 'Twilight')}
          <button className={`chip${view === 'list' ? ' on' : ''}`} type="button" onClick={() => setView('list')}>
            List
          </button>
          <button className={`chip${view === 'map' ? ' on' : ''}`} type="button" onClick={() => setView('map')}>
            Map
          </button>
          <select
            className="chip"
            style={{ paddingRight: 28 }}
            value={params.sortBy}
            aria-label="Sort"
            onChange={(e) => setParam('sort', e.target.value as SortBy)}
          >
            <option value="distance">Distance</option>
            <option value="soonest">Soonest</option>
            <option value="price">Price</option>
            <option value="rating">Rating</option>
          </select>
          {!catalogLoading && timesFetchScope.regional && timesFetchScope.outOfScopeCount > 0 ? (
            <button type="button" className="chip" onClick={() => setFetchScope('all')}>
              All Utah
            </button>
          ) : null}
          {!catalogLoading && fetchAllUtah ? (
            <button type="button" className="chip" onClick={() => setFetchScope('nearby')}>
              Nearby
            </button>
          ) : null}
          <div className="filter-spacer" />
          <span className="result-count">
            <strong>{resultCountLabel}</strong>
            {updatedLabel !== '—' ? ` · ${updatedLabel}` : ''}
            {` · ${formatDateShort(params.date)}`}
          </span>
        </div>

        <FinderDayOutlook dateYmd={params.date} />

        {!catalogLoading && !loadingTimes && !catalogError && searchPool.length === 0 && workerCourses.length > 0 ? (
          <div
            style={{
              padding: 18,
              borderRadius: 16,
              border: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.92)',
              maxWidth: 560,
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 17, letterSpacing: '-0.02em', marginBottom: 8 }}>No courses match that search</div>
            <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.55, fontSize: 14 }}>
              Try clearing the location box, switching time of day to <strong>Any</strong>, or picking another date.
              {!fetchAllUtah && timesFetchScope.mode === 'nearby' && timesFetchScope.outOfScopeCount > 0
                ? ' Try Search all Utah for statewide results, or search a city like St. George.'
                : ' The full live catalog stays available when your search matches again.'}
            </p>
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {locationDraft.trim() ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setLocationDraft('');
                    commitLocationToUrl('');
                  }}
                >
                  Clear search
                </button>
              ) : null}
              {!fetchAllUtah && timesFetchScope.outOfScopeCount > 0 ? (
                <button type="button" className="btn btn-primary" onClick={() => setFetchScope('all')}>
                  Search all Utah
                </button>
              ) : null}
              {params.timeOfDay !== 'any' ? (
                <button type="button" className="btn" onClick={() => setParam('tod', 'any')}>
                  Any time of day
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 1);
                  setParam('date', toYmd(d));
                }}
              >
                Try tomorrow
              </button>
            </div>
          </div>
        ) : null}

        {view === 'map' ? (
          <Suspense
            fallback={
              <div className="map-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}>
                Loading map…
              </div>
            }
          >
            <MapView
              courses={gridCourses}
              timesByCourseId={timesByCourse}
              userLocation={userLocation}
              onSelectCourse={(id) => {
                nav(`/course/${id}?${courseDetailQueryString(params)}`);
              }}
            />
          </Suspense>
        ) : (
          <div className="mp-grid">
            {showCatalogSkeleton
              ? Array.from({ length: 9 }).map((_, i) => <CourseCardSkeleton key={i} />)
              : null}
            {!showCatalogSkeleton &&
              gridCourses.map((course) => {
                const times = timesByCourse.get(course.id) ?? [];
                const inFetchPool = fetchSlugSet.has(course.id);
                const outOfScope = !inFetchPool && !fetchAllUtah;
                const timesPending = inFetchPool && pendingSlugs.has(course.id);
                const detailHref = `/course/${course.id}?${courseDetailQueryString(params)}`;
                return (
                  <CourseMarketplaceCard
                    key={course.id}
                    course={course}
                    record={recordsBySlug.get(course.id)}
                    times={times}
                    detailHref={detailHref}
                    timesPending={timesPending}
                    outOfScope={outOfScope}
                    onAlert={() => setNotifCourseId(course.id)}
                    onSearchAllUtah={() => setFetchScope('all')}
                    onShare={() => void shareCourseRound(course, times)}
                    shareBusy={shareBusyCourseId === course.id}
                    shareDisabled={times.length === 0 || timesPending || authLoading}
                  />
                );
              })}
          </div>
        )}

        {view === 'list' && bookingOnlySorted.length > 0 ? (
          <div style={{ marginTop: 22, display: 'grid', gap: 14 }}>
            {bookingOnlySorted.length > 0 ? (
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 16,
                  background: 'rgba(255,255,255,0.88)',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowBookingOnly((s) => !s)}
                  className="btn btn-ghost"
                  style={{
                    width: '100%',
                    borderRadius: 0,
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    fontWeight: 900,
                    border: 'none',
                    borderBottom: showBookingOnly ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <span>
                    More courses — book on vendor site ({bookingOnlySorted.length})
                  </span>
                  <span style={{ color: 'var(--muted)', fontWeight: 800 }}>{showBookingOnly ? '▼' : '▶'}</span>
                </button>
                {showBookingOnly ? (
                  <div style={{ padding: 14 }}>
                    <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
                      Live tee-time feeds are added per booking platform in the worker. These courses still appear in search so multi-state expansion stays one catalog experience — open the site to see real availability.
                    </p>
                    <div className="grid-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                      {bookingOnlySorted.map((course) => (
                        <div
                          key={course.id}
                          style={{
                            border: '1px solid var(--border)',
                            borderRadius: 14,
                            padding: 12,
                            background: '#fff',
                          }}
                        >
                          <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: '-0.02em' }}>
                            {course.name} <span style={{ color: 'var(--muted)', fontWeight: 700 }}>({course.city})</span>
                          </div>
                          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span className="pill">{platformDisplayName(course.platform)}</span>
                            <span className="pill" style={{ fontSize: 11 }}>
                              {capabilityHint(getPlatformCapability(course.platform))}
                            </span>
                          </div>
                          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {course.bookingUrl ? (
                              <a className="btn btn-primary" href={course.bookingUrl} target="_blank" rel="noreferrer" style={{ padding: '8px 12px' }}>
                                Open booking site
                              </a>
                            ) : null}
                            <Link
                              className="btn"
                              to={`/course/${course.id}?${courseDetailQueryString(params)}`}
                              style={{ padding: '8px 12px' }}
                            >
                              Details
                            </Link>
                            <button
                              className="btn"
                              type="button"
                              onClick={() => setNotifCourseId(course.id)}
                              style={{ padding: '8px 10px' }}
                              title="Tee time alerts"
                              aria-label={`Tee time alerts for ${course.name}`}
                            >
                              🔔
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ marginTop: 26, padding: 16, border: '1px solid var(--border)', borderRadius: 16, background: 'rgba(255,255,255,0.7)' }}>
          <div style={{ fontWeight: 900, letterSpacing: '-0.02em' }}>How shared rounds work</div>
          <p style={{ color: 'var(--muted)', marginTop: 6 }}>
            {user ? (
              <>
                Tap <strong style={{ color: 'var(--ink)' }}>Share</strong> at the bottom of a course card to create a link with <strong>every tee time</strong> that matches your filters — the link is copied for chat. Open <strong>Shared rounds</strong> in the nav to see links you created.
              </>
            ) : (
              <>
                Sign in, then tap <strong style={{ color: 'var(--ink)' }}>Share</strong> at the bottom of a course card to create a link with <strong>every tee time</strong> that matches your filters — the link is copied for chat. Open <strong>Shared rounds</strong> in the nav to see links you created.
              </>
            )}
          </p>
        </div>
      </div>

      <SignInToShareModal open={signInToShareOpen} onClose={closeSignInToShare} />

      <NotificationModal
        open={notifCourseId != null}
        course={notifCourseId ? coursesById.get(notifCourseId) ?? null : null}
        defaultDate={params.date}
        onClose={() => setNotifCourseId(null)}
      />
    </div>
  );
}

