import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  captureAppPageview,
  consumeAnalyticsQueryFlag,
  identifyAnalyticsUser,
  initAnalytics,
  optOutAnalytics,
  resetAnalytics,
} from '../lib/analytics';
import { useAuth } from '../state/AuthContext';
import { useIsAdmin } from '../hooks/useIsAdmin';

/**
 * SPA pageviews + identify after Google sign-in.
 * Waits for the admin check so testers with `profiles.is_admin` are never counted.
 */
export function PostHogTracker() {
  const { pathname, search } = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const lastIdentified = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const hold = authLoading || (Boolean(user) && adminLoading);

  useEffect(() => {
    consumeAnalyticsQueryFlag();
  }, [search]);

  useEffect(() => {
    if (hold) return;
    if (isAdmin) {
      optOutAnalytics();
      setReady(false);
      lastIdentified.current = null;
      return;
    }
    setReady(initAnalytics());
  }, [hold, isAdmin]);

  useEffect(() => {
    if (hold || !ready || isAdmin) return;
    captureAppPageview(pathname.replace(/\/$/, '') || '/');
  }, [hold, ready, isAdmin, pathname]);

  useEffect(() => {
    if (hold || !ready || isAdmin) return;
    const id = user?.id ?? null;
    if (id) {
      if (lastIdentified.current !== id) {
        identifyAnalyticsUser(id, user.email);
        lastIdentified.current = id;
      }
      return;
    }
    if (lastIdentified.current) {
      resetAnalytics();
      lastIdentified.current = null;
    }
  }, [hold, ready, isAdmin, user]);

  return null;
}
