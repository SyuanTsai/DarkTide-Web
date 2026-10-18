import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  computeReviewDigests,
  createReviewReceipt,
  getReviewState,
  loadWebAuthoringInputs,
  validateWebAuthoring,
} from '../scripts/content/contract-authoring.mjs';
import { committedW01 } from '../scripts/content/contract-w06.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Scenario: W06 remains pinned to the verified Source data commit without treating candidate copy as a fixture.
// Purpose: guard the additive dataSha256 pin branch and non-publishable contract validation.
test('UnitT70_w06-loads-real-source-pin-and-valid-nonfixture-candidate', async () => {
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w06' });
  assert.equal(inputs.mode, 'w06');
  assert.equal(inputs.sourceLock.commit, '079c07c02c30e45a99cff805e7e05855031b163e');
  assert.equal(inputs.authoring.fixtureOnly, false);
  assert.equal(inputs.authoring.publicationEligible, false);
  assert.equal(inputs.authoring.sourcePin.dataSha256, inputs.sourceLock.files.data.sha256);
  assert.equal(Object.hasOwn(inputs.authoring.sourcePin, 'fixtureSha256'), false);
  const result = validateWebAuthoring(inputs.authoring, inputs);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(inputs.authoring.reviewReceipts.length, 0);
  assert.equal(inputs.authoring.presentations.length, 2);
  assert.equal(inputs.officialInputs.sources.length, 14);
  assert.equal(inputs.authoring.reviewTargets.filter(target => target.ownerKind === 'presentation' && target.fieldPath.includes('/items/')).length, 23);
  assert.equal(inputs.authoring.presentations.every(item => !Object.hasOwn(item, 'faithfulTranslation')), true);
});

function convertW01Sections(sectionObject) {
  return ['effects', 'conditions', 'calculation', 'notes', 'extra']
    .filter(sectionId => sectionObject[sectionId]?.length)
    .map(sectionId => ({ sectionId, items: sectionObject[sectionId] }));
}

function sourceIdForW01(sourceId) {
  return sourceId.toLowerCase();
}

function officialInputFor(inputs, record, locale, tier = null) {
  const sourceId = (locale === 'en' ? record.payload.official.sourceRef : record.payload.official.localizations['zh-TW'].sourceRef).toLowerCase();
  return inputs.officialInputs.sources.find(source => source.sourceLocale === locale
    && source.entityRef.recordId === record.entityRef
    && (tier === null ? !source.bindingContext && source.officialSourceId === sourceId
      : source.bindingContext?.tier === tier && source.officialSourceId === sourceId + ':tier-' + tier));
}

function assertW01OfficialInput(actual, expected, tierParams = null) {
  assert.ok(actual);
  assert.equal(actual.sourceText, expected.sourceText);
  assert.equal(actual.sourceTextSha256, expected.sourceTextSha256);
  assert.equal(actual.key, expected.key ?? null);
  assert.equal(actual.sourceHash, expected.sourceHash);
  assert.equal(actual.occurrence, expected.occurrence);
  assert.deepEqual(actual.segments.map(segment => segment.kind === 'text' ? segment.text : segment.token), expected.segments.map(segment => segment.text));
  const refs = new Map((tierParams ?? expected.params).map(parameter => [parameter.name, parameter.bindingRef]));
  for (const parameter of expected.params) {
    const bindingRef = refs.get(parameter.name) ?? parameter.bindingRef;
    const actualParam = actual.params.find(item => item.parameterId === parameter.name);
    assert.ok(actualParam, `missing parameter ${parameter.name}`);
    assert.equal(actualParam.sourceKey, sourceIdForW01(bindingRef));
  }
}

// Scenario: the accepted W01 copy is rehomed to W06 with native official sources.
// Purpose: prevent wording drift and fabricated official locator context during the additive migration.
test('UnitT71_w06-preserves-accepted-w01-wording-and-bound-official-locators', async () => {
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w06' });
  const w01 = JSON.parse(await readFile(path.join(repoRoot, 'content/w01/web-authoring.json'), 'utf8'));
  const records = new Map(w01.records.filter(record => record.kind === 'presentation').map(record => [record.recordId, record]));
  const skillCandidate = records.get('web:presentation:psyker-brain-burst-improved');
  const blessingCandidate = records.get('web:presentation:chainaxe-p1-movement-speed');
  const skill = inputs.authoring.presentations.find(item => item.authoringId === skillCandidate.recordId);
  const blessing = inputs.authoring.presentations.find(item => item.authoringId === blessingCandidate.recordId);
  assert.equal(skill.name, skillCandidate.payload.name);
  assert.equal(blessing.name, blessingCandidate.payload.name);
  assert.deepEqual(skill.detailSections.map(({ sectionId, items }) => ({ sectionId, items: items.map(({ itemId, text }) => ({ itemId, text })) })), convertW01Sections(skillCandidate.payload.detailSections).map(({ sectionId, items }) => ({ sectionId, items: items.map(({ itemId, text }) => ({ itemId, text })) })));
  for (const option of blessing.tierPresentations.options) {
    const sourceOption = blessingCandidate.payload.tierPresentations.options.find(item => item.tier === option.tier);
    assert.deepEqual(option.detailSections.map(({ sectionId, items }) => ({ sectionId, items: items.map(item => item.text ?? item.parts.map(part => part.kind === 'literal' ? part.text : null)) })),
      convertW01Sections(sourceOption.detailSections).map(({ sectionId, items }) => ({ sectionId, items: items.map(item => item.text ?? item.parts.map(part => part.kind === 'literal' ? part.text : null)) })));
    assert.equal(option.officialLocaleRefs.length, 2);
    assert.equal(option.officialLocaleRefs.find(item => item.sourceLocale === 'en').officialSourceId, option.officialLocaleRefs.find(item => item.sourceLocale === 'en').officialSourceId.toLowerCase());
    assert.equal(option.officialLocaleRefs.find(item => item.sourceLocale === 'zh-TW').officialSourceId, option.officialLocaleRefs.find(item => item.sourceLocale === 'zh-TW').officialSourceId.toLowerCase());
    for (const locale of ['en', 'zh-TW']) {
      const expected = locale === 'en' ? blessingCandidate.payload.official : blessingCandidate.payload.official.localizations['zh-TW'];
      const actual = inputs.officialInputs.sources.find(item => item.entityRef.recordId === blessing.entityRef.recordId
        && item.sourceLocale === locale && item.bindingContext?.tier === option.tier);
      assertW01OfficialInput(actual, expected, sourceOption.params);
      assert.equal(actual.resolvedText, locale === 'en'
        ? `+${16 + option.tier}% Movement Speed for 2s on Weapon Special Activation.`
        : `武器特殊啟動後+${16 + option.tier}%移動速度，持續2秒。`);
    }
  }
  for (const locale of ['en', 'zh-TW']) assertW01OfficialInput(officialInputFor(inputs, skillCandidate, locale), locale === 'en' ? skillCandidate.payload.official : skillCandidate.payload.official.localizations['zh-TW']);
  assert.deepEqual(blessing.tierPresentations.options.map(item => item.tier), [1, 2, 3, 4]);
  assert.equal(blessing.tierPresentations.defaultTier, 4);
  assert.equal(inputs.sourceContract.gameReleases.find(item => item.gameReleaseId === 'darktide:1.13.2').gameBuild, 'UNVERIFIED');
  assert.equal(inputs.authoring.presentations.some(item => item.entityRef.kind === 'weapon'), false);
  const sourceBlessing = inputs.sourceRecordMap.get(`${blessing.entityRef.gameReleaseId}\u0000${blessing.entityRef.recordId}`);
  const sourceVariant = inputs.sourceRecordMap.get(`${blessing.entityRef.gameReleaseId}\u0000${blessing.tierPresentations.variantRef.recordId}`);
  assert.deepEqual(sourceBlessing.payload.nameKey, { status: 'unknown', reasonCode: 'NOT_VERIFIED' });
  assert.deepEqual(sourceVariant.payload.weaponRefs, []);
  assert.deepEqual(sourceVariant.dataCoverage.missing, [{ field: '/payload/weaponRefs', reasonCode: 'NOT_IMPORTED' }]);
});

// Scenario: a real tier claim is redirected to another tier or an undefined default.
// Purpose: keep tier display values bound to the selected Source option and reject unsupported defaults.
test('UnitT72_w06-rejects-tier-cross-binding-and-default-outside-source-option-set', async () => {
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w06' });
  const sourceClaim = inputs.sourceContract.records.find(record => record.recordId === 'darktide:claim:chainaxe:p1-movement-speed-on-activation-tier1-display-percent');
  const tierFourSource = inputs.sourceContract.records.find(record => record.recordId === 'darktide:claim:chainaxe:p1-movement-speed-on-activation-tier4-display-percent');
  const presentation = contract => contract.presentations.find(item => item.entityRef.kind === 'blessing');
  const crossBound = structuredClone(inputs.authoring);
  const tierFour = presentation(crossBound).tierPresentations.options.find(item => item.tier === 4);
  tierFour.params.find(item => item.name === 'movement_speed').bindingRef.recordId = sourceClaim.recordId;
  const crossBindingResult = validateWebAuthoring(crossBound, inputs);
  assert.equal(crossBindingResult.valid, false);
  assert.ok(crossBindingResult.issues.some(item => item.code === 'official-tier-parameter' || item.code === 'tier-claim-binding'));
  assert.notEqual(sourceClaim.payload.value.decimal, tierFourSource.payload.value.decimal);

  const badPart = structuredClone(inputs.authoring);
  const badBlessing = presentation(badPart);
  const optionFour = badBlessing.tierPresentations.options.find(item => item.tier === 4);
  const partItem = optionFour.detailSections.flatMap(section => section.items).find(item => item.parts?.some(part => part.kind === 'unsigned-percent'));
  const tierOneRef = inputs.authoring.presentations.find(item => item.entityRef.kind === 'blessing').tierPresentations.options.find(item => item.tier === 1).params.find(item => item.format === 'signed-percent').bindingRef;
  const percentPart = partItem.parts.find(part => part.kind === 'unsigned-percent');
  percentPart.bindingRef = structuredClone(tierOneRef);
  partItem.claimRefs = [structuredClone(tierOneRef)];
  badBlessing.detailSections = structuredClone(optionFour.detailSections);
  const badPartResult = validateWebAuthoring(badPart, inputs);
  assert.equal(badPartResult.valid, false);
  assert.ok(badPartResult.issues.some(item => item.code === 'tier-claim-binding'));

  const badDefault = structuredClone(inputs.authoring);
  presentation(badDefault).tierPresentations.defaultTier = 5;
  const defaultResult = validateWebAuthoring(badDefault, inputs);
  assert.equal(defaultResult.valid, false);
  assert.ok(defaultResult.issues.some(item => item.path.endsWith('/tierPresentations/defaultTier') && item.code === 'tier-default'));
});

// Scenario: a referenced terminology rule changes after review receipts are recorded.
// Purpose: stale only targets that cite the changed rule while preserving unrelated and official targets.
test('UnitT73_term-rule-dependencies-stale-only-targets-that-reference-the-edited-rule', async () => {
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w06' });
  const contract = structuredClone(inputs.authoring);
  const skill = contract.presentations.find(item => item.entityRef.kind === 'skill');
  const skillSection = skill.detailSections.find(section => section.items.some(item => item.termRuleRefs.includes('peril-general')));
  const skillSectionIndex = skill.detailSections.indexOf(skillSection);
  const skillItemIndex = skillSection.items.findIndex(item => item.termRuleRefs.includes('peril-general'));
  const skillTarget = contract.reviewTargets.find(target => target.ownerId === skill.authoringId
    && target.fieldPath === `/detailSections/${skillSectionIndex}/items/${skillItemIndex}`);
  const chainaxeTarget = contract.reviewTargets.find(target => target.ownerId !== skill.authoringId && target.fieldPath.includes('/items/'));
  const officialTarget = contract.reviewTargets.find(target => target.ownerId === skill.authoringId && target.dimension === 'official');
  const makeReceipt = target => createReviewReceipt(contract, target, {
    sourceContract: inputs.sourceContract,
    officialInputs: inputs.officialInputs,
    sourceValidator: inputs.sourceValidator,
    sourceRecordMap: inputs.sourceRecordMap,
    termRules: inputs.termRules,
    mode: inputs.mode,
    reviewer: { kind: 'human', id: 'test-reviewer' },
    reviewedAt: '2026-10-18T00:00:00Z',
  });
  for (const target of [skillTarget, chainaxeTarget, officialTarget]) contract.reviewReceipts.push(makeReceipt(target));
  assert.equal(getReviewState(contract, skillTarget.targetId, inputs), 'approved');
  const changedInputs = { ...inputs, termRules: structuredClone(inputs.termRules) };
  changedInputs.termRules.rules.find(rule => rule.ruleId === 'peril-general').targetText = '不同術語';
  assert.equal(getReviewState(contract, skillTarget.targetId, changedInputs), 'stale');
  assert.equal(getReviewState(contract, chainaxeTarget.targetId, changedInputs), 'approved');
  assert.equal(getReviewState(contract, officialTarget.targetId, changedInputs), 'approved');
});

// Scenario: a typed detail text leaf is reviewed and its Source claim later changes.
// Purpose: include the parent's claim dependencies in the leaf digest.
test('UnitT74_typed-detail-text-targets-retain-parent-claim-dependencies', async () => {
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w06' });
  const contract = structuredClone(inputs.authoring);
  const blessing = contract.presentations.find(item => item.entityRef.kind === 'blessing');
  const optionIndex = blessing.tierPresentations.options.findIndex(item => item.tier === 4);
  const target = {
    targetId: 'review:w06:test:typed-part-text', ownerKind: 'presentation', ownerId: blessing.authoringId,
    fieldPath: `/tierPresentations/options/${optionIndex}/detailSections/0/items/0/parts/0/text`, dimension: 'content',
  };
  contract.reviewTargets.push(target);
  assert.equal(validateWebAuthoring(contract, inputs).valid, true);
  const initial = computeReviewDigests(contract, target, inputs);
  const changedSource = structuredClone(inputs.sourceContract);
  const claim = changedSource.records.find(record => record.recordId === 'darktide:claim:chainaxe:p1-movement-speed-on-activation-tier4-display-percent');
  claim.payload.value.decimal = '21';
  const changedInputs = {
    ...inputs,
    sourceContract: changedSource,
    sourceRecordMap: new Map(changedSource.records.map(record => [`${record.gameReleaseId}\u0000${record.recordId}`, record])),
  };
  const changed = computeReviewDigests(contract, target, changedInputs);
  assert.notEqual(changed.dependenciesDigest, initial.dependenciesDigest);
});

// Scenario: the W06 terminology list is loaded from reviewed Mods Git evidence.
// Purpose: preserve the exact pinned file identity and verify the embedded official name hash.
test('UnitT75_w06-term-rule-provenance-is-pinned-to-the-reviewed-mods-line-bytes', async () => {
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w06' });
  const rules = inputs.termRules.rules;
  assert.equal(rules.length, 7);
  assert.equal(rules.every(rule => rule.sourceRef.commit === '241ad76ce62330472aa423055a5b85db59bb6c0d'), true);
  assert.equal(rules.every(rule => rule.sourceRef.path === 'Referneces/Translation.md'), true);
  assert.equal(rules.every(rule => rule.sourceRef.fileSha256 === 'fb60e9e8b7beb81765ca50acb3483b9a10e3148e82f630bdf43878a8e45543a0'), true);
  const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
  const oldName = inputs.officialInputs.sources.find(source => source.params.some(param => param.officialNameRef));
  const name = oldName.params.find(param => param.officialNameRef).officialNameRef;
  assert.equal(name.textSha256, hash(name.text));
});

// Scenario: an existing W06 skill display sentence binds an unsigned-percent part to the 1.5 ratio claim.
// Purpose: reject a resolvable Source claim whose unit is not percent before it can be rendered as a percent.
test('UnitT76_w06-rejects-ratio-claim-bound-to-unsigned-percent-part', async () => {
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w06' });
  const candidate = structuredClone(inputs.authoring);
  const skill = candidate.presentations.find(item => item.entityRef.kind === 'skill');
  const item = skill.detailSections.flatMap(section => section.items).find(entry => entry.itemId === 'psyker-description-damage-parameter');
  const ratioRef = {
    recordId: 'darktide:claim:psyker:brain-burst-improved-smite-damage-multiplier',
    gameReleaseId: 'darktide:1.13.2',
    kind: 'claim',
  };
  delete item.text;
  item.parts = [
    { kind: 'literal', text: 'damage ' },
    { kind: 'unsigned-percent', bindingRef: ratioRef },
  ];
  item.claimRefs = [ratioRef];
  const result = validateWebAuthoring(candidate, inputs);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.code === 'unsigned-percent-source'));
});

// Scenario: a Source display-percent claim changes after review receipts are recorded.
// Purpose: stale only official and content targets that resolve that exact claim, never names or another tier's official inputs.
test('UnitT77_w06-official-digest-includes-only-its-resolved-source-claims', async () => {
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w06' });
  const contract = structuredClone(inputs.authoring);
  const skillId = 'web:presentation:psyker-brain-burst-improved';
  const blessingId = 'web:presentation:chainaxe-p1-movement-speed';
  const officialTarget = contract.reviewTargets.find(target => target.ownerId === skillId && target.dimension === 'official');
  const contentTarget = contract.reviewTargets.find(target => target.ownerId === skillId && target.fieldPath === '/detailSections/0/items/1');
  const skillNameTarget = contract.reviewTargets.find(target => target.ownerId === skillId && target.fieldPath === '/name');
  const chainaxeTierFourTarget = contract.reviewTargets.find(target => target.ownerId === blessingId && target.targetId.endsWith(':tier-4'));
  const targets = [officialTarget, contentTarget, skillNameTarget, chainaxeTierFourTarget];
  const makeReceipt = target => createReviewReceipt(contract, target, {
    sourceContract: inputs.sourceContract,
    officialInputs: inputs.officialInputs,
    sourceValidator: inputs.sourceValidator,
    sourceRecordMap: inputs.sourceRecordMap,
    termRules: inputs.termRules,
    mode: inputs.mode,
    reviewer: { kind: 'human', id: 'test-reviewer' },
    reviewedAt: '2026-10-18T00:00:00Z',
  });
  for (const target of targets) {
    assert.ok(target);
    contract.reviewReceipts.push(makeReceipt(target));
    assert.equal(getReviewState(contract, target.targetId, inputs), 'approved');
  }
  const changedSource = structuredClone(inputs.sourceContract);
  const changedClaim = changedSource.records.find(record => record.recordId === 'darktide:claim:psyker:brain-burst-improved-description-display-percent');
  changedClaim.payload.value.decimal = '51';
  const changedInputs = {
    ...inputs,
    sourceContract: changedSource,
    sourceRecordMap: new Map(changedSource.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record])),
  };
  assert.equal(getReviewState(contract, officialTarget.targetId, changedInputs), 'stale');
  assert.equal(getReviewState(contract, contentTarget.targetId, changedInputs), 'stale');
  assert.equal(getReviewState(contract, skillNameTarget.targetId, changedInputs), 'approved');
  assert.equal(getReviewState(contract, chainaxeTierFourTarget.targetId, changedInputs), 'approved');
});

// Scenario: the W06 CLI is invoked repeatedly with identical fixed inputs and with a reused output directory.
// Purpose: make candidate bytes reproducible, keep validation-only mode read-only, and refuse overwriting human review files.
test('UnitT78_w06-cli-is-deterministic-and-never-overwrites-review-files', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'w06-cli-test-'));
  const cli = path.join(repoRoot, 'scripts/content/contract-w06.mjs');
  const firstRoot = path.join(tempRoot, 'first');
  const secondRoot = path.join(tempRoot, 'second');
  try {
    const validationOnly = spawnSync(process.execPath, [cli], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(validationOnly.status, 0, validationOnly.stderr);
    assert.match(validationOnly.stdout, /No output was written/);
    const first = spawnSync(process.execPath, [cli, '--out-root', firstRoot], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const second = spawnSync(process.execPath, [cli, '--out-root', secondRoot], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr);
    const firstMarkdown = await readFile(path.join(firstRoot, 'review-candidate.md'));
    const secondMarkdown = await readFile(path.join(secondRoot, 'review-candidate.md'));
    const firstMatrix = await readFile(path.join(firstRoot, 'review-matrix.json'));
    const secondMatrix = await readFile(path.join(secondRoot, 'review-matrix.json'));
    assert.deepEqual(firstMarkdown, secondMarkdown);
    assert.deepEqual(firstMatrix, secondMatrix);
    assert.doesNotMatch(firstMarkdown.toString('utf8'), /[ \t]+$/m, 'candidate Markdown must not contain trailing whitespace');
    const matrix = JSON.parse(firstMatrix.toString('utf8'));
    assert.equal(matrix.detailRows.length, 23);
    assert.equal(matrix.detailRows.every(row => row.reviewState === 'pending'), true);
    assert.equal(matrix.publicationEligible, false);
    assert.match(firstMarkdown.toString('utf8'), /23 句逐字沿用、0 項新增或差異/);
    const beforeRetry = await readFile(path.join(firstRoot, 'review-candidate.md'));
    const retry = spawnSync(process.execPath, [cli, '--out-root', firstRoot], { cwd: repoRoot, encoding: 'utf8' });
    assert.notEqual(retry.status, 0);
    assert.deepEqual(await readFile(path.join(firstRoot, 'review-candidate.md')), beforeRetry);
    const invalid = spawnSync(process.execPath, [cli, '--unknown'], { cwd: repoRoot, encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /usage:/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// Scenario: an official source literal and its local sourceText hash are edited while the W06 lock remains fixed.
// Purpose: prove that recomputing embedded hashes cannot replace the pinned official snapshot.
test('UnitT79_w06-loader-rejects-official-input-tampering-after-local-rehash', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'w06-official-tamper-'));
  try {
    const paths = [
      'content/schema/v2/web-authoring.schema.json',
      'content/authoring/v2/w06-skills-blessings.json',
      'content/contracts/w06',
      'content/terms/w06-rules.json',
    ];
    for (const relativePath of paths) {
      const source = path.join(repoRoot, relativePath);
      const destination = path.join(tempRoot, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true });
    }
    const officialPath = path.join(tempRoot, 'content/contracts/w06/official-inputs.json');
    const officialInputs = JSON.parse(await readFile(officialPath, 'utf8'));
    officialInputs.sources[0].sourceText += ' tampered';
    officialInputs.sources[0].sourceTextSha256 = createHash('sha256').update(officialInputs.sources[0].sourceText, 'utf8').digest('hex');
    await writeFile(officialPath, JSON.stringify(officialInputs, null, 2) + '\n', 'utf8');
    await assert.rejects(
      loadWebAuthoringInputs({ repoRoot: tempRoot, mode: 'w06' }),
      /pinned official input snapshot hash mismatch/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// Scenario: invalid Source values are selected for an unsigned-percent detail part.
// Purpose: reject unknown, negative, and malformed decimal values before display formatting.
test('UnitT80_w06-unsigned-percent-rejects-unknown-negative-and-malformed-values', async () => {
  const inputs = await loadWebAuthoringInputs({ repoRoot, mode: 'w06' });
  const ref = {
    recordId: 'darktide:claim:psyker:brain-burst-improved-description-display-percent',
    gameReleaseId: 'darktide:1.13.2',
    kind: 'claim',
  };
  const cases = [
    ['unknown', { status: 'unknown', reasonCode: 'NOT_VERIFIED' }],
    ['negative', { status: 'known', decimal: '-1', unit: 'percent' }],
    ['malformed', { status: 'known', decimal: '1e2', unit: 'percent' }],
  ];
  for (const [label, value] of cases) {
    const candidate = structuredClone(inputs.authoring);
    const skill = candidate.presentations.find(item => item.entityRef.kind === 'skill');
    const item = skill.detailSections[0].items.find(entry => entry.itemId === 'psyker-description-damage-parameter');
    delete item.text;
    item.parts = [
      { kind: 'literal', text: 'damage ' },
      { kind: 'unsigned-percent', bindingRef: structuredClone(ref) },
    ];
    item.claimRefs = [structuredClone(ref)];
    const changedSource = structuredClone(inputs.sourceContract);
    changedSource.records.find(record => record.recordId === ref.recordId).payload.value = structuredClone(value);
    const changedInputs = {
      ...inputs,
      sourceContract: changedSource,
      sourceRecordMap: new Map(changedSource.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record])),
    };
    const result = validateWebAuthoring(candidate, changedInputs);
    assert.equal(result.valid, false, label);
    assert.ok(result.issues.some(issue => issue.code === 'unsigned-percent-source'), label);
  }
});

// Scenario: the candidate generator reads the same W01 blob while the checked-out Git HEAD advances.
// Purpose: keep the accepted wording baseline locator stable across the later W06 implementation commit.
test('UnitT81_w06-baseline-locator-is-independent-of-current-head', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'w06-baseline-test-'));
  const expected = {
    commit: 'b0c52e2f62cc7b08bec275ebc8e8a9d6fbffec30',
    sha256: '038cecd27f151943b54b9cd8487de05cf293011e701580f87a9bd62b061d1513',
  };
  const blobOid = 'abd12fff64c1f32c80f59ef6e0d2ecff9cb83593';
  const w01Bytes = execFileSync('git', ['cat-file', 'blob', blobOid], { cwd: repoRoot });
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: tempRoot });
    execFileSync('git', ['config', 'user.email', 'w06-test@example.invalid'], { cwd: tempRoot });
    execFileSync('git', ['config', 'user.name', 'W06 Test'], { cwd: tempRoot });
    const insertedBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: tempRoot,
      input: w01Bytes,
      encoding: 'utf8',
    }).trim();
    assert.equal(insertedBlob, blobOid);
    const w01Path = path.join(tempRoot, 'content/w01/web-authoring.json');
    await mkdir(path.dirname(w01Path), { recursive: true });
    await writeFile(w01Path, w01Bytes);
    execFileSync('git', ['add', 'content/w01/web-authoring.json'], { cwd: tempRoot });
    execFileSync('git', ['commit', '--quiet', '-m', 'baseline input'], { cwd: tempRoot });
    const before = committedW01(tempRoot);
    await writeFile(path.join(tempRoot, 'unrelated.txt'), 'advance HEAD\n');
    execFileSync('git', ['add', 'unrelated.txt'], { cwd: tempRoot });
    execFileSync('git', ['commit', '--quiet', '-m', 'advance HEAD'], { cwd: tempRoot });
    const after = committedW01(tempRoot);
    assert.equal(before.commit, after.commit);
    assert.equal(before.commit, expected.commit);
    assert.equal(before.sha256, expected.sha256);
    assert.equal(after.sha256, expected.sha256);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
