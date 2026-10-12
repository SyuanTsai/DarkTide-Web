import test from 'node:test';
import assert from 'node:assert/strict';
import { createReleaseDraft } from '../src/release/build.mjs';
import { computeReleaseId } from '../src/release/manifest.mjs';
import { uploadVerifiedRelease } from '../src/release/upload.mjs';
import worker from '../worker/index.mjs';

const encoder = new TextEncoder();

async function packageInput() {
  const files = new Map([
    ['index.html', '<h1>虛構首頁</h1>'],
    ['assets/site.css', 'body{}']
  ]);
  const workerBytes = encoder.encode('export default {};');
  const manifest = await createReleaseDraft({
    files, workerBytes,
    sourceLocks: [{ source_id: 'fictional-source', sha256: 'a'.repeat(64) }],
    rightsLedger: [{ rights_id: 'fictional-right', publish: { status: 'approved' } }],
    taxonomySha256: 'b'.repeat(64), fieldRequirementSha256: 'c'.repeat(64),
    toolCommitSha: 'd'.repeat(40)
  });
  manifest.validation = { complete: true, checks: ['assets-v1', 'content-v1', 'rights-v1', 'routes-v1'] };
  manifest.release_id = await computeReleaseId(manifest);
  return {
    files, workerBytes, manifestBytes: encoder.encode(JSON.stringify(manifest)),
    expectedReleaseId: manifest.release_id
  };
}

function bucket({ failPutPath = null, corruptReadPath = null } = {}) {
  const objects = new Map();
  const puts = [];
  return {
    objects, puts,
    async get(key) {
      if (!objects.has(key)) return null;
      return {
        async arrayBuffer() {
          const bytes = new Uint8Array(objects.get(key));
          if (key === corruptReadPath) bytes[0] ^= 1;
          return bytes.buffer;
        },
        async text() { return new TextDecoder().decode(objects.get(key)); }
      };
    },
    async put(key, value, options) {
      if (key === failPutPath) throw new Error('R2 put failed');
      assert.equal(options?.onlyIf?.get('If-None-Match'), '*');
      if (objects.has(key)) return null;
      objects.set(key, new Uint8Array(value));
      puts.push(key);
      return { key };
    }
  };
}

// Scenario: The local package is complete and every R2 readback matches its manifest entry.
// Purpose: Write the manifest only after all static objects have been stored and checked.
test('UnitT10_uploads_static_objects_before_manifest_and_reads_back_bytes', async () => {
  const input = await packageInput();
  const store = bucket();
  const receipt = await uploadVerifiedRelease({ ...input, bucket: store });
  const prefix = `releases/${input.expectedReleaseId}/`;
  assert.deepEqual(store.puts, [
    `${prefix}assets/site.css`, `${prefix}index.html`, `${prefix}build-manifest.json`
  ]);
  assert.deepEqual(receipt, {
    release_id: input.expectedReleaseId, file_count: 2, upload_state: 'created'
  });
});

// Scenario: The manifest has not completed release validation.
// Purpose: Reject a draft before any write reaches the R2 boundary.
test('UnitT15_rejects_unapproved_manifest_before_r2_write', async () => {
  const input = await packageInput();
  const manifest = JSON.parse(new TextDecoder().decode(input.manifestBytes));
  manifest.validation.complete = false;
  input.manifestBytes = encoder.encode(JSON.stringify(manifest));
  const store = bucket();
  await assert.rejects(() => uploadVerifiedRelease({ ...input, bucket: store }), /validation.*incomplete/i);
  assert.deepEqual(store.puts, []);
});

// Scenario: The second static object cannot be uploaded.
// Purpose: Leave a partial prefix without a manifest so the Worker cannot select it.
test('UnitT20_does_not_write_manifest_after_partial_upload_failure', async () => {
  const input = await packageInput();
  const prefix = `releases/${input.expectedReleaseId}/`;
  const store = bucket({ failPutPath: `${prefix}index.html` });
  await assert.rejects(() => uploadVerifiedRelease({ ...input, bucket: store }), /R2 put failed/);
  assert.equal(store.objects.has(`${prefix}build-manifest.json`), false);
});

// Scenario: R2 returns bytes that differ from a just-uploaded static object.
// Purpose: Stop before the completion manifest when remote storage fails byte validation.
test('UnitT30_does_not_write_manifest_after_readback_mismatch', async () => {
  const input = await packageInput();
  const prefix = `releases/${input.expectedReleaseId}/`;
  const store = bucket({ corruptReadPath: `${prefix}index.html` });
  await assert.rejects(() => uploadVerifiedRelease({ ...input, bucket: store }), /mismatch/i);
  assert.equal(store.objects.has(`${prefix}build-manifest.json`), false);
});

// Scenario: A previous failed attempt left one correct static object in the release prefix.
// Purpose: Resume without rewriting the existing content-addressed object.
test('UnitT35_resumes_matching_partial_upload_without_overwrite', async () => {
  const input = await packageInput();
  const prefix = `releases/${input.expectedReleaseId}/`;
  const store = bucket();
  store.objects.set(`${prefix}assets/site.css`, encoder.encode(input.files.get('assets/site.css')));
  const receipt = await uploadVerifiedRelease({ ...input, bucket: store });
  assert.deepEqual(store.puts, [`${prefix}index.html`, `${prefix}build-manifest.json`]);
  assert.equal(receipt.upload_state, 'created');
});

// Scenario: A retry finds a fully matching release already stored under the same ID.
// Purpose: Make retries read-only and preserve immutable release objects.
test('UnitT40_accepts_matching_existing_release_without_overwrite', async () => {
  const input = await packageInput();
  const store = bucket();
  await uploadVerifiedRelease({ ...input, bucket: store });
  const putCount = store.puts.length;
  const receipt = await uploadVerifiedRelease({ ...input, bucket: store });
  assert.equal(store.puts.length, putCount);
  assert.equal(receipt.upload_state, 'existing');
});

// Scenario: A previous partial upload contains a different object at the release key.
// Purpose: Refuse to overwrite content-addressed data and leave the release unpublished.
test('UnitT50_rejects_conflicting_existing_object', async () => {
  const input = await packageInput();
  const prefix = `releases/${input.expectedReleaseId}/`;
  const store = bucket();
  store.objects.set(`${prefix}assets/site.css`, encoder.encode('not the stylesheet'));
  await assert.rejects(() => uploadVerifiedRelease({ ...input, bucket: store }), /conflict|mismatch/i);
  assert.equal(store.objects.has(`${prefix}build-manifest.json`), false);
});

// Scenario: The caller changes a supplied byte array after starting an upload.
// Purpose: Upload only the package bytes that passed the local preflight check.
test('UnitT60_snapshots_caller_bytes_before_async_upload', async () => {
  const input = await packageInput();
  input.files.set('index.html', encoder.encode(input.files.get('index.html')));
  const store = bucket();
  const uploading = uploadVerifiedRelease({ ...input, bucket: store });
  input.files.get('index.html')[0] = 0;
  input.manifestBytes[0] = 0;
  input.workerBytes[0] = 0;
  await assert.doesNotReject(() => uploading);
});

// Scenario: A completed upload is selected by the Worker through its release ID.
// Purpose: Verify the uploader's R2 layout is compatible with the read-only serving path.
test('InterT10_serves_uploaded_release_through_worker', async () => {
  const input = await packageInput();
  const store = bucket();
  await uploadVerifiedRelease({ ...input, bucket: store });
  const response = await worker.fetch(new Request('https://example.test/'), {
    ACTIVE_RELEASE: input.expectedReleaseId, CONTENT_BUCKET: store
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), input.files.get('index.html'));
});

// Scenario: A static upload fails before the completion manifest is written.
// Purpose: Ensure the Worker refuses a half-uploaded release even if it is selected.
test('InterT20_refuses_partial_release_prefix', async () => {
  const input = await packageInput();
  const store = bucket({ failPutPath: `releases/${input.expectedReleaseId}/index.html` });
  await assert.rejects(() => uploadVerifiedRelease({ ...input, bucket: store }), /R2 put failed/);
  const response = await worker.fetch(new Request('https://example.test/'), {
    ACTIVE_RELEASE: input.expectedReleaseId, CONTENT_BUCKET: store
  });
  assert.equal(response.status, 503);
});
