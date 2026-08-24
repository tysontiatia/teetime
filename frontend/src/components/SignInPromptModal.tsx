import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../state/AuthContext';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { AuthPanel } from './AuthPanel';
import { ModalCloseButton } from './ModalCloseButton';

export type SignInPromptVariant = 'share' | 'alert' | 'you' | 'general';

const COPY: Record<SignInPromptVariant, { title: string; body: (detail?: string) => ReactNode }> = {
  share: {
    title: 'Share with friends',
    body: () => (
      <>
        Google signs you in — or creates your account if you&apos;re new. Then you can send a live vote link.
      </>
    ),
  },
  alert: {
    title: 'Log in or create an account',
    body: (detail) => (
      <>
        Get an email when tee times open
        {detail ? (
          <>
            {' '}
            at <strong>{detail}</strong>
          </>
        ) : null}
        . If you&apos;re new to Tee-Time, we&apos;ll create an account for you.
      </>
    ),
  },
  you: {
    title: 'Log in or create an account',
    body: () => (
      <>
        Host vote links and see rounds you join. If you&apos;re new to Tee-Time, we&apos;ll create an account for you.
      </>
    ),
  },
  general: {
    title: 'Log in or create an account',
    body: () => (
      <>Use Google to continue. If you&apos;re new to Tee-Time, we&apos;ll create an account for you.</>
    ),
  },
};

export function SignInPromptModal({
  open,
  onClose,
  variant,
  detail,
  closeOnSignIn = true,
  /** In-app path to open after Google OAuth (e.g. `/account`). */
  returnTo,
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
  returnTo?: string;
}) {
  const { user, signInWithGoogle } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const copy = COPY[variant];

  useEffect(() => {
    if (open && user && closeOnSignIn) onClose();
  }, [open, user, onClose, closeOnSignIn]);

  useBodyScrollLock(open);

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
      <div className="modal-panel modal-panel-auth" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onClose} />
        <AuthPanel
          title={copy.title}
          titleId="sign-in-prompt-title"
          signingIn={signingIn}
          onGoogle={() => {
            setSigningIn(true);
            void signInWithGoogle(returnTo).finally(() => setSigningIn(false));
          }}
          secondary={
            <button type="button" className="auth-panel-back" onClick={onClose}>
              Not now
            </button>
          }
        >
          {copy.body(detail)}
        </AuthPanel>
      </div>
    </div>
  );
}
