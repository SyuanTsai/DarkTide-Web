import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(repoRoot, 'content', 'schema', 'v2', 'shared-release.schema.json');
const fixtureRoot = path.join(repoRoot, 'content', 'fixtures', 'v2', 'shared-release');
const validatorPath = path.join(repoRoot, 'scripts', 'content', 'contract-release.mjs');

async function loadValidator() {
  return import('../scripts/content/contract-release.mjs');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readFixture(name, fileName) {
  return readJson(path.join(fixtureRoot, name, fileName));
}

async function readFixtureManifest(name) {
  const version = await readFixture(name, 'version.json');
  const relativeManifest = version.game_releases[0].manifest_path.slice(1).split('/');
  return readJson(path.join(fixtureRoot, name, ...relativeManifest));
}

// Scenario: the formal shared-release contract is loaded by Web tooling.
// Purpose: keep the version, shared manifest, and non-publishable fixture marker governed by one Draft 2020-12 schema.
test('UnitT00_schema-defines-formal-version-manifest-and-fixture-contracts', async () => {
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));

  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.$id, 'urn:darktide-web:shared-release:2.0.0');
  assert.equal(schema.oneOf.length, 3);
  assert.equal(schema.definitions.manifestPath.pattern, '^/data/[a-f0-9]{64}/manifest\\.json$');

  const version = schema.definitions.version;
  assert.ok(version.required.includes('schema_version'));
  assert.ok(version.required.includes('data_revision'));
  assert.ok(version.required.includes('build_id'));
  assert.ok(version.required.includes('game_version'));
  assert.ok(version.required.includes('package_kind'));
  assert.ok(version.required.includes('game_releases'));
  assert.equal(version.properties.package_kind.const, 'published');
  assert.equal(version.additionalProperties, false);

  const manifest = schema.definitions.manifest;
  for (const key of [
    'schemaVersion', 'gameReleaseId', 'gameVersion', 'contentVersion', 'dataRevision',
    'source', 'web', 'compatibility', 'files', 'changeIndexPath',
  ]) assert.ok(manifest.required.includes(key), key);
  assert.deepEqual(schema.definitions.domainKind.enum, [
    'skills', 'blessings', 'weapons', 'terms', 'catalog', 'curios', 'perks',
    'classifications', 'announcements', 'game-changes',
  ]);
  assert.equal(manifest.additionalProperties, false);

  const fixtureMarker = schema.definitions.fixtureMarker;
  assert.equal(fixtureMarker.properties.fixtureOnly.const, true);
  assert.equal(fixtureMarker.properties.publicationEligible.const, false);
});

// Scenario: a shared manifest declares only compatibility features that the local Extension understands.
// Purpose: preserve the v17-D snapshot field name and known native-localization / blessing-tier dependencies while rejecting unknown features.
test('UnitT30_preserves-known-snapshot-and-native-tier-feature-contract', async () => {
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  const compatibility = schema.definitions.compatibility;
  assert.ok(compatibility.required.includes('gameSnapshotRefs'));
  assert.equal(compatibility.required.includes('gameSnapshots'), false);
  assert.deepEqual(compatibility.properties.requiredFeatures.items.enum, [
    'official-errata-details-v1',
    'official-native-localizations-v1',
    'blessing-tier-presentations-v1',
  ]);

  const { computeDataRevision, validateManifest } = await loadValidator();
  const manifest = await readFixtureManifest('valid');
  manifest.compatibility.requiredFeatures = [
    'official-native-localizations-v1',
    'blessing-tier-presentations-v1',
  ];
  manifest.dataRevision = computeDataRevision(manifest);
  assert.doesNotThrow(() => validateManifest(manifest));

  const missingNative = structuredClone(manifest);
  missingNative.compatibility.requiredFeatures = ['blessing-tier-presentations-v1'];
  missingNative.dataRevision = computeDataRevision(missingNative);
  assert.throws(() => validateManifest(missingNative), /requires official-native-localizations-v1/);

  const unknownFeature = structuredClone(manifest);
  unknownFeature.compatibility.requiredFeatures.push('unknown-feature-v1');
  unknownFeature.dataRevision = computeDataRevision(unknownFeature);
  assert.throws(() => validateManifest(unknownFeature), /unknown required feature/);
});

// Scenario: a consumer requests only a subset of the published shared domains.
// Purpose: resolve one exact patch pointer and include its declared dependencies without selecting a global maximum or a consumer-specific manifest.
test('UnitT10_valid-release-preserves-exact-patch-and-consumer-dependency-closure', async () => {
  const {
    buildManifestPath,
    computeDataRevision,
    selectConsumerFiles,
    selectGameRelease,
    validateManifest,
    validateVersion,
  } = await loadValidator();
  const version = await readFixture('valid', 'version.json');
  const manifest = await readFixtureManifest('valid');
  const fixtureMarker = await readFixture('valid', 'fixture.json');

  assert.doesNotThrow(() => validateVersion(version));
  assert.doesNotThrow(() => validateManifest(manifest));
  assert.equal(fixtureMarker.fixtureOnly, true);
  assert.equal(fixtureMarker.publicationEligible, false);
  assert.equal(computeDataRevision(manifest), manifest.dataRevision);
  assert.equal(
    buildManifestPath(manifest.dataRevision),
    '/data/' + manifest.dataRevision + '/manifest.json',
  );
  assert.equal(buildManifestPath(version.game_releases[0].data_revision), version.game_releases[0].manifest_path);
  assert.equal(selectGameRelease(version, '1.13.2').content_version, '1.13.2.1');
  assert.equal(selectGameRelease(version, '9.9.9'), null);

  const onePatchVersion = structuredClone(version);
  const oldPatch = structuredClone(version.game_releases[0]);
  oldPatch.game_version = '1.13.1';
  oldPatch.content_version = '1.13.1.99';
  oldPatch.data_revision = 'e'.repeat(64);
  oldPatch.manifest_path = buildManifestPath(oldPatch.data_revision);
  version.game_releases.push(oldPatch);
  assert.doesNotThrow(() => validateVersion(version));
  assert.equal(selectGameRelease(version, '1.13.2').content_version, '1.13.2.1');
  assert.equal(selectGameRelease(version, '1.13.1').content_version, '1.13.1.99');

  const higherRelease = structuredClone(onePatchVersion);
  higherRelease.game_releases[0].content_version = '1.13.2.9';
  higherRelease.game_releases[0].data_revision = 'f'.repeat(64);
  higherRelease.game_releases[0].manifest_path = buildManifestPath(higherRelease.game_releases[0].data_revision);
  higherRelease.game_releases[0].manifest_sha256 = 'c'.repeat(64);
  higherRelease.data_revision = higherRelease.game_releases[0].data_revision;
  assert.doesNotThrow(() => validateVersion(higherRelease));
  assert.doesNotThrow(() => validateVersion(onePatchVersion));
  assert.equal(selectGameRelease(onePatchVersion, '1.13.2').content_version, '1.13.2.1');

  const files = selectConsumerFiles(manifest, {
    requiredKinds: ['skills'],
    supportedKinds: ['skills', 'terms'],
  });
  assert.deepEqual(files.map(file => file.kind).sort(), ['skills', 'terms']);
  assert.equal(selectConsumerFiles(manifest, {
    requiredKinds: ['announcements'],
    supportedKinds: ['announcements', 'terms'],
  })[0].kind, 'announcements');
  assert.throws(() => selectConsumerFiles(manifest, {
    requiredKinds: ['skills'],
    supportedKinds: ['skills'],
  }), /dependency kind.*not supported/);
  assert.throws(() => selectConsumerFiles(manifest, {
    requiredKinds: ['not-a-domain'],
    supportedKinds: ['skills'],
  }), /unknown consumer kind/);
});

// Scenario: version or manifest metadata contains a malformed, unpinned, unsafe, or incomplete value.
// Purpose: reject invalid versions, pins, feature flags, path forms, graph references, and added consumer or executable-code projections.
test('UnitT20_rejects-invalid-release-metadata-and-dependency-graphs', async () => {
  const { validateManifest, validateVersion } = await loadValidator();
  const validVersion = await readFixture('valid', 'version.json');
  const validManifest = await readFixtureManifest('valid');

  for (const [name, mutate, expected] of [
    ['bad four-part version', value => { value.game_releases[0].content_version = '1.13.2.0'; }, /content_version/],
    ['version-scoped manifest path', value => { value.game_releases[0].manifest_path += '/1.13.2.1'; }, /manifest_path/],
    ['duplicate patch pointer', value => { value.game_releases.push({ ...value.game_releases[0], content_version: '1.13.2.2', manifest_path: value.game_releases[0].manifest_path.replace('1.13.2.1', '1.13.2.2') }); }, /duplicate game_version/],
    ['same manifest path reused across patches', value => { value.game_releases.push({ ...value.game_releases[0], game_version: '1.13.1', content_version: '1.13.1.1' }); }, /duplicate manifest_path/],
    ['top-level patch missing', value => { value.game_version = '1.13.3'; }, /game_version.*game_releases/],
    ['top-level revision mismatch', value => { value.data_revision = 'f'.repeat(64); }, /data_revision.*pointer/],
    ['nonpublished package kind', value => { value.package_kind = 'fixture'; }, /package_kind/],
  ]) {
    const version = structuredClone(validVersion);
    mutate(version);
    assert.throws(() => validateVersion(version), expected, name);
  }

  for (const [name, mutate, expected] of [
    ['invalid source SHA', value => { value.source.commit = 'not-a-git-sha'; }, /source\.commit/],
    ['invalid source revision SHA', value => { value.source.sourceRevision = 'bad-digest'; }, /source\.sourceRevision/],
    ['invalid source manifest SHA', value => { value.source.manifestSha256 = 'bad-digest'; }, /source\.manifestSha256/],
    ['wrong source repository', value => { value.source.repository = 'https://example.invalid/private'; }, /source\.repository/],
    ['unknown required feature', value => { value.compatibility.requiredFeatures.push('unknown-feature-v1'); }, /requiredFeatures/],
    ['extra consumer projection', value => { value.consumerProjection = { extension: ['skills'] }; }, /unexpected property/],
    ['extra remote-code selector', value => { value.remoteScriptTemplate = 'https://example.invalid/{patch}.js'; }, /unexpected property/],
    ['bad metadata content version', value => { value.contentVersion = '1.13.2.0'; }, /contentVersion/],
    ['bad domain path', value => { value.files[0].path = '../outside.json'; }, /path/],
    ['scheme path', value => { value.files[0].path = 'https://example.invalid/file.json'; }, /path/],
    ['encoded slash', value => { value.files[0].path = 'safe%2fescape.json'; }, /path/],
    ['backslash path', value => { value.files[0].path = 'safe\\escape.json'; }, /path/],
    ['remote executable path', value => { value.files[0].path = 'remote.js'; }, /path/],
    ['missing dependency', value => { value.files[0].dependencies = ['missing.json']; }, /dependency.*missing/],
    ['dependency cycle', value => { value.files[1].dependencies = ['skills.json']; }, /dependency cycle/],
    ['case-insensitive collision', value => { value.files.push({ ...value.files[0], path: 'Skills.json' }); }, /case-insensitive.*collision/],
    ['duplicate exact path', value => { value.files.push({ ...value.files[0] }); }, /duplicate.*path/],
    ['unknown change index', value => { value.changeIndexPath = 'missing-game-changes.json'; }, /changeIndexPath/],
    ['non game-change index', value => { value.changeIndexPath = 'announcements.json'; }, /game-changes/],
  ]) {
    const manifest = structuredClone(validManifest);
    mutate(manifest);
    assert.throws(() => validateManifest(manifest), expected, name);
  }

  const changedIdentity = structuredClone(validManifest);
  changedIdentity.web.authoringCommit = '3'.repeat(40);
  assert.throws(() => validateManifest(changedIdentity), /dataRevision.*canonical/);
});

// Scenario: a package directory contains a synthetic release fixture with real manifest and domain-file bytes.
// Purpose: verify the CLI checks version pointers, exact manifest/file hashes, dependency closure, and an announcement scope without granting publication eligibility.
test('InterT10_cli-validates-synthetic-package-bytes-and-exact-manifest-pointers', async t => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'shared-release-contract-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const run = async (fixtureName, runName = fixtureName) => {
    const root = path.join(tempRoot, runName);
    await cp(path.join(fixtureRoot, fixtureName), root, { recursive: true });
    const result = spawnSync(process.execPath, [validatorPath, '--root', root], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    return { root, result };
  };

  for (const [name, expectedDomains] of [['valid', 3], ['announcement-only', 1]]) {
    const { result } = await run(name);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /contract validation passed/);
    assert.match(result.stdout, new RegExp('domainFiles=' + expectedDomains));
    assert.match(result.stdout, /fixtureOnly=true/);
    assert.doesNotMatch(result.stdout, /approved|publicationEligible=true/i);
  }

  const { result: first } = await run('valid', 'valid-first-run');
  const { result: retry } = await run('valid', 'valid-same-digest-retry');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(retry.stdout, first.stdout);
});

// Scenario: a valid synthetic fixture is tampered, incomplete, or given an unlisted file before CLI validation.
// Purpose: prove real filesystem input is checked and that the CLI fails closed on hash, dependency, inventory, and fixture-publication violations.
test('InterT20_cli-rejects-tampered-incomplete-or-publishable-fixture-directories', async t => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'shared-release-invalid-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const runCase = async (name, mutate, expected) => {
    const root = path.join(tempRoot, name);
    await cp(path.join(fixtureRoot, 'valid'), root, { recursive: true });
    await mutate(root);
    const result = spawnSync(process.execPath, [validatorPath, '--root', root], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 1, name + ': ' + result.stdout);
    assert.match(result.stderr, expected, name);
    await rm(root, { recursive: true, force: true });
  };

  const version = await readFixture('valid', 'version.json');
  const dataRoot = path.join('data', version.data_revision);
  await runCase('wrong-domain-hash', async root => {
    const filePath = path.join(root, dataRoot, 'skills.json');
    const bytes = await readFile(filePath);
    bytes[bytes.byteLength - 1] = bytes[bytes.byteLength - 1] === 0x0a ? 0x20 : 0x0a;
    await writeFile(filePath, bytes);
  }, /SHA-256 mismatch/);
  await runCase('missing-domain-dependency', async root => {
    await rm(path.join(root, dataRoot, 'terms.json'));
  }, /missing file/);
  await runCase('unlisted-file', async root => {
    await writeFile(path.join(root, 'unlisted.json'), '{}\n');
  }, /unlisted file/);
  await runCase('publishable-fixture-marker', async root => {
    const markerPath = path.join(root, 'fixture.json');
    const marker = await readJson(markerPath);
    marker.publicationEligible = true;
    await writeFile(markerPath, JSON.stringify(marker, null, 2) + '\n');
  }, /publicationEligible/);
  await runCase('wrong-manifest-sha', async root => {
    const versionPath = path.join(root, 'version.json');
    const version = await readJson(versionPath);
    version.game_releases[0].manifest_sha256 = 'f'.repeat(64);
    await writeFile(versionPath, JSON.stringify(version, null, 2) + '\n');
  }, /manifest SHA-256 mismatch/);
  await runCase('mixed-patch-manifest-identity', async root => {
    const versionPath = path.join(root, 'version.json');
    const version = await readJson(versionPath);
    const manifestPath = path.join(root, ...version.game_releases[0].manifest_path.slice(1).split('/'));
    const manifest = await readJson(manifestPath);
    manifest.gameVersion = '1.13.1';
    manifest.contentVersion = '1.13.1.1';
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    version.game_releases[0].manifest_sha256 = createHash('sha256').update(manifestBytes).digest('hex');
    await writeFile(manifestPath, manifestBytes);
    await writeFile(versionPath, JSON.stringify(version, null, 2) + '\n');
  }, /release identity do not match/);
});
