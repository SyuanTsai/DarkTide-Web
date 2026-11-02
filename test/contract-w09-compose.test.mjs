import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadWebAuthoringInputs, validateWebAuthoring } from '../scripts/content/contract-authoring.mjs';
import {
  assertW09SourceProjectionPreservesReviewProof,
  createW09AuthoringSourcePin,
  deriveW09CandidateBranch,
  ensureW09CandidatePullRequest,
  validateW09CompositionInputLock,
} from '../scripts/content/contract-w09-compose.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const request = {
  schema: 'w09-source-request/1',
  repository: 'SyuanTsai/DarkTide-Source-Data',
  sourceCommit: '1'.repeat(40),
  sourceRevision: '2'.repeat(64),
  manifestSha256: '3'.repeat(64),
  archiveSha256: '6'.repeat(64),
  gameReleaseId: 'fixture:game-release',
  releaseId: '',
  requestId: '5'.repeat(64),
};
request.releaseId = 'w09-' + createHash('sha256')
  .update(JSON.stringify({ gameReleaseId: request.gameReleaseId, sourceRevision: request.sourceRevision }))
  .digest('hex').slice(0, 32);

const packetPaths = [
  'analysis.md',
  'source-revision.json',
  'source-revision.md',
  'source-manifest.json',
  'source-receipt.json',
  'technical.json',
];

request.packetFiles = packetPaths.map((path, index) => ({
  path,
  sizeBytes: index + 1,
  sha256: 'abcdef'[index].repeat(64),
}));

function validLock() {
  return {
    schema: 'w09-web-inputs-lock/1',
    repository: 'https://github.com/SyuanTsai/DarkTide-Web',
    source: {
      releaseId: request.releaseId,
      requestId: request.requestId,
      sourceCommit: request.sourceCommit,
      sourceRevision: request.sourceRevision,
      manifestSha256: request.manifestSha256,
      archiveSha256: '6'.repeat(64),
      packetFiles: structuredClone(request.packetFiles),
    },
    web: {
      w08InputLockSha256: '8'.repeat(64),
      w08CompilerLockSha256: '9'.repeat(64),
      w08CompilerCommit: 'a'.repeat(40),
      w09CompilerLockSha256: 'c'.repeat(64),
      compilerFileSetSha256: 'd'.repeat(64),
      compilerCommit: 'e'.repeat(40),
      w08AuthoringCommit: 'b'.repeat(40),
      overlayCommit: null,
      authoringCommit: 'b'.repeat(40),
    },
    gameReleaseId: request.gameReleaseId,
    authoringOverlay: [],
  };
}

// Scenario: a composition lock pins the exact public Source archive and the W08-derived Web compiler inputs.
// Purpose: prevent request identity, compiler identity, or raw packet hashes from being supplied as untracked readiness flags.
test('UnitT03_composition-input-lock-validates-exact-Source-and-Web-pins', () => {
  const lock = validLock();
  assert.equal(validateW09CompositionInputLock(lock, request), lock);
  const wrongRevision = structuredClone(lock);
  wrongRevision.source.sourceRevision = 'c'.repeat(64);
  assert.throws(() => validateW09CompositionInputLock(wrongRevision, request), /request|sourceRevision|pin/i);
  const unsafeOverlay = structuredClone(lock);
  unsafeOverlay.authoringOverlay = [{ mode: 'w07', target: 'authoring', path: 'content/contracts/w09/authoring-overlays/w07/authoring/../outside.json', sizeBytes: 4, sha256: 'd'.repeat(64) }];
  assert.throws(() => validateW09CompositionInputLock(unsafeOverlay, request), /path|safe|overlay/i);

  const overlay = structuredClone(lock);
  overlay.web.overlayCommit = 'c'.repeat(40);
  overlay.web.authoringCommit = overlay.web.overlayCommit;
  overlay.authoringOverlay = [{
    mode: 'w07', target: 'officialInputs',
    path: 'content/contracts/w09/authoring-overlays/w07/officialInputs/official-inputs.json',
    sizeBytes: 9, sha256: 'd'.repeat(64),
  }];
  assert.equal(validateW09CompositionInputLock(overlay, request), overlay);

  const inconsistentPin = structuredClone(overlay);
  inconsistentPin.web.authoringCommit = 'e'.repeat(40);
  assert.throws(() => validateW09CompositionInputLock(inconsistentPin, request), /authoringCommit|overlayCommit/i);
});

// Scenario: the W09 adapter generates the Source pin consumed by the unchanged Web authoring validator.
// Purpose: keep the generated repository identity compatible with the formal authoring schema and pinned validator.
test('UnitT03_generated-W09-Source-pin-validates-formal-W07-authoring-shape', async () => {
  const mode = await loadWebAuthoringInputs({ repoRoot: REPO_ROOT, mode: 'w07' });
  const sourceLock = {
    schemaVersion: 'w09-source-contract-pin/1',
    repository: 'https://github.com/SyuanTsai/DarkTide-Source-Data',
    commit: mode.sourceLock.commit,
    schemaId: mode.sourceLock.schemaId,
    files: {
      schema: structuredClone(mode.sourceLock.files.schema),
      data: structuredClone(mode.sourceLock.files.data),
      validator: structuredClone(mode.sourceLock.files.validator),
    },
  };
  const authoring = structuredClone(mode.authoring);
  authoring.sourcePin = createW09AuthoringSourcePin(sourceLock);
  const result = validateWebAuthoring(authoring, { ...mode, sourceLock });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(authoring.sourcePin.repository, 'https://github.com/SyuanTsai/DarkTide-Source-Data');
});

// Scenario: W09 creates a compiler projection by changing only the root publicationEligible flag.
// Purpose: Independently revalidate every receipt through the pinned validator's scoped cache, accepting only its one exact expected flag-consistency issue.
test('UnitT04_source-projection-revalidates-complete-receipt-proof_and_fails_closed', () => {
  const expectedFlagIssue = {
    path: '/publicationEligible',
    code: 'publication-state-mismatch',
    message: 'publicationEligible must be true based on fixture and review state',
  };
  const originalValidation = { valid: true, publicationEligible: true, issues: [] };
  const projectedValidation = { valid: false, publicationEligible: true, issues: [expectedFlagIssue] };
  const makeCase = ({ projectionResult = projectedValidation, originalResult = originalValidation, mutateProjection = false } = {}) => {
    const original = {
      fixtureOnly: false,
      publicationEligible: true,
      records: [{
        recordId: 'fixture:record',
        gameReleaseId: 'fixture:release',
        payload: { label: 'fixed content' },
        reviewTargets: [{ fieldPath: '/payload/label', dimension: 'content' }],
      }],
      tombstones: [],
      reviewReceipts: [{
        target: { recordId: 'fixture:record', gameReleaseId: 'fixture:release', fieldPath: '/payload/label', dimension: 'content' },
        targetDigest: 'a'.repeat(64),
        dependenciesDigest: 'b'.repeat(64),
        decision: 'approved',
        reviewer: { kind: 'human', id: 'fixture-reviewer' },
      }],
    };
    const projection = structuredClone(original);
    projection.publicationEligible = false;
    if (mutateProjection) projection.records[0].payload.label = 'changed content';
    const schema = { fixtureSchema: true };
    const validationCalls = [];
    let publicDigestCalls = 0;
    const validator = {
      computeReviewDigests() {
        publicDigestCalls += 1;
        return { targetDigest: 'a'.repeat(64), dependenciesDigest: 'b'.repeat(64) };
      },
      validateSourceContract(contract, options) {
        validationCalls.push({ contract, schema: options.schema });
        return structuredClone(contract.publicationEligible === false ? projectionResult : originalResult);
      },
    };
    return { original, projection, schema, validator, validationCalls, get publicDigestCalls() { return publicDigestCalls; }, originalValidation: originalResult };
  };

  const valid = makeCase();
  const projectedResult = assertW09SourceProjectionPreservesReviewProof(
    valid.original, valid.projection, valid.validator, valid.schema, valid.originalValidation,
  );
  assert.deepEqual(projectedResult, projectedValidation);
  assert.deepEqual(valid.validationCalls, [{ contract: valid.projection, schema: valid.schema }]);
  assert.equal(valid.publicDigestCalls, 0, 'the projection proof uses the validator-scoped receipt cache, not fresh public digest contexts per target');

  const changedContent = makeCase({ mutateProjection: true });
  assert.throws(() => assertW09SourceProjectionPreservesReviewProof(
    changedContent.original, changedContent.projection, changedContent.validator, changedContent.schema, changedContent.originalValidation,
  ), /projection changed content|review state|receipts/i);
  assert.equal(changedContent.validationCalls.length, 0, 'structural mismatch fails before projected validation');

  const invalidOriginal = makeCase({ originalResult: { valid: false, publicationEligible: false, issues: [{ path: '/reviewReceipts/0', code: 'stale', message: 'stale receipt' }] } });
  assert.throws(() => assertW09SourceProjectionPreservesReviewProof(
    invalidOriginal.original, invalidOriginal.projection, invalidOriginal.validator, invalidOriginal.schema, invalidOriginal.originalValidation,
  ), /original.*valid|review proof/i);

  const withExtraIssue = makeCase({ projectionResult: {
    ...projectedValidation,
    issues: [expectedFlagIssue, { path: '/reviewReceipts/0', code: 'stale-review', message: 'receipt no longer matches' }],
  } });
  assert.throws(() => assertW09SourceProjectionPreservesReviewProof(
    withExtraIssue.original, withExtraIssue.projection, withExtraIssue.validator, withExtraIssue.schema, withExtraIssue.originalValidation,
  ), /projection.*review|validation/i);

  for (const badProjectionResult of [
    { valid: true, publicationEligible: true, issues: [] },
    { valid: false, publicationEligible: false, issues: [expectedFlagIssue] },
    { valid: false, publicationEligible: true, issues: [{ ...expectedFlagIssue, path: '/records/0' }] },
    { valid: false, publicationEligible: true, issues: [{ ...expectedFlagIssue, code: 'other-mismatch' }] },
    { valid: false, publicationEligible: true, issues: [{ ...expectedFlagIssue, message: 'publicationEligible must be false' }] },
  ]) {
    const invalid = makeCase({ projectionResult: badProjectionResult });
    assert.throws(() => assertW09SourceProjectionPreservesReviewProof(
      invalid.original, invalid.projection, invalid.validator, invalid.schema, invalid.originalValidation,
    ), /projection.*review|validation/i);
  }
});

// Scenario: a request is retried after a Web runner restart.
// Purpose: derive one stable candidate branch identity from the full Source revision, never a per-game request ID.
test('InterT03_candidate-branch-aggregates-per-game-proposals-by-Source-revision', () => {
  const second = {
    ...request,
    gameReleaseId: 'fixture:second-game-release',
    releaseId: 'w09-' + createHash('sha256')
      .update(JSON.stringify({ gameReleaseId: 'fixture:second-game-release', sourceRevision: request.sourceRevision }))
      .digest('hex').slice(0, 32),
    requestId: 'f'.repeat(64),
    manifestSha256: request.manifestSha256,
    archiveSha256: '7'.repeat(64),
  };
  const branch = deriveW09CandidateBranch(request.sourceRevision);
  assert.equal(branch, deriveW09CandidateBranch(second.sourceRevision));
  assert.match(branch, /^codex\/syp-341-w09-[a-f0-9]+$/);
  assert.notEqual(branch, deriveW09CandidateBranch('e'.repeat(64)));
});

// Scenario: several game releases share one Source revision, and the runner loses a PR update response.
// Purpose: merge per-game proposals into one revision-scoped PR without overwriting prior games or accepting conflicting identity.
test('InterT03_PR-retry-merges-per-game-proposals-and-rejects-conflicts', async () => {
  const second = {
    ...request,
    gameReleaseId: 'fixture:second-game-release',
    releaseId: 'w09-' + createHash('sha256')
      .update(JSON.stringify({ gameReleaseId: 'fixture:second-game-release', sourceRevision: request.sourceRevision }))
      .digest('hex').slice(0, 32),
    requestId: 'f'.repeat(64),
    manifestSha256: request.manifestSha256,
    archiveSha256: '7'.repeat(64),
  };
  const branch = deriveW09CandidateBranch(request.sourceRevision);
  let current = [];
  const commands = [];
  const bodyFileContents = [];
  const runGh = async args => {
    commands.push(args);
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(current);
    if (args[0] === 'pr' && args[1] === 'create') {
      const bodyPath = args[args.indexOf('--body-file') + 1];
      const body = await readFile(bodyPath, 'utf8');
      bodyFileContents.push(body);
      current = [{
        number: 341,
        url: 'https://github.com/SyuanTsai/DarkTide-Web/pull/341',
        state: 'OPEN',
        headRefName: branch,
        baseRefName: 'main',
        headRepository: { nameWithOwner: 'SyuanTsai/DarkTide-Web' },
        headRepositoryOwner: { login: 'SyuanTsai' },
        isCrossRepository: false,
        body,
      }];
      return current[0].url;
    }
    if (args[0] === 'pr' && args[1] === 'edit') {
      const body = await readFile(args[args.indexOf('--body-file') + 1], 'utf8');
      bodyFileContents.push(body);
      current[0] = { ...current[0], body };
      return 'edited';
    }
    throw new Error('unexpected gh command');
  };
  const created = await ensureW09CandidatePullRequest({ sourceRevision: request.sourceRevision, proposals: [request], runGh });
  assert.equal(created.created, true);
  const listArgs = commands.find(args => args[0] === 'pr' && args[1] === 'list');
  const requestedFields = listArgs[listArgs.indexOf('--json') + 1].split(',');
  assert.ok(requestedFields.includes('headRepository'));
  assert.ok(requestedFields.includes('headRepositoryOwner'));
  assert.ok(requestedFields.includes('isCrossRepository'));
  assert.ok(!requestedFields.includes('baseRepository'));
  assert.ok(commands.some(args => args[0] === 'pr' && args[1] === 'create' && args.includes('--body-file') && !args.includes('--body')));
  assert.equal(bodyFileContents.length, 1);
  const reused = await ensureW09CandidatePullRequest({ sourceRevision: request.sourceRevision, proposals: [request], runGh });
  assert.equal(reused.created, false);
  assert.equal(reused.number, 341);
  assert.equal(commands.some(args => args[1] === 'edit'), false);

  current[0] = { ...current[0], body: current[0].body + '\n\nHuman review note: preserve this wording across retries.\n' };
  const merged = await ensureW09CandidatePullRequest({ sourceRevision: request.sourceRevision, proposals: [second], runGh });
  assert.equal(merged.created, false);
  assert.equal(merged.updated, true);
  assert.ok(commands.some(args => args[0] === 'pr' && args[1] === 'edit' && args.includes('--body-file') && !args.includes('--body')));
  assert.equal(bodyFileContents.length, 2);
  assert.deepEqual(new Set(merged.proposals.map(row => row.requestId)), new Set([request.requestId, second.requestId]));
  assert.match(merged.body, /Human review note: preserve this wording across retries\./u);

  const conflict = { ...second, archiveSha256: 'b'.repeat(64) };
  await assert.rejects(ensureW09CandidatePullRequest({ sourceRevision: request.sourceRevision, proposals: [conflict], runGh }), /identity|archive|manifest|conflict/i);

  await assert.rejects(ensureW09CandidatePullRequest({ sourceRevision: 'e'.repeat(64), proposals: [request], runGh }), /sourceRevision|revision/i);

  current = [{ ...current[0], state: 'CLOSED' }];
  await assert.rejects(ensureW09CandidatePullRequest({ sourceRevision: request.sourceRevision, proposals: [request], runGh }), /closed|duplicate/i);

  current = [{ ...current[0], state: 'OPEN', isCrossRepository: true }];
  await assert.rejects(ensureW09CandidatePullRequest({ sourceRevision: request.sourceRevision, proposals: [request], runGh }), /repository|cross/i);

});
