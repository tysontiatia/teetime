import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  formatDateCompact,
  formatDateShort,
  formatTime12h,
  matchesPreset,
  toYmd,
  todayYmdUtah,
  clampDateToTodayOrLater,
} from '../lib/time';
import { courseTimezone } from '../lib/teeTimeInstant';
import type { SearchParams, SortBy, TeeTime, TimeOfDayPreset } from '../types';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { fetchTeeTimesForCourse } from '../lib/workerTimes';
import { capabilityHint, getPlatformCapability, workerSupportedPlatform } from '../lib/platformRegistry';
import { WeatherStrip } from '../components/WeatherStrip';
import { CoursePhoto } from '../components/CoursePhoto';
import { TeeSlotTimesSkeleton } from '../components/CourseCardSkeleton';
import { TeeSlotCard } from '../components/TeeSlotCard';
import { NotificationModal } from '../components/NotificationModal';
import { SignInPromptModal } from '../components/SignInPromptModal';
import { PlanRoundModal } from '../components/PlanRoundModal';
import { GetDirectionsButton } from '../components/GetDirectionsButton';
import { SlotActionSheet } from '../components/SlotActionSheet';
import { slotActionMeta } from '../lib/slotAction';
import { useAuth } from '../state/AuthContext';
import {
  authReturnPath,
  clearPendingAuthAction,
  peekPendingAuthAction,
  savePendingAuthAction,
  takePendingAuthAction,
} from '../lib/pendingAuthAction';
import { courseDetailQueryString } from '../lib/finderUrl';
import { parseHolesFilter, type HolesFilter } from '../lib/holesFilter';
import { parseFetchRadiusMi } from '../lib/timesFetchScope';
import { buildBookingUrl } from '../lib/bookingUrl';
import { formatCityState, resolveCourseBookingMode } from '../lib/courseRecord';
import { teeTimeFitsPlayers } from '../lib/teeTimeFitsPlayers';
import { CourseDetailPanel } from '../components/CourseDetailPanel';
import { CourseReviewsSection } from '../components/CourseReviewsSection';
import { AlertsIcon, PlanIcon } from '../components/icons/AppIcons';
import { CourseStatsBar } from '../components/CourseStatsBar';
import { useCourseHourlyWeather } from '../hooks/useCourseHourlyWeather';
import {
  fetchCourseCatalogMeta,
  type CourseCatalogMeta,
} from '../lib/courseCatalogApi';
import { fetchPlaceReviews, type PlaceReview } from '../lib/placeReviews';

function clampPlayers(n: number): 1 | 2 | 3 | 4 {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

const SLOT_PREVIEW = 12;

type DetailTab = 'times' | 'info' | 'reviews';

const TOD_OPTIONS: { value: TimeOfDayPreset; label: string }[] = [
  { value: 'any', label: 'All day' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Twilight' },
];

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'times', label: 'Tee Times' },
  { id: 'info', label: 'Info' },
  { id: 'reviews', label: 'Reviews' },
];

export function CoursePage() {
  const { courseId } = useParams();
  const location = useLocation();
  const [sp, setSp] = useSearchParams();
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const { courses, recordsBySlug, loading: catalogLoading } = useCourseCatalog();
  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const date = clampDateToTodayOrLater(sp.get('date') || todayYmdUtah());
  const todayYmd = todayYmdUtah();
  const prevDateDisabled = date <= todayYmd;
  const players = clampPlayers(Number(sp.get('players') || 2));
  const holes: HolesFilter = parseHolesFilter(sp.get('holes'));
  const tod = ((sp.get('tod') as TimeOfDayPreset) || 'any') satisfies TimeOfDayPreset;
  const sort = ((sp.get('sort') as SortBy) || 'soonest') satisfies SortBy;

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(sp);
      if (value) next.set(key, value);
      else next.delete(key);
      setSp(next, { replace: true });
    },
    [sp, setSp],
  );

  /** Past `?date=` (or invalid) → replace with today so the URL matches search. */
  useEffect(() => {
    const raw = sp.get('date');
    if (!raw) return;
    const clamped = clampDateToTodayOrLater(raw);
    if (clamped === raw) return;
    const next = new URLSearchParams(sp);
    next.set('date', clamped);
    setSp(next, { replace: true });
  }, [sp, setSp]);

  const shiftDate = useCallback(
    (deltaDays: number) => {
      const [y, m, d] = date.split('-').map(Number);
      const next = new Date(y!, (m ?? 1) - 1, (d ?? 1) + deltaDays);
      setParam('date', clampDateToTodayOrLater(toYmd(next)));
    },
    [date, setParam],
  );

  const finderBackSearch = useMemo(() => {
    const finderParams: SearchParams = {
      date,
      players,
      holes,
      timeOfDay: tod,
      sortBy: sort,
      locationQuery: sp.get('q') || '',
      fetchScope: sp.get('scope') === 'all' ? 'all' : 'nearby',
      radiusMi: parseFetchRadiusMi(sp.get('radius')),
    };
    return courseDetailQueryString(finderParams);
  }, [date, players, holes, tod, sort, sp]);

  const course = useMemo(() => courses.find((c) => c.id === courseId) ?? null, [courses, courseId]);
  const record = courseId ? recordsBySlug.get(courseId) : undefined;

  const [detailTab, setDetailTab] = useState<DetailTab>('times');
  const [notifOpen, setNotifOpen] = useState(false);
  const [rawTimes, setRawTimes] = useState<TeeTime[]>([]);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [teeTimesFetchFailed, setTeeTimesFetchFailed] = useState(false);
  const [timesRetryNonce, setTimesRetryNonce] = useState(0);
  const [hiddenSlotIds, setHiddenSlotIds] = useState<Set<string>>(() => new Set());
  const lastTimesFetchAtRef = useRef(0);
  const hasTimesRef = useRef(false);
  const [planRoundOpen, setPlanRoundOpen] = useState(false);
  const [planAfterSignIn, setPlanAfterSignIn] = useState(false);
  const [signInToShareOpen, setSignInToShareOpen] = useState(false);
  const closeSignInToShare = useCallback(() => {
    setSignInToShareOpen(false);
    setPlanAfterSignIn(false);
    clearPendingAuthAction();
  }, []);
  const [catalogMeta, setCatalogMeta] = useState<CourseCatalogMeta | null>(null);
  const [reviews, setReviews] = useState<PlaceReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsMapsUrl, setReviewsMapsUrl] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [slotAction, setSlotAction] = useState<{
    time: TeeTime;
    bookHref: string | null;
    resumeBook?: boolean;
  } | null>(null);
  const [slotAuthBusy, setSlotAuthBusy] = useState(false);
  const [slotsExpanded, setSlotsExpanded] = useState(false);

  useEffect(() => {
    if (!courseId) {
      setCatalogMeta(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const meta = await fetchCourseCatalogMeta(courseId);
      if (!cancelled) setCatalogMeta(meta);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const reviewQueryName = course?.catalogName || course?.name || '';
  const reviewLat = course?.lat;
  const reviewLng = course?.lng;

  useEffect(() => {
    if (!courseId || !reviewQueryName) {
      setReviews([]);
      setReviewsMapsUrl(null);
      setReviewsLoading(false);
      return;
    }
    let cancelled = false;
    setReviewsLoading(true);
    void (async () => {
      const data = await fetchPlaceReviews({
        name: reviewQueryName,
        lat: reviewLat,
        lng: reviewLng,
      });
      if (cancelled) return;
      setReviews(data?.reviews ?? []);
      setReviewsMapsUrl(data?.mapsUrl ?? null);
      setReviewsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, reviewQueryName, reviewLat, reviewLng]);

  useEffect(() => {
    if (!courseId || !record || !workerSupportedPlatform(record.platform)) {
      setRawTimes([]);
      setTeeTimesFetchFailed(false);
      return;
    }
    let cancelled = false;
    if (!hasTimesRef.current) setLoadingTimes(true);
    setTeeTimesFetchFailed(false);
    void (async () => {
      try {
        const { times, ok } = await fetchTeeTimesForCourse(record, courseId, date, holes, players);
        if (!cancelled) {
          setRawTimes(times);
          hasTimesRef.current = times.length > 0;
          setHiddenSlotIds(new Set());
          setTeeTimesFetchFailed(!ok);
          lastTimesFetchAtRef.current = Date.now();
        }
      } catch {
        if (!cancelled) {
          setRawTimes([]);
          setHiddenSlotIds(new Set());
          setTeeTimesFetchFailed(true);
        }
      } finally {
        if (!cancelled) setLoadingTimes(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, record, date, holes, players, timesRetryNonce]);

  useEffect(() => {
    setHiddenSlotIds(new Set());
    hasTimesRef.current = false;
  }, [courseId, date, holes, players]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastTimesFetchAtRef.current < 4000) return;
      setTimesRetryNonce((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (!course) return;
    const short = course.name.length > 42 ? `${course.name.slice(0, 40)}…` : course.name;
    document.title = `${short} · Tee-Time`;
  }, [course]);

  const times = useMemo(() => {
    const tz = courseTimezone(record?.timezone ?? course?.timezone);
    const list = rawTimes
      .filter((t) => !hiddenSlotIds.has(t.id))
      .filter((t) => matchesPreset(t.startsAt, tod, tz))
      .filter((t) => teeTimeFitsPlayers(t, players))
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    if (sort === 'price') {
      list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    }
    return list;
  }, [rawTimes, hiddenSlotIds, tod, players, sort, record?.timezone, course?.timezone]);

  const weatherPoints = useCourseHourlyWeather(course?.lat, course?.lng, date, times.length > 0);

  useEffect(() => {
    setSelectedSlotId(null);
    setSlotsExpanded(false);
  }, [courseId, date, holes, players, tod]);

  useEffect(() => {
    setDetailTab('times');
  }, [courseId]);

  useEffect(() => {
    if (!times.length) {
      setSelectedSlotId(null);
      return;
    }
    if (!selectedSlotId || !times.some((t) => t.id === selectedSlotId)) {
      setSelectedSlotId(times[0]!.id);
    }
  }, [times, selectedSlotId]);

  useEffect(() => {
    if (user?.id && planAfterSignIn) {
      setPlanAfterSignIn(false);
      setSignInToShareOpen(false);
      setPlanRoundOpen(true);
    }
  }, [user?.id, planAfterSignIn]);

  useEffect(() => {
    if (!user?.id || authLoading || !courseId) return;
    const pending = peekPendingAuthAction();
    if (!pending || pending.courseId !== courseId) return;
    if (catalogLoading) return;

    if (pending.intent === 'share') {
      if (loadingTimes) return;
      takePendingAuthAction();
      if (times.length === 0) return;
      setSelectedSlotId(pending.time?.id ?? times[0]?.id ?? null);
      setPlanRoundOpen(true);
      setSignInToShareOpen(false);
      setPlanAfterSignIn(false);
      return;
    }

    if (pending.intent === 'book' && pending.bookHref && pending.time) {
      takePendingAuthAction();
      setSelectedSlotId(pending.time.id);
      setSlotAction({ time: pending.time, bookHref: pending.bookHref, resumeBook: true });
    }
  }, [user?.id, authLoading, catalogLoading, courseId, loadingTimes, times]);

  const returnTo = authReturnPath(location.pathname, location.search);

  if (catalogLoading && !course) {
    return (
      <div className="container">
        <div className="course-page-skeleton" aria-busy="true" aria-label="Loading course">
          <div className="course-page-skeleton-hero skeleton-shimmer">
            <div className="course-page-skeleton-scrim" aria-hidden>
              <div className="skeleton-shimmer" style={{ width: '48%', height: 22, borderRadius: 8 }} />
              <div className="skeleton-shimmer" style={{ width: '62%', height: 12, marginTop: 10, borderRadius: 6 }} />
            </div>
          </div>
          <div className="course-page-skeleton-rail">
            <div className="skeleton-shimmer" style={{ width: '48%', height: 16, borderRadius: 8 }} />
            <div className="skeleton-shimmer" style={{ width: '100%', height: 120, marginTop: 14, borderRadius: 14 }} />
            <div className="skeleton-shimmer" style={{ width: '100%', height: 48, marginTop: 14, borderRadius: 14 }} />
          </div>
        </div>
      </div>
    );
  }

  if (!course || !courseId) {
    return (
      <div className="container hub-page">
        <div className="hub-page-card">
          <p className="hub-page-kicker">Missing course</p>
          <h1 className="hub-page-title">Course not found</h1>
          <p className="hub-page-lede">
            That course isn’t in the catalog, or the link is out of date. Head back to Find and pick another.
          </p>
          <div className="hub-page-actions">
            <Link className="btn btn-primary" to={`/?${finderBackSearch}`}>
              Back to Find
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const bookingMode = resolveCourseBookingMode(record);
  const phoneOnly = bookingMode === 'phone';
  const unsupported = bookingMode !== 'live';
  const bookingLinkHref =
    bookingMode === 'booking_link'
      ? buildBookingUrl(record ?? { bookingUrl: course.bookingUrl, platform: course.platform, timezone: course.timezone }, {
          dateYmd: date,
          players,
          holes: holes === 'any' ? 18 : holes,
        })
      : null;
  const proShopPhone = record?.phone_number?.trim() || '';
  const proShopTelHref = proShopPhone ? `tel:${proShopPhone.replace(/\D/g, '')}` : null;
  const courseWebsite = String(record?.website || '').trim();
  const courseWebsiteHref = courseWebsite
    ? /^https?:\/\//i.test(courseWebsite)
      ? courseWebsite
      : `https://${courseWebsite}`
    : null;
  const selected = times.find((t) => t.id === selectedSlotId) ?? times[0] ?? null;
  const hiddenSlotCount = Math.max(0, times.length - SLOT_PREVIEW);
  const visibleSlots = slotsExpanded || hiddenSlotCount === 0 ? times : times.slice(0, SLOT_PREVIEW);

  const onShareTimes = (selectedId?: string | null) => {
    if (unsupported || times.length === 0) return;
    if (selectedId) setSelectedSlotId(selectedId);
    if (!user?.id) {
      savePendingAuthAction({
        intent: 'share',
        courseId: course.id,
        time: times.find((t) => t.id === (selectedId ?? selectedSlotId)) ?? times[0] ?? null,
        bookHref: null,
      });
      setPlanAfterSignIn(true);
      setSignInToShareOpen(true);
      return;
    }
    setPlanRoundOpen(true);
  };

  const heroMeta = [
    formatCityState(course.city, course.state) || null,
    typeof course.distanceMi === 'number' ? `${course.distanceMi.toFixed(1)} mi` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const canShare = !unsupported && times.length > 0;
  const openCount = times.length;
  const todLabel = TOD_OPTIONS.find((o) => o.value === tod)?.label ?? 'All day';
  const detailTabs = unsupported
    ? TABS.map((tab) => (tab.id === 'times' ? { ...tab, label: 'Book' } : tab))
    : TABS;
  const cap = record ? getPlatformCapability(record.platform) : 'booking_link_only';

  const openReviews = () => {
    setDetailTab('reviews');
    requestAnimationFrame(() => {
      document.getElementById('course-panel-reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <div className={`container course-detail course-detail--${detailTab}`}>
      <div className="back-row">
        <Link to={`/?${finderBackSearch}`} className="back-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Find
        </Link>
      </div>

      <div className="detail-hero">
        {course.photoUrl ? (
          <CoursePhoto src={course.photoUrl} height={280} className="detail-hero-photo" style={{ height: '100%' }} />
        ) : (
          <div className="mp-photo-fallback detail-hero-photo" style={{ height: '100%' }} aria-hidden />
        )}
        {!unsupported && !loadingTimes && openCount > 0 ? (
          <span className="badge-live is-live detail-hero-open">
            <span className="pulse" aria-hidden />
            {openCount} open
          </span>
        ) : phoneOnly ? (
          <span className="badge-live is-muted detail-hero-open">Call to book</span>
        ) : unsupported ? (
          <span className="badge-live is-muted detail-hero-open">Book on site</span>
        ) : null}
        <div className="mp-course-actions detail-hero-actions">
          {!unsupported ? (
            <button
              type="button"
              className="mp-icon-btn"
              aria-label={`Tee time alerts for ${course.name}`}
              title="Alerts"
              onClick={() => setNotifOpen(true)}
            >
              <AlertsIcon />
            </button>
          ) : null}
          {!unsupported ? (
            <button
              type="button"
              className="mp-icon-btn"
              aria-label={`Plan a round at ${course.name}`}
              title="Plan a round"
              disabled={!canShare || authLoading}
              onClick={() => onShareTimes()}
            >
              <PlanIcon />
            </button>
          ) : null}
        </div>
        <div className="detail-hero-scrim">
          <h1 className="detail-hero-name">{course.name}</h1>
          {typeof course.rating === 'number' || heroMeta ? (
            <div className="detail-hero-meta">
              {typeof course.rating === 'number' ? (
                <span className="course-rating course-rating--muted">
                  <span className="star-gold" aria-hidden>
                    ★
                  </span>{' '}
                  {course.rating.toFixed(1)}
                  {typeof course.reviewCount === 'number' ? (
                    <>
                      {' '}
                      <button type="button" className="detail-hero-reviews" onClick={openReviews}>
                        ({course.reviewCount.toLocaleString()} reviews)
                      </button>
                    </>
                  ) : null}
                </span>
              ) : null}
              {typeof course.rating === 'number' && heroMeta ? (
                <span className="sep" aria-hidden>
                  ·
                </span>
              ) : null}
              {heroMeta || null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="course-stats-desktop">
        <CourseStatsBar
          holes={record?.holes ?? course.holes}
          par={record?.par}
          yardage={record?.yardage}
        />
      </div>

      <div className="detail-tabs" role="tablist" aria-label="Course sections">
        {detailTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`course-tab-${tab.id}`}
            aria-selected={detailTab === tab.id}
            aria-controls={`course-panel-${tab.id}`}
            className={`detail-tab${detailTab === tab.id ? ' is-on' : ''}`}
            onClick={() => setDetailTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="detail-cols">
        <div className="detail-main detail-panel detail-panel--info" id="course-panel-info">
          <div className="course-stats-mobile">
            <CourseStatsBar
              holes={record?.holes ?? course.holes}
              par={record?.par}
              yardage={record?.yardage}
            />
          </div>
          <CourseDetailPanel
            record={record}
            catalogMeta={catalogMeta}
            course={course}
          />
          <div className="section">
            <h2>Conditions</h2>
            <WeatherStrip
              lat={course.lat}
              lng={course.lng}
              dateYmd={date}
              highlightTimeIso={selected?.startsAt ?? null}
            />
          </div>
        </div>

        <aside className="tee-panel detail-panel detail-panel--times" id="course-panel-times">
          {unsupported ? (
            <>
              <div className="tee-panel-head">
                <div className="tee-panel-head-text">
                  <h2 className="tee-panel-title">How to book</h2>
                  <p className="tee-panel-date">{phoneOnly ? 'Phone or in person' : 'On their site'}</p>
                </div>
              </div>
              <div className="rail-empty">
                <p>
                  {phoneOnly
                    ? 'This course doesn’t take online tee times. Call the pro shop to reserve a tee time.'
                    : `${capabilityHint(cap)}.`}
                </p>
                <div className="rail-empty-actions rail-empty-actions--stack">
                  {phoneOnly ? (
                    <>
                      {proShopTelHref ? (
                        <a
                          className="tee-empty-action tee-empty-action--primary"
                          href={proShopTelHref}
                          aria-label={`Call ${course.name} pro shop at ${proShopPhone}`}
                        >
                          Call pro shop
                        </a>
                      ) : null}
                      <div className="rail-empty-actions-links">
                        {courseWebsiteHref ? (
                          <a className="tee-empty-action" href={courseWebsiteHref} target="_blank" rel="noreferrer">
                            Website
                          </a>
                        ) : null}
                        <GetDirectionsButton course={course} className="tee-empty-action">
                          Directions
                        </GetDirectionsButton>
                      </div>
                    </>
                  ) : (
                    <>
                      {bookingLinkHref ? (
                        <a
                          className="tee-empty-action tee-empty-action--primary"
                          href={bookingLinkHref}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Book on site
                        </a>
                      ) : null}
                      {proShopTelHref ? (
                        <a
                          className="tee-empty-action tee-empty-action--secondary"
                          href={proShopTelHref}
                          aria-label={`Call ${course.name} pro shop at ${proShopPhone}`}
                        >
                          Call pro shop
                        </a>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
          <div className="tee-panel-head">
            <div className="tee-panel-head-text">
              <h2 className="tee-panel-title">Next available</h2>
              <div className="rail-date-nudge-row tee-panel-date-control">
                <button
                  type="button"
                  className="rail-date-nudge"
                  aria-label="Previous day"
                  disabled={prevDateDisabled}
                  onClick={() => shiftDate(-1)}
                >
                  ‹
                </button>
                <span className="tee-panel-date-pill">
                  <span className="tee-panel-date-label" aria-hidden>
                    {formatDateShort(date)}
                  </span>
                  <input
                    type="date"
                    className="tee-panel-date-input"
                    min={todayYmd}
                    value={date}
                    aria-label={`Date, ${formatDateShort(date)}`}
                    onChange={(e) => {
                      if (e.target.value) setParam('date', clampDateToTodayOrLater(e.target.value));
                    }}
                  />
                </span>
                <button type="button" className="rail-date-nudge" aria-label="Next day" onClick={() => shiftDate(1)}>
                  ›
                </button>
              </div>
            </div>
          </div>

          <div className="rail-filters">
            <label className="rail-filter-chip">
              <span className="visually-hidden">Players</span>
              <select aria-label="Players" value={players} onChange={(e) => setParam('players', e.target.value)}>
                <option value="1">1 player</option>
                <option value="2">2 players</option>
                <option value="3">3 players</option>
                <option value="4">4 players</option>
              </select>
            </label>
            <label className="rail-filter-chip">
              <span className="visually-hidden">Holes</span>
              <select aria-label="Holes" value={holes} onChange={(e) => setParam('holes', e.target.value)}>
                <option value="18">18 holes</option>
                <option value="9">9 holes</option>
                <option value="any">Any holes</option>
              </select>
            </label>
            <label className="rail-filter-chip">
              <span className="visually-hidden">Time of day</span>
              <select aria-label="Time of day" value={tod} onChange={(e) => setParam('tod', e.target.value)}>
                {TOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {loadingTimes ? (
            <TeeSlotTimesSkeleton count={5} />
          ) : teeTimesFetchFailed ? (
            <div className="rail-empty">
              <p>Could not load tee times.</p>
              <div className="rail-empty-actions rail-empty-actions--stack">
                <button type="button" className="tee-empty-action tee-empty-action--primary" onClick={() => setTimesRetryNonce((n) => n + 1)}>
                  Retry
                </button>
              </div>
            </div>
          ) : visibleSlots.length === 0 ? (
            <div className="rail-empty">
              <p>
                No tee times for {todLabel.toLowerCase()} on {formatDateCompact(date)}
              </p>
              <div className="rail-empty-actions rail-empty-actions--stack">
                <button type="button" className="tee-empty-action tee-empty-action--primary" onClick={() => setNotifOpen(true)}>
                  Alert me
                </button>
                <div className="rail-empty-actions-links">
                  {tod !== 'any' ? (
                    <button type="button" className="tee-empty-action" onClick={() => setParam('tod', 'any')}>
                      Any time of day
                    </button>
                  ) : null}
                  <button type="button" className="tee-empty-action" onClick={() => shiftDate(1)}>
                    Try tomorrow
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className={`tee-slot-scroller${slotsExpanded && times.length > SLOT_PREVIEW ? ' is-expanded' : ''}`}>
                {visibleSlots.map((t) => {
                  const slotBookHref = buildBookingUrl(
                    record ?? { bookingUrl: course.bookingUrl, platform: course.platform, timezone: course.timezone },
                    {
                      dateYmd: date,
                      players,
                      holes: t.holes === 9 || t.holes === 18 ? t.holes : holes === 9 ? 9 : 18,
                      startsAtIso: t.startsAt,
                    },
                  );
                  return (
                    <TeeSlotCard
                      key={`${t.id}-${t.holes}`}
                      startsAt={t.startsAt}
                      timeZone={courseTimezone(record?.timezone ?? course.timezone)}
                      price={t.price}
                      spots={t.spots}
                      holes={t.holes}
                      reopenedAt={t.reopenedAt}
                      weatherPoints={weatherPoints}
                      selected={t.id === selected?.id}
                      onClick={() => {
                        setSelectedSlotId(t.id);
                        setSlotAction({ time: t, bookHref: slotBookHref });
                      }}
                    />
                  );
                })}
              </div>
              {hiddenSlotCount > 0 ? (
                <button
                  type="button"
                  className="rail-slots-more"
                  onClick={() => {
                    if (slotsExpanded) {
                      const idx = times.findIndex((t) => t.id === selectedSlotId);
                      if (idx >= SLOT_PREVIEW) setSelectedSlotId(times[0]?.id ?? null);
                      setSlotsExpanded(false);
                    } else {
                      setSlotsExpanded(true);
                    }
                  }}
                >
                  {slotsExpanded ? 'Show fewer times' : `Show ${hiddenSlotCount} more`}
                </button>
              ) : null}
              <p className="tee-panel-note">Tap a time to book or share. No markup, ever.</p>
            </>
          )}

          {!unsupported ? (
            <div className="tee-panel-foot">
              <button type="button" className="tee-panel-alert-link" onClick={() => setNotifOpen(true)}>
                <AlertsIcon size={16} />
                Create Alert
              </button>
              <button
                type="button"
                className="tee-panel-plan-link"
                disabled={!canShare || authLoading}
                onClick={() => onShareTimes()}
              >
                <PlanIcon size={16} />
                Plan a round
              </button>
            </div>
          ) : null}
            </>
          )}
        </aside>
      </div>

      <div className="detail-panel detail-panel--reviews" id="course-panel-reviews">
        <CourseReviewsSection
          reviews={reviews}
          loading={reviewsLoading}
          mapsUrl={reviewsMapsUrl}
          course={course}
        />
      </div>

      <SlotActionSheet
        open={Boolean(slotAction)}
        onClose={() => {
          if (!slotAuthBusy) clearPendingAuthAction();
          setSlotAction(null);
        }}
        courseName={course.name}
        timeLabel={
          slotAction
            ? formatTime12h(
                slotAction.time.startsAt,
                courseTimezone(record?.timezone ?? course.timezone),
              )
            : ''
        }
        metaLabel={slotAction ? slotActionMeta(slotAction.time) : ''}
        bookHref={slotAction?.bookHref ?? null}
        needsAuth={!user?.id}
        resumeBook={Boolean(slotAction?.resumeBook)}
        signingIn={slotAuthBusy}
        onBook={() => {
          if (!slotAction?.bookHref || user?.id) return;
          savePendingAuthAction({
            intent: 'book',
            courseId: course.id,
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
              courseId: course.id,
              time: slotAction.time,
              bookHref: slotAction.bookHref,
            });
            setSlotAuthBusy(true);
            void signInWithGoogle(returnTo).finally(() => setSlotAuthBusy(false));
            return;
          }
          const selectedId = slotAction.time.id;
          setSlotAction(null);
          onShareTimes(selectedId);
        }}
        onOpenedBooking={() => {
          if (!slotAction) return;
          const id = slotAction.time.id;
          setHiddenSlotIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          });
        }}
      />
      <SignInPromptModal
        open={signInToShareOpen}
        onClose={closeSignInToShare}
        variant="share"
        returnTo={returnTo}
      />
      <PlanRoundModal
        open={planRoundOpen}
        onClose={() => setPlanRoundOpen(false)}
        course={course}
        record={record}
        dateYmd={date}
        players={players}
        holes={holes === 'any' ? 18 : holes}
        times={times}
        initialSelectedId={selectedSlotId}
        coursesById={coursesById}
        recordsBySlug={recordsBySlug}
      />
      <NotificationModal
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        course={course}
        defaultDate={date}
        defaultPlayers={players}
        defaultTimeOfDay={tod}
      />
    </div>
  );
}
