import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { computeDataRevision } from '../scripts/content/contract-release.mjs';
import { loadSharedRelease } from '../web/shared-client.mjs';
import { installTestLocation, jsonResponse } from './w11-shared-client.fixture.mjs';

const PROPOSAL_ID = 'c41434cc510b4d28b91e59a14ac681e5aa973a09958ba3b7eb03d10eb13a8a00';
const CANDIDATE_ROOT = new URL(`../content/contracts/w09/proposals/${PROPOSAL_ID}/candidate/`, import.meta.url);
const EXPECTED_MANIFEST_SHA256 = '71d9ae708ea3c209b3831295b499f4b584720cd5622d9a915faa9a597f38da36';
const EXPECTED_WEAPONS_SHA256 = '5f86b049f411883abd60378b2717590202a2322aa7b221241f84bc8003358605';
const EXPECTED_WEAPONS_BYTES = 13_987_749;
const MAX_DOMAIN_BYTES = 16 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 24 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function readCandidate() {
  const manifestBytes = await readFile(new URL('manifest.json', CANDIDATE_ROOT));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const domainBytes = new Map();
  for (const file of manifest.files) {
    domainBytes.set(file.path, await readFile(new URL(file.path, CANDIDATE_ROOT)));
  }
  return { manifest, manifestBytes, domainBytes };
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
    sharedFiles,
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

test('UnitT10_loads-the-exact-approved-W09-package-with-its-14MB-weapons-domain', async t => {
  installTestLocation(t);
  const { manifest, manifestBytes, domainBytes } = await readCandidate();
  const weapon = manifest.files.find(file => file.kind === 'weapons');
  const packageInfo = createPackage(manifest, manifestBytes, domainBytes);
  const totalSelectedBytes = manifestBytes.byteLength + manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const calls = [];

  assert.equal(sha256(manifestBytes), EXPECTED_MANIFEST_SHA256);
  assert.equal(manifest.dataRevision, '279268c69260b03a6c7613f4346fe74c9eaaaeff7e94860a01190d1cec921575');
  assert.equal(weapon.sizeBytes, EXPECTED_WEAPONS_BYTES);
  assert.equal(weapon.sha256, EXPECTED_WEAPONS_SHA256);
  assert.ok(weapon.sizeBytes < MAX_DOMAIN_BYTES);
  assert.ok(totalSelectedBytes < MAX_PACKAGE_BYTES, 'the approved complete six-domain package fits the aggregate bound');
  for (const file of manifest.files) {
    const bytes = domainBytes.get(file.path);
    assert.equal(bytes.byteLength, file.sizeBytes, `${file.path} exact size`);
    assert.equal(sha256(bytes), file.sha256, `${file.path} exact digest`);
  }

  const result = await loadSharedRelease({ build: packageInfo.build, fetchImpl: makeFetch(packageInfo.responses, calls) });

  assert.equal(result.status, 'ready');
  assert.equal(result.manifest.dataRevision, manifest.dataRevision);
  assert.equal(result.domains.find(domain => domain.kind === 'weapons')?.kind, 'weapons');
  assert.deepEqual(Buffer.from(result.rawFiles.get(`/data/${manifest.dataRevision}/domains/weapons.json`)),
    domainBytes.get('domains/weapons.json'));
  assert.equal(result.rawFiles.size, manifest.files.length + 1);
  assert.ok(calls.includes(`/data/${manifest.dataRevision}/domains/weapons.json`),
    'the shared consumer validates and loads the weapons core domain even on a non-weapon route');
});

test('UnitT20_rejects-a-domain-above-the-new-16MiB-bound-before-fetching-domains', async t => {
  installTestLocation(t);
  const { manifest, domainBytes } = await readCandidate();
  const weapon = manifest.files.find(file => file.kind === 'weapons');
  weapon.sizeBytes = MAX_DOMAIN_BYTES + 1;
  const manifestBytes = recalculateManifest(manifest);
  const packageInfo = createPackage(manifest, manifestBytes, domainBytes);
  const calls = [];

  await assert.rejects(
    loadSharedRelease({ build: packageInfo.build, fetchImpl: makeFetch(packageInfo.responses, calls) }),
    /sizeBytes exceeds the supported limit/u,
  );
  assert.deepEqual(calls, [packageInfo.pointer.manifest_path],
    'the domain bound is checked from the pinned manifest before the client fetches a domain');
});

test('UnitT30_keeps-the-aggregate-shared-package-bound-at-24MiB', async t => {
  installTestLocation(t);
  const { manifest, domainBytes } = await readCandidate();
  const changes = manifest.files.find(file => file.kind === 'game-changes');
  const paddedChanges = Buffer.concat([domainBytes.get(changes.path), Buffer.alloc(9 * 1024 * 1024, 0x20)]);
  domainBytes.set(changes.path, paddedChanges);
  changes.sizeBytes = paddedChanges.byteLength;
  changes.sha256 = sha256(paddedChanges);
  const manifestBytes = recalculateManifest(manifest);
  const packageInfo = createPackage(manifest, manifestBytes, domainBytes);
  const totalSelectedBytes = manifestBytes.byteLength + manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const calls = [];

  assert.ok(changes.sizeBytes < MAX_DOMAIN_BYTES, 'the padded optional domain remains inside the per-domain bound');
  assert.ok(totalSelectedBytes > MAX_PACKAGE_BYTES, 'the complete selected package exceeds the aggregate bound');
  await assert.rejects(
    loadSharedRelease({ build: packageInfo.build, fetchImpl: makeFetch(packageInfo.responses, calls) }),
    /selected shared domains exceed the package byte limit/u,
  );
  const announcements = manifest.files.find(file => file.kind === 'announcements');
  assert.ok(calls.includes(`/data/${manifest.dataRevision}/${changes.path}`),
    'the verified change index fits within the running aggregate bound');
  assert.ok(!calls.includes(`/data/${manifest.dataRevision}/${announcements.path}`),
    'the aggregate limit rejects the package before downloading its final optional domain');
});
