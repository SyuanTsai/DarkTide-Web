import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { computeDataRevision } from '../scripts/content/contract-release.mjs';
import { loadSharedRelease } from '../web/shared-client.mjs';
import { installTestLocation, jsonResponse } from './w11-shared-client.fixture.mjs';
import { makeCompiledGameChangesPackage } from './w12-shared-view.fixture.mjs';

const MAX_DOMAIN_BYTES = 16 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 24 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function readCandidate() {
  const compiled = await makeCompiledGameChangesPackage();
  const manifest = structuredClone(compiled.manifest);
  const manifestBytes = Buffer.from(JSON.stringify(manifest) + '\n', 'utf8');
  return { manifest, manifestBytes, domainBytes: new Map(compiled.files) };
}

function createPackage(manifest, manifestBytes, domainBytes) {
  const pointer = {
    game_version: manifest.gameVersion,
    content_version: manifest.contentVersion,
    data_revision: manifest.dataRevision,
    manifest_path: `/data/${manifest.dataRevision}/manifest.json`,
    manifest_sha256: sha256(manifestBytes),
  };
  const sharedFiles = [
    { path: pointer.manifest_path, size_bytes: manifestBytes.byteLength, sha256: pointer.manifest_sha256 },
    ...manifest.files.map(file => ({
      path: `/data/${manifest.dataRevision}/${file.path}`,
      size_bytes: file.sizeBytes,
      sha256: file.sha256,
    })),
  ];
  const responses = new Map([[pointer.manifest_path, manifestBytes]]);
  for (const file of manifest.files) {
    const bytes = domainBytes.get(file.path);
    if (bytes) responses.set(`/data/${manifest.dataRevision}/${file.path}`, bytes);
  }
  return {
    pointer,
    responses,
    build: {
      shared_game_version: manifest.gameVersion,
      shared_data_revision: manifest.dataRevision,
      shared_files: sharedFiles,
      game_releases: [pointer],
      shared_package_kind: 'published',
    },
  };
}

function makeFetch(responses, calls = []) {
  return async url => {
    const parsed = new URL(url);
    calls.push(parsed.pathname);
    const bytes = responses.get(parsed.pathname);
    return bytes
      ? jsonResponse(parsed.href, bytes)
      : jsonResponse(parsed.href, Buffer.from('{}'), { status: 404 });
  };
}

function recalculateManifest(manifest) {
  manifest.dataRevision = computeDataRevision(manifest);
  return Buffer.from(JSON.stringify(manifest) + '\n', 'utf8');
}

function padJson(bytes, targetBytes) {
  assert.ok(targetBytes > bytes.byteLength);
  return Buffer.concat([bytes, Buffer.alloc(targetBytes - bytes.byteLength, 0x20)]);
}

test('UnitT10_split_files_and_every_named_route_stay_within_the_existing_limits', async t => {
  installTestLocation(t);
  const { manifest, manifestBytes, domainBytes } = await readCandidate();
  for (const file of manifest.files) {
    const bytes = domainBytes.get(file.path);
    assert.equal(bytes.byteLength, file.sizeBytes, `${file.path} exact size`);
    assert.equal(sha256(bytes), file.sha256, `${file.path} exact digest`);
    assert.ok(file.sizeBytes <= MAX_DOMAIN_BYTES, `${file.path} is within 16 MiB`);
  }

  const weaponIndex = manifest.files.find(file => file.kind === 'weapons-index');
  const blessingIndex = manifest.files.find(file => file.kind === 'blessings-index');
  const family = manifest.files.find(file => file.kind === 'weapon-family');
  const blessing = manifest.files.find(file => file.kind === 'blessing');
  const routeSets = [
    [weaponIndex],
    [weaponIndex, family, blessingIndex],
    [blessingIndex],
    [blessingIndex, blessing, weaponIndex],
  ];
  for (const route of routeSets) {
    const routeBytes = manifestBytes.byteLength
      + [...new Map(route.map(file => [file.path, file])).values()].reduce((sum, file) => sum + file.sizeBytes, 0);
    assert.ok(routeBytes <= MAX_PACKAGE_BYTES);
  }

  const packageInfo = createPackage(manifest, manifestBytes, domainBytes);
  const calls = [];
  const result = await loadSharedRelease({
    build: packageInfo.build,
    fetchImpl: makeFetch(packageInfo.responses, calls),
    pathname: '/weapons/',
    search: '?family=fixture-family&mark=fixture-mark',
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.domains.map(domain => domain.kind).sort(),
    ['blessings-index', 'weapon-family', 'weapons-index']);
  assert.equal(result.rawFiles.size, 4, 'manifest plus the three route files are loaded');
});

test('UnitT20_rejects_a_split_file_above_16MiB_before_fetching_domains', async t => {
  installTestLocation(t);
  const { manifest, domainBytes } = await readCandidate();
  const family = manifest.files.find(file => file.kind === 'weapon-family');
  family.sizeBytes = MAX_DOMAIN_BYTES + 1;
  const manifestBytes = recalculateManifest(manifest);
  const packageInfo = createPackage(manifest, manifestBytes, domainBytes);
  const calls = [];

  await assert.rejects(
    loadSharedRelease({
      build: packageInfo.build,
      fetchImpl: makeFetch(packageInfo.responses, calls),
      pathname: '/weapons/',
      search: '?family=fixture-family',
    }),
    /sizeBytes exceeds the supported limit/u,
  );
  assert.deepEqual(calls, [packageInfo.pointer.manifest_path]);
});

test('UnitT30_keeps_the_per_route_bound_at_24MiB_for_split_detail_routes', async t => {
  installTestLocation(t);
  const { manifest, domainBytes } = await readCandidate();
  const family = manifest.files.find(file => file.kind === 'weapon-family');
  const blessingIndex = manifest.files.find(file => file.kind === 'blessings-index');
  for (const [file, targetBytes] of [[family, 13 * 1024 * 1024], [blessingIndex, 12 * 1024 * 1024]]) {
    const padded = padJson(domainBytes.get(file.path), targetBytes);
    domainBytes.set(file.path, padded);
    file.sizeBytes = padded.byteLength;
    file.sha256 = sha256(padded);
    assert.ok(file.sizeBytes < MAX_DOMAIN_BYTES);
  }
  const manifestBytes = recalculateManifest(manifest);
  const packageInfo = createPackage(manifest, manifestBytes, domainBytes);
  const calls = [];

  await assert.rejects(
    loadSharedRelease({
      build: packageInfo.build,
      fetchImpl: makeFetch(packageInfo.responses, calls),
      pathname: '/weapons/',
      search: '?family=fixture-family',
    }),
    /selected shared domains exceed the package byte limit/u,
  );
  assert.deepEqual(calls, [
    packageInfo.pointer.manifest_path,
    `/data/${manifest.dataRevision}/${blessingIndex.path}`,
    `/data/${manifest.dataRevision}/${manifest.files.find(file => file.kind === 'weapons-index').path}`,
  ], 'the existing running route bound rejects before fetching the family that would cross 24 MiB');
});
