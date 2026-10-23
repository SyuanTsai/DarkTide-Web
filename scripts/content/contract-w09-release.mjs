import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { safeRelativePath } from '../../src/static/common.mjs';

const STATE_SCHEMA = 'w09-release-ledger/1';
const SHA256_RE = /^[a-f0-9]{64}$/;
const GAME_VERSION_RE = /^\d+\.\d+\.\d+$/;
const SLOT_RE = /^(\d+\.\d+\.\d+)\.(\d+)$/;
const RELEASE_STATUSES = new Set(['reserved', 'prepared', 'approved', 'failed']);
const INTERNAL_PUBLICATION_LOCK = Symbol('w09-internal-publication-lock');

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
    const pending = state.pendingPromotion;
    if (!pending || typeof pending !== 'object' || Array.isArray(pending)
        || pending.schema !== 'w09-promotion-journal/1'
        || !Array.isArray(pending.releaseIds) || pending.releaseIds.length === 0
        || (pending.sourceReleaseIds !== undefined && (!Array.isArray(pending.sourceReleaseIds) || pending.sourceReleaseIds.length === 0))
        || !pending.expectedActive || typeof pending.expectedActive !== 'object' || !['prepared', 'retryable'].includes(pending.phase)) {
      throw new TypeError('pendingPromotion must be a valid W09 promotion journal');
    }
    assertText(pending.transactionId, 'pendingPromotion.transactionId');
    assertSha256(pending.buildId, 'pendingPromotion.buildId');
    if (pending.dataRevision !== undefined) assertSha256(pending.dataRevision, 'pendingPromotion.dataRevision');
    assertSha256(pending.artifactManifestSha256, 'pendingPromotion.artifactManifestSha256');
    if (pending.runtimeSnapshotBuildId !== undefined) assertSha256(pending.runtimeSnapshotBuildId, 'pendingPromotion.runtimeSnapshotBuildId');
    for (const releaseId of pending.releaseIds) {
      const reservation = state.reservations.find(item => item.releaseId === releaseId);
      if (!reservation || !['prepared', 'approved'].includes(reservation.status)) {
        throw new TypeError('pending promotion must retain its prepared release reservations');
      }
    }
    validateActiveSnapshotShape(pending.expectedActive, 'pendingPromotion.expectedActive');
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

  const { loadW09VerifiedComposition } = await import('./contract-w09-compose.mjs');
  const repoRoot = path.resolve(options.repoRoot);
  const dryRun = options.dryRun === true;
  const firstPass = await loadW09VerifiedComposition({
    repoRoot,
    sourceRoot: options.sourceRoot,
    releaseId: options.releaseId,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
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
    const candidate = await finalizeW09Candidate(firstPass.candidate, contentVersion);
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
      const composition = await loadW09VerifiedComposition({
        repoRoot,
        sourceRoot: options.sourceRoot,
        releaseId: options.releaseId,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
      if (composition.status !== 'verified') return composition;
      if (composition.gate.status !== 'ready-for-release-allocation') {
        return { status: 'blocked', releaseId: options.releaseId, inputDigest: composition.inputDigest, gate: composition.gate };
      }
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
      const planned = await planW09CandidateAllocation(state, identity, contentVersion => finalizeW09Candidate(composition.candidate, contentVersion));
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
  const branch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current'], { encoding: 'utf8', windowsHide: true }).trim();
  if (branch !== 'main' && process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('W09 shared promotion is restricted to reviewed Web main');
  const statePath = path.join(repoRoot, 'content/contracts/w09/release-state.json');
  const lockPath = path.join(repoRoot, 'content/contracts/w09/publication.lock');
  const { loadW09VerifiedComposition } = await import('./contract-w09-compose.mjs');

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
        const composition = await loadW09VerifiedComposition({
          repoRoot,
          sourceRoot: options.sourceRoot,
          releaseId: sourceReleaseId,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        if (composition.status !== 'verified' || composition.gate.status !== 'ready-for-release-allocation') {
          return { status: 'pending', sourceReleaseId, gate: composition.gate ?? { status: composition.status, reason: composition.reason } };
        }
        if (result.gameReleaseId !== composition.candidate.manifest.gameReleaseId || result.inputDigest !== composition.inputDigest) {
          throw new Error('prepared Web allocation does not map to the verified Source release composition');
        }
        preparedBySourceRelease.push({ sourceReleaseId, webReleaseId: result.releaseId, composition });
      }

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

async function finalizeW09Candidate(original, contentVersion) {
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
  const { validateW08Candidate } = await import('./contract-w08-build.mjs');
  validateW08Candidate(candidate);
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
