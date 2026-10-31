import assert from 'node:assert/strict';
import test from 'node:test';

import { countUnifiedWeaponMarks, currentWeaponMarkIdentities } from '../web/shared-render.mjs';

test('UnitT10_current_only_count | Scenario: current-only weapon families keep every current mark; Purpose: count without requiring a retained counterpart', () => {
  assert.equal(countUnifiedWeaponMarks(['lasgun_p1_m1', 'lasgun_p1_m2'], []), 2);
});

test('UnitT20_ready_view_only | Scenario: current family records include a mark without a displayable view; Purpose: count only marks rendered in the ready family', () => {
  const records = [
    { payload: { markId: 'lasgun_p1_m1', templateKey: 'lasgun_p1_m1' } },
    { payload: { markId: 'lasgun_p1_m2', templateKey: 'lasgun_p1_m2' } },
    { payload: { markId: 'lasgun_p1_m3', templateKey: 'lasgun_p1_m3' } },
  ];
  const visibleIdentities = currentWeaponMarkIdentities(records, [{ markId: 'lasgun_p1_m1' }, { markId: 'lasgun_p1_m2' }]);
  assert.deepEqual(visibleIdentities, ['lasgun_p1_m1', 'lasgun_p1_m2']);
  assert.equal(countUnifiedWeaponMarks(visibleIdentities, []), 2);
});

test('UnitT30_mark_id_fallback | Scenario: a rendered current mark has no usable template mapping; Purpose: fall back to its current mark ID', () => {
  const records = [{ payload: { markId: 'lasgun_p1_m1', templateKey: '' } }];
  assert.deepEqual(currentWeaponMarkIdentities(records, [{ markId: 'lasgun_p1_m1' }]), ['lasgun_p1_m1']);
});

test('UnitT40_retained_only_count | Scenario: retained-only weapon families count retained mark identities once; Purpose: ignore duplicate rows', () => {
  assert.equal(countUnifiedWeaponMarks([], [
    { id: 'transonic_knife_p1_m1' },
    { id: 'transonic_knife_p1_m2' },
    { id: 'transonic_knife_p1_m2' },
  ]), 2);
});

test('UnitT50_exact_overlap_count | Scenario: current and retained weapon marks overlap by exact stable ID; Purpose: merge exact identities and keep distinct retained marks', () => {
  assert.equal(countUnifiedWeaponMarks(['lasgun_p1_m1'], [
    { id: 'lasgun_p1_m1' },
    { id: 'lasgun_p1_m2' },
    { id: 'lasgun_p1_m3' },
  ]), 3);
});

test('UnitT60_different_ids_stay_distinct | Scenario: similar names do not merge different IDs; Purpose: avoid collapsing unrelated weapon marks', () => {
  assert.equal(countUnifiedWeaponMarks(['lasgun_p1_m1'], [
    { id: 'lasgun_p1_m1_variant' },
  ]), 2);
});
