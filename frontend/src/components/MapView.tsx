import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import type { Course, TeeTime } from '../types';
import { formatTime12h } from '../lib/time';

// Fix default marker icons for Vite bundling
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function FitBounds({ courses }: { courses: Course[] }) {
  const map = useMap();
  const pts = courses
    .filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number')
    .map((c) => [c.lat as number, c.lng as number] as [number, number]);
  if (pts.length >= 2) {
    map.fitBounds(pts, { padding: [30, 30] });
  } else if (pts.length === 1) {
    map.setView(pts[0], 12);
  }
  return null;
}

export function MapView({
  courses,
  timesByCourseId,
  onSelectCourse,
}: {
  courses: Course[];
  timesByCourseId: Map<string, TeeTime[]>;
  onSelectCourse: (courseId: string) => void;
}) {
  const first = courses.find((c) => typeof c.lat === 'number' && typeof c.lng === 'number');
  const center: [number, number] = first ? [first.lat as number, first.lng as number] : [40.7608, -111.891];

  return (
    <div className="map-shell">
      <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds courses={courses} />
        {courses
          .filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number')
          .map((c) => {
            const times = timesByCourseId.get(c.id) ?? [];
            const top = times.slice(0, 3);
            return (
              <Marker key={c.id} position={[c.lat as number, c.lng as number]}>
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

