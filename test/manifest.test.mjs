import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureManifest, validateReleaseManifest } from '../src/release/manifest.mjs';

const files = new Map([['index.html', '<h1>示範</h1>'], ['assets/site.css', 'body{}']]);
const release = () => ({
  schema_version: 1,
  package_kind: 'release',
  release_ready: true,
  release_id: 'release-abc123',
  source_lock_ids: ['source-example'],
  total_files: 1,
  total_bytes: 5,
  files: { 'index.html': { sha256: 'a'.repeat(64), bytes: 5 } }
});

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

// Scenario: A release manifest has an exact ID, source-lock reference, and complete totals.
// Purpose: Give the Worker a strict gate before serving a release.
test('UnitT20_accepts_well_formed_release_manifest', () => {
  assert.doesNotThrow(() => validateReleaseManifest(release(), 'release-abc123'));
});

// Scenario: A release file path tries to leave its immutable prefix.
// Purpose: Stop manifest injection from changing the R2 object namespace.
test('UnitT30_rejects_unsafe_release_file_path', () => {
  const manifest = release();
  manifest.files['../secrets'] = { sha256: 'b'.repeat(64), bytes: 1 };
  manifest.total_files++;
  manifest.total_bytes++;
  assert.throws(() => validateReleaseManifest(manifest, 'release-abc123'), /path/i);
});

// Scenario: A manifest advertises a complete release but has false aggregate bytes.
// Purpose: Catch incomplete or inconsistent publish metadata before object reads.
test('UnitT40_rejects_incorrect_release_totals', () => {
  const manifest = release();
  manifest.total_bytes = 6;
  assert.throws(() => validateReleaseManifest(manifest, 'release-abc123'), /total/i);
});

// Scenario: A release lacks source lock provenance.
// Purpose: Prevent a content package from being promoted without input identity.
test('UnitT50_rejects_release_without_source_lock', () => {
  const manifest = release();
  manifest.source_lock_ids = [];
  assert.throws(() => validateReleaseManifest(manifest, 'release-abc123'), /source.lock/i);
});
