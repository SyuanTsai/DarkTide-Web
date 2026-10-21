import assert from 'node:assert/strict';
import { sha256, safeRelativePath } from '../static/common.mjs';
import { verifyOrigin } from '../deploy/cloudflare.mjs';
import { REPOSITORY } from './backup.mjs';

export const INCIDENT_TITLE = '[Operations] Static site incident';
export function assertSamePublication(origins) {
  assert.ok(origins.length > 0 && origins.every(row => row.status === 'healthy'), 'all origins must be healthy');
  assert.equal(new Set(origins.map(row => row.build_id + ':' + row.data_revision)).size, 1, 'origins serve different approved builds or data revisions');
}
export function incidentAction(healthy, issues) {
  const issue = issues.find(row => row.title === INCIDENT_TITLE && row.user?.login === 'github-actions[bot]');
  return issue ? { action: healthy ? 'close' : 'keep', number: issue.number } : { action: healthy ? 'none' : 'open' };
}

export async function loadBackupManifest(version, { fetch: fetcher = globalThis.fetch } = {}) {
  const get = async url => {
    const response = await fetcher(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/vnd.github+json' } });
    assert.equal(response.status, 200, 'backup lookup HTTP status');
    return Buffer.from(await response.arrayBuffer());
  };
  const releases = JSON.parse(await get('https://api.github.com/repos/' + REPOSITORY + '/releases?per_page=100'));
  const release = releases.find(row => !row.draft && !row.prerelease && /^site-[a-f0-9]{40}-\d+-\d+$/.test(row.tag_name) && row.name === 'Static site ' + version.build_id);
  assert.ok(release, 'no retained GitHub Release for live build');
  const assetUrl = name => {
    const expected = 'https://github.com/' + REPOSITORY + '/releases/download/' + release.tag_name + '/' + name;
    assert.ok(release.assets.some(row => row.name === name && row.browser_download_url === expected), 'missing trusted backup asset ' + name);
    return expected;
  };
  const record = JSON.parse(await get(assetUrl('backup.json')));
  assert.equal(record.repository, REPOSITORY);
  assert.equal(record.tag, release.tag_name);
  assert.ok(record.tag.startsWith('site-' + record.commit + '-'));
  assert.equal(record.build_id, version.build_id);
  assert.equal(record.data_revision, version.data_revision);
  const bytes = await get(assetUrl('artifact-manifest.json'));
  assert.equal(sha256(bytes), record.files.find(row => row.name === 'artifact-manifest.json')?.sha256, 'retained manifest hash mismatch');
  return { manifest: JSON.parse(bytes), backup_url: release.html_url, commit: record.commit };
}

export async function monitorOrigin(origin, manifest, { fetch: fetcher = globalThis.fetch } = {}) {
  assert.equal(manifest.package_kind, 'published');
  assert.match(manifest.build_id, /^[a-f0-9]{64}$/);
  assert.match(manifest.data_revision, /^[a-f0-9]{64}$/);
  const entries = new Map();
  for (const row of manifest.files) {
    safeRelativePath(row.path, 'retained manifest path');
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    assert.ok(!entries.has(row.path), 'duplicate manifest path');
    entries.set(row.path, row);
  }
  const started = Date.now();
  await verifyOrigin(origin, manifest, { fetch: fetcher });
  const checks = [];
  const check = async name => {
    const expected = entries.get(name);
    assert.ok(expected, 'backup manifest missing ' + name);
    // Static Assets canonicalizes /index.html to /; compare the root document's bytes.
    const response = await fetcher(new URL(name === 'index.html' ? '/' : '/' + name, origin), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, 'content HTTP status: ' + name);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, expected.size_bytes, 'content integrity size: ' + name);
    assert.equal(sha256(bytes), expected.sha256, 'content hash: ' + name);
    checks.push({ path: name, sha256: expected.sha256, size_bytes: bytes.length });
    return bytes;
  };
  await check('version.json');
  // Cloudflare may inject per-request security JavaScript into HTML at the edge.
  // Check the public document contract; immutable JSON/JS/CSS below stay byte-pinned.
  const documentResponse = await fetcher(new URL('/', origin), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  assert.equal(documentResponse.status, 200);
  assert.match(documentResponse.headers.get('content-type') || '', /text\/html/i);
  const html = await documentResponse.text();
  const context = JSON.parse(html.match(/window\.__BUILD__\s*=\s*(\{[^<]*?\})/)?.[1] || 'null');
  assert.equal(context?.build_id, manifest.build_id, 'initial HTML build mismatch');
  assert.equal(context?.data_revision, manifest.data_revision, 'initial HTML data mismatch');
  const credit = html.match(/<a\b[^>]*href="https:\/\/darktide\.gameslantern\.com\/"[^>]*>Games Lantern<\/a>/)?.[0];
  assert.ok(credit && !/rel=["'][^"']*(?:nofollow|ugc|sponsored)/i.test(credit), 'initial Games Lantern attribution must remain follow');
  await check('robots.txt');
  if (entries.has('sitemap.xml')) await check('sitemap.xml');
  const catalog = JSON.parse(await check('data/' + manifest.data_revision + '/catalog.json'));
  for (const kind of ['skill', 'weapon', 'blessing']) {
    const entry = catalog.entries.find(row => row.kind === kind);
    assert.ok(entry, 'catalog missing ' + kind);
    await check('data/' + manifest.data_revision + '/' + entry.detail_path);
  }
  for (const row of manifest.files.filter(row => row.path.startsWith('assets/'))) await check(row.path);
  return { origin, status: 'healthy', build_id: manifest.build_id, data_revision: manifest.data_revision,
    elapsed_ms: Date.now() - started, document_check: 'build/data context and direct follow attribution; edge HTML is not byte-pinned', hash_checks: checks };
}
