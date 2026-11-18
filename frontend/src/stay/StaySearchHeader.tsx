import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { formatCityState } from '../lib/courseRecord';
import type { HolesFilter } from '../lib/holesFilter';
import { formatDateChip, formatDateCompact } from '../lib/time';
import { courseMatchesLocationQuery } from '../lib/timesFetchScope';
import { extractZip } from '../lib/zipSearch';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import type { Course, TimeOfDayPreset } from '../types';
import { StayAccount, StayPrimaryNav, usePhoneLayout } from './StayHeader';
import { StayLogo } from './StayLogo';
import { nextSaturday, toYmd } from './stayTimes';
import { startOfDay, weekendSpan, WhenPanel } from './WhenPanel';

export type StayRadius = 15 | 25 | 50 | 'all';

export type StaySearchQuery = {
  place: string;
  radius: StayRadius;
  date: string | null;
  tod: TimeOfDayPreset;
  players: 1 | 2 | 3 | 4 | null;
  holes: HolesFilter;
};

type Seg = 'where' | 'when' | 'who' | null;
type Field = Exclude<Seg, null>;
type Pill = { left: number; width: number; on: boolean; move: boolean };
type PlaceOption = { name: string; note: string; tint: string };

const restingPill: Pill = { left: 0, width: 0, on: false, move: false };

const PLACES: PlaceOption[] = [
  { name: 'Nearby', note: 'Courses around you', tint: 'sky' },
  { name: 'Salt Lake City', note: 'City and valley courses', tint: 'pine' },
  { name: 'St. George', note: 'Red-rock and desert golf', tint: 'clay' },
  { name: 'Phoenix', note: 'Desert and resort courses', tint: 'rose' },
  { name: 'Scottsdale', note: 'Resort golf', tint: 'lilac' },
  { name: 'San Diego', note: 'Coastal courses', tint: 'tide' },
  { name: 'Denver', note: 'City and foothill courses', tint: 'fair' },
  { name: 'Boise', note: 'Valley courses', tint: 'sand' },
];

export function readStayRadius(raw: string | null): StayRadius {
  if (raw === 'all') return 'all';
  if (raw === '15') return 15;
  if (raw === '50') return 50;
  return 25;
}

export function staySearchQueryString(query: StaySearchQuery) {
  const q = new URLSearchParams();
  if (query.place && query.place !== 'Nearby') q.set('where', query.place);
  if (query.date) q.set('date', query.date);
  if (query.tod !== 'any') q.set('tod', query.tod);
  if (query.players) q.set('players', String(query.players));
  if (query.holes !== 'any') q.set('holes', String(query.holes));
  if (query.radius === 'all') q.set('radius', 'all');
  else if (query.radius !== 25) q.set('radius', String(query.radius));
  return q.toString();
}

function suggestWhere(draft: string, courses: Course[]) {
  const q = draft.trim();
  if (!q) return { places: PLACES, courses: [] as Course[], zip: null as string | null };
  const norm = q.toLowerCase();
  const featured = PLACES.filter((spot) => spot.name.toLowerCase().includes(norm));
  const seen = new Set(featured.map((spot) => spot.name.toLowerCase()));
  const cities: PlaceOption[] = [];
  for (const course of courses) {
    const city = course.city?.trim();
    if (!city) continue;
    const title = formatCityState(city, course.state);
    const key = title.toLowerCase();
    if (seen.has(key) || isGenericCity(city)) continue;
    if (!key.includes(norm) && !city.toLowerCase().includes(norm)) continue;
    seen.add(key);
    cities.push({ name: title, note: 'City courses', tint: 'pine' });
  }
  cities.sort((a, b) => {
    const rank = (name: string) => (name.toLowerCase().startsWith(norm) ? 0 : 1);
    return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
  });
  const zip = extractZip(q);
  return {
    places: [...featured, ...cities].slice(0, 8),
    courses: courses.filter((course) => courseMatchesLocationQuery(course, q)).slice(0, 6),
    zip: zip === q ? zip : null,
  };
}

function isGenericCity(city: string) {
  const name = city.toLowerCase().replace(/\./g, '').trim();
  return !name || name === 'utah' || name === 'idaho' || name === 'wy' || name === 'wyoming';
}

function todLabel(tod: TimeOfDayPreset) {
  if (tod === 'morning') return 'Morning';
  if (tod === 'afternoon') return 'Afternoon';
  if (tod === 'evening') return 'Twilight';
  return 'Any time';
}

export function staySearchLabels(
  search: StaySearchQuery,
  empty: { where: string; when: string; who: string },
  dense = false,
) {
  const where = !search.place
    ? empty.where
    : search.place === 'Nearby'
      ? search.radius === 'all'
        ? 'Statewide'
        : `Nearby · ${search.radius} mi`
      : search.place;
  const date = search.date ? (dense ? formatDateCompact(search.date) : formatDateChip(search.date)) : '';
  const when = !search.date
    ? search.tod === 'any'
      ? empty.when
      : todLabel(search.tod)
    : search.tod === 'any'
      ? date
      : `${date} · ${todLabel(search.tod)}`;
  const who = [
    search.players ? `${search.players} ${search.players === 1 ? 'player' : 'players'}` : '',
    search.holes === 'any' ? '' : `${search.holes} holes`,
  ].filter(Boolean).join(' · ') || empty.who;
  return { where, when, who };
}

function phoneSummary(search: StaySearchQuery) {
  const labels = staySearchLabels(search, { where: '', when: '', who: '' }, true);
  const place = search.place ? labels.where : '';
  const detail = [
    search.date || search.tod !== 'any' ? labels.when : '',
    search.players || search.holes !== 'any' ? labels.who : '',
  ].filter(Boolean).join(' · ');
  return { place, detail };
}

function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path fill="none" stroke="currentColor" strokeWidth="4" d="M13 24a11 11 0 1 0 0-22 11 11 0 0 0 0 22zm8-3 8 8" />
    </svg>
  );
}

function PlaceGlyph({ name }: { name: string }) {
  if (name === 'Nearby') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <path fill="currentColor" d="M12 2.5 14.2 9H21l-5.5 4 2.1 6.5L12 15.6 6.4 19.5 8.5 13 3 9h6.8L12 2.5z" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M12 2.2a7 7 0 0 0-7 7c0 5.1 7 12.6 7 12.6s7-7.5 7-12.6a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}

export function StaySearchHeader({
  value,
  pinned,
  onSearch,
  onOpenCourse,
  queryRef,
  editRequest,
}: {
  value: StaySearchQuery;
  /** Resting state is the minimized pill, as on search results. */
  pinned: boolean;
  onSearch: (query: StaySearchQuery) => void;
  onOpenCourse: (courseId: string, query: StaySearchQuery) => void;
  /** Latest in-progress search, so the rest of the page can reuse it. */
  queryRef?: MutableRefObject<StaySearchQuery | null>;
  /** Open When or Who. A new `n` reopens that step even if it was already open. */
  editRequest?: { seg: 'when' | 'who'; n: number } | null;
}) {
  const { courses } = useCourseCatalog();
  const phone = usePhoneLayout();
  const [compact, setCompact] = useState(pinned);
  const [seg, setSeg] = useState<Seg>(null);
  const [place, setPlace] = useState(value.place);
  const [radiusMi, setRadiusMi] = useState<StayRadius>(value.radius);
  const [whereDraft, setWhereDraft] = useState('');
  const [whereTyping, setWhereTyping] = useState(false);
  const [playYmd, setPlayYmd] = useState<string | null>(value.date);
  const [tod, setTod] = useState<TimeOfDayPreset>(value.tod);
  const [players, setPlayers] = useState<1 | 2 | 3 | 4 | null>(value.players);
  const [holes, setHoles] = useState<HolesFilter>(value.holes);
  const today = useMemo(() => startOfDay(), []);
  const tomorrow = useMemo(() => {
    const next = new Date(today);
    next.setDate(next.getDate() + 1);
    return next;
  }, [today]);
  const weekend = useMemo(() => weekendSpan(today), [today]);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [thumb, setThumb] = useState<Pill>(restingPill);
  const [thumbMove, setThumbMove] = useState(false);
  const [hot, setHot] = useState<Pill>(restingPill);
  const [ghost, setGhost] = useState<Field | null>(null);
  const [risen, setRisen] = useState(false);

  const compactRef = useRef(pinned);
  const expandLock = useRef(false);
  const headRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const sheetStackRef = useRef<HTMLDivElement>(null);
  const segRefs = useRef<Partial<Record<Field, HTMLElement>>>({});
  const whereInputRef = useRef<HTMLInputElement>(null);
  const hotId = useRef<Field | null>(null);
  const segRef = useRef<Seg>(null);
  segRef.current = seg;
  const editSeen = useRef(0);

  const valueRef = useRef(value);
  valueRef.current = value;
  const valueKey = `${value.place}|${value.radius}|${value.date ?? ''}|${value.tod}|${value.players ?? ''}|${value.holes}`;
  const draftSearch: StaySearchQuery = { place, radius: radiusMi, date: playYmd, tod, players, holes };
  if (queryRef) queryRef.current = draftSearch;
  const barSearch = compact ? value : draftSearch;
  const barLabels = staySearchLabels(
    barSearch,
    compact
      ? { where: 'Anywhere', when: 'Anytime', who: 'Any players' }
      : { where: 'Search destinations', when: 'Add dates', who: 'Add players' },
    compact,
  );

  const measure = (id: Field) => {
    const el = segRefs.current[id];
    if (!el) return null;
    return { left: el.offsetLeft, width: el.offsetWidth };
  };

  useEffect(() => {
    if (segRef.current) return;
    const next = valueRef.current;
    setPlace(next.place);
    setRadiusMi(next.radius);
    setPlayYmd(next.date);
    setTod(next.tod);
    setPlayers(next.players);
    setHoles(next.holes);
  }, [valueKey]);

  useEffect(() => {
    if (!seg) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const bar = headRef.current?.querySelector('.stay-wide');
      const pop = headRef.current?.querySelector('.stay-pop');
      const sheet = headRef.current?.querySelector('.stay-sheet');
      const pill = headRef.current?.querySelector('.stay-phone-pill');
      if (bar?.contains(target) || pop?.contains(target) || sheet?.contains(target) || pill?.contains(target)) return;
      if (target instanceof Element && target.closest('.stay-filters')) return;
      settleSearch();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settleSearch();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [seg]);

  useEffect(() => {
    if (!editRequest || editSeen.current === editRequest.n) return;
    editSeen.current = editRequest.n;
    if (!phone) {
      expandLock.current = true;
      compactRef.current = false;
      setCompact(false);
    }
    setSeg(editRequest.seg);
  }, [editRequest, phone]);

  useEffect(() => {
    if (!seg) {
      setRisen(false);
      const hide = window.setTimeout(() => setGhost(null), 340);
      return () => window.clearTimeout(hide);
    }
    setGhost(seg);
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setRisen(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [seg]);

  useLayoutEffect(() => {
    const el = sheetStackRef.current;
    if (!el) return;
    const fit = () => {
      el.style.setProperty('--stay-open', `${Math.max(64, el.clientHeight - 152)}px`);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  });

  useLayoutEffect(() => {
    if (!seg) {
      setThumb((pill) => ({ ...pill, on: false }));
      setThumbMove(false);
      setHot((pill) => ({ ...pill, on: false }));
      return;
    }
    const box = measure(seg);
    if (!box) return;
    setThumb((pill) => ({ ...box, on: true, move: pill.move }));
  }, [seg, compact]);

  useEffect(() => {
    if (!thumb.on) return;
    const id = requestAnimationFrame(() => setThumbMove(true));
    return () => cancelAnimationFrame(id);
  }, [thumb.on]);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const watch = new ResizeObserver(() => {
      if (seg) {
        const box = measure(seg);
        if (box) setThumb((pill) => (pill.on ? { ...pill, ...box } : pill));
      }
      if (hotId.current) {
        const box = measure(hotId.current);
        if (box) setHot((pill) => (pill.on ? { ...pill, ...box } : pill));
      }
    });
    watch.observe(bar);
    return () => watch.disconnect();
  }, [seg]);

  useEffect(() => {
    const onScroll = () => {
      if (pinned) return;
      const y = window.scrollY;
      if (expandLock.current) {
        if (y <= 8) expandLock.current = false;
        else return;
      }
      const was = compactRef.current;
      const next = was ? y > 8 : y > 64;
      if (next === was) return;
      compactRef.current = next;
      setCompact(next);
      if (next) setSeg(null);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pinned]);

  const whereSuggestions = useMemo(
    () => suggestWhere(whereTyping ? whereDraft : '', courses),
    [whereTyping, whereDraft, courses],
  );

  function settleSearch() {
    setSeg(null);
    if (!pinned && window.scrollY <= 64) {
      expandLock.current = false;
      return;
    }
    expandLock.current = false;
    compactRef.current = true;
    setCompact(true);
  }

  function expandInPlace(id: Field | null) {
    expandLock.current = true;
    compactRef.current = false;
    setCompact(false);
    if (!id) return;
    if (id === 'where') {
      setWhereDraft(place || '');
      setWhereTyping(false);
    }
    setSeg(id);
  }

  function choosePlace(name: string) {
    setPlace(name);
    setWhereDraft(name);
    setWhereTyping(false);
    setSeg('when');
  }

  function openSeg(next: Seg) {
    if (seg === next) {
      settleSearch();
      return;
    }
    if (seg === 'where' && next !== 'where') {
      const raw = whereDraft.trim();
      if (raw) setPlace(/^near(by| me)?$/i.test(raw) ? 'Nearby' : raw);
    }
    if (next === 'where') {
      setWhereDraft(place || '');
      setWhereTyping(false);
    }
    setSeg(next);
  }

  function draftQuery(whereText?: string): StaySearchQuery {
    const raw = (whereText ?? place).trim();
    const nextPlace = !raw || /^near(by| me)?$/i.test(raw) ? 'Nearby' : raw;
    return { place: nextPlace, radius: radiusMi, date: playYmd, tod, players, holes };
  }

  function commitSearch(whereText?: string) {
    const draft = draftQuery(whereText);
    const query = { ...draft, date: draft.date ?? toYmd(nextSaturday()) };
    setPlace(query.place);
    setPlayYmd(query.date);
    setWhereDraft(query.place);
    setWhereTyping(false);
    onSearch(query);
    expandLock.current = false;
    compactRef.current = true;
    setCompact(true);
    setSeg(null);
  }

  function openPhoneSheet() {
    setWhereDraft(place && place !== 'Nearby' ? place : '');
    setWhereTyping(false);
    setSeg('where');
  }

  function sheetAdvance() {
    if (seg === 'where') {
      const raw = whereDraft.trim();
      if (raw) setPlace(/^near(by| me)?$/i.test(raw) ? 'Nearby' : raw);
      setSeg('when');
      return;
    }
    if (seg === 'when') {
      setSeg('who');
      return;
    }
    commitSearch();
  }

  function clearSheet() {
    setPlace('');
    setRadiusMi(25);
    setWhereDraft('');
    setWhereTyping(false);
    setPlayYmd(null);
    setTod('any');
    setPlayers(null);
    setHoles('any');
    setSeg('where');
  }

  function trackHot(id: Field) {
    if (compact || !seg || id === seg) {
      hotId.current = null;
      setHot((pill) => ({ ...pill, on: false }));
      return;
    }
    const box = measure(id);
    if (!box) return;
    hotId.current = id;
    setHot((pill) => ({ ...box, on: true, move: pill.on }));
  }

  function clearHot() {
    hotId.current = null;
    setHot((pill) => ({ ...pill, on: false }));
  }

  useEffect(() => {
    if (seg !== 'where') return;
    const input = whereInputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [seg]);

  useEffect(() => {
    if (!phone || !seg) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('is-stay-sheet');
    return () => {
      document.body.style.overflow = previous;
      document.body.classList.remove('is-stay-sheet');
    };
  }, [phone, seg]);

  const shown = seg ?? ghost;
  const phoneLine = phone ? phoneSummary(barSearch) : null;
  const sheetLabels = staySearchLabels(
    draftSearch,
    { where: 'Search courses', when: 'Add a date', who: 'Add players' },
    true,
  );

  function renderField(id: Field) {
    if (id === 'where') {
      return (
        <div className="stay-places">
          {phone ? (
            <input
              ref={whereInputRef}
              className="stay-sheet-where"
              value={whereDraft}
              placeholder="City, ZIP, or course"
              aria-label="Search by city, ZIP, or course"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              onChange={(event) => {
                setWhereDraft(event.target.value);
                setWhereTyping(true);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                commitSearch(whereDraft);
              }}
            />
          ) : null}
          <div className="stay-radius" role="radiogroup" aria-label="Distance">
            <div className="stay-radius-label">Within</div>
            <div className="stay-radius-row">
              {([15, 25, 50] as const).map((mi) => (
                <button
                  key={mi}
                  type="button"
                  role="radio"
                  aria-checked={radiusMi === mi}
                  className={`stay-radius-chip${radiusMi === mi ? ' is-on' : ''}`}
                  onClick={() => setRadiusMi(mi)}
                >
                  {mi} mi
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={radiusMi === 'all'}
                className={`stay-radius-chip${radiusMi === 'all' ? ' is-on' : ''}`}
                onClick={() => setRadiusMi('all')}
              >
                Statewide
              </button>
            </div>
          </div>
          {whereSuggestions.places.map((spot) => (
            <button
              key={spot.name}
              type="button"
              className="stay-place"
              onClick={() => choosePlace(spot.name)}
            >
              <span className={`stay-place-mark is-${spot.tint}`} aria-hidden>
                <PlaceGlyph name={spot.name} />
              </span>
              <span className="stay-place-copy">
                <span className="stay-place-name">{spot.name}</span>
                <span className="stay-place-note">
                  {spot.name === 'Nearby'
                    ? radiusMi === 'all'
                      ? 'All courses'
                      : `Courses within ${radiusMi} miles`
                    : spot.note}
                </span>
              </span>
            </button>
          ))}
          {whereSuggestions.zip ? (
            <button
              type="button"
              className="stay-place"
              onClick={() => choosePlace(whereSuggestions.zip!)}
            >
              <span className="stay-place-mark is-tide" aria-hidden><PlaceGlyph name="zip" /></span>
              <span className="stay-place-copy">
                <span className="stay-place-name">{whereSuggestions.zip}</span>
                <span className="stay-place-note">Courses near this ZIP</span>
              </span>
            </button>
          ) : null}
          {whereSuggestions.courses.length > 0 ? <div className="stay-suggest-label">Courses</div> : null}
          {whereSuggestions.courses.map((course) => (
            <button
              key={course.id}
              type="button"
              className="stay-place"
              onClick={() => {
                onOpenCourse(course.id, draftQuery());
                setSeg(null);
              }}
            >
              <span className="stay-place-mark is-sand" aria-hidden><PlaceGlyph name="course" /></span>
              <span>
                <span className="stay-place-name">{course.name}</span>
                <span className="stay-place-note">{formatCityState(course.city, course.state) || course.area || 'Golf course'}</span>
              </span>
            </button>
          ))}
          {whereDraft.trim() && whereSuggestions.places.length === 0 && !whereSuggestions.zip && whereSuggestions.courses.length === 0 ? (
            <p className="stay-where-empty">No courses or cities match “{whereDraft.trim()}”.</p>
          ) : null}
        </div>
      );
    }
    if (id === 'when') {
      return (
        <WhenPanel
          today={today}
          tomorrow={tomorrow}
          weekend={weekend}
          playYmd={playYmd}
          tod={tod}
          cursor={cursor}
          onCursor={setCursor}
          onPick={setPlayYmd}
          onTod={setTod}
        />
      );
    }
    return (
      <div className="stay-who">
        <div className="stay-guest">
          <div>
            <div className="stay-guest-k">Players</div>
            <div className="stay-guest-n">In your group</div>
          </div>
          <div className="stay-guest-step">
            <button type="button" disabled={!players} onClick={() => setPlayers((n) => (n && n > 1 ? ((n - 1) as 1 | 2 | 3 | 4) : null))} aria-label="Fewer players">–</button>
            <span>{players ?? 0}</span>
            <button type="button" disabled={players != null && players >= 4} onClick={() => setPlayers((n) => (n ? ((n + 1) as 1 | 2 | 3 | 4) : 1))} aria-label="More players">+</button>
          </div>
        </div>
        <div className="stay-guest stay-holes">
          <div>
            <div className="stay-guest-k">Holes</div>
            <div className="stay-guest-n">Length of the round</div>
          </div>
          <div className="stay-holes-row" role="radiogroup" aria-label="Holes">
            {([9, 18, 'any'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={holes === option}
                className={`stay-holes-chip${holes === option ? ' is-on' : ''}`}
                onClick={() => setHoles(option)}
              >
                {option === 'any' ? 'Any' : option}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <header ref={headRef} className={`stay-header${compact ? ' is-compact' : ''}${phone && seg ? ' is-sheet' : ''}`}>
      <div className="stay-top">
        <StayLogo />
        {phone ? (
          <button type="button" className="stay-phone-pill" onClick={openPhoneSheet}>
            {phoneLine?.place ? null : <SearchIcon size={16} />}
            <span className="stay-phone-copy">
              <span className="stay-phone-place">{phoneLine?.place || 'Find tee times'}</span>
              {phoneLine?.detail ? <span className="stay-phone-meta">{phoneLine.detail}</span> : null}
            </span>
          </button>
        ) : (
          <nav className="stay-top-center" aria-label="Primary" aria-hidden={compact || undefined}>
            <StayPrimaryNav />
          </nav>
        )}
        <StayAccount />
      </div>
      <div className="stay-wide-wrap" />
      <div
        ref={barRef}
        className={`stay-wide${seg ? ' is-open' : ''}`}
        onMouseLeave={clearHot}
        onClick={(event) => {
          if (compact) {
            expandInPlace(null);
            return;
          }
          if (event.target === event.currentTarget) settleSearch();
        }}
      >
        <span className={`stay-hot${hot.on ? ' is-on' : ''}${hot.move ? ' is-move' : ''}`} style={{ width: hot.width, transform: `translateX(${hot.left}px)` }} aria-hidden />
        <span className={`stay-thumb${thumb.on ? ' is-on' : ''}${thumbMove ? ' is-move' : ''}`} style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }} aria-hidden />
        {(['where', 'when', 'who'] as const).map((id) => (
          id === 'where' && seg === 'where' ? (
            <div
              key="where"
              ref={(node) => { segRefs.current.where = node ?? undefined; }}
              className="stay-seg is-open"
              onMouseEnter={() => trackHot('where')}
            >
              <span className="stay-seg-k">Where</span>
              <input
                ref={phone ? undefined : whereInputRef}
                className="stay-seg-input"
                value={whereDraft}
                placeholder="City, ZIP, or course"
                aria-label="Search by city, ZIP, or course"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="search"
                onChange={(event) => {
                  setWhereDraft(event.target.value);
                  setWhereTyping(true);
                }}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  commitSearch(whereDraft);
                }}
              />
            </div>
          ) : (
            <button
              key={id}
              type="button"
              ref={(node) => { segRefs.current[id] = node ?? undefined; }}
              className={`stay-seg${seg === id ? ' is-open' : ''}`}
              aria-expanded={seg === id}
              onMouseEnter={() => trackHot(id)}
              onClick={(event) => {
                event.stopPropagation();
                if (compact) expandInPlace(id);
                else openSeg(id);
              }}
            >
              <span className="stay-seg-k">{id === 'where' ? 'Where' : id === 'when' ? 'When' : 'Who'}</span>
              <span className={`stay-seg-v${(id === 'where' ? !barSearch.place : id === 'when' ? !barSearch.date && barSearch.tod === 'any' : !barSearch.players && barSearch.holes === 'any') ? ' is-empty' : ''}`}>
                {id === 'where' ? barLabels.where : id === 'when' ? barLabels.when : barLabels.who}
              </span>
            </button>
          )
        ))}
        <button
          type="button"
          className="stay-go"
          aria-label={compact ? 'Edit search' : 'Search'}
          onMouseEnter={clearHot}
          onClick={(event) => {
            event.stopPropagation();
            if (compact) {
              expandInPlace(null);
              return;
            }
            commitSearch(seg === 'where' ? whereDraft : undefined);
          }}
        >
          <SearchIcon size={compact ? 14 : 16} />
          <span className="stay-go-label">Search</span>
        </button>
      </div>
      {phone && shown ? (
        <div className={`stay-sheet${risen && seg ? ' is-on' : ''}`} role="dialog" aria-label="Search">
          <button type="button" className="stay-sheet-scrim" aria-label="Close search" onClick={settleSearch} />
          <div className="stay-sheet-top">
            <button type="button" className="stay-sheet-x" aria-label="Close" onClick={settleSearch}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="stay-sheet-stack" ref={sheetStackRef}>
            {(['where', 'when', 'who'] as const).map((id) => {
              const open = shown === id;
              const label = id === 'where' ? 'Where' : id === 'when' ? 'When' : 'Who';
              const value = id === 'where' ? sheetLabels.where : id === 'when' ? sheetLabels.when : sheetLabels.who;
              return (
                <section key={id} className={`stay-sheet-card${open ? ' is-open' : ''}`}>
                  <button type="button" className="stay-sheet-row" aria-expanded={open} onClick={() => openSeg(id)}>
                    <span className="stay-sheet-k">{label}</span>
                    <span className="stay-sheet-v">{value}</span>
                  </button>
                  <div className="stay-sheet-expand">
                    <h2 className="stay-sheet-title">{label}?</h2>
                    {renderField(id)}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="stay-sheet-foot">
            {shown === 'when' ? (
              <button
                type="button"
                className="stay-sheet-reset"
                disabled={!playYmd && tod === 'any'}
                onClick={() => {
                  setPlayYmd(null);
                  setTod('any');
                }}
              >
                Reset
              </button>
            ) : (
              <button type="button" className="stay-sheet-clear" onClick={clearSheet}>Clear all</button>
            )}
            {shown === 'when' ? (
              <button type="button" className="stay-sheet-next is-forward" disabled={!playYmd} onClick={() => setSeg('who')}>
                Next
              </button>
            ) : (
              <button type="button" className="stay-sheet-next" onClick={() => commitSearch(seg === 'where' ? whereDraft : undefined)}>
                <SearchIcon size={16} />
                Search
              </button>
            )}
          </div>
        </div>
      ) : shown ? (
        <div className={`stay-pop is-${shown}${risen && seg ? ' is-on' : ''}`} role="dialog" aria-label={shown === 'where' ? 'Where' : shown === 'when' ? 'When' : 'Who'}>
          <div className="stay-pop-body" key={shown}>
            {renderField(shown)}
          </div>
          <div className="stay-search-foot">
            {seg && seg !== 'where' ? (
              <button type="button" className="stay-sheet-back" onClick={() => setSeg(seg === 'who' ? 'when' : 'where')}>
                Back
              </button>
            ) : (
              <button type="button" className="stay-sheet-back" onClick={settleSearch}>Close</button>
            )}
            <button type="button" className="stay-sheet-next" onClick={sheetAdvance}>
              {seg === 'who' ? 'Search' : 'Next'}
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
