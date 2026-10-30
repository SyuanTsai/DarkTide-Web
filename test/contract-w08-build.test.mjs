import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadWebAuthoringInputs, validateWebAuthoring } from '../scripts/content/contract-authoring.mjs';
import {
  collectRequiredContentFromWeb,
  compileW08Candidate,
  evaluateW08PublicationGate,
  validateW08Candidate,
  validateW08CandidateDirectory,
  writeW08Candidate,
} from '../scripts/content/contract-w08-build.mjs';
import { buildManifestPath, computeDataRevision } from '../scripts/content/contract-release.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_ID = 'darktide:1.13.2';
const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
const SOURCE_COMMIT = 'c'.repeat(40);
const SNAPSHOT = {
  snapshotId: 'source-snapshot-1', commit: SOURCE_COMMIT,
  manifestSha256: 'd'.repeat(64), contentSha256: 'e'.repeat(64),
};
const SUPPLEMENTAL_SNAPSHOT = {
  snapshotId: 'source-snapshot-supplemental', commit: SOURCE_COMMIT,
  manifestSha256: 'f'.repeat(64), contentSha256: '1'.repeat(64),
};
const COMPILER_FILES = [
  'content/schema/v2/shared-candidate.schema.json',
  'scripts/content/contract-authoring.mjs',
  'scripts/content/contract-release.mjs',
  'scripts/content/contract-w08-build.mjs',
].map((filePath, index) => ({ path: filePath, sizeBytes: index + 1, sha256: String(index + 2).repeat(64) }));

// Scenario: A W08 game change targets a Source rule with no existing Web presentation.
// Purpose: Require reviewed identity and complete zh-TW before/after rule wording before the publication content gate can pass.
test('UnitT76_required-content-gate-needs-reviewed-subject-and-both-rule-sides', () => {
  const changeId = 'fixture:game-change:rule-change';
  const ruleRef = { gameReleaseId: RELEASE_ID, recordId: 'fixture:rule:new', kind: 'modifier-rule' };
  const sourceContract = { records: [
    { recordId: changeId, gameReleaseId: RELEASE_ID, kind: 'game-change', payload: { entityRef: ruleRef } },
    { recordId: ruleRef.recordId, gameReleaseId: RELEASE_ID, kind: 'modifier-rule', payload: { triggerText: 'Synthetic rule.' } },
  ] };
  const local = text => ({ locale: 'zh-TW', text });
  const web = {
    presentations: [],
    termLocalizations: [],
    gameChanges: [{
      changeId,
      sourceRef: { gameReleaseId: RELEASE_ID, recordId: changeId, kind: 'game-change' },
      summary: local('更新規則。'),
      fieldSummaries: [{ field: 'modifier_rule_trigger', summary: '觸發條件更新。', beforeRule: local('舊條件。'), afterRule: local('新條件。') }],
    }],
  };

  const requiredChangeRow = () => collectRequiredContentFromWeb(web, sourceContract).find(row => row.id === changeId);
  assert.deepEqual(requiredChangeRow(), { id: changeId, present: false },
    'a non-presented Source subject must have a reviewed Web identity before it can count as present');
  web.gameChanges[0].entityName = local('新規則名稱');
  assert.deepEqual(requiredChangeRow(), { id: changeId, present: true });
  delete web.gameChanges[0].fieldSummaries[0].afterRule;
  assert.deepEqual(requiredChangeRow(), { id: changeId, present: false },
    'one missing rule side must block content readiness');

  const presented = structuredClone(web);
  delete presented.gameChanges[0].entityName;
  sourceContract.records[0].payload.entityRef = { gameReleaseId: RELEASE_ID, recordId: 'fixture:weapon:presented', kind: 'weapon' };
  sourceContract.records.push({ recordId: 'fixture:weapon:presented', gameReleaseId: RELEASE_ID, kind: 'weapon', payload: {} });
  presented.presentations.push({ authoringId: 'fixture:presentation:weapon', locale: 'zh-TW', name: '已呈現武器',
    entityRef: sourceContract.records.at(-1) });
  assert.deepEqual(collectRequiredContentFromWeb(presented, sourceContract).find(row => row.id === changeId), { id: changeId, present: false },
    'existing subject names do not waive missing before/after rule text');
  presented.gameChanges[0].fieldSummaries[0].afterRule = local('新條件。');
  assert.deepEqual(collectRequiredContentFromWeb(presented, sourceContract).find(row => row.id === changeId), { id: changeId, present: true },
    'an exact existing Web presentation can supply the subject name without a duplicate identity target');
  const ambiguousPresentation = structuredClone(presented);
  ambiguousPresentation.presentations.push({ ...structuredClone(ambiguousPresentation.presentations[0]), authoringId: 'fixture:presentation:weapon-duplicate' });
  assert.deepEqual(collectRequiredContentFromWeb(ambiguousPresentation, sourceContract).find(row => row.id === changeId), { id: changeId, present: false },
    'ambiguous subject presentations cannot satisfy the publication content gate');
});

function makeSourceRecord(recordId, kind, payload = {}, dimension = 'technical') {
  return {
    recordId,
    gameReleaseId: RELEASE_ID,
    kind,
    owner: 'source',
    reviewState: 'pending',
    reviewTargets: [{ fieldPath: '/payload', dimension }],
    sourceRefs: [],
    dataCoverage: { status: 'complete', missing: [] },
    payload,
  };
}

function makeSourceContract({ withEventSource = false } = {}) {
  const records = [
    makeSourceRecord('skill:one', 'skill', { evidenceRefs: [] }),
    makeSourceRecord('blessing:one', 'blessing', { evidenceRefs: [] }),
    makeSourceRecord('weapon:one', 'weapon', { claimRefs: [], attackProfileRefs: [], statDefinitionRefs: [], statCurveRefs: [] }),
    makeSourceRecord('term:one', 'term', { contextKey: 'combat' }, 'context'),
  ];
  if (withEventSource) records.push(makeSourceRecord('evidence:event', 'evidence', { evidenceType: 'code' }, 'evidence'));
  const sourceRefs = withEventSource ? [{
    sourceId: 'source:event',
    gameReleaseId: RELEASE_ID,
    repository: SOURCE_REPOSITORY,
    commit: SOURCE_COMMIT,
    path: 'scripts/settings/event.lua',
    line: 1,
    snapshot: SUPPLEMENTAL_SNAPSHOT,
    summary: 'synthetic event locator',
  }] : [];
  return {
    schemaVersion: '2.0.0',
    fixtureOnly: false,
    publicationEligible: false,
    gameReleases: [{
      gameReleaseId: RELEASE_ID,
      gameVersion: '1.13.2',
      gameBuild: 'UNVERIFIED',
      releaseOrder: 1,
      snapshot: SNAPSHOT,
    }],
    sourceSnapshots: withEventSource ? [{ gameReleaseId: RELEASE_ID, snapshot: SUPPLEMENTAL_SNAPSHOT }] : [],
    sourceRefs,
    tombstones: [],
    reviewReceipts: [],
    records,
  };
}

function makePresentation(recordId, kind, authoringId) {
  const officialSourceId = 'official:' + authoringId;
  return {
    authoringId,
    entityRef: { recordId, gameReleaseId: RELEASE_ID, kind },
    locale: 'zh-TW',
    name: authoringId,
    nameOfficialSourceId: officialSourceId,
    nameOfficialLocaleRefs: [],
    nameTermRuleRefs: [],
    official: [],
    officialLocaleRefs: [],
    errata: [],
    detailSections: [],
    tierApplicability: [],
  };
}

function makeMode(name, presentations, extra = {}) {
  const officialSources = presentations.map(item => ({
    officialSourceId: item.nameOfficialSourceId,
    locale: 'en',
    text: 'Immutable source text',
  }));
  const reviewTargets = presentations.map(item => ({
    targetId: 'target:' + item.authoringId + ':name',
    ownerId: item.authoringId,
    fieldPath: '/name',
    dimension: 'content',
  }));
  const authoring = {
    schemaVersion: '2.0.0',
    contractKind: 'web-authoring',
    fixtureOnly: false,
    publicationEligible: false,
    sourcePin: {},
    officialInputsSha256: 'a'.repeat(64),
    presentations,
    termLocalizations: [],
    announcements: [],
    gameChanges: [],
    officialTextChanges: [],
    reviewTargets,
    reviewReceipts: [],
  };
  return {
    mode: name,
    authoring,
    officialInputs: { sources: officialSources },
    termRules: { rules: [] },
    reviewStates: Object.fromEntries(reviewTargets.map(target => [target.targetId, 'pending'])),
    webLock: {},
    ...extra,
  };
}

function makeInput() {
  const sourceContract = makeSourceContract();
  const skill = makePresentation('skill:one', 'skill', 'presentation:skill');
  const blessing = makePresentation('blessing:one', 'blessing', 'presentation:blessing');
  const weapon = makePresentation('weapon:one', 'weapon', 'presentation:weapon');
  const w06 = makeMode('w06', [skill, blessing], { sourceContract: structuredClone(sourceContract) });
  const w07 = makeMode('w07', [weapon], { sourceContract: structuredClone(sourceContract) });
  return {
    sourceContract,
    sourceBuild: {
      repository: SOURCE_REPOSITORY,
      commit: 'b'.repeat(40),
      sourceRevision: '1'.repeat(64),
      manifestSha256: '2'.repeat(64),
      mode: 'candidate',
      buildIdentityVerified: false,
      publicationEligible: false,
      receiptSha256: null,
    },
    compilerIdentity: {
      commit: 'a'.repeat(40),
      inputLockSha256: '9'.repeat(64),
      files: COMPILER_FILES.map(row => ({ ...row })),
      gitHistoryAvailable: true,
    },
    webIdentity: { authoringCommit: '8'.repeat(40), compilerCommit: 'a'.repeat(40) },
    w06,
    w07,
    proposedContentVersion: '1.13.2.1',
    gameReleaseId: RELEASE_ID,
  };
}

function makeSyntheticAnnouncementInput(donor) {
  const input = makeInput();
  const announcement = structuredClone(donor.authoring.announcements.find(item => item.scope === 'site'));
  const targets = structuredClone(donor.authoring.reviewTargets.filter(target => target.ownerId === announcement.announcementId));
  input.w07.authoring.announcements = [announcement];
  input.w07.authoring.reviewTargets.push(...targets);
  input.w07.reviewStates = Object.fromEntries(input.w07.authoring.reviewTargets.map(target => [target.targetId, 'pending']));
  return input;
}

async function loadValidatedFormalDonor() {
  const loaded = await loadWebAuthoringInputs({ repoRoot: REPO_ROOT });
  const authoring = structuredClone(loaded.authoring);
  const announcement = authoring.announcements.find(item => item.scope === 'site');
  const spoiler = announcement.blocks.find(block => block.kind === 'spoiler');
  const assetId = announcement.assets[0].assetId;
  const url = 'https://example.invalid/synthetic-patch-notes';
  spoiler.blocks.push(
    { blockId: 'fixture:block:nested-heading', kind: 'heading', text: 'Power Sword patch notes' },
    { blockId: 'fixture:block:nested-link', kind: 'link', text: url, href: url },
    { blockId: 'fixture:block:nested-list', kind: 'list', ordered: true, items: [
      { blockId: 'fixture:block:nested-list-item', text: 'Power Sword' },
    ] },
    { blockId: 'fixture:block:nested-table', kind: 'table', rows: [
      { cells: [
        { blockId: 'fixture:block:nested-table-cell-name', text: 'Damage' },
        { blockId: 'fixture:block:nested-table-cell-value', text: '40' },
      ] },
    ] },
    { blockId: 'fixture:block:nested-image', kind: 'image', assetRef: { assetId }, alt: 'Weapon preview' },
    { blockId: 'fixture:block:nested-spoiler', kind: 'spoiler', label: 'More details', blocks: [
      { blockId: 'fixture:block:nested-spoiler-paragraph', kind: 'paragraph', text: 'Patch 1.13.2 details' },
    ] },
  );
  const validationInputs = { ...loaded, authoring };
  const validation = validateWebAuthoring(authoring, validationInputs);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  return { authoring, inputs: validationInputs };
}

async function makeFormalCompilerInput(donor, {
  announcements = true,
  gameChanges = true,
  officialTextChanges = true,
} = {}) {
  const releaseId = 'fixture-r1';
  const sourceContract = structuredClone(donor.inputs.sourceContract);
  // This adapter is local to the W08 unit test: candidate identities stay synthetic and no fixture is written as a real pin.
  sourceContract.fixtureOnly = false;
  sourceContract.publicationEligible = false;
  // Exclude donor Source rows outside the selected presentation/event closure so the candidate does not require their review targets.
  sourceContract.records = sourceContract.records.filter(record => !(
    (record.gameReleaseId === 'fixture-r1' && ['fixture:catalog:alpha', 'fixture:curio:alpha'].includes(record.recordId))
    || (record.gameReleaseId === 'fixture-r2'
      && ['fixture:blessing:alpha', 'fixture:compat:r2', 'fixture:variant:r2'].includes(record.recordId))
  ));
  const release = sourceContract.gameReleases.find(item => item.gameReleaseId === releaseId);
  assert.ok(release, 'the validated donor must contain its selected release');

  const authoring = structuredClone(donor.authoring);
  authoring.presentations = authoring.presentations.filter(item => item.entityRef.gameReleaseId === releaseId
    && ['skill', 'blessing', 'weapon'].includes(item.entityRef.kind));
  authoring.termLocalizations = authoring.termLocalizations.filter(item => item.termRef.gameReleaseId === releaseId);
  for (const change of authoring.gameChanges) {
    const sourceChange = sourceContract.records.find(record => record.kind === 'game-change'
      && record.recordId === change.sourceRef?.recordId && record.gameReleaseId === change.sourceRef?.gameReleaseId);
    const subjectRef = sourceChange?.payload?.entityRef;
    const hasCandidatePresentation = authoring.presentations.some(item => item.entityRef?.recordId === subjectRef?.recordId
      && item.entityRef?.gameReleaseId === subjectRef?.gameReleaseId);
    if (!hasCandidatePresentation) {
      const sourcePresentation = donor.authoring.presentations.find(item => item.entityRef?.recordId === subjectRef?.recordId
        && item.entityRef?.gameReleaseId === subjectRef?.gameReleaseId);
      if (sourcePresentation) {
        change.entityName = { locale: 'zh-TW', text: sourcePresentation.name };
        authoring.reviewTargets.push({
          targetId: 'target:' + change.changeId + ':entity-name', ownerKind: 'game-change', ownerId: change.changeId,
          fieldPath: '/entityName', dimension: 'identity',
        });
      }
    }
  }
  if (!announcements) authoring.announcements = [];
  if (!gameChanges) authoring.gameChanges = [];
  if (!officialTextChanges) authoring.officialTextChanges = [];
  const ownerIds = new Set([
    ...authoring.presentations.map(item => item.authoringId),
    ...authoring.termLocalizations.map(item => item.authoringId),
    ...authoring.announcements.map(item => item.announcementId),
    ...authoring.gameChanges.map(item => item.changeId),
    ...authoring.officialTextChanges.map(item => item.changeId),
  ]);
  authoring.reviewTargets = authoring.reviewTargets.filter(target => ownerIds.has(target.ownerId));
  const targetIds = new Set(authoring.reviewTargets.map(target => target.targetId));
  authoring.reviewReceipts = authoring.reviewReceipts.filter(receipt => targetIds.has(receipt.targetId));

  const w06 = makeMode('w06', []);
  w06.sourceContract = structuredClone(sourceContract);
  w06.officialInputs = { sources: [] };
  w06.termRules = structuredClone(donor.inputs.termRules);
  const w07 = makeMode('w07', []);
  w07.authoring = authoring;
  w07.sourceContract = structuredClone(sourceContract);
  w07.officialInputs = structuredClone(donor.inputs.officialInputs);
  w07.termRules = structuredClone(donor.inputs.termRules);
  w07.reviewStates = Object.fromEntries(authoring.reviewTargets.map(target => [target.targetId, 'pending']));

  const input = makeInput();
  input.sourceContract = sourceContract;
  input.gameReleaseId = releaseId;
  input.proposedContentVersion = release.gameVersion + '.1';
  input.w06 = w06;
  input.w07 = w07;
  return input;
}

function collectAnnouncementTextPaths(announcement) {
  const paths = [];
  const visit = (blocks, prefix) => {
    blocks.forEach((block, index) => {
      const blockPath = [...prefix, index];
      if (['heading', 'paragraph', 'link'].includes(block.kind)) paths.push({ path: [...blockPath, 'text'], label: block.kind + '.text' });
      else if (block.kind === 'list') block.items.forEach((item, itemIndex) => {
        paths.push({ path: [...blockPath, 'items', itemIndex, 'text'], label: 'list.items[].text' });
      });
      else if (block.kind === 'table') block.rows.forEach((row, rowIndex) => row.cells.forEach((cell, cellIndex) => {
        paths.push({ path: [...blockPath, 'rows', rowIndex, 'cells', cellIndex, 'text'], label: 'table.rows[].cells[].text' });
      }));
      else if (block.kind === 'image') paths.push({ path: [...blockPath, 'alt'], label: 'image.alt' });
      else if (block.kind === 'spoiler') {
        paths.push({ path: [...blockPath, 'label'], label: 'spoiler.label' });
        visit(block.blocks, [...blockPath, 'blocks']);
      }
    });
  };
  visit(announcement.blocks, ['blocks']);
  announcement.assets.forEach((asset, index) => paths.push({ path: ['assets', index, 'alt'], label: 'assets[].alt' }));
  return paths;
}

function collectAnnouncementBlockKinds(announcement) {
  const kinds = new Set();
  const visit = blocks => blocks.forEach(block => {
    kinds.add(block.kind);
    if (block.kind === 'spoiler') visit(block.blocks);
  });
  visit(announcement.blocks);
  return [...kinds].sort();
}

function findAnnouncementBlock(announcement, blockId) {
  const visit = blocks => {
    for (const block of blocks) {
      if (block.blockId === blockId) return block;
      if (block.kind === 'spoiler') {
        const found = visit(block.blocks);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(announcement.blocks);
}

function deleteAtPath(value, pathParts) {
  let parent = value;
  for (const key of pathParts.slice(0, -1)) parent = parent[key];
  delete parent[pathParts.at(-1)];
}

function setAtPath(value, pathParts, next) {
  let parent = value;
  for (const key of pathParts.slice(0, -1)) parent = parent[key];
  parent[pathParts.at(-1)] = next;
}

function requiredContentBlockers(candidate) {
  return candidate.envelope.publicationGate.blockers.filter(item => item.startsWith('required-zh-tw-content-missing:'));
}

function serializedOutput(candidate) {
  return JSON.stringify(candidate.envelope) + '\n' + candidate.manifestBytes.toString('utf8') + '\n'
    + candidate.manifest.files.map(row => candidate.files.get(row.path).toString('utf8')).join('\n');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function jsonBytes(value) {
  return Buffer.from(JSON.stringify(canonicalize(value), null, 2) + '\n', 'utf8');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('UnitT01_W08CompilesFourCoreDomainsFromOneSourceOwner', () => {
  // Scenario: W06/W07 inputs and one real, non-publishable Source registry provide all four core record kinds.
  // Purpose: the shared compiler must emit all domains under one immutable manifest without claiming publication.
  const result = compileW08Candidate(makeInput());

  assert.deepEqual(result.manifest.files.map(file => file.kind), ['blessings', 'skills', 'terms', 'weapons']);
  assert.equal(result.envelope.candidateOnly, true);
  assert.equal(result.envelope.fixtureOnly, false);
  assert.equal(result.envelope.publicationEligible, false);
  assert.equal(result.envelope.publicationGate.status, 'blocked');
});

test('UnitT02_W08OutputDoesNotDependOnGitHistoryAvailability', () => {
  // Scenario: identical pinned bytes are compiled once with a shallow-clone history miss and once with history present.
  // Purpose: optional local Git object availability must not change candidate bytes or its immutable revision.
  const historyMissing = makeInput();
  historyMissing.compilerIdentity.gitHistoryAvailable = false;
  const historyPresent = makeInput();

  const left = compileW08Candidate(historyMissing);
  const right = compileW08Candidate(historyPresent);
  assert.equal(serializedOutput(left), serializedOutput(right));
  assert.equal(Object.hasOwn(left.envelope.compiler, 'inputHistoryAvailable'), false);
});

test('UnitT03_W08CountsEverySourceReviewTupleExactlyOnce', () => {
  // Scenario: four Source records and three Web targets are compiled with Source targets identified by release/record/path/dimension.
  // Purpose: Source coverage must not be omitted or counted once in reviewCoverage and again in the compiler.
  const input = makeInput();
  const result = compileW08Candidate(input);
  const expectedSourceCount = input.sourceContract.records.reduce((count, record) => count + record.reviewTargets.length, 0);

  assert.equal(result.envelope.review.webTargetCount, 3);
  assert.equal(result.envelope.review.sourceTargetCount, expectedSourceCount);
  assert.equal(result.envelope.review.targetCount, 3 + expectedSourceCount);
  assert.equal(result.envelope.review.sourceTargets.length, expectedSourceCount);
  assert.ok(result.envelope.review.sourceTargets.every(row => row.gameReleaseId && row.recordId && row.fieldPath && row.dimension));
  assert.ok(result.envelope.review.sourceTargets.every(row => !Object.hasOwn(row, 'targetId')));
});

test('UnitT78_W08ReviewCoverageMatchesEmittedReleaseDomains', () => {
  // Scenario: one W06/W07 authoring input retains 1.13.2 and 1.13.3 rows while W08 emits only the selected 1.13.3 domains.
  // Purpose: review targets/receipts follow emitted owners, while approved Source digests still use the complete cross-release contract.
  const input = makeInput();
  const previousReleaseId = RELEASE_ID;
  const selectedReleaseId = 'darktide:1.13.3';
  const selectedSnapshot = {
    snapshotId: 'source-snapshot-1-13-3', commit: SOURCE_COMMIT,
    manifestSha256: '2'.repeat(64), contentSha256: '3'.repeat(64),
  };
  input.sourceContract.gameReleases.push({
    gameReleaseId: selectedReleaseId,
    gameVersion: '1.13.3',
    gameBuild: 'UNVERIFIED',
    releaseOrder: 2,
    snapshot: selectedSnapshot,
  });
  const selectedRecords = input.sourceContract.records.map(record => ({
    ...structuredClone(record),
    gameReleaseId: selectedReleaseId,
  }));
  input.sourceContract.records.push(...selectedRecords);
  const previousSkill = input.sourceContract.records.find(record => record.gameReleaseId === previousReleaseId && record.recordId === 'skill:one');
  const selectedSkill = input.sourceContract.records.find(record => record.gameReleaseId === selectedReleaseId && record.recordId === 'skill:one');
  previousSkill.reviewState = 'approved';
  selectedSkill.reviewState = 'approved';
  const digestPair = { targetDigest: 'a'.repeat(64), dependenciesDigest: 'b'.repeat(64) };
  const sourceReceipt = gameReleaseId => ({
    target: { gameReleaseId, recordId: 'skill:one', fieldPath: '/payload', dimension: 'technical' },
    ...digestPair,
    decision: 'approved',
    reviewer: { kind: 'human', id: 'synthetic-w08-fixture' },
    reviewedAt: '2026-10-30T12:00:00Z',
  });
  input.sourceContract.reviewReceipts = [sourceReceipt(previousReleaseId), sourceReceipt(selectedReleaseId)];
  input.w06.sourceContract = structuredClone(input.sourceContract);
  input.w07.sourceContract = structuredClone(input.sourceContract);

  const versionedPresentation = (kind, releaseId) => {
    const suffix = releaseId === selectedReleaseId ? 'r3' : 'r2';
    const item = makePresentation(kind + ':one', kind, 'presentation:' + kind + ':' + suffix);
    item.entityRef.gameReleaseId = releaseId;
    return item;
  };
  const presentationTarget = item => ({
    targetId: 'target:' + item.authoringId + ':name', ownerId: item.authoringId,
    fieldPath: '/name', dimension: 'content',
  });
  const versionedTerm = releaseId => {
    const suffix = releaseId === selectedReleaseId ? 'r3' : 'r2';
    return {
      authoringId: 'term:combat:' + suffix,
      termRef: { gameReleaseId: releaseId, recordId: 'term:one', kind: 'term' },
      locale: 'zh-TW', label: '戰鬥', definition: '戰鬥用語。',
    };
  };
  const termTargets = item => ['label', 'definition'].map(fieldPath => ({
    targetId: 'target:' + item.authoringId + ':' + fieldPath,
    ownerId: item.authoringId,
    fieldPath: '/' + fieldPath,
    dimension: 'content',
  }));
  const previousSkillPresentation = versionedPresentation('skill', previousReleaseId);
  const previousBlessingPresentation = versionedPresentation('blessing', previousReleaseId);
  const selectedSkillPresentation = versionedPresentation('skill', selectedReleaseId);
  const selectedBlessingPresentation = versionedPresentation('blessing', selectedReleaseId);
  const previousWeaponPresentation = versionedPresentation('weapon', previousReleaseId);
  const selectedWeaponPresentation = versionedPresentation('weapon', selectedReleaseId);
  const previousTerm = versionedTerm(previousReleaseId);
  const selectedTerm = versionedTerm(selectedReleaseId);
  input.w06.authoring.presentations = [previousSkillPresentation, previousBlessingPresentation, selectedSkillPresentation, selectedBlessingPresentation];
  input.w06.authoring.termLocalizations = [previousTerm, selectedTerm];
  input.w06.authoring.reviewTargets = [
    ...input.w06.authoring.presentations.map(presentationTarget),
    ...input.w06.authoring.termLocalizations.flatMap(termTargets),
  ];
  input.w06.reviewStates = Object.fromEntries(input.w06.authoring.reviewTargets.map(target => [target.targetId, 'pending']));
  input.w06.officialInputs.sources = input.w06.authoring.presentations.map(item => ({
    officialSourceId: item.nameOfficialSourceId, locale: 'en', text: 'Immutable source text',
  }));
  input.w07.authoring.presentations = [previousWeaponPresentation, selectedWeaponPresentation];
  input.w07.authoring.reviewTargets = input.w07.authoring.presentations.map(presentationTarget);
  input.w07.reviewStates = Object.fromEntries(input.w07.authoring.reviewTargets.map(target => [target.targetId, 'pending']));
  input.w07.officialInputs.sources = input.w07.authoring.presentations.map(item => ({
    officialSourceId: item.nameOfficialSourceId, locale: 'en', text: 'Immutable source text',
  }));
  const digestInputs = [];
  input.w07.sourceValidator = {
    computeReviewDigests(contract, target) {
      assert.equal(contract.records.length, 8, 'Source digest calculation must retain both releases');
      assert.equal(contract.gameReleases.length, 2, 'Source digest calculation must retain both release identities');
      digestInputs.push({ gameReleaseId: target.gameReleaseId, recordId: target.recordId });
      assert.equal(target.gameReleaseId, selectedReleaseId, 'only emitted Source targets need a candidate digest');
      assert.equal(target.fieldPath, '/payload');
      return digestPair;
    },
  };
  input.gameReleaseId = selectedReleaseId;
  input.proposedContentVersion = '1.13.3.1';

  const result = compileW08Candidate(input);
  assert.equal(input.w06.authoring.presentations.length, 4, 'compilation must not delete previous-release authoring');
  assert.equal(input.w07.authoring.presentations.length, 2, 'compilation must not delete previous-release authoring');
  assert.equal(result.envelope.review.webTargetCount, 5);
  assert.equal(result.envelope.review.sourceTargetCount, 4);
  assert.equal(result.envelope.review.targetCount, 9);
  assert.deepEqual(digestInputs, [{ gameReleaseId: selectedReleaseId, recordId: 'skill:one' }],
    'approved selected-release digests must use the full multi-release Source contract');
  assert.deepEqual([...new Set(result.envelope.review.sourceTargets.map(row => row.gameReleaseId))], [selectedReleaseId]);
  assert.deepEqual(result.envelope.review.targets.map(row => row.target.targetId).sort(), [
    ...[selectedSkillPresentation, selectedBlessingPresentation].map(presentationTarget).map(target => target.targetId),
    ...termTargets(selectedTerm).map(target => target.targetId),
    ...[selectedWeaponPresentation].map(presentationTarget).map(target => target.targetId),
  ].sort());
  const sourceReceipts = result.envelope.review.receipts.filter(row => row.mode === 'source');
  assert.equal(sourceReceipts.length, 1, 'only the selected release receipt should be retained');
  assert.equal(sourceReceipts[0].receipt.target.gameReleaseId, selectedReleaseId);
  assert.deepEqual(requiredContentBlockers(result), []);
  assert.doesNotThrow(() => validateW08Candidate(result));

  input.sourceContract.reviewReceipts = [sourceReceipt(previousReleaseId)];
  input.w06.sourceContract = structuredClone(input.sourceContract);
  input.w07.sourceContract = structuredClone(input.sourceContract);
  const missingSelectedReceipt = compileW08Candidate(input);
  assert.ok(missingSelectedReceipt.envelope.publicationGate.blockers.includes('approved-review-target-lacks-matching-receipt'),
    'filtering must not let a prior-release receipt approve the selected release');

  input.sourceContract.reviewReceipts.push({
    ...sourceReceipt(selectedReleaseId),
    target: { gameReleaseId: selectedReleaseId, recordId: 'skill:missing', fieldPath: '/payload', dimension: 'technical' },
  });
  input.w06.sourceContract = structuredClone(input.sourceContract);
  input.w07.sourceContract = structuredClone(input.sourceContract);
  assert.throws(() => compileW08Candidate(input), /points to a missing review target/,
    'valid but non-emitted receipts are filtered, while undeclared Source targets remain rejected');
});

test('UnitT04_W08GateDerivesStateFromReviewTargetsInsteadOfClaimedCounts', () => {
  // Scenario: a pending target is paired with forged state counts claiming it is approved.
  // Purpose: publication readiness must derive and cross-check actual target states rather than trust caller summaries.
  const gate = evaluateW08PublicationGate({
    sourceBuild: { buildIdentityVerified: true, publicationEligible: true },
    review: {
      targets: [{ state: 'pending' }],
      sourceTargets: [],
      states: { approved: 1, pending: 0, stale: 0, rejected: 0 },
      targetCount: 1,
      webTargetCount: 1,
      sourceTargetCount: 0,
      receiptCount: 0,
      receipts: [],
    },
    requiredContent: [{ id: 'presentation:required', present: true }],
  });

  assert.equal(gate.status, 'blocked');
  assert.ok(gate.blockers.includes('review-target-pending'));
  assert.ok(gate.blockers.includes('review-state-counts-mismatch'));
});

test('UnitT05_W08EventDomainClosesWebSourceRefsAndTypedEvidence', async () => {
  // Scenario: schema- and semantic-validated event rows are compiled with the game change's typed evidence closure.
  // Purpose: event projections must retain exact Source records and provenance while rejecting dangling typed references.
  const donor = await loadValidatedFormalDonor();
  const input = await makeFormalCompilerInput(donor);
  const result = compileW08Candidate(input);
  const changePath = result.manifest.files.find(file => file.kind === 'game-changes').path;
  const change = JSON.parse(result.files.get(changePath).toString('utf8'));

  assert.ok(change.source.records.some(record => record.recordId === 'fixture:evidence:r2'));
  assert.ok(change.source.sourceRefs.some(ref => ref.sourceId === 'fixture-public-code-r2'));
  assert.equal(change.web.gameChanges.length, 1);
  assert.ok(result.manifest.compatibility.gameSnapshotRefs.includes('fixture-snapshot-r2'));
  assert.deepEqual(requiredContentBlockers(result), []);

  const invalid = structuredClone(input);
  invalid.w07.authoring.gameChanges[0].sourceRef.recordId = 'fixture:game-change:missing';
  assert.throws(() => compileW08Candidate(invalid), /unresolved/i);
});

test('UnitT06_W08SiteAnnouncementDoesNotCreateAGameChangeDomain', async () => {
  // Scenario: the validated authoring fixture contains a site announcement but no projected change rows.
  // Purpose: preserve announcement content without fabricating a game-change file or a missing-content blocker.
  const donor = await loadValidatedFormalDonor();
  const input = makeSyntheticAnnouncementInput(donor);
  const result = compileW08Candidate(input);
  const announcementPath = result.manifest.files.find(file => file.kind === 'announcements').path;
  const announcementDocument = JSON.parse(result.files.get(announcementPath).toString('utf8'));

  assert.deepEqual(announcementDocument.web.announcements, input.w07.authoring.announcements);
  assert.ok(result.manifest.files.some(file => file.kind === 'announcements'));
  assert.equal(result.manifest.files.some(file => file.kind === 'game-changes'), false);
  assert.deepEqual(requiredContentBlockers(result), []);
});

test('UnitT15_W08ValidatedRepresentativeContentPassesPublicCompileGate', async () => {
  // Scenario: full fixture authoring passes the schema and semantic validator before its formal event rows reach W08 compile.
  // Purpose: required-content collection must follow authoring shapes while preserving all seven announcement block kinds.
  const donor = await loadValidatedFormalDonor();
  const input = await makeFormalCompilerInput(donor);
  const result = compileW08Candidate(input);
  const announcementsPath = result.manifest.files.find(file => file.kind === 'announcements').path;
  const gameChangesPath = result.manifest.files.find(file => file.kind === 'game-changes').path;
  const announcements = JSON.parse(result.files.get(announcementsPath).toString('utf8')).web.announcements;
  const changes = JSON.parse(result.files.get(gameChangesPath).toString('utf8')).web;

  assert.deepEqual(collectAnnouncementBlockKinds(announcements[0]), ['heading', 'image', 'link', 'list', 'paragraph', 'spoiler', 'table']);
  assert.deepEqual(announcements, input.w07.authoring.announcements);
  assert.deepEqual(changes.gameChanges, input.w07.authoring.gameChanges);
  assert.deepEqual(changes.officialTextChanges, input.w07.authoring.officialTextChanges);
  assert.deepEqual(requiredContentBlockers(result), []);
  assert.doesNotThrow(() => validateW08Candidate(result));
});

test('UnitT16_W08MissingNestedAnnouncementTextAndUnsupportedShapesBlock', async () => {
  // Scenario: one required announcement text leaf is absent, a required nested collection is empty, or a block kind is unknown.
  // Purpose: all schema text leaves must fail closed at arbitrary spoiler depth, including English links and asset alternatives.
  const donor = await loadValidatedFormalDonor();
  const baseline = makeSyntheticAnnouncementInput(donor);
  const announcementId = baseline.w07.authoring.announcements[0].announcementId;
  assert.deepEqual(requiredContentBlockers(compileW08Candidate(baseline)), []);
  const textPaths = collectAnnouncementTextPaths(baseline.w07.authoring.announcements[0]);
  assert.ok(textPaths.some(item => item.label === 'link.text'));
  assert.ok(textPaths.some(item => item.label === 'list.items[].text'));
  assert.ok(textPaths.some(item => item.label === 'table.rows[].cells[].text'));
  assert.ok(textPaths.some(item => item.label === 'image.alt'));
  assert.ok(textPaths.some(item => item.label === 'spoiler.label'));
  assert.ok(textPaths.some(item => item.label === 'assets[].alt'));

  for (const textPath of textPaths) {
    const input = structuredClone(baseline);
    deleteAtPath(input.w07.authoring.announcements[0], textPath.path);
    const candidate = compileW08Candidate(input);
    assert.ok(requiredContentBlockers(candidate).includes('required-zh-tw-content-missing:' + announcementId), textPath.label);
  }
  for (const textPath of textPaths) {
    const input = structuredClone(baseline);
    setAtPath(input.w07.authoring.announcements[0], textPath.path, ' \t\n');
    const candidate = compileW08Candidate(input);
    assert.ok(requiredContentBlockers(candidate).includes('required-zh-tw-content-missing:' + announcementId), textPath.label + ' whitespace');
  }

  const emptyCollectionCases = [
    ['blocks', announcement => { announcement.blocks = []; }],
    ['nested list items', announcement => { findAnnouncementBlock(announcement, 'fixture:block:nested-list').items = []; }],
    ['nested table rows', announcement => { findAnnouncementBlock(announcement, 'fixture:block:nested-table').rows = []; }],
    ['nested table cells', announcement => { findAnnouncementBlock(announcement, 'fixture:block:nested-table').rows[0].cells = []; }],
    ['nested spoiler children', announcement => { findAnnouncementBlock(announcement, 'fixture:block:nested-spoiler').blocks = []; }],
  ];
  for (const [label, mutate] of emptyCollectionCases) {
    const input = structuredClone(baseline);
    mutate(input.w07.authoring.announcements[0]);
    const candidate = compileW08Candidate(input);
    assert.ok(requiredContentBlockers(candidate).includes('required-zh-tw-content-missing:' + announcementId), label);
  }

  const unknownKind = structuredClone(baseline);
  unknownKind.w07.authoring.announcements[0].blocks.push({
    blockId: 'fixture:block:unknown-kind', kind: 'unknown-extension', text: 'Unrecognized content',
  });
  const candidate = compileW08Candidate(unknownKind);
  assert.ok(requiredContentBlockers(candidate).includes('required-zh-tw-content-missing:' + announcementId));
});

test('UnitT17_W08LocalizedChangeSummariesAndFieldSummariesMustBeComplete', async () => {
  // Scenario: required change summary locale/text or a Source field summary is absent or empty.
  // Purpose: compile must recognize localizedSummary objects and all required per-field Web wording.
  const donor = await loadValidatedFormalDonor();
  const baseline = await makeFormalCompilerInput(donor, { announcements: false });
  const gameChangeId = baseline.w07.authoring.gameChanges[0].changeId;
  const officialChangeId = baseline.w07.authoring.officialTextChanges[0].changeId;
  assert.deepEqual(requiredContentBlockers(compileW08Candidate(baseline)), []);
  const mutationCases = [
    ['game summary text', input => { delete input.w07.authoring.gameChanges[0].summary.text; }, gameChangeId],
    ['game summary locale', input => { input.w07.authoring.gameChanges[0].summary.locale = 'en'; }, gameChangeId],
    ['game field summary missing', input => { delete input.w07.authoring.gameChanges[0].fieldSummaries[0].summary; }, gameChangeId],
    ['game field summary whitespace', input => { input.w07.authoring.gameChanges[0].fieldSummaries[0].summary = ' \t\n'; }, gameChangeId],
    ['empty game field summaries', input => { input.w07.authoring.gameChanges[0].fieldSummaries = []; }, gameChangeId],
    ['official summary text', input => { input.w07.authoring.officialTextChanges[0].summary.text = '  '; }, officialChangeId],
    ['official summary locale', input => { delete input.w07.authoring.officialTextChanges[0].summary.locale; }, officialChangeId],
  ];
  for (const [label, mutate, ownerId] of mutationCases) {
    const input = structuredClone(baseline);
    mutate(input);
    const candidate = compileW08Candidate(input);
    assert.ok(requiredContentBlockers(candidate).includes('required-zh-tw-content-missing:' + ownerId), label);
  }
});

test('UnitT07_W08WriterPlacesManifestAtItsDeclaredImmutablePath', async () => {
  // Scenario: a valid in-memory candidate is written to a new, empty directory.
  // Purpose: the shared manifest must exist at the exact immutable URL declared by the candidate envelope.
  const candidate = compileW08Candidate(makeInput());
  const parent = await mkdtemp(path.join(os.tmpdir(), 'w08-candidate-'));
  const output = path.join(parent, 'candidate');
  try {
    await writeW08Candidate(candidate, output);
    const declared = path.join(output, ...candidate.envelope.manifest.path.split('/'));
    assert.ok((await stat(declared)).isFile());
    const checked = await validateW08CandidateDirectory(output, { expectedCandidate: candidate });
    assert.equal(checked.candidate.envelope.manifest.path, candidate.envelope.manifest.path);
    assert.ok(checked.files.includes(candidate.envelope.manifest.path.slice(1)));
    await assert.rejects(writeW08Candidate(candidate, output), /already exists/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('UnitT08_W08SchemaPinsCandidateOnlyNonPublishableEnvelope', async () => {
  // Scenario: the public candidate schema is read from its checked-in contract path.
  // Purpose: W08 must use an additive strict envelope and leave the W02 published manifest schema untouched.
  const schema = JSON.parse(await readFile(new URL('../content/schema/v2/shared-candidate.schema.json', import.meta.url), 'utf8'));

  assert.equal(schema.$id, 'w08-shared-candidate/1.0.0');
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.candidateOnly.const, true);
  assert.equal(schema.properties.fixtureOnly.const, false);
  assert.equal(schema.properties.publicationEligible.const, false);
});

test('UnitT09_W08CandidateValidationRejectsRehashedUnpinnedSourceMutation', () => {
  // Scenario: an output record changes while the candidate's local file hashes and manifest revision are recomputed.
  // Purpose: validation against expected pinned inputs must detect semantic tampering, not accept self-consistent hashes alone.
  const input = makeInput();
  const candidate = compileW08Candidate(input);
  const tampered = {
    envelope: structuredClone(candidate.envelope),
    manifest: structuredClone(candidate.manifest),
    files: new Map([...candidate.files].map(([filePath, bytes]) => [filePath, Buffer.from(bytes)])),
    manifestBytes: Buffer.from(candidate.manifestBytes),
  };
  const row = tampered.manifest.files.find(file => file.kind === 'skills');
  const document = JSON.parse(tampered.files.get(row.path).toString('utf8'));
  document.source.records.find(record => record.recordId === 'skill:one').payload.w08Probe = 'tampered but structurally valid';
  const bytes = jsonBytes(document);
  tampered.files.set(row.path, bytes);
  row.sizeBytes = bytes.byteLength;
  row.sha256 = sha256(bytes);
  tampered.manifest.dataRevision = computeDataRevision(tampered.manifest);
  tampered.envelope.manifest.path = buildManifestPath(tampered.manifest.dataRevision);
  tampered.envelope.manifest.dataRevision = tampered.manifest.dataRevision;
  tampered.manifestBytes = jsonBytes(tampered.manifest);
  tampered.envelope.manifest.sha256 = sha256(tampered.manifestBytes);

  assert.doesNotThrow(() => validateW08Candidate(tampered));
  assert.throws(() => validateW08Candidate(tampered, { expectedInputs: input }), /expected pinned inputs|domains\/skills/i);
});

test('UnitT10_W08SourceReceiptsStayWithinTheirRecordDomain', () => {
  // Scenario: a skill and a term have Source receipts, while the skill domain contains only the skill record.
  // Purpose: missing Source targetId fields must not cause every receipt to match every record's undefined targetId.
  const input = makeInput();
  const skillReceipt = { receiptId: 'receipt:skill', target: { gameReleaseId: RELEASE_ID, recordId: 'skill:one', fieldPath: '/payload', dimension: 'technical' } };
  const termReceipt = { receiptId: 'receipt:term', target: { gameReleaseId: RELEASE_ID, recordId: 'term:one', fieldPath: '/payload', dimension: 'context' } };
  input.sourceContract.reviewReceipts = [skillReceipt, termReceipt];
  input.w06.sourceContract.reviewReceipts = structuredClone(input.sourceContract.reviewReceipts);
  input.w07.sourceContract.reviewReceipts = structuredClone(input.sourceContract.reviewReceipts);
  const candidate = compileW08Candidate(input);
  const skillPath = candidate.manifest.files.find(file => file.kind === 'skills').path;
  const skillDocument = JSON.parse(candidate.files.get(skillPath).toString('utf8'));

  assert.deepEqual(skillDocument.source.reviewReceipts, [skillReceipt]);
  assert.ok(candidate.envelope.review.receipts.some(row => row.mode === 'source' && row.receipt.receiptId === 'receipt:term'));
});

test('UnitT11_W08DomainClosureIncludesPresentationSpecificSourceClaimsOnlyInTheirDomain', () => {
  // Scenario: a skill presentation points to an additional Source claim outside the skill record's own typed closure.
  // Purpose: each domain must close all Source refs from its own Web items without importing another domain's Web refs.
  const input = makeInput();
  const claim = makeSourceRecord('claim:skill-display', 'claim', { evidenceRefs: [] }, 'content');
  input.sourceContract.records.push(claim);
  input.w06.sourceContract.records.push(structuredClone(claim));
  input.w07.sourceContract.records.push(structuredClone(claim));
  input.w06.authoring.presentations[0].detailSections.push({
    claimRefs: [{ recordId: claim.recordId, gameReleaseId: RELEASE_ID, kind: 'claim' }],
  });

  const candidate = compileW08Candidate(input);
  const skillPath = candidate.manifest.files.find(file => file.kind === 'skills').path;
  const blessingPath = candidate.manifest.files.find(file => file.kind === 'blessings').path;
  const skill = JSON.parse(candidate.files.get(skillPath).toString('utf8'));
  const blessing = JSON.parse(candidate.files.get(blessingPath).toString('utf8'));

  assert.ok(skill.source.records.some(record => record.recordId === claim.recordId));
  assert.ok(!blessing.source.records.some(record => record.recordId === claim.recordId));
});

test('UnitT12_W08RetainsSharedReleaseAndWeaponArmorSourceClosure', () => {
  // Scenario: the fixed Source registry has one unused armor enum and shared release compatibility evidence outside Web ownership refs.
  // Purpose: all Source review targets remain covered without copying unrelated records across every content domain.
  const input = makeInput();
  const evidence = makeSourceRecord('evidence:release-compatibility', 'evidence', { evidenceType: 'code' }, 'evidence');
  const compatibility = makeSourceRecord('compatibility:to-current-release', 'release-compatibility', {
    fromGameReleaseId: 'darktide:1.13.1',
    toGameReleaseId: RELEASE_ID,
    evidenceRefs: [{ recordId: evidence.recordId, gameReleaseId: RELEASE_ID, kind: 'evidence' }],
  });
  const unusedArmor = makeSourceRecord('armor-class:player', 'armor-class', { classKey: 'player' });
  for (const source of [input.sourceContract, input.w06.sourceContract, input.w07.sourceContract]) {
    source.records.push(structuredClone(evidence), structuredClone(compatibility), structuredClone(unusedArmor));
  }

  const candidate = compileW08Candidate(input);
  const domains = Object.fromEntries(candidate.manifest.files.map(file => [file.kind,
    JSON.parse(candidate.files.get(file.path).toString('utf8'))]));

  assert.ok(domains.weapons.source.records.some(record => record.recordId === unusedArmor.recordId));
  assert.ok(!domains.skills.source.records.some(record => record.recordId === unusedArmor.recordId));
  for (const kind of ['blessings', 'skills', 'terms', 'weapons']) {
    assert.ok(domains[kind].source.records.some(record => record.recordId === compatibility.recordId), kind);
    assert.ok(domains[kind].source.records.some(record => record.recordId === evidence.recordId), kind);
  }
  assert.equal(candidate.envelope.review.sourceTargetCount, 7);
});

test('UnitT13_W08GateRequiresMatchingHumanApprovalReceiptsForEveryApprovedTarget', () => {
  // Scenario: approved Web and Source rows are supplied with no receipt, a wrong-mode receipt, or exact approvals.
  // Purpose: release readiness must prove approval against each target's owner identity and current digest tuple.
  const targetDigest = 'a'.repeat(64);
  const dependenciesDigest = 'b'.repeat(64);
  const webTarget = { targetId: 'target:skill:name', ownerId: 'presentation:skill', fieldPath: '/name', dimension: 'content' };
  const sourceTarget = { gameReleaseId: RELEASE_ID, recordId: 'skill:one', fieldPath: '/payload', dimension: 'technical' };
  const reviewer = { kind: 'human', id: 'reviewer:synthetic' };
  const reviewedAt = '2026-10-20T00:00:00Z';
  const sourceBuild = { buildIdentityVerified: true, publicationEligible: true };
  const makeReview = receipts => ({
    targets: [{ mode: 'w06', target: webTarget, state: 'approved', targetDigest, dependenciesDigest }],
    sourceTargets: [{ mode: 'source', ...sourceTarget, state: 'approved', targetDigest, dependenciesDigest }],
    states: { approved: 2, pending: 0, stale: 0, rejected: 0 },
    targetCount: 2,
    webTargetCount: 1,
    sourceTargetCount: 1,
    receiptCount: receipts.length,
    receipts,
  });
  const webApproval = { mode: 'w06', receipt: {
    targetId: webTarget.targetId, targetDigest, dependenciesDigest, decision: 'approved', reviewer, reviewedAt,
  } };
  const sourceApproval = { mode: 'source', receipt: {
    target: sourceTarget, targetDigest, dependenciesDigest, decision: 'approved', reviewer, reviewedAt,
  } };
  const evaluate = receipts => evaluateW08PublicationGate({ sourceBuild, review: makeReview(receipts), requiredContent: [] });

  const missing = evaluate([]);
  assert.equal(missing.status, 'blocked');
  assert.ok(missing.blockers.includes('approved-review-target-lacks-matching-receipt'));

  const wrongMode = evaluate([{ ...webApproval, mode: 'w07' }, sourceApproval]);
  assert.equal(wrongMode.status, 'blocked');
  assert.ok(wrongMode.blockers.includes('approved-review-target-lacks-matching-receipt'));

  const wrongDigest = evaluate([{ ...webApproval, receipt: { ...webApproval.receipt, targetDigest: 'c'.repeat(64) } }, sourceApproval]);
  assert.equal(wrongDigest.status, 'blocked');
  assert.ok(wrongDigest.blockers.includes('approved-review-target-lacks-matching-receipt'));

  const wrongSourceDimension = evaluate([webApproval, { ...sourceApproval, receipt: {
    ...sourceApproval.receipt, target: { ...sourceTarget, dimension: 'content' },
  } }]);
  assert.equal(wrongSourceDimension.status, 'blocked');
  assert.ok(wrongSourceDimension.blockers.includes('approved-review-target-lacks-matching-receipt'));

  const matched = evaluate([webApproval, sourceApproval]);
  assert.equal(matched.status, 'ready-for-release-allocation');

  const laterRejection = evaluate([webApproval, sourceApproval, {
    mode: 'w06', receipt: { ...webApproval.receipt, decision: 'rejected', reviewedAt: '2026-10-20T00:00:00.0000000001Z' },
  }]);
  assert.equal(laterRejection.status, 'blocked');
  assert.ok(laterRejection.blockers.includes('approved-review-target-lacks-matching-receipt'));

  const equalInstantConflict = evaluate([webApproval, sourceApproval, {
    mode: 'w06', receipt: { ...webApproval.receipt, decision: 'rejected', reviewedAt: '2026-10-20T00:00:00.000Z' },
  }]);
  assert.equal(equalInstantConflict.status, 'blocked');
  assert.ok(equalInstantConflict.blockers.includes('approved-review-target-lacks-matching-receipt'));

  const invalidCalendarDate = evaluate([{
    mode: 'w06', receipt: { ...webApproval.receipt, reviewedAt: '2026-02-30T12:00:00Z' },
  }, sourceApproval]);
  assert.equal(invalidCalendarDate.status, 'blocked');
  assert.ok(invalidCalendarDate.blockers.includes('approved-review-target-lacks-matching-receipt'));
});

test('InterT14_W08CandidateDirectoryRejectsMalformedUtf8AfterConsistentRehash', () => {
  // Scenario: a package file contains an invalid UTF-8 byte even though its declared size, hash, and revision are recomputed.
  // Purpose: JSON package validation must decode UTF-8 fatally instead of replacing malformed bytes before parsing.
  const candidate = compileW08Candidate(makeInput());
  const invalid = {
    envelope: structuredClone(candidate.envelope),
    manifest: structuredClone(candidate.manifest),
    files: new Map([...candidate.files].map(([filePath, bytes]) => [filePath, Buffer.from(bytes)])),
    manifestBytes: Buffer.from(candidate.manifestBytes),
  };
  const row = invalid.manifest.files.find(file => file.kind === 'skills');
  const malformed = Buffer.from(invalid.files.get(row.path));
  const marker = Buffer.from('"name": "presentation:skill"');
  const markerOffset = malformed.indexOf(marker);
  assert.notEqual(markerOffset, -1);
  malformed[markerOffset + Buffer.byteLength('"name": "')] = 0xff;
  invalid.files.set(row.path, malformed);
  row.sizeBytes = malformed.byteLength;
  row.sha256 = sha256(malformed);
  invalid.manifest.dataRevision = computeDataRevision(invalid.manifest);
  invalid.envelope.manifest.path = buildManifestPath(invalid.manifest.dataRevision);
  invalid.envelope.manifest.dataRevision = invalid.manifest.dataRevision;
  invalid.manifestBytes = jsonBytes(invalid.manifest);
  invalid.envelope.manifest.sha256 = sha256(invalid.manifestBytes);

  assert.throws(() => validateW08Candidate(invalid), /UTF-8/i);
});
