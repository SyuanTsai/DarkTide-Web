import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildW01, verifyW01Package } from '../scripts/w01-build.mjs';
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

// Scenario: CI starts empty, rebuilds exact R1 and baseline, builds R2, then runs the fixed R1 helper over a verified R2 output.
// Purpose: prove R1/R2/baseline immutable URLs survive and the helper accepts only the exact R2 receipt identity.
test('UnitT41_r1-r2-fixed-rollback-helper-retains-all-data-revisions', {
  skip: !process.env.W01_PRIOR_R1_ROOT || !process.env.W01_BASELINE_ROOT
}, async t => {
  const priorR1Root = path.resolve(process.env.W01_PRIOR_R1_ROOT);
  const baselineRoot = path.resolve(process.env.W01_BASELINE_ROOT);
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'w01-r1-r2-lifecycle-'));
  const selectorRoot = await mkdtemp(path.join(os.tmpdir(), 'w01-r1-rollback-selector-'));
  t.after(async () => {
    await rm(outputRoot, { recursive: true, force: true });
    await rm(selectorRoot, { recursive: true, force: true });
  });

  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: priorR1Root, encoding: 'utf8' }).trim(), pinnedR1.commit);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baselineRoot, encoding: 'utf8' }).trim(), '8a4b3db2b1e835f0757f387ca89a19b9092b35ee');

  const r1Builder = await import(pathToFileURL(path.join(priorR1Root, 'scripts', 'w01-build.mjs')).href);
  const r1Retainer = await import(pathToFileURL(path.join(priorR1Root, 'scripts', 'w01-retain-baseline.mjs')).href);
  const currentRetainer = await import('../scripts/w01-retain-baseline.mjs');

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

  await buildW01({ repoRoot: webRoot, outputRoot });
  await currentRetainer.retainPinnedBaseline({ baselineRoot, outputRoot });
  await verifyW01Package(outputRoot);
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
  await verifyW01Package(outputRoot);

  await writeFile(selectorPath, JSON.stringify(selector));

  const wrongExpectedCommit = '0'.repeat(40);
  const beforeRejectedRollback = await readFile(path.join(outputRoot, 'receipt.json'));
  await assert.rejects(rollbackToPinnedR1({
    webRoot: selectorRoot, expectedR2Commit: wrongExpectedCommit, sourceRoot: priorR1Root, baselineRoot, outputRoot
  }), /exact published R2 commit/);
  assert.deepEqual(await readFile(path.join(outputRoot, 'receipt.json')), beforeRejectedRollback);
  await verifyW01Package(outputRoot);

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
  await verifyW01Package(outputRoot);
  const restoredReceipt = await readJson(path.join(outputRoot, 'receipt.json'));
  assert.equal(restoredReceipt.contentVersion, pinnedR1.contentVersion);
  assert.equal(restoredReceipt.dataRevision, pinnedR1.dataRevision);
  assert.equal(restoredReceipt.buildId, pinnedR1.buildId);
  assert.equal(restoredReceipt.manifestSha256, pinnedR1.manifestSha256);
  assertRowsPreserved(r1Rows, restoredReceipt);
  assertRowsPreserved(baselineRows, restoredReceipt);
  assertRowsPreserved(r2Rows, restoredReceipt);
});
