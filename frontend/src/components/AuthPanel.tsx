import type { ReactNode } from 'react';
import { AppBackLink } from './AppBackLink';

function AuthLogoMark() {
  return (
    <span className="auth-panel-logo" aria-hidden>
      <img className="auth-panel-logo-img is-light" src="/logo-icon-light.svg" alt="" width={44} height={44} />
      <img className="auth-panel-logo-img is-dark" src="/logo-icon-dark.svg" alt="" width={44} height={44} />
    </span>
  );
}

function GoogleGlyph() {
  return (
    <svg className="auth-panel-google-icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}

type Props = {
  title?: string;
  titleId?: string;
  children: ReactNode;
  onGoogle: () => void;
  signingIn?: boolean;
  /** Optional secondary action under the Google button (link or button). */
  secondary?: ReactNode;
  showLegal?: boolean;
};

/** Clean centered sign-in panel — Google only (Tee-Time auth). */
export function AuthPanel({
  title = 'Log in or create an account',
  titleId,
  children,
  onGoogle,
  signingIn = false,
  secondary,
  showLegal = true,
}: Props) {
  return (
    <div className="auth-panel">
      <AuthLogoMark />
      <h1 id={titleId} className="auth-panel-title">
        {title}
      </h1>
      <div className="auth-panel-lede">{children}</div>

      <button
        type="button"
        className="auth-panel-google"
        disabled={signingIn}
        onClick={onGoogle}
      >
        <GoogleGlyph />
        <span>{signingIn ? 'Opening Google…' : 'Continue with Google'}</span>
      </button>

      {secondary ? <div className="auth-panel-secondary">{secondary}</div> : null}

      {showLegal ? (
        <p className="auth-panel-legal">
          By continuing, you agree to our{' '}
          <a href="/terms.html" target="_blank" rel="noopener noreferrer">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}

export function AuthPanelBackLink({
  to = '/',
  label = 'Back',
}: {
  to?: string;
  label?: string;
}) {
  return (
    <AppBackLink to={to} className="auth-panel-back">
      {label}
    </AppBackLink>
  );
}
