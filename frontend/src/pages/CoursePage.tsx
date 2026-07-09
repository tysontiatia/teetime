import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SearchParams, SortBy, TeeTime, TimeOfDayPreset } from '../types';
import { formatDateShort, formatReopenedAgo, formatTime12h, matchesPreset, toYmd } from '../lib/time';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { fetchTeeTimesForCourse } from '../lib/workerTimes';
import { capabilityHint, getPlatformCapability, platformDisplayName, workerSupportedPlatform } from '../lib/platformRegistry';
import { WeatherStrip } from '../components/WeatherStrip';
import { CoursePhoto } from '../components/CoursePhoto';
import { NotificationModal } from '../components/NotificationModal';
import { SignInToShareModal } from '../components/SignInToShareModal';
import { googleMapsPlaceUrl } from '../lib/mapsLinks';
import { useAuth } from '../state/AuthContext';
import { publishRoundFromPlan, planFromCourseVisibleTimes } from '../lib/roundsApi';
import { copyTextToClipboard } from '../lib/clipboard';
import { courseDetailQueryString } from '../lib/finderUrl';
import { absoluteRoundUrl } from '../lib/shareUrl';
import { CourseDetailPanel } from '../components/CourseDetailPanel';
import {
  fetchCourseCatalogMeta,
  fetchCourseRatesExpanded,
  type CourseCatalogMeta,
  type CourseRatesExpanded,
} from '../lib/courseCatalogApi';

function clampPlayers(n: number): 1 | 2 | 3 | 4 {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

function clampHoles(n: number): 9 | 18 {
  return n === 9 ? 9 : 18;
}

export function CoursePage() {
  const nav = useNavigate();
  const { courseId } = useParams();
  const [sp] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { courses, recordsBySlug, loading: catalogLoading } = useCourseCatalog();
  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const date = sp.get('date') || toYmd(new Date());
  const players = clampPlayers(Number(sp.get('players') || 2));
  const holes = clampHoles(Number(sp.get('holes') || 18));
  const tod = ((sp.get('tod') as TimeOfDayPreset) || 'any') satisfies TimeOfDayPreset;
  const sort = ((sp.get('sort') as SortBy) || 'soonest') satisfies SortBy;

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
  const [shareBusy, setShareBusy] = useState(false);
  const [shareErr, setShareErr] = useState<string | null>(null);
  const [signInToShareOpen, setSignInToShareOpen] = useState(false);
  const closeSignInToShare = useCallback(() => setSignInToShareOpen(false), []);
  const [ratesExpanded, setRatesExpanded] = useState<CourseRatesExpanded | null>(null);
  const [catalogMeta, setCatalogMeta] = useState<CourseCatalogMeta | null>(null);
  const [catalogDetailLoading, setCatalogDetailLoading] = useState(false);

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

  useEffect(() => {
    setSelectedSlotId(null);
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
  const railSlots = times.slice(0, 9);

  const onShareTimes = async () => {
    if (unsupported || times.length === 0) return;
    const uid = user?.id;
    if (!uid) {
      setSignInToShareOpen(true);
      return;
    }
    setShareBusy(true);
    setShareErr(null);
    const planPayload = planFromCourseVisibleTimes(course, date, times, players);
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
    setShareBusy(false);
    if ('error' in res) {
      setShareErr(res.error);
      return;
    }
    const url = absoluteRoundUrl(res.slug);
    const copied = await copyTextToClipboard(url);
    if (!copied) {
      setShareErr('Vote page created, but the link could not be copied automatically — copy it from the address bar.');
    }
    nav(`/round/${res.slug}`);
  };

  const bookLabel = selected
    ? `Book ${formatTime12h(selected.startsAt)} on ${platformDisplayName(record?.platform)} →`
    : course.bookingUrl
      ? `Open ${platformDisplayName(record?.platform)} →`
      : 'No booking link';

  return (
    <div className="container">
      <div className="back-row">
        <Link to={`/?${finderBackSearch}`} className="back-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          All courses
        </Link>
        <div className="detail-actions">
          <button type="button" className="btn-ghost-pill" onClick={() => setNotifOpen(true)}>
            Alert me
          </button>
          {!unsupported && times.length > 0 ? (
            <button
              type="button"
              className="btn-ghost-pill"
              disabled={shareBusy || authLoading}
              onClick={() => void onShareTimes()}
            >
              {shareBusy ? 'Creating…' : 'Share times'}
            </button>
          ) : null}
          {course.bookingUrl ? (
            <a className="btn-ghost-pill" href={course.bookingUrl} target="_blank" rel="noreferrer">
              Booking site
            </a>
          ) : null}
        </div>
      </div>

      {shareErr ? <p style={{ margin: '0 0 12px', color: '#9a3412', fontSize: 14 }}>{shareErr}</p> : null}

      <div className="mosaic">
        <div className="m-main">
          {course.photoUrl ? (
            <CoursePhoto src={course.photoUrl} height={360} style={{ height: '100%' }} />
          ) : (
            <div className="mp-photo-fallback" style={{ height: '100%' }} aria-hidden />
          )}
        </div>
      </div>

      <div className="detail-title">
        <h1>
          {course.name}
          {course.city ? ` (${course.city})` : ''}
        </h1>
        <div className="detail-sub">
          {typeof course.rating === 'number' ? (
            <>
              <strong>★ {course.rating.toFixed(1)}</strong>
              {typeof course.reviewCount === 'number' ? (
                <a href={googleMapsPlaceUrl(course)} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
                  {course.reviewCount.toLocaleString()} reviews
                </a>
              ) : null}
              <span className="sep">·</span>
            </>
          ) : null}
          {course.city}
          {typeof course.distanceMi === 'number' ? (
            <>
              <span className="sep">·</span>
              {course.distanceMi.toFixed(1)} mi away
            </>
          ) : null}
          {record?.par || record?.yardage ? (
            <>
              <span className="sep">·</span>
              <span className="mono">
                {[record.par ? `Par ${record.par}` : null, record.yardage ? `${record.yardage.toLocaleString()} yds` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="detail-cols">
        <div>
          <div className="section">
            <div className="facts">
              {record?.walkability ? (
                <div className="fact">
                  <div className="k">Walkability</div>
                  <div className="v">{record.walkability === 'carts only' ? 'Carts only' : record.walkability.charAt(0).toUpperCase() + record.walkability.slice(1)}</div>
                </div>
              ) : null}
              {Number.isFinite(record?.booking_window_days) ? (
                <div className="fact">
                  <div className="k">Books out</div>
                  <div className="v mono">{record!.booking_window_days} days</div>
                </div>
              ) : null}
              {record?.platform ? (
                <div className="fact">
                  <div className="k">Booking via</div>
                  <div className="v">{platformDisplayName(record.platform)}</div>
                </div>
              ) : null}
              <div className="fact">
                <div className="k">Playing</div>
                <div className="v mono">
                  {formatDateShort(date)} · {players}p · {holes}h
                </div>
              </div>
            </div>
          </div>

          <CourseDetailPanel
            record={record}
            rates={ratesExpanded}
            catalogMeta={catalogMeta}
            ratesLoading={catalogDetailLoading}
          />

          <div className="section">
            <h2>Conditions</h2>
            <WeatherStrip lat={course.lat} lng={course.lng} dateYmd={date} />
          </div>

          <div className="section">
            <h2>What golfers say</h2>
            <p style={{ marginBottom: 14 }}>
              Star ratings and review counts come from Google Places. Full review text stays on Google.
            </p>
            <a className="btn btn-primary" href={googleMapsPlaceUrl(course)} target="_blank" rel="noreferrer" style={{ borderRadius: 999 }}>
              Read reviews on Google Maps →
            </a>
            {record?.address ? <div style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-3)' }}>{record.address}</div> : null}
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
                <div className="v">{formatDateShort(date)}</div>
              </div>
              <div className="rp-cell">
                <div className="k">Players</div>
                <div className="v">
                  {players} golfer{players === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            <div className="rp-cell">
              <div className="k">Holes</div>
              <div className="v">{holes} holes</div>
            </div>
          </div>

          <h3>Today&apos;s times</h3>
          {unsupported ? (
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--ink)' }}>{platformDisplayName(record?.platform)}</strong> — {capabilityHint(cap)}.
            </p>
          ) : loadingTimes ? (
            <p style={{ margin: '0 0 16px', color: 'var(--ink-3)', fontSize: 14 }}>Loading tee times…</p>
          ) : teeTimesFetchFailed ? (
            <div style={{ marginBottom: 16 }}>
              <p style={{ margin: 0, color: '#92400e', fontSize: 13 }}>Could not load tee times.</p>
              <button type="button" className="btn btn-primary" style={{ marginTop: 10, width: '100%' }} onClick={() => setTimesRetryNonce((n) => n + 1)}>
                Retry
              </button>
            </div>
          ) : railSlots.length === 0 ? (
            <div style={{ marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.45 }}>
                No matching times for this filter set.
              </p>
              <button type="button" className="btn btn-primary" style={{ marginTop: 10, width: '100%' }} onClick={() => setNotifOpen(true)}>
                Get notified
              </button>
            </div>
          ) : (
            <div className="rail-slots">
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
          )}

          {course.bookingUrl ? (
            <a className="rail-cta" href={course.bookingUrl} target="_blank" rel="noreferrer">
              {bookLabel}
            </a>
          ) : (
            <button type="button" className="rail-cta" disabled>
              {bookLabel}
            </button>
          )}
          <div className="rail-note">Opens the course&apos;s booking site. No markup, ever.</div>

          <div className="rail-plan">
            <span className="icon" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M17 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9.5 11a4 4 0 100-8 4 4 0 000 8ZM22 21v-2a4 4 0 00-3-3.87M15.5 3.13a4 4 0 010 7.75"
                  stroke="#2A4405"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="txt">
              <strong>Playing with a group?</strong>
              Send these times to a vote.
            </span>
            <button
              type="button"
              className="go"
              disabled={unsupported || times.length === 0 || shareBusy || authLoading}
              onClick={() => void onShareTimes()}
            >
              Plan a round
            </button>
          </div>
        </aside>
      </div>

      <SignInToShareModal open={signInToShareOpen} onClose={closeSignInToShare} />
      <NotificationModal open={notifOpen} onClose={() => setNotifOpen(false)} course={course} defaultDate={date} />
    </div>
  );
}
