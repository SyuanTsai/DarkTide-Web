import assert from 'node:assert/strict';
import test from 'node:test';

import { isRawAttackPowerDistributionDefinition } from '../web/shared-render.mjs';

function attackPowerDefinition({
  quantity = 'damage_templates.default_light_axe.targets[1].power_distribution.attack',
  outputUnit = 'attack-power-point',
  locators = [
    { fieldPath: 'targets.default_target.power_distribution.attack.1', path: 'scripts/settings/damage_profiles/axe.lua', rawEndpoint: '20' },
    { fieldPath: 'targets.default_target.power_distribution.attack.2', path: 'scripts/settings/damage_profiles/axe.lua', rawEndpoint: '40' },
  ],
} = {}) {
  const gameReleaseId = 'darktide:1.13.4';
  const sourceRef = { sourceId: 'public-code:axe-profile-e46', gameReleaseId };
  const recordId = 'darktide:stat-curve:axe-default-light';
  const definition = {
    kind: 'stat-definition',
    gameReleaseId,
    payload: { quantity, curveRef: { recordId, gameReleaseId } },
  };
  const curve = {
    kind: 'stat-curve',
    recordId,
    gameReleaseId,
    payload: {
      inputUnit: 'ratio',
      outputUnit,
      knots: locators.map((locator, index) => ({
        input: String(index),
        output: locator.rawEndpoint,
        ...(locator.rawEndpoint === undefined ? {} : { rawEndpoint: locator.rawEndpoint }),
        sourceLocator: {
          sourceRef,
          path: locator.path,
          line: index + 1,
          fieldPath: locator.fieldPath,
        },
      })),
    },
  };
  const curveSourceRefs = [{ ...sourceRef, path: 'scripts/settings/damage_profiles/axe.lua' }];
  return { definition, curve, curveSourceRefs };
}

// Scenario: A stat definition points to a raw attack-power distribution curve whose every endpoint has a matching pinned source locator.
// Purpose: Keep the non-final-damage explanation available for future weapon profiles without a profile-name allowlist.
test('UnitT10_RawAttackPowerDistributionIsRecognizedFromVerifiedSourceLocators', () => {
  const { definition, curve, curveSourceRefs } = attackPowerDefinition({
    quantity: 'damage_templates.default_light_axe.targets[1].power_distribution.attack',
    locators: [
      { fieldPath: 'targets.default_target.power_distribution.attack.1', path: 'scripts/settings/damage_profiles/axe.lua', rawEndpoint: '20' },
      { fieldPath: 'targets.default_target.power_distribution.attack.2', path: 'scripts/settings/damage_profiles/axe.lua', rawEndpoint: '40' },
    ],
  });
  assert.equal(isRawAttackPowerDistributionDefinition(definition, curve, curveSourceRefs), true);
});

// Scenario: A different weapon profile uses attack-power points, while a nearby property or mismatched source path is supplied.
// Purpose: Recognize verified attack distribution fields generically and keep similar non-attack fields unlabelled.
test('UnitT20_OtherWeaponProfileAttackFieldsAreRecognizedButImpactFieldsAreNot', () => {
  const generic = attackPowerDefinition({
    quantity: 'base_templates.default_heavy_lasgun.targets.default_target.power_distribution.attack',
    locators: [
      { fieldPath: 'base_templates.default_heavy_lasgun.targets.default_target.power_distribution.attack.1', path: 'scripts/settings/damage_profiles/lasgun.lua', rawEndpoint: '11' },
      { fieldPath: 'base_templates.default_heavy_lasgun.targets.default_target.power_distribution.attack.2', path: 'scripts/settings/damage_profiles/lasgun.lua', rawEndpoint: '22' },
    ],
  });
  generic.curveSourceRefs = [{ ...generic.curveSourceRefs[0], path: 'scripts/settings/damage_profiles/lasgun.lua' }];
  assert.equal(isRawAttackPowerDistributionDefinition(generic.definition, generic.curve, generic.curveSourceRefs), true);

  const impact = attackPowerDefinition({
    quantity: 'damage_templates.default_light_axe.targets[1].power_distribution.impact',
    locators: [
      { fieldPath: 'targets.default_target.power_distribution.impact.1', path: 'scripts/settings/damage_profiles/axe.lua', rawEndpoint: '5' },
      { fieldPath: 'targets.default_target.power_distribution.impact.2', path: 'scripts/settings/damage_profiles/axe.lua', rawEndpoint: '10' },
    ],
  });
  assert.equal(isRawAttackPowerDistributionDefinition(impact.definition, impact.curve, impact.curveSourceRefs), false);
});

// Scenario: An attack-like quantity has an unlinked, mismatched, incomplete, or differently typed curve.
// Purpose: Fail closed unless all knots are raw attack-power source fields tied to the exact stat definition and release.
test('UnitT30_UnprovenOrMismatchedRawAttackCurvesRemainUnclassified', () => {
  const unlinkedSource = attackPowerDefinition();
  unlinkedSource.curveSourceRefs = [];
  assert.equal(isRawAttackPowerDistributionDefinition(unlinkedSource.definition, unlinkedSource.curve, unlinkedSource.curveSourceRefs), false);

  const missingEndpoint = attackPowerDefinition({
    locators: [
      { fieldPath: 'targets.default_target.power_distribution.attack.1', path: 'scripts/settings/damage_profiles/axe.lua', rawEndpoint: '20' },
      { fieldPath: 'targets.default_target.power_distribution.attack.2', path: 'scripts/settings/damage_profiles/axe.lua' },
    ],
  });
  assert.equal(isRawAttackPowerDistributionDefinition(missingEndpoint.definition, missingEndpoint.curve, missingEndpoint.curveSourceRefs), false);

  const wrongUnit = attackPowerDefinition({ outputUnit: 'damage' });
  assert.equal(isRawAttackPowerDistributionDefinition(wrongUnit.definition, wrongUnit.curve, wrongUnit.curveSourceRefs), false);

  const wrongCurve = attackPowerDefinition();
  wrongCurve.definition.payload.curveRef.recordId = 'darktide:stat-curve:other';
  assert.equal(isRawAttackPowerDistributionDefinition(wrongCurve.definition, wrongCurve.curve, wrongCurve.curveSourceRefs), false);
});