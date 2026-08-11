import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { formatDateCompact, formatDateShort, formatReopenedAgo, formatTime12h, matchesPreset, toYmd } from '../lib/time';
import type { SearchParams, SortBy, TeeTime, TimeOfDayPreset } from '../types';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { fetchTeeTimesForCourse } from '../lib/workerTimes';
import { capabilityHint, getPlatformCapability, platformDisplayName, workerSupportedPlatform } from '../lib/platformRegistry';
import { WeatherStrip } from '../components/WeatherStrip';
import { CoursePhoto } from '../components/CoursePhoto';
import { NotificationModal } from '../components/NotificationModal';
import { SignInPromptModal } from '../components/SignInPromptModal';
import { PlanRoundModal } from '../components/PlanRoundModal';
import { googleMapsPlaceUrl } from '../lib/mapsLinks';
import { useAuth } from '../state/AuthContext';
import { courseDetailQueryString } from '../lib/finderUrl';
import { parseFetchRadiusMi } from '../lib/timesFetchScope';
import { buildBookingUrl } from '../lib/bookingUrl';
import { teeTimeFitsPlayers } from '../lib/teeTimeFitsPlayers';
import { CourseDetailPanel } from '../components/CourseDetailPanel';
import { CourseReviewsSection } from '../components/CourseReviewsSection';
import { AlertsIcon, PlanIcon } from '../components/icons/AppIcons';
import { CourseStatsBar } from '../components/CourseStatsBar';
import { useCourseHourlyWeather } from '../hooks/useCourseHourlyWeather';
import { pickNearestHour } from '../lib/weather';
import { WeatherGlyph } from '../components/WeatherGlyph';
import { chipWeatherLabel, weatherKindFromPrecip } from '../lib/weatherKind';
import {
  fetchCourseCatalogMeta,
  fetchCourseRatesExpanded,
  type CourseCatalogMeta,
  type CourseRatesExpanded,
} from '../lib/courseCatalogApi';
import { fetchPlaceReviews, type PlaceReview } from '../lib/placeReviews';

function clampPlayers(n: number): 1 | 2 | 3 | 4 {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

function clampHoles(n: number): 9 | 18 {
  return n === 9 ? 9 : 18;
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
  const [sp, setSp] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { courses, recordsBySlug, loading: catalogLoading } = useCourseCatalog();
  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const date = sp.get('date') || toYmd(new Date());
  const players = clampPlayers(Number(sp.get('players') || 2));
  const holes = clampHoles(Number(sp.get('holes') || 18));
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

  const shiftDate = useCallback(
    (deltaDays: number) => {
      const [y, m, d] = date.split('-').map(Number);
      const next = new Date(y!, (m ?? 1) - 1, (d ?? 1) + deltaDays);
      setParam('date', toYmd(next));
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
  const [planRoundOpen, setPlanRoundOpen] = useState(false);
  const [planAfterSignIn, setPlanAfterSignIn] = useState(false);
  const [signInToShareOpen, setSignInToShareOpen] = useState(false);
  const closeSignInToShare = useCallback(() => {
    setSignInToShareOpen(false);
    setPlanAfterSignIn(false);
  }, []);
  const [ratesExpanded, setRatesExpanded] = useState<CourseRatesExpanded | null>(null);
  const [catalogMeta, setCatalogMeta] = useState<CourseCatalogMeta | null>(null);
  const [catalogDetailLoading, setCatalogDetailLoading] = useState(false);
  const [reviews, setReviews] = useState<PlaceReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsMapsUrl, setReviewsMapsUrl] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [slotsExpanded, setSlotsExpanded] = useState(false);

  useEffect(() => {
    if (!courseId) {
      setRatesExpanded(null);
      setCatalogMeta(null);
      return;
    }
    let cancelled = false;
    setCatalogDetailLoading(true);
    void (async () => {
      try {
        const [rates, meta] = await Promise.all([
          fetchCourseRatesExpanded(courseId),
          fetchCourseCatalogMeta(courseId),
        ]);
        if (!cancelled) {
          setRatesExpanded(rates);
          setCatalogMeta(meta);
        }
      } finally {
        if (!cancelled) setCatalogDetailLoading(false);
      }
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
    setLoadingTimes(true);
    setTeeTimesFetchFailed(false);
    void (async () => {
      try {
        const { times, ok } = await fetchTeeTimesForCourse(record, courseId, date, holes, players);
        if (!cancelled) {
          setRawTimes(times);
          setTeeTimesFetchFailed(!ok);
        }
      } catch {
        if (!cancelled) {
          setRawTimes([]);
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
    if (!course) return;
    const short = course.name.length > 42 ? `${course.name.slice(0, 40)}…` : course.name;
    document.title = `${short} · Tee-Time`;
  }, [course]);

  const times = useMemo(() => {
    const list = rawTimes
      .filter((t) => matchesPreset(t.startsAt, tod))
      .filter((t) => teeTimeFitsPlayers(t, players))
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    if (sort === 'price') {
      list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    }
    return list;
  }, [rawTimes, tod, players, sort]);

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

  if (catalogLoading && !course) {
    return (
      <div className="container">
        <div className="course-page-skeleton" aria-busy="true" aria-label="Loading course">
          <div className="course-page-skeleton-hero skeleton-shimmer" />
          <div className="course-page-skeleton-identity">
            <div className="skeleton-shimmer" style={{ width: '55%', height: 28, borderRadius: 10 }} />
            <div className="skeleton-shimmer" style={{ width: '38%', height: 14, marginTop: 12, borderRadius: 8 }} />
            <div className="skeleton-shimmer" style={{ width: '72%', height: 14, marginTop: 10, borderRadius: 8 }} />
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

  const cap = record ? getPlatformCapability(record.platform) : 'booking_link_only';
  const unsupported = !record || cap !== 'live_inventory';
  const selected = times.find((t) => t.id === selectedSlotId) ?? times[0] ?? null;
  const hiddenSlotCount = Math.max(0, times.length - SLOT_PREVIEW);
  const visibleSlots = slotsExpanded || hiddenSlotCount === 0 ? times : times.slice(0, SLOT_PREVIEW);

  const onShareTimes = () => {
    if (unsupported || times.length === 0) return;
    if (!user?.id) {
      setPlanAfterSignIn(true);
      setSignInToShareOpen(true);
      return;
    }
    setPlanRoundOpen(true);
  };

  const heroMeta = [
    course.city || null,
    typeof course.distanceMi === 'number' ? `${course.distanceMi.toFixed(1)} mi` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const canShare = !unsupported && times.length > 0;
  const openCount = times.length;
  const todLabel = TOD_OPTIONS.find((o) => o.value === tod)?.label ?? 'All day';

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
        ) : null}
        <div className="mp-course-actions detail-hero-actions">
          <button
            type="button"
            className="mp-icon-btn"
            aria-label={`Tee time alerts for ${course.name}`}
            title="Alerts"
            onClick={() => setNotifOpen(true)}
          >
            <AlertsIcon />
          </button>
          <button
            type="button"
            className="mp-icon-btn"
            aria-label={`Plan a round at ${course.name}`}
            title="Plan a round"
            disabled={!canShare || authLoading}
            onClick={onShareTimes}
          >
            <PlanIcon />
          </button>
        </div>
      </div>

      <header className="detail-identity">
        <div className="detail-identity-main">
          <h1 className="detail-identity-name">{course.name}</h1>
          <div className="detail-identity-meta">
            {heroMeta || null}
            {heroMeta && typeof course.rating === 'number' ? (
              <span className="sep" aria-hidden>
                ·
              </span>
            ) : null}
            {typeof course.rating === 'number' ? (
              <span className="course-rating">
                <span className="star-gold" aria-hidden>
                  ★
                </span>{' '}
                {course.rating.toFixed(1)}
                {typeof course.reviewCount === 'number' ? (
                  <button type="button" className="detail-identity-reviews" onClick={openReviews}>
                    ({course.reviewCount.toLocaleString()} reviews)
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="course-stats-desktop">
        <CourseStatsBar
          holes={record?.holes ?? course.holes}
          par={record?.par}
          yardage={record?.yardage}
        />
      </div>

      <div className="detail-tabs" role="tablist" aria-label="Course sections">
        {TABS.map((tab) => (
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
            rates={ratesExpanded}
            catalogMeta={catalogMeta}
            ratesLoading={catalogDetailLoading}
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
          <div className="section">
            <h2>Location</h2>
            {record?.address ? <p className="detail-address">{record.address}</p> : null}
            <a className="detail-text-link" href={googleMapsPlaceUrl(course)} target="_blank" rel="noreferrer">
              Get directions →
            </a>
          </div>
        </div>

        <aside className="tee-panel detail-panel detail-panel--times" id="course-panel-times">
          <div className="tee-panel-head">
            <div className="tee-panel-head-text">
              <h2 className="tee-panel-title">Next available</h2>
              <p className="tee-panel-date">{formatDateShort(date)}</p>
            </div>
            <div className="rail-date-nudge-row">
              <button type="button" className="rail-date-nudge" aria-label="Previous day" onClick={() => shiftDate(-1)}>
                ‹
              </button>
              <button type="button" className="rail-date-nudge" aria-label="Next day" onClick={() => shiftDate(1)}>
                ›
              </button>
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
            <label className="rail-filter-chip rail-filter-chip--date">
              <span className="visually-hidden">Date</span>
              <input type="date" value={date} aria-label="Date" onChange={(e) => setParam('date', e.target.value)} />
            </label>
          </div>

          {unsupported ? (
            <div className="rail-empty">
              <p>
                <strong>{platformDisplayName(record?.platform)}</strong>. {capabilityHint(cap)}.
              </p>
              <button type="button" className="tee-empty-action" onClick={() => setNotifOpen(true)}>
                Alert me
              </button>
            </div>
          ) : loadingTimes ? (
            <p className="rail-status">Checking tee times…</p>
          ) : teeTimesFetchFailed ? (
            <div className="rail-empty">
              <p>Could not load tee times.</p>
              <button type="button" className="tee-empty-action" onClick={() => setTimesRetryNonce((n) => n + 1)}>
                Retry
              </button>
            </div>
          ) : visibleSlots.length === 0 ? (
            <div className="rail-empty">
              <p>
                No tee times for {todLabel.toLowerCase()} on {formatDateCompact(date)}
              </p>
              <div className="rail-empty-actions">
                {tod !== 'any' ? (
                  <button type="button" className="tee-empty-action" onClick={() => setParam('tod', 'any')}>
                    Any time of day
                  </button>
                ) : null}
                <button type="button" className="tee-empty-action" onClick={() => shiftDate(1)}>
                  Try tomorrow
                </button>
                <button type="button" className="tee-empty-action tee-empty-action--primary" onClick={() => setNotifOpen(true)}>
                  Alert me
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className={`tee-slot-scroller${slotsExpanded && times.length > SLOT_PREVIEW ? ' is-expanded' : ''}`}>
                {visibleSlots.map((t) => {
                  const slotBookHref = buildBookingUrl(
                    record ?? { bookingUrl: course.bookingUrl, platform: course.platform },
                    {
                      dateYmd: date,
                      players,
                      holes,
                      startsAtIso: t.startsAt,
                    },
                  );
                  const wx = weatherPoints ? pickNearestHour(weatherPoints, t.startsAt) : null;
                  const wxLabel = chipWeatherLabel(wx);
                  const precip = wx?.precipProb ?? 0;
                  const wxKind = weatherKindFromPrecip(precip);
                  const slotClass = `tee-slot-card${t.id === selected?.id ? ' is-sel' : ''}${
                    t.reopenedAt ? ' is-reopened' : ''
                  }`;
                  const priceLabel = typeof t.price === 'number' ? `$${Math.round(t.price)}` : null;
                  const reopenLabel = t.reopenedAt ? formatReopenedAgo(t.reopenedAt) : null;
                  const bookAria = [
                    `Book ${formatTime12h(t.startsAt)}`,
                    priceLabel,
                    reopenLabel ? `reopened ${reopenLabel}` : null,
                  ]
                    .filter(Boolean)
                    .join(', ');
                  const slotBody = (
                    <>
                      <span className="tee-slot-card-time">{formatTime12h(t.startsAt)}</span>
                      {reopenLabel ? (
                        <span className="tee-slot-card-new" title={reopenLabel}>
                          New
                        </span>
                      ) : null}
                      {wxLabel ? (
                        <span className={`tee-slot-card-wx tee-slot-card-wx--${wxKind}`}>
                          <WeatherGlyph precipProb={precip} />
                          {wxLabel}
                        </span>
                      ) : (
                        <span className="tee-slot-card-wx is-empty" aria-hidden>
                          &nbsp;
                        </span>
                      )}
                      <span className="tee-slot-card-meta">
                        {typeof t.spots === 'number' ? (
                          <span title={`${t.spots} spot${t.spots === 1 ? '' : 's'}`}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
                              <path
                                d="M3.5 19c.8-3 2.8-4.5 5.5-4.5S13.7 16 14.5 19"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                            </svg>
                            {t.spots}
                          </span>
                        ) : null}
                        <span title={`${t.holes} holes`}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path d="M6 21V5l9 4.5L6 14" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                          </svg>
                          {t.holes}
                        </span>
                      </span>
                      {priceLabel ? (
                        <span className="tee-slot-card-price">{priceLabel}</span>
                      ) : (
                        <span className="tee-slot-card-price is-muted">—</span>
                      )}
                      <svg className="tee-slot-card-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </>
                  );
                  if (slotBookHref) {
                    return (
                      <a
                        key={t.id}
                        href={slotBookHref}
                        target="_blank"
                        rel="noreferrer"
                        className={slotClass}
                        onClick={() => setSelectedSlotId(t.id)}
                        aria-label={bookAria}
                      >
                        {slotBody}
                      </a>
                    );
                  }
                  return (
                    <button key={t.id} type="button" className={slotClass} onClick={() => setSelectedSlotId(t.id)}>
                      {slotBody}
                    </button>
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
              <p className="tee-panel-note">Tap a time to book on the course site. No markup, ever.</p>
            </>
          )}

          <div className="tee-panel-foot">
            <button type="button" className="tee-panel-alert-link" onClick={() => setNotifOpen(true)}>
              <AlertsIcon size={16} />
              Create alert
            </button>
            <button
              type="button"
              className="tee-panel-plan-link"
              disabled={!canShare || authLoading}
              onClick={onShareTimes}
            >
              <PlanIcon size={16} />
              Plan a round
            </button>
          </div>
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

      <SignInPromptModal open={signInToShareOpen} onClose={closeSignInToShare} variant="share" />
      <PlanRoundModal
        open={planRoundOpen}
        onClose={() => setPlanRoundOpen(false)}
        course={course}
        record={record}
        dateYmd={date}
        players={players}
        holes={holes}
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
