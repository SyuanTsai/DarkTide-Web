import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { lstat, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { W14_FIXED_INPUTS } from './build-w14-outcomes.mjs';
import { safeRepoPath } from './contract-w03-ledger.mjs';
import { createW14CompletionVerifier, validateW14OverlayShard, verifyW14Overlay, walkW03ModsLedgerShards } from './contract-w14-ledger.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlobOid = bytes => createHash('sha1')
  .update(Buffer.concat([Buffer.from('blob ' + bytes.length + '\0', 'utf8'), bytes])).digest('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true });
const W15_GROUPS = Object.freeze({ M05: 1291, M06: 771, M07: 8, M08: 2623 });
const W15_SCOPE_SHA256 = '94a12932584d2fb0a4f0d6a78181f3b1c55600472e14b4f9fb6f04e7af66e52c';
const W15_RECEIPT_SHA256 = 'e226eea711b46141e5d42c9836b76b8a0a2a7babc78038c3ddca2c6e0171552a';
const W15_RECEIPT_BYTES = 7198934;
const W15_BUILD = '6872aee741cef7f150bd79fc25ad251276b15f6a81a9c287f5e3623b6df422dc';
const W14_MODS_MANIFEST_SHA256 = 'b213b785a7cca4dfb70d6795c778a51066d54fb1143ebf29887ff76fc2d762e5';
const W14_MODS_MANIFEST_BYTES = 32606;
const W14_MODS_MANIFEST_PATH = 'docs/contracts/w14/outcomes/final-20261025/mods/manifest.json';
const M01_PREFIX = 'content/legacy/mods/241ad76/';
const MODS_REPO = 'github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods';
const W15_ALLOWED_GROUPS = new Set(Object.keys(W15_GROUPS));

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort(compareUtf8).map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function sourceRowSha256(entry) { return sha256(Buffer.from(JSON.stringify(entry), 'utf8')); }
function compareUtf8(left, right) { return Buffer.compare(Buffer.from(String(left), 'utf8'), Buffer.from(String(right), 'utf8')); }
function sourceFragmentKind(entry) {
  const fragment = entry?.fragment;
  if (fragment?.normalization === 'raw' && /^[a-f0-9]{64}$/u.test(fragment.sha256 || '')) return 'raw';
  if (fragment?.normalization === 'git-blob' && /^[a-f0-9]{40}$/u.test(fragment.gitBlobOid || '')) return 'git-blob';
  return null;
}
function validW15ReviewDigest(value) { return /^[a-f0-9]{64}$/u.test(value || ''); }

export function assertW15GroupRow(row) {
  const source = row.source;
  const target = row.target;
  const review = row.review;
  if (!isObject(target) || !['web', 'source', 'private', 'mods'].includes(target.owner)) {
    throw new Error('W15 row has no fixed target owner: ' + row.entryId);
  }
  if (row.group === 'A17') {
    if (row.disposition !== 'archived-readable-original-w01-candidate' || target.owner !== 'web'
      || !isObject(review) || review.originalPendingStatePreserved !== true || review.selectedAsW15Announcement !== false) {
      throw new Error('W15 A17 row does not preserve its out-of-scope original pending state: ' + row.entryId);
    }
    return;
  }
  if (!isObject(source) || source.repoId !== 'mods' || source.commit !== W14_FIXED_INPUTS.modsSourceCommit
    || !safeRepoPath(source.path) || !/^[a-f0-9]{40}$/u.test(source.gitBlobOid || '')
    || !isObject(source.selector) || typeof source.selector.kind !== 'string' || typeof source.selector.locator !== 'string') {
    throw new Error('W15 row is not bound to its fixed Mods source selector: ' + row.entryId);
  }
  const hasRawFragment = /^[a-f0-9]{64}$/u.test(source.fragmentSha256 || '');
  const hasGitFragment = /^[a-f0-9]{40}$/u.test(source.fragmentGitBlobOid || '');
  if (row.group === 'M05') {
    if (row.disposition !== 'approved-and-live-announcement' || target.owner !== 'web' || !hasRawFragment
      || !isObject(review) || review.scopeSha256 !== W15_SCOPE_SHA256 || !review.targetId
      || !validW15ReviewDigest(review.targetDigest) || !validW15ReviewDigest(review.dependenciesDigest)
      || typeof target.announcementId !== 'string' || !Array.isArray(target.blockIds) || !target.blockIds.length
      || !Array.isArray(target.pointers) || !target.pointers.length || !validW15ReviewDigest(target.domainSha256)) {
      throw new Error('W15 M05 row is not backed by the fixed announcement content review: ' + row.entryId);
    }
    return;
  }
  if (row.group === 'M06') {
    if (row.disposition !== 'owner-workflow-handoff' || review != null || !hasRawFragment
      || !['web', 'source', 'private'].includes(target.owner) || !/^[a-f0-9]{40}$/u.test(target.commit || '')
      || !safeRepoPath(target.path) || !/^[a-f0-9]{40}$/u.test(target.gitBlob || '')
      || !validW15ReviewDigest(target.sha256)) {
      throw new Error('W15 M06 row is not a review-free owner workflow handoff: ' + row.entryId);
    }
    return;
  }
  if (row.group === 'M07') {
    const ownersByDisposition = {
      'migrated-exact-local-markdown-reference-check': 'source',
      'migrated-existing-synthetic-local-reference-tests': 'source',
      'private-fixed-tool-reused-line-endings-only': 'private',
      'private-limn-readme-copied-byte-exact': 'private',
      'private-owner-runbook-extended-for-m07': 'private',
      'replaced-with-scoped-player-renderer': 'web',
    };
    if (review != null || !hasGitFragment || target.owner !== ownersByDisposition[row.disposition]
      || !/^[a-f0-9]{40}$/u.test(target.commit || '') || !safeRepoPath(target.path)
      || !/^[a-f0-9]{40}$/u.test(target.gitBlob || '') || !validW15ReviewDigest(target.sha256)) {
      throw new Error('W15 M07 row is not bound to its fixed operational handoff: ' + row.entryId);
    }
    return;
  }
  if (row.group === 'M08' && row.disposition === 'approved-owner-reference-adoption') {
    if (!['web', 'source'].includes(target.owner) || (!hasRawFragment && !hasGitFragment)
      || !isObject(review) || review.scopeSha256 !== W15_SCOPE_SHA256 || review.usage !== 'authoring-reference-only'
      || review.originalProposalStatePreserved !== true || review.currentGameplayFactApproved !== false
      || 'targetDigest' in review || 'dependenciesDigest' in review) {
      throw new Error('W15 M08 adoption is not limited to approved authoring reference use: ' + row.entryId);
    }
    return;
  }
  if (row.group === 'M08' && row.disposition === 'retained-at-fixed-mods-source') {
    if (review != null || target.owner !== 'mods' || (!hasGitFragment && !hasRawFragment) || target.commit !== source.commit
      || target.path !== source.path || target.gitBlob !== source.gitBlobOid || target.bodyRead !== false) {
      throw new Error('W15 M08 retained selector does not remain at its exact fixed Mods blob: ' + row.entryId);
    }
    return;
  }
  throw new Error('W15 row has an unsupported group/disposition: ' + row.entryId);
}

function safeW15Review(review) {
  if (!isObject(review)) return null;
  const result = {};
  for (const key of ['scopeSha256', 'targetId', 'targetDigest', 'dependenciesDigest', 'usage']) {
    if (typeof review[key] === 'string') result[key] = review[key];
  }
  for (const key of ['originalProposalStatePreserved', 'currentGameplayFactApproved']) {
    if (typeof review[key] === 'boolean') result[key] = review[key];
  }
  return result;
}
function assertW15Receipt(receiptBytes) {
  if (!Buffer.isBuffer(receiptBytes) || receiptBytes.length !== W15_RECEIPT_BYTES
    || sha256(receiptBytes) !== W15_RECEIPT_SHA256) {
    throw new Error('W15 final completion receipt does not match its fixed byte length and SHA-256');
  }
  let receipt;
  try { receipt = JSON.parse(utf8.decode(receiptBytes)); }
  catch { throw new Error('W15 final completion receipt is not valid UTF-8 JSON'); }
  const expectedCounts = { M05: 1291, M06: 771, M07: 8, M08: 2623, A17: 17 };
  if (receipt.schema !== 'w15-verified-migration-completion/1'
    || receipt.status !== 'deployed-awaiting-user-acceptance'
    || receipt.humanScope !== W15_SCOPE_SHA256 || receipt.contentVersion !== '1.13.2.3'
    || receipt.build !== W15_BUILD || receipt.originalRows !== 4710
    || !same(receipt.groupCounts, expectedCounts)
    || !Array.isArray(receipt.rows) || receipt.rows.length !== 4710) {
    throw new Error('W15 receipt identity, scope, group counts, or row total differs from the fixed completion');
  }
  const rowsById = new Map();
  const counts = Object.create(null);
  for (const row of receipt.rows) {
    if (!isObject(row) || typeof row.entryId !== 'string' || !row.entryId || rowsById.has(row.entryId)
      || typeof row.group !== 'string' || !isObject(row.source) || !isObject(row.target)
      || (row.review != null && !isObject(row.review))) {
      throw new Error('W15 final receipt has a duplicate or malformed row');
    }
    const expectedPrefix = row.group === 'A17' ? 'w03-' : 'mods-' + String(row.group).toLowerCase() + '-';
    if (!row.entryId.startsWith(expectedPrefix)) throw new Error('W15 receipt row group does not match its entryId: ' + row.entryId);
    counts[row.group] = (counts[row.group] || 0) + 1;
    rowsById.set(row.entryId, row);
  }
  if (!same(counts, receipt.groupCounts)) throw new Error('W15 receipt row groups do not match the fixed aggregate counts');
  for (const [group, expectedCount] of Object.entries(W15_GROUPS)) {
    const rows = receipt.rows.filter(row => row.group === group);
    if (rows.length !== expectedCount) throw new Error('W15 ' + group + ' completion row count differs from the fixed scope');
    for (const row of rows) assertW15GroupRow(row);
  }
  const a17Rows = receipt.rows.filter(row => row.group === 'A17');
  if (a17Rows.length !== 17) throw new Error('W15 A17 out-of-scope row count differs from the fixed scope');
  for (const row of a17Rows) assertW15GroupRow(row);
  return { receipt, rowsById };
}

function validateCompletionRowBinding({ sourceEntry, groupId, overlayEntry, verification, completion }) {
  if (!isObject(sourceEntry) || sourceEntry.source?.repoId !== 'mods'
    || sourceEntry.source.commit !== W14_FIXED_INPUTS.modsSourceCommit || !safeRepoPath(sourceEntry.source.path)
    || !/^[a-f0-9]{40}$/u.test(sourceEntry.source.gitBlobOid || '')
    || !isObject(sourceEntry.selector) || !sourceFragmentKind(sourceEntry)
    || !sourceEntry.review?.basisRefs?.includes('W03/' + groupId)) {
    throw new Error('W03 source row is not bound to its fixed Mods path/group: ' + (sourceEntry?.entryId || 'unknown'));
  }
  if (!isObject(overlayEntry) || overlayEntry.entryId !== sourceEntry.entryId
    || overlayEntry.sourceRowSha256 !== sourceRowSha256(sourceEntry)
    || overlayEntry.owner !== sourceEntry.owner || !same(overlayEntry.source, sourceEntry.source)
    || !same(overlayEntry.sourceTarget, sourceEntry.target) || !same(overlayEntry.sourceScope, sourceEntry.scope)
    || !same(overlayEntry.rollback, sourceEntry.rollback)
    || overlayEntry.actualOutcome?.status !== overlayEntry.disposition) {
    throw new Error('W14 outcome does not bind the exact W03 selector row: ' + sourceEntry.entryId);
  }
  if (!isObject(verification) || verification.status !== overlayEntry.actualOutcome.status) {
    throw new Error('W14 completion verification status differs from its row: ' + sourceEntry.entryId);
  }
  const status = overlayEntry.actualOutcome.status;
  if (status === 'deferred-w15') {
    if (verification.verified !== false || overlayEntry.actualOutcome.scopeGroupId !== groupId
      || overlayEntry.actualOutcome.scopeOwner !== 'W15' || !W15_ALLOWED_GROUPS.has(groupId)) {
      throw new Error('W14 deferred row is not a fixed W15 Mods selector: ' + sourceEntry.entryId);
    }
    if (!completion) throw new Error('deferred W14 selector is missing its fixed W15 completion row: ' + sourceEntry.entryId);
    if (completion.group !== groupId || completion.source.repoId !== sourceEntry.source.repoId
      || completion.source.commit !== sourceEntry.source.commit || completion.source.path !== sourceEntry.source.path
      || completion.source.gitBlobOid !== sourceEntry.source.gitBlobOid
      || !same(completion.source.selector, sourceEntry.selector)
      || (sourceEntry.fragment.normalization === 'raw'
        ? completion.source.fragmentSha256 !== sourceEntry.fragment.sha256
        : completion.source.fragmentGitBlobOid !== sourceEntry.fragment.gitBlobOid)) {
      throw new Error('W15 completion row source locator mismatch: ' + sourceEntry.entryId);
    }
  } else {
    if (completion) throw new Error('W15 completion row is not bound to a W14 deferred selector: ' + sourceEntry.entryId);
    const shouldBeVerified = !['gap', 'excluded'].includes(status);
    if (verification.verified !== shouldBeVerified) {
      throw new Error('W14 completion evidence is not verified for its row: ' + sourceEntry.entryId);
    }
  }
  return status;
}

function urlForSource(entry) {
  const encodedPath = entry.source.path.split('/').map(part => encodeURIComponent(part)).join('/');
  const line = /^L(\d+)-L(\d+)(?::.*)?$/u.exec(entry.selector?.locator || '');
  const fragment = line ? '#L' + line[1] + '-L' + line[2] : '';
  return 'https://' + MODS_REPO + '/blob/' + entry.source.commit + '/' + encodedPath + fragment;
}

function safeW14Summary(entry, verification) {
  const destination = entry.destination || null;
  const outcomeStatus = entry.actualOutcome?.status || 'unknown';
  const result = {
    disposition: entry.disposition,
    status: outcomeStatus,
    verificationStatus: verification.status,
    verificationPassed: verification.verified === true,
    reviewState: entry.review?.state || 'unknown',
    migrationKind: entry.actualOutcome?.migrationKind || null,
  };
  if (destination) {
    const summary = { kind: destination.kind || 'unknown' };
    if (destination.repoId === 'private' || destination.kind === 'private-restore-proof') {
      summary.owner = 'private';
      summary.scopeGroupId = destination.modsGroupId || entry.actualOutcome?.scopeGroupId || null;
      summary.publicProofSha256 = destination.receiptSha256 || null;
    } else {
      for (const key of ['repoId', 'commit', 'path', 'archivePath', 'sourcePath', 'manifestPath',
        'manifestCommit', 'manifestSha256', 'fileSha256', 'sourceSha256', 'sourceByteLength',
        'gameReleaseId', 'recordId']) {
        if (typeof destination[key] === 'string' || Number.isSafeInteger(destination[key])) summary[key] = destination[key];
      }
    }
    result.destination = summary;
  }
  return result;
}
function localStateLabels(state) {
  if (!state) return [];
  if (Array.isArray(state.statuses)) return [...new Set(state.statuses)].sort(compareUtf8);
  if (typeof state.status === 'string') return [state.status];
  return [];
}

function createW17Aggregator({ w15Rows = [], worktreeStateByPath = new Map(), treeStateByPath = new Map() } = {}) {
  if (!Array.isArray(w15Rows) || !(worktreeStateByPath instanceof Map) || !(treeStateByPath instanceof Map)) {
    throw new TypeError('W15 rows and per-path metadata maps are required');
  }
  const w15ById = new Map();
  const w15Counts = Object.create(null);
  for (const row of w15Rows) {
    if (!isObject(row) || typeof row.entryId !== 'string' || !row.entryId || w15ById.has(row.entryId)) {
      throw new Error('duplicate W15 completion entryId: ' + (row?.entryId || 'unknown'));
    }
    if (!W15_ALLOWED_GROUPS.has(row.group)) continue;
    w15ById.set(row.entryId, row);
    w15Counts[row.group] = (w15Counts[row.group] || 0) + 1;
  }
  const pathsBySourcePath = new Map();
  const seenW03Ids = new Set();
  const seenW15Ids = new Set();
  let selectorCount = 0;

  function add(verifiedRow) {
    const { sourceEntry, groupId, overlayEntry, verification } = verifiedRow || {};
    if (!isObject(sourceEntry) || seenW03Ids.has(sourceEntry.entryId)) {
      throw new Error('duplicate or malformed W03 source entryId: ' + (sourceEntry?.entryId || 'unknown'));
    }
    seenW03Ids.add(sourceEntry.entryId);
    const completion = w15ById.get(sourceEntry.entryId) || null;
    const status = validateCompletionRowBinding({ sourceEntry, groupId, overlayEntry, verification, completion });
    if (completion) seenW15Ids.add(sourceEntry.entryId);

    const sourcePath = sourceEntry.source.path;
    const localLabels = localStateLabels(verifiedRow.worktreeState || worktreeStateByPath.get(sourcePath));
    const treeState = verifiedRow.treeState || treeStateByPath.get(sourcePath);
    const selectorPreserveReasons = new Set();
    if (status === 'kept') selectorPreserveReasons.add('fixed-w03-group-is-explicitly-retained');
    if (['gap', 'excluded'].includes(status)) selectorPreserveReasons.add('w14-outcome-is-not-a-complete-transfer');
    if (completion?.disposition === 'retained-at-fixed-mods-source' || completion?.target?.owner === 'mods') {
      selectorPreserveReasons.add('contains-retained-source-selector');
    }
    for (const label of localLabels) selectorPreserveReasons.add('local-' + label);
    if (treeState?.sourceBlobMismatch) selectorPreserveReasons.add('fixed-w03-source-blob-mismatch');
    if (treeState && treeState.headBlobOid !== sourceEntry.source.gitBlobOid) {
      selectorPreserveReasons.add('committed-source-path-differs-from-w03-baseline');
    }

    let pathEntry = pathsBySourcePath.get(sourcePath);
    if (!pathEntry) {
      pathEntry = {
        sourcePath,
        sourceCommit: sourceEntry.source.commit,
        sourceBlobOids: new Set(),
        selectors: [],
        w03Groups: new Set(),
        w14Statuses: Object.create(null),
        w15Dispositions: Object.create(null),
        targetOwners: new Set(),
        preserveReasons: new Set(['read-only-preflight-does-not-authorize-deletion', 'w16-final-acceptance-not-passed']),
        evidenceNotes: new Set(),
      };
      pathsBySourcePath.set(sourcePath, pathEntry);
    }
    pathEntry.sourceBlobOids.add(sourceEntry.source.gitBlobOid);
    pathEntry.w03Groups.add(groupId);
    pathEntry.w14Statuses[status] = (pathEntry.w14Statuses[status] || 0) + 1;
    if (overlayEntry.review?.state === 'verified-reuse') pathEntry.evidenceNotes.add('w14-reuses-fixed-prior-reviewed-proof');
    if (status === 'kept') pathEntry.preserveReasons.add('fixed-w03-group-is-explicitly-retained');
    if (status === 'archived-readable') pathEntry.evidenceNotes.add('historical-copy-is-preserved-at-fixed-source-owner');
    if (status === 'private-restorable') pathEntry.evidenceNotes.add('w14-reuses-fixed-private-remote-proof-and-11-sampled-restores');
    if (['gap', 'excluded'].includes(status)) pathEntry.preserveReasons.add('w14-outcome-is-not-a-complete-transfer');
    if (status === 'deferred-w15') pathEntry.evidenceNotes.add('w15-final-receipt-binds-the-deferred-selector');
    for (const reason of selectorPreserveReasons) pathEntry.preserveReasons.add(reason);

    const targetOwner = completion?.target?.owner || null;
    if (targetOwner) {
      pathEntry.targetOwners.add(targetOwner);
      pathEntry.w15Dispositions[completion.disposition] = (pathEntry.w15Dispositions[completion.disposition] || 0) + 1;
      if (completion.disposition === 'retained-at-fixed-mods-source' || targetOwner === 'mods') {
        pathEntry.preserveReasons.add('contains-retained-source-selector');
      }
      if (targetOwner === 'private') pathEntry.evidenceNotes.add('selector-has-a-fixed-private-owner-handoff');
    }

    pathEntry.selectors.push({
      entryId: sourceEntry.entryId,
      groupId,
      selector: sourceEntry.selector,
      fragmentNormalization: sourceEntry.fragment.normalization,
      fragmentSha256: sourceEntry.fragment.sha256 || null,
      fragmentGitBlobOid: sourceEntry.fragment.gitBlobOid || null,
      w14: safeW14Summary(overlayEntry, verification),
      w15: completion ? {
        group: completion.group,
        disposition: completion.disposition,
        targetOwner,
        review: safeW15Review(completion.review),
        ...(targetOwner === 'private' ? {} : {
          targetCommit: completion.target.commit || null,
          targetPath: completion.target.path || null,
          targetId: completion.target.announcementId || completion.target.targetId || null,
        }),
      } : null,
      rollbackUrl: urlForSource(sourceEntry),
      requiresPreservation: selectorPreserveReasons.size > 0,
      selectorPreserveReasons: [...selectorPreserveReasons].sort(compareUtf8),
      localStatus: localLabels,
      committedSourceState: treeState ? {
        baselineBlobOid: treeState.baselineBlobOid || null,
        currentHeadBlobOid: treeState.headBlobOid || null,
      } : null,
    });
    selectorCount++;
  }

  function finish({ expectedW15Counts = null } = {}) {
    if (seenW03Ids.size === 0) throw new Error('no W03 selector rows were aggregated');
    for (const entryId of w15ById.keys()) {
      if (!seenW15Ids.has(entryId)) throw new Error('W15 completion row does not bind a W03 deferred selector: ' + entryId);
    }
    const actualW15Counts = Object.fromEntries(Object.entries(w15Counts).sort(([a], [b]) => compareUtf8(a, b)));
    if (expectedW15Counts && !same(actualW15Counts, expectedW15Counts)) {
      throw new Error('W15 completion rows bound to W03 do not match the fixed group counts');
    }
    const paths = [...pathsBySourcePath.values()].map(value => {
      const sourceBlobOids = [...value.sourceBlobOids].sort(compareUtf8);
      const owners = [...value.targetOwners].sort(compareUtf8);
      const selectors = value.selectors.sort((a, b) => compareUtf8(a.entryId, b.entryId));
      const preservedSelectorCount = selectors.filter(item => item.requiresPreservation).length;
      const mixedSelectorOutcomes = preservedSelectorCount > 0 && preservedSelectorCount < selectors.length;
      const retirementCandidateAfterW16 = sourceBlobOids.length === 1 && preservedSelectorCount === 0;
      return {
        sourcePath: value.sourcePath,
        sourceCommit: value.sourceCommit,
        sourceBlobOid: sourceBlobOids.length === 1 ? sourceBlobOids[0] : null,
        conflictingSourceBlobOids: sourceBlobOids.length > 1 ? sourceBlobOids : [],
        selectorCount: selectors.length,
        preservedSelectorCount,
        retirementCandidateAfterW16,
        pathDisposition: retirementCandidateAfterW16 ? 'candidate-after-w16-acceptance' : 'preserve-source-path',
        w03Groups: [...value.w03Groups].sort(compareUtf8),
        w14Statuses: Object.fromEntries(Object.entries(value.w14Statuses).sort(([a], [b]) => compareUtf8(a, b))),
        w15Dispositions: Object.fromEntries(Object.entries(value.w15Dispositions).sort(([a], [b]) => compareUtf8(a, b))),
        targetOwners: owners,
        multipleTargetOwners: owners.length > 1,
        mixedSelectorOutcomes,
        preserveReasons: [...value.preserveReasons].sort(compareUtf8),
        evidenceNotes: [...value.evidenceNotes].sort(compareUtf8),
        selectors,
        deletionReady: false,
      };
    }).sort((a, b) => compareUtf8(a.sourcePath, b.sourcePath));
    return {
      deletionReady: false,
      pathCount: paths.length,
      selectorCount,
      retirementCandidateAfterW16PathCount: paths.filter(item => item.retirementCandidateAfterW16).length,
      preserveSourcePathCount: paths.filter(item => !item.retirementCandidateAfterW16).length,
      mixedSelectorPathCount: paths.filter(item => item.mixedSelectorOutcomes).length,
      w15BoundCountsByGroup: actualW15Counts,
      paths,
    };
  }
  return { add, finish };
}

export function aggregateW17PathInventory({ verifiedRows = [], w15Rows = [], worktreeStateByPath = new Map(), treeStateByPath = new Map() } = {}) {
  if (!Array.isArray(verifiedRows)) throw new TypeError('verified W03/W14 rows are required');
  const aggregator = createW17Aggregator({ w15Rows, worktreeStateByPath, treeStateByPath });
  for (const row of verifiedRows) aggregator.add(row);
  return aggregator.finish();
}
function runGitBuffer(repoRoot, args, input = null) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', repoRoot, ...args], {
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.on('error', error => reject(new Error('W17 Git metadata command could not start: ' + error.message)));
    child.on('close', code => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim().slice(0, 1000);
        reject(new Error('W17 Git metadata command failed (' + code + '): ' + detail));
      } else resolve(Buffer.concat(stdout));
    });
    child.stdin.end(input || undefined);
  });
}
async function runGitText(repoRoot, args) {
  return utf8.decode(await runGitBuffer(repoRoot, args));
}
function parseTreeEntries(bytes) {
  const result = new Map();
  let start = 0;
  while (start < bytes.length) {
    const end = bytes.indexOf(0, start);
    if (end < 0) throw new Error('Git tree listing is not NUL terminated');
    const record = bytes.subarray(start, end);
    start = end + 1;
    const tab = record.indexOf(9);
    if (tab < 0) throw new Error('Git tree entry has no path separator');
    const header = utf8.decode(record.subarray(0, tab)).split(' ');
    const filePath = utf8.decode(record.subarray(tab + 1));
    if (header.length !== 3 || !/^[a-f0-9]{40}$/u.test(header[2]) || !filePath || result.has(filePath)) {
      throw new Error('Git tree entry is malformed or duplicated');
    }
    result.set(filePath, { mode: header[0], type: header[1], oid: header[2] });
  }
  return result;
}
function parseCatFileBatch(bytes, expectedOids) {
  const result = new Map();
  let offset = 0;
  for (const expectedOid of expectedOids) {
    const newline = bytes.indexOf(10, offset);
    if (newline < 0) throw new Error('git cat-file batch header is truncated');
    const header = utf8.decode(bytes.subarray(offset, newline)).split(' ');
    offset = newline + 1;
    if (header.length !== 3 || header[0] !== expectedOid || header[1] !== 'blob' || !/^(0|[1-9][0-9]*)$/u.test(header[2])) {
      throw new Error('git cat-file batch returned an unexpected pinned object header');
    }
    const size = Number(header[2]);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size >= bytes.length) {
      throw new Error('git cat-file batch object length is invalid');
    }
    const body = Buffer.from(bytes.subarray(offset, offset + size));
    offset += size;
    if (bytes[offset] !== 10) throw new Error('git cat-file batch payload is not newline terminated');
    offset++;
    result.set(expectedOid, body);
  }
  if (offset !== bytes.length) throw new Error('git cat-file batch has trailing output bytes');
  return result;
}
async function readGitBlobsBatch(repoRoot, oids) {
  const unique = [...new Set(oids)];
  if (!unique.every(oid => /^[a-f0-9]{40}$/u.test(oid))) throw new Error('W17 pinned Git object list contains an invalid blob ID');
  const input = Buffer.from(unique.map(oid => oid + '\n').join(''), 'ascii');
  const result = await runGitBuffer(repoRoot, ['cat-file', '--batch'], input);
  return parseCatFileBatch(result, unique);
}
function parsePorcelain(bytes) {
  const items = [];
  let offset = 0;
  while (offset < bytes.length) {
    const end = bytes.indexOf(0, offset);
    if (end < 0) throw new Error('Git porcelain status is not NUL terminated');
    const record = utf8.decode(bytes.subarray(offset, end));
    offset = end + 1;
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') throw new Error('Git porcelain status record is malformed');
    const xy = record.slice(0, 2);
    const filePath = record.slice(3);
    if (!filePath) throw new Error('Git porcelain status record has no path');
    const state = xy === '!!' ? 'ignored'
      : xy === '??' ? 'untracked'
        : xy.includes('A') ? 'new-tracked'
          : xy.includes('D') ? 'deleted'
            : xy.includes('R') || xy.includes('C') ? 'renamed'
              : 'modified';
    items.push({ path: filePath, xy, state });
    if (xy.includes('R') || xy.includes('C')) {
      const secondEnd = bytes.indexOf(0, offset);
      if (secondEnd < 0) throw new Error('Git rename status has no second path');
      const secondPath = utf8.decode(bytes.subarray(offset, secondEnd));
      offset = secondEnd + 1;
      items.push({ path: secondPath, xy, state });
    }
  }
  return items;
}
function summarizeTrackedTreeDelta(baselineTree, currentTree) {
  const added = [];
  const removed = [];
  const modified = [];
  const allPaths = new Set([...baselineTree.keys(), ...currentTree.keys()]);
  for (const filePath of allPaths) {
    const before = baselineTree.get(filePath) || null;
    const after = currentTree.get(filePath) || null;
    if (!before) added.push({ path: filePath, mode: after.mode, type: after.type, gitBlobOid: after.oid });
    else if (!after) removed.push({ path: filePath, mode: before.mode, type: before.type, gitBlobOid: before.oid });
    else if (before.mode !== after.mode || before.type !== after.type || before.oid !== after.oid) {
      modified.push({
        path: filePath,
        baseline: { mode: before.mode, type: before.type, gitBlobOid: before.oid },
        current: { mode: after.mode, type: after.type, gitBlobOid: after.oid },
      });
    }
  }
  const order = (left, right) => compareUtf8(left.path, right.path);
  added.sort(order);
  removed.sort(order);
  modified.sort(order);
  return { added, removed, modified };
}
function summarizeStatusItems(statusItems) {
  const counts = Object.create(null);
  for (const item of statusItems) counts[item.state] = (counts[item.state] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => compareUtf8(left, right)));
}
function statusesForSourcePath(sourcePath, statusItems) {
  const matched = [];
  for (const item of statusItems) {
    const candidate = item.path.replace(/\/+$/u, '');
    if (candidate === sourcePath || sourcePath.startsWith(candidate + '/') || candidate.startsWith(sourcePath + '/')) {
      matched.push(item.state);
    }
  }
  return [...new Set(matched)].sort(compareUtf8);
}
function normalizeRemote(value) {
  const remote = value.trim();
  const candidates = [
    /^https?:\/\/github\.com\/(.+?)(?:\.git)?\/?$/iu,
    /^git@github\.com:(.+?)(?:\.git)?$/iu,
    /^ssh:\/\/git@github\.com\/(.+?)(?:\.git)?\/?$/iu,
  ];
  for (const pattern of candidates) {
    const match = pattern.exec(remote);
    if (match) return match[1].replace(/\.git$/iu, '').toLowerCase();
  }
  return null;
}
function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
async function canonicalizeMaybeMissingDirectory(directory) {
  const missing = [];
  let existing = path.resolve(directory);
  while (true) {
    try {
      const info = await lstat(existing);
      if (!info.isDirectory() && !info.isSymbolicLink()) throw new Error('W17 output parent component is not a directory');
      const resolved = await realpath(existing);
      return path.join(resolved, ...missing.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error('W17 output parent has no existing ancestor');
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
}
export async function resolveSafeW17OutputRoot(outputRoot, auditedRoots) {
  if (typeof outputRoot !== 'string' || !path.isAbsolute(outputRoot)) {
    throw new Error('W17 --output-root must be an explicit absolute path');
  }
  const absolute = path.resolve(outputRoot);
  try {
    await lstat(absolute);
    throw new Error('W17 output root already exists; choose a new directory');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const resolvedCandidate = await canonicalizeMaybeMissingDirectory(absolute);
  for (const root of auditedRoots) {
    const realRoot = await realpath(root);
    if (isWithin(realRoot, resolvedCandidate)) {
      throw new Error('W17 output root resolves inside an audited repository');
    }
  }
  return resolvedCandidate;
}
async function readModsGitSnapshot(modsRoot, { includeTrees = false } = {}) {
  const realRoot = await realpath(modsRoot);
  const top = path.resolve((await runGitText(realRoot, ['rev-parse', '--show-toplevel'])).trim());
  if (top.toLowerCase() !== realRoot.toLowerCase()) throw new Error('--mods-root must name the exact Git worktree root');
  const remote = await runGitText(realRoot, ['remote', 'get-url', 'origin']);
  if (normalizeRemote(remote) !== 'syuantsai/warhammer-40-000-darktide-mods') {
    throw new Error('--mods-root origin is not the fixed public Mods repository');
  }
  const head = (await runGitText(realRoot, ['rev-parse', '--verify', 'HEAD'])).trim();
  if (!/^[a-f0-9]{40}$/u.test(head)) throw new Error('Mods worktree HEAD is not a full Git commit');
  await runGitBuffer(realRoot, ['merge-base', '--is-ancestor', W14_FIXED_INPUTS.modsSourceCommit, head]);
  const statusBytes = await runGitBuffer(realRoot, [
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching',
  ]);
  const snapshot = {
    root: realRoot,
    originRepository: normalizeRemote(remote),
    head,
    statusBytes,
    statusSha256: sha256(statusBytes),
    statusItems: parsePorcelain(statusBytes),
  };
  if (includeTrees) {
    snapshot.baselineTree = parseTreeEntries(await runGitBuffer(realRoot, [
      'ls-tree', '-r', '-z', '--full-tree', W14_FIXED_INPUTS.modsSourceCommit,
    ]));
    snapshot.currentTree = parseTreeEntries(await runGitBuffer(realRoot, [
      'ls-tree', '-r', '-z', '--full-tree', head,
    ]));
  }
  return snapshot;
}
async function readSourceGitSnapshot(sourceRoot) {
  const realRoot = await realpath(sourceRoot);
  const top = path.resolve((await runGitText(realRoot, ['rev-parse', '--show-toplevel'])).trim());
  if (top.toLowerCase() !== realRoot.toLowerCase()) throw new Error('--source-root must name the exact Source Git clone root');
  const head = (await runGitText(realRoot, ['rev-parse', '--verify', 'HEAD'])).trim();
  if (!/^[a-f0-9]{40}$/u.test(head)) throw new Error('Source Git HEAD is not a full commit');
  await runGitBuffer(realRoot, ['merge-base', '--is-ancestor', W14_FIXED_INPUTS.m01Manifest.commit, head]);
  const statusBytes = await runGitBuffer(realRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching']);
  return { root: realRoot, head, statusSha256: sha256(statusBytes), statusBytes };
}
async function readM01ArchiveFromFixedGit(sourceRoot) {
  const commit = W14_FIXED_INPUTS.m01Manifest.commit;
  const prefix = 'content/legacy/mods/241ad76';
  const tree = parseTreeEntries(await runGitBuffer(sourceRoot, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', prefix]));
  const manifestPath = W14_FIXED_INPUTS.m01Manifest.path;
  const manifestTreeEntry = tree.get(manifestPath);
  if (!manifestTreeEntry || manifestTreeEntry.type !== 'blob'
    || manifestTreeEntry.oid !== W14_FIXED_INPUTS.m01Manifest.gitBlobOid) {
    throw new Error('Pinned M01 manifest Git tree entry does not match its fixed blob ID');
  }
  const manifestBlob = (await readGitBlobsBatch(sourceRoot, [manifestTreeEntry.oid])).get(manifestTreeEntry.oid);
  if (manifestBlob.length !== W14_FIXED_INPUTS.m01Manifest.byteLength
    || sha256(manifestBlob) !== W14_FIXED_INPUTS.m01Manifest.sha256
    || gitBlobOid(manifestBlob) !== manifestTreeEntry.oid) {
    throw new Error('Pinned M01 manifest bytes differ from their fixed size, SHA-256, or Git blob ID');
  }
  let manifest;
  try { manifest = JSON.parse(utf8.decode(manifestBlob)); }
  catch { throw new Error('Pinned M01 manifest is not valid UTF-8 JSON'); }
  if (manifest.schema !== 'w14.m01-mods-legacy-archive/1'
    || manifest.archiveRole !== 'historical-mods-content-preservation'
    || manifest.sourceSelection !== 'pinned-git-objects-only'
    || manifest.currentApproval !== 'not-current-approved' || manifest.sourceVersionStatus !== 'unverified'
    || manifest.readOnly !== true || manifest.sourceRepository !== 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods'
    || manifest.sourceCommit !== W14_FIXED_INPUTS.modsSourceCommit
    || manifest.inventorySha256 !== 'ee841b36463248003cf490344979170fb67b860ea39b70295dcc4c65a8de3307'
    || manifest.fileCount !== 3071 || manifest.rawBytes !== 25070107 || !Array.isArray(manifest.files)
    || manifest.files.length !== manifest.fileCount) {
    throw new Error('Pinned M01 manifest metadata differs from the fixed historical archive');
  }
  const archivePaths = new Set([manifestPath]);
  const fileTree = new Map();
  const requestedOids = [];
  let rawBytes = 0;
  for (const file of manifest.files) {
    if (!isObject(file) || !safeRepoPath(file.sourcePath) || file.archivePath !== file.sourcePath
      || file.normalization !== 'raw' || !/^[a-f0-9]{40}$/u.test(file.gitBlobOid || '')
      || !/^[a-f0-9]{64}$/u.test(file.sha256 || '') || !Number.isSafeInteger(file.byteLength) || file.byteLength < 0) {
      throw new Error('Pinned M01 file descriptor is malformed');
    }
    const archivePath = prefix + '/' + file.archivePath;
    if (archivePaths.has(archivePath)) throw new Error('Pinned M01 manifest repeats an archive path');
    archivePaths.add(archivePath);
    const entry = tree.get(archivePath);
    if (!entry || entry.type !== 'blob') throw new Error('Pinned M01 Git tree is missing an archive blob');
    fileTree.set(archivePath, { treeOid: entry.oid, file });
    requestedOids.push(entry.oid);
    rawBytes += file.byteLength;
  }
  const archiveTreePaths = [...tree.keys()].filter(filePath => filePath === manifestPath
    || filePath.startsWith(prefix + '/Game Info/'));
  if (archiveTreePaths.length !== archivePaths.size || archiveTreePaths.some(filePath => !archivePaths.has(filePath))
    || rawBytes !== manifest.rawBytes) {
    throw new Error('Pinned M01 Git tree membership or total raw-byte count differs from its manifest');
  }
  const blobs = await readGitBlobsBatch(sourceRoot, requestedOids);
  const artifacts = new Map([[manifestPath, manifestBlob]]);
  for (const [archivePath, record] of fileTree) {
    const bytes = blobs.get(record.treeOid);
    if (!bytes || bytes.length !== record.file.byteLength || sha256(bytes) !== record.file.sha256
      || gitBlobOid(bytes) !== record.file.gitBlobOid) {
      throw new Error('Pinned M01 archive bytes fail the exact original source size/SHA/Git blob check');
    }
    artifacts.set(archivePath, bytes);
  }
  return {
    manifest,
    artifacts,
    manifestScopedGitBlobCount: archiveTreePaths.length,
    unrelatedSiblingGitBlobCount: tree.size - archiveTreePaths.length,
  };
}
function createPinnedM01Reader(archive) {
  return async ({ repoId, commit, path: artifactPath, fileSha256, byteLength, gitBlobOid: expectedGitBlobOid }) => {
    if (repoId !== 'source' || commit !== W14_FIXED_INPUTS.m01Manifest.commit
      || !archive.artifacts.has(artifactPath)) {
      throw new Error('W14 artifact request is outside the exact public M01 Source Git-blob allowlist');
    }
    const bytes = archive.artifacts.get(artifactPath);
    if ((fileSha256 && sha256(bytes) !== fileSha256) || (byteLength !== undefined && bytes.length !== byteLength)
      || (expectedGitBlobOid && gitBlobOid(bytes) !== expectedGitBlobOid)) {
      throw new Error('W14 artifact request SHA, size, or original Git blob differs from its descriptor');
    }
    return Buffer.from(bytes);
  };
}
function createPrivateRestorationVerifier(privateSummary) {
  return async ({ sourceEntry, decision }) => {
    const destination = decision.destination;
    const groupId = decision.actualOutcome?.scopeGroupId;
    return sourceEntry.source?.repoId === 'mods'
      && sourceEntry.source.commit === W14_FIXED_INPUTS.modsSourceCommit
      && sourceEntry.review?.basisRefs?.includes('W03/' + groupId)
      && ['M02', 'M03', 'M04'].includes(groupId)
      && privateSummary.scopeGroups.includes(groupId)
      && privateSummary.groupCounts[groupId] > 0
      && privateSummary.sourcePathCount === 79014
      && privateSummary.modsLedgerSha256 === W14_FIXED_INPUTS.w03ModsLedger.sha256
      && privateSummary.scopeInventorySha256 === 'd279f907b38ae414a6f693812a267c24c7246ed8c20e4a0a630bac9ce47faac6'
      && privateSummary.remoteRetrievedBytesVerified === true
      && privateSummary.allCrcAndSha256AndGitBlobHashesVerified === true
      && privateSummary.fixedGitTreeMembershipVerified === true
      && privateSummary.fullRestoreClaimed === false
      && destination.receiptPath === W14_FIXED_INPUTS.privateSummary.path
      && destination.receiptSha256 === W14_FIXED_INPUTS.privateSummary.sha256
      && destination.receiptBytes === W14_FIXED_INPUTS.privateSummary.byteLength
      && destination.scopeInventorySha256 === privateSummary.scopeInventorySha256
      && destination.sourcePath === sourceEntry.source.path
      && destination.sourceGitBlobOid === sourceEntry.source.gitBlobOid
      && destination.modsGroupId === groupId;
  };
}
async function readPinnedFile(root, relativePath, expectedBytes, expectedSha256, label) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  const info = await lstat(absolutePath);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(label + ' must be a regular file');
  const bytes = await readFile(absolutePath);
  if (bytes.length !== expectedBytes || sha256(bytes) !== expectedSha256) {
    throw new Error(label + ' differs from its fixed byte length or SHA-256');
  }
  return bytes;
}
function parseCliArgs(argv) {
  if (argv.includes('--apply')) throw new Error('W17 preflight has no --apply or source mutation mode');
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const options = new Map();
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (!['--web-root', '--source-root', '--mods-root', '--w15-receipt', '--output-root'].includes(name)
      || options.has(name) || typeof argv[index + 1] !== 'string' || argv[index + 1].startsWith('--')) {
      throw new Error('W17 CLI arguments are invalid; use --help for the read-only invocation');
    }
    options.set(name, argv[++index]);
  }
  const required = ['--web-root', '--source-root', '--mods-root', '--w15-receipt', '--output-root'];
  if (required.some(name => !options.has(name))) throw new Error('W17 CLI requires all five explicit root/receipt/output arguments');
  return { webRoot: options.get('--web-root'), sourceRoot: options.get('--source-root'), modsRoot: options.get('--mods-root'), w15Receipt: options.get('--w15-receipt'), outputRoot: options.get('--output-root') };
}

export const W17_CLI_USAGE = [
  'Read-only W17 Mods retirement preflight:',
  'node scripts/content/contract-w17-retirement-cli.mjs --web-root <Web checkout> --source-root <Source checkout> --mods-root <Mods worktree> --w15-receipt <fixed completion-receipt.json> --output-root <new absolute directory outside all three repos>',
  'The command reads fixed ledgers, outcome receipts, pinned Source M01 archive Git blobs (for byte verification), and Git metadata. It does not read protected original worktree bodies and has no apply/delete/move/reset mode.',
].join('\n');

export async function buildW17RetirementPreflight({ webRoot, sourceRoot, modsRoot, w15Receipt, outputRoot } = {}) {
  for (const [label, value] of Object.entries({ webRoot, sourceRoot, modsRoot, w15Receipt })) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('W17 ' + label + ' must be an explicit absolute path');
  }
  const roots = await Promise.all([realpath(webRoot), realpath(sourceRoot), realpath(modsRoot)]);
  const safeOutputRoot = await resolveSafeW17OutputRoot(outputRoot, roots);
  const [webRootReal, sourceRootReal, modsBefore] = [roots[0], roots[1], await readModsGitSnapshot(roots[2], { includeTrees: true })];
  const sourceBefore = await readSourceGitSnapshot(sourceRootReal);

  const w15ReceiptBytes = await readFile(w15Receipt);
  const { receipt: w15, rowsById: w15RowsById } = assertW15Receipt(w15ReceiptBytes);
  const w15Rows = [...w15RowsById.values()];

  const w14ManifestBytes = await readPinnedFile(
    webRootReal, W14_MODS_MANIFEST_PATH, W14_MODS_MANIFEST_BYTES, W14_MODS_MANIFEST_SHA256, 'W14 Mods outcome manifest',
  );
  let w14Manifest;
  try { w14Manifest = JSON.parse(utf8.decode(w14ManifestBytes)); }
  catch { throw new Error('W14 Mods outcome manifest is not valid UTF-8 JSON'); }
  const privateSummaryBytes = await readPinnedFile(
    webRootReal, W14_FIXED_INPUTS.privateSummary.path, W14_FIXED_INPUTS.privateSummary.byteLength,
    W14_FIXED_INPUTS.privateSummary.sha256, 'W14 public-safe private restoration summary',
  );
  let privateSummary;
  try { privateSummary = JSON.parse(utf8.decode(privateSummaryBytes)); }
  catch { throw new Error('W14 private restoration summary is not valid UTF-8 JSON'); }

  const m01Archive = await readM01ArchiveFromFixedGit(sourceRootReal);
  const readArtifact = createPinnedM01Reader(m01Archive);
  const verifyPrivateRestoration = createPrivateRestorationVerifier(privateSummary);
  const docRoot = path.join(webRootReal, 'docs/contracts/w03');
  const overlayRoot = path.join(webRootReal, 'docs/contracts/w14/outcomes/final-20261025/mods');
  const verifiedW14 = await verifyW14Overlay({
    docRoot,
    overlayRoot,
    readArtifact,
    verifyApprovedReuse: async () => false,
    verifyPrivateRestoration,
    walkShards: walkW03ModsLedgerShards,
    ledgerRelativePath: 'mods/mapping-ledger.json',
    ledgerDisplayPath: W14_FIXED_INPUTS.w03ModsLedger.path,
  });
  if (verifiedW14.entryCount !== 191861 || verifiedW14.shardCount !== 45 || verifiedW14.groupCount !== 10
    || verifiedW14.completionGapCount !== 0 || verifiedW14.deferredW15Count !== 4693
    || !same(verifiedW14.countsByGroup, w14Manifest.countsByGroup)
    || !same(verifiedW14.countsByOutcome, { kept: 1094, 'archived-readable': 107060, 'private-restorable': 79014, 'deferred-w15': 4693 })) {
    throw new Error('W14 Mods rows or outcomes do not match the fixed verified scope');
  }

  const w15Counts = { M05: 1291, M06: 771, M07: 8, M08: 2623 };
  const aggregator = createW17Aggregator({ w15Rows });
  const w14Shards = new Map(verifiedW14.shards.map(shard => [shard.sourcePath, shard]));
  const completionVerifier = createW14CompletionVerifier({
    readArtifact,
    verifyApprovedReuse: async () => false,
    verifyPrivateRestoration,
  });
  const walk = await walkW03ModsLedgerShards({
    docRoot,
    onShard: async ({ descriptor, entries }) => {
      const indexed = w14Shards.get(descriptor.path);
      if (!indexed) throw new Error('W14 has no fixed overlay shard for W03 source shard ' + descriptor.path);
      const overlayPath = path.join(overlayRoot, ...indexed.path.split('/'));
      const overlayInfo = await lstat(overlayPath);
      if (overlayInfo.isSymbolicLink() || !overlayInfo.isFile()) throw new Error('W14 overlay shard is not a regular file');
      const compressed = await readFile(overlayPath);
      if (compressed.length !== indexed.compressedBytes || sha256(compressed) !== indexed.compressedSha256) {
        throw new Error('W14 overlay shard changed between verification passes');
      }
      let payload;
      try { payload = JSON.parse(utf8.decode(gunzipSync(compressed, { maxOutputLength: 64000000 }))); }
      catch { throw new Error('W14 overlay shard failed bounded UTF-8 JSON decoding on its aggregation pass'); }
      const issues = validateW14OverlayShard(entries, payload.entries);
      if (issues.length) throw new Error('W14 aggregation shard no longer matches its W03 rows: ' + issues[0].code);
      for (let index = 0; index < entries.length; index++) {
        const sourceEntry = entries[index];
        const overlayEntry = payload.entries[index];
        const decision = {
          disposition: overlayEntry.disposition,
          actualOutcome: overlayEntry.actualOutcome,
          review: overlayEntry.review,
          destination: overlayEntry.destination,
        };
        const verification = await completionVerifier({ sourceEntry, decision });
        const completion = w15RowsById.get(sourceEntry.entryId) || null;
        const pathState = statusesForSourcePath(sourceEntry.source.path, modsBefore.statusItems);
        const base = modsBefore.baselineTree.get(sourceEntry.source.path);
        const head = modsBefore.currentTree.get(sourceEntry.source.path);
        const treeState = {
          baselineBlobOid: base?.type === 'blob' ? base.oid : null,
          headBlobOid: head?.type === 'blob' ? head.oid : null,
          sourceBlobMismatch: base?.type !== 'blob' || base.mode === '120000' || base.oid !== sourceEntry.source.gitBlobOid,
        };
        aggregator.add({
          sourceEntry,
          groupId: descriptor.groupId,
          overlayEntry,
          verification,
          completion,
          worktreeState: { statuses: pathState },
          treeState,
        });
      }
    },
  });
  if (walk.entryCount !== 191861 || walk.shardCount !== 45 || walk.groupCount !== 10
    || walk.sourceLedgerSha256 !== W14_FIXED_INPUTS.w03ModsLedger.sha256) {
    throw new Error('W03 Mods ledger differs from its fixed W14 source index');
  }

  const inventory = aggregator.finish({ expectedW15Counts: w15Counts });
  if (inventory.pathCount !== 83260 || inventory.selectorCount !== 191861) {
    throw new Error('W17 source path/selector totals differ from the fixed Mods W03 ledger');
  }
  const modsAfter = await readModsGitSnapshot(modsRoot);
  const sourceAfter = await readSourceGitSnapshot(sourceRootReal);
  if (modsAfter.head !== modsBefore.head || modsAfter.statusSha256 !== modsBefore.statusSha256
    || !modsAfter.statusBytes.equals(modsBefore.statusBytes)) {
    throw new Error('Mods HEAD or Git status changed during the read-only W17 preflight');
  }
  if (sourceAfter.head !== sourceBefore.head || sourceAfter.statusSha256 !== sourceBefore.statusSha256
    || !sourceAfter.statusBytes.equals(sourceBefore.statusBytes)) {
    throw new Error('Source HEAD or Git status changed during the read-only W17 preflight');
  }

  const reasonCounts = Object.create(null);
  const statusCounts = Object.create(null);
  const trackedTreeDelta = summarizeTrackedTreeDelta(modsBefore.baselineTree, modsBefore.currentTree);
  for (const item of inventory.paths) {
    for (const reason of item.preserveReasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    for (const [status, count] of Object.entries(item.w14Statuses)) statusCounts[status] = (statusCounts[status] || 0) + count;
  }
  const jsonl = Buffer.from(inventory.paths.map(item => JSON.stringify(item)).join('\n') + '\n', 'utf8');
  const gzip = gzipSync(jsonl, { level: 9, mtime: 0 });
  const manifest = {
    schemaVersion: 'w17.mods-retirement-preflight.v1',
    status: 'preserve-only; no-delete-or-apply',
    deletionReady: false,
    decision: 'preserve-all-source-paths',
    inputs: {
      w03ModsLedger: { path: W14_FIXED_INPUTS.w03ModsLedger.path, sha256: W14_FIXED_INPUTS.w03ModsLedger.sha256, rowCount: walk.entryCount, shardCount: walk.shardCount },
      w14ModsOverlay: { path: W14_MODS_MANIFEST_PATH, sha256: W14_MODS_MANIFEST_SHA256, byteLength: W14_MODS_MANIFEST_BYTES, outputManifest: verifiedW14.manifestSha256, entryCount: verifiedW14.entryCount, gapCount: verifiedW14.completionGapCount },
      w14PrivateSummary: { path: W14_FIXED_INPUTS.privateSummary.path, sha256: W14_FIXED_INPUTS.privateSummary.sha256, byteLength: W14_FIXED_INPUTS.privateSummary.byteLength, sourcePathCount: privateSummary.sourcePathCount, scopeInventorySha256: privateSummary.scopeInventorySha256, fullRestoreClaimed: privateSummary.fullRestoreClaimed },
      w14M01Archive: { repository: 'SyuanTsai/DarkTide-Source-Data', commit: W14_FIXED_INPUTS.m01Manifest.commit, manifestPath: W14_FIXED_INPUTS.m01Manifest.path, manifestSha256: W14_FIXED_INPUTS.m01Manifest.sha256, fileCount: m01Archive.manifest.fileCount, rawBytes: m01Archive.manifest.rawBytes, manifestScopedGitBlobCount: m01Archive.manifestScopedGitBlobCount, unrelatedSiblingGitBlobCount: m01Archive.unrelatedSiblingGitBlobCount },
      w15FinalCompletion: { sha256: W15_RECEIPT_SHA256, byteLength: W15_RECEIPT_BYTES, humanScope: W15_SCOPE_SHA256, status: w15.status, contentVersion: w15.contentVersion, build: w15.build, rows: w15.originalRows, modsRows: 4693, outOfScopeA17Rows: 17, groupCounts: w15.groupCounts },
    },
    repositoryState: {
      mods: {
        originRepository: modsBefore.originRepository,
        fixedSourceCommit: W14_FIXED_INPUTS.modsSourceCommit,
        head: modsBefore.head,
        fixedCommitIsAncestor: true,
        statusSha256BeforeAndAfter: modsBefore.statusSha256,
        statusEntryCount: modsBefore.statusItems.length,
        statusEntryCountsByState: summarizeStatusItems(modsBefore.statusItems),
        sourceCommitToHeadTreeDelta: trackedTreeDelta,
      },
      source: { fixedArchiveCommit: W14_FIXED_INPUTS.m01Manifest.commit, head: sourceBefore.head, fixedCommitIsAncestor: true, statusSha256BeforeAndAfter: sourceBefore.statusSha256 },
    },
    summary: {
      sourcePathCount: inventory.pathCount,
      selectorCount: inventory.selectorCount,
      retirementCandidateAfterW16PathCount: inventory.retirementCandidateAfterW16PathCount,
      preserveSourcePathCount: inventory.preserveSourcePathCount,
      mixedSelectorPathCount: inventory.mixedSelectorPathCount,
      w14OutcomeCounts: statusCounts,
      w15BoundCountsByGroup: inventory.w15BoundCountsByGroup,
       preserveReasonPathCounts: Object.fromEntries(Object.entries(reasonCounts).sort(([a], [b]) => compareUtf8(a, b))),
      deletionReady: false,
      w16Acceptance: 'not-completed; all source paths remain preserved',
       privateRestoreScope: 'reuses the fixed W14 public-safe proof of remote retrieval, member verification, and 11 sampled restores; this CLI does not read back private archive bytes or claim a full restore',
    },
    artifacts: {
      paths: { file: 'paths.jsonl.gz', mediaType: 'application/gzip', byteLength: gzip.length, sha256: sha256(gzip), uncompressedByteLength: jsonl.length, uncompressedSha256: sha256(jsonl), pathCount: inventory.pathCount, selectorCount: inventory.selectorCount },
    },
  };

  const outputRootReal = safeOutputRoot;
  const parent = path.dirname(outputRootReal);
  const staging = await mkdtemp(path.join(parent, '.w17-preserve-stage-'));
  try {
    await writeFile(path.join(staging, 'paths.jsonl.gz'), gzip, { flag: 'wx' });
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    await writeFile(path.join(staging, 'manifest.json'), manifestBytes, { flag: 'wx' });
    try { await lstat(outputRootReal); throw new Error('W17 output root appeared during generation'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await rename(staging, outputRootReal);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return { outputRoot: outputRootReal, manifest, manifestSha256: sha256(Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')) };
}

export async function runW17RetirementCli(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  if (options.help) {
    process.stdout.write(W17_CLI_USAGE + '\n');
    return null;
  }
  const result = await buildW17RetirementPreflight(options);
  process.stdout.write(JSON.stringify({
    outputRoot: result.outputRoot,
    manifestSha256: result.manifestSha256,
    sourcePathCount: result.manifest.summary.sourcePathCount,
    selectorCount: result.manifest.summary.selectorCount,
    retirementCandidateAfterW16PathCount: result.manifest.summary.retirementCandidateAfterW16PathCount,
    preserveSourcePathCount: result.manifest.summary.preserveSourcePathCount,
    mixedSelectorPathCount: result.manifest.summary.mixedSelectorPathCount,
    deletionReady: result.manifest.deletionReady,
  }, null, 2) + '\n');
  return result;
}
