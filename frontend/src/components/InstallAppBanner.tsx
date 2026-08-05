export function InstallAppBanner({
  open,
  onInstall,
  onDismiss,
}: {
  open: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  if (!open) return null;

  return (
    <div className="install-banner" role="region" aria-label="Install Tee-Time">
      <div className="install-banner-copy">
        <div className="install-banner-title">Install Tee-Time</div>
        <p className="install-banner-sub">Add it to your home screen for one-tap access.</p>
      </div>
      <div className="install-banner-actions">
        <button type="button" className="btn btn-primary install-banner-install" onClick={onInstall}>
          Install
        </button>
        <button type="button" className="btn btn-ghost install-banner-dismiss" onClick={onDismiss} aria-label="Dismiss">
          Not now
        </button>
      </div>
    </div>
  );
}
