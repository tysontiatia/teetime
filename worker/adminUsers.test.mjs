import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAdminUsers } from './courseAdmin.js';

test('mapAdminUsers joins auth users with profiles and sorts newest first', () => {
  const users = mapAdminUsers(
    [
      {
        id: 'a',
        email: 'old@example.com',
        created_at: '2026-01-01T00:00:00Z',
        last_sign_in_at: '2026-02-01T00:00:00Z',
        user_metadata: { full_name: 'Auth Name' },
        app_metadata: { provider: 'google' },
      },
      {
        id: 'b',
        email: 'new@example.com',
        created_at: '2026-08-01T00:00:00Z',
        user_metadata: {},
        app_metadata: { provider: 'email' },
      },
    ],
    [
      { id: 'a', display_name: 'Ada', is_admin: true, phone: '555-0100', notify_via: 'sms' },
      { id: 'c', display_name: 'Orphan', created_at: '2026-03-01T00:00:00Z', is_admin: false },
    ],
  );

  assert.equal(users.length, 3);
  assert.equal(users[0].id, 'b');
  assert.equal(users[0].display_name, null);
  assert.equal(users[0].provider, 'email');
  assert.equal(users[1].id, 'c');
  assert.equal(users[1].email, null);
  assert.equal(users[2].display_name, 'Ada');
  assert.equal(users[2].is_admin, true);
  assert.equal(users[2].phone, '555-0100');
  assert.equal(users[2].provider, 'google');
});

test('mapAdminUsers falls back to Google metadata when profile has no name', () => {
  const [user] = mapAdminUsers(
    [{ id: 'x', email: 'x@example.com', user_metadata: { full_name: 'From Google' } }],
    [{ id: 'x', display_name: null }],
  );
  assert.equal(user.display_name, 'From Google');
});
