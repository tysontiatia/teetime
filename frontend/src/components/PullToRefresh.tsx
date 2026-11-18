import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PullToRefreshContext, type PullStore, type RefreshFn } from '../hooks/usePullToRefresh';
import { isStandaloneDisplay } from '../lib/pwa';
import { invalidateWeatherCaches } from '../lib/weather';

const PULL_MAX = 88;
const PULL_THRESHOLD = 64;
const PULL_HOLD = 48;
const HIDDEN_Y = -46;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function useStandalone(): boolean {
  const [on, setOn] = useState(isStandaloneDisplay);
  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const sync = () => setOn(isStandaloneDisplay());
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return on;
}

function isFormField(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function blockedSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      '.modal-backdrop, .app-header-drawer-backdrop--open, .finder-map-pane, .user-menu-panel, .user-menu-backdrop',
    ),
  );
}

/** True when the page (and any vertical scroller under the finger) is already at the top. */
function atPageTop(target: EventTarget | null): boolean {
  if (document.body.style.position === 'fixed') return false;
  const root = document.scrollingElement;
  if (root && root.scrollTop > 1) return false;
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    const oy = window.getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && node.scrollHeight > node.clientHeight + 2) {
      if (node.scrollTop > 1) return false;
    }
    node = node.parentElement;
  }
  return true;
}

export function PullToRefreshProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<PullStore>({ fn: null });
  const register = useCallback((refresh: RefreshFn) => {
    storeRef.current.fn = refresh;
    return () => {
      if (storeRef.current.fn === refresh) storeRef.current.fn = null;
    };
  }, []);
  const value = useMemo(() => ({ register, storeRef }), [register]);
  return <PullToRefreshContext.Provider value={value}>{children}</PullToRefreshContext.Provider>;
}

export function PullToRefreshControl() {
  const ctx = useContext(PullToRefreshContext);
  const standalone = useStandalone();
  const [pullY, setPullY] = useState(HIDDEN_Y);
  const [phase, setPhase] = useState<'idle' | 'pulling' | 'refreshing'>('idle');
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!standalone || !ctx) return;
    let startY = 0;
    let startX = 0;
    let armed = false;
    let pulling = false;
    let latest = 0;
    let mounted = true;

    const finish = async () => {
      const started = performance.now();
      try {
        invalidateWeatherCaches();
        await Promise.race([Promise.resolve(ctx.storeRef.current.fn?.()), delay(12000)]);
      } catch {
        /* the page surfaces its own error */
      }
      const remain = 450 - (performance.now() - started);
      if (remain > 0) await delay(remain);
      if (!mounted) return;
      phaseRef.current = 'idle';
      setPhase('idle');
      setPullY(HIDDEN_Y);
    };

    const onStart = (event: TouchEvent) => {
      if (phaseRef.current === 'refreshing' || !ctx.storeRef.current.fn) return;
      if (event.touches.length !== 1) return;
      const target = event.target;
      if (isFormField(target) || blockedSurface(target) || !atPageTop(target)) return;
      const touch = event.touches[0]!;
      startY = touch.clientY;
      startX = touch.clientX;
      armed = true;
      pulling = false;
      latest = 0;
    };

    const onMove = (event: TouchEvent) => {
      if (!armed || event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;
      if (!pulling) {
        if (dy < 10) return;
        if (Math.abs(dx) > dy || !atPageTop(event.target)) {
          armed = false;
          return;
        }
        pulling = true;
        phaseRef.current = 'pulling';
        setPhase('pulling');
      }
      if (dy <= 0) {
        latest = 0;
        setPullY(0);
        return;
      }
      event.preventDefault();
      latest = Math.min(PULL_MAX, dy * 0.48);
      setPullY(latest);
    };

    const onEnd = () => {
      if (!armed) return;
      const shouldRefresh = pulling && latest >= PULL_THRESHOLD && Boolean(ctx.storeRef.current.fn);
      armed = false;
      pulling = false;
      latest = 0;
      if (!shouldRefresh) {
        phaseRef.current = 'idle';
        setPhase('idle');
        setPullY(HIDDEN_Y);
        return;
      }
      phaseRef.current = 'refreshing';
      setPhase('refreshing');
      setPullY(PULL_HOLD);
      void finish();
    };

    window.addEventListener('touchstart', onStart, { passive: true, capture: true });
    window.addEventListener('touchmove', onMove, { passive: false, capture: true });
    window.addEventListener('touchend', onEnd, { capture: true });
    window.addEventListener('touchcancel', onEnd, { capture: true });
    return () => {
      mounted = false;
      window.removeEventListener('touchstart', onStart, { capture: true });
      window.removeEventListener('touchmove', onMove, { capture: true });
      window.removeEventListener('touchend', onEnd, { capture: true });
      window.removeEventListener('touchcancel', onEnd, { capture: true });
    };
  }, [ctx, standalone]);

  const visible = phase !== 'idle';
  const spin = phase === 'refreshing';
  const ready = pullY >= PULL_THRESHOLD;

  if (!standalone) return null;

  return (
    <div
      className={`ptr${phase === 'pulling' ? ' is-pulling' : ''}${spin ? ' is-refreshing' : ''}`}
      style={{ transform: `translateY(${pullY}px)`, opacity: visible ? 1 : 0 }}
      aria-hidden={!spin}
    >
      <span className={`ptr-icon${ready || spin ? ' is-ready' : ''}`}>
        <svg
          className="ptr-arrow"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          style={spin ? undefined : { transform: `rotate(${Math.min(180, Math.max(0, pullY) * 2.4)}deg)` }}
          aria-hidden
        >
          <path d="M12 5v10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M7.5 11.5 12 16l4.5-4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="visually-hidden" role="status">
        {spin ? 'Refreshing' : ''}
      </span>
    </div>
  );
}
