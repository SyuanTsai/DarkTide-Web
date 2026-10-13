import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

async function writeSourceSnapshot(sourceRoot, sourceRevision = 'a'.repeat(64), fixtureOnly = true) {
  const revisionRoot = path.join(sourceRoot, 'dist-w01', 'source', sourceRevision);
  await mkdir(revisionRoot, { recursive: true });
  const gameReleaseId = 'fixture-game-1';
  const technical = jsonBytes({ fixtureOnly, publicationEligible: false, gameReleaseId, records: [], sourceRevision });
  const changes = jsonBytes({ changes: [], fixtureOnly, publicationEligible: false, gameReleaseId, sourceRevision });
  const sourceManifest = {
    schemaVersion: '1.0.0',
    gameReleaseId,
    gameVersion: 'fixture-preview',
    sourceRevision,
    fixtureOnly,
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

// Scenario: a pinned, publication-ineligible non-fixture Source packet contains only pending records.
// Purpose: source composition can stage a real candidate while keeping fixture and publication booleans explicit.
test('UnitT40_composition-request-imports-pending-nonfixture-candidate', async () => {
  await withTempRoots(async ({ sourceRoot, webRoot }) => {
    const source = await writeSourceSnapshot(sourceRoot, 'b'.repeat(64), false);
    const result = await applyCompositionRequest({ request: source.request, sourceRoot, webRoot, verifyCheckout: false });
    const receipt = JSON.parse(await readFile(path.join(webRoot, 'content', 'w01', 'composition-receipt.json'), 'utf8'));
    assert.equal(result.changed, true);
    assert.equal(receipt.fixtureOnly, false);
    assert.equal(receipt.publicationEligible, false);
    assert.equal(receipt.formalPublishAllowed, false);
  });
});

// Scenario: the public Source checkout HEAD matches the request but a tracked authoring/compiler file has local edits.
// Purpose: composition refuses an unverifiable dirty input before writing any Web candidate files.
test('UnitT50_composition-request-rejects-dirty-source-checkout-before-write', async () => {
  await withTempRoots(async ({ sourceRoot, webRoot }) => {
    const source = await writeSourceSnapshot(sourceRoot);
    await writeFile(path.join(sourceRoot, '.gitignore'), 'dist-w01/\n', 'utf8');
    await writeFile(path.join(sourceRoot, 'compile.mjs'), 'export const version = 1;\n', 'utf8');
    execFileSync('git', ['init', '--quiet'], { cwd: sourceRoot });
    execFileSync('git', ['config', 'user.email', 'w01-test@example.invalid'], { cwd: sourceRoot });
    execFileSync('git', ['config', 'user.name', 'W01 Test'], { cwd: sourceRoot });
    execFileSync('git', ['add', '.gitignore', 'compile.mjs'], { cwd: sourceRoot });
    execFileSync('git', ['commit', '--quiet', '-m', 'test pinned public compiler'], { cwd: sourceRoot });
    execFileSync('git', ['remote', 'add', 'origin', sourceRepository], { cwd: sourceRoot });
    source.request.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
    await writeFile(path.join(sourceRoot, 'compile.mjs'), 'export const version = 2;\n', 'utf8');

    await assert.rejects(
      applyCompositionRequest({ request: source.request, sourceRoot, webRoot, verifyCheckout: true }),
      /checkout must be clean/i
    );
    await assert.rejects(readFile(path.join(webRoot, 'source.lock.json')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(webRoot, 'content', 'w01', 'source', 'technical.json')), { code: 'ENOENT' });
  });
});
