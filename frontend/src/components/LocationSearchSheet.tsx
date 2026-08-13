import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Course } from '../types';
import { formatCityState } from '../lib/courseRecord';
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

type LocationOption = {
  /** Query committed on select — includes state when known ("Eagle, ID"). */
  query: string;
  title: string;
  stateLabel: string;
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericCity(city: string): boolean {
  const n = normalize(city);
  return !n || n === 'utah' || n === 'idaho' || n === 'wy' || n === 'wyoming';
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
  const currentQ = normalize(currentQuery);

  const matchedCourses = useMemo(() => {
    if (!q) return [] as Course[];
    return courses
      .filter((c) =>
        [c.name, c.catalogName, c.city, formatCityState(c.city, c.state), c.state ?? '', c.area ?? '', c.address ?? ''].some(
          (v) => normalize(v).includes(q),
        ),
      )
      .slice(0, 8);
  }, [courses, q]);

  const matchedLocations = useMemo(() => {
    const cities = new Map<string, LocationOption>();
    for (const c of courses) {
      const city = c.city?.trim();
      if (!city || isGenericCity(city)) continue;
      const state = String(c.state || '').trim().toUpperCase();
      const title = formatCityState(city, state);
      const key = normalize(title);
      if (!cities.has(key)) {
        cities.set(key, {
          query: title,
          title,
          stateLabel: state || '—',
        });
      }
    }
    const all = [...cities.values()].sort((a, b) => a.title.localeCompare(b.title));
    if (!q) return all.slice(0, 8);
    return all.filter((loc) => normalize(loc.title).includes(q) || normalize(loc.stateLabel).includes(q)).slice(0, 8);
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
                    <span className="location-sheet-row-sub">
                      {formatCityState(c.city, c.state) || c.city || '—'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {matchedLocations.length > 0 ? (
            <div className="location-sheet-section">
              <div className="location-sheet-section-label">Locations</div>
              {matchedLocations.map((loc) => {
                const active = currentQ === normalize(loc.query);
                return (
                  <button
                    key={loc.query}
                    type="button"
                    className={`location-sheet-row${active ? ' is-active' : ''}`}
                    onClick={() => {
                      onSelectQuery(loc.query);
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
                      <span className="location-sheet-row-title">{loc.title}</span>
                      <span className="location-sheet-row-sub">{loc.stateLabel}</span>
                    </span>
                    {active ? (
                      <span className="location-sheet-check" aria-hidden>
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {q && matchedCourses.length === 0 && matchedLocations.length === 0 ? (
            <p className="location-sheet-empty">No courses or cities match “{draft.trim()}”.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
