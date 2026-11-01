import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { FIXED_RETAINED_NAME_PINS } from '../scripts/content/retained-name-evidence.mjs';
import {
  computeReviewDigests,
  createReviewReceipt,
  getReviewState,
  loadWebAuthoringInputs,
  validateWebAuthoring,
} from '../scripts/content/contract-authoring.mjs';
import { buildW07Candidate, renderW07BoostCurveSection, writeW07Candidate } from '../scripts/content/contract-w07.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('UnitT00_w07-mode-loads-the-pinned-weapon-contract', async () => {
  // Scenario: The W07 contract inputs are present and the loader is asked to load mode w07.
  // Purpose: Ensure the existing authoring API accepts the new mode and resolves its pinned inputs.
  await assert.doesNotReject(loadWebAuthoringInputs({ repoRoot, mode: 'w07' }));
});

test('UnitT01_w07-authoring-binds-each-mark-stat-and-action-to-its-source-records', async () => {
  // Scenario: Both accepted W01 weapons are loaded with their complete Source-owned stat groups and action profiles.
  // Purpose: Keep mark switching and review scope tied to each exact Source weapon, metric, and action.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const result = validateWebAuthoring(inputs.authoring, inputs);
  assert.deepEqual(result.issues, []);
});

test('UnitT20_ScenarioCallerSuppliesForgedRetainedName_PurposeRequiresFixedSourceEvidenceMap', async () => {
  // Scenario: A candidate carries a well-shaped retained name but its validation inputs have no loader-verified map.
  // Purpose: Prevent caller-controlled localized names and source hashes from satisfying retained-name validation.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const candidate = structuredClone(inputs.authoring);
  const presentation = candidate.presentations[0];
  const weapon = inputs.sourceRecordMap.get(presentation.weaponView.sourceWeaponRef.gameReleaseId + '\u0000'
    + presentation.weaponView.sourceWeaponRef.recordId);
  const sourceRefMap = new Map(inputs.sourceContract.sourceRefs.map(ref => [ref.sourceId + '\u0000' + ref.gameReleaseId, ref]));
  const templateSourceRef = weapon.sourceRefs.map(ref => sourceRefMap.get(ref.sourceId + '\u0000' + ref.gameReleaseId))
    .find(ref => ref?.path.endsWith('/' + weapon.payload.templateKey + '.lua'));
  assert.ok(templateSourceRef, 'fixture weapon should have an exact template SourceRef');
  presentation.retainedName = {
    name: presentation.name,
    sourceGameVersion: '1.13.1',
    sourceMarkId: weapon.payload.markId,
    historyEvidence: {
      repository: 'SyuanTsai/DarkTide-Web',
      commit: '3b8d8cc3e86cf69bb5cb0009ad41e512463370a3',
      path: 'content/history/1.13.1/source-content.json',
      sourceSha256: '0'.repeat(64),
      sourceIds: ['mods-release-1-13-x'],
    },
    modsEvidence: {
      repository: FIXED_RETAINED_NAME_PINS.mods.repository,
      commit: FIXED_RETAINED_NAME_PINS.mods.commit,
      path: FIXED_RETAINED_NAME_PINS.mods.path,
      blobSha1: FIXED_RETAINED_NAME_PINS.mods.blobSha1,
      sha256: FIXED_RETAINED_NAME_PINS.mods.sha256,
      familyId: weapon.payload.familyId,
      nameKey: 'loc_weapon_family_chainaxe_p1_m1',
      templatePath: templateSourceRef.path,
    },
    currentIdentity: {
      gameReleaseId: weapon.gameReleaseId,
      familyId: weapon.payload.familyId,
      markId: weapon.payload.markId,
      templateKey: weapon.payload.templateKey,
      repository: 'Aussiemon/Darktide-Source-Code',
      commit: templateSourceRef.commit,
      path: templateSourceRef.path,
      blobSha1: '0'.repeat(40),
      sourceSha256: templateSourceRef.artifactSha256,
    },
    identityMethod: 'exact-mark-id-family-id-template-path-and-pinned-source-blob',
  };
  const result = validateWebAuthoring(candidate, inputs);
  assert.ok(result.issues.some(item => item.code === 'retained-name-evidence'));
});

test('UnitT02_w07-rejects-a-foreign-mark-action-profile', async () => {
  // Scenario: Mk IV keeps its presentation identity but is given the first Mk XII Source action profile.
  // Purpose: Prevent a mark switch from retaining another mark's action and damage-profile binding.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const candidate = structuredClone(inputs.authoring);
  candidate.presentations[0].weaponView.attackProfileRefs[0] = structuredClone(candidate.presentations[1].weaponView.attackProfileRefs[0]);
  const result = validateWebAuthoring(candidate, inputs);
  assert.ok(result.issues.some(item => item.code === 'weapon-action-owner' || item.code === 'weapon-action-coverage'));
});

test('UnitT03_w07-rejects-a-claim-moved-to-another-stat-group', async () => {
  // Scenario: An armor-pierce claim is moved into the damage stat section while its Source ref stays valid.
  // Purpose: Ensure claim membership is bound to context.weaponStat, not merely record existence.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const candidate = structuredClone(inputs.authoring);
  candidate.presentations[0].weaponView.statSections[0].claimRefs[0] = structuredClone(candidate.presentations[0].weaponView.statSections[1].claimRefs[0]);
  const result = validateWebAuthoring(candidate, inputs);
  assert.ok(result.issues.some(item => item.code === 'weapon-stat-claim' || item.code === 'weapon-stat-coverage'));
});

test('UnitT04_w07-review-digests-stale-only-the-targeted-stat-and-ignore-consistent-source-permalink-moves', async () => {
  // Scenario: A reviewed Mk IV claim value changes while an unrelated Mk XII stat and an action source permalink move together.
  // Purpose: Preserve per-stat dependency scope when a pinned repository commit and its matching public URL change together.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const contract = structuredClone(inputs.authoring);
  const m1Target = contract.reviewTargets.find(target => target.targetId === 'review:w07:p1-m1:stat-chainaxe_dps_stat');
  const m2Target = contract.reviewTargets.find(target => target.targetId === 'review:w07:p1-m2:stat-chainaxe_dps_stat');
  const m1Receipt = createReviewReceipt(contract, m1Target, { ...inputs, reviewer: { kind: 'human', id: 'test-only' }, reviewedAt: '2026-10-19T00:00:00Z' });
  const m2Receipt = createReviewReceipt(contract, m2Target, { ...inputs, reviewer: { kind: 'human', id: 'test-only' }, reviewedAt: '2026-10-19T00:00:00Z' });
  const actionTarget = contract.reviewTargets.find(target => target.targetId === 'review:w07:p1-m1:action-01');
  const actionReceipt = createReviewReceipt(contract, actionTarget, { ...inputs, reviewer: { kind: 'human', id: 'test-only' }, reviewedAt: '2026-10-19T00:00:00Z' });
  contract.reviewReceipts = [m1Receipt, m2Receipt, actionReceipt];

  const changedClaimInputs = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const changedClaim = changedClaimInputs.sourceContract.records.find(record => record.recordId === contract.presentations[0].weaponView.statSections[0].claimRefs[0].recordId);
  changedClaim.payload.value.decimal = '999';
  changedClaimInputs.sourceRecordMap = new Map(changedClaimInputs.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.equal(getReviewState(contract, m1Target.targetId, changedClaimInputs), 'stale');
  assert.equal(getReviewState(contract, m2Target.targetId, changedClaimInputs), 'approved');

  const commitOnlyInputs = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const profileRef = contract.presentations[0].weaponView.attackProfileRefs[0];
  const profile = commitOnlyInputs.sourceContract.records.find(record => record.recordId === profileRef.recordId);
  const sourceIds = new Set(profile.sourceRefs.map(ref => ref.sourceId));
  const provenance = commitOnlyInputs.sourceContract.sourceRefs.find(ref => ref.gameReleaseId === profile.gameReleaseId && sourceIds.has(ref.sourceId));
  const previousCommit = provenance.commit;
  provenance.commit = '1111111111111111111111111111111111111111';
  provenance.snapshot.commit = provenance.commit;
  provenance.publicUrl = provenance.publicUrl.replace(`/blob/${previousCommit}/`, `/blob/${provenance.commit}/`);
  commitOnlyInputs.sourceRecordMap = new Map(commitOnlyInputs.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.equal(getReviewState(contract, actionTarget.targetId, commitOnlyInputs), 'approved');
});

test('UnitT05_w07-rejects-duplicated-mechanics-values-in-the-Web-view', async () => {
  // Scenario: A Web author adds an editable damage value alongside the Source claim reference.
  // Purpose: Keep Source as the only mechanics owner while allowing Web-owned labels and notes.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const candidate = structuredClone(inputs.authoring);
  candidate.presentations[0].weaponView.statSections[0].damageValue = '999';
  const result = validateWebAuthoring(candidate, inputs);
  assert.equal(result.valid, false);
});

test('UnitT06_w07-rejects-removing-all-mechanics-review-targets-from-the-candidate', async () => {
  // Scenario: The candidate removes every W07-specific review target while the initially loaded authoring object remains unchanged.
  // Purpose: Validate target completeness against the candidate being reviewed, not the loader's original input object.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const candidate = structuredClone(inputs.authoring);
  candidate.reviewTargets = candidate.reviewTargets.filter(target => !target.fieldPath.startsWith('/weaponView/'));
  const result = validateWebAuthoring(candidate, inputs);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(item => item.code === 'weapon-review-target'));
});

test('UnitT07_w07-matrix-preserves-complete-weapon-facts-and-readable-source-values', async () => {
  // Scenario: Build the deterministic human-review candidate from the pinned W07 inputs.
  // Purpose: Keep all Source weapon payload tables and the actual displayed/raw comparison facts available for review.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const first = buildW07Candidate(inputs);
  const second = buildW07Candidate(inputs);
  assert.deepEqual(first.markdownBytes, second.markdownBytes);
  assert.deepEqual(first.matrixBytes, second.matrixBytes);

  for (const presentation of first.matrix.presentations) {
    const sourceWeapon = inputs.sourceRecordMap.get(presentation.sourceWeaponRef.gameReleaseId + '\u0000' + presentation.sourceWeaponRef.recordId);
    assert.deepEqual(presentation.sourceWeapon.sourceFact.payload, sourceWeapon.payload);
    for (const key of ['sourceRows', 'statTables', 'emptyTables', 'actionContinuations']) assert.ok(Object.hasOwn(presentation.sourceWeapon.sourceFact.payload, key), key);
    assert.ok(presentation.sourceWeapon.actionProfileResolution);
    assert.deepEqual(presentation.actionProfileResolution, sourceWeapon.payload.actionProfileResolution);
    for (const section of presentation.statSections) for (const { definition, curve } of section.statDefinitions) {
      if (!curve) continue;
      assert.equal(curve.payload.inputUnit, 'ratio');
      assert.deepEqual(curve.payload.knots.map(point => [point.input, point.sourceOrdinal]), [['0', 1], ['1', 2]]);
      assert.equal(curve.payload.interpolation.value, 'linear');
      assert.equal(curve.payload.edgePolicy.value, 'extrapolate');
      assert.ok(definition.payload.rangeEvidence.checkedSources.length > 0);
    }
  }
  assert.equal(first.matrix.sourceOwnedEvidence.length, 12);
  assert.ok(first.matrix.sourceOwnedEvidence.some(fact => fact.recordId === 'darktide:evidence:chainaxe:p1-m1-displayed-attack-role-summary-code'));
  assert.ok(first.matrix.sourceOwnedEvidence.some(fact => fact.recordId === 'darktide:evidence:chainaxe:p1-m2-displayed-attack-role-summary-code'));

  assert.match(first.markdownBytes.toString('utf8'), /113 attack-power-point/);
  assert.match(first.markdownBytes.toString('utf8'), /113\.00 attack-power-point \/ fixed-2/);
  assert.match(first.markdownBytes.toString('utf8'), /Panel range/);
  assert.match(first.markdownBytes.toString('utf8'), /theoretical range/);
  assert.match(first.markdownBytes.toString('utf8'), /obtainable range/);
  assert.match(first.markdownBytes.toString('utf8'), /Source slot 1 .* normalized t=0 ratio/);
  assert.match(first.markdownBytes.toString('utf8'), /Interpolation：linear；edge policy：extrapolate/);
  assert.match(first.markdownBytes.toString('utf8'), /attainable item-rating range/);
  assert.match(first.markdownBytes.toString('utf8'), /Static facts are Source-owned/);
  assert.match(first.markdownBytes.toString('utf8'), /74 個 distinct weapon stat locator fields/);
  assert.match(first.markdownBytes.toString('utf8'), /0\.25–0\.75 ratio/);
  assert.match(first.markdownBytes.toString('utf8'), /multi-target-cleave（群體（順劈））/);
  assert.match(first.markdownBytes.toString('utf8'), /保留來源參數，不代表總命中次數/);
  assert.doesNotMatch(first.markdownBytes.toString('utf8'), /敵人專屬 hit-zone 與 critical\/weakspot 組合：NOT_IMPORTED/u);
  assert.match(first.markdownBytes.toString('utf8'), /敵人靜態 hit-zone、armor\/weakspot 對照及 critical\/finesse Source 關係已匯入；不執行 runtime 規則，也不計算 critical\/weakspot 結果或 final damage/u);
  assert.match(first.markdownBytes.toString('utf8'), /special-active/);
  assert.match(first.markdownBytes.toString('utf8'), /chain_time=0\.54/);
  assert.match(first.markdownBytes.toString('utf8'), /以下是獨立的顯示摘要，不表示可達連段/);
  assert.equal(first.matrix.materials.weaponInventory.length, 2);
  for (const item of first.matrix.materials.weaponInventory) {
    assert.deepEqual(item.existingReusableAssetRefs, []);
    assert.equal(item.licenseStatus, 'NOT_REVIEWED');
    assert.equal(item.imageStatus, 'MISSING_NO_VERIFIED_REUSABLE_REFERENCE');
  }
});

test('UnitT09_w07-matrix-projects-source-action-resolution-and-target-armor-closure-per-action', async () => {
  // Scenario: Each selected weapon has a Source action-resolution graph whose action profiles bind the static target and armor closure.
  // Purpose: Preserve the real per-action Source relationships in the review matrix without inventing Web-owned mechanics facts.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const candidate = buildW07Candidate(inputs);
  const armorAndTargetFacts = new Map(candidate.matrix.sourceOwnedArmorAndTargetProfiles.map(fact => [fact.gameReleaseId + '\u0000' + fact.recordId, fact]));
  const modifierRuleFacts = new Map(candidate.matrix.sourceOwnedModifierRules.map(fact => [fact.gameReleaseId + '\u0000' + fact.recordId, fact]));

  for (const presentation of candidate.matrix.presentations) {
    const weapon = inputs.sourceRecordMap.get(presentation.sourceWeaponRef.gameReleaseId + '\u0000' + presentation.sourceWeaponRef.recordId);
    assert.ok(weapon.payload.actionProfileResolution, 'weapon must retain the Source-owned actionProfileResolution');
    assert.deepEqual(presentation.sourceWeapon.sourceFact.payload.actionProfileResolution, weapon.payload.actionProfileResolution);
    assert.deepEqual(presentation.actionProfileResolution, weapon.payload.actionProfileResolution);
    assert.equal(presentation.actionBindings.length, weapon.payload.attackProfileRefs.length);
    const expectedTargetCount = inputs.sourceContract.records.filter(record => record.kind === 'target-profile'
      && record.gameReleaseId === presentation.sourceWeaponRef.gameReleaseId
      && record.payload.sourceStatic?.breedType === 'minion').length;

    for (const action of presentation.actionBindings) {
      const profile = inputs.sourceRecordMap.get(action.sourceRef.gameReleaseId + '\u0000' + action.sourceRef.recordId);
      assert.ok(profile.payload.actionResolution, action.sourceRef.recordId);
      assert.deepEqual(action.actionResolution, profile.payload.actionResolution);
      assert.deepEqual(action.targetProfileRefs, profile.payload.targetProfileRefs);
      assert.deepEqual(action.armorClassRefs, profile.payload.armorClassRefs);
      assert.deepEqual(action.modifierRuleRefs, profile.payload.modifierRuleRefs);
      assert.deepEqual(action.actionResolution.branchBindings, profile.payload.sourceBindings);
      assert.equal(action.targetProfileRefs.length, expectedTargetCount, action.sourceRef.recordId);

      for (const ref of action.targetProfileRefs) {
        const fact = armorAndTargetFacts.get(ref.gameReleaseId + '\u0000' + ref.recordId);
        assert.ok(fact, 'Source-owned target fact must be present in the matrix: ' + ref.recordId);
        assert.equal(fact.kind, 'target-profile');
        assert.ok(fact.payload.sourceStatic.rawHitZones.rawValue);
        assert.ok(fact.payload.sourceStatic.hitZones.length > 0);
        assert.ok(Array.isArray(fact.payload.sourceStatic.unresolvedZoneReferences));
        for (const zone of fact.payload.sourceStatic.hitZones) assert.equal(typeof zone.actorsRawValue, 'string');
        const toughness = fact.payload.sourceStatic.toughnessArmorClassRef;
        if (toughness) {
          assert.ok(fact.payload.sourceStatic.toughnessArmorLocator);
          assert.equal(typeof fact.payload.sourceStatic.toughnessArmorRawValue, 'string');
          assert.ok(action.armorClassRefs.some(ref => ref.recordId === toughness.recordId && ref.gameReleaseId === toughness.gameReleaseId),
            'action armor closure must include the target’s toughness armor identity');
        }
      }
      for (const ref of action.armorClassRefs) {
        const fact = armorAndTargetFacts.get(ref.gameReleaseId + '\u0000' + ref.recordId);
        assert.ok(fact, 'Source-owned armor fact must be present in the matrix: ' + ref.recordId);
        assert.equal(fact.kind, 'armor-class');
      }
      for (const ref of action.modifierRuleRefs) {
        const fact = modifierRuleFacts.get(ref.gameReleaseId + '\u0000' + ref.recordId);
        assert.ok(fact, 'Source-owned modifier-rule fact must be present in the matrix: ' + ref.recordId);
        assert.equal(fact.kind, 'modifier-rule');
      }
    }
  }
});

test('UnitT10_w07-stat-review-digest-is-scoped-to-the-selected-stat-binding-group', async () => {
  // Scenario: One Mk IV Source trait parameter range changes while the other Mk IV and Mk XII stat groups remain fixed.
  // Purpose: Make each stat review depend on its own Source mapping row without staling sibling stats or the other mark.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const contract = structuredClone(inputs.authoring);
  const m1Presentation = contract.presentations[0];
  const m2Presentation = contract.presentations[1];
  const m1Target = contract.reviewTargets.find(target => target.ownerId === m1Presentation.authoringId
    && target.fieldPath === '/weaponView/statSections/0');
  const m1SiblingTarget = contract.reviewTargets.find(target => target.ownerId === m1Presentation.authoringId
    && target.fieldPath === '/weaponView/statSections/1');
  const m2Target = contract.reviewTargets.find(target => target.ownerId === m2Presentation.authoringId
    && target.fieldPath === '/weaponView/statSections/0');
  contract.reviewReceipts = [m1Target, m1SiblingTarget, m2Target].map(target => createReviewReceipt(contract, target, {
    ...inputs,
    reviewer: { kind: 'human', id: 'test-only' },
    reviewedAt: '2026-10-19T00:00:00Z',
  }));

  const changedInputs = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const weaponRef = m1Presentation.weaponView.sourceWeaponRef;
  const weapon = changedInputs.sourceContract.records.find(record => record.recordId === weaponRef.recordId
    && record.gameReleaseId === weaponRef.gameReleaseId);
  const selectedSection = m1Presentation.weaponView.statSections[0];
  const mappingRef = selectedSection.statDefinitionRefs.find(ref => {
    const definition = inputs.sourceRecordMap.get(ref.gameReleaseId + '\u0000' + ref.recordId);
    return Boolean(definition?.payload.curveMapping);
  });
  assert.ok(mappingRef, 'the real pinned Source input must contain a curve mapping definition for the selected stat');
  const mappingDefinition = changedInputs.sourceContract.records.find(record => record.recordId === mappingRef.recordId
    && record.gameReleaseId === mappingRef.gameReleaseId);
  mappingDefinition.payload.curveMapping.traitParameter.range.max = '0.76';
  changedInputs.sourceRecordMap = new Map(changedInputs.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));

  assert.equal(getReviewState(contract, m1Target.targetId, changedInputs), 'stale');
  assert.equal(getReviewState(contract, m1SiblingTarget.targetId, changedInputs), 'approved');
  assert.equal(getReviewState(contract, m2Target.targetId, changedInputs), 'approved');
});

test('UnitT11_w07-rejects-duplicate-wrong-kind-and-missing-source-resolution-refs', async () => {
  // Scenario: A pinned W07 Source profile duplicates a target, substitutes an armor ref, or loses target/action facts.
  // Purpose: Require exact same-release typed closure and preserve toughness/raw-actor source evidence from real pinned data.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const presentation = inputs.authoring.presentations[0];
  const weaponRef = presentation.weaponView.sourceWeaponRef;
  const profileRef = presentation.weaponView.attackProfileRefs[0];
  const duplicate = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const duplicateProfile = duplicate.sourceContract.records.find(record => record.recordId === profileRef.recordId && record.gameReleaseId === profileRef.gameReleaseId);
  assert.ok(duplicateProfile.payload.actionResolution);
  assert.ok(duplicateProfile.payload.targetProfileRefs.length > 1);
  duplicateProfile.payload.targetProfileRefs[1] = structuredClone(duplicateProfile.payload.targetProfileRefs[0]);
  duplicate.sourceRecordMap = new Map(duplicate.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.ok(validateWebAuthoring(inputs.authoring, duplicate).issues.some(item => item.code === 'weapon-target-coverage'));

  const wrongKind = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const wrongKindProfile = wrongKind.sourceContract.records.find(record => record.recordId === profileRef.recordId && record.gameReleaseId === profileRef.gameReleaseId);
  wrongKindProfile.payload.targetProfileRefs[0] = structuredClone(wrongKindProfile.payload.armorClassRefs[0]);
  wrongKind.sourceRecordMap = new Map(wrongKind.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.ok(validateWebAuthoring(inputs.authoring, wrongKind).issues.some(item => ['wrong-kind-ref', 'weapon-target-coverage'].includes(item.code)));

  const foreignRelease = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const currentTarget = foreignRelease.sourceContract.records.find(record => record.kind === 'target-profile'
    && record.gameReleaseId === weaponRef.gameReleaseId);
  assert.ok(currentTarget, 'the fixed Source pin must contain the current-release static target registry');
  const unrelatedTarget = structuredClone(currentTarget);
  unrelatedTarget.recordId += ':other-release-sentinel';
  unrelatedTarget.gameReleaseId = foreignRelease.sourceContract.gameReleases.find(release => release.gameReleaseId !== weaponRef.gameReleaseId).gameReleaseId;
  foreignRelease.sourceContract.records.push(unrelatedTarget);
  foreignRelease.sourceRecordMap = new Map(foreignRelease.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.ok(!validateWebAuthoring(inputs.authoring, foreignRelease).issues.some(item => item.code === 'weapon-target-coverage'),
    'unrelated target facts from another release must not be added to this weapon’s required closure');

  const missingToughness = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const toughnessTarget = missingToughness.sourceContract.records.find(record => record.kind === 'target-profile'
    && record.gameReleaseId === weaponRef.gameReleaseId && record.payload.sourceStatic?.toughnessArmorClassRef);
  assert.ok(toughnessTarget, 'the fixed static registry must include a breed with a Source-owned toughness armor identity');
  delete toughnessTarget.payload.sourceStatic.toughnessArmorClassRef;
  missingToughness.sourceRecordMap = new Map(missingToughness.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.ok(validateWebAuthoring(inputs.authoring, missingToughness).issues.some(item => item.code === 'weapon-target-static-facts'),
    'toughness armor identity cannot be dropped while its raw token and locator remain');

  const wrongToughness = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const wrongToughnessTarget = wrongToughness.sourceContract.records.find(record => record.recordId === toughnessTarget.recordId
    && record.gameReleaseId === toughnessTarget.gameReleaseId);
  wrongToughnessTarget.payload.sourceStatic.toughnessArmorRawValue = 'armor_types.armored';
  wrongToughness.sourceRecordMap = new Map(wrongToughness.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.ok(validateWebAuthoring(inputs.authoring, wrongToughness).issues.some(item => item.code === 'weapon-target-static-facts'),
    'the toughness raw enum access must resolve to its exact armor-class ref');

  const missingRawActors = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const actorsTarget = missingRawActors.sourceContract.records.find(record => record.kind === 'target-profile'
    && record.gameReleaseId === weaponRef.gameReleaseId && record.payload.sourceStatic?.hitZones?.some(zone => typeof zone.actorsRawValue === 'string'));
  assert.ok(actorsTarget, 'the fixed registry must retain a raw actors token for at least one hit zone');
  delete actorsTarget.payload.sourceStatic.hitZones.find(zone => typeof zone.actorsRawValue === 'string').actorsRawValue;
  missingRawActors.sourceRecordMap = new Map(missingRawActors.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.ok(validateWebAuthoring(inputs.authoring, missingRawActors).issues.some(item => item.code === 'weapon-target-static-facts'),
    'resolved actors must not replace the original raw actors token');

  const missingResolution = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const missingWeapon = missingResolution.sourceContract.records.find(record => record.recordId === weaponRef.recordId && record.gameReleaseId === weaponRef.gameReleaseId);
  delete missingWeapon.payload.actionProfileResolution;
  missingResolution.sourceRecordMap = new Map(missingResolution.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.ok(validateWebAuthoring(inputs.authoring, missingResolution).issues.some(item => item.code === 'weapon-resolution-required'));
});

test('UnitT12_w07-action-review-digest-is-scoped-to-one-action-and-shared-target-dependencies', async () => {
  // Scenario: One action locator changes, then a shared target profile changes across two marks.
  // Purpose: Stale only the action rows that depend on the changed Source action or shared target, leaving stat reviews isolated.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const contract = structuredClone(inputs.authoring);
  const target = (presentationIndex, actionIndex) => contract.reviewTargets.find(item => item.ownerId === contract.presentations[presentationIndex].authoringId
    && item.fieldPath === '/weaponView/attackProfileRefs/' + actionIndex);
  const m1Action0 = target(0, 0);
  const m1Action1 = target(0, 1);
  const m2Action0 = target(1, 0);
  const m1Stat0 = contract.reviewTargets.find(item => item.ownerId === contract.presentations[0].authoringId && item.fieldPath === '/weaponView/statSections/0');
  contract.reviewReceipts = [m1Action0, m1Action1, m2Action0, m1Stat0].map(item => createReviewReceipt(contract, item, {
    ...inputs,
    reviewer: { kind: 'human', id: 'test-only' },
    reviewedAt: '2026-10-19T00:00:00Z',
  }));

  const actionChanged = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const actionRef = contract.presentations[0].weaponView.attackProfileRefs[0];
  const actionProfile = actionChanged.sourceContract.records.find(record => record.recordId === actionRef.recordId && record.gameReleaseId === actionRef.gameReleaseId);
  assert.ok(actionProfile.payload.actionResolution.inputBindings.length > 0);
  actionProfile.payload.actionResolution.inputBindings[0].sourceLocator.line += 1;
  actionChanged.sourceRecordMap = new Map(actionChanged.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.equal(getReviewState(contract, m1Action0.targetId, actionChanged), 'stale');
  assert.equal(getReviewState(contract, m1Action1.targetId, actionChanged), 'approved');
  assert.equal(getReviewState(contract, m2Action0.targetId, actionChanged), 'approved');
  assert.equal(getReviewState(contract, m1Stat0.targetId, actionChanged), 'approved');

  const firstTargetRef = actionProfile.payload.targetProfileRefs[0];
  const m2ProfileRef = contract.presentations[1].weaponView.attackProfileRefs[0];
  const m2Profile = actionChanged.sourceRecordMap.get(m2ProfileRef.gameReleaseId + '\u0000' + m2ProfileRef.recordId);
  assert.ok(m2Profile.payload.targetProfileRefs.some(ref => ref.recordId === firstTargetRef.recordId && ref.gameReleaseId === firstTargetRef.gameReleaseId));
  const targetChanged = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const targetProfile = targetChanged.sourceContract.records.find(record => record.recordId === firstTargetRef.recordId && record.gameReleaseId === firstTargetRef.gameReleaseId);
  targetProfile.payload.sourceStatic.hitZones[0].rawSource.rawValue += ' changed-for-digest-test';
  targetChanged.sourceRecordMap = new Map(targetChanged.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.equal(getReviewState(contract, m1Action0.targetId, targetChanged), 'stale');
  assert.equal(getReviewState(contract, m2Action0.targetId, targetChanged), 'stale');
  assert.equal(getReviewState(contract, m1Stat0.targetId, targetChanged), 'approved');
});

test('UnitT14_w07-action-digest-includes-only-the-selected-action-generator-definition', async () => {
  // Scenario: Two attack actions share a weapon but only one action owns a generator callsite.
  // Purpose: Make its effective shared definition and incoming edge stale only that action review.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const contract = structuredClone(inputs.authoring);
  const presentation = contract.presentations[0];
  const target = contract.reviewTargets.find(item => item.ownerId === presentation.authoringId
    && item.fieldPath === '/weaponView/attackProfileRefs/0');
  const profileRef = presentation.weaponView.attackProfileRefs[0];
  const profile = inputs.sourceRecordMap.get(profileRef.gameReleaseId + '\u0000' + profileRef.recordId);
  const weaponRef = presentation.weaponView.sourceWeaponRef;
  const weapon = inputs.sourceRecordMap.get(weaponRef.gameReleaseId + '\u0000' + weaponRef.recordId);
  const action = profile.payload.action;
  const locator = { sourceRef: { sourceId: 'synthetic-w07-code', gameReleaseId: profile.gameReleaseId }, path: 'scripts/synthetic.lua', line: 20, fieldPath: 'actions.' + action };
  weapon.payload.actionProfileResolution = {
    inputSetup: {
      setupKey: 'synthetic-setup', inheritedSetupKey: 'synthetic-default',
      inputEntries: [{ inputKey: 'start_attack', origin: 'weapon-mid-setup', rawValue: 'start_attack = true', sourceLocator: locator }],
    },
    localActions: [{ action, startInput: null, rawSource: { rawValue: 'action row', sourceLocator: locator }, sourceRange: { ...locator, endLine: 24 } }],
    fallbackActions: [],
    generatorBindings: [{
      generatorKey: 'generate_wield_chain_actions', ownerAction: action,
      callsite: { sourceLocator: { ...locator, line: 22 }, rawValue: 'generate_wield_chain_actions({ chain_time = 0.35 })' },
    }],
    actionGenerators: [
      { generatorKey: 'generate_wield_chain_actions', effectiveDefinitionIndex: 2, definitions: [
        { definitionIndex: 1, rawValue: 'old definition' },
        { definitionIndex: 2, rawValue: 'effective definition' },
      ] },
      { generatorKey: 'generate_inspect_action', effectiveDefinitionIndex: 1, definitions: [
        { definitionIndex: 1, rawValue: 'unrelated definition' },
      ] },
    ],
  };
  profile.payload.actionResolution = {
    origin: 'weapon-template', startInput: null, inputBindings: [],
    entryBindings: [{ fromAction: 'action_windup', inputKey: 'start_attack.[]', toAction: action, sourceLocator: locator, conditions: [{ fieldPath: 'chain_time', rawValue: '0.35', sourceLocator: locator }] }],
    branchBindings: [], runtimeConditions: [],
    targetApplicability: 'all-static-registry-minion-hit-schemas',
  };
  const digest = subjectInputs => computeReviewDigests(contract, target, subjectInputs).dependenciesDigest;
  const original = digest(inputs);

  const usedDefinitionChanged = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const usedWeapon = usedDefinitionChanged.sourceContract.records.find(record => record.recordId === weapon.recordId && record.gameReleaseId === weapon.gameReleaseId);
  usedWeapon.payload.actionProfileResolution.actionGenerators[0].definitions[1].rawValue += ' changed';
  usedDefinitionChanged.sourceRecordMap = new Map(usedDefinitionChanged.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.notEqual(digest(usedDefinitionChanged), original);

  const unrelatedDefinitionChanged = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const unrelatedWeapon = unrelatedDefinitionChanged.sourceContract.records.find(record => record.recordId === weapon.recordId && record.gameReleaseId === weapon.gameReleaseId);
  unrelatedWeapon.payload.actionProfileResolution.actionGenerators[1].definitions[0].rawValue += ' changed';
  unrelatedDefinitionChanged.sourceRecordMap = new Map(unrelatedDefinitionChanged.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.equal(digest(unrelatedDefinitionChanged), original);

  const incomingEdgeChanged = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const incomingProfile = incomingEdgeChanged.sourceContract.records.find(record => record.recordId === profile.recordId && record.gameReleaseId === profile.gameReleaseId);
  incomingProfile.payload.actionResolution.entryBindings[0].conditions[0].rawValue = '0.99';
  incomingEdgeChanged.sourceRecordMap = new Map(incomingEdgeChanged.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.notEqual(digest(incomingEdgeChanged), original);
});

test('UnitT15_w07-action-digest-ignores-unselected-input-setup-source-rows', async () => {
  // Scenario: A weapon setup source includes multiple inputs, while one action consumes only one input key.
  // Purpose: Keep per-action review dependencies scoped to its selected merged input entries, not the entire setup source tables.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const contract = structuredClone(inputs.authoring);
  const presentation = contract.presentations[0];
  const target = contract.reviewTargets.find(item => item.ownerId === presentation.authoringId
    && item.fieldPath === '/weaponView/attackProfileRefs/0');
  const profileRef = presentation.weaponView.attackProfileRefs[0];
  const profile = inputs.sourceRecordMap.get(profileRef.gameReleaseId + '\u0000' + profileRef.recordId);
  const weaponRef = presentation.weaponView.sourceWeaponRef;
  const weapon = inputs.sourceRecordMap.get(weaponRef.gameReleaseId + '\u0000' + weaponRef.recordId);
  const action = profile.payload.action;
  const locator = { sourceRef: { sourceId: 'synthetic-w07-code', gameReleaseId: profile.gameReleaseId }, path: 'scripts/synthetic.lua', line: 20, fieldPath: 'action_input_setup' };
  weapon.payload.actionProfileResolution = {
    inputSetup: {
      setupKey: 'synthetic-setup', inheritedSetupKey: 'synthetic-default',
      hierarchyRaw: { rawValue: 'synthetic hierarchy', sourceLocator: locator },
      setupSources: [
        { rawValue: 'start_attack = { ... }', sourceLocator: { ...locator, line: 21, fieldPath: 'start_attack' } },
        { rawValue: 'heavy_attack = { ... }', sourceLocator: { ...locator, line: 22, fieldPath: 'heavy_attack' } },
      ],
      inputEntries: [
        { inputKey: 'start_attack', origin: 'default-setup', rawValue: 'start_attack = true', sourceLocator: { ...locator, line: 21, fieldPath: 'start_attack' } },
        { inputKey: 'heavy_attack', origin: 'default-setup', rawValue: 'heavy_attack = true', sourceLocator: { ...locator, line: 22, fieldPath: 'heavy_attack' } },
      ],
    },
    localActions: [{ action, startInput: null, rawSource: { rawValue: 'action row', sourceLocator: locator }, sourceRange: { ...locator, endLine: 24 } }],
    fallbackActions: [],
    generatorBindings: [],
    actionGenerators: [],
  };
  profile.payload.actionResolution = {
    origin: 'weapon-template', startInput: null, inputBindings: [],
    entryBindings: [{ fromAction: 'action_windup', inputKey: 'start_attack.[]', toAction: action, sourceLocator: locator, conditions: [] }],
  };
  const digest = subjectInputs => computeReviewDigests(contract, target, subjectInputs).dependenciesDigest;
  const original = digest(inputs);

  const unrelatedSetupSourceChanged = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const changedWeapon = unrelatedSetupSourceChanged.sourceContract.records.find(record => record.recordId === weapon.recordId && record.gameReleaseId === weapon.gameReleaseId);
  changedWeapon.payload.actionProfileResolution.inputSetup.setupSources[1].rawValue = 'heavy_attack = { unrelated changed setting }';
  unrelatedSetupSourceChanged.sourceRecordMap = new Map(unrelatedSetupSourceChanged.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.equal(digest(unrelatedSetupSourceChanged), original);

  const selectedInputChanged = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const selectedWeapon = selectedInputChanged.sourceContract.records.find(record => record.recordId === weapon.recordId && record.gameReleaseId === weapon.gameReleaseId);
  selectedWeapon.payload.actionProfileResolution.inputSetup.inputEntries[0].rawValue = 'start_attack = false';
  selectedInputChanged.sourceRecordMap = new Map(selectedInputChanged.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.notEqual(digest(selectedInputChanged), original);
});

test('UnitT16_w07-stat-semantics-cover-every-source-binding-property', async () => {
  // Scenario: W07 source trait bindings and semantic table rows are separately projected into the review candidate.
  // Purpose: Reject omitted, duplicated, or orphan semantic rows instead of silently losing a source-bound property.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const presentation = inputs.authoring.presentations[0];
  const weaponRef = presentation.weaponView.sourceWeaponRef;
  const sourceLocator = locator => structuredClone(locator);

  const evaluate = (mutateSemantics = () => {}) => {
    const subjectInputs = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
    const weapon = subjectInputs.sourceContract.records.find(record => record.recordId === weaponRef.recordId
      && record.gameReleaseId === weaponRef.gameReleaseId);
    const semantics = (weapon.payload.statBindings ?? []).map(group => ({
      statKey: group.statKey,
      groupKey: group.statKey.replace(/^chainaxe_/u, '').replace(/_stat$/u, ''),
      bindings: [...new Set((group.bindings ?? []).map(binding => binding.property))].map(property => {
        const owner = group.bindings.find(binding => binding.property === property);
        return {
          property,
          quantityKind: 'stamina-capacity-addition',
          unit: 'point',
          consumerEvidence: [{ sourceLocator: sourceLocator(owner.weaponLocator), rawValue: 'synthetic test evidence', summary: 'Synthetic coverage-only row.' }],
          theoreticalInputRange: { status: 'unknown', reasonCode: 'NOT_EXPOSED_BY_SOURCE' },
          obtainableInputRange: { status: 'unknown', reasonCode: 'NOT_EXPOSED_BY_SOURCE' },
        };
      }),
    }));
    weapon.payload.statTableSemantics = semantics;
    weapon.payload.actionProfileResolution = { executionPolicy: 'static-only; functions not executed' };
    mutateSemantics(weapon.payload.statTableSemantics);
    subjectInputs.sourceRecordMap = new Map(subjectInputs.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
    const result = validateWebAuthoring(subjectInputs.authoring, subjectInputs);
    return result.issues.filter(item => item.code === 'weapon-stat-semantics-coverage');
  };

  assert.deepEqual(evaluate(), []);
  assert.ok(evaluate(semantics => { semantics[0].bindings.pop(); }).length > 0, 'missing property semantics must be rejected');
  assert.ok(evaluate(semantics => { semantics[0].bindings.push(structuredClone(semantics[0].bindings[0])); }).length > 0, 'duplicate property semantics must be rejected');
  assert.ok(evaluate(semantics => { semantics[0].bindings.push({ ...structuredClone(semantics[0].bindings[0]), property: 'unowned.synthetic.selector' }); }).length > 0,
    'orphan semantic properties must be rejected');
});

test('UnitT17_w07-markdown-renders-the-complete-typed-profile-boost-curve', () => {
  // Scenario: Two selected action profiles point to the same Source-owned five-point boost table.
  // Purpose: Make every output, normalized input knot, caller interval, and evidence locator readable without executing the curve.
  const table = {
    tableKey: 'PowerLevelSettings.boost_curves.default',
    quantity: 'damage-boost-curve',
    unit: 'ratio',
    sourceLocator: { path: 'scripts/settings/damage/power_level_settings.lua', line: 125, fieldPath: 'power_level_settings.boost_curves.default.1' },
    orderedValues: ['0', '0.3', '0.6', '0.8', '1'].map((rawValue, index) => ({ ordinal: index + 1, rawValue, decimal: rawValue })),
    curveSemantics: {
      schemaVersion: 'w07-boost-curve-semantics/1.0.0',
      referenceAxis: {
        min: '0', max: '1', minInclusive: true, maxInclusive: true, unit: 'ratio',
        sourceLocators: [{ path: 'scripts/utilities/attack/damage_calculation.lua', line: 208, endLine: 217, fieldPath: 'source.five_point_damage_boost_curve_indexing_and_interpolation' }],
      },
      knots: ['0', '0.25', '0.5', '0.75', '1'].map((input, index) => ({ sourceOrdinal: index + 1, input })),
      interpolation: {
        value: 'piecewise-linear',
        sourceLocator: { path: 'scripts/utilities/attack/damage_calculation.lua', line: 208, endLine: 217, fieldPath: 'source.five_point_damage_boost_curve_indexing_and_interpolation' },
      },
      callerInput: {
        min: '0', minInclusive: false, max: '1', maxInclusive: true, unit: 'ratio',
        predicate: 'finesse_boost_amount > 0',
        transform: 'math.min(finesse_boost_amount, 1)',
        sourceLocators: [{ path: 'scripts/utilities/attack/damage_calculation.lua', line: 700, endLine: 704, fieldPath: 'source.finesse_boost_amount_cap_and_positive_amount_gate' }],
      },
    },
  };
  const profile = (recordId, profileTable = table) => ({
    recordId, gameReleaseId: 'fixture-release',
    payload: { rawSourceDefinition: { tables: [structuredClone(profileTable)] } },
  });
  const presentation = {
    actionBindings: [
      { damageProfileRefs: [{ recordId: 'damage:one', gameReleaseId: 'fixture-release' }] },
      { damageProfileRefs: [{ recordId: 'damage:two', gameReleaseId: 'fixture-release' }] },
    ],
  };
  const lines = renderW07BoostCurveSection(presentation, [profile('damage:one'), profile('damage:two'), profile('unselected')]);
  const rendered = lines.join('\n');
  assert.equal(rendered.split('\n').filter(line => line.includes('PowerLevelSettings.boost_curves.default')).length, 1);
  assert.match(rendered, /1:0 ratio；2:0\.3 ratio；3:0\.6 ratio；4:0\.8 ratio；5:1 ratio/u);
  assert.match(rendered, /\[0, 1\] ratio；knots 1:0；2:0\.25；3:0\.5；4:0\.75；5:1/u);
  assert.match(rendered, /piecewise-linear/u);
  assert.match(rendered, /\(0, 1\] ratio；finesse_boost_amount > 0；math\.min\(finesse_boost_amount, 1\)/u);
  assert.match(rendered, /damage_calculation\.lua:208–217/u);
  assert.match(rendered, /damage_calculation\.lua:700–704/u);
  assert.doesNotMatch(rendered, /unselected/u);
});

test('UnitT18_w07-action-input-bindings-deduplicate-keys-but-preserve-all-outgoing-edges', async () => {
  // Scenario: One action has four literal outgoing edges, with two destinations sharing start_attack.[] input.
  // Purpose: Keep the action-level input summary unique while preserving every edge and its conditions in the weapon graph.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const presentation = inputs.authoring.presentations[0];
  const weaponRef = presentation.weaponView.sourceWeaponRef;
  const weapon = inputs.sourceRecordMap.get(weaponRef.gameReleaseId + '\u0000' + weaponRef.recordId);
  const profileRef = presentation.weaponView.attackProfileRefs.find(ref =>
    inputs.sourceRecordMap.get(ref.gameReleaseId + '\u0000' + ref.recordId)?.payload.action === 'action_right_heavy');
  assert.ok(profileRef, 'the fixed W07 input must retain the m1 right-heavy action profile');
  const profile = inputs.sourceRecordMap.get(profileRef.gameReleaseId + '\u0000' + profileRef.recordId);
  const outgoing = weapon.payload.actionContinuations.filter(edge => edge.fromAction === 'action_right_heavy');
  const uniqueInputs = new Map();
  for (const edge of outgoing) if (!uniqueInputs.has(edge.inputKey)) uniqueInputs.set(edge.inputKey, edge);
  const expectedBindings = [...uniqueInputs.values()].map(edge => ({
    inputKey: edge.inputKey,
    role: 'continuation',
    sourceLocator: edge.sourceLocator,
  }));
  assert.equal(outgoing.length, 4);
  assert.equal(expectedBindings.length, 3);
  assert.equal(expectedBindings[0].sourceLocator.line, 872);
  assert.deepEqual(profile.payload.actionResolution.inputBindings, expectedBindings);
  assert.deepEqual(validateWebAuthoring(inputs.authoring, inputs).issues, []);

  const missing = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const missingProfile = missing.sourceContract.records.find(record => record.recordId === profileRef.recordId
    && record.gameReleaseId === profileRef.gameReleaseId);
  missingProfile.payload.actionResolution.inputBindings.pop();
  missing.sourceRecordMap = new Map(missing.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  assert.ok(validateWebAuthoring(inputs.authoring, missing).issues.some(issue => issue.code === 'weapon-action-resolution-input'));
});

test('UnitT13_w07-rejects-a-source-curve-that-reuses-array-slot-as-the-t-axis', async () => {
  // Scenario: A real Source curve keeps its raw endpoints but changes the normalized reference knot back to ordinal input.
  // Purpose: Prevent the Web contract from presenting array positions 1/2 as the input axis or implying a damage calculation.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const changed = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const curve = changed.sourceContract.records.find(record => record.kind === 'stat-curve');
  assert.ok(curve.payload.knots[0].sourceOrdinal);
  curve.payload.knots[0].input = String(curve.payload.knots[0].sourceOrdinal);
  changed.sourceRecordMap = new Map(changed.sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  const result = validateWebAuthoring(inputs.authoring, changed);
  assert.ok(result.issues.some(item => item.code === 'weapon-curve-normalized-endpoints'));
});

// Scenario: A W07 candidate keeps its weapons but removes both official-source and displayed-name review targets.
// Purpose: Require review of each non-empty weapon identity and official presentation before candidate generation.
test('UnitT08_w07-rejects-missing-official-and-name-review-coverage', async () => {
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  inputs.authoring.reviewTargets = inputs.authoring.reviewTargets.filter(target => !['/official', '/name'].includes(target.fieldPath));

  const result = validateWebAuthoring(inputs.authoring, inputs);

  assert.equal(result.valid, false);
  assert.ok(result.issues.some(item => item.code === 'review-coverage' && item.path.endsWith('/official')));
  assert.ok(result.issues.some(item => item.code === 'review-coverage' && item.path.endsWith('/name')));
  assert.throws(() => buildW07Candidate(inputs), /Web contract is invalid/);
});

test('InterT30_w07-writer-creates-only-a-new-explicit-output-directory', async t => {
  // Scenario: Write a W07 candidate to a new directory outside the checkout, then retry against an existing manual directory.
  // Purpose: Permit explicit review exports while preserving every pre-existing output byte.
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w07' });
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'w07-writer-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const expected = buildW07Candidate(inputs);
  const outputRoot = path.join(tempRoot, 'outside', 'candidate');
  await mkdir(path.dirname(outputRoot));
  const written = await writeW07Candidate(inputs, outputRoot);
  const markdownBytes = await readFile(path.join(outputRoot, 'review-candidate.md'));
  const matrixBytes = await readFile(path.join(outputRoot, 'review-matrix.json'));
  assert.deepEqual(markdownBytes, expected.markdownBytes);
  assert.deepEqual(matrixBytes, expected.matrixBytes);
  assert.equal(JSON.stringify(written.matrix).includes(tempRoot), false);
  await assert.rejects(writeW07Candidate(inputs, outputRoot), /already exists; refusing to overwrite/);
  assert.deepEqual(await readFile(path.join(outputRoot, 'review-candidate.md')), markdownBytes);
  assert.deepEqual(await readFile(path.join(outputRoot, 'review-matrix.json')), matrixBytes);

  const manualRoot = path.join(tempRoot, 'manual');
  await mkdir(manualRoot);
  const sentinel = Buffer.from('human-owned bytes\n');
  await writeFile(path.join(manualRoot, 'review-candidate.md'), sentinel);
  await assert.rejects(writeW07Candidate(inputs, manualRoot), /already exists; refusing to overwrite/);
  assert.deepEqual(await readFile(path.join(manualRoot, 'review-candidate.md')), sentinel);
  await assert.rejects(readFile(path.join(manualRoot, 'review-matrix.json')), { code: 'ENOENT' });
});

test('InterT10_official-locator-tampering-is-rejected-after-all-local-lock-hashes-are-recomputed', async t => {
  // Scenario: A caller changes an official name, recomputes the segment/snapshot/authoring hashes, and updates the W07 lock.
  // Purpose: Keep the immutable official input tied to its reviewed safe snapshot even when an attacker recalculates local hashes.
  await mkdir(path.join(repoRoot, '.tmp'), { recursive: true });
  const tempRoot = await mkdtemp(path.join(repoRoot, '.tmp', 'w07-official-pin-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const copy = async relative => {
    const destination = path.join(tempRoot, ...relative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(repoRoot, ...relative.split('/')), destination);
  };
  for (const relative of [
    'content/schema/v2/web-authoring.schema.json',
    'content/authoring/v2/w07-weapons.json',
    'content/contracts/w07/source-v2.lock.json',
    'content/contracts/w07/official-inputs.json',
    'content/contracts/w07/web-authoring.lock.json',
    'content/contracts/w07/baseline/w01-web-authoring.json',
    'content/contracts/w07/baseline/w01-baseline.lock.json',
  ]) await copy(relative);

  const officialPath = path.join(tempRoot, 'content/contracts/w07/official-inputs.json');
  const lockPath = path.join(tempRoot, 'content/contracts/w07/web-authoring.lock.json');
  const authoringPath = path.join(tempRoot, 'content/authoring/v2/w07-weapons.json');
  const official = JSON.parse(await readFile(officialPath, 'utf8'));
  const source = official.sources[0];
  const alteredText = source.sourceText + ' tampered';
  const alteredTextHash = createHash('sha256').update(alteredText).digest('hex');
  source.sourceText = alteredText;
  source.sourceTextSha256 = alteredTextHash;
  source.segments[0].text = alteredText;
  source.segments[0].sha256 = alteredTextHash;
  source.resolvedText = alteredText;
  source.resolvedTextSha256 = alteredTextHash;
  const officialBytes = Buffer.from(JSON.stringify(official, null, 2) + '\n');
  const officialHash = createHash('sha256').update(officialBytes).digest('hex');
  await writeFile(officialPath, officialBytes);

  const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
  authoring.officialInputsSha256 = officialHash;
  const authoringBytes = Buffer.from(JSON.stringify(authoring, null, 2) + '\n');
  const authoringHash = createHash('sha256').update(authoringBytes).digest('hex');
  await writeFile(authoringPath, authoringBytes);
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.officialInputs.sha256 = officialHash;
  lock.authoring.sha256 = authoringHash;
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');

  await assert.rejects(
    loadWebAuthoringInputs({ repoRoot: tempRoot, sourceSnapshotRoot: path.join(repoRoot, 'content/contracts/w07/source-v2-snapshot'), mode: 'w07' }),
    /fixed reviewed snapshot/,
  );
});

test('InterT20_w07-rejects-a-recalculated-but-different-accepted-W01-baseline-cache', async t => {
  // Scenario: The accepted W01 baseline cache and its local lock are both changed to new bytes after the original raw Git pin was reviewed.
  // Purpose: Keep comparisons tied to the fixed accepted W01 Git blob rather than trusting a self-consistent replacement cache.
  const tempRoot = await mkdtemp(path.join(repoRoot, '.tmp', 'w07-baseline-pin-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const copy = async relative => {
    const destination = path.join(tempRoot, ...relative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(repoRoot, ...relative.split('/')), destination);
  };
  for (const relative of [
    'content/schema/v2/web-authoring.schema.json',
    'content/authoring/v2/w07-weapons.json',
    'content/contracts/w07/source-v2.lock.json',
    'content/contracts/w07/official-inputs.json',
    'content/contracts/w07/web-authoring.lock.json',
    'content/contracts/w07/baseline/w01-web-authoring.json',
    'content/contracts/w07/baseline/w01-baseline.lock.json',
  ]) await copy(relative);

  const baselinePath = path.join(tempRoot, 'content/contracts/w07/baseline/w01-web-authoring.json');
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  baseline.records[0].owner = 'tampered-after-acceptance';
  const baselineBytes = Buffer.from(JSON.stringify(baseline, null, 2) + '\n');
  const baselineSha256 = createHash('sha256').update(baselineBytes).digest('hex');
  await writeFile(baselinePath, baselineBytes);
  const lockPath = path.join(tempRoot, 'content/contracts/w07/baseline/w01-baseline.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.sha256 = baselineSha256;
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');

  await assert.rejects(
    loadWebAuthoringInputs({ repoRoot: tempRoot, sourceSnapshotRoot: path.join(repoRoot, 'content/contracts/w07/source-v2-snapshot'), mode: 'w07' }),
    /pinned W01 baseline raw-blob cache differs from its fixed identity/,
  );
});
