import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { profileAvatarUrlFromUser } from '../lib/profileAvatar';
import { UserAvatar } from './UserAvatar';
import { useTheme, type ThemePreference } from '../state/ThemeContext';

type UserMenuProps = {
  open: boolean;
  onClose: () => void;
  initial: string;
};

function MenuIcon({ children }: { children: ReactNode }) {
  return <span className="user-menu-item-icon" aria-hidden>{children}</span>;
}

export function UserMenu({ open, onClose, initial }: UserMenuProps) {
  const { user, signOut } = useAuth();
  const { preference, resolved, setPreference } = useTheme();
  const location = useLocation();
  const avatar = profileAvatarUrlFromUser(user);

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

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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

  return (
    <div className="user-menu-backdrop" role="presentation" onClick={onClose}>
      <div
        className="user-menu-panel"
        role="menu"
        aria-label="Account menu"
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
            <span className="user-menu-item-label">Recent openings</span>
          </Link>
          <Link to="/plan" className="user-menu-item" role="menuitem" onClick={onClose}>
            <MenuIcon>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M17 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9.5 11a4 4 0 100-8 4 4 0 000 8ZM22 21v-2a4 4 0 00-3-3.87M15.5 3.13a4 4 0 010 7.75"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </MenuIcon>
            <span className="user-menu-item-label">Shared rounds</span>
          </Link>
          <Link to="/account" className="user-menu-item" role="menuitem" onClick={onClose}>
            <MenuIcon>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 15a3 3 0 100-6 3 3 0 000 6z"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </MenuIcon>
            <span className="user-menu-item-label">Account & alerts</span>
          </Link>
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
      </div>
    </div>
  );
}
