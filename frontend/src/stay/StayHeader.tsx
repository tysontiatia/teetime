import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserAvatar } from '../components/UserAvatar';
import { profileAvatarUrlFromUser } from '../lib/profileAvatar';
import { useAuth } from '../state/AuthContext';
import { useTheme, type ThemePreference } from '../state/ThemeContext';

export function usePhoneLayout() {
  const [phone, setPhone] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)');
    const apply = () => setPhone(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
  return phone;
}

const NAV = [
  { to: '/favorites', label: 'Favorites', on: (path: string) => path.startsWith('/favorites') },
  { to: '/account', label: 'Alerts', on: (path: string) => path === '/account' || path.startsWith('/account/') },
  { to: '/plan', label: 'Plan', on: (path: string) => path === '/plan' || path.startsWith('/plan/') },
  { to: '/pricing', label: 'Pricing', on: (path: string) => path.startsWith('/pricing') },
];

export function StayPrimaryNav() {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/$/, '') || '/';
  return (
    <div className="stay-nav">
      {NAV.map((item) => {
        const current = item.on(path);
        return (
          <Link key={item.to} to={item.to} aria-current={current ? 'page' : undefined} className={current ? 'is-on' : undefined}>
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

function PersonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
      <path fill="currentColor" d="M16 16a6 6 0 1 0 0-12 6 6 0 0 0 0 12zm0 2c-5.3 0-12 2.7-12 8v2h24v-2c0-5.3-6.7-8-12-8z" />
    </svg>
  );
}

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
];

export function StayAccount() {
  const { user, loading } = useAuth();
  const { preference, setPreference } = useTheme();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const avatar = profileAvatarUrlFromUser(user);
  const initial = (user?.user_metadata?.full_name?.[0] || user?.email?.[0] || '?').toUpperCase();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const face = loading ? (
    <span className="stay-avatar" aria-hidden />
  ) : user ? (
    <UserAvatar src={avatar} initial={initial} size={40} className="stay-avatar-photo" />
  ) : (
    <PersonIcon />
  );

  return (
    <div className="stay-account" ref={menuRef}>
      <button
        type="button"
        className={`stay-avatar${user ? ' is-user' : ''}`}
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {face}
      </button>
      {open ? (
        <div className="stay-menu">
          <Link to="/account">Account</Link>
          <div className="stay-menu-theme" role="radiogroup" aria-label="Appearance">
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={preference === option.value}
                className={`stay-menu-theme-opt${preference === option.value ? ' is-on' : ''}`}
                onClick={() => setPreference(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
