import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import {
  fetchAlertsSeenAt,
  fetchNotificationLogs,
  groupNotificationLogs,
  markAlertsSeen,
  seedAlertsSeenIfNeeded,
  type AlertActivityItem,
} from '../lib/alertActivity';

type AlertActivityContextValue = {
  items: AlertActivityItem[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markSeen: () => Promise<void>;
};

const AlertActivityContext = createContext<AlertActivityContextValue | null>(null);

export function AlertActivityProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<AlertActivityItem[]>([]);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seenAtRef = useRef<string | null>(null);

  useEffect(() => {
    seenAtRef.current = seenAt;
  }, [seenAt]);

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([]);
      setSeenAt(null);
      seenAtRef.current = null;
      return;
    }
    setLoading(true);
    try {
      const [logs, seen] = await Promise.all([fetchNotificationLogs(user.id), fetchAlertsSeenAt(user.id)]);
      const seeded = await seedAlertsSeenIfNeeded(user.id, seen);
      const localSeen = seenAtRef.current;
      const cutoff =
        localSeen && seeded && new Date(localSeen).getTime() >= new Date(seeded).getTime()
          ? localSeen
          : seeded ?? localSeen;
      seenAtRef.current = cutoff;
      setSeenAt(cutoff);
      setItems(groupNotificationLogs(logs, cutoff));
    } finally {
      setLoading(false);
    }
  }, [user]);

  const markSeen = useCallback(async () => {
    if (!user) return;
    try {
      const at = await markAlertsSeen(user.id);
      seenAtRef.current = at;
      setSeenAt(at);
      setItems((prev) => prev.map((item) => ({ ...item, unread: false })));
    } catch {
      /* ignore — badge will clear on next successful visit */
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh when returning to the tab (catch pushes that arrived while away).
  useEffect(() => {
    if (!user) return;
    const onVis = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [user, refresh]);

  const unreadCount = useMemo(() => items.filter((i) => i.unread).length, [items]);

  const value = useMemo(
    () => ({ items, unreadCount, loading, refresh, markSeen }),
    [items, unreadCount, loading, refresh, markSeen],
  );

  return <AlertActivityContext.Provider value={value}>{children}</AlertActivityContext.Provider>;
}

export function useAlertActivity(): AlertActivityContextValue {
  const ctx = useContext(AlertActivityContext);
  if (!ctx) {
    return {
      items: [],
      unreadCount: 0,
      loading: false,
      refresh: async () => {},
      markSeen: async () => {},
    };
  }
  return ctx;
}
