import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceSite } from '../src/build/build.mjs';
import { createStaticServer } from '../scripts/serve.mjs';
import { monitorOrigin, assertSamePublication, incidentAction } from '../src/operations/monitor.mjs';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
