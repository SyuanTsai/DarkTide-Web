import assert from 'node:assert/strict';
import { cp, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { restorePinnedRealR3Preview } from '../scripts/w01-restore-preview.mjs';
import { verifyW01Package } from '../scripts/w01-build.mjs';
import { sha256 } from '../src/static/common.mjs';

const r3SourceRoot = process.env.W01_PRIOR_REAL_R3_ROOT;
const r4SourceRoot = process.env.W01_PRIOR_REAL_R4_ROOT;
const inputRootsReady = Boolean(r3SourceRoot && r4SourceRoot);

async function readReceipt(root) {
  return JSON.parse(await readFile(path.join(root, 'receipt.json'), 'utf8'));
}

async function createWorkspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'syp-311-w01-r4-to-r3-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const activeRoot = path.join(root, 'dist-w01');
  if (r4SourceRoot) await cp(r4SourceRoot, activeRoot, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  return { root, activeRoot, proofPath: path.join(root, 'recovery-proof.json') };
}

// Scenario: exact published .3 and .4 packages are available as read-only inputs.
// Purpose: restore every .3 runtime byte, retain all immutable .4 data URLs, and emit a provenance proof without modifying either input.
test('UnitT10_fixed-r4-to-r3-restoration-retains-all-immutable-data', { skip: !inputRootsReady }, async t => {
  const { root, activeRoot, proofPath } = await createWorkspace(t);
  const targetReceiptBefore = await readFile(path.join(r3SourceRoot, 'receipt.json'));
  const activeReceiptBefore = await readFile(path.join(r4SourceRoot, 'receipt.json'));
  const targetReceipt = JSON.parse(targetReceiptBefore);
  const activeReceipt = JSON.parse(activeReceiptBefore);

  const result = await restorePinnedRealR3Preview({ targetRoot: r3SourceRoot, activeRoot, proofPath });

  const restoredReceiptBytes = await readFile(path.join(activeRoot, 'receipt.json'));
  const restoredReceipt = JSON.parse(restoredReceiptBytes);
  const proof = JSON.parse(await readFile(proofPath, 'utf8'));
  const restoredRows = new Map(restoredReceipt.files.map(row => [row.path, row]));
  for (const row of targetReceipt.files.filter(row => !row.path.startsWith('data/'))) {
    assert.deepEqual(restoredRows.get(row.path), row, `exact .3 runtime row ${row.path}`);
    assert.deepEqual(await readFile(path.join(activeRoot, ...row.path.split('/'))), await readFile(path.join(r3SourceRoot, ...row.path.split('/'))));
  }
  const activeDataRows = activeReceipt.files.filter(row => row.path.startsWith('data/'));
  assert.equal(activeDataRows.length, 2301);
  for (const row of activeDataRows) assert.deepEqual(restoredRows.get(row.path), row, `retained .4 data URL ${row.path}`);
  assert.equal(restoredReceipt.files.length, 2308);
  assert.equal(restoredReceipt.contentVersion, '0.0.3');
  assert.equal(restoredReceipt.dataRevision, 'f406d32142fc9ef507a0884c211e6ae7364580f016f9f12389a8cf36448d7222');
  assert.equal(restoredReceipt.buildId, 'c948c9954e1eb4066517acd576b2e1e16c3b82780bf9a621582ebd355fca93ca');
  assert.equal(restoredReceipt.manifestSha256, '40468483602b8ac237585446f140455659eab39cf0537ae2a8f7d44d1c95260c');
  assert.equal(restoredReceipt.web.authoringCommit, 'e516a5b896f78273544c16047126c327337a8424');
  assert.equal(restoredReceipt.fixtureOnly, false);
  assert.equal(restoredReceipt.candidatePreviewOnly, true);
  assert.equal(restoredReceipt.publicationEligible, false);
  assert.equal(restoredReceipt.formalPublishAllowed, false);
  assert.equal(sha256(restoredReceiptBytes), result.restoredReceiptSha256);
  assert.equal(proof.controllerCommit, result.controllerCommit);
  assert.equal(proof.restored.webAuthoringCommit, 'e516a5b896f78273544c16047126c327337a8424');
  assert.equal(proof.retained.webAuthoringCommit, 'b401ae50d7ebb7e44aeb59a8c864a8b93628aead');
  assert.equal(proof.retained.dataFileCount, activeDataRows.length);
  assert.doesNotMatch(JSON.stringify(proof), /(?:[A-Za-z]:\\|runner\.temp|private|\.zip)/i);
  assert.equal(sha256(await readFile(path.join(r3SourceRoot, 'receipt.json'))), sha256(targetReceiptBefore));
  assert.equal(sha256(await readFile(path.join(r4SourceRoot, 'receipt.json'))), sha256(activeReceiptBefore));
  await verifyW01Package(activeRoot);
  await verifyW01Package(result.backupRoot);
});

// Scenario: the active package has the wrong release identity or the target contains an unsafe receipt path.
// Purpose: reject bad inputs before any active .4 file is changed.
test('UnitT20_wrong-release-and-unsafe-path-reject-before-active-mutation', { skip: !inputRootsReady }, async t => {
  const { activeRoot, proofPath } = await createWorkspace(t);
  const activeReceiptBefore = await readFile(path.join(activeRoot, 'receipt.json'));
  await assert.rejects(restorePinnedRealR3Preview({ targetRoot: r4SourceRoot, activeRoot, proofPath }), /not the exact fixed W01 0\.0\.3/);
  assert.deepEqual(await readFile(path.join(activeRoot, 'receipt.json')), activeReceiptBefore);
  await verifyW01Package(activeRoot);

  const unsafeTargetRoot = path.join(path.dirname(activeRoot), 'unsafe-target');
  await cp(r3SourceRoot, unsafeTargetRoot, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  const unsafeTargetReceipt = await readReceipt(unsafeTargetRoot);
  unsafeTargetReceipt.files[0].path = '../outside.json';
  await writeFile(path.join(unsafeTargetRoot, 'receipt.json'), JSON.stringify(unsafeTargetReceipt));
  await assert.rejects(restorePinnedRealR3Preview({ targetRoot: unsafeTargetRoot, activeRoot, proofPath }), /safe relative path|fixed 0\.0\.3|output/);
  assert.deepEqual(await readFile(path.join(activeRoot, 'receipt.json')), activeReceiptBefore);
  await verifyW01Package(activeRoot);
});

// Scenario: an otherwise pinned active .4 package has a data file whose bytes no longer match its receipt.
// Purpose: ensure tampered history is rejected before the active package can be replaced.
test('UnitT30_tampered-active-data-fails-before-any-recovery-write', { skip: !inputRootsReady }, async t => {
  const { activeRoot, proofPath } = await createWorkspace(t);
  const activeReceipt = await readReceipt(activeRoot);
  const changedRow = activeReceipt.files.find(row => row.path.startsWith('data/'));
  const changedPath = path.join(activeRoot, ...changedRow.path.split('/'));
  const originalBytes = await readFile(changedPath);
  const tamperedBytes = Buffer.from(originalBytes);
  tamperedBytes[0] ^= 1;
  await writeFile(changedPath, tamperedBytes);
  const tamperedReceiptBytes = await readFile(path.join(activeRoot, 'receipt.json'));

  await assert.rejects(restorePinnedRealR3Preview({ targetRoot: r3SourceRoot, activeRoot, proofPath }), /does not match receipt/);
  assert.deepEqual(await readFile(changedPath), tamperedBytes);
  assert.deepEqual(await readFile(path.join(activeRoot, 'receipt.json')), tamperedReceiptBytes);
  await assert.rejects(verifyW01Package(activeRoot));
});

// Scenario: a file inside the pinned .3 package is replaced by a symbolic link to another file.
// Purpose: reject symlinked package inputs before changing the active .4 package.
test('UnitT40_symlinked-target-file-rejects-before-active-mutation', { skip: !inputRootsReady }, async t => {
  const { root, activeRoot, proofPath } = await createWorkspace(t);
  const symlinkTargetRoot = path.join(root, 'symlink-target');
  await cp(r3SourceRoot, symlinkTargetRoot, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  const receipt = await readReceipt(symlinkTargetRoot);
  const row = receipt.files.find(entry => entry.path.startsWith('data/'));
  const filePath = path.join(symlinkTargetRoot, ...row.path.split('/'));
  const externalFile = path.join(symlinkTargetRoot, 'version.json');
  await rm(filePath);
  try {
    await symlink(externalFile, filePath, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip('the local Windows profile does not permit creating a file symlink');
      return;
    }
    throw error;
  }
  const activeReceiptBefore = await readFile(path.join(activeRoot, 'receipt.json'));
  await assert.rejects(restorePinnedRealR3Preview({ targetRoot: symlinkTargetRoot, activeRoot, proofPath }), /symbolic link|does not match receipt/);
  assert.deepEqual(await readFile(path.join(activeRoot, 'receipt.json')), activeReceiptBefore);
  await verifyW01Package(activeRoot);
});

// Scenario: the staging-to-active rename fails after the verified .4 directory has been moved to a backup.
// Purpose: restore the original .4 output and leave it verifiable rather than losing the only restorable package.
test('UnitT50_failed-stage-replacement-restores-active-r4', { skip: !inputRootsReady }, async t => {
  const { activeRoot, proofPath } = await createWorkspace(t);
  const activeReceiptBefore = await readFile(path.join(activeRoot, 'receipt.json'));
  let calls = 0;
  const renameImpl = async (from, to) => {
    calls += 1;
    if (calls === 2) throw new Error('injected staging replacement failure');
    const { rename } = await import('node:fs/promises');
    return rename(from, to);
  };

  await assert.rejects(restorePinnedRealR3Preview({ targetRoot: r3SourceRoot, activeRoot, proofPath, renameImpl }), /injected staging replacement failure/);
  assert.equal(calls, 3);
  assert.deepEqual(await readFile(path.join(activeRoot, 'receipt.json')), activeReceiptBefore);
  await verifyW01Package(activeRoot);
});
