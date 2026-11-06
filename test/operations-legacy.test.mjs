import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { monitorOrigin } from '../src/operations/monitor.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const revision = 'a'.repeat(64), build = 'b'.repeat(64);
  const domain = Buffer.from('{"items":[]}');
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: '2.0.0', dataRevision: revision, gameVersion: '1.2.3', files: [{ kind: 'skills', path: 'domains/skills.json', sha256: hash(domain), sizeBytes: domain.length }] }));
  const version = { schema_version: 2, package_kind: 'published', build_id: build, data_revision: revision, game_version: '1.2.3', game_releases: [{ game_version: '1.2.3', data_revision: revision, manifest_path: `/data/${revision}/manifest.json`, manifest_sha256: hash(manifest) }] };
  const files = new Map([['/version.json', JSON.stringify(version)], [`/data/${revision}/manifest.json`, manifest], [`/data/${revision}/domains/skills.json`, domain], ['/', '<!doctype html><script src="/assets/main.mjs"></script>'], ['/assets/main.mjs', 'export {};']]);
  return { version, files, fetcher: async url => {
    const name = new URL(url).pathname, value = files.get(name);
    return value === undefined ? new Response('missing', { status: 404 }) : new Response(value, { headers: { 'content-type': name === '/' ? 'text/html' : name.endsWith('.json') ? 'application/json' : 'text/javascript' } });
  } };
}

// Scenario: A W09 publication serves matching release manifests and domain bytes.
// Purpose: Preserve healthy monitoring during the deployment transition.
test('UnitT10_legacy_publication_is_healthy', async () => {
  const { fetcher } = fixture();
  const result = await monitorOrigin('https://example.test', { fetch: fetcher });
  assert.equal(result.status, 'healthy');
  assert.equal(result.publication, 'legacy-w09');
});

// Scenario: A release pointer contains an incorrect manifest hash.
// Purpose: Reject corrupted legacy releases.
test('UnitT20_legacy_manifest_hash_mismatch_fails', async () => {
  const f = fixture(); f.version.game_releases[0].manifest_sha256 = 'c'.repeat(64);
  f.files.set('/version.json', JSON.stringify(f.version));
  await assert.rejects(monitorOrigin('https://example.test', { fetch: f.fetcher }), /hash/);
});

// Scenario: The version document identifies neither supported publication.
// Purpose: Avoid treating unknown formats as healthy legacy sites.
test('UnitT30_unknown_publication_fails', async () => {
  const f = fixture(); f.files.set('/version.json', JSON.stringify({ schema_version: 99 }));
  await assert.rejects(monitorOrigin('https://example.test', { fetch: f.fetcher }));
});
