import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { profileAvatarUrlFromUser } from '../lib/profileAvatar';
import { UserAvatar } from './UserAvatar';
import { UserMenu } from './UserMenu';
import { ErrorBoundary } from './ErrorBoundary';
import { OpeningsPreviewProvider } from '../state/OpeningsPreviewContext';
import { AlertActivityProvider, useAlertActivity } from '../state/AlertActivityContext';
import { InstallAppModal } from './InstallAppModal';
import { InstallAppBanner } from './InstallAppBanner';
import { SignInPromptModal, type SignInPromptVariant } from './SignInPromptModal';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { useIsCompactShell } from '../hooks/useMediaQuery';
import { useKeyboardInsetCssVar } from '../hooks/useKeyboardInsetCssVar';
import { FinderHeaderSlotsContext } from '../state/FinderHeaderSlots';

const INSTAGRAM_URL = 'https://www.instagram.com/teetimehq/';

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

function MenuGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" />
    </svg>
  );
}

function AppShellInner() {
  const { user, loading, signInWithGoogle } = useAuth();
  const { unreadCount } = useAlertActivity();
  const location = useLocation();
  const navigate = useNavigate();
  const isCompact = useIsCompactShell();
  useKeyboardInsetCssVar();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const accountBtnRef = useRef<HTMLButtonElement>(null);
  const [bannerReady, setBannerReady] = useState(false);
  const [hubAuth, setHubAuth] = useState<{ variant: SignInPromptVariant; returnTo: string } | null>(null);
  const closeUserMenu = useCallback(() => setUserMenuOpen(false), []);
  const {
    installed,
    platform,
    canNativeInstall,
    canSoftPrompt,
    showInstallEntry,
    promptNativeInstall,
    dismissSoftPrompt,
  } = usePwaInstall();

  const path = location.pathname.replace(/\/$/, '') || '/';
  const alertsBadge = user && unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : null;

  useEffect(() => {
    setUserMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!canSoftPrompt || installed) {
      setBannerReady(false);
      return;
    }
    const t = window.setTimeout(() => setBannerReady(true), 2200);
    return () => window.clearTimeout(t);
  }, [canSoftPrompt, installed]);

  /* Mobile / PWA: Alerts & Plan while signed out → auth modal over Find (not a full page). */
  useEffect(() => {
    if (loading || user || !isCompact) return;
    if (path === '/account' || path.startsWith('/account/')) {
      setHubAuth({ variant: 'alert', returnTo: '/account' });
      navigate('/', { replace: true });
      return;
    }
    if (path === '/plan' || path.startsWith('/plan/')) {
      setHubAuth({ variant: 'you', returnTo: '/plan' });
      navigate('/', { replace: true });
    }
  }, [loading, user, isCompact, path, navigate]);

  useEffect(() => {
    if (!user || !hubAuth) return;
    const to = hubAuth.returnTo;
    setHubAuth(null);
    if (to && to !== path) navigate(to);
  }, [user, hubAuth, navigate, path]);

  useEffect(() => {
    const p = path;
    if (p === '/' || p === '') {
      document.title = 'Tee-Time · Find';
    } else if (p === '/plan') {
      document.title = 'Tee-Time · Plan';
    } else if (p === '/share') {
      document.title = 'Tee-Time · Plan';
    } else if (p === '/account') {
      document.title = 'Tee-Time · Alerts';
    } else if (p === '/feed') {
      document.title = 'Tee-Time · Openings';
    } else if (p.startsWith('/round/')) {
      document.title = 'Tee-Time · Vote';
    } else if (p.startsWith('/course/')) {
      document.title = 'Tee-Time · Course';
    } else if (p.startsWith('/admin/users')) {
      document.title = 'Tee-Time · Signups';
    } else if (p.startsWith('/admin')) {
      document.title = 'Tee-Time · Admin';
    } else {
      document.title = 'Tee-Time';
    }
  }, [path]);

  const avatar = useMemo(() => profileAvatarUrlFromUser(user), [user]);
  const initial = (user?.email?.[0] || user?.user_metadata?.full_name?.[0] || '?').toUpperCase();

  const alertsActive = path === '/account' || path.startsWith('/account/');
  const youRouteActive =
    path === '/plan' || path.startsWith('/plan/') || path === '/share' || path.startsWith('/share/');
  const isAdmin = path.startsWith('/admin');
  const isFind = path === '/' || path === '';
  const isCourse = path.startsWith('/course/');
  const headerRef = useRef<HTMLElement>(null);
  const [searchEl, setSearchEl] = useState<HTMLElement | null>(null);
  const [filtersEl, setFiltersEl] = useState<HTMLElement | null>(null);
  const [metaEl, setMetaEl] = useState<HTMLElement | null>(null);
  const [courseBar, setCourseBar] = useState(false);
  const showCourseBar = isCourse && !isCompact && courseBar;

  useEffect(() => {
    if (!isCourse) setCourseBar(false);
  }, [isCourse]);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty('--app-header-offset', `${el.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--app-header-offset');
    };
  }, [path, isCompact]);

  const openGeneralSignIn = () => {
    if (isCompact) setHubAuth({ variant: 'general', returnTo: path });
    else void signInWithGoogle(path === '/' ? undefined : path);
  };

  const requestHubAuth = useCallback((variant: Extract<SignInPromptVariant, 'alert' | 'you'>, returnTo: string) => {
    setHubAuth({ variant, returnTo });
  }, []);

  return (
    <FinderHeaderSlotsContext.Provider
      value={{ searchEl, filtersEl, metaEl, setSearchEl, setFiltersEl, setMetaEl, courseBar, setCourseBar }}
    >
    <div className="app-shell">
      <header className={`app-header${isFind ? ' is-find' : ''}${showCourseBar ? ' is-course' : ''}`} ref={headerRef}>
        <div className={`container app-header-inner${isCompact && !isAdmin ? ' is-brand-bar' : ''}${!isCompact && !isAdmin ? ' is-nav' : ''}`}>
          {isCompact && !isAdmin ? (
            <button
              type="button"
              className={`app-header-menu-btn${userMenuOpen ? ' is-open' : ''}`}
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
              aria-label={alertsBadge ? `Open menu, ${unreadCount} new alerts` : 'Open menu'}
              onClick={() => setUserMenuOpen((open) => !open)}
            >
              <MenuGlyph />
              {alertsBadge ? <span className="app-header-alerts-badge">{alertsBadge}</span> : null}
            </button>
          ) : null}

          <Link to={path === '/' || path === '' ? '.' : '/'} className="app-header-logo">
            <LogoMark />
            <span>
              Tee-Time<span className="app-header-logo-tld">.io</span>
            </span>
          </Link>

          {!isCompact && !isAdmin ? (
            <nav className="app-header-nav" aria-label="Primary">
              <Link to="/" className={isFind ? 'is-active' : undefined} aria-current={isFind ? 'page' : undefined}>
                Find
              </Link>
              <Link
                to="/account"
                className={alertsActive ? 'is-active' : undefined}
                aria-current={alertsActive ? 'page' : undefined}
              >
                Alerts
                {alertsBadge ? <span className="app-header-nav-badge">{alertsBadge}</span> : null}
              </Link>
              <Link
                to="/plan"
                className={youRouteActive ? 'is-active' : undefined}
                aria-current={youRouteActive ? 'page' : undefined}
              >
                Plan
              </Link>
            </nav>
          ) : null}

          {!isCompact && !isAdmin ? (
            <div className="app-header-trailing">
              {showInstallEntry ? (
                <button
                  type="button"
                  className="app-header-icon-btn app-header-install-btn"
                  aria-label="Install Tee-Time"
                  title="Install app"
                  onClick={() => setInstallOpen(true)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M12 3v10M8.5 9.5L12 13l3.5-3.5"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M5 16v2a2 2 0 002 2h10a2 2 0 002-2v-2"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              ) : null}
              {loading ? (
                <span className="app-header-loading" aria-hidden>
                  …
                </span>
              ) : user ? (
                <button
                  type="button"
                  ref={accountBtnRef}
                  className={`app-header-account-btn${userMenuOpen ? ' is-open' : ''}`}
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
                  onClick={openGeneralSignIn}
                >
                  Sign in
                </button>
              )}
            </div>
          ) : null}
          {isAdmin ? (
            <div className="app-header-trailing">
              {loading ? null : user ? (
                <button
                  type="button"
                  ref={accountBtnRef}
                  className={`app-header-account-btn${userMenuOpen ? ' is-open' : ''}`}
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  aria-label="Open account menu"
                  onClick={() => setUserMenuOpen((o) => !o)}
                >
                  <AvatarChip avatar={avatar} initial={initial} />
                </button>
              ) : null}
            </div>
          ) : null}
          {isCompact && !isAdmin ? (
            <div className="app-header-trailing is-compact">
              {loading ? (
                <span className="app-header-loading" aria-hidden>
                  …
                </span>
              ) : user ? (
                <button
                  type="button"
                  ref={accountBtnRef}
                  className={`app-header-account-btn${userMenuOpen ? ' is-open' : ''}`}
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  aria-label="Open account menu"
                  onClick={() => setUserMenuOpen((o) => !o)}
                >
                  <AvatarChip avatar={avatar} initial={initial} />
                </button>
              ) : (
                <button className="btn btn-primary app-header-sign-in" type="button" onClick={openGeneralSignIn}>
                  Sign in
                </button>
              )}
            </div>
          ) : null}
        </div>
        {isFind || showCourseBar ? (
          <div className="container app-header-find">
            <div className="app-header-search" ref={setSearchEl} />
            <div className="app-header-filters" ref={setFiltersEl} />
            <div className="app-header-meta" ref={setMetaEl} />
          </div>
        ) : null}
      </header>

      <UserMenu
        open={userMenuOpen}
        onClose={closeUserMenu}
        initial={initial}
        anchorRef={accountBtnRef}
        showInstall={showInstallEntry}
        onInstall={() => setInstallOpen(true)}
        alertsBadge={alertsBadge}
        onSignIn={openGeneralSignIn}
        onOpenAlerts={() => requestHubAuth('alert', '/account')}
        onOpenPlan={() => requestHubAuth('you', '/plan')}
      />

      <InstallAppBanner
        open={bannerReady && canSoftPrompt}
        onInstall={() => {
          setBannerReady(false);
          setInstallOpen(true);
        }}
        onDismiss={() => {
          dismissSoftPrompt();
          setBannerReady(false);
        }}
      />

      <InstallAppModal
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        platform={platform}
        canNativeInstall={canNativeInstall}
        onNativeInstall={promptNativeInstall}
      />

      <SignInPromptModal
        open={hubAuth != null}
        variant={hubAuth?.variant ?? 'general'}
        returnTo={hubAuth?.returnTo}
        onClose={() => setHubAuth(null)}
      />

      <main className="app-main">
        {/* Reset page errors when the route changes. Search-param updates stay on the
            same page, so they must not remount Find — that was destroying the map and
            flashing the full course list before tee times loaded back in. */}
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <footer className="app-footer">
        <p className="app-footer-note">
          Made with ❤️ in Salt Lake City
          <a
            className="app-footer-ig"
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noreferrer"
          >
            <InstagramIcon />
            Instagram
          </a>
        </p>
      </footer>

    </div>
    </FinderHeaderSlotsContext.Provider>
  );
}

export function AppShell() {
  return (
    <OpeningsPreviewProvider>
      <AlertActivityProvider>
        <AppShellInner />
      </AlertActivityProvider>
    </OpeningsPreviewProvider>
  );
}
