import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { safeRepoPath, validateMappingEntry, verifyLedgerBundle } from './contract-w03-ledger.mjs';
import {
  MODS_COMMIT,
  validateMappingEntry as validateModsMappingEntry,
  verifyEntryFragment as verifyModsEntryFragment,
} from './contract-w03-mods.mjs';

export const W14_OVERLAY_ENTRY_SCHEMA = 'w14.mapping-overlay-entry.v1';
export const W14_OVERLAY_SHARD_SCHEMA = 'w14.mapping-overlay-shard.v1';
export const W14_OVERLAY_MANIFEST_SCHEMA = 'w14.mapping-overlay-manifest.v1';

const DISPOSITIONS = new Set([
  'migrated', 'archived-readable', 'private-restorable', 'kept',
  'deduplicated-with-evidence', 'deferred-w15', 'excluded',
]);
const OUTCOME_STATUSES = new Set([
  'migrated', 'archived-readable', 'private-restorable', 'kept',
  'deduplicated-with-evidence', 'deferred-w15', 'excluded', 'gap',
]);
const REVIEW_STATES = new Set(['pending', 'not-applicable', 'verified-reuse']);
const COMPLETE_OUTCOMES = new Set([
  'migrated', 'archived-readable', 'private-restorable', 'kept', 'deduplicated-with-evidence',
]);
const issue = (code, message, path = '/') => ({ code, message, path });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function legacyWeaponIdentityMatches(record, sourceEntityKey, targetFieldPath) {
  if (record?.kind !== 'weapon' || sourceEntityKey?.kind !== 'legacy-id') return false;
  if (record.payload?.templateKey === sourceEntityKey.value) return true;
  if (!['primary', 'secondary'].includes(sourceEntityKey.value)) return false;
  const match = /^\/payload\/displayedAttacks\/([01])\/.+$/u.exec(targetFieldPath ?? '');
  const expectedIndex = sourceEntityKey.value === 'primary' ? '0' : '1';
  return match?.[1] === expectedIndex
    && record.payload?.displayedAttacks?.[Number(expectedIndex)]?.key === sourceEntityKey.value;
}
const M01_MANIFEST_PATH = 'content/legacy/mods/241ad76/m01-manifest.json';
const M01_ARCHIVE_COMMIT = '805fa5ea3df2482419c967b4e82d019b65338065';
const M01_MANIFEST_SHA256 = '9437100b28c375d2a49df1f8e65d8848d61ed7187a3fb104d60ec63d03d1fd99';
const M01_MANIFEST_BYTES = 2133770;
const M01_MANIFEST_BLOB = 'c8acb5612a14b11df5e75f7c76351f00ed22e79c';
const M01_INVENTORY_SHA256 = 'ee841b36463248003cf490344979170fb67b860ea39b70295dcc4c65a8de3307';
const M01_LEDGER_SHA256 = '90d1d27ed7673db16ff3c5b82640f2af7847466fc5a7a4fcd7d1f9795ee9af16';
const SOURCE_CURRENT_RECONCILIATION_PATH = 'docs/contracts/w14/source-current-row-reconciliation.json';
const WEB_CURRENT_RECONCILIATION_PATH = 'docs/contracts/w14/web-current-row-reconciliation.json';

/**
 * Classify a frozen current-row mapping after the caller has recomputed the receipt digests
 * with the pinned Source validator. Metadata is accepted only when the caller has an exact
 * owner/schema/manifest mapping; gameplay fields require a current approved receipt that
 * covers either the field directly or through the receipt dependency closure.
 */
export function classifyW14CurrentFieldEvidence({
  identityMatches,
  targetExists,
  sourceMatchesTarget,
  metadataOnly = false,
  directReceipts = [],
  dependencyReceipts = [],
}) {
  if (identityMatches !== true) return { status: 'identity-conflict' };
  if (targetExists !== true) return { status: 'target-missing' };
  const hasVerifiedApproval = receipts => receipts.some(receipt => receipt?.decision === 'approved'
    && receipt?.state === 'approved'
    && receipt?.targetDigestMatches === true
    && receipt?.dependenciesDigestMatches === true);
  if (hasVerifiedApproval(directReceipts)) {
    return { status: sourceMatchesTarget === true ? 'approved-exact-field-reuse' : 'approved-field-rewrite' };
  }
  if (hasVerifiedApproval(dependencyReceipts)) {
    return { status: sourceMatchesTarget === true ? 'approved-exact-dependency-reuse' : 'approved-dependency-rewrite' };
  }
  if (metadataOnly === true) return { status: 'verified-metadata-mapping' };
  return { status: 'review-required' };
}

/**
 * Validate a generated row-level W14 Web crosswalk against the exact frozen W03 rows.
 * This checks inventory coverage and evidence shape; it does not grant review or turn an
 * unresolved row into an approved migration.
 */
export function validateW14WebRowReconciliation(report, sourceRows) {
  const issues = [];
  const add = (code, message, path = '/') => issues.push(issue(code, message, path));
  const dispositions = new Set([
    'approved-current-reuse', 'approved-current-rewrite', 'metadata-mapped',
    'deferred-w15', 'unresolved-current-gap',
  ]);
  if (!isObject(report) || report.schemaVersion !== 'w14.web-current-row-reconciliation.v1'
    || !Array.isArray(report.rows) || !Array.isArray(sourceRows)
    || !/^[a-f0-9]{64}$/u.test(report.sourceLedgerSha256 ?? '')) {
    return [issue('web-row-report-shape', 'report must bind the W14 Web schema, ledger hash, and source/report row arrays')];
  }

  const expected = new Map();
  for (const [index, source] of sourceRows.entries()) {
    if (!isObject(source) || typeof source.entryId !== 'string' || !source.entryId || expected.has(source.entryId)) {
      add('web-row-source-identity', 'source row identities must be present and unique', `/sourceRows/${index}`);
      continue;
    }
    expected.set(source.entryId, source);
  }
  const seen = new Set();
  for (const [index, row] of report.rows.entries()) {
    const rowPath = `/rows/${index}`;
    if (!isObject(row) || typeof row.entryId !== 'string' || !row.entryId) {
      add('web-row-identity', 'report row identity is required', rowPath);
      continue;
    }
    if (seen.has(row.entryId)) {
      add('web-row-duplicate', 'report row identity is duplicated', `${rowPath}/entryId`);
      continue;
    }
    seen.add(row.entryId);
    const source = expected.get(row.entryId);
    if (!source) {
      add('web-row-unexpected', 'report contains a row outside the fixed W03 Web scope', rowPath);
      continue;
    }
    const expectedRowSha = rowDigest(source);
    if (row.sourceRowSha256 !== expectedRowSha || !sameJson(row.source, source.source)
      || !sameJson(row.selector, source.selector) || !sameJson(row.sourceFragment, source.fragment)) {
      add('web-row-source-binding', 'report row must retain the exact W03 row digest, source, selector, and fragment binding', rowPath);
    }
    if (!dispositions.has(row.disposition)) {
      add('web-row-disposition', 'report row must have an explicit current, metadata, W15, or unresolved disposition', `${rowPath}/disposition`);
      continue;
    }
    if (row.disposition === 'deferred-w15') {
      if (source.owner !== 'web' || !source.selector?.locator?.startsWith('/announcements/')) {
        add('web-row-deferred-scope', 'only frozen announcement rows may be deferred to W15', `${rowPath}/disposition`);
      }
      if (row.scopeOwner !== 'W15' || typeof row.reason !== 'string' || !row.reason) {
        add('web-row-deferred-reason', 'W15 deferral must state its owner and reason', rowPath);
      }
      continue;
    }
    if (row.disposition === 'approved-current-reuse' || row.disposition === 'approved-current-rewrite') {
      const mapping = row.currentMapping;
      const targets = row.evidence?.ownerCandidateTargets;
      const validTargets = Array.isArray(targets) && targets.length > 0 && targets.every(target =>
        isObject(target) && typeof target.mode === 'string' && typeof target.targetId === 'string'
        && typeof target.ownerId === 'string' && typeof target.ownerKind === 'string'
        && typeof target.fieldPath === 'string' && typeof target.dimension === 'string'
        && /^[a-f0-9]{64}$/u.test(target.targetDigest ?? '')
        && /^[a-f0-9]{64}$/u.test(target.dependenciesDigest ?? '')
        && target.candidateState === 'approved' && target.receiptMatchesPinnedOwnerCandidate === true);
      if (!isObject(mapping) || typeof mapping.ownerId !== 'string' || typeof mapping.fieldPath !== 'string' || !validTargets) {
        add('web-row-review-closure', 'approved row requires a precise current owner/path and complete pinned-candidate target/dependency receipt evidence', rowPath);
      }
    } else if (row.disposition === 'metadata-mapped') {
      if (!isObject(row.currentMapping) || typeof row.currentMapping.kind !== 'string'
        || typeof row.mappingBasis !== 'string' || !row.mappingBasis) {
        add('web-row-metadata-proof', 'metadata rows require an explicit compiler/schema mapping basis', rowPath);
      }
    } else if (row.disposition === 'unresolved-current-gap') {
      if (typeof row.reason !== 'string' || !row.reason || !isObject(row.currentMapping)) {
        add('web-row-gap-reason', 'current required gaps must retain their failed mapping and reason', rowPath);
      }
    }
  }
  for (const entryId of expected.keys()) {
    if (!seen.has(entryId)) add('web-row-coverage', `fixed W03 Web row is missing from the report: ${entryId}`, '/rows');
  }
  return issues;
}

/**
 * Reconcile W03's pinned Source-code weapon registry with exact current-release Source records.
 * Registry membership is source identity only; this function never treats a registry key as
 * player availability or assigns a game release to a registry group.
 */
export function reconcileW14WeaponRegistry({ registryEntries, currentRecords, gameReleaseId, approvalEvidence = [] }) {
  const invalid = (code, message) => ({ valid: false, issues: [issue(code, message)], rows: [], summary: null });
  if (!Array.isArray(registryEntries) || !Array.isArray(currentRecords) || !Array.isArray(approvalEvidence)
    || typeof gameReleaseId !== 'string' || !gameReleaseId) {
    return invalid('registry-input-shape', 'registry entries, current records, approval evidence, and exact gameReleaseId are required');
  }

  const parsedEntries = [];
  const entryIds = new Set();
  const groupIndexes = new Map();
  for (const entry of registryEntries) {
    if (!isObject(entry) || typeof entry.entryId !== 'string' || !entry.entryId
      || typeof entry.registryKey !== 'string' || !entry.registryKey
      || entryIds.has(entry.entryId)) {
      return invalid('registry-entry-identity', 'registry entry identity is missing or duplicated');
    }
    entryIds.add(entry.entryId);
    const groupMatch = typeof entry.selector === 'string' && /^template_groups\[(0|[1-9]\d*)\]\.group-key$/u.exec(entry.selector);
    const memberMatch = typeof entry.selector === 'string' && /^template_groups\[(0|[1-9]\d*)\]\.members\[(0|[1-9]\d*)\]$/u.exec(entry.selector);
    if (entry.registryKind === 'template-group' && groupMatch) {
      const groupIndex = Number(groupMatch[1]);
      if (groupIndexes.has(groupIndex)) return invalid('registry-group-duplicate', 'one Source registry group index has multiple group identities');
      groupIndexes.set(groupIndex, entry);
      parsedEntries.push({ entry, kind: 'group', groupIndex, memberIndex: null });
    } else if (entry.registryKind === 'template-member' && memberMatch) {
      parsedEntries.push({ entry, kind: 'member', groupIndex: Number(memberMatch[1]), memberIndex: Number(memberMatch[2]) });
    } else {
      return invalid('registry-entry-selector', 'registry kind and Source template selector do not agree');
    }
  }

  const seenMemberPositions = new Set();
  for (const parsed of parsedEntries) {
    if (parsed.kind !== 'member') continue;
    const position = `${parsed.groupIndex}:${parsed.memberIndex}`;
    if (seenMemberPositions.has(position)) return invalid('registry-member-duplicate', 'Source registry member selector is duplicated');
    seenMemberPositions.add(position);
    if (!groupIndexes.has(parsed.groupIndex)) return invalid('registry-member-parent-missing', 'Source registry member has no exact group row');
  }

  const currentByTemplateKey = new Map();
  const currentRecordIds = new Set();
  for (const record of currentRecords) {
    if (!isObject(record) || typeof record.recordId !== 'string' || !record.recordId
      || typeof record.gameReleaseId !== 'string' || !record.gameReleaseId || typeof record.kind !== 'string') {
      return invalid('current-record-identity', 'current Source record identity is malformed');
    }
    const recordKey = `${record.gameReleaseId}\u0000${record.recordId}`;
    if (currentRecordIds.has(recordKey)) return invalid('current-record-duplicate', 'current Source record identity is duplicated');
    currentRecordIds.add(recordKey);
    if (record.gameReleaseId !== gameReleaseId || record.kind !== 'weapon') continue;
    const templateKey = record.payload?.templateKey;
    if (typeof templateKey !== 'string' || !templateKey) return invalid('current-weapon-template-key', 'current weapon record has no exact templateKey');
    const matches = currentByTemplateKey.get(templateKey) ?? [];
    matches.push(record);
    currentByTemplateKey.set(templateKey, matches);
  }

  const validApprovalEvidence = new Map();
  for (const evidence of approvalEvidence) {
    if (!isObject(evidence) || typeof evidence.recordId !== 'string' || typeof evidence.gameReleaseId !== 'string') continue;
    if (evidence.gameReleaseId !== gameReleaseId || evidence.decision !== 'approved' || evidence.state !== 'approved'
      || evidence.targetDigestMatches !== true || evidence.dependenciesDigestMatches !== true
      || !/^[a-f0-9]{64}$/u.test(evidence.targetDigest ?? '')
      || !/^[a-f0-9]{64}$/u.test(evidence.dependenciesDigest ?? '')) continue;
    const key = `${evidence.gameReleaseId}\u0000${evidence.recordId}`;
    const rows = validApprovalEvidence.get(key) ?? [];
    rows.push({
      fieldPath: typeof evidence.fieldPath === 'string' ? evidence.fieldPath : null,
      dimension: typeof evidence.dimension === 'string' ? evidence.dimension : null,
      targetDigest: evidence.targetDigest,
      dependenciesDigest: evidence.dependenciesDigest,
    });
    validApprovalEvidence.set(key, rows);
  }

  const members = parsedEntries.filter(item => item.kind === 'member').map(({ entry, groupIndex }) => {
    const matches = [...(currentByTemplateKey.get(entry.registryKey) ?? [])].sort((left, right) => left.recordId.localeCompare(right.recordId));
    const matchIds = matches.map(record => record.recordId);
    const approvedMatches = matches.filter(record => validApprovalEvidence.has(`${gameReleaseId}\u0000${record.recordId}`));
    let classification = 'no-exact-current-source-record';
    if (matches.length > 1) classification = 'ambiguous-current-source-record';
    else if (matches.length === 1 && approvedMatches.length === 1) classification = 'exact-current-source-record-with-approved-digest-evidence';
    else if (matches.length === 1) classification = 'exact-current-source-record-without-valid-approved-digest-evidence';
    return {
      entryId: entry.entryId,
      registryKind: entry.registryKind,
      registryKey: entry.registryKey,
      selector: entry.selector,
      gameReleaseId,
      classification,
      currentRecordIds: matchIds,
      approvedFieldEvidence: approvedMatches.flatMap(record => validApprovalEvidence.get(`${gameReleaseId}\u0000${record.recordId}`)),
      groupIndex,
    };
  });
  const memberByGroup = new Map();
  for (const member of members) {
    const rows = memberByGroup.get(member.groupIndex) ?? [];
    rows.push(member);
    memberByGroup.set(member.groupIndex, rows);
  }
  const rows = parsedEntries.map(({ entry, kind, groupIndex }) => {
    if (kind === 'member') return members.find(member => member.entryId === entry.entryId);
    const linkedIds = [...new Set((memberByGroup.get(groupIndex) ?? []).flatMap(member => member.currentRecordIds))].sort();
    return {
      entryId: entry.entryId,
      registryKind: entry.registryKind,
      registryKey: entry.registryKey,
      selector: entry.selector,
      gameReleaseId: null,
      classification: linkedIds.length ? 'registry-group-without-release-identity-linked-to-current-records' : 'registry-group-without-current-record-link',
      associatedCurrentRecordIds: linkedIds,
      memberEntryIds: (memberByGroup.get(groupIndex) ?? []).map(member => member.entryId),
    };
  });
  const countClass = classification => members.filter(member => member.classification === classification).length;
  const summary = {
    registryEntries: rows.length,
    groupEntries: rows.filter(row => row.registryKind === 'template-group').length,
    memberEntries: members.length,
    exactCurrentRecordMatches: members.filter(member => member.currentRecordIds.length === 1).length,
    approvedCurrentRecordMatches: countClass('exact-current-source-record-with-approved-digest-evidence'),
    ambiguousCurrentMatches: countClass('ambiguous-current-source-record'),
    unmatchedMembers: countClass('no-exact-current-source-record'),
    groupsLinkedToCurrentRecords: rows.filter(row => row.registryKind === 'template-group' && row.associatedCurrentRecordIds.length).length,
    playerAvailabilityInferred: false,
  };
  return { valid: true, issues: [], gameReleaseId, rows, summary };
}

function rowDigest(entry) {
  return createHash('sha256').update(JSON.stringify(entry), 'utf8').digest('hex');
}

function gitBlobOid(bytes) {
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, 'utf8'), bytes])).digest('hex');
}

function valueAtJsonPointer(document, locator) {
  if (locator === '') return document;
  if (typeof locator !== 'string' || !locator.startsWith('/')) throw new Error('completion selector is not a JSON Pointer');
  const tokens = locator.slice(1).split('/').map(token => {
    if (/~(?![01])/u.test(token)) throw new Error('completion selector contains an invalid JSON Pointer escape');
    return token.replace(/~1/gu, '/').replace(/~0/gu, '~');
  });
  let value = document;
  for (const token of tokens) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, token)) {
      throw new Error(`completion selector does not resolve: ${locator}`);
    }
    value = value[token];
  }
  return value;
}

function jsonPointerTokens(locator) {
  if (typeof locator !== 'string' || !locator.startsWith('/')) return null;
  const tokens = locator.slice(1).split('/');
  if (tokens.some(token => /~(?![01])/u.test(token))) return null;
  return tokens.map(token => token.replace(/~1/gu, '/').replace(/~0/gu, '~'));
}

/**
 * Resolve a missing legacy payload leaf only to the existing payload container that an
 * already-verified current receipt covers. This records a real parent replacement (for
 * example an empty array or whole typed payload), never a virtual child locator.
 */
export function resolveW14ApprovedCurrentParent({ currentRecord, proposedFieldPath, approvedFieldPath }) {
  if (!isObject(currentRecord)) return null;
  const proposedTokens = jsonPointerTokens(proposedFieldPath);
  const approvedTokens = jsonPointerTokens(approvedFieldPath);
  if (!proposedTokens || !approvedTokens || proposedTokens[0] !== 'payload' || approvedTokens[0] !== 'payload'
    || approvedTokens.length >= proposedTokens.length
    || !approvedTokens.every((token, index) => proposedTokens[index] === token)) return null;

  let approvedValue;
  try { approvedValue = valueAtJsonPointer(currentRecord, approvedFieldPath); }
  catch { return null; }

  try {
    valueAtJsonPointer(currentRecord, proposedFieldPath);
    return null;
  } catch {
    return { fieldPath: approvedFieldPath, value: approvedValue, proposedFieldAbsent: true };
  }
}

function createVerificationCache() {
  return {
    pinnedBytes: new Map(), parsedJson: new Map(), decodedArchives: new Map(), workspaceBytes: new Map(),
    workspaceJson: new Map(), sourcePacketBytes: new Map(), sourcePacketJson: new Map(), archiveFileIndexes: new Map(),
  };
}

function archiveFileIndex(manifest, cache, key, identityKey) {
  if (cache.archiveFileIndexes.has(key)) return cache.archiveFileIndexes.get(key);
  const index = new Map();
  for (const file of manifest.files ?? []) {
    const fileKey = identityKey(file);
    if (typeof fileKey !== 'string' || index.has(fileKey)) {
      throw new Error('W14 archive manifest contains a duplicate or malformed source-file identity');
    }
    index.set(fileKey, file);
  }
  cache.archiveFileIndexes.set(key, index);
  return index;
}

export function m01ArchiveFileSourceKey(manifest, file) {
  const sourceCommit = file?.sourceCommit ?? manifest?.sourceCommit;
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '') || typeof file?.sourcePath !== 'string'
    || !/^[a-f0-9]{40}$/u.test(file?.gitBlobOid ?? '')
    || (file.sourceCommit !== undefined && file.sourceCommit !== manifest.sourceCommit)) {
    throw new Error('W14 M01 archive file has an invalid or conflicting source identity');
  }
  return `${sourceCommit}\u0000${file.sourcePath}\u0000${file.gitBlobOid}`;
}

function pinnedArtifactKey(descriptor) {
  return JSON.stringify([descriptor.repoId, descriptor.commit, descriptor.path,
    descriptor.fileSha256, descriptor.byteLength, descriptor.gitBlobOid]);
}

async function readPinnedArtifact(readArtifact, descriptor, verificationCache) {
  const key = pinnedArtifactKey(descriptor);
  if (verificationCache.pinnedBytes.has(key)) return verificationCache.pinnedBytes.get(key);
  const bytes = Buffer.from(await readArtifact({ repoId: descriptor.repoId, commit: descriptor.commit, path: descriptor.path }));
  if (bytes.length !== descriptor.byteLength || createHash('sha256').update(bytes).digest('hex') !== descriptor.fileSha256
    || gitBlobOid(bytes) !== descriptor.gitBlobOid) {
    throw new Error(`W14 completion artifact integrity mismatch: ${descriptor.repoId}:${descriptor.commit}:${descriptor.path}`);
  }
  verificationCache.pinnedBytes.set(key, bytes);
  return bytes;
}

function parsePinnedJson(bytes, descriptor, verificationCache, invalidMessage) {
  const key = pinnedArtifactKey(descriptor);
  if (verificationCache.parsedJson.has(key)) return verificationCache.parsedJson.get(key);
  let document;
  try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error(invalidMessage); }
  verificationCache.parsedJson.set(key, document);
  return document;
}

async function readWorkspaceW14Report(readArtifact, descriptor, verificationCache) {
  const key = JSON.stringify([descriptor.path, descriptor.reportSha256, descriptor.reportByteLength]);
  if (verificationCache.workspaceBytes.has(key)) return verificationCache.workspaceBytes.get(key);
  const bytes = Buffer.from(await readArtifact({ repoId: 'web', commit: 'working-tree', path: descriptor.path }));
  if (bytes.length !== descriptor.reportByteLength
    || createHash('sha256').update(bytes).digest('hex') !== descriptor.reportSha256) {
    throw new Error('metadata reconciliation report integrity mismatch');
  }
  verificationCache.workspaceBytes.set(key, bytes);
  return bytes;
}

async function readSourcePacketDocument(readArtifact, descriptor, verificationCache) {
  const key = JSON.stringify([descriptor.releaseId, descriptor.archiveSha256, descriptor.packetPath,
    descriptor.fileSha256, descriptor.byteLength]);
  if (!verificationCache.sourcePacketBytes.has(key)) {
    const bytes = Buffer.from(await readArtifact({
      repoId: 'source', releaseId: descriptor.releaseId, archiveSha256: descriptor.archiveSha256,
      path: descriptor.packetPath,
    }));
    if (bytes.length !== descriptor.byteLength
      || createHash('sha256').update(bytes).digest('hex') !== descriptor.fileSha256) {
      throw new Error('W14 public Source packet asset integrity mismatch');
    }
    verificationCache.sourcePacketBytes.set(key, bytes);
  }
  if (!verificationCache.sourcePacketJson.has(key)) {
    let document;
    try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(verificationCache.sourcePacketBytes.get(key))); }
    catch { throw new Error('W14 Source packet target is not valid UTF-8 JSON'); }
    verificationCache.sourcePacketJson.set(key, document);
  }
  return verificationCache.sourcePacketJson.get(key);
}

async function readWorkspaceW14ReportDocument(readArtifact, descriptor, verificationCache) {
  const key = JSON.stringify([descriptor.path, descriptor.reportSha256, descriptor.reportByteLength]);
  if (!verificationCache.workspaceJson.has(key)) {
    const bytes = await readWorkspaceW14Report(readArtifact, descriptor, verificationCache);
    let report;
    try { report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error('metadata reconciliation report is not valid UTF-8 JSON'); }
    verificationCache.workspaceJson.set(key, report);
  }
  return verificationCache.workspaceJson.get(key);
}

async function verifyMetadataReconciliationRow({ sourceEntry, decision, destination, readArtifact, verificationCache }) {
  const report = await readWorkspaceW14ReportDocument(readArtifact, destination, verificationCache);
  const row = report.rows?.[destination.rowIndex];
  const rowDigestMatches = row?.sourceRowSha256 === rowDigest(sourceEntry)
    && row?.entryId === sourceEntry.entryId && row.sourceRowSha256 === destination.sourceRowSha256;
  const reportDecision = row?.decision ?? null;
  const reportStatus = typeof reportDecision?.status === 'string' ? reportDecision.status : row?.disposition;
  const reportDecisionSha256 = reportDecision
    ? createHash('sha256').update(JSON.stringify(reportDecision), 'utf8').digest('hex')
    : createHash('sha256').update(JSON.stringify({
      disposition: row?.disposition, currentMapping: row?.currentMapping, mappingBasis: row?.mappingBasis,
    }), 'utf8').digest('hex');
  if (!rowDigestMatches || reportStatus !== destination.decisionStatus
    || reportDecisionSha256 !== destination.decisionSha256
    || decision.actualOutcome.reportStatus !== destination.decisionStatus) {
    throw new Error('metadata reconciliation row does not match the fixed source entry and decision');
  }
}

async function verifySourceIdentityAssignment({ sourceEntry, destination, readArtifact, verificationCache }) {
  const assignment = destination.identityAssignment;
  if (!assignment || assignment.kind !== 'w03-not-generated-target-assignment'
    || assignment.reportPath !== SOURCE_CURRENT_RECONCILIATION_PATH
    || assignment.entryId !== sourceEntry?.entryId || assignment.sourceRowSha256 !== rowDigest(sourceEntry)
    || !sameJson(assignment.sourceEntityKey, sourceEntry?.sourceEntityKey)) {
    throw new Error('W14 Source identity assignment is not bound to the exact not-generated W03 row');
  }
  const report = await readWorkspaceW14ReportDocument(readArtifact, {
    path: assignment.reportPath,
    reportSha256: assignment.reportSha256,
    reportByteLength: assignment.reportByteLength,
  }, verificationCache);
  const row = report.rows?.[assignment.rowIndex];
  const rowTarget = row?.decision?.target;
  const decisionSha256 = row?.decision
    ? createHash('sha256').update(JSON.stringify(row.decision), 'utf8').digest('hex') : null;
  const identityAssignmentValid = assignment.sourceEntityKey?.kind === 'stable-id'
    ? rowTarget?.recordId === assignment.sourceEntityKey.value
    : assignment.sourceEntityKey?.kind === 'legacy-id' && typeof assignment.sourceEntityKey.value === 'string'
      && assignment.sourceEntityKey.value.length > 0
      || assignment.sourceEntityKey?.kind === 'record-index'
        && /^(0|[1-9][0-9]*)$/u.test(assignment.sourceEntityKey.value ?? '');
  if (!Number.isSafeInteger(assignment.rowIndex) || assignment.rowIndex < 0
    || row?.entryId !== sourceEntry.entryId || row.sourceRowSha256 !== rowDigest(sourceEntry)
    || row.sourceRowSha256 !== assignment.sourceRowSha256
    || row.decision?.status !== assignment.decisionStatus || decisionSha256 !== assignment.decisionSha256
    || !sameJson(rowTarget, assignment.target)
    || rowTarget?.gameReleaseId !== destination.gameReleaseId || rowTarget?.recordId !== destination.recordId
    || rowTarget?.kind !== assignment.target?.kind || rowTarget?.fieldPath !== assignment.target?.fieldPath
    || rowTarget?.gameReleaseId !== sourceEntry.scope?.gameReleaseId
    || sourceEntry.target?.status !== 'not-generated' || sourceEntry.target.recordId !== null
    || !identityAssignmentValid) {
    throw new Error('W14 identity assignment report row does not bind the exact W03 source and assigned target');
  }
}

async function verifySourceApprovalClosure({ sourceEntry, decision, closure, readArtifact, verificationCache }) {
  const report = await readWorkspaceW14ReportDocument(readArtifact, {
    path: closure.reportPath,
    reportSha256: closure.reportSha256,
    reportByteLength: closure.reportByteLength,
  }, verificationCache);
  const row = report.rows?.[closure.rowIndex];
  const decisionSha256 = row?.decision
    ? createHash('sha256').update(JSON.stringify(row.decision), 'utf8').digest('hex') : null;
  const evidenceSet = report.rowEvidenceIndex?.approvalEvidenceSets?.[closure.approvalEvidenceSetId];
  if (closure.reportPath !== SOURCE_CURRENT_RECONCILIATION_PATH
    || row?.entryId !== sourceEntry?.entryId || row.sourceRowSha256 !== rowDigest(sourceEntry)
    || row.sourceRowSha256 !== closure.sourceRowSha256
    || row.decision?.status !== closure.decisionStatus || decisionSha256 !== closure.decisionSha256
    || row.decision?.approvalEvidenceSetId !== closure.approvalEvidenceSetId
    || decision.actualOutcome.approvalEvidenceSetId !== closure.approvalEvidenceSetId
    || !Array.isArray(evidenceSet) || evidenceSet.length !== closure.references.length) {
    throw new Error('W14 Source approval closure does not match the exact fixed reconciliation row and evidence set');
  }
  const matchedEvidenceIndexes = new Set();
  for (const reference of closure.references) {
    const matches = evidenceSet.map((evidence, index) => ({ evidence, index })).filter(({ evidence }) => {
      const attestation = evidence?.candidateReceipt ?? evidence;
      const coveredFieldPath = evidence?.coveredBy?.fieldPath ?? attestation?.fieldPath;
      const coveredDimension = evidence?.coveredBy?.dimension ?? attestation?.dimension;
      const coveredBy = evidence?.coveredBy === undefined ? null : { fieldPath: coveredFieldPath, dimension: coveredDimension };
      return sameJson(reference.coveredBy, coveredBy)
        && reference.attestation?.gameReleaseId === attestation?.gameReleaseId
        && reference.attestation?.recordId === attestation?.recordId
        && reference.attestation?.fieldPath === attestation?.fieldPath
        && reference.attestation?.dimension === attestation?.dimension
        && reference.attestation?.targetDigest === attestation?.targetDigest
        && reference.attestation?.dependenciesDigest === attestation?.dependenciesDigest;
    });
    if (matches.length !== 1 || matchedEvidenceIndexes.has(matches[0].index)) {
      throw new Error('W14 Source approval closure reference differs from the fixed evidence set');
    }
    matchedEvidenceIndexes.add(matches[0].index);
  }
}

async function verifyActionProfileResolutionProof({ sourceEntry, decision, destination, readArtifact, verificationCache }) {
  const proof = destination.resolutionProof;
  if (!proof || proof.kind !== 'w03-approved-action-profile-resolution'
    || proof.reportPath !== SOURCE_CURRENT_RECONCILIATION_PATH
    || proof.entryId !== sourceEntry?.entryId || proof.sourceRowSha256 !== rowDigest(sourceEntry)) {
    throw new Error('W14 action-profile resolution proof is not bound to its exact W03 row');
  }
  const report = await readWorkspaceW14ReportDocument(readArtifact, {
    path: proof.reportPath,
    reportSha256: proof.reportSha256,
    reportByteLength: proof.reportByteLength,
  }, verificationCache);
  const row = report.rows?.[proof.rowIndex];
  const rowDecision = row?.decision;
  const decisionSha256 = rowDecision
    ? createHash('sha256').update(JSON.stringify(rowDecision), 'utf8').digest('hex') : null;
  const receiptSet = report.rowEvidenceIndex?.approvalEvidenceSets?.[proof.approvedReceiptsSetId];
  const receipt = Array.isArray(receiptSet) && receiptSet.length === 1 ? receiptSet[0] : null;
  const requiresIdentityAssignment = sourceEntry?.target?.status === 'not-generated' && sourceEntry.target.recordId === null;
  const identityAssignment = destination.identityAssignment;
  const assignedActionTargetMatches = requiresIdentityAssignment
    ? identityAssignment?.kind === 'w03-not-generated-target-assignment'
      && sameJson(identityAssignment.sourceEntityKey, sourceEntry.sourceEntityKey)
      && identityAssignment.target?.gameReleaseId === proof.target?.gameReleaseId
      && identityAssignment.target?.recordId === proof.target?.recordId
      && identityAssignment.target?.kind === 'weapon'
      && identityAssignment.target?.fieldPath === proof.target?.fieldPath
    : identityAssignment === undefined;
  if (!Number.isSafeInteger(proof.rowIndex) || proof.rowIndex < 0
    || row?.entryId !== sourceEntry.entryId || row.sourceRowSha256 !== rowDigest(sourceEntry)
    || row.sourceRowSha256 !== proof.sourceRowSha256
    || rowDecision?.status !== proof.decisionStatus
    || rowDecision?.status !== 'legacy-not-imported-coverage-superseded-by-approved-current-action-profile-resolution'
    || decisionSha256 !== proof.decisionSha256
    || rowDecision?.approvedReceiptsSetId !== proof.approvedReceiptsSetId
    || !sameJson(rowDecision?.target, proof.target)
    || proof.target?.gameReleaseId !== destination.gameReleaseId
    || proof.target?.recordId !== destination.recordId
    || proof.target?.gameReleaseId !== sourceEntry.scope?.gameReleaseId
    || (!requiresIdentityAssignment && proof.target?.recordId !== sourceEntry.target?.recordId)
    || !assignedActionTargetMatches
    || proof.target?.fieldPath !== '/payload/actionProfileResolution'
    || proof.target?.kind !== 'weapon'
    || !receipt || receipt.state !== 'approved'
    || receipt.targetDigest !== proof.receipt?.targetDigest
    || receipt.dependenciesDigest !== proof.receipt?.dependenciesDigest
    || proof.receipt?.targetDigest !== decision.actualOutcome.approvedTargetDigest
    || proof.receipt?.dependenciesDigest !== decision.actualOutcome.approvedDependenciesDigest
    || decision.actualOutcome.approvedReceiptsSetId !== proof.approvedReceiptsSetId) {
    throw new Error('W14 action-profile resolution report row or approved receipt set does not match');
  }
}

async function verifyWebOwnerMappingProof({ sourceEntry, decision, destination, readArtifact, verificationCache }) {
  const proof = destination.ownerMappingProof;
  if (!proof || proof.kind !== 'w03-approved-compiled-official-owner-reassignment'
    || proof.reportPath !== WEB_CURRENT_RECONCILIATION_PATH
    || proof.entryId !== sourceEntry?.entryId || proof.sourceRowSha256 !== rowDigest(sourceEntry)) {
    throw new Error('W14 Web owner mapping proof is not bound to its exact W03 row');
  }
  const report = await readWorkspaceW14ReportDocument(readArtifact, {
    path: proof.reportPath,
    reportSha256: proof.reportSha256,
    reportByteLength: proof.reportByteLength,
  }, verificationCache);
  const row = report.rows?.[proof.rowIndex];
  const mapping = row?.currentMapping;
  const decisionSha256 = row
    ? createHash('sha256').update(JSON.stringify({
      disposition: row.disposition, currentMapping: row.currentMapping, mappingBasis: row.mappingBasis,
    }), 'utf8').digest('hex') : null;
  const allowedKinds = ['approved-compiled-official-input-field', 'approved-compiled-official-placeholder'];
  if (!Number.isSafeInteger(proof.rowIndex) || proof.rowIndex < 0
    || row?.entryId !== sourceEntry.entryId || row.sourceRowSha256 !== rowDigest(sourceEntry)
    || !['approved-current-reuse', 'approved-current-rewrite'].includes(row.disposition)
    || decisionSha256 !== proof.decisionSha256
    || !allowedKinds.includes(mapping?.kind)
    || mapping.ownerId !== proof.mappedOwnerId || mapping.ownerKind !== proof.ownerKind
    || mapping.fieldPath !== proof.ownerFieldPath || destination.ownerId !== mapping.ownerId
    || destination.ownerKind !== mapping.ownerKind
    || sourceEntry?.owner !== 'web' || sourceEntry.target?.repoId !== 'web'
    || sourceEntry.target?.recordId !== proof.originalOwnerId
    || sourceEntry.sourceEntityKey?.kind !== 'legacy-id'
    || sourceEntry.sourceEntityKey.value !== proof.originalOwnerId
    || !sourceEntry.target?.fieldPath?.startsWith('/records/')
    || !sourceEntry.target.fieldPath.includes('/payload/official/')
    || !mapping.fieldPath?.startsWith('/officialInputs/sources/')) {
    throw new Error('W14 Web owner mapping report row does not authorize this exact official-input reassignment');
  }
}

async function verifyM01ArchiveEntry({ sourceEntry, destination, readArtifact, verificationCache }) {
  if (sourceEntry?.source?.repoId !== 'mods' || sourceEntry.source.commit !== MODS_COMMIT
    || !sourceEntry.review?.basisRefs?.includes('W03/M01')) {
    throw new Error('M01 archive outcome is not bound to a fixed W03 M01 Mods source row');
  }
  const manifestDescriptor = {
    repoId: destination.manifestRepoId,
    commit: destination.manifestCommit,
    path: destination.manifestPath,
    fileSha256: destination.manifestSha256,
    byteLength: destination.manifestByteLength,
    gitBlobOid: destination.manifestGitBlobOid,
  };
  if (manifestDescriptor.repoId !== 'source' || manifestDescriptor.commit !== M01_ARCHIVE_COMMIT
    || manifestDescriptor.path !== M01_MANIFEST_PATH
    || manifestDescriptor.fileSha256 !== M01_MANIFEST_SHA256 || manifestDescriptor.byteLength !== M01_MANIFEST_BYTES
    || manifestDescriptor.gitBlobOid !== M01_MANIFEST_BLOB) {
    throw new Error('M01 archive outcome does not use the exact pinned Source manifest');
  }
  const manifestBytes = await readPinnedArtifact(readArtifact, manifestDescriptor, verificationCache);
  const manifest = parsePinnedJson(manifestBytes, manifestDescriptor, verificationCache, 'W14 M01 manifest is not valid UTF-8 JSON');
  if (manifest.schema !== 'w14.m01-mods-legacy-archive/1'
    || manifest.archiveRole !== 'historical-mods-content-preservation'
    || manifest.sourceSelection !== 'pinned-git-objects-only' || manifest.currentApproval !== 'not-current-approved'
    || manifest.sourceVersionStatus !== 'unverified' || manifest.readOnly !== true
    || manifest.protectedWorkingTreeBodiesRead !== false || manifest.sourceCommit !== MODS_COMMIT
    || manifest.sourceRepository !== 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods'
    || manifest.inventorySha256 !== M01_INVENTORY_SHA256 || manifest.fileCount !== 3071
    || manifest.rawBytes !== 25070107 || manifest.mapping?.ledgerPath !== 'docs/contracts/w03/mods/mapping-ledger.json'
    || manifest.mapping?.sourceLedgerSha256 !== M01_LEDGER_SHA256 || manifest.mapping?.scopeGroupId !== 'M01'
    || manifest.mapping?.rowCount !== 107060 || !Array.isArray(manifest.files) || manifest.files.length !== manifest.fileCount) {
    throw new Error('W14 M01 manifest is not the fixed historical Mods archive');
  }
  const manifestKey = pinnedArtifactKey(manifestDescriptor);
  const filesBySource = archiveFileIndex(manifest, verificationCache, manifestKey,
    file => m01ArchiveFileSourceKey(manifest, file));
  const archived = filesBySource.get(m01ArchiveFileSourceKey(manifest, {
    sourceCommit: sourceEntry.source.commit,
    sourcePath: sourceEntry.source.path,
    gitBlobOid: sourceEntry.source.gitBlobOid,
  }));
  if (!archived || archived.normalization !== 'raw' || archived.archivePath !== sourceEntry.source.path
    || destination.sourceCommit !== MODS_COMMIT || destination.sourcePath !== sourceEntry.source.path
    || destination.sourceGitBlobOid !== sourceEntry.source.gitBlobOid
    || destination.archivePath !== `content/legacy/mods/241ad76/${archived.archivePath}`
    || destination.sourceSha256 !== archived.sha256 || destination.sourceByteLength !== archived.byteLength) {
    throw new Error('W14 M01 manifest does not contain the exact frozen source file');
  }
  const archivedBytes = await readPinnedArtifact(readArtifact, {
    repoId: 'source', commit: manifestDescriptor.commit, path: destination.archivePath,
    fileSha256: archived.sha256, byteLength: archived.byteLength, gitBlobOid: archived.gitBlobOid,
  }, verificationCache);
  if (verifyModsEntryFragment(sourceEntry, archivedBytes).length) {
    throw new Error('W14 M01 archive does not preserve the exact W03 source fragment');
  }
}

/** Re-open and verify every artifact needed to claim a completed W14 outcome. */
async function verifyW14CompletionEvidenceUsingCache({ sourceEntry, decision, readArtifact, verifyApprovedReuse, verifyPrivateRestoration }, verificationCache) {
  const issues = validateDecision(decision, sourceEntry);
  if (issues.length) throw new Error(`invalid W14 completion evidence for ${sourceEntry?.entryId ?? 'unknown W03 row'}: ${issues[0].code}`);
  const status = decision.actualOutcome.status;
  if (!COMPLETE_OUTCOMES.has(status)) return { verified: false, status };
  const needsArtifactReader = !(status === 'kept' && decision.destination?.kind === 'pinned-source-object'
    && decision.destination.verification === 'fixed-source-ledger-pointer');
  if (needsArtifactReader && typeof readArtifact !== 'function') throw new TypeError('a pinned artifact reader is required for completed W14 outcomes');

  if (['migrated', 'deduplicated-with-evidence'].includes(status)) {
    const destination = decision.destination;
    if (destination.kind === 'reconciliation-row' && decision.actualOutcome.migrationKind === 'metadata-mapping') {
      await verifyMetadataReconciliationRow({ sourceEntry, decision, destination, readArtifact, verificationCache });
    } else if (destination.kind === 'source-packet-file') {
      const document = await readSourcePacketDocument(readArtifact, destination, verificationCache);
      const selectedValue = valueAtJsonPointer(document, destination.selector.locator);
      const selectedSha256 = createHash('sha256').update(JSON.stringify(selectedValue), 'utf8').digest('hex');
      if (selectedSha256 !== destination.fragmentSha256) throw new Error('W14 Source packet selector digest mismatch');
      const needsIdentityAssignment = sourceEntry?.target?.status === 'not-generated' && sourceEntry.target.recordId === null;
      if (needsIdentityAssignment) {
        await verifySourceIdentityAssignment({ sourceEntry, destination, readArtifact, verificationCache });
      } else if (destination.identityAssignment !== undefined
        || destination.recordId !== sourceEntry?.target?.recordId
        || destination.gameReleaseId !== sourceEntry?.scope?.gameReleaseId) {
        throw new Error('W14 Source packet target does not preserve the frozen release and stable record identity');
      }
      if (decision.actualOutcome.migrationKind === 'approved-source-action-profile-resolution') {
        await verifyActionProfileResolutionProof({ sourceEntry, decision, destination, readArtifact, verificationCache });
      }
      if (decision.actualOutcome.migrationKind === 'approved-source-target-reuse') {
        await verifySourceApprovalClosure({
          sourceEntry, decision, closure: decision.actualOutcome.approvedCoverClosure,
          readArtifact, verificationCache,
        });
      }
      if (destination.gameReleaseId !== sourceEntry?.scope?.gameReleaseId) {
        throw new Error('W14 Source packet target does not preserve the frozen release identity');
      }
      const selectedTokens = jsonPointerTokens(destination.selector.locator);
      if (!selectedTokens || selectedTokens[0] !== 'records' || !/^(0|[1-9][0-9]*)$/u.test(selectedTokens[1] ?? '')) {
        throw new Error('W14 Source packet selector does not point into a record');
      }
      const recordIndex = Number(selectedTokens[1]);
      const record = document.records?.[recordIndex];
      if (!record || record.gameReleaseId !== destination.gameReleaseId || record.recordId !== destination.recordId) {
        throw new Error('W14 Source packet selector record identity differs from the destination');
      }
      if (needsIdentityAssignment) {
        const expectedLocator = `/records/${recordIndex}${destination.identityAssignment.target.fieldPath}`;
        if (destination.identityAssignment.target.kind !== record.kind
          || decision.actualOutcome.targetFieldPath !== destination.identityAssignment.target.fieldPath
          || destination.selector.locator !== expectedLocator) {
          throw new Error('W14 Source identity assignment selector does not match its target record and field');
        }
        if (destination.identityAssignment.sourceEntityKey.kind === 'legacy-id'
          && !legacyWeaponIdentityMatches(record, destination.identityAssignment.sourceEntityKey,
            destination.identityAssignment.target.fieldPath)) {
          throw new Error('W14 Source legacy weapon identity does not match the exact packet template or attack key');
        }
      }
    } else {
    const artifactDescriptor = {
      repoId: destination.repoId,
      commit: destination.commit,
      path: destination.path,
      fileSha256: destination.fileSha256,
      byteLength: destination.byteLength,
      gitBlobOid: destination.gitBlobOid,
    };
    const bytes = await readPinnedArtifact(readArtifact, artifactDescriptor, verificationCache);
    const document = parsePinnedJson(bytes, artifactDescriptor, verificationCache, 'W14 completion target is not valid UTF-8 JSON');
    const selectedValue = valueAtJsonPointer(document, destination.selector.locator);
    const selectedSha256 = createHash('sha256').update(JSON.stringify(selectedValue), 'utf8').digest('hex');
    if (selectedSha256 !== destination.fragmentSha256) throw new Error('W14 completion target selector digest mismatch');
    if (sourceEntry?.scope?.releaseScope === 'current-snapshot-candidate'
      && (destination.gameReleaseId !== sourceEntry.scope.gameReleaseId
        || destination.recordId !== sourceEntry.target?.recordId)) {
      throw new Error('W14 completion target does not preserve the frozen current release and stable record identity');
    }
    if (destination.ownerMappingProof !== undefined) {
      await verifyWebOwnerMappingProof({ sourceEntry, decision, destination, readArtifact, verificationCache });
    }
    }
  } else if (status === 'kept' && decision.destination?.kind === 'pinned-source-object') {
    const destination = decision.destination;
    const source = sourceEntry?.source;
    if (!source || destination.repoId !== source.repoId || destination.commit !== source.commit
      || destination.path !== source.path || destination.gitBlobOid !== source.gitBlobOid
      || destination.sourceRowSha256 !== rowDigest(sourceEntry)) {
      throw new Error('kept W14 outcome does not bind the exact fixed source locator');
    }
    if (destination.verification === 'fixed-source-ledger-pointer') {
      if (!['source', 'web', 'extension', 'source-code', 'mods'].includes(destination.repoId)) {
        throw new Error('kept W14 outcome uses an unsupported source owner');
      }
      if (destination.repoId === 'mods' && !['K01', 'K02'].includes(destination.modsGroupId)) {
        throw new Error('kept Mods rows must remain in an explicitly retained W03 group');
      }
      if (destination.repoId !== 'mods' && destination.modsGroupId !== undefined) {
        throw new Error('non-Mods kept rows cannot claim a Mods group');
      }
    } else if (destination.verification === 'source-object-bytes') {
      await readPinnedArtifact(readArtifact, {
        repoId: source.repoId, commit: source.commit, path: source.path,
        fileSha256: destination.fileSha256, byteLength: destination.byteLength, gitBlobOid: source.gitBlobOid,
      }, verificationCache);
    } else {
      throw new Error('kept W14 source object verification policy is unsupported');
    }
  } else if (['archived-readable', 'kept'].includes(status)) {
    const destination = decision.destination;
    if (destination.kind === 'm01-legacy-archive-entry') {
      await verifyM01ArchiveEntry({ sourceEntry, destination, readArtifact, verificationCache });
    } else {
    const manifestDescriptor = {
      repoId: destination.manifestRepoId,
      commit: destination.manifestCommit,
      path: destination.manifestPath,
      fileSha256: destination.manifestSha256,
      byteLength: destination.manifestByteLength,
      gitBlobOid: destination.manifestGitBlobOid,
    };
    const manifestBytes = await readPinnedArtifact(readArtifact, manifestDescriptor, verificationCache);
    const manifest = parsePinnedJson(manifestBytes, manifestDescriptor, verificationCache, 'W14 completion archive manifest is not valid UTF-8 JSON');
    if (manifest.schemaVersion !== 'w14.extension-legacy-archive.v1'
      || manifest.archiveRole !== 'historical-extension-input-preservation'
      || manifest.currentApproval !== 'not-current-approved'
      || manifest.sourceSelection !== 'pinned-git-objects-only'
      || manifest.protectedWorkingTreeBodiesRead !== false) {
      throw new Error('W14 completion archive is not a read-only historical Extension package');
    }
    const manifestKey = pinnedArtifactKey(manifestDescriptor);
    const filesBySource = archiveFileIndex(manifest, verificationCache, manifestKey,
      file => `${file.sourceCommit}\u0000${file.sourcePath}\u0000${file.gitBlobOid}`);
    const archived = filesBySource.get(`${destination.sourceCommit}\u0000${destination.sourcePath}\u0000${destination.sourceGitBlobOid}`);
    if (!archived || archived.archivePath !== destination.archivePath || archived.sha256 !== destination.sourceSha256
      || archived.byteLength !== destination.sourceByteLength || archived.compressedSha256 !== destination.compressedSha256
      || archived.compressedBytes !== destination.compressedBytes) {
      throw new Error('W14 completion archive manifest does not contain the exact frozen source object');
    }
    const archiveKey = JSON.stringify([
      destination.manifestRepoId, destination.manifestCommit, destination.manifestPath,
      destination.manifestSha256, destination.manifestByteLength, destination.manifestGitBlobOid,
      destination.archiveRootPath, destination.archivePath, destination.compressedSha256, destination.compressedBytes,
      destination.sourceCommit, destination.sourcePath, destination.sourceGitBlobOid,
      destination.sourceSha256, destination.sourceByteLength,
    ]);
    if (!verificationCache.decodedArchives.has(archiveKey)) {
      const compressedBytes = Buffer.from(await readArtifact({
        repoId: destination.manifestRepoId,
        commit: destination.manifestCommit,
        path: `${destination.archiveRootPath}/${destination.archivePath}`,
      }));
      if (compressedBytes.length !== destination.compressedBytes
        || createHash('sha256').update(compressedBytes).digest('hex') !== destination.compressedSha256) {
        throw new Error('W14 completion archived payload integrity mismatch');
      }
      let rawBytes;
      try { rawBytes = gunzipSync(compressedBytes, { maxOutputLength: destination.sourceByteLength + 1 }); }
      catch { throw new Error('W14 completion archived payload is not a bounded gzip file'); }
      if (rawBytes.length !== destination.sourceByteLength
        || createHash('sha256').update(rawBytes).digest('hex') !== destination.sourceSha256
        || gitBlobOid(rawBytes) !== destination.sourceGitBlobOid) {
        throw new Error('W14 completion raw archive bytes differ from the frozen source object');
      }
      verificationCache.decodedArchives.set(archiveKey, rawBytes);
    }
    }
  } else if (status === 'private-restorable') {
    if (typeof verifyPrivateRestoration !== 'function'
      || await verifyPrivateRestoration({ sourceEntry, decision }) !== true) {
      throw new Error('W14 private restoration has no verified restore receipt');
    }
  }

  if (decision.review.state === 'verified-reuse') {
    await readPinnedArtifact(readArtifact, decision.review.evidence, verificationCache);
    if (typeof verifyApprovedReuse !== 'function'
      || await verifyApprovedReuse({ sourceEntry, decision, readArtifact }) !== true) {
      throw new Error('W14 verified reuse has no validated approved-target receipt');
    }
  }
  return { verified: true, status, entryId: sourceEntry?.entryId ?? null };
}

export async function verifyW14CompletionEvidence(options) {
  return verifyW14CompletionEvidenceUsingCache(options, createVerificationCache());
}

/** Create one completion verifier whose immutable artifact and decoded-document cache is shared across rows. */
export function createW14CompletionVerifier({ readArtifact, verifyApprovedReuse, verifyPrivateRestoration } = {}) {
  const verificationCache = createVerificationCache();
  return ({ sourceEntry, decision }) => verifyW14CompletionEvidenceUsingCache({
    sourceEntry, decision, readArtifact, verifyApprovedReuse, verifyPrivateRestoration,
  }, verificationCache);
}

function validateDecision(decision, sourceEntry = null) {
  const issues = [];
  if (!isObject(decision) || !DISPOSITIONS.has(decision.disposition)) {
    issues.push(issue('overlay-disposition', 'W14 disposition must use the closed migration disposition set', '/disposition'));
  }
  if (!isObject(decision?.actualOutcome) || !OUTCOME_STATUSES.has(decision.actualOutcome.status)) {
    issues.push(issue('overlay-outcome', 'actualOutcome must use the closed W14 outcome status set', '/actualOutcome/status'));
  } else if (['gap', 'excluded', 'deferred-w15'].includes(decision.actualOutcome.status)
    && (typeof decision.actualOutcome.reason !== 'string' || !decision.actualOutcome.reason.trim())) {
    issues.push(issue('overlay-outcome-reason', 'gap, excluded, or deferred outcomes require a specific reason', '/actualOutcome/reason'));
  }
  if (!isObject(decision?.review) || !REVIEW_STATES.has(decision.review.state)
    || typeof decision.review.carryForward !== 'boolean' || !Array.isArray(decision.review.basisRefs)
    || decision.review.basisRefs.some(item => typeof item !== 'string' || !item.trim())) {
    issues.push(issue('overlay-review', 'review requires an explicit state, carryForward flag, and nonempty string evidence references', '/review'));
  } else if (decision.review.carryForward && (decision.review.state !== 'verified-reuse' || decision.review.basisRefs.length === 0)) {
    issues.push(issue('overlay-review-carry-forward', 'review carry-forward requires verified-reuse and exact evidence references', '/review/carryForward'));
  }
  if (decision?.destination !== null && !isObject(decision?.destination)) {
    issues.push(issue('overlay-destination', 'destination must be null or a structured owner locator', '/destination'));
  }
  const status = decision?.actualOutcome?.status;
  const currentCandidate = sourceEntry?.scope?.releaseScope === 'current-snapshot-candidate';
  if (currentCandidate && decision?.disposition === 'kept') {
    issues.push(issue('overlay-current-kept', 'a current-snapshot candidate cannot be declared kept at its historical source', '/actualOutcome/status'));
  }
  if (currentCandidate && decision?.disposition === 'excluded') {
    issues.push(issue('overlay-current-excluded', 'a current-snapshot candidate cannot be excluded to hide an unresolved required target', '/actualOutcome/status'));
  }
  if (COMPLETE_OUTCOMES.has(status)) {
    if (decision.disposition !== status) {
      issues.push(issue('overlay-completion-disposition', 'a completed outcome must use its matching W14 disposition', '/disposition'));
    }
    if (!isObject(decision.destination)) {
      issues.push(issue('overlay-completion-destination', 'a completed outcome requires a concrete, verifiable destination', '/destination'));
    } else if (status === 'migrated' && decision.actualOutcome.migrationKind === 'metadata-mapping') {
      const destination = decision.destination;
      if (destination.kind !== 'reconciliation-row' || destination.repoId !== 'web'
        || !safeRepoPath(destination.path) || !destination.path.startsWith('docs/contracts/w14/')
        || !/^[a-f0-9]{64}$/u.test(destination.reportSha256 ?? '')
        || !Number.isSafeInteger(destination.reportByteLength) || destination.reportByteLength < 1
        || !Number.isSafeInteger(destination.rowIndex) || destination.rowIndex < 0
        || destination.entryId !== sourceEntry?.entryId || destination.sourceRowSha256 !== rowDigest(sourceEntry)
        || typeof destination.decisionStatus !== 'string' || !destination.decisionStatus
        || !/^[a-f0-9]{64}$/u.test(destination.decisionSha256 ?? '')
        || decision.actualOutcome.migrationKind !== 'metadata-mapping'
        || decision.review?.state !== 'not-applicable' || decision.review?.carryForward !== false
        || decision.actualOutcome?.reportStatus !== destination.decisionStatus) {
        issues.push(issue('overlay-metadata-proof', 'metadata mapping must bind the exact reconciliation report row and preserve non-gameplay review state', '/destination'));
      }
    } else if (['migrated', 'deduplicated-with-evidence'].includes(status)) {
      const destination = decision.destination;
      if (currentCandidate && decision.actualOutcome.migrationKind !== 'metadata-mapping' && (destination.repoId !== sourceEntry.owner
        || (['existing', 'retained'].includes(sourceEntry.target?.status)
          && destination.repoId !== sourceEntry.target.repoId))) {
        issues.push(issue('overlay-current-owner', 'a current migration destination must remain in the frozen W03 owner repository', '/destination/repoId'));
      }
      if (destination.ownerMappingProof !== undefined) {
        const proof = destination.ownerMappingProof;
        const validProof = currentCandidate && decision.actualOutcome.migrationKind === 'approved-web-target-reuse'
          && destination.kind === 'repository-file' && destination.repoId === 'web'
          && sourceEntry?.owner === 'web' && sourceEntry.target?.repoId === 'web'
          && proof.kind === 'w03-approved-compiled-official-owner-reassignment'
          && proof.reportPath === WEB_CURRENT_RECONCILIATION_PATH
          && /^[a-f0-9]{64}$/u.test(proof.reportSha256 ?? '')
          && Number.isSafeInteger(proof.reportByteLength) && proof.reportByteLength > 0
          && Number.isSafeInteger(proof.rowIndex) && proof.rowIndex >= 0
          && proof.entryId === sourceEntry.entryId && proof.sourceRowSha256 === rowDigest(sourceEntry)
          && /^[a-f0-9]{64}$/u.test(proof.decisionSha256 ?? '')
          && proof.originalOwnerId === sourceEntry.target.recordId
          && proof.originalOwnerId === sourceEntry.sourceEntityKey?.value
          && sourceEntry.sourceEntityKey?.kind === 'legacy-id'
          && proof.mappedOwnerId === destination.ownerId
          && proof.mappedOwnerId !== proof.originalOwnerId
          && proof.ownerKind === destination.ownerKind && proof.ownerKind === 'presentation'
          && ['approved-compiled-official-input-field', 'approved-compiled-official-placeholder'].includes(decision.actualOutcome.ownerMappingKind)
          && proof.ownerFieldPath === decision.actualOutcome.ownerFieldPath
          && proof.ownerFieldPath?.startsWith('/officialInputs/sources/')
          && sourceEntry.target.fieldPath?.startsWith('/records/')
          && sourceEntry.target.fieldPath.includes('/payload/official/');
        if (!validProof) issues.push(issue('overlay-web-owner-mapping-proof', 'compiled official input reassignment must bind the exact W03 row and Web reconciliation report row', '/destination/ownerMappingProof'));
      } else if (currentCandidate && sourceEntry?.owner === 'web' && destination.ownerId !== sourceEntry.target?.recordId) {
        issues.push(issue('overlay-web-owner-mapping-proof', 'a Web owner ID change requires the exact compiled official input reassignment proof', '/destination/ownerId'));
      }
      if (decision.actualOutcome.migrationKind === 'metadata-mapping') {
        if (destination.kind !== 'reconciliation-row' || destination.repoId !== 'web') {
          issues.push(issue('overlay-metadata-proof', 'metadata migration must resolve through its fixed reconciliation row', '/destination'));
        }
      } else if (destination.kind === 'source-packet-file') {
        if (destination.repoId !== 'source' || typeof destination.releaseId !== 'string'
          || !/^w09-[a-f0-9]{32}$/u.test(destination.releaseId)
          || !/^[a-f0-9]{64}$/u.test(destination.archiveSha256 ?? '')
          || destination.packetPath !== 'technical.json' || !/^[a-f0-9]{64}$/u.test(destination.fileSha256 ?? '')
          || !Number.isSafeInteger(destination.byteLength) || destination.byteLength < 1
          || destination.selector?.kind !== 'json-pointer' || typeof destination.selector.locator !== 'string'
          || !destination.selector.locator.startsWith('/') || !/^[a-f0-9]{64}$/u.test(destination.fragmentSha256 ?? '')
          || !/^[a-f0-9]{64}$/u.test(destination.gameReleaseId ?? '') && destination.gameReleaseId !== 'darktide:1.13.2'
          || typeof destination.recordId !== 'string' || !destination.recordId.trim()) {
          issues.push(issue('overlay-completion-source-packet', 'Source migration must bind the fixed public technical packet, asset and JSON target selector', '/destination'));
        }
        if (currentCandidate && sourceEntry?.owner === 'source') {
          const sourceTarget = sourceEntry.target;
          const requiresAssignment = sourceTarget?.status === 'not-generated' && sourceTarget.recordId === null;
          const assignment = destination.identityAssignment;
          if (requiresAssignment) {
            const assignedIdentityValid = assignment?.sourceEntityKey?.kind === 'stable-id'
              ? assignment.target?.recordId === assignment.sourceEntityKey.value
              : assignment?.sourceEntityKey?.kind === 'legacy-id'
                && typeof assignment.sourceEntityKey.value === 'string' && assignment.sourceEntityKey.value.length > 0;
            const assignedRecordIndexValid = assignment?.sourceEntityKey?.kind === 'record-index'
              && /^(0|[1-9][0-9]*)$/u.test(assignment.sourceEntityKey.value ?? '');
            const assignmentValid = assignment?.kind === 'w03-not-generated-target-assignment'
              && assignment.reportPath === SOURCE_CURRENT_RECONCILIATION_PATH
              && /^[a-f0-9]{64}$/u.test(assignment.reportSha256 ?? '')
              && Number.isSafeInteger(assignment.reportByteLength) && assignment.reportByteLength > 0
              && Number.isSafeInteger(assignment.rowIndex) && assignment.rowIndex >= 0
              && assignment.entryId === sourceEntry.entryId
              && assignment.sourceRowSha256 === rowDigest(sourceEntry)
              && sameJson(assignment.sourceEntityKey, sourceEntry.sourceEntityKey)
              && ['stable-id', 'legacy-id', 'record-index'].includes(assignment.sourceEntityKey?.kind)
              && (assignedIdentityValid || assignedRecordIndexValid)
              && typeof assignment.decisionStatus === 'string' && assignment.decisionStatus.length > 0
              && /^[a-f0-9]{64}$/u.test(assignment.decisionSha256 ?? '')
              && isObject(assignment.target)
              && assignment.target.gameReleaseId === sourceEntry.scope?.gameReleaseId
              && assignment.target.recordId === destination.recordId
              && assignment.target.kind && typeof assignment.target.kind === 'string'
              && typeof assignment.target.fieldPath === 'string' && assignment.target.fieldPath.startsWith('/')
              && ( /^[a-f0-9]{64}$/u.test(assignment.target.actualValueCanonicalSha256 ?? '')
                || (decision.actualOutcome.migrationKind === 'approved-source-action-profile-resolution'
                  && assignment.target.kind === 'weapon'
                  && assignment.target.fieldPath === '/payload/actionProfileResolution'
                  && !Object.hasOwn(assignment.target, 'actualValueCanonicalSha256')) )
              && destination.gameReleaseId === assignment.target.gameReleaseId
              && decision.actualOutcome.targetFieldPath === assignment.target.fieldPath;
            if (!assignmentValid) {
              issues.push(issue('overlay-source-identity-assignment', 'a not-generated current Source identity requires the exact stable or legacy ID assignment, fixed report row locator, and approved target hash', '/destination/identityAssignment'));
            }
          } else if (destination.identityAssignment !== undefined
            || destination.gameReleaseId !== sourceTarget?.gameReleaseId
            || destination.recordId !== sourceTarget?.recordId) {
            issues.push(issue('overlay-current-source-identity', 'existing or retained Source targets must preserve their original release and record identity', '/destination'));
          }
        }
        if (decision.actualOutcome.migrationKind === 'approved-source-action-profile-resolution') {
          const proof = destination.resolutionProof;
          const requiresActionAssignment = sourceEntry?.target?.status === 'not-generated' && sourceEntry.target.recordId === null;
          const assignment = destination.identityAssignment;
          const actionAssignmentValid = requiresActionAssignment
            ? assignment?.kind === 'w03-not-generated-target-assignment'
              && sameJson(assignment.sourceEntityKey, sourceEntry.sourceEntityKey)
              && assignment.target?.gameReleaseId === proof?.target?.gameReleaseId
              && assignment.target?.recordId === proof?.target?.recordId
              && assignment.target?.kind === 'weapon'
              && assignment.target?.fieldPath === '/payload/actionProfileResolution'
            : assignment === undefined;
          const proofValid = proof?.kind === 'w03-approved-action-profile-resolution'
            && proof.reportPath === SOURCE_CURRENT_RECONCILIATION_PATH
            && /^[a-f0-9]{64}$/u.test(proof.reportSha256 ?? '')
            && Number.isSafeInteger(proof.reportByteLength) && proof.reportByteLength > 0
            && Number.isSafeInteger(proof.rowIndex) && proof.rowIndex >= 0
            && proof.entryId === sourceEntry?.entryId
            && proof.sourceRowSha256 === rowDigest(sourceEntry)
            && proof.decisionStatus === 'legacy-not-imported-coverage-superseded-by-approved-current-action-profile-resolution'
            && /^[a-f0-9]{64}$/u.test(proof.decisionSha256 ?? '')
            && typeof proof.approvedReceiptsSetId === 'string' && proof.approvedReceiptsSetId
            && proof.target?.gameReleaseId === sourceEntry?.scope?.gameReleaseId
            && proof.target?.recordId === destination.recordId
            && proof.target?.kind === 'weapon'
            && proof.target?.fieldPath === '/payload/actionProfileResolution'
            && (requiresActionAssignment || proof.target?.recordId === sourceEntry?.target?.recordId)
            && actionAssignmentValid
            && /^[a-f0-9]{64}$/u.test(proof.receipt?.targetDigest ?? '')
            && /^[a-f0-9]{64}$/u.test(proof.receipt?.dependenciesDigest ?? '')
            && proof.receipt?.state === 'approved'
            && proof.receipt.targetDigest === decision.actualOutcome.approvedTargetDigest
            && proof.receipt.dependenciesDigest === decision.actualOutcome.approvedDependenciesDigest
            && proof.approvedReceiptsSetId === decision.actualOutcome.approvedReceiptsSetId;
          if (!proofValid) {
            issues.push(issue('overlay-source-action-profile-proof', 'action-profile resolution must bind its exact fixed W03 report row, receipt set, and Source packet target', '/destination/resolutionProof'));
          }
        } else if (destination.resolutionProof !== undefined) {
          issues.push(issue('overlay-source-action-profile-proof', 'action-profile resolution proof is allowed only for the fixed approved supersession status', '/destination/resolutionProof'));
        }
      } else if (destination.kind !== 'repository-file' || !['source', 'web'].includes(destination.repoId)
        || !/^[a-f0-9]{40}$/u.test(destination.commit ?? '') || !safeRepoPath(destination.path)
        || !/^[a-f0-9]{64}$/u.test(destination.fileSha256 ?? '')
        || !Number.isSafeInteger(destination.byteLength) || destination.byteLength < 0
        || !/^[a-f0-9]{40}$/u.test(destination.gitBlobOid ?? '')
        || destination.selector?.kind !== 'json-pointer' || typeof destination.selector.locator !== 'string'
        || !destination.selector.locator.startsWith('/')
        || !/^[a-f0-9]{64}$/u.test(destination.fragmentSha256 ?? '')) {
        issues.push(issue('overlay-completion-destination', 'migrated data must bind an exact repo commit, file bytes, selector, and selected-value digest', '/destination'));
      }
    } else if (status === 'kept' && decision.destination?.kind === 'pinned-source-object') {
      const destination = decision.destination;
      const source = sourceEntry?.source;
      if (currentCandidate || !source || destination.repoId !== source.repoId || destination.commit !== source.commit
        || destination.path !== source.path || destination.gitBlobOid !== source.gitBlobOid
        || destination.sourceRowSha256 !== rowDigest(sourceEntry)
        || !['fixed-source-ledger-pointer', 'source-object-bytes'].includes(destination.verification)
        || (destination.verification === 'fixed-source-ledger-pointer' && destination.repoId === 'mods'
          && !['K01', 'K02'].includes(destination.modsGroupId))
        || (destination.verification === 'fixed-source-ledger-pointer' && destination.repoId !== 'mods'
          && destination.modsGroupId !== undefined)
        || (destination.verification === 'source-object-bytes'
          && (!/^[a-f0-9]{64}$/u.test(destination.fileSha256 ?? '') || !Number.isSafeInteger(destination.byteLength) || destination.byteLength < 0))) {
        issues.push(issue('overlay-kept-source-proof', 'kept outcomes must bind the exact noncurrent W03 source locator and verification policy', '/destination'));
      }
    } else if (['archived-readable', 'kept'].includes(status)) {
      const destination = decision.destination;
      if (destination.kind === 'm01-legacy-archive-entry') {
        if (status !== 'archived-readable' || destination.manifestRepoId !== 'source'
          || destination.manifestCommit !== M01_ARCHIVE_COMMIT || destination.manifestPath !== M01_MANIFEST_PATH
          || destination.manifestSha256 !== M01_MANIFEST_SHA256 || destination.manifestByteLength !== M01_MANIFEST_BYTES
          || destination.manifestGitBlobOid !== M01_MANIFEST_BLOB
          || sourceEntry?.source?.repoId !== 'mods' || sourceEntry.source.commit !== MODS_COMMIT
          || !sourceEntry.review?.basisRefs?.includes('W03/M01')
          || destination.sourceCommit !== MODS_COMMIT || destination.sourcePath !== sourceEntry.source.path
          || destination.sourceGitBlobOid !== sourceEntry.source.gitBlobOid
          || destination.archivePath !== `content/legacy/mods/241ad76/${sourceEntry.source.path}`
          || !/^[a-f0-9]{64}$/u.test(destination.sourceSha256 ?? '')
          || !Number.isSafeInteger(destination.sourceByteLength) || destination.sourceByteLength < 0) {
          issues.push(issue('overlay-completion-m01-archive-proof', 'M01 outcomes must bind a fixed Mods source row to the exact public Source manifest and archive path', '/destination'));
        }
      } else if (destination.kind !== 'legacy-archive-entry' || destination.manifestRepoId !== 'source'
        || !/^[a-f0-9]{40}$/u.test(destination.manifestCommit ?? '') || !safeRepoPath(destination.manifestPath)
        || !/^[a-f0-9]{64}$/u.test(destination.manifestSha256 ?? '')
        || !Number.isSafeInteger(destination.manifestByteLength) || destination.manifestByteLength < 1
        || !/^[a-f0-9]{40}$/u.test(destination.manifestGitBlobOid ?? '')
        || !safeRepoPath(destination.archiveRootPath) || !safeRepoPath(destination.archivePath)
        || !/^[a-f0-9]{64}$/u.test(destination.compressedSha256 ?? '')
        || !Number.isSafeInteger(destination.compressedBytes) || destination.compressedBytes < 1
        || destination.sourceCommit !== sourceEntry?.source?.commit || destination.sourcePath !== sourceEntry?.source?.path
        || destination.sourceGitBlobOid !== sourceEntry?.source?.gitBlobOid
        || !/^[a-f0-9]{64}$/u.test(destination.sourceSha256 ?? '')
        || !Number.isSafeInteger(destination.sourceByteLength) || destination.sourceByteLength < 0) {
        issues.push(issue('overlay-completion-archive-proof', 'archived or kept outcomes must bind the frozen source row to an exact archive manifest entry', '/destination'));
      }
    } else if (status === 'private-restorable') {
      const destination = decision.destination;
      if (destination.kind !== 'private-restore-proof' || !safeRepoPath(destination.receiptPath)
        || !/^[a-f0-9]{64}$/u.test(destination.receiptSha256 ?? '')
        || !Number.isSafeInteger(destination.receiptBytes) || destination.receiptBytes < 1) {
        issues.push(issue('overlay-completion-private-proof', 'private restoration requires a concrete restore receipt locator and digest', '/destination'));
      }
    }
    if (!decision.review?.basisRefs?.length) {
      issues.push(issue('overlay-completion-review-evidence', 'a completed outcome requires a traceable review or preservation basis', '/review/basisRefs'));
    }
    if (decision.actualOutcome.migrationKind === 'approved-source-target-reuse') {
      const closure = decision.actualOutcome.approvedCoverClosure;
      const multiCoverAllowed = ['approved-current-dependency-exact-reuse', 'approved-current-dependency-reviewed-rewrite']
        .includes(closure?.decisionStatus);
      const validReference = reference => isObject(reference)
        && (reference.coveredBy === null || (isObject(reference.coveredBy)
          && typeof reference.coveredBy.fieldPath === 'string' && reference.coveredBy.fieldPath.startsWith('/')
          && typeof reference.coveredBy.dimension === 'string' && reference.coveredBy.dimension))
        && isObject(reference.attestation)
        && typeof reference.attestation.gameReleaseId === 'string' && typeof reference.attestation.recordId === 'string'
        && typeof reference.attestation.fieldPath === 'string' && reference.attestation.fieldPath.startsWith('/')
        && typeof reference.attestation.dimension === 'string' && reference.attestation.dimension
        && /^[a-f0-9]{64}$/u.test(reference.attestation.targetDigest ?? '')
        && /^[a-f0-9]{64}$/u.test(reference.attestation.dependenciesDigest ?? '')
        && isObject(reference.candidateEvidence) && reference.candidateEvidence.kind === 'approved-target-receipt'
        && reference.candidateEvidence.selector?.kind === 'json-pointer'
        && /^\/review\/sourceTargets\/(0|[1-9][0-9]*)$/u.test(reference.candidateEvidence.selector.locator ?? '')
        && /^[a-f0-9]{64}$/u.test(reference.candidateEvidence.targetSha256 ?? '')
        && /^[a-f0-9]{64}$/u.test(reference.candidateEvidence.dependencySha256 ?? '')
        && reference.candidateEvidence.targetSha256 === reference.attestation.targetDigest
        && reference.candidateEvidence.dependencySha256 === reference.attestation.dependenciesDigest;
      const targetFieldPath = decision.actualOutcome.targetFieldPath;
      const coveragePath = reference => reference.coveredBy?.fieldPath ?? reference.attestation?.fieldPath ?? '';
      const primaryOrder = (left, right) => (left.attestation?.dimension === 'technical' ? 0 : 1)
        - (right.attestation?.dimension === 'technical' ? 0 : 1)
        || coveragePath(left).length - coveragePath(right).length
        || coveragePath(left).localeCompare(coveragePath(right))
        || Number(/\/(0|[1-9][0-9]*)$/u.exec(left.candidateEvidence?.selector?.locator ?? '')?.[1] ?? 0)
          - Number(/\/(0|[1-9][0-9]*)$/u.exec(right.candidateEvidence?.selector?.locator ?? '')?.[1] ?? 0);
      const exactReferences = (closure?.references ?? []).filter(reference => coveragePath(reference) === targetFieldPath);
      const ancestorReferences = (closure?.references ?? []).filter(reference => targetFieldPath?.startsWith(`${coveragePath(reference)}/`));
      const longestAncestorLength = ancestorReferences.length ? Math.max(...ancestorReferences.map(reference => coveragePath(reference).length)) : -1;
      const closestAncestors = ancestorReferences.filter(reference => coveragePath(reference).length === longestAncestorLength);
      const directReferences = (closure?.references ?? []).filter(reference => reference.coveredBy === null);
      const selectedReferences = multiCoverAllowed ? (closure?.references ?? [])
        : exactReferences.length ? exactReferences
          : closestAncestors.length ? closestAncestors
            : directReferences.length === 1 ? directReferences : [];
      const primaryReference = [...selectedReferences].sort(primaryOrder)[0];
      const primaryValid = selectedReferences.length > 0
        && (multiCoverAllowed || selectedReferences.length === 1)
        && primaryReference?.attestation.fieldPath === decision.actualOutcome.approvedCoverFieldPath
        && primaryReference?.attestation.dimension === decision.actualOutcome.approvedCoverDimension
        && sameJson(primaryReference?.candidateEvidence, decision.review?.evidence);
      if (!isObject(closure) || closure.reportPath !== SOURCE_CURRENT_RECONCILIATION_PATH
        || !/^[a-f0-9]{64}$/u.test(closure.reportSha256 ?? '')
        || !Number.isSafeInteger(closure.reportByteLength) || closure.reportByteLength < 1
        || !Number.isSafeInteger(closure.rowIndex) || closure.rowIndex < 0
        || closure.entryId !== sourceEntry?.entryId || closure.sourceRowSha256 !== rowDigest(sourceEntry)
        || typeof closure.decisionStatus !== 'string' || !closure.decisionStatus
        || !/^[a-f0-9]{64}$/u.test(closure.decisionSha256 ?? '')
        || typeof closure.approvalEvidenceSetId !== 'string' || !closure.approvalEvidenceSetId
        || closure.approvalEvidenceSetId !== decision.actualOutcome.approvalEvidenceSetId
        || !Array.isArray(closure.references) || closure.references.length === 0
        || closure.references.some(reference => !validReference(reference))
        || !primaryValid) {
        issues.push(issue('overlay-source-approval-closure', 'Source target reuse must preserve its exact report row, full approved dependency closure, and deterministic primary receipt', '/actualOutcome/approvedCoverClosure'));
      }
    } else if (decision.actualOutcome.approvedCoverClosure !== undefined) {
      issues.push(issue('overlay-source-approval-closure', 'Source approval closure is allowed only for approved source-target reuse', '/actualOutcome/approvedCoverClosure'));
    }
    if (decision.review?.state === 'verified-reuse') {
      const evidence = decision.review.evidence;
      if (decision.review.carryForward !== true || !isObject(evidence)
        || evidence.kind !== 'approved-target-receipt' || !['source', 'web'].includes(evidence.repoId)
        || !/^[a-f0-9]{40}$/u.test(evidence.commit ?? '') || !safeRepoPath(evidence.path)
        || !/^[a-f0-9]{64}$/u.test(evidence.fileSha256 ?? '')
        || !Number.isSafeInteger(evidence.byteLength) || evidence.byteLength < 1
        || !/^[a-f0-9]{40}$/u.test(evidence.gitBlobOid ?? '')
        || evidence.selector?.kind !== 'json-pointer' || typeof evidence.selector.locator !== 'string'
        || !evidence.selector.locator.startsWith('/') || typeof evidence.targetId !== 'string' || !evidence.targetId.trim()
        || !/^[a-f0-9]{64}$/u.test(evidence.targetSha256 ?? '')
        || !/^[a-f0-9]{64}$/u.test(evidence.dependencySha256 ?? '')) {
        issues.push(issue('overlay-completion-reuse-proof', 'verified reuse requires a digest-bound approved target receipt, not a free-form basis string', '/review/evidence'));
      }
    } else if (status === 'migrated' && decision.actualOutcome.migrationKind !== 'metadata-mapping'
      && decision.review?.state !== 'pending') {
      issues.push(issue('overlay-completion-review-state', 'a migrated target must be pending review or carry a verified reuse receipt', '/review/state'));
    }
  }
  if (status === 'deferred-w15') {
    const scope = decision?.actualOutcome?.scopeGroupId;
    const validModsDeferral = ['M05', 'M06', 'M07', 'M08'].includes(scope)
      && sourceEntry?.source?.repoId === 'mods'
      && sourceEntry.source.commit === MODS_COMMIT
      && sourceEntry.entryId?.startsWith(`mods-${scope.toLowerCase()}-`)
      && sourceEntry.review?.basisRefs?.includes(`W03/${scope}`);
    const validWebDeferral = sourceEntry?.owner === 'web'
      && sourceEntry.source?.path === 'content/w01/web-authoring.json'
      && sourceEntry.selector?.locator?.startsWith('/announcements/');
    if (decision.disposition !== 'deferred-w15' || (currentCandidate && !validWebDeferral && !validModsDeferral) || (!validModsDeferral && !validWebDeferral)
      || decision.actualOutcome.scopeOwner !== 'W15') {
      issues.push(issue('overlay-w15-deferral-scope', 'only the fixed W15 announcement or Mods groups may be explicitly deferred', '/actualOutcome'));
    }
  }
  return issues;
}

/** Create one W14 overlay row while retaining immutable bindings to the exact W03 row. */
export function createW14OverlayEntry(sourceEntry, decision) {
  const sourceIssues = validateMappingEntry(sourceEntry);
  if (sourceIssues.length) throw new TypeError(`invalid frozen W03 entry: ${sourceIssues[0].code}`);
  const decisionIssues = validateDecision(decision, sourceEntry);
  if (decisionIssues.length) throw new TypeError(`invalid W14 decision: ${decisionIssues[0].code}`);
  return {
    schemaVersion: W14_OVERLAY_ENTRY_SCHEMA,
    entryId: sourceEntry.entryId,
    sourceRowSha256: rowDigest(sourceEntry),
    owner: sourceEntry.owner,
    source: sourceEntry.source,
    sourceTarget: sourceEntry.target,
    sourceScope: sourceEntry.scope,
    disposition: decision.disposition,
    actualOutcome: decision.actualOutcome,
    review: decision.review,
    destination: decision.destination,
    rollback: sourceEntry.rollback,
  };
}

/** Validate a one-to-one overlay for a single already-validated W03 source shard. */
export function validateW14OverlayShard(sourceEntries, overlayEntries) {
  const issues = [];
  if (!Array.isArray(sourceEntries) || !Array.isArray(overlayEntries)) {
    return [issue('overlay-shard-shape', 'source and overlay shard entries must be arrays')];
  }
  const sources = new Map();
  for (let index = 0; index < sourceEntries.length; index++) {
    const row = sourceEntries[index];
    const rowIssues = validateMappingEntry(row);
    if (rowIssues.length) issues.push(issue('overlay-source-row', `invalid W03 source row: ${rowIssues[0].code}`, `/source/${index}`));
    if (typeof row?.entryId !== 'string') continue;
    if (sources.has(row.entryId)) issues.push(issue('overlay-source-duplicate', 'source shard contains duplicate entryId', `/source/${index}/entryId`));
    else sources.set(row.entryId, row);
  }
  const seen = new Set();
  for (let index = 0; index < overlayEntries.length; index++) {
    const overlay = overlayEntries[index];
    const rowPath = `/overlay/${index}`;
    const source = sources.get(overlay?.entryId);
    if (!source) {
      issues.push(issue('overlay-source-missing', 'overlay entry does not bind a source row in this shard', `${rowPath}/entryId`));
      continue;
    }
    if (seen.has(overlay.entryId)) {
      issues.push(issue('overlay-entry-duplicate', 'source entry must occur exactly once in the overlay shard', `${rowPath}/entryId`));
      continue;
    }
    seen.add(overlay.entryId);
    if (overlay.schemaVersion !== W14_OVERLAY_ENTRY_SCHEMA) issues.push(issue('overlay-entry-schema', 'overlay row schemaVersion is unsupported', `${rowPath}/schemaVersion`));
    if (overlay.sourceRowSha256 !== rowDigest(source)) issues.push(issue('overlay-source-hash', 'overlay source row digest differs from the frozen W03 row', `${rowPath}/sourceRowSha256`));
    if (overlay.owner !== source.owner || !sameJson(overlay.source, source.source)
      || !sameJson(overlay.sourceTarget, source.target) || !sameJson(overlay.sourceScope, source.scope)
      || !sameJson(overlay.rollback, source.rollback)) {
      issues.push(issue('overlay-source-binding', 'overlay must preserve the W03 owner, source, target, scope, and rollback pointers', rowPath));
    }
    for (const item of validateDecision(overlay, source)) issues.push(issue(item.code, item.message, `${rowPath}${item.path}`));
  }
  for (const entryId of sources.keys()) {
    if (!seen.has(entryId)) issues.push(issue('overlay-entry-missing', `W03 entry is missing from the overlay shard: ${entryId}`, '/overlay'));
  }
  return issues;
}

/** Verify and decode one W03 A-ledger shard without retaining neighboring shards in memory. */
export function verifyW03LedgerShard(ledger, descriptor, containerBytes) {
  if (!isObject(ledger) || ledger.schemaVersion !== 1 || ledger.entrySchemaVersion !== 'w03.mapping-entry.v1'
    || !isObject(ledger.groups) || !Array.isArray(ledger.shards) || !isObject(descriptor) || !Buffer.isBuffer(containerBytes)) {
    return { valid: false, issues: [issue('shard-input-shape', 'W03 ledger, shard descriptor, and exact container bytes are required')] };
  }
  if (!safeRepoPath(descriptor.path) || !descriptor.path.startsWith('extension/')
    || descriptor.encoding !== 'gzip-base64' || !Array.isArray(ledger.groups[descriptor.groupId]?.shardPaths)
    || !ledger.groups[descriptor.groupId].shardPaths.includes(descriptor.path)) {
    return { valid: false, issues: [issue('shard-ledger-binding', 'W03 shard path is not safely bound to its declared ledger group')] };
  }
  const indexed = ledger.shards.find(item => item?.path === descriptor.path);
  if (!indexed || !sameJson(indexed, descriptor)) {
    return { valid: false, issues: [issue('shard-descriptor-binding', 'shard descriptor differs from the frozen W03 ledger index')] };
  }
  const miniLedger = {
    schemaVersion: ledger.schemaVersion,
    entrySchemaVersion: ledger.entrySchemaVersion,
    groups: { [descriptor.groupId]: { entryCount: descriptor.entryCount, shardPaths: [descriptor.path] } },
    shards: [descriptor],
  };
  const issues = verifyLedgerBundle(miniLedger, new Map([[descriptor.path, containerBytes]]));
  if (issues.length) return { valid: false, issues };
  try {
    const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(containerBytes));
    const contentBytes = gunzipSync(Buffer.from(envelope.data, 'base64'), { maxOutputLength: 8_000_001 });
    const shard = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contentBytes));
    return { valid: true, issues: [], entries: shard.entries };
  } catch (error) {
    return { valid: false, issues: [issue('shard-decode', `verified W03 shard could not be decoded: ${error.message}`)] };
  }
}

/** Verify the complete W03 A ledger, reading only one bounded shard container at a time. */
export async function walkW03LedgerShards({ docRoot, onShard = async () => {} }) {
  if (typeof docRoot !== 'string' || !docRoot || typeof onShard !== 'function') {
    throw new TypeError('docRoot and an optional asynchronous shard callback are required');
  }
  const ledgerBytes = await readFile(path.join(docRoot, 'mapping-ledger.json'));
  let ledger;
  try { ledger = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(ledgerBytes)); }
  catch (error) { throw new Error(`W03 mapping ledger is not valid UTF-8 JSON: ${error.message}`); }
  if (ledger.schemaVersion !== 1 || ledger.entrySchemaVersion !== 'w03.mapping-entry.v1'
    || !isObject(ledger.groups) || !Array.isArray(ledger.shards)) {
    throw new Error('W03 mapping ledger header is invalid');
  }

  const descriptorByPath = new Map();
  for (const descriptor of ledger.shards) {
    if (!isObject(descriptor) || !safeRepoPath(descriptor.path) || !descriptor.path.startsWith('extension/')
      || descriptorByPath.has(descriptor.path) || !ledger.groups[descriptor.groupId]?.shardPaths?.includes(descriptor.path)) {
      throw new Error('W03 mapping ledger has an unsafe or multiply-bound shard descriptor');
    }
    descriptorByPath.set(descriptor.path, descriptor);
  }
  const expectedPaths = new Set();
  for (const [groupId, group] of Object.entries(ledger.groups)) {
    if (!isObject(group) || !Number.isSafeInteger(group.entryCount) || group.entryCount < 0 || !Array.isArray(group.shardPaths)) {
      throw new Error(`W03 group descriptor is invalid: ${groupId}`);
    }
    for (const shardPath of group.shardPaths) {
      if (expectedPaths.has(shardPath) || descriptorByPath.get(shardPath)?.groupId !== groupId) {
        throw new Error(`W03 shard membership is duplicate or mismatched: ${shardPath}`);
      }
      expectedPaths.add(shardPath);
    }
  }
  if (expectedPaths.size !== descriptorByPath.size) throw new Error('W03 index contains an unreferenced shard descriptor');

  const seenEntryIds = new Set();
  const countsByGroup = new Map();
  let entryCount = 0;
  for (const descriptor of ledger.shards) {
    const containerBytes = await readFile(path.join(docRoot, ...descriptor.path.split('/')));
    const checked = verifyW03LedgerShard(ledger, descriptor, containerBytes);
    if (!checked.valid) {
      const first = checked.issues[0];
      throw new Error(`W03 shard verification failed: ${descriptor.path}: ${first.code} ${first.path}`);
    }
    for (const entry of checked.entries) {
      if (seenEntryIds.has(entry.entryId)) throw new Error(`W03 entryId occurs in multiple shards: ${entry.entryId}`);
      seenEntryIds.add(entry.entryId);
      entryCount++;
      countsByGroup.set(descriptor.groupId, (countsByGroup.get(descriptor.groupId) ?? 0) + 1);
    }
    await onShard({ descriptor, containerBytes, entries: checked.entries });
  }
  for (const [groupId, group] of Object.entries(ledger.groups)) {
    if ((countsByGroup.get(groupId) ?? 0) !== group.entryCount) throw new Error(`W03 entry count differs from index: ${groupId}`);
  }
  return {
    valid: true,
    sourceLedgerSha256: createHash('sha256').update(ledgerBytes).digest('hex'),
    shardCount: ledger.shards.length,
    groupCount: Object.keys(ledger.groups).length,
    entryCount,
    countsByGroup: Object.fromEntries([...countsByGroup].sort(([left], [right]) => left.localeCompare(right))),
  };
}

/** Stream the separately indexed W03 Mods ledger with its native raw-JSON shard contract. */
export async function walkW03ModsLedgerShards({ docRoot, onShard = async () => {} }) {
  if (typeof docRoot !== 'string' || !docRoot || typeof onShard !== 'function') {
    throw new TypeError('Mods docRoot and an optional asynchronous shard callback are required');
  }
  const ledgerBytes = await readFile(path.join(docRoot, 'mods', 'mapping-ledger.json'));
  const ledgerSha256 = createHash('sha256').update(ledgerBytes).digest('hex');
  if (ledgerSha256 !== M01_LEDGER_SHA256) throw new Error('W03 Mods mapping ledger differs from the fixed W14 source index');
  let ledger;
  try { ledger = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(ledgerBytes)); }
  catch (error) { throw new Error(`W03 Mods mapping ledger is not valid UTF-8 JSON: ${error.message}`); }
  if (ledger.format !== 'w03-mods-mapping-ledger.v1' || ledger.entrySchemaVersion !== 'w03.mapping-entry.v1'
    || ledger.source?.repoId !== 'mods' || ledger.source.commit !== MODS_COMMIT
    || !Array.isArray(ledger.groups) || !Array.isArray(ledger.shards)) {
    throw new Error('W03 Mods mapping ledger header is invalid');
  }

  const groupByPath = new Map();
  const expectedByGroup = new Map();
  for (const group of ledger.groups) {
    if (!isObject(group) || typeof group.groupId !== 'string' || !Array.isArray(group.shards)
      || !Number.isSafeInteger(group.entryCount) || group.entryCount < 0) {
      throw new Error('W03 Mods group descriptor is invalid');
    }
    expectedByGroup.set(group.groupId, group.entryCount);
    for (const shard of group.shards) {
      if (!isObject(shard) || !safeRepoPath(shard.path) || !shard.path.startsWith('mods/shards/')
        || groupByPath.has(shard.path) || !ledger.shards.some(indexed => sameJson(indexed, shard))) {
        throw new Error(`W03 Mods shard membership is unsafe or multiply bound: ${shard?.path}`);
      }
      groupByPath.set(shard.path, group.groupId);
    }
  }
  if (groupByPath.size !== ledger.shards.length) throw new Error('W03 Mods index has unreferenced shard descriptors');

  const seenEntryIds = new Set();
  const countsByGroup = new Map();
  let entryCount = 0;
  for (const descriptor of ledger.shards) {
    const groupId = groupByPath.get(descriptor.path);
    if (!groupId || !Number.isSafeInteger(descriptor.entryCount) || descriptor.entryCount < 1
      || !Number.isSafeInteger(descriptor.sizeBytes) || descriptor.sizeBytes < 1
      || !/^[a-f0-9]{64}$/u.test(descriptor.sha256 ?? '')) {
      throw new Error(`W03 Mods shard descriptor is invalid: ${descriptor.path}`);
    }
    const containerBytes = await readFile(path.join(docRoot, ...descriptor.path.split('/')));
    if (containerBytes.length !== descriptor.sizeBytes
      || createHash('sha256').update(containerBytes).digest('hex') !== descriptor.sha256) {
      throw new Error(`W03 Mods shard integrity mismatch: ${descriptor.path}`);
    }
    let entries;
    try { entries = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(containerBytes)); }
    catch (error) { throw new Error(`W03 Mods shard is not valid UTF-8 JSON: ${descriptor.path}: ${error.message}`); }
    if (!Array.isArray(entries) || entries.length !== descriptor.entryCount) {
      throw new Error(`W03 Mods shard entry count mismatch: ${descriptor.path}`);
    }
    for (const [index, entry] of entries.entries()) {
      const issues = validateModsMappingEntry(entry);
      if (issues.length) throw new Error(`W03 Mods row is invalid: ${descriptor.path}[${index}]: ${issues[0].code}`);
      if (seenEntryIds.has(entry.entryId)) throw new Error(`W03 Mods entryId occurs more than once: ${entry.entryId}`);
      if (!entry.review?.basisRefs?.includes(`W03/${groupId}`)) throw new Error(`W03 Mods row is outside its fixed group: ${entry.entryId}`);
      seenEntryIds.add(entry.entryId);
      entryCount++;
    }
    countsByGroup.set(groupId, (countsByGroup.get(groupId) ?? 0) + entries.length);
    await onShard({ descriptor: { ...descriptor, groupId }, containerBytes, entries });
  }
  for (const [groupId, expectedCount] of expectedByGroup) {
    if ((countsByGroup.get(groupId) ?? 0) !== expectedCount) throw new Error(`W03 Mods group entry count mismatch: ${groupId}`);
  }
  if (entryCount !== 191861) throw new Error('W03 Mods total entry count differs from the fixed W14 scope');
  return {
    valid: true, sourceLedgerSha256: ledgerSha256, shardCount: ledger.shards.length,
    groupCount: ledger.groups.length, entryCount,
    countsByGroup: Object.fromEntries([...countsByGroup].sort(([left], [right]) => left.localeCompare(right))),
  };
}

/**
 * Stream a complete W03 A ledger into a deterministic, digest-bound W14 overlay.
 * The output is staged as a sibling directory and becomes visible only after all shards validate.
 */
export async function buildW14Overlay({ docRoot, outputRoot, classifyEntry, readArtifact, verifyApprovedReuse,
  verifyPrivateRestoration, walkShards = walkW03LedgerShards, ledgerRelativePath = 'mapping-ledger.json',
  ledgerDisplayPath = 'docs/contracts/w03/mapping-ledger.json' }) {
  if (typeof docRoot !== 'string' || !docRoot || typeof outputRoot !== 'string' || !outputRoot
    || typeof classifyEntry !== 'function') {
    throw new TypeError('docRoot, outputRoot, and classifyEntry are required');
  }

  if (!safeRepoPath(ledgerRelativePath)) throw new TypeError('ledgerRelativePath must be a safe repo-relative path');
  const ledgerPath = path.join(docRoot, ...ledgerRelativePath.split('/'));
  const ledgerBytes = await readFile(ledgerPath);
  const sourceLedgerSha256 = createHash('sha256').update(ledgerBytes).digest('hex');
  const stagingRoot = await mkdtemp(path.join(path.dirname(outputRoot), '.w14-overlay-stage-'));
  const manifest = {
    schemaVersion: W14_OVERLAY_MANIFEST_SCHEMA,
    sourceLedger: { path: ledgerDisplayPath, sha256: sourceLedgerSha256 },
    entryCount: 0,
    shardCount: 0,
    groupCount: 0,
    countsByGroup: {},
    countsByDisposition: {},
    countsByOutcome: {},
    countsByReviewState: {},
    shards: [],
  };
  const verificationCache = createVerificationCache();

  const addCount = (target, key, count = 1) => { target[key] = (target[key] ?? 0) + count; };
  try {
    const walk = await walkShards({
      docRoot,
      onShard: async ({ descriptor, containerBytes, entries }) => {
        const overlayEntries = [];
        const dispositionCounts = {};
        const outcomeCounts = {};
        const reviewCounts = {};
        for (const entry of entries) {
          const decision = await classifyEntry(entry);
          await verifyW14CompletionEvidenceUsingCache({ sourceEntry: entry, decision, readArtifact, verifyApprovedReuse, verifyPrivateRestoration }, verificationCache);
          const overlay = createW14OverlayEntry(entry, decision);
          overlayEntries.push(overlay);
          addCount(dispositionCounts, overlay.disposition);
          addCount(outcomeCounts, overlay.actualOutcome.status);
          addCount(reviewCounts, overlay.review.state);
        }
        const validationIssues = validateW14OverlayShard(entries, overlayEntries);
        if (validationIssues.length) {
          const first = validationIssues[0];
          throw new Error(`W14 overlay validation failed for ${descriptor.path}: ${first.code} ${first.path}`);
        }

        const sourceDescriptorSha256 = createHash('sha256').update(JSON.stringify(descriptor), 'utf8').digest('hex');
        const payload = {
          schemaVersion: W14_OVERLAY_SHARD_SCHEMA,
          sourceLedgerSha256,
          sourceShard: {
            path: descriptor.path,
            descriptorSha256: sourceDescriptorSha256,
            containerSha256: descriptor.containerSha256,
          },
          entries: overlayEntries,
        };
        const rawBytes = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
        const compressedBytes = gzipSync(rawBytes, { level: 9, mtime: 0 });
        const baseName = path.posix.basename(descriptor.path).replace(/\.json$/u, '');
        const overlayPath = `shards/${descriptor.groupId}/${baseName}.w14.json.gz`;
        if (!safeRepoPath(overlayPath)) throw new Error(`unsafe generated W14 overlay path: ${overlayPath}`);
        const localPath = path.join(stagingRoot, ...overlayPath.split('/'));
        await mkdir(path.dirname(localPath), { recursive: true });
        await writeFile(localPath, compressedBytes);

        manifest.entryCount += overlayEntries.length;
        manifest.shardCount++;
        addCount(manifest.countsByGroup, descriptor.groupId, overlayEntries.length);
        for (const [key, count] of Object.entries(dispositionCounts)) addCount(manifest.countsByDisposition, key, count);
        for (const [key, count] of Object.entries(outcomeCounts)) addCount(manifest.countsByOutcome, key, count);
        for (const [key, count] of Object.entries(reviewCounts)) addCount(manifest.countsByReviewState, key, count);
        manifest.shards.push({
          path: overlayPath,
          sourcePath: descriptor.path,
          sourceContainerSha256: descriptor.containerSha256,
          sourceDescriptorSha256,
          entryCount: overlayEntries.length,
          uncompressedBytes: rawBytes.length,
          uncompressedSha256: createHash('sha256').update(rawBytes).digest('hex'),
          compressedBytes: compressedBytes.length,
          compressedSha256: createHash('sha256').update(compressedBytes).digest('hex'),
          countsByDisposition: dispositionCounts,
          countsByOutcome: outcomeCounts,
          countsByReviewState: reviewCounts,
        });
      },
    });
    if (walk.sourceLedgerSha256 !== sourceLedgerSha256) throw new Error('W03 mapping ledger changed while its overlay was being built');
    manifest.groupCount = Object.keys(walk.countsByGroup).length;
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await writeFile(path.join(stagingRoot, 'manifest.json'), manifestBytes);
    await rename(stagingRoot, outputRoot);
    return {
      sourceLedgerSha256,
      entryCount: manifest.entryCount,
      shardCount: manifest.shardCount,
      groupCount: manifest.groupCount,
      countsByGroup: manifest.countsByGroup,
      countsByDisposition: manifest.countsByDisposition,
      countsByOutcome: manifest.countsByOutcome,
      countsByReviewState: manifest.countsByReviewState,
      outputManifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

/** Reopen a generated W14 overlay against its W03 index, exact compressed bytes, and completion proofs. */
export async function verifyW14Overlay({ docRoot, overlayRoot, readArtifact, verifyApprovedReuse,
  verifyPrivateRestoration, walkShards = walkW03LedgerShards, ledgerRelativePath = 'mapping-ledger.json',
  ledgerDisplayPath = 'docs/contracts/w03/mapping-ledger.json' }) {
  if (typeof docRoot !== 'string' || !docRoot || typeof overlayRoot !== 'string' || !overlayRoot) {
    throw new TypeError('docRoot and overlayRoot are required');
  }
  if (!safeRepoPath(ledgerRelativePath)) throw new TypeError('ledgerRelativePath must be a safe repo-relative path');
  const absoluteOverlayRoot = path.resolve(overlayRoot);
  const rootInfo = await lstat(absoluteOverlayRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('W14 overlay root must be a regular non-symlink directory');
  const manifestPath = path.join(absoluteOverlayRoot, 'manifest.json');
  const manifestBytes = await readFile(manifestPath);
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)); }
  catch { throw new Error('W14 overlay manifest is not valid UTF-8 JSON'); }
  const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
  if (!isObject(manifest) || manifest.schemaVersion !== W14_OVERLAY_MANIFEST_SCHEMA
    || !isObject(manifest.sourceLedger) || manifest.sourceLedger.path !== ledgerDisplayPath
    || !Number.isSafeInteger(manifest.entryCount) || manifest.entryCount < 0
    || !Number.isSafeInteger(manifest.shardCount) || manifest.shardCount < 1
    || !Number.isSafeInteger(manifest.groupCount) || manifest.groupCount < 1
    || !Array.isArray(manifest.shards) || manifest.shards.length !== manifest.shardCount) {
    throw new Error('W14 overlay manifest header is invalid');
  }
  const usesRawModsShardContract = ledgerRelativePath === 'mods/mapping-ledger.json'
    && walkShards === walkW03ModsLedgerShards;
  const sourceLedgerBytes = await readFile(path.join(docRoot, ...ledgerRelativePath.split('/')));
  const actualSourceLedgerSha256 = createHash('sha256').update(sourceLedgerBytes).digest('hex');
  if (manifest.sourceLedger.sha256 !== actualSourceLedgerSha256) {
    throw new Error('W14 overlay manifest does not match the current fixed W03 ledger bytes');
  }

  const shardsBySourcePath = new Map();
  for (const shard of manifest.shards) {
    const sourceContainerBindingValid = usesRawModsShardContract
      ? shard?.sourceContainerSha256 === undefined
      : /^[a-f0-9]{64}$/u.test(shard?.sourceContainerSha256 ?? '');
    if (!isObject(shard) || !safeRepoPath(shard.path) || !safeRepoPath(shard.sourcePath)
      || shardsBySourcePath.has(shard.sourcePath)
      || !sourceContainerBindingValid
      || !/^[a-f0-9]{64}$/u.test(shard.sourceDescriptorSha256 ?? '')
      || !Number.isSafeInteger(shard.entryCount) || shard.entryCount < 1
      || !Number.isSafeInteger(shard.uncompressedBytes) || shard.uncompressedBytes < 1
      || !/^[a-f0-9]{64}$/u.test(shard.uncompressedSha256 ?? '')
      || !Number.isSafeInteger(shard.compressedBytes) || shard.compressedBytes < 1
      || !/^[a-f0-9]{64}$/u.test(shard.compressedSha256 ?? '')) {
      throw new Error('W14 overlay manifest contains a malformed or duplicate shard descriptor');
    }
    shardsBySourcePath.set(shard.sourcePath, shard);
  }

  const verificationCache = createVerificationCache();
  const countsByGroup = {};
  const countsByDisposition = {};
  const countsByOutcome = {};
  const countsByReviewState = {};
  let entryCount = 0;
  let gapCount = 0;
  let deferredCount = 0;
  const seenSourcePaths = new Set();
  const addCount = (target, key, count = 1) => { target[key] = (target[key] ?? 0) + count; };

  const walk = await walkShards({
    docRoot,
    ledgerRelativePath,
    onShard: async ({ descriptor, containerBytes, entries }) => {
      const indexed = shardsBySourcePath.get(descriptor.path);
      if (!indexed || seenSourcePaths.has(descriptor.path)) throw new Error(`W14 overlay is missing or duplicates source shard ${descriptor.path}`);
      seenSourcePaths.add(descriptor.path);
      const descriptorSha256 = createHash('sha256').update(JSON.stringify(descriptor), 'utf8').digest('hex');
      const baseName = path.posix.basename(descriptor.path).replace(/\.json$/u, '');
      const expectedOverlayPath = `shards/${descriptor.groupId}/${baseName}.w14.json.gz`;
      if (indexed.path !== expectedOverlayPath || indexed.sourceContainerSha256 !== descriptor.containerSha256
        || indexed.sourceDescriptorSha256 !== descriptorSha256) {
        throw new Error(`W14 overlay shard source binding differs from W03: ${descriptor.path}`);
      }
      const compressedPath = path.join(absoluteOverlayRoot, ...indexed.path.split('/'));
      const compressedStat = await lstat(compressedPath);
      if (compressedStat.isSymbolicLink() || !compressedStat.isFile()) throw new Error(`W14 overlay shard must be a regular file: ${indexed.path}`);
      const compressedBytes = await readFile(compressedPath);
      if (compressedBytes.length !== indexed.compressedBytes
        || createHash('sha256').update(compressedBytes).digest('hex') !== indexed.compressedSha256) {
        throw new Error(`W14 compressed shard integrity mismatch: ${indexed.path}`);
      }
      let rawBytes;
      let payload;
      try {
        rawBytes = gunzipSync(compressedBytes, { maxOutputLength: 64_000_000 });
        payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBytes));
      } catch (error) {
        throw new Error(`W14 compressed shard is not bounded valid UTF-8 JSON: ${indexed.path}: ${error.message}`);
      }
      if (rawBytes.length !== indexed.uncompressedBytes
        || createHash('sha256').update(rawBytes).digest('hex') !== indexed.uncompressedSha256
        || !isObject(payload) || payload.schemaVersion !== W14_OVERLAY_SHARD_SCHEMA
        || payload.sourceLedgerSha256 !== actualSourceLedgerSha256
        || !isObject(payload.sourceShard) || payload.sourceShard.path !== descriptor.path
        || payload.sourceShard.descriptorSha256 !== descriptorSha256
        || payload.sourceShard.containerSha256 !== descriptor.containerSha256
        || !Array.isArray(payload.entries) || payload.entries.length !== entries.length
        || indexed.entryCount !== entries.length) {
        throw new Error(`W14 decompressed shard or source index binding mismatch: ${indexed.path}`);
      }
      const issues = validateW14OverlayShard(entries, payload.entries);
      if (issues.length) throw new Error(`W14 overlay shard validation failed: ${descriptor.path}: ${issues[0].code}`);

      const shardDispositions = {};
      const shardOutcomes = {};
      const shardReviews = {};
      for (let index = 0; index < entries.length; index++) {
        const sourceEntry = entries[index];
        const overlayEntry = payload.entries[index];
        const decision = {
          disposition: overlayEntry.disposition,
          actualOutcome: overlayEntry.actualOutcome,
          review: overlayEntry.review,
          destination: overlayEntry.destination,
        };
        const verified = await verifyW14CompletionEvidenceUsingCache({
          sourceEntry, decision, readArtifact, verifyApprovedReuse, verifyPrivateRestoration,
        }, verificationCache);
        if (verified.status === 'gap') gapCount++;
        if (verified.status === 'deferred-w15') deferredCount++;
        addCount(shardDispositions, overlayEntry.disposition);
        addCount(shardOutcomes, overlayEntry.actualOutcome.status);
        addCount(shardReviews, overlayEntry.review.state);
      }
      if (!sameJson(indexed.countsByDisposition, shardDispositions)
        || !sameJson(indexed.countsByOutcome, shardOutcomes)
        || !sameJson(indexed.countsByReviewState, shardReviews)) {
        throw new Error(`W14 shard counters do not match their verified entries: ${indexed.path}`);
      }
      entryCount += entries.length;
      addCount(countsByGroup, descriptor.groupId, entries.length);
      for (const [key, value] of Object.entries(shardDispositions)) addCount(countsByDisposition, key, value);
      for (const [key, value] of Object.entries(shardOutcomes)) addCount(countsByOutcome, key, value);
      for (const [key, value] of Object.entries(shardReviews)) addCount(countsByReviewState, key, value);
    },
  });

  if (walk.sourceLedgerSha256 !== actualSourceLedgerSha256 || seenSourcePaths.size !== manifest.shards.length
    || entryCount !== walk.entryCount || entryCount !== manifest.entryCount
    || walk.shardCount !== manifest.shardCount || walk.groupCount !== manifest.groupCount
    || !sameJson(countsByGroup, manifest.countsByGroup)
    || !sameJson(countsByDisposition, manifest.countsByDisposition)
    || !sameJson(countsByOutcome, manifest.countsByOutcome)
    || !sameJson(countsByReviewState, manifest.countsByReviewState)) {
    throw new Error('W14 overlay aggregate manifest does not match the reopened W03 rows and shards');
  }
  return {
    integrityVerified: true,
    completionProofsVerified: true,
    completionGapCount: gapCount,
    deferredW15Count: deferredCount,
    entryCount,
    shardCount: manifest.shardCount,
    groupCount: manifest.groupCount,
    countsByGroup,
    countsByDisposition,
    countsByOutcome,
    countsByReviewState,
    manifestSha256,
    manifestByteLength: manifestBytes.length,
    shards: manifest.shards,
  };
}
