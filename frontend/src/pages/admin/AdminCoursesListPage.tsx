import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { AppBackLink } from '../../components/AppBackLink';
import { listAdminCourses, reclassifyAdminPlatforms } from '../../lib/courseAdminApi';
import type { AdminCourseListItem } from '../../lib/adminCourseTypes';
import {
  BOOKING_STATUS_LABELS,
  needsBookingRecord,
  resolveBookingStatus,
  type BookingStatus,
} from '../../lib/adminBookingQa';
import { effectivePlatform, platformDisplayName, rollupPlatforms } from '../../lib/platformRegistry';

type ListFilter = 'all' | BookingStatus;

export function AdminCoursesListPage() {
  const [courses, setCourses] = useState<AdminCourseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ListFilter>('all');
  const [vendorFilter, setVendorFilter] = useState<string | null>(null);
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassifyMsg, setReclassifyMsg] = useState<string | null>(null);

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

  const counts = useMemo(() => {
    const out: Record<BookingStatus, number> = {
      pending: 0,
      ready: 0,
      phone: 0,
      unsupported: 0,
      private: 0,
      closed: 0,
    };
    for (const c of courses) out[resolveBookingStatus(c)] += 1;
    return out;
  }, [courses]);

  const platformRollup = useMemo(() => rollupPlatforms(courses), [courses]);
  const backlogRollup = platformRollup.filter((r) => !r.live);

  const firstNeedsSlug = useMemo(
    () => courses.find(needsBookingRecord)?.slug ?? null,
    [courses],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return courses.filter((c) => {
      const status = resolveBookingStatus(c);
      if (filter !== 'all' && status !== filter) return false;
      if (vendorFilter && effectivePlatform(c) !== vendorFilter) return false;
      if (!needle) return true;
      return (
        c.name.toLowerCase().includes(needle) ||
        c.slug.includes(needle) ||
        (c.area || '').toLowerCase().includes(needle) ||
        (c.booking_status_note || '').toLowerCase().includes(needle) ||
        platformDisplayName(effectivePlatform(c)).toLowerCase().includes(needle)
      );
    });
  }, [courses, q, filter, vendorFilter]);

  const chipStyle = (active: boolean): CSSProperties => ({
    border: `1px solid ${active ? 'var(--pine)' : 'var(--border)'}`,
    background: active ? 'color-mix(in srgb, var(--pine) 14%, var(--card))' : 'var(--card)',
    color: active ? 'var(--pine-deep)' : 'var(--ink)',
    borderRadius: 999,
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
  });

  const statusLabel = (c: AdminCourseListItem) => {
    const status = resolveBookingStatus(c);
    if (status === 'ready') return platformDisplayName(effectivePlatform(c) || c.platform || undefined);
    if (status === 'unsupported') {
      const vendor = effectivePlatform(c);
      return vendor ? `Unsupported · ${platformDisplayName(vendor)}` : BOOKING_STATUS_LABELS.unsupported;
    }
    return BOOKING_STATUS_LABELS[status];
  };

  const statusDetail = (c: AdminCourseListItem): { text: string; href?: string } | null => {
    const status = resolveBookingStatus(c);
    if (status === 'unsupported' && c.booking_url) {
      try {
        const host = new URL(c.booking_url).hostname.replace(/^www\./, '');
        return { text: host, href: c.booking_url };
      } catch {
        return { text: c.booking_url, href: c.booking_url };
      }
    }
    return null;
  };

  const filters: { id: ListFilter; label: string; count?: number }[] = [
    { id: 'all', label: 'All', count: courses.length },
    { id: 'pending', label: 'Needs booking', count: counts.pending },
    { id: 'ready', label: 'Has booking', count: counts.ready },
    { id: 'phone', label: 'Phone', count: counts.phone },
    { id: 'unsupported', label: 'Unsupported', count: counts.unsupported },
    { id: 'private', label: 'Private', count: counts.private },
    { id: 'closed', label: 'Closed', count: counts.closed },
  ];

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        <div>
          <AppBackLink to="/" className="pill">
            ← Back
          </AppBackLink>
          <h1 style={{ margin: '12px 0 4px', fontFamily: 'var(--font-display)', fontSize: 32, letterSpacing: '-0.03em' }}>
            Course catalog admin
          </h1>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
            Edit enrichment, booking platform, and rate cards. Saves go live via the course registry (no redeploy needed after backfill).
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn" to="/admin/users">
            Signups
          </Link>
          {firstNeedsSlug ? (
            <Link className="btn btn-primary" to={`/admin/courses/qa/${firstNeedsSlug}`}>
              Start booking QA
            </Link>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={reclassifying}
            onClick={() => {
              void (async () => {
                setReclassifying(true);
                setReclassifyMsg(null);
                try {
                  const result = await reclassifyAdminPlatforms();
                  setCourses(await listAdminCourses());
                  setReclassifyMsg(
                    result.counts.updated === 0
                      ? `Checked ${result.counts.scanned} courses — all vendors already match their booking URL.`
                      : `Updated ${result.counts.updated} of ${result.counts.scanned} courses from booking URLs.`,
                  );
                } catch (e) {
                  setReclassifyMsg(e instanceof Error ? e.message : 'Recategorize failed');
                } finally {
                  setReclassifying(false);
                }
              })();
            }}
          >
            {reclassifying ? 'Recategorizing…' : 'Recategorize from booking URLs'}
          </button>
          <Link className="btn" to="/admin/courses/import">
            Import CSV
          </Link>
          <Link className="btn" to="/admin/courses/new">
            + Add course
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {filters.map((f) => (
          <button key={f.id} type="button" style={chipStyle(filter === f.id)} onClick={() => setFilter(f.id)}>
            {f.label}
            {typeof f.count === 'number' ? ` (${f.count})` : ''}
          </button>
        ))}
        {!loading && !error ? (
          <span style={{ marginLeft: 4, color: 'var(--muted)', fontSize: 13 }}>
            {counts.pending} / {courses.length} need booking
            {filter !== 'all' ? ` · showing ${filtered.length}` : ''}
          </span>
        ) : null}
      </div>

      {!loading && !error && platformRollup.length > 0 ? (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            border: '1px solid var(--border)',
            borderRadius: 16,
            background: 'var(--card)',
            display: 'grid',
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>What to build next</div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)', maxWidth: 640 }}>
              Vendors we don’t poll yet. Click a chip to filter the table. Recategorize writes the vendor from the
              booking URL so leftover “Other” rows get a real name.
            </p>
          </div>
          {reclassifyMsg ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>{reclassifyMsg}</p>
          ) : null}
          {backlogRollup.length > 0 ? (
            <div>
              <div style={{ marginTop: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {backlogRollup.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    style={chipStyle(vendorFilter === r.key)}
                    onClick={() => setVendorFilter((cur) => (cur === r.key ? null : r.key))}
                  >
                    {r.label} ({r.count})
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>No unsupported vendors yet.</p>
          )}
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <input
          className="input"
          placeholder="Search by name, slug, area, or note…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: '100%', maxWidth: 420 }}
        />
      </div>

      {loading ? (
        <p style={{ marginTop: 16, color: 'var(--muted)' }}>Loading courses…</p>
      ) : error ? (
        <p className="admin-err" style={{ marginTop: 16 }}>{error}</p>
      ) : filtered.length === 0 ? (
        <p style={{ marginTop: 16, color: 'var(--muted)' }}>
          {courses.length === 0
            ? 'No courses in registry yet. Run the backfill script, import CSV, or add a new course.'
            : 'No courses match this filter.'}
        </p>
      ) : (
        <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', background: 'var(--card)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', background: 'color-mix(in srgb, var(--sand) 70%, var(--card))', color: 'var(--muted)', fontSize: 12 }}>
                <th style={{ padding: '10px 12px' }}>Course</th>
                <th style={{ padding: '10px 12px' }}>Status</th>
                <th style={{ padding: '10px 12px' }}>Rates</th>
                <th style={{ padding: '10px 12px' }}>Updated</th>
                <th style={{ padding: '10px 12px' }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const status = resolveBookingStatus(c);
                return (
                  <tr key={c.slug} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 800 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.slug}</div>
                      {c.area ? <div style={{ fontSize: 12, color: 'var(--subtle)' }}>{c.area}</div> : null}
                    </td>
                    <td style={{ padding: '10px 12px', color: status === 'pending' ? 'var(--muted)' : undefined }}>
                      <div>{statusLabel(c)}</div>
                      {(() => {
                        const detail = statusDetail(c);
                        if (!detail) return null;
                        return detail.href ? (
                          <a
                            href={detail.href}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontSize: 12, color: 'var(--subtle)', wordBreak: 'break-all' }}
                          >
                            {detail.text}
                          </a>
                        ) : (
                          <div style={{ fontSize: 12, color: 'var(--subtle)' }}>{detail.text}</div>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '10px 12px' }}>{c.has_rates ? '✓' : '—'}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12 }}>
                      {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {status === 'pending' ? (
                        <Link className="btn btn-primary" to={`/admin/courses/qa/${c.slug}`} style={{ marginRight: 8 }}>
                          QA
                        </Link>
                      ) : null}
                      <Link className="btn" to={`/admin/courses/${c.slug}`}>
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
