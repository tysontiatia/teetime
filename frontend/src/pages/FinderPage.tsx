import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Course, SearchParams, SortBy, TeeTime, TimeOfDayPreset } from '../types';
import { matchesPreset, minutesSince, toYmd, formatTime12h } from '../lib/time';
import { sortCourses } from '../lib/sort';
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
import { FinderDayOutlook } from '../components/FinderDayOutlook';
import { courseDetailQueryString } from '../lib/finderUrl';

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
  return { date, players, holes, timeOfDay, sortBy, locationQuery };
}

export function FinderPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const params = useMemo(() => parseParams(sp), [sp]);

  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(Date.now());
  const [view, setView] = useState<'list' | 'map'>('list');
  const [notifCourseId, setNotifCourseId] = useState<string | null>(null);
  const { user, loading: authLoading } = useAuth();

  const { courses, recordsBySlug, loading: catalogLoading, error: catalogError, userLocation } = useCourseCatalog();

  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  /** All worker-backed courses — fetch times once; filter by search client-side. */
  const fetchPool = useMemo(() => filterWorkerCourses(courses), [courses]);

  const searchPool = useMemo(() => {
    const q = params.locationQuery.trim().toLowerCase();
    if (!q) return fetchPool;
    return fetchPool.filter(
      (c) =>
        c.catalogName.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q)
    );
  }, [fetchPool, params.locationQuery]);

  const { timesByCourse: rawTimesByCourse, loadingTimes } = useTimesByCourseMap(
    fetchPool,
    recordsBySlug,
    params.date,
    params.holes,
    params.players,
    lastUpdatedAt ?? 0,
    catalogLoading
  );

  const showFinderSkeleton =
    view === 'list' &&
    !catalogError &&
    (catalogLoading || (loadingTimes && fetchPool.length > 0));

  const timesByCourse = useMemo(() => {
    const map = new Map<string, TeeTime[]>();
    for (const [courseId, list] of rawTimesByCourse) {
      const filtered = list.filter(
        (t) =>
          matchesPreset(t.startsAt, params.timeOfDay) && (t.spots == null || t.spots >= params.players)
      );
      filtered.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
      map.set(courseId, filtered);
    }
    return map;
  }, [rawTimesByCourse, params.timeOfDay, params.players]);

  const availableCourses = useMemo(() => {
    const withTimes = searchPool.filter((c) => (timesByCourse.get(c.id)?.length ?? 0) > 0);
    return sortCourses(withTimes, timesByCourse, params.sortBy);
  }, [params.sortBy, searchPool, timesByCourse]);

  /** Same text search as live list, but over the full catalog (other states / platforms). */
  const queryAllCourses = useMemo(() => {
    const q = params.locationQuery.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c) =>
        c.catalogName.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q)
    );
  }, [courses, params.locationQuery]);

  const bookingOnlyCourses = useMemo(() => {
    return queryAllCourses.filter((c) => getPlatformCapability(c.platform) !== 'live_inventory');
  }, [queryAllCourses]);

  const liveNoMatchCourses = useMemo(() => {
    return searchPool.filter((c) => (timesByCourse.get(c.id)?.length ?? 0) === 0);
  }, [searchPool, timesByCourse]);

  const bookingOnlySorted = useMemo(
    () => [...bookingOnlyCourses].sort(sortCoursesByDistanceThenName),
    [bookingOnlyCourses]
  );

  const liveNoMatchSorted = useMemo(
    () => [...liveNoMatchCourses].sort(sortCoursesByDistanceThenName),
    [liveNoMatchCourses]
  );

  const [showBookingOnly, setShowBookingOnly] = useState(true);
  const [showLiveNoMatch, setShowLiveNoMatch] = useState(false);
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

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    next.set(key, value);
    setSp(next, { replace: true });
    setLastUpdatedAt(Date.now());
  };

  const timeChip = (tod: TimeOfDayPreset, label: string) => (
    <button
      className="btn"
      onClick={() => setParam('tod', tod)}
      style={{
        padding: '8px 12px',
        borderRadius: 999,
        borderColor: params.timeOfDay === tod ? 'rgba(45,122,58,0.35)' : 'var(--border)',
        background: params.timeOfDay === tod ? 'var(--green-soft)' : 'rgba(255,255,255,0.7)',
        color: params.timeOfDay === tod ? 'var(--green-2)' : 'var(--muted)',
        fontWeight: 800,
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
      type="button"
    >
      {label}
    </button>
  );

  return (
    <div className="container">
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div>
            <div className="pill">Availability finder</div>
            <h1 style={{ margin: '10px 0 0', fontFamily: 'var(--font-display)', letterSpacing: '-0.03em', lineHeight: 1.05 }}>
              Find open tee times.<br />
              Plan the round with your buddies.
            </h1>
            <p style={{ marginTop: 10, color: 'var(--muted)', maxWidth: 660 }}>
              Live Utah catalog and tee times via the Cloudflare worker. Sign in (header) to save notification alerts to your account.
            </p>
          </div>
        </div>

        {catalogError ? (
          <div style={{ padding: 14, borderRadius: 14, border: '1px solid rgba(180,60,60,0.35)', background: 'rgba(254,242,242,0.9)', color: '#7f1d1d' }}>
            <strong>Could not load courses.</strong> {catalogError}
          </div>
        ) : null}

        {shareFinderErr ? (
          <div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: '1px solid rgba(180,60,60,0.35)', background: 'rgba(254,242,242,0.9)', color: '#7f1d1d', fontSize: 14 }}>
            {shareFinderErr}
          </div>
        ) : null}

        {/* Search bar */}
        <div
          style={{
            background: 'rgba(255,255,255,0.85)',
            border: '1px solid var(--border)',
            borderRadius: 18,
            padding: 12,
            boxShadow: '0 6px 22px rgba(26,46,26,0.06)',
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          <div
            className="search-grid"
            style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.7fr 0.6fr 0.9fr auto', gap: 10, minWidth: 0 }}
          >
            <div className="search-grid-field">
              <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Location or course
              </label>
              <input
                className="input"
                value={params.locationQuery}
                placeholder="City, course name, or zip…"
                onChange={(e) => setParam('q', e.target.value)}
              />
            </div>
            <div className="search-grid-field">
              <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Date
              </label>
              <div className="search-grid-date-input">
                <input className="input" type="date" value={params.date} onChange={(e) => setParam('date', e.target.value)} />
              </div>
            </div>
            <div className="search-grid-field">
              <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Players
              </label>
              <select className="input" value={params.players} onChange={(e) => setParam('players', String(e.target.value))}>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </div>
            <div className="search-grid-field">
              <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Holes
              </label>
              <select className="input" value={params.holes} onChange={(e) => setParam('holes', String(e.target.value))}>
                <option value="18">18</option>
                <option value="9">9</option>
              </select>
            </div>
            <button className="btn btn-primary" type="button" onClick={() => setLastUpdatedAt(Date.now())} style={{ alignSelf: 'end', padding: '11px 16px' }}>
              Search
            </button>
          </div>

          {/* Control row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap', minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {timeChip('any', 'Any')}
              {timeChip('morning', 'Morning')}
              {timeChip('afternoon', 'Afternoon')}
              {timeChip('evening', 'Evening')}
            </div>

            <div style={{ flex: 1 }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setView('list')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 999,
                    background: view === 'list' ? 'var(--green-soft)' : '#fff',
                    color: view === 'list' ? 'var(--green-2)' : 'var(--muted)',
                    borderColor: view === 'list' ? 'rgba(45,122,58,0.25)' : 'var(--border)',
                    fontWeight: 950,
                  }}
                >
                  List
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setView('map')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 999,
                    background: view === 'map' ? 'var(--green-soft)' : '#fff',
                    color: view === 'map' ? 'var(--green-2)' : 'var(--muted)',
                    borderColor: view === 'map' ? 'rgba(45,122,58,0.25)' : 'var(--border)',
                    fontWeight: 950,
                  }}
                >
                  Map
                </button>
              </div>
              <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Sort</span>
              <select
                className="input"
                style={{ width: 'min(170px, 100%)', minWidth: 0, maxWidth: '100%' }}
                value={params.sortBy}
                onChange={(e) => setParam('sort', e.target.value as SortBy)}
              >
                <option value="distance">Distance</option>
                <option value="soonest">Soonest</option>
                <option value="price">Price</option>
                <option value="rating">Rating</option>
              </select>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{updatedLabel}</span>
            </div>
          </div>

          <FinderDayOutlook dateYmd={params.date} />
        </div>

        <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {catalogLoading || loadingTimes
              ? 'Loading tee times…'
              : `${availableCourses.length} courses with times matching filters`}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {user ? (
              <>
                Use <strong style={{ color: 'var(--ink)' }}>Share</strong> at the bottom of a card for a vote link (all matching times), or open course details to refine filters.
              </>
            ) : (
              <>
                Sign in, then use <strong style={{ color: 'var(--ink)' }}>Share</strong> at the bottom of a card for a vote link (all matching times), or open course details to refine filters.
              </>
            )}
          </div>
        </div>

        {view === 'map' ? (
          <Suspense
            fallback={
              <div className="map-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
                Loading map…
              </div>
            }
          >
            <MapView
              courses={availableCourses}
              timesByCourseId={timesByCourse}
              userLocation={userLocation}
              onSelectCourse={(id) => {
                nav(`/course/${id}?${courseDetailQueryString(params)}`);
              }}
            />
          </Suspense>
        ) : (
          <div
            className="grid-cards"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 14,
            }}
          >
            {showFinderSkeleton
              ? Array.from({ length: 9 }).map((_, i) => <CourseCardSkeleton key={i} />)
              : null}
            {!showFinderSkeleton &&
              availableCourses.map((course) => {
              const times = timesByCourse.get(course.id) ?? [];
              const top = times.slice(0, 6);

              return (
                <div
                  key={course.id}
                  style={{
                    background: 'rgba(255,255,255,0.9)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    overflow: 'hidden',
                    boxShadow: '0 6px 18px rgba(0,0,0,0.05)',
                  }}
                >
                  {course.photoUrl ? (
                    <div style={{ lineHeight: 0 }}>
                      <img src={course.photoUrl} alt="" style={{ width: '100%', height: 132, objectFit: 'cover', display: 'block' }} />
                    </div>
                  ) : null}

                  <div style={{ padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: '-0.02em' }}>
                          {course.name} <span style={{ color: 'var(--muted)', fontWeight: 700 }}>({course.city})</span>
                        </div>
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: 12,
                            color: 'var(--muted)',
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            columnGap: 10,
                            rowGap: 4,
                          }}
                        >
                          <span style={{ fontWeight: 700, color: 'var(--ink)' }}>
                            {times.length} tee time{times.length === 1 ? '' : 's'}
                          </span>
                          {typeof course.rating === 'number' && (
                            <span>
                              ★ {course.rating.toFixed(1)}
                              {typeof course.reviewCount === 'number' ? ` (${course.reviewCount.toLocaleString()})` : ''}
                            </span>
                          )}
                          {typeof course.distanceMi === 'number' && <span>{course.distanceMi.toFixed(1)} mi</span>}
                        </div>
                      </div>

                      <button className="btn" type="button" onClick={() => setNotifCourseId(course.id)} style={{ padding: '8px 10px' }} title="Alerts">
                        🔔
                      </button>
                    </div>

                    <div className="times-grid" style={{ marginTop: 10 }}>
                      {top.map((t) => (
                        <div
                          key={t.id}
                          style={{
                            padding: '10px 10px',
                            borderRadius: 12,
                            background: '#fff',
                            border: '1px solid rgba(45,122,58,0.22)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            alignItems: 'center',
                          }}
                        >
                          <div style={{ fontWeight: 900, fontSize: 13, color: 'var(--green-2)' }}>{formatTime12h(t.startsAt)}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{typeof t.price === 'number' ? `$${t.price}` : '—'}</div>
                        </div>
                      ))}
                      {times.length > top.length && (
                        <Link
                          to={`/course/${course.id}?${courseDetailQueryString(params)}`}
                          className="btn"
                          style={{
                            padding: '10px 10px',
                            borderRadius: 12,
                            background: 'rgba(233,245,234,0.75)',
                            borderColor: 'rgba(45,122,58,0.18)',
                            color: 'var(--green-2)',
                            fontWeight: 900,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                            fontSize: 12,
                          }}
                        >
                          +{times.length - top.length} more
                        </Link>
                      )}
                    </div>

                    <div
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: '1px solid var(--border)',
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                      }}
                    >
                      <Link
                        to={`/course/${course.id}?${courseDetailQueryString(params)}`}
                        className="btn btn-ghost"
                        style={{ padding: '8px 10px', color: 'var(--muted)' }}
                      >
                        Course details →
                      </Link>
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={times.length === 0 || shareBusyCourseId === course.id || authLoading}
                        onClick={() => void shareCourseRound(course, times)}
                        title={
                          authLoading
                            ? 'Checking account…'
                            : `Create a vote link with all ${times.length} tee time${times.length === 1 ? '' : 's'} matching your filters (link copied)`
                        }
                        style={{
                          padding: '10px 16px',
                          borderRadius: 12,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontWeight: 800,
                          fontSize: 14,
                        }}
                        aria-label={`Share vote link for ${course.name}`}
                      >
                        {shareBusyCourseId === course.id ? (
                          '…'
                        ) : (
                          <>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                              <polyline points="16 6 12 2 8 6" />
                              <line x1="12" y1="2" x2="12" y2="15" />
                            </svg>
                            Share
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === 'list' && (bookingOnlySorted.length > 0 || liveNoMatchSorted.length > 0) ? (
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
                            <button className="btn" type="button" onClick={() => setNotifCourseId(course.id)} style={{ padding: '8px 10px' }} title="Alerts">
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

            {liveNoMatchSorted.length > 0 ? (
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 16,
                  background: 'rgba(248,250,248,0.95)',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowLiveNoMatch((s) => !s)}
                  className="btn btn-ghost"
                  style={{
                    width: '100%',
                    borderRadius: 0,
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    fontWeight: 900,
                    border: 'none',
                    borderBottom: showLiveNoMatch ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <span>Live feed courses — no times match filters ({liveNoMatchSorted.length})</span>
                  <span style={{ color: 'var(--muted)', fontWeight: 800 }}>{showLiveNoMatch ? '▼' : '▶'}</span>
                </button>
                {showLiveNoMatch ? (
                  <div style={{ padding: 14 }}>
                    <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
                      These use the worker but returned nothing for this date/holes, or every slot was filtered out (time-of-day, players). Try another date or loosen filters.
                    </p>
                    <div className="grid-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                      {liveNoMatchSorted.map((course) => (
                        <div
                          key={course.id}
                          style={{
                            border: '1px solid var(--border)',
                            borderRadius: 14,
                            padding: 12,
                            background: '#fff',
                          }}
                        >
                          <div style={{ fontWeight: 900 }}>{course.name}</div>
                          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{course.city}</div>
                          <Link
                            className="btn btn-ghost"
                            to={`/course/${course.id}?${courseDetailQueryString(params)}`}
                            style={{ marginTop: 10, padding: '8px 10px' }}
                          >
                            Open course →
                          </Link>
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

