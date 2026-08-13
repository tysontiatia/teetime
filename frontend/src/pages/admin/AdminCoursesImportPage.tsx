import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { importAdminCourses } from '../../lib/courseAdminApi';
import { parseMasterCsvToImportRows, type CourseImportRow } from '../../lib/courseImport';

type PreviewStatus = 'create' | 'skip' | 'error' | 'pending';

type PreviewRow = CourseImportRow & {
  status: PreviewStatus;
  detail?: string;
};

function skipDetail(reason?: string, matchedName?: string): string {
  const base = reason || 'exists';
  if (matchedName && (base === 'name_match' || base === 'place_id')) {
    return `${base} → ${matchedName}`;
  }
  return base;
}

export function AdminCoursesImportPage() {
  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState<CourseImportRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const summary = useMemo(() => {
    if (!preview) return null;
    return {
      create: preview.filter((r) => r.status === 'create').length,
      skip: preview.filter((r) => r.status === 'skip').length,
      error: preview.filter((r) => r.status === 'error').length,
    };
  }, [preview]);

  function onParseLocal() {
    setParseError(null);
    setActionError(null);
    setPreview(null);
    setConfirmed(false);
    try {
      const mapped = parseMasterCsvToImportRows(csvText);
      if (mapped.length === 0) {
        setRows(null);
        setParseError('No course rows found. Expect columns including Course Name, City, State, Place ID.');
        return;
      }
      setRows(mapped);
    } catch (e) {
      setRows(null);
      setParseError(e instanceof Error ? e.message : 'Failed to parse CSV');
    }
  }

  async function onFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setParseError(null);
    setActionError(null);
    setPreview(null);
    setConfirmed(false);
    try {
      const mapped = parseMasterCsvToImportRows(text);
      if (mapped.length === 0) {
        setRows(null);
        setParseError('No course rows found. Expect columns including Course Name, City, State, Place ID.');
        return;
      }
      setRows(mapped);
    } catch (e) {
      setRows(null);
      setParseError(e instanceof Error ? e.message : 'Failed to parse CSV');
    }
  }

  async function onDryRun() {
    if (!rows?.length) return;
    setBusy(true);
    setActionError(null);
    setConfirmed(false);
    try {
      const result = await importAdminCourses(rows, { dryRun: true });
      const bySlug = new Map(rows.map((r) => [r.slug, r]));
      const next: PreviewRow[] = [];
      for (const c of result.created) {
        const base = bySlug.get(c.slug);
        if (base) next.push({ ...base, status: 'create' });
      }
      for (const s of result.skipped) {
        const base = bySlug.get(s.slug);
        if (base) {
          next.push({
            ...base,
            status: 'skip',
            detail: skipDetail(s.reason, s.matched_name),
          });
        }
      }
      for (const e of result.errors) {
        const base = e.slug ? bySlug.get(e.slug) : undefined;
        if (base) {
          next.push({ ...base, status: 'error', detail: e.error || 'error' });
        } else {
          next.push({
            slug: e.slug || '(unknown)',
            record: { name: e.name || '', area: '', platform: '', booking_url: '' },
            status: 'error',
            detail: e.error || 'error',
          });
        }
      }
      next.sort((a, b) => a.slug.localeCompare(b.slug));
      setPreview(next);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Dry-run failed');
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    if (!rows?.length || !preview) return;
    const toCreate = preview.filter((r) => r.status === 'create');
    if (toCreate.length === 0) {
      setActionError('Nothing to create — all rows would be skipped.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const result = await importAdminCourses(
        toCreate.map((r) => ({ slug: r.slug, record: r.record })),
        { dryRun: false },
      );
      const next: PreviewRow[] = preview.map((row) => {
        if (result.created.some((c) => c.slug === row.slug)) {
          return { ...row, status: 'create', detail: 'created' };
        }
        if (result.skipped.some((s) => s.slug === row.slug)) {
          const s = result.skipped.find((x) => x.slug === row.slug)!;
          return {
            ...row,
            status: 'skip',
            detail: skipDetail(s.reason, s.matched_name),
          };
        }
        const err = result.errors.find((e) => e.slug === row.slug);
        if (err) return { ...row, status: 'error', detail: err.error || 'error' };
        return row;
      });
      setPreview(next);
      setConfirmed(true);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <div style={{ marginTop: 8 }}>
        <Link to="/admin/courses" className="pill">
          ← Back to courses
        </Link>
        <h1 style={{ margin: '12px 0 4px', fontFamily: 'var(--font-display)', fontSize: 32, letterSpacing: '-0.03em' }}>
          Import course stubs
        </h1>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, maxWidth: 560 }}>
          Paste or upload the Tee Time Master CSV (Idaho or Utah). Dry-run skips existing courses by slug, Google Place
          ID, or same-state name/city match — then confirm creates empty platform / booking URL stubs for QA.
        </p>
      </div>

      <div style={{ marginTop: 20, display: 'grid', gap: 12, maxWidth: 720 }}>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />
        <textarea
          className="input"
          value={csvText}
          onChange={(e) => {
            setCsvText(e.target.value);
            setPreview(null);
            setConfirmed(false);
          }}
          placeholder="Paste CSV (Course Name, Street Address, City, State, ZIP, Phone, Website URL, Region, Place ID)…"
          rows={8}
          style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={onParseLocal} disabled={!csvText.trim() || busy}>
            Parse CSV
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onDryRun()} disabled={!rows?.length || busy}>
            {busy ? 'Working…' : 'Dry-run preview'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onConfirm()}
            disabled={!preview || busy || confirmed || (summary?.create ?? 0) === 0}
          >
            Confirm create {summary ? `(${summary.create})` : ''}
          </button>
        </div>
        {parseError ? <p className="admin-err">{parseError}</p> : null}
        {actionError ? <p className="admin-err">{actionError}</p> : null}
        {rows && !preview ? (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
            Parsed {rows.length} row{rows.length === 1 ? '' : 's'}. Run dry-run to check against the live registry.
          </p>
        ) : null}
        {summary ? (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
            {confirmed ? 'Import finished — ' : 'Dry-run — '}
            {summary.create} create, {summary.skip} skip, {summary.error} error
            {confirmed ? '. Stubs are under Needs booking on the course list.' : '.'}
          </p>
        ) : null}
      </div>

      {preview && preview.length > 0 ? (
        <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 16, overflow: 'auto', background: 'var(--card)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
            <thead>
              <tr style={{ textAlign: 'left', background: 'color-mix(in srgb, var(--sand) 70%, var(--card))', color: 'var(--muted)', fontSize: 12 }}>
                <th style={{ padding: '10px 12px' }}>Status</th>
                <th style={{ padding: '10px 12px' }}>Slug</th>
                <th style={{ padding: '10px 12px' }}>Name</th>
                <th style={{ padding: '10px 12px' }}>Area</th>
                <th style={{ padding: '10px 12px' }}>Timezone</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r) => (
                <tr key={r.slug} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px', textTransform: 'capitalize' }}>
                    {r.status}
                    {r.detail ? (
                      <span style={{ color: 'var(--muted)', fontSize: 11 }}> · {r.detail}</span>
                    ) : null}
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{r.slug}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700 }}>{r.record.name}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>{r.record.area}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>{r.record.timezone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
