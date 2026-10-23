import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedViewModel } from '../web/shared-view.mjs';
import { makeCompiledGameChangesPackage } from './w12-shared-view.fixture.mjs';

const CHANGE_ID = 'fixture:game-change:curve';

// Scenario: A W08 game-change index has cross-release comparisons but no typed predecessor dependency.
// Purpose: Preserve the validated comparison releases and their snapshots in the optional domain closure.
// Given compiler output with a game-change row or official-text row, When their comparison points to an older release, Then both releases remain available in the emitted index registry.
test('UnitT05_compiler_includes_comparison_release_registry', async () => {
  const sourcePackage = await makeCompiledGameChangesPackage({ removeWeaponPredecessor: true });
  const sourceIndex = sourcePackage.domains.find(domain => domain.kind === 'game-changes');
  assert.deepEqual(sourceIndex.source.gameReleases.map(row => row.gameReleaseId), ['fixture-r1', 'fixture-r2']);
  assert.deepEqual(sourceIndex.source.gameReleases.map(row => row.snapshot.snapshotId), ['fixture-snapshot-r1', 'fixture-snapshot-r2']);

  const officialPackage = await makeCompiledGameChangesPackage({ omitSourceChange: true, removeWeaponPredecessor: true });
  const officialIndex = officialPackage.domains.find(domain => domain.kind === 'game-changes');
  assert.deepEqual(officialIndex.source.gameReleases.map(row => row.gameReleaseId), ['fixture-r1', 'fixture-r2']);
  assert.deepEqual(officialIndex.source.gameReleases.map(row => row.snapshot.snapshotId), ['fixture-snapshot-r1', 'fixture-snapshot-r2']);
});

// Scenario: The optional game-changes domain and core weapon domain repeat one identical official source input.
// Purpose: Keep full-package consumers stable while rejecting conflicting duplicate source identities.
// Given the compiler's complete domain package, When official inputs are aggregated, Then identical rows remain usable and a conflicting source ID fails closed only for dependent official-text output.
test('UnitT06_deduplicates_identical_official_inputs_and_rejects_conflicts', async () => {
  const sourcePackage = await makeCompiledGameChangesPackage();
  const index = sourcePackage.domains.find(row => row.kind === 'game-changes');
  const weapons = sourcePackage.domains.find(row => row.kind === 'weapons');
  const sharedId = index.web.officialTextChanges[0].toOfficialSourceId;
  const indexSource = index.web.officialInputs.sources.find(row => row.officialSourceId === sharedId);
  const weaponSource = weapons.web.officialInputs.sources.find(row => row.officialSourceId === sharedId);
  assert.ok(indexSource && weaponSource);
  assert.deepEqual(indexSource, weaponSource);

  const sameInputsView = createSharedViewModel({ domains: sourcePackage.domains, gameReleaseId: index.gameReleaseId });
  assert.ok(sameInputsView.getGameChanges({ gameVersion: '1.0.1' }).items.some(row => row.changeKind === 'official-text'));

  weaponSource.sourceText += ' Conflicting duplicate.';
  const conflictingInputsView = createSharedViewModel({ domains: sourcePackage.domains, gameReleaseId: index.gameReleaseId });
  const items = conflictingInputsView.getGameChanges({ gameVersion: '1.0.1' }).items;
  assert.ok(items.some(row => row.changeKind === 'source-technical'));
  assert.equal(items.some(row => row.changeKind === 'official-text'), false);
});

// Scenario: W08 compiles a Source-owned technical change and an official-text change from the validated authoring donor.
// Purpose: Consume the actual W08 Source entityRef, typed-value, comparison, evidence-ref and Web row shapes.
// Given a compiler-emitted game-changes domain, When filtered by target version and resolved entity kind, Then both correctly joined rows are projected without inventing Source fields.
test('UnitT10_projects_compiler_emitted_changes_with_version_and_kind_filters', async () => {
  const sourcePackage = await makeCompiledGameChangesPackage();
  const domain = sourcePackage.domains.find(row => row.kind === 'game-changes');
  const sourceRecord = domain.source.records.find(record => record.kind === 'game-change');
  assert.ok(sourceRecord);
  assert.equal(sourceRecord.payload.entityKind, undefined);
  assert.equal(sourceRecord.payload.recordId, undefined);
  assert.deepEqual(Object.keys(sourceRecord.payload.comparison).sort(), [
    'fromGameBuild', 'fromGameReleaseId', 'fromGameVersion', 'fromSnapshotId',
    'toGameBuild', 'toGameReleaseId', 'toGameVersion', 'toSnapshotId',
  ]);
  assert.equal(typeof sourceRecord.reviewState, 'string');
  assert.equal(sourceRecord.payload.reviewState, undefined);
  assert.deepEqual(sourceRecord.payload.changedFields[0].before, { status: 'known', decimal: '0', unit: 'damage' });
  assert.deepEqual(sourceRecord.payload.changedFields[0].after, { status: 'known', decimal: '1.25', unit: 'damage' });
  assert.equal(typeof sourceRecord.payload.evidenceRefs[0], 'object');
  assert.equal(domain.web.gameChanges[0].changeId, sourceRecord.recordId);
  assert.equal(domain.web.officialTextChanges[0].owner, 'web');
  assert.equal(domain.web.officialTextChanges[0].changeKind, 'official-text');

  assert.equal(sourcePackage.publicationEligible, false);
  const view = createSharedViewModel({ domains: sourcePackage.domains, gameReleaseId: domain.gameReleaseId });
  const result = view.getGameChanges({ gameVersion: '1.0.1', entityKind: 'weapon' });

  assert.equal(result.status, 'ready');
  assert.equal(result.items.length, 2);
  const sourceChange = result.items.find(item => item.changeId === CHANGE_ID);
  assert.equal(sourceChange.owner, 'source');
  assert.equal(sourceChange.summary, '合成技術變動摘要。');
  assert.equal(sourceChange.entityKind, 'weapon');
  assert.deepEqual(sourceChange.changedFields, [{
    field: 'synthetic-damage',
    before: { status: 'known', decimal: '0', unit: 'damage' },
    after: { status: 'known', decimal: '1.25', unit: 'damage' },
    unit: 'damage',
    summary: '合成欄位摘要。',
  }]);
  assert.deepEqual(sourceChange.comparison, {
    ...sourceRecord.payload.comparison,
    fromSnapshotCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    toSnapshotCommit: 'cccccccccccccccccccccccccccccccccccccccc',
  });
  assert.equal(sourceChange.evidence[0].source.snapshot.snapshotId, 'fixture-snapshot-r2');

  const officialTextChange = result.items.find(item => item.changeId === 'fixture:official-text-change:weapon');
  assert.equal(officialTextChange.owner, 'web');
  assert.equal(officialTextChange.officialText.before.sourceLocale, 'en');
  assert.equal(officialTextChange.officialText.after.sourceLocale, 'en');
  assert.deepEqual(view.getGameChanges({ gameVersion: '1.0.1', entityKind: 'skill' }).items, []);
});

// Scenario: A Source game change targets a fact record rather than a page-level weapon record.
// Purpose: Resolve an exact existing relation to its approved localized subject without inventing a fallback label.
// Given compiler output targets a stat definition, stat curve, or unpresented blessing variant, When projected, Then unique weapon parents are named in zh-TW and an unresolvable target is omitted.
test('UnitT15_resolves_fact_targets_only_through_unique_approved_subjects', async () => {
  for (const targetKind of ['stat-definition', 'stat-curve']) {
    const sourcePackage = await makeCompiledGameChangesPackage({ changeTargetKind: targetKind });
    const index = sourcePackage.domains.find(row => row.kind === 'game-changes');
    const view = createSharedViewModel({ domains: sourcePackage.domains, gameReleaseId: index.gameReleaseId });
    const sourceChange = view.getGameChanges({ gameVersion: '1.0.1' }).items.find(row => row.owner === 'source');
    assert.ok(sourceChange, targetKind);
    assert.equal(sourceChange.entityKind, targetKind);
    assert.equal(sourceChange.entityName, '合成武器範例');
    assert.deepEqual(sourceChange.displayEntityRef, {
      gameReleaseId: 'fixture-r2', kind: 'weapon', recordId: 'fixture:weapon:alpha',
    });
    assert.equal(view.getGameChanges({ gameVersion: '1.0.1', entityKind: 'weapon' }).items
      .some(row => row.entityKind === targetKind), true, targetKind + ' belongs in the weapon filter');
  }

  const ambiguousPackage = await makeCompiledGameChangesPackage({ changeTargetKind: 'stat-definition' });
  const ambiguousIndex = ambiguousPackage.domains.find(row => row.kind === 'game-changes');
  const localizedWeapon = ambiguousIndex.source.records.find(record => record.kind === 'weapon'
    && record.gameReleaseId === 'fixture-r2');
  const extraParent = structuredClone(localizedWeapon);
  extraParent.recordId = 'fixture:weapon:unlocalized-parent';
  extraParent.payload.familyId = 'fixture-unlocalized-family';
  ambiguousIndex.source.records.push(extraParent);
  const ambiguousView = createSharedViewModel({ domains: ambiguousPackage.domains, gameReleaseId: ambiguousIndex.gameReleaseId });
  assert.equal(ambiguousView.getGameChanges({ gameVersion: '1.0.1' }).items.some(row => row.owner === 'source'), false,
    'a second legal parent without a presentation must not be ignored');

  const variantPackage = await makeCompiledGameChangesPackage({ changeTargetKind: 'blessing-variant' });
  const variantIndex = variantPackage.domains.find(row => row.kind === 'game-changes');
  const variantView = createSharedViewModel({ domains: variantPackage.domains, gameReleaseId: variantIndex.gameReleaseId });
  const variantChange = variantView.getGameChanges({ gameVersion: '1.0.1', entityKind: 'blessing' }).items
    .find(row => row.owner === 'source');
  assert.equal(variantChange.entityKind, 'blessing-variant');
  assert.equal(variantChange.displayEntityRef.kind, 'blessing');
  assert.equal(variantChange.entityName, '合成祝福範例');
});

// Scenario: Approved game changes have public-safe evidence and may supersede an earlier record.
// Purpose: Keep correction links traceable and distinguish evidence source/build identity from verification method.
// Given a compiler-emitted package with public evidence, When the shared view projects both owners, Then it exposes safe HTTPS evidence, exact comparison identity, and stable predecessor IDs without raw source registries.
test('UnitT45_projects_safe_evidence_and_correction_links', async () => {
  const sourcePackage = await makeCompiledGameChangesPackage();
  const domain = sourcePackage.domains.find(row => row.kind === 'game-changes');
  const sourceRecord = domain.source.records.find(record => record.kind === 'game-change');
  sourceRecord.payload.supersedesChangeRef = {
    gameReleaseId: 'fixture-r2', kind: 'game-change', recordId: 'fixture:game-change:prior',
  };
  const sourceRow = domain.web.gameChanges.find(row => row.changeId === sourceRecord.recordId);
  sourceRow.supersedesChangeId = 'fixture:game-change:prior';
  const officialRow = domain.web.officialTextChanges.find(row => row.owner === 'web');
  officialRow.supersedesChangeId = CHANGE_ID;
  const view = createSharedViewModel({ domains: sourcePackage.domains, gameReleaseId: domain.gameReleaseId });
  const sourceChange = view.getGameChanges({ gameVersion: '1.0.1' }).items.find(row => row.owner === 'source');
  const officialChange = view.getGameChanges({ gameVersion: '1.0.1' }).items.find(row => row.owner === 'web');

  assert.equal(sourceChange.evidence.length, 1);
  assert.equal(sourceChange.evidence[0].kindLabel, '程式碼證據');
  assert.equal(sourceChange.evidence[0].source.publicUrl,
    'https://example.invalid/synthetic/game-code/blob/cccccccccccccccccccccccccccccccccccccccc/fixture.lua');
  assert.equal(sourceChange.evidence[0].source.gameReleaseId, 'fixture-r2');
  assert.deepEqual(sourceChange.evidence[0].source.snapshot, {
    snapshotId: 'fixture-snapshot-r2', commit: 'cccccccccccccccccccccccccccccccccccccccc',
  });
  assert.equal(sourceChange.verificationLabel, '程式觀察');
  assert.equal(sourceChange.supersedesChangeId, 'fixture:game-change:prior');
  assert.equal(officialChange.supersedesChangeId, CHANGE_ID);
  assert.equal(officialChange.officialText.before.text, officialChange.officialText.after.text,
    'the compiler fixture uses the same official source template on both sides');
  assert.equal(officialChange.officialText.before.resolvedText, 'Synthetic official weapon value: 40.');
  assert.equal(officialChange.officialText.after.resolvedText, 'Synthetic official weapon value: 41.');
  assert.deepEqual(officialChange.officialText.before.params, [{
    parameterId: 'value', sourceKey: 'synthetic_damage_value', value: '40',
  }]);
  assert.deepEqual(officialChange.officialText.after.params, [{
    parameterId: 'value', sourceKey: 'synthetic_damage_value', value: '41',
  }]);
  assert.deepEqual(officialChange.officialText.before.sourceIdentity, {
    origin: 'game-localization',
    resource: 'synthetic_localization',
    key: 'fixture_weapon_alpha',
    occurrence: 0,
    sourceTextSha256: 'f288fa0d3cabc1b8328a745e5d1af49c4fdbd0660e99ba48660a83cd0cd5c1e2',
    resolvedTextSha256: 'f6207f0d674206324a567e8c6b2e50deabbe3e031d19ac3fa2ef006016553644',
  });
  assert.equal(officialChange.officialText.after.sourceIdentity.key, 'fixture_weapon_alpha');
  assert.equal(officialChange.officialText.after.sourceIdentity.sourceTextSha256,
    'f288fa0d3cabc1b8328a745e5d1af49c4fdbd0660e99ba48660a83cd0cd5c1e2');
  assert.deepEqual(officialChange.correctionChain.map(row => row.changeId), [CHANGE_ID]);

  const conflictingPackage = await makeCompiledGameChangesPackage();
  const conflictingDomain = conflictingPackage.domains.find(row => row.kind === 'game-changes');
  const conflictingRecord = conflictingDomain.source.records.find(record => record.kind === 'game-change');
  conflictingRecord.payload.supersedesChangeRef = {
    gameReleaseId: 'fixture-r2', kind: 'game-change', recordId: 'fixture:game-change:source-target',
  };
  conflictingDomain.web.gameChanges[0].supersedesChangeId = 'fixture:game-change:web-target';
  const conflictingView = createSharedViewModel({ domains: conflictingPackage.domains, gameReleaseId: conflictingDomain.gameReleaseId });
  assert.equal(conflictingView.getGameChanges({ gameVersion: '1.0.1' }).items.some(row => row.owner === 'source'), false,
    'conflicting Source and Web correction targets fail closed');
});

// Scenario: A W08-compiled Source game change compares a typed range with inclusive bounds and a step.
// Purpose: Present every valid knownRange component and every Source schema unit with a clear Traditional Chinese label.
// Given actual compiler output containing a knownRange typedValue, When its detail value is formatted, Then bounds, inclusivity, step, and unit remain visible without invented condition fields.
test('UnitT50_formats_compiler_emitted_known_ranges_and_schema_units', async () => {
  const { formatGameChangeValue } = await import('../web/shared-render.mjs');
  assert.equal(typeof formatGameChangeValue, 'function');
  const sourcePackage = await makeCompiledGameChangesPackage({ knownRangeChange: true });
  const domain = sourcePackage.domains.find(row => row.kind === 'game-changes');
  const sourceRecord = domain.source.records.find(record => record.kind === 'game-change');
  assert.deepEqual(sourceRecord.payload.changedFields[0].after, {
    status: 'known', min: '0.25', max: '0.75', unit: 'ratio',
    inclusive: { min: true, max: false }, step: '0.05',
  });
  const view = createSharedViewModel({ domains: sourcePackage.domains, gameReleaseId: domain.gameReleaseId });
  const change = view.getGameChanges({ gameVersion: '1.0.1' }).items.find(row => row.owner === 'source');
  assert.equal(change.changedFields[0].after.status, 'known');
  assert.equal(formatGameChangeValue(change.changedFields[0].after), '0.25–0.75 比例（含下限、不含上限；步進 0.05）');

  const unitLabels = {
    ratio: '比例', percent: '%', s: '秒', m: '公尺', damage: '傷害', impact: '衝擊', point: '點',
    rating: '評級', 'attack-power-point': '攻擊威力點', 'stamina-point': '耐力點',
    'stamina-point-per-second': '耐力點／秒', 'dodge-count': '次閃避', 'instance-count': '次',
    'normalized-speed-per-second': '標準化速度／秒', 'item-stat-rating': '物品素質評級',
    'expertise-level': '專精等級', 'expertise-level-per-rank': '每階專精等級',
  };
  for (const [unit, label] of Object.entries(unitLabels)) {
    const rendered = formatGameChangeValue({ status: 'known', decimal: '1.5', unit });
    assert.equal(rendered, label === '%' ? '1.5%' : `1.5 ${label}`, unit);
  }
});

// Scenario: An approved blessing-variant game change points to a Source record with defined tiers and an unknown obtainable set.
// Purpose: Preserve the exact Source tier and applicability relationship without presenting unknown availability as confirmed.
// Given a compiler-emitted blessing-variant change and its approved review receipts, When projected for the blessing category, Then its localized subject, defined tiers, weapon refs, and unknown obtainable status remain distinct.
test('UnitT55_projects_approved_blessing_variant_tiers_and_unknown_applicability', async () => {
  const sourcePackage = await makeCompiledGameChangesPackage({ changeTargetKind: 'blessing-variant' });
  assert.equal(sourcePackage.publicationEligible, false);
  const domain = sourcePackage.domains.find(row => row.kind === 'game-changes');
  const targetRef = domain.source.records.find(record => record.kind === 'game-change').payload.entityRef;
  const variant = domain.source.records.find(record => record.kind === 'blessing-variant'
    && record.gameReleaseId === targetRef.gameReleaseId && record.recordId === targetRef.recordId);
  assert.equal(variant.reviewState, 'approved');
  const view = createSharedViewModel({ domains: sourcePackage.domains, gameReleaseId: domain.gameReleaseId });
  const change = view.getGameChanges({ gameVersion: '1.0.1', entityKind: 'blessing' }).items
    .find(row => row.owner === 'source');

  assert.equal(change.summary, '合成技術變動摘要。');
  assert.equal(change.entityName, '合成祝福範例');
  assert.deepEqual(change.blessingVariant.definedTiers, [1, 2, 3, 4]);
  assert.deepEqual(change.blessingVariant.obtainableTiers, { status: 'unknown' });
  assert.equal(change.blessingVariant.weaponApplicability.status, 'identified');
  assert.equal(change.blessingVariant.weaponApplicability.weapons[0].name, '合成武器範例');
  assert.equal(change.blessingVariant.weaponApplicability.weapons[0].weaponRef.recordId, 'fixture:weapon:alpha');
});

// Scenario: The compiler-emitted Source row loses its zh-TW summary while the separate Web official-text row remains valid.
// Purpose: Avoid English fallback or exposing an incomplete Source technical item.
// Given a same-shape domain with a non-zh-TW Source summary, When the change list is built, Then only the valid Web-owned row remains.
test('UnitT20_omits_source_changes_without_required_zh_tw_summary', async () => {
  const sourcePackage = await makeCompiledGameChangesPackage();
  const domain = sourcePackage.domains.find(row => row.kind === 'game-changes');
  domain.web.gameChanges[0].summary.locale = 'en';
  const view = createSharedViewModel({ domains: sourcePackage.domains, gameReleaseId: domain.gameReleaseId });
  const result = view.getGameChanges({ gameVersion: '1.0.1' });

  assert.equal(result.status, 'ready');
  assert.equal(result.items.some(item => item.changeId === CHANGE_ID), false);
  assert.equal(result.items.some(item => item.changeKind === 'official-text'), true);
});

// Scenario: Compiler output carries pending Source/Web review states or an unknown game build.
// Purpose: Keep unreviewed candidates and unverified comparisons out of the confirmed public change list.
// Given the actual compiler domain, When confirmed changes are projected, Then pending, stale, rejected, or unverified rows are omitted.
test('UnitT30_omits_unreviewed_or_unverified_changes', async () => {
  const sourcePackage = await makeCompiledGameChangesPackage();
  const domain = sourcePackage.domains.find(row => row.kind === 'game-changes');
  const sourceChange = domain.source.records.find(record => record.kind === 'game-change');
  sourceChange.reviewState = 'pending';
  for (const target of domain.web.reviewTargets) target.state = 'pending';
  let view = createSharedViewModel({ domains: sourcePackage.domains, gameReleaseId: domain.gameReleaseId });

  assert.deepEqual(view.getGameChanges({ gameVersion: '1.0.1' }).items, []);

  sourceChange.reviewState = 'approved';
  for (const target of domain.web.reviewTargets) target.state = 'stale';
  view = createSharedViewModel({ domains: sourcePackage.domains, gameReleaseId: domain.gameReleaseId });
  assert.deepEqual(view.getGameChanges({ gameVersion: '1.0.1' }).items, []);

  for (const target of domain.web.reviewTargets) target.state = 'approved';
  const toRelease = domain.source.gameReleases.find(row => row.gameReleaseId === 'fixture-r2');
  toRelease.gameBuild = 'UNVERIFIED';
  view = createSharedViewModel({ domains: sourcePackage.domains, gameReleaseId: domain.gameReleaseId });
  assert.deepEqual(view.getGameChanges({ gameVersion: '1.0.1' }).items, []);
});

// Scenario: A comparison row is present but its declared older release or snapshot is absent from the package closure.
// Purpose: Require both comparison identities after the compiler has been taught to include their registry rows.
// Given an otherwise approved compiler package, When either comparison pointer cannot resolve inside its release, Then the affected changes are not presented as confirmed.
test('UnitT35_requires_both_comparison_release_and_snapshot_rows', async () => {
  const missingReleasePackage = await makeCompiledGameChangesPackage();
  for (const domain of missingReleasePackage.domains) {
    domain.source.gameReleases = domain.source.gameReleases.filter(row => row.gameReleaseId !== 'fixture-r1');
    domain.source.sourceSnapshots = domain.source.sourceSnapshots.filter(row => row.gameReleaseId !== 'fixture-r1');
  }
  const missingReleaseView = createSharedViewModel({
    domains: missingReleasePackage.domains,
    gameReleaseId: 'fixture-r2',
  });
  assert.deepEqual(missingReleaseView.getGameChanges({ gameVersion: '1.0.1' }).items, []);

  const missingSnapshotPackage = await makeCompiledGameChangesPackage();
  const index = missingSnapshotPackage.domains.find(row => row.kind === 'game-changes');
  const change = index.source.records.find(record => record.kind === 'game-change');
  change.payload.comparison.fromSnapshotId = 'fixture-snapshot-unresolved';
  const missingSnapshotView = createSharedViewModel({
    domains: missingSnapshotPackage.domains,
    gameReleaseId: 'fixture-r2',
  });
  assert.equal(missingSnapshotView.getGameChanges({ gameVersion: '1.0.1' }).items.some(row => row.owner === 'source'), false);
});

// Scenario: A compiler-emitted change points at an entity without a unique zh-TW display name.
// Purpose: Prevent raw record IDs or generic fallback names from being presented as a public game update.
// Given a valid change domain with its target presentation missing, When projected, Then the unidentified item is omitted.
test('UnitT40_omits_changes_without_a_unique_zh_tw_entity_name', async () => {
  const sourcePackage = await makeCompiledGameChangesPackage();
  const domain = sourcePackage.domains.find(row => row.kind === 'weapons');
  domain.web.presentations = [];
  const view = createSharedViewModel({ domains: sourcePackage.domains, gameReleaseId: domain.gameReleaseId });

  assert.deepEqual(view.getGameChanges({ gameVersion: '1.0.1' }).items, []);
});
