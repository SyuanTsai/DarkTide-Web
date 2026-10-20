import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStaticSite } from '../src/static/build.mjs';
import { verifyStaticPackage } from '../src/static/verify.mjs';
import { loadSharedReleaseFixture } from '../src/static/shared-release.mjs';
import { createDataClient } from '../web/client.mjs';
import { ACCOUNT_ID, deployVerifiedArtifact } from '../src/deploy/cloudflare.mjs';
import { createBuildRoot, disposeBuildRoot } from './static-test-helpers.mjs';
import { sha256 } from '../src/static/common.mjs';
import { fixturePublicContent } from '../src/static/fixture.mjs';
import { computeDataRevision } from '../scripts/content/contract-release.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

function officialInputWithParameterToken() {
  const token = '{damage:%s}';
  const before = 'Damage ';
  const after = '.';
  const value = '40';
  const segments = [
    { segmentId: 'damage-label', kind: 'text', text: before, sha256: sha256(Buffer.from(before, 'utf8')) },
    { segmentId: 'damage-value', kind: 'parameter', parameterId: 'damage', token, sha256: sha256(Buffer.from(token, 'utf8')) },
    { segmentId: 'damage-period', kind: 'text', text: after, sha256: sha256(Buffer.from(after, 'utf8')) },
  ];
  const sourceText = before + token + after;
  const resolvedText = before + value + after;
  return {
    officialSourceId: 'fixture:official:skill-damage',
    entityRef: { recordId: 'fixture:skill:damage', gameReleaseId: 'synthetic-release-1-13-2-valid', kind: 'skill' },
    origin: 'game-localization',
    sourceLocale: 'en',
    resource: 'synthetic_localization',
    key: 'fixture_skill_damage',
    occurrence: 0,
    sourceText,
    sourceTextSha256: sha256(Buffer.from(sourceText, 'utf8')),
    segments,
    params: [{ parameterId: 'damage', sourceKey: 'damage', value }],
    resolvedText,
    resolvedTextSha256: sha256(Buffer.from(resolvedText, 'utf8')),
  };
}

function sharedBundleWithOfficialInput(baseBundle, { domainKind = 'skills', addPrivateToken = false, unlinkedPresentation = false } = {}) {
  const basePointer = baseBundle.version.game_releases[0];
  const baseManifest = JSON.parse(baseBundle.files.get(basePointer.manifest_path.slice(1)).toString('utf8'));
  const domainFiles = new Map(baseManifest.files.map(row => [row.path, Buffer.from(
    baseBundle.files.get('data/' + basePointer.data_revision + '/' + row.path),
  )]));
  const targetRow = baseManifest.files.find(row => row.kind === domainKind);
  assert.ok(targetRow, 'the selected W02 fixture contains the requested domain');
  const domain = JSON.parse(domainFiles.get(targetRow.path).toString('utf8'));
  const official = officialInputWithParameterToken();
  const presentationOfficial = structuredClone(official);
  if (unlinkedPresentation) presentationOfficial.officialSourceId = 'fixture:official:unlinked';
  domain.web = { officialInputs: { sources: [official] }, presentations: [{ official: presentationOfficial }] };
  if (addPrivateToken) domain.web.privateMetadata = { token: 'must remain rejected' };
  domainFiles.set(targetRow.path, Buffer.from(JSON.stringify(domain, null, 2) + '\n', 'utf8'));

  const manifest = structuredClone(baseManifest);
  manifest.contentVersion = manifest.gameVersion + '.2';
  for (const row of manifest.files) {
    const bytes = domainFiles.get(row.path);
    row.sizeBytes = bytes.byteLength;
    row.sha256 = sha256(bytes);
  }
  const dataRevision = computeDataRevision(manifest);
  manifest.dataRevision = dataRevision;
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const pointer = {
    game_version: manifest.gameVersion,
    content_version: manifest.contentVersion,
    data_revision: dataRevision,
    manifest_path: '/data/' + dataRevision + '/manifest.json',
    manifest_sha256: sha256(manifestBytes),
  };
  const version = structuredClone(baseBundle.version);
  version.data_revision = dataRevision;
  version.game_releases = [pointer];
  const files = new Map([[pointer.manifest_path.slice(1), manifestBytes]]);
  for (const [relativePath, bytes] of domainFiles) files.set('data/' + dataRevision + '/' + relativePath, bytes);
  const sourceLock = {
    schema: 'w09-public-source-lock/1',
    repository: manifest.source.repository,
    source_revision: manifest.source.sourceRevision,
    source_manifest_sha256: manifest.source.manifestSha256,
    game_release_id: manifest.gameReleaseId,
    game_version: manifest.gameVersion,
    content_version: manifest.contentVersion,
  };
  const sourceLockBytes = Buffer.from(JSON.stringify(sourceLock, null, 2) + '\n', 'utf8');
  files.set('source-locks/' + manifest.source.sourceRevision + '/' + sha256(sourceLockBytes) + '.json', sourceLockBytes);
  return { ...baseBundle, version, files, retainedReleases: [] };
}

test('UnitT10_loads_a_W02_shared_release_fixture_as_explicit_nonpublishable_input', async () => {
  const bundle = await loadSharedReleaseFixture({ repoRoot: REPOSITORY_ROOT });
  assert.equal(bundle.packageKind, 'fixture');
  assert.equal(bundle.version.package_kind, 'fixture');
  assert.equal(bundle.fixtureMarker.fixtureOnly, true);
  assert.equal(bundle.fixtureMarker.publicationEligible, false);
  assert.equal(bundle.version.game_releases.length, 1);
  assert.equal(bundle.files.has(bundle.version.game_releases[0].manifest_path.slice(1)), true);
  assert.equal(bundle.files.size, 5, 'the validated W02 fixture maps to a manifest, three domains, and one public Source lock');
  const sourceLockPath = bundle.metadata.source_locks[0].path.slice(1);
  const sourceLockBytes = bundle.files.get(sourceLockPath);
  assert.equal(bundle.metadata.source_locks[0].sha256, sha256(sourceLockBytes));
  assert.equal(path.basename(sourceLockPath), sha256(sourceLockBytes) + '.json',
    'a retained lock path must change when its public lock bytes change');
  assert.doesNotMatch(sourceLockBytes.toString('utf8'), /sourceCommit|sourceCheckout|privatePath/i);
});

test('InterT10_static_package_retains_and_verifies_older_approved_release_urls', async () => {
  const root = await createBuildRoot();
  try {
    const bundle = await loadSharedReleaseFixture({ repoRoot: REPOSITORY_ROOT });
    const priorPointer = bundle.version.game_releases[0];
    const priorManifest = JSON.parse(bundle.files.get(priorPointer.manifest_path.slice(1)).toString('utf8'));
    const nextDomainFiles = new Map(priorManifest.files.map(row => [row.path, Buffer.from(bundle.files.get('data/' + priorPointer.data_revision + '/' + row.path))]));
    const changedDomain = Buffer.from(JSON.stringify({ entries: [{ id: 'retained-next-release' }] }) + '\n');
    nextDomainFiles.set('skills.json', changedDomain);
    const nextManifest = structuredClone(priorManifest);
    nextManifest.contentVersion = priorPointer.game_version + '.2';
    for (const row of nextManifest.files) {
      const bytes = nextDomainFiles.get(row.path);
      row.sizeBytes = bytes.byteLength;
      row.sha256 = sha256(bytes);
    }
    const nextRevision = computeDataRevision(nextManifest);
    nextManifest.dataRevision = nextRevision;
    const nextManifestBytes = Buffer.from(JSON.stringify(nextManifest, null, 2) + '\n');
    const nextPointer = {
      game_version: priorPointer.game_version,
      content_version: nextManifest.contentVersion,
      data_revision: nextRevision,
      manifest_path: '/data/' + nextRevision + '/manifest.json',
      manifest_sha256: sha256(nextManifestBytes),
    };
    const files = new Map(bundle.files);
    files.set(nextPointer.manifest_path.slice(1), nextManifestBytes);
    for (const [name, bytes] of nextDomainFiles) files.set('data/' + nextRevision + '/' + name, bytes);
    const sourceLock = {
      schema: 'w09-public-source-lock/1',
      repository: nextManifest.source.repository,
      source_revision: nextManifest.source.sourceRevision,
      source_manifest_sha256: nextManifest.source.manifestSha256,
      game_release_id: nextManifest.gameReleaseId,
      game_version: nextManifest.gameVersion,
      content_version: nextManifest.contentVersion,
    };
    const sourceLockBytes = Buffer.from(JSON.stringify(sourceLock, null, 2) + '\n');
    files.set('source-locks/' + nextManifest.source.sourceRevision + '/' + sha256(sourceLockBytes) + '.json', sourceLockBytes);
    const sharedRelease = { ...bundle, files, retainedReleases: [priorPointer, nextPointer] };
    await buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), sharedRelease });
    const report = await verifyStaticPackage(path.join(root, 'dist'));
    const version = await readJson(path.join(root, 'dist', 'version.json'));
    assert.equal(version.game_releases.length, 1, 'the closed W02 current-pointer contract stays unchanged');
    assert.equal(report.retained_releases.length, 2, 'the shared context retains both current and older approved pointers');
    assert.ok(report.shared_files.some(row => row.path === nextPointer.manifest_path));
    assert.ok(report.shared_files.some(row => row.path === '/data/' + nextRevision + '/skills.json'));
    const retainedDomain = path.join(root, 'dist', 'data', nextRevision, 'skills.json');
    await writeFile(retainedDomain, Buffer.from('{}\n'));
    await assert.rejects(verifyStaticPackage(path.join(root, 'dist')), /integrity|hash|shared/i);
  } finally {
    await disposeBuildRoot(root);
  }
});

test('InterT10_builds_and_verifies_shared_static_data_while_preserving_legacy_runtime_urls', async () => {
  const root = await createBuildRoot({ productionWeb: true });
  const bundle = await loadSharedReleaseFixture({ repoRoot: REPOSITORY_ROOT });
  try {
    const publishedDirectory = path.join(root, 'content', 'published');
    await mkdir(publishedDirectory, { recursive: true });
    await writeFile(path.join(publishedDirectory, 'content.json'), await readFile(path.join(REPOSITORY_ROOT, 'content/published/content.json')));
    const legacyBuild = await buildStaticSite({ root });
    const legacyManifest = await readJson(path.join(root, 'dist', 'artifact-manifest.json'));
    const legacyFiles = new Map();
    for (const row of legacyManifest.files) {
      if (row.path.startsWith('data/')) legacyFiles.set(row.path, await readFile(path.join(root, 'dist', ...row.path.split('/'))));
    }

    const result = await buildStaticSite({ root, sharedRelease: bundle });
    const dist = path.join(root, 'dist');
    const report = await verifyStaticPackage(dist);
    const version = await readJson(path.join(dist, 'version.json'));
    const artifactManifest = await readJson(path.join(dist, 'artifact-manifest.json'));
    const contextMatch = /<script>\s*window\.__BUILD__\s*=\s*(\{[^<]*?\})\s*;?\s*<\/script>/.exec(await readFile(path.join(dist, 'index.html'), 'utf8'));
    assert.ok(contextMatch, 'the verified index includes the legacy and shared metadata bridge');
    const context = JSON.parse(contextMatch[1]);

    assert.equal(result.package_kind, 'fixture');
    assert.equal(report.package_kind, 'fixture');
    assert.equal(report.runtime_data_revision, legacyBuild.data_revision);
    assert.equal(report.shared_data_revision, bundle.version.data_revision);
    assert.equal(version.data_revision, bundle.version.data_revision);
    assert.deepEqual(version.game_releases, bundle.version.game_releases);
    assert.equal(artifactManifest.data_revision, bundle.version.data_revision);
    assert.equal(context.data_revision, legacyBuild.data_revision, 'legacy catalog URLs continue using the prior runtime revision');
    assert.equal(context.package_kind, 'published', 'the retained catalog keeps its original public package semantics');
    assert.equal(context.shared_data_revision, bundle.version.data_revision);
    assert.equal(context.shared_package_kind, 'fixture');
    assert.deepEqual(context.game_releases, bundle.version.game_releases);
    assert.deepEqual(context.source_locks, bundle.metadata.source_locks);
    assert.equal(context.shared_fixture_only, true);
    for (const [relativePath, bytes] of legacyFiles) {
      assert.deepEqual(await readFile(path.join(dist, ...relativePath.split('/'))), bytes, relativePath);
    }
    for (const [relativePath, bytes] of bundle.files) {
      assert.deepEqual(await readFile(path.join(dist, ...relativePath.split('/'))), bytes, relativePath);
    }

    const deployConfig = {
      account_id: ACCOUNT_ID,
      name: 'darktide-zh-tw',
      assets: { directory: './dist', not_found_handling: 'none' },
      workers_dev: true,
      routes: [{ pattern: 'darktide.tw-syuan.com', custom_domain: true }],
    };
    let mutated = false;
    await assert.rejects(deployVerifiedArtifact({ token: 'fixture-test-value', config: deployConfig }, {
      verify: async () => report,
      api: async () => { mutated = true; throw new Error('must not call deployment API'); },
      record: async () => { mutated = true; },
      deploy: async () => { mutated = true; },
      check: async () => { mutated = true; },
    }), /only verified published artifacts may deploy/);
    assert.equal(mutated, false, 'the existing deploy boundary rejects fixture packages before side effects');

    const sharedDomain = bundle.version.game_releases[0].data_revision;
    const sharedFile = path.join(dist, 'data', sharedDomain, 'skills.json');
    await (await import('node:fs/promises')).writeFile(sharedFile, '{}', 'utf8');
    await assert.rejects(verifyStaticPackage(dist), /integrity|hash|shared|manifest-listed/i);
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT20_shared_version_metadata_does_not_make_the_legacy_catalog_stale_but_new_shared_release_is_detected', async () => {
  const root = await createBuildRoot({ productionWeb: true });
  try {
    const publishedDirectory = path.join(root, 'content', 'published');
    await mkdir(publishedDirectory, { recursive: true });
    await writeFile(path.join(publishedDirectory, 'content.json'), await readFile(path.join(REPOSITORY_ROOT, 'content/published/content.json')));
    const legacyBuild = await buildStaticSite({ root });
    const bundle = await loadSharedReleaseFixture({ repoRoot: REPOSITORY_ROOT });
    await buildStaticSite({ root, sharedRelease: bundle });
    const dist = path.join(root, 'dist');
    const version = await readJson(path.join(dist, 'version.json'));
    const index = await readFile(path.join(dist, 'index.html'), 'utf8');
    const context = JSON.parse(/<script>\s*window\.__BUILD__\s*=\s*(\{[^<]*?\})\s*;?\s*<\/script>/.exec(index)[1]);
    const client = createDataClient({ build: context, fetchImpl: async () => new Response(JSON.stringify(version), {
      status: 200, headers: { 'content-type': 'application/json' },
    }) });
    assert.equal(context.data_revision, legacyBuild.data_revision);
    assert.equal(await client.hasBuildUpdate(), false, 'the W02 top-level shared revision must not trigger perpetual legacy updates');

    const nextVersion = structuredClone(version);
    nextVersion.build_id = 'a'.repeat(64);
    nextVersion.data_revision = 'b'.repeat(64);
    nextVersion.game_releases[0].data_revision = nextVersion.data_revision;
    nextVersion.game_releases[0].manifest_path = '/data/' + nextVersion.data_revision + '/manifest.json';
    const nextClient = createDataClient({ build: context, fetchImpl: async () => new Response(JSON.stringify(nextVersion), {
      status: 200, headers: { 'content-type': 'application/json' },
    }) });
    assert.equal(await nextClient.hasBuildUpdate(), true, 'a new shared release still signals a site update');
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT21_public_official_parameter_tokens_are_allowed_only_in_validated_skill_inputs', async () => {
  const root = await createBuildRoot();
  try {
    const base = await loadSharedReleaseFixture({ repoRoot: REPOSITORY_ROOT });
    const validBundle = sharedBundleWithOfficialInput(base);
    await buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), sharedRelease: validBundle });
    const report = await verifyStaticPackage(path.join(root, 'dist'));
    assert.equal(report.package_kind, 'fixture');
    const pointer = validBundle.version.game_releases[0];
    const skillsPath = path.join(root, 'dist', 'data', pointer.data_revision, 'skills.json');
    const skills = await readJson(skillsPath);
    assert.equal(skills.web.officialInputs.sources[0].segments[1].token, '{damage:%s}');

    const genericTokenBundle = sharedBundleWithOfficialInput(base, { addPrivateToken: true });
    await assert.rejects(buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), sharedRelease: genericTokenBundle }),
      /public JSON contains a private field: token/);

    const unrelatedDomainBundle = sharedBundleWithOfficialInput(base, { domainKind: 'terms' });
    await assert.rejects(buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), sharedRelease: unrelatedDomainBundle }),
      /public JSON contains a private field: token/);

    const unlinkedBundle = sharedBundleWithOfficialInput(base, { unlinkedPresentation: true });
    await assert.rejects(buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), sharedRelease: unlinkedBundle }),
      /presentation official input does not match its validated official source identity/);
  } finally {
    await disposeBuildRoot(root);
  }
});
