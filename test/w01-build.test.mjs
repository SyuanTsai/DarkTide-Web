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
const publishedR5Root = process.env.W01_PRIOR_REAL_R5_ROOT;
const publishedR6Root = process.env.W01_PRIOR_REAL_R6_ROOT;
const publishedR7Root = process.env.W01_PRIOR_REAL_R7_ROOT;
const publishedR12Root = process.env.W01_PRIOR_REAL_R12_ROOT;
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
  const fixtureRoot = path.join(repoRoot, 'test', 'fixtures', 'w01');
  await cp(path.join(fixtureRoot, 'content', 'w01'), path.join(destination, 'content', 'w01'), { recursive: true });
  await cp(path.join(fixtureRoot, 'source.lock.json'), path.join(destination, 'source.lock.json'));
}

async function copyCurrentInputs(destination) {
  await mkdir(path.join(destination, 'content'), { recursive: true });
  await cp(path.join(repoRoot, 'content', 'w01'), path.join(destination, 'content', 'w01'), { recursive: true });
  await cp(path.join(repoRoot, 'source.lock.json'), path.join(destination, 'source.lock.json'));
}

async function updatePinnedTechnical(copiedRoot, update) {
  const sourceRoot = path.join(copiedRoot, 'content', 'w01', 'source');
  const technicalPath = path.join(sourceRoot, 'technical.json');
  const technical = JSON.parse(await readFile(technicalPath, 'utf8'));
  update(technical);
  const technicalBytes = jsonBytes(technical);
  await writeFile(technicalPath, technicalBytes);

  const sourceManifestPath = path.join(sourceRoot, 'source-manifest.json');
  const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
  const row = sourceManifest.files.find(file => file.path === 'technical.json');
  row.sha256 = sha256(technicalBytes);
  row.sizeBytes = technicalBytes.byteLength;
  const manifestBytes = jsonBytes(sourceManifest);
  await writeFile(sourceManifestPath, manifestBytes);

  const lockPath = path.join(copiedRoot, 'source.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.manifestSha256 = sha256(manifestBytes);
  await writeFile(lockPath, jsonBytes(lock));
}

const chainaxeTierVariantId = 'darktide:blessing-variant:chainaxe:p1-movement-speed-on-activation';
const chainaxeTierClaimId = tier => 'darktide:claim:chainaxe:p1-movement-speed-on-activation-tier' + tier + '-display-percent';
const chainaxeTierPercent = tier => String(16 + tier);

async function addSyntheticTierClaims(copiedRoot) {
  await updatePinnedTechnical(copiedRoot, technical => {
    const tierOneClaim = technical.records.find(record => record.recordId === chainaxeTierClaimId(1));
    assert.ok(tierOneClaim, 'the real tier-1 display claim is present');
    const existingRecordIds = new Set(technical.records.map(record => record.recordId));
    for (const tier of [2, 3, 4]) {
      if (existingRecordIds.has(chainaxeTierClaimId(tier))) continue;
      const evidenceId = 'test-only:evidence:chainaxe:tier-' + tier + '-display-percent';
      technical.records.push({
        recordId: evidenceId,
        owner: 'source',
        kind: 'evidence',
        gameReleaseId: tierOneClaim.gameReleaseId,
        payload: {
          sourceRef: 'public-code:trait-value-parser-ba6c148',
          safeSummary: 'TEST ONLY: synthetic fixture evidence for one tier-specific display binding.'
        },
        sourceRefs: ['public-code:chainaxe-p1-traits-ba6c148', 'public-code:trait-value-parser-ba6c148'],
        reviewState: 'pending'
      });
      technical.records.push({
        ...structuredClone(tierOneClaim),
        recordId: chainaxeTierClaimId(tier),
        payload: {
          ...structuredClone(tierOneClaim.payload),
          evidenceRefs: [
            'darktide:evidence:chainaxe:p1-movement-speed-on-activation-code',
            evidenceId
          ],
          property: 'description.format_values.movement_speed.defined_tier_' + tier + '_display_percent',
          value: { status: 'known', decimal: chainaxeTierPercent(tier), unit: 'percent' }
        }
      });
      existingRecordIds.add(evidenceId);
      existingRecordIds.add(chainaxeTierClaimId(tier));
    }
  });
}

function tierParamsFor(record, tier) {
  return record.payload.official.params.map(param => ({
    ...param,
    ...(param.name === 'movement_speed' ? { bindingRef: chainaxeTierClaimId(tier) } : {})
  }));
}

function tierSectionsFor(record, tier) {
  const sections = structuredClone(record.payload.detailSections);
  const claimRef = chainaxeTierClaimId(tier);
  sections.effects = [{
    itemId: 'chainaxe-tier-display-parameter',
    parts: [
      { kind: 'literal', text: '你的移動速度提高 ' },
      { kind: 'unsigned-percent', bindingRef: claimRef },
      { kind: 'literal', text: '。' }
    ],
    claimRefs: [claimRef]
  }];
  return sections;
}

async function prepareTieredCandidateInputs(copiedRoot) {
  await copyCurrentInputs(copiedRoot);
  await addSyntheticTierClaims(copiedRoot);
  const authoringPath = path.join(copiedRoot, 'content', 'w01', 'web-authoring.json');
  const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
  const record = authoring.records.find(item => item.recordId === 'web:presentation:chainaxe-p1-movement-speed');
  assert.ok(record, 'the blessing presentation is present');
  record.payload.official.params = tierParamsFor(record, 4);
  record.payload.official.localizations['zh-TW'].params = tierParamsFor(record, 4);
  record.payload.detailSections = tierSectionsFor(record, 4);
  record.payload.tierPresentations = {
    variantRef: chainaxeTierVariantId,
    defaultTier: 4,
    options: [1, 2, 3, 4].map(tier => ({
      tier,
      params: tierParamsFor(record, tier),
      detailSections: tierSectionsFor(record, tier)
    }))
  };
  await writeFile(authoringPath, jsonBytes(authoring));
  return { authoringPath, recordId: record.recordId };
}
async function repinTechnicalClaimTarget(repoRoot, recordId, targetRef, { linkTermToClaim = false } = {}) {
  const sourceRoot = path.join(repoRoot, 'content', 'w01', 'source');
  const technicalPath = path.join(sourceRoot, 'technical.json');
  const technical = JSON.parse(await readFile(technicalPath, 'utf8'));
  technical.records.find(record => record.recordId === recordId).payload.targetRef = targetRef;
  if (linkTermToClaim) technical.records.find(record => record.kind === 'term').payload.claimRefs = [recordId];
  const technicalBytes = jsonBytes(technical);
  await writeFile(technicalPath, technicalBytes);

  const manifestPath = path.join(sourceRoot, 'source-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const technicalRow = manifest.files.find(file => file.path === 'technical.json');
  technicalRow.sha256 = sha256(technicalBytes);
  technicalRow.sizeBytes = technicalBytes.byteLength;
  const manifestBytes = jsonBytes(manifest);
  await writeFile(manifestPath, manifestBytes);

  const lockPath = path.join(repoRoot, 'source.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.manifestSha256 = sha256(manifestBytes);
  await writeFile(lockPath, jsonBytes(lock));
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

async function readOfficialPresentations(buildRoot, receipt) {
  const domains = await Promise.all(['skills', 'blessings', 'weapons'].map(async kind =>
    JSON.parse(await readFile(path.join(buildRoot, 'data', receipt.dataRevision, kind + '.json'), 'utf8'))));
  return domains.flatMap(domain => domain.records)
    .filter(record => record.owner === 'web' && record.kind === 'presentation');
}

function officialSourceIdentity(official) {
  const keys = ['sourceRef', 'sourceLocale', 'resource', 'sourceHash', 'key', 'occurrence', 'sourceText', 'sourceTextSha256', 'segments'];
  const pick = entry => Object.fromEntries(keys.map(key => [key, entry[key]]));
  return { root: pick(official), zhTW: { origin: official.localizations['zh-TW'].origin, ...pick(official.localizations['zh-TW']) } };
}

// Scenario: the same pinned Source and Web fixture are compiled twice in clean directories.
// Purpose: generated output is reproducible and the shared package preserves v17-A ownership/identity and v17-D metadata.
test('UnitT00_deterministic-build-preserves-v17-contract-and-fixture-erratum', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyBuildInputs(copiedRoot);
    const firstRoot = path.join(tempRoot, 'first');
    const secondRoot = path.join(tempRoot, 'second');
    const first = await buildW01({ repoRoot: copiedRoot, outputRoot: firstRoot });
    const second = await buildW01({ repoRoot: copiedRoot, outputRoot: secondRoot });
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
    assert.equal(version.game_releases[0].content_version, '0.0.2');
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
    const versionPatternLiteral = previewJs.match(/const contentVersionPattern = (\/[^\n]+\/);/)?.[1];
    assert.ok(versionPatternLiteral, 'generated preview.js contains the content version validator');
    const versionPattern = new RegExp(versionPatternLiteral.slice(1, versionPatternLiteral.lastIndexOf('/')));
    assert.equal(versionPattern.test('0.0.2'), true);
    assert.equal(versionPattern.test('0x0x1'), false);
    assert.ok(previewJs.includes('補充說明'));
    assert.ok(previewJs.includes('額外說明'));
    assert.ok(previewJs.includes('renderErrata'));
    assert.ok(previewJs.includes('renderGameChange'));
    assert.ok(previewJs.includes('announcement.payload.blocks'));
    assert.equal(firstFiles.get('index.html').toString('utf8').includes('name="robots" content="noindex, noarchive"'), true);
    assert.equal(firstFiles.get('index.html').toString('utf8').includes('nofollow'), false);
    assert.equal(firstFiles.get('index.html').toString('utf8').includes('此頁僅供資料預覽'), true);
    assert.equal(firstFiles.get('_headers').toString('utf8').includes('X-Robots-Tag: noindex, noarchive'), true);
    assert.equal(firstFiles.get('_headers').toString('utf8').includes('nofollow'), false);
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
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyBuildInputs(copiedRoot);
    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'formal'), mode: 'formal' }),
      /fixture|pending|formal publication/i
    );
  });
});

// Scenario: the pinned Source fixture includes a weapon range and an unverified blessing tier set.
// Purpose: typed ranges and unknown tier coverage remain unchanged and no calculation or guessed tier is introduced.
test('UnitT03_typed-ranges-and-unknown-tier-coverage-remain-unchanged', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyBuildInputs(copiedRoot);
    const result = await buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'out') });
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

// Scenario: one fixture input is built explicitly as 0.0.1, then 0.0.2 into the same output.
// Purpose: a numeric version transition changes the data revision while retaining the older release URL byte-for-byte.
test('UnitT10_versioned-rebuild-0.0.1-to-0.0.2-preserves-prior-data', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    const outputRoot = path.join(tempRoot, 'out');
    await copyBuildInputs(copiedRoot);
    const r1 = await buildW01({ repoRoot: copiedRoot, outputRoot, contentVersion: '0.0.1' });
    const r1ManifestPath = path.join(outputRoot, ...r1.manifestPath.split('/'));
    const r1ManifestBytes = await readFile(r1ManifestPath);
    const r1DomainPath = path.join(outputRoot, 'data', r1.dataRevision, 'skills.json');
    const r1DomainBytes = await readFile(r1DomainPath);

    const r2 = await buildW01({ repoRoot: copiedRoot, outputRoot, contentVersion: '0.0.2' });
    const version = JSON.parse(await readFile(path.join(outputRoot, 'version.json'), 'utf8'));
    const r2Manifest = JSON.parse(await readFile(path.join(outputRoot, ...r2.manifestPath.split('/')), 'utf8'));
    const receipt = JSON.parse(await readFile(path.join(outputRoot, 'receipt.json'), 'utf8'));

    assert.notEqual(r2.dataRevision, r1.dataRevision);
    assert.equal(version.game_releases[0].content_version, '0.0.2');
    assert.equal(r2Manifest.contentVersion, '0.0.2');
    assert.equal(receipt.contentVersion, '0.0.2');
    assert.deepEqual(await readFile(r1ManifestPath), r1ManifestBytes);
    assert.deepEqual(await readFile(r1DomainPath), r1DomainBytes);
    assert.ok(receipt.files.some(row => row.path === 'data/' + r1.dataRevision + '/manifest.json'));
    await assertExactOutputInventory(outputRoot, receipt.files);
    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'invalid'), contentVersion: '0.02.0' }),
      /numeric major\.minor\.patch/
    );
  });
});

// Scenario: a sanitized, non-fixture Source package is explicitly built in candidate-preview mode.
// Purpose: pending public candidates can use the isolated preview while fixture mode and formal publication stay separately guarded.
test('UnitT11_candidate-preview-requires-explicit-pending-nonfixture-flags', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyBuildInputs(copiedRoot);
    await makePendingCandidateInputs(copiedRoot);

    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'implicit') }),
      /candidate-preview|fixture-only/i
    );
    const candidate = await buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'candidate'), mode: 'candidate-preview' });
    const version = JSON.parse(await readFile(path.join(tempRoot, 'candidate', 'version.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(path.join(tempRoot, 'candidate', candidate.manifestPath), 'utf8'));
    const preview = JSON.parse(await readFile(path.join(tempRoot, 'candidate', 'preview.json'), 'utf8'));

    assert.equal(candidate.receipt.fixtureOnly, false);
    assert.equal(candidate.receipt.publicationEligible, false);
    assert.equal(candidate.receipt.formalPublishAllowed, false);
    assert.equal(version.package_kind, 'pending-preview');
    assert.equal(manifest.fixtureOnly, false);
    assert.equal(manifest.publicationEligible, false);
    assert.equal(preview.candidatePreviewOnly, true);
    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'formal'), mode: 'formal' }),
      /formal publication/i
    );
  });
});

// Scenario: native official templates bind a Web-owned name or a matching Source claim, then reject a cross-entity claim.
// Purpose: localized official text resolves from exact owner inputs and cannot display a valid-looking value for the wrong game entity.
test('UnitT12_native-official-localization-resolves-ordered-source-spans', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyBuildInputs(copiedRoot);
    const authoringPath = path.join(copiedRoot, 'content', 'w01', 'web-authoring.json');
    const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
    const record = authoring.records[0];
    const enNameRef = 'fixture:official-name:brain-burst-en';
    const zhNameRef = 'fixture:official-name:brain-burst-zh-tw';
    const zhTextRef = 'fixture:official-source:smite-zh-tw';
    const enText = 'This is {talent_old:%s}.';
    const zhText = '這是{talent_old:%s}。';
    const enName = 'Brain Burst';
    const zhName = '顱腦爆裂';
    const digest = text => sha256(Buffer.from(text, 'utf8'));
    const segments = (prefix, token, suffix) => [
      { segmentId: prefix + '-literal', kind: 'literal', text: prefix, sha256: digest(prefix) },
      { segmentId: 'talent-old', kind: 'template-placeholder', text: token, sha256: digest(token) },
      { segmentId: suffix + '-literal', kind: 'literal', text: suffix, sha256: digest(suffix) }
    ];
    const enParams = [{ name: 'talent_old', placeholder: '{talent_old:%s}', status: 'bound', bindingRef: enNameRef, format: 'official-name' }];
    const zhParams = [{ name: 'talent_old', placeholder: '{talent_old:%s}', status: 'bound', bindingRef: zhNameRef, format: 'official-name' }];
    const officialSourceRef = record.payload.official.sourceRef;
    authoring.references.push(
      { sourceId: zhTextRef, safeSummary: 'Synthetic native official TC description identity for the contract test.' },
      { sourceId: enNameRef, officialName: { sourceLocale: 'en', resource: 'skills/talents', sourceHash: '6f06e398', key: 'loc_ability_psyker_smite', occurrence: 1, text: enName, sha256: digest(enName) } },
      { sourceId: zhNameRef, officialName: { sourceLocale: 'zh-TW', resource: 'skills/talents', sourceHash: '6f06e398', key: 'loc_ability_psyker_smite', occurrence: 1, text: zhName, sha256: digest(zhName) } }
    );
    record.sourceRefs = [...new Set([...record.sourceRefs, zhTextRef, enNameRef, zhNameRef])];
    record.payload.official = {
      sourceRef: officialSourceRef,
      sourceLocale: 'en',
      resource: 'skills/talents',
      sourceHash: '681e4980',
      key: 'loc_talent_psyker_brain_burst_improved_description',
      occurrence: 1,
      sourceText: enText,
      sourceTextSha256: digest(enText),
      segments: segments('This is ', '{talent_old:%s}', '.'),
      params: enParams,
      localizations: {
        'zh-TW': {
          origin: 'official',
          sourceRef: zhTextRef,
          sourceLocale: 'zh-TW',
          resource: 'skills/talents',
          sourceHash: '681e4980',
          key: 'loc_talent_psyker_brain_burst_improved_description',
          occurrence: 1,
          sourceText: zhText,
          sourceTextSha256: digest(zhText),
          segments: segments('這是', '{talent_old:%s}', '。'),
          params: zhParams
        }
      }
    };
    record.payload.errata = [{
      erratumId: 'fixture-native-official-contract-test',
      anchor: { segmentId: 'talent-old', sourceTextDigest: digest('{talent_old:%s}') },
      gameReleaseId: record.gameReleaseId,
      context: {},
      problem: 'Synthetic contract test only.',
      claimRef: 'fixture:claim:smite-damage',
      evidenceRefs: ['fixture:evidence:smite-template'],
      text: 'Synthetic pending erratum for identity-closure testing.',
      reviewState: 'pending'
    }];
    await writeFile(authoringPath, jsonBytes(authoring));

    const result = await buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'out') });
    const skills = JSON.parse(await readFile(path.join(tempRoot, 'out', 'data', result.dataRevision, 'skills.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(path.join(tempRoot, 'out', result.manifestPath), 'utf8'));
    const compiled = skills.records.find(item => item.recordId === record.recordId);
    const official = compiled.payload.official;
    const localized = official.localizations['zh-TW'];

    assert.ok(manifest.compatibility.requiredFeatures.includes('official-native-localizations-v1'));
    assert.equal(official.resolvedText, 'This is Brain Burst.');
    assert.equal(official.params[0].resolvedValue, enName);
    assert.equal(localized.origin, 'official');
    assert.equal(localized.sourceRef, zhTextRef);
    assert.equal(localized.sourceText, zhText);
    assert.equal(localized.resolvedText, '這是顱腦爆裂。');
    assert.equal(localized.text, localized.resolvedText);
    assert.equal(localized.params[0].resolvedValue, zhName);
    assert.equal(localized.sha256, digest(localized.text));
    assert.equal(official.segments.map(segment => segment.text).join(''), enText);
    assert.equal(localized.segments.map(segment => segment.text).join(''), zhText);

    await repinTechnicalClaimTarget(copiedRoot, 'fixture:claim:smite-damage', 'fixture:skill:smite', { linkTermToClaim: true });
    record.entityRef = 'fixture:blessing:sample';
    await writeFile(authoringPath, jsonBytes(authoring));
    const blessingResult = await buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'blessing-out') });
    const blessings = JSON.parse(await readFile(path.join(tempRoot, 'blessing-out', 'data', blessingResult.dataRevision, 'blessings.json'), 'utf8'));
    const blessingManifest = JSON.parse(await readFile(path.join(tempRoot, 'blessing-out', blessingResult.manifestPath), 'utf8'));
    const blessingPresentation = blessings.records.find(item => item.recordId === record.recordId);
    assert.equal(blessingPresentation.payload.official.localizations['zh-TW'].resolvedText, '這是顱腦爆裂。');
    assert.ok(blessingManifest.files.find(file => file.kind === 'blessings').dependencies.includes('skills'));
    assert.deepEqual(blessingManifest.files.find(file => file.kind === 'blessings').dependencies, ['skills', 'weapons', 'terms']);
    assert.deepEqual(blessingManifest.files.find(file => file.kind === 'skills').dependencies, ['terms']);
    assert.deepEqual(blessingManifest.files.find(file => file.kind === 'terms').dependencies, ['skills']);
    assert.deepEqual(blessingManifest.files.find(file => file.kind === 'weapons').dependencies, ['terms']);
    assert.deepEqual(blessingManifest.files.find(file => file.kind === 'game-changes').dependencies, ['skills']);

  });
});

// Scenario: a native official TC localization points to a missing Web-owned source identity.
// Purpose: a hash alone cannot replace owner-checked locale references or allow an unresolved official record into output.
test('UnitT13_native-official-localization-rejects-dangling-locale-source', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyBuildInputs(copiedRoot);
    const authoringPath = path.join(copiedRoot, 'content', 'w01', 'web-authoring.json');
    const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
    const english = 'Original official text.';
    const englishDigest = sha256(Buffer.from(english));
    Object.assign(authoring.records[0].payload.official, {
      sourceHash: '1234abcd',
      sourceText: english,
      sourceTextSha256: englishDigest,
      segments: [{ segmentId: 'literal-en', kind: 'literal', text: english, sha256: englishDigest }],
      params: []
    });
    delete authoring.records[0].payload.official.resolvedText;
    delete authoring.records[0].payload.official.resolvedTextSha256;
    authoring.records[0].payload.official.localizations['zh-TW'] = {
      origin: 'official',
      sourceRef: 'web:official:missing-tc-string',
      sourceLocale: 'zh-TW',
      resource: 'skills/talents',
      sourceHash: '681e4980',
      key: null,
      occurrence: 1,
      sourceText: '原始官方文字。',
      sourceTextSha256: sha256(Buffer.from('原始官方文字。')),
      segments: [{ segmentId: 'literal', kind: 'literal', text: '原始官方文字。', sha256: sha256(Buffer.from('原始官方文字。')) }],
      params: []
    };
    await writeFile(authoringPath, jsonBytes(authoring));
    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'out') }),
      /Web-owned registry|unresolved Web-owned sourceRef|sourceRefs/i
    );
  });
});

// Scenario: a fixed public Source pin and official EN/TC strings compile into one pending shared package.
// Purpose: real representative claims resolve only their matching native description parameters and all cross-domain references close.
test('UnitT14_real-pending-candidate-renders-exact-locales-and-closes-domain-references', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    const outputRoot = path.join(tempRoot, 'out');
    await copyCurrentInputs(copiedRoot);

    const result = await buildW01({ repoRoot: copiedRoot, outputRoot, mode: 'candidate-preview' });
    const version = JSON.parse(await readFile(path.join(outputRoot, 'version.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(path.join(outputRoot, result.manifestPath), 'utf8'));
    const receipt = JSON.parse(await readFile(path.join(outputRoot, 'receipt.json'), 'utf8'));
    const domains = Object.fromEntries(await Promise.all(domainKinds.map(async kind => [
      kind,
      JSON.parse(await readFile(path.join(outputRoot, 'data', result.dataRevision, kind + '.json'), 'utf8'))
    ])));
    const find = (kind, recordId) => domains[kind].records.find(record => record.recordId === recordId);
    const skill = find('skills', 'web:presentation:psyker-brain-burst-improved');
    const blessing = find('blessings', 'web:presentation:chainaxe-p1-movement-speed');
    const weapon = find('weapons', 'web:presentation:chainaxe-p1-m1');

    assert.equal(manifest.source.commit, '5d16c70a828d4bd6293a12430cd4ebea36c6ed1c');
    assert.equal(manifest.source.sourceRevision, '8e2996286df1875eb55d4e1ecd1650443ca9bd9b1a45a364c9c3f6de4f76048d');
    assert.equal(manifest.source.manifestSha256, '625725aa628f55bc484dd6fd267170b9991bb16b1d46c975a87193733c6418bc');
    assert.equal(version.package_kind, 'pending-preview');
    assert.equal(version.game_releases[0].content_version, '0.0.13');
    assert.equal(receipt.fixtureOnly, false);
    assert.equal(receipt.publicationEligible, false);
    assert.equal(receipt.formalPublishAllowed, false);
    assert.equal(receipt.candidatePreviewOnly, true);
    assert.equal(domains['game-changes'].records.length, 0);

    assert.equal(skill.payload.official.sourceText, 'Charge up your Psychic Power and release it to deal immense Damage to a Single Enemy.\n\nThis is an augmented version of {talent_old:%s} dealing {damage:%s} Damage.');
    assert.equal(skill.payload.official.localizations['zh-TW'].sourceText, '積蓄靈能力量，釋放時可對單個敵人造成巨大傷害。\n\n該天賦是可造成{damage:%s}傷害的{talent_old:%s}的加強版。');
    assert.equal(skill.payload.official.resolvedText, 'Charge up your Psychic Power and release it to deal immense Damage to a Single Enemy.\n\nThis is an augmented version of Brain Burst dealing +50% Damage.');
    assert.equal(skill.payload.official.localizations['zh-TW'].resolvedText, '積蓄靈能力量，釋放時可對單個敵人造成巨大傷害。\n\n該天賦是可造成+50%傷害的顱腦爆裂的加強版。');
    assert.deepEqual(skill.payload.detailSections.effects, [
      {
        itemId: 'psyker-numerical-assumptions',
        text: '以下數值不含其他加成或減免。'
      },
      {
        itemId: 'psyker-description-damage-parameter',
        text: '相較於顱腦爆裂，顱腦崩裂傷害提高 50%（1.5 倍）；這項加成不適用於所有靈能攻擊。',
        claimRefs: [
          'darktide:claim:psyker:brain-burst-improved-description-display-percent',
          'darktide:claim:psyker:brain-burst-improved-smite-damage-multiplier'
        ]
      },
      {
        itemId: 'psyker-base-hit-peril-cost',
        text: '顱腦崩裂蓄力時，你會累積反噬；造成傷害後再增加 25%。',
        claimRefs: [
          'darktide:claim:psyker:brain-burst-improved-normal-charge-base-time',
          'darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time',
          'darktide:claim:psyker:brain-burst-improved-successful-hit-base-peril-ratio'
        ]
      }
    ]);
    assert.deepEqual(skill.payload.detailSections.conditions, [
      {
        itemId: 'psyker-normal-charge-condition',
        text: '先蓄力再鎖定：未鎖定敵人也能蓄力；鎖定後接續蓄力進度。',
        claimRefs: ['darktide:claim:psyker:brain-burst-improved-normal-charge-base-time']
      },
      {
        itemId: 'psyker-sticky-charge-condition',
        text: '直接鎖定蓄力：先鎖定敵人，再蓄力。',
        claimRefs: [
          'darktide:claim:psyker:brain-burst-improved-normal-charge-base-time',
          'darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time'
        ]
      },
      {
        itemId: 'psyker-lock-on-charge-condition',
        text: '鎖定後，移開準星也不會更換目標。',
        claimRefs: [
          'darktide:claim:psyker:brain-burst-improved-normal-charge-base-time',
          'darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time'
        ]
      }
    ]);
    assert.deepEqual(skill.payload.detailSections.calculation, [
      {
        itemId: 'psyker-estimate-assumptions',
        text: '你的反噬從 0% 起算，且蓄力不中斷：'
      },
      {
        itemId: 'psyker-normal-charge-peril-estimate',
        text: '先蓄力再鎖定：約 3 秒蓄滿；1／2／3 秒時，你的反噬約 6.67%／13.33%／20%。',
        claimRefs: ['darktide:claim:psyker:brain-burst-improved-normal-charge-base-time']
      },
      {
        itemId: 'psyker-sticky-charge-peril-estimate',
        text: '直接鎖定蓄力：約 2 秒蓄滿；1／2 秒時，你的反噬約 10%／20%。',
        claimRefs: ['darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time']
      },
      {
        itemId: 'psyker-full-charge-peril-rate-estimate',
        text: '滿蓄後繼續蓄力，你的反噬每秒約增加 9%。',
        claimRefs: [
          'darktide:claim:psyker:brain-burst-improved-normal-charge-base-time',
          'darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time'
        ]
      },
      {
        itemId: 'psyker-full-charge-hit-peril-estimate',
        text: '顱腦崩裂蓄滿後立即造成傷害，你的反噬約 45%；多維持 1 秒則約 54%。',
        claimRefs: [
          'darktide:claim:psyker:brain-burst-improved-normal-charge-base-time',
          'darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time',
          'darktide:claim:psyker:brain-burst-improved-successful-hit-base-peril-ratio'
        ]
      }
    ]);
    assert.deepEqual(skill.payload.detailSections.notes, [
      {
        itemId: 'psyker-empty-cast-peril-cost',
        text: '顱腦崩裂未造成傷害時，你不會再累積 25% 反噬；蓄力時累積的反噬仍保留。',
        claimRefs: ['darktide:claim:psyker:brain-burst-improved-successful-hit-base-peril-ratio']
      }
    ]);
    assert.deepEqual(skill.payload.detailSections.extra, [
      {
        itemId: 'psyker-stagger-eligible-target-condition',
        text: '以下僅適用於會被顱腦崩裂打出踉蹌的敵人：',
        claimRefs: [
          'darktide:claim:psyker:brain-burst-improved-normal-charge-base-time',
          'darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time'
        ]
      },
      {
        itemId: 'psyker-lock-on-direct-stagger-condition',
        text: '直接鎖定：鎖定同一敵人超過 1 秒，顱腦崩裂使其輕微踉蹌一次。',
        claimRefs: [
          'darktide:claim:psyker:brain-burst-improved-normal-charge-base-time',
          'darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time'
        ]
      },
      {
        itemId: 'psyker-lock-on-transition-stagger-condition',
        text: '先蓄力再鎖定：鎖定敵人超過 0.25 秒，顱腦崩裂使其輕微踉蹌一次。',
        claimRefs: [
          'darktide:claim:psyker:brain-burst-improved-normal-charge-base-time',
          'darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time'
        ]
      }
    ]);
    assert.deepEqual(blessing.payload.detailSections.effects, [
      { itemId: 'chainaxe-tier-display-parameter', text: '你的移動速度提高 20%。', claimRefs: ['darktide:claim:chainaxe:p1-movement-speed-on-activation-tier4-display-percent'] }
    ]);
    assert.deepEqual(blessing.payload.detailSections.conditions, [
      { itemId: 'chainaxe-special-activation-condition', text: '使用武器特殊動作後生效，持續 2 秒。' }
    ]);
    assert.deepEqual(weapon.payload.detailSections.conditions, [
      { itemId: 'chainaxe-attack-point-table', text: '已收錄的攻擊數值：80、140。' }
    ]);
    assert.deepEqual(weapon.payload.detailSections.notes, [
      { itemId: 'chainaxe-armor-point-table', text: '已收錄的護甲修正值：1.035、1.965。' },
      { itemId: 'chainaxe-incomplete-attack-data', text: '其他攻擊資料尚未補齊。' }
    ]);
    const damageTerm = domains.terms.records.find(record => record.recordId === 'web:term-localization:psyker-smite-damage-multiplier-parameter');
    assert.equal(damageTerm.payload.label, '傷害倍率');
    assert.equal(damageTerm.payload.definition, '此天賦用來放大對應傷害的倍率；不能套用到所有靈能攻擊。');
    assert.equal(blessing.payload.official.resolvedText, '+20% Movement Speed for 2s on Weapon Special Activation.');
    assert.equal(blessing.payload.official.localizations['zh-TW'].resolvedText, '武器特殊啟動後+20%移動速度，持續2秒。');
    assert.equal(weapon.payload.name, '突擊鏈斧');
    assert.equal(blessing.payload.name, '提速');
    assert.equal(skill.reviewState, 'pending');
    assert.equal(blessing.reviewState, 'pending');
    assert.equal(weapon.reviewState, 'pending');

    const legacyAnalysisRefs = manifest.source.references.filter(reference => reference.sourceId === 'legacy:mods:psyker:brain-burst-improved:analysis-en');
    assert.equal(legacyAnalysisRefs.length, 1);
    assert.equal(legacyAnalysisRefs[0].repository, 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods');
    assert.equal(legacyAnalysisRefs[0].commit, '241ad76ce62330472aa423055a5b85db59bb6c0d');
    assert.equal(legacyAnalysisRefs[0].path, 'Game Info/releases/1.13.X/skills/talents/Psyker/en/psyker_brain_burst_improved.md');
    assert.deepEqual(legacyAnalysisRefs[0].snapshot, { commit: '241ad76ce62330472aa423055a5b85db59bb6c0d' });
    for (const reference of manifest.source.references) {
      if (!reference.repository || reference.sourceId === 'legacy:mods:psyker:brain-burst-improved:analysis-en') continue;
      assert.equal(reference.repository, 'https://github.com/Aussiemon/Darktide-Source-Code');
      assert.match(reference.commit, /^[a-f0-9]{40}$/);
      assert.equal(reference.snapshot.commit, reference.commit);
      assert.equal(reference.path.includes('\\'), false);
      assert.equal(/^(?:[A-Za-z]:|\/)/.test(reference.path), false);
      assert.equal(Object.hasOwn(reference, 'officialName'), false);
    }
    const dependencies = Object.fromEntries(manifest.files
      .filter(file => domainKinds.includes(file.kind))
      .map(file => [file.kind, file.dependencies]));
    assert.deepEqual(dependencies.skills, ['blessings', 'terms']);
    assert.deepEqual(dependencies.blessings, ['skills', 'weapons']);
    assert.deepEqual(dependencies.weapons, []);
    assert.deepEqual(dependencies.terms, ['skills']);
    assert.deepEqual(dependencies['game-changes'], []);

    const authoringPath = path.join(copiedRoot, 'content', 'w01', 'web-authoring.json');
    const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
    const psykerRecord = authoring.records.find(record => record.recordId === skill.recordId);
    psykerRecord.payload.official.params.find(param => param.name === 'damage').bindingRef = 'darktide:claim:chainaxe:p1-movement-speed-on-activation-tier1-display-percent';
    await writeFile(authoringPath, jsonBytes(authoring));
    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'foreign-claim'), mode: 'candidate-preview' }),
      /signed-percent requires a code-derived official format value|fixed property, unit, basis, or entity kind|does not target this presentation/
    );
  });
});

// Scenario: a repinned same-target percent claim describes a runtime outcome rather than official text formatting.
// Purpose: a candidate cannot bind a final/game-tested damage percentage into a source template placeholder.
test('UnitT15_native-percent-binding-requires-code-derived-official-formatter-claim', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyCurrentInputs(copiedRoot);
    await updatePinnedTechnical(copiedRoot, technical => {
      const claim = technical.records.find(record => record.recordId === 'darktide:claim:psyker:brain-burst-improved-description-display-percent');
      claim.payload.basis = 'game-tested';
    });
    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'wrong-basis'), mode: 'candidate-preview' }),
      /signed-percent requires a code-derived official format value|fixed property, unit, basis, or entity kind/
    );

    await copyCurrentInputs(copiedRoot);
    await updatePinnedTechnical(copiedRoot, technical => {
      const claim = technical.records.find(record => record.recordId === 'darktide:claim:psyker:brain-burst-improved-description-display-percent');
      claim.payload.property = 'combat.final_damage_percent';
    });
    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'wrong-property'), mode: 'candidate-preview' }),
      /signed-percent requires a code-derived official format value|fixed property, unit, basis, or entity kind/
    );
  });
});

// Scenario: a same-target raw 1.5 ratio is bound to the official damage token as a plain number.
// Purpose: only the Source-derived formatter claim may populate this official display parameter; raw mechanic values cannot bypass the display binding contract.
test('UnitT16_native-raw-ratio-cannot-bypass-official-display-binding', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyCurrentInputs(copiedRoot);
    const authoringPath = path.join(copiedRoot, 'content', 'w01', 'web-authoring.json');
    const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
    const skill = authoring.records.find(record => record.recordId === 'web:presentation:psyker-brain-burst-improved');
    const rawClaimId = 'darktide:claim:psyker:brain-burst-improved-smite-damage-multiplier';
    const nativeOfficial = skill.payload.official;
    for (const entry of [nativeOfficial, nativeOfficial.localizations['zh-TW']]) {
      const damage = entry.params.find(param => param.name === 'damage');
      damage.bindingRef = rawClaimId;
      damage.format = 'plain-number';
    }
    await writeFile(authoringPath, jsonBytes(authoring));

    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'raw-ratio'), mode: 'candidate-preview' }),
      /plain-number is limited to the fixed code-observed duration parameter/
    );
  });
});

// Scenario: a real candidate weapon name marks its English root template as zh-TW while keeping the existing locale references.
// Purpose: the native localization contract always requires English at the root and a separate official zh-TW branch.
test('UnitT17_native-official-root-template-must-remain-english', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    await copyCurrentInputs(copiedRoot);
    const authoringPath = path.join(copiedRoot, 'content', 'w01', 'web-authoring.json');
    const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
    const weapon = authoring.records.find(record => record.recordId === 'web:presentation:chainaxe-p1-m1');
    weapon.payload.official.sourceLocale = 'zh-TW';
    await writeFile(authoringPath, jsonBytes(authoring));

    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot: path.join(tempRoot, 'wrong-root-locale'), mode: 'candidate-preview' }),
      /sourceLocale does not match its official locale/
    );
  });
});

// Scenario: a quarantined real candidate is rebuilt after a neutral Web-owned data update.
// Purpose: a valid pending-preview receipt is accepted as prior output and every old data URL remains byte-identical.
test('UnitT18_pending-candidate-update-retains-prior-data-urls', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    const outputRoot = path.join(tempRoot, 'out');
    await copyCurrentInputs(copiedRoot);
    const prior = await buildW01({ repoRoot: copiedRoot, outputRoot, mode: 'candidate-preview', contentVersion: '0.0.3' });
    const priorReceiptBytes = await readFile(path.join(outputRoot, 'receipt.json'));
    const priorReceipt = JSON.parse(priorReceiptBytes);
    const priorDataRows = priorReceipt.files.filter(row => row.path.startsWith('data/' + prior.dataRevision + '/'));
    const priorDataBytes = new Map(await Promise.all(priorDataRows.map(async row => [
      row.path,
      await readFile(path.join(outputRoot, ...row.path.split('/')))
    ])));

    const current = await buildW01({ repoRoot: copiedRoot, outputRoot, mode: 'candidate-preview' });
    const currentReceipt = JSON.parse(await readFile(path.join(outputRoot, 'receipt.json')));
    assert.notEqual(current.dataRevision, prior.dataRevision);
    assert.equal(currentReceipt.contentVersion, '0.0.13');
    for (const row of priorDataRows) {
      assert.ok(currentReceipt.files.some(currentRow => currentRow.path === row.path));
      assert.deepEqual(await readFile(path.join(outputRoot, ...row.path.split('/'))), priorDataBytes.get(row.path));
    }
    await assertExactOutputInventory(outputRoot, currentReceipt.files);
  });
});

// Scenario: a pending candidate's previous receipt has a mixed or missing quarantine flag.
// Purpose: reject before writing and preserve every listed output byte plus the supplied receipt bytes.
test('UnitT19_invalid-prior-candidate-flags-fail-before-output-mutation', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    const outputRoot = path.join(tempRoot, 'out');
    await copyCurrentInputs(copiedRoot);
    await buildW01({ repoRoot: copiedRoot, outputRoot, mode: 'candidate-preview', contentVersion: '0.0.3' });
    const receiptPath = path.join(outputRoot, 'receipt.json');
    const validReceipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    const snapshots = new Map(await Promise.all(validReceipt.files.map(async row => [
      row.path,
      await readFile(path.join(outputRoot, ...row.path.split('/')))
    ])));
    const invalidReceipts = [
      { ...validReceipt, candidatePreviewOnly: false },
      { ...validReceipt, fixtureOnly: true }
    ];

    for (const invalidReceipt of invalidReceipts) {
      const invalidBytes = jsonBytes(invalidReceipt);
      await writeFile(receiptPath, invalidBytes);
      await assert.rejects(
        buildW01({ repoRoot: copiedRoot, outputRoot, mode: 'candidate-preview' }),
        /previous W01 receipt is not a quarantined fixture or pending-candidate preview/
      );
      assert.deepEqual(await readFile(receiptPath), invalidBytes);
      for (const [relativePath, bytes] of snapshots) {
        assert.deepEqual(await readFile(path.join(outputRoot, ...relativePath.split('/'))), bytes);
      }
    }
  });
});

// Scenario: the exact published 0.0.5 package is present in the 0.0.13 candidate's retained history.
// Purpose: preserve every published 0.0.5 immutable data URL and official text with identical receipt rows and bytes.
test('UnitT20_exact-published-0-0-5-data-remains-byte-identical-in-0-0-13', { skip: !publishedR5Root }, async () => {
  await withTempDirectory(async tempRoot => {
    const outputRoot = path.join(tempRoot, 'dist-w01');
    await cp(publishedR5Root, outputRoot, { recursive: true });
    const priorReceipt = JSON.parse(await readFile(path.join(outputRoot, 'receipt.json'), 'utf8'));
    assert.equal(priorReceipt.contentVersion, '0.0.5');
    assert.equal(priorReceipt.web.authoringCommit, 'a09863ceac2bfca3944d09081c315d62b704563c');
    const priorDataRows = priorReceipt.files.filter(row => row.path.startsWith('data/'));
    const current = await buildW01({ repoRoot, outputRoot, mode: 'candidate-preview' });
    const currentReceipt = JSON.parse(await readFile(path.join(outputRoot, 'receipt.json'), 'utf8'));
    const currentRows = new Map(currentReceipt.files.map(row => [row.path, row]));

    assert.equal(current.receipt.contentVersion, '0.0.13');
    assert.equal(currentReceipt.contentVersion, '0.0.13');
    assert.equal(currentReceipt.fixtureOnly, false);
    assert.equal(currentReceipt.candidatePreviewOnly, true);
    assert.equal(currentReceipt.publicationEligible, false);
    assert.equal(currentReceipt.formalPublishAllowed, false);
    assert.equal(priorDataRows.length, 2307);
    for (const row of priorDataRows) {
      assert.deepEqual(currentRows.get(row.path), row, `retained 0.0.5 receipt row ${row.path}`);
      assert.deepEqual(
        await readFile(path.join(outputRoot, ...row.path.split('/'))),
        await readFile(path.join(publishedR5Root, ...row.path.split('/'))),
        `retained 0.0.5 data bytes ${row.path}`
      );
    }
    const previousPresentations = await readOfficialPresentations(publishedR5Root, priorReceipt);
    const currentPresentations = await readOfficialPresentations(outputRoot, currentReceipt);
    assert.equal(previousPresentations.length, 3);
    assert.deepEqual(currentPresentations.map(record => record.recordId).sort(), previousPresentations.map(record => record.recordId).sort());
    for (const previous of previousPresentations) {
      const currentPresentation = currentPresentations.find(record => record.recordId === previous.recordId);
      assert.deepEqual(officialSourceIdentity(currentPresentation.payload.official), officialSourceIdentity(previous.payload.official), `unchanged official source identity ${previous.recordId}`);
      assert.deepEqual(currentPresentation.payload.name, previous.payload.name, `unchanged displayed name ${previous.recordId}`);
      assert.deepEqual(currentPresentation.sourceRefs, previous.sourceRefs, `unchanged official references ${previous.recordId}`);
      assert.ok(Array.isArray(previous.payload.errata), `published errata array ${previous.recordId}`);
      assert.ok(Array.isArray(currentPresentation.payload.errata), `current errata array ${previous.recordId}`);
      assert.deepEqual(currentPresentation.payload.errata, previous.payload.errata, `unchanged separate errata ${previous.recordId}`);
    }
    await assertExactOutputInventory(outputRoot, currentReceipt.files);
  });
});

// Scenario: the exact published 0.0.6 package is present in the 0.0.13 candidate's retained history.
// Purpose: preserve every published 0.0.6 immutable data URL and the official text/errata while Source and Web details advance.
test('UnitT21_exact-published-0-0-6-data-and-official-text-remain-byte-identical-in-0-0-13', { skip: !publishedR6Root }, async () => {
  await withTempDirectory(async tempRoot => {
    const outputRoot = path.join(tempRoot, 'dist-w01');
    await cp(publishedR6Root, outputRoot, { recursive: true });
    const priorReceipt = JSON.parse(await readFile(path.join(outputRoot, 'receipt.json'), 'utf8'));
    assert.equal(priorReceipt.contentVersion, '0.0.6');
    assert.equal(priorReceipt.web.authoringCommit, 'f2a465e9858e57c3a4850126522dacc71226453d');
    const priorDataRows = priorReceipt.files.filter(row => row.path.startsWith('data/'));
    const current = await buildW01({ repoRoot, outputRoot, mode: 'candidate-preview' });
    const currentReceipt = JSON.parse(await readFile(path.join(outputRoot, 'receipt.json'), 'utf8'));
    const currentRows = new Map(currentReceipt.files.map(row => [row.path, row]));

    assert.equal(current.receipt.contentVersion, '0.0.13');
    assert.equal(currentReceipt.contentVersion, '0.0.13');
    assert.equal(currentReceipt.fixtureOnly, false);
    assert.equal(currentReceipt.candidatePreviewOnly, true);
    assert.equal(currentReceipt.publicationEligible, false);
    assert.equal(currentReceipt.formalPublishAllowed, false);
    assert.equal(priorDataRows.length, 2313);
    for (const row of priorDataRows) {
      assert.deepEqual(currentRows.get(row.path), row, `retained 0.0.6 receipt row ${row.path}`);
      assert.deepEqual(
        await readFile(path.join(outputRoot, ...row.path.split('/'))),
        await readFile(path.join(publishedR6Root, ...row.path.split('/'))),
        `retained 0.0.6 data bytes ${row.path}`
      );
    }
    const previousPresentations = await readOfficialPresentations(publishedR6Root, priorReceipt);
    const currentPresentations = await readOfficialPresentations(outputRoot, currentReceipt);
    assert.equal(previousPresentations.length, 3);
    assert.deepEqual(currentPresentations.map(record => record.recordId).sort(), previousPresentations.map(record => record.recordId).sort());
    for (const previous of previousPresentations) {
      const currentPresentation = currentPresentations.find(record => record.recordId === previous.recordId);
      assert.deepEqual(officialSourceIdentity(currentPresentation.payload.official), officialSourceIdentity(previous.payload.official), `unchanged official source identity ${previous.recordId}`);
      assert.deepEqual(currentPresentation.payload.name, previous.payload.name, `unchanged displayed name ${previous.recordId}`);
      assert.deepEqual(currentPresentation.sourceRefs, previous.sourceRefs, `unchanged official references ${previous.recordId}`);
      assert.ok(Array.isArray(previous.payload.errata), `published errata array ${previous.recordId}`);
      assert.ok(Array.isArray(currentPresentation.payload.errata), `current errata array ${previous.recordId}`);
      assert.deepEqual(currentPresentation.payload.errata, previous.payload.errata, `unchanged separate errata ${previous.recordId}`);
    }
    await assertExactOutputInventory(outputRoot, currentReceipt.files);
  });
});

// Scenario: the Source-owned archive registry carries one fixed public Mods analysis locator.
// Purpose: preserve that exact source path while rejecting nearby repositories, commits, paths, and IDs.
test('UnitT22_fixed-legacy-analysis-reference-is-accepted-exactly', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    const outputRoot = path.join(tempRoot, 'out');
    await copyCurrentInputs(copiedRoot);

    const result = await buildW01({ repoRoot: copiedRoot, outputRoot, mode: 'candidate-preview' });
    const manifest = JSON.parse(await readFile(path.join(outputRoot, result.manifestPath), 'utf8'));
    const references = manifest.source.references.filter(reference => reference.sourceId === 'legacy:mods:psyker:brain-burst-improved:analysis-en');
    assert.equal(references.length, 1);
    assert.deepEqual(references[0], {
      sourceId: 'legacy:mods:psyker:brain-burst-improved:analysis-en',
      fixtureOnly: false,
      safeSummary: references[0].safeSummary,
      repository: 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods',
      commit: '241ad76ce62330472aa423055a5b85db59bb6c0d',
      path: 'Game Info/releases/1.13.X/skills/talents/Psyker/en/psyker_brain_burst_improved.md',
      snapshot: { commit: '241ad76ce62330472aa423055a5b85db59bb6c0d' }
    });
  });
});

// Scenario: a candidate attempts to substitute a nearby locator for the fixed archive source.
// Purpose: keep the new repository exception pinned to one source ID, repository, commit, and path.
test('UnitT23_legacy-analysis-reference-rejects-nearby-locator-identities', async () => {
  const mutations = [
    ['repository', reference => { reference.repository = 'https://github.com/example/Warhammer-40-000-DARKTIDE-Mods'; }],
    ['commit', reference => { reference.commit = '241ad76ce62330472aa423055a5b85db59bb6c0d'.replace(/^2/, '3'); reference.snapshot.commit = reference.commit; }],
    ['path', reference => { reference.path = 'Game Info/releases/1.13.X/skills/talents/Psyker/psyker_brain_burst_improved.md'; }],
    ['sourceId', reference => { reference.sourceId = 'legacy:mods:psyker:other-analysis'; }]
  ];

  for (const [label, mutate] of mutations) {
    await withTempDirectory(async tempRoot => {
      const copiedRoot = path.join(tempRoot, 'repo');
      const outputRoot = path.join(tempRoot, 'out');
      await copyCurrentInputs(copiedRoot);
      await updatePinnedTechnical(copiedRoot, technical => {
        mutate(technical.sourceRefs.find(reference => reference.sourceId === 'legacy:mods:psyker:brain-burst-improved:analysis-en'));
      });

      await assert.rejects(
        buildW01({ repoRoot: copiedRoot, outputRoot, mode: 'candidate-preview' }),
        /legacy analysis reference does not match its fixed public locator|repository is not an allowlisted public Source repository/,
        label
      );
      await assert.rejects(readdir(outputRoot), { code: 'ENOENT' }, label + ' is rejected before writing output');
    });
  }
});

async function makePendingCandidateInputs(copiedRoot) {
  const releaseId = 'candidate-test-release';
  const sourceRoot = path.join(copiedRoot, 'content', 'w01', 'source');
  const technicalPath = path.join(sourceRoot, 'technical.json');
  const changesPath = path.join(sourceRoot, 'game-changes.json');
  const sourceManifestPath = path.join(sourceRoot, 'source-manifest.json');
  const lockPath = path.join(copiedRoot, 'source.lock.json');
  const authoringPath = path.join(copiedRoot, 'content', 'w01', 'web-authoring.json');
  const technical = JSON.parse(await readFile(technicalPath, 'utf8'));
  const changes = JSON.parse(await readFile(changesPath, 'utf8'));
  const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
  const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  for (const item of [technical, changes, authoring, sourceManifest, lock]) item.gameReleaseId = releaseId;
  technical.gameVersion = '1.13.2';
  sourceManifest.gameVersion = '1.13.2';
  lock.gameVersion = '1.13.2';
  for (const reference of [...technical.sourceRefs, ...authoring.references]) {
    if (Object.hasOwn(reference, 'fixtureOnly')) reference.fixtureOnly = false;
  }
  for (const record of technical.records) record.gameReleaseId = releaseId;
  for (const change of technical.gameChanges) change.gameReleaseId = releaseId;
  for (const change of changes.changes) change.gameReleaseId = releaseId;
  for (const record of authoring.records) {
    record.gameReleaseId = releaseId;
    for (const erratum of record.payload.errata ?? []) erratum.gameReleaseId = releaseId;
  }
  for (const announcement of authoring.announcements) announcement.gameReleaseId = releaseId;
  for (const item of [technical, changes, authoring, sourceManifest]) item.fixtureOnly = false;
  sourceManifest.publicationEligible = false;
  technical.publicationEligible = false;
  changes.publicationEligible = false;
  authoring.fixtureOnly = false;

  for (const [name, value] of [['technical.json', technical], ['game-changes.json', changes]]) {
    const bytes = jsonBytes(value);
    await writeFile(path.join(sourceRoot, name), bytes);
    const row = sourceManifest.files.find(file => file.path === name);
    row.sha256 = sha256(bytes);
    row.sizeBytes = bytes.byteLength;
  }
  const manifestBytes = jsonBytes(sourceManifest);
  await writeFile(sourceManifestPath, manifestBytes);
  lock.manifestSha256 = sha256(manifestBytes);
  await writeFile(lockPath, jsonBytes(lock));
  await writeFile(authoringPath, jsonBytes(authoring));
}

// Scenario: one pending blessing exposes every Source-defined tier with the source-backed highest tier selected by default.
// Purpose: compile complete tier options from the original official template and keep its EN/zh-TW identity fixed.
test('UnitT24_blessing-tier-presentations-compile-all-options-with-tier-four-default', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    const outputRoot = path.join(tempRoot, 'out');
    await prepareTieredCandidateInputs(copiedRoot);

    const result = await buildW01({ repoRoot: copiedRoot, outputRoot, mode: 'candidate-preview' });
    const manifest = JSON.parse(await readFile(path.join(outputRoot, result.manifestPath), 'utf8'));
    const domains = Object.fromEntries(await Promise.all(domainKinds.map(async kind => [
      kind,
      JSON.parse(await readFile(path.join(outputRoot, 'data', result.dataRevision, kind + '.json'), 'utf8'))
    ])));
    const blessing = domains.blessings.records.find(record => record.recordId === 'web:presentation:chainaxe-p1-movement-speed');
    const sourceVariant = domains.blessings.records.find(record => record.recordId === chainaxeTierVariantId);
    const claimsById = new Map(domains.skills.records.filter(record => record.kind === 'claim').map(record => [record.recordId, record]));
    const tiered = blessing.payload.tierPresentations;

    assert.deepEqual(manifest.compatibility.requiredFeatures, [
      'official-errata-details-v1', 'official-native-localizations-v1', 'blessing-tier-presentations-v1'
    ]);
    assert.equal(tiered.variantRef, chainaxeTierVariantId);
    assert.equal(tiered.defaultTier, 4);
    assert.deepEqual(tiered.options.map(option => option.tier), sourceVariant.payload.definedTiers);
    assert.deepEqual(blessing.payload.official, tiered.options[3].official);
    assert.deepEqual(blessing.payload.detailSections, tiered.options[3].detailSections);
    assert.deepEqual(blessing.payload.errata, []);
    assert.equal(sourceVariant.payload.obtainableTiers.status, 'unknown');

    const baseOfficial = blessing.payload.official;
    const expectedRatios = ['0.17', '0.18', '0.19', '0.2'];
    for (const [index, option] of tiered.options.entries()) {
      const tier = index + 1;
      const claimId = chainaxeTierClaimId(tier);
      const claim = claimsById.get(claimId);
      const variantValue = sourceVariant.payload.tierValues.find(item => item.tier === tier).value;
      assert.equal(claim.payload.targetRef, tiered.variantRef);
      assert.equal(claim.payload.property, 'description.format_values.movement_speed.defined_tier_' + tier + '_display_percent');
      assert.equal(claim.payload.basis, 'code-derived');
      assert.deepEqual(claim.payload.context, {});
      assert.equal(claim.payload.value.decimal, chainaxeTierPercent(tier));
      assert.equal(claim.payload.value.unit, 'percent');
      assert.equal(variantValue.decimal, expectedRatios[index]);
      assert.equal(option.official.params.find(param => param.name === 'movement_speed').bindingRef, claimId);
      assert.equal(option.official.params.find(param => param.name === 'movement_speed').resolvedValue, '+' + chainaxeTierPercent(tier) + '%');
      assert.deepEqual(option.official.params.find(param => param.name === 'time'), baseOfficial.params.find(param => param.name === 'time'));
      assert.equal(option.official.resolvedText, '+' + chainaxeTierPercent(tier) + '% Movement Speed for 2s on Weapon Special Activation.');
      assert.equal(option.official.localizations['zh-TW'].resolvedText, '武器特殊啟動後+' + chainaxeTierPercent(tier) + '%移動速度，持續2秒。');
      assert.equal(option.official.sourceText, baseOfficial.sourceText);
      assert.equal(option.official.sourceTextSha256, baseOfficial.sourceTextSha256);
      assert.deepEqual(option.official.segments, baseOfficial.segments);
      assert.equal(option.official.localizations['zh-TW'].sourceText, baseOfficial.localizations['zh-TW'].sourceText);
      assert.equal(option.official.localizations['zh-TW'].sourceTextSha256, baseOfficial.localizations['zh-TW'].sourceTextSha256);
      assert.deepEqual(option.official.localizations['zh-TW'].segments, baseOfficial.localizations['zh-TW'].segments);
      assert.deepEqual(option.detailSections.effects, [{
        itemId: 'chainaxe-tier-display-parameter',
        text: '你的移動速度提高 ' + chainaxeTierPercent(tier) + '%。',
        claimRefs: [claimId]
      }]);
      assert.equal(Object.hasOwn(option.detailSections.effects[0], 'parts'), false);
      assert.deepEqual(option.detailSections.conditions, baseOfficial ? blessing.payload.detailSections.conditions : []);
    }
    assert.equal(result.receipt.fixtureOnly, false);
    assert.equal(result.receipt.candidatePreviewOnly, true);
    assert.equal(result.receipt.formalPublishAllowed, false);
  });
});

// Scenario: an otherwise pinned four-tier package contains a mismatched tier binding, Source ratio, or variant identity.
// Purpose: reject cross-tier and disconnected records before producing shared bytes.
test('UnitT25_blessing-tier-presentations-reject-cross-tier-and-source-mismatches', async () => {
  const cases = [
    {
      name: 'cross-tier binding',
      mutateAuthoring: authoring => {
        const presentation = authoring.records.find(record => record.recordId === 'web:presentation:chainaxe-p1-movement-speed');
        presentation.payload.tierPresentations.options[1].params.find(param => param.name === 'movement_speed').bindingRef = chainaxeTierClaimId(1);
      },
      expected: /movement_speed bindingRef does not identify its tier/
    },
    {
      name: 'cross-tier detail display binding',
      mutateAuthoring: authoring => {
        const presentation = authoring.records.find(record => record.recordId === 'web:presentation:chainaxe-p1-movement-speed');
        presentation.payload.tierPresentations.options[1].detailSections.effects[0].parts[1].bindingRef = chainaxeTierClaimId(1);
      },
      expected: /parts\[1\]\.bindingRef does not match the selected tier/
    },
    {
      name: 'missing detail display binding',
      mutateAuthoring: authoring => {
        const presentation = authoring.records.find(record => record.recordId === 'web:presentation:chainaxe-p1-movement-speed');
        delete presentation.payload.tierPresentations.options[1].detailSections.effects[0].parts[1].bindingRef;
      },
      expected: /parts\[1\] has missing or unsupported fields/
    },
    {
      name: 'different variant',
      mutateAuthoring: authoring => {
        const presentation = authoring.records.find(record => record.recordId === 'web:presentation:chainaxe-p1-movement-speed');
        presentation.payload.tierPresentations.variantRef = 'darktide:blessing-variant:other';
      },
      expected: /variantRef must identify a variant of this blessing/
    },
    {
      name: 'ratio and display claim disagree',
      mutateSource: technical => {
        const variant = technical.records.find(record => record.recordId === chainaxeTierVariantId);
        variant.payload.tierValues.find(entry => entry.tier === 2).value.decimal = '0.19';
      },
      expected: /does not match the selected blessing tier and Source value/
    },
    {
      name: 'non-default root',
      mutateAuthoring: authoring => {
        const presentation = authoring.records.find(record => record.recordId === 'web:presentation:chainaxe-p1-movement-speed');
        presentation.payload.tierPresentations.defaultTier = 3;
      },
      expected: /requires the four defined tiers with tier 4 as default/
    }
  ];

  for (const item of cases) {
    await withTempDirectory(async tempRoot => {
      const copiedRoot = path.join(tempRoot, 'repo');
      const outputRoot = path.join(tempRoot, 'out');
      await prepareTieredCandidateInputs(copiedRoot);
      if (item.mutateSource) await updatePinnedTechnical(copiedRoot, item.mutateSource);
      if (item.mutateAuthoring) {
        const authoringPath = path.join(copiedRoot, 'content', 'w01', 'web-authoring.json');
        const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
        item.mutateAuthoring(authoring);
        await writeFile(authoringPath, jsonBytes(authoring));
      }
      await assert.rejects(buildW01({ repoRoot: copiedRoot, outputRoot, mode: 'candidate-preview' }), item.expected, item.name);
      await assert.rejects(readdir(outputRoot), { code: 'ENOENT' }, 'invalid tier data is rejected before output writes');
    });
  }
});

// Scenario: a tiered effect repeats a tier percentage as authored text instead of binding it to the selected Source claim.
// Purpose: make the dynamic value mandatory and prevent every option from carrying a disconnected hard-coded number.
test('UnitT26_blessing-tier-effects-require-a-typed-selected-tier-binding', async () => {
  await withTempDirectory(async tempRoot => {
    const copiedRoot = path.join(tempRoot, 'repo');
    const outputRoot = path.join(tempRoot, 'out');
    await prepareTieredCandidateInputs(copiedRoot);
    const authoringPath = path.join(copiedRoot, 'content', 'w01', 'web-authoring.json');
    const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
    const presentation = authoring.records.find(record => record.recordId === 'web:presentation:chainaxe-p1-movement-speed');
    for (const option of presentation.payload.tierPresentations.options) {
      const claimRef = chainaxeTierClaimId(option.tier);
      option.detailSections.effects = [{
        itemId: 'hard-coded-tier-value',
        text: '此階級的說明數值為 +20%。',
        claimRefs: [claimRef]
      }];
    }
    presentation.payload.detailSections = structuredClone(presentation.payload.tierPresentations.options[3].detailSections);
    await writeFile(authoringPath, jsonBytes(authoring));
    await assert.rejects(
      buildW01({ repoRoot: copiedRoot, outputRoot, mode: 'candidate-preview' }),
      /may not hard-code a tier percentage/
    );
    await assert.rejects(readdir(outputRoot), { code: 'ENOENT' });
  });
});

// Scenario: the exact published 0.0.7 package is rebuilt from its public source and retained in the 0.0.13 output.
// Purpose: preserve every immutable .7 URL and byte while the four-tier selector advances the current candidate.
test('UnitT27_exact-published-0-0-7-data-remains-byte-identical-in-0-0-13', { skip: !publishedR7Root }, async () => {
  await withTempDirectory(async tempRoot => {
    const outputRoot = path.join(tempRoot, 'dist-w01');
    const priorReceipt = JSON.parse(await readFile(path.join(publishedR7Root, 'receipt.json'), 'utf8'));
    assert.equal(priorReceipt.contentVersion, '0.0.7');
    assert.equal(priorReceipt.web.authoringCommit, 'a11bdb73d4e00b735051bfcb55685623c05c9c12');
    const priorDataRows = priorReceipt.files.filter(row => row.path.startsWith('data/'));
    assert.equal(priorDataRows.length, 2319);
    await cp(publishedR7Root, outputRoot, { recursive: true });

    const current = await buildW01({ repoRoot, outputRoot, mode: 'candidate-preview' });
    const currentReceipt = JSON.parse(await readFile(path.join(outputRoot, 'receipt.json'), 'utf8'));
    const currentRows = new Map(currentReceipt.files.map(row => [row.path, row]));
    assert.equal(current.receipt.contentVersion, '0.0.13');
    assert.equal(currentReceipt.contentVersion, '0.0.13');
    assert.equal(currentReceipt.fixtureOnly, false);
    assert.equal(currentReceipt.candidatePreviewOnly, true);
    assert.equal(currentReceipt.publicationEligible, false);
    assert.equal(currentReceipt.formalPublishAllowed, false);
    for (const row of priorDataRows) {
      assert.deepEqual(currentRows.get(row.path), row, `retained 0.0.7 receipt row ${row.path}`);
      assert.deepEqual(
        await readFile(path.join(outputRoot, ...row.path.split('/'))),
        await readFile(path.join(publishedR7Root, ...row.path.split('/'))),
        `retained 0.0.7 data bytes ${row.path}`
      );
    }
    await assertExactOutputInventory(outputRoot, currentReceipt.files);
  });
});

// Scenario: the exact published 0.0.12 package is present in the 0.0.13 candidate's retained history.
// Purpose: preserve every published 0.0.12 immutable data URL and byte while only Web-owned copy advances.
test('UnitT28_exact-published-0-0-12-data-remains-byte-identical-in-0-0-13', { skip: !publishedR12Root }, async () => {
  await withTempDirectory(async tempRoot => {
    const outputRoot = path.join(tempRoot, 'dist-w01');
    const priorReceipt = JSON.parse(await readFile(path.join(publishedR12Root, 'receipt.json'), 'utf8'));
    assert.equal(priorReceipt.contentVersion, '0.0.12');
    assert.equal(priorReceipt.web.authoringCommit, '869f03f829b377ed4779ec73f55baf8a7507d6c4');
    const priorDataRows = priorReceipt.files.filter(row => row.path.startsWith('data/'));
    await cp(publishedR12Root, outputRoot, { recursive: true });

    const current = await buildW01({ repoRoot, outputRoot, mode: 'candidate-preview' });
    const currentReceipt = JSON.parse(await readFile(path.join(outputRoot, 'receipt.json'), 'utf8'));
    const currentRows = new Map(currentReceipt.files.map(row => [row.path, row]));
    assert.equal(current.receipt.contentVersion, '0.0.13');
    assert.equal(currentReceipt.contentVersion, '0.0.13');
    assert.equal(currentReceipt.fixtureOnly, false);
    assert.equal(currentReceipt.candidatePreviewOnly, true);
    assert.equal(currentReceipt.publicationEligible, false);
    assert.equal(currentReceipt.formalPublishAllowed, false);
    assert.ok(priorDataRows.length > 0);
    for (const row of priorDataRows) {
      assert.deepEqual(currentRows.get(row.path), row, `retained 0.0.12 receipt row ${row.path}`);
      assert.deepEqual(
        await readFile(path.join(outputRoot, ...row.path.split('/'))),
        await readFile(path.join(publishedR12Root, ...row.path.split('/'))),
        `retained 0.0.12 data bytes ${row.path}`
      );
    }
    await assertExactOutputInventory(outputRoot, currentReceipt.files);
  });
});
