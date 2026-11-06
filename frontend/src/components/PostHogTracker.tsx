import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  captureAppPageview,
  consumeAnalyticsQueryFlag,
  identifyAnalyticsUser,
  captureEvent,
  initAnalytics,
  resetAnalytics,
} from '../lib/analytics';
import { useAuth } from '../state/AuthContext';
import { useIsAdmin } from '../hooks/useIsAdmin';

/**
 * SPA pageviews, and a person profile after Google sign-in.
 * Admins are identified with is_admin so they can be filtered out of product insights.
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
    setReady(initAnalytics());
  }, [hold]);

  useEffect(() => {
    if (hold || !ready) return;
    captureAppPageview(pathname.replace(/\/$/, '') || '/');
  }, [hold, ready, pathname]);

  useEffect(() => {
    if (hold || !ready) return;
    const id = user?.id ?? null;
    if (user && id) {
      if (lastIdentified.current !== id) {
        const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
        const name = meta?.full_name || meta?.name || null;
        identifyAnalyticsUser(id, { email: user.email, name, isAdmin });
        captureEvent('signed_in', { is_admin: isAdmin });
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
