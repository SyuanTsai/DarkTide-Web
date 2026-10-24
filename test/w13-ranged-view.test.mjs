import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedViewModel } from '../web/shared-view.mjs';

function makeRangedWeaponDomains() {
  const gameReleaseId = 'fixture:w13-ranged-view';
  const weaponRef = { gameReleaseId, kind: 'weapon', recordId: 'fixture:weapon:lasgun-p1-m1' };
  const hipRef = { gameReleaseId, kind: 'attack-profile', recordId: 'fixture:attack:hipfire' };
  const adsRef = { gameReleaseId, kind: 'attack-profile', recordId: 'fixture:attack:ads' };
  const definitionRef = { gameReleaseId, kind: 'stat-definition', recordId: 'fixture:stat:ammunition-clips' };
  const curveRef = { gameReleaseId, kind: 'stat-curve', recordId: 'fixture:curve:ammunition-clips' };
  const officialSourceId = 'fixture:official:weapon-name';
  const sourceRows = [
    { rawValue: '3', sourceLocator: { fieldPath: 'weapon_template.actions.action_shoot_hip.ammunition_usage' } },
    { rawValue: 'true', sourceLocator: { fieldPath: 'weapon_template.actions.action_shoot_hip.allow_shots_with_less_than_required_ammo' } },
  ];
  const weapon = {
    ...weaponRef,
    reviewState: 'pending',
    payload: {
      familyId: 'lasgun_p1', markId: 'lasgun_p1_m1', templateKey: 'lasgun_p1_m1',
      statRefs: [{ recordId: definitionRef.recordId, gameReleaseId }],
      attackProfileRefs: [hipRef, adsRef], sourceRows,
      statTables: [{ statKey: 'ammunition_clips', tableKey: 'weapon_ammo_templates.fixture.ammunition_clips',
        properties: [{ property: 'ammunition_clips', unit: 'instance-count', orderedValues: [
          { key: 'lerp_basic', rawValue: '80', decimal: '80' },
          { key: 'lerp_perfect', rawValue: '120', decimal: '120' },
        ] }] }],
    },
  };
  const definition = {
    ...definitionRef,
    payload: {
      quantity: 'ammunition_clips', curveRef: { recordId: curveRef.recordId, gameReleaseId },
      theoreticalInputRange: { status: 'known', min: '0', max: '1', unit: 'ratio' },
      obtainableInputRange: { status: 'unknown', reasonCode: 'NOT_EXPOSED_BY_SOURCE' },
    },
  };
  const curve = { ...curveRef, payload: { knots: [
    { input: '0', output: '80', sourceOrdinal: 1 }, { input: '1', output: '120', sourceOrdinal: 2 },
  ], inputUnit: 'ratio', outputUnit: 'instance-count' } };
  const profiles = [
    { ...hipRef, payload: { weaponRef, templateKey: 'lasgun_p1_m1', action: 'action_shoot_hip', mode: 'hipfire' } },
    { ...adsRef, payload: { weaponRef, templateKey: 'lasgun_p1_m1', action: 'action_shoot_zoomed', mode: 'ads' } },
  ];
  const name = { officialSourceId, entityRef: weaponRef, sourceLocale: 'zh-TW', sourceText: '測試步兵鐳射槍', resolvedText: '測試步兵鐳射槍' };
  const presentation = {
    entityRef: weaponRef, locale: 'zh-TW', name: '測試步兵鐳射槍', nameOfficialSourceId: officialSourceId,
    official: { officialSourceId }, nameOfficialLocaleRefs: [{ officialSourceId, sourceLocale: 'zh-TW' }],
    weaponView: { sourceWeaponRef: weaponRef, markLabel: '測試型號', statSections: [], attackProfileRefs: [hipRef, adsRef] },
    detailSections: [],
  };
  const weapons = {
    kind: 'weapons', gameReleaseId,
    source: { records: [weapon, definition, curve, ...profiles] },
    web: { presentations: [presentation], officialInputs: { sources: [name] }, termLocalizations: [] },
  };
  return { gameReleaseId, domains: [weapons], refs: { weaponRef, sourceRows } };
}

// Scenario: A ranged weapon stores its ammo definitions in statRefs/statTables while its statBindings list is empty.
// Purpose: Project typed theoretical and obtainable ranges alongside the existing raw source rows without inventing weapon stat sections.
test('UnitT20_w13-ranged-view-resolves-ammo-definition-curves-and-preserves-source-rows', () => {
  const { gameReleaseId, domains, refs } = makeRangedWeaponDomains();
  const view = createSharedViewModel({ domains, gameReleaseId });
  const weapon = view.getWeapon({ familyId: 'lasgun_p1', markId: 'lasgun_p1_m1' });

  assert.equal(weapon.status, 'ready');
  assert.deepEqual(weapon.source.sourceRows, refs.sourceRows);
  assert.equal(weapon.source.statDefinitions.length, 1);
  assert.equal(weapon.source.statDefinitions[0].definition.payload.quantity, 'ammunition_clips');
  assert.deepEqual(weapon.source.statDefinitions[0].curve.payload.knots.map(row => [row.input, row.output]), [['0', '80'], ['1', '120']]);
  assert.equal(weapon.source.statDefinitions[0].definition.payload.obtainableInputRange.status, 'unknown');
  assert.deepEqual(weapon.attackProfiles.map(row => row.payload.mode), ['hipfire', 'ads']);
});

// Scenario: A Source stat reference is missing or resolves to a record of another type.
// Purpose: Keep the new ranged-only statRefs projection fail-closed instead of returning a partially rendered weapon.
test('UnitT21_w13-ranged-view-rejects-missing-or-wrong-kind-stat-references', () => {
  for (const mutation of ['missing-statrefs', 'empty-statrefs', 'missing-stat-definition', 'missing-curve-ref', 'wrong-kind-curve']) {
    const { gameReleaseId, domains, refs } = makeRangedWeaponDomains();
    const records = domains[0].source.records;
    const weapon = records.find(record => record.kind === 'weapon' && record.recordId === refs.weaponRef.recordId);
    if (mutation === 'missing-statrefs') {
      delete weapon.payload.statRefs;
    } else if (mutation === 'empty-statrefs') {
      weapon.payload.statRefs = [];
    } else if (mutation === 'missing-stat-definition') {
      weapon.payload.statRefs[0].recordId = 'fixture:stat:missing';
    } else {
      const definition = records.find(record => record.kind === 'stat-definition');
      if (mutation === 'missing-curve-ref') delete definition.payload.curveRef;
      else definition.payload.curveRef = { recordId: refs.weaponRef.recordId, gameReleaseId };
    }
    const view = createSharedViewModel({ domains, gameReleaseId });
    const result = view.getWeapon({ familyId: 'lasgun_p1', markId: 'lasgun_p1_m1' });
    assert.notEqual(result.status, 'ready', mutation);
  }
});
