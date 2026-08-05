import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { profileAvatarUrlFromUser } from '../lib/profileAvatar';
import { UserAvatar } from './UserAvatar';
import { UserMenu } from './UserMenu';
import { AppBottomNav } from './AppBottomNav';
import { OpeningsPreviewProvider, useOpeningsPreview } from '../state/OpeningsPreviewContext';

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

function HeaderNav() {
  const location = useLocation();
  const { openCount } = useOpeningsPreview();
  const p = location.pathname.replace(/\/$/, '') || '/';

  if (p.startsWith('/admin')) return null;

  const badge = openCount > 0 ? (openCount > 99 ? '99+' : String(openCount)) : null;

  return (
    <nav className="app-header-nav" aria-label="Primary">
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `app-header-nav-link${isActive || p.startsWith('/course/') ? ' is-active' : ''}`
        }
      >
        <span className="app-header-nav-label">Search</span>
      </NavLink>
      <NavLink to="/feed" className={({ isActive }) => `app-header-nav-link${isActive ? ' is-active' : ''}`}>
        <span className="app-header-nav-label">Openings</span>
        {badge ? (
          <span className={`app-header-nav-badge${openCount >= 5 ? ' app-header-nav-badge--hot' : ''}`}>
            {badge}
          </span>
        ) : null}
      </NavLink>
      <NavLink
        to="/account"
        className={() => {
          const youActive =
            p === '/account' ||
            p.startsWith('/account/') ||
            p === '/plan' ||
            p.startsWith('/plan/') ||
            p === '/share' ||
            p.startsWith('/share/');
          return `app-header-nav-link${youActive ? ' is-active' : ''}`;
        }}
      >
        <span className="app-header-nav-label">You</span>
      </NavLink>
    </nav>
  );
}

function AppShellInner() {
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
      document.title = 'Tee-Time · Search';
    } else if (p === '/plan') {
      document.title = 'Tee-Time · Plan';
    } else if (p === '/share') {
      document.title = 'Tee-Time · Share';
    } else if (p === '/account') {
      document.title = 'Tee-Time · Account';
    } else if (p === '/feed') {
      document.title = 'Tee-Time · Openings';
    } else if (p.startsWith('/round/')) {
      document.title = 'Tee-Time · Vote';
    } else if (p.startsWith('/course/')) {
      document.title = 'Tee-Time · Course';
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
    <div className="app-shell">
      <header className="app-header">
        <div className="container app-header-inner">
          <Link to="/" className="app-header-logo">
            <LogoMark />
            <span>
              Tee-Time<span className="app-header-logo-tld">.io</span>
            </span>
          </Link>

          <HeaderNav />

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

      <footer className="app-footer">
        <p className="app-footer-note">Made with ❤️ in Salt Lake City</p>
      </footer>

      <AppBottomNav />
    </div>
  );
}

export function AppShell() {
  return (
    <OpeningsPreviewProvider>
      <AppShellInner />
    </OpeningsPreviewProvider>
  );
}
