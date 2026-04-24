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
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-in-share-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 85,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(480px, 100%)',
          background: 'rgba(255,255,255,0.96)',
          borderRadius: 18,
          border: '1px solid rgba(26,46,26,0.12)',
          boxShadow: '0 30px 90px rgba(0,0,0,0.28)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            borderBottom: '1px solid rgba(26,46,26,0.10)',
            background: 'rgba(233,245,234,0.55)',
          }}
        >
          <div>
            <h2 id="sign-in-share-title" style={{ margin: 0, fontWeight: 950, letterSpacing: '-0.02em', fontSize: 20 }}>
              Sign in to share
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
              Create a live vote link your group can open in one tap. If you don’t have an account yet, Google sign-in sets one up for free — your links also appear under{' '}
              <strong style={{ color: 'var(--ink)' }}>Shared rounds</strong>.
            </p>
          </div>
          <button className="btn btn-ghost" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="btn btn-primary" type="button" onClick={() => void signInWithGoogle()} style={{ padding: '12px 16px', fontWeight: 800 }}>
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
