import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useTheme } from '../state/ThemeContext';
const MOBILE_MQ = '(max-width: 720px)';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    setReduced(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `app-nav-link${isActive ? ' on' : ''}`;

const drawerLinkClass = ({ isActive }: { isActive: boolean }) =>
  `app-drawer-link${isActive ? ' on' : ''}`;

function AvatarChip({ avatar, initial }: { avatar?: string; initial: string }) {
  if (avatar) {
    return (
      <span className="app-header-avatar-chip" aria-hidden>
        <img src={avatar} alt="" width={34} height={34} />
      </span>
    );
  }
  return (
    <span className="app-header-avatar-chip" aria-hidden>
      {initial}
    </span>
  );
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

function ThemeToggle() {
  const { resolved, toggleTheme } = useTheme();
  const label = resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {resolved === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 3a9 9 0 109 9c0-5-4-9-9-9z"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.9" />
          <path
            d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

export function AppShell() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const location = useLocation();
  const isMobile = useIsMobile();
  const reduceMotion = usePrefersReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [drawerEntered, setDrawerEntered] = useState(false);
  const drawerEnterRafRef = useRef<number | null>(null);

  useEffect(() => {
    setMenuOpen(false);
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

  useEffect(() => {
    if (!isMobile) {
      setDrawerMounted(false);
      setDrawerEntered(false);
      return;
    }
    if (menuOpen) {
      setDrawerMounted(true);
      if (reduceMotion) {
        setDrawerEntered(true);
        return;
      }
      let alive = true;
      drawerEnterRafRef.current = requestAnimationFrame(() => {
        drawerEnterRafRef.current = requestAnimationFrame(() => {
          drawerEnterRafRef.current = null;
          if (alive) setDrawerEntered(true);
        });
      });
      return () => {
        alive = false;
        if (drawerEnterRafRef.current != null) {
          cancelAnimationFrame(drawerEnterRafRef.current);
          drawerEnterRafRef.current = null;
        }
      };
    }
    setDrawerEntered(false);
    if (reduceMotion) setDrawerMounted(false);
  }, [menuOpen, isMobile, reduceMotion]);

  useEffect(() => {
    if (!isMobile || !drawerMounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerMounted, isMobile]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const avatar =
    (user?.user_metadata?.avatar_url as string | undefined) ||
    (user?.user_metadata?.picture as string | undefined);
  const initial = (user?.email?.[0] || user?.user_metadata?.full_name?.[0] || '?').toUpperCase();

  const onDrawerTransitionEnd = (e: React.TransitionEvent<HTMLElement>) => {
    if (reduceMotion) return;
    if (e.propertyName !== 'transform') return;
    if (!menuOpen) setDrawerMounted(false);
  };

  const authDesktop = loading ? (
    <span style={{ color: 'var(--ink-3)', fontSize: 13, marginLeft: 8 }}>…</span>
  ) : user ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 8 }}>
      <AvatarChip avatar={avatar} initial={initial} />
      <button className="btn-ghost-pill" type="button" onClick={() => void signOut()} style={{ padding: '8px 14px' }}>
        Sign out
      </button>
    </div>
  ) : (
    <button
      className="btn btn-primary"
      type="button"
      onClick={() => void signInWithGoogle()}
      style={{ marginLeft: 8, padding: '8px 14px', fontSize: 13, borderRadius: 999 }}
    >
      Sign in
    </button>
  );

  const authDrawer = loading ? (
    <p style={{ color: 'var(--ink-3)', fontSize: 14, margin: '8px 0 0' }}>Loading…</p>
  ) : user ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <AvatarChip avatar={avatar} initial={initial} />
        <span style={{ color: 'var(--ink-2)', fontSize: 14, wordBreak: 'break-all' }}>{user.email}</span>
      </div>
      <button
        className="btn"
        type="button"
        onClick={() => void signOut()}
        style={{ width: '100%', padding: '12px 14px', borderRadius: 12 }}
      >
        Sign out
      </button>
    </div>
  ) : (
    <button
      className="btn btn-primary"
      type="button"
      onClick={() => void signInWithGoogle()}
      style={{ width: '100%', marginTop: 8, padding: '12px 14px', fontSize: 15, borderRadius: 12 }}
    >
      Sign in with Google
    </button>
  );

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

          <nav className="app-header-nav-desktop" aria-label="Main">
            <NavLink to="/plan" className={navLinkClass}>
              Shared rounds
            </NavLink>
            {user && (
              <NavLink to="/account" className={navLinkClass}>
                Account
              </NavLink>
            )}
            <ThemeToggle />
            {authDesktop}
          </nav>

          {isMobile && (
            <div className="app-header-mobile-trailing">
              <ThemeToggle />
              {!loading && user && <AvatarChip avatar={avatar} initial={initial} />}
              <button
                type="button"
                className="app-header-menu-btn"
                aria-expanded={menuOpen}
                aria-controls="app-header-drawer"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                onClick={() => setMenuOpen((o) => !o)}
              >
                {menuOpen ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 7h16M4 12h16M4 17h16" />
                  </svg>
                )}
              </button>
            </div>
          )}
        </div>
      </header>

      {isMobile && drawerMounted && (
        <div
          className={`app-header-drawer-backdrop${drawerEntered ? ' app-header-drawer-backdrop--open' : ''}`}
          role="presentation"
          onClick={() => setMenuOpen(false)}
        >
          <aside
            id="app-header-drawer"
            className="app-header-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            onClick={(e) => e.stopPropagation()}
            onTransitionEnd={onDrawerTransitionEnd}
          >
            <NavLink to="/plan" className={drawerLinkClass} onClick={() => setMenuOpen(false)}>
              Shared rounds
            </NavLink>
            {user && (
              <NavLink to="/account" className={drawerLinkClass} onClick={() => setMenuOpen(false)}>
                Account
              </NavLink>
            )}

            <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: '1px solid var(--line)' }}>{authDrawer}</div>
          </aside>
        </div>
      )}

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
