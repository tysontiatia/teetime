import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { profileAvatarUrlFromUser } from '../lib/profileAvatar';
import { UserAvatar } from './UserAvatar';
import { UserMenu } from './UserMenu';

function AvatarChip({ avatar, initial }: { avatar?: string; initial: string }) {
  return <UserAvatar src={avatar} initial={initial} size={34} className="app-header-avatar-chip" />;
}

function FlagMark() {
  return (
    <span className="app-header-logo-flag" aria-hidden>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <path
          d="M6 21V4M6 4l11 3.5L6 11"
          stroke="#B7EA3C"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function AppShell() {
  const { user, loading, signInWithGoogle } = useAuth();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const closeUserMenu = useCallback(() => setUserMenuOpen(false), []);

  useEffect(() => {
    setUserMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const p = location.pathname.replace(/\/$/, '') || '/';
    if (p === '/' || p === '') {
      document.title = 'Tee-Time — Search';
    } else if (p === '/plan') {
      document.title = 'Tee-Time — Plan';
    } else if (p === '/share') {
      document.title = 'Tee-Time — Share';
    } else if (p === '/account') {
      document.title = 'Tee-Time — Account';
    } else if (p.startsWith('/round/')) {
      document.title = 'Tee-Time — Vote';
    } else if (p.startsWith('/course/')) {
      document.title = 'Tee-Time — Course';
    } else {
      document.title = 'Tee-Time';
    }
  }, [location.pathname]);

  const avatar = useMemo(() => profileAvatarUrlFromUser(user), [user]);
  const initial = (user?.email?.[0] || user?.user_metadata?.full_name?.[0] || '?').toUpperCase();

  const youRouteActive =
    location.pathname === '/plan' ||
    location.pathname.startsWith('/plan/') ||
    location.pathname === '/account' ||
    location.pathname.startsWith('/account/');

  return (
    <div>
      <header className="app-header">
        <div className="container app-header-inner">
          <Link to="/" className="app-header-logo">
            <FlagMark />
            <span>
              Tee-Time<span className="app-header-logo-tld">.io</span>
            </span>
          </Link>

          <div className="app-header-trailing">
            {loading ? (
              <span className="app-header-loading" aria-hidden>
                …
              </span>
            ) : user ? (
              <button
                type="button"
                className={`app-header-account-btn${userMenuOpen ? ' is-open' : ''}${youRouteActive ? ' is-active' : ''}`}
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                aria-label="Open account menu"
                onClick={() => setUserMenuOpen((o) => !o)}
              >
                <AvatarChip avatar={avatar} initial={initial} />
              </button>
            ) : (
              <button
                className="btn btn-primary app-header-sign-in"
                type="button"
                onClick={() => void signInWithGoogle()}
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      <UserMenu open={userMenuOpen} onClose={closeUserMenu} initial={initial} />

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
