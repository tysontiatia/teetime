import { useEffect, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { fetchIsAdmin } from '../lib/courseAdminApi';

export function useIsAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
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
  }, [user, authLoading]);

  return { isAdmin, loading: authLoading || loading };
}
