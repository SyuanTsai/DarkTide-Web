import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compileW08Candidate,
  evaluateW08PublicationGate,
  validateW08Candidate,
  validateW08CandidateDirectory,
  writeW08Candidate,
} from '../scripts/content/contract-w08-build.mjs';
import { buildManifestPath, computeDataRevision } from '../scripts/content/contract-release.mjs';

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

function makeInput({ withEventSource = false, addAnnouncement = false, addGameChange = false } = {}) {
  const sourceContract = makeSourceContract({ withEventSource });
  const skill = makePresentation('skill:one', 'skill', 'presentation:skill');
  const blessing = makePresentation('blessing:one', 'blessing', 'presentation:blessing');
  const weapon = makePresentation('weapon:one', 'weapon', 'presentation:weapon');
  const w06 = makeMode('w06', [skill, blessing], { sourceContract: structuredClone(sourceContract) });
  const w07Extra = { sourceContract: structuredClone(sourceContract) };
  if (addAnnouncement) {
    w07Extra.authoring = structuredClone(makeMode('w07', [weapon]).authoring);
    w07Extra.authoring.announcements.push({ announcementId: 'announcement:site-only', locale: 'zh-TW', text: 'A site note' });
  }
  if (addGameChange) {
    w07Extra.authoring ??= structuredClone(makeMode('w07', [weapon]).authoring);
    w07Extra.authoring.gameChanges = [{
      changeId: 'change:combat',
      locale: 'zh-TW',
      summary: 'Combat change',
      sourceRef: { sourceId: 'source:event', gameReleaseId: RELEASE_ID },
      evidenceRef: { recordId: 'evidence:event', gameReleaseId: RELEASE_ID, kind: 'evidence' },
    }];
    w07Extra.authoring.reviewTargets = [...w07Extra.authoring.reviewTargets, {
      targetId: 'target:change:combat:summary', ownerId: 'change:combat', fieldPath: '/summary', dimension: 'content',
    }];
    w07Extra.reviewStates = { ...w07Extra.reviewStates, 'target:change:combat:summary': 'pending' };
  }
  const w07 = makeMode('w07', [weapon], w07Extra);
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

test('UnitT05_W08EventDomainClosesWebSourceRefsAndTypedEvidence', () => {
  // Scenario: a localized gameplay change refers to a Source locator and an evidence record outside the four domain roots.
  // Purpose: event projections must carry the exact Source record/provenance closure and reject dangling typed references.
  const result = compileW08Candidate(makeInput({ withEventSource: true, addGameChange: true }));
  const changePath = result.manifest.files.find(file => file.kind === 'game-changes').path;
  const change = JSON.parse(result.files.get(changePath).toString('utf8'));

  assert.ok(change.source.records.some(record => record.recordId === 'evidence:event'));
  assert.ok(change.source.sourceRefs.some(ref => ref.sourceId === 'source:event'));
  assert.equal(change.web.gameChanges.length, 1);
  assert.ok(result.manifest.compatibility.gameSnapshotRefs.includes(SUPPLEMENTAL_SNAPSHOT.snapshotId));

  const invalid = makeInput({ withEventSource: true, addGameChange: true });
  invalid.w07.authoring.gameChanges[0].evidenceRef.recordId = 'evidence:missing';
  assert.throws(() => compileW08Candidate(invalid), /unresolved/i);
});

test('UnitT06_W08SiteAnnouncementDoesNotCreateAGameChangeDomain', () => {
  // Scenario: an informational announcement exists without a gameplay or official-text change.
  // Purpose: the compiler must preserve the announcement while avoiding a fabricated game-change file.
  const result = compileW08Candidate(makeInput({ addAnnouncement: true }));

  assert.ok(result.manifest.files.some(file => file.kind === 'announcements'));
  assert.equal(result.manifest.files.some(file => file.kind === 'game-changes'), false);
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
