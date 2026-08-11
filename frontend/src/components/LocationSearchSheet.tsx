import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Course } from '../types';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

export type LocationSearchSheetProps = {
  open: boolean;
  onClose: () => void;
  courses: Course[];
  /** Current committed location query (empty = Near me / area default). */
  currentQuery: string;
  /** True when GPS (or equivalent) is available for a true Near me. */
  locationAvailable?: boolean;
  onSelectNearMe: () => void;
  onSelectQuery: (query: string) => void;
  onSelectCourse: (course: Course) => void;
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function LocationSearchSheet({
  open,
  onClose,
  courses,
  currentQuery,
  locationAvailable = false,
  onSelectNearMe,
  onSelectQuery,
  onSelectCourse,
}: LocationSearchSheetProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    setDraft(currentQuery);
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, currentQuery, onClose]);

  const q = normalize(draft);

  const matchedCourses = useMemo(() => {
    if (!q) return [] as Course[];
    return courses
      .filter((c) =>
        [c.name, c.catalogName, c.city, c.area ?? '', c.address ?? ''].some((v) => normalize(v).includes(q)),
      )
      .slice(0, 8);
  }, [courses, q]);

  const matchedLocations = useMemo(() => {
    const cities = new Map<string, string>();
    for (const c of courses) {
      const city = c.city?.trim();
      if (!city || city === 'Utah' || city === 'WY') continue;
      const key = normalize(city);
      if (!cities.has(key)) cities.set(key, city);
    }
    const all = [...cities.values()].sort((a, b) => a.localeCompare(b));
    if (!q) return all.slice(0, 8);
    return all.filter((city) => normalize(city).includes(q)).slice(0, 8);
  }, [courses, q]);

  if (!open) return null;

  const nearMeActive = !currentQuery.trim();

  return (
    <div
      className="location-sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="location-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="location-sheet-handle" aria-hidden />
        <div className="location-sheet-head">
          <h2 id={titleId} className="location-sheet-title">
            Search
          </h2>
          <button type="button" className="location-sheet-close" onClick={onClose} aria-label="Close search">
            ✕
          </button>
        </div>

        <div className="location-sheet-input-wrap">
          <svg className="location-sheet-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.9" />
            <path d="M16.2 16.2L20 20" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="location-sheet-input"
            value={draft}
            placeholder="Search by city or course"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label="Search by city or course"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const trimmed = draft.trim();
                if (trimmed) onSelectQuery(trimmed);
                else onSelectNearMe();
                onClose();
              }
            }}
          />
          {draft ? (
            <button type="button" className="location-sheet-clear" onClick={() => setDraft('')} aria-label="Clear">
              ✕
            </button>
          ) : null}
        </div>

        <div className="location-sheet-body">
          <button
            type="button"
            className={`location-sheet-row${nearMeActive && !q ? ' is-active' : ''}`}
            onClick={() => {
              onSelectNearMe();
              onClose();
            }}
          >
            <span className="location-sheet-row-icon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 21s7-5.2 7-11a7 7 0 10-14 0c0 5.8 7 11 7 11z"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.9" />
              </svg>
            </span>
            <span className="location-sheet-row-text">
              <span className="location-sheet-row-title">
                {locationAvailable ? 'Near me' : 'Salt Lake area'}
              </span>
              <span className="location-sheet-row-sub">
                {locationAvailable
                  ? 'Courses around your location'
                  : 'Default area until location is available'}
              </span>
            </span>
            {nearMeActive && !q ? <span className="location-sheet-check" aria-hidden>✓</span> : null}
          </button>

          {matchedCourses.length > 0 ? (
            <div className="location-sheet-section">
              <div className="location-sheet-section-label">Courses</div>
              {matchedCourses.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="location-sheet-row"
                  onClick={() => {
                    onSelectCourse(c);
                    onClose();
                  }}
                >
                  <span className="location-sheet-row-icon" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M6 20V9l6-4 6 4v11"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path d="M10 20v-5h4v5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="location-sheet-row-text">
                    <span className="location-sheet-row-title">{c.name}</span>
                    <span className="location-sheet-row-sub">{c.city || 'Utah'}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {matchedLocations.length > 0 ? (
            <div className="location-sheet-section">
              <div className="location-sheet-section-label">Locations</div>
              {matchedLocations.map((city) => (
                <button
                  key={city}
                  type="button"
                  className={`location-sheet-row${normalize(currentQuery) === normalize(city) ? ' is-active' : ''}`}
                  onClick={() => {
                    onSelectQuery(city);
                    onClose();
                  }}
                >
                  <span className="location-sheet-row-icon" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M12 21s7-5.2 7-11a7 7 0 10-14 0c0 5.8 7 11 7 11z"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinejoin="round"
                      />
                      <circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.9" />
                    </svg>
                  </span>
                  <span className="location-sheet-row-text">
                    <span className="location-sheet-row-title">{city}</span>
                    <span className="location-sheet-row-sub">UT</span>
                  </span>
                  {normalize(currentQuery) === normalize(city) ? (
                    <span className="location-sheet-check" aria-hidden>
                      ✓
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          {q && matchedCourses.length === 0 && matchedLocations.length === 0 ? (
            <p className="location-sheet-empty">No Utah courses or cities match “{draft.trim()}”.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
