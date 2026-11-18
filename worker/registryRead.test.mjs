import test from 'node:test';
import assert from 'node:assert/strict';
import { RegistryReadError, fetchAllRows, fetchPublicRegistryRows } from './courseAdmin.js';

const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_KEY: 'k' };

/** A fake PostgREST table that honours Range, a max_rows cap, and count=exact. */
function fakeTable(rows, { maxRows = 1000, failAt = null, status = 500 } = {}) {
  return async (url, init) => {
    const [from, to] = String(init.headers.Range).split('-').map(Number);
    if (failAt != null && from >= failAt) return new Response('boom', { status });
    const page = rows.slice(from, Math.min(to + 1, from + maxRows));
    const headers = { 'content-range': `${from}-${from + page.length - 1}/${rows.length}` };
    return new Response(JSON.stringify(page), { status: 200, headers });
  };
}

function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ slug: `c-${String(i).padStart(5, '0')}`, record: { name: `C${i}` } }));

test('reads past 20,000 rows with no cap', () =>
  withFetch(fakeTable(rowsOf(23_456)), async () => {
    const rows = await fetchAllRows(env, 'course_registry?select=slug,record&order=slug');
    assert.equal(rows.length, 23_456);
  }));

test('a lower server max_rows still reads everything', () =>
  withFetch(fakeTable(rowsOf(2_500), { maxRows: 500 }), async () => {
    const rows = await fetchAllRows(env, 'course_registry?select=slug,record&order=slug');
    assert.equal(rows.length, 2_500);
  }));

test('a failed page throws instead of returning the rows read so far', () =>
  withFetch(fakeTable(rowsOf(2_500), { failAt: 1000 }), async () => {
    await assert.rejects(
      fetchAllRows(env, 'course_registry?select=slug,record&order=slug'),
      (err) => err instanceof RegistryReadError && /row 1000/.test(err.message),
    );
  }));

test('the public view falls back to the full registry before the migration', () => {
  const registry = [
    { slug: 'a', record: { name: 'A', booking_status: 'ready', platform: 'foreup' } },
    { slug: 'b', record: { name: 'B', booking_status: 'pending', platform: 'foreup' } },
  ];
  const photos = [{ slug: 'a', photo_storage_url: 'https://img/a.jpg' }];
  const fake = async (url, init) => {
    if (url.includes('course_registry_public')) return new Response('{"code":"PGRST205"}', { status: 404 });
    if (url.includes('course_catalog')) return fakeTable(photos)(url, init);
    return fakeTable(registry)(url, init);
  };
  return withFetch(fake, async () => {
    const rows = await fetchPublicRegistryRows(env);
    assert.deepEqual(rows.map((r) => r.slug), ['a']);
    assert.equal(rows[0].record.photo_storage_url, 'https://img/a.jpg');
  });
});

test('a view error other than missing is not hidden by the fallback', () =>
  withFetch(async () => new Response('down', { status: 503 }), async () => {
    await assert.rejects(fetchPublicRegistryRows(env), RegistryReadError);
  }));
