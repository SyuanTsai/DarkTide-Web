import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertWebAuthoringSchemaParity,
  computeReviewDigests,
  createReviewReceipt,
  getReviewState,
  loadWebAuthoringInputs,
  validateWebAuthoring,
} from '../scripts/content/contract-authoring.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoRoot, 'content', 'fixtures', 'v2', 'web-authoring', 'representative.json');
const schemaPath = path.join(repoRoot, 'content', 'schema', 'v2', 'web-authoring.schema.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function loadInputs(options) {
  return loadWebAuthoringInputs({ repoRoot, ...options });
}

function validate(contract, inputs) {
  return validateWebAuthoring(contract, inputs);
}

// Scenario: Web authoring keeps its own contract while resolving fixed Source-owned technical refs.
// Purpose: guard the Draft 2020-12 shape, every presentation kind, strict owner separation, and a non-publishable synthetic baseline.
test('UnitT00_schema-and-representative-fixture-cover-web-owned-authoring-shapes', async () => {
  const [schemaBytes, fixtureBytes, inputs] = await Promise.all([
    readFile(schemaPath),
    readFile(fixturePath),
    loadInputs(),
  ]);
  const schema = JSON.parse(schemaBytes.toString('utf8'));
  const fixture = JSON.parse(fixtureBytes.toString('utf8'));
  const result = validate(fixture, inputs);

  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.$id, 'urn:darktide-web:web-authoring:2.0.0');
  assert.equal(assertWebAuthoringSchemaParity(schema), true);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.publicationEligible, false);
  assert.equal(fixture.fixtureOnly, true);
  assert.equal(fixture.publicationEligible, false);
  assert.deepEqual(
    [...new Set(fixture.presentations.map(item => item.entityRef.kind))].sort(),
    ['blessing', 'catalog', 'classification', 'curio', 'perk', 'skill', 'weapon'],
  );
  const weapon = fixture.presentations.find(item => item.authoringId === 'fixture:presentation:weapon-r1');
  assert.equal(weapon.official.resolvedText, 'Synthetic official weapon value: 40.');
  const weaponR2 = fixture.presentations.find(item => item.authoringId === 'fixture:presentation:weapon-r2');
  const expectedExamples = new Map([
    ['fixture:presentation:skill-r1', ['合成技能範例', '合成技能的官方說明。']],
    ['fixture:presentation:blessing-r1', ['合成祝福範例', '合成祝福的官方說明。']],
    ['fixture:presentation:weapon-r1', ['合成武器範例', '合成武器的官方數值：40。']],
    ['fixture:presentation:weapon-r2', ['合成武器範例', '合成武器的官方數值：41。']],
    ['fixture:presentation:catalog-r1', ['合成目錄項目範例', '合成目錄項目的官方說明。']],
    ['fixture:presentation:curio-r1', ['合成珍品範例', '合成珍品的官方說明。']],
    ['fixture:presentation:perk-r1', ['合成附加屬性範例', '合成附加屬性的官方說明。']],
    ['fixture:presentation:classification-r1', ['合成分類範例', '合成分類的官方說明。']],
  ]);
  for (const presentation of fixture.presentations) {
    const [expectedName, expectedTranslation] = expectedExamples.get(presentation.authoringId) ?? [];
    assert.equal(presentation.name, expectedName, `${presentation.authoringId} name`);
    assert.equal(presentation.faithfulTranslation.text, expectedTranslation, `${presentation.authoringId} translation`);
    assert.equal(presentation.faithfulTranslation.textSha256, hash(Buffer.from(expectedTranslation, 'utf8')));
  }
  assert.equal(weapon.faithfulTranslation.text, '合成武器的官方數值：40。');
  assert.equal(weaponR2.official.resolvedText, 'Synthetic official weapon value: 41.');
  assert.equal(weaponR2.faithfulTranslation.text, '合成武器的官方數值：41。');
  assert.notEqual(weapon.faithfulTranslation.text, '合成武器的官方數值：0。');
  assert.notEqual(weaponR2.faithfulTranslation.text, '合成武器的官方數值：1.25。');
  assert.equal(
    inputs.sourceContract.records.find(item => item.recordId === 'fixture:claim:damage' && item.gameReleaseId === 'fixture-r1')
      .payload.value.decimal,
    '0',
  );
  const sourceValue = inputs.sourceContract.records.find(item => item.recordId === 'fixture:claim:damage' && item.gameReleaseId === 'fixture-r1').payload.value.decimal;
  assert.equal(sourceValue, '0');
  assert.notEqual(weapon.official.resolvedText, 'Synthetic official weapon value: ' + sourceValue + '.');
  assert.equal(fixture.gameChanges[0].changeId, 'fixture:game-change:curve');
  assert.equal(fixture.announcements.some(item => item.scope === 'site' && !Object.hasOwn(item, 'gameReleaseId')), true);
});

// Scenario: an editor changes the official wording and recomputes all local hashes without changing the pinned input snapshot.
// Purpose: prove hashes alone cannot authorize rewritten official source text and errata must remain anchored to exact source segments.
test('UnitT10_rejects_rehashed-official-text-and-broken-errata-anchor', async () => {
  const inputs = await loadInputs();
  const changed = structuredClone(inputs.authoring);
  const weapon = changed.presentations.find(item => item.authoringId === 'fixture:presentation:weapon-r1');
  weapon.official.segments[0].text = 'Adjusted synthetic damage: ';
  weapon.official.segments[0].sha256 = hash(Buffer.from(weapon.official.segments[0].text, 'utf8'));
  weapon.official.sourceText = 'Adjusted synthetic damage: {value}.';
  weapon.official.sourceTextSha256 = hash(Buffer.from(weapon.official.sourceText, 'utf8'));
  weapon.official.resolvedText = 'Adjusted synthetic damage: 40.';
  weapon.official.resolvedTextSha256 = hash(Buffer.from(weapon.official.resolvedText, 'utf8'));
  let result = validate(changed, inputs);
  assert.equal(result.valid, false);
  assert.match(result.issues.map(issue => issue.message).join('\n'), /fixed official input snapshot/i);

  const badAnchor = structuredClone(inputs.authoring);
  const erratum = badAnchor.presentations.find(item => item.authoringId === 'fixture:presentation:weapon-r1').errata[0];
  erratum.anchor.segmentSha256 = 'f'.repeat(64);
  result = validate(badAnchor, inputs);
  assert.equal(result.valid, false);
  assert.match(result.issues.map(issue => issue.message).join('\n'), /errata anchor/i);
});

// Scenario: a Web ref targets the wrong Source record kind or crosses releases without a compatibility record.
// Purpose: keep composite release-scoped IDs, expected kinds, and explicit compatibility evidence enforceable.
test('UnitT11_rejects-wrong-kind-dangling-unproven-cross-release-refs-and-undefined-tier', async () => {
  const inputs = await loadInputs();
  const wrongKind = structuredClone(inputs.authoring);
  wrongKind.presentations.find(item => item.authoringId === 'fixture:presentation:skill-r1').entityRef.kind = 'weapon';
  assert.equal(validate(wrongKind, inputs).valid, false);

  const missingCompatibility = structuredClone(inputs.authoring);
  const detail = missingCompatibility.presentations.find(item => item.authoringId === 'fixture:presentation:weapon-r2')
    .detailSections.find(section => section.sectionId === 'extra').items[0];
  delete detail.termRefs[0].compatibilityRef;
  assert.equal(validate(missingCompatibility, inputs).valid, false);

  const dangling = structuredClone(inputs.authoring);
  dangling.presentations.find(item => item.authoringId === 'fixture:presentation:weapon-r1').detailSections[0].items[0]
    .claimRefs[0].recordId = 'fixture:claim:missing';
  assert.equal(validate(dangling, inputs).valid, false);

  const undefinedTier = structuredClone(inputs.authoring);
  undefinedTier.presentations.find(item => item.authoringId === 'fixture:presentation:blessing-r1')
    .tierApplicability[0].tiers = [99];
  assert.equal(validate(undefinedTier, inputs).valid, false);
});

// Scenario: only the target field, its official input, and explicitly referenced Source records change.
// Purpose: derive field-scoped review state so translation edits do not stale details and unrelated records do not stale the target.
test('UnitT20_review-digests-track-real-field-dependencies-without-global-staleness', async () => {
  const inputs = await loadInputs();
  const sourceRefs = {
    sourceContract: inputs.sourceContract,
    officialInputs: inputs.officialInputs,
    sourceValidator: inputs.sourceValidator,
  };
  const detailTarget = inputs.authoring.reviewTargets.find(item => item.targetId === 'fixture:review:weapon-r1-details');
  const translationTarget = inputs.authoring.reviewTargets.find(item => item.targetId === 'fixture:review:weapon-r1-translation');
  const tierTarget = inputs.authoring.reviewTargets.find(item => item.targetId === 'fixture:review:blessing-r1-tiers');
  const detailReceipt = createReviewReceipt(inputs.authoring, detailTarget, {
    ...sourceRefs,
    reviewer: { kind: 'human', id: 'synthetic-reviewer' },
    reviewedAt: '2026-10-18T00:00:00Z',
  });
  const translationReceipt = createReviewReceipt(inputs.authoring, translationTarget, {
    ...sourceRefs,
    reviewer: { kind: 'human', id: 'synthetic-reviewer' },
    reviewedAt: '2026-10-18T00:00:00Z',
  });
  const tierReceipt = createReviewReceipt(inputs.authoring, tierTarget, {
    ...sourceRefs,
    reviewer: { kind: 'human', id: 'synthetic-reviewer' },
    reviewedAt: '2026-10-18T00:00:00Z',
  });
  const approved = structuredClone(inputs.authoring);
  approved.reviewReceipts.push(detailReceipt, translationReceipt, tierReceipt);
  assert.equal(validate(approved, inputs).valid, true);
  assert.equal(getReviewState(approved, detailTarget.targetId, sourceRefs), 'approved');
  assert.equal(getReviewState(approved, tierTarget.targetId, sourceRefs), 'approved');

  const wordingEdit = structuredClone(approved);
  const translation = wordingEdit.presentations.find(item => item.authoringId === 'fixture:presentation:weapon-r1').faithfulTranslation;
  translation.text += '，僅供示意。';
  translation.textSha256 = hash(Buffer.from(translation.text, 'utf8'));
  assert.equal(getReviewState(wordingEdit, translationTarget.targetId, sourceRefs), 'stale');
  assert.equal(getReviewState(wordingEdit, detailTarget.targetId, sourceRefs), 'approved');

  const changedOfficialInputs = structuredClone(inputs.officialInputs);
  changedOfficialInputs.sources.find(item => item.officialSourceId === 'fixture:official:weapon-r1').resolvedText += ' corrected';
  assert.equal(getReviewState(approved, detailTarget.targetId, { ...sourceRefs, officialInputs: changedOfficialInputs }), 'stale');

  const unrelatedSourceEdit = structuredClone(inputs.sourceContract);
  unrelatedSourceEdit.records.find(item => item.kind === 'catalog').payload.catalogKey = 'fixture-catalog-renamed';
  const changedInputs = { ...sourceRefs, sourceContract: unrelatedSourceEdit };
  assert.equal(getReviewState(approved, detailTarget.targetId, changedInputs), 'approved');
  const commitOnlyEdit = structuredClone(inputs.sourceContract);
  commitOnlyEdit.gameReleases.find(item => item.gameReleaseId === 'fixture-r1').snapshot.commit = 'ffffffffffffffffffffffffffffffffffffffff';
  assert.equal(getReviewState(approved, detailTarget.targetId, { ...sourceRefs, sourceContract: commitOnlyEdit }), 'approved');

  const claimContextEdit = structuredClone(inputs.sourceContract);
  claimContextEdit.records.find(item => item.recordId === 'fixture:claim:damage' && item.gameReleaseId === 'fixture-r1')
    .payload.context.mode = 'synthetic-alternate-mode';
  assert.equal(getReviewState(approved, detailTarget.targetId, { ...sourceRefs, sourceContract: claimContextEdit }), 'stale');

  const tierValueEdit = structuredClone(inputs.sourceContract);
  tierValueEdit.records.find(item => item.recordId === 'fixture:variant:alpha' && item.gameReleaseId === 'fixture-r1')
    .payload.tierValues[0].value.decimal = '0.01';
  assert.equal(getReviewState(approved, tierTarget.targetId, { ...sourceRefs, sourceContract: tierValueEdit }), 'stale');

  const claimEdit = structuredClone(inputs.sourceContract);
  claimEdit.records.find(item => item.recordId === 'fixture:claim:damage' && item.gameReleaseId === 'fixture-r1')
    .payload.value.decimal = '0.5';
  const changedClaimInputs = { ...sourceRefs, sourceContract: claimEdit };
  assert.notDeepEqual(
    computeReviewDigests(inputs.authoring, detailTarget, sourceRefs),
    computeReviewDigests(inputs.authoring, detailTarget, changedClaimInputs),
  );
  assert.equal(getReviewState(approved, detailTarget.targetId, changedClaimInputs), 'stale');
});

// Scenario: a pinned Source snapshot cache file is corrupted.
// Purpose: verify the offline file bytes; the explicit real-checkout smoke is run with --source-root.
test('InterT30_source-snapshot-hashes-and-verified-file-tree-bytes-are-checked', async t => {
  const inputs = await loadInputs();
  const snapshotRoot = path.join(repoRoot, 'content', 'contracts', 'source-v2-snapshot');
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'web-source-contract-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const tamperedSnapshot = path.join(tempRoot, 'tampered');
  await cp(snapshotRoot, tamperedSnapshot, { recursive: true });
  const schemaFile = path.join(tamperedSnapshot, 'content', 'schema', 'v2', 'source-contract.schema.json');
  const bytes = await readFile(schemaFile);
  bytes[0] ^= 1;
  await writeFile(schemaFile, bytes);
  await assert.rejects(
    loadWebAuthoringInputs({ repoRoot, sourceSnapshotRoot: tamperedSnapshot }),
    /pinned Source snapshot hash mismatch/i,
  );

  const verifiedSnapshot = await loadWebAuthoringInputs({ repoRoot, sourceSnapshotRoot: snapshotRoot });
  assert.equal(verifiedSnapshot.sourceCheck.matchesPinnedSnapshot, null);
  assert.equal(verifiedSnapshot.sourceValidation.valid, true);
});

// Scenario: a candidate invents an official text update from the same source snapshot or reuses a Source change ID.
// Purpose: prevent source revision/baseline noise and ID collisions from entering the game-change view.
test('UnitT30_game-change-owner-comparison-and-id-rules-reject-false-updates', async () => {
  const inputs = await loadInputs();
  const sameSnapshot = structuredClone(inputs.authoring);
  sameSnapshot.officialTextChanges[0].toOfficialSourceId = sameSnapshot.officialTextChanges[0].fromOfficialSourceId;
  assert.equal(validate(sameSnapshot, inputs).valid, false);

  const collidingId = structuredClone(inputs.authoring);
  collidingId.officialTextChanges[0].changeId = 'fixture:game-change:curve';
  assert.equal(validate(collidingId, inputs).valid, false);

  const modifierField = structuredClone(inputs.authoring);
  modifierField.gameChanges[0].impact = 'no-mod-impact';
  assert.equal(validate(modifierField, inputs).valid, false);

  const sameBuildInputs = { ...inputs, sourceContract: structuredClone(inputs.sourceContract) };
  const fromRelease = sameBuildInputs.sourceContract.gameReleases.find(item => item.gameReleaseId === 'fixture-r1');
  const toRelease = sameBuildInputs.sourceContract.gameReleases.find(item => item.gameReleaseId === 'fixture-r2');
  toRelease.gameVersion = fromRelease.gameVersion;
  toRelease.gameBuild = fromRelease.gameBuild;
  const sameBuildResult = validate(inputs.authoring, sameBuildInputs);
  assert.equal(sameBuildResult.valid, false);
  assert.match(sameBuildResult.issues.map(issue => issue.message).join('\n'), /same-version\/build/i);

  const empty = structuredClone(inputs.authoring);
  empty.gameChanges = [];
  empty.officialTextChanges = [];
  assert.equal(validate(empty, inputs).valid, true);
});

// Scenario: a document supplies an approval state or publication flag instead of a digest-bound receipt.
// Purpose: keep pending/stale/approved derived from valid receipts and prevent fixtures from becoming publishable.
test('UnitT40_review-state-is-derived-and-fixture-cannot-self-approve', async () => {
  const inputs = await loadInputs();
  const target = inputs.authoring.reviewTargets.find(item => item.targetId === 'fixture:review:weapon-r1-details');
  assert.equal(getReviewState(inputs.authoring, target.targetId, inputs), 'pending');

  const forgedState = structuredClone(inputs.authoring);
  forgedState.presentations.find(item => item.authoringId === 'fixture:presentation:weapon-r1').reviewState = 'approved';
  assert.equal(validate(forgedState, inputs).valid, false);

  const publishable = structuredClone(inputs.authoring);
  publishable.publicationEligible = true;
  assert.equal(validate(publishable, inputs).valid, false);

  const receipt = createReviewReceipt(inputs.authoring, target, {
    ...inputs,
    reviewer: { kind: 'human', id: 'synthetic-reviewer' },
    reviewedAt: '2026-10-18T00:00:00Z',
  });
  assert.equal(receipt.reviewer.kind, 'human');
  assert.equal(receipt.targetDigest.length, 64);
  assert.equal(receipt.dependenciesDigest.length, 64);
});

// Scenario: the documented offline CLI runs against pinned synthetic fixtures without a sibling checkout.
// Purpose: keep the package entry point usable in standalone CI while the explicit --source-root smoke remains separate.
test('UnitT50_offline-authoring-cli-validates-the-fixed-fixture', () => {
  const output = execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'content', 'contract-authoring.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.match(output, /presentations=8/);
  assert.match(output, /publicationEligible=false/);
});

// Scenario: a presentation omits empty detail sections while preserving the declared order.
// Purpose: allow an ordered subset of the five known section names, but reject repeated or reversed sections.
test('UnitT60_detail-sections-allow-ordered-subsets-and-reject-duplicates-or-reordering', async () => {
  const inputs = await loadInputs();
  const presentationFor = contract => contract.presentations.find(item => item.authoringId === 'fixture:presentation:weapon-r1');
  const omittedEmpty = structuredClone(inputs.authoring);
  presentationFor(omittedEmpty).detailSections = [presentationFor(omittedEmpty).detailSections[0]];
  assert.equal(validate(omittedEmpty, inputs).valid, true);

  const repeated = structuredClone(inputs.authoring);
  const repeatedSections = presentationFor(repeated).detailSections;
  repeatedSections.pop();
  repeatedSections.push(structuredClone(repeatedSections[0]));
  const repeatedResult = validate(repeated, inputs);
  assert.equal(repeatedResult.valid, false);
  assert.ok(repeatedResult.issues.some(item => item.code === 'section-order'));

  const reversed = structuredClone(inputs.authoring);
  presentationFor(reversed).detailSections = presentationFor(reversed).detailSections.slice(0, 2).reverse();
  const reversedResult = validate(reversed, inputs);
  assert.equal(reversedResult.valid, false);
  assert.ok(reversedResult.issues.some(item => item.code === 'section-order'));
});

// Scenario: an erratum points to a valid segment belonging to a different presentation, or a source repeats a segment ID.
// Purpose: bind each correction to its own official entity/release and keep anchors unambiguous.
test('UnitT61_errata-anchors-are-owner-bound-and-official-segment-ids-are-unique', async () => {
  const inputs = await loadInputs();
  const wrongOwner = structuredClone(inputs.authoring);
  const weapon = wrongOwner.presentations.find(item => item.authoringId === 'fixture:presentation:weapon-r1');
  const skillSource = inputs.officialInputs.sources.find(item => item.officialSourceId === 'fixture:official:skill-r1');
  const skillSegment = skillSource.segments[0];
  weapon.errata[0].anchor = {
    officialSourceId: skillSource.officialSourceId,
    segmentId: skillSegment.segmentId,
    segmentSha256: skillSegment.sha256,
  };
  const ownerResult = validate(wrongOwner, inputs);
  assert.equal(ownerResult.valid, false);
  assert.ok(ownerResult.issues.some(item => item.code === 'errata-owner'));

  const duplicateSegments = { ...inputs, officialInputs: structuredClone(inputs.officialInputs) };
  const ownSource = duplicateSegments.officialInputs.sources.find(item => item.officialSourceId === 'fixture:official:weapon-r1');
  ownSource.segments.push(structuredClone(ownSource.segments[0]));
  const duplicateResult = validate(duplicateSegments.authoring, duplicateSegments);
  assert.equal(duplicateResult.valid, false);
  assert.ok(duplicateResult.issues.some(item => item.code === 'duplicate-id' && /segment/i.test(item.message)));
});

// Scenario: two releases and source locators differ while every official text byte and binding remains identical.
// Purpose: prevent release metadata alone from being represented as an official text update.
test('UnitT62_official-text-change-requires-a-real-ordered-text-or-binding-difference', async () => {
  const inputs = await loadInputs();
  const sameTextInputs = {
    ...inputs,
    authoring: structuredClone(inputs.authoring),
    officialInputs: structuredClone(inputs.officialInputs),
  };
  const from = sameTextInputs.officialInputs.sources.find(item => item.officialSourceId === 'fixture:official:weapon-r1');
  const to = structuredClone(from);
  to.officialSourceId = 'fixture:official:weapon-r2-same-text';
  to.entityRef.gameReleaseId = 'fixture-r2';
  to.resource = 'another synthetic resource locator';
  to.key = 'fixture_weapon_alpha_other_key';
  sameTextInputs.officialInputs.sources.push(to);
  sameTextInputs.authoring.officialTextChanges[0].toOfficialSourceId = to.officialSourceId;

  const result = validate(sameTextInputs.authoring, sameTextInputs);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(item => item.code === 'same-official-text'));
});

// Scenario: Web supplies localized summaries for Source-owned game-change fields.
// Purpose: bind each summary to a real Source field and review its prose against that exact Source change.
test('UnitT32_game-change-field-summaries-map-to-source-and-have-scoped-reviews', async () => {
  const inputs = await loadInputs();
  const contract = structuredClone(inputs.authoring);
  const change = contract.gameChanges[0];
  assert.equal(validate(contract, inputs).valid, true);

  const wrongField = structuredClone(contract);
  wrongField.gameChanges[0].fieldSummaries[0].field = 'totally_nonexistent_field';
  const wrongFieldResult = validate(wrongField, inputs);
  assert.equal(wrongFieldResult.valid, false);
  assert.ok(wrongFieldResult.issues.some(item => item.code === 'game-change-field'));
  const duplicateField = structuredClone(contract);
  duplicateField.gameChanges[0].fieldSummaries.push({ ...duplicateField.gameChanges[0].fieldSummaries[0] });
  const duplicateFieldResult = validate(duplicateField, inputs);
  assert.equal(duplicateFieldResult.valid, false);
  assert.ok(duplicateFieldResult.issues.some(item => item.code === 'duplicate-id'));

  const sourceWithSecondField = structuredClone(inputs.sourceContract);
  const sourceChange = sourceWithSecondField.records.find(item => item.kind === 'game-change' && item.recordId === change.changeId);
  const secondField = structuredClone(sourceChange.payload.changedFields[0]);
  secondField.field = 'synthetic-secondary';
  secondField.before.decimal = '2';
  secondField.after.decimal = '3';
  sourceChange.payload.changedFields.push(secondField);
  const sourceValidation = inputs.sourceValidator.validateSourceContract(sourceWithSecondField, { schema: inputs.sourceSchema });
  assert.equal(sourceValidation.valid, true, JSON.stringify(sourceValidation.issues));
  const subsetInputs = {
    ...inputs,
    sourceContract: sourceWithSecondField,
    sourceValidation,
    sourceRecordMap: new Map(sourceWithSecondField.records.map(item => [item.gameReleaseId + '\u0000' + item.recordId, item])),
  };
  assert.equal(validate(contract, subsetInputs).valid, true, JSON.stringify(validate(contract, subsetInputs).issues));

  const fieldSummaryTarget = {
    targetId: 'fixture:review:game-change-first-field-summary',
    ownerKind: 'game-change',
    ownerId: change.changeId,
    fieldPath: '/fieldSummaries/0/summary',
    dimension: 'content',
  };
  contract.reviewTargets.push(fieldSummaryTarget);
  assert.equal(validate(contract, inputs).valid, true);
  contract.reviewReceipts.push(createReviewReceipt(contract, fieldSummaryTarget, {
    ...inputs,
    reviewer: { kind: 'human', id: 'synthetic-reviewer' },
    reviewedAt: '2026-10-18T00:00:00Z',
  }));
  assert.equal(getReviewState(contract, fieldSummaryTarget.targetId, inputs), 'approved');

  const changedSummary = structuredClone(contract);
  changedSummary.gameChanges[0].fieldSummaries[0].summary = '另一個合成欄位摘要。';
  assert.equal(getReviewState(changedSummary, fieldSummaryTarget.targetId, inputs), 'stale');

  const changedSourceChange = structuredClone(inputs.sourceContract);
  changedSourceChange.records.find(item => item.kind === 'game-change' && item.recordId === change.changeId)
    .payload.changedFields[0].after.decimal = '9';
  const changedSourceInputs = {
    ...inputs,
    sourceContract: changedSourceChange,
    sourceRecordMap: new Map(changedSourceChange.records.map(item => [item.gameReleaseId + '\u0000' + item.recordId, item])),
  };
  assert.equal(getReviewState(contract, fieldSummaryTarget.targetId, changedSourceInputs), 'stale');
});

// Scenario: Web-owned names and term prose are reviewed separately from Source mechanics and context.
// Purpose: keep actual wording edits stale while unrelated technical changes do not invalidate text review.
test('UnitT63_name-and-term-text-reviews-are-field-scoped-and-context-bound', async () => {
  const inputs = await loadInputs();
  const contract = structuredClone(inputs.authoring);
  const nameTarget = contract.reviewTargets.find(item => item.targetId === 'fixture:review:weapon-r1-name');
  const labelTarget = contract.reviewTargets.find(item => item.targetId === 'fixture:review:term-label');
  const definitionTarget = contract.reviewTargets.find(item => item.targetId === 'fixture:review:term-definition');
  const itemTextTarget = {
    targetId: 'fixture:review:weapon-r1-first-item-text', ownerKind: 'presentation',
    ownerId: 'fixture:presentation:weapon-r1', fieldPath: '/detailSections/0/items/0/text', dimension: 'content',
  };
  const errataContextTarget = {
    targetId: 'fixture:review:weapon-r1-errata-context', ownerKind: 'presentation',
    ownerId: 'fixture:presentation:weapon-r1', fieldPath: '/errata/0/context/description', dimension: 'context',
  };
  const termContextTarget = {
    targetId: 'fixture:review:term-context', ownerKind: 'term-localization',
    ownerId: 'fixture:term-localization:alpha-zh-tw', fieldPath: '/contextKey', dimension: 'context',
  };
  const gameChangeTarget = {
    targetId: 'fixture:review:game-change-summary', ownerKind: 'game-change',
    ownerId: 'fixture:game-change:curve', fieldPath: '/summary', dimension: 'game-change',
  };
  const officialChangeTarget = {
    targetId: 'fixture:review:official-text-change-summary', ownerKind: 'official-text-change',
    ownerId: 'fixture:official-text-change:weapon', fieldPath: '/summary', dimension: 'game-change',
  };
  const announcementTarget = {
    targetId: 'fixture:review:site-announcement-blocks', ownerKind: 'announcement',
    ownerId: 'fixture:announcement:site', fieldPath: '/blocks', dimension: 'announcement',
  };
  const gameplayAnnouncement = structuredClone(contract.announcements[0]);
  gameplayAnnouncement.announcementId = 'fixture:announcement:gameplay';
  gameplayAnnouncement.scope = 'gameplay';
  gameplayAnnouncement.gameReleaseId = 'fixture-r2';
  gameplayAnnouncement.source = { kind: 'official-game-source', locator: 'https://synthetic.invalid/patch/1', sha256: 'b'.repeat(64) };
  contract.announcements.push(gameplayAnnouncement);
  const gameplayAnnouncementTarget = {
    targetId: 'fixture:review:gameplay-announcement-blocks', ownerKind: 'announcement',
    ownerId: 'fixture:announcement:gameplay', fieldPath: '/blocks', dimension: 'announcement',
  };
  contract.reviewTargets.push(itemTextTarget, errataContextTarget, termContextTarget, gameChangeTarget, officialChangeTarget, announcementTarget, gameplayAnnouncementTarget);
  assert.equal(validate(contract, inputs).valid, true);
  const targets = [nameTarget, labelTarget, definitionTarget, itemTextTarget, errataContextTarget, termContextTarget, gameChangeTarget, officialChangeTarget, announcementTarget, gameplayAnnouncementTarget];
  for (const target of targets) {
    contract.reviewReceipts.push(createReviewReceipt(contract, target, {
      ...inputs, reviewer: { kind: 'human', id: 'synthetic-reviewer' }, reviewedAt: '2026-10-18T00:00:00Z',
    }));
    assert.equal(getReviewState(contract, target.targetId, inputs), 'approved');
  }
  const withSourceContract = sourceContract => ({
    ...inputs,
    sourceContract,
    sourceRecordMap: new Map(sourceContract.records.map(item => [item.gameReleaseId + '\u0000' + item.recordId, item])),
  });

  const changedDamage = structuredClone(inputs.sourceContract);
  changedDamage.records.find(item => item.recordId === 'fixture:claim:damage' && item.gameReleaseId === 'fixture-r1').payload.value.decimal = '8';
  const technicalEdit = withSourceContract(changedDamage);
  assert.equal(getReviewState(contract, nameTarget.targetId, technicalEdit), 'approved');
  assert.equal(getReviewState(contract, labelTarget.targetId, technicalEdit), 'approved');
  assert.equal(getReviewState(contract, definitionTarget.targetId, technicalEdit), 'stale');
  assert.equal(getReviewState(contract, itemTextTarget.targetId, technicalEdit), 'stale');

  const changedDefinition = structuredClone(inputs.sourceContract);
  changedDefinition.records.find(item => item.kind === 'term' && item.gameReleaseId === 'fixture-r1').payload.technicalDefinitionEn = 'A materially different synthetic definition.';
  const definitionEdit = withSourceContract(changedDefinition);
  assert.equal(getReviewState(contract, definitionTarget.targetId, definitionEdit), 'stale');
  assert.equal(getReviewState(contract, labelTarget.targetId, definitionEdit), 'approved');
  const unrelatedClaimEdit = structuredClone(inputs.sourceContract);
  unrelatedClaimEdit.records.find(item => item.recordId === 'fixture:claim:r2' && item.gameReleaseId === 'fixture-r2').payload.value.decimal = '1.3';
  assert.equal(getReviewState(contract, definitionTarget.targetId, withSourceContract(unrelatedClaimEdit)), 'approved');

  const changedName = structuredClone(contract);
  changedName.presentations.find(item => item.authoringId === nameTarget.ownerId).name = '新名稱';
  assert.equal(getReviewState(changedName, nameTarget.targetId, inputs), 'stale');
  const changedLabel = structuredClone(contract);
  changedLabel.termLocalizations[0].label = '新術語';
  assert.equal(getReviewState(changedLabel, labelTarget.targetId, inputs), 'stale');
  const changedContext = structuredClone(inputs.sourceContract);
  changedContext.records.find(item => item.kind === 'term' && item.gameReleaseId === 'fixture-r1').payload.contextKey = 'another_context';
  const contextEditInputs = {
    ...inputs,
    sourceContract: changedContext,
    sourceRecordMap: new Map(changedContext.records.map(item => [item.gameReleaseId + '\u0000' + item.recordId, item])),
  };
  assert.equal(getReviewState(contract, labelTarget.targetId, contextEditInputs), 'stale');
  assert.equal(getReviewState(contract, termContextTarget.targetId, contextEditInputs), 'stale');

  const changedGameChange = structuredClone(inputs.sourceContract);
  changedGameChange.records.find(item => item.kind === 'game-change').payload.changedFields[0].after.decimal = '9';
  assert.equal(getReviewState(contract, gameChangeTarget.targetId, {
    ...inputs,
    sourceContract: changedGameChange,
    sourceRecordMap: new Map(changedGameChange.records.map(item => [item.gameReleaseId + '\u0000' + item.recordId, item])),
  }), 'stale');

  const commitOnly = structuredClone(inputs.sourceContract);
  for (const release of commitOnly.gameReleases) release.snapshot.commit = 'f'.repeat(40);
  assert.equal(getReviewState(contract, definitionTarget.targetId, withSourceContract(commitOnly)), 'approved');
  assert.equal(getReviewState(contract, officialChangeTarget.targetId, { ...inputs, sourceContract: commitOnly }), 'approved');
  assert.equal(getReviewState(contract, gameplayAnnouncementTarget.targetId, { ...inputs, sourceContract: commitOnly }), 'approved');
  const releaseEdit = structuredClone(inputs.sourceContract);
  releaseEdit.gameReleases.find(item => item.gameReleaseId === 'fixture-r2').snapshot.contentSha256 = 'e'.repeat(64);
  assert.equal(getReviewState(contract, officialChangeTarget.targetId, { ...inputs, sourceContract: releaseEdit }), 'stale');
  assert.equal(getReviewState(contract, gameplayAnnouncementTarget.targetId, { ...inputs, sourceContract: releaseEdit }), 'stale');

  const announcementAssetEdit = structuredClone(contract);
  announcementAssetEdit.announcements[0].assets[0].sha256 = 'c'.repeat(64);
  assert.equal(getReviewState(announcementAssetEdit, announcementTarget.targetId, inputs), 'stale');
});

// Scenario: announcement content uses ordered nested blocks and repeated image occurrences of one asset.
// Purpose: preserve stable occurrence IDs through list/table/spoiler nesting and reject duplicate IDs or missing assets.
test('UnitT64_announcement-block-occurrences-are-nested-ordered-and-asset-bound', async () => {
  const inputs = await loadInputs();
  const contract = structuredClone(inputs.authoring);
  const announcement = contract.announcements.find(item => item.announcementId === 'fixture:announcement:site');
  assert.equal(validate(contract, inputs).valid, true);
  const imageOrder = announcement.blocks.filter(item => item.kind === 'image').map(item => item.blockId);
  assert.deepEqual(imageOrder, ['fixture:block:image-one', 'fixture:block:image-two']);

  const duplicateNestedId = structuredClone(contract);
  duplicateNestedId.announcements[0].blocks.find(item => item.kind === 'image').blockId = 'fixture:block:list-item-one';
  assert.equal(validate(duplicateNestedId, inputs).valid, false);
  const danglingAsset = structuredClone(contract);
  danglingAsset.announcements[0].blocks.find(item => item.kind === 'image').assetRef.assetId = 'fixture:asset:missing';
  const danglingResult = validate(danglingAsset, inputs);
  assert.equal(danglingResult.valid, false);
  assert.ok(danglingResult.issues.some(item => item.code === 'dangling-asset'));
});

// Scenario: a pinned JSON file contains an invalid UTF-8 byte sequence.
// Purpose: fail closed before JSON parsing instead of replacing bytes with U+FFFD.
test('InterT65_authoring-loader-rejects-invalid-utf8-bytes', async t => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'web-authoring-invalid-utf8-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  await mkdir(path.join(tempRoot, 'content'), { recursive: true });
  await cp(path.join(repoRoot, 'content', 'contracts'), path.join(tempRoot, 'content', 'contracts'), { recursive: true });
  await cp(path.join(repoRoot, 'content', 'schema', 'v2'), path.join(tempRoot, 'content', 'schema', 'v2'), { recursive: true });
  await cp(path.join(repoRoot, 'content', 'fixtures', 'v2', 'web-authoring'), path.join(tempRoot, 'content', 'fixtures', 'v2', 'web-authoring'), { recursive: true });
  const officialPath = path.join(tempRoot, 'content', 'fixtures', 'v2', 'web-authoring', 'official-inputs.json');
  const bytes = await readFile(officialPath);
  await writeFile(officialPath, Buffer.concat([bytes, Buffer.from([0xff])]));
  await assert.rejects(
    loadWebAuthoringInputs({ repoRoot: tempRoot }),
    /official-inputs\.json contains invalid UTF-8 byte sequence/i,
  );
});
