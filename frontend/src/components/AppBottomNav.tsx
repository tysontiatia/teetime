import { Link, useLocation } from 'react-router-dom';

function SearchIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} />
      <path d="M16.2 16.2L20 20" stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} strokeLinecap="round" />
    </svg>
  );
}

function AlertsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M18 9a6 6 0 10-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9ZM10 20a2.2 2.2 0 004 0"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
  const p = location.pathname.replace(/\/$/, '') || '/';

  if (p.startsWith('/admin')) return null;

  const searchActive = p === '/' || p.startsWith('/course/');
  const alertsActive = p === '/account' || p.startsWith('/account/');
  const youActive =
    p === '/plan' ||
    p.startsWith('/plan/') ||
    p === '/share' ||
    p.startsWith('/share/');

  return (
    <nav className="app-bottom-nav" aria-label="Primary">
      <Link to="/" className={`app-bottom-nav-link${searchActive ? ' is-active' : ''}`} aria-current={searchActive ? 'page' : undefined}>
        <SearchIcon active={searchActive} />
        <span>Search</span>
      </Link>
      <Link
        to="/account"
        className={`app-bottom-nav-link${alertsActive ? ' is-active' : ''}`}
        aria-current={alertsActive ? 'page' : undefined}
      >
        <AlertsIcon active={alertsActive} />
        <span>Alerts</span>
      </Link>
      <Link
        to="/plan"
        className={`app-bottom-nav-link${youActive ? ' is-active' : ''}`}
        aria-current={youActive ? 'page' : undefined}
      >
        <YouIcon active={youActive} />
        <span>You</span>
      </Link>
    </nav>
  );
}
