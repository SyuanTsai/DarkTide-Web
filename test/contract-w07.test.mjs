import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createReviewReceipt,
  getReviewState,
  loadWebAuthoringInputs,
  validateWebAuthoring,
} from '../scripts/content/contract-authoring.mjs';
import { buildW07Candidate, writeW07Candidate } from '../scripts/content/contract-w07.mjs';

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

test('UnitT04_w07-review-digests-stale-only-the-targeted-stat-and-ignore-commit-only-changes', async () => {
  // Scenario: A reviewed Mk IV claim value changes while an unrelated Mk XII stat and an action source commit remain stable.
  // Purpose: Preserve per-stat dependency scope and the Source digest rule that commit metadata alone is not content.
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
  provenance.commit = '1111111111111111111111111111111111111111';
  provenance.snapshot.commit = provenance.commit;
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
  }
  assert.equal(first.matrix.sourceOwnedEvidence.length, 12);
  assert.ok(first.matrix.sourceOwnedEvidence.some(fact => fact.recordId === 'darktide:evidence:chainaxe:p1-m1-displayed-attack-role-summary-code'));
  assert.ok(first.matrix.sourceOwnedEvidence.some(fact => fact.recordId === 'darktide:evidence:chainaxe:p1-m2-displayed-attack-role-summary-code'));

  assert.match(first.markdownBytes.toString('utf8'), /113 attack-power-point/);
  assert.match(first.markdownBytes.toString('utf8'), /113\.00 attack-power-point \/ fixed-2/);
  assert.match(first.markdownBytes.toString('utf8'), /Panel range/);
  assert.match(first.markdownBytes.toString('utf8'), /theoretical range/);
  assert.match(first.markdownBytes.toString('utf8'), /obtainable range/);
  assert.match(first.markdownBytes.toString('utf8'), /1 point → 80 attack-power-point；2 point → 140 attack-power-point/);
  assert.match(first.markdownBytes.toString('utf8'), /74 個 distinct weapon stat locator fields/);
  assert.match(first.markdownBytes.toString('utf8'), /0\.25–0\.75 ratio/);
  assert.match(first.markdownBytes.toString('utf8'), /multi-target-cleave（群體（順劈））/);
  assert.match(first.markdownBytes.toString('utf8'), /保留來源參數，不代表總命中次數/);
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
