import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../state/AuthContext';

export type SignInPromptVariant = 'share' | 'alert';

const COPY: Record<SignInPromptVariant, { title: string; body: (detail?: string) => ReactNode }> = {
  share: {
    title: 'Sign in to share',
    body: () => (
      <>
        Create a live vote link your group can open in one tap. Google sign-in is free. Links also appear under{' '}
        <strong style={{ color: 'var(--ink)' }}>You → Shared rounds</strong>.
      </>
    ),
  },
  alert: {
    title: 'Sign in for alerts',
    body: (detail) => (
      <>
        Get an email when tee times open
        {detail ? (
          <>
            {' '}
            at <strong style={{ color: 'var(--ink)' }}>{detail}</strong>
          </>
        ) : null}
        . Google sign-in is free and takes a few seconds.
      </>
    ),
  },
};

export function SignInPromptModal({
  open,
  onClose,
  variant,
  detail,
  closeOnSignIn = true,
}: {
  open: boolean;
  onClose: () => void;
  variant: SignInPromptVariant;
  /** e.g. course name for alerts */
  detail?: string;
  /**
   * When true (default), close as soon as a user session appears.
   * Set false when the parent should stay open and continue (e.g. alert form after Google).
   */
  closeOnSignIn?: boolean;
}) {
  const { user, signInWithGoogle } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const copy = COPY[variant];

  useEffect(() => {
    if (open && user && closeOnSignIn) onClose();
  }, [open, user, onClose, closeOnSignIn]);

  useEffect(() => {
    if (!open) {
      setSigningIn(false);
      return;
    }
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
      aria-labelledby="sign-in-prompt-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-panel modal-panel-sm sign-in-prompt" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 id="sign-in-prompt-title" className="modal-header-title" style={{ fontSize: 20 }}>
              {copy.title}
            </h2>
            <p className="modal-header-sub" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
              {copy.body(detail)}
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
            disabled={signingIn}
            onClick={() => {
              setSigningIn(true);
              void signInWithGoogle().finally(() => setSigningIn(false));
            }}
            style={{ padding: '12px 16px', fontWeight: 700 }}
          >
            {signingIn ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose} style={{ padding: '10px 16px' }}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
