import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bookingHolesForSlots,
  buildAlertHeadline,
  buildAlertPushMessage,
  buildAlertSmsBody,
  buildAlertSubject,
  describeAlertPreference,
  formatTime12h,
  windowLabelFromRange,
} from './alertCopy.js';

const course = { name: 'The Ridge (West Valley)' };

test('formatTime12h matches brand house style', () => {
  assert.equal(formatTime12h('14:40'), '2:40 PM');
  assert.equal(formatTime12h('06:50'), '6:50 AM');
});

test('windowLabelFromRange maps UI presets', () => {
  assert.equal(windowLabelFromRange('05:00:00', '11:59:00'), 'Morning');
  assert.equal(windowLabelFromRange('12:00:00', '16:59:00'), 'Afternoon');
  assert.equal(windowLabelFromRange('00:00:00', '23:59:00'), 'All day');
});

test('describeAlertPreference one-time includes date window players', () => {
  const d = describeAlertPreference(
    {
      target_date: '2026-08-28',
      earliest_time: '05:00:00',
      latest_time: '11:59:00',
      players: 2,
    },
    '2026-08-28',
  );
  assert.equal(d.kind, 'one-time');
  assert.equal(d.title, 'Your one-time Alert');
  assert.match(d.scheduleLine, /Aug/);
  assert.equal(d.filtersLine, 'Morning · 2 players');
  assert.match(d.summaryLine, /One-time/);
  assert.match(d.summaryLine, /Morning · 2 players/);
});

test('describeAlertPreference weekly includes DOW and match date', () => {
  const d = describeAlertPreference(
    {
      target_date: null,
      days_of_week: [5],
      earliest_time: '12:00:00',
      latest_time: '16:59:00',
      players: 2,
    },
    '2026-08-28',
  );
  assert.equal(d.kind, 'weekly');
  assert.equal(d.title, 'Your weekly Alert');
  assert.equal(d.scheduleLine, 'Fridays');
  assert.equal(d.filtersLine, 'Afternoon · 2 players');
  assert.match(d.matchLine, /Matched/);
});

test('subject includes holes so 9 vs 18 is clear', () => {
  const subject = buildAlertSubject(
    course,
    [{ rawTime: '14:40', holes: 18, price: '$55' }],
    'reopened',
  );
  assert.equal(subject, '2:40 PM · 18 holes reopened at The Ridge');
});

test('headline for mixed multi is clear', () => {
  assert.equal(
    buildAlertHeadline(
      [
        { rawTime: '14:40', holes: 18 },
        { rawTime: '14:40', holes: 9 },
      ],
      'reopened',
    ),
    '2 times match your Alert',
  );
});

test('bookingHolesForSlots prefers single-slot holes', () => {
  assert.equal(bookingHolesForSlots([{ holes: 9 }]), '9');
  assert.equal(bookingHolesForSlots([{ holes: 18 }, { holes: 9 }]), '18');
});

test('SMS leads with Alert context', () => {
  const summary = describeAlertPreference(
    {
      target_date: '2026-08-28',
      earliest_time: '05:00:00',
      latest_time: '11:59:00',
      players: 2,
    },
    '2026-08-28',
  );
  const sms = buildAlertSmsBody(
    course,
    [{ rawTime: '14:40', holes: 18, price: '$55' }],
    '2026-08-28',
    2,
    'reopened',
    'https://example.com/book',
    summary,
  );
  assert.match(sms, /One-time/);
  assert.match(sms, /Morning · 2 players/);
  assert.match(sms, /2:40 PM · 18 holes reopened at The Ridge/);
});

test('push body marks one-time vs weekly', () => {
  const weekly = describeAlertPreference(
    {
      target_date: null,
      days_of_week: [5],
      earliest_time: '12:00:00',
      latest_time: '16:59:00',
      players: 2,
    },
    '2026-08-28',
  );
  const push = buildAlertPushMessage(
    course,
    [{ rawTime: '14:40', holes: 9, price: '$28' }],
    '2026-08-28',
    2,
    'opened',
    weekly,
  );
  assert.equal(push.title, '2:40 PM · 9 holes opened');
  assert.match(push.body, /Weekly/);
});
