import { AppBackLink } from '../components/AppBackLink';

export function NotFoundPage() {
  return (
    <div className="container hub-page">
      <div className="hub-page-card">
        <p className="hub-page-kicker">404</p>
        <h1 className="hub-page-title">Page not found</h1>
        <p className="hub-page-lede">That URL is not part of the app. Check the link or head back to Find.</p>
        <div className="hub-page-actions">
          <AppBackLink to="/" className="btn btn-primary">
            Back
          </AppBackLink>
        </div>
      </div>
    </div>
  );
}
