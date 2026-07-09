import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAdminCourses } from '../../lib/courseAdminApi';
import type { AdminCourseListItem } from '../../lib/adminCourseTypes';
import { platformDisplayName } from '../../lib/platformRegistry';

export function AdminCoursesListPage() {
  const [courses, setCourses] = useState<AdminCourseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        setCourses(await listAdminCourses());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load courses');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return courses;
    return courses.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.slug.includes(needle) ||
        (c.area || '').toLowerCase().includes(needle),
    );
  }, [courses, q]);

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        <div>
          <Link to="/" className="pill">
            ← Back to finder
          </Link>
          <h1 style={{ margin: '12px 0 4px', fontFamily: 'var(--font-display)', fontSize: 32, letterSpacing: '-0.03em' }}>
            Course catalog admin
          </h1>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
            Edit enrichment, booking platform, and rate cards. Saves go live via the course registry (no redeploy needed after backfill).
          </p>
        </div>
        <Link className="btn btn-primary" to="/admin/courses/new">
          + Add course
        </Link>
      </div>

      <div style={{ marginTop: 16 }}>
        <input
          className="input"
          placeholder="Search by name, slug, or area…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: '100%', maxWidth: 420 }}
        />
      </div>

      {loading ? (
        <p style={{ marginTop: 16, color: 'var(--muted)' }}>Loading courses…</p>
      ) : error ? (
        <p style={{ marginTop: 16, color: '#9a3412' }}>{error}</p>
      ) : filtered.length === 0 ? (
        <p style={{ marginTop: 16, color: 'var(--muted)' }}>
          No courses in registry yet. Run the backfill script, or add a new course.
        </p>
      ) : (
        <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', background: 'rgba(248,250,248,0.95)', color: 'var(--muted)', fontSize: 12 }}>
                <th style={{ padding: '10px 12px' }}>Course</th>
                <th style={{ padding: '10px 12px' }}>Platform</th>
                <th style={{ padding: '10px 12px' }}>Rates</th>
                <th style={{ padding: '10px 12px' }}>Updated</th>
                <th style={{ padding: '10px 12px' }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.slug} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 800 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.slug}</div>
                    {c.area ? <div style={{ fontSize: 12, color: 'var(--subtle)' }}>{c.area}</div> : null}
                  </td>
                  <td style={{ padding: '10px 12px' }}>{platformDisplayName(c.platform || undefined)}</td>
                  <td style={{ padding: '10px 12px' }}>{c.has_rates ? '✓' : '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12 }}>
                    {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <Link className="btn" to={`/admin/courses/${c.slug}`}>
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
