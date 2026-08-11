import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useAlertActivity } from '../state/AlertActivityContext';
import { useIsCompactShell } from '../hooks/useMediaQuery';
import { AlertsIcon, FindIcon, PlanIcon } from './icons/AppIcons';
import type { SignInPromptVariant } from './SignInPromptModal';

type Props = {
  /** Compact + signed-out: open auth modal instead of navigating to Alerts/Plan. */
  onRequestHubAuth?: (variant: Extract<SignInPromptVariant, 'alert' | 'you'>, returnTo: string) => void;
};

export function AppBottomNav({ onRequestHubAuth }: Props) {
  const location = useLocation();
  const { user, loading } = useAuth();
  const { unreadCount } = useAlertActivity();
  const isCompact = useIsCompactShell();
  const p = location.pathname.replace(/\/$/, '') || '/';

  if (p.startsWith('/admin')) return null;

  const findActive = p === '/' || p.startsWith('/course/');
  const alertsActive = p === '/account' || p.startsWith('/account/');
  const planActive =
    p === '/plan' ||
    p.startsWith('/plan/') ||
    p === '/share' ||
    p.startsWith('/share/');

  const gateHubNav = isCompact && !loading && !user && !!onRequestHubAuth;
  const alertsBadge = user && unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : null;

  return (
    <nav className="app-bottom-nav" aria-label="Primary">
      <div className="app-bottom-nav-inner">
        <Link
          to="/"
          className={`app-bottom-nav-link${findActive ? ' is-active' : ''}`}
          aria-current={findActive ? 'page' : undefined}
        >
          <span className="app-bottom-nav-icon-wrap">
            <FindIcon size={22} active={findActive} />
          </span>
          <span>Find</span>
        </Link>
        {gateHubNav ? (
          <button
            type="button"
            className="app-bottom-nav-link"
            onClick={() => onRequestHubAuth('alert', '/account')}
          >
            <span className="app-bottom-nav-icon-wrap">
              <AlertsIcon size={22} />
            </span>
            <span>Alerts</span>
          </button>
        ) : (
          <Link
            to="/account"
            className={`app-bottom-nav-link${alertsActive ? ' is-active' : ''}`}
            aria-current={alertsActive ? 'page' : undefined}
            aria-label={alertsBadge ? `Alerts, ${unreadCount} new` : 'Alerts'}
          >
            <span className="app-bottom-nav-icon-wrap">
              <AlertsIcon size={22} active={alertsActive} />
              {alertsBadge ? <span className="app-bottom-nav-badge">{alertsBadge}</span> : null}
            </span>
            <span>Alerts</span>
          </Link>
        )}
        {gateHubNav ? (
          <button
            type="button"
            className="app-bottom-nav-link"
            onClick={() => onRequestHubAuth('you', '/plan')}
          >
            <span className="app-bottom-nav-icon-wrap">
              <PlanIcon size={22} />
            </span>
            <span>Plan</span>
          </button>
        ) : (
          <Link
            to="/plan"
            className={`app-bottom-nav-link${planActive ? ' is-active' : ''}`}
            aria-current={planActive ? 'page' : undefined}
          >
            <span className="app-bottom-nav-icon-wrap">
              <PlanIcon size={22} active={planActive} />
            </span>
            <span>Plan</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
