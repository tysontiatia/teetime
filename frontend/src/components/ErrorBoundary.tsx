import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err.message || 'Something went wrong' };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', err, info.componentStack);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="container" style={{ padding: '48px 0', maxWidth: 520 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.5rem, 4vw, 2rem)', margin: '0 0 12px' }}>
            This page hit a snag
          </h1>
          <p style={{ color: 'var(--muted)', margin: '0 0 20px', lineHeight: 1.55 }}>
            Try reloading. If it keeps happening, let us know what you were doing so we can fix it.
          </p>
          {import.meta.env.DEV ? (
            <pre
              style={{
                fontSize: 12,
                padding: 12,
                borderRadius: 10,
                background: 'rgba(26,46,26,0.06)',
                overflow: 'auto',
                marginBottom: 20,
              }}
            >
              {this.state.message}
            </pre>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload page
            </button>
            <Link to="/" className="btn">
              Back to search
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
