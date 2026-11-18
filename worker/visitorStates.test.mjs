import test from 'node:test';
import assert from 'node:assert/strict';
import { coveredStateCodes, rankUncoveredStates, stateCodeFromRecord } from './visitorStates.js';

test('state comes from the record, the address, or the area name', () => {
  assert.equal(stateCodeFromRecord({ state: 'tx' }), 'TX');
  assert.equal(stateCodeFromRecord({ address: '1 Main St, Austin, TX 78701' }), 'TX');
  assert.equal(stateCodeFromRecord({ area: 'Oregon · Central' }), 'OR');
  assert.equal(stateCodeFromRecord({ area: 'Salt Lake' }), null);
});

test('covered states are the ones already published', () => {
  const covered = coveredStateCodes([
    { record: { booking_status: 'ready', state: 'UT' } },
    { record: { booking_status: 'phone', area: 'Oregon · Coast' } },
    { record: { booking_status: 'pending', state: 'AK' } },
    { record: { booking_status: 'private', state: 'CA' } },
  ]);
  assert.deepEqual([...covered].sort(), ['OR', 'UT']);
});

test('uncovered states are ranked by visitors, then by people who asked', () => {
  const covered = new Set(['UT', 'CA']);
  const ranked = rankUncoveredStates({
    visitors: [
      { code: 'UT', visitors: 40 },
      { code: 'TX', visitors: 12 },
      { code: 'MT', visitors: 4 },
      { code: 'nope', visitors: 9 },
    ],
    asked: [
      { code: 'MT', asked: 3 },
      { code: 'IA', asked: 1 },
      { code: 'UT', asked: 8 },
    ],
    covered,
  });
  assert.deepEqual(ranked, [
    { code: 'TX', visitors: 12, asked: 0 },
    { code: 'MT', visitors: 4, asked: 3 },
    { code: 'IA', visitors: 0, asked: 1 },
  ]);
});
