import { useEffect, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { fetchIsAdmin } from '../lib/courseAdminApi';

export function useIsAdmin() {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchIsAdmin().then((v) => {
      if (!cancelled) {
        setIsAdmin(v);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // Key on the stable user id (not the session object) so a background
    // token refresh on tab focus doesn't re-run this and unmount admin pages.
  }, [userId, authLoading]);

  return { isAdmin, loading: authLoading || loading };
}
