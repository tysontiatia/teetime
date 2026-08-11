import type { ReactNode } from 'react';
import { useAuth } from '../state/AuthContext';
import { AuthPanel, AuthPanelBackLink } from './AuthPanel';

type Props = {
  title?: string;
  children: ReactNode;
  secondaryTo?: string;
  secondaryLabel?: string;
  /** In-app path after Google OAuth (e.g. `/account`). */
  returnTo?: string;
};

/** Full-page signed-out gate using the shared auth panel. */
export function SignedOutGate({
  title = 'Log in or create an account',
  children,
  secondaryTo = '/',
  secondaryLabel = 'Back to Find',
  returnTo,
}: Props) {
  const { loading, signInWithGoogle } = useAuth();

  return (
    <div className="container hub-page hub-page--auth">
      <div className="hub-page-card hub-page-card--auth">
        {loading ? (
          <p className="hub-page-status auth-panel-loading">Loading…</p>
        ) : (
          <AuthPanel
            title={title}
            onGoogle={() => void signInWithGoogle(returnTo)}
            secondary={<AuthPanelBackLink to={secondaryTo} label={secondaryLabel} />}
          >
            {children}
          </AuthPanel>
        )}
      </div>
    </div>
  );
}
