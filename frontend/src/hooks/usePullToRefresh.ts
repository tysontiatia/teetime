import { createContext, useContext, useEffect, type RefObject } from 'react';

export type RefreshFn = () => void | Promise<void>;

export type PullStore = {
  fn: RefreshFn | null;
};

export const PullToRefreshContext = createContext<{
  register: (refresh: RefreshFn) => () => void;
  storeRef: RefObject<PullStore>;
} | null>(null);

/** Page registers the reload that a downward swipe at the top of the PWA should run. */
export function usePullToRefresh(refresh: RefreshFn) {
  const ctx = useContext(PullToRefreshContext);
  useEffect(() => {
    if (!ctx) return;
    return ctx.register(refresh);
  }, [ctx, refresh]);
}
