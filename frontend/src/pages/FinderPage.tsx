import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Course, SearchParams, SortBy, TeeTime, TimeOfDayPreset } from '../types';
import { matchesPreset, minutesSince, toYmd, formatDateShort, formatDateCompact } from '../lib/time';
import { sortFinderGridCourses, sortCourses } from '../lib/sort';
import {
  filterWorkerCourses,
  getPlatformCapability,
} from '../lib/platformRegistry';
import { useAuth } from '../state/AuthContext';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { useTimesByCourseMap } from '../hooks/useTimesByCourseMap';
const MapView = lazy(() => import('../components/MapView').then((m) => ({ default: m.MapView })));
import { NotificationModal } from '../components/NotificationModal';
import { SignInToShareModal } from '../components/SignInToShareModal';
import { PlanRoundModal } from '../components/PlanRoundModal';
import { CourseCardSkeleton } from '../components/CourseCardSkeleton';
import { CourseMarketplaceCard } from '../components/CourseMarketplaceCard';
import { FinderDayOutlook } from '../components/FinderDayOutlook';
import { FeedTeaser } from '../components/FeedTeaser';
import { useScopedOpenings } from '../hooks/useScopedOpenings';
import { courseDetailQueryString, feedQueryString } from '../lib/finderUrl';
import {
  buildTimesFetchScope,
  courseMatchesLocationQuery,
  distanceFromAnchor,
  filterCoursesWithinRadius,
  DEFAULT_FETCH_RADIUS_MI,
} from '../lib/timesFetchScope';
import { resolveZipQuery } from '../lib/zipSearch';

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

type PlanRoundTarget = {
  course: Course;
  times: TeeTime[];
  initialSelectedId: string | null;
};

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
  const { setMinPlayers, openCount, statewideHiddenCount } = useScopedOpenings({
    fetchAllUtah: params.fetchScope === 'all',
    locationQuery: params.locationQuery,
  });

  useEffect(() => {
    setMinPlayers(params.players);
  }, [params.players, setMinPlayers]);

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

  /** When the location box holds a Utah ZIP, resolve it to a centroid anchor. */
  const zipMatch = useMemo(() => resolveZipQuery(locationDraft), [locationDraft]);

  /** Filter to courses near the ZIP centroid and re-express distance from it. */
  const coursesNearZip = useCallback(
    (pool: Course[]) => {
      if (!zipMatch) return pool;
      const anchor = { ...zipMatch.anchor, source: 'default' as const };
      return filterCoursesWithinRadius(pool, anchor, DEFAULT_FETCH_RADIUS_MI).map((c) => ({
        ...c,
        distanceMi: distanceFromAnchor(c, anchor) ?? undefined,
      }));
    },
    [zipMatch]
  );

  const searchPool = useMemo(() => {
    const q = locationDraft.trim();
    let pool = holesCompatibleCourses;
    if (zipMatch) {
      pool = coursesNearZip(pool);
    } else if (q) {
      pool = pool.filter((c) => courseMatchesLocationQuery(c, q));
    } else if (!fetchAllUtah) {
      pool = pool.filter((c) => fetchSlugSet.has(c.id));
    }
    return pool;
  }, [holesCompatibleCourses, locationDraft, zipMatch, coursesNearZip, fetchAllUtah, fetchSlugSet]);

  const searchPendingCommit =
    locationDraft.trim() !== params.locationQuery.trim() && locationDraft.trim().length > 0;

  const {
    timesByCourse: rawTimesByCourse,
    sourceBySlug,
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
    // Stable distance order while inventory streams in — one intentional reorder when the batch finishes.
    if (loadingTimes) {
      return sortCourses([...searchPool], new Map(), 'distance');
    }
    return sortFinderGridCourses(searchPool, timesByCourse, params.sortBy);
  }, [loadingTimes, params.sortBy, searchPool, timesByCourse]);

  const withTimesCount = useMemo(
    () => gridCourses.filter((c) => (timesByCourse.get(c.id)?.length ?? 0) > 0).length,
    [gridCourses, timesByCourse]
  );

  const resultCountLabel = catalogLoading
    ? 'Loading courses…'
    : loadingTimes
      ? attemptedSlugCount > 0
        ? `Checking ${loadedSlugCount}/${attemptedSlugCount} courses…`
        : 'Checking courses…'
      : `${withTimesCount} with tee times · ${gridCourses.length} courses`;

  const workerFetchTotalFailure =
    !loadingTimes && failedSlugs.length > 0 && failedSlugs.length === attemptedSlugCount && attemptedSlugCount > 0;
  const workerFetchPartialFailure = !loadingTimes && failedSlugs.length > 0 && !workerFetchTotalFailure;

  /** Same search as live list, but over the full catalog (other platforms). */
  const queryAllCourses = useMemo(() => {
    const q = locationDraft.trim();
    if (zipMatch) return coursesNearZip(courses);
    if (!q) return courses;
    return courses.filter((c) => courseMatchesLocationQuery(c, q));
  }, [courses, locationDraft, zipMatch, coursesNearZip]);

  const bookingOnlyCourses = useMemo(() => {
    return queryAllCourses.filter((c) => getPlatformCapability(c.platform) !== 'live_inventory');
  }, [queryAllCourses]);

  const bookingOnlySorted = useMemo(
    () => [...bookingOnlyCourses].sort(sortCoursesByDistanceThenName),
    [bookingOnlyCourses]
  );

  const [showBookingOnly, setShowBookingOnly] = useState(true);
  const [planRound, setPlanRound] = useState<PlanRoundTarget | null>(null);
  const [planAfterSignIn, setPlanAfterSignIn] = useState<PlanRoundTarget | null>(null);
  const [signInToShareOpen, setSignInToShareOpen] = useState(false);
  const closeSignInToShare = useCallback(() => {
    setSignInToShareOpen(false);
    setPlanAfterSignIn(null);
  }, []);

  const updatedLabel = useMemo(() => {
    const m = minutesSince(lastUpdatedAt);
    if (m == null) return '—';
    if (m === 0) return 'Updated just now';
    return `Updated ${m}m ago`;
  }, [lastUpdatedAt]);

  useEffect(() => {
    if (user?.id && planAfterSignIn) {
      setPlanRound(planAfterSignIn);
      setPlanAfterSignIn(null);
      setSignInToShareOpen(false);
    }
  }, [user?.id, planAfterSignIn]);

  const requestShareRound = useCallback(
    (course: Course, courseTimes: TeeTime[]) => {
      if (courseTimes.length === 0) return;
      const target: PlanRoundTarget = {
        course,
        times: courseTimes,
        initialSelectedId: courseTimes[0]?.id ?? null,
      };
      if (!user?.id) {
        setPlanAfterSignIn(target);
        setSignInToShareOpen(true);
        return;
      }
      setPlanRound(target);
    },
    [user?.id],
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

  const playersHolesSelect = () => (
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
  );

  const dateField = (id: string) => (
    <span className="sp-date">
      <span className="sp-date-label" aria-hidden>
        {formatDateCompact(params.date)}
      </span>
      <input
        id={id}
        type="date"
        value={params.date}
        aria-label="Date"
        onChange={(e) => setParam('date', e.target.value)}
      />
    </span>
  );

  return (
    <div className="container">
      <div className="finder-page">
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
            <div className="sp-cell sp-desktop-only">
              <span className="sp-label">When</span>
              <span className="sp-value">{dateField('finder-date-desktop')}</span>
            </div>
            <div className="sp-cell sp-desktop-only">
              <span className="sp-label">Players</span>
              <span className="sp-value">{playersHolesSelect()}</span>
            </div>
            <button className="sp-go" type="button" aria-label="Search" onClick={runSearch}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.4" />
                <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {searchPendingCommit ? (
            <div style={{ maxWidth: 860, margin: '8px auto 0', fontSize: 12, color: 'var(--ink-3)', textAlign: 'center' }}>
              Press Enter or search to load times for this place.
            </div>
          ) : null}

          <div className="sp-mobile-sheet">
            <div className="sp-cell">
              <span className="sp-label">When</span>
              <span className="sp-value">{dateField('finder-date-mobile')}</span>
            </div>
            <div className="sp-cell">
              <span className="sp-label">Players</span>
              <span className="sp-value">{playersHolesSelect()}</span>
            </div>
          </div>
        </div>

        <div className="filter-toolbar">
          <div className="filter-row">
            {timeChip('any', 'Any time')}
            {timeChip('morning', 'Morning')}
            {timeChip('afternoon', 'Afternoon')}
            {timeChip('evening', 'Twilight')}
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
          </div>
          <div className="filter-controls">
            <div className="seg" role="group" aria-label="View">
              <button className={view === 'list' ? 'on' : ''} type="button" onClick={() => setView('list')}>
                List
              </button>
              <button className={view === 'map' ? 'on' : ''} type="button" onClick={() => setView('map')}>
                Map
              </button>
            </div>
            <label className="sort-control">
              <span className="visually-hidden">Sort</span>
              <select
                value={params.sortBy}
                aria-label="Sort"
                onChange={(e) => setParam('sort', e.target.value as SortBy)}
              >
                <option value="distance">Distance</option>
                <option value="soonest">Soonest</option>
                <option value="price">Price</option>
                <option value="rating">Rating</option>
              </select>
            </label>
          </div>
        </div>

        {view === 'list' ? (
          <FeedTeaser
            players={params.players}
            fetchAllUtah={fetchAllUtah}
            locationQuery={params.locationQuery}
          />
        ) : null}

        <div className="result-meta">
          <span className="result-count">
            <strong>{resultCountLabel}</strong>
            {updatedLabel !== '—' ? ` · ${updatedLabel}` : ''}
            <span className="result-count-date">{` · ${formatDateShort(params.date)}`}</span>
          </span>
          <FinderDayOutlook dateYmd={params.date} />
        </div>

        {!catalogLoading && !loadingTimes && !catalogError && searchPool.length === 0 && workerCourses.length > 0 ? (
          <div className="empty-search">
            <div className="empty-search-title">No courses match that search</div>
            <p>
              Try clearing the location box, switching time of day to <strong>Any</strong>, or picking another date.
              {!fetchAllUtah && timesFetchScope.mode === 'nearby' && timesFetchScope.outOfScopeCount > 0
                ? ' Try Search all Utah for statewide results, or search a city like St. George.'
                : ' The full live catalog stays available when your search matches again.'}
            </p>
            <div className="empty-search-actions">
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

        {!catalogLoading && !loadingTimes && withTimesCount === 0 && searchPool.length > 0 && openCount > 0 ? (
          <div className="empty-openings-hint">
            <p>
              No tee times match your search for <strong>{formatDateShort(params.date)}</strong>. Recent openings may still be available nearby.
            </p>
            <Link
              to={`/feed?${feedQueryString({ players: params.players, locationQuery: params.locationQuery, fetchScope: params.fetchScope })}`}
              className="btn btn-primary"
            >
              See {openCount} recent opening{openCount !== 1 ? 's' : ''} →
            </Link>
          </div>
        ) : null}

        {!catalogLoading && !loadingTimes && withTimesCount === 0 && searchPool.length > 0 && openCount === 0 && statewideHiddenCount > 0 ? (
          <div className="empty-openings-hint">
            <p>
              No tee times or recent openings nearby for <strong>{formatDateShort(params.date)}</strong>.
            </p>
            <Link
              to={`/feed?${feedQueryString({ players: params.players, locationQuery: params.locationQuery, fetchScope: 'all' })}`}
              className="btn btn-primary"
            >
              See {statewideHiddenCount} opening{statewideHiddenCount !== 1 ? 's' : ''} statewide →
            </Link>
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
          <div className={`mp-grid${loadingTimes ? ' is-loading' : ''}`}>
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
                    inventorySource={sourceBySlug.get(course.id)}
                    batchLoading={loadingTimes}
                    dateYmd={params.date}
                    players={params.players}
                    holes={params.holes}
                    onAlert={() => setNotifCourseId(course.id)}
                    onSearchAllUtah={() => setFetchScope('all')}
                    onShare={() => requestShareRound(course, times)}
                    shareDisabled={times.length === 0 || timesPending || authLoading}
                  />
                );
              })}
          </div>
        )}

        {view === 'list' && bookingOnlySorted.length > 0 ? (
          <section className="booking-only-section">
            <button
              type="button"
              className="booking-only-toggle"
              onClick={() => setShowBookingOnly((s) => !s)}
              aria-expanded={showBookingOnly}
            >
              <span>
                Coming soon <span className="booking-only-count">({bookingOnlySorted.length})</span>
              </span>
              <span className="booking-only-chevron" aria-hidden>
                {showBookingOnly ? '−' : '+'}
              </span>
            </button>
            {showBookingOnly ? (
              <>
                <p className="booking-only-blurb">
                  These courses aren&apos;t on live inventory yet. We&apos;ll add tee times as platforms come online.
                </p>
                <div className="mp-grid booking-only-grid">
                  {bookingOnlySorted.map((course) => (
                    <CourseMarketplaceCard
                      key={course.id}
                      course={course}
                      record={recordsBySlug.get(course.id)}
                      detailHref={`/course/${course.id}?${courseDetailQueryString(params)}`}
                      variant="comingSoon"
                      dateYmd={params.date}
                      players={params.players}
                      holes={params.holes}
                      onAlert={() => setNotifCourseId(course.id)}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        <div className="finder-help">
          <div className="finder-help-title">Planning with a group?</div>
          <p>
            Tap <strong>Share times</strong> on any course to pick tee times and get a vote link, or open a course for
            the full list. Past links live under <strong>Shared rounds</strong> in the nav.
          </p>
        </div>
      </div>

      <SignInToShareModal open={signInToShareOpen} onClose={closeSignInToShare} />
      {planRound ? (
        <PlanRoundModal
          open
          onClose={() => setPlanRound(null)}
          course={planRound.course}
          record={recordsBySlug.get(planRound.course.id)}
          dateYmd={params.date}
          players={params.players}
          holes={params.holes}
          times={planRound.times}
          initialSelectedId={planRound.initialSelectedId}
          coursesById={coursesById}
          recordsBySlug={recordsBySlug}
        />
      ) : null}

      <NotificationModal
        open={notifCourseId != null}
        course={notifCourseId ? coursesById.get(notifCourseId) ?? null : null}
        defaultDate={params.date}
        onClose={() => setNotifCourseId(null)}
      />
    </div>
  );
}
