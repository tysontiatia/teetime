import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="container" style={{ padding: '48px 0', maxWidth: 520 }}>
      <div className="pill">404</div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.5rem, 4vw, 2rem)', margin: '12px 0' }}>
        Page not found
      </h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 20px', lineHeight: 1.55 }}>
        That URL is not part of the app. Check the link or head back to the finder.
      </p>
      <Link to="/" className="btn btn-primary">
        Go to search
      </Link>
    </div>
  );
}
