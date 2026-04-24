import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import type { Course, TeeTime } from '../types';
import { formatTime12h } from '../lib/time';

/** Matches `:root` --green-2 / --green in `index.css` */
const PIN_FILL = '#2d7a3a';
const PIN_STROKE = '#1a2e1a';

const coursePinIcon = L.divIcon({
  className: 'teetime-map-pin',
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" aria-hidden="true">
    <path fill="${PIN_FILL}" stroke="${PIN_STROKE}" stroke-width="1.1" stroke-linejoin="round"
      d="M14 1C8.2 1 3.5 5.7 3.5 11.4c0 6.8 9.1 22.6 10.5 24.6 1.4-2 10.5-17.8 10.5-24.6C24.5 5.7 19.8 1 14 1z"/>
    <circle cx="14" cy="11.4" r="3.6" fill="rgba(255,255,255,0.92)"/>
  </svg>`,
  iconSize: [28, 36],
  iconAnchor: [14, 34],
  popupAnchor: [0, -30],
});

/** Zoom level when centering on the user's location (regional “around me” view). */
const USER_AREA_ZOOM = 11;

function MapAutoView({
  courses,
  userLocation,
}: {
  courses: Course[];
  userLocation: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  const courseBoundsKey = useMemo(
    () =>
      courses
        .filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number')
        .map((c) => c.id)
        .sort()
        .join('|'),
    [courses],
  );

  useEffect(
    () => {
      if (userLocation) {
        map.setView([userLocation.lat, userLocation.lng], USER_AREA_ZOOM, { animate: false });
        return;
      }
      const pts = courses
        .filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number')
        .map((c) => [c.lat as number, c.lng as number] as [number, number]);
      if (pts.length >= 2) {
        map.fitBounds(pts, { padding: [30, 30], animate: false });
      } else if (pts.length === 1) {
        map.setView(pts[0], 12, { animate: false });
      }
    },
    // courseBoundsKey tracks which courses have coords; omit `courses` to avoid refit every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `courses` matches courseBoundsKey from the same render
    [map, userLocation, courseBoundsKey],
  );

  return null;
}

export function MapView({
  courses,
  timesByCourseId,
  onSelectCourse,
  userLocation = null,
}: {
  courses: Course[];
  timesByCourseId: Map<string, TeeTime[]>;
  onSelectCourse: (courseId: string) => void;
  userLocation?: { lat: number; lng: number } | null;
}) {
  const first = courses.find((c) => typeof c.lat === 'number' && typeof c.lng === 'number');
  const center: [number, number] = userLocation
    ? [userLocation.lat, userLocation.lng]
    : first
      ? [first.lat as number, first.lng as number]
      : [40.7608, -111.891];

  return (
    <div className="map-shell">
      <MapContainer center={center} zoom={USER_AREA_ZOOM} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapAutoView courses={courses} userLocation={userLocation} />
        {courses
          .filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number')
          .map((c) => {
            const times = timesByCourseId.get(c.id) ?? [];
            const top = times.slice(0, 3);
            return (
              <Marker key={c.id} position={[c.lat as number, c.lng as number]} icon={coursePinIcon}>
                <Popup>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ fontWeight: 900 }}>{c.name}</div>
                    <div style={{ color: '#666', fontSize: 12 }}>{c.city}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {top.map((t) => (
                        <span
                          key={t.id}
                          style={{
                            display: 'inline-flex',
                            padding: '4px 8px',
                            borderRadius: 999,
                            border: '1px solid rgba(45,122,58,0.22)',
                            background: 'rgba(233,245,234,0.85)',
                            color: '#2d7a3a',
                            fontWeight: 800,
                            fontSize: 12,
                          }}
                        >
                          {formatTime12h(t.startsAt)}
                        </span>
                      ))}
                      {times.length > top.length ? <span style={{ fontSize: 12, color: '#666' }}>+{times.length - top.length} more</span> : null}
                    </div>
                    <button
                      className="btn btn-primary"
                      style={{ marginTop: 10, width: '100%' }}
                      type="button"
                      onClick={() => onSelectCourse(c.id)}
                    >
                      Open course →
                    </button>
                  </div>
                </Popup>
              </Marker>
            );
          })}
      </MapContainer>
    </div>
  );
}

