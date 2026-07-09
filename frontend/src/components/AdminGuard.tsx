import { Outlet } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useIsAdmin } from '../hooks/useIsAdmin';

export function AdminGuard() {
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsAdmin();

  if (authLoading || adminLoading) {
    return (
      <div className="container" style={{ padding: 24, color: 'var(--muted)' }}>
        Loading admin…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container" style={{ padding: 24 }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: 20, background: 'rgba(255,255,255,0.85)' }}>
          <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)' }}>Admin sign-in required</h2>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)' }}>Sign in with your Google account to manage the course catalog.</p>
          <button type="button" className="btn btn-primary" onClick={() => void signInWithGoogle()}>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container" style={{ padding: 24 }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: 20, background: 'rgba(255,255,255,0.85)' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>Access denied</h2>
          <p style={{ margin: '8px 0 0', color: 'var(--muted)' }}>
            Your account does not have admin access. Set <code>profiles.is_admin = true</code> in Supabase for your user.
          </p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
