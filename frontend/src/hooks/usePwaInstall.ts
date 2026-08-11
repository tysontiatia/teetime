import { useCallback, useEffect, useState } from 'react';
import {
  detectInstallPlatform,
  dismissInstallPrompt,
  isMobileInstallCandidate,
  isStandaloneDisplay,
  wasInstallDismissedRecently,
  type InstallPlatform,
} from '../lib/pwa';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function usePwaInstall() {
  const [installed, setInstalled] = useState(() => isStandaloneDisplay());
  const [platform, setPlatform] = useState<InstallPlatform>(() => detectInstallPlatform());
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [canSoftPrompt, setCanSoftPrompt] = useState(false);

  useEffect(() => {
    setInstalled(isStandaloneDisplay());
    setPlatform(detectInstallPlatform());
    setCanSoftPrompt(isMobileInstallCandidate() && !wasInstallDismissedRecently());

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBip);

    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
      setCanSoftPrompt(false);
    };
    window.addEventListener('appinstalled', onInstalled);

    const mq = window.matchMedia('(display-mode: standalone)');
    const onMq = () => setInstalled(isStandaloneDisplay());
    mq.addEventListener?.('change', onMq);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
      mq.removeEventListener?.('change', onMq);
    };
  }, []);

  const promptNativeInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferredPrompt) return 'unavailable';
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (outcome === 'accepted') setInstalled(true);
      return outcome;
    } catch {
      return 'unavailable';
    }
  }, [deferredPrompt]);

  const dismissSoftPrompt = useCallback(() => {
    dismissInstallPrompt();
    setCanSoftPrompt(false);
  }, []);

  return {
    installed,
    platform,
    canNativeInstall: !!deferredPrompt,
    canSoftPrompt: canSoftPrompt && !installed,
    /** Header / menu install entry — mobile only; desktop PWAs are rare for this product. */
    showInstallEntry: !installed && isMobileInstallCandidate(),
    promptNativeInstall,
    dismissSoftPrompt,
  };
}
