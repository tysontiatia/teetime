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
import { SignInToShareModal } from '../components/SignInToShareModal';
import { PlanRoundModal } from '../components/PlanRoundModal';
import { googleMapsPlaceUrl } from '../lib/mapsLinks';
import { useAuth } from '../state/AuthContext';
import { courseDetailQueryString } from '../lib/finderUrl';
import { buildBookingUrl } from '../lib/bookingUrl';
import { CourseDetailPanel } from '../components/CourseDetailPanel';
import { CourseReviewsSection } from '../components/CourseReviewsSection';
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

const RAIL_SLOT_PREVIEW = 9;

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

  const finderBackSearch = useMemo(() => {
    const finderParams: SearchParams = {
      date,
      players,
      holes,
      timeOfDay: tod,
      sortBy: sort,
      locationQuery: sp.get('q') || '',
      fetchScope: sp.get('scope') === 'all' ? 'all' : 'nearby',
    };
    return courseDetailQueryString(finderParams);
  }, [date, players, holes, tod, sort, sp]);

  const course = useMemo(() => courses.find((c) => c.id === courseId) ?? null, [courses, courseId]);
  const record = courseId ? recordsBySlug.get(courseId) : undefined;

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
    document.title = `${short} — Tee-Time`;
  }, [course]);

  const times = useMemo(() => {
    const list = rawTimes
      .filter((t) => matchesPreset(t.startsAt, tod))
      .filter((t) => {
        if (players === 1) return true;
        return t.spots != null && t.spots >= players;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    if (sort === 'price') {
      list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    }
    return list;
  }, [rawTimes, tod, players, sort]);

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [slotsExpanded, setSlotsExpanded] = useState(false);

  useEffect(() => {
    setSelectedSlotId(null);
    setSlotsExpanded(false);
  }, [courseId, date, holes, players, tod]);

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
        <div style={{ padding: 18, color: 'var(--ink-3)' }}>Loading course…</div>
      </div>
    );
  }

  if (!course || !courseId) {
    return (
      <div className="container">
        <div style={{ padding: 18, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16 }}>
          <div style={{ fontWeight: 700 }}>Course not found</div>
          <Link className="btn" to={`/?${finderBackSearch}`} style={{ marginTop: 10 }}>
            Back to finder
          </Link>
        </div>
      </div>
    );
  }

  const cap = record ? getPlatformCapability(record.platform) : 'booking_link_only';
  const unsupported = !record || cap !== 'live_inventory';
  const selected = times.find((t) => t.id === selectedSlotId) ?? times[0] ?? null;
  const priceHint = selected?.price ?? times.find((t) => typeof t.price === 'number')?.price;
  const hiddenSlotCount = Math.max(0, times.length - RAIL_SLOT_PREVIEW);
  const railSlots = slotsExpanded || hiddenSlotCount === 0 ? times : times.slice(0, RAIL_SLOT_PREVIEW);

  const onShareTimes = () => {
    if (unsupported || times.length === 0) return;
    if (!user?.id) {
      setPlanAfterSignIn(true);
      setSignInToShareOpen(true);
      return;
    }
    setPlanRoundOpen(true);
  };

  const playersHolesValue = `${players}-${holes}`;
  const platformName = platformDisplayName(record?.platform);
  const bookingHref = buildBookingUrl(record ?? { bookingUrl: course.bookingUrl, platform: course.platform }, {
    dateYmd: date,
    players,
    holes,
    startsAtIso: selected?.startsAt ?? null,
  });
  const bookLabel = bookingHref
    ? selected
      ? `Continue on ${platformName} →`
      : `Open ${platformName} →`
    : 'No booking link';
  const bookNote = selected
    ? `Opens ${platformName} with ${formatDateShort(date)} · ${players} · ${holes} holes — confirm ${formatTime12h(selected.startsAt)} there. No markup, ever.`
    : 'Opens the course’s booking site with your date and party when supported. No markup, ever.';

  const heroMeta = [
    course.city || null,
    typeof course.distanceMi === 'number' ? `${course.distanceMi.toFixed(1)} mi` : null,
    record?.par ? `Par ${record.par}` : null,
    record?.yardage ? `${record.yardage.toLocaleString()} yds` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const canShare = !unsupported && times.length > 0;

  return (
    <div className="container">
      <div className="back-row">
        <Link to={`/?${finderBackSearch}`} className="back-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          All courses
        </Link>
      </div>


      <div className="detail-hero">
        {course.photoUrl ? (
          <CoursePhoto src={course.photoUrl} height={280} className="detail-hero-photo" style={{ height: '100%' }} />
        ) : (
          <div className="mp-photo-fallback detail-hero-photo" style={{ height: '100%' }} aria-hidden />
        )}
        <div className="detail-hero-scrim">
          <h1 className="detail-hero-name">{course.name}</h1>
          <div className="detail-hero-meta">
            {typeof course.rating === 'number' ? (
              <span className="course-rating">
                <span className="star-gold" aria-hidden>
                  ★
                </span>{' '}
                {course.rating.toFixed(1)}
                {typeof course.reviewCount === 'number' ? (
                  <a href={googleMapsPlaceUrl(course)} target="_blank" rel="noreferrer" className="detail-hero-reviews">
                    {' '}
                    ({course.reviewCount.toLocaleString()})
                  </a>
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
        </div>
        <div className="mp-course-actions detail-hero-actions">
          <button
            type="button"
            className="mp-icon-btn"
            aria-label={`Tee time alerts for ${course.name}`}
            title="Tee time alerts"
            onClick={() => setNotifOpen(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M18 9a6 6 0 10-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9ZM10 20a2.2 2.2 0 004 0"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="mp-icon-btn"
            aria-label={`Share vote link for ${course.name}`}
            title="Share times"
            disabled={!canShare || authLoading}
            onClick={onShareTimes}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 3v11M8.5 6.5L12 3l3.5 3.5"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5 12v6.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V12"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="detail-cols">
        <div className="detail-main">
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

          <CourseReviewsSection
            reviews={reviews}
            loading={reviewsLoading}
            mapsUrl={reviewsMapsUrl}
            course={course}
          />

          <div className="section">
            <h2>Location</h2>
            {record?.address ? <p className="detail-address">{record.address}</p> : null}
            <a className="detail-text-link" href={googleMapsPlaceUrl(course)} target="_blank" rel="noreferrer">
              Open in Google Maps →
            </a>
          </div>
        </div>

        <aside className="rail">
          <div className="rail-price">
            <span className="amt mono">{typeof priceHint === 'number' ? `$${priceHint}` : '—'}</span>
            <span className="per">/ player · {holes} holes</span>
          </div>
          <div className="rail-picker">
            <div className="rp-row">
              <div className="rp-cell">
                <div className="k">Date</div>
                <span className="sp-date rp-date">
                  <span className="sp-date-label" aria-hidden>
                    {formatDateCompact(date)}
                  </span>
                  <input
                    type="date"
                    value={date}
                    aria-label="Date"
                    onChange={(e) => setParam('date', e.target.value)}
                  />
                </span>
              </div>
              <div className="rp-cell">
                <div className="k">Players · holes</div>
                <select
                  className="rp-select"
                  aria-label="Players and holes"
                  value={playersHolesValue}
                  onChange={(e) => {
                    const [p, h] = e.target.value.split('-');
                    const next = new URLSearchParams(sp);
                    if (p) next.set('players', p);
                    if (h) next.set('holes', h);
                    setSp(next, { replace: true });
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
              </div>
            </div>
          </div>

          <h3>Tee times</h3>
          {unsupported ? (
            <div className="rail-empty">
              <p>
                <strong>{platformDisplayName(record?.platform)}</strong> — {capabilityHint(cap)}.
              </p>
              <button type="button" className="tee-empty-action" onClick={() => setNotifOpen(true)}>
                Notify me
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
          ) : railSlots.length === 0 ? (
            <div className="rail-empty">
              <p>No tee times for these filters</p>
              <button type="button" className="tee-empty-action" onClick={() => setNotifOpen(true)}>
                Notify me
              </button>
            </div>
          ) : (
            <>
              <div className={`rail-slots${slotsExpanded && times.length > RAIL_SLOT_PREVIEW ? ' is-expanded' : ''}`}>
                {railSlots.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`slot${t.id === selected?.id ? ' sel' : ''}`}
                    onClick={() => setSelectedSlotId(t.id)}
                  >
                    <span className="t">{formatTime12h(t.startsAt).replace(' ', '').toLowerCase()}</span>
                    <span className={`s${typeof t.spots === 'number' && t.spots <= 2 ? ' low' : ''}`}>
                      {t.reopenedAt
                        ? formatReopenedAgo(t.reopenedAt)
                        : typeof t.spots === 'number'
                          ? `${t.spots} spot${t.spots === 1 ? '' : 's'}`
                          : typeof t.price === 'number'
                            ? `$${t.price}`
                            : 'Open'}
                    </span>
                  </button>
                ))}
              </div>
              {hiddenSlotCount > 0 ? (
                <button
                  type="button"
                  className="rail-slots-more"
                  onClick={() => {
                    if (slotsExpanded) {
                      const idx = times.findIndex((t) => t.id === selectedSlotId);
                      if (idx >= RAIL_SLOT_PREVIEW) setSelectedSlotId(times[0]?.id ?? null);
                      setSlotsExpanded(false);
                    } else {
                      setSlotsExpanded(true);
                    }
                  }}
                >
                  {slotsExpanded ? 'Show fewer times' : `Show ${hiddenSlotCount} more`}
                </button>
              ) : null}
            </>
          )}

          {bookingHref ? (
            <a className="rail-cta" href={bookingHref} target="_blank" rel="noreferrer">
              {bookLabel}
            </a>
          ) : (
            <button type="button" className="rail-cta" disabled>
              {bookLabel}
            </button>
          )}
          <div className="rail-note">{bookNote}</div>

          <div className="rail-plan">
            <span className="icon" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M17 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9.5 11a4 4 0 100-8 4 4 0 000 8ZM22 21v-2a4 4 0 00-3-3.87M15.5 3.13a4 4 0 010 7.75"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="txt">
              <strong>Playing with a group?</strong>
              Pick times to vote on, then share a link.
            </span>
            <button
              type="button"
              className="go"
              disabled={!canShare || authLoading}
              onClick={onShareTimes}
            >
              Plan a round
            </button>
          </div>
        </aside>
      </div>

      <SignInToShareModal open={signInToShareOpen} onClose={closeSignInToShare} />
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
      <NotificationModal open={notifOpen} onClose={() => setNotifOpen(false)} course={course} defaultDate={date} />
    </div>
  );
}
