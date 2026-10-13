import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyCompositionRequest } from '../scripts/w01-compose-source.mjs';
import { jsonBytes } from '../src/static/common.mjs';

const sourceRepository = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function withTempRoots(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-compose-'));
  const sourceRoot = path.join(root, 'Source');
  const webRoot = path.join(root, 'Web');
  try {
    await callback({ root, sourceRoot, webRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeSourceSnapshot(sourceRoot, sourceRevision = 'a'.repeat(64)) {
  const revisionRoot = path.join(sourceRoot, 'dist-w01', 'source', sourceRevision);
  await mkdir(revisionRoot, { recursive: true });
  const technical = jsonBytes({ fixtureOnly: true, records: [], sourceRevision });
  const changes = jsonBytes({ changes: [], fixtureOnly: true, sourceRevision });
  const sourceManifest = {
    schemaVersion: '1.0.0',
    gameReleaseId: 'fixture-game-1',
    gameVersion: 'fixture-preview',
    sourceRevision,
    fixtureOnly: true,
    publicationEligible: false,
    files: [
      { path: 'technical.json', sizeBytes: technical.byteLength, sha256: sha256(technical) },
      { path: 'game-changes.json', sizeBytes: changes.byteLength, sha256: sha256(changes) }
    ]
  };
  const manifestBytes = jsonBytes(sourceManifest);
  await writeFile(path.join(revisionRoot, 'source-manifest.json'), manifestBytes);
  await writeFile(path.join(revisionRoot, 'technical.json'), technical);
  await writeFile(path.join(revisionRoot, 'game-changes.json'), changes);
  return {
    request: {
      repository: sourceRepository,
      commit: '2c1e26ecde70773fc2588a8a70baba9a28770586',
      sourceRevision,
      manifestSha256: sha256(manifestBytes)
    },
    technical,
    changes,
    manifestBytes
  };
}

// Scenario: the same Source request is consumed more than once on the same W01 candidate branch.
// Purpose: the first run imports exactly the pinned bytes and the replay is a no-op with the same idempotency key.
test('UnitT10_composition-request-import-is-pinned-and-idempotent', async () => {
  await withTempRoots(async ({ sourceRoot, webRoot }) => {
    const source = await writeSourceSnapshot(sourceRoot);
    const first = await applyCompositionRequest({ request: source.request, sourceRoot, webRoot, verifyCheckout: false });
    const second = await applyCompositionRequest({ request: source.request, sourceRoot, webRoot, verifyCheckout: false });
    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(first.requestId, second.requestId);
    assert.equal(first.candidateBranch, 'codex/SYP-311-w01');
    assert.deepEqual(await readFile(path.join(webRoot, 'content', 'w01', 'source', 'technical.json')), source.technical);
    assert.deepEqual(await readFile(path.join(webRoot, 'content', 'w01', 'source', 'game-changes.json')), source.changes);
    const lock = JSON.parse(await readFile(path.join(webRoot, 'source.lock.json'), 'utf8'));
    assert.equal(lock.commit, source.request.commit);
    assert.equal(lock.sourceRevision, source.request.sourceRevision);
    const receipt = JSON.parse(await readFile(path.join(webRoot, 'content', 'w01', 'composition-receipt.json'), 'utf8'));
    assert.equal(receipt.requestId, first.requestId);
    assert.equal(receipt.formalPublishAllowed, false);
  });
});

// Scenario: a pinned technical artifact changes after its Source manifest and request were created.
// Purpose: the consumer fails before writing a Web lock or partial candidate payload.
test('UnitT20_composition-request-rejects-tampered-artifact-before-mutating-web-lock', async () => {
  await withTempRoots(async ({ sourceRoot, webRoot }) => {
    const source = await writeSourceSnapshot(sourceRoot);
    const artifact = path.join(sourceRoot, 'dist-w01', 'source', source.request.sourceRevision, 'technical.json');
    await writeFile(artifact, Buffer.from('tampered'));
    await assert.rejects(
      applyCompositionRequest({ request: source.request, sourceRoot, webRoot, verifyCheckout: false }),
      /manifest hash|does not match pinned manifest/
    );
    await assert.rejects(readFile(path.join(webRoot, 'source.lock.json')), { code: 'ENOENT' });
  });
});

// Scenario: an unknown or private field is added to the Source request.
 // Purpose: request handling accepts only the four public pin fields.
test('UnitT30_composition-request-rejects-extra-request-fields', async () => {
  await withTempRoots(async ({ sourceRoot, webRoot }) => {
    const source = await writeSourceSnapshot(sourceRoot);
    await assert.rejects(
      applyCompositionRequest({ request: { ...source.request, privateProof: 'not-public' }, sourceRoot, webRoot, verifyCheckout: false }),
      /missing or unsupported fields/
    );
  });
});