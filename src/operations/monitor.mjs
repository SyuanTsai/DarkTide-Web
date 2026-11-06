import assert from 'node:assert/strict';
import { sha256, safeRelativePath, jsonBytes } from '../static/common.mjs';
import { verifyOrigin } from '../deploy/cloudflare.mjs';
export const REPOSITORY = 'SyuanTsai/DarkTide-Web';

export const INCIDENT_TITLE = '[Operations] Static site incident';
export function assertSamePublication(origins) {
  assert.ok(origins.length > 0 && origins.every(row => row.status === 'healthy'), 'all origins must be healthy');
  assert.equal(new Set(origins.map(row => row.build_id + ':' + row.data_revision)).size, 1, 'origins serve different approved builds or data revisions');
}
export function incidentAction(healthy, issues) {
  const issue = issues.find(row => row.title === INCIDENT_TITLE && row.user?.login === 'github-actions[bot]');
  return issue ? { action: healthy ? 'close' : 'keep', number: issue.number } : { action: healthy ? 'none' : 'open' };
}

async function monitorLegacy(origin, version, fetcher, check, checks) {
  assert.equal(version.package_kind, 'published');
  assert.match(version.build_id, /^[a-f0-9]{64}$/);
  assert.match(version.data_revision, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(version.game_releases) && version.game_releases.length > 0);
  for (const pointer of version.game_releases) {
    assert.match(pointer.data_revision, /^[a-f0-9]{64}$/);
    assert.equal(pointer.manifest_path, `/data/${pointer.data_revision}/manifest.json`);
    assert.match(pointer.manifest_sha256, /^[a-f0-9]{64}$/);
    const manifest = JSON.parse(await check(pointer.manifest_path, pointer.manifest_sha256));
    assert.equal(manifest.schemaVersion, '2.0.0');
    assert.equal(manifest.dataRevision, pointer.data_revision);
    assert.equal(manifest.gameVersion, pointer.game_version);
    assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
    const kinds = new Set();
    for (const row of manifest.files) {
      assert.ok(typeof row.kind === 'string' && row.kind.length > 0);
      safeRelativePath(row.path);
      assert.ok(row.path.startsWith('domains/'));
      assert.match(row.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(row.sizeBytes) && row.sizeBytes >= 0);
      if (!kinds.has(row.kind)) {
        kinds.add(row.kind);
        await check(`/data/${pointer.data_revision}/${row.path}`, row.sha256, row.sizeBytes);
      }
    }
  }
  assert.equal(version.game_releases.find(p => p.game_version === version.game_version)?.data_revision, version.data_revision);
  const document = await fetcher(new URL('/', origin), { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(document.status, 200, 'homepage HTTP status');
  assert.match(document.headers.get('content-type') ?? '', /text\/html/i);
  const html = await document.text();
  const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(match => match[1]);
  assert.ok(assets.length > 0, 'missing main assets');
  for (const asset of new Set(assets)) {
    const response = await fetcher(new URL(asset, origin), { redirect: 'error', signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, 'asset HTTP status: ' + asset);
  }
  const missing = await fetcher(new URL('/assets/missing.mjs', origin), { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(missing.status, 404, 'unknown path HTTP status');
  return { origin, status: 'healthy', publication: 'legacy-w09', build_id: version.build_id, data_revision: version.data_revision, hash_checks: checks };
}

// Verify the public contract directly; no release-state or retained backup authority.
export async function monitorOrigin(origin, { fetch: fetcher = globalThis.fetch } = {}) {
  const checks = [];
  const get = async name => {
    const response = await fetcher(new URL(name, origin), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, 'public content HTTP status: ' + name);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/i, 'public JSON MIME');
    return Buffer.from(await response.arrayBuffer());
  };
  const check = async (name, hash, size) => {
    const bytes = await get(name);
    if (hash) assert.equal(sha256(bytes), hash, 'public content hash: ' + name);
    if (size !== undefined) assert.equal(bytes.length, size, 'public content size: ' + name);
    const row = { path: name, sha256: sha256(bytes), size_bytes: bytes.length };
    checks.push(row);
    return bytes;
  };
  const version = JSON.parse(await get('/version.json'));
  const publication = version.source_data === true ? 'source-data' : version.source_data === undefined && version.schema_version === 2 ? 'legacy-w09' : undefined;
  assert.ok(publication, 'unknown publication format');
  try {
  if (publication === 'legacy-w09') return await monitorLegacy(origin, version, fetcher, check, checks);
  assert.equal(version.source_data, true, 'monitor requires Source-Data publication');
  assert.equal(version.package_kind, 'published');
  assert.match(version.build_id, /^[a-f0-9]{64}$/);
  assert.match(version.data_revision, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(version.game_releases) && version.game_releases.length > 0);
  let commit;
  for (const pointer of version.game_releases) {
    assert.match(pointer.data_revision, /^[a-f0-9]{64}$/);
    assert.equal(pointer.manifest_path, `/data/${pointer.data_revision}/manifest.json`);
    assert.match(pointer.manifest_sha256, /^[a-f0-9]{64}$/);
    const manifest = JSON.parse(await check(pointer.manifest_path, pointer.manifest_sha256));
    const { dataRevision, ...material } = manifest;
    assert.equal(dataRevision, pointer.data_revision);
    assert.equal(sha256(jsonBytes(material)), dataRevision, 'manifest revision hash');
    assert.equal(manifest.schemaVersion, '3.0.0');
    assert.equal(manifest.gameVersion, pointer.game_version);
    assert.equal(manifest.source.repository, 'SyuanTsai/DarkTide-Source-Data');
    assert.match(manifest.source.commit, /^[a-f0-9]{40}$/);
    if (commit) assert.equal(manifest.source.commit, commit, 'versions must use the same source commit');
    commit = manifest.source.commit;
    const paths = new Set();
    for (const row of manifest.files) {
      safeRelativePath(row.path);
      assert.ok(row.path.startsWith('domains/') && !paths.has(row.path));
      paths.add(row.path);
      assert.match(row.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(row.sizeBytes) && row.sizeBytes >= 0 && row.sizeBytes <= 16 * 1024 * 1024);
      await check(`/data/${dataRevision}/${row.path}`, row.sha256, row.sizeBytes);
    }
    for (const row of manifest.files) assert.ok(Array.isArray(row.dependencies) && row.dependencies.every(p => paths.has(p)));
  }
  const current = JSON.parse(await check('/source-data/current.json'));
  assert.equal(current.gameVersion, version.game_version);
  assert.deepEqual(current.versions, version.game_releases.map(p => p.game_version));
  assert.equal(version.game_releases.find(p => p.game_version === version.game_version)?.data_revision, version.data_revision);
  for (const release of current.versions) {
    assert.match(release, /^[0-9]+(?:\.[0-9]+){1,3}$/);
    for (const category of ['skills', 'weapons', 'blessings', 'terms']) await check(`/source-data/${release}/${category}.json`);
  }
  await verifyOrigin(origin, { ...version, source_commit: commit, source_files: checks }, { fetch: fetcher });
  // Use the injectable fetch for all checks, including deployment contract verification.
  const document = await fetcher(new URL('/', origin));
  const html = await document.text();
  const context = JSON.parse(html.match(/window\.__BUILD__\s*=\s*(\{[^<]*\})\s*;?\s*<\/script>/u)?.[1] || 'null');
  assert.equal(context?.build_id, version.build_id, 'HTML build context');
  assert.equal(context?.data_revision, version.data_revision, 'HTML data context');
  const credit = html.match(/<a\b[^>]*href="https:\/\/darktide\.gameslantern\.com\/"[^>]*>Games Lantern<\/a>/)?.[0];
  assert.ok(credit && !/rel=["'][^"']*(?:nofollow|ugc|sponsored)/i.test(credit), 'Games Lantern attribution must remain follow');
  const pending = [...html.matchAll(/(?:src|href)="(\/assets\/[a-f0-9]{64}\.(?:mjs|css))"/g)].map(m => m[1]);
  const seen = new Set();
  while (pending.length) {
    const name = pending.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const response = await fetcher(new URL(name, origin));
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha256(bytes), name.match(/[a-f0-9]{64}/)[0], 'asset hash');
    checks.push({ path: name, sha256: sha256(bytes), size_bytes: bytes.length });
    for (const match of bytes.toString().matchAll(/['"](?:\.\/|\/assets\/)([a-f0-9]{64}\.mjs)['"]/g)) pending.push('/assets/' + match[1]);
  }
  assert.ok(seen.size > 0, 'missing executable assets');
  return { origin, status: 'healthy', publication, build_id: version.build_id, data_revision: version.data_revision, source_commit: commit, hash_checks: checks };
  } catch (error) {
    error.publication = publication;
    throw error;
  }
}
