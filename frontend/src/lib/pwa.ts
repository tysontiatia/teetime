const DISMISS_KEY = 'tt-install-dismissed-at';
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

export type InstallPlatform = 'ios' | 'android' | 'desktop';

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = 'standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return mq || iosStandalone;
}

export function detectInstallPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export function isMobileInstallCandidate(): boolean {
  if (typeof window === 'undefined') return false;
  if (isStandaloneDisplay()) return false;
  const platform = detectInstallPlatform();
  if (platform === 'ios' || platform === 'android') return true;
  return window.matchMedia('(max-width: 820px)').matches;
}

export function wasInstallDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

export function dismissInstallPrompt(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function clearInstallDismiss(): void {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  // Only register under /app/ (Vite base); SW must live in scope.
  const swUrl = `${import.meta.env.BASE_URL}sw.js`;
  try {
    await navigator.serviceWorker.register(swUrl, { scope: import.meta.env.BASE_URL });
  } catch {
    /* installability degrades gracefully */
  }
}
