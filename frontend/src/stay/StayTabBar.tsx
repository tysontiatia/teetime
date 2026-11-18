import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useIsCompactShell } from '../hooks/useMediaQuery';
import { useAlertActivity } from '../state/AlertActivityContext';
import { useAuth } from '../state/AuthContext';
import { useTheme, type ThemePreference } from '../state/ThemeContext';

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
];

function IconSearch() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.25" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 16.5 20 20.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 18.2 6.2 12.6a3.6 3.6 0 0 1 5.1-5.1L12 8.2l.7-.7a3.6 3.6 0 0 1 5.1 5.1L12 18.2z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 16.2V11a6 6 0 1 1 12 0v5.2l1.2 1.6H4.8L6 16.2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10 19.2a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconPlan() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 3.5v3M16 3.5v3M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconPerson() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8.5" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5.5 19.2c1.2-2.8 3.4-4.2 6.5-4.2s5.3 1.4 6.5 4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function StayTabBar({ onSignIn }: { onSignIn: () => void }) {
  const phone = useIsCompactShell();
  const { pathname } = useLocation();
  const { user, signOut } = useAuth();
  const { unreadCount } = useAlertActivity();
  const { preference, setPreference } = useTheme();
  const [accountOpen, setAccountOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const path = pathname.replace(/\/$/, '') || '/';
  const hide = !phone || path.startsWith('/course/') || path.startsWith('/admin');
  const badge = user && unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : null;
  const who = (user?.user_metadata?.full_name as string | undefined) || user?.email || '';

  useEffect(() => {
    setAccountOpen(false);
  }, [path]);

  useEffect(() => {
    if (!accountOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [accountOpen]);

  if (hide) return null;

  const find = path === '/' || path === '/search' || path.startsWith('/search/');
  const favorites = path.startsWith('/favorites');
  const alerts = path === '/account' || path.startsWith('/account/');
  const plan = path === '/plan' || path.startsWith('/plan/') || path === '/share' || path.startsWith('/share/') || path.startsWith('/round/');
  const account = accountOpen || path.startsWith('/pricing');

  return (
    <div ref={rootRef}>
      {accountOpen ? (
        <div className="stay-tab-sheet" role="dialog" aria-label="Account">
          {user ? <p className="stay-tab-who">{who}</p> : (
            <button
              type="button"
              className="stay-tab-row"
              onClick={() => {
                setAccountOpen(false);
                onSignIn();
              }}
            >
              Sign in
            </button>
          )}
          <Link to="/pricing" className="stay-tab-row">Pricing</Link>
          <div className="stay-tab-theme" role="radiogroup" aria-label="Appearance">
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={preference === option.value}
                className={`stay-tab-theme-opt${preference === option.value ? ' is-on' : ''}`}
                onClick={() => setPreference(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {user ? (
            <button
              type="button"
              className="stay-tab-row"
              onClick={() => {
                setAccountOpen(false);
                void signOut();
              }}
            >
              Sign out
            </button>
          ) : null}
        </div>
      ) : null}
      <nav className="stay-tabbar" aria-label="Primary">
        <Link to="/" aria-current={find ? 'page' : undefined} className={find ? 'is-on' : undefined}>
          <IconSearch />
          <span>Find</span>
        </Link>
        <Link to="/favorites" aria-current={favorites ? 'page' : undefined} className={favorites ? 'is-on' : undefined}>
          <IconHeart />
          <span>Favorites</span>
        </Link>
        <Link to="/account" aria-current={alerts ? 'page' : undefined} className={alerts ? 'is-on' : undefined}>
          <IconBell />
          <span>Alerts</span>
          {badge ? <span className="stay-tab-badge">{badge}</span> : null}
        </Link>
        <Link to="/plan" aria-current={plan ? 'page' : undefined} className={plan ? 'is-on' : undefined}>
          <IconPlan />
          <span>Plan</span>
        </Link>
        <button
          type="button"
          className={account ? 'is-on' : undefined}
          aria-expanded={accountOpen}
          aria-haspopup="dialog"
          onClick={() => setAccountOpen((open) => !open)}
        >
          <IconPerson />
          <span>Account</span>
        </button>
      </nav>
    </div>
  );
}
