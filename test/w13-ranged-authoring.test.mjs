import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createReviewReceipt,
  getReviewState,
  validateWebAuthoring,
} from '../scripts/content/contract-authoring.mjs';
import { buildW07Candidate } from '../scripts/content/contract-w07.mjs';
import { loadW13RangedPreviewInputs } from '../scripts/content/w13-ranged-preview.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPROVED_W07_OVERLAY = 'content/contracts/w09/authoring-overlays/w07/authoring/7c2e8bba7b53629af1a7938b5b47108054290a76fbf322b3a7d47f56d4977dd6.json';
const RANGED_PRESENTATION_ID = 'web:presentation:lasgun-p1-m1';
const SOURCE_WEAPON_REF = {
  recordId: 'darktide:weapon:lasgun:p1-m1',
  gameReleaseId: 'darktide:1.13.2',
  kind: 'weapon',
};

// Scenario: The immutable approved W07 overlay is extended with one same-release ranged presentation.
// Purpose: Preserve every existing reviewed target and receipt while keeping the new ranged wording and action targets pending.
test('UnitT10_w13-ranged-candidate-preserves-approved-w07-receipts-and-validates-new-review-state', { timeout: 300000 }, async () => {
  const approvedBaseline = JSON.parse(await readFile(path.join(repoRoot, ...APPROVED_W07_OVERLAY.split('/')), 'utf8'));
  const preview = await loadW13RangedPreviewInputs({ repoRoot });
  const inputs = preview.w07;
  assert.equal(preview.reviewReceipt.status, 'validated-pending-candidate');
  assert.equal(preview.reviewReceipt.previewOnly, true);
  assert.equal(preview.reviewReceipt.publicationEligible, false);
  assert.equal(preview.reviewReceipt.projection.compilationStatus, 'not-run');
  assert.equal(preview.reviewReceipt.w06Baseline.preservedTargetCount, 34);
  assert.equal(preview.reviewReceipt.w06Baseline.preservedReceiptCount, 39);
  assert.equal(preview.reviewReceipt.w06Baseline.allTargetsApprovedByReviewApi, true);
  assert.equal(inputs.authoring.reviewTargets.length - approvedBaseline.reviewTargets.length, 8);
  assert.equal(preview.w06.authoring.reviewTargets.length, 34);
  assert.equal(preview.w06.authoring.reviewReceipts.length, 39, 'the selected W06 overlay keeps historical receipts beyond its 34 current targets');
  assert.ok(preview.w06.authoring.reviewTargets.every(target => getReviewState(preview.w06.authoring, target.targetId, preview.w06) === 'approved'));
  const oldTargetIds = new Set(approvedBaseline.reviewTargets.map(target => target.targetId));
  const currentOldTargets = inputs.authoring.reviewTargets.filter(target => oldTargetIds.has(target.targetId));
  const currentOldReceipts = inputs.authoring.reviewReceipts.filter(receipt => oldTargetIds.has(receipt.targetId));

  assert.deepEqual(currentOldTargets, approvedBaseline.reviewTargets,
    'all previously approved W07 target identities and scopes remain byte-equivalent as parsed values');
  assert.deepEqual(currentOldReceipts, approvedBaseline.reviewReceipts,
    'all 38 existing human receipts and their exact digests remain unchanged');

  const presentation = inputs.authoring.presentations.find(row => row.authoringId === RANGED_PRESENTATION_ID);
  assert.ok(presentation, 'the real W13 Source weapon has a Web presentation');
  assert.deepEqual(presentation.weaponView.sourceWeaponRef, SOURCE_WEAPON_REF);
  assert.deepEqual(presentation.weaponView.statSections, [], 'the Source weapon has no statBindings, so the view does not invent stat groups');
  assert.equal(presentation.weaponView.note,
    '來源模板端點不代表實際可取得彈藥量；未匯入欄位另列於來源涵蓋。數值依公開程式碼整理，未經遊戲內實測。');
  const sourceWeapon = inputs.sourceRecordMap.get(SOURCE_WEAPON_REF.gameReleaseId + '\u0000' + SOURCE_WEAPON_REF.recordId);
  assert.deepEqual(sourceWeapon.payload.statBindings ?? [], []);
  const officialNames = inputs.officialInputs.sources.filter(source => source.entityRef.recordId === SOURCE_WEAPON_REF.recordId
    && source.key === 'loc_weapon_family_lasgun_p1_m1');
  assert.deepEqual(officialNames.map(source => [source.sourceLocale, source.sourceHash, source.occurrence, source.sourceText]), [
    ['en', 'f93eef0d', 1, 'Infantry Lasgun'],
    ['zh-TW', 'f93eef0d', 1, '步兵鐳射槍'],
  ]);
  const newTargets = inputs.authoring.reviewTargets.filter(target => target.ownerId === RANGED_PRESENTATION_ID);
  assert.equal(newTargets.length, 8, 'two official inputs, four labels, and two action bindings each have their own target');
  assert.deepEqual(newTargets.map(target => target.fieldPath).sort(), [
    '/name', '/official', '/weaponView/attackHeading', '/weaponView/attackProfileRefs/0',
    '/weaponView/attackProfileRefs/1', '/weaponView/comparisonHeading', '/weaponView/markLabel', '/weaponView/note',
  ].sort(), 'the ranged target identity and scope remain fixed');
  const newTargetIds = new Set(newTargets.map(target => target.targetId));
  const newReceipts = inputs.authoring.reviewReceipts.filter(receipt => newTargetIds.has(receipt.targetId));
  assert.ok(newReceipts.every(receipt => receipt.reviewer?.kind === 'human'
    && typeof receipt.reviewer.id === 'string' && receipt.reviewer.id.trim()
    && !/(?:^|[-_:])(?:synthetic|probe|fixture)(?:[-_:]|$)/iu.test(receipt.reviewer.id)),
  'new receipts, if present, must be validator-backed human receipts rather than test/probe identities');
  assert.equal(validateWebAuthoring(inputs.authoring, inputs).valid, true,
    'the current authoring and any real receipts pass the existing validator');
  const actualReviewStates = new Map(newTargets.map(target => [target.targetId, getReviewState(inputs.authoring, target.targetId, inputs)]));
  const allowedStates = new Set(['pending', 'approved', 'rejected', 'stale']);
  assert.ok([...actualReviewStates.values()].every(state => allowedStates.has(state)),
    'the repository regression accepts the lifecycle states derived from the real review API');

  const candidate = buildW07Candidate(inputs);
  assert.equal(candidate.matrix.review.receiptCount, inputs.authoring.reviewReceipts.length);
  assert.equal(candidate.matrix.review.targetCount, approvedBaseline.reviewTargets.length + newTargets.length);
  assert.ok(candidate.matrix.review.targets.filter(target => oldTargetIds.has(target.targetId))
    .every(target => target.state === 'approved'));
  for (const target of candidate.matrix.review.targets.filter(target => target.ownerId === RANGED_PRESENTATION_ID)) {
    assert.equal(target.state, actualReviewStates.get(target.targetId));
  }

  const isolatedPendingAuthoring = structuredClone(inputs.authoring);
  isolatedPendingAuthoring.reviewReceipts = isolatedPendingAuthoring.reviewReceipts.filter(receipt => !newTargetIds.has(receipt.targetId));
  const isolatedPendingInputs = { ...inputs, authoring: isolatedPendingAuthoring };
  assert.equal(validateWebAuthoring(isolatedPendingAuthoring, isolatedPendingInputs).valid, true);
  assert.ok(newTargets.every(target => getReviewState(isolatedPendingAuthoring, target.targetId, isolatedPendingInputs) === 'pending'));
  const pendingCandidate = buildW07Candidate(isolatedPendingInputs);
  assert.equal(pendingCandidate.matrix.publicationEligible, false);
  assert.equal(pendingCandidate.matrix.review.receiptCount, approvedBaseline.reviewReceipts.length,
    'the isolated all-pending candidate keeps the exact 38 approved baseline receipts');

  const profiles = sourceWeapon.payload.attackProfileRefs.map(ref => inputs.sourceRecordMap.get(ref.gameReleaseId + '\u0000' + ref.recordId));
  assert.deepEqual(profiles.map(profile => profile.payload.mode), ['hipfire', 'ads']);
  assert.ok(profiles.every(profile => !profile.payload.actionResolution
    && profile.dataCoverage?.status === 'partial'
    && profile.dataCoverage.missing.some(item => item.field === '/payload/actionResolution' && item.reasonCode === 'NOT_IMPORTED')));

  const validMissing = sourceWeapon.dataCoverage.missing;
  try {
    sourceWeapon.dataCoverage.missing = validMissing.filter(item => item.field !== '/payload/actionProfileResolution');
    assert.ok(validateWebAuthoring(inputs.authoring, inputs).issues.some(item => item.code === 'weapon-resolution-required'),
      'missing weapon NOT_IMPORTED marker is rejected');
  } finally {
    sourceWeapon.dataCoverage.missing = validMissing;
  }

  try {
    sourceWeapon.dataCoverage.missing = [...validMissing, { field: '/payload/actionProfileResolution', reasonCode: 'UNKNOWN' }];
    assert.ok(validateWebAuthoring(inputs.authoring, inputs).issues.some(item => item.code === 'weapon-resolution-required'),
      'a conflicting marker for the same action-resolution field is rejected');
  } finally {
    sourceWeapon.dataCoverage.missing = validMissing;
  }

  const profile = profiles[0];
  const profileCoverage = profile.dataCoverage;
  try {
    profile.dataCoverage = { ...profileCoverage, missing: profileCoverage.missing.filter(item => item.field !== '/payload/actionResolution') };
    assert.ok(validateWebAuthoring(inputs.authoring, inputs).issues.some(item => item.code === 'weapon-resolution-required'),
      'missing profile NOT_IMPORTED marker is rejected');
  } finally {
    profile.dataCoverage = profileCoverage;
  }

  try {
    const missing = profileCoverage.missing.map(item => item.field === '/payload/actionResolution'
      ? { ...item, reasonCode: 'UNKNOWN' } : item);
    profile.dataCoverage = { ...profileCoverage, missing };
    assert.ok(validateWebAuthoring(inputs.authoring, inputs).issues.some(item => item.code === 'weapon-resolution-required'),
      'a contradictory profile coverage marker is rejected');
  } finally {
    profile.dataCoverage = profileCoverage;
  }

  const originalActionResolution = sourceWeapon.payload.actionProfileResolution;
  try {
    sourceWeapon.payload.actionProfileResolution = {};
    const strictIssues = validateWebAuthoring(inputs.authoring, inputs).issues;
    assert.ok(strictIssues.some(item => item.code === 'weapon-resolution-input-setup'),
      'an existing but incomplete closure enters the strict validation path');
    assert.ok(!strictIssues.some(item => item.code === 'weapon-resolution-required'));
  } finally {
    if (originalActionResolution === undefined) delete sourceWeapon.payload.actionProfileResolution;
    else sourceWeapon.payload.actionProfileResolution = originalActionResolution;
  }

  const originalMode = profile.payload.mode;
  try {
    profile.payload.mode = 'light';
    assert.ok(validateWebAuthoring(inputs.authoring, inputs).issues.some(item => item.code === 'weapon-resolution-required'),
      'the incomplete-closure exception is restricted to known ranged modes');
  } finally {
    profile.payload.mode = originalMode;
  }

  const reorderedProfiles = structuredClone(inputs.authoring);
  reorderedProfiles.presentations.find(row => row.authoringId === RANGED_PRESENTATION_ID).weaponView.attackProfileRefs.reverse();
  assert.ok(validateWebAuthoring(reorderedProfiles, inputs).issues.some(item => item.code === 'weapon-action-coverage'),
    'ranged profile references must keep Source order');

  const originalOwner = profile.payload.weaponRef;
  try {
    profile.payload.weaponRef = { ...originalOwner, recordId: 'darktide:weapon:chainaxe:p1-m1' };
    assert.ok(validateWebAuthoring(inputs.authoring, inputs).issues.some(item => item.code === 'weapon-action-owner'),
      'ranged profile owner mismatch remains rejected');
  } finally {
    profile.payload.weaponRef = originalOwner;
  }

  const originalTemplate = profile.payload.templateKey;
  try {
    profile.payload.templateKey = 'unrelated-template';
    assert.ok(validateWebAuthoring(inputs.authoring, inputs).issues.some(item => item.code === 'weapon-action-template'),
      'ranged profile template mismatch remains rejected');
  } finally {
    profile.payload.templateKey = originalTemplate;
  }

  const chainaxePresentation = inputs.authoring.presentations.find(row => row.entityRef.recordId === 'darktide:weapon:chainaxe:p1-m1');
  const chainaxeWeapon = inputs.sourceRecordMap.get(chainaxePresentation.entityRef.gameReleaseId + '\u0000' + chainaxePresentation.entityRef.recordId);
  const originalResolution = chainaxeWeapon.payload.actionProfileResolution;
  const originalCoverage = chainaxeWeapon.dataCoverage;
  try {
    delete chainaxeWeapon.payload.actionProfileResolution;
    chainaxeWeapon.dataCoverage = { status: 'partial', missing: [{ field: '/payload/actionProfileResolution', reasonCode: 'NOT_IMPORTED' }] };
    assert.ok(validateWebAuthoring(inputs.authoring, inputs).issues.some(item => item.code === 'weapon-resolution-required'),
      'a melee weapon cannot use the ranged explicit-missing closure exception');
  } finally {
    chainaxeWeapon.payload.actionProfileResolution = originalResolution;
    if (originalCoverage === undefined) delete chainaxeWeapon.dataCoverage;
    else chainaxeWeapon.dataCoverage = originalCoverage;
  }

  const emptyChainaxeView = structuredClone(inputs.authoring);
  emptyChainaxeView.presentations.find(row => row.authoringId === chainaxePresentation.authoringId).weaponView.statSections = [];
  assert.ok(validateWebAuthoring(emptyChainaxeView, inputs).issues.some(item => item.code === 'weapon-stat-coverage'),
    'Source stat groups cannot be hidden behind an empty view');

  const wordingTarget = newTargets.find(target => target.fieldPath === '/weaponView/markLabel');
  const isolatedSyntheticReceiptCopy = structuredClone(isolatedPendingAuthoring);
  isolatedSyntheticReceiptCopy.reviewReceipts.push(createReviewReceipt(isolatedSyntheticReceiptCopy, wordingTarget, {
    ...isolatedPendingInputs,
    reviewer: { kind: 'human', id: 'isolated-test-only' },
    reviewedAt: '2026-10-24T00:00:00Z',
  }));
  assert.equal(getReviewState(isolatedSyntheticReceiptCopy, wordingTarget.targetId, isolatedPendingInputs), 'approved');
  isolatedSyntheticReceiptCopy.presentations.find(row => row.authoringId === RANGED_PRESENTATION_ID).weaponView.markLabel += ' edited';
  assert.equal(getReviewState(isolatedSyntheticReceiptCopy, wordingTarget.targetId, isolatedPendingInputs), 'stale',
    'a changed new target becomes stale only in the isolated synthetic review copy');
});
