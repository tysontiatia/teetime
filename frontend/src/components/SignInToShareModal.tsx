import { useEffect } from 'react';
import { useAuth } from '../state/AuthContext';

export function SignInToShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, signInWithGoogle } = useAuth();

  useEffect(() => {
    if (open && user) onClose();
  }, [open, user, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-in-share-title"
      style={{ zIndex: 85 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-panel modal-panel-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 id="sign-in-share-title" className="modal-header-title" style={{ fontSize: 20 }}>
              Sign in to share
            </h2>
            <p className="modal-header-sub" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
              Create a live vote link your group can open in one tap. If you don’t have an account yet, Google sign-in
              sets one up for free — your links also appear under <strong style={{ color: 'var(--ink)' }}>Shared rounds</strong>.
            </p>
          </div>
          <button className="btn btn-ghost" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void signInWithGoogle()}
            style={{ padding: '12px 16px', fontWeight: 700 }}
          >
            Continue with Google
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose} style={{ padding: '10px 16px' }}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
