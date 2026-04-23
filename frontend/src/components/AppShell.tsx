import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';

export function AppShell() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const avatar =
    (user?.user_metadata?.avatar_url as string | undefined) ||
    (user?.user_metadata?.picture as string | undefined);
  const initial = (user?.email?.[0] || user?.user_metadata?.full_name?.[0] || '?').toUpperCase();

  return (
    <div>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'rgba(26,46,26,0.96)',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div
          className="container"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '14px 0',
          }}
        >
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              aria-hidden
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'rgba(255,255,255,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="3.5" y="2" width="1.5" height="12" fill="white" rx="0.5" />
                <path d="M5 2.5L12.5 5.5L5 8.5V2.5Z" fill="white" />
              </svg>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', color: '#fff', fontSize: 18, lineHeight: 1.1 }}>
                Tee-Time <span style={{ fontSize: 10, opacity: 0.55, marginLeft: 6, letterSpacing: '0.12em' }}>UTAH</span>
              </div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>Find availability. Plan the round.</div>
            </div>
          </Link>

          <div style={{ flex: 1 }} />

          <nav style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <NavLink
              to="/"
              end
              style={({ isActive }) => ({
                padding: '8px 12px',
                borderRadius: 10,
                color: isActive ? '#fff' : 'rgba(255,255,255,0.68)',
                background: isActive ? 'rgba(255,255,255,0.10)' : 'transparent',
                fontWeight: 700,
                fontSize: 13,
              })}
            >
              Tee times
            </NavLink>
            <NavLink
              to="/plan"
              style={({ isActive }) => ({
                padding: '8px 12px',
                borderRadius: 10,
                color: isActive ? '#fff' : 'rgba(255,255,255,0.68)',
                background: isActive ? 'rgba(255,255,255,0.10)' : 'transparent',
                fontWeight: 700,
                fontSize: 13,
              })}
            >
              Plan
            </NavLink>

            {loading ? (
              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginLeft: 8 }}>…</span>
            ) : user ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 8 }}>
                {avatar ? (
                  <img
                    src={avatar}
                    alt=""
                    width={32}
                    height={32}
                    style={{ borderRadius: 999, border: '1px solid rgba(255,255,255,0.25)' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      background: 'rgba(255,255,255,0.15)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 800,
                    }}
                  >
                    {initial}
                  </div>
                )}
                <button
                  className="btn"
                  type="button"
                  onClick={() => void signOut()}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.08)',
                    color: 'rgba(255,255,255,0.85)',
                    borderColor: 'rgba(255,255,255,0.18)',
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void signInWithGoogle()}
                style={{ marginLeft: 8, padding: '8px 14px', fontSize: 13 }}
              >
                Sign in with Google
              </button>
            )}
          </nav>
        </div>
      </header>

      <main style={{ padding: '18px 0 120px' }}>
        <Outlet />
      </main>
    </div>
  );
}

