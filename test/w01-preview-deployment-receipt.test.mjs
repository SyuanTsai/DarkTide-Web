import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDeploymentReceipt } from '../scripts/w01-preview-deployment-receipt.mjs';
import { buildW01 } from '../scripts/w01-build.mjs';
import { jsonBytes } from '../src/static/common.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Scenario: a deployed preview serves the local versioned package and one pinned old data URL.
// Purpose: the receipt is written only when remote bytes, noindex, CORS, and retained URL checks pass.
test('UnitT00_deployment-receipt-verifies-version-domains-and-retained-url', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-deploy-receipt-'));
  try {
    const copiedRoot = path.join(tempRoot, 'repo');
    const outputRoot = path.join(tempRoot, 'dist-w01');
    const fixtureRoot = path.join(repoRoot, 'test', 'fixtures', 'w01');
    await cp(path.join(fixtureRoot, 'content', 'w01'), path.join(copiedRoot, 'content', 'w01'), { recursive: true });
    await cp(path.join(fixtureRoot, 'source.lock.json'), path.join(copiedRoot, 'source.lock.json'));
    const build = await buildW01({ repoRoot: copiedRoot, outputRoot });
    const versionBytes = await readFile(path.join(outputRoot, 'version.json'));
    const version = JSON.parse(versionBytes);
    const manifestPath = path.join(outputRoot, ...version.game_releases[0].manifest_path.slice(1).split('/'));
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes);

    const oldBytes = Buffer.from('pinned old preview data');
    const oldRevision = 'a'.repeat(64);
    const oldRow = { path: 'data/' + oldRevision + '/old.json', sizeBytes: oldBytes.byteLength, sha256: sha256(oldBytes) };
    const retainedManifest = {
      schemaVersion: '1.0.0', baselineCommit: 'f'.repeat(40), dataRevision: oldRevision,
      fileCount: 1, totalBytes: oldBytes.byteLength, files: [oldRow]
    };
    await mkdir(path.join(copiedRoot, 'docs', 'w01'), { recursive: true });
    await writeFile(path.join(copiedRoot, 'docs', 'w01', 'retained-preview-manifest.json'), jsonBytes(retainedManifest));
    const oldPath = path.join(outputRoot, ...oldRow.path.split('/'));
    await mkdir(path.dirname(oldPath), { recursive: true });
    await writeFile(oldPath, oldBytes);
    const buildReceiptPath = path.join(outputRoot, 'receipt.json');
    const buildReceipt = JSON.parse(await readFile(buildReceiptPath, 'utf8'));
    buildReceipt.files.push(oldRow);
    buildReceipt.files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    buildReceipt.retainedData = {
      baselineCommit: retainedManifest.baselineCommit,
      dataRevision: oldRevision,
      fileCount: retainedManifest.fileCount,
      totalBytes: retainedManifest.totalBytes,
      inventorySha256: sha256(jsonBytes(retainedManifest))
    };
    await writeFile(buildReceiptPath, jsonBytes(buildReceipt));

    const objects = new Map([
      ['/version.json', versionBytes],
      [version.game_releases[0].manifest_path, manifestBytes],
      ['/' + oldRow.path, oldBytes]
    ]);
    for (const file of manifest.files) {
      objects.set('/data/' + build.dataRevision + '/' + file.path,
        await readFile(path.join(outputRoot, 'data', build.dataRevision, file.path)));
    }
    const fetchImpl = async url => new Response(objects.get(new URL(url).pathname) ?? new Uint8Array(), {
      status: objects.has(new URL(url).pathname) ? 200 : 404,
      headers: { 'access-control-allow-origin': '*', 'x-robots-tag': 'noindex, noarchive' }
    });
    const receiptPath = path.join(tempRoot, 'deployment-receipt.json');
    const result = await createDeploymentReceipt({
      repoRoot: copiedRoot, outputRoot, receiptPath, fetchImpl, createdAt: '2026-10-13T00:00:00.000Z'
    });
    assert.equal(result.requestKind, 'w01-preview-deployment-receipt');
    assert.equal(result.contentVersion, '0.0.2');
    assert.equal(result.verifiedRemoteObjects, 8);
    assert.equal(result.retainedBaseline.sampleSha256, oldRow.sha256);
    assert.equal(JSON.parse(await readFile(receiptPath, 'utf8')).deploymentPerformed, true);

    const missingHeadersFetch = async url => new Response(objects.get(new URL(url).pathname), {
      status: 200, headers: { 'x-robots-tag': 'noindex' }
    });
    await assert.rejects(
      createDeploymentReceipt({ repoRoot: copiedRoot, outputRoot, receiptPath: path.join(tempRoot, 'bad.json'), fetchImpl: missingHeadersFetch }),
      /CORS response header/
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// Scenario: the current non-fixture W01 candidate is deployed only to the isolated preview worker.
// Purpose: the receipt accepts the exact pending-preview flag combination and rejects mixed or missing mode flags before network access.
test('UnitT01_deployment-receipt-verifies-native-pending-candidate-and-quarantine-flags', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-native-deploy-receipt-'));
  try {
    const copiedRoot = path.join(tempRoot, 'repo');
    const outputRoot = path.join(tempRoot, 'dist-w01');
    await cp(path.join(repoRoot, 'content', 'w01'), path.join(copiedRoot, 'content', 'w01'), { recursive: true });
    await cp(path.join(repoRoot, 'source.lock.json'), path.join(copiedRoot, 'source.lock.json'));
    const build = await buildW01({ repoRoot: copiedRoot, outputRoot, mode: 'candidate-preview' });
    const versionBytes = await readFile(path.join(outputRoot, 'version.json'));
    const version = JSON.parse(versionBytes);
    const manifestPath = path.join(outputRoot, ...version.game_releases[0].manifest_path.slice(1).split('/'));
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes);

    const oldBytes = Buffer.from('pinned old preview data');
    const oldRevision = 'b'.repeat(64);
    const oldRow = { path: 'data/' + oldRevision + '/old.json', sizeBytes: oldBytes.byteLength, sha256: sha256(oldBytes) };
    const retainedManifest = {
      schemaVersion: '1.0.0', baselineCommit: 'e'.repeat(40), dataRevision: oldRevision,
      fileCount: 1, totalBytes: oldBytes.byteLength, files: [oldRow]
    };
    await mkdir(path.join(copiedRoot, 'docs', 'w01'), { recursive: true });
    await writeFile(path.join(copiedRoot, 'docs', 'w01', 'retained-preview-manifest.json'), jsonBytes(retainedManifest));
    const oldPath = path.join(outputRoot, ...oldRow.path.split('/'));
    await mkdir(path.dirname(oldPath), { recursive: true });
    await writeFile(oldPath, oldBytes);
    const buildReceiptPath = path.join(outputRoot, 'receipt.json');
    const buildReceipt = JSON.parse(await readFile(buildReceiptPath, 'utf8'));
    buildReceipt.files.push(oldRow);
    buildReceipt.files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    buildReceipt.retainedData = {
      baselineCommit: retainedManifest.baselineCommit,
      dataRevision: oldRevision,
      fileCount: retainedManifest.fileCount,
      totalBytes: retainedManifest.totalBytes,
      inventorySha256: sha256(jsonBytes(retainedManifest))
    };
    await writeFile(buildReceiptPath, jsonBytes(buildReceipt));

    const objects = new Map([
      ['/version.json', versionBytes],
      [version.game_releases[0].manifest_path, manifestBytes],
      ['/' + oldRow.path, oldBytes]
    ]);
    for (const file of manifest.files) {
      objects.set('/data/' + build.dataRevision + '/' + file.path,
        await readFile(path.join(outputRoot, 'data', build.dataRevision, file.path)));
    }
    let fetchCount = 0;
    const fetchImpl = async url => {
      fetchCount += 1;
      return new Response(objects.get(new URL(url).pathname) ?? new Uint8Array(), {
        status: objects.has(new URL(url).pathname) ? 200 : 404,
        headers: { 'access-control-allow-origin': '*', 'x-robots-tag': 'noindex, noarchive' }
      });
    };
    const receiptPath = path.join(tempRoot, 'deployment-receipt.json');
    const result = await createDeploymentReceipt({
      repoRoot: copiedRoot, outputRoot, receiptPath, fetchImpl, createdAt: '2026-10-14T00:00:00.000Z'
    });
    assert.equal(result.requestKind, 'w01-preview-deployment-receipt');
    assert.equal(result.contentVersion, '0.0.9');
    assert.equal(result.packageKind, 'pending-preview');
    assert.equal(result.candidatePreviewOnly, true);
    assert.equal(result.verifiedRemoteObjects, 8);
    assert.equal(result.retainedBaseline.sampleSha256, oldRow.sha256);
    assert.equal(JSON.parse(await readFile(receiptPath, 'utf8')).deploymentPerformed, true);

    const validReceipt = JSON.parse(await readFile(buildReceiptPath, 'utf8'));
    const invalidModes = [
      { ...validReceipt, fixtureOnly: true },
      { ...validReceipt, candidatePreviewOnly: false },
      Object.fromEntries(Object.entries(validReceipt).filter(([key]) => key !== 'candidatePreviewOnly'))
    ];
    for (const invalidReceipt of invalidModes) {
      await writeFile(buildReceiptPath, jsonBytes(invalidReceipt));
      fetchCount = 0;
      await assert.rejects(
        createDeploymentReceipt({ repoRoot: copiedRoot, outputRoot, receiptPath: path.join(tempRoot, 'invalid.json'), fetchImpl }),
        /quarantined preview build/
      );
      assert.equal(fetchCount, 0, 'an invalid preview mode must be rejected before fetching remote objects');
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
