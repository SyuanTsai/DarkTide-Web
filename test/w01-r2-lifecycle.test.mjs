import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { verifyW01Package } from '../scripts/w01-build.mjs';
import { createDeploymentReceipt } from '../scripts/w01-preview-deployment-receipt.mjs';
import { rollbackToPinnedR1 } from '../scripts/w01-rollback-r1.mjs';

const webRoot = path.resolve(import.meta.dirname, '..');
const pinnedR1 = {
  commit: '872bd72bad255d40af62329b8ffe97a357935275',
  contentVersion: '0.0.1',
  dataRevision: 'ac4e659408e9be4c1e56226f2fecdbf9b1bd033b8f0e2d7f2ef52be0aa821701',
  buildId: '39c6ed446f9d526774d0404cf852042ffc2ffd38eb3ca8f4306088d070bf7265',
  manifestSha256: '368451efd002e16c1ce068643bc1cac8bb7a90b51d7200f31d68aaaf07e189f7',
  baselineRevision: '0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b'
};
const publishedR2 = {
  commit: 'a7fabea66f56cd5c8236b6e84a3f6c6586175840',
  contentVersion: '0.0.2',
  dataRevision: '954cbfaec4340d6237913c0edae39967ff28c55fee7b372bc74367a95a85d292',
  buildId: '1aea7c152c5383457f7b87e38f7c840bc7fa92cf3c9276fb18214d29ad790023',
  manifestSha256: 'c2a17c9d17da123940e1432a957e5ced31be9f2977c3df7530deaacaa5ce361f'
};

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function dataRows(receipt, revision) {
  return receipt.files.filter(row => row.path.startsWith(`data/${revision}/`));
}

function assertRowsPreserved(beforeRows, afterReceipt) {
  const afterRows = new Map(afterReceipt.files.map(row => [row.path, row]));
  for (const row of beforeRows) assert.deepEqual(afterRows.get(row.path), row, `preserved ${row.path}`);
}

async function fetchRollbackOutput(outputRoot, url) {
  const pathname = new URL(url).pathname;
  const filePath = path.join(outputRoot, ...pathname.slice(1).split('/'));
  try {
    return new Response(await readFile(filePath), {
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
        'x-robots-tag': 'noindex, nofollow, noarchive',
        'content-type': 'application/json; charset=utf-8'
      }
    });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return new Response(new Uint8Array(), { status: 404 });
  }
}

// Scenario: the lifecycle's local-package fetch stub serves a JSON artifact to the deployment receipt checker.
// Purpose: keep the test server response consistent with the JSON MIME contract required by the production checker.
test('UnitT40_rollback-output-fetch-declares-JSON-content-type', async t => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'w01-rollback-output-fetch-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  await writeFile(path.join(outputRoot, 'version.json'), '{"schema_version":2}');

  const response = await fetchRollbackOutput(outputRoot, 'https://preview.invalid/version.json');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
});

// Scenario: CI starts empty, rebuilds exact R1 and baseline, builds R2, then runs the fixed R1 helper over a verified R2 output.
// Purpose: prove R1/R2/baseline immutable URLs survive and the helper accepts only the exact R2 receipt identity.
test('UnitT41_r1-r2-fixed-rollback-helper-retains-all-data-revisions', {
  skip: !process.env.W01_PRIOR_R1_ROOT || !process.env.W01_PRIOR_R2_ROOT || !process.env.W01_BASELINE_ROOT
}, async t => {
  const priorR1Root = path.resolve(process.env.W01_PRIOR_R1_ROOT);
  const priorR2Root = path.resolve(process.env.W01_PRIOR_R2_ROOT);
  const baselineRoot = path.resolve(process.env.W01_BASELINE_ROOT);
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'w01-r1-r2-lifecycle-'));
  const selectorRoot = await mkdtemp(path.join(os.tmpdir(), 'w01-r1-rollback-selector-'));
  t.after(async () => {
    await rm(outputRoot, { recursive: true, force: true });
    await rm(selectorRoot, { recursive: true, force: true });
  });

  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: priorR1Root, encoding: 'utf8' }).trim(), pinnedR1.commit);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: priorR2Root, encoding: 'utf8' }).trim(), publishedR2.commit);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baselineRoot, encoding: 'utf8' }).trim(), '8a4b3db2b1e835f0757f387ca89a19b9092b35ee');

  const r1Builder = await import(pathToFileURL(path.join(priorR1Root, 'scripts', 'w01-build.mjs')).href);
  const r1Retainer = await import(pathToFileURL(path.join(priorR1Root, 'scripts', 'w01-retain-baseline.mjs')).href);
  const r2Builder = await import(pathToFileURL(path.join(priorR2Root, 'scripts', 'w01-build.mjs')).href);
  const r2Retainer = await import(pathToFileURL(path.join(priorR2Root, 'scripts', 'w01-retain-baseline.mjs')).href);
  await r1Builder.buildW01({ repoRoot: priorR1Root, outputRoot });
  await r1Retainer.retainPinnedBaseline({ baselineRoot, outputRoot });
  await r1Builder.verifyW01Package(outputRoot);
  const r1Receipt = await readJson(path.join(outputRoot, 'receipt.json'));
  assert.equal(r1Receipt.contentVersion, pinnedR1.contentVersion);
  assert.equal(r1Receipt.dataRevision, pinnedR1.dataRevision);
  assert.equal(r1Receipt.buildId, pinnedR1.buildId);
  assert.equal(r1Receipt.manifestSha256, pinnedR1.manifestSha256);
  const r1Rows = dataRows(r1Receipt, pinnedR1.dataRevision);
  assert.ok(r1Rows.length > 0);
  const baselineRows = dataRows(r1Receipt, pinnedR1.baselineRevision);
  assert.equal(baselineRows.length, 2277);

  await r2Builder.buildW01({ repoRoot: priorR2Root, outputRoot });
  await r2Retainer.retainPinnedBaseline({ baselineRoot, outputRoot });
  await r2Builder.verifyW01Package(outputRoot);
  const r2Receipt = await readJson(path.join(outputRoot, 'receipt.json'));
  assert.equal(r2Receipt.contentVersion, '0.0.2');
  assert.notEqual(r2Receipt.dataRevision, pinnedR1.dataRevision);
  assertRowsPreserved(r1Rows, r2Receipt);
  const r2Rows = dataRows(r2Receipt, r2Receipt.dataRevision);
  assert.ok(r2Rows.length > 0);
  const r2Manifest = await readJson(path.join(outputRoot, ...r2Receipt.manifestPath.split('/')));
  assert.equal(r2Manifest.contentVersion, '0.0.2');
  const r2Skills = await readJson(path.join(outputRoot, 'data', r2Receipt.dataRevision, 'skills.json'));
  const r2Presentation = r2Skills.records.find(record => record.recordId === 'web:presentation:fixture-skill-smite');
  const r2Claim = r2Skills.records.find(record => record.recordId === 'fixture:claim:smite-damage');
  assert.equal(r2Presentation.payload.name, '合成技能示例（修訂2）');
  assert.equal(r2Presentation.payload.official.sourceText, 'Cooldown: 40 seconds.');
  assert.equal(r2Claim.payload.value.decimal, '35');
  assert.equal(r2Claim.payload.value.unit, 's');

  assertRowsPreserved(r1Rows, r2Receipt);
  assertRowsPreserved(baselineRows, r2Receipt);
  const allPriorDataRows = r2Receipt.files.filter(row => row.path.startsWith('data/'));
  const selector = {
    schemaVersion: '1.0.0',
    targetCommit: pinnedR1.commit,
    contentVersion: pinnedR1.contentVersion,
    dataRevision: pinnedR1.dataRevision,
    buildId: pinnedR1.buildId,
    manifestSha256: pinnedR1.manifestSha256
  };
  const selectorPath = path.join(selectorRoot, 'content', 'w01', 'rollback.json');
  await mkdir(path.dirname(selectorPath), { recursive: true });
  await writeFile(selectorPath, JSON.stringify({ ...selector, targetCommit: '8a4b3db2b1e835f0757f387ca89a19b9092b35ee' }));
  await assert.rejects(rollbackToPinnedR1({
    webRoot: selectorRoot,
    expectedR2Commit: r2Receipt.web.authoringCommit,
    sourceRoot: priorR1Root,
    baselineRoot,
    outputRoot
  }), /exact fixed R1 package/);
  await r2Builder.verifyW01Package(outputRoot);

  await writeFile(selectorPath, JSON.stringify(selector));

  const wrongExpectedCommit = '0'.repeat(40);
  const beforeRejectedRollback = await readFile(path.join(outputRoot, 'receipt.json'));
  await assert.rejects(rollbackToPinnedR1({
    webRoot: selectorRoot, expectedR2Commit: wrongExpectedCommit, sourceRoot: priorR1Root, baselineRoot, outputRoot
  }), /exact published R2 commit/);
  assert.deepEqual(await readFile(path.join(outputRoot, 'receipt.json')), beforeRejectedRollback);
  await r2Builder.verifyW01Package(outputRoot);

  const rollbackReceipt = await rollbackToPinnedR1({
    webRoot: selectorRoot,
    expectedR2Commit: r2Receipt.web.authoringCommit,
    sourceRoot: priorR1Root,
    baselineRoot,
    outputRoot
  });
  assert.equal(rollbackReceipt.deploymentPerformed, false);
  assert.equal(rollbackReceipt.previousContentVersion, '0.0.2');
  assert.equal(rollbackReceipt.previousWebCommit, r2Receipt.web.authoringCommit);
  assert.equal(rollbackReceipt.preservedPriorDataFileCount, allPriorDataRows.length);
  await r1Builder.verifyW01Package(outputRoot);
  const restoredReceipt = await readJson(path.join(outputRoot, 'receipt.json'));
  assert.equal(restoredReceipt.contentVersion, pinnedR1.contentVersion);
  assert.equal(restoredReceipt.dataRevision, pinnedR1.dataRevision);
  assert.equal(restoredReceipt.buildId, pinnedR1.buildId);
  assert.equal(restoredReceipt.manifestSha256, pinnedR1.manifestSha256);
  assertRowsPreserved(r1Rows, restoredReceipt);
  assertRowsPreserved(baselineRows, restoredReceipt);
  assertRowsPreserved(r2Rows, restoredReceipt);
});

// Scenario: rollback candidate B runs on an empty output, reconstructs the exact public R1 and R2 A packages, then restores R1.
// Purpose: prove a new rollback commit retains the deployed A URLs and baseline URLs without rebuilding A from B's authoring commit.
test('UnitT42_clean-runner-rebuilds-published-a-then-restores-fixed-r1-with-all-urls', {
  skip: !process.env.W01_PRIOR_R1_ROOT || !process.env.W01_PRIOR_R2_ROOT || !process.env.W01_BASELINE_ROOT
}, async t => {
  const priorR1Root = path.resolve(process.env.W01_PRIOR_R1_ROOT);
  const priorR2Root = path.resolve(process.env.W01_PRIOR_R2_ROOT);
  const baselineRoot = path.resolve(process.env.W01_BASELINE_ROOT);
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'w01-r2a-r1b-lifecycle-'));
  const receiptRoot = await mkdtemp(path.join(os.tmpdir(), 'w01-r2a-r1b-deployment-receipt-'));
  t.after(async () => {
    await rm(outputRoot, { recursive: true, force: true });
    await rm(receiptRoot, { recursive: true, force: true });
  });

  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: priorR1Root, encoding: 'utf8' }).trim(), pinnedR1.commit);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: priorR2Root, encoding: 'utf8' }).trim(), publishedR2.commit);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baselineRoot, encoding: 'utf8' }).trim(), '8a4b3db2b1e835f0757f387ca89a19b9092b35ee');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: priorR2Root, encoding: 'utf8' }).trim(), '');

  const r1Builder = await import(pathToFileURL(path.join(priorR1Root, 'scripts', 'w01-build.mjs')).href);
  const r1Retainer = await import(pathToFileURL(path.join(priorR1Root, 'scripts', 'w01-retain-baseline.mjs')).href);
  const r2Builder = await import(pathToFileURL(path.join(priorR2Root, 'scripts', 'w01-build.mjs')).href);
  const r2Retainer = await import(pathToFileURL(path.join(priorR2Root, 'scripts', 'w01-retain-baseline.mjs')).href);

  await r1Builder.buildW01({ repoRoot: priorR1Root, outputRoot });
  await r1Retainer.retainPinnedBaseline({ baselineRoot, outputRoot });
  await r1Builder.verifyW01Package(outputRoot);
  const r1Receipt = await readJson(path.join(outputRoot, 'receipt.json'));
  assert.equal(r1Receipt.contentVersion, pinnedR1.contentVersion);
  assert.equal(r1Receipt.dataRevision, pinnedR1.dataRevision);
  assert.equal(r1Receipt.buildId, pinnedR1.buildId);
  assert.equal(r1Receipt.manifestSha256, pinnedR1.manifestSha256);
  const r1Rows = dataRows(r1Receipt, pinnedR1.dataRevision);
  const baselineRows = dataRows(r1Receipt, pinnedR1.baselineRevision);
  assert.equal(r1Rows.length, 6);
  assert.equal(baselineRows.length, 2277);

  await r2Builder.buildW01({ repoRoot: priorR2Root, outputRoot });
  await r2Retainer.retainPinnedBaseline({ baselineRoot, outputRoot });
  await r2Builder.verifyW01Package(outputRoot);
  const r2Receipt = await readJson(path.join(outputRoot, 'receipt.json'));
  assert.equal(r2Receipt.contentVersion, publishedR2.contentVersion);
  assert.equal(r2Receipt.dataRevision, publishedR2.dataRevision);
  assert.equal(r2Receipt.buildId, publishedR2.buildId);
  assert.equal(r2Receipt.manifestSha256, publishedR2.manifestSha256);
  assert.equal(r2Receipt.web.authoringCommit, publishedR2.commit);
  const r2Rows = dataRows(r2Receipt, publishedR2.dataRevision);
  const allPriorDataRows = r2Receipt.files.filter(row => row.path.startsWith('data/'));
  assert.equal(r2Rows.length, 6);
  assert.equal(allPriorDataRows.length, 2289);
  assertRowsPreserved(r1Rows, r2Receipt);
  assertRowsPreserved(baselineRows, r2Receipt);

  const rollbackReceipt = await rollbackToPinnedR1({
    webRoot,
    expectedR2Commit: publishedR2.commit,
    sourceRoot: priorR1Root,
    baselineRoot,
    outputRoot
  });
  assert.equal(rollbackReceipt.deploymentPerformed, false);
  assert.equal(rollbackReceipt.previousWebCommit, publishedR2.commit);
  assert.equal(rollbackReceipt.previousDataRevision, publishedR2.dataRevision);
  assert.equal(rollbackReceipt.preservedPriorDataFileCount, allPriorDataRows.length);

  await verifyW01Package(outputRoot);
  const restoredReceipt = await readJson(path.join(outputRoot, 'receipt.json'));
  assert.equal(restoredReceipt.contentVersion, pinnedR1.contentVersion);
  assert.equal(restoredReceipt.dataRevision, pinnedR1.dataRevision);
  assert.equal(restoredReceipt.buildId, pinnedR1.buildId);
  assert.equal(restoredReceipt.manifestSha256, pinnedR1.manifestSha256);
  assert.equal(restoredReceipt.web.authoringCommit, pinnedR1.commit);
  assertRowsPreserved(r1Rows, restoredReceipt);
  assertRowsPreserved(r2Rows, restoredReceipt);
  assertRowsPreserved(baselineRows, restoredReceipt);
  assert.equal(restoredReceipt.files.filter(row => row.path.startsWith('data/')).length, 2289);

  const deploymentReceipt = await createDeploymentReceipt({
    repoRoot: webRoot,
    outputRoot,
    receiptPath: path.join(receiptRoot, 'deployment-receipt.json'),
    fetchImpl: url => fetchRollbackOutput(outputRoot, url),
    createdAt: '2026-10-13T00:00:00.000Z'
  });
  assert.equal(deploymentReceipt.contentVersion, pinnedR1.contentVersion);
  assert.equal(deploymentReceipt.dataRevision, pinnedR1.dataRevision);
  assert.equal(deploymentReceipt.verifiedRemoteObjects, 8);
});
