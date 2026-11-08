import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceSite } from '../src/build/build.mjs';
import { createStaticServer } from '../scripts/serve.mjs';
import { monitorOrigin, assertSamePublication, incidentAction } from '../src/operations/monitor.mjs';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mixedSourceFixture, collectFiles, publicationFetch, transportOptions } from './syp391-fixture.mjs';

// Scenario: A public Source-Data site is healthy, then serves corrupt domain bytes or HTML attribution.
// Purpose: Monitor the new publication without a retained backup or state branch and reject corruption.
test('InterT10_monitor_checks_source_manifests_domains_assets_and_attribution', async t => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const root = await mkdtemp(path.join(repo, '.static-build-staging-monitor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['web', 'content/history', 'content/reference', 'content/authoring/v2']) await cp(path.join(repo, name), path.join(root, name), { recursive: true });
  await buildSourceSite({ root, sourceData: path.join(repo, 'test/fixtures/source-data'), fixture: true });
  const server = await createStaticServer({ distPath: path.join(root, 'dist') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fetcher = async (url, options) => {
    if (options?.headers?.['Sec-Fetch-Mode'] === 'navigate') options = { ...options, headers: { ...options.headers, Accept: 'text/html' } };
    const response = await fetch(url, options);
    if (new URL(url).pathname === '/version.json') {
      const version = await response.json(); version.package_kind = 'published';
      return new Response(JSON.stringify(version), { headers: response.headers });
    }
    return response;
  };
  const result = await monitorOrigin(origin, { fetch: fetcher });
  assert.equal(result.status, 'healthy');
  assert.equal(result.publication, 'source-data');
  const legacy = async (url, options) => new URL(url).pathname.endsWith('.manifest.json') && new URL(url).pathname.startsWith('/source-data/') ? new Response('missing',{status:404}) : fetcher(url,options);
  assert.equal((await monitorOrigin(origin, {fetch:legacy})).status, 'healthy');
  for (const status of [403, 500]) {
    let fallback = false;
    const rejected = async (url, options) => {
      const name = new URL(url).pathname;
      if (name.startsWith('/source-data/') && name.endsWith('.manifest.json')) return new Response('error',{status});
      if (name.startsWith('/source-data/') && /\/(skills|weapons|blessings|terms)\.json$/.test(name)) fallback = true;
      return fetcher(url,options);
    };
    await assert.rejects(monitorOrigin(origin,{fetch:rejected}), /HTTP status/);
    assert.equal(fallback,false,`manifest ${status} must not fall back`);
  }
  const badManifest = async (url, options) => new URL(url).pathname.endsWith('.manifest.json') && new URL(url).pathname.startsWith('/source-data/') ? new Response('<html>',{headers:{'content-type':'text/html'}}) : fetcher(url,options);
  await assert.rejects(monitorOrigin(origin, {fetch:badManifest}), /MIME/);
  assert.ok(result.hash_checks.some(row => row.path.includes('/domains/')));
  assert.ok(result.hash_checks.some(row => row.path.startsWith('/assets/')));
  for (const target of ['domain', 'attribution', '404']) {
    const corrupt = async (url, options) => {
      const response = await fetcher(url, options), name = new URL(url).pathname;
      if (target === 'domain' && name.includes('/domains/')) return new Response('{}', { headers: response.headers });
      if (target === 'attribution' && name === '/') return new Response((await response.text()).replace('<a href="https://darktide.gameslantern.com/">', '<a rel="nofollow" href="https://darktide.gameslantern.com/">'), { headers: response.headers });
      if (target === '404' && name.endsWith('/missing.mjs')) return new Response('<!doctype html>');
      return response;
    };
    await assert.rejects(monitorOrigin(origin, { fetch: corrupt }), undefined, target);
  }
});

// Scenario: Healthy origins disagree or a bot-owned incident needs recovery.
// Purpose: Preserve publication consistency and narrowly scoped incident deduplication.
test('UnitT20_monitor_preserves_consistency_and_bot_incident_actions', () => {
  const row = { status: 'healthy', build_id: 'a', data_revision: 'b' };
  assert.doesNotThrow(() => assertSamePublication([row, { ...row }]));
  assert.throws(() => assertSamePublication([row, { ...row, build_id: 'c' }]));
  const issue = { number: 7, title: '[Operations] Static site incident', user: { login: 'github-actions[bot]' } };
  assert.deepEqual(incidentAction(false, []), { action: 'open' });
  assert.deepEqual(incidentAction(false, [issue]), { action: 'keep', number: 7 });
  assert.deepEqual(incidentAction(true, [issue]), { action: 'close', number: 7 });
  assert.deepEqual(incidentAction(true, [{ ...issue, user: { login: 'other' } }]), { action: 'none' });
});

// Scenario: An upgraded origin uses shards, then its manifest, part, or legacy endpoint is corrupted.
// Purpose: Fail closed on transport errors and never GET an oversize single file after discovery.
test('InterT30_monitor_shards_fail_closed_without_legacy_downloads', async t => {
  const opts = await mixedSourceFixture(t); await buildSourceSite(opts);
  const original = await collectFiles(path.join(opts.root, 'dist'));
  const manifestName = 'source-data/9.9.2/weapons.manifest.json';
  const legacy = '/source-data/9.9.2/weapons.json';
  const scenarios = [
    ['InterT10_shards_succeed', null, null],
    ['InterT20_malformed_JSON', files => files.set(manifestName, Buffer.from('{')), null, /JSON/],
    ['InterT30_invalid_manifest', files => files.set(manifestName, Buffer.from('{}')), null, /transport parts/],
    ['InterT40_wrong_part_hash', files => files.set('source-data/9.9.2/weapons.part-0002.bin', Buffer.alloc(2049)), null, /invalid source transport/],
    ['InterT50_wrong_total_hash', files => {
      const manifest = JSON.parse(files.get(manifestName)); manifest.totalSha256 = '0'.repeat(64);
      files.set(manifestName, Buffer.from(JSON.stringify(manifest)));
    }, null, /invalid source transport/],
    ['InterT60_forbidden_manifest', null, 403, /HTTP status/],
    ['InterT70_failed_manifest', null, 500, /HTTP status/],
    ['InterT80_oversize_legacy_200', null, 'legacy', /oversized legacy.*404/],
  ];
  for (const [name, mutate, status, error] of scenarios) {
    // Scenario: A single selected transport response changes on an otherwise valid origin.
    // Purpose: Transport failures must not trigger a legacy single-file fallback.
    await t.test(name, async () => {
      const files = new Map(original); mutate?.(files);
      const origin = publicationFetch(files), requests = [];
      const fetch = async (url, options) => {
        const name = new URL(url).pathname; requests.push({ name, method: options?.method ?? 'GET' });
        if (status === 'legacy' && name === legacy) return new Response(null, { status: 200 });
        if (typeof status === 'number' && name === '/' + manifestName) return new Response('error', { status });
        return origin.fetch(url, options);
      };
      const run = () => monitorOrigin('https://example.test', { fetch, transportOptions });
      if (error) {
        await assert.rejects(run, error);
        if (name === 'InterT40_wrong_part_hash' || name === 'InterT50_wrong_total_hash') {
          assert.equal(requests.filter(row => row.name === '/version.json').length, 1, 'reject corrupted transport before repeating origin verification');
        }
      }
      else {
        const result = await run(); assert.equal(result.status, 'healthy');
        assert.ok(result.hash_checks.some(row => row.path.endsWith('weapons.part-0002.bin')));
        assert.ok(requests.some(row => row.name === legacy && row.method === 'HEAD'));
      }
      assert.ok(!requests.some(row => row.name === legacy && row.method === 'GET'), 'must not fall back or download oversize legacy bytes');
    });
  }
});

// Scenario: All transport manifests return 404 on a pre-upgrade website with single files.
// Purpose: Preserve legacy discovery, and only read each single file after its manifest 404.
test('InterT40_monitor_manifest_404_falls_back_to_legacy_single_files', async t => {
  const opts = await mixedSourceFixture(t); await buildSourceSite(opts);
  const files = await collectFiles(path.join(opts.root, 'dist'));
  for (const [name, bytes] of opts.rawFiles) files.set('source-data/' + name, bytes);
  const origin = publicationFetch(files), requests = [];
  const fetch = async (url, options) => {
    const name = new URL(url).pathname; requests.push(name);
    if (name.startsWith('/source-data/') && name.endsWith('.manifest.json')) return new Response('missing', { status: 404 });
    return origin.fetch(url, options);
  };
  assert.equal((await monitorOrigin('https://example.test', { fetch, transportOptions })).status, 'healthy');
  for (const name of opts.rawFiles.keys()) if (name !== 'current.json') {
    const legacy = '/source-data/' + name, manifest = legacy.replace(/\.json$/, '.manifest.json');
    assert.ok(requests.indexOf(manifest) >= 0);
    assert.ok(requests.indexOf(legacy) > requests.indexOf(manifest));
  }
  assert.ok(!requests.some(name => name.endsWith('.bin')));
});
