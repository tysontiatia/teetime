import { useEffect } from 'react';

/**
 * Publishes --keyboard-inset from visualViewport so fixed sheets/modals can
 * sit above the iOS/Android keyboard (especially in installed PWAs).
 */
export function useKeyboardInsetCssVar() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    if (!vv) return;

    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        root.style.setProperty('--keyboard-inset', `${inset}px`);

        // Body scroll lock prevents iOS from scrolling the focused field into view.
        const el = document.activeElement;
        if (
          inset > 0 &&
          el instanceof HTMLElement &&
          (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
        ) {
          const rect = el.getBoundingClientRect();
          const top = vv.offsetTop + 8;
          const bottom = vv.offsetTop + vv.height - 8;
          if (rect.bottom > bottom || rect.top < top) {
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
          }
        }
      });
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('focusin', update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('focusin', update);
      root.style.removeProperty('--keyboard-inset');
    };
  }, []);
}
