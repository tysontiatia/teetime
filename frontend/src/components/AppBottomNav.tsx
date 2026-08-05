import { Link, useLocation } from 'react-router-dom';
import { useOpeningsPreview } from '../state/OpeningsPreviewContext';

function SearchIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} />
      <path d="M16.2 16.2L20 20" stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} strokeLinecap="round" />
    </svg>
  );
}

function OpeningsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 11h16M4 7h10M4 15h14M4 19h8"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.9}
        strokeLinecap="round"
      />
      <circle cx="18" cy="7" r="2.5" stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} />
    </svg>
  );
}

function YouIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="9" r="3.5" stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} />
      <path
        d="M5.5 19.5c1.2-3.2 3.5-4.8 6.5-4.8s5.3 1.6 6.5 4.8"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.9}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AppBottomNav() {
  const location = useLocation();
  const { openCount } = useOpeningsPreview();
  const p = location.pathname.replace(/\/$/, '') || '/';

  if (p.startsWith('/admin')) return null;

  const searchActive = p === '/' || p.startsWith('/course/');
  const openingsActive = p === '/feed' || p.startsWith('/feed/');
  const youActive =
    p === '/account' ||
    p.startsWith('/account/') ||
    p === '/plan' ||
    p.startsWith('/plan/') ||
    p === '/share' ||
    p.startsWith('/share/');

  const badge = openCount > 0 ? (openCount > 99 ? '99+' : String(openCount)) : null;

  return (
    <nav className="app-bottom-nav" aria-label="Primary">
      <Link to="/" className={`app-bottom-nav-link${searchActive ? ' is-active' : ''}`} aria-current={searchActive ? 'page' : undefined}>
        <SearchIcon active={searchActive} />
        <span>Search</span>
      </Link>
      <Link
        to="/feed"
        className={`app-bottom-nav-link${openingsActive ? ' is-active' : ''}`}
        aria-current={openingsActive ? 'page' : undefined}
      >
        <span className="app-bottom-nav-icon-wrap">
          <OpeningsIcon active={openingsActive} />
          {badge ? <span className="app-bottom-nav-badge">{badge}</span> : null}
        </span>
        <span>Openings</span>
      </Link>
      <Link
        to="/account"
        className={`app-bottom-nav-link${youActive ? ' is-active' : ''}`}
        aria-current={youActive ? 'page' : undefined}
      >
        <YouIcon active={youActive} />
        <span>You</span>
      </Link>
    </nav>
  );
}
