import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { GetDirectionsButton } from '../components/GetDirectionsButton';
import { NotificationModal } from '../components/NotificationModal';
import { TeeSlotCard } from '../components/TeeSlotCard';
import { WeatherGlyph } from '../components/WeatherGlyph';
import { SiteFooter } from '../components/SiteFooter';
import { useCourseHourlyWeather } from '../hooks/useCourseHourlyWeather';
import { captureEvent } from '../lib/analytics';
import { buildBookingUrl } from '../lib/bookingUrl';
import { noteOutboundBooking } from '../lib/bookingFollowUp';
import { resolveCourseBookingMode } from '../lib/courseRecord';
import { fetchTeeTimesForCourse } from '../lib/workerTimes';
import { parseHolesFilter, type HolesFilter } from '../lib/holesFilter';
import { googleMapsPlaceUrl } from '../lib/mapsLinks';
import { courseTimezone } from '../lib/teeTimeInstant';
import { teeTimeFitsPlayers } from '../lib/teeTimeFitsPlayers';
import {
  clampDateToTodayOrLater,
  defaultFindDateYmd,
  formatDateChip,
  formatDateCompact,
  formatTime12h,
  shiftYmd,
  todayYmdUtah,
  ymdInTimeZone,
} from '../lib/time';
import { useAuth } from '../state/AuthContext';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import type { TeeTime, TimeOfDayPreset } from '../types';
import { CourseHighlights } from './CourseHighlights';
import { buildCourseHighlights, courseAboutNotes } from './coursePlay';
import { StaySearchHeader, readStayRadius, staySearchQueryString, type StaySearchQuery } from './StaySearchHeader';
import { visibleSlots, collapseIdenticalSlots, sheetWeatherSummary, ymdToDate } from './stayTimes';
import { TIME_OPTIONS } from './WhenPanel';
import './stay.css';

const SLOT_PREVIEW = 12;

function clampPlayers(n: number): 1 | 2 | 3 | 4 {
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return 1;
}

function parseSlotHoles(raw: string | null): 9 | 18 | null {
  if (raw === '9') return 9;
  if (raw === '18') return 18;
  return null;
}

function parseTod(raw: string | null): TimeOfDayPreset {
  if (raw === 'morning' || raw === 'afternoon' || raw === 'evening') return raw;
  return 'any';
}

function emptyTimesCopy(tod: TimeOfDayPreset, ymd: string) {
  const day = formatDateCompact(ymd);
  if (tod === 'morning') return `No morning tee times on ${day}.`;
  if (tod === 'afternoon') return `No afternoon tee times on ${day}.`;
  if (tod === 'evening') return `No twilight tee times on ${day}.`;
  return `No tee times on ${day}.`;
}

function todWord(tod: TimeOfDayPreset) {
  if (tod === 'morning') return 'Morning';
  if (tod === 'afternoon') return 'Afternoon';
  if (tod === 'evening') return 'Twilight';
  return '';
}

function bookingWindowLine(days?: number | null, opens?: string | null) {
  if (!Number.isFinite(days)) return null;
  const at = opens?.trim();
  if (at) return `Books ${days} days out · opens ${at} MT`;
  return `Books ${days} days out`;
}

function Heart({ on }: { on: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
      <path
        d="M16 28c7-4.73 14-10 14-17a6.98 6.98 0 0 0-7-7c-1.8 0-3.58.68-4.95 2.05L16 8.1l-2.05-2.05a6.98 6.98 0 0 0-9.9 0A6.98 6.98 0 0 0 2 11c0 7 7 12.27 14 17z"
        fill={on ? 'currentColor' : 'rgba(0,0,0,0.5)'}
        stroke="#fff"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StayCourse() {
  const { courseId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;
  const { user } = useAuth();
  const { courses, recordsBySlug, loading: catalogLoading } = useCourseCatalog();
  const course = useMemo(
    () => courses.find((c) => c.id === courseId) ?? null,
    [courses, courseId],
  );
  const record = recordsBySlug.get(courseId);
  const holesLocked = record?.holes === 9;
  const [playDate, setPlayDate] = useState(() => clampDateToTodayOrLater(params.get('date') || defaultFindDateYmd()));
  const [party, setParty] = useState<1 | 2 | 3 | 4>(() => clampPlayers(Number(params.get('players') || 1)));
  const [holeChoice, setHoleChoice] = useState<HolesFilter>(() => parseHolesFilter(params.get('holes')));
  const [tod, setTod] = useState<TimeOfDayPreset>(() => parseTod(params.get('tod')));
  const [picked, setPicked] = useState<string | null>(() => params.get('time'));
  const [pickedHoles, setPickedHoles] = useState<9 | 18 | null>(() => parseSlotHoles(params.get('slot')));
  const holes: HolesFilter = holesLocked ? 9 : holeChoice;
  const date = playDate;
  const players = party;
  const [expanded, setExpanded] = useState(false);
  const daysRef = useRef<HTMLDivElement>(null);
  const dayPillReady = useRef(false);
  const [dayPill, setDayPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [dayPillMoves, setDayPillMoves] = useState(false);
  const [priceSettle, setPriceSettle] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pop, setPop] = useState(false);
  const [copied, setCopied] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [rawTimes, setRawTimes] = useState<TeeTime[]>([]);
  const [loadingTimes, setLoadingTimes] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const hasTimesRef = useRef(false);
  const lastFetchAtRef = useRef(0);

  const holesLockedRef = useRef(holesLocked);
  holesLockedRef.current = holesLocked;
  const filtersRef = useRef({ date, players, holes: holeChoice, tod, time: picked });
  filtersRef.current = { date, players, holes: holeChoice, tod, time: picked };

  const publish = useCallback((next: URLSearchParams) => {
    navigate(
      { pathname: locationRef.current.pathname, search: `?${next.toString()}` },
      { replace: true },
    );
  }, [navigate]);

  const write = useCallback(
    (changes: Record<string, string | null>) => {
      const cur = filtersRef.current;
      const nextFilters = {
        date: changes.date || cur.date,
        players: changes.players ? clampPlayers(Number(changes.players)) : cur.players,
        holes: 'holes' in changes ? parseHolesFilter(changes.holes) : cur.holes,
        tod: 'tod' in changes ? parseTod(changes.tod) : cur.tod,
        time: 'time' in changes ? changes.time : null,
        slot: 'slot' in changes ? parseSlotHoles(changes.slot) : null,
      };
      if (holesLockedRef.current) nextFilters.holes = 9;
      filtersRef.current = nextFilters;
      setPlayDate(nextFilters.date);
      setParty(nextFilters.players);
      setHoleChoice(nextFilters.holes);
      setTod(nextFilters.tod);
      setPicked(nextFilters.time);
      setPickedHoles(nextFilters.slot);

      const next = new URLSearchParams();
      next.set('date', nextFilters.date);
      next.set('players', String(nextFilters.players));
      next.set('holes', String(nextFilters.holes));
      if (nextFilters.tod !== 'any') next.set('tod', nextFilters.tod);
      if (nextFilters.time) next.set('time', nextFilters.time);
      if (nextFilters.slot) next.set('slot', String(nextFilters.slot));
      const current = new URLSearchParams(window.location.search);
      const where = current.get('where');
      const radius = current.get('radius');
      const sort = current.get('sort');
      if (where) next.set('where', where);
      if (radius) next.set('radius', radius);
      if (sort) next.set('sort', sort);
      publish(next);
    },
    [publish],
  );

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [courseId]);

  const query = params.toString();
  useEffect(() => {
    const next = new URLSearchParams(query);
    setPlayDate(clampDateToTodayOrLater(next.get('date') || defaultFindDateYmd()));
    setParty(clampPlayers(Number(next.get('players') || 1)));
    setHoleChoice(parseHolesFilter(next.get('holes')));
    setTod(parseTod(next.get('tod')));
    setPicked(next.get('time'));
    setPickedHoles(parseSlotHoles(next.get('slot')));
  }, [query]);

  useEffect(() => {
    const next = new URLSearchParams(window.location.search);
    let changed = false;
    const rawDate = next.get('date');
    const nextDate = rawDate ? clampDateToTodayOrLater(rawDate) : defaultFindDateYmd();
    if (rawDate !== nextDate) {
      next.set('date', nextDate);
      changed = true;
    }
    if (holesLocked && next.get('holes') !== '9') {
      next.set('holes', '9');
      changed = true;
    }
    if (changed) publish(next);
  }, [holesLocked, publish]);

  useEffect(() => {
    setExpanded(false);
  }, [courseId, date, players, holes, tod]);

  const searchKey = `${courseId}|${date}|${holes}|${players}`;
  // Drop the previous day's chips before paint so a slow vendor sheet cannot
  // sit on screen as if it belonged to the new date.
  useLayoutEffect(() => {
    hasTimesRef.current = false;
    setRawTimes([]);
    setFetchFailed(false);
    setLoadingTimes(true);
  }, [searchKey]);

  useEffect(() => {
    if (catalogLoading || !courseId) {
      setLoadingTimes(Boolean(courseId));
      return;
    }
    if (!record || resolveCourseBookingMode(record) !== 'live') {
      setRawTimes([]);
      setFetchFailed(false);
      setLoadingTimes(false);
      return;
    }

    let cancelled = false;
    const keepShown = hasTimesRef.current;
    if (!keepShown) {
      setRawTimes([]);
      setLoadingTimes(true);
    }
    setFetchFailed(false);

    // Same single-course path as the previous course page: fresh=1 so the worker
    // live-fills this course in one request. The Find hook skips that and then
    // makes a second browser live call when the snapshot is too old to trust.
    const sheetHoles = record.holes === 9 && holes === 18 ? 9 : holes;
    // Defer so Strict Mode's mount→cleanup→mount only starts one vendor request.
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { times, ok } = await fetchTeeTimesForCourse(record, courseId, date, sheetHoles, players);
          if (cancelled) return;
          if (!ok && times.length === 0 && hasTimesRef.current) return;
          setRawTimes(times);
          hasTimesRef.current = times.length > 0;
          setFetchFailed(!ok && times.length === 0);
          lastFetchAtRef.current = Date.now();
        } catch {
          if (cancelled) return;
          if (!hasTimesRef.current) setRawTimes([]);
          setFetchFailed(!hasTimesRef.current);
        } finally {
          if (!cancelled) setLoadingTimes(false);
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [catalogLoading, courseId, record, date, holes, players, refreshNonce]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchAtRef.current < 4000) return;
      setRefreshNonce((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (!course) return;
    const short = course.name.length > 42 ? `${course.name.slice(0, 40)}…` : course.name;
    document.title = `${short} · Tee-Time`;
  }, [course]);

  const tz = courseTimezone(record?.timezone ?? course?.timezone);
  const slots = collapseIdenticalSlots(
    visibleSlots(rawTimes, tz, { tod, holes }).filter((tee) =>
      teeTimeFitsPlayers(tee, players) && ymdInTimeZone(tee.startsAt, tz) === date,
    ),
    tz,
  );
  const selected = slots.find((tee) =>
    tee.startsAt === picked && (pickedHoles == null || tee.holes === pickedHoles),
  ) ?? null;
  const mixedLengths = slots.some((tee) => tee.holes === 9) && slots.some((tee) => tee.holes === 18);
  const roundHoles = holes === 'any' ? selected?.holes ?? null : holes;
  const shown = expanded ? slots : slots.slice(0, SLOT_PREVIEW);
  const hiddenCount = Math.max(0, slots.length - shown.length);
  const { points: weatherPoints, pending: weatherPending } = useCourseHourlyWeather(
    course?.lat,
    course?.lng,
    date,
    slots.length > 0,
  );
  const sheetWx = sheetWeatherSummary(slots, weatherPoints);
  const cardWeather = !sheetWx && !weatherPending;

  const today = todayYmdUtah();
  const days = useMemo(() => {
    const ahead = Math.round((ymdToDate(date).getTime() - ymdToDate(today).getTime()) / 86_400_000);
    const count = Math.min(21, Math.max(7, ahead + 1));
    return Array.from({ length: count }, (_, i) => shiftYmd(today, i));
  }, [date, today]);

  const measureDayPill = useCallback(() => {
    const root = daysRef.current;
    const selectedDay = root?.querySelector<HTMLElement>('.stay-daystrip.is-on');
    if (!root || !selectedDay) return;
    setDayPill({
      left: selectedDay.offsetLeft,
      top: selectedDay.offsetTop,
      width: selectedDay.offsetWidth,
      height: selectedDay.offsetHeight,
    });
    if (!dayPillReady.current) {
      dayPillReady.current = true;
      requestAnimationFrame(() => setDayPillMoves(true));
    }
  }, []);

  useLayoutEffect(() => {
    measureDayPill();
  }, [measureDayPill, date, days]);

  useEffect(() => {
    const root = daysRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => measureDayPill());
    observer.observe(root);
    return () => observer.disconnect();
  }, [measureDayPill]);

  const bookingMode = record ? resolveCourseBookingMode(record) : null;
  const phoneOnly = bookingMode === 'phone';
  const live = bookingMode === 'live' || (catalogLoading && !record);
  const phone = record?.phone_number?.trim() || '';
  const tel = phone ? `tel:${phone.replace(/\D/g, '')}` : null;
  const slotHref = selected
    ? buildBookingUrl(record, {
        dateYmd: date,
        players,
        holes: selected.holes,
        startsAtIso: selected.startsAt,
      })
    : null;
  const genericHref = course?.bookingUrl || record?.booking_url || null;
  const bookHref = phoneOnly ? tel : live ? slotHref : genericHref;
  const bookLabel = phoneOnly ? (phone ? `Call ${phone}` : 'Call the pro shop') : 'Book on the course site';
  const price = selected?.price;
  const total = price != null ? Math.round(price * players) : null;
  const priceSeen = useRef(price);
  useEffect(() => {
    if (priceSeen.current === price) return;
    priceSeen.current = price;
    if (price == null) return;
    setPriceSettle(true);
    const timer = window.setTimeout(() => setPriceSettle(false), 320);
    return () => window.clearTimeout(timer);
  }, [price]);
  const whenLabel = formatDateChip(date);
  const place = course ? [course.city, course.state].filter(Boolean).join(', ') : '';
  const finding = loadingTimes && slots.length === 0;
  const failed = fetchFailed && !loadingTimes && slots.length === 0;
  const about = record?.editorial_note?.trim()
    || record?.history_blurb?.trim()
    || record?.notes?.trim()
    || (!course && !catalogLoading ? 'This course is not in the catalog yet.' : '');
  const windowLine = bookingWindowLine(record?.booking_window_days, record?.booking_opens_time);
  const highlights = buildCourseHighlights(record, courseId);
  const aboutNotes = courseAboutNotes(record, courseId);

  const headerQuery: StaySearchQuery = {
    place: params.get('where')?.trim() || 'Nearby',
    radius: readStayRadius(params.get('radius')),
    date,
    tod,
    players,
    holes,
  };

  function pickSlot(tee: TeeTime) {
    write({ time: tee.startsAt, slot: String(tee.holes) });
  }

  function book() {
    if (!course || !bookHref) return;
    captureEvent('outbound_booking_click', {
      course: course.name,
      course_id: course.id,
      surface: 'course',
      signed_in: Boolean(user?.id),
    });
    noteOutboundBooking(course.id, course.name);
  }

  function goBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1);
      return;
    }
    navigate(`/search?${staySearchQueryString(headerQuery)}`);
  }

  async function share() {
    const url = window.location.href;
    const title = course?.name ?? 'Tee time';
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const bookShort = bookLabel.startsWith('Call') ? 'Call' : 'Book';
  const bookControl = bookHref ? (
    <a className="stay-reserve" href={bookHref} target={phoneOnly ? undefined : '_blank'} rel="noreferrer" aria-label={bookLabel} onClick={book}>
      <span className="stay-reserve-full">{bookLabel}</span>
      <span className="stay-reserve-short">{bookShort}</span>
    </a>
  ) : (
    <button type="button" className="stay-reserve" disabled>
      <span className="stay-reserve-full">{live ? 'Select a time' : 'Course site not linked'}</span>
      <span className="stay-reserve-short">{live ? 'Select a time' : 'No link'}</span>
    </button>
  );

  return (
    <div className="stay is-course">
      <StaySearchHeader
        value={headerQuery}
        pinned
        onSearch={(query) => navigate(`/search?${staySearchQueryString(query)}`)}
        onOpenCourse={(id, query) => navigate(`/course/${id}?${staySearchQueryString(query)}`)}
      />

      <article className="stay-course">
        <div className="stay-course-grid">
          <div>
            <div className="stay-hero-wrap">
              <div className="stay-hero">
                {course?.photoUrl ? <img src={course.photoUrl} alt="" /> : <div className="stay-card-fallback" />}
                <button type="button" className="stay-back" aria-label="Back" onClick={goBack}>
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                    <path d="M15 5L8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className="stay-hero-actions">
                  <button type="button" className="stay-share" aria-label={copied ? 'Link copied' : 'Share'} onClick={() => void share()}>
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                      <path fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 4v10M8 8l4-4 4 4M5 14v5h14v-5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={`stay-heart${saved ? ' is-on' : ''}${pop ? ' is-pop' : ''}`}
                    aria-label={saved ? 'Remove from saved' : 'Save'}
                    onClick={() => {
                      if (!saved) setPop(true);
                      setSaved((on) => !on);
                    }}
                    onAnimationEnd={(event) => {
                      if (event.animationName === 'stay-heart-pop') setPop(false);
                    }}
                  >
                    <Heart on={saved} />
                  </button>
                </div>
                {copied ? <span className="stay-hero-copied">Link copied</span> : null}
              </div>
              {course || !catalogLoading ? (
                <div className="stay-hero-sheet">
                  <h1>{course?.name ?? 'Course'}</h1>
                  {course?.rating != null || place || course?.area ? (
                    <p className="stay-course-sub">
                      {course?.rating != null ? (
                        <button type="button" className="stay-review-jump" onClick={() => document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                          <span className="star-gold" aria-hidden>★</span> {course.rating.toFixed(2)}
                          {course.reviewCount ? ` · ${course.reviewCount.toLocaleString()} reviews` : ''}
                        </button>
                      ) : null}
                      {course?.rating != null && (place || course?.area) ? <span aria-hidden> · </span> : null}
                      {place ? <span>{place}</span> : course?.area ? <span>{course.area}</span> : null}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <CourseHighlights highlights={highlights} />

            {live ? (
              <>
                <div className="stay-divider" />
                <h2>Tee times</h2>
                <div className={`stay-days${dayPillMoves ? ' is-ready' : ''}`} ref={daysRef}>
                  {dayPill ? (
                    <span
                      className="stay-day-pill"
                      style={{ left: dayPill.left, top: dayPill.top, width: dayPill.width, height: dayPill.height }}
                      aria-hidden
                    />
                  ) : null}
                  {days.map((ymd) => {
                    const day = ymdToDate(ymd);
                    return (
                      <button
                        key={ymd}
                        type="button"
                        className={`stay-daystrip${ymd === date ? ' is-on' : ''}`}
                        onClick={() => write({ date: ymd })}
                      >
                        <span className="stay-daystrip-label">
                          <small>{day.toLocaleDateString('en-US', { weekday: 'short' })}</small>
                          {day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="stay-round">
                  <div className="stay-round-group stay-round-time" role="radiogroup" aria-label="Time of day">
                    {TIME_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={tod === option.id}
                        className={`stay-chip${tod === option.id ? ' is-on' : ''}`}
                        onClick={() => write({ tod: option.id === 'any' ? null : option.id })}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="stay-round-group">
                    <span className="stay-round-k">Players</span>
                    <span className="stay-guest-step">
                      <button type="button" disabled={players <= 1} onClick={() => write({ players: String(players - 1) })} aria-label="Fewer players">–</button>
                      <span>{players}</span>
                      <button type="button" disabled={players >= 4} onClick={() => write({ players: String(players + 1) })} aria-label="More players">+</button>
                    </span>
                  </div>
                  <div className="stay-round-group" role="radiogroup" aria-label="Holes">
                    {holesLocked ? (
                      <span className="stay-round-note">9 holes</span>
                    ) : (
                      ([9, 18, 'any'] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          role="radio"
                          aria-checked={holes === option}
                          className={`stay-chip${holes === option ? ' is-on' : ''}`}
                          onClick={() => write({ holes: String(option) })}
                        >
                          {option === 'any' ? 'Any holes' : `${option} holes`}
                        </button>
                      ))
                    )}
                  </div>
                </div>
                {windowLine ? <p className="stay-window">{windowLine}</p> : null}
                {sheetWx ? (
                  <p className={`stay-sheet-wx stay-sheet-wx--${sheetWx.kind}`}>
                    <WeatherGlyph precipProb={sheetWx.precip} />
                    <span>{sheetWx.label}</span>
                  </p>
                ) : weatherPending && slots.length > 0 ? (
                  <p className="stay-sheet-wx is-pending" aria-hidden>
                    <span className="skeleton-shimmer" />
                  </p>
                ) : null}
                {finding ? (
                  <div className="stay-sheet-slots" aria-busy="true" aria-label="Loading tee times">
                    {Array.from({ length: 6 }, (_, i) => (
                      <div
                        key={i}
                        className="tee-slot-card tee-slot-card--skeleton"
                        style={{ opacity: 1 - i * 0.06 }}
                      />
                    ))}
                  </div>
                ) : null}
                {failed ? (
                  <div className="stay-sheet-empty">
                    <p>Could not load tee times.</p>
                    <button type="button" className="stay-chip" onClick={() => setRefreshNonce((n) => n + 1)}>Retry</button>
                  </div>
                ) : null}
                {!finding && !failed && slots.length === 0 ? (
                  <div className="stay-sheet-empty">
                    <p>{emptyTimesCopy(tod, date)}</p>
                    <div className="stay-sheet-filters">
                      <button type="button" className="stay-chip" onClick={() => setAlertOpen(true)}>Alert me</button>
                      {tod !== 'any' ? (
                        <button type="button" className="stay-chip" onClick={() => write({ tod: null })}>Anytime</button>
                      ) : null}
                      <button type="button" className="stay-chip" onClick={() => write({ date: shiftYmd(date, 1) })}>Try tomorrow</button>
                    </div>
                  </div>
                ) : null}
                {shown.length > 0 ? (
                  <div className="stay-sheet-slots">
                    {shown.map((tee, index) => (
                      <TeeSlotCard
                        key={`${tee.id}-${tee.holes}`}
                        riseDelay={(index < SLOT_PREVIEW ? index : Math.min(index - SLOT_PREVIEW, 8)) * 22}
                        startsAt={tee.startsAt}
                        timeZone={tz}
                        price={tee.price}
                        spots={tee.spots}
                        holes={tee.holes}
                        emphasizeHoles={mixedLengths}
                        showWeather={cardWeather}
                        showMeta={false}
                        reopenedAt={tee.reopenedAt}
                        weatherPoints={cardWeather ? weatherPoints : null}
                        weatherPending={cardWeather && weatherPending}
                        selected={selected != null && tee.startsAt === selected.startsAt && tee.holes === selected.holes}
                        onClick={() => pickSlot(tee)}
                      />
                    ))}
                  </div>
                ) : null}
                <div className="stay-sheet-foot">
                  {hiddenCount > 0 ? (
                    <button type="button" className="stay-chip stay-sheet-more" onClick={() => setExpanded(true)}>
                      Show {hiddenCount} more
                    </button>
                  ) : null}
                  {expanded && slots.length > SLOT_PREVIEW ? (
                    <button type="button" className="stay-chip stay-sheet-more" onClick={() => setExpanded(false)}>
                      Show fewer times
                    </button>
                  ) : null}
                  <button type="button" className="stay-alert-link" onClick={() => setAlertOpen(true)}>
                    Want an earlier time? Get the alert.
                  </button>
                </div>
              </>
            ) : course ? (
              <>
                <div className="stay-divider" />
                <h2>How to book</h2>
                <p className="stay-about">
                  {phoneOnly
                    ? 'This course takes tee times by phone. Call the pro shop to reserve.'
                    : 'Tee times for this course are booked on the course site.'}
                </p>
                {windowLine ? <p className="stay-window">{windowLine}</p> : null}
              </>
            ) : null}

            {course || !catalogLoading ? (
            <>
            <div className="stay-divider" />
            <h2>About this course</h2>
            {about ? <p className="stay-about">{about}</p> : null}
            {(record?.address || course || phone || record?.website || aboutNotes.scores || aboutNotes.amenities || record?.signature_hole || record?.cancellation_policy) ? (
            <div className="stay-about-practical">
              {record?.address || course ? (
                <p className="stay-about-line">
                  {record?.address ? <span>{record.address}</span> : null}
                  {course ? (
                    <GetDirectionsButton course={course} className="stay-text-link">Get directions</GetDirectionsButton>
                  ) : null}
                </p>
              ) : null}
              {phone || record?.website ? (
                <p className="stay-about-links">
                  {phone && tel ? <a className="stay-text-link" href={tel}>{phone}</a> : null}
                  {record?.website ? (
                    <a className="stay-text-link" href={record.website} target="_blank" rel="noreferrer">Course site</a>
                  ) : null}
                </p>
              ) : null}
              {aboutNotes.scores ? <p className="stay-about-facts">{aboutNotes.scores}</p> : null}
              {aboutNotes.amenities ? <p className="stay-about-facts">{aboutNotes.amenities}</p> : null}
              {record?.signature_hole ? <p className="stay-about-facts">Signature hole · {record.signature_hole}</p> : null}
              {record?.cancellation_policy ? <p className="stay-about-facts">{record.cancellation_policy}</p> : null}
            </div>
            ) : null}
            {course ? (
              <div id="reviews">
                <div className="stay-divider" />
                <h2>Reviews</h2>
                {course.rating != null ? (
                  <p className="stay-about">
                    Google rating {course.rating.toFixed(1)}
                    {course.reviewCount ? ` · ${course.reviewCount.toLocaleString()} reviews` : ''}
                  </p>
                ) : null}
                <a className="stay-text-link" href={googleMapsPlaceUrl(course)} target="_blank" rel="noreferrer">
                  Read reviews on Google Maps
                </a>
              </div>
            ) : null}
            </>
            ) : null}
          </div>

          <aside className="stay-book">
            <div className={`stay-book-price${priceSettle ? ' is-settle' : ''}`}>
              {price != null ? <>${Math.round(price)} <span>per player</span></> : <span>Select a time</span>}
            </div>
            <p className="stay-book-when">
              <span>{whenLabel}</span>
              {tod !== 'any' ? <span>{todWord(tod)}</span> : null}
              {selected ? <span>{formatTime12h(selected.startsAt, tz)}</span> : null}
              <span>{players} {players === 1 ? 'player' : 'players'}</span>
              {roundHoles ? <span>{roundHoles} holes</span> : null}
            </p>
            <div className="stay-book-box">
              <div className="stay-book-row">
                <div className="stay-book-cell">
                  <label>Date</label>
                  {whenLabel}
                </div>
                <div className="stay-book-cell">
                  <label>Tee time</label>
                  {selected ? formatTime12h(selected.startsAt, tz) : '—'}
                </div>
              </div>
              <div className="stay-book-players">
                <div>
                  <label>Players</label>
                  {players}
                </div>
                <span className="stay-stepper">
                  <button type="button" disabled={players <= 1} onClick={() => write({ players: String(players - 1) })} aria-label="Fewer players">–</button>
                  <button type="button" disabled={players >= 4} onClick={() => write({ players: String(players + 1) })} aria-label="More players">+</button>
                </span>
              </div>
            </div>
            {bookControl}
            <p className="stay-book-note">No fee from us. You pay the course directly.</p>
            <div className="stay-book-lines">
              <div><span>Tee-Time fee</span><span>$0</span></div>
              <div className={`is-total${priceSettle ? ' is-settle' : ''}`}><span>At the course</span><span>{total != null ? `$${total}` : '—'}</span></div>
            </div>
            <Link className="stay-save" to="/plan">Send to your foursome for a vote</Link>
          </aside>
        </div>
      </article>
      <SiteFooter />
      {course ? (
        <NotificationModal
          open={alertOpen}
          onClose={() => setAlertOpen(false)}
          course={course}
          defaultDate={date}
          defaultPlayers={players}
          defaultTimeOfDay={tod}
        />
      ) : null}
    </div>
  );
}
