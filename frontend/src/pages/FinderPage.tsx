import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Course, FetchRadiusMi, SearchParams, SortBy, TeeTime, TimeOfDayPreset } from '../types';
import { matchesPreset, minutesSince, toYmd, formatDateShort, formatDateCompact } from '../lib/time';
import { sortFinderGridCourses, sortCourses } from '../lib/sort';
import {
  filterWorkerCourses,
  getPlatformCapability,
} from '../lib/platformRegistry';
import { useAuth } from '../state/AuthContext';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { useTimesByCourseMap } from '../hooks/useTimesByCourseMap';
import { NotificationModal } from '../components/NotificationModal';
import { SignInPromptModal } from '../components/SignInPromptModal';
import { PlanRoundModal } from '../components/PlanRoundModal';
import { CourseCardSkeleton } from '../components/CourseCardSkeleton';
import { CourseMarketplaceCard } from '../components/CourseMarketplaceCard';
import { FinderDayOutlook } from '../components/FinderDayOutlook';
import { LocationSearchSheet } from '../components/LocationSearchSheet';
import { FeedTeaser } from '../components/FeedTeaser';
import { courseDetailQueryString } from '../lib/finderUrl';
import {
  buildTimesFetchScope,
  courseMatchesLocationQuery,
  distanceFromAnchor,
  filterCoursesWithinRadius,
  parseFetchRadiusMi,
  resolvePlaceAnchor,
  DEFAULT_FETCH_RADIUS_MI,
} from '../lib/timesFetchScope';
import { teeTimeFitsPlayers } from '../lib/teeTimeFitsPlayers';

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
  const radiusMi = parseFetchRadiusMi(sp.get('radius'));
  return { date, players, holes, timeOfDay, sortBy, locationQuery, fetchScope, radiusMi };
}

/** Worker refetch only when date or party size changes — not text search, sort, or time-of-day. */
const FETCH_PARAM_KEYS = new Set(['date', 'holes', 'players']);

type PlanRoundTarget = {
  course: Course;
  times: TeeTime[];
  initialSelectedId: string | null;
};

export function FinderPage() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const params = useMemo(() => parseParams(sp), [sp]);
  const [locationDraft, setLocationDraft] = useState(() => params.locationQuery);

  /** Keep draft in sync when URL q changes externally (back button, shared link). */
  useEffect(() => {
    setLocationDraft(params.locationQuery);
  }, [params.locationQuery]);

  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(Date.now());
  const [notifCourseId, setNotifCourseId] = useState<string | null>(null);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
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
  const radiusMi = params.radiusMi;

  /** Radius select: 15 / 25 / 50 mi, or statewide (`all`). */
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
      setLastUpdatedAt(Date.now());
    },
    [sp, setSp]
  );

  const radiusSelectValue: string = fetchAllUtah ? 'all' : String(radiusMi);

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
        radiusMi,
        placeCourses: courses,
      }),
    [holesCompatibleCourses, userLocation, fetchAllUtah, params.locationQuery, radiusMi, courses]
  );

  const fetchPool = timesFetchScope.fetchPool;

  const fetchSlugSet = useMemo(() => new Set(fetchPool.map((c) => c.id)), [fetchPool]);

  /** When the location box holds a Utah ZIP or city, resolve it to a map anchor. */
  const placeMatch = useMemo(
    () => resolvePlaceAnchor(locationDraft, courses),
    [locationDraft, courses],
  );

  /** Filter to courses near the place centroid and re-express distance from it. */
  const coursesNearPlace = useCallback(
    (pool: Course[]) => {
      if (!placeMatch) return pool;
      const anchor = { ...placeMatch.anchor, source: 'default' as const };
      return filterCoursesWithinRadius(pool, anchor, radiusMi).map((c) => ({
        ...c,
        distanceMi: distanceFromAnchor(c, anchor) ?? undefined,
      }));
    },
    [placeMatch, radiusMi],
  );

  const searchPool = useMemo(() => {
    const q = locationDraft.trim();
    let pool = holesCompatibleCourses;
    if (placeMatch) {
      pool = coursesNearPlace(pool);
    } else if (q) {
      pool = pool.filter((c) => courseMatchesLocationQuery(c, q));
    } else if (!fetchAllUtah) {
      pool = pool.filter((c) => fetchSlugSet.has(c.id));
    }
    return pool;
  }, [holesCompatibleCourses, locationDraft, placeMatch, coursesNearPlace, fetchAllUtah, fetchSlugSet]);

  const {
    timesByCourse: rawTimesByCourse,
    sourceBySlug,
    loadingTimes,
    failedSlugs,
    attemptedSlugCount,
    pendingSlugs,
  } = useTimesByCourseMap(
    fetchPool,
    recordsBySlug,
    params.date,
    params.holes,
    params.players,
    lastUpdatedAt ?? 0,
    catalogLoading
  );

  const showCatalogSkeleton = !catalogError && catalogLoading;

  const timesByCourse = useMemo(() => {
    const map = new Map<string, TeeTime[]>();
    for (const [courseId, list] of rawTimesByCourse) {
      const filtered = list.filter(
        (t) => matchesPreset(t.startsAt, params.timeOfDay) && teeTimeFitsPlayers(t, params.players),
      );
      filtered.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
      map.set(courseId, filtered);
    }
    return map;
  }, [rawTimesByCourse, params.timeOfDay, params.players]);

  const gridCourses = useMemo(() => {
    // Progressive open-first as results arrive (avoids looking "stuck" while a slow
    // vendor like GolfPay is still pending).
    if (loadingTimes && timesByCourse.size === 0) {
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

  /** Booking-link courses in the same geographic / search scope as the live grid. */
  const bookingOnlyInScope = useMemo(() => {
    let list = courses.filter((c) => getPlatformCapability(c.platform) !== 'live_inventory');
    if (params.holes !== 9) list = list.filter((c) => c.holes !== 9);

    const q = locationDraft.trim();
    if (fetchAllUtah && !placeMatch && !q) {
      return [...list].sort(sortCoursesByDistanceThenName);
    }
    if (placeMatch) {
      return coursesNearPlace(list).sort(sortCoursesByDistanceThenName);
    }
    if (q) {
      return list
        .filter((c) => courseMatchesLocationQuery(c, q))
        .sort(sortCoursesByDistanceThenName);
    }
    const anchor = timesFetchScope.anchor;
    return filterCoursesWithinRadius(list, anchor, radiusMi)
      .map((c) => ({
        ...c,
        distanceMi: distanceFromAnchor(c, anchor) ?? undefined,
      }))
      .sort(sortCoursesByDistanceThenName);
  }, [
    courses,
    params.holes,
    locationDraft,
    fetchAllUtah,
    placeMatch,
    coursesNearPlace,
    timesFetchScope.anchor,
    radiusMi,
  ]);

  const displayCourses = useMemo(() => {
    if (bookingOnlyInScope.length === 0) return gridCourses;
    const liveIds = new Set(gridCourses.map((c) => c.id));
    const extras = bookingOnlyInScope.filter((c) => !liveIds.has(c.id));
    if (extras.length === 0) return gridCourses;
    const combined = [...gridCourses, ...extras];
    if (loadingTimes && timesByCourse.size === 0) {
      return combined.sort(sortCoursesByDistanceThenName);
    }
    return sortFinderGridCourses(combined, timesByCourse, params.sortBy);
  }, [gridCourses, bookingOnlyInScope, loadingTimes, timesByCourse, params.sortBy]);

  const resultCountPrimary = catalogLoading
    ? 'Loading courses…'
    : withTimesCount > 0
      ? `${withTimesCount} open`
      : loadingTimes
        ? 'Finding tee times…'
        : `${displayCourses.length} courses`;

  const resultCountSecondary = catalogLoading
    ? null
    : loadingTimes && withTimesCount > 0
      ? 'still checking a few…'
      : loadingTimes
        ? null
        : (() => {
            const m = minutesSince(lastUpdatedAt);
            if (m == null) return null;
            if (m === 0) return 'Updated just now';
            return `Updated ${m}m ago`;
          })();

  const [planRound, setPlanRound] = useState<PlanRoundTarget | null>(null);
  const [planAfterSignIn, setPlanAfterSignIn] = useState<PlanRoundTarget | null>(null);
  const [signInToShareOpen, setSignInToShareOpen] = useState(false);
  const closeSignInToShare = useCallback(() => {
    setSignInToShareOpen(false);
    setPlanAfterSignIn(null);
  }, []);

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

  const shiftDate = useCallback(
    (deltaDays: number) => {
      const [y, m, d] = params.date.split('-').map(Number);
      const dt = new Date(y!, m! - 1, d!);
      dt.setDate(dt.getDate() + deltaDays);
      setParam('date', toYmd(dt));
    },
    [params.date, setParam],
  );

  const applyLocationQuery = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      setLocationDraft(trimmed);
      const next = new URLSearchParams(sp);
      if (trimmed) next.set('q', trimmed);
      else next.delete('q');
      // Choosing a place should search nearby for that place, not statewide.
      next.delete('scope');
      setSp(next, { replace: true });
      setLastUpdatedAt(Date.now());
    },
    [sp, setSp],
  );

  const applyNearMe = useCallback(() => {
    setLocationDraft('');
    const next = new URLSearchParams(sp);
    next.delete('q');
    next.delete('scope');
    setSp(next, { replace: true });
    setLastUpdatedAt(Date.now());
  }, [sp, setSp]);

  const timeChip = (tod: TimeOfDayPreset, label: string) => (
    <button
      className={`chip${params.timeOfDay === tod ? ' on' : ''}`}
      onClick={() => setParam('tod', tod)}
      type="button"
    >
      {label}
    </button>
  );

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

  const whereLabel =
    params.locationQuery.trim() ||
    (timesFetchScope.anchor.source === 'gps' ? 'Near me' : 'Salt Lake area');

  return (
    <div className="container">
      <div className="finder-page">
        {catalogError ? (
          <div className="app-banner app-banner--error" role="alert">
            <strong>Could not load courses.</strong> {catalogError}
            <div className="app-banner-actions">
              <button type="button" className="btn btn-primary" onClick={() => void refreshCatalog()}>
                Try again
              </button>
            </div>
          </div>
        ) : null}

        {workerFetchTotalFailure ? (
          <div className="app-banner app-banner--error" role="alert">
            <strong>Could not load live tee times.</strong> Check your connection, then search again.
            <div className="app-banner-actions">
              <button type="button" className="btn btn-primary" onClick={() => setLastUpdatedAt(Date.now())}>
                Retry now
              </button>
            </div>
          </div>
        ) : workerFetchPartialFailure ? (
          <div className="app-banner app-banner--warn" role="status">
            <strong>Some courses didn&apos;t refresh</strong> ({failedSlugs.length} of {attemptedSlugCount}). Results may
            be incomplete.
          </div>
        ) : null}

        <div className="search-zone">
          {/* Desktop: When · Players · Where (search icon at end) */}
          <div className="search-pill search-pill--desktop">
            <div className="sp-cell sp-cell-when">
              <span className="sp-label">When</span>
              <span className="sp-value sp-value-when">
                <button type="button" className="sp-date-nudge" aria-label="Previous day" onClick={() => shiftDate(-1)}>
                  ‹
                </button>
                {dateField('finder-date-desktop')}
                <button type="button" className="sp-date-nudge" aria-label="Next day" onClick={() => shiftDate(1)}>
                  ›
                </button>
              </span>
            </div>
            <div className="sp-cell">
              <span className="sp-label">Players</span>
              <span className="sp-value">{playersHolesSelect()}</span>
            </div>
            <button
              type="button"
              className="sp-cell sp-cell-btn"
              onClick={() => setLocationSheetOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={locationSheetOpen}
            >
              <span className="sp-label">Where</span>
              <span className="sp-value sp-value-btn">
                <span className="sp-where-text">{whereLabel}</span>
              </span>
            </button>
            <button
              className="sp-go"
              type="button"
              aria-label="Refresh results"
              title="Refresh"
              onClick={() => setLastUpdatedAt(Date.now())}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M20 12a8 8 0 10-2.3 5.5"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <path
                  d="M20 7v5h-5"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          {/* Mobile: When · Players · Where — same order as desktop */}
          <div className="finder-mobile-search">
            <div className="finder-mobile-bar">
              <div className="finder-date-control">
                <button
                  type="button"
                  className="finder-date-nudge"
                  aria-label="Previous day"
                  onClick={() => shiftDate(-1)}
                >
                  ‹
                </button>
                {/* Overlay native date input — iOS ignores showPicker() on clipped/hidden proxies. */}
                <span className="finder-date-pill">
                  <span className="finder-date-label" aria-hidden>
                    {formatDateCompact(params.date)}
                  </span>
                  <input
                    type="date"
                    className="finder-date-input"
                    value={params.date}
                    aria-label={`Date, ${formatDateCompact(params.date)}`}
                    onChange={(e) => {
                      if (e.target.value) setParam('date', e.target.value);
                    }}
                  />
                </span>
                <button
                  type="button"
                  className="finder-date-nudge"
                  aria-label="Next day"
                  onClick={() => shiftDate(1)}
                >
                  ›
                </button>
              </div>

              <label className="finder-players-pill finder-players-pill--compact">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
                  <path
                    d="M3.5 19c.8-3 2.8-4.5 5.5-4.5S13.7 16 14.5 19"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                  <circle cx="17" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.8" />
                  <path
                    d="M14.8 19c.5-2.2 1.8-3.3 3.7-3.3 1.5 0 2.7.7 3.5 2"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="finder-players-pill-value" aria-hidden>
                  {params.players} · {params.holes}h
                </span>
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
              </label>

              <button
                type="button"
                className="finder-where-pill"
                onClick={() => setLocationSheetOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={locationSheetOpen}
              >
                <span className="finder-where-pill-text">{whereLabel}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="filter-toolbar">
          <div className="filter-row">
            {timeChip('any', 'Any time')}
            {timeChip('morning', 'Morning')}
            {timeChip('afternoon', 'Afternoon')}
            {timeChip('evening', 'Twilight')}
          </div>
          <div className="filter-controls">
            <label className="sort-control radius-control">
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

        <FeedTeaser
          players={params.players}
          fetchAllUtah={fetchAllUtah}
          locationQuery={params.locationQuery}
          radiusMi={radiusMi}
        />

        <div className="result-meta">
          <span
            className={`result-count${
              loadingTimes && withTimesCount === 0 ? ' is-finding' : ''
            }`}
          >
            <strong>{resultCountPrimary}</strong>
            {resultCountSecondary ? (
              <span className="result-count-secondary"> · {resultCountSecondary}</span>
            ) : null}
          </span>
          <FinderDayOutlook
            dateYmd={params.date}
            lat={timesFetchScope.anchor.lat}
            lng={timesFetchScope.anchor.lng}
            regionLabel={
              params.locationQuery.trim() ||
              (timesFetchScope.anchor.source === 'gps' ? 'Near you' : 'Salt Lake area')
            }
          />
        </div>

        {!catalogLoading && !loadingTimes && !catalogError && displayCourses.length === 0 && workerCourses.length > 0 ? (
          <div className="empty-search">
            <div className="empty-search-title">No courses match that search</div>
            <p>
              Try clearing the location box, switching time of day to <strong>Any</strong>, or picking another date.
              {!fetchAllUtah && timesFetchScope.outOfScopeCount > 0
                ? ' Widen the radius or try Statewide for more courses, or search a city like St. George.'
                : ' The full live catalog stays available when your search matches again.'}
            </p>
            <div className="empty-search-actions">
              {params.locationQuery.trim() ? (
                <button type="button" className="btn btn-primary" onClick={applyNearMe}>
                  Clear search
                </button>
              ) : null}
              {!fetchAllUtah && radiusMi < 50 ? (
                <button type="button" className="btn btn-primary" onClick={() => setRadiusMode(50)}>
                  Within 50 mi
                </button>
              ) : null}
              {!fetchAllUtah && timesFetchScope.outOfScopeCount > 0 ? (
                <button type="button" className="btn btn-primary" onClick={() => setRadiusMode('all')}>
                  Try Statewide
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

        {!catalogLoading && !loadingTimes && withTimesCount === 0 && searchPool.length > 0 ? (
          <div className="empty-openings-hint">
            <p>
              No tee times match your search for <strong>{formatDateShort(params.date)}</strong>. Tap the bell on a
              course to get notified when times open, or try another day.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const d = new Date(params.date + 'T12:00:00');
                d.setDate(d.getDate() + 1);
                setParam('date', toYmd(d));
              }}
            >
              Try tomorrow
            </button>
          </div>
        ) : null}

        <div className={`mp-grid${loadingTimes ? ' is-loading' : ''}`}>
          {showCatalogSkeleton
            ? Array.from({ length: 9 }).map((_, i) => <CourseCardSkeleton key={i} />)
            : null}
          {!showCatalogSkeleton &&
            displayCourses.map((course) => {
              const times = timesByCourse.get(course.id) ?? [];
              const inFetchPool = fetchSlugSet.has(course.id);
              const bookingLinkOnly = getPlatformCapability(course.platform) !== 'live_inventory';
              const outOfScope = !bookingLinkOnly && !inFetchPool && !fetchAllUtah;
              const timesPending = !bookingLinkOnly && inFetchPool && pendingSlugs.has(course.id);
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
                  variant={bookingLinkOnly ? 'bookingLink' : 'inventory'}
                  dateYmd={params.date}
                  players={params.players}
                  holes={params.holes}
                  onAlert={
                    bookingLinkOnly ? undefined : () => setNotifCourseId(course.id)
                  }
                  onSearchAllUtah={() => setRadiusMode('all')}
                  onShare={() => requestShareRound(course, times)}
                  shareDisabled={times.length === 0 || timesPending || authLoading}
                />
              );
            })}
        </div>

        <p className="finder-help">
          Planning a group round? Tap the calendar icon on a course for a vote link — past links live under{' '}
          <strong>Plan</strong>.
        </p>
      </div>

      <SignInPromptModal open={signInToShareOpen} onClose={closeSignInToShare} variant="share" />
      <LocationSearchSheet
        open={locationSheetOpen}
        onClose={() => setLocationSheetOpen(false)}
        courses={courses}
        currentQuery={params.locationQuery}
        locationAvailable={Boolean(userLocation)}
        onSelectNearMe={applyNearMe}
        onSelectQuery={applyLocationQuery}
        onSelectCourse={(course) => {
          navigate(`/course/${course.id}?${courseDetailQueryString(params)}`);
        }}
      />
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
        defaultPlayers={params.players}
        defaultTimeOfDay={params.timeOfDay}
        onClose={() => setNotifCourseId(null)}
      />
    </div>
  );
}
