import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBlessingTiers } from '../scripts/source-browser-smoke.mjs';

// Scenario: A valid blessing has only tier 4; Purpose: smoke accepts its actual levels.
test('UnitT10_partial_blessing_tiers_are_accepted', () => {
  assert.doesNotThrow(() => assertBlessingTiers('LV4', [{ tier: 4 }]));
  assert.throws(() => assertBlessingTiers('LV1', [{ tier: 4 }]));
  assert.throws(() => assertBlessingTiers('LV4', [{ tier: 4 }], true));
});
