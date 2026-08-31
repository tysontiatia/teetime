import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { profileAvatarUrlFromUser } from '../lib/profileAvatar';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useIsCompactShell } from '../hooks/useMediaQuery';
import { UserAvatar } from './UserAvatar';
import { useTheme, type ThemePreference } from '../state/ThemeContext';
import { AlertsIcon, PlanIcon } from './icons/AppIcons';
import {
  countPushSubscriptions,
  disablePushAlerts,
  enablePushAlerts,
  pushSupported,
} from '../lib/pushAlerts';

type UserMenuProps = {
  open: boolean;
  onClose: () => void;
  initial: string;
  /** Desktop: align the dropdown under this header control. */
  anchorRef?: RefObject<HTMLElement | null>;
  showInstall?: boolean;
  onInstall?: () => void;
};

function MenuIcon({ children }: { children: ReactNode }) {
  return <span className="user-menu-item-icon" aria-hidden>{children}</span>;
}

export function UserMenu({ open, onClose, initial, anchorRef, showInstall, onInstall }: UserMenuProps) {
  const { user, signOut } = useAuth();
  const { isAdmin } = useIsAdmin();
  const { preference, resolved, setPreference } = useTheme();
  const location = useLocation();
  const isCompact = useIsCompactShell();
  const avatar = profileAvatarUrlFromUser(user);
  const canUsePush = pushSupported();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [anchorStyle, setAnchorStyle] = useState<CSSProperties | undefined>();

  useBodyScrollLock(open && Boolean(user));

  useLayoutEffect(() => {
    if (!open) {
      setAnchorStyle(undefined);
      return;
    }
    const update = () => {
      const el = anchorRef?.current;
      if (!el || window.matchMedia('(max-width: 720px)').matches) {
        setAnchorStyle(undefined);
        return;
      }
      const r = el.getBoundingClientRect();
      const panelWidth = Math.min(320, window.innerWidth - 24);
      const gap = 8;
      let right = Math.max(12, window.innerWidth - r.right);
      // Keep panel on-screen if the avatar sits near the left.
      right = Math.min(right, window.innerWidth - panelWidth - 12);
      setAnchorStyle({
        ['--user-menu-top' as string]: `${Math.round(r.bottom + gap)}px`,
        ['--user-menu-right' as string]: `${Math.round(right)}px`,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    onClose();
  }, [location.pathname, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const refreshPushState = useCallback(async (uid: string) => {
    const n = await countPushSubscriptions(uid);
    setPushEnabled(n > 0);
  }, []);

  useEffect(() => {
    if (!open || !user?.id) return;
    setPushMsg(null);
    void refreshPushState(user.id);
  }, [open, user?.id, refreshPushState]);

  const onTogglePush = async () => {
    if (!user?.id || pushBusy) return;
    setPushBusy(true);
    setPushMsg(null);
    if (pushEnabled) {
      const res = await disablePushAlerts(user.id);
      setPushBusy(false);
      if (!res.ok) {
        setPushMsg(res.message);
        return;
      }
      setPushEnabled(false);
      setPushMsg('Push off on this device.');
      return;
    }
    const res = await enablePushAlerts(user.id);
    setPushBusy(false);
    if (!res.ok) {
      setPushMsg(res.message);
      return;
    }
    setPushEnabled(true);
    setPushMsg('Push on — we’ll notify this device.');
  };

  if (!open || !user) return null;

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    user.email?.split('@')[0] ||
    'Account';

  const themeOption = (value: ThemePreference, label: string) => (
    <button
      type="button"
      className={preference === value ? 'on' : ''}
      onClick={() => setPreference(value)}
    >
      {label}
    </button>
  );

  const showHubLinks = !isCompact;

  return (
    <div className="user-menu-backdrop" role="presentation" onClick={onClose}>
      <div
        className="user-menu-panel"
        role="menu"
        aria-label="Account menu"
        style={anchorStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="user-menu-head">
          <UserAvatar src={avatar} initial={initial} size={40} className="user-menu-avatar" />
          <div className="user-menu-head-text">
            <div className="user-menu-name">{displayName}</div>
            <div className="user-menu-email">{user.email}</div>
          </div>
          <button type="button" className="user-menu-close btn btn-ghost" onClick={onClose} aria-label="Close menu">
            ✕
          </button>
        </div>

        <nav className="user-menu-nav">
          {showHubLinks ? (
            <>
              <Link to="/account" className="user-menu-item" role="menuitem" onClick={onClose}>
                <MenuIcon>
                  <AlertsIcon />
                </MenuIcon>
                <span className="user-menu-item-label">Alerts</span>
              </Link>
              <Link to="/plan" className="user-menu-item" role="menuitem" onClick={onClose}>
                <MenuIcon>
                  <PlanIcon />
                </MenuIcon>
                <span className="user-menu-item-label">Plan</span>
              </Link>
            </>
          ) : null}
          <Link to="/feed" className="user-menu-item" role="menuitem" onClick={onClose}>
            <MenuIcon>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 11h16M4 7h10M4 15h14M4 19h8"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                />
                <circle cx="18" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.9" />
              </svg>
            </MenuIcon>
            <span className="user-menu-item-label">Openings</span>
          </Link>
          {isAdmin ? (
            <>
              <Link to="/admin/users" className="user-menu-item" role="menuitem" onClick={onClose}>
                <MenuIcon>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.9" />
                    <path
                      d="M4.5 18c.6-2.4 2.4-3.6 4.5-3.6s3.9 1.2 4.5 3.6"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                    />
                    <circle cx="16.5" cy="8.5" r="2.4" stroke="currentColor" strokeWidth="1.9" />
                    <path
                      d="M15.2 14.6c1.6-.3 3 .5 3.8 2.2"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                    />
                  </svg>
                </MenuIcon>
                <span className="user-menu-item-label">Signups</span>
              </Link>
              <Link to="/admin/courses" className="user-menu-item" role="menuitem" onClick={onClose}>
                <MenuIcon>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 7h14M5 12h14M5 17h9"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                    />
                  </svg>
                </MenuIcon>
                <span className="user-menu-item-label">Course catalog</span>
              </Link>
            </>
          ) : null}
          {showInstall && onInstall ? (
            <button
              type="button"
              className="user-menu-item"
              role="menuitem"
              onClick={() => {
                onClose();
                onInstall();
              }}
            >
              <MenuIcon>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="6" y="3" width="12" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.9" />
                  <path d="M12 17.2h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                  <path d="M9 8.5h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                </svg>
              </MenuIcon>
              <span className="user-menu-item-label">Install app</span>
            </button>
          ) : null}
        </nav>

        <div className="user-menu-section">
          <div className="user-menu-section-label">Appearance</div>
          <div className="seg user-menu-theme-seg" role="group" aria-label="Theme">
            {themeOption('light', 'Light')}
            {themeOption('dark', 'Dark')}
            {themeOption('system', 'Auto')}
          </div>
          <p className="user-menu-theme-hint">
            {preference === 'system' ? `Using ${resolved} from your device` : `Using ${resolved} mode`}
          </p>
        </div>

        <div className="user-menu-section">
          <div className="user-menu-section-label">Delivery</div>
          <div className="user-menu-push-row">
            <div className="user-menu-push-copy">
              <div className="user-menu-push-title">Browser push</div>
              <p className="user-menu-push-hint">
                {canUsePush
                  ? 'Instant notices on this device.'
                  : 'Not available in this browser.'}
              </p>
            </div>
            <button
              type="button"
              className={`btn user-menu-push-btn${pushEnabled ? ' is-on' : ' btn-primary'}`}
              disabled={!canUsePush || pushBusy}
              onClick={() => void onTogglePush()}
            >
              {pushBusy ? '…' : pushEnabled ? 'On' : 'Enable'}
            </button>
          </div>
          {pushMsg ? <p className="user-menu-push-msg">{pushMsg}</p> : null}
          <p className="user-menu-delivery-note">Email alerts go to {user.email}.</p>
        </div>

        <button
          type="button"
          className="btn user-menu-sign-out"
          role="menuitem"
          onClick={() => {
            onClose();
            void signOut();
          }}
        >
          Sign out
        </button>

        <p className="user-menu-legal">
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
            Privacy
          </a>
          <span aria-hidden> · </span>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer">
            Terms
          </a>
        </p>
      </div>
    </div>
  );
}
