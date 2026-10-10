import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';

const releaseId = 'release-abc123';
const html = '<!doctype html><html lang="zh-Hant-TW"><title>示範</title></html>';
const manifest = { schema_version: 1, package_kind: 'release', release_ready: true, release_id: releaseId, source_lock_ids: ['source-example'], total_files: 3, total_bytes: Buffer.byteLength(html) * 2 + 8, files: {
  'index.html': { sha256: 'a'.repeat(64), bytes: Buffer.byteLength(html) },
  'skills/index.html': { sha256: 'b'.repeat(64), bytes: Buffer.byteLength(html) },
  'assets/site.css': { sha256: 'c'.repeat(64), bytes: 8 }
} };

function environment(options = {}) {
  const calls = [];
  const objects = {
    [`releases/${releaseId}/build-manifest.json`]: JSON.stringify(options.manifest ?? manifest),
    [`releases/${releaseId}/index.html`]: html,
    [`releases/${releaseId}/skills/index.html`]: html,
    [`releases/${releaseId}/assets/site.css`]: 'body{}'
  };
  return {
    calls,
    env: {
      ACTIVE_RELEASE: options.activeRelease ?? releaseId,
      CONTENT_BUCKET: { async get(key) {
        calls.push(key);
        const value = objects[key];
        return value === undefined ? null : { body: value, text: async () => value };
      } }
    }
  };
}

// Scenario: A valid immutable release contains the requested homepage and nested category.
// Purpose: Serve only files named in the active release manifest.
test('UnitT10_serves_manifest_listed_html_from_private_bucket', async () => {
  const { env, calls } = environment();
  const home = await worker.fetch(new Request('https://example.test/'), env);
  const category = await worker.fetch(new Request('https://example.test/skills/'), env);
  assert.equal(home.status, 200);
  assert.equal(category.status, 200);
  assert.match(await home.text(), /示範/);
  assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.ok(calls.includes(`releases/${releaseId}/skills/index.html`));
});

// Scenario: An unknown URL and encoded traversal are requested.
// Purpose: Never read an object outside manifest-listed release files.
test('UnitT20_rejects_unlisted_or_encoded_paths', async () => {
  const { env, calls } = environment();
  assert.equal((await worker.fetch(new Request('https://example.test/missing/'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://example.test/%2e%2e/secrets'), env)).status, 404);
  assert.ok(calls.every(key => key.startsWith(`releases/${releaseId}/`)));
  assert.ok(!calls.some(key => key.includes('secrets')));
});

// Scenario: The active manifest is the local fictional build or its release ID differs.
// Purpose: Block an incomplete package from the public Worker.
test('UnitT30_rejects_fixture_or_mismatched_release', async () => {
  const fixture = environment({ manifest: { ...manifest, package_kind: 'fixture', release_ready: false } });
  const mismatched = environment({ manifest: { ...manifest, release_id: 'another-release' } });
  assert.equal((await worker.fetch(new Request('https://example.test/'), fixture.env)).status, 503);
  assert.equal((await worker.fetch(new Request('https://example.test/'), mismatched.env)).status, 503);
});

// Scenario: The client asks for headers only, then revalidates a known file.
// Purpose: Support efficient responses without reading unrelated objects.
test('UnitT40_supports_head_and_etag_revalidation', async () => {
  const { env } = environment();
  const head = await worker.fetch(new Request('https://example.test/', { method: 'HEAD' }), env);
  const fresh = await worker.fetch(new Request('https://example.test/', { headers: { 'if-none-match': `"${'a'.repeat(64)}"` } }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(fresh.status, 304);
});

// Scenario: The asset path stays the same when the active release changes.
// Purpose: Avoid a stale stylesheet persisting across release promotion.
test('UnitT50_does_not_mark_shared_asset_paths_immutable', async () => {
  const { env } = environment();
  const asset = await worker.fetch(new Request('https://example.test/assets/site.css'), env);
  assert.equal(asset.status, 200);
  assert.doesNotMatch(asset.headers.get('cache-control'), /immutable|max-age=31536000/i);
});
