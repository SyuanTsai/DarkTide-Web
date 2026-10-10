import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { computeReleaseId } from '../src/release/manifest.mjs';
import worker from '../worker/index.mjs';

const html = '<!doctype html><html lang="zh-Hant-TW"><title>示範</title></html>';
const css = 'body{}';
const hash = value => createHash('sha256').update(value).digest('hex');
const manifest = {
  schema_version: 1,
  package_kind: 'release',
  source_lock_ids: ['source-example'],
  source_lock_digest: 'a'.repeat(64),
  rights_ledger_digest: 'b'.repeat(64),
  taxonomy_sha256: 'c'.repeat(64),
  field_requirement_sha256: 'd'.repeat(64),
  tool_commit_sha: 'e'.repeat(40),
  files: [
    { path: 'assets/site.css', raw_bytes: Buffer.byteLength(css), sha256: hash(css), content_type: 'text/css; charset=utf-8' },
    { path: 'index.html', raw_bytes: Buffer.byteLength(html), sha256: hash(html), content_type: 'text/html; charset=utf-8' },
    { path: 'skills/index.html', raw_bytes: Buffer.byteLength(html), sha256: hash(html), content_type: 'text/html; charset=utf-8' }
  ],
  worker: { path: 'worker/index.mjs', raw_bytes: 42, sha256: 'f'.repeat(64) },
  totals: { file_count: 3, raw_bytes: Buffer.byteLength(css) + Buffer.byteLength(html) * 2 },
  validation: { complete: true, checks: ['assets-v1', 'content-v1', 'rights-v1', 'routes-v1'] }
};
manifest.release_id = await computeReleaseId(manifest);
const releaseId = manifest.release_id;

function environment(options = {}) {
  const calls = [];
  const objects = {
    [`releases/${releaseId}/build-manifest.json`]: JSON.stringify(options.manifest ?? manifest),
    [`releases/${releaseId}/index.html`]: options.homeBody ?? html,
    [`releases/${releaseId}/skills/index.html`]: html,
    [`releases/${releaseId}/assets/site.css`]: css
  };
  return {
    calls,
    env: {
      ACTIVE_RELEASE: options.activeRelease ?? releaseId,
      CONTENT_BUCKET: { async get(key) {
        calls.push(key);
        const value = objects[key];
        return value === undefined ? null : {
          body: value,
          text: async () => value,
          arrayBuffer: async () => Uint8Array.from(Buffer.from(value, 'utf8')).buffer
        };
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

// Scenario: The active manifest is fictional, has a different ID, or was changed after ID calculation.
// Purpose: Block incomplete and tampered packages from the public Worker.
test('UnitT30_rejects_fixture_mismatched_or_tampered_release', async () => {
  const fixture = environment({ manifest: { ...manifest, package_kind: 'fixture' } });
  const mismatched = environment({ manifest: { ...manifest, release_id: `sha256:${'0'.repeat(64)}` } });
  const tampered = structuredClone(manifest);
  tampered.files[1].sha256 = '9'.repeat(64);
  assert.equal((await worker.fetch(new Request('https://example.test/'), fixture.env)).status, 503);
  assert.equal((await worker.fetch(new Request('https://example.test/'), mismatched.env)).status, 503);
  assert.equal((await worker.fetch(new Request('https://example.test/'), environment({ manifest: tampered }).env)).status, 503);
});

// Scenario: The client asks for headers only, then revalidates a known file.
// Purpose: Support efficient responses without reading unrelated objects.
test('UnitT40_supports_head_and_etag_revalidation', async () => {
  const { env } = environment();
  const head = await worker.fetch(new Request('https://example.test/', { method: 'HEAD' }), env);
  const fresh = await worker.fetch(new Request('https://example.test/', { headers: { 'if-none-match': `"${hash(html)}"` } }), env);
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

// Scenario: R2 returns bytes different from the signed release file entry.
// Purpose: Never serve corrupt bytes under the release's expected ETag.
test('UnitT60_rejects_corrupt_r2_object_bytes', async () => {
  const { env } = environment({ homeBody: `${html}changed` });
  const result = await worker.fetch(new Request('https://example.test/'), env);
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});
