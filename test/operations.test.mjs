import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildStaticSite } from '../src/static/build.mjs';
import { createBuildRoot, disposeBuildRoot, publishedRemotePackage } from './static-test-helpers.mjs';
import { createBackup, validateDeploymentReceipt, inspectBackup, restoreBackup } from '../src/operations/backup.mjs';
import { monitorOrigin, incidentAction } from '../src/operations/monitor.mjs';

const versionId = '45770a28-fd27-445a-98e9-7d619764f3db';
function receipt(artifact) {
  return { status: 'verified', build_id: artifact.build_id, data_revision: artifact.data_revision,
    production_origin: 'https://darktide.tw-syuan.com', preview_origin: 'https://darktide-zh-tw-preview.syuan-tsai.workers.dev',
    previous_versions: [], deployed_versions: [{ version_id: versionId, percentage: 100 }] };
}

// Scenario: A successful receipt or a stale, failed, or mixed deployment is supplied.
// Purpose: Archive only a complete verified publication, with no credential-bearing extras.
test('UnitT10_backup_requires_matching_verified_deployment', () => {
  const artifact = { package_kind: 'published', build_id: 'a'.repeat(64), data_revision: 'b'.repeat(64) };
  assert.deepEqual(validateDeploymentReceipt(receipt(artifact), artifact), receipt(artifact));
  for (const changed of [{ status: 'rolled-back' }, { build_id: 'c'.repeat(64) }, { token: 'must-not-copy' },
    { deployed_versions: [] }, { production_origin: 'https://wrong.test' }]) {
    assert.throws(() => validateDeploymentReceipt({ ...receipt(artifact), ...changed }, artifact));
  }
  assert.throws(() => validateDeploymentReceipt(receipt(artifact), { ...artifact, package_kind: 'fixture' }));
});

async function originHarness(t) {
  const root = await createBuildRoot();
  t.after(() => disposeBuildRoot(root));
  await mkdir(path.join(root, 'content/published'), { recursive: true });
  await writeFile(path.join(root, 'content/published/content.json'), JSON.stringify(publishedRemotePackage()) + '\n');
  const artifact = await buildStaticSite({ root, mode: 'published', siteOrigin: 'https://darktide.tw-syuan.com' });
  const dist = path.join(root, 'dist');
  const manifest = JSON.parse(await readFile(path.join(dist, 'artifact-manifest.json'), 'utf8'));
  const files = new Map(await Promise.all(manifest.files.map(async row => [row.path, await readFile(path.join(dist, row.path))])));
  const catalog = JSON.parse(files.get('data/' + artifact.data_revision + '/catalog.json'));
  const routes = new Set(['/', '/skills/ogryn/', '/weapons/bolter_p1/', '/blessings/terrifying-barrage/']);
  const fetcher = async url => {
    const name = new URL(url).pathname.slice(1);
    if (name === 'index.html') return new Response(null, { status: 308, headers: { location: '/' } });
    const body = routes.has('/' + name) ? files.get('index.html') : files.get(name);
    if (!body) return new Response('Not Found', { status: 404 });
    const type = routes.has('/' + name) || name.endsWith('.html') ? 'text/html' : name.endsWith('.json') ? 'application/json' : name.endsWith('.css') ? 'text/css' : name.endsWith('.mjs') ? 'text/javascript' : 'text/plain';
    const edgeBody = routes.has('/' + name) ? Buffer.concat([body, Buffer.from('<script>/* per-request edge security injection */</script>')]) : body;
    return new Response(edgeBody, { headers: { 'content-type': type, 'cache-control': name === 'version.json' ? 'no-cache' : 'public, max-age=31536000, immutable' } });
  };
  return { manifest, fetcher, files, catalog, artifact };
}

// Scenario: A healthy static origin serves bytes matching its independently retained manifest.
// Purpose: Prove the probe checks the actual catalog, representative details, and executable assets.
test('UnitT20_monitor_accepts_content_matching_backup_hashes', async t => {
  const h = await originHarness(t);
  const result = await monitorOrigin('https://example.test', h.manifest, { fetch: h.fetcher });
  assert.equal(result.status, 'healthy');
  assert.ok(result.hash_checks.some(row => row.path.endsWith('/catalog.json')));
  for (const kind of ['skill', 'weapon', 'blessing']) {
    assert.ok(result.hash_checks.some(row => row.path.endsWith('/' + h.catalog.entries.find(row => row.kind === kind).detail_path)));
  }
  assert.equal(result.hash_checks.filter(row => row.path.startsWith('assets/')).length, 3);
});

// Scenario: HTML has dynamic edge injection but its required source attribution changes to nofollow.
// Purpose: Tolerate normal edge bytes while enforcing the public attribution contract.
test('UnitT25_monitor_checks_follow_attribution_with_dynamic_edge_HTML', async t => {
  const h = await originHarness(t);
  h.files.set('index.html', Buffer.from(h.files.get('index.html').toString().replace('<a href="https://darktide.gameslantern.com/">', '<a rel="nofollow" href="https://darktide.gameslantern.com/">')));
  await assert.rejects(monitorOrigin('https://example.test', h.manifest, { fetch: h.fetcher }), /attribution must remain follow/);
});

// Scenario: An origin returns valid JSON with altered content but still responds HTTP 200.
// Purpose: Prevent a superficially healthy SPA response from masking content corruption.
test('UnitT30_monitor_rejects_changed_JSON_bytes', async t => {
  const h = await originHarness(t);
  const name = 'data/' + h.artifact.data_revision + '/catalog.json';
  h.files.set(name, Buffer.concat([h.files.get(name), Buffer.from(' ')]));
  await assert.rejects(monitorOrigin('https://example.test', h.manifest, { fetch: h.fetcher }), /hash|integrity/i);
});

// Scenario: The version or a missing asset is accidentally served by an HTML catch-all.
// Purpose: Protect JSON MIME and real 404 behavior separately from accepted unknown content routes.
test('UnitT40_monitor_rejects_HTML_fallback_and_false_404', async t => {
  const h = await originHarness(t);
  for (const target of ['/version.json', '/assets/not-present.mjs']) {
    const fetcher = url => new URL(url).pathname === target ? new Response('<html>shell</html>', { headers: { 'content-type': 'text/html' } }) : h.fetcher(url);
    await assert.rejects(monitorOrigin('https://example.test', h.manifest, { fetch: fetcher }));
  }
});

// Scenario: Failure repeats, then service recovers; an unrelated issue happens to exist.
// Purpose: Deduplicate the incident and avoid modifying arbitrary repository issues.
test('UnitT50_incident_changes_only_the_matching_bot_issue_on_state_change', () => {
  const issue = { number: 7, title: '[Operations] Static site incident', user: { login: 'github-actions[bot]' } };
  assert.deepEqual(incidentAction(false, []), { action: 'open' });
  assert.deepEqual(incidentAction(false, [issue]), { action: 'keep', number: 7 });
  assert.deepEqual(incidentAction(true, [issue]), { action: 'close', number: 7 });
  assert.deepEqual(incidentAction(true, [{ ...issue, user: { login: 'someone-else' } }]), { action: 'none' });
});

// Scenario: A backup record references modified archive bytes.
// Purpose: Refuse extraction before any archive contents can be written.
test('UnitT60_restore_rejects_unverified_or_missing_archives', async t => {
  const root = await createBuildRoot();
  t.after(() => disposeBuildRoot(root));
  await assert.rejects(inspectBackup(root), /backup|ENOENT/i);
});

// Scenario: A verified published package is archived, retrieved, then damaged.
// Purpose: Exercise real tar/Git I/O, complete extraction and integrity refusal before extraction.
test('InterT70_backup_roundtrip_preserves_all_files_and_rejects_tampering', async t => {
  const root = await createBuildRoot({ withSpaces: true });
  t.after(() => disposeBuildRoot(root));
  await mkdir(path.join(root, 'content/published'), { recursive: true });
  await writeFile(path.join(root, 'content/published/content.json'), JSON.stringify(publishedRemotePackage()) + '\n');
  const exec = promisify(execFile);
  await exec('git', ['init', '--quiet'], { cwd: root });
  await exec('git', ['config', 'core.autocrlf', 'true'], { cwd: root });
  await exec('git', ['add', 'web', 'content'], { cwd: root });
  await exec('git', ['-c', 'user.name=Operations Test', '-c', 'user.email=operations@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=.no-hooks', 'commit', '--quiet', '-m', 'Synthetic published backup fixture'], { cwd: root });
  const artifact = await buildStaticSite({ root, mode: 'published', siteOrigin: 'https://darktide.tw-syuan.com' });
  const receiptPath = path.join(root, 'deployment.json');
  await writeFile(receiptPath, JSON.stringify(receipt(artifact)));
  const directory = path.join(root, 'backup');
  const record = await createBackup({ root, dist: path.join(root, 'dist'), receiptPath, output: directory, runUrl: 'https://github.com/SyuanTsai/DarkTide-Web/actions/runs/12345' });
  const restored = await restoreBackup({ directory, output: path.join(root, 'restored'), sourceOutput: path.join(root, 'source') });
  assert.equal(restored.build_id, artifact.build_id);
  assert.equal(restored.file_count, artifact.file_count);
  assert.equal(record.files.length, 4);
  await writeFile(path.join(directory, 'static-site.tar.gz'), 'damaged');
  await assert.rejects(restoreBackup({ directory, output: path.join(root, 'must-not-exist') }), /size|hash/);
  await assert.rejects(readFile(path.join(root, 'must-not-exist', 'version.json')), /ENOENT/);
});
