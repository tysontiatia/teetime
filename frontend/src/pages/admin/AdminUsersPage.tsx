import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAdminUsers, type AdminUserListItem } from '../../lib/courseAdminApi';

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function providerLabel(provider: string | null): string {
  if (!provider) return '—';
  if (provider === 'google') return 'Google';
  if (provider === 'email') return 'Email';
  return provider;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function countSignedUpSince(users: AdminUserListItem[], start: Date): number {
  const t = start.getTime();
  return users.filter((u) => {
    if (!u.created_at) return false;
    const d = new Date(u.created_at);
    return !Number.isNaN(d.getTime()) && d.getTime() >= t;
  }).length;
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const data = await listAdminUsers();
        setUsers(data.users);
        setCount(data.count);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load users');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const { last7, thisMonth } = useMemo(() => {
    const now = new Date();
    return {
      last7: countSignedUpSince(users, new Date(startOfLocalDay(now).getTime() - 6 * 86400000)),
      thisMonth: countSignedUpSince(users, new Date(now.getFullYear(), now.getMonth(), 1)),
    };
  }, [users]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) => {
      return (
        (u.display_name || '').toLowerCase().includes(needle) ||
        (u.email || '').toLowerCase().includes(needle) ||
        (u.phone || '').toLowerCase().includes(needle)
      );
    });
  }, [users, q]);

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          marginTop: 8,
        }}
      >
        <div>
          <Link to="/admin/courses" className="pill">
            ← Course catalog
          </Link>
          <h1 style={{ margin: '12px 0 4px', fontFamily: 'var(--font-display)', fontSize: 32, letterSpacing: '-0.03em' }}>
            Signups
          </h1>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
            Accounts that have signed up for Tee-Time.
          </p>
        </div>
      </div>

      {loading ? (
        <p style={{ marginTop: 16, color: 'var(--muted)' }}>Loading signups…</p>
      ) : error ? (
        <p className="admin-err" style={{ marginTop: 16 }}>{error}</p>
      ) : (
        <>
          <div
            style={{
              marginTop: 20,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            <div
              style={{
                padding: '16px 18px',
                border: '1px solid var(--border)',
                borderRadius: 16,
                background: 'var(--card)',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.04em' }}>
                TOTAL SIGNUPS
              </div>
              <div style={{ marginTop: 6, fontFamily: 'var(--font-display)', fontSize: 40, letterSpacing: '-0.04em', lineHeight: 1 }}>
                {count}
              </div>
            </div>
            <div
              style={{
                padding: '16px 18px',
                border: '1px solid var(--border)',
                borderRadius: 16,
                background: 'var(--card)',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.04em' }}>
                LAST 7 DAYS
              </div>
              <div style={{ marginTop: 6, fontFamily: 'var(--font-display)', fontSize: 40, letterSpacing: '-0.04em', lineHeight: 1 }}>
                {last7}
              </div>
            </div>
            <div
              style={{
                padding: '16px 18px',
                border: '1px solid var(--border)',
                borderRadius: 16,
                background: 'var(--card)',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.04em' }}>
                THIS MONTH
              </div>
              <div style={{ marginTop: 6, fontFamily: 'var(--font-display)', fontSize: 40, letterSpacing: '-0.04em', lineHeight: 1 }}>
                {thisMonth}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <input
              className="input"
              placeholder="Search by name, email, or phone…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: '100%', maxWidth: 420 }}
            />
          </div>

          {filtered.length === 0 ? (
            <p style={{ marginTop: 16, color: 'var(--muted)' }}>
              {users.length === 0 ? 'No signups yet.' : 'No users match this search.'}
            </p>
          ) : (
            <div
              style={{
                marginTop: 16,
                border: '1px solid var(--border)',
                borderRadius: 16,
                overflowX: 'auto',
                background: 'var(--card)',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr
                    style={{
                      textAlign: 'left',
                      background: 'color-mix(in srgb, var(--sand) 70%, var(--card))',
                      color: 'var(--muted)',
                      fontSize: 12,
                    }}
                  >
                    <th style={{ padding: '10px 12px' }}>Name</th>
                    <th style={{ padding: '10px 12px' }}>Email</th>
                    <th style={{ padding: '10px 12px' }}>Signed up</th>
                    <th style={{ padding: '10px 12px' }}>Last sign-in</th>
                    <th style={{ padding: '10px 12px' }}>Auth</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 800 }}>{u.display_name || '—'}</div>
                        {u.is_admin ? (
                          <div style={{ fontSize: 12, color: 'var(--pine-deep)', fontWeight: 700 }}>Admin</div>
                        ) : null}
                        {u.phone ? (
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.phone}</div>
                        ) : null}
                      </td>
                      <td style={{ padding: '10px 12px', wordBreak: 'break-all' }}>{u.email || '—'}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {formatWhen(u.created_at)}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {formatWhen(u.last_sign_in_at)}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12 }}>
                        {providerLabel(u.provider)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
