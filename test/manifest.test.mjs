import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalize, computeReleaseId, createFixtureManifest, validateReleaseManifest } from '../src/release/manifest.mjs';

const files = new Map([['index.html', '<h1>示範</h1>'], ['assets/site.css', 'body{}']]);
const sha = character => character.repeat(64);

async function release() {
  const manifest = {
    schema_version: 1,
    package_kind: 'release',
    source_lock_ids: ['source-example'],
    source_lock_digest: sha('a'),
    rights_ledger_digest: sha('b'),
    taxonomy_sha256: sha('c'),
    field_requirement_sha256: sha('d'),
    tool_commit_sha: 'e'.repeat(40),
    files: [
      { path: 'assets/site.css', raw_bytes: 6, sha256: sha('f'), content_type: 'text/css; charset=utf-8' },
      { path: 'index.html', raw_bytes: 5, sha256: sha('1'), content_type: 'text/html; charset=utf-8' }
    ],
    worker: { path: 'worker/index.mjs', raw_bytes: 42, sha256: sha('2') },
    totals: { file_count: 2, raw_bytes: 11 },
    validation: { complete: true, checks: ['assets-v1', 'content-v1', 'rights-v1', 'routes-v1'] }
  };
  manifest.release_id = await computeReleaseId(manifest);
  return manifest;
}

// Scenario: A local fictional build emits its file list.
// Purpose: Make the nondeployable state and byte totals explicit in every local build.
test('UnitT10_creates_nonrelease_fixture_manifest_with_totals', async () => {
  const manifest = await createFixtureManifest(files);
  assert.equal(manifest.release_ready, false);
  assert.equal(manifest.release_id, null);
  assert.equal(manifest.total_files, 2);
  assert.equal(manifest.total_bytes, Buffer.byteLength('<h1>示範</h1>') + 6);
  assert.equal(manifest.files['index.html'].sha256.length, 64);
});

// Scenario: Keys are reordered and a decomposed Unicode value is supplied.
// Purpose: Keep the RFC 8785 preimage stable across input ordering and normalization.
test('UnitT20_canonicalizes_sorted_keys_and_nfc_strings', () => {
  assert.equal(canonicalize({ b: 1, a: 'e\u0301' }), '{"a":"é","b":1}');
  assert.equal(canonicalize({ a: 'é', b: 1 }), '{"a":"é","b":1}');
});

// Scenario: A release manifest has sorted files and all identity inputs.
// Purpose: Admit only a complete manifest whose release ID matches its canonical bytes.
test('UnitT30_accepts_complete_content_addressed_release', async () => {
  const manifest = await release();
  assert.match(manifest.release_id, /^sha256:[a-f0-9]{64}$/);
  await assert.doesNotReject(() => validateReleaseManifest(manifest, manifest.release_id));
  const expected = createHash('sha256').update(canonicalize({
    schema_version: 1,
    files: manifest.files,
    worker_sha256: manifest.worker.sha256,
    source_lock_ids: manifest.source_lock_ids,
    source_lock_digest: manifest.source_lock_digest,
    rights_ledger_digest: manifest.rights_ledger_digest,
    taxonomy_sha256: manifest.taxonomy_sha256,
    field_requirement_sha256: manifest.field_requirement_sha256,
    tool_commit_sha: manifest.tool_commit_sha
  })).digest('hex');
  assert.equal(manifest.release_id, `sha256:${expected}`);
});

// Scenario: A file digest changes after the release ID was computed.
// Purpose: Reject a manifest that no longer represents its immutable release ID.
test('UnitT40_rejects_release_identity_mismatch', async () => {
  const manifest = await release();
  manifest.files[1].sha256 = sha('3');
  await assert.rejects(() => validateReleaseManifest(manifest, manifest.release_id), /release.id.*mismatch/i);
});

// Scenario: File entries are reversed or a path leaves the release prefix.
// Purpose: Preserve canonical ordering and the R2 object namespace.
test('UnitT50_rejects_unsorted_or_unsafe_release_paths', async () => {
  const unsorted = await release();
  unsorted.files.reverse();
  await assert.rejects(() => validateReleaseManifest(unsorted, unsorted.release_id), /sorted/i);
  const traversal = await release();
  traversal.files[0].path = '../secret.css';
  await assert.rejects(() => validateReleaseManifest(traversal, traversal.release_id), /path/i);
});

// Scenario: Aggregate bytes disagree with the individual release files.
// Purpose: Catch incomplete or inconsistent publish metadata before object reads.
test('UnitT60_rejects_incorrect_release_totals', async () => {
  const manifest = await release();
  manifest.totals.raw_bytes++;
  await assert.rejects(() => validateReleaseManifest(manifest, manifest.release_id), /total/i);
});

// Scenario: Source provenance or completed validation is absent.
// Purpose: Stop promotion of an unverified content package.
test('UnitT70_rejects_unverified_release', async () => {
  const noSource = await release();
  noSource.source_lock_ids = [];
  await assert.rejects(() => validateReleaseManifest(noSource, noSource.release_id), /source.lock/i);
  const incomplete = await release();
  incomplete.validation.complete = false;
  await assert.rejects(() => validateReleaseManifest(incomplete, incomplete.release_id), /validation/i);
});
