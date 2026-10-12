import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalize, validateReleaseManifest } from '../src/release/manifest.mjs';
import { createReleaseDraft } from '../src/release/build.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const source = id => ({ source_id: id, schema_version: 1, sha256: 'a'.repeat(64) });
const right = id => ({ rights_id: id, schema_version: 1, publish: { status: 'approved' } });
const input = () => ({
  files: new Map([
    ['index.html', '<h1>繁體</h1>'],
    ['assets/icon.webp', new Uint8Array([0, 1, 255])],
    ['assets/site.css', 'body{}']
  ]),
  workerBytes: new TextEncoder().encode('export default {};'),
  sourceLocks: [source('source-b'), source('source-a')],
  rightsLedger: [right('right-b'), right('right-a')],
  taxonomySha256: 'b'.repeat(64),
  fieldRequirementSha256: 'c'.repeat(64),
  toolCommitSha: 'd'.repeat(40)
});

// Scenario: A renderer supplies HTML, CSS, image, Worker, and evidence snapshots.
// Purpose: Derive manifest bytes and digests from the actual supplied artifacts in stable order.
test('UnitT10_builds_draft_manifest_from_raw_artifact_bytes', async () => {
  const args = input();
  const manifest = await createReleaseDraft(args);
  assert.equal(manifest.validation.complete, false);
  assert.deepEqual(manifest.files.map(file => file.path), ['assets/icon.webp', 'assets/site.css', 'index.html']);
  assert.deepEqual(manifest.source_lock_ids, ['source-a', 'source-b']);
  assert.deepEqual(manifest.files[0], {
    path: 'assets/icon.webp', raw_bytes: 3, sha256: digest(new Uint8Array([0, 1, 255])), content_type: 'image/webp'
  });
  assert.equal(manifest.worker.sha256, digest(args.workerBytes));
  assert.equal(manifest.source_lock_digest, digest(canonicalize([source('source-a'), source('source-b')])));
  assert.equal(manifest.rights_ledger_digest, digest(canonicalize([right('right-a'), right('right-b')])));
  assert.equal(manifest.totals.raw_bytes, manifest.files.reduce((sum, file) => sum + file.raw_bytes, 0));
  assert.match(manifest.release_id, /^sha256:[a-f0-9]{64}$/);
  await assert.rejects(() => validateReleaseManifest(manifest, manifest.release_id), /validation.*incomplete/i);
});

// Scenario: Identical artifacts and evidence arrive in a different iteration order.
// Purpose: Preserve the release identity across ordering differences.
test('UnitT20_keeps_draft_identity_deterministic_across_input_order', async () => {
  const first = input();
  const second = input();
  second.files = new Map([...second.files].reverse());
  second.sourceLocks.reverse();
  second.rightsLedger.reverse();
  assert.deepEqual(await createReleaseDraft(first), await createReleaseDraft(second));
});

// Scenario: A source snapshot repeats an identity or a rendered file has an unsafe path.
// Purpose: Reject ambiguous or escaping inputs before a release ID is issued.
test('UnitT30_rejects_ambiguous_snapshot_and_unsafe_output_path', async () => {
  const duplicate = input();
  duplicate.sourceLocks.push(source('source-a'));
  await assert.rejects(() => createReleaseDraft(duplicate), /duplicate.*source/i);
  const unsafe = input();
  unsafe.files.set('../leak.html', 'secret');
  await assert.rejects(() => createReleaseDraft(unsafe), /path/i);
});

// Scenario: A caller changes raw image bytes just after invoking the asynchronous builder.
// Purpose: Make the manifest describe the input snapshot rather than later mutation.
test('UnitT40_hashes_a_stable_snapshot_of_mutable_bytes', async () => {
  const args = input();
  const original = new Uint8Array(args.files.get('assets/icon.webp'));
  const building = createReleaseDraft(args);
  args.files.get('assets/icon.webp')[0] = 99;
  args.workerBytes[0] = 99;
  const manifest = await building;
  assert.equal(manifest.files[0].sha256, digest(original));
  assert.equal(manifest.worker.sha256, digest(new TextEncoder().encode('export default {};')));
});

// Scenario: A required identity digest or Worker byte stream is malformed.
// Purpose: Stop a draft whose identity inputs cannot form a valid release manifest.
test('UnitT50_rejects_missing_or_malformed_identity_inputs', async () => {
  const malformed = input();
  malformed.taxonomySha256 = 'pending';
  await assert.rejects(() => createReleaseDraft(malformed), /hash/i);
  const noWorker = input();
  noWorker.workerBytes = null;
  await assert.rejects(() => createReleaseDraft(noWorker), /Worker bundle/i);
});
