import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { fetchRecentOpenings, type FeedItem } from '../lib/feedApi';
import { FINDER_PREVIEW_HOURS } from '../lib/feedDisplay';

const STORAGE_KEY = 'tt_feed_players';
const POLL_MS = 60_000;
const PREVIEW_HOURS = FINDER_PREVIEW_HOURS;

export type FeedPlayers = 1 | 2 | 3 | 4;

function clampPlayers(n: number): FeedPlayers {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

function readStoredPlayers(): FeedPlayers {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return clampPlayers(Number(raw));
  } catch {
    // ignore
  }
  return 2;
}

type OpeningsPreviewApi = {
  minPlayers: FeedPlayers;
  setMinPlayers: (players: FeedPlayers) => void;
  items: FeedItem[];
  openCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
};

const OpeningsPreviewContext = createContext<OpeningsPreviewApi | null>(null);

export function OpeningsPreviewProvider({ children }: { children: ReactNode }) {
  const [minPlayers, setMinPlayersState] = useState<FeedPlayers>(() => readStoredPlayers());
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const setMinPlayers = useCallback((players: FeedPlayers) => {
    setMinPlayersState(players);
    try {
      sessionStorage.setItem(STORAGE_KEY, String(players));
    } catch {
      // ignore
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchRecentOpenings({
        hours: PREVIEW_HOURS,
        min_players: minPlayers,
        open_only: true,
        limit: 80,
      });
      setItems(data.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [minPlayers]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const api = useMemo<OpeningsPreviewApi>(
    () => ({
      minPlayers,
      setMinPlayers,
      items,
      openCount: items.length,
      loading,
      refresh,
    }),
    [minPlayers, setMinPlayers, items, loading, refresh],
  );

  return (
    <OpeningsPreviewContext.Provider value={api}>{children}</OpeningsPreviewContext.Provider>
  );
}

export function useOpeningsPreview() {
  const ctx = useContext(OpeningsPreviewContext);
  if (!ctx) throw new Error('useOpeningsPreview must be used within OpeningsPreviewProvider');
  return ctx;
}
