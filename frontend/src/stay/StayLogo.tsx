import { Link } from 'react-router-dom';

export function StayLogo({ onClick }: { onClick?: () => void }) {
  return (
    <Link to="/" className="stay-logo" aria-label="Tee-Time home" onClick={onClick}>
      <span className="stay-logo-mark" aria-hidden>
        <img className="is-light" src="/logo-icon-light.svg" alt="" width={26} height={26} />
        <img className="is-dark" src="/logo-icon-dark.svg" alt="" width={26} height={26} />
      </span>
      <span className="stay-logo-word">
        Tee-Time<span className="stay-logo-tld">.io</span>
      </span>
    </Link>
  );
}
