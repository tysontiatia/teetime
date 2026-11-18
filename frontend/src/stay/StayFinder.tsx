import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { bookingRelease, type BookingRelease } from '../lib/bookingWindow';
import { type CourseRecord } from '../lib/courseRecord';
import { DEFAULT_TEE_TIMEZONE } from '../lib/teeTimeInstant';
import type { HolesFilter } from '../lib/holesFilter';
import { formatDateChip, formatDateCompact, todayYmd } from '../lib/time';
import { buildTimesFetchScope, courseMatchesLocationQuery, distanceFromAnchor, filterCoursesWithinRadius, resolvePlaceAnchor, WASATCH_FRONT_ANCHOR } from '../lib/timesFetchScope';
import { FinderMap } from '../components/FinderMap';
import { SiteFooter } from '../components/SiteFooter';
import { PlanIcon } from '../components/icons/AppIcons';
import { TeeSlotCard } from '../components/TeeSlotCard';
import { useTimesByCourseMap } from '../hooks/useTimesByCourseMap';
import { courseInMapBounds, type MapBounds } from '../lib/mapBounds';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import type { Course, TeeTime, TimeOfDayPreset } from '../types';
import { StaySearchHeader, staySearchQueryString, type StaySearchQuery } from './StaySearchHeader';
import {
  buildHomeRows,
  comingSaturdayYmd,
  defaultBrowseId,
  homeFetchCourses,
  ymdForBrowse,
  type HomeSearch,
} from './homeBrowse';
import { nextSaturday, summarizeSlots, toYmd, visibleSlots, ymdToDate, type SlotSummary } from './stayTimes';
import { usePollerSnapshots } from './usePollerSnapshots';
import './stay.css';

type StayRadius = 15 | 25 | 50 | 'all';

function readRadius(raw: string | null): StayRadius {
  if (raw === 'all') return 'all';
  if (raw === '15') return 15;
  if (raw === '50') return 50;
  return 25;
}

function readHoles(raw: string | null): HolesFilter {
  if (raw === '9') return 9;
  if (raw === '18') return 18;
  return 'any';
}

function takeSearchCourses(list: Course[], radius: StayRadius, anchor: { lat: number; lng: number; source: 'gps' | 'default' }): Course[] {
  const sorted = [...list].sort(
    (a, b) => (distanceFromAnchor(a, anchor) ?? 999) - (distanceFromAnchor(b, anchor) ?? 999),
  );
  if (radius !== 'all') {
    const cap = radius === 15 ? 24 : radius === 25 ? 32 : 40;
    return sorted.slice(0, cap);
  }
  const home = sorted.filter((course) => course.state === 'UT' || course.state === 'AZ' || course.state === 'ID');
  const pool = home.length >= 12 ? home : sorted;
  const local = pool.slice(0, 12);
  const picked = [...local];
  const seen = new Set(local.map((course) => course.id));
  const rest = pool.filter((course) => !seen.has(course.id));
  const stride = Math.max(1, Math.floor(rest.length / 24));
  for (let i = stride - 1; i < rest.length && picked.length < 36; i += stride) {
    const course = rest[i];
    if (!course || seen.has(course.id)) continue;
    seen.add(course.id);
    picked.push(course);
  }
  return picked;
}

const STATE_CODE: Record<string, string> = { Utah: 'UT', Arizona: 'AZ', Idaho: 'ID' };

// One city for every state in the published catalog, plus the extra golf towns
// in Utah, Arizona, and California. Photos are landmarks, not course pictures.
const POPULAR_CITIES: { city: string; state: string; label: string; photo: string }[] = [
  { city: 'Salt Lake City', state: 'UT', label: 'Utah', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/62/Salt_Lake_City_skyline%2C_August_2011.jpg/960px-Salt_Lake_City_skyline%2C_August_2011.jpg' },
  { city: 'Park City', state: 'UT', label: 'Utah', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/35/View_on_Main_Street_in_Park_City_Utah.JPG/960px-View_on_Main_Street_in_Park_City_Utah.JPG' },
  { city: 'St. George', state: 'UT', label: 'Utah', photo: 'https://upload.wikimedia.org/wikipedia/commons/0/05/Snow_canyon_state_park.jpg' },
  { city: 'Boise', state: 'ID', label: 'Idaho', photo: 'https://upload.wikimedia.org/wikipedia/commons/4/4e/Idaho_State_Capitol.jpg' },
  { city: 'Denver', state: 'CO', label: 'Colorado', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bb/Denver_Skyline_%2815242286069%29.jpg/960px-Denver_Skyline_%2815242286069%29.jpg' },
  { city: 'Phoenix', state: 'AZ', label: 'Arizona', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a9/Camelback_Mountain_2.jpg/960px-Camelback_Mountain_2.jpg' },
  { city: 'Scottsdale', state: 'AZ', label: 'Arizona', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/71/Sonoran_Desert_in_Scottsdale%2C_AZ.jpg/960px-Sonoran_Desert_in_Scottsdale%2C_AZ.jpg' },
  { city: 'Tucson', state: 'AZ', label: 'Arizona', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fe/Saguaro_cactus_forest.jpg/960px-Saguaro_cactus_forest.jpg' },
  { city: 'Las Vegas', state: 'NV', label: 'Nevada', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5e/Welcome_to_Fabulous_Las_Vegas.jpg/960px-Welcome_to_Fabulous_Las_Vegas.jpg' },
  { city: 'Palm Springs', state: 'CA', label: 'California', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e2/San_Gorgonio_Pass_Wind_Power_Plants.jpg/960px-San_Gorgonio_Pass_Wind_Power_Plants.jpg' },
  { city: 'Los Angeles', state: 'CA', label: 'California', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/ba/Downtown_Los_Angeles_skyline.jpg/960px-Downtown_Los_Angeles_skyline.jpg' },
  { city: 'San Diego', state: 'CA', label: 'California', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/22/San_Diego_Skyline_Image.jpg/960px-San_Diego_Skyline_Image.jpg' },
  { city: 'San Francisco', state: 'CA', label: 'California', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/GoldenGateBridge-001.jpg/960px-GoldenGateBridge-001.jpg' },
  { city: 'Portland', state: 'OR', label: 'Oregon', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2d/Downtown_Portland_skyline_and_the_Fremont_Bridge_beyond_Swan_Island%2C_Portland%2C_Oregon.jpg/960px-Downtown_Portland_skyline_and_the_Fremont_Bridge_beyond_Swan_Island%2C_Portland%2C_Oregon.jpg' },
  { city: 'Seattle', state: 'WA', label: 'Washington', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e3/Seattle_Kerry_Park_Skyline.jpg/960px-Seattle_Kerry_Park_Skyline.jpg' },
  { city: 'Albuquerque', state: 'NM', label: 'New Mexico', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cd/Albuquerque_Balloon_Fiesta_2012.JPG/960px-Albuquerque_Balloon_Fiesta_2012.JPG' },
  { city: 'Homer', state: 'AK', label: 'Alaska', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/10/Kachemak_Bay%2C_Alaska.jpg/960px-Kachemak_Bay%2C_Alaska.jpg' },
  { city: 'Jersey City', state: 'NJ', label: 'New Jersey', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/87/Jersey_City_skyline%2C_Exchange_Place_waterfront_at_sunset.jpg/960px-Jersey_City_skyline%2C_Exchange_Place_waterfront_at_sunset.jpg' },
  { city: 'Evanston', state: 'WY', label: 'Wyoming', photo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1e/Evanston_Wyoming_Carnegie_Library.jpeg/960px-Evanston_Wyoming_Carnegie_Library.jpeg' },
];


function todLabel(tod: TimeOfDayPreset) {
  if (tod === 'morning') return 'Morning';
  if (tod === 'afternoon') return 'Afternoon';
  if (tod === 'evening') return 'Twilight';
  return 'Any time';
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

function FavoriteToast({
  notice,
  onUndo,
  onClose,
}: {
  notice: { id: string; photoUrl?: string };
  onUndo: () => void;
  onClose: () => void;
}) {
  const onUndoRef = useRef(onUndo);
  const onCloseRef = useRef(onClose);
  onUndoRef.current = onUndo;
  onCloseRef.current = onClose;
  const undoOnEnd = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finish = (undo: boolean) => {
    if (undo) onUndoRef.current();
    else onCloseRef.current();
  };
  const startLeave = (undo: boolean) => {
    if (reduced()) {
      finish(undo);
      return;
    }
    undoOnEnd.current = undo;
    setLeaving(true);
  };
  useEffect(() => {
    setLeaving(false);
    undoOnEnd.current = false;
  }, [notice.id]);
  useEffect(() => {
    if (paused || leaving) return;
    const timer = window.setTimeout(() => startLeave(false), 5000);
    return () => window.clearTimeout(timer);
  }, [notice.id, paused, leaving]);
  return (
    <div className="stay-toast-anchor">
      <div
        className={`stay-toast${leaving ? ' is-out' : ''}`}
        role="status"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onAnimationEnd={(event) => {
          if (event.animationName !== 'stay-toast-out') return;
          finish(undoOnEnd.current);
        }}
      >
        {notice.photoUrl
          ? <img className="stay-toast-photo" src={notice.photoUrl} alt="" />
          : <span className="stay-toast-photo" />}
        <span className="stay-toast-copy">Course added to Favorites</span>
        <button type="button" className="stay-toast-undo" onClick={() => startLeave(true)}>Undo</button>
      </div>
    </div>
  );
}

function SaveHeart({ saved, onSave }: { saved: boolean; onSave: () => void }) {
  const [pop, setPop] = useState(false);
  const wasSaved = useRef(saved);
  useEffect(() => {
    if (saved && !wasSaved.current) setPop(true);
    wasSaved.current = saved;
  }, [saved]);
  return (
    <button
      type="button"
      className={`stay-heart${saved ? ' is-on' : ''}${pop ? ' is-pop' : ''}`}
      aria-label={saved ? 'Remove from saved' : 'Save'}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSave();
      }}
      onAnimationEnd={(event) => {
        if (event.animationName === 'stay-heart-pop') setPop(false);
      }}
    >
      <Heart on={saved} />
    </button>
  );
}

function AlertBell({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        d="M6 9.5a6 6 0 0 1 12 0c0 4.2 1.2 5.5 1.8 6.2H4.2C4.8 15 6 13.7 6 9.5z"
      />
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M10 18.2a2 2 0 0 0 4 0" />
    </svg>
  );
}

function CourseCard({
  course,
  saved,
  onSave,
  summary,
  release,
  pending,
  href,
  showTimes,
  timesCount,
  exception,
  hot,
  onHover,
}: {
  course: Course;
  saved: boolean;
  onSave: (id: string) => void;
  summary: SlotSummary | null;
  release: BookingRelease | null;
  pending: boolean;
  href: string;
  showTimes: boolean;
  timesCount?: number;
  exception?: string | null;
  hot?: boolean;
  onHover?: (id: string | null) => void;
}) {
  const meta = [course.city, course.state].filter(Boolean).join(', ');
  const miles = course.distanceMi != null ? `${Math.round(course.distanceMi)} mi` : null;
  const openCount = summary?.slots.length ?? 0;
  const countTag = timesCount && timesCount > 0 ? `${timesCount} ${timesCount === 1 ? 'time' : 'times'}` : null;
  const badge = showTimes && openCount > 0
    ? `${openCount} open`
    : showTimes
      ? release?.label ?? ((course.rating ?? 0) >= 4.6 ? 'Guest favorite' : null)
      : exception ?? countTag;
  const navigate = useNavigate();
  const tz = course.timezone || DEFAULT_TEE_TIMEZONE;
  const top = summary?.slots.slice(0, 5) ?? [];
  const more = Math.max(0, openCount - top.length);
  const photo = (
    <div className="stay-card-photo">
      {course.photoUrl ? (
        <img src={course.photoUrl} alt="" />
      ) : (
        <div className="stay-card-fallback" />
      )}
      {badge ? <span className="stay-badge">{badge}</span> : null}
      <div className="stay-scrim">
        <div className="stay-scrim-name">{course.name}</div>
        <div className="stay-scrim-meta">
          {course.rating != null ? (
            <span className="stay-scrim-rating"><span className="star-gold" aria-hidden>★</span> {course.rating.toFixed(1)}</span>
          ) : null}
          {meta ? <span>{meta}</span> : null}
          {miles ? <span>{miles}</span> : null}
        </div>
      </div>
      <SaveHeart saved={saved} onSave={() => onSave(course.id)} />
    </div>
  );
  const hover = {
    onMouseEnter: () => onHover?.(course.id),
    onMouseLeave: () => onHover?.(null),
  };
  if (!showTimes) {
    return (
      <Link className={`stay-card${hot ? ' is-hot' : ''}`} to={href} {...hover}>
        {photo}
      </Link>
    );
  }
  return (
    <article className={`stay-card${hot ? ' is-hot' : ''}`} {...hover}>
      <Link to={href}>{photo}</Link>
      {summary ? (
        <div className={`tee-strip tee-strip--discover${more > 0 ? ' has-more' : ''}${top.length >= 4 ? ' is-dense' : ''}`}>
          {top.map((tee) => (
            <TeeSlotCard
              key={`${tee.id}-${tee.holes}`}
              startsAt={tee.startsAt}
              timeZone={tz}
              price={tee.price}
              spots={tee.spots}
              holes={tee.holes}
              reopenedAt={tee.reopenedAt}
              showMeta={false}
              showWeather={false}
              onClick={() => {
                const join = href.includes('?') ? '&' : '?';
                navigate(`${href}${join}time=${encodeURIComponent(tee.startsAt)}`);
              }}
            />
          ))}
          {more > 0 ? (
            <Link to={href} className="tee-slot-card tee-slot-card--more" aria-label={`${more} more tee times at ${course.name}`}>
              <span className="tee-slot-card-more-count">+{more}</span>
              <span className="tee-slot-card-more-label">more</span>
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="stay-card-body">
          <div className="stay-card-sub">{pending ? 'Finding times…' : release ? release.detail : 'No open times'}</div>
        </div>
      )}
    </article>
  );
}

type CardModel = {
  course: Course;
  summary: SlotSummary | null;
  release: BookingRelease | null;
  pending: boolean;
  href: string;
  showTimes: boolean;
  timesCount?: number;
  exception?: string | null;
};

function seeAllPhotos(cards: CardModel[]) {
  const urls: string[] = [];
  for (const card of cards) {
    const url = card.course.photoUrl;
    if (!url || urls.includes(url)) continue;
    urls.push(url);
    if (urls.length === 2) break;
  }
  return urls;
}

function SeeAllCard({ title, photos, onOpen }: { title: string; photos: string[]; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = el.closest('.stay-scroller');
    const observer = new IntersectionObserver(
      ([entry]) => setShown(entry.isIntersecting && entry.intersectionRatio >= 0.72),
      { root: root instanceof HTMLElement ? root : null, threshold: [0, 0.72, 1] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <button ref={ref} type="button" className={`stay-see-all${shown ? ' is-shown' : ''}${photos.length === 0 ? ' is-plain' : ''}`} onClick={onOpen} aria-label={`See all, ${title}`}>
      {photos.length > 0 ? (
        <span className="stay-see-all-stack" aria-hidden>
          {photos.map((src, index) => (
            <img key={src} className={`stay-see-all-shot is-${index === 0 ? 'back' : 'front'}`} src={src} alt="" />
          ))}
        </span>
      ) : null}
      <strong>See all</strong>
    </button>
  );
}

function Row({
  title,
  cards,
  saved,
  onSave,
  action,
  onOpen,
  hotId,
  onHover,
  notice,
  onCloseNotice,
}: {
  title: string;
  cards: CardModel[];
  saved: Set<string>;
  onSave: (id: string) => void;
  action?: ReactNode;
  onOpen?: () => void;
  hotId?: string | null;
  onHover?: (id: string | null) => void;
  notice?: { id: string; photoUrl?: string } | null;
  onCloseNotice?: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const rowNotice = notice && cards.some((card) => card.course.id === notice.id) ? notice : null;
  if (cards.length === 0) return null;
  const nudge = (dir: number) => {
    scroller.current?.scrollBy({ left: dir * 264 * 3, behavior: 'smooth' });
  };
  return (
    <section className="stay-row">
      <div className="stay-row-head">
        <h2>
          {onOpen ? (
            <button type="button" onClick={onOpen}>
              {title}
              <span aria-hidden> ›</span>
            </button>
          ) : (
            title
          )}
        </h2>
        <div className="stay-row-tools">
          {action}
          <div className="stay-arrows">
            <button type="button" aria-label="Previous" onClick={() => nudge(-1)}>‹</button>
            <button type="button" aria-label="Next" onClick={() => nudge(1)}>›</button>
          </div>
        </div>
      </div>
      <div className="stay-row-stage">
        <div className="stay-scroller" ref={scroller}>
          {cards.map((card) => (
            <CourseCard key={card.course.id} {...card} saved={saved.has(card.course.id)} onSave={onSave} hot={hotId === card.course.id} onHover={onHover} />
          ))}
          {onOpen ? <SeeAllCard title={title} photos={seeAllPhotos(cards)} onOpen={onOpen} /> : null}
        </div>
        {rowNotice && onCloseNotice ? (
          <FavoriteToast
            key={rowNotice.id}
            notice={rowNotice}
            onUndo={() => onSave(rowNotice.id)}
            onClose={onCloseNotice}
          />
        ) : null}
      </div>
    </section>
  );
}

type AppliedSearch = {
  place: string;
  radius: StayRadius;
  playYmd: string | null;
  tod: TimeOfDayPreset;
  players: 1 | 2 | 3 | 4 | null;
  holes: HolesFilter;
  maxPrice: number | null;
  opened: boolean;
};

function readTod(raw: string | null): TimeOfDayPreset {
  return raw === 'morning' || raw === 'afternoon' || raw === 'evening' ? raw : 'any';
}

function readMax(raw: string | null) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function searchParamsFor(search: AppliedSearch) {
  const q = new URLSearchParams();
  if (search.place && search.place !== 'Nearby') q.set('where', search.place);
  if (search.playYmd) q.set('date', search.playYmd);
  if (search.tod !== 'any') q.set('tod', search.tod);
  if (search.players) q.set('players', String(search.players));
  if (search.holes !== 'any') q.set('holes', String(search.holes));
  if (search.radius === 'all') q.set('radius', 'all');
  else if (search.radius !== 25) q.set('radius', String(search.radius));
  if (search.maxPrice) q.set('max', String(search.maxPrice));
  if (search.opened) q.set('opened', '1');
  return q;
}

function readApplied(results: boolean, params: URLSearchParams): AppliedSearch {
  if (!results) {
    return { place: '', radius: 25, playYmd: null, tod: 'any', players: null, holes: 'any', maxPrice: null, opened: false };
  }
  return {
    place: params.get('where')?.trim() || 'Nearby',
    radius: readRadius(params.get('radius')),
    playYmd: params.get('date') || toYmd(nextSaturday()),
    tod: readTod(params.get('tod')),
    players: partySize(params.get('players')),
    holes: readHoles(params.get('holes')),
    maxPrice: readMax(params.get('max')),
    opened: params.get('opened') === '1',
  };
}

function searchLabels(
  search: AppliedSearch,
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
  const date = search.playYmd ? (dense ? formatDateCompact(search.playYmd) : formatDateChip(search.playYmd)) : '';
  const when = !search.playYmd
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

function exceptionLabel(slots: TeeTime[]) {
  const fresh = slots.some((tee) => {
    if (!tee.reopenedAt) return false;
    const mins = (Date.now() - new Date(tee.reopenedAt).getTime()) / 60000;
    return mins >= 0 && mins < 360;
  });
  if (fresh) return 'Just opened';
  if (slots.length === 1) return 'Last time';
  return null;
}

function partySize(value: string | null): 1 | 2 | 3 | 4 | null {
  const n = Number(value);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

export function StayFinder() {
  const { courses, loading: catalogLoading, recordsBySlug, userLocation } = useCourseCatalog();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const results = location.pathname === '/search';
  const browse = defaultBrowseId();
  const [applied, setApplied] = useState(() => readApplied(results, params));
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  const editN = useRef(0);
  const [editRequest, setEditRequest] = useState<{ seg: 'when' | 'who'; n: number } | null>(null);
  const [mapOnly, setMapOnly] = useState(false);
  const [areaBounds, setAreaBounds] = useState<MapBounds | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const activeYmd = applied.playYmd ?? toYmd(nextSaturday());
  const party = applied.players ?? 1;
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [favoriteNotice, setFavoriteNotice] = useState<{ id: string; photoUrl?: string } | null>(null);
  const headerDraftRef = useRef<StaySearchQuery | null>(null);
  const headerValue: StaySearchQuery = {
    place: applied.place,
    radius: applied.radius,
    date: applied.playYmd,
    tod: applied.tod,
    players: applied.players,
    holes: applied.holes,
  };

  const fetchScope = useMemo(() => {
    if (!results) return null;
    const nearby = !applied.place || applied.place === 'Nearby';
    const state = STATE_CODE[applied.place];
    return buildTimesFetchScope(courses, userLocation, {
      fetchAllUtah: applied.radius === 'all' && (nearby || Boolean(state)),
      radiusMi: applied.radius === 'all' ? 25 : applied.radius,
      locationQuery: nearby || state || applied.radius === 'all' ? '' : applied.place,
    });
  }, [results, courses, userLocation, applied]);

  const fetchCourses = useMemo(() => {
    if (!fetchScope) return [];
    const nearby = !applied.place || applied.place === 'Nearby';
    const state = STATE_CODE[applied.place];
    let list = applied.radius === 'all' && !nearby && !state
      ? courses.filter((course) => courseMatchesLocationQuery(course, applied.place))
      : fetchScope.fetchPool;
    if (state) list = list.filter((course) => course.state === state);
    if (areaBounds) list = list.filter((course) => courseInMapBounds(course, areaBounds));
    return takeSearchCourses(list, applied.radius, fetchScope.anchor);
  }, [fetchScope, courses, applied, areaBounds]);

  const sheet = useTimesByCourseMap(fetchCourses, recordsBySlug, activeYmd, applied.holes, party, 0, catalogLoading || !results);
  const slotTod: TimeOfDayPreset = applied.tod;
  const todayKey = todayYmd();

  const popularCities = useMemo(() => {
    return POPULAR_CITIES.map((place) => {
      const query = `${place.city}, ${place.state}`;
      const resolved = resolvePlaceAnchor(query, courses);
      const nearby = resolved
        ? filterCoursesWithinRadius(courses, { ...resolved.anchor, source: 'default' }, 25)
        : [];
      return { ...place, query, count: nearby.length, photoUrl: place.photo };
    });
  }, [courses]);

  const courseHref = (id: string) => {
    const q = new URLSearchParams({ date: activeYmd, players: String(party) });
    if (applied.holes !== 'any') q.set('holes', String(applied.holes));
    if (applied.tod !== 'any') q.set('tod', applied.tod);
    if (applied.place && applied.place !== 'Nearby') q.set('where', applied.place);
    if (applied.radius !== 25) q.set('radius', String(applied.radius));
    return `/course/${id}?${q.toString()}`;
  };

  const cards = useMemo(() => {
    const models: CardModel[] = fetchCourses.map((course) => {
      const raw = sheet.timesByCourse.get(course.id) ?? [];
      const slots = visibleSlots(raw, course.timezone, {
        tod: slotTod,
        holes: applied.holes,
        maxPrice: applied.maxPrice ?? undefined,
      }).filter((tee) => !applied.opened || tee.reopenedAt);
      const summary = summarizeSlots(slots, course.timezone);
      const release = summary ? null : bookingRelease(
        recordsBySlug.get(course.id),
        activeYmd,
        todayKey,
        sheet.bookingWindows[course.id],
        sheet.bookingOpens[course.id],
      );
      const anchor = fetchScope?.anchor ?? { ...WASATCH_FRONT_ANCHOR, source: 'default' as const };
      return {
        course: { ...course, distanceMi: distanceFromAnchor(course, anchor) ?? undefined },
        summary,
        release,
        pending: sheet.loadingTimes || sheet.pendingSlugs.has(course.id),
        href: courseHref(course.id),
        showTimes: true,
      };
    });
    return [...models]
      .sort((a, b) => Number(Boolean(b.summary)) - Number(Boolean(a.summary)))
      .filter((card) => card.summary || card.release || card.pending);
  }, [fetchCourses, fetchScope, sheet, slotTod, applied.holes, applied.maxPrice, applied.opened, activeYmd, party, recordsBySlug, todayKey]);

  const homeToday = todayYmd();
  const homeDate = ymdForBrowse(browse, homeToday);
  const dealDate = browse === 'next' ? homeDate : comingSaturdayYmd(homeToday);
  const homeAnchor = useMemo(
    () => (userLocation
      ? { lat: userLocation.lat, lng: userLocation.lng, source: 'gps' as const }
      : { ...WASATCH_FRONT_ANCHOR, source: 'default' as const }),
    [userLocation],
  );
  const homeMonth = ymdToDate(homeToday).getMonth();
  const homePool = useMemo(
    () => (results ? [] : homeFetchCourses(courses, homeAnchor, homeMonth)),
    [results, courses, homeAnchor, homeMonth],
  );
  const homeSheets = usePollerSnapshots(homePool, results ? [] : [...new Set([homeDate, dealDate])], !results && !catalogLoading);
  const homeRows = useMemo(() => {
    if (results) return [];
    const timesFor = (date: string, courseId: string) => homeSheets.sheets[date]?.get(courseId) ?? [];
    return buildHomeRows({
      courses,
      anchor: homeAnchor,
      located: userLocation != null,
      browseYmd: homeDate,
      todayYmd: homeToday,
      dealYmd: dealDate,
      month: homeMonth,
      timesFor,
    }).map((row) => ({
      ...row,
      cards: row.courses.map((course): CardModel => {
        const tz = course.timezone || DEFAULT_TEE_TIMEZONE;
        const date = row.id === 'deals' ? dealDate : homeDate;
        const slots = visibleSlots(timesFor(date, course.id), tz);
        const shown = row.id === 'deals' ? visibleSlots(slots, tz, { tod: 'morning', maxPrice: 40 }) : slots;
        const showCount = row.id !== 'rated';
        return {
          course: { ...course, distanceMi: course.distanceMi ?? distanceFromAnchor(course, homeAnchor) ?? undefined },
          summary: null,
          release: null,
          pending: false,
          href: `/course/${course.id}?date=${date}&players=1`,
          showTimes: false,
          timesCount: showCount ? shown.length : 0,
          exception: showCount && exceptionLabel(slots) === 'Just opened' ? 'Just opened' : null,
        };
      }),
    }));
  }, [results, courses, homeAnchor, userLocation, homeDate, homeToday, dealDate, homeMonth, homeSheets.sheets]);

  const mapAnchor = fetchScope?.anchor ?? {
    lat: 40.7608,
    lng: -111.891,
  };
  const fetchedSlugs = useMemo(() => new Set(fetchCourses.map((course) => course.id)), [fetchCourses]);

  const toggleSave = (id: string) => {
    const adding = !saved.has(id);
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (adding) {
      const course = courses.find((item) => item.id === id);
      setFavoriteNotice({ id, photoUrl: course?.photoUrl });
    } else {
      setFavoriteNotice((current) => (current?.id === id ? null : current));
    }
  };

  const runSearch = (whereValue?: string, radiusOverride?: StayRadius, extra?: Partial<HomeSearch>) => {
    const raw = (whereValue ?? extra?.place ?? '').trim();
    const nextPlace = !raw || /^near(by| me)?$/i.test(raw) ? 'Nearby' : raw;
    const draft = headerDraftRef.current;
    const nextRadius = radiusOverride ?? extra?.radius ?? draft?.radius ?? 25;
    const nextDate = extra?.date ?? draft?.date ?? toYmd(nextSaturday());
    const nextTod = extra?.tod ?? draft?.tod ?? 'any';
    const maxPrice = extra?.maxPrice ?? null;
    const opened = extra?.opened === true;
    const players = draft?.players ?? null;
    const holes = draft?.holes ?? 'any';
    const q = new URLSearchParams();
    if (nextPlace !== 'Nearby') q.set('where', nextPlace);
    q.set('date', nextDate);
    if (nextTod !== 'any') q.set('tod', nextTod);
    if (nextRadius === 'all') q.set('radius', 'all');
    else if (nextRadius !== 25) q.set('radius', String(nextRadius));
    if (maxPrice) q.set('max', String(maxPrice));
    if (opened) q.set('opened', '1');
    setApplied({ place: nextPlace, radius: nextRadius, playYmd: nextDate, tod: nextTod, players, holes, maxPrice, opened });
    setAreaBounds(null);
    window.scrollTo(0, 0);
    navigate(`/search?${q.toString()}`, { replace: results });
  };

  const writeSearch = (next: AppliedSearch) => {
    setApplied(next);
    setAreaBounds(null);
    window.scrollTo(0, 0);
    navigate(`/search?${searchParamsFor(next).toString()}`, { replace: true });
  };

  const editSearch = (seg: 'when' | 'who') => {
    editN.current += 1;
    setEditRequest({ seg, n: editN.current });
  };

  const applyHeaderSearch = (query: StaySearchQuery) => {
    const prev = appliedRef.current;
    writeSearch({
      place: query.place || 'Nearby',
      radius: query.radius,
      playYmd: query.date,
      tod: query.tod,
      players: query.players,
      holes: query.holes,
      maxPrice: prev.maxPrice,
      opened: prev.opened,
    });
  };

  useLayoutEffect(() => {
    if (!results) return;
    window.scrollTo(0, 0);
  }, [results, location.search]);

  return (
    <div className={`stay stay-finder${results ? ' is-results' : ''}${mapOnly ? ' is-map' : ''}`}>
      <StaySearchHeader
        value={results ? headerValue : { place: '', radius: 25, date: null, tod: 'any', players: null, holes: 'any' }}
        pinned={results}
        queryRef={headerDraftRef}
        editRequest={results ? editRequest : null}
        onSearch={applyHeaderSearch}
        onOpenCourse={(id, query) => {
          const q = staySearchQueryString({
            ...query,
            date: query.date ?? activeYmd,
            players: query.players ?? party,
          });
          navigate(`/course/${id}?${q}`);
        }}
      />

      <main className="stay-main">
        {results ? (
          <Results
            cards={cards}
            courses={fetchCourses}
            saved={saved}
            onSave={toggleSave}
            loading={sheet.loadingTimes && cards.every((card) => !card.summary)}
            place={applied.place || 'Nearby'}
            radius={applied.radius}
            when={searchLabels(applied, { where: 'Nearby', when: 'Add dates', who: 'Any players' }).when}
            note={[applied.maxPrice ? `under $${applied.maxPrice}` : '', applied.opened ? 'just opened' : ''].filter(Boolean).join(' · ')}
            mapOnly={mapOnly}
            onMapOnly={setMapOnly}
            timesByCourse={sheet.timesByCourse}
            pendingSlugs={sheet.pendingSlugs}
            fetchedSlugs={fetchedSlugs}
            recordsBySlug={recordsBySlug}
            playYmd={activeYmd}
            players={party}
            holes={applied.holes}
            tod={slotTod}
            anchor={mapAnchor}
            userLocation={userLocation}
            hoverId={hoverId}
            focusId={focusId}
            onHover={setHoverId}
            onFocus={setFocusId}
            onSearchArea={setAreaBounds}
            bookingWindows={sheet.bookingWindows}
            bookingOpens={sheet.bookingOpens}
            catalogLoading={catalogLoading}
            notice={favoriteNotice}
            onCloseNotice={() => setFavoriteNotice(null)}
            onEdit={editSearch}
            onPrice={(maxPrice) => writeSearch({ ...appliedRef.current, maxPrice })}
            onOpened={(opened) => writeSearch({ ...appliedRef.current, opened })}
            maxPrice={applied.maxPrice}
            opened={applied.opened}
          />
        ) : (
          <HomeBrowse
            rows={homeRows}
            saved={saved}
            onSave={toggleSave}
            cities={popularCities}
            onCity={(query) => runSearch(query, 25)}
            onOpen={(search) => runSearch(search.place, search.radius, search)}
            loading={catalogLoading && courses.length === 0}
            notice={favoriteNotice}
            onCloseNotice={() => setFavoriteNotice(null)}
          />
        )}
      </main>
      {results ? (
        <button type="button" className="stay-map-float" onClick={() => setMapOnly((open) => !open)}>
          {mapOnly ? <ListGlyph /> : <MapGlyph />}
          {mapOnly ? 'List' : 'Map'}
        </button>
      ) : null}
      <SiteFooter />
    </div>
  );
}

function PromoCard({ to, className, children }: { to: string; className: string; children: ReactNode }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [play, setPlay] = useState(false);
  const played = useRef(false);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || played.current) return;
      played.current = true;
      setPlay(true);
    }, { threshold: 0.6 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Link
      ref={ref}
      to={to}
      className={`${className}${play ? ' is-play' : ''}`}
      onMouseEnter={() => {
        if (reduced()) return;
        setPlay(false);
        requestAnimationFrame(() => setPlay(true));
      }}
      onAnimationEnd={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest('.stay-alert-icon')) return;
        setPlay(false);
      }}
    >
      {children}
    </Link>
  );
}

function CityRow({
  cities,
  onCity,
}: {
  cities: { query: string; city: string; state: string; photoUrl?: string }[];
  onCity: (query: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const nudge = (dir: number) => {
    scroller.current?.scrollBy({ left: dir * 264 * 3, behavior: 'smooth' });
  };
  return (
    <section className="stay-states" aria-label="Popular cities">
      <div className="stay-row-head">
        <h2>Popular cities</h2>
        <div className="stay-arrows">
          <button type="button" aria-label="Previous" onClick={() => nudge(-1)}>‹</button>
          <button type="button" aria-label="Next" onClick={() => nudge(1)}>›</button>
        </div>
      </div>
      <div className="stay-scroller" ref={scroller}>
        {cities.map((place) => (
          <button key={place.query} type="button" className="stay-city" onClick={() => onCity(place.query)}>
            <span className="stay-city-photo">
              {place.photoUrl ? <img src={place.photoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
            </span>
            <span className="stay-city-name">{place.city}, {place.state}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function HomeBrowse({
  rows,
  saved,
  onSave,
  cities,
  onCity,
  onOpen,
  loading,
  notice,
  onCloseNotice,
}: {
  rows: { id: string; title: string; cards: CardModel[]; search: HomeSearch }[];
  saved: Set<string>;
  onSave: (id: string) => void;
  cities: { query: string; city: string; state: string; label: string; count: number; photoUrl?: string }[];
  onCity: (query: string) => void;
  onOpen: (search: HomeSearch) => void;
  loading: boolean;
  notice: { id: string; photoUrl?: string } | null;
  onCloseNotice: () => void;
}) {
  return (
    <>
      {loading ? (
        <section className="stay-row">
          <div className="stay-row-head"><h2>Finding courses</h2></div>
          <div className="stay-scroller">{Array.from({ length: 4 }, (_, i) => <div key={i} className="stay-skel" />)}</div>
        </section>
      ) : (
        rows.map((row) => (
          <Row
            key={row.id}
            title={row.title}
            cards={row.cards}
            saved={saved}
            onSave={onSave}
            onOpen={() => onOpen(row.search)}
            notice={notice}
            onCloseNotice={onCloseNotice}
          />
        ))
      )}
      <div className="stay-promos">
        <PromoCard to="/account" className="stay-alert">
          <span className="stay-alert-icon" aria-hidden>
            <AlertBell />
          </span>
          <strong>Cancellation Alerts</strong>
          <p>Be the first to know when tee times cancel.</p>
          <span className="stay-alert-go">Set an alert</span>
          <AlertBell className="stay-alert-mark" />
        </PromoCard>
        <PromoCard to="/plan" className="stay-alert is-ink">
          <span className="stay-alert-icon" aria-hidden>
            <PlanIcon />
          </span>
          <strong>Plan a round</strong>
          <p>Pick a few times, send a link, and let the group vote.</p>
          <span className="stay-alert-go">Start a plan</span>
          <PlanIcon className="stay-alert-mark" />
        </PromoCard>
      </div>
      <CityRow cities={cities} onCity={onCity} />
    </>
  );
}

const PRICE_CAPS = [40, 60, 80, 100] as const;

function SearchFilters({
  date,
  tod,
  players,
  holes,
  maxPrice,
  opened,
  onEdit,
  onPrice,
  onOpened,
  className,
}: {
  date: string;
  tod: TimeOfDayPreset;
  players: 1 | 2 | 3 | 4;
  holes: HolesFilter;
  maxPrice: number | null;
  opened: boolean;
  onEdit: (seg: 'when' | 'who') => void;
  onPrice: (maxPrice: number | null) => void;
  onOpened: (opened: boolean) => void;
  className?: string;
}) {
  const [priceOpen, setPriceOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<{ top: number; left: number } | null>(null);
  const priceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!priceOpen) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.stay-price-menu')) return;
      if (!priceRef.current?.contains(target as Node)) setPriceOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPriceOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [priceOpen]);

  return (
    <div className={`stay-filters${className ? ` ${className}` : ''}`} role="group" aria-label="Search filters">
      <button type="button" className="stay-filter is-on" onClick={() => onEdit('when')}>
        {formatDateCompact(date)}
      </button>
      <button type="button" className={`stay-filter${tod !== 'any' ? ' is-on' : ''}`} onClick={() => onEdit('when')}>
        {todLabel(tod)}
      </button>
      <button type="button" className="stay-filter is-on" onClick={() => onEdit('who')}>
        {players === 1 ? '1 player' : `${players} players`}
      </button>
      <button type="button" className={`stay-filter${holes !== 'any' ? ' is-on' : ''}`} onClick={() => onEdit('who')}>
        {holes === 'any' ? 'Any holes' : `${holes} holes`}
      </button>
      <div className="stay-filter-price" ref={priceRef}>
        <button
          type="button"
          className={`stay-filter${maxPrice ? ' is-on' : ''}`}
          aria-expanded={priceOpen}
          aria-haspopup="menu"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenuBox({ top: rect.bottom + 8, left: Math.max(12, Math.min(rect.left, window.innerWidth - 188)) });
            setPriceOpen((open) => !open);
          }}
        >
          {maxPrice ? `Under $${maxPrice}` : 'Any price'}
        </button>
        {priceOpen && menuBox ? createPortal(
          <div className="stay-price-menu" role="menu" style={{ top: menuBox.top, left: menuBox.left }}>
            <button type="button" role="menuitem" className={!maxPrice ? 'is-on' : ''} onClick={() => { onPrice(null); setPriceOpen(false); }}>
              Any price
            </button>
            {PRICE_CAPS.map((cap) => (
              <button
                key={cap}
                type="button"
                role="menuitem"
                className={maxPrice === cap ? 'is-on' : ''}
                onClick={() => { onPrice(cap); setPriceOpen(false); }}
              >
                Under ${cap}
              </button>
            ))}
          </div>,
          document.body,
        ) : null}
      </div>
      {opened ? (
        <button type="button" className="stay-filter is-on" onClick={() => onOpened(false)}>
          Just opened
        </button>
      ) : null}
    </div>
  );
}

function MapGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 18.2 4 20V6.6L9 4.8l6 2 5-1.8V18.2L15 20l-6-1.8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 4.8v13.4M15 6.8v13.2" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ListGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 7h12M8 12h12M8 17h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ViewToggle({ mapOnly, onMapOnly }: { mapOnly: boolean; onMapOnly: (next: boolean) => void }) {
  const listRef = useRef<HTMLButtonElement>(null);
  const mapRef = useRef<HTMLButtonElement>(null);
  const [pill, setPill] = useState({ left: 0, width: 0, move: false });

  useLayoutEffect(() => {
    const el = mapOnly ? mapRef.current : listRef.current;
    if (!el) return;
    setPill((prev) => ({
      left: el.offsetLeft,
      width: el.offsetWidth,
      move: prev.width > 0,
    }));
  }, [mapOnly]);

  return (
    <div className="stay-pane" role="group" aria-label="Results view">
      <span className={`stay-pane-thumb${pill.move ? ' is-move' : ''}`} style={{ width: pill.width, transform: `translateX(${pill.left}px)` }} aria-hidden />
      <button ref={listRef} type="button" className={!mapOnly ? 'is-on' : ''} aria-pressed={!mapOnly} onClick={() => onMapOnly(false)}>List</button>
      <button ref={mapRef} type="button" className={mapOnly ? 'is-on' : ''} aria-pressed={mapOnly} onClick={() => onMapOnly(true)}>Map</button>
    </div>
  );
}

function MapSheet({
  cards,
  loading,
  saved,
  onSave,
  focusId,
}: {
  cards: CardModel[];
  loading: boolean;
  saved: Set<string>;
  onSave: (id: string) => void;
  focusId: string | null;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusId) return;
    rowRef.current?.querySelector<HTMLElement>(`[data-course="${focusId}"]`)?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [focusId]);
  const count = cards.length;
  return (
    <div className="stay-map-sheet">
      <p className="stay-map-sheet-count">
        {loading ? 'Finding tee times…' : count === 0 ? 'No open times' : `${count} course${count === 1 ? '' : 's'}`}
      </p>
      {count > 0 ? (
        <div className="stay-map-sheet-row" ref={rowRef}>
          {cards.map((card) => {
            const openCount = card.summary?.slots.length ?? 0;
            const price = card.summary?.from;
            return (
              <Link
                key={card.course.id}
                to={card.href}
                data-course={card.course.id}
                className={`stay-map-sheet-card${focusId === card.course.id ? ' is-on' : ''}`}
                aria-label={card.course.name}
              >
                {card.course.photoUrl ? <img src={card.course.photoUrl} alt="" /> : <span className="stay-card-fallback" />}
                {openCount > 0 ? <span className="stay-badge">{openCount} open</span> : null}
                <span className="stay-map-sheet-scrim">
                  <span className="stay-map-sheet-name">{card.course.name}</span>
                  {price != null ? <span className="stay-map-sheet-price">${Math.round(price)}</span> : null}
                </span>
                <SaveHeart saved={saved.has(card.course.id)} onSave={() => onSave(card.course.id)} />
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Results({
  cards,
  courses,
  saved,
  onSave,
  loading,
  place,
  radius,
  when,
  note,
  mapOnly,
  onMapOnly,
  timesByCourse,
  pendingSlugs,
  fetchedSlugs,
  recordsBySlug,
  playYmd,
  players,
  holes,
  tod,
  anchor,
  userLocation,
  hoverId,
  focusId,
  onHover,
  onFocus,
  onSearchArea,
  bookingWindows,
  bookingOpens,
  catalogLoading,
  notice,
  onCloseNotice,
  onEdit,
  onPrice,
  onOpened,
  maxPrice,
  opened,
}: {
  cards: CardModel[];
  courses: Course[];
  saved: Set<string>;
  onSave: (id: string) => void;
  loading: boolean;
  place: string;
  radius: StayRadius;
  when: string;
  note?: string;
  mapOnly: boolean;
  onMapOnly: (next: boolean) => void;
  timesByCourse: Map<string, TeeTime[]>;
  pendingSlugs: Set<string>;
  fetchedSlugs: Set<string>;
  recordsBySlug: Map<string, CourseRecord>;
  playYmd: string;
  players: 1 | 2 | 3 | 4;
  holes: HolesFilter;
  tod: TimeOfDayPreset;
  anchor: { lat: number; lng: number };
  userLocation: { lat: number; lng: number } | null;
  hoverId: string | null;
  focusId: string | null;
  onHover: (id: string | null) => void;
  onFocus: (id: string | null) => void;
  onSearchArea: (bounds: MapBounds) => void;
  bookingWindows: Record<string, number>;
  bookingOpens: Record<string, string>;
  catalogLoading: boolean;
  notice: { id: string; photoUrl?: string } | null;
  onCloseNotice: () => void;
  onEdit: (seg: 'when' | 'who') => void;
  onPrice: (maxPrice: number | null) => void;
  onOpened: (opened: boolean) => void;
  maxPrice: number | null;
  opened: boolean;
}) {
  const open = cards.filter((card) => card.summary).length;
  const [mapMounted, setMapMounted] = useState(mapOnly);
  const [narrowMap, setNarrowMap] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const onChange = () => setNarrowMap(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  const mapPad = useMemo(
    () => (narrowMap && mapOnly ? { top: 58, right: 16, bottom: 248, left: 16 } : undefined),
    [narrowMap, mapOnly],
  );
  if (mapOnly && !mapMounted) setMapMounted(true);
  useEffect(() => {
    if (mapOnly) {
      setMapMounted(true);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMapMounted(false);
      return;
    }
    const hide = window.setTimeout(() => setMapMounted(false), 460);
    return () => window.clearTimeout(hide);
  }, [mapOnly]);
  return (
    <div className={`stay-results-layout${mapOnly ? ' is-map' : ''}${mapMounted ? ' has-map' : ''}`}>
      <div className="stay-results-list">
        <div className="stay-results-head">
          <div>
            <h1>
              {when}{' '}
              {radius === 'all'
                ? 'statewide'
                : place === 'Nearby' || !place
                  ? 'near you'
                  : `near ${place}`}
            </h1>
            <p>
              {loading
                ? 'Finding tee times…'
                : `${open} course${open === 1 ? '' : 's'} ${radius === 'all' ? 'statewide' : `within ${radius} miles`}${note ? ` · ${note}` : ''}`}
            </p>
          </div>
          <ViewToggle mapOnly={mapOnly} onMapOnly={onMapOnly} />
        </div>
        <SearchFilters
          date={playYmd}
          tod={tod}
          players={players}
          holes={holes}
          maxPrice={maxPrice}
          opened={opened}
          onEdit={onEdit}
          onPrice={onPrice}
          onOpened={onOpened}
        />
        {loading ? (
          <div className="stay-results">{Array.from({ length: 6 }, (_, i) => <div key={i} className="stay-skel" />)}</div>
        ) : cards.length === 0 ? (
          <p className="stay-where-empty">No open times for this search. Try another day, or move the map and search this area.</p>
        ) : (
          <div className="stay-results">
            {notice && cards.some((card) => card.course.id === notice.id) ? (
              <FavoriteToast
                key={notice.id}
                notice={notice}
                onUndo={() => onSave(notice.id)}
                onClose={onCloseNotice}
              />
            ) : null}
            {cards.map((card) => (
              <CourseCard
                key={card.course.id}
                {...card}
                saved={saved.has(card.course.id)}
                onSave={onSave}
                hot={hoverId === card.course.id || focusId === card.course.id}
                onHover={onHover}
              />
            ))}
          </div>
        )}
      </div>
      <div className="stay-map-pane">
        <FinderMap
          courses={courses}
          timesByCourse={timesByCourse}
          pendingSlugs={pendingSlugs}
          fetchedSlugs={fetchedSlugs}
          selectedId={focusId}
          hoveredId={hoverId}
          anchor={anchor}
          lockView={false}
          recordsBySlug={recordsBySlug}
          dateYmd={playYmd}
          players={players}
          holes={holes}
          timeOfDay={tod}
          detailHref={(course) => {
            const q = new URLSearchParams({ date: playYmd, players: String(players) });
            if (holes !== 'any') q.set('holes', String(holes));
            if (tod !== 'any') q.set('tod', tod);
            if (place && place !== 'Nearby') q.set('where', place);
            if (radius !== 25) q.set('radius', String(radius));
            return `/course/${course.id}?${q.toString()}`;
          }}
          coursesLoading={catalogLoading}
          userLocation={userLocation}
          onSelect={onFocus}
          onHover={onHover}
          onSearchArea={onSearchArea}
          bookingWindows={bookingWindows}
          bookingOpens={bookingOpens}
          viewportPadding={mapPad}
        />
        {narrowMap ? (
          <SearchFilters
            className="stay-map-filters"
            date={playYmd}
            tod={tod}
            players={players}
            holes={holes}
            maxPrice={maxPrice}
            opened={opened}
            onEdit={onEdit}
            onPrice={onPrice}
            onOpened={onOpened}
          />
        ) : null}
        {narrowMap ? (
          <MapSheet cards={cards} loading={loading} saved={saved} onSave={onSave} focusId={focusId} />
        ) : null}
      </div>
    </div>
  );
}

