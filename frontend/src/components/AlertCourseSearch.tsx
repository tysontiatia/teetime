import { useEffect, useMemo, useRef, useState } from 'react';
import type { Course } from '../types';
import { formatCityState } from '../lib/courseRecord';
import { CoursePhoto } from './CoursePhoto';
import { FindIcon } from './icons/AppIcons';

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchScore(course: Course, q: string): number | null {
  const name = normalize(course.name);
  const catalog = normalize(course.catalogName);
  const city = normalize(course.city);
  const loc = normalize(formatCityState(course.city, course.state));
  const area = normalize(course.area ?? '');
  const address = normalize(course.address ?? '');
  const haystacks = [name, catalog, city, loc, area, address];
  if (!haystacks.some((v) => v.includes(q))) return null;
  if (name === q || catalog === q) return 0;
  if (name.startsWith(q) || catalog.startsWith(q)) return 1;
  if (name.includes(q) || catalog.includes(q)) return 2;
  if (city.startsWith(q) || loc.startsWith(q)) return 3;
  return 4;
}

export function AlertCourseSearch({
  courses,
  onPick,
}: {
  courses: Course[];
  onPick: (course: Course) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, []);

  const q = normalize(draft);
  const matches = useMemo(() => {
    if (!q) return [] as Course[];
    return courses
      .map((c) => {
        const score = matchScore(c, q);
        return score == null ? null : { c, score, name: c.name };
      })
      .filter((row): row is { c: Course; score: number; name: string } => row != null)
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((row) => row.c);
  }, [courses, q]);

  return (
    <div className="alert-course-search">
      <div className="alert-course-search-input-wrap">
        <FindIcon size={18} className="alert-course-search-icon" />
        <input
          ref={inputRef}
          className="alert-course-search-input"
          value={draft}
          placeholder="Course or city"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          aria-label="Search for a course"
          onChange={(e) => setDraft(e.target.value)}
        />
        {draft ? (
          <button
            type="button"
            className="alert-course-search-clear"
            aria-label="Clear search"
            onClick={() => {
              setDraft('');
              inputRef.current?.focus();
            }}
          >
            ✕
          </button>
        ) : null}
      </div>

      {!q ? (
        <p className="alert-course-search-hint">
          {courses.length === 0
            ? 'Loading courses…'
            : 'Try a course or city — Bonneville, The Ridge, St. George…'}
        </p>
      ) : matches.length === 0 ? (
        <p className="alert-course-search-hint">
          {courses.length === 0 ? 'Loading courses…' : 'No live courses match that search.'}
        </p>
      ) : (
        <div className="alert-course-hits" role="listbox" aria-label="Matching courses">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              className="alert-course-hit"
              onClick={() => onPick(c)}
            >
              <span className="alert-course-hit-thumb" aria-hidden>
                <CoursePhoto src={c.photoUrl} height={44} className="alert-course-hit-photo" style={{ height: '100%' }} />
              </span>
              <span className="alert-course-hit-text">
                <span className="alert-course-hit-title">{c.name}</span>
                <span className="alert-course-hit-sub">{formatCityState(c.city, c.state) || c.city || '—'}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
