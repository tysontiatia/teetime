import { Link } from 'react-router-dom';

export function PlanPage() {
  return (
    <div className="container">
      <div style={{ padding: 18, borderRadius: 18, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.8)' }}>
        <div className="pill">Group vote</div>
        <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
          Share tee times from the finder
        </h2>
        <p style={{ color: 'var(--muted)', maxWidth: 640, lineHeight: 1.55 }}>
          Pick a date and filters on the tee times page, then use <strong style={{ color: 'var(--ink)' }}>Share</strong> on a course card (or{' '}
          <strong style={{ color: 'var(--ink)' }}>Share times</strong> on a course page). That creates one link your group opens to vote — no need to tap individual slots.
        </p>
        <Link to="/" className="btn btn-primary" style={{ marginTop: 14 }}>
          Browse tee times →
        </Link>
      </div>
    </div>
  );
}
