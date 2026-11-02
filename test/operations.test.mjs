import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildStaticSite } from '../src/static/build.mjs';
import { createBuildRoot, disposeBuildRoot, publishedRemotePackage } from './static-test-helpers.mjs';
import { createBackup, validateDeploymentReceipt, inspectBackup, restoreBackup } from '../src/operations/backup.mjs';
import { assertSamePublication, monitorOrigin, incidentAction } from '../src/operations/monitor.mjs';
import { resolveW09BackupReceipt } from '../scripts/operations-backup-lookup.mjs';
import { sha256 } from '../src/static/common.mjs';

const versionId = '45770a28-fd27-445a-98e9-7d619764f3db';
function receipt(artifact) {
  return { status: 'verified', build_id: artifact.build_id, data_revision: artifact.data_revision,
    production_origin: 'https://darktide.tw-syuan.com', preview_origin: 'https://darktide-zh-tw-preview.syuan-tsai.workers.dev',
    previous_versions: [], deployed_versions: [{ version_id: versionId, percentage: 100 }] };
}

function w09Receipt(artifact, artifactManifestSha256 = 'c'.repeat(64)) {
  return {
    schema: 'w09-publication-receipt/1', status: 'verified', action: 'promote',
    transactionId: 'd'.repeat(64), releaseIds: ['w09-' + 'e'.repeat(32)],
    expectedActive: { activeByGame: [], runtimeSnapshotBuildId: null },
    buildId: artifact.build_id, dataRevision: artifact.data_revision, artifactManifestSha256,
    productionOrigin: 'https://darktide.tw-syuan.com',
    activeByGame: [{ gameReleaseId: 'game-release', releaseId: 'w09-' + 'e'.repeat(32) }],
  };
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

// Scenario: A retained package contains either a legacy Cloudflare receipt or a W09 publication receipt.
// Purpose: Keep restore and inspection compatible while binding W09 evidence to the exact manifest bytes.
test('UnitT15_backup_accepts_only_matching_verified_W09_publication_receipts', () => {
  const artifact = { package_kind: 'published', build_id: 'a'.repeat(64), data_revision: 'b'.repeat(64) };
  const manifestSha = 'c'.repeat(64);
  const valid = w09Receipt(artifact, manifestSha);
  assert.deepEqual(validateDeploymentReceipt(valid, artifact, manifestSha), valid);
  for (const changed of [
    { status: 'pending' }, { buildId: 'f'.repeat(64) }, { dataRevision: 'f'.repeat(64) },
    { artifactManifestSha256: 'f'.repeat(64) }, { productionOrigin: 'https://wrong.test' },
    { token: 'must-not-copy' },
  ]) {
    assert.throws(() => validateDeploymentReceipt({ ...valid, ...changed }, artifact, manifestSha));
  }
  assert.throws(() => validateDeploymentReceipt(valid, artifact), /manifest/i);
});

// Scenario: The active W09 build may already have a retained Release, or may need its state receipt materialized.
// Purpose: Use the monitor lookup identity, avoid duplicates, and fail closed before publication on stale bytes or missing evidence.
test('UnitT17_already_active_backup_lookup_is_idempotent_and_fail_closed', async () => {
  const artifact = { package_kind: 'published', build_id: 'a'.repeat(64), data_revision: 'b'.repeat(64) };
  const manifestSha = 'c'.repeat(64);
  const publicationReceipt = w09Receipt(artifact, manifestSha);
  const matchingRelease = {
    draft: false, prerelease: false, tag_name: 'site-' + '1'.repeat(40) + '-123-1',
    name: 'Static site ' + artifact.build_id, html_url: 'https://example.test/release',
  };
  let calls = 0;
  const retained = await resolveW09BackupReceipt({
    artifact, artifactManifestSha256: manifestSha, activeBuildId: artifact.build_id,
    state: { publicationReceipts: [] },
    listReleases: async () => { calls += 1; return [matchingRelease]; },
  });
  assert.equal(calls, 1, 'GitHub lookup is injectable and called once');
  assert.deepEqual(retained, { status: 'already-retained', release: matchingRelease });

  const required = await resolveW09BackupReceipt({
    artifact, artifactManifestSha256: manifestSha, activeBuildId: artifact.build_id,
    state: { publicationReceipts: [publicationReceipt] }, listReleases: async () => [],
  });
  assert.deepEqual(required, { status: 'backup-required', receipt: publicationReceipt });
  await assert.rejects(resolveW09BackupReceipt({
    artifact, artifactManifestSha256: manifestSha, activeBuildId: artifact.build_id,
    state: { publicationReceipts: [] }, listReleases: async () => [],
  }), /publication receipt.*active build/i);
  await assert.rejects(resolveW09BackupReceipt({
    artifact, artifactManifestSha256: manifestSha, activeBuildId: 'f'.repeat(64),
    state: { publicationReceipts: [publicationReceipt] }, listReleases: async () => [matchingRelease],
  }), /dist build.*active build/i);
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

// Scenario: Individually healthy origins serve different retained publications.
// Purpose: Do not treat a split preview/production release as globally healthy.
test('UnitT45_all_healthy_origins_must_serve_the_same_publication', () => {
  const row = { status: 'healthy', build_id: 'a'.repeat(64), data_revision: 'b'.repeat(64) };
  assert.doesNotThrow(() => assertSamePublication([row, { ...row }, { ...row }]));
  assert.throws(() => assertSamePublication([row, { ...row, build_id: 'c'.repeat(64) }]), /different approved builds/);
  assert.throws(() => assertSamePublication([row, { ...row, data_revision: 'c'.repeat(64) }]), /different approved builds/);
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
  assert.equal(restored.composition, undefined, 'legacy backup records remain accepted without composition metadata');
  assert.equal(record.files.length, 4);
  const w09Directory = path.join(root, 'w09-backup');
  const stateCommit = 'd'.repeat(40);
  const w09ReceiptPath = path.join(root, 'w09-deployment.json');
  const artifactManifestSha256 = sha256(await readFile(path.join(root, 'dist/artifact-manifest.json')));
  await writeFile(w09ReceiptPath, JSON.stringify(w09Receipt(artifact, artifactManifestSha256)));
  const w09Record = await createBackup({ root, dist: path.join(root, 'dist'), receiptPath: w09ReceiptPath, output: w09Directory,
    runUrl: 'https://github.com/SyuanTsai/DarkTide-Web/actions/runs/54321', composition: 'w09', stateBranchCommit: stateCommit });
  assert.equal(w09Record.composition, 'w09');
  assert.deepEqual(w09Record.state_branch, { name: 'w09-release-state', commit: stateCommit });
  const restoredW09 = await restoreBackup({ directory: w09Directory, output: path.join(root, 'w09-restored'), sourceOutput: path.join(root, 'w09-source') });
  assert.equal(restoredW09.composition, 'w09');
  assert.equal(restoredW09.state_branch_commit, stateCommit);
  await writeFile(path.join(directory, 'static-site.tar.gz'), 'damaged');
  await assert.rejects(restoreBackup({ directory, output: path.join(root, 'must-not-exist') }), /size|hash/);
  await assert.rejects(readFile(path.join(root, 'must-not-exist', 'version.json')), /ENOENT/);
});
