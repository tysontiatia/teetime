import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents, ZoomControl } from 'react-leaflet';
import type { Course, TeeTime } from '../types';
import { formatCityState } from '../lib/courseRecord';
import { formatTime12h } from '../lib/time';
import { courseTimezone } from '../lib/teeTimeInstant';

export type MapBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export function courseInMapBounds(course: { lat?: number; lng?: number }, bounds: MapBounds): boolean {
  if (typeof course.lat !== 'number' || typeof course.lng !== 'number') return false;
  return (
    course.lat >= bounds.south &&
    course.lat <= bounds.north &&
    course.lng >= bounds.west &&
    course.lng <= bounds.east
  );
}

type PinTone = 'price' | 'open' | 'checking' | 'sold' | 'quiet';

type PinGroup = {
  id: string;
  lat: number;
  lng: number;
  courses: Course[];
};

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

export function pinTone(
  times: TeeTime[] | undefined,
  pending: boolean,
  fetched: boolean,
): { label: string; tone: PinTone } {
  if (pending && (!times || times.length === 0)) return { label: '…', tone: 'checking' };
  if (times && times.length > 0) {
    const prices = times
      .map((t) => t.price)
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
    if (prices.length === 0) return { label: 'Open', tone: 'open' };
    return { label: `$${Math.round(Math.min(...prices))}`, tone: 'price' };
  }
  if (fetched) return { label: 'Sold', tone: 'sold' };
  return { label: '', tone: 'quiet' };
}

function clusterCourses(map: L.Map, courses: Course[], zoom: number): PinGroup[] {
  const cell = zoom >= 13 ? 0 : zoom >= 11 ? 52 : zoom >= 9 ? 70 : 88;
  const located = courses.filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number');
  if (cell === 0) {
    return located.map((c) => ({ id: c.id, lat: c.lat as number, lng: c.lng as number, courses: [c] }));
  }
  const buckets = new Map<string, Course[]>();
  for (const course of located) {
    const point = map.project([course.lat as number, course.lng as number], zoom);
    const key = `${Math.floor(point.x / cell)}:${Math.floor(point.y / cell)}`;
    const list = buckets.get(key);
    if (list) list.push(course);
    else buckets.set(key, [course]);
  }
  const groups: PinGroup[] = [];
  for (const [key, list] of buckets) {
    const lat = list.reduce((sum, c) => sum + (c.lat as number), 0) / list.length;
    const lng = list.reduce((sum, c) => sum + (c.lng as number), 0) / list.length;
    groups.push({ id: list.length === 1 ? list[0].id : key, lat, lng, courses: list });
  }
  return groups;
}

function pinIcon(label: string, tone: PinTone, selected: boolean, hovered: boolean): L.DivIcon {
  const quiet = tone === 'quiet' && !label;
  const cls = [
    quiet ? 'finder-pin-dot' : 'finder-pin-pill',
    `is-${tone}`,
    selected ? 'is-selected' : '',
    hovered ? 'is-hover' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const width = quiet ? 14 : Math.max(46, label.length * 9 + 18);
  const height = quiet ? 14 : 30;
  return L.divIcon({
    className: 'finder-pin',
    html: `<span class="${cls}">${label}</span>`,
    iconSize: [width, height],
    iconAnchor: [width / 2, height],
  });
}

function MapController({
  courses,
  lockView,
  selectedId,
  onUserMove,
  onClear,
}: {
  courses: Course[];
  lockView: boolean;
  selectedId: string | null;
  onUserMove: (bounds: MapBounds) => void;
  onClear: () => void;
}) {
  const map = useMap();
  const fittedKey = useRef<string | null>(null);
  const programmatic = useRef(false);
  const lastSelected = useRef<string | null>(null);
  const courseKey = courses.map((c) => c.id).join('|');

  const moveQuietly = (run: () => void) => {
    programmatic.current = true;
    run();
    window.setTimeout(() => {
      programmatic.current = false;
    }, 600);
  };

  useEffect(() => {
    if (lockView || courses.length === 0 || fittedKey.current === courseKey) return;
    fittedKey.current = courseKey;
    moveQuietly(() => {
      if (courses.length === 1 && typeof courses[0].lat === 'number' && typeof courses[0].lng === 'number') {
        map.setView([courses[0].lat, courses[0].lng], 12);
        return;
      }
      const bounds = L.latLngBounds(
        courses
          .filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number')
          .map((c) => [c.lat as number, c.lng as number] as [number, number]),
      );
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    });
  }, [courseKey, courses, lockView, map]);

  useEffect(() => {
    if (!selectedId) {
      lastSelected.current = null;
      return;
    }
    if (selectedId === lastSelected.current) return;
    lastSelected.current = selectedId;
    const course = courses.find((c) => c.id === selectedId);
    if (!course || typeof course.lat !== 'number' || typeof course.lng !== 'number') return;
    const point = L.latLng(course.lat, course.lng);
    if (map.getBounds().contains(point)) return;
    moveQuietly(() => map.panTo(point));
  }, [courses, map, selectedId]);

  useMapEvents({
    moveend: () => {
      if (programmatic.current) {
        programmatic.current = false;
        return;
      }
      const bounds = map.getBounds();
      onUserMove({
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
      });
    },
    click: () => onClear(),
  });

  return null;
}

function PinLayer({
  courses,
  timesByCourse,
  pendingSlugs,
  fetchedSlugs,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
}: {
  courses: Course[];
  timesByCourse: Map<string, TeeTime[]>;
  pendingSlugs: Set<string>;
  fetchedSlugs: Set<string>;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  const groups = useMemo(() => clusterCourses(map, courses, zoom), [map, courses, zoom]);

  return (
    <>
      {groups.map((group) => {
        const single = group.courses.length === 1 ? group.courses[0] : null;
        const pin = single
          ? pinTone(timesByCourse.get(single.id), pendingSlugs.has(single.id), fetchedSlugs.has(single.id))
          : { label: `+${group.courses.length}`, tone: 'price' as PinTone };
        const selected = group.courses.some((c) => c.id === selectedId);
        const hovered = group.courses.some((c) => c.id === hoveredId);
        return (
          <Marker
            key={group.id}
            position={[group.lat, group.lng]}
            icon={pinIcon(pin.label, single ? pin.tone : 'price', selected, hovered)}
            zIndexOffset={selected || hovered ? 800 : 0}
            eventHandlers={{
              click: (event) => {
                L.DomEvent.stopPropagation(event.originalEvent);
                if (single) {
                  onSelect(single.id);
                  return;
                }
                map.flyTo([group.lat, group.lng], Math.min(map.getZoom() + 2, 14));
              },
              mouseover: () => onHover(single?.id ?? null),
              mouseout: () => onHover(null),
            }}
          />
        );
      })}
    </>
  );
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
  detailHref,
  onSelect,
  onHover,
  onSearchArea,
}: Props) {
  const dark = useDarkMap();
  const [searchBounds, setSearchBounds] = useState<MapBounds | null>(null);
  const pinClick = useRef(false);
  const located = courses.filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number');
  const selected = located.find((c) => c.id === selectedId) ?? null;
  const selectedTimes = selected ? (timesByCourse.get(selected.id) ?? []) : [];
  const next = selectedTimes[0];
  const place = selected ? formatCityState(selected.city, selected.state) : '';
  const miles =
    selected && typeof selected.distanceMi === 'number' ? `${selected.distanceMi.toFixed(1)} mi` : '';

  return (
    <div className="finder-map">
      <MapContainer
        center={[anchor.lat, anchor.lng]}
        zoom={11}
        zoomControl={false}
        scrollWheelZoom
      >
        <TileLayer
          attribution="Tiles &copy; Esri"
          url={
            dark
              ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
              : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'
          }
        />
        <TileLayer
          url={
            dark
              ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
              : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
          }
        />
        <ZoomControl position="topright" />
        <MapController
          courses={located}
          lockView={lockView}
          selectedId={selectedId}
          onUserMove={(bounds) => setSearchBounds(bounds)}
          onClear={() => {
            if (pinClick.current) {
              pinClick.current = false;
              return;
            }
            onSelect(null);
          }}
        />
        <PinLayer
          courses={located}
          timesByCourse={timesByCourse}
          pendingSlugs={pendingSlugs}
          fetchedSlugs={fetchedSlugs}
          selectedId={selectedId}
          hoveredId={hoveredId}
          onSelect={(id) => {
            pinClick.current = true;
            onSelect(id);
          }}
          onHover={onHover}
        />
      </MapContainer>

      {searchBounds ? (
        <button
          type="button"
          className="finder-map-search"
          onClick={() => {
            onSearchArea(searchBounds);
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
              <button
                type="button"
                className="finder-map-card-close"
                aria-label="Close"
                onClick={() => onSelect(null)}
              >
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
              <span className="finder-map-card-when">
                {next
                  ? `${formatTime12h(next.startsAt, courseTimezone(selected.timezone))}${
                      typeof next.price === 'number' ? ` · $${Math.round(next.price)}` : ''
                    }`
                  : pendingSlugs.has(selected.id)
                    ? 'Checking times…'
                    : 'No openings'}
              </span>
              <Link to={detailHref(selected)} className="btn btn-primary finder-map-card-go">
                View times
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
