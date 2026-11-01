import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { retainedNameInputsRequired } from '../scripts/content/retained-name-overlay-scan.mjs';

const HEAD = 'a'.repeat(40);
const OVERLAY_COMMIT = 'b'.repeat(40);
const W08_LOCK_PATH = 'content/contracts/w08/compiler-inputs.lock.json';
const W07_PATH = 'content/authoring/v2/w07-weapons.json';
const SELECTED_PATH = 'content/contracts/w09/source-handoff/selected.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = character => character.repeat(64);
const commit = character => character.repeat(40);
const asBytes = value => Buffer.from(JSON.stringify(value) + '\n');

function makeFixture({ baseHasRetainedName = false, overlayHasRetainedName = false, tamperOverlayPin = false } = {}) {
  const baseAuthoringBytes = asBytes({
    presentations: [{ name: 'Base weapon', ...(baseHasRetainedName ? { retainedName: { name: 'old name' } } : {}) }],
  });
  const overlayBytes = asBytes({
    presentations: [{ name: 'Overlay weapon', ...(overlayHasRetainedName ? { retainedName: { name: 'old name' } } : {}) }],
  });
  const gameReleaseId = 'darktide:1.13.4';
  const sourceRevision = digest('c');
  const releaseId = 'w09-' + createHash('sha256')
    .update(JSON.stringify({ gameReleaseId, sourceRevision }))
    .digest('hex').slice(0, 32);
  const requestId = digest('d');
  const manifestSha256 = digest('e');
  const archiveSha256 = digest('f');
  const packetPaths = ['analysis.md', 'source-revision.json', 'source-revision.md', 'source-manifest.json', 'source-receipt.json', 'technical.json'];
  const packetFiles = packetPaths.map((packetPath, index) => ({ path: packetPath, sha256: digest(String(index + 1)), sizeBytes: index + 1 }));
  const selected = {
    schema: 'w09-selected-composition/1',
    repository: 'SyuanTsai/DarkTide-Web',
    sourceRevision,
    proposals: [{ gameReleaseId, releaseId, requestId, manifestSha256, archiveSha256 }],
  };
  const overlayPath = 'content/contracts/w09/authoring-overlays/w07/authoring/' + digest('7') + '.json';
  const lock = {
    schema: 'w09-web-inputs-lock/1',
    repository: 'https://github.com/SyuanTsai/DarkTide-Web',
    source: {
      releaseId,
      requestId,
      sourceCommit: commit('1'),
      sourceRevision,
      manifestSha256,
      archiveSha256,
      packetFiles,
    },
    web: {
      w08InputLockSha256: digest('2'),
      w08CompilerLockSha256: digest('3'),
      w08AuthoringCommit: commit('4'),
      w08CompilerCommit: commit('5'),
      w09CompilerLockSha256: digest('6'),
      compilerFileSetSha256: digest('8'),
      compilerCommit: commit('9'),
      overlayCommit: OVERLAY_COMMIT,
      authoringCommit: OVERLAY_COMMIT,
    },
    gameReleaseId,
    authoringOverlay: [{
      mode: 'w07', target: 'authoring', path: overlayPath,
      sizeBytes: overlayBytes.byteLength,
      sha256: tamperOverlayPin ? digest('0') : sha256(overlayBytes),
    }],
  };
  const baseInputLock = {
    schemaVersion: 'w08-compiler-inputs/1',
    inputFiles: [{ path: W07_PATH, sizeBytes: baseAuthoringBytes.byteLength, sha256: sha256(baseAuthoringBytes) }],
  };
  const blobs = new Map([
    [`${HEAD}:${W08_LOCK_PATH}`, asBytes(baseInputLock)],
    [`${HEAD}:${W07_PATH}`, baseAuthoringBytes],
    [`${HEAD}:${SELECTED_PATH}`, asBytes(selected)],
    [`${HEAD}:content/contracts/w09/source-handoff/locks/${requestId}.json`, asBytes(lock)],
    [`${OVERLAY_COMMIT}:${overlayPath}`, overlayBytes],
  ]);
  return {
    readBlob(revision, relativePath, { allowMissing = false } = {}) {
      const bytes = blobs.get(`${revision}:${relativePath}`);
      if (bytes) return Buffer.from(bytes);
      if (allowMissing) return null;
      throw new Error('fixture Git blob missing: ' + revision + ':' + relativePath);
    },
    selected,
    lock,
    overlayBytes,
  };
}

function scan(fixture) {
  return retainedNameInputsRequired({ repoRoot: process.cwd(), revision: HEAD, readBlob: fixture.readBlob });
}

// Scenario: neither the fixed W07 base authoring nor selected W07 overlay uses retainedName.
// Purpose: allow existing selected release replay without acquiring extra public upstream checkouts.
test('UnitT10_ScenarioSelectedCompositionHasNoRetainedNames_PurposeNeedsNoUpstreamRoots', () => {
  assert.equal(scan(makeFixture()), false);
});

// Scenario: a retained name appears only in the exact pinned W07 overlay.
// Purpose: require both pinned provenance roots for this composition.
test('UnitT20_ScenarioSelectedOverlayContainsRetainedName_PurposeRequiresPinnedRoots', () => {
  assert.equal(scan(makeFixture({ overlayHasRetainedName: true })), true);
});

// Scenario: a new W09 Source proposal will consume the current W08-pinned W07 base even though the old selection has no retained name.
// Purpose: decide on provenance roots from the new candidate's actual base input, not only from existing selected releases.
test('UnitT30_ScenarioNewSourceProposalHasRetainedBaseAuthoring_PurposeRequiresPinnedRoots', () => {
  assert.equal(scan(makeFixture({ baseHasRetainedName: true })), true);
});

// Scenario: selected overlay bytes do not match the immutable lock row.
// Purpose: fail closed instead of skipping checkouts on unverified selection data.
test('UnitT40_ScenarioSelectedOverlayPinMismatch_PurposeFailsClosed', () => {
  assert.throws(() => scan(makeFixture({ tamperOverlayPin: true })), /differs from its exact pinned Git bytes/u);
});
