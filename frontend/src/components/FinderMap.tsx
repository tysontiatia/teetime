import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Course, TeeTime, TimeOfDayPreset } from '../types';
import { mapStyleUrl } from '../lib/env';
import { formatCityState, resolveCourseBookingMode, type CourseRecord } from '../lib/courseRecord';
import type { MapBounds } from '../lib/mapBounds';
import { formatTime12h } from '../lib/time';
import { courseTimezone } from '../lib/teeTimeInstant';
import { buildBookingUrl } from '../lib/bookingUrl';
import { liveTimesEmptyBadge } from '../lib/liveTimesEmpty';
import type { HolesFilter } from '../lib/holesFilter';

type PinTone = 'price' | 'open' | 'checking' | 'sold' | 'quiet';

type PinGroup = {
  id: string;
  lat: number;
  lng: number;
  courses: Course[];
};

setWorkerUrl(maplibreWorkerUrl);

function mapStyle(dark: boolean): string {
  return mapStyleUrl(dark);
}

function useDarkMap(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark',
  );
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.dataset.theme === 'dark');
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function clusterCell(zoom: number): number {
  if (zoom >= 12) return 0;
  if (zoom >= 10) return 64;
  return 92;
}

const HIDDEN_BASEMAP_LABELS = [
  'Highway shield',
  'Highway shield (US)',
  'Highway shield interstate (US)',
  'Highway shield interstate top (US)',
  'Highway junction',
];

/** Drop route shields and island names, and stop city names from looking like pins. */
function quietBasemap(map: MapLibreMap) {
  for (const id of HIDDEN_BASEMAP_LABELS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  }
  if (map.getLayer('Road labels')) {
    map.setFilter('Road labels', [
      'all',
      ['!in', 'subclass', 'gondola', 'cable_car'],
      ['!in', 'class', 'ferry', 'service', 'motorway'],
    ]);
  }
  if (map.getLayer('Place labels')) {
    map.setFilter('Place labels', [
      '!in',
      'class',
      'continent',
      'country',
      'state',
      'region',
      'province',
      'city',
      'town',
      'place',
      'island',
    ]);
  }
  for (const id of ['City labels', 'Town labels', 'Capital city labels']) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, 'icon-opacity', 0);
    map.setLayoutProperty(id, 'text-anchor', 'center');
    map.setLayoutProperty(id, 'text-offset', [0, 0]);
    map.setPaintProperty(id, 'text-color', 'hsl(0, 0%, 74%)');
    map.setPaintProperty(id, 'text-halo-color', 'hsla(150, 20%, 6%, 0.72)');
    map.setPaintProperty(id, 'text-halo-width', 1.2);
  }
}

function shortCourseName(name: string): string {
  const stripped = name
    .replace(/\s+(golf\s+(course|club|links|resort)|country\s+club)$/i, '')
    .trim();
  const base = stripped || name.trim();
  return base.length > 24 ? `${base.slice(0, 23)}…` : base;
}

function locatedCourses(courses: Course[]): Course[] {
  return courses.filter((course) => typeof course.lat === 'number' && typeof course.lng === 'number');
}

function clusterCourses(map: MapLibreMap, courses: Course[], zoom: number): PinGroup[] {
  const cell = clusterCell(zoom);
  const located = locatedCourses(courses);
  if (cell === 0) {
    return located.map((course) => ({
      id: course.id,
      lat: course.lat as number,
      lng: course.lng as number,
      courses: [course],
    }));
  }
  const buckets = new Map<string, Course[]>();
  for (const course of located) {
    const point = map.project([course.lng as number, course.lat as number]);
    const key = `${Math.floor(point.x / cell)}:${Math.floor(point.y / cell)}`;
    const list = buckets.get(key);
    if (list) list.push(course);
    else buckets.set(key, [course]);
  }
  const groups: PinGroup[] = [];
  for (const [key, list] of buckets) {
    const lat = list.reduce((sum, course) => sum + (course.lat as number), 0) / list.length;
    const lng = list.reduce((sum, course) => sum + (course.lng as number), 0) / list.length;
    groups.push({ id: list.length === 1 ? list[0].id : key, lat, lng, courses: list });
  }
  return groups;
}

function telHref(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits ? `tel:${digits}` : null;
}

function websiteHref(url: string | undefined | null): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function bookingSource(course: Course, record: CourseRecord | undefined) {
  return record ?? { platform: course.platform, booking_url: course.bookingUrl, timezone: course.timezone };
}

function pinTone(
  times: TeeTime[] | undefined,
  pending: boolean,
  fetched: boolean,
): { label: string; tone: PinTone } {
  if (pending && (!times || times.length === 0)) return { label: '…', tone: 'checking' };
  if (times && times.length > 0) {
    const prices = times
      .map((time) => time.price)
      .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
    if (prices.length === 0) return { label: 'Open', tone: 'open' };
    return { label: `$${Math.round(Math.min(...prices))}`, tone: 'price' };
  }
  if (fetched) return { label: 'Sold', tone: 'sold' };
  return { label: '', tone: 'quiet' };
}

function cheapestOpen(courses: Course[], timesByCourse: Map<string, TeeTime[]>): number | null {
  let min = Infinity;
  for (const course of courses) {
    const times = timesByCourse.get(course.id);
    if (!times) continue;
    for (const time of times) {
      if (typeof time.price === 'number' && time.price > 0 && time.price < min) min = time.price;
    }
  }
  return min < Infinity ? Math.round(min) : null;
}

function pinCopy(
  group: PinGroup,
  timesByCourse: Map<string, TeeTime[]>,
  pendingSlugs: Set<string>,
  fetchedSlugs: Set<string>,
  focus: Course | null,
): { price: string; name: string; tone: PinTone } {
  if (group.courses.length === 1) {
    const course = group.courses[0];
    const pin = pinTone(timesByCourse.get(course.id), pendingSlugs.has(course.id), fetchedSlugs.has(course.id));
    return { price: pin.label, name: shortCourseName(course.name), tone: pin.tone };
  }
  const price = cheapestOpen(group.courses, timesByCourse);
  const label = price != null ? `${group.courses.length} · $${price}` : `${group.courses.length}`;
  const tone: PinTone = price != null ? 'price' : 'quiet';
  return { price: label, name: focus ? shortCourseName(focus.name) : '', tone };
}

function pinButton(price: string, name: string, tone: PinTone, selected: boolean, hovered: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  const named = Boolean(name);
  button.className = ['finder-pin-pill', `is-${tone}`, named ? 'is-named' : '', selected ? 'is-selected' : '', hovered ? 'is-hover' : '']
    .filter(Boolean)
    .join(' ');
  const aria = [name, price].filter(Boolean).join(', ');
  if (aria) button.setAttribute('aria-label', aria);
  if (price) {
    const priceEl = document.createElement('span');
    priceEl.className = 'finder-pin-price';
    priceEl.textContent = price;
    button.append(priceEl);
  }
  if (name) {
    const nameEl = document.createElement('span');
    nameEl.className = 'finder-pin-name';
    nameEl.textContent = name;
    button.append(nameEl);
  }
  if (!price && !name) button.textContent = '•';
  return button;
}

type CardLink = {
  href: string;
  label: string;
  aria?: string;
  external?: boolean;
  primary?: boolean;
};

function selectionActions(
  course: Course,
  record: CourseRecord | undefined,
  times: TeeTime[],
  pending: boolean,
  fetched: boolean,
  detailHref: string,
  dateYmd: string,
  players: number,
  holes: HolesFilter,
  timeOfDay: TimeOfDayPreset,
): { status: string; links: CardLink[] } {
  const source = bookingSource(course, record);
  const mode = resolveCourseBookingMode(source);
  const viewCourse: CardLink = { href: detailHref, label: 'View course', primary: true };
  if (mode === 'phone' || mode === 'booking_link') {
    const call = telHref(record?.phone_number);
    const phone = record?.phone_number?.trim() || '';
    const site = websiteHref(record?.website);
    const book = buildBookingUrl(record ?? { bookingUrl: course.bookingUrl, platform: course.platform, timezone: course.timezone }, {
      dateYmd,
      players,
      holes: holes === 9 ? 9 : 18,
    });
    const links: CardLink[] = [];
    if (mode === 'booking_link' && book) {
      links.push({ href: book, label: 'Book on site', external: true, primary: true });
    }
    if (call && phone) {
      links.push({
        href: call,
        label: 'Call',
        aria: `Call ${course.name} pro shop at ${phone}`,
        primary: links.length === 0,
      });
    }
    if (mode === 'phone' && site) {
      links.push({ href: site, label: 'Website', external: true, primary: links.length === 0 });
    }
    if (links.length === 0) links.push(viewCourse);
    return {
      status: mode === 'phone' ? 'Book by phone' : 'Book on their site',
      links,
    };
  }
  if (times.length > 0) {
    const next = times[0];
    const when = formatTime12h(next.startsAt, courseTimezone(course.timezone));
    const price = typeof next.price === 'number' ? ` · $${Math.round(next.price)}` : '';
    return {
      status: `${when}${price}`,
      links: [{ href: detailHref, label: 'View times', primary: true }],
    };
  }
  if (pending) return { status: 'Checking times…', links: [] };
  if (fetched) {
    const narrowed = timeOfDay !== 'any' || holes === 9;
    return {
      status: narrowed ? liveTimesEmptyBadge(timeOfDay, holes).label : 'Sold out',
      links: [viewCourse],
    };
  }
  return { status: '', links: [viewCourse] };
}

function boundsOf(courses: Course[]): [[number, number], [number, number]] | null {
  const located = locatedCourses(courses);
  if (located.length === 0) return null;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const course of located) {
    const lat = course.lat as number;
    const lng = course.lng as number;
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  return [
    [west, south],
    [east, north],
  ];
}

type Props = {
  courses: Course[];
  timesByCourse: Map<string, TeeTime[]>;
  pendingSlugs: Set<string>;
  fetchedSlugs: Set<string>;
  selectedId: string | null;
  hoveredId: string | null;
  anchor: { lat: number; lng: number };
  lockView: boolean;
  recordsBySlug: Map<string, CourseRecord>;
  dateYmd: string;
  players: number;
  holes: HolesFilter;
  timeOfDay: TimeOfDayPreset;
  detailHref: (course: Course) => string;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onSearchArea: (bounds: MapBounds) => void;
};

export function FinderMap({
  courses,
  timesByCourse,
  pendingSlugs,
  fetchedSlugs,
  selectedId,
  hoveredId,
  anchor,
  lockView,
  recordsBySlug,
  dateYmd,
  players,
  holes,
  timeOfDay,
  detailHref,
  onSelect,
  onHover,
  onSearchArea,
}: Props) {
  const dark = useDarkMap();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const quietMoveRef = useRef(false);
  const gestureRef = useRef(false);
  const pinClickRef = useRef(false);
  const fittedKeyRef = useRef<string | null>(null);
  const lastSelectedRef = useRef<string | null>(null);
  const styleUrlRef = useRef(mapStyle(dark));
  const [mapReady, setMapReady] = useState(false);
  const [zoom, setZoom] = useState(11);
  const [searchBounds, setSearchBounds] = useState<MapBounds | null>(null);
  const anchorRef = useRef(anchor);
  const onSelectRef = useRef(onSelect);
  const onHoverRef = useRef(onHover);
  const onSearchRef = useRef(onSearchArea);
  const onClearRef = useRef<() => void>(() => {});

  useEffect(() => {
    anchorRef.current = anchor;
    onSelectRef.current = onSelect;
    onHoverRef.current = onHover;
    onSearchRef.current = onSearchArea;
    onClearRef.current = () => onSelect(null);
  }, [anchor, onHover, onSearchArea, onSelect]);

  const searchKey = `${anchor.lat.toFixed(3)},${anchor.lng.toFixed(3)}`;
  const located = locatedCourses(courses);
  const selected = located.find((course) => course.id === selectedId) ?? null;
  const selectedTimes = selected ? (timesByCourse.get(selected.id) ?? []) : [];
  const place = selected ? formatCityState(selected.city, selected.state) : '';
  const selectedCard = selected
    ? selectionActions(
        selected,
        recordsBySlug.get(selected.id),
        selectedTimes,
        pendingSlugs.has(selected.id),
        fetchedSlugs.has(selected.id),
        detailHref(selected),
        dateYmd,
        players,
        holes,
        timeOfDay,
      )
    : null;
  const miles = selected && typeof selected.distanceMi === 'number' ? `${selected.distanceMi.toFixed(1)} mi` : '';

  const runQuiet = useCallback((run: () => void) => {
    quietMoveRef.current = true;
    run();
    window.setTimeout(() => {
      quietMoveRef.current = false;
    }, 1100);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    const map = new MapLibreMap({
      container,
      style: styleUrlRef.current,
      center: [anchorRef.current.lng, anchorRef.current.lat],
      zoom: 11,
      minZoom: 3.5,
      maxZoom: 18,
      attributionControl: { compact: false },
      cancelPendingTileRequestsWhileZooming: false,
      fadeDuration: 0,
    });
    map.addControl(new NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right');
    map.on('style.load', () => quietBasemap(map));
    if (map.isStyleLoaded()) quietBasemap(map);
    map.scrollZoom.setZoomRate(1 / 90);
    map.scrollZoom.setWheelZoomRate(1 / 320);
    map.on('zoomstart', (event) => {
      if (event.originalEvent) gestureRef.current = true;
    });
    map.on('dragstart', () => {
      gestureRef.current = true;
    });
    map.on('zoomend', () => setZoom(map.getZoom()));
    map.on('moveend', () => {
      if (quietMoveRef.current) {
        quietMoveRef.current = false;
        return;
      }
      if (!gestureRef.current) return;
      gestureRef.current = false;
      const bounds = map.getBounds();
      setSearchBounds({
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
      });
    });
    map.on('click', () => {
      if (pinClickRef.current) {
        pinClickRef.current = false;
        return;
      }
      onClearRef.current();
    });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container);
    mapRef.current = map;
    setMapReady(true);
    return () => {
      resize.disconnect();
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const nextStyle = mapStyle(dark);
    if (styleUrlRef.current === nextStyle) return;
    styleUrlRef.current = nextStyle;
    map.setStyle(nextStyle);
  }, [dark, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || lockView || courses.length === 0 || fittedKeyRef.current === searchKey) return;
    const points = locatedCourses(courses);
    const bounds = boundsOf(points);
    if (!bounds) return;
    fittedKeyRef.current = searchKey;
    map.resize();
    runQuiet(() => {
      if (points.length === 1) {
        map.easeTo({
          center: [points[0].lng as number, points[0].lat as number],
          zoom: 14,
          duration: 900,
        });
        return;
      }
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 900 });
    });
  }, [courses, lockView, mapReady, runQuiet, searchKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!selectedId) {
      lastSelectedRef.current = null;
      return;
    }
    if (selectedId === lastSelectedRef.current) return;
    lastSelectedRef.current = selectedId;
    const course = courses.find((item) => item.id === selectedId);
    if (!course || typeof course.lat !== 'number' || typeof course.lng !== 'number') return;
    const point: [number, number] = [course.lng, course.lat];
    if (map.getBounds().contains(point)) return;
    runQuiet(() => map.easeTo({ center: point, duration: 700 }));
  }, [courses, mapReady, runQuiet, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    markersRef.current.forEach((marker) => marker.remove());
    const groups = clusterCourses(map, courses, map.getZoom());
    const markers: Marker[] = [];
    for (const group of groups) {
      const focus =
        group.courses.find((course) => course.id === selectedId) ??
        group.courses.find((course) => course.id === hoveredId) ??
        null;
      const pin = pinCopy(group, timesByCourse, pendingSlugs, fetchedSlugs, focus);
      const selected = group.courses.some((course) => course.id === selectedId);
      const hovered = group.courses.some((course) => course.id === hoveredId);
      const button = pinButton(pin.price, pin.name, pin.tone, selected, hovered);
      const single = group.courses.length === 1 ? group.courses[0] : null;
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        pinClickRef.current = true;
        if (single) {
          onSelectRef.current(single.id);
          return;
        }
        const bounds = boundsOf(group.courses);
        if (!bounds) return;
        runQuiet(() => map.fitBounds(bounds, { padding: 72, maxZoom: 16, duration: 800 }));
      });
      if (single) {
        button.addEventListener('mouseenter', () => onHoverRef.current(single.id));
        button.addEventListener('mouseleave', () => onHoverRef.current(null));
      }
      const marker = new Marker({ element: button, anchor: 'bottom' })
        .setLngLat([group.lng, group.lat])
        .addTo(map);
      if (selected || hovered) marker.getElement().style.zIndex = '3';
      markers.push(marker);
    }
    markersRef.current = markers;
  }, [courses, fetchedSlugs, hoveredId, mapReady, pendingSlugs, runQuiet, selectedId, timesByCourse, zoom]);

  return (
    <div className="finder-map">
      <div ref={containerRef} className="finder-map-canvas" />

      {searchBounds ? (
        <button
          type="button"
          className="finder-map-search"
          onClick={() => {
            onSearchRef.current(searchBounds);
            setSearchBounds(null);
          }}
        >
          Search this area
        </button>
      ) : null}

      {located.length === 0 ? (
        <p className="finder-map-empty">No courses in this view yet. Move the map and search this area.</p>
      ) : null}

      {selected ? (
        <div className="finder-map-card">
          <Link to={detailHref(selected)} className="finder-map-card-photo" aria-label={selected.name}>
            {selected.photoUrl ? (
              <img src={selected.photoUrl} alt="" />
            ) : (
              <span className="finder-map-card-fallback" aria-hidden>
                ⛳
              </span>
            )}
          </Link>
          <div className="finder-map-card-body">
            <div className="finder-map-card-top">
              <Link to={detailHref(selected)} className="finder-map-card-name">
                {selected.name}
              </Link>
              <button type="button" className="finder-map-card-close" aria-label="Close" onClick={() => onSelect(null)}>
                ×
              </button>
            </div>
            <p className="finder-map-card-meta">
              {typeof selected.rating === 'number' ? (
                <span className="course-rating course-rating--muted">
                  <span className="star-gold" aria-hidden>
                    ★
                  </span>{' '}
                  {selected.rating.toFixed(1)}
                </span>
              ) : null}
              {place ? <span>{place}</span> : null}
              {miles ? <span>{miles}</span> : null}
              {selectedTimes.length > 0 ? <span>{selectedTimes.length} open</span> : null}
            </p>
            <div className="finder-map-card-row">
              {selectedCard?.status ? (
                <span className={`finder-map-card-when${selectedCard.status === 'Sold out' ? ' is-soldout' : ''}`}>
                  {selectedCard.status}
                </span>
              ) : null}
              <div className="finder-map-card-actions">
                {selectedCard?.links.map((link) => {
                  const className = `btn ${link.primary ? 'btn-primary' : 'btn-ghost'} finder-map-card-go`;
                  if (link.external || link.href.startsWith('tel:')) {
                    return (
                      <a
                        key={`${link.label}-${link.href}`}
                        className={className}
                        href={link.href}
                        aria-label={link.aria}
                        {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                      >
                        {link.label}
                      </a>
                    );
                  }
                  return (
                    <Link key={`${link.label}-${link.href}`} to={link.href} className={className}>
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
