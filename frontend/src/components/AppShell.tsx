import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { profileAvatarUrlFromUser } from '../lib/profileAvatar';
import { UserAvatar } from './UserAvatar';
import { UserMenu } from './UserMenu';
import { AppBottomNav } from './AppBottomNav';
import { ErrorBoundary } from './ErrorBoundary';
import { OpeningsPreviewProvider } from '../state/OpeningsPreviewContext';
import { AlertActivityProvider, useAlertActivity } from '../state/AlertActivityContext';
import { InstallAppModal } from './InstallAppModal';
import { InstallAppBanner } from './InstallAppBanner';
import { SignInPromptModal, type SignInPromptVariant } from './SignInPromptModal';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { useIsCompactShell } from '../hooks/useMediaQuery';
import { useKeyboardInsetCssVar } from '../hooks/useKeyboardInsetCssVar';
import { AlertsIcon, PlanIcon } from './icons/AppIcons';

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

  const openGeneralSignIn = () => {
    if (isCompact) setHubAuth({ variant: 'general', returnTo: path });
    else void signInWithGoogle(path === '/' ? undefined : path);
  };

  const requestHubAuth = useCallback((variant: Extract<SignInPromptVariant, 'alert' | 'you'>, returnTo: string) => {
    setHubAuth({ variant, returnTo });
  }, []);

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

          {!isAdmin ? (
            <div className="app-header-trailing">
              <a
                className="app-header-ig"
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="Follow Tee-Time on Instagram"
                title="Follow on Instagram"
              >
                <InstagramIcon />
                <span className="app-header-ig-label">Follow</span>
              </a>
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
              <Link
                to="/account"
                className={`app-header-icon-btn app-header-alerts-btn${alertsActive ? ' is-active' : ''}`}
                aria-label={alertsBadge ? `Tee time alerts, ${unreadCount} new` : 'Tee time alerts'}
                title="Alerts"
              >
                <AlertsIcon />
                {alertsBadge ? <span className="app-header-alerts-badge">{alertsBadge}</span> : null}
              </Link>
              <Link
                to="/plan"
                className={`app-header-icon-btn app-header-plan-btn${youRouteActive ? ' is-active' : ''}`}
                aria-label="Plan rounds"
                title="Plan"
              >
                <PlanIcon />
              </Link>
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
          ) : (
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
          )}
        </div>
      </header>

      <UserMenu
        open={userMenuOpen}
        onClose={closeUserMenu}
        initial={initial}
        anchorRef={accountBtnRef}
        showInstall={showInstallEntry}
        onInstall={() => setInstallOpen(true)}
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
        {/* Reset page errors on navigation without remounting the shell (modal state lives here). */}
        <ErrorBoundary key={location.key}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <footer className="app-footer">
        <p className="app-footer-note">Made with ❤️ in Salt Lake City</p>
      </footer>

      <AppBottomNav onRequestHubAuth={isCompact ? requestHubAuth : undefined} />
    </div>
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
