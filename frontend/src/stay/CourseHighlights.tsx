import type { CourseHighlight } from './coursePlay';

export function CourseHighlights({ highlights }: { highlights: CourseHighlight[] }) {
  if (highlights.length === 0) return null;
  return (
    <ul className="stay-highlights">
      {highlights.map((row) => (
        <li key={row.id} className="stay-highlight">
          <HighlightIcon id={row.id} />
          <div>
            <strong>{row.title}</strong>
            {row.detail ? <span>{row.detail}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function HighlightIcon({ id }: { id: CourseHighlight['id'] }) {
  if (id === 'play') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4.5 16.5a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M12 16.5 15.4 10.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="12" cy="16.5" r="1.15" fill="currentColor" />
      </svg>
    );
  }
  if (id === 'site') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="7.4" r="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 10v3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M8.8 19.2 12 13.2l3.2 6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5.5 21V3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M5.5 4.4h12.2L14.4 8.2l3.3 3.8H5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
