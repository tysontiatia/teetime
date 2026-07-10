import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { profileAvatarUrlFromUser } from '../lib/profileAvatar';
import { UserAvatar } from './UserAvatar';
import { UserMenu } from './UserMenu';

function AvatarChip({ avatar, initial }: { avatar?: string; initial: string }) {
  return <UserAvatar src={avatar} initial={initial} size={34} className="app-header-avatar-chip" />;
}

function LogoMark() {
  return (
    <span className="app-header-logo-mark" aria-hidden>
      <img className="app-header-logo-img is-light" src="/logo-icon-light.svg" alt="" width={26} height={26} />
      <img className="app-header-logo-img is-dark" src="/logo-icon-dark.svg" alt="" width={26} height={26} />
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
    } else if (p === '/feed') {
      document.title = 'Tee-Time — Openings';
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
    location.pathname.startsWith('/account/') ||
    location.pathname === '/feed' ||
    location.pathname.startsWith('/feed/');

  const feedActive = location.pathname === '/feed' || location.pathname.startsWith('/feed/');

  return (
    <div>
      <header className="app-header">
        <div className="container app-header-inner">
          <Link to="/" className="app-header-logo">
            <LogoMark />
            <span>
              Tee-Time<span className="app-header-logo-tld">.io</span>
            </span>
          </Link>

          <nav className="app-header-nav" aria-label="Main">
            <Link to="/feed" className={`app-header-nav-link${feedActive ? ' is-active' : ''}`}>
              Openings
            </Link>
          </nav>

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
