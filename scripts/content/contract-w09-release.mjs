import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { safeRelativePath } from '../../src/static/common.mjs';
import { verifyW09UndeployedPromotion } from './contract-w09-cancellation-proof.mjs';

const STATE_SCHEMA = 'w09-release-ledger/1';
const SHA256_RE = /^[a-f0-9]{64}$/;
const GAME_VERSION_RE = /^\d+\.\d+\.\d+$/;
const SLOT_RE = /^(\d+\.\d+\.\d+)\.(\d+)$/;
const RELEASE_STATUSES = new Set(['reserved', 'prepared', 'approved', 'failed']);
const INTERNAL_PUBLICATION_LOCK = Symbol('w09-internal-publication-lock');
const W09_WEB_ORIGINS = new Set([
  'https://github.com/SyuanTsai/DarkTide-Web',
  'https://github.com/SyuanTsai/DarkTide-Web.git',
]);
const W09_SELECTED_PATH = 'content/contracts/w09/source-handoff/selected.json';
const W09_COMPOSITION_LOCK_ROOT = 'content/contracts/w09/source-handoff/locks/';
const W09_COMPOSER_MODULE_PATH = 'scripts/content/contract-w09-compose.mjs';
const W09_COMPILER_LOCK_PATH = 'content/contracts/w09/compiler.lock.json';
const W08_INPUT_LOCK_PATH = 'content/contracts/w08/compiler-inputs.lock.json';
const W08_COMPILER_LOCK_PATH = 'content/contracts/w08/compiler.lock.json';
const W09_COMPOSITION_CONTEXTS = new WeakSet();

function registerW09CompositionContext(context) {
  const frozen = Object.freeze(context);
  W09_COMPOSITION_CONTEXTS.add(frozen);
  return frozen;
}

function canonicalW09Value(value) {
  if (Array.isArray(value)) return value.map(canonicalW09Value);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    const sorted = {};
    for (const key of Object.keys(value).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))) {
      sorted[key] = canonicalW09Value(value[key]);
    }
    return sorted;
  }
  return value;
}

function canonicalW09Json(value) {
  return JSON.stringify(canonicalW09Value(value));
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function releaseGitText(repoRoot, args, label) {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }).trim();
  } catch (error) {
    throw new Error(label + ' failed: ' + (error.stderr?.toString('utf8').trim() || error.message));
  }
}

function releaseGitBlob(repoRoot, commit, relativePath) {
  try {
    return Buffer.from(execFileSync('git', ['-C', repoRoot, 'show', commit + ':' + relativePath], {
      encoding: null,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }));
  } catch (error) {
    throw new Error('tracked W09 composition input is unavailable: ' + relativePath + ' ('
      + (error.stderr?.toString('utf8').trim() || error.message) + ')');
  }
}

async function readExactTrackedInput(repoRoot, relativePath, trackedBytes) {
  let cursor = repoRoot;
  const parts = relativePath.split('/');
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part);
    let info;
    try { info = await lstat(cursor); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error('tracked W09 composition input is missing: ' + relativePath);
      throw error;
    }
    if (info.isSymbolicLink() || (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())) {
      throw new Error('tracked W09 composition input must be a regular non-symlink path: ' + relativePath);
    }
  }
  const workingBytes = await readFile(cursor);
  if (!workingBytes.equals(trackedBytes)) {
    throw new Error('tracked W09 composition input differs from its committed bytes: ' + relativePath);
  }
}

function assertOfficialW09WebOrigin(repoRoot) {
  const origin = releaseGitText(repoRoot, ['remote', 'get-url', 'origin'], 'W09 Web origin check').replace(/\/$/u, '');
  if (!W09_WEB_ORIGINS.has(origin)) throw new Error('W09 Web origin must be the fixed official repository');
}

async function validateSelectedBytesMatch(runtimeRoot, runtimeHead, historyRoot, historyHead, composer) {
  const runtimeBytes = releaseGitBlob(runtimeRoot, runtimeHead, W09_SELECTED_PATH);
  const historyBytes = releaseGitBlob(historyRoot, historyHead, W09_SELECTED_PATH);
  await readExactTrackedInput(runtimeRoot, W09_SELECTED_PATH, runtimeBytes);
  await readExactTrackedInput(historyRoot, W09_SELECTED_PATH, historyBytes);
  if (!runtimeBytes.equals(historyBytes)) {
    throw new Error('current main selected W09 marker differs from the pinned historical composition input');
  }

  let selection;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(runtimeBytes);
    selection = composer.validateW09SelectedComposition(JSON.parse(decoded));
  } catch (error) {
    throw new Error('current main selected W09 marker is invalid: ' + error.message);
  }
  for (const proposal of selection.proposals) {
    const relativePath = W09_COMPOSITION_LOCK_ROOT + proposal.requestId + '.json';
    const runtimeLock = releaseGitBlob(runtimeRoot, runtimeHead, relativePath);
    const historyLock = releaseGitBlob(historyRoot, historyHead, relativePath);
    await readExactTrackedInput(runtimeRoot, relativePath, runtimeLock);
    await readExactTrackedInput(historyRoot, relativePath, historyLock);
    if (!runtimeLock.equals(historyLock)) {
      throw new Error('current main W09 request lock differs from the pinned historical composition input: ' + proposal.requestId);
    }
  }
}

/**
 * Resolve the exact compiler module used for Source/W08/overlay replay. In dual-root
 * promotion, runtime state remains in repoRoot while the original composition module
 * is imported only after both tracked code pins and all selected input bytes agree.
 */
export async function resolveW09CompositionContext(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('W09 composition context options must be an object');
  }
  const hasCompositionRoot = options.compositionRepoRoot !== undefined;
  const hasExpectedCommit = options.expectedCompositionCommit !== undefined;
  if (hasCompositionRoot !== hasExpectedCommit) {
    throw new Error('compositionRepoRoot and expectedCompositionCommit must be provided together');
  }
  if (typeof options.repoRoot !== 'string' || options.repoRoot.trim() === '') {
    throw new Error('repoRoot is required to resolve the W09 composition context');
  }

  const runtimeRoot = await realpath(path.resolve(options.repoRoot));
  if (!hasCompositionRoot) {
    const moduleUrl = new URL('./contract-w09-compose.mjs', import.meta.url).href;
    const composer = await import(moduleUrl);
    const runtimeHead = releaseGitText(runtimeRoot, ['rev-parse', 'HEAD'], 'current W09 Web HEAD check');
    if (typeof composer.loadW09VerifiedComposition !== 'function') {
      throw new Error('current W09 composer does not expose the verified composition loader');
    }
    const context = {
      runtimeRoot,
      runtimeHead,
      dualRoot: false,
      compositionRoot: runtimeRoot,
      expectedCompositionCommit: null,
      moduleUrl,
      loadW09VerifiedComposition: composer.loadW09VerifiedComposition,
    };
    return registerW09CompositionContext(context);
  }

  if (typeof options.compositionRepoRoot !== 'string' || options.compositionRepoRoot.trim() === '') {
    throw new TypeError('compositionRepoRoot must be a non-empty local path');
  }
  if (typeof options.expectedCompositionCommit !== 'string'
      || !/^[a-f0-9]{40}$/u.test(options.expectedCompositionCommit)) {
    throw new TypeError('expectedCompositionCommit must be a full lowercase Git commit SHA');
  }
  const compositionRoot = await realpath(path.resolve(options.compositionRepoRoot));
  if (runtimeRoot.toLowerCase() === compositionRoot.toLowerCase()) {
    throw new Error('runtime and historical W09 composition roots must be separate checkouts');
  }

  assertOfficialW09WebOrigin(runtimeRoot);
  assertOfficialW09WebOrigin(compositionRoot);
  const runtimeHead = releaseGitText(runtimeRoot, ['rev-parse', 'HEAD'], 'current W09 Web HEAD check');
  const compositionHead = releaseGitText(compositionRoot, ['rev-parse', 'HEAD'], 'historical W09 Web HEAD check');
  if (compositionHead !== options.expectedCompositionCommit) {
    throw new Error('historical W09 composition checkout does not match expectedCompositionCommit');
  }
  try {
    execFileSync('git', ['-C', runtimeRoot, 'merge-base', '--is-ancestor', compositionHead, runtimeHead], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (error) {
    if (error.status === 1) throw new Error('historical W09 composition commit must be an ancestor of current main');
    throw new Error('historical W09 composition ancestry check failed');
  }

  const currentComposer = await import(new URL('./contract-w09-compose.mjs', import.meta.url).href);
  if (typeof currentComposer.loadW09CompilerCodePin !== 'function'
      || typeof currentComposer.validateW09SelectedComposition !== 'function') {
    throw new Error('current W09 compiler verifier is unavailable');
  }
  const runtimePin = currentComposer.loadW09CompilerCodePin({ repoRoot: runtimeRoot, head: runtimeHead });
  const historyPin = currentComposer.loadW09CompilerCodePin({ repoRoot: compositionRoot, head: compositionHead });
  await validateSelectedBytesMatch(runtimeRoot, runtimeHead, compositionRoot, compositionHead, currentComposer);

  const composerPin = historyPin.files.find(row => row.path === W09_COMPOSER_MODULE_PATH);
  if (!composerPin) throw new Error('historical W09 code pin omits the composition module');
  const historicalComposerPath = path.join(compositionRoot, ...W09_COMPOSER_MODULE_PATH.split('/'));
  const historicalComposerInfo = await lstat(historicalComposerPath);
  if (historicalComposerInfo.isSymbolicLink() || !historicalComposerInfo.isFile()) {
    throw new Error('historical W09 composition module must be a regular pinned file');
  }
  const historicalComposerBytes = await readFile(historicalComposerPath);
  if (historicalComposerBytes.byteLength !== composerPin.sizeBytes
      || createHash('sha256').update(historicalComposerBytes).digest('hex') !== composerPin.sha256) {
    throw new Error('historical W09 composition module differs from its verified code pin');
  }

  const moduleUrl = pathToFileURL(historicalComposerPath).href;
  const historicalComposer = await import(moduleUrl);
  if (typeof historicalComposer.loadW09VerifiedComposition !== 'function'
      || typeof historicalComposer.loadW09CompilerCodePin !== 'function') {
    throw new Error('pinned historical W09 composer does not expose the verified loader');
  }
  const importedHistoryPin = historicalComposer.loadW09CompilerCodePin({ repoRoot: compositionRoot, head: compositionHead });
  if (importedHistoryPin.lockSha256 !== historyPin.lockSha256
      || importedHistoryPin.fileSetSha256 !== historyPin.fileSetSha256) {
    throw new Error('imported historical W09 composer disagrees with the pre-import code-pin verification');
  }

  const context = {
    runtimeRoot,
    runtimeHead,
    dualRoot: true,
    runtimePin,
    compositionRoot,
    expectedCompositionCommit: compositionHead,
    historyPin,
    moduleUrl,
    loadW09VerifiedComposition: historicalComposer.loadW09VerifiedComposition,
  };
  return registerW09CompositionContext(context);
}

async function revalidateW09CompositionContext(options, initialContext, stage) {
  const latest = await resolveW09CompositionContext(options);
  if (initialContext.dualRoot && latest.runtimeHead !== initialContext.runtimeHead) {
    throw new Error('current main changed during W09 ' + stage + '; refusing to use historical composition inputs with a different runtime checkout');
  }
  return latest;
}

function assertText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(label + ' must be a non-empty string');
  }
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new TypeError(label + ' must be a lowercase SHA-256 hex digest');
  }
}

function parseGameVersion(value) {
  if (typeof value !== 'string' || !GAME_VERSION_RE.test(value)) {
    throw new TypeError('gameVersion must be a three-part numeric version');
  }
  return value.split('.').map(Number);
}

function contentSlot(gameVersion, sequence) {
  parseGameVersion(gameVersion);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new TypeError('content version sequence must be a positive safe integer');
  }
  return gameVersion + '.' + sequence;
}

function expectedReleaseId({ gameVersion, gameReleaseId, contentVersion, inputDigest, manifestSha256 }) {
  return 'w09-' + createHash('sha256').update(JSON.stringify([gameVersion, gameReleaseId, contentVersion, inputDigest, manifestSha256])).digest('hex').slice(0, 32);
}

export function createW09ReleaseState() {
  return {
    schema: STATE_SCHEMA,
    reservations: [],
    activeByGame: [],
    referenceReleaseIds: [],
    approvedRuntimeSnapshots: [],
    activeRuntimeSnapshotBuildId: null,
    publicationReceipts: [],
    pendingPromotion: null,
    promotionCancellations: [],
  };
}

function validateActiveSnapshotShape(snapshot, label) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
      || Object.keys(snapshot).sort().join(',') !== 'activeByGame,runtimeSnapshotBuildId'
      || !Array.isArray(snapshot.activeByGame)) {
    throw new TypeError(label + ' must pin the complete active pointer set and whole-site runtime build');
  }
  if (snapshot.runtimeSnapshotBuildId !== null) assertSha256(snapshot.runtimeSnapshotBuildId, label + ' runtimeSnapshotBuildId');
  const games = new Set();
  for (const [index, row] of snapshot.activeByGame.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
        || Object.keys(row).sort().join(',') !== 'gameReleaseId,releaseId') {
      throw new TypeError(label + '.activeByGame[' + index + '] must pin one gameReleaseId/releaseId pair');
    }
    assertText(row.gameReleaseId, label + ' gameReleaseId');
    assertText(row.releaseId, label + ' releaseId');
    if (games.has(row.gameReleaseId)) throw new TypeError(label + ' contains duplicate active game pointers');
    games.add(row.gameReleaseId);
  }
  if (snapshot.activeByGame.length > 0 && snapshot.runtimeSnapshotBuildId === null) {
    throw new TypeError(label + ' must pin a whole-site runtime build when shared releases are active');
  }
  return true;
}

function canonicalActiveSnapshot(snapshot) {
  validateActiveSnapshotShape(snapshot, 'expectedCurrent');
  return {
    activeByGame: [...snapshot.activeByGame].sort((left, right) => left.gameReleaseId.localeCompare(right.gameReleaseId, 'en')),
    runtimeSnapshotBuildId: snapshot.runtimeSnapshotBuildId,
  };
}

function validatePendingPromotion(pending, state, label) {
  if (!pending || typeof pending !== 'object' || Array.isArray(pending)
      || pending.schema !== 'w09-promotion-journal/1'
      || !Array.isArray(pending.releaseIds) || pending.releaseIds.length === 0
      || (pending.sourceReleaseIds !== undefined && (!Array.isArray(pending.sourceReleaseIds) || pending.sourceReleaseIds.length === 0))
      || !pending.expectedActive || typeof pending.expectedActive !== 'object' || !['prepared', 'retryable'].includes(pending.phase)) {
    throw new TypeError(label + ' must be a valid W09 promotion journal');
  }
  assertSha256(pending.transactionId, label + '.transactionId');
  assertSha256(pending.buildId, label + '.buildId');
  if (pending.dataRevision !== undefined) assertSha256(pending.dataRevision, label + '.dataRevision');
  assertSha256(pending.artifactManifestSha256, label + '.artifactManifestSha256');
  if (pending.runtimeSnapshotBuildId !== undefined) {
    assertSha256(pending.runtimeSnapshotBuildId, label + '.runtimeSnapshotBuildId');
    if (pending.runtimeSnapshotBuildId !== pending.buildId) throw new TypeError(label + ' runtime snapshot must pin its exact artifact build');
  }
  if (pending.action !== undefined && !['promote', 'rollback'].includes(pending.action)) {
    throw new TypeError(label + ' action is invalid');
  }
  for (const releaseId of pending.releaseIds) {
    const reservation = state.reservations.find(item => item.releaseId === releaseId);
    if (!reservation || !['prepared', 'approved'].includes(reservation.status)) {
      throw new TypeError(label + ' must retain its prepared release reservations');
    }
  }
  validateActiveSnapshotShape(pending.expectedActive, label + '.expectedActive');
  const expected = canonicalActiveSnapshot(pending.expectedActive);
  if (!sameJson(expected, pending.expectedActive)) throw new TypeError(label + '.expectedActive must be canonical');
}

function expectedPublicReleasePointers(state, activeSnapshot, label) {
  return activeSnapshot.activeByGame.map(active => {
    const reservation = state.reservations.find(row => row.releaseId === active.releaseId);
    if (!reservation || reservation.status !== 'approved' || reservation.gameReleaseId !== active.gameReleaseId
        || !reservation.dataRevision) {
      throw new TypeError(label + ' has no approved immutable reservation');
    }
    return {
      game_version: reservation.gameVersion,
      content_version: reservation.contentVersion,
      data_revision: reservation.dataRevision,
      manifest_path: '/data/' + reservation.dataRevision + '/manifest.json',
      manifest_sha256: reservation.manifestSha256,
    };
  }).sort((left, right) => left.game_version.localeCompare(right.game_version, 'en', { numeric: true }));
}

function validatePromotionCancellation(receipt, state, label) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || Object.keys(receipt).sort().join(',') !== 'action,cancellationId,evidence,pendingPromotion,schema,transactionId'
      || receipt.schema !== 'w09-promotion-cancellation/1' || receipt.action !== 'promote') {
    throw new TypeError(label + ' must be a closed promote-cancellation receipt');
  }
  assertSha256(receipt.transactionId, label + '.transactionId');
  assertSha256(receipt.cancellationId, label + '.cancellationId');
  validatePendingPromotion(receipt.pendingPromotion, state, label + '.pendingPromotion');
  const pending = receipt.pendingPromotion;
  if (pending.phase !== 'retryable' || (pending.action !== undefined && pending.action !== 'promote')
      || pending.transactionId !== receipt.transactionId || !Array.isArray(pending.sourceReleaseIds)
      || pending.expectedActive.runtimeSnapshotBuildId === null) {
    throw new TypeError(label + ' must preserve a retryable promotion journal with a pinned previous runtime');
  }
  const proof = receipt.evidence;
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)
      || Object.keys(proof).sort().join(',') !== 'observedAt,production,schema,workflow'
      || proof.schema !== 'w09-undeployed-promotion-proof/1'
      || typeof proof.observedAt !== 'string' || !Number.isFinite(Date.parse(proof.observedAt))
      || new Date(proof.observedAt).toISOString() !== proof.observedAt) {
    throw new TypeError(label + ' has invalid public no-deployment evidence');
  }
  const workflow = proof.workflow;
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)
      || Object.keys(workflow).sort().join(',') !== 'conclusion,failedStep,failure,headBranch,headSha,jobId,logSha256,promoterSha256,runId,selectedReleaseIds,selectedSha256,workflowPath'
      || !Number.isSafeInteger(workflow.runId) || workflow.runId < 1
      || !Number.isSafeInteger(workflow.jobId) || workflow.jobId < 1
      || workflow.workflowPath !== '.github/workflows/shared-release.yml'
      || workflow.headBranch !== 'main' || !/^[a-f0-9]{40}$/u.test(workflow.headSha)
      || workflow.conclusion !== 'failure' || workflow.failedStep !== 'Promote the selected shared composition'
      || workflow.failure !== 'browser-smoke-official-text-timeout'
      || !Array.isArray(workflow.selectedReleaseIds)
      || ![workflow.selectedSha256, workflow.promoterSha256, workflow.logSha256].every(value => typeof value === 'string' && SHA256_RE.test(value))) {
    throw new TypeError(label + ' has invalid GitHub workflow evidence');
  }
  const selectedIds = [...workflow.selectedReleaseIds].sort();
  const journalSourceIds = [...pending.sourceReleaseIds].sort();
  if (new Set(selectedIds).size !== selectedIds.length || !sameJson(selectedIds, journalSourceIds)) {
    throw new TypeError(label + ' GitHub selected Source releases do not match the preserved journal');
  }
  const production = proof.production;
  if (!production || typeof production !== 'object' || Array.isArray(production)
      || Object.keys(production).sort().join(',') !== 'buildId,dataRevision,gameReleases,observedAt,origin'
      || production.origin !== 'https://darktide.tw-syuan.com'
      || production.observedAt !== proof.observedAt
      || production.buildId !== pending.expectedActive.runtimeSnapshotBuildId
      || !SHA256_RE.test(production.dataRevision) || !Array.isArray(production.gameReleases)
      || !sameJson(production.gameReleases, expectedPublicReleasePointers(state, pending.expectedActive, label + '.production')) ) {
    throw new TypeError(label + ' formal production evidence does not match the pinned previous build and active releases');
  }
  const expectedCancellationId = createHash('sha256').update(JSON.stringify([
    receipt.transactionId, workflow.runId, workflow.logSha256, production.buildId, proof.observedAt,
  ])).digest('hex');
  if (receipt.cancellationId !== expectedCancellationId) throw new TypeError(label + ' cancellationId does not bind its public evidence');
}

export function validateW09ReleaseState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.schema !== STATE_SCHEMA) {
    throw new TypeError('release state must use ' + STATE_SCHEMA);
  }
  if (!Array.isArray(state.reservations) || !Array.isArray(state.activeByGame)) {
    throw new TypeError('release state reservations and activeByGame must be arrays');
  }

  const slots = new Set();
  const releaseIds = new Set();
  const identities = new Map();
  const perVersion = new Map();
  const dataRevisionOwners = new Map();

  for (const record of state.reservations) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('release reservation must be an object');
    }
    parseGameVersion(record.gameVersion);
    assertText(record.gameReleaseId, 'gameReleaseId');
    assertSha256(record.inputDigest, 'inputDigest');
    assertSha256(record.manifestSha256, 'manifestSha256');
    if (record.dataRevision !== undefined) {
      assertSha256(record.dataRevision, 'dataRevision');
      const priorManifest = dataRevisionOwners.get(record.dataRevision);
      if (priorManifest && priorManifest !== record.manifestSha256) {
        throw new TypeError('release state assigns conflicting manifest bytes to the same immutable dataRevision URL');
      }
      dataRevisionOwners.set(record.dataRevision, record.manifestSha256);
    }
    const match = typeof record.contentVersion === 'string' ? SLOT_RE.exec(record.contentVersion) : null;
    if (!match || match[1] !== record.gameVersion || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1) {
      throw new TypeError('contentVersion must be the reserved slot for its gameVersion');
    }
    if (!RELEASE_STATUSES.has(record.status)) {
      throw new TypeError('release reservation has an unknown status');
    }
    if (record.runtimeSnapshotBuildId !== undefined) assertSha256(record.runtimeSnapshotBuildId, 'runtimeSnapshotBuildId');
    const expectedId = expectedReleaseId(record);
    if (record.releaseId !== expectedId) {
      throw new TypeError('releaseId does not match its immutable allocation identity');
    }
    const slotKey = record.gameVersion + '/' + record.contentVersion;
    if (slots.has(slotKey) || releaseIds.has(record.releaseId)) {
      throw new TypeError('release state contains a duplicate slot or releaseId');
    }
    slots.add(slotKey);
    releaseIds.add(record.releaseId);
    const identityKey = record.gameVersion + '/' + record.gameReleaseId + '/' + record.inputDigest;
    if (identities.has(identityKey)) {
      throw new TypeError('release state contains duplicate input identity');
    }
    identities.set(identityKey, record.manifestSha256);
    perVersion.set(record.gameVersion, Math.max(perVersion.get(record.gameVersion) || 0, Number(match[2])));
  }

  for (const [gameVersion, maxSequence] of perVersion) {
    for (let sequence = 1; sequence <= maxSequence; sequence += 1) {
      if (!slots.has(gameVersion + '/' + contentSlot(gameVersion, sequence))) {
        throw new TypeError('release state has a gap in reserved content versions');
      }
    }
  }

  const activeGames = new Set();
  const activeVersions = new Set();
  for (const active of state.activeByGame) {
    if (!active || typeof active !== 'object' || Array.isArray(active)) {
      throw new TypeError('active release pointer must be an object');
    }
    assertText(active.gameReleaseId, 'active gameReleaseId');
    assertText(active.releaseId, 'active releaseId');
    if (activeGames.has(active.gameReleaseId)) {
      throw new TypeError('release state contains duplicate active game pointers');
    }
    const reservation = state.reservations.find(item => item.releaseId === active.releaseId);
    if (!reservation || reservation.gameReleaseId !== active.gameReleaseId || reservation.status !== 'approved') {
      throw new TypeError('active pointer must identify an approved reservation for the same game release');
    }
    if (activeVersions.has(reservation.gameVersion)) throw new TypeError('release state contains duplicate active pointers for one gameVersion');
    activeGames.add(active.gameReleaseId);
    activeVersions.add(reservation.gameVersion);
  }
  const referenceReleaseIds = state.referenceReleaseIds ?? [];
  if (!Array.isArray(referenceReleaseIds) || new Set(referenceReleaseIds).size !== referenceReleaseIds.length) {
    throw new TypeError('release state referenceReleaseIds must be a unique array');
  }
  for (const releaseId of referenceReleaseIds) {
    const reservation = state.reservations.find(item => item.releaseId === releaseId);
    if (!reservation || reservation.status !== 'approved') throw new TypeError('explicit release reference must identify an approved reservation');
  }
  if (state.activeRuntimeSnapshotBuildId !== null && state.activeRuntimeSnapshotBuildId !== undefined) {
    assertSha256(state.activeRuntimeSnapshotBuildId, 'activeRuntimeSnapshotBuildId');
  }
  const approvedRuntimeSnapshots = state.approvedRuntimeSnapshots ?? [];
  if (!Array.isArray(approvedRuntimeSnapshots)) throw new TypeError('release state approvedRuntimeSnapshots must be an array');
  const runtimeSnapshotBuildIds = new Set();
  for (const [index, snapshot] of approvedRuntimeSnapshots.entries()) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
        || Object.keys(snapshot).sort().join(',') !== 'activeByGame,buildId' || !Array.isArray(snapshot.activeByGame)) {
      throw new TypeError('approvedRuntimeSnapshots[' + index + '] is invalid');
    }
    assertSha256(snapshot.buildId, 'approvedRuntimeSnapshots buildId');
    if (runtimeSnapshotBuildIds.has(snapshot.buildId)) throw new TypeError('release state contains a duplicate approved runtime snapshot');
    runtimeSnapshotBuildIds.add(snapshot.buildId);
    validateActiveSnapshotShape({ activeByGame: snapshot.activeByGame, runtimeSnapshotBuildId: snapshot.buildId },
      'approvedRuntimeSnapshots[' + index + ']');
    for (const active of snapshot.activeByGame) {
      const reservation = state.reservations.find(item => item.releaseId === active.releaseId);
      if (!reservation || reservation.gameReleaseId !== active.gameReleaseId || reservation.status !== 'approved') {
        throw new TypeError('approved runtime snapshot must reference approved shared release reservations');
      }
    }
  }
  const publicationReceipts = state.publicationReceipts ?? [];
  if (!Array.isArray(publicationReceipts)) throw new TypeError('release state publicationReceipts must be an array');
  const publicationTransactions = new Set();
  for (const [index, receipt] of publicationReceipts.entries()) {
    const label = 'publicationReceipts[' + index + ']';
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
        || Object.keys(receipt).sort().join(',') !== 'action,activeByGame,artifactManifestSha256,buildId,dataRevision,expectedActive,productionOrigin,releaseIds,schema,status,transactionId'
        || receipt.schema !== 'w09-publication-receipt/1' || receipt.status !== 'verified'
        || !['promote', 'rollback'].includes(receipt.action) || receipt.productionOrigin !== 'https://darktide.tw-syuan.com'
        || !Array.isArray(receipt.releaseIds) || receipt.releaseIds.length === 0
        || !Array.isArray(receipt.activeByGame)) {
      throw new TypeError(label + ' must be a closed verified publication receipt projection');
    }
    assertSha256(receipt.transactionId, label + '.transactionId');
    assertSha256(receipt.buildId, label + '.buildId');
    assertSha256(receipt.dataRevision, label + '.dataRevision');
    assertSha256(receipt.artifactManifestSha256, label + '.artifactManifestSha256');
    if (publicationTransactions.has(receipt.transactionId)) throw new TypeError('release state contains a duplicate publication transaction receipt');
    publicationTransactions.add(receipt.transactionId);
    validateActiveSnapshotShape({ activeByGame: receipt.activeByGame, runtimeSnapshotBuildId: receipt.buildId }, label);
    const canonicalActive = [...receipt.activeByGame]
      .sort((left, right) => left.gameReleaseId.localeCompare(right.gameReleaseId, 'en'));
    if (!sameJson(canonicalActive, receipt.activeByGame)) throw new TypeError(label + '.activeByGame must be sorted by gameReleaseId');
    const canonicalExpected = canonicalActiveSnapshot(receipt.expectedActive);
    if (!sameJson(canonicalExpected, receipt.expectedActive)) throw new TypeError(label + '.expectedActive must be canonical');
    const released = [...receipt.releaseIds].sort();
    if (new Set(released).size !== released.length || !sameJson(released, receipt.releaseIds)) {
      throw new TypeError(label + '.releaseIds must be unique and sorted');
    }
    const releaseRecords = released.map(releaseId => state.reservations.find(row => row.releaseId === releaseId));
    if (releaseRecords.some(record => !record || record.status !== 'approved')) {
      throw new TypeError(label + ' must identify approved Web release reservations');
    }
    const snapshot = approvedRuntimeSnapshots.find(row => row.buildId === receipt.buildId);
    if (!snapshot || !sameJson(snapshot.activeByGame, receipt.activeByGame)) {
      throw new TypeError(label + ' must bind its verified artifact to an approved whole-site runtime snapshot');
    }
    const activeReservations = receipt.activeByGame.map(active => {
      const reservation = state.reservations.find(row => row.releaseId === active.releaseId);
      if (!reservation || reservation.status !== 'approved' || reservation.gameReleaseId !== active.gameReleaseId) {
        throw new TypeError(label + ' active pointers must identify approved reservations');
      }
      return reservation;
    });
    const primaryReservation = [...activeReservations].sort((left, right) => {
      const leftVersion = parseGameVersion(left.gameVersion);
      const rightVersion = parseGameVersion(right.gameVersion);
      return rightVersion[0] - leftVersion[0] || rightVersion[1] - leftVersion[1] || rightVersion[2] - leftVersion[2];
    })[0];
    if (!primaryReservation?.dataRevision || receipt.dataRevision !== primaryReservation.dataRevision) {
      throw new TypeError(label + '.dataRevision must match the highest active gameVersion reservation');
    }
    if (receipt.action === 'rollback') {
      if (!sameJson(released, receipt.activeByGame.map(row => row.releaseId).sort())) {
        throw new TypeError(label + ' rollback IDs must exactly match its full active pointer set');
      }
    } else {
      const expectedPointers = [...receipt.expectedActive.activeByGame];
      for (const reservation of releaseRecords) {
        const retained = expectedPointers.filter(active => {
          const previous = state.reservations.find(row => row.releaseId === active.releaseId);
          return previous && previous.gameVersion !== reservation.gameVersion
            && previous.gameReleaseId !== reservation.gameReleaseId;
        });
        expectedPointers.splice(0, expectedPointers.length, ...retained, {
          gameReleaseId: reservation.gameReleaseId,
          releaseId: reservation.releaseId,
        });
      }
      expectedPointers.sort((left, right) => left.gameReleaseId.localeCompare(right.gameReleaseId, 'en'));
      if (!sameJson(expectedPointers, receipt.activeByGame)) {
        throw new TypeError(label + ' active pointers do not match the approved transaction result');
      }
    }
    const expectedTransactionId = createHash('sha256').update(JSON.stringify(
      receipt.action === 'rollback'
        ? ['rollback', released, canonicalExpected, receipt.buildId, receipt.artifactManifestSha256]
        : [released, canonicalExpected, receipt.buildId, receipt.artifactManifestSha256],
    )).digest('hex');
    if (expectedTransactionId !== receipt.transactionId) {
      throw new TypeError(label + ' transactionId does not bind its immutable artifact and pointer snapshots');
    }
  }
  if (state.pendingPromotion !== null && state.pendingPromotion !== undefined) {
    validatePendingPromotion(state.pendingPromotion, state, 'pendingPromotion');
  }
  const promotionCancellations = state.promotionCancellations ?? [];
  if (!Array.isArray(promotionCancellations)) throw new TypeError('release state promotionCancellations must be an array');
  const cancellationIds = new Set();
  for (const [index, cancellation] of promotionCancellations.entries()) {
    const label = 'promotionCancellations[' + index + ']';
    validatePromotionCancellation(cancellation, state, label);
    if (cancellationIds.has(cancellation.cancellationId)) throw new TypeError('release state contains a duplicate promotion cancellation');
    cancellationIds.add(cancellation.cancellationId);
  }
  return true;
}

export function planW09ContentVersion(state, input) {
  validateW09ReleaseState(state);
  const identity = validateW09AllocationIdentity(input);
  const { gameVersion } = identity;
  assertSha256(input.manifestSha256, 'manifestSha256');
  const sameIdentity = state.reservations.find(record =>
    record.gameVersion === identity.gameVersion
      && record.gameReleaseId === identity.gameReleaseId
      && record.inputDigest === identity.inputDigest);
  if (sameIdentity) {
    if (sameIdentity.manifestSha256 !== input.manifestSha256
        || (identity.dataRevision !== undefined && sameIdentity.dataRevision !== identity.dataRevision)) {
      throw new Error('manifest hash conflict for the same immutable release input');
    }
    return structuredClone(sameIdentity);
  }

  const { contentVersion } = findW09ContentVersionSlot(state, identity);
  const allocation = {
    ...identity,
    manifestSha256: input.manifestSha256,
    ...(input.dataRevision ? { dataRevision: input.dataRevision } : {}),
    contentVersion,
    releaseId: expectedReleaseId({ ...input, gameVersion, contentVersion }),
    status: 'reserved',
  };
  return allocation;
}

function validateW09AllocationIdentity(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('allocation input must be an object');
  }
  parseGameVersion(input.gameVersion);
  assertText(input.gameReleaseId, 'gameReleaseId');
  assertSha256(input.inputDigest, 'inputDigest');
  if (input.dataRevision !== undefined) assertSha256(input.dataRevision, 'dataRevision');
  return {
    gameVersion: input.gameVersion,
    gameReleaseId: input.gameReleaseId,
    inputDigest: input.inputDigest,
    ...(input.dataRevision !== undefined ? { dataRevision: input.dataRevision } : {}),
  };
}

export function findW09ContentVersionSlot(state, input) {
  validateW09ReleaseState(state);
  const identity = validateW09AllocationIdentity(input);
  const existing = state.reservations.find(record =>
    record.gameVersion === identity.gameVersion
      && record.gameReleaseId === identity.gameReleaseId
      && record.inputDigest === identity.inputDigest);
  if (existing) return { contentVersion: existing.contentVersion, priorReservation: structuredClone(existing) };
  const maxSequence = state.reservations.reduce((max, record) => {
    if (record.gameVersion !== identity.gameVersion) return max;
    const match = SLOT_RE.exec(record.contentVersion);
    return Math.max(max, Number(match[2]));
  }, 0);
  return { contentVersion: contentSlot(identity.gameVersion, maxSequence + 1), priorReservation: null };
}

export async function planW09CandidateAllocation(state, identity, buildCandidate) {
  validateW09ReleaseState(state);
  validateW09AllocationIdentity(identity);
  if (typeof buildCandidate !== 'function') throw new TypeError('buildCandidate must construct a manifest for the selected contentVersion');
  const { contentVersion } = findW09ContentVersionSlot(state, identity);
  const candidate = await buildCandidate(contentVersion);
  if (!candidate || typeof candidate !== 'object' || !candidate.manifest || !Buffer.isBuffer(candidate.manifestBytes)) {
    throw new TypeError('buildCandidate must return a candidate with manifest and raw manifestBytes');
  }
  if (candidate.manifest.contentVersion !== contentVersion) throw new Error('candidate manifest was not built for its exact reserved contentVersion');
  const manifestSha256 = createHash('sha256').update(candidate.manifestBytes).digest('hex');
  const allocation = planW09ContentVersion(state, { ...identity, manifestSha256 });
  if (allocation.contentVersion !== contentVersion) throw new Error('release state changed while preparing the contentVersion slot');
  return { candidate, allocation, contentVersion, manifestSha256 };
}

export function reserveW09ContentVersion(state, allocation) {
  validateW09ReleaseState(state);
  if (!allocation || typeof allocation !== 'object' || Array.isArray(allocation)) {
    throw new TypeError('allocation must be an object');
  }
  const planned = planW09ContentVersion(state, allocation);
  if (planned.releaseId !== allocation.releaseId
      || planned.contentVersion !== allocation.contentVersion
      || planned.manifestSha256 !== allocation.manifestSha256) {
    throw new Error('allocation is stale or conflicts with the current release state');
  }
  const existing = state.reservations.find(record => record.releaseId === planned.releaseId);
  if (existing) {
    const next = structuredClone(state);
    const record = next.reservations.find(item => item.releaseId === planned.releaseId);
    if (record.status === 'failed') {
      record.status = 'reserved';
      delete record.failureReason;
    }
    validateW09ReleaseState(next);
    return next;
  }
  const next = structuredClone(state);
  next.reservations.push({ ...planned, status: 'reserved' });
  validateW09ReleaseState(next);
  return next;
}

export function markW09ReleaseFailed(state, releaseId, reason) {
  validateW09ReleaseState(state);
  assertText(releaseId, 'releaseId');
  assertText(reason, 'failure reason');
  const next = structuredClone(state);
  const record = next.reservations.find(item => item.releaseId === releaseId);
  if (!record) throw new Error('cannot fail an unknown reserved release');
  if (record.status === 'approved') throw new Error('an approved release cannot be marked failed');
  if (record.status !== 'failed') {
    record.status = 'failed';
    record.failureReason = reason.slice(0, 500);
  } else if (record.failureReason !== reason.slice(0, 500)) {
    throw new Error('failed reservation reason conflicts with its existing record');
  }
  validateW09ReleaseState(next);
  return next;
}

export async function readW09ReleaseState(statePath) {
  assertText(statePath, 'statePath');
  try {
    const raw = await readFile(statePath);
    const state = JSON.parse(raw.toString('utf8'));
    validateW09ReleaseState(state);
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return createW09ReleaseState();
    throw error;
  }
}

export async function writeW09ReleaseStateAtomic(statePath, state) {
  assertText(statePath, 'statePath');
  validateW09ReleaseState(state);
  const absolute = path.resolve(statePath);
  const directory = path.dirname(absolute);
  await mkdir(directory, { recursive: true });
  let cursor = path.parse(absolute).root;
  for (const segment of path.relative(cursor, directory).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error('release state path may not traverse a symlink');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  try {
    if ((await lstat(absolute)).isSymbolicLink()) throw new Error('release state file may not be a symlink');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temp = path.join(directory, '.' + path.basename(absolute) + '.' + randomUUID() + '.tmp');
  const bytes = Buffer.from(JSON.stringify(state, null, 2) + '\n', 'utf8');
  await writeFile(temp, bytes, { flag: 'wx' });
  try {
    await rename(temp, absolute);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return absolute;
}

function parseSlot(record) {
  const match = SLOT_RE.exec(record.contentVersion);
  if (!match || match[1] !== record.gameVersion) {
    throw new TypeError('release has an invalid contentVersion');
  }
  return Number(match[2]);
}

export function selectW09RetainedReleases(releases, {
  activeReleaseIds = [],
  explicitReferenceIds = [],
  perGameVersionLimit = 3,
} = {}) {
  if (!Array.isArray(releases)) throw new TypeError('releases must be an array');
  if (!Number.isSafeInteger(perGameVersionLimit) || perGameVersionLimit < 1) {
    throw new TypeError('perGameVersionLimit must be a positive safe integer');
  }
  const byId = new Map();
  for (const release of releases) {
    if (!release || typeof release !== 'object' || Array.isArray(release)) {
      throw new TypeError('release entry must be an object');
    }
    assertText(release.releaseId, 'releaseId');
    parseGameVersion(release.gameVersion);
    parseSlot(release);
    if (byId.has(release.releaseId)) throw new TypeError('release list contains duplicate releaseId');
    byId.set(release.releaseId, release);
  }

  const referenced = new Set([...activeReleaseIds, ...explicitReferenceIds]);
  for (const releaseId of referenced) {
    assertText(releaseId, 'referenced releaseId');
    if (!byId.has(releaseId)) throw new Error('retention reference points to an unknown release: ' + releaseId);
    if (byId.get(releaseId).status !== 'approved') throw new Error('retention reference must point to an approved release: ' + releaseId);
  }

  const keep = new Set(referenced);
  const approvedByGame = new Map();
  for (const release of byId.values()) {
    if (release.status !== 'approved') continue;
    const group = approvedByGame.get(release.gameVersion) || [];
    group.push(release);
    approvedByGame.set(release.gameVersion, group);
  }
  for (const group of approvedByGame.values()) {
    group.sort((left, right) => parseSlot(right) - parseSlot(left) || left.releaseId.localeCompare(right.releaseId));
    for (const release of group.slice(0, perGameVersionLimit)) keep.add(release.releaseId);
  }

  return [...keep].sort((leftId, rightId) => {
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    const patchCompare = left.gameVersion.localeCompare(right.gameVersion, undefined, { numeric: true });
    return patchCompare || parseSlot(left) - parseSlot(right) || leftId.localeCompare(rightId);
  });
}

export async function withW09PublicationLock({
  lockPath,
  run,
  retryDelayMs = 100,
  timeoutMs = 30_000,
} = {}) {
  assertText(lockPath, 'lockPath');
  if (typeof run !== 'function') throw new TypeError('run must be a function');
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1) throw new TypeError('retryDelayMs must be positive');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < retryDelayMs) throw new TypeError('timeoutMs must be at least retryDelayMs');

  await mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  const token = randomUUID();
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ schema: 'w09-publication-lock/1', token, pid: process.pid }));
      await handle.sync();
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
        handle = undefined;
      }
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error('timed out waiting for the W09 publication lock');
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(retryDelayMs, timeoutMs - (Date.now() - startedAt))));
    }
  }

  try {
    return await run();
  } finally {
    await handle.close();
    try {
      const contents = JSON.parse(await readFile(lockPath, 'utf8'));
      if (contents.token === token) await unlink(lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export async function prepareW09SharedRelease(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('release preparation options must be an object');
  }
  assertW09DurableStateCapability(options);
  if (typeof options.releaseId !== 'string' || !/^w09-[a-f0-9]{32}$/u.test(options.releaseId)) {
    throw new Error('releaseId must be selected from a verified W09 Source archive');
  }
  if (typeof options.repoRoot !== 'string' || typeof options.sourceRoot !== 'string') {
    throw new Error('explicit Web repoRoot and official Source sourceRoot are required');
  }
  if (options.publicationEligible === true || options.sourceBuild?.publicationEligible === true
      || options.sourceBuild?.buildIdentityVerified === true || options.inputsLock || options.sourceRequest || options.sourceArchiveBytes) {
    throw new Error('caller-supplied readiness flags, request, packet, or lock are not accepted by the formal release entry');
  }

  const repoRoot = path.resolve(options.repoRoot);
  const contextOptions = { ...options, repoRoot };
  const compositionContext = await resolveW09CompositionContext(contextOptions);
  const dryRun = options.dryRun === true;
  const firstPass = await compositionContext.loadW09VerifiedComposition({
    repoRoot: compositionContext.compositionRoot,
    sourceRoot: options.sourceRoot,
    releaseId: options.releaseId,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  await revalidateW09CompositionContext(contextOptions, compositionContext, 'preflight replay');
  if (firstPass.status !== 'verified') return firstPass;
  if (firstPass.gate.status !== 'ready-for-release-allocation') {
    return { status: 'blocked', releaseId: options.releaseId, inputDigest: firstPass.inputDigest, gate: firstPass.gate };
  }

  const statePath = path.join(repoRoot, 'content/contracts/w09/release-state.json');
  if (dryRun) {
    const state = await readW09ReleaseState(statePath);
    const identity = {
      gameVersion: firstPass.candidate.manifest.gameVersion,
      gameReleaseId: firstPass.candidate.manifest.gameReleaseId,
      inputDigest: firstPass.inputDigest,
      dataRevision: firstPass.candidate.manifest.dataRevision,
    };
    const { contentVersion } = findW09ContentVersionSlot(state, identity);
    const candidate = await finalizeW09Candidate(firstPass.candidate, contentVersion, {
      compositionContext,
      composition: firstPass,
    });
    const manifestSha256 = createHash('sha256').update(candidate.manifestBytes).digest('hex');
    const planned = planW09ContentVersion(state, { ...identity, manifestSha256 });
    if (planned.contentVersion !== contentVersion) throw new Error('dry-run candidate version differs from the current durable allocation plan');
    return {
      status: 'dry-run-ready',
      releaseId: planned.releaseId,
      gameReleaseId: planned.gameReleaseId,
      gameVersion: planned.gameVersion,
      contentVersion,
      inputDigest: firstPass.inputDigest,
      manifestSha256,
      gate: firstPass.gate,
      allocationReserved: false,
      packageWritten: false,
    };
  }

  const branch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current'], { encoding: 'utf8', windowsHide: true }).trim();
  const workflowRef = process.env.GITHUB_REF ?? '';
  if (branch !== 'main' && workflowRef !== 'refs/heads/main') {
    throw new Error('formal W09 allocation is restricted to the reviewed Web main branch');
  }

  const publicationLockPath = path.join(repoRoot, 'content/contracts/w09/publication.lock');
  const runLocked = async () => {
      const composition = await compositionContext.loadW09VerifiedComposition({
        repoRoot: compositionContext.compositionRoot,
        sourceRoot: options.sourceRoot,
        releaseId: options.releaseId,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
      if (composition.status !== 'verified') return composition;
      if (composition.gate.status !== 'ready-for-release-allocation') {
        return { status: 'blocked', releaseId: options.releaseId, inputDigest: composition.inputDigest, gate: composition.gate };
      }
      await revalidateW09CompositionContext(contextOptions, compositionContext, 'serialized allocation replay');
      if (composition.inputDigest !== firstPass.inputDigest || composition.repositoryHead !== firstPass.repositoryHead) {
        throw new Error('W09 composition inputs changed between the preflight and serialized allocation');
      }

      const state = await readW09ReleaseState(statePath);
      const identity = {
        gameVersion: composition.candidate.manifest.gameVersion,
        gameReleaseId: composition.candidate.manifest.gameReleaseId,
        inputDigest: composition.inputDigest,
        dataRevision: composition.candidate.manifest.dataRevision,
      };
      const planned = await planW09CandidateAllocation(state, identity, contentVersion => finalizeW09Candidate(composition.candidate, contentVersion, {
        compositionContext,
        composition,
      }));
      const nextState = reserveW09ContentVersion(state, planned.allocation);
      await writeW09ReleaseStateAtomic(statePath, nextState);
      await persistW09DurableCheckpoint(options, repoRoot, statePath, 'reserved');

      const candidateEnvelope = {
        schema: 'w09-prepared-shared-release/1',
        candidateOnly: true,
        fixtureOnly: false,
        publicationEligible: false,
        releaseId: planned.allocation.releaseId,
        inputDigest: composition.inputDigest,
        gameReleaseId: planned.allocation.gameReleaseId,
        gameVersion: planned.allocation.gameVersion,
        contentVersion: planned.contentVersion,
        manifest: {
          path: composition.candidate.envelope.manifest.path,
          sha256: planned.manifestSha256,
          dataRevision: composition.candidate.manifest.dataRevision,
        },
        source: composition.verifiedSource,
        web: {
          inputLockPath: composition.lockPath,
          inputLockSha256: composition.inputLockSha256,
          compilerCommit: composition.inputLock.web.compilerCommit,
          compilerFileSetSha256: composition.inputLock.web.compilerFileSetSha256,
          w09CompilerLockSha256: composition.inputLock.web.w09CompilerLockSha256,
          w08CompilerCommit: composition.inputLock.web.w08CompilerCommit,
          authoringCommit: composition.inputLock.web.authoringCommit,
        },
        gate: composition.gate,
        review: composition.candidate.envelope.review,
      };
      const sourceLock = {
        schema: 'w09-verified-source-lock/1',
        repository: 'https://github.com/SyuanTsai/DarkTide-Source-Data',
        ...composition.verifiedSource,
      };
      const dataRoot = 'data/' + planned.candidate.manifest.dataRevision + '/';
      const packageFiles = new Map([
        ['candidate.json', Buffer.from(JSON.stringify(sortJson(candidateEnvelope), null, 2) + '\n', 'utf8')],
        ['source-lock.json', Buffer.from(JSON.stringify(sortJson(sourceLock), null, 2) + '\n', 'utf8')],
        ['web-input-lock.json', composition.inputLockBytes],
        [composition.candidate.envelope.manifest.path.slice(1), planned.candidate.manifestBytes],
        ...[...planned.candidate.files].map(([relativePath, bytes]) => [dataRoot + relativePath, bytes]),
      ]);
      const packageRoot = path.join(repoRoot, 'content/contracts/w09/prepared', planned.allocation.releaseId);
      try {
        await writeW09PreparedPackage(packageRoot, packageFiles);
        const latestState = await readW09ReleaseState(statePath);
        const preparedState = structuredClone(latestState);
        const record = preparedState.reservations.find(row => row.releaseId === planned.allocation.releaseId);
        if (!record) throw new Error('reserved W09 release disappeared before package completion');
        if (record.status === 'reserved') record.status = 'prepared';
        validateW09ReleaseState(preparedState);
        await writeW09ReleaseStateAtomic(statePath, preparedState);
        await persistW09DurableCheckpoint(options, repoRoot, statePath, 'prepared');
      } catch (error) {
        const latestState = await readW09ReleaseState(statePath);
        const reservation = latestState.reservations.find(row => row.releaseId === planned.allocation.releaseId);
        if (reservation && ['reserved', 'prepared'].includes(reservation.status)) {
          const failedState = markW09ReleaseFailed(latestState, planned.allocation.releaseId, 'prepared package write failed: ' + error.message);
          await writeW09ReleaseStateAtomic(statePath, failedState);
          await persistW09DurableCheckpoint(options, repoRoot, statePath, 'failed');
        }
        throw error;
      }
      return {
        status: 'prepared',
        releaseId: planned.allocation.releaseId,
        gameReleaseId: planned.allocation.gameReleaseId,
        contentVersion: planned.contentVersion,
        inputDigest: composition.inputDigest,
        manifestSha256: planned.manifestSha256,
        dataRevision: planned.candidate.manifest.dataRevision,
        packageRoot,
        gate: composition.gate,
        allocationReserved: true,
        packageWritten: true,
      };
  };
  if (options[INTERNAL_PUBLICATION_LOCK] === true) return runLocked();
  return withW09PublicationLock({ lockPath: publicationLockPath, run: runLocked });
}

export function currentW09ActiveSnapshot(state) {
  validateW09ReleaseState(state);
  const snapshot = {
    activeByGame: state.activeByGame.map(row => ({ gameReleaseId: row.gameReleaseId, releaseId: row.releaseId }))
      .sort((left, right) => left.gameReleaseId.localeCompare(right.gameReleaseId, 'en')),
    runtimeSnapshotBuildId: state.activeRuntimeSnapshotBuildId ?? null,
  };
  if (snapshot.activeByGame.length > 0) {
    const approved = (state.approvedRuntimeSnapshots ?? []).find(row => row.buildId === snapshot.runtimeSnapshotBuildId);
    if (!approved || !sameJson(approved.activeByGame, snapshot.activeByGame)) {
      throw new Error('active W09 pointers do not match their approved whole-site runtime snapshot');
    }
  } else if (snapshot.runtimeSnapshotBuildId !== null) {
    throw new Error('empty W09 active pointers may not retain a whole-site runtime build identity');
  }
  return snapshot;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function recordApprovedRuntimeSnapshot(state, buildId, activeByGame) {
  const rows = [...activeByGame].map(row => ({ gameReleaseId: row.gameReleaseId, releaseId: row.releaseId }))
    .sort((left, right) => left.gameReleaseId.localeCompare(right.gameReleaseId, 'en'));
  state.approvedRuntimeSnapshots ??= [];
  const prior = state.approvedRuntimeSnapshots.find(item => item.buildId === buildId);
  if (prior) {
    if (!sameJson(prior.activeByGame, rows)) throw new Error('one immutable whole-site build identity cannot map to conflicting active pointers');
    return;
  }
  state.approvedRuntimeSnapshots.push({ buildId, activeByGame: rows });
  state.approvedRuntimeSnapshots.sort((left, right) => left.buildId.localeCompare(right.buildId, 'en'));
}

function appendW09PublicationReceipt(state, receipt) {
  state.publicationReceipts ??= [];
  const prior = state.publicationReceipts.find(row => row.transactionId === receipt.transactionId);
  if (prior) {
    if (!sameJson(prior, receipt)) throw new Error('one W09 transaction cannot have conflicting verified publication receipts');
    return;
  }
  state.publicationReceipts.push(receipt);
  state.publicationReceipts.sort((left, right) => left.transactionId.localeCompare(right.transactionId, 'en'));
}

function createW09PublicationReceiptProjection({ receipt, action, pendingPromotion, activeByGame }) {
  if (!receipt || receipt.status !== 'verified'
      || receipt.build_id !== pendingPromotion.buildId
      || receipt.data_revision !== pendingPromotion.dataRevision
      || receipt.production_origin !== 'https://darktide.tw-syuan.com') {
    throw new Error('publication callback did not return an origin-verified receipt for the exact static artifact');
  }
  const projection = {
    schema: 'w09-publication-receipt/1',
    status: 'verified',
    action,
    transactionId: pendingPromotion.transactionId,
    releaseIds: [...pendingPromotion.releaseIds].sort(),
    expectedActive: canonicalActiveSnapshot(pendingPromotion.expectedActive),
    buildId: pendingPromotion.buildId,
    dataRevision: pendingPromotion.dataRevision,
    artifactManifestSha256: pendingPromotion.artifactManifestSha256,
    productionOrigin: 'https://darktide.tw-syuan.com',
    activeByGame: [...activeByGame]
      .map(row => ({ gameReleaseId: row.gameReleaseId, releaseId: row.releaseId }))
      .sort((left, right) => left.gameReleaseId.localeCompare(right.gameReleaseId, 'en')),
  };
  return projection;
}

async function saveVerifiedRuntimeSnapshot(repoRoot, distPath, expectedBuildId) {
  assertSha256(expectedBuildId, 'runtime snapshot buildId');
  const { verifyStaticPackage } = await import('../../src/static/verify.mjs');
  const verified = await verifyStaticPackage(distPath);
  if (verified.package_kind !== 'published' || verified.build_id !== expectedBuildId) {
    throw new Error('runtime snapshot source must be the exact verified published artifact');
  }
  const entries = await collectPackageEntries(distPath);
  const files = new Map();
  for (const entry of entries) {
    if (!entry.endsWith('\0file')) continue;
    const relative = entry.slice(0, -'\0file'.length);
    files.set(relative, await readFile(path.join(distPath, ...relative.split('/'))));
  }
  const archiveBytes = encodeW09RuntimeSnapshotArchive(expectedBuildId, files);
  const snapshotPath = path.join(repoRoot, 'content/contracts/w09/runtime-snapshots', expectedBuildId);
  await writeW09PreparedPackage(snapshotPath, new Map([['snapshot.json.gz', archiveBytes]]));
  const roundTripPath = await materializeW09RuntimeSnapshotArchive(archiveBytes, expectedBuildId);
  try {
    const snapshot = await verifyStaticPackage(roundTripPath);
    if (snapshot.package_kind !== 'published' || snapshot.build_id !== expectedBuildId) {
      throw new Error('durable W09 runtime snapshot failed exact package verification');
    }
  } finally {
    await rm(roundTripPath, { recursive: true, force: true });
  }
  return {
    buildId: expectedBuildId,
    path: path.join(snapshotPath, 'snapshot.json.gz'),
    archiveSha256: createHash('sha256').update(archiveBytes).digest('hex'),
    dataRevision: verified.runtime_data_revision ?? verified.data_revision,
  };
}

async function loadVerifiedRuntimeSnapshot(repoRoot, buildId) {
  assertSha256(buildId, 'runtime snapshot buildId');
  const snapshotPath = path.join(repoRoot, 'content/contracts/w09/runtime-snapshots', buildId);
  const archivePath = path.join(snapshotPath, 'snapshot.json.gz');
  const archiveInfo = await lstat(archivePath);
  if (archiveInfo.isSymbolicLink() || !archiveInfo.isFile()) throw new Error('approved W09 runtime snapshot archive must be a regular file');
  const archiveBytes = await readFile(archivePath);
  const runtimeRoot = await materializeW09RuntimeSnapshotArchive(archiveBytes, buildId);
  const { verifyStaticPackage } = await import('../../src/static/verify.mjs');
  try {
    const snapshot = await verifyStaticPackage(runtimeRoot);
    if (snapshot.package_kind !== 'published' || snapshot.build_id !== buildId) {
      throw new Error('approved W09 runtime snapshot does not match its immutable build identity');
    }
    const artifactManifestBytes = await readFile(path.join(runtimeRoot, 'artifact-manifest.json'));
    const archive = parseRuntimeSnapshotArchive(archiveBytes, buildId);
    if (createHash('sha256').update(artifactManifestBytes).digest('hex') !== archive.artifactManifestSha256) {
      throw new Error('approved W09 runtime snapshot artifact manifest differs from its archive pin');
    }
  } catch (error) {
    await rm(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    path: runtimeRoot,
    archiveSha256: createHash('sha256').update(archiveBytes).digest('hex'),
    cleanup: () => rm(runtimeRoot, { recursive: true, force: true }),
  };
}

export function encodeW09RuntimeSnapshotArchive(buildId, files) {
  assertSha256(buildId, 'runtime snapshot buildId');
  if (!(files instanceof Map)) throw new TypeError('runtime snapshot files must be a Map');
  const rows = [...files].map(([relative, value]) => {
    if (!isSafeRuntimeSnapshotPath(relative)) {
      throw new TypeError('runtime snapshot contains an unsafe file path');
    }
    const bytes = Buffer.from(value);
    return { path: relative, sizeBytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') };
  }).sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const artifactManifest = rows.find(row => row.path === 'artifact-manifest.json');
  if (!artifactManifest) throw new TypeError('runtime snapshot must include artifact-manifest.json');
  const archive = {
    schema: 'w09-runtime-snapshot/1',
    buildId,
    artifactManifestSha256: artifactManifest.sha256,
    files: rows,
  };
  const canonicalBytes = Buffer.from(JSON.stringify(sortJson(archive), null, 2) + '\n', 'utf8');
  const archiveBytes = gzipSync(canonicalBytes, { level: 9, mtime: 0 });
  parseRuntimeSnapshotArchive(archiveBytes, buildId);
  return archiveBytes;
}

function isCanonicalRuntimeSnapshotBase64(value) {
  if (typeof value !== 'string' || value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const payloadLength = value.length - padding;
  if ((padding === 2 && payloadLength % 4 !== 2)
      || (padding === 1 && payloadLength % 4 !== 3)
      || (padding === 0 && payloadLength % 4 !== 0)) return false;
  let finalSextet = -1;
  for (let index = 0; index < payloadLength; index += 1) {
    const code = value.charCodeAt(index);
    let sextet = -1;
    if (code >= 65 && code <= 90) sextet = code - 65;
    else if (code >= 97 && code <= 122) sextet = code - 71;
    else if (code >= 48 && code <= 57) sextet = code + 4;
    else if (code === 43) sextet = 62;
    else if (code === 47) sextet = 63;
    if (sextet < 0) return false;
    finalSextet = sextet;
  }
  if ((padding === 2 && (finalSextet & 0x0f) !== 0)
      || (padding === 1 && (finalSextet & 0x03) !== 0)) return false;
  return true;
}

function parseRuntimeSnapshotArchive(archiveBytes, expectedBuildId) {
  let archive;
  let decoded;
  try {
    decoded = gunzipSync(archiveBytes, { maxOutputLength: 128 * 1024 * 1024 });
    archive = JSON.parse(decoded.toString('utf8'));
  } catch (error) {
    throw new Error('approved W09 runtime snapshot archive is not valid bounded gzip JSON', { cause: error });
  }
  if (!archive || typeof archive !== 'object' || Array.isArray(archive)
      || archive.schema !== 'w09-runtime-snapshot/1' || archive.buildId !== expectedBuildId
      || !SHA256_RE.test(archive.artifactManifestSha256) || !Array.isArray(archive.files)
      || decoded.toString('utf8') !== JSON.stringify(sortJson(archive), null, 2) + '\n') {
    throw new Error('approved W09 runtime snapshot archive has an invalid or noncanonical envelope');
  }
  const expectedKeys = ['artifactManifestSha256', 'buildId', 'files', 'schema'];
  if (JSON.stringify(Object.keys(archive).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error('approved W09 runtime snapshot archive contains unknown envelope fields');
  }
  let previousPath = '';
  const seen = new Set();
  for (const row of archive.files) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
        || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(['base64', 'path', 'sha256', 'sizeBytes'])) {
      throw new Error('approved W09 runtime snapshot archive contains a malformed file row');
    }
    if (!isSafeRuntimeSnapshotPath(row.path)
        || (previousPath && Buffer.compare(Buffer.from(previousPath), Buffer.from(row.path)) >= 0)
        || seen.has(row.path)) {
      throw new Error('approved W09 runtime snapshot archive contains an unsafe or unsorted path');
    }
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0 || !SHA256_RE.test(row.sha256)
        || typeof row.base64 !== 'string' || row.base64.length !== Math.ceil(row.sizeBytes / 3) * 4
        || !isCanonicalRuntimeSnapshotBase64(row.base64)) {
      throw new Error('approved W09 runtime snapshot archive contains invalid file metadata');
    }
    const bytes = Buffer.from(row.base64, 'base64');
    if (bytes.byteLength !== row.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
      throw new Error('approved W09 runtime snapshot archive file bytes do not match their immutable hashes');
    }
    previousPath = row.path;
    seen.add(row.path);
  }
  if (!seen.has('artifact-manifest.json')
      || archive.files.find(row => row.path === 'artifact-manifest.json').sha256 !== archive.artifactManifestSha256) {
    throw new Error('approved W09 runtime snapshot archive does not pin its artifact manifest');
  }
  return archive;
}

export async function materializeW09RuntimeSnapshotArchive(archiveBytes, expectedBuildId) {
  const archive = parseRuntimeSnapshotArchive(archiveBytes, expectedBuildId);
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'w09-runtime-'));
  const resolvedRoot = path.resolve(runtimeRoot);
  try {
    for (const row of archive.files) {
      const bytes = Buffer.from(row.base64, 'base64');
      const destination = path.resolve(resolvedRoot, ...row.path.split('/'));
      const relativeDestination = path.relative(resolvedRoot, destination);
      if (!relativeDestination || relativeDestination === '..' || relativeDestination.startsWith('..' + path.sep)
          || path.isAbsolute(relativeDestination)) {
        throw new Error('approved W09 runtime snapshot path escapes its generated root');
      }
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: 'wx' });
    }
    return runtimeRoot;
  } catch (error) {
    await rm(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}

function isSafeRuntimeSnapshotPath(value) {
  try {
    safeRelativePath(value, 'runtime snapshot path');
    return true;
  } catch {
    return false;
  }
}

async function readPreparedSharedRelease(repoRoot, reservation) {
  if (!['prepared', 'approved'].includes(reservation.status)) {
    throw new Error('only immutable prepared or approved W09 packages can enter the static release bundle');
  }
  const packageRoot = path.join(repoRoot, 'content/contracts/w09/prepared', reservation.releaseId);
  const rootInfo = await lstat(packageRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('prepared W09 package root must be a regular directory');
  const candidate = JSON.parse((await readFile(path.join(packageRoot, 'candidate.json'), 'utf8')));
  if (candidate.schema !== 'w09-prepared-shared-release/1' || candidate.candidateOnly !== true
      || candidate.publicationEligible !== false || candidate.releaseId !== reservation.releaseId
      || candidate.inputDigest !== reservation.inputDigest || candidate.gameReleaseId !== reservation.gameReleaseId
      || candidate.gameVersion !== reservation.gameVersion || candidate.contentVersion !== reservation.contentVersion) {
    throw new Error('prepared W09 envelope does not match its immutable release reservation');
  }
  const manifestPath = candidate.manifest?.path;
  if (typeof manifestPath !== 'string' || !manifestPath.startsWith('/data/')) throw new Error('prepared W09 envelope has no canonical manifest URL');
  const relativeManifestPath = manifestPath.slice(1);
  const manifestBytes = await readFile(path.join(packageRoot, ...relativeManifestPath.split('/')));
  if (createHash('sha256').update(manifestBytes).digest('hex') !== reservation.manifestSha256
      || candidate.manifest.sha256 !== reservation.manifestSha256) {
    throw new Error('prepared W09 manifest bytes differ from the reserved immutable hash');
  }
  const { validateManifest } = await import('./contract-release.mjs');
  const manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')));
  if (manifest.gameReleaseId !== reservation.gameReleaseId || manifest.gameVersion !== reservation.gameVersion
      || manifest.contentVersion !== reservation.contentVersion || manifest.dataRevision !== candidate.manifest.dataRevision
      || (reservation.dataRevision && manifest.dataRevision !== reservation.dataRevision)) {
    throw new Error('prepared W09 manifest identity differs from its reserved release');
  }
  const files = new Map([[relativeManifestPath, Buffer.from(manifestBytes)]]);
  const expectedPaths = new Set([relativeManifestPath]);
  for (const row of manifest.files) {
    const relativePath = 'data/' + manifest.dataRevision + '/' + row.path;
    const absolutePath = path.join(packageRoot, ...relativePath.split('/'));
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('prepared W09 domain file must be a regular file: ' + relativePath);
    const bytes = await readFile(absolutePath);
    if (bytes.byteLength !== row.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
      throw new Error('prepared W09 domain bytes differ from their manifest: ' + row.path);
    }
    files.set(relativePath, bytes);
    expectedPaths.add(relativePath);
  }
  const entries = await collectPackageEntries(packageRoot);
  for (const entry of entries) {
    if (entry.endsWith('\0file')) {
      const relative = entry.slice(0, -'\0file'.length);
      if (relative.startsWith('data/') && !expectedPaths.has(relative)) {
        throw new Error('prepared W09 package has an unreferenced data file: ' + relative);
      }
    }
  }
  return {
    pointer: {
      game_version: manifest.gameVersion,
      content_version: manifest.contentVersion,
      data_revision: manifest.dataRevision,
      manifest_path: manifestPath,
      manifest_sha256: reservation.manifestSha256,
    },
    manifest,
    files,
  };
}

async function buildSharedBundleFromState(repoRoot, state, { candidateReleaseIds = [] } = {}) {
  validateW09ReleaseState(state);
  const simulated = structuredClone(state);
  const byId = new Map(simulated.reservations.map(row => [row.releaseId, row]));
  for (const releaseId of candidateReleaseIds) {
    const reservation = byId.get(releaseId);
    if (!reservation || !['prepared', 'approved'].includes(reservation.status)) {
      throw new Error('shared bundle candidate is not a prepared W09 reservation: ' + releaseId);
    }
    reservation.status = 'approved';
  }
  const retainedIds = selectW09RetainedReleases(simulated.reservations, {
    activeReleaseIds: simulated.activeByGame.map(row => row.releaseId),
    explicitReferenceIds: simulated.referenceReleaseIds ?? [],
  });
  const pointers = new Map();
  const files = new Map();
  for (const releaseId of retainedIds) {
    const reservation = byId.get(releaseId);
    const loaded = await readPreparedSharedRelease(repoRoot, reservation);
    const prior = pointers.get(loaded.pointer.manifest_path);
    if (prior && JSON.stringify(prior) !== JSON.stringify(loaded.pointer)) {
      throw new Error('retained W09 releases conflict at an immutable manifest URL');
    }
    pointers.set(loaded.pointer.manifest_path, loaded.pointer);
    for (const [relativePath, bytes] of loaded.files) {
      const previous = files.get(relativePath);
      if (previous && !previous.equals(bytes)) throw new Error('retained W09 release packages conflict at an immutable URL: ' + relativePath);
      files.set(relativePath, Buffer.from(bytes));
    }
    const sourceLockFile = createW09PublicSourceLockFile(loaded.manifest);
    const priorSourceLock = files.get(sourceLockFile.relativePath);
    if (priorSourceLock && !priorSourceLock.equals(sourceLockFile.bytes)) {
      throw new Error('retained W09 Source lock conflicts at an immutable public path');
    }
    files.set(sourceLockFile.relativePath, sourceLockFile.bytes);
  }
  const activeRows = simulated.activeByGame.map(row => {
    const reservation = byId.get(row.releaseId);
    const pointer = [...pointers.values()].find(item => item.game_version === reservation.gameVersion
      && item.content_version === reservation.contentVersion
      && item.manifest_sha256 === reservation.manifestSha256);
    if (!pointer) throw new Error('active W09 pointer is absent from the verified retained package closure');
    return pointer;
  }).sort((left, right) => left.game_version.localeCompare(right.game_version, undefined, { numeric: true }));
  if (activeRows.length === 0) throw new Error('shared static release requires at least one approved active W09 release');
  const selected = [...activeRows].sort((left, right) => right.game_version.localeCompare(left.game_version, undefined, { numeric: true }))[0];
  const retainedRows = [...pointers.values()].sort((left, right) => left.game_version.localeCompare(right.game_version, undefined, { numeric: true })
    || left.content_version.localeCompare(right.content_version, undefined, { numeric: true }));
  return {
    packageKind: 'published',
    version: {
      schema_version: 2,
      data_revision: selected.data_revision,
      build_id: '0'.repeat(64),
      game_version: selected.game_version,
      package_kind: 'published',
      game_releases: activeRows,
    },
    files,
    retainedReleases: retainedRows,
  };
}

function markActivePointers(state, releaseIds) {
  const next = structuredClone(state);
  for (const releaseId of releaseIds) {
    const reservation = next.reservations.find(row => row.releaseId === releaseId);
    if (!reservation || !['prepared', 'approved'].includes(reservation.status)) {
      throw new Error('cannot activate a release that is not prepared: ' + releaseId);
    }
    reservation.status = 'approved';
    next.activeByGame = next.activeByGame.filter(active => {
      const prior = next.reservations.find(row => row.releaseId === active.releaseId);
      return prior && prior.gameVersion !== reservation.gameVersion && prior.gameReleaseId !== reservation.gameReleaseId;
    });
    next.activeByGame.push({ gameReleaseId: reservation.gameReleaseId, releaseId });
  }
  next.activeByGame.sort((left, right) => left.gameReleaseId.localeCompare(right.gameReleaseId, 'en'));
  next.pendingPromotion = null;
  validateW09ReleaseState(next);
  return next;
}

export function restoreW09ActivePointersFromSnapshot(state, activeByGame) {
  const next = structuredClone(state);
  const target = [...activeByGame].map(row => ({ gameReleaseId: row.gameReleaseId, releaseId: row.releaseId }))
    .sort((left, right) => left.gameReleaseId.localeCompare(right.gameReleaseId, 'en'));
  for (const active of target) {
    const reservation = next.reservations.find(row => row.releaseId === active.releaseId);
    if (!reservation || reservation.status !== 'approved' || reservation.gameReleaseId !== active.gameReleaseId) {
      throw new Error('approved W09 whole-build snapshot contains a mismatched active pointer');
    }
  }
  next.activeByGame = target;
  validateW09ReleaseState(next);
  return next;
}

export function createW09PublicSourceLockFile(manifest) {
  if (!manifest || typeof manifest !== 'object' || !manifest.source || typeof manifest.source !== 'object') {
    throw new TypeError('validated W09 manifest with Source provenance is required');
  }
  const sourceLock = {
    schema: 'w09-public-source-lock/1',
    repository: manifest.source.repository,
    source_revision: manifest.source.sourceRevision,
    source_manifest_sha256: manifest.source.manifestSha256,
    game_release_id: manifest.gameReleaseId,
    game_version: manifest.gameVersion,
    content_version: manifest.contentVersion,
  };
  if (typeof sourceLock.repository !== 'string' || !sourceLock.repository.trim()
      || !SHA256_RE.test(sourceLock.source_revision) || !SHA256_RE.test(sourceLock.source_manifest_sha256)
      || typeof sourceLock.game_release_id !== 'string' || !sourceLock.game_release_id.trim()
      || typeof sourceLock.game_version !== 'string' || !sourceLock.game_version.trim()
      || typeof sourceLock.content_version !== 'string' || !sourceLock.content_version.trim()) {
    throw new TypeError('W09 manifest contains invalid public Source lock provenance');
  }
  const bytes = Buffer.from(JSON.stringify(sourceLock, null, 2) + '\n', 'utf8');
  const relativePath = 'source-locks/' + sourceLock.source_revision + '/'
    + createHash('sha256').update(bytes).digest('hex') + '.json';
  return { relativePath, bytes };
}

/**
 * Validated main-branch promotion coordinator. The injected deployer is called only after
 * source replay, selected-lock validation, immutable package verification, and full static
 * artifact verification. Active pointers are persisted only after an origin-verified receipt.
 */
/**
 * Clear only a retryable promotion whose pre-deployment browser smoke failure is
 * authenticated by GitHub and whose exact previous whole-site build is still live.
 * The complete journal is copied into an append-only cancellation receipt; release
 * reservations, prepared packages, runtime snapshots, and active pointers stay intact.
 */
export async function cancelW09RetryablePromotion(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('cancellation options must be an object');
  assertW09DurableStateCapability(options);
  if (options.requireDurableState !== true) throw new Error('W09 promotion cancellation requires durable owner-state persistence');
  if (typeof options.repoRoot !== 'string' || !options.repoRoot.trim()) throw new TypeError('repoRoot is required for W09 promotion cancellation');
  if (typeof options.transactionId !== 'string' || !SHA256_RE.test(options.transactionId)) {
    throw new TypeError('cancellation transactionId must be a full SHA-256 digest');
  }
  if (!Number.isSafeInteger(options.workflowRunId) || options.workflowRunId < 1) {
    throw new TypeError('cancellation workflowRunId must be a positive integer');
  }
  if (typeof options.token !== 'string' || !options.token.trim()) throw new TypeError('GitHub token is required to verify cancellation evidence');
  const expectedCurrent = canonicalActiveSnapshot(options.expectedCurrent);
  const repoRoot = path.resolve(options.repoRoot);
  if (process.env.GITHUB_REF !== 'refs/heads/main') {
    const branch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current'], { encoding: 'utf8', windowsHide: true }).trim();
    if (branch !== 'main') throw new Error('W09 promotion cancellation is restricted to reviewed Web main');
  }
  const statePath = path.join(repoRoot, 'content/contracts/w09/release-state.json');
  const lockPath = path.join(repoRoot, 'content/contracts/w09/publication.lock');

  return withW09PublicationLock({
    lockPath,
    run: async () => {
      const state = await readW09ReleaseState(statePath);
      const current = currentW09ActiveSnapshot(state);
      if (!sameJson(expectedCurrent, current)) throw new Error('active W09 whole-site CAS failed; refusing stale promotion cancellation');
      const pending = state.pendingPromotion;
      if (!pending) {
        const prior = (state.promotionCancellations ?? []).find(row => row.transactionId === options.transactionId);
        if (prior) return {
          status: 'already-cancelled', transactionId: prior.transactionId,
          cancellationId: prior.cancellationId, activePointers: current,
        };
        throw new Error('no retryable W09 promotion journal matches the cancellation request');
      }
      if (pending.transactionId !== options.transactionId) throw new Error('cancellation transactionId does not match the pending W09 journal');
      validatePendingPromotion(pending, state, 'pendingPromotion');
      if (pending.phase !== 'retryable') throw new Error('only a retryable W09 promotion journal can be cancelled');
      if (pending.action !== undefined && pending.action !== 'promote') throw new Error('rollback journals cannot be cancelled as promotions');
      if (!Array.isArray(pending.sourceReleaseIds) || !pending.sourceReleaseIds.length) {
        throw new Error('retryable W09 promotion journal does not pin its selected Source releases');
      }
      if (!sameJson(canonicalActiveSnapshot(pending.expectedActive), current)) {
        throw new Error('pending promotion expected-active snapshot differs from the current W09 pointers');
      }
      if (!current.activeByGame.length || !current.runtimeSnapshotBuildId
          || !pending.runtimeSnapshotBuildId || pending.runtimeSnapshotBuildId !== pending.buildId
          || pending.buildId === current.runtimeSnapshotBuildId) {
        throw new Error('cancellation requires distinct pinned previous and failed whole-site runtime builds');
      }

      const readJournalSnapshot = async () => {
        const snapshotDirectory = path.join(repoRoot, 'content/contracts/w09/runtime-snapshots', pending.runtimeSnapshotBuildId);
        const directoryInfo = await lstat(snapshotDirectory);
        if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw new Error('pending runtime snapshot directory must be a regular directory');
        const archivePath = path.join(snapshotDirectory, 'snapshot.json.gz');
        const archiveInfo = await lstat(archivePath);
        if (archiveInfo.isSymbolicLink() || !archiveInfo.isFile()) throw new Error('pending runtime snapshot must be a regular archive');
        const bytes = await readFile(archivePath);
        const archive = parseRuntimeSnapshotArchive(bytes, pending.runtimeSnapshotBuildId);
        if (archive.artifactManifestSha256 !== pending.artifactManifestSha256) {
          throw new Error('pending runtime snapshot manifest differs from the transaction journal');
        }
        const manifestBytes = Buffer.from(archive.files.find(row => row.path === 'artifact-manifest.json').base64, 'base64');
        let manifest;
        try { manifest = JSON.parse(manifestBytes.toString('utf8')); }
        catch (error) { throw new Error('pending runtime snapshot artifact manifest is invalid JSON', { cause: error }); }
        if (manifest.build_id !== pending.buildId || manifest.data_revision !== pending.dataRevision
            || manifest.package_kind !== 'published') {
          throw new Error('pending runtime snapshot artifact identity differs from the transaction journal');
        }
        return { archiveSha256: createHash('sha256').update(bytes).digest('hex') };
      };
      const journalSnapshot = await readJournalSnapshot();
      const evidence = await verifyW09UndeployedPromotion({
        pendingPromotion: structuredClone(pending), state: structuredClone(state), expectedCurrent: current,
        workflowRunId: options.workflowRunId, token: options.token,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.siteOrigin ? { siteOrigin: options.siteOrigin } : {}),
      });
      if (evidence.workflow.runId !== options.workflowRunId) throw new Error('verified GitHub run does not match the requested workflowRunId');

      const stateAfterVerification = await readW09ReleaseState(statePath);
      if (!sameJson(stateAfterVerification, state)) throw new Error('W09 owner state changed during cancellation evidence verification');
      if (!sameJson(currentW09ActiveSnapshot(stateAfterVerification), expectedCurrent)
          || !sameJson(stateAfterVerification.pendingPromotion, pending)
          || stateAfterVerification.pendingPromotion.phase !== 'retryable') {
        throw new Error('W09 transaction or active snapshot changed after cancellation verification');
      }
      const snapshotAfterVerification = await readJournalSnapshot();
      if (snapshotAfterVerification.archiveSha256 !== journalSnapshot.archiveSha256) {
        throw new Error('pending runtime snapshot archive changed during cancellation verification');
      }

      const cancellationId = createHash('sha256').update(JSON.stringify([
        pending.transactionId, evidence.workflow.runId, evidence.workflow.logSha256,
        evidence.production.buildId, evidence.observedAt,
      ])).digest('hex');
      const cancellation = {
        schema: 'w09-promotion-cancellation/1',
        action: 'promote',
        transactionId: pending.transactionId,
        cancellationId,
        pendingPromotion: structuredClone(pending),
        evidence,
      };
      const next = structuredClone(stateAfterVerification);
      next.promotionCancellations ??= [];
      next.promotionCancellations.push(cancellation);
      next.promotionCancellations.sort((left, right) => left.cancellationId.localeCompare(right.cancellationId, 'en'));
      next.pendingPromotion = null;
      validateW09ReleaseState(next);
      await writeW09ReleaseStateAtomic(statePath, next);
      try {
        await persistW09DurableCheckpoint(options, repoRoot, statePath, 'cancelled');
      } catch (error) {
        await writeW09ReleaseStateAtomic(statePath, stateAfterVerification);
        throw new Error('W09 cancellation owner-state checkpoint is uncertain; the retryable journal was restored locally and the remote state must be re-read', { cause: error });
      }
      return {
        status: 'cancelled-without-deployment', transactionId: pending.transactionId,
        cancellationId, releaseIds: [...pending.releaseIds], activePointers: current,
      };
    },
  });
}

export async function promoteW09SelectedComposition(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('promotion options must be an object');
  assertW09DurableStateCapability(options);
  if (typeof options.repoRoot !== 'string' || typeof options.sourceRoot !== 'string') {
    throw new Error('explicit Web repoRoot and official Source sourceRoot are required');
  }
  if (!Array.isArray(options.sourceReleaseIds) || options.sourceReleaseIds.length === 0
      || options.sourceReleaseIds.some(id => typeof id !== 'string' || !/^w09-[a-f0-9]{32}$/u.test(id))
      || new Set(options.sourceReleaseIds).size !== options.sourceReleaseIds.length) {
    throw new TypeError('promotion sourceReleaseIds must be unique verified Source game release IDs');
  }
  if (typeof options.promoteVerifiedArtifact !== 'function') throw new TypeError('promoteVerifiedArtifact must deploy and origin-verify the exact static artifact');
  const expectedCurrent = canonicalActiveSnapshot(options.expectedCurrent);
  const repoRoot = path.resolve(options.repoRoot);
  const compositionOptions = { ...options, repoRoot };
  const compositionContext = await resolveW09CompositionContext(compositionOptions);
  const branch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current'], { encoding: 'utf8', windowsHide: true }).trim();
  if (branch !== 'main' && process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('W09 shared promotion is restricted to reviewed Web main');
  const statePath = path.join(repoRoot, 'content/contracts/w09/release-state.json');
  const lockPath = path.join(repoRoot, 'content/contracts/w09/publication.lock');

  return withW09PublicationLock({
    lockPath,
    run: async () => {
      let state = await readW09ReleaseState(statePath);
      const current = currentW09ActiveSnapshot(state);
      if (!sameJson(expectedCurrent, current)) throw new Error('active W09 whole-site CAS failed; refusing stale shared or runtime inputs');
      if (state.pendingPromotion) {
        const pendingSourceIds = state.pendingPromotion.sourceReleaseIds;
        if (!pendingSourceIds || !sameJson([...pendingSourceIds].sort(), [...options.sourceReleaseIds].sort())
            || !sameJson(state.pendingPromotion.expectedActive, current)) {
          throw new Error('another W09 promotion journal owns the serialized release transaction');
        }
      }

      const preparedBySourceRelease = [];
      for (const sourceReleaseId of [...options.sourceReleaseIds].sort()) {
        const result = await prepareW09SharedRelease({
          ...options,
          releaseId: sourceReleaseId,
          dryRun: false,
          [INTERNAL_PUBLICATION_LOCK]: true,
        });
        if (result.status !== 'prepared') return result;
        const composition = await compositionContext.loadW09VerifiedComposition({
          repoRoot: compositionContext.compositionRoot,
          sourceRoot: options.sourceRoot,
          releaseId: sourceReleaseId,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        await revalidateW09CompositionContext(compositionOptions, compositionContext, 'verified Source replay');
        if (composition.status !== 'verified' || composition.gate.status !== 'ready-for-release-allocation') {
          return { status: 'pending', sourceReleaseId, gate: composition.gate ?? { status: composition.status, reason: composition.reason } };
        }
        if (result.gameReleaseId !== composition.candidate.manifest.gameReleaseId || result.inputDigest !== composition.inputDigest) {
          throw new Error('prepared Web allocation does not map to the verified Source release composition');
        }
        preparedBySourceRelease.push({ sourceReleaseId, webReleaseId: result.releaseId, composition });
      }

      await revalidateW09CompositionContext(compositionOptions, compositionContext, 'shared artifact build');
      state = await readW09ReleaseState(statePath);
      if (!sameJson(currentW09ActiveSnapshot(state), current)) throw new Error('active W09 pointer changed during serialized preparation');
      const transactionIds = preparedBySourceRelease.map(row => row.webReleaseId).sort();
      if (new Set(transactionIds).size !== transactionIds.length) throw new Error('distinct Source game requests unexpectedly map to the same Web release allocation');
      if (state.pendingPromotion && (!sameJson([...state.pendingPromotion.releaseIds].sort(), transactionIds)
          || !sameJson([...state.pendingPromotion.sourceReleaseIds].sort(), [...options.sourceReleaseIds].sort()))) {
        throw new Error('retryable W09 promotion journal does not match the Source-to-Web allocation mapping');
      }
      const pointersAlreadyActive = transactionIds.every(releaseId => state.activeByGame.some(row => row.releaseId === releaseId));
      const records = transactionIds.map(releaseId => state.reservations.find(row => row.releaseId === releaseId));
      if (records.some(row => !row || !['prepared', 'approved'].includes(row.status))) throw new Error('selected W09 release is missing its immutable prepared package');
      const gameVersions = new Set(records.map(row => row.gameVersion));
      if (gameVersions.size !== records.length) throw new Error('one W09 transaction may select only one active release per gameVersion');
      for (const record of records) {
        const active = state.activeByGame
          .map(pointer => state.reservations.find(row => row.releaseId === pointer.releaseId))
          .find(row => row?.gameVersion === record.gameVersion);
        if (active && active.releaseId !== record.releaseId && parseSlot(record) < parseSlot(active)) {
          throw new Error('W09 promotion cannot downgrade an approved contentVersion; use the explicit rollback API');
        }
      }

      const plannedState = pointersAlreadyActive ? structuredClone(state) : markActivePointers(state, transactionIds);
      plannedState.pendingPromotion = state.pendingPromotion;
      const sharedRelease = await buildSharedBundleFromState(repoRoot, plannedState);
      const { buildStaticSite } = await import('../../src/static/build.mjs');
      const { verifyStaticPackage } = await import('../../src/static/verify.mjs');
      const build = await buildStaticSite({
        root: repoRoot,
        mode: 'published',
        sharedRelease,
        siteOrigin: options.siteOrigin ?? 'https://darktide.tw-syuan.com',
      });
      const artifact = await verifyStaticPackage(path.join(repoRoot, 'dist'));
      if (artifact.package_kind !== 'published' || artifact.build_id !== build.build_id
          || artifact.shared_data_revision !== sharedRelease.version.data_revision) {
        throw new Error('built shared package failed formal published artifact identity verification');
      }
      if (pointersAlreadyActive && artifact.build_id === current.runtimeSnapshotBuildId) {
        return {
          status: 'already-active', releaseIds: transactionIds, sourceReleaseIds: [...options.sourceReleaseIds].sort(),
          activePointers: current, allocationReserved: false, packageWritten: false,
        };
      }
      const artifactManifestBytes = await readFile(path.join(repoRoot, 'dist/artifact-manifest.json'));
      const artifactManifestSha256 = createHash('sha256').update(artifactManifestBytes).digest('hex');
      const runtimeSnapshot = await saveVerifiedRuntimeSnapshot(repoRoot, path.join(repoRoot, 'dist'), artifact.build_id);
      const transactionId = createHash('sha256').update(JSON.stringify([transactionIds, current, artifact.build_id, artifactManifestSha256])).digest('hex');
      if (state.pendingPromotion && state.pendingPromotion.transactionId !== transactionId) {
        throw new Error('retryable W09 promotion bytes differ from the pinned transaction journal');
      }
      const pendingPromotion = {
        schema: 'w09-promotion-journal/1',
        transactionId,
        releaseIds: transactionIds,
        sourceReleaseIds: [...options.sourceReleaseIds].sort(),
        expectedActive: current,
        buildId: artifact.build_id,
        dataRevision: artifact.data_revision,
        artifactManifestSha256,
        runtimeSnapshotBuildId: runtimeSnapshot.buildId,
        phase: 'prepared',
      };
      const journalState = structuredClone(state);
      journalState.pendingPromotion = pendingPromotion;
      validateW09ReleaseState(journalState);
      await writeW09ReleaseStateAtomic(statePath, journalState);
      await persistW09DurableCheckpoint(options, repoRoot, statePath, 'journal');

      let receipt;
      try {
        receipt = await options.promoteVerifiedArtifact({ artifact, distPath: path.join(repoRoot, 'dist'), transactionId });
        createW09PublicationReceiptProjection({ receipt, action: 'promote', pendingPromotion, activeByGame: plannedState.activeByGame });
      } catch (error) {
        const retryState = await readW09ReleaseState(statePath);
        if (retryState.pendingPromotion?.transactionId === transactionId) {
          retryState.pendingPromotion.phase = 'retryable';
          retryState.pendingPromotion.lastFailure = String(error?.message ?? error).slice(0, 500);
          await writeW09ReleaseStateAtomic(statePath, retryState);
          await persistW09DurableCheckpoint(options, repoRoot, statePath, 'retryable');
        }
        if (/CLOUDFLARE_API_TOKEN|required credential|credentials are unavailable/iu.test(String(error?.message ?? error))) {
          return { status: 'waiting-for-credentials', releaseIds: transactionIds, buildId: artifact.build_id, activePointersUnchanged: true };
        }
        throw error;
      }

      const latest = await readW09ReleaseState(statePath);
      if (latest.pendingPromotion?.transactionId !== transactionId
          || !sameJson(currentW09ActiveSnapshot(latest), current)) {
        throw new Error('W09 active pointer changed while the verified deployment was in flight');
      }
      const committed = pointersAlreadyActive ? structuredClone(latest) : markActivePointers(latest, transactionIds);
      for (const releaseId of transactionIds) {
        const reservation = committed.reservations.find(row => row.releaseId === releaseId);
        reservation.runtimeSnapshotBuildId = runtimeSnapshot.buildId;
      }
      committed.activeRuntimeSnapshotBuildId = runtimeSnapshot.buildId;
      recordApprovedRuntimeSnapshot(committed, runtimeSnapshot.buildId, committed.activeByGame);
      appendW09PublicationReceipt(committed, createW09PublicationReceiptProjection({
        receipt, action: 'promote', pendingPromotion, activeByGame: committed.activeByGame,
      }));
      committed.pendingPromotion = null;
      await writeW09ReleaseStateAtomic(statePath, committed);
      try {
        await persistW09DurableCheckpoint(options, repoRoot, statePath, 'active');
      } catch (error) {
        await writeW09ReleaseStateAtomic(statePath, journalState);
        throw error;
      }
      return { status: 'verified-and-active', releaseIds: transactionIds, sourceReleaseIds: [...options.sourceReleaseIds].sort(), transactionId, artifact, receipt, runtimeSnapshot, retainedReleases: sharedRelease.retainedReleases };
    },
  });
}

/** Pin or remove historical/baseline release references with compare-and-swap under the publication lock. */
export async function updateW09RetentionReferences({ repoRoot, expectedReferences, releaseIds, persistDurableState, requireDurableState = false } = {}) {
  const options = { persistDurableState, requireDurableState };
  assertW09DurableStateCapability(options);
  if (typeof repoRoot !== 'string') throw new TypeError('repoRoot is required');
  if (!Array.isArray(expectedReferences) || !Array.isArray(releaseIds)) throw new TypeError('expectedReferences and releaseIds must be arrays');
  if (releaseIds.some(id => typeof id !== 'string') || new Set(releaseIds).size !== releaseIds.length) {
    throw new TypeError('retention releaseIds must be unique strings');
  }
  const root = path.resolve(repoRoot);
  const statePath = path.join(root, 'content/contracts/w09/release-state.json');
  const lockPath = path.join(root, 'content/contracts/w09/publication.lock');
  return withW09PublicationLock({ lockPath, run: async () => {
    const state = await readW09ReleaseState(statePath);
    const current = [...(state.referenceReleaseIds ?? [])].sort();
    const expected = [...expectedReferences].sort();
    if (!sameJson(current, expected)) throw new Error('explicit W09 retention reference CAS failed');
    const next = structuredClone(state);
    next.referenceReleaseIds = [...releaseIds].sort();
    validateW09ReleaseState(next);
    await writeW09ReleaseStateAtomic(statePath, next);
    await persistW09DurableCheckpoint(options, root, statePath, 'retention-references');
    return next.referenceReleaseIds;
  } });
}

/** Explicit rollback: reactivates approved package bytes, while retaining the current approved window and refs. */
export async function rollbackW09SharedComposition(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('rollback options must be an object');
  assertW09DurableStateCapability(options);
  if (typeof options.repoRoot !== 'string' || !Array.isArray(options.targetReleaseIds) || options.targetReleaseIds.length === 0
      || typeof options.promoteVerifiedArtifact !== 'function'
      || typeof options.targetRuntimeSnapshotBuildId !== 'string') {
    throw new TypeError('rollback requires repoRoot, targetReleaseIds, targetRuntimeSnapshotBuildId, expectedCurrent, and an origin-verifying deployer');
  }
  assertSha256(options.targetRuntimeSnapshotBuildId, 'targetRuntimeSnapshotBuildId');
  const repoRoot = path.resolve(options.repoRoot);
  const targetReleaseIds = [...options.targetReleaseIds].sort();
  if (targetReleaseIds.some(id => typeof id !== 'string' || !/^w09-[a-f0-9]{32}$/u.test(id))
      || new Set(targetReleaseIds).size !== targetReleaseIds.length) throw new TypeError('rollback targetReleaseIds must be unique W09 release IDs');
  const expectedCurrent = canonicalActiveSnapshot(options.expectedCurrent);
  const branch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current'], { encoding: 'utf8', windowsHide: true }).trim();
  if (branch !== 'main' && process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('W09 shared rollback is restricted to reviewed Web main');
  const statePath = path.join(repoRoot, 'content/contracts/w09/release-state.json');
  const lockPath = path.join(repoRoot, 'content/contracts/w09/publication.lock');
  return withW09PublicationLock({ lockPath, run: async () => {
    const state = await readW09ReleaseState(statePath);
    const current = currentW09ActiveSnapshot(state);
    if (!sameJson(expectedCurrent, current)) throw new Error('active W09 whole-site CAS failed; refusing a stale or implicit rollback');
    const records = targetReleaseIds.map(releaseId => state.reservations.find(row => row.releaseId === releaseId));
    if (records.some(row => !row || row.status !== 'approved')) throw new Error('rollback targets must be previously approved releases');
    if (new Set(records.map(row => row.gameVersion)).size !== records.length) throw new Error('rollback may select only one release per gameVersion');
    const targetSnapshotRecord = (state.approvedRuntimeSnapshots ?? []).find(row => row.buildId === options.targetRuntimeSnapshotBuildId);
    const targetSnapshotReleaseIds = targetSnapshotRecord?.activeByGame?.map(active => active.releaseId).sort() ?? [];
    if (!targetSnapshotRecord || !sameJson(targetReleaseIds, targetSnapshotReleaseIds)
        || records.some(record => !targetSnapshotRecord.activeByGame.some(active =>
          active.gameReleaseId === record.gameReleaseId && active.releaseId === record.releaseId))) {
      throw new Error('rollback targets must exactly match the full active release set of the approved whole-build identity');
    }
    if (sameJson(targetSnapshotRecord.activeByGame, current.activeByGame)
        && options.targetRuntimeSnapshotBuildId === current.runtimeSnapshotBuildId) {
      return { status: 'already-active', releaseIds: targetReleaseIds, activePointers: current };
    }
    if (state.pendingPromotion && (!sameJson([...state.pendingPromotion.releaseIds].sort(), targetReleaseIds)
        || !sameJson(state.pendingPromotion.expectedActive, current))) {
      throw new Error('another W09 promotion journal owns the serialized release transaction');
    }

    const targetSnapshotBuildId = options.targetRuntimeSnapshotBuildId;
    const loadedRuntimeSnapshot = await loadVerifiedRuntimeSnapshot(repoRoot, targetSnapshotBuildId);
    const plannedState = restoreW09ActivePointersFromSnapshot(state, targetSnapshotRecord.activeByGame);
    const sharedRelease = await buildSharedBundleFromState(repoRoot, plannedState);
    const { buildStaticSite } = await import('../../src/static/build.mjs');
    const { verifyStaticPackage } = await import('../../src/static/verify.mjs');
    let build;
    try {
      build = await buildStaticSite({
        root: repoRoot,
        mode: 'published',
        runtimeSnapshot: loadedRuntimeSnapshot.path,
        sharedRelease,
        siteOrigin: options.siteOrigin ?? 'https://darktide.tw-syuan.com',
      });
    } finally {
      await loadedRuntimeSnapshot.cleanup();
    }
    const artifact = await verifyStaticPackage(path.join(repoRoot, 'dist'));
    if (artifact.package_kind !== 'published' || artifact.build_id !== build.build_id) {
      throw new Error('rollback static package failed full published artifact verification');
    }
    const runtimeSnapshot = await saveVerifiedRuntimeSnapshot(repoRoot, path.join(repoRoot, 'dist'), artifact.build_id);
    const artifactManifestSha256 = createHash('sha256').update(await readFile(path.join(repoRoot, 'dist/artifact-manifest.json'))).digest('hex');
    const transactionId = createHash('sha256').update(JSON.stringify(['rollback', targetReleaseIds, current, artifact.build_id, artifactManifestSha256])).digest('hex');
    if (state.pendingPromotion && state.pendingPromotion.transactionId !== transactionId) {
      throw new Error('retryable W09 rollback bytes differ from the pinned transaction journal');
    }
    const pending = {
      schema: 'w09-promotion-journal/1', transactionId, releaseIds: targetReleaseIds,
      expectedActive: current, buildId: artifact.build_id, dataRevision: artifact.data_revision, artifactManifestSha256,
      runtimeSnapshotBuildId: runtimeSnapshot.buildId, phase: 'prepared', action: 'rollback',
    };
    const journal = structuredClone(state);
    journal.pendingPromotion = pending;
    validateW09ReleaseState(journal);
    await writeW09ReleaseStateAtomic(statePath, journal);
    await persistW09DurableCheckpoint(options, repoRoot, statePath, 'journal');
    let receipt;
    try {
      receipt = await options.promoteVerifiedArtifact({ artifact, distPath: path.join(repoRoot, 'dist'), transactionId, action: 'rollback' });
      createW09PublicationReceiptProjection({ receipt, action: 'rollback', pendingPromotion: pending, activeByGame: targetSnapshotRecord.activeByGame });
    } catch (error) {
      const retryState = await readW09ReleaseState(statePath);
      if (retryState.pendingPromotion?.transactionId === transactionId) {
        retryState.pendingPromotion.phase = 'retryable';
        retryState.pendingPromotion.lastFailure = String(error?.message ?? error).slice(0, 500);
        await writeW09ReleaseStateAtomic(statePath, retryState);
        await persistW09DurableCheckpoint(options, repoRoot, statePath, 'retryable');
      }
      if (/CLOUDFLARE_API_TOKEN|required credential|credentials are unavailable/iu.test(String(error?.message ?? error))) {
        return { status: 'waiting-for-credentials', releaseIds: targetReleaseIds, buildId: artifact.build_id, activePointersUnchanged: true };
      }
      throw error;
    }
    const latest = await readW09ReleaseState(statePath);
    if (latest.pendingPromotion?.transactionId !== transactionId || !sameJson(currentW09ActiveSnapshot(latest), current)) {
      throw new Error('W09 active pointers changed while rollback was in flight');
    }
    const committed = restoreW09ActivePointersFromSnapshot(latest, targetSnapshotRecord.activeByGame);
    for (const releaseId of targetReleaseIds) {
      const reservation = committed.reservations.find(row => row.releaseId === releaseId);
      reservation.runtimeSnapshotBuildId = runtimeSnapshot.buildId;
    }
    committed.activeRuntimeSnapshotBuildId = runtimeSnapshot.buildId;
    recordApprovedRuntimeSnapshot(committed, runtimeSnapshot.buildId, committed.activeByGame);
    appendW09PublicationReceipt(committed, createW09PublicationReceiptProjection({
      receipt, action: 'rollback', pendingPromotion: pending, activeByGame: committed.activeByGame,
    }));
    committed.pendingPromotion = null;
    await writeW09ReleaseStateAtomic(statePath, committed);
    try {
      await persistW09DurableCheckpoint(options, repoRoot, statePath, 'active');
    } catch (error) {
      await writeW09ReleaseStateAtomic(statePath, journal);
      throw error;
    }
    return {
      status: 'verified-and-rolled-back', releaseIds: targetReleaseIds, transactionId, artifact, receipt,
      runtimeSnapshot, restoredRuntimeSnapshotBuildId: targetSnapshotBuildId,
      retainedReleases: sharedRelease.retainedReleases,
    };
  } });
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    const sorted = {};
    for (const key of Object.keys(value).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))) sorted[key] = sortJson(value[key]);
    return sorted;
  }
  return value;
}

function assertW09DurableStateCapability(options) {
  if (options.requireDurableState === true && typeof options.persistDurableState !== 'function') {
    throw new Error('formal W09 publication requires the owner Git state persistence hook');
  }
  if (options.persistDurableState !== undefined && typeof options.persistDurableState !== 'function') {
    throw new TypeError('persistDurableState must be an async owner-state persistence callback');
  }
}

async function persistW09DurableCheckpoint(options, repoRoot, statePath, phase) {
  if (typeof options.persistDurableState !== 'function') return null;
  const result = await options.persistDurableState({ repoRoot, statePath, phase });
  if (options.requireDurableState === true && (!result || !['persisted', 'unchanged'].includes(result.status))) {
    throw new Error('W09 owner state persistence did not confirm the requested checkpoint');
  }
  return result;
}

async function loadW09CandidateValidator(candidate, { compositionContext, composition } = {}) {
  if (!W09_COMPOSITION_CONTEXTS.has(compositionContext)) {
    throw new Error('W09 candidate validation requires a context returned by the pinned composition resolver');
  }
  if (!compositionContext.dualRoot) return import('./contract-w08-build.mjs');

  const historyRoot = compositionContext.compositionRoot;
  const historyHead = compositionContext.expectedCompositionCommit;
  if (releaseGitText(historyRoot, ['rev-parse', 'HEAD'], 'historical W09 composition HEAD recheck') !== historyHead
      || releaseGitText(compositionContext.runtimeRoot, ['rev-parse', 'HEAD'], 'current W09 runtime HEAD recheck') !== compositionContext.runtimeHead) {
    throw new Error('W09 candidate validation roots changed after the pinned composition was resolved');
  }
  const candidateReleaseId = candidate?.envelope?.gameReleaseId;
  const selectedBytes = releaseGitBlob(historyRoot, historyHead, W09_SELECTED_PATH);
  await readExactTrackedInput(historyRoot, W09_SELECTED_PATH, selectedBytes);
  let selected;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(selectedBytes);
    const { validateW09SelectedComposition } = await import(pathToFileURL(path.join(historyRoot, ...W09_COMPOSER_MODULE_PATH.split('/'))).href);
    selected = validateW09SelectedComposition(JSON.parse(decoded));
  } catch (error) {
    throw new Error('historical selected marker could not authenticate W09 candidate validation: ' + error.message);
  }
  const proposal = selected.proposals.find(row => row.gameReleaseId === candidateReleaseId);
  if (!proposal) throw new Error('W09 candidate gameReleaseId is absent from the pinned selected composition');
  const lockPath = W09_COMPOSITION_LOCK_ROOT + proposal.requestId + '.json';
  const inputLockBytes = releaseGitBlob(historyRoot, historyHead, lockPath);
  await readExactTrackedInput(historyRoot, lockPath, inputLockBytes);
  let historicalInputLock;
  try { historicalInputLock = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inputLockBytes)); }
  catch (error) { throw new Error('pinned W09 composition lock is invalid: ' + error.message); }
  if (!composition || canonicalW09Json(composition.inputLock) !== canonicalW09Json(historicalInputLock)) {
    throw new Error('W09 replay input lock differs from the exact selected historical bytes');
  }
  const lock = historicalInputLock;
  if (lock.schema !== 'w09-web-inputs-lock/1' || lock.gameReleaseId !== candidateReleaseId
      || lock.source?.releaseId !== proposal.releaseId || lock.source?.requestId !== proposal.requestId
      || lock.source?.sourceRevision !== selected.sourceRevision) {
    throw new Error('historical W09 selected identity does not match the replayed candidate');
  }
  if (compositionContext.historyPin.commit !== lock.web?.compilerCommit
      || compositionContext.historyPin.fileSetSha256 !== lock.web?.compilerFileSetSha256
      || compositionContext.historyPin.lockSha256 !== lock.web?.w09CompilerLockSha256) {
    throw new Error('historical W09 code pin differs from the selected composition lock');
  }

  const w08InputLockBytes = releaseGitBlob(historyRoot, historyHead, W08_INPUT_LOCK_PATH);
  const w08CompilerLockBytes = releaseGitBlob(historyRoot, historyHead, W08_COMPILER_LOCK_PATH);
  await readExactTrackedInput(historyRoot, W08_INPUT_LOCK_PATH, w08InputLockBytes);
  await readExactTrackedInput(historyRoot, W08_COMPILER_LOCK_PATH, w08CompilerLockBytes);
  if (sha256Bytes(w08InputLockBytes) !== lock.web.w08InputLockSha256
      || sha256Bytes(w08CompilerLockBytes) !== lock.web.w08CompilerLockSha256) {
    throw new Error('historical W08 input/compiler lock bytes differ from the selected composition pin');
  }
  let w08CompilerLock;
  try { w08CompilerLock = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(w08CompilerLockBytes)); }
  catch (error) { throw new Error('historical W08 compiler lock is invalid: ' + error.message); }
  if (!w08CompilerLock || w08CompilerLock.schemaVersion !== 'w08-compiler/1'
      || w08CompilerLock.commit !== lock.web.w08CompilerCommit || !Array.isArray(w08CompilerLock.files)
      || !w08CompilerLock.files.length) {
    throw new Error('historical W08 compiler lock identity differs from the selected composition');
  }
  try {
    execFileSync('git', ['-C', historyRoot, 'merge-base', '--is-ancestor', w08CompilerLock.commit, historyHead], {
      stdio: 'ignore', windowsHide: true,
    });
  } catch {
    throw new Error('historical W08 compiler commit is not an ancestor of its pinned composition checkout');
  }

  const candidateCompiler = candidate?.envelope?.compiler;
  const normalizeFilePins = rows => {
    if (!Array.isArray(rows)) return null;
    return [...rows].map(row => ({ ...row }))
      .sort((left, right) => Buffer.compare(Buffer.from(left.path ?? ''), Buffer.from(right.path ?? '')));
  };
  if (!candidateCompiler || candidateCompiler.commit !== lock.web.compilerCommit
      || candidateCompiler.inputLockSha256 !== lock.web.w08InputLockSha256
      || candidateCompiler.authoringCommit !== lock.web.authoringCommit
      || candidate.manifest?.gameReleaseId !== candidateReleaseId
      || candidate.manifest?.source?.commit !== lock.source.sourceCommit
      || candidate.manifest?.source?.sourceRevision !== lock.source.sourceRevision
      || candidate.manifest?.source?.manifestSha256 !== lock.source.manifestSha256
      || candidate.manifest?.web?.compilerCommit !== lock.web.compilerCommit
      || candidate.manifest?.web?.authoringCommit !== lock.web.authoringCommit
      || canonicalW09Json(normalizeFilePins(candidateCompiler.files)) !== canonicalW09Json(normalizeFilePins(w08CompilerLock.files))) {
    throw new Error('historical W09 candidate metadata differs from its independently pinned W09 and W08 compiler identities');
  }

  const seenPaths = new Set();
  for (const row of w08CompilerLock.files) {
    if (!row || typeof row.path !== 'string' || row.path.includes('\\') || row.path.startsWith('/')
        || row.path.split('/').some(part => !part || part === '.' || part === '..')
        || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1 || !SHA256_RE.test(row.sha256)
        || seenPaths.has(row.path)) {
      throw new Error('historical W08 compiler lock contains an unsafe or duplicate file pin');
    }
    seenPaths.add(row.path);
    const compilerBytes = releaseGitBlob(historyRoot, w08CompilerLock.commit, row.path);
    const compositionBytes = releaseGitBlob(historyRoot, historyHead, row.path);
    if (compilerBytes.byteLength !== row.sizeBytes || sha256Bytes(compilerBytes) !== row.sha256
        || !compositionBytes.equals(compilerBytes)) {
      throw new Error('historical W08 executable differs from its pinned compiler commit: ' + row.path);
    }
    await readExactTrackedInput(historyRoot, row.path, compositionBytes);
  }
  const validatorPath = path.join(historyRoot, 'scripts', 'content', 'contract-w08-build.mjs');
  if (!seenPaths.has('scripts/content/contract-w08-build.mjs')) {
    throw new Error('historical W08 compiler pin omits its candidate validator');
  }
  if (releaseGitText(historyRoot, ['status', '--porcelain', '--untracked-files=no'], 'historical W09 composition tracked-worktree check') !== '') {
    throw new Error('historical W09 composition checkout has tracked changes outside its selected input and compiler pins');
  }
  const validator = await import(pathToFileURL(validatorPath).href);
  if (typeof validator.validateW08Candidate !== 'function') {
    throw new Error('pinned historical W08 compiler does not expose its candidate validator');
  }
  return validator;
}

export async function validateW09CandidateForComposition(candidate, validationContext) {
  const validator = await loadW09CandidateValidator(candidate, validationContext);
  validator.validateW08Candidate(candidate);
}

async function finalizeW09Candidate(original, contentVersion, validationContext) {
  const candidate = {
    envelope: structuredClone(original.envelope),
    manifest: structuredClone(original.manifest),
    files: new Map([...original.files].map(([name, bytes]) => [name, Buffer.from(bytes)])),
    manifestBytes: Buffer.from(original.manifestBytes),
  };
  candidate.manifest.contentVersion = contentVersion;
  candidate.envelope.proposedContentVersion = contentVersion;
  candidate.manifestBytes = Buffer.from(JSON.stringify(sortJson(candidate.manifest), null, 2) + '\n', 'utf8');
  const digest = createHash('sha256').update(candidate.manifestBytes).digest('hex');
  candidate.envelope.manifest.sha256 = digest;
  await validateW09CandidateForComposition(candidate, validationContext);
  return candidate;
}

async function writeW09PreparedPackage(packageRoot, packageFiles) {
  const absolute = path.resolve(packageRoot);
  const parent = path.dirname(absolute);
  await mkdir(parent, { recursive: true });
  for (const directory of [parent, path.dirname(parent), path.dirname(path.dirname(parent))]) {
    try {
      if ((await lstat(directory)).isSymbolicLink()) throw new Error('W09 prepared package path may not traverse a symbolic link');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  try {
    const existing = await lstat(absolute);
    if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error('immutable W09 package destination is not a regular directory');
    const actualEntries = await collectPackageEntries(absolute);
    const expectedEntries = new Set();
    for (const [relativePath, expectedBytes] of packageFiles) {
      if (relativePath.startsWith('/') || relativePath.split(/[\\/]/u).some(segment => segment === '' || segment === '.' || segment === '..')) {
        throw new Error('prepared package contains an unsafe file path');
      }
      const normalizedPath = relativePath.replaceAll('\\', '/');
      const segments = normalizedPath.split('/');
      for (let index = 1; index < segments.length; index += 1) {
        expectedEntries.add(segments.slice(0, index).join('/') + '\0directory');
      }
      expectedEntries.add(normalizedPath + '\0file');
      const actualPath = path.join(absolute, ...relativePath.split('/'));
      const actualInfo = await lstat(actualPath);
      if (!actualInfo.isFile() || actualInfo.isSymbolicLink() || !(await readFile(actualPath)).equals(expectedBytes)) {
        throw new Error('existing W09 package conflicts with the immutable prepared bytes: ' + relativePath);
      }
    }
    if (JSON.stringify(actualEntries) !== JSON.stringify([...expectedEntries].sort())) throw new Error('existing W09 package contains missing or unrecognized entries');
    return { path: absolute, reused: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const temp = path.join(parent, '.' + path.basename(absolute) + '.' + randomUUID() + '.tmp');
  await mkdir(temp, { recursive: false });
  try {
    for (const [relativePath, bytes] of packageFiles) {
      if (relativePath.startsWith('/') || relativePath.split(/[\\/]/u).some(segment => segment === '' || segment === '.' || segment === '..')) {
        throw new Error('prepared package contains an unsafe file path');
      }
      const filePath = path.join(temp, ...relativePath.split('/'));
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, bytes, { flag: 'wx' });
    }
    await rename(temp, absolute);
  } catch (error) {
    const tempInfo = await lstat(temp).catch(() => null);
    if (tempInfo?.isDirectory() && !tempInfo.isSymbolicLink()) {
      const { rm } = await import('node:fs/promises');
      await rm(temp, { recursive: true, force: true });
    }
    throw error;
  }
  return { path: absolute, reused: false };
}

async function collectPackageEntries(directory, prefix = '') {
  const entries = [];
  for (const name of (await readdir(directory)).sort()) {
    const absolute = path.join(directory, name);
    const relative = prefix ? prefix + '/' + name : name;
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error('immutable W09 package may not contain symbolic links');
    if (info.isDirectory()) {
      entries.push(relative + '\0directory');
      entries.push(...await collectPackageEntries(absolute, relative));
    } else if (info.isFile()) {
      entries.push(relative + '\0file');
    } else {
      throw new Error('immutable W09 package may contain only regular files and directories');
    }
  }
  return entries.sort();
}
