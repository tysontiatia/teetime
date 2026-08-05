import { useEffect, useState, type ReactNode } from 'react';
import type { InstallPlatform } from '../lib/pwa';

type Tab = 'ios' | 'android';

function Step({
  n,
  title,
  body,
  icon,
}: {
  n: number;
  title: string;
  body: string;
  icon: ReactNode;
}) {
  return (
    <li className="install-step">
      <div className="install-step-num" aria-hidden>
        {n}
      </div>
      <div className="install-step-icon" aria-hidden>
        {icon}
      </div>
      <div className="install-step-copy">
        <div className="install-step-title">{title}</div>
        <p className="install-step-body">{body}</p>
      </div>
    </li>
  );
}

function IosShareIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v12M8 7l4-4 4 4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusSquareIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MenuDotsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function InstallAppModal({
  open,
  onClose,
  platform,
  canNativeInstall,
  onNativeInstall,
}: {
  open: boolean;
  onClose: () => void;
  platform: InstallPlatform;
  canNativeInstall: boolean;
  onNativeInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}) {
  const defaultTab: Tab = platform === 'android' ? 'android' : 'ios';
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [installBusy, setInstallBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab(platform === 'android' ? 'android' : 'ios');
  }, [open, platform]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const runNative = async () => {
    setInstallBusy(true);
    const outcome = await onNativeInstall();
    setInstallBusy(false);
    if (outcome === 'accepted') onClose();
  };

  return (
    <div className="modal-backdrop install-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel modal-panel-sm install-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="install-modal-title" className="modal-header-title">
              Install Tee-Time
            </h2>
            <p className="modal-header-sub">Add Tee-Time to your home screen for quicker access.</p>
          </div>
          <button className="btn btn-ghost" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body install-modal-body">
          <div className="modal-seg install-os-seg" role="tablist" aria-label="Phone type">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'ios'}
              className={`btn modal-seg-btn${tab === 'ios' ? ' on' : ''}`}
              onClick={() => setTab('ios')}
            >
              iOS
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'android'}
              className={`btn modal-seg-btn${tab === 'android' ? ' on' : ''}`}
              onClick={() => setTab('android')}
            >
              Android
            </button>
          </div>

          {tab === 'android' && canNativeInstall ? (
            <div className="install-native">
              <p className="install-native-copy">Your browser can install Tee-Time in one tap.</p>
              <button
                type="button"
                className="btn btn-primary install-native-btn"
                disabled={installBusy}
                onClick={() => void runNative()}
              >
                {installBusy ? '…' : 'Install app'}
              </button>
            </div>
          ) : null}

          {tab === 'ios' ? (
            <ol className="install-steps">
              <Step
                n={1}
                title="Tap Share"
                body="In Safari, tap the Share button in the toolbar (square with an arrow)."
                icon={<IosShareIcon />}
              />
              <Step
                n={2}
                title="Add to Home Screen"
                body="Scroll the share sheet and choose Add to Home Screen."
                icon={<PlusSquareIcon />}
              />
              <Step
                n={3}
                title="Confirm"
                body="Tap Add. Tee-Time appears on your home screen like an app."
                icon={<CheckIcon />}
              />
            </ol>
          ) : (
            <ol className="install-steps">
              <Step
                n={1}
                title="Open the browser menu"
                body="Tap the ⋮ menu (Chrome) or the address-bar install icon if you see it."
                icon={<MenuDotsIcon />}
              />
              <Step
                n={2}
                title="Install app / Add to Home screen"
                body="Choose Install app or Add to Home screen."
                icon={<PlusSquareIcon />}
              />
              <Step
                n={3}
                title="Confirm"
                body="Tap Install. Open Tee-Time from your home screen anytime."
                icon={<CheckIcon />}
              />
            </ol>
          )}

          <div className="install-why">
            <div className="install-why-title">Why install it?</div>
            <ul className="install-why-list">
              <li>Open in one tap</li>
              <li>Full screen without browser bars</li>
              <li>Faster access to tee times</li>
              <li>Push notifications when tee times open</li>
            </ul>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
