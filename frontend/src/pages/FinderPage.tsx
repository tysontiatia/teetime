import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { Course, FetchRadiusMi, SearchParams, SortBy, TeeTime, TimeOfDayPreset } from '../types';
import {
  matchesPreset,
  minutesSince,
  toYmd,
  formatDateShort,
  formatDateCompact,
  formatTime12h,
  todayYmdUtah,
  clampDateToTodayOrLater,
  defaultFindDateYmd,
} from '../lib/time';
import { courseTimezone } from '../lib/teeTimeInstant';
import { sortFinderGridCourses, sortCourses } from '../lib/sort';
import {
  filterWorkerCourses,
  getPlatformCapability,
} from '../lib/platformRegistry';
import { resolveCourseBookingMode } from '../lib/courseRecord';
import { useAuth } from '../state/AuthContext';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { useTimesByCourseMap } from '../hooks/useTimesByCourseMap';
import { useIsCompactShell } from '../hooks/useMediaQuery';
import { NotificationModal } from '../components/NotificationModal';
import { SignInPromptModal } from '../components/SignInPromptModal';
import { PlanRoundModal } from '../components/PlanRoundModal';
import { CourseCardSkeleton } from '../components/CourseCardSkeleton';
import { CourseMarketplaceCard } from '../components/CourseMarketplaceCard';
import { FinderDayOutlook } from '../components/FinderDayOutlook';
import { LocationSearchSheet } from '../components/LocationSearchSheet';
import { SlotActionSheet } from '../components/SlotActionSheet';
import { slotActionMeta } from '../lib/slotAction';
import {
  authReturnPath,
  clearPendingAuthAction,
  peekPendingAuthAction,
  savePendingAuthAction,
  takePendingAuthAction,
} from '../lib/pendingAuthAction';
import { courseDetailQueryString, rememberFinderSearch, rememberedFinderSearchParams } from '../lib/finderUrl';
import { captureEvent } from '../lib/analytics';
import { holesFilterLabel, parseHolesFilter } from '../lib/holesFilter';
import {
  buildTimesFetchScope,
  courseMatchesLocationQuery,
  courseMatchesResolvedPlace,
  distanceFromAnchor,
  filterCoursesWithinRadius,
  parseFetchRadiusMi,
  resolvePlaceAnchor,
  DEFAULT_FETCH_RADIUS_MI,
} from '../lib/timesFetchScope';
import { resolveServiceArea } from '../lib/serviceArea';
import { teeTimeFitsPlayers } from '../lib/teeTimeFitsPlayers';

function clampPlayers(n: number): 1 | 2 | 3 | 4 {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

function sortCoursesByDistanceThenName(a: Course, b: Course): number {
  const da = typeof a.distanceMi === 'number' ? a.distanceMi : Number.POSITIVE_INFINITY;
  const db = typeof b.distanceMi === 'number' ? b.distanceMi : Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return a.catalogName.localeCompare(b.catalogName);
}

function parseParams(sp: URLSearchParams): SearchParams {
  const date = clampDateToTodayOrLater(sp.get('date') || defaultFindDateYmd());
  const players = clampPlayers(Number(sp.get('players') || 2));
  const holes = parseHolesFilter(sp.get('holes'));
  const timeOfDay = (sp.get('tod') as TimeOfDayPreset) || 'any';
  const sortBy = (sp.get('sort') as SortBy) || 'soonest';
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

type SlotActionTarget = {
  course: Course;
  time: TeeTime;
  times: TeeTime[];
  bookHref: string | null;
  detailHref: string;
  resumeBook?: boolean;
};

export function FinderPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sp, setSp] = useSearchParams();
  const params = useMemo(() => {
    if ([...sp.keys()].length > 0) return parseParams(sp);
    const remembered = rememberedFinderSearchParams();
    return parseParams(remembered ?? sp);
  }, [sp]);
  const todayYmd = todayYmdUtah();
  const [locationDraft, setLocationDraft] = useState(() => params.locationQuery);

  /** Keep draft in sync when URL q changes externally (back button, shared link). */
  useEffect(() => {
    setLocationDraft(params.locationQuery);
  }, [params.locationQuery]);

  /**
   * Persist the Find query. Returning from Alerts/Plan is `to="/"` (basename-safe);
   * empty URL rehydrates from this store so we don't start a new search.
   */
  useEffect(() => {
    if ([...sp.keys()].length === 0) {
      const remembered = rememberedFinderSearchParams();
      if (remembered && [...remembered.keys()].length > 0) {
        setSp(remembered, { replace: true });
        return;
      }
    } else {
      rememberFinderSearch(`?${sp.toString()}`);
    }
    const raw = sp.get('date');
    const nextDate = raw ? clampDateToTodayOrLater(raw) : defaultFindDateYmd();
    if (raw === nextDate) return;
    const next = new URLSearchParams(sp);
    next.set('date', nextDate);
    setSp(next, { replace: true });
  }, [sp, setSp]);

  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(Date.now());
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [notifCourseId, setNotifCourseId] = useState<string | null>(null);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const isCompactShell = useIsCompactShell();
  const querySentinelRef = useRef<HTMLDivElement>(null);
  const queryDockRef = useRef<HTMLDivElement>(null);
  const [queryScrolledAway, setQueryScrolledAway] = useState(false);
  const [queryPinnedOpen, setQueryPinnedOpen] = useState(false);
  const [queryDockHoldPx, setQueryDockHoldPx] = useState<number | null>(null);
  const { user, loading: authLoading, signInWithGoogle } = useAuth();

  const refetchResults = useCallback(() => {
    setRefreshNonce((n) => n + 1);
    setLastUpdatedAt(Date.now());
  }, []);

  useEffect(() => {
    captureEvent('search_performed', {
      date: params.date,
      players: params.players,
      holes: params.holes,
      q: params.locationQuery || null,
      tod: params.timeOfDay,
      scope: params.fetchScope,
      radius_mi: params.radiusMi ?? null,
    });
  }, [
    params.date,
    params.players,
    params.holes,
    params.locationQuery,
    params.timeOfDay,
    params.fetchScope,
    params.radiusMi,
  ]);

  useEffect(() => {
    if (!isCompactShell) {
      setQueryScrolledAway(false);
      setQueryPinnedOpen(false);
      setQueryDockHoldPx(null);
      return;
    }
    const el = querySentinelRef.current;
    if (!el) return;

    let io: IntersectionObserver | null = null;
    const observe = () => {
      io?.disconnect();
      const headerEl = document.querySelector('.app-header');
      const headerH =
        headerEl instanceof HTMLElement ? headerEl.getBoundingClientRect().height : 56;
      io = new IntersectionObserver(
        ([entry]) => {
          if (!entry) return;
          const away = !entry.isIntersecting;
          setQueryScrolledAway(away);
          if (!away) {
            setQueryPinnedOpen(false);
            setQueryDockHoldPx(null);
          }
        },
        { root: null, threshold: 0, rootMargin: `-${Math.round(headerH + 8)}px 0px 0px 0px` },
      );
      io.observe(el);
    };

    observe();
    window.addEventListener('resize', observe);
    return () => {
      io?.disconnect();
      window.removeEventListener('resize', observe);
    };
  }, [isCompactShell]);

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

  const workerCourses = useMemo(() => filterWorkerCourses(courses), [courses]);

  /** When the location box holds a ZIP or city, resolve it to a map anchor. */
  const placeMatch = useMemo(
    () => resolvePlaceAnchor(locationDraft, courses),
    [locationDraft, courses],
  );

  /** 18-hole search: skip true 9-only courses. 9 / any: keep everyone. */
  const holesCompatibleCourses = useMemo(() => {
    if (params.holes === 9 || params.holes === 'any') return workerCourses;
    return workerCourses.filter((c) => c.holes !== 9);
  }, [workerCourses, params.holes]);

  /** When a city/ZIP is selected, always keep courses in that place — even 9-only under an 18 filter. */
  const placeResidentCourses = useMemo(() => {
    if (!placeMatch) return [] as Course[];
    return workerCourses.filter((c) => courseMatchesResolvedPlace(c, placeMatch));
  }, [workerCourses, placeMatch]);

  const scopedWorkerCourses = useMemo(() => {
    if (placeResidentCourses.length === 0) return holesCompatibleCourses;
    const byId = new Map(holesCompatibleCourses.map((c) => [c.id, c]));
    for (const c of placeResidentCourses) {
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
    return [...byId.values()];
  }, [holesCompatibleCourses, placeResidentCourses]);

  const timesFetchScope = useMemo(
    () =>
      buildTimesFetchScope(scopedWorkerCourses, userLocation, {
        fetchAllUtah,
        locationQuery: params.locationQuery,
        radiusMi,
        placeCourses: courses,
      }),
    [scopedWorkerCourses, userLocation, fetchAllUtah, params.locationQuery, radiusMi, courses]
  );

  const fetchPool = timesFetchScope.fetchPool;

  const serviceArea = useMemo(
    () =>
      resolveServiceArea({
        courses: workerCourses,
        userLocation,
        locationQuery: params.locationQuery,
        fetchAll: fetchAllUtah,
        catalogHitsForQuery:
          timesFetchScope.mode === 'search' ? timesFetchScope.searchMatchCount : 0,
      }),
    [workerCourses, userLocation, params.locationQuery, fetchAllUtah, timesFetchScope],
  );
  const showOutOfMarket = !catalogLoading && !catalogError && serviceArea.outside;

  const fetchSlugSet = useMemo(() => new Set(fetchPool.map((c) => c.id)), [fetchPool]);

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
    let pool = scopedWorkerCourses;
    if (placeMatch) {
      const near = coursesNearPlace(pool);
      const byId = new Map(near.map((c) => [c.id, c]));
      const anchor = { ...placeMatch.anchor, source: 'default' as const };
      for (const c of placeResidentCourses) {
        if (!byId.has(c.id)) {
          byId.set(c.id, {
            ...c,
            distanceMi: distanceFromAnchor(c, anchor) ?? undefined,
          });
        }
      }
      pool = [...byId.values()];
    } else if (q) {
      pool = pool.filter((c) => courseMatchesLocationQuery(c, q));
    } else if (!fetchAllUtah) {
      pool = pool.filter((c) => fetchSlugSet.has(c.id));
    }
    return pool;
  }, [
    scopedWorkerCourses,
    locationDraft,
    placeMatch,
    coursesNearPlace,
    placeResidentCourses,
    fetchAllUtah,
    fetchSlugSet,
  ]);

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
    refreshNonce,
    catalogLoading,
  );

  const showCatalogSkeleton = !catalogError && catalogLoading;

  const timesByCourse = useMemo(() => {
    const map = new Map<string, TeeTime[]>();
    const holesFilter = params.holes;
    for (const [courseId, list] of rawTimesByCourse) {
      const tz = courseTimezone(recordsBySlug.get(courseId)?.timezone);
      const filtered = list.filter((t) => {
        if (holesFilter === 9 || holesFilter === 18) {
          if (t.holes !== holesFilter) return false;
        }
        return (
          matchesPreset(t.startsAt, params.timeOfDay, tz) && teeTimeFitsPlayers(t, params.players)
        );
      });
      filtered.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
      map.set(courseId, filtered);
    }
    return map;
  }, [rawTimesByCourse, params.timeOfDay, params.players, params.holes, recordsBySlug]);

  const gridCourses = useMemo(() => {
    // Progressive open-first as results arrive (avoids looking "stuck" while a slow
    // vendor like GolfPay is still pending).
    if (loadingTimes && timesByCourse.size === 0) {
      // Nearby live courses while we wait — don't mix in booking-link rows yet.
      return sortCourses([...searchPool], new Map(), 'distance');
    }
    return sortFinderGridCourses(searchPool, timesByCourse, params.sortBy);
  }, [loadingTimes, params.sortBy, searchPool, timesByCourse]);

  const withTimesCount = useMemo(
    () => gridCourses.filter((c) => (timesByCourse.get(c.id)?.length ?? 0) > 0).length,
    [gridCourses, timesByCourse]
  );

  const openTeeTimeCount = useMemo(
    () => gridCourses.reduce((n, c) => n + (timesByCourse.get(c.id)?.length ?? 0), 0),
    [gridCourses, timesByCourse],
  );

  // Only warn when failed courses actually have no times on screen (rate-limit misses that
  // kept prior inventory should not trip the banner).
  const emptyFailedCount = useMemo(
    () => failedSlugs.filter((slug) => (timesByCourse.get(slug)?.length ?? 0) === 0).length,
    [failedSlugs, timesByCourse],
  );
  const workerFetchTotalFailure =
    !loadingTimes && emptyFailedCount > 0 && emptyFailedCount === attemptedSlugCount && attemptedSlugCount > 0;
  // Partial Chronogolf/live gaps are common when pivoting filters. Don't alarm when the
    // grid already has openings — cards show empty/filter-miss copy for the misses.
  const workerFetchPartialFailure =
    !loadingTimes &&
    emptyFailedCount > 0 &&
    !workerFetchTotalFailure &&
    withTimesCount === 0;

  /** Booking-link courses in the same geographic / search scope as the live grid. */
  const bookingOnlyInScope = useMemo(() => {
    let list = courses.filter((c) => getPlatformCapability(c.platform) !== 'live_inventory');
    if (params.holes !== 9 && params.holes !== 'any') {
      list = list.filter(
        (c) => c.holes !== 9 || (placeMatch != null && courseMatchesResolvedPlace(c, placeMatch)),
      );
    }

    const q = locationDraft.trim();
    if (fetchAllUtah && !placeMatch && !q) {
      return [...list].sort(sortCoursesByDistanceThenName);
    }
    if (placeMatch) {
      const near = coursesNearPlace(list);
      const byId = new Map(near.map((c) => [c.id, c]));
      const anchor = { ...placeMatch.anchor, source: 'default' as const };
      for (const c of list) {
        if (courseMatchesResolvedPlace(c, placeMatch) && !byId.has(c.id)) {
          byId.set(c.id, {
            ...c,
            distanceMi: distanceFromAnchor(c, anchor) ?? undefined,
          });
        }
      }
      return [...byId.values()].sort(sortCoursesByDistanceThenName);
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
      // Keep live/checking cards first so the first paint doesn't bury openings
      // under booking-link courses. Soonest takes over as times arrive.
      return [...gridCourses, ...extras.sort(sortCoursesByDistanceThenName)];
    }
    return sortFinderGridCourses(combined, timesByCourse, params.sortBy);
  }, [gridCourses, bookingOnlyInScope, loadingTimes, timesByCourse, params.sortBy]);

  const soonestGroups = useMemo(() => {
    if (params.sortBy !== 'soonest') return null;
    const openings: Course[] = [];
    const noTimes: Course[] = [];
    const alsoNearby: Course[] = [];
    for (const c of displayCourses) {
      const mode = resolveCourseBookingMode(
        recordsBySlug.get(c.id) ?? { platform: c.platform, booking_url: c.bookingUrl },
      );
      if (mode !== 'live') alsoNearby.push(c);
      else if ((timesByCourse.get(c.id)?.length ?? 0) > 0) openings.push(c);
      else noTimes.push(c);
    }
    return {
      openings: sortCourses(openings, timesByCourse, 'soonest'),
      noTimes: [...noTimes].sort(sortCoursesByDistanceThenName),
      alsoNearby: [...alsoNearby].sort(sortCoursesByDistanceThenName),
    };
  }, [params.sortBy, displayCourses, timesByCourse, recordsBySlug]);

  const soonestHasLive = Boolean(
    soonestGroups && soonestGroups.openings.length + soonestGroups.noTimes.length > 0,
  );
  const mainGridCourses = soonestGroups
    ? soonestHasLive
      ? [...soonestGroups.openings, ...soonestGroups.noTimes]
      : soonestGroups.alsoNearby
    : displayCourses;
  const alsoNearbyCourses = soonestHasLive ? (soonestGroups?.alsoNearby ?? []) : [];

  const resultCountPrimary = catalogLoading
    ? 'Loading courses…'
    : showOutOfMarket
      ? 'Outside live markets'
      : openTeeTimeCount > 0
      ? `${openTeeTimeCount} tee time${openTeeTimeCount === 1 ? '' : 's'}`
      : loadingTimes
        ? 'Finding tee times…'
        : `${displayCourses.length} courses`;

  const resultCountSecondary = catalogLoading
    ? null
    : loadingTimes && openTeeTimeCount > 0
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
  const [slotAction, setSlotAction] = useState<SlotActionTarget | null>(null);
  const [slotAuthBusy, setSlotAuthBusy] = useState(false);
  const [signInToShareOpen, setSignInToShareOpen] = useState(false);
  const closeSignInToShare = useCallback(() => {
    setSignInToShareOpen(false);
    setPlanAfterSignIn(null);
    clearPendingAuthAction();
  }, []);
  const returnTo = authReturnPath(location.pathname, location.search);

  useEffect(() => {
    if (user?.id && planAfterSignIn) {
      setPlanRound(planAfterSignIn);
      setPlanAfterSignIn(null);
      setSignInToShareOpen(false);
    }
  }, [user?.id, planAfterSignIn]);

  const requestShareRound = useCallback(
    (course: Course, courseTimes: TeeTime[], selectedId?: string | null) => {
      if (courseTimes.length === 0) return;
      const target: PlanRoundTarget = {
        course,
        times: courseTimes,
        initialSelectedId: selectedId ?? courseTimes[0]?.id ?? null,
      };
      if (!user?.id) {
        savePendingAuthAction({
          intent: 'share',
          courseId: course.id,
          time: courseTimes.find((t) => t.id === target.initialSelectedId) ?? courseTimes[0] ?? null,
          bookHref: null,
        });
        setPlanAfterSignIn(target);
        setSignInToShareOpen(true);
        return;
      }
      setPlanRound(target);
    },
    [user?.id],
  );

  useEffect(() => {
    if (!user?.id || authLoading) return;
    const pending = peekPendingAuthAction();
    if (!pending) return;
    const course = coursesById.get(pending.courseId);
    if (!course) {
      if (catalogLoading) return;
      takePendingAuthAction();
      return;
    }

    if (pending.intent === 'share') {
      const times = timesByCourse.get(pending.courseId) ?? [];
      if (times.length === 0 && (loadingTimes || pendingSlugs.has(pending.courseId))) return;
      takePendingAuthAction();
      if (times.length === 0) return;
      setPlanRound({
        course,
        times,
        initialSelectedId: pending.time?.id ?? times[0]?.id ?? null,
      });
      setSignInToShareOpen(false);
      setPlanAfterSignIn(null);
      return;
    }

    if (pending.intent === 'book' && pending.bookHref && pending.time) {
      takePendingAuthAction();
      setSlotAction({
        course,
        time: pending.time,
        times: timesByCourse.get(pending.courseId) ?? [pending.time],
        bookHref: pending.bookHref,
        detailHref: `/course/${course.id}?${courseDetailQueryString(params)}`,
        resumeBook: true,
      });
    }
  }, [
    user?.id,
    authLoading,
    catalogLoading,
    coursesById,
    timesByCourse,
    pendingSlugs,
    loadingTimes,
    params,
  ]);

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
      setParam('date', clampDateToTodayOrLater(toYmd(dt)));
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

  const browseLiveMarket = useCallback(() => {
    setLocationDraft('');
    const next = new URLSearchParams(sp);
    next.delete('q');
    next.set('scope', 'all');
    next.delete('radius');
    setSp(next, { replace: true });
    setLastUpdatedAt(Date.now());
  }, [sp, setSp]);

  const timeChip = (tod: Exclude<TimeOfDayPreset, 'any'>, label: string) => {
    const selected = params.timeOfDay === tod;
    return (
      <button
        className={`chip${selected ? ' on' : ''}`}
        onClick={() => setParam('tod', selected ? '' : tod)}
        type="button"
        aria-pressed={selected}
      >
        {label}
      </button>
    );
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
      <option value="1-any">1 · Any holes</option>
      <option value="2-any">2 · Any holes</option>
      <option value="3-any">3 · Any holes</option>
      <option value="4-any">4 · Any holes</option>
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
        min={todayYmd}
        value={params.date}
        aria-label="Date"
        onChange={(e) => {
          if (e.target.value) setParam('date', clampDateToTodayOrLater(e.target.value));
        }}
      />
    </span>
  );

  const prevDateDisabled = params.date <= todayYmd;

  const wherePlaceLabel =
    params.locationQuery.trim() ||
    (timesFetchScope.anchor.source === 'gps' ? 'Near me' : 'Salt Lake area');

  const whereLabel = fetchAllUtah
    ? 'Statewide'
    : !isCompactShell && radiusMi !== DEFAULT_FETCH_RADIUS_MI
      ? `${wherePlaceLabel} · ${radiusMi} mi`
      : wherePlaceLabel;

  const locationRadiusEnabled =
    fetchAllUtah || !params.locationQuery.trim() || Boolean(placeMatch);

  const todSummaryLabel =
    params.timeOfDay === 'morning'
      ? 'Morning'
      : params.timeOfDay === 'afternoon'
        ? 'Afternoon'
        : params.timeOfDay === 'evening'
          ? 'Twilight'
          : 'Any';

  const partySummaryLabel =
    params.holes === 'any'
      ? String(params.players)
      : `${params.players} · ${holesFilterLabel(params.holes)}`;

  const querySummaryParts = [
    formatDateCompact(params.date),
    partySummaryLabel,
    ...(params.timeOfDay === 'any' ? [] : [todSummaryLabel]),
    fetchAllUtah ? 'Statewide' : wherePlaceLabel,
  ];

  const queryCollapsed = isCompactShell && queryScrolledAway && !queryPinnedOpen;
  const queryPinned = isCompactShell && queryScrolledAway && queryPinnedOpen;
  const queryDockClass = [
    'finder-query-dock',
    queryCollapsed ? 'is-collapsed' : '',
    queryPinned ? 'is-pinned-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const openPinnedQuery = () => {
    const h = queryDockRef.current?.offsetHeight;
    setQueryDockHoldPx(typeof h === 'number' && h > 0 ? h : null);
    setQueryPinnedOpen(true);
  };

  const closePinnedQuery = () => {
    setQueryPinnedOpen(false);
    setQueryDockHoldPx(null);
  };

  const renderFinderCard = (course: Course) => {
    const times = timesByCourse.get(course.id) ?? [];
    const inFetchPool = fetchSlugSet.has(course.id);
    const record = recordsBySlug.get(course.id);
    const bookingMode = resolveCourseBookingMode(
      record ?? { platform: course.platform, booking_url: course.bookingUrl },
    );
    const noLiveInventory = bookingMode !== 'live';
    const outOfScope = !noLiveInventory && !inFetchPool && !fetchAllUtah;
    const timesPending = !noLiveInventory && inFetchPool && pendingSlugs.has(course.id);
    const detailHref = `/course/${course.id}?${courseDetailQueryString(params)}`;
    const variant =
      bookingMode === 'phone' ? 'phone' : bookingMode === 'booking_link' ? 'bookingLink' : 'inventory';
    return (
      <CourseMarketplaceCard
        key={course.id}
        course={course}
        record={record}
        times={times}
        detailHref={detailHref}
        timesPending={timesPending}
        outOfScope={outOfScope}
        inventorySource={sourceBySlug.get(course.id)}
        variant={variant}
        dateYmd={params.date}
        players={params.players}
        holes={params.holes}
        timeOfDay={params.timeOfDay}
        onAlert={noLiveInventory ? undefined : () => setNotifCourseId(course.id)}
        onSearchAllUtah={() => setRadiusMode('all')}
        onShare={() => requestShareRound(course, times)}
        shareDisabled={times.length === 0 || timesPending || authLoading}
        onSelectTime={(time, bookHref) => {
          captureEvent('tee_time_clicked', {
            course: course.name,
            course_id: course.id,
            time: time.startsAt,
            price: time.price,
            spots: time.spots,
            holes: time.holes,
            surface: 'find',
            signed_in: Boolean(user?.id),
          });
          setSlotAction({ course, time, times, bookHref, detailHref });
        }}
      />
    );
  };

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
              <button type="button" className="btn btn-primary" onClick={refetchResults}>
                Retry now
              </button>
            </div>
          </div>
        ) : workerFetchPartialFailure ? (
          <div className="app-banner app-banner--warn" role="status">
            <strong>Some courses didn&apos;t refresh</strong> ({emptyFailedCount} of {attemptedSlugCount}). Results may
            be incomplete.
          </div>
        ) : null}

        {queryCollapsed
          ? createPortal(
              <div className="finder-query-collapsed">
                <button
                  type="button"
                  className="finder-query-summary"
                  aria-expanded={false}
                  aria-controls="finder-query-details"
                  onClick={openPinnedQuery}
                >
                  <span className="finder-query-summary-text">{querySummaryParts.join(' · ')}</span>
                  <span className="finder-query-summary-hint">Edit</span>
                </button>
              </div>,
              document.body,
            )
          : null}

        <div
          className="finder-query-dock-hold"
          style={queryPinned && queryDockHoldPx != null ? { height: queryDockHoldPx } : undefined}
        >
        <div
          ref={queryDockRef}
          className={queryDockClass}
          inert={queryCollapsed ? true : undefined}
        >
          <div
            id="finder-query-details"
            className="finder-query-details"
          >
            {queryPinned ? (
              <div className="finder-query-pinned-bar">
                <span className="finder-query-pinned-label">Filters</span>
                <button
                  type="button"
                  className="finder-query-done"
                  onClick={closePinnedQuery}
                >
                  Done
                </button>
              </div>
            ) : null}

        <div className="search-zone">
          {/* Desktop: When · Players · Where (search icon at end) */}
          <div className="search-pill search-pill--desktop">
            <div className="sp-cell sp-cell-when">
              <span className="sp-label">When</span>
              <span className="sp-value sp-value-when">
                <button
                  type="button"
                  className="sp-date-nudge"
                  aria-label="Previous day"
                  disabled={prevDateDisabled}
                  onClick={() => shiftDate(-1)}
                >
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
              onClick={refetchResults}
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
                  disabled={prevDateDisabled}
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
                    min={todayYmd}
                    value={params.date}
                    aria-label={`Date, ${formatDateCompact(params.date)}`}
                    onChange={(e) => {
                      if (e.target.value) setParam('date', clampDateToTodayOrLater(e.target.value));
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
                  {params.players} · {holesFilterLabel(params.holes)}
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
                  <option value="1-any">1 · Any holes</option>
                  <option value="2-any">2 · Any holes</option>
                  <option value="3-any">3 · Any holes</option>
                  <option value="4-any">4 · Any holes</option>
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
          <div className="filter-row" role="group" aria-label="Time of day">
            {timeChip('morning', 'Morning')}
            {timeChip('afternoon', 'Afternoon')}
            {timeChip('evening', 'Twilight')}
          </div>
        </div>
          </div>
        </div>
        </div>
        <div className="finder-query-sentinel" ref={querySentinelRef} aria-hidden />

        <div className="result-meta">
          <div className="result-meta-lead">
            <span
              className={`result-count${
                loadingTimes && withTimesCount === 0 && !showOutOfMarket ? ' is-finding' : ''
              }`}
            >
              <strong>{resultCountPrimary}</strong>
            </span>
            {!showOutOfMarket ? (
              <label className="result-sort">
                <span className="result-sort-prefix">Sort</span>
                <select
                  value={params.sortBy}
                  aria-label="Sort courses"
                  onChange={(e) => setParam('sort', e.target.value as SortBy)}
                >
                  <option value="soonest">Soonest time</option>
                  <option value="distance">Closest</option>
                  <option value="price">Price</option>
                  <option value="rating">Rating</option>
                </select>
              </label>
            ) : null}
            {resultCountSecondary && !showOutOfMarket ? (
              <span className="result-count-secondary">{resultCountSecondary}</span>
            ) : null}
          </div>
          {!showOutOfMarket ? (
          <FinderDayOutlook
            dateYmd={params.date}
            lat={timesFetchScope.anchor.lat}
            lng={timesFetchScope.anchor.lng}
            regionLabel={
              params.locationQuery.trim() ||
              (timesFetchScope.anchor.source === 'gps' ? 'Near you' : 'Salt Lake area')
            }
          />
          ) : null}
        </div>

        {showOutOfMarket ? (
          <div className="empty-search empty-search--market">
            <div className="empty-search-kicker">Coming soon</div>
            <div className="empty-search-title">
              {serviceArea.visitorRegion
                ? `${serviceArea.visitorRegion.name} isn’t on Tee-Time yet`
                : 'Tee-Time isn’t in your area yet'}
            </div>
            <p>
              We’re live in {serviceArea.liveMarkets} today
              {serviceArea.visitorRegion
                ? `, and ${serviceArea.visitorRegion.name} is on the roadmap`
                : ', and we’re expanding'}
              . Browse {serviceArea.liveMarkets} if you’re heading that way, or follow along for
              launch news.
            </p>
            <div className="empty-search-actions">
              <button type="button" className="btn btn-primary" onClick={browseLiveMarket}>
                Browse {serviceArea.liveMarkets} tee times
              </button>
              <a
                className="btn"
                href="https://www.instagram.com/teetimehq/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Follow @teetimehq
              </a>
            </div>
          </div>
        ) : null}

        {!showOutOfMarket && !catalogLoading && !loadingTimes && !catalogError && displayCourses.length === 0 && workerCourses.length > 0 ? (
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

        {!showOutOfMarket && !catalogLoading && !loadingTimes && withTimesCount === 0 && searchPool.length > 0 ? (
          <div className="empty-openings-hint">
            <div className="empty-openings-hint-copy">
              <p className="empty-openings-hint-title">
                {alsoNearbyCourses.length > 0 || bookingOnlyInScope.length > 0
                  ? `No live openings for ${formatDateShort(params.date)}`
                  : `No openings for ${formatDateShort(params.date)}`}
              </p>
              <p>
                {alsoNearbyCourses.length > 0 || bookingOnlyInScope.length > 0
                  ? 'Set an alert on a course below, or book nearby on their site.'
                  : 'Set an alert on a course below, or try another day.'}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary empty-openings-hint-cta"
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
          {!showOutOfMarket && !showCatalogSkeleton ? (
            <>
              {mainGridCourses.map(renderFinderCard)}
              {alsoNearbyCourses.length > 0 ? (
                <>
                  <div className="mp-grid-section">
                    <p className="mp-grid-section-title">Also nearby</p>
                    <p className="mp-grid-section-copy">Book on their site, or call the pro shop.</p>
                  </div>
                  {alsoNearbyCourses.map(renderFinderCard)}
                </>
              ) : null}
            </>
          ) : null}
        </div>

        <p className="finder-help">
          Tap a time to book or share with friends. Past vote links live under <strong>Plan</strong>.
        </p>
      </div>

      <SlotActionSheet
        open={Boolean(slotAction)}
        onClose={() => {
          if (!slotAuthBusy) clearPendingAuthAction();
          setSlotAction(null);
        }}
        courseName={slotAction?.course.name ?? ''}
        timeLabel={
          slotAction
            ? formatTime12h(
                slotAction.time.startsAt,
                courseTimezone(recordsBySlug.get(slotAction.course.id)?.timezone ?? slotAction.course.timezone),
              )
            : ''
        }
        metaLabel={slotAction ? slotActionMeta(slotAction.time) : ''}
        bookHref={slotAction?.bookHref ?? null}
        viewHref={slotAction?.detailHref}
        needsAuth={!user?.id}
        resumeBook={Boolean(slotAction?.resumeBook)}
        signingIn={slotAuthBusy}
        onBook={() => {
          if (!slotAction?.bookHref || user?.id) return;
          savePendingAuthAction({
            intent: 'book',
            courseId: slotAction.course.id,
            time: slotAction.time,
            bookHref: slotAction.bookHref,
          });
          setSlotAuthBusy(true);
          void signInWithGoogle(returnTo).finally(() => setSlotAuthBusy(false));
        }}
        onShare={() => {
          if (!slotAction) return;
          if (!user?.id) {
            savePendingAuthAction({
              intent: 'share',
              courseId: slotAction.course.id,
              time: slotAction.time,
              bookHref: slotAction.bookHref,
            });
            setSlotAuthBusy(true);
            void signInWithGoogle(returnTo).finally(() => setSlotAuthBusy(false));
            return;
          }
          const { course, times, time } = slotAction;
          setSlotAction(null);
          requestShareRound(course, times, time.id);
        }}
        onOpenedBooking={() => {
          if (!slotAction) return;
          captureEvent('outbound_booking_click', {
            course: slotAction.course.name,
            course_id: slotAction.course.id,
            time: slotAction.time.startsAt,
            price: slotAction.time.price,
            surface: 'find',
            signed_in: Boolean(user?.id),
          });
        }}
      />
      <SignInPromptModal
        open={signInToShareOpen}
        onClose={closeSignInToShare}
        variant="share"
        returnTo={returnTo}
      />
      <LocationSearchSheet
        open={locationSheetOpen}
        onClose={() => setLocationSheetOpen(false)}
        courses={courses}
        currentQuery={params.locationQuery}
        locationAvailable={Boolean(userLocation)}
        showRadius={locationRadiusEnabled}
        radiusValue={fetchAllUtah ? 'all' : radiusMi}
        onRadiusChange={setRadiusMode}
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
          holes={params.holes === 'any' ? 18 : params.holes}
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
