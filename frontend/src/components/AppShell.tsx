import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';

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

const navLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  padding: '8px 12px',
  borderRadius: 10,
  color: isActive ? '#fff' : 'rgba(255,255,255,0.68)',
  background: isActive ? 'rgba(255,255,255,0.10)' : 'transparent',
  fontWeight: 700,
  fontSize: 13,
});

const navLinkStyleDrawer = ({ isActive }: { isActive: boolean }) => ({
  display: 'block',
  padding: '14px 14px',
  borderRadius: 12,
  color: isActive ? '#fff' : 'rgba(255,255,255,0.78)',
  background: isActive ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
  fontWeight: 700,
  fontSize: 16,
  textDecoration: 'none',
});

function AvatarChip({ avatar, initial }: { avatar?: string; initial: string }) {
  if (avatar) {
    return (
      <span className="app-header-avatar-chip" aria-hidden>
        <img src={avatar} alt="" width={36} height={36} />
      </span>
    );
  }
  return (
    <span className="app-header-avatar-chip" aria-hidden>
      {initial}
    </span>
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
    <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginLeft: 8 }}>…</span>
  ) : user ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 8 }}>
      {avatar ? (
        <img
          src={avatar}
          alt=""
          width={32}
          height={32}
          style={{ borderRadius: 999, border: '1px solid rgba(255,255,255,0.25)' }}
        />
      ) : (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.15)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 800,
          }}
        >
          {initial}
        </div>
      )}
      <button
        className="btn"
        type="button"
        onClick={() => void signOut()}
        style={{
          padding: '8px 12px',
          borderRadius: 10,
          background: 'rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.85)',
          borderColor: 'rgba(255,255,255,0.18)',
          fontWeight: 700,
          fontSize: 13,
        }}
      >
        Sign out
      </button>
    </div>
  ) : (
    <button
      className="btn btn-primary"
      type="button"
      onClick={() => void signInWithGoogle()}
      style={{ marginLeft: 8, padding: '8px 14px', fontSize: 13 }}
    >
      Sign in with Google
    </button>
  );

  const authDrawer = loading ? (
    <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, margin: '8px 0 0' }}>Loading…</p>
  ) : user ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {avatar ? (
          <img
            src={avatar}
            alt=""
            width={40}
            height={40}
            style={{ borderRadius: 999, border: '1px solid rgba(255,255,255,0.25)' }}
          />
        ) : (
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
              fontWeight: 800,
            }}
          >
            {initial}
          </div>
        )}
        <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, wordBreak: 'break-all' }}>
          {user.email}
        </span>
      </div>
      <button
        className="btn"
        type="button"
        onClick={() => void signOut()}
        style={{
          width: '100%',
          padding: '12px 14px',
          borderRadius: 12,
          background: 'rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.9)',
          borderColor: 'rgba(255,255,255,0.18)',
          fontWeight: 700,
          fontSize: 15,
        }}
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
      <header
        className="app-header"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'rgba(26,46,26,0.96)',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div className="container app-header-inner">
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <div
              aria-hidden
              style={{
                width: 34,
                height: 34,
                flexShrink: 0,
                borderRadius: 10,
                background: 'rgba(255,255,255,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="3.5" y="2" width="1.5" height="12" fill="white" rx="0.5" />
                <path d="M5 2.5L12.5 5.5L5 8.5V2.5Z" fill="white" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  color: '#fff',
                  fontSize: isMobile ? 16 : 18,
                  lineHeight: 1.15,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Tee-Time{' '}
                <span style={{ fontSize: isMobile ? 9 : 10, opacity: 0.55, marginLeft: 4, letterSpacing: '0.12em' }}>
                  UTAH
                </span>
              </div>
              <div className="app-header-brand-sub" style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                Find availability. Plan the round.
              </div>
            </div>
          </Link>

          {!isMobile && <div style={{ flex: 1 }} />}

          <nav className="app-header-nav-desktop" aria-label="Main">
            <NavLink to="/" end style={navLinkStyle}>
              Tee times
            </NavLink>
            <NavLink to="/plan" style={navLinkStyle}>
              Group vote
            </NavLink>
            {authDesktop}
          </nav>

          {isMobile && (
            <div className="app-header-mobile-trailing">
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
            <NavLink to="/" end style={navLinkStyleDrawer} onClick={() => setMenuOpen(false)}>
              Tee times
            </NavLink>
            <NavLink to="/plan" style={navLinkStyleDrawer} onClick={() => setMenuOpen(false)}>
              Group vote
            </NavLink>

            <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              {authDrawer}
            </div>
          </aside>
        </div>
      )}

      <main style={{ padding: '18px 0 120px' }}>
        <Outlet />
      </main>
    </div>
  );
}
