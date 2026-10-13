import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertExactOutputInventory, buildW01 } from '../scripts/w01-build.mjs';
import { jsonBytes } from '../src/static/common.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const domainKinds = ['skills', 'blessings', 'weapons', 'terms', 'game-changes'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function withTempDirectory(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-'));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function copyBuildInputs(destination) {
  await cp(path.join(repoRoot, 'content', 'w01'), path.join(destination, 'content', 'w01'), { recursive: true });
  await cp(path.join(repoRoot, 'source.lock.json'), path.join(destination, 'source.lock.json'));
}

async function readBuildFiles(buildRoot) {
  const output = new Map();
  for (const name of await readdir(buildRoot, { recursive: true })) {
    const absolute = path.join(buildRoot, name);
    const stat = await import('node:fs/promises').then(({ stat }) => stat(absolute));
    if (stat.isFile()) output.set(name.replaceAll(path.sep, '/'), await readFile(absolute));
  }
  return output;
}

// Scenario: the same pinned Source and Web fixture are compiled twice in clean directories.
// Purpose: generated output is reproducible and the shared package preserves v17-A ownership/identity and v17-D metadata.
test('UnitT00_deterministic-build-preserves-v17-contract-and-fixture-erratum', async () => {
  await withTempDirectory(async tempRoot => {
    const firstRoot = path.join(tempRoot, 'first');
    const secondRoot = path.join(tempRoot, 'second');
    const first = await buildW01({ repoRoot, outputRoot: firstRoot });
    const second = await buildW01({ repoRoot, outputRoot: secondRoot });
    const firstFiles = await readBuildFiles(firstRoot);
    const secondFiles = await readBuildFiles(secondRoot);

    assert.deepEqual([...firstFiles.keys()], [...secondFiles.keys()]);
    for (const [name, bytes] of firstFiles) assert.deepEqual(bytes, secondFiles.get(name), name);
    assert.equal(first.dataRevision, second.dataRevision);
    assert.equal(first.buildId, second.buildId);
    assert.equal(first.receipt.fixtureOnly, true);
    assert.equal(first.receipt.publicationEligible, false);
    assert.equal(first.receipt.formalPublishAllowed, false);

    const manifest = JSON.parse(await readFile(path.join(firstRoot, 'data', first.dataRevision, 'manifest.json'), 'utf8'));
    const domains = Object.fromEntries(await Promise.all(manifest.files
      .filter(file => domainKinds.includes(file.kind))
      .map(async file => [file.kind, JSON.parse(await readFile(path.join(firstRoot, 'data', first.dataRevision, file.path), 'utf8'))])));
    const version = JSON.parse(await readFile(path.join(firstRoot, 'version.json'), 'utf8'));
    const preview = JSON.parse(await readFile(path.join(firstRoot, 'preview.json'), 'utf8'));
    const allRecords = Object.values(domains).flatMap(domain => domain.records);
    const ids = new Set(allRecords.map(record => record.recordId));

    assert.deepEqual(new Set(Object.keys(domains)), new Set(domainKinds));
    assert.equal(manifest.schemaVersion, '2.0.0');
    assert.equal(manifest.compatibility.dataContractMajor, 2);
    assert.deepEqual(manifest.compatibility.requiredFeatures, ['official-errata-details-v1']);
    assert.equal(manifest.changeIndexPath, 'game-changes.json');
    assert.equal(version.schema_version, 2);
    assert.equal(version.package_kind, 'fixture');
    assert.equal(version.game_releases[0].content_version, '0.0.1');
    assert.equal(version.game_releases[0].manifest_path, '/data/' + first.dataRevision + '/manifest.json');
    assert.equal(version.game_releases[0].manifest_sha256, first.manifestSha256);
    assert.equal(manifest.source.commit, 'fa8711c3cab784b83238709e728f3df497b2624a');
    assert.equal(manifest.source.sourceRevision, '94d2e7767bf60d56793a6b9a910376c975fef3439afe5931fbb03d763913ef4b');

    for (const record of allRecords) {
      const registry = record.owner === 'web' ? manifest.web.references : manifest.source.references;
      for (const sourceRef of record.sourceRefs ?? []) {
        assert.ok(registry.some(reference => reference.sourceId === sourceRef), record.recordId + ' has unresolved owner sourceRef ' + sourceRef);
      }
    }
    assert.ok(manifest.source.references.some(reference => reference.sourceId === 'fixture:snapshot:upstream'));
    assert.ok(manifest.web.references.some(reference => reference.sourceId === 'fixture:official-source:smite'));
    assert.ok(ids.has('fixture:claim:smite-damage'));
    assert.ok(ids.has('fixture:evidence:smite-template'));
    assert.ok(ids.has('fixture:blessing-variant:sample-tier'));
    assert.ok(ids.has('fixture:weapon:sample'));
    assert.ok(ids.has('fixture:weapon-stat:sample'));
    assert.ok(ids.has('fixture:curve:sample'));
    assert.ok(ids.has('fixture:term:smite'));
    const termLocalization = domains.terms.records.find(record => record.kind === 'term-localization');
    assert.equal(termLocalization.entityRef, 'fixture:term:smite');
    assert.equal(termLocalization.locale, 'zh-TW');

    const skill = domains.skills.records.find(record => record.recordId === 'web:presentation:fixture-skill-smite');
    assert.equal(skill.entityRef, 'fixture:skill:smite');
    assert.equal(skill.locale, 'zh-TW');
    assert.equal(skill.payload.official.sourceText, 'Cooldown: 40 seconds.');
    assert.equal(skill.payload.official.sourceTextSha256, sha256(Buffer.from(skill.payload.official.sourceText, 'utf8')));
    assert.equal(skill.payload.official.segments[0].text, 'Cooldown: 40 seconds.');
    assert.equal(skill.payload.official.segments[0].sha256, skill.payload.official.sourceTextSha256);
    assert.equal(skill.payload.official.resolvedText, 'Cooldown: 40 seconds.');
    assert.equal(skill.payload.official.resolvedTextSha256, skill.payload.official.sourceTextSha256);
    assert.equal(skill.payload.official.localizations['zh-TW'].text, '冷卻時間：40 秒。');
    assert.equal(skill.payload.official.localizations['zh-TW'].origin, 'faithful-translation');
    const erratum = skill.payload.errata[0];
    assert.equal(erratum.anchor.segmentId, skill.payload.official.segments[0].segmentId);
    assert.equal(erratum.anchor.sourceTextDigest, skill.payload.official.sourceTextSha256);
    assert.equal(erratum.claimRef, 'fixture:claim:smite-damage');
    const claim = domains.skills.records.find(record => record.recordId === erratum.claimRef);
    assert.equal(claim.payload.value.status, 'known');
    assert.equal(claim.payload.value.decimal, '35');
    assert.equal(claim.payload.value.unit, 's');
    assert.equal(erratum.reviewState, 'pending');
    assert.match(erratum.text, /40.*35/);
    assert.deepEqual(Object.keys(skill.payload.detailSections), ['effects', 'conditions', 'calculation', 'notes', 'extra']);
    assert.equal(skill.payload.detailSections.extra[0].termRef, 'fixture:term:smite');

    const gameChange = domains['game-changes'].records.find(record => record.payload.changeId === 'fixture:change:smite-claim');
    assert.equal(gameChange.recordId, 'fixture:change:smite-claim');
    assert.equal(gameChange.payload.changedFields[0].after.decimal, '35');
    assert.equal(preview.announcements[0].payload.blocks[0].blockId, 'heading');
    assert.equal(preview.announcements[0].payload.blocks[1].blockId, 'paragraph');
    assert.equal(preview.announcements[0].reviewState, 'pending');

    const previewJs = firstFiles.get('preview.js').toString('utf8');
    assert.ok(previewJs.includes('補充說明'));
    assert.ok(previewJs.includes('額外說明'));
    assert.ok(previewJs.includes('renderErrata'));
    assert.ok(previewJs.includes('renderGameChange'));
    assert.ok(previewJs.includes('announcement.payload.blocks'));
    assert.equal(firstFiles.get('index.html').toString('utf8').includes('name="robots" content="noindex, nofollow, noarchive"'), true);
    assert.equal(firstFiles.get('index.html').toString('utf8').includes('不是已核准的遊戲事實'), true);
    assert.equal(firstFiles.has('dist/index.html'), false);
    assert.equal(firstFiles.has('analysis.md'), false);
    assert.equal(firstFiles.has('game-changes.md'), false);
  });
});

// Scenario: a pinned generated Source artifact changes without updating source.lock.json.
// Purpose: the Web compiler refuses a mixed or silently drifted input set.
test('UnitT01_source-artifact-drift-fails-the-pinned-manifest', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyBuildInputs(copiedRoot);
    const sourcePath = path.join(copiedRoot, 'content', 'w01', 'source', 'technical.json');
    const original = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, original.replace('fixture:claim:smite-damage', 'fixture:claim:tampered'), 'utf8');
    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'out') }),
      /source artifact .*hash|manifest.*mismatch/i
    );
  });
});

// Scenario: a release build is requested while the pinned Source package is fixture-only and pending.
// Purpose: fixture and pending material can build a quarantined preview but can never pass the formal-publication gate.
test('UnitT02_fixture-and-pending-data-cannot-pass-formal-publication', async () => {
  await withTempDirectory(async tempRoot => {
    await assert.rejects(
      buildW01({ repoRoot, outputRoot: path.join(tempRoot, 'formal'), mode: 'formal' }),
      /fixture|pending|formal publication/i
    );
  });
});

// Scenario: the pinned Source fixture includes a weapon range and an unverified blessing tier set.
// Purpose: typed ranges and unknown tier coverage remain unchanged and no calculation or guessed tier is introduced.
test('UnitT03_typed-ranges-and-unknown-tier-coverage-remain-unchanged', async () => {
  await withTempDirectory(async tempRoot => {
    const result = await buildW01({ repoRoot, outputRoot: path.join(tempRoot, 'out') });
    const buildRoot = path.join(tempRoot, 'out', 'data', result.dataRevision);
    const weapons = JSON.parse(await readFile(path.join(buildRoot, 'weapons.json'), 'utf8'));
    const blessings = JSON.parse(await readFile(path.join(buildRoot, 'blessings.json'), 'utf8'));
    const blessingVariant = blessings.records.find(record => record.recordId === 'fixture:blessing-variant:sample-tier');
    const weapon = weapons.records.find(record => record.recordId === 'fixture:weapon:sample');
    assert.deepEqual(weapon.payload.theoreticalInputRange, {
      inclusive: true, max: '100', min: '0', status: 'known', step: '0.5', unit: 'rating'
    });
    assert.deepEqual(blessingVariant.payload.obtainableTiers, { reasonCode: 'NOT_VERIFIED', status: 'unknown' });
    assert.equal(blessingVariant.payload.tierValues[0].value.decimal, '0.02');
  });
});

// Scenario: a Web presentation locale is changed from zh-TW to en.
// Purpose: the shared preview rejects missing Traditional Chinese instead of filling it with English fallback.
test('UnitT04_missing-zh-tw-presentation-is-rejected', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyBuildInputs(copiedRoot);
    const authoringPath = path.join(copiedRoot, 'content', 'w01', 'web-authoring.json');
    const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
    authoring.records[0].locale = 'en';
    await writeFile(authoringPath, JSON.stringify(authoring), 'utf8');
    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'out') }),
      /zh-TW|Traditional Chinese|missing or unsupported/i
    );
  });
});

// Scenario: a Source claim points to an evidence record absent from the generated domains.
// Purpose: the compiler rejects dangling technical and Web references rather than emitting a partial release.
test('UnitT05_dangling-shared-reference-is-rejected', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyBuildInputs(copiedRoot);
    const sourcePath = path.join(copiedRoot, 'content', 'w01', 'source', 'technical.json');
    const source = JSON.parse(await readFile(sourcePath, 'utf8'));
    const claim = source.records.find(record => record.kind === 'claim');
    claim.payload.evidenceRefs[0] = 'fixture:evidence:missing';
    const sourceBytes = jsonBytes(source);
    await writeFile(sourcePath, sourceBytes);
    const manifestPath = path.join(copiedRoot, 'content', 'w01', 'source', 'source-manifest.json');
    const sourceManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const row = sourceManifest.files.find(file => file.path === 'technical.json');
    row.sha256 = sha256(sourceBytes);
    row.sizeBytes = sourceBytes.byteLength;
    const manifestBytes = jsonBytes(sourceManifest);
    await writeFile(manifestPath, manifestBytes);
    const lockPath = path.join(copiedRoot, 'source.lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.manifestSha256 = sha256(manifestBytes);
    await writeFile(lockPath, jsonBytes(lock));
    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'out') }),
      /unresolved|reference closure/i
    );
  });
});

// Scenario: source.lock.json is checked out with equivalent LF or CRLF line endings.
// Purpose: the canonical content revision stays stable across Windows and Linux checkout settings.
test('UnitT06_equivalent-lf-and-crlf-inputs-preserve-data-revision', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyBuildInputs(copiedRoot);
    const previousSha = process.env.GITHUB_SHA;
    process.env.GITHUB_SHA = 'a'.repeat(40);
    try {
      const lf = await buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'lf') });
      for (const name of ['source.lock.json', 'content/w01/source/source-manifest.json', 'content/w01/source/technical.json', 'content/w01/source/game-changes.json']) {
        const inputPath = path.join(copiedRoot, ...name.split('/'));
        const value = JSON.parse(await readFile(inputPath, 'utf8'));
        const crlf = JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
        await writeFile(inputPath, crlf, 'utf8');
      }
      const crlf = await buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'crlf') });
      assert.equal(crlf.dataRevision, lf.dataRevision);
    } finally {
      if (previousSha === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = previousSha;
    }
  });
});


// Scenario: a Web presentation lists a Source-only reference ID in its owner references.
// Purpose: the two public registries stay separate and records cannot claim another owner's source.
test('UnitT07_web-record-cannot-use-source-owned-reference', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyBuildInputs(copiedRoot);
    const authoringPath = path.join(copiedRoot, 'content', 'w01', 'web-authoring.json');
    const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
    authoring.records[0].sourceRefs = ['fixture:snapshot:upstream'];
    await writeFile(authoringPath, JSON.stringify(authoring), 'utf8');
    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'out') }),
      /unresolved Web-owned sourceRef/i
    );
  });
});

// Scenario: a file is added to a completed preview package after its receipt was written.
// Purpose: the verifier rejects any output bytes that are absent from the immutable receipt.
test('UnitT08_unlisted-output-file-is-rejected', async () => {
  await withTempDirectory(async tempRoot => {
    const outputRoot = path.join(tempRoot, 'out');
    await mkdir(path.join(outputRoot, 'data'), { recursive: true });
    await writeFile(path.join(outputRoot, 'data', 'listed.json'), '{}');
    await writeFile(path.join(outputRoot, 'receipt.json'), '{}');
    const rows = [{ path: 'data/listed.json' }];
    await assertExactOutputInventory(outputRoot, rows);
    await writeFile(path.join(outputRoot, 'unexpected.txt'), 'unlisted');
    await assert.rejects(assertExactOutputInventory(outputRoot, rows), /unlisted file/);
  });
});

// Scenario: a fixture edit changes the data revision but keeps the same dist-w01 output directory.
// Purpose: a rebuilt package preserves old data bytes and lists both revisions in the new receipt.
test('UnitT09_same-output-rebuild-retains-prior-revision-files', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    const outputRoot = path.join(tempRoot, 'out');
    await copyBuildInputs(copiedRoot);
    const first = await buildW01({ repoRoot: copiedRoot, outputRoot });
    const firstManifestPath = path.join(outputRoot, 'data', first.dataRevision, 'manifest.json');
    const firstManifestBytes = await readFile(firstManifestPath);
    const authoringPath = path.join(copiedRoot, 'content', 'w01', 'web-authoring.json');
    const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
    authoring.records[0].payload.name += ' 更新';
    await writeFile(authoringPath, jsonBytes(authoring));
    const second = await buildW01({ repoRoot: copiedRoot, outputRoot });
    assert.notEqual(second.dataRevision, first.dataRevision);
    await assertExactOutputInventory(outputRoot, second.receipt.files);
    assert.deepEqual(await readFile(firstManifestPath), firstManifestBytes);
    assert.ok(second.receipt.files.some(row => row.path === 'data/' + first.dataRevision + '/manifest.json'));
  });
});
