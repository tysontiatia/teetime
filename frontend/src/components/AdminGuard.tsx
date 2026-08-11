import { Outlet } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { SignedOutGate } from './SignedOutGate';

export function AdminGuard() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsAdmin();

  if (authLoading || adminLoading) {
    return (
      <div className="container hub-page">
        <div className="hub-page-card">
          <p className="hub-page-status">Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <SignedOutGate title="Admin sign-in required">
        Sign in with your Google account to manage the course catalog. If you&apos;re new to Tee-Time, we&apos;ll
        create an account for you.
      </SignedOutGate>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container hub-page">
        <div className="hub-page-card">
          <h1 className="hub-page-title">Access denied</h1>
          <p className="hub-page-lede">
            Your account does not have admin access. Set <code>profiles.is_admin = true</code> in Supabase for your
            user.
          </p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
