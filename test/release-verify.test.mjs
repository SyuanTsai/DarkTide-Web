import test from 'node:test';
import assert from 'node:assert/strict';
import { computeReleaseId } from '../src/release/manifest.mjs';
import { createReleaseDraft } from '../src/release/build.mjs';
import { verifyReleaseArtifactBytes } from '../src/release/verify.mjs';

const encoder = new TextEncoder();
const source = { source_id: 'fictional-source', schema_version: 1, sha256: 'a'.repeat(64) };
const right = { rights_id: 'fictional-right', schema_version: 1, publish: { status: 'approved' } };

async function packageInput() {
  const files = new Map([
    ['index.html', '<h1>虛構內容</h1>'],
    ['assets/site.css', 'body{}']
  ]);
  const workerBytes = encoder.encode('export default {};');
  const manifest = await createReleaseDraft({
    files, workerBytes, sourceLocks: [source], rightsLedger: [right],
    taxonomySha256: 'b'.repeat(64), fieldRequirementSha256: 'c'.repeat(64),
    toolCommitSha: 'd'.repeat(40)
  });
  manifest.validation = { complete: true, checks: ['assets-v1', 'content-v1', 'rights-v1', 'routes-v1'] };
  manifest.release_id = await computeReleaseId(manifest);
  return {
    manifestBytes: encoder.encode(JSON.stringify(manifest)), files, workerBytes,
    expectedReleaseId: manifest.release_id
  };
}

// Scenario: A complete fictional manifest names every supplied static object and the Worker bundle.
// Purpose: Verify the exact bytes of the package before any future upload step can use it.
test('UnitT10_accepts_matching_release_artifact_bytes', async () => {
  const input = await packageInput();
  const result = await verifyReleaseArtifactBytes(input);
  assert.deepEqual(result, {
    release_id: input.expectedReleaseId, file_count: 2,
    raw_bytes: [...input.files.values()].reduce((sum, value) => sum + encoder.encode(value).byteLength, 0),
    worker_sha256: JSON.parse(new TextDecoder().decode(input.manifestBytes)).worker.sha256
  });
});

// Scenario: One listed object is absent or an unlisted object is present.
// Purpose: Prevent incomplete or mixed release prefixes from passing the local artifact check.
test('UnitT20_rejects_missing_or_extra_static_object', async () => {
  const missing = await packageInput();
  missing.files.delete('assets/site.css');
  await assert.rejects(() => verifyReleaseArtifactBytes(missing), /missing.*assets\/site\.css/i);
  const extra = await packageInput();
  extra.files.set('assets/extra.css', 'body{}');
  await assert.rejects(() => verifyReleaseArtifactBytes(extra), /extra.*assets\/extra\.css/i);
});

// Scenario: A listed file or the Worker bundle differs from the manifest's byte inventory.
// Purpose: Refuse a content-addressed release when any deployable artifact was changed.
test('UnitT30_rejects_changed_static_or_worker_bytes', async () => {
  const changedFile = await packageInput();
  changedFile.files.set('index.html', '<h1>變更</h1>');
  await assert.rejects(() => verifyReleaseArtifactBytes(changedFile), /index\.html.*mismatch/i);
  const changedWorker = await packageInput();
  changedWorker.workerBytes[0] = 0;
  await assert.rejects(() => verifyReleaseArtifactBytes(changedWorker), /worker.*mismatch/i);
});

// Scenario: A draft manifest is supplied with matching artifact bytes.
// Purpose: Keep byte integrity separate from the full approval needed to deploy a release.
test('UnitT40_rejects_incomplete_release_validation', async () => {
  const input = await packageInput();
  const manifest = JSON.parse(new TextDecoder().decode(input.manifestBytes));
  manifest.validation.complete = false;
  input.manifestBytes = encoder.encode(JSON.stringify(manifest));
  await assert.rejects(() => verifyReleaseArtifactBytes(input), /validation.*incomplete/i);
});

// Scenario: The caller mutates a supplied byte array after starting asynchronous verification.
// Purpose: Verify a stable snapshot instead of a mixture of values from different moments.
test('UnitT50_snapshots_mutable_artifact_bytes_before_hashing', async () => {
  const input = await packageInput();
  input.files.set('index.html', encoder.encode(input.files.get('index.html')));
  const verifying = verifyReleaseArtifactBytes(input);
  input.files.get('index.html')[0] = 0;
  input.workerBytes[0] = 0;
  input.manifestBytes[0] = 0;
  await assert.doesNotReject(() => verifying);
});
