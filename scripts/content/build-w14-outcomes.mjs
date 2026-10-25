import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { resolvePublishedW09SourceArchive } from '../../content/contracts/w09/source-request/contract-w09-request.mjs';
import { safeRepoPath } from './contract-w03-ledger.mjs';
import {
  buildW14Overlay,
  createW14CompletionVerifier,
  verifyW03LedgerShard,
  verifyW14Overlay,
  walkW03LedgerShards,
  walkW03ModsLedgerShards,
} from './contract-w14-ledger.mjs';

const execFileAsync = promisify(execFile);

export const W14_OUTCOME_SET_SCHEMA = 'w14.complete-outcome-set.v1';
export const W14_FIXED_INPUTS = Object.freeze({
  domainMatrix: Object.freeze({
    path: 'docs/contracts/w14/domain-matrix.json',
    sha256: 'ab075e657827edf7ffcd83c2d901eb2c8f905d4b6f2384d85f71beef84a63fe8',
    byteLength: 853837,
  }),
  sourceReconciliation: Object.freeze({
    path: 'docs/contracts/w14/source-current-row-reconciliation.json',
    sha256: '2fec6babafa176a353b69729ac89a60b2581b7238358071d1b76066f7324bd31',
    byteLength: 14645990,
  }),
  webReconciliation: Object.freeze({
    path: 'docs/contracts/w14/web-current-row-reconciliation.json',
    sha256: 'fb1eac2e02fcc2ceaa8425eba1f9ed36840efc8361256b70a4e98629f67f5208',
    byteLength: 1349936,
  }),
  registryReconciliation: Object.freeze({
    path: 'docs/contracts/w14/weapon-registry-current-reconciliation.json',
    sha256: 'be18157f9624d2a672ff5dff0225cd19fa7de4cc59e42c8eeacfcb20791557c1',
    byteLength: 496459,
  }),
  privateSummary: Object.freeze({
    path: 'docs/contracts/w14/private-preservation-public-summary.json',
    sha256: 'e9eae25c7f7b7761ed387659a4d26500009bcffaf5c4999f1b02ead9d7e4ffee',
    byteLength: 1395,
  }),
  w03ALedger: Object.freeze({
    path: 'docs/contracts/w03/mapping-ledger.json',
    sha256: 'bdf4b02c278e9dafef9aea00ac8263fe7929b29e9dc0eb90325cf7c55daa2288',
    byteLength: 239883,
  }),
  w03ModsLedger: Object.freeze({
    path: 'docs/contracts/w03/mods/mapping-ledger.json',
    sha256: '90d1d27ed7673db16ff3c5b82640f2af7847466fc5a7a4fcd7d1f9795ee9af16',
  }),
  sourceTechnical: Object.freeze({
    releaseId: 'w09-810d0f41e9904265b7c53f4d2c610eab',
    sourceRevision: '83e70e7946bd13738ea97ec6731daeb4df5eb42edec8e1e819f428ee2197005d',
    archiveSha256: 'ae6137c70e9ea197f8f077a141511ac321f1179b1a18554870f2539ea72ef03c',
    path: 'technical.json',
    sha256: '052514ee1a1dc8d4754189f3ca1c3dbc626b1e7577b282b3de001f03ed459dd2',
    byteLength: 6639711,
  }),
  m01Manifest: Object.freeze({
    repository: 'source',
    commit: '805fa5ea3df2482419c967b4e82d019b65338065',
    path: 'content/legacy/mods/241ad76/m01-manifest.json',
    gitBlobOid: 'c8acb5612a14b11df5e75f7c76351f00ed22e79c',
    byteLength: 2133770,
    sha256: '9437100b28c375d2a49df1f8e65d8848d61ed7187a3fb104d60ec63d03d1fd99',
  }),
  modsSourceCommit: '241ad76ce62330472aa423055a5b85db59bb6c0d',
  w13OwnerCandidate: Object.freeze({
    commit: '100e3c0339078b5ed985e103d0ead818c361feb9',
    path: 'content/contracts/w09/prepared/w09-1a09e5ffcc1daf5358d2692b9234c9db/candidate.json',
    gitBlobOid: 'b1250b665088e48da2d383cd50924336fb20f018',
    byteLength: 1059353,
    sha256: 'd113c63275233a77da6c6b3e55a0f3bac3e617686d3e94d11982a8e4dddc83a1',
    selected: false,
    publicationEligible: false,
  }),
});

const reportDescriptorByBytes = new WeakMap();

export function assertW14ALedgerPin(sourceLedgerSha256) {
  if (sourceLedgerSha256 !== W14_FIXED_INPUTS.w03ALedger.sha256) {
    throw new Error('W03 A mapping ledger differs from the fixed W14 source index');
  }
  return sourceLedgerSha256;
}

const SOURCE_DIRECT_STATUSES = new Set([
  'approved-current-field-exact-reuse',
  'approved-current-field-reviewed-rewrite',
  'approved-current-dependency-exact-reuse',
  'approved-current-dependency-reviewed-rewrite',
  'legacy-not-imported-coverage-superseded-by-approved-current-action-profile-resolution',
]);

const SOURCE_MULTI_COVER_STATUSES = new Set([
  'approved-current-dependency-exact-reuse',
  'approved-current-dependency-reviewed-rewrite',
]);

const SOURCE_METADATA_STATUSES = new Set([
  'approved-current-record-identity-metadata',
  'authoring-or-fixture-control-not-carried-as-domain-content',
  'authoring-review-metadata-replaced-by-w09-digest-bound-candidate-receipts',
  'authoring-review-state-replaced-by-current-digest-bound-record-receipts',
  'current-source-reference-exact-and-covered-by-approved-record-dependencies',
  'current-source-reference-metadata-exact',
  'empty-change-list-mapped-to-no-current-change-index',
  'generated-source-revision-replaced-by-current-packet-identity',
  'historical-analysis-retained-at-exact-1-13-1-release',
  'historical-source-reference-retained-at-exact-1-13-1-identity',
  'legacy-term-reference-mapped-to-current-typed-termRefs',
  'metadata-mapped-to-current-release-identity',
  'metadata-replaced-by-current-shared-domain-schema',
  'old-code-comparison-record-replaced-by-exact-approved-current-claims',
  'source-packet-file-descriptor-regenerated',
  'w01-file-descriptor-not-in-current-source-packet',
  'w01-fixtureOnly-reference-flag-not-in-formal-sourceRef-schema',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitBlobOid(bytes) {
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, 'utf8'), bytes])).digest('hex');
}

function rowSha256(row) {
  return sha256(Buffer.from(JSON.stringify(row), 'utf8'));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPointer(document, locator) {
  if (typeof locator !== 'string' || !locator.startsWith('/')) throw new Error('selector is not an absolute JSON Pointer');
  let value = document;
  for (const rawToken of locator.slice(1).split('/')) {
    if (/~(?![01])/u.test(rawToken)) throw new Error('selector contains a bad JSON Pointer escape');
    const token = rawToken.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, token)) {
      throw new Error(`selector does not resolve: ${locator}`);
    }
    value = value[token];
  }
  return value;
}

function pointerForArrayMember(base, index) {
  return `${base}/${index}`;
}

function repositoryKey(repoId, commit, filePath) {
  return `${repoId}\u0000${commit}\u0000${filePath}`;
}

function targetKey({ gameReleaseId, recordId, fieldPath, dimension }) {
  return `${gameReleaseId}\u0000${recordId}\u0000${fieldPath}\u0000${dimension ?? ''}`;
}

function addUnique(map, key, value, label) {
  const existing = map.get(key);
  if (existing !== undefined && existing !== value) throw new Error(`${label} has a conflicting pinned locator: ${key}`);
  map.set(key, value);
}

function parseJson(bytes, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (error) { throw new Error(`${label} is not valid UTF-8 JSON: ${error.message}`); }
}

async function readRegularFile(filePath, label) {
  const info = await lstat(filePath);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular non-symlink file`);
  return readFile(filePath);
}

async function readPinnedWorkspaceJson(webRoot, descriptor, label) {
  const bytes = await readRegularFile(path.join(webRoot, ...descriptor.path.split('/')), label);
  if (bytes.length !== descriptor.byteLength || sha256(bytes) !== descriptor.sha256) {
    throw new Error(`${label} differs from its fixed W14 pin`);
  }
  if ([W14_FIXED_INPUTS.sourceReconciliation.path, W14_FIXED_INPUTS.webReconciliation.path].includes(descriptor.path)) {
    reportDescriptorByBytes.set(bytes, { path: descriptor.path, sha256: descriptor.sha256, byteLength: descriptor.byteLength });
  }
  return {
    bytes,
    value: parseJson(bytes, label),
    descriptor: { path: descriptor.path, sha256: descriptor.sha256, byteLength: descriptor.byteLength },
  };
}

async function gitBlobBytes(repoRoot, oid) {
  if (!/^[a-f0-9]{40}$/u.test(oid ?? '')) throw new Error('Git blob OID must be a full SHA-1 object ID');
  const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'cat-file', 'blob', oid], {
    encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, windowsHide: true,
  });
  return Buffer.from(stdout);
}

async function readPinnedArchiveBlobsFromGit(repoRoot, commit, files) {
  if (!/^[a-f0-9]{40}$/u.test(commit) || !Array.isArray(files)) throw new Error('fixed archive Git batch request is invalid');
  const requests = files.map(file => {
    if (!safeRepoPath(file.archivePath) || !/^[a-f0-9]{40}$/u.test(file.gitBlobOid ?? '')
      || !Number.isSafeInteger(file.byteLength) || !/^[a-f0-9]{64}$/u.test(file.sha256 ?? '')) {
      throw new Error('fixed archive manifest contains an invalid raw file descriptor');
    }
    return `${commit}:content/legacy/mods/241ad76/${file.archivePath}\n`;
  }).join('');
  const batchBytes = await new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', repoRoot, 'cat-file', '--batch'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 128 * 1024 * 1024) child.kill();
      else stdout.push(Buffer.from(chunk));
    });
    child.stderr.on('data', chunk => {
      if (stderr.reduce((length, part) => length + part.length, 0) < 8192) stderr.push(Buffer.from(chunk));
    });
    child.once('error', () => reject(new Error('fixed archive Git object batch could not start')));
    child.once('close', code => {
      if (code !== 0 || stdoutBytes > 128 * 1024 * 1024) return reject(new Error('fixed archive Git object batch failed'));
      resolve(Buffer.concat(stdout));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(requests, 'utf8'));
  });
  const result = new Map();
  let offset = 0;
  for (const file of files) {
    const lineEnd = batchBytes.indexOf(0x0a, offset);
    if (lineEnd < 0) throw new Error('fixed archive Git batch response is truncated');
    const header = batchBytes.toString('ascii', offset, lineEnd);
    const match = /^([a-f0-9]{40}) blob ([0-9]+)$/u.exec(header);
    if (!match || match[1] !== file.gitBlobOid || Number(match[2]) !== file.byteLength) {
      throw new Error(`fixed archive Git blob identity differs: ${file.archivePath}`);
    }
    const start = lineEnd + 1;
    const end = start + file.byteLength;
    if (end >= batchBytes.length || batchBytes[end] !== 0x0a) throw new Error('fixed archive Git batch payload is truncated');
    const bytes = batchBytes.subarray(start, end);
    if (sha256(bytes) !== file.sha256 || gitBlobOid(bytes) !== file.gitBlobOid) {
      throw new Error(`fixed archive Git blob bytes differ: ${file.archivePath}`);
    }
    if (result.has(file.archivePath)) throw new Error(`fixed archive repeats a path: ${file.archivePath}`);
    result.set(file.archivePath, bytes);
    offset = end + 1;
  }
  if (offset !== batchBytes.length) throw new Error('fixed archive Git batch has trailing bytes');
  return result;
}

async function gitCommitPathBytes(repoRoot, commit, filePath) {
  if (!/^[a-f0-9]{40}$/u.test(commit ?? '') || !safeRepoPath(filePath)) throw new Error('fixed Git commit/path is invalid');
  const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'cat-file', 'blob', `${commit}:${filePath}`], {
    encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, windowsHide: true,
  });
  return Buffer.from(stdout);
}

async function addPinnedGitObject({ map, repoId, repoRoot, descriptor }) {
  const bytes = await gitBlobBytes(repoRoot, descriptor.gitBlobOid);
  if (bytes.length !== descriptor.byteLength || sha256(bytes) !== descriptor.sha256 || gitBlobOid(bytes) !== descriptor.gitBlobOid) {
    throw new Error(`fixed Git object differs from its byte descriptor: ${repoId}:${descriptor.path}`);
  }
  addUnique(map, repositoryKey(repoId, descriptor.commit, descriptor.path), bytes, 'W14 pinned Git input');
  return bytes;
}

function indexUniqueRows(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} rows are missing`);
  const result = new Map();
  for (const row of rows) {
    if (!row || typeof row.entryId !== 'string' || result.has(row.entryId)) throw new Error(`${label} has a duplicate or malformed row identity`);
    result.set(row.entryId, row);
  }
  return result;
}

function indexTargets(rows, selectIdentity) {
  const result = new Map();
  rows.forEach((row, index) => {
    const key = selectIdentity(row);
    const values = result.get(key) ?? [];
    values.push({ row, index });
    result.set(key, values);
  });
  return result;
}

function selectUniqueApproved(matches, label) {
  if (!Array.isArray(matches) || matches.length !== 1) return null;
  const match = matches[0];
  if (match.row?.state !== 'approved' || !/^[a-f0-9]{64}$/u.test(match.row.targetDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(match.row.dependenciesDigest ?? '')) return null;
  if (label === 'web' && !match.row.target?.targetId) return null;
  return match;
}

function hasApprovedHumanReceipt(candidate, target, { web = false } = {}) {
  const targetId = web ? target.target?.targetId : null;
  const matches = candidate.review?.receipts?.filter(item => {
    const receipt = item?.receipt;
    return receipt?.decision === 'approved'
      && receipt?.targetDigest === target.targetDigest
      && receipt?.dependenciesDigest === target.dependenciesDigest
      && (!web || receipt.targetId === targetId)
      && receipt?.reviewer?.kind === 'human';
  }) ?? [];
  return matches.length > 0;
}

function candidateEvidence(descriptor, target, index, { web = false } = {}) {
  const tupleId = web
    ? target.target.targetId
    : `source:${target.gameReleaseId}:${target.recordId}:${target.fieldPath}:${target.dimension}`;
  return {
    kind: 'approved-target-receipt',
    repoId: 'web',
    commit: descriptor.commit,
    path: descriptor.path,
    fileSha256: descriptor.sha256,
    byteLength: descriptor.byteLength,
    gitBlobOid: descriptor.gitBlobOid,
    selector: {
      kind: 'json-pointer',
      locator: `/review/${web ? 'targets' : 'sourceTargets'}/${index}`,
    },
    targetId: tupleId,
    targetSha256: target.targetDigest,
    dependencySha256: target.dependenciesDigest,
  };
}

function createMetadataDecision({ sourceEntry, report, reportPath, reportDescriptor: descriptor, reportRow, status, decisionSha256 }) {
  if (!reportRow || reportRow.entryId !== sourceEntry.entryId || reportRow.sourceRowSha256 !== rowSha256(sourceEntry)) {
    return null;
  }
  const index = report.rows.indexOf(reportRow);
  const historicalTarget = status === 'historical-analysis-retained-at-exact-1-13-1-release'
    ? reportRow.decision?.target ?? null
    : null;
  return {
    disposition: 'migrated',
    actualOutcome: {
      status: 'migrated',
      migrationKind: 'metadata-mapping',
      reportStatus: status,
      ...(historicalTarget ? { metadataSubtype: 'historical-identity-correction' } : {}),
      ...(historicalTarget ? { historicalTarget: { ...historicalTarget } } : {}),
    },
    review: {
      state: 'not-applicable',
      carryForward: false,
      basisRefs: [`W14 exact row reconciliation ${reportPath}`, `row ${sourceEntry.entryId}`, `status ${status}`],
    },
    destination: {
      kind: 'reconciliation-row',
      repoId: 'web',
      path: reportPath,
      reportSha256: descriptor.sha256,
      reportByteLength: descriptor.byteLength,
      rowIndex: index,
      entryId: sourceEntry.entryId,
      sourceRowSha256: rowSha256(sourceEntry),
      decisionStatus: status,
      decisionSha256,
    },
  };
}

function createGapDecision(sourceEntry, reason) {
  return {
    disposition: 'migrated',
    actualOutcome: { status: 'gap', reason },
    review: { state: 'pending', carryForward: false, basisRefs: [`W03 exact row ${sourceEntry.entryId}`, 'W14 target unresolved'] },
    destination: null,
  };
}

function sourceRecordPointer(recordIndex, fieldPath) {
  if (!Number.isSafeInteger(recordIndex) || recordIndex < 0 || typeof fieldPath !== 'string' || !fieldPath.startsWith('/')) return null;
  return `/records/${recordIndex}${fieldPath}`;
}

function buildSourceTargetIndex(candidate) {
  return indexTargets(candidate.review?.sourceTargets ?? [], row => targetKey(row));
}

function buildWebTargetIndex(candidate) {
  return indexTargets(candidate.review?.targets ?? [], row => {
    const target = row?.target ?? {};
    return `${target.ownerId ?? ''}\u0000${target.ownerKind ?? ''}\u0000${target.fieldPath ?? ''}\u0000${target.dimension ?? ''}`;
  });
}

function sourceApprovalCover(sourceEntry, reportRow, context) {
  const target = reportRow?.decision?.target;
  const setId = reportRow?.decision?.approvalEvidenceSetId;
  const evidenceSet = context.sourceReport?.rowEvidenceIndex?.approvalEvidenceSets?.[setId];
  if (!target || !Array.isArray(evidenceSet) || !/^[a-f0-9]{64}$/u.test(target.actualValueCanonicalSha256 ?? '')) return null;
  const covering = [];
  for (const evidence of evidenceSet) {
    const attestation = evidence?.candidateReceipt ?? evidence;
    const coveredBy = evidence?.coveredBy;
    if (attestation?.state !== 'approved' || attestation?.mode !== 'source'
      || attestation.gameReleaseId !== target.gameReleaseId || attestation.recordId !== target.recordId
      || typeof attestation.fieldPath !== 'string' || !attestation.fieldPath.startsWith('/')
      || typeof attestation.dimension !== 'string' || !attestation.dimension) return null;
    if (coveredBy !== undefined && (coveredBy === null || typeof coveredBy !== 'object' || Array.isArray(coveredBy)
      || typeof coveredBy.fieldPath !== 'string' || !coveredBy.fieldPath.startsWith('/')
      || typeof coveredBy.dimension !== 'string' || !coveredBy.dimension
      || coveredBy.fieldPath !== attestation.fieldPath || coveredBy.dimension !== attestation.dimension)) return null;
    const coveredFieldPath = coveredBy?.fieldPath ?? attestation.fieldPath;
    const coveredDimension = coveredBy?.dimension ?? attestation.dimension;
    const matches = context.sourceTargetIndex.get(targetKey({
      gameReleaseId: attestation.gameReleaseId,
      recordId: attestation.recordId,
      fieldPath: coveredFieldPath,
      dimension: coveredDimension,
    })) ?? [];
    if (matches.length !== 1) return null;
    for (const candidate of matches) {
      const candidateTarget = candidate.row;
      if (candidateTarget.state !== 'approved' || candidateTarget.targetDigest !== attestation.targetDigest
        || candidateTarget.dependenciesDigest !== attestation.dependenciesDigest
        || !hasApprovedHumanReceipt(context.candidate, candidateTarget)) return null;
      covering.push({ ...candidate, evidence, attestation, coveredFieldPath, coveredDimension });
    }
  }
  if (!covering.length) return null;
  const exact = covering.filter(item => item.coveredFieldPath === target.fieldPath);
  const ancestors = covering.filter(item => target.fieldPath.startsWith(`${item.coveredFieldPath}/`));
  const longestAncestorLength = ancestors.length ? Math.max(...ancestors.map(item => item.coveredFieldPath.length)) : -1;
  const directEvidence = covering.filter(item => item.evidence?.coveredBy === undefined);
  const selected = exact.length ? exact : longestAncestorLength >= 0
    ? ancestors.filter(item => item.coveredFieldPath.length === longestAncestorLength)
    : directEvidence.length === 1 ? directEvidence
      : SOURCE_MULTI_COVER_STATUSES.has(reportRow.decision.status) ? covering : [];
  if (!selected.length || (!SOURCE_MULTI_COVER_STATUSES.has(reportRow.decision.status) && selected.length !== 1)) return null;
  const primaryOrder = (left, right) => (left.coveredDimension === 'technical' ? 0 : 1)
    - (right.coveredDimension === 'technical' ? 0 : 1)
    || left.coveredFieldPath.length - right.coveredFieldPath.length
    || left.coveredFieldPath.localeCompare(right.coveredFieldPath)
    || left.index - right.index;
  const [match] = [...selected].sort(primaryOrder);
  const rowIndex = context.sourceReportRowIndexes?.get(sourceEntry.entryId);
  if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || !Buffer.isBuffer(context.sourceReportBytes)) return null;
  const fixedReport = reportDescriptor(context, 'source');
  const approvalClosure = {
    reportPath: W14_FIXED_INPUTS.sourceReconciliation.path,
    reportSha256: fixedReport.sha256,
    reportByteLength: fixedReport.byteLength,
    rowIndex,
    entryId: sourceEntry.entryId,
    sourceRowSha256: rowSha256(sourceEntry),
    decisionStatus: reportRow.decision.status,
    decisionSha256: decisionShaForSourceRow(reportRow),
    approvalEvidenceSetId: setId,
    references: [...covering].sort(primaryOrder).map(item => ({
      coveredBy: item.evidence?.coveredBy === undefined ? null : {
        fieldPath: item.coveredFieldPath,
        dimension: item.coveredDimension,
      },
      attestation: {
        gameReleaseId: item.attestation.gameReleaseId,
        recordId: item.attestation.recordId,
        fieldPath: item.attestation.fieldPath,
        dimension: item.attestation.dimension,
        targetDigest: item.attestation.targetDigest,
        dependenciesDigest: item.attestation.dependenciesDigest,
      },
      candidateEvidence: candidateEvidence(context.candidateDescriptor, item.row, item.index),
    })),
  };
  return { ...match, approvalEvidenceSetId: setId, approvalClosure };
}

function createSourceIdentityAssignment(sourceEntry, reportRow, context) {
  if (sourceEntry.target?.status !== 'not-generated' || sourceEntry.target.recordId !== null
    || !['stable-id', 'legacy-id', 'record-index'].includes(sourceEntry.sourceEntityKey?.kind)
    || typeof sourceEntry.sourceEntityKey?.value !== 'string' || !sourceEntry.sourceEntityKey.value
    || (sourceEntry.sourceEntityKey.kind === 'record-index'
      && !/^(0|[1-9][0-9]*)$/u.test(sourceEntry.sourceEntityKey.value))
    || !reportRow
    || reportRow.entryId !== sourceEntry.entryId || reportRow.sourceRowSha256 !== rowSha256(sourceEntry)) return null;
  const target = reportRow.decision?.target;
  const rowIndex = context.sourceReportRowIndexes?.get(sourceEntry.entryId);
  if (!target || target.gameReleaseId !== sourceEntry.scope?.gameReleaseId
    || (sourceEntry.sourceEntityKey.kind === 'stable-id' && target.recordId !== sourceEntry.sourceEntityKey.value)
    || typeof target.recordId !== 'string' || !target.recordId
    || typeof target.kind !== 'string' || !target.kind
    || typeof target.fieldPath !== 'string' || !target.fieldPath.startsWith('/')
    || !Number.isSafeInteger(rowIndex) || rowIndex < 0
    || !Buffer.isBuffer(context.sourceReportBytes)) return null;
  return {
    kind: 'w03-not-generated-target-assignment',
    reportPath: W14_FIXED_INPUTS.sourceReconciliation.path,
    reportSha256: reportDescriptor(context, 'source').sha256,
    reportByteLength: reportDescriptor(context, 'source').byteLength,
    rowIndex,
    entryId: sourceEntry.entryId,
    sourceRowSha256: rowSha256(sourceEntry),
    sourceEntityKey: { ...sourceEntry.sourceEntityKey },
    decisionStatus: reportRow.decision.status,
    decisionSha256: decisionShaForSourceRow(reportRow),
    target: { ...target },
  };
}

function legacyWeaponIdentityMatches(packetRecord, sourceEntityKey, targetFieldPath) {
  if (packetRecord?.kind !== 'weapon' || sourceEntityKey?.kind !== 'legacy-id') return false;
  if (packetRecord.payload?.templateKey === sourceEntityKey.value) return true;
  if (!['primary', 'secondary'].includes(sourceEntityKey.value)) return false;
  const match = /^\/payload\/displayedAttacks\/([01])\/.+$/u.exec(targetFieldPath ?? '');
  const expectedIndex = sourceEntityKey.value === 'primary' ? '0' : '1';
  return match?.[1] === expectedIndex
    && packetRecord.payload?.displayedAttacks?.[Number(expectedIndex)]?.key === sourceEntityKey.value;
}

function createSourceApprovedDecision(sourceEntry, reportRow, context) {
  const status = reportRow?.decision?.status;
  if (status === 'legacy-not-imported-coverage-superseded-by-approved-current-action-profile-resolution') {
    return createApprovedActionProfileResolutionDecision(sourceEntry, reportRow, context);
  }
  if (!SOURCE_DIRECT_STATUSES.has(status) || reportRow?.sourceRowSha256 !== rowSha256(sourceEntry)) return null;
  const target = reportRow.decision.target;
  const identityAssignment = sourceEntry.target?.status === 'not-generated' && sourceEntry.target.recordId === null
    ? createSourceIdentityAssignment(sourceEntry, reportRow, context) : null;
  if (!target || target.gameReleaseId !== sourceEntry.scope?.gameReleaseId
    || (target.recordId !== sourceEntry.target?.recordId && !identityAssignment) || !target.fieldPath?.startsWith('/')) return null;

  const match = sourceApprovalCover(sourceEntry, reportRow, context);
  if (!match) return null;

  const recordKey = `${target.gameReleaseId}\u0000${target.recordId}`;
  const packetMatch = context.sourceRecordIndexes.get(recordKey);
  if (!packetMatch || packetMatch.length !== 1) return null;
  const packetRecord = context.sourceTechnical.records[packetMatch[0]];
  if (target.kind && packetRecord?.kind !== target.kind) return null;
  if (identityAssignment?.sourceEntityKey.kind === 'legacy-id'
    && !legacyWeaponIdentityMatches(packetRecord, identityAssignment.sourceEntityKey, target.fieldPath)) return null;
  const selector = sourceRecordPointer(packetMatch[0], target.fieldPath);
  if (!selector) return null;
  let value;
  try { value = readPointer(context.sourceTechnical, selector); }
  catch { return null; }
  if (sha256(Buffer.from(JSON.stringify(value), 'utf8')) !== target.actualValueCanonicalSha256) return null;
  const evidence = candidateEvidence(context.candidateDescriptor, match.row, match.index);
  return {
    disposition: 'migrated',
    actualOutcome: {
      status: 'migrated',
      migrationKind: 'approved-source-target-reuse',
      sourceValueExactAtTarget: reportRow.decision.sourceValueExactAtTarget === true,
      targetFieldPath: target.fieldPath,
      approvalEvidenceSetId: match.approvalEvidenceSetId,
      approvedCoverFieldPath: match.row.fieldPath,
      approvedCoverDimension: match.row.dimension,
      approvedCoverClosure: match.approvalClosure,
    },
    review: {
      state: 'verified-reuse',
      carryForward: true,
      basisRefs: [
        `W13 fixed owner candidate ${context.candidateDescriptor.sha256}`,
        `approved Source target ${target.gameReleaseId}/${target.recordId}${target.fieldPath}`,
        `receipt-bound approved cover ${match.row.dimension}:${match.row.fieldPath}`,
      ],
      evidence,
    },
    destination: {
      kind: 'source-packet-file',
      repoId: 'source',
      releaseId: context.sourceArchive.releaseId,
      archiveSha256: context.sourceArchive.archiveSha256,
      packetPath: 'technical.json',
      fileSha256: context.sourcePacketDescriptor.sha256,
      byteLength: context.sourcePacketDescriptor.byteLength,
      selector: { kind: 'json-pointer', locator: selector },
      fragmentSha256: sha256(Buffer.from(JSON.stringify(value), 'utf8')),
      gameReleaseId: target.gameReleaseId,
      recordId: target.recordId,
      ...(identityAssignment ? { identityAssignment } : {}),
    },
  };
}

function createApprovedActionProfileResolutionDecision(sourceEntry, reportRow, context) {
  if (reportRow?.sourceRowSha256 !== rowSha256(sourceEntry)) return null;
  const target = reportRow.decision?.target;
  const setId = reportRow.decision?.approvedReceiptsSetId;
  const receiptSet = context.sourceReport?.rowEvidenceIndex?.approvalEvidenceSets?.[setId];
  const requiresIdentityAssignment = sourceEntry.target?.status === 'not-generated' && sourceEntry.target.recordId === null;
  const identityAssignment = requiresIdentityAssignment
    ? createSourceIdentityAssignment(sourceEntry, reportRow, context) : null;
  if (!target || target.kind !== 'weapon' || target.fieldPath !== '/payload/actionProfileResolution'
    || target.gameReleaseId !== sourceEntry.scope?.gameReleaseId
    || (target.recordId !== sourceEntry.target?.recordId && !identityAssignment)
    || (identityAssignment && (identityAssignment.target.recordId !== target.recordId
      || identityAssignment.target.kind !== target.kind || identityAssignment.target.fieldPath !== target.fieldPath))
    || (!requiresIdentityAssignment && target.recordId !== sourceEntry.target?.recordId)
    || (target.gameReleaseId !== sourceEntry.target?.gameReleaseId && !identityAssignment)
    || !Array.isArray(receiptSet) || receiptSet.length !== 1) return null;
  const proof = receiptSet[0];
  if (proof?.state !== 'approved' || !/^[a-f0-9]{64}$/u.test(proof.targetDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(proof.dependenciesDigest ?? '')) return null;
  const matches = context.sourceTargetIndex.get(targetKey({
    gameReleaseId: target.gameReleaseId, recordId: target.recordId,
    fieldPath: target.fieldPath, dimension: 'technical',
  })) ?? [];
  if (matches.length !== 1) return null;
  const match = matches[0];
  const approvedTarget = match.row;
  if (approvedTarget.state !== 'approved' || approvedTarget.mode !== 'source'
    || approvedTarget.targetDigest !== proof.targetDigest
    || approvedTarget.dependenciesDigest !== proof.dependenciesDigest
    || !hasApprovedHumanReceipt(context.candidate, approvedTarget)) return null;

  const recordKey = `${target.gameReleaseId}\u0000${target.recordId}`;
  const packetMatches = context.sourceRecordIndexes.get(recordKey);
  if (!packetMatches || packetMatches.length !== 1) return null;
  const packetRecord = context.sourceTechnical.records[packetMatches[0]];
  if (packetRecord?.kind !== 'weapon'
    || (identityAssignment?.sourceEntityKey.kind === 'legacy-id'
      && !legacyWeaponIdentityMatches(packetRecord, identityAssignment.sourceEntityKey, target.fieldPath))) return null;
  const selector = sourceRecordPointer(packetMatches[0], target.fieldPath);
  if (!selector) return null;
  let resolution;
  try { resolution = readPointer(context.sourceTechnical, selector); }
  catch { return null; }
  const requiredFields = ['actionGenerators', 'executionPolicy', 'fallbackActions', 'generatorBindings', 'inputSetup', 'localActions', 'staticClosure'];
  if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)
    || requiredFields.some(field => !Object.hasOwn(resolution, field))) return null;

  const evidence = candidateEvidence(context.candidateDescriptor, approvedTarget, match.index);
  const fixedReport = reportDescriptor(context, 'source');
  const resolutionProof = {
    kind: 'w03-approved-action-profile-resolution',
    reportPath: W14_FIXED_INPUTS.sourceReconciliation.path,
    reportSha256: fixedReport.sha256,
    reportByteLength: fixedReport.byteLength,
    rowIndex: context.sourceReportRowIndexes?.get(sourceEntry.entryId),
    entryId: sourceEntry.entryId,
    sourceRowSha256: rowSha256(sourceEntry),
    decisionStatus: reportRow.decision.status,
    decisionSha256: decisionShaForSourceRow(reportRow),
    approvedReceiptsSetId: setId,
    target: { ...target },
    receipt: { targetDigest: proof.targetDigest, dependenciesDigest: proof.dependenciesDigest, state: proof.state },
  };
  if (!Number.isSafeInteger(resolutionProof.rowIndex) || resolutionProof.rowIndex < 0) return null;
  return {
    disposition: 'migrated',
    actualOutcome: {
      status: 'migrated',
      migrationKind: 'approved-source-action-profile-resolution',
      targetFieldPath: target.fieldPath,
      approvedReceiptsSetId: setId,
      approvedTargetDigest: proof.targetDigest,
      approvedDependenciesDigest: proof.dependenciesDigest,
    },
    review: {
      state: 'verified-reuse', carryForward: true,
      basisRefs: [
        `W13 fixed owner candidate ${context.candidateDescriptor.sha256}`,
        `approved action-profile resolution ${target.gameReleaseId}/${target.recordId}${target.fieldPath}`,
        `exact row-bound W14 Source reconciliation ${W14_FIXED_INPUTS.sourceReconciliation.sha256}`,
      ],
      evidence,
    },
    destination: {
      kind: 'source-packet-file', repoId: 'source',
      releaseId: context.sourceArchive.releaseId, archiveSha256: context.sourceArchive.archiveSha256,
      packetPath: 'technical.json', fileSha256: context.sourcePacketDescriptor.sha256,
      byteLength: context.sourcePacketDescriptor.byteLength,
      selector: { kind: 'json-pointer', locator: selector },
      fragmentSha256: sha256(Buffer.from(JSON.stringify(resolution), 'utf8')),
      gameReleaseId: target.gameReleaseId, recordId: target.recordId,
      ...(identityAssignment ? { identityAssignment } : {}),
      resolutionProof,
    },
  };
}

function createWebApprovedDecision(sourceEntry, reportRow, context) {
  const status = reportRow?.disposition;
  if (!['approved-current-reuse', 'approved-current-rewrite'].includes(status)
    || reportRow.sourceRowSha256 !== rowSha256(sourceEntry)) return null;
  const mapping = reportRow.currentMapping;
  if (!mapping || typeof mapping.ownerId !== 'string' || typeof mapping.ownerKind !== 'string'
    || typeof mapping.fieldPath !== 'string' || !mapping.fieldPath.startsWith('/')) return null;
  const ownerCandidateTargets = reportRow.evidence?.ownerCandidateTargets;
  if (!Array.isArray(ownerCandidateTargets) || ownerCandidateTargets.length === 0) return null;
  const candidateTargets = [];
  for (const ref of ownerCandidateTargets) {
    if (!ref || ref.candidateState !== 'approved' || ref.receiptMatchesPinnedOwnerCandidate !== true
      || ref.ownerId !== mapping.ownerId || ref.ownerKind !== mapping.ownerKind
      || typeof ref.targetId !== 'string' || !ref.targetId
      || typeof ref.fieldPath !== 'string' || !ref.fieldPath.startsWith('/')
      || typeof ref.dimension !== 'string' || !ref.dimension
      || !/^[a-f0-9]{64}$/u.test(ref.targetDigest ?? '')
      || !/^[a-f0-9]{64}$/u.test(ref.dependenciesDigest ?? '')) return null;
    const hits = context.candidate.review.targets.map((row, index) => ({ row, index }))
      .filter(item => item.row.target?.targetId === ref.targetId);
    if (hits.length !== 1) return null;
    const [candidateTarget] = hits;
    const target = candidateTarget.row.target;
    if (candidateTarget.row.state !== 'approved' || target.ownerId !== ref.ownerId
      || target.ownerKind !== ref.ownerKind || target.fieldPath !== ref.fieldPath
      || target.dimension !== ref.dimension || candidateTarget.row.targetDigest !== ref.targetDigest
      || candidateTarget.row.dependenciesDigest !== ref.dependenciesDigest
      || !hasApprovedHumanReceipt(context.candidate, candidateTarget.row, { web: true })) return null;
    candidateTargets.push({ ...candidateTarget, ref });
  }
  const uniqueTargets = new Map(candidateTargets.map(item => [item.row.target.targetId, item]));
  if (uniqueTargets.size !== 1) return null;
  const match = [...uniqueTargets.values()][0];
  const originalOwnerId = sourceEntry.target?.recordId;
  const compiledOfficialReassignment = ['approved-compiled-official-input-field', 'approved-compiled-official-placeholder'].includes(mapping.kind)
    && sourceEntry.target?.status !== 'not-generated'
    && sourceEntry.target?.repoId === 'web'
    && sourceEntry.sourceEntityKey?.kind === 'legacy-id'
    && sourceEntry.sourceEntityKey.value === originalOwnerId
    && sourceEntry.target?.fieldPath?.startsWith('/records/')
    && sourceEntry.target?.fieldPath?.includes('/payload/official/')
    && mapping.ownerKind === 'presentation'
    && mapping.fieldPath.startsWith('/officialInputs/sources/');
  if (originalOwnerId !== mapping.ownerId && !compiledOfficialReassignment) return null;
  const domainOwners = [];
  for (const domain of context.domains) {
    const collectionName = mapping.ownerKind === 'presentation' ? 'presentations'
      : mapping.ownerKind === 'term-localization' ? 'termLocalizations' : null;
    if (!collectionName || (mapping.ownerKind === 'term-localization' && domain.value.kind !== 'terms')) continue;
    for (const [index, presentation] of (domain.value.web?.[collectionName] ?? []).entries()) {
      if (presentation?.authoringId === mapping.ownerId) domainOwners.push({ domain, index, presentation, collectionName });
    }
  }
  if (domainOwners.length !== 1) return null;
  const { domain, index, presentation, collectionName } = domainOwners[0];
  const entityRef = mapping.ownerKind === 'term-localization' ? presentation.termRef : presentation.entityRef;
  if (presentation.authoringId !== mapping.ownerId
    || entityRef?.gameReleaseId !== sourceEntry.scope?.gameReleaseId
    || typeof entityRef?.recordId !== 'string' || !entityRef.recordId.trim()) return null;
  const selector = pointerForArrayMember(`/web/${collectionName}`, index);
  const evidence = candidateEvidence(context.candidateDescriptor, match.row, match.index, { web: true });
  const fixedReport = reportDescriptor(context, 'web');
  const mappingProof = compiledOfficialReassignment ? {
    kind: 'w03-approved-compiled-official-owner-reassignment',
    reportPath: W14_FIXED_INPUTS.webReconciliation.path,
    reportSha256: fixedReport.sha256,
    reportByteLength: fixedReport.byteLength,
    rowIndex: context.webReportRowIndexes?.get(sourceEntry.entryId),
    entryId: sourceEntry.entryId,
    sourceRowSha256: rowSha256(sourceEntry),
    decisionSha256: decisionShaForWebRow(reportRow),
    originalOwnerId,
    mappedOwnerId: mapping.ownerId,
    ownerKind: mapping.ownerKind,
    ownerFieldPath: mapping.fieldPath,
  } : undefined;
  if (mappingProof && (!Number.isSafeInteger(mappingProof.rowIndex) || mappingProof.rowIndex < 0)) return null;
  return {
    disposition: 'migrated',
    actualOutcome: {
      status: 'migrated',
      migrationKind: 'approved-web-target-reuse',
      sourceValueExactAtTarget: reportRow.currentMapping.sourceValueMatchesCurrent === true,
      targetFieldPath: match.row.target.fieldPath,
      ownerId: mapping.ownerId,
      ownerKind: mapping.ownerKind,
      ...(mappingProof ? { ownerMappingKind: mapping.kind, ownerFieldPath: mapping.fieldPath } : {}),
    },
    review: {
      state: 'verified-reuse',
      carryForward: true,
      basisRefs: [
        `W13 fixed owner candidate ${context.candidateDescriptor.sha256}`,
        `approved Web target ${mapping.ownerId}${match.row.target.fieldPath}`,
      ],
      evidence,
    },
    destination: {
      kind: 'repository-file',
      repoId: 'web',
      commit: domain.descriptor.commit,
      path: domain.descriptor.path,
      fileSha256: domain.descriptor.sha256,
      byteLength: domain.descriptor.byteLength,
      gitBlobOid: domain.descriptor.gitBlobOid,
      selector: { kind: 'json-pointer', locator: selector },
      fragmentSha256: sha256(Buffer.from(JSON.stringify(presentation), 'utf8')),
      gameReleaseId: sourceEntry.scope.gameReleaseId,
      recordId: sourceEntry.target.recordId,
      mappedFieldPath: match.row.target.fieldPath,
      ownerId: mapping.ownerId,
      ownerKind: mapping.ownerKind,
      entityRef: { ...entityRef },
      ...(mappingProof ? { ownerMappingProof: mappingProof } : {}),
    },
  };
}

function decisionShaForWebRow(row) {
  return sha256(Buffer.from(JSON.stringify({
    disposition: row.disposition,
    currentMapping: row.currentMapping,
    mappingBasis: row.mappingBasis,
  }), 'utf8'));
}

function decisionShaForSourceRow(row) {
  return sha256(Buffer.from(JSON.stringify(row.decision), 'utf8'));
}

function reportDescriptor(context, kind) {
  const fixed = W14_FIXED_INPUTS[`${kind}Reconciliation`];
  const bytes = context[`${kind}ReportBytes`];
  if (!Buffer.isBuffer(bytes)) return null;
  if (reportDescriptorByBytes.has(bytes)) return reportDescriptorByBytes.get(bytes);
  const descriptor = {
    path: fixed.path,
    sha256: sha256(bytes),
    byteLength: bytes.length,
  };
  reportDescriptorByBytes.set(bytes, descriptor);
  return descriptor;
}

export function classifyW14AEntry(sourceEntry, context) {
  if (sourceEntry.scope?.releaseScope === 'current-snapshot-candidate') {
    if (sourceEntry.owner === 'source') {
      const row = context.sourceRows.get(sourceEntry.entryId);
      const direct = createSourceApprovedDecision(sourceEntry, row, context);
      if (direct) return direct;
      if (row?.sourceRowSha256 === rowSha256(sourceEntry) && SOURCE_METADATA_STATUSES.has(row.decision?.status)) {
        return createMetadataDecision({
          sourceEntry, report: context.sourceReport,
          reportPath: W14_FIXED_INPUTS.sourceReconciliation.path,
          reportDescriptor: reportDescriptor(context, 'source'), reportRow: row,
          status: row.decision.status, decisionSha256: decisionShaForSourceRow(row),
        }) ?? createGapDecision(sourceEntry, 'Source reconciliation row does not bind this exact W03 row.');
      }
      return createGapDecision(sourceEntry, row ? `No verified current Source destination for reconciliation status ${row.decision?.status ?? 'missing'}.` : 'Current Source row is missing from the fixed reconciliation report.');
    }
    if (sourceEntry.owner === 'web') {
      const row = context.webRows.get(sourceEntry.entryId);
      const direct = createWebApprovedDecision(sourceEntry, row, context);
      if (direct) return direct;
      if (row?.sourceRowSha256 === rowSha256(sourceEntry) && row.disposition === 'metadata-mapped') {
        return createMetadataDecision({
          sourceEntry, report: context.webReport,
          reportPath: W14_FIXED_INPUTS.webReconciliation.path,
          reportDescriptor: reportDescriptor(context, 'web'), reportRow: row,
          status: row.disposition, decisionSha256: decisionShaForWebRow(row),
        }) ?? createGapDecision(sourceEntry, 'Web metadata reconciliation row does not bind this exact W03 row.');
      }
      if (row?.sourceRowSha256 === rowSha256(sourceEntry) && row.disposition === 'deferred-w15') {
        return {
          disposition: 'deferred-w15',
          actualOutcome: {
            status: 'deferred-w15',
            scopeGroupId: 'W15-announcements',
            scopeOwner: 'W15',
            reason: 'W03 announcement content belongs to the explicitly deferred W15 announcement migration; no announcement content is completed by this overlay.',
          },
          review: { state: 'not-applicable', carryForward: false, basisRefs: ['W03 exact announcement row', `W14 Web reconciliation ${W14_FIXED_INPUTS.webReconciliation.sha256}`] },
          destination: null,
        };
      }
      return createGapDecision(sourceEntry, row ? `No verified current Web destination for reconciliation status ${row.disposition}.` : 'Current Web row is missing from the fixed reconciliation report.');
    }
    return createGapDecision(sourceEntry, `Current-snapshot row owner ${sourceEntry.owner} has no fixed W14 reconciliation source.`);
  }

  if (sourceEntry.scope?.releaseScope === 'synthetic-only') {
    return {
      disposition: 'excluded',
      actualOutcome: { status: 'excluded', reason: 'The frozen W03 row is explicitly scoped to synthetic test/example content and is not current player data.' },
      review: { state: 'not-applicable', carryForward: false, basisRefs: ['W03 exact synthetic-only scope', `row ${sourceEntry.entryId}`] },
      destination: null,
    };
  }

  if (sourceEntry.scope?.releaseScope === 'registry-snapshot' && sourceEntry.source?.repoId === 'source-code') {
    const row = context.registryRows.get(sourceEntry.entryId);
    if (!registryRowBindsSource(row, sourceEntry)) {
      return createGapDecision(sourceEntry, 'The fixed registry reconciliation does not bind this exact W03 source-code locator.');
    }
    return {
      disposition: 'kept',
      actualOutcome: {
        status: 'kept',
        reason: 'The exact source-code registry snapshot remains at its fixed W03 locator. Registry membership is not a game-release or player-availability claim.',
        registryClassification: row.classification,
        registryEvidence: {
          path: W14_FIXED_INPUTS.registryReconciliation.path,
          sha256: W14_FIXED_INPUTS.registryReconciliation.sha256,
          entryId: row.entryId,
          playerAvailabilityInferred: false,
        },
      },
      review: { state: 'not-applicable', carryForward: false, basisRefs: ['W03 fixed source-code registry row', `W14 registry reconciliation ${W14_FIXED_INPUTS.registryReconciliation.sha256}`] },
      destination: pinnedSourceDestination(sourceEntry),
    };
  }

  if (sourceEntry.source?.repoId === 'extension') {
    const archived = context.extensionFiles.get(`${sourceEntry.source.commit}\u0000${sourceEntry.source.path}\u0000${sourceEntry.source.gitBlobOid}`);
    if (archived) return extensionArchiveDecision(sourceEntry, archived);
  }
  if (['source', 'web', 'extension', 'source-code'].includes(sourceEntry.source?.repoId)) {
    return {
      disposition: 'kept',
      actualOutcome: {
        status: 'kept',
        reason: `The noncurrent row remains at its exact frozen W03 ${sourceEntry.scope?.releaseScope ?? 'release-unspecified'} source pointer; this reuses the ledger locator and does not claim a fresh byte read or current game-version identity.`,
      },
      review: { state: 'not-applicable', carryForward: false, basisRefs: ['W03 fixed source ledger pointer', `release scope ${sourceEntry.scope?.releaseScope ?? 'unspecified'}`] },
      destination: pinnedSourceDestination(sourceEntry),
    };
  }
  return createGapDecision(sourceEntry, `No fixed W14 outcome mapping exists for noncurrent source owner ${sourceEntry.source?.repoId ?? 'missing'}.`);
}

function registryRowBindsSource(reportRow, sourceEntry) {
  return reportRow?.entryId === sourceEntry.entryId
    && reportRow.source?.repoId === sourceEntry.source?.repoId
    && reportRow.source?.commit === sourceEntry.source?.commit
    && reportRow.source?.path === sourceEntry.source?.path
    && reportRow.source?.gitBlobOid === sourceEntry.source?.gitBlobOid
    && sameJson(reportRow.selector, sourceEntry.selector)
    && reportRow.sourceFragmentSha256 === sourceEntry.fragment?.sha256
    && sameJson(reportRow.sourceScope, sourceEntry.scope);
}

function pinnedSourceDestination(sourceEntry) {
  const modsGroupId = sourceEntry.source?.repoId === 'mods'
    ? sourceEntry.review?.basisRefs?.map(ref => /^W03\/(K01|K02)$/u.exec(ref)?.[1]).find(Boolean)
    : undefined;
  return {
    kind: 'pinned-source-object',
    repoId: sourceEntry.source.repoId,
    commit: sourceEntry.source.commit,
    path: sourceEntry.source.path,
    gitBlobOid: sourceEntry.source.gitBlobOid,
    sourceRowSha256: rowSha256(sourceEntry),
    verification: 'fixed-source-ledger-pointer',
    ...(modsGroupId ? { modsGroupId } : {}),
  };
}

function extensionArchiveDecision(sourceEntry, archived) {
  const descriptor = archived.archiveDescriptor;
  return {
    disposition: 'archived-readable',
    actualOutcome: {
      status: 'archived-readable',
      reason: 'The exact historical Extension input bytes are available in the pinned read-only Source legacy archive; no current approval is inferred.',
    },
    review: { state: 'not-applicable', carryForward: false, basisRefs: ['W03 exact Extension source pointer', `Source archive ${descriptor.sha256}`] },
    destination: {
      kind: 'legacy-archive-entry',
      manifestRepoId: 'source',
      manifestCommit: descriptor.commit,
      manifestPath: descriptor.path,
      manifestSha256: descriptor.sha256,
      manifestByteLength: descriptor.byteLength,
      manifestGitBlobOid: descriptor.gitBlobOid,
      archiveRootPath: archived.archiveRootPath,
      archivePath: archived.file.archivePath,
      sourceCommit: archived.file.sourceCommit,
      sourcePath: archived.file.sourcePath,
      sourceGitBlobOid: archived.file.gitBlobOid,
      sourceSha256: archived.file.sha256,
      sourceByteLength: archived.file.byteLength,
      compressedSha256: archived.file.compressedSha256,
      compressedBytes: archived.file.compressedBytes,
    },
  };
}

function classifyW14ModsEntry(sourceEntry, context) {
  const groupId = sourceEntry.review?.basisRefs?.map(ref => /^W03\/(M0[1-8]|K0[12])$/u.exec(ref)?.[1]).find(Boolean);
  if (sourceEntry.source?.repoId !== 'mods' || sourceEntry.source.commit !== W14_FIXED_INPUTS.modsSourceCommit || !groupId) {
    return createGapDecision(sourceEntry, 'Mods row has no exact fixed source commit and W03 group binding.');
  }
  if (groupId === 'M01') {
    const archived = context.m01Files.get(`${sourceEntry.source.path}\u0000${sourceEntry.source.gitBlobOid}`);
    if (!archived) return createGapDecision(sourceEntry, 'The fixed M01 Source archive manifest has no exact source path and Git blob entry.');
    const manifest = context.m01ManifestDescriptor;
    return {
      disposition: 'archived-readable',
      actualOutcome: { status: 'archived-readable', reason: 'The exact M01 historical Mods source bytes are preserved in the fixed Source legacy archive; the manifest marks them not current-approved and source version unverified.' },
      review: { state: 'not-applicable', carryForward: false, basisRefs: ['W03/M01 exact Mods row', `Source M01 manifest ${manifest.sha256}`] },
      destination: {
        kind: 'm01-legacy-archive-entry',
        manifestRepoId: 'source',
        manifestCommit: manifest.commit,
        manifestPath: manifest.path,
        manifestSha256: manifest.sha256,
        manifestByteLength: manifest.byteLength,
        manifestGitBlobOid: manifest.gitBlobOid,
        sourceCommit: sourceEntry.source.commit,
        sourcePath: sourceEntry.source.path,
        sourceGitBlobOid: sourceEntry.source.gitBlobOid,
        archivePath: `content/legacy/mods/241ad76/${archived.archivePath}`,
        sourceSha256: archived.sha256,
        sourceByteLength: archived.byteLength,
      },
    };
  }
  if (['M02', 'M03', 'M04'].includes(groupId)) {
    const summary = context.privateSummary;
    if (!summary.scopeGroups.includes(groupId) || summary.groupCounts[groupId] < 1) {
      return createGapDecision(sourceEntry, `The public-safe private preservation proof does not include fixed group ${groupId}.`);
    }
    return {
      disposition: 'private-restorable',
      actualOutcome: {
        status: 'private-restorable',
        scopeGroupId: groupId,
        reason: 'The original private archive was retrieved and CRC/SHA/Git-tree verified; the public-safe receipt records 11 sample restores and explicitly does not claim a full restore.',
        fullRestoreClaimed: false,
        sampleRestoredFiles: summary.freshRestoredSampleFiles,
      },
      review: { state: 'not-applicable', carryForward: false, basisRefs: ['W03 exact Mods group and row', `public-safe private preservation summary ${W14_FIXED_INPUTS.privateSummary.sha256}`] },
      destination: {
        kind: 'private-restore-proof',
        receiptPath: W14_FIXED_INPUTS.privateSummary.path,
        receiptSha256: W14_FIXED_INPUTS.privateSummary.sha256,
        receiptBytes: W14_FIXED_INPUTS.privateSummary.byteLength,
        sourceCommit: sourceEntry.source.commit,
        sourcePath: sourceEntry.source.path,
        sourceGitBlobOid: sourceEntry.source.gitBlobOid,
        modsGroupId: groupId,
        scopeInventorySha256: summary.scopeInventorySha256,
        fullRestoreClaimed: false,
      },
    };
  }
  if (['M05', 'M06', 'M07', 'M08'].includes(groupId)) {
    return {
      disposition: 'deferred-w15',
      actualOutcome: {
        status: 'deferred-w15',
        scopeGroupId: groupId,
        scopeOwner: 'W15',
        reason: `The fixed W03 ${groupId} Mods scope is explicitly deferred to W15 and is not counted as completed W14 migration.`,
      },
      review: { state: 'not-applicable', carryForward: false, basisRefs: [`W03/${groupId} exact source group`, 'W15 deferred scope'] },
      destination: null,
    };
  }
  if (groupId === 'K01' || groupId === 'K02') {
    return {
      disposition: 'kept',
      actualOutcome: {
        status: 'kept',
        reason: `This fixed W03 ${groupId} row remains at its exact Mods source pointer; no current-version or availability claim is made.`,
      },
      review: { state: 'not-applicable', carryForward: false, basisRefs: [`W03/${groupId} exact retained group`] },
      destination: pinnedSourceDestination(sourceEntry),
    };
  }
  return createGapDecision(sourceEntry, `No W14 outcome is defined for fixed Mods group ${groupId}.`);
}

function buildContextForA(sourceEntry, context) {
  if (sourceEntry.scope?.releaseScope !== 'current-snapshot-candidate') {
    return classifyW14AEntry(sourceEntry, context);
  }
  return classifyW14AEntry(sourceEntry, context);
}

async function buildAOverlay(context, outputRoot) {
  return buildW14Overlay({
    docRoot: path.join(context.webRoot, 'docs/contracts/w03'),
    outputRoot,
    classifyEntry: async sourceEntry => buildContextForA(sourceEntry, context),
    readArtifact: context.readArtifact,
    verifyApprovedReuse: context.verifyApprovedReuse,
    verifyPrivateRestoration: context.verifyPrivateRestoration,
    walkShards: async options => {
      const result = await walkW03LedgerShards(options);
      assertW14ALedgerPin(result.sourceLedgerSha256);
      return result;
    },
    ledgerRelativePath: 'mapping-ledger.json',
    ledgerDisplayPath: W14_FIXED_INPUTS.w03ALedger.path,
  });
}

async function buildModsOverlay(context, outputRoot) {
  return buildW14Overlay({
    docRoot: path.join(context.webRoot, 'docs/contracts/w03'),
    outputRoot,
    classifyEntry: async sourceEntry => classifyW14ModsEntry(sourceEntry, context),
    readArtifact: context.readArtifact,
    verifyApprovedReuse: context.verifyApprovedReuse,
    verifyPrivateRestoration: context.verifyPrivateRestoration,
    walkShards: walkW03ModsLedgerShards,
    ledgerRelativePath: 'mods/mapping-ledger.json',
    ledgerDisplayPath: W14_FIXED_INPUTS.w03ModsLedger.path,
  });
}

async function ensureNewDirectoryTarget(outputRoot) {
  await mkdir(path.dirname(outputRoot), { recursive: true });
  try {
    await lstat(outputRoot);
    throw new Error(`W14 output path already exists; choose a new directory: ${outputRoot}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function expectedW14CurrentIdentity() {
  return {
    gameVersion: '1.13.2',
    gameReleaseId: 'darktide:1.13.2',
    gameBuild: 'SteamBuild_25681127',
    contentVersion: '1.13.2.2',
    dataRevision: '82b79e47e88717b4237655fe4909f0754bac18238c3a23530b985effd60f3130',
  };
}

function expectedW14OwnerCandidate(context) {
  return {
    commit: context.candidateDescriptor.commit,
    path: context.candidateDescriptor.path,
    gitBlobOid: context.candidateDescriptor.gitBlobOid,
    byteLength: context.candidateDescriptor.byteLength,
    sha256: context.candidateDescriptor.sha256,
    selected: false,
    publicationEligible: false,
    inputDigest: context.candidate.inputDigest,
  };
}

function expectedW14Inputs(context) {
  return {
    w03ALedger: { path: W14_FIXED_INPUTS.w03ALedger.path, sha256: W14_FIXED_INPUTS.w03ALedger.sha256, byteLength: W14_FIXED_INPUTS.w03ALedger.byteLength },
    w03ModsLedger: { path: W14_FIXED_INPUTS.w03ModsLedger.path, sha256: W14_FIXED_INPUTS.w03ModsLedger.sha256 },
    domainMatrix: { ...W14_FIXED_INPUTS.domainMatrix },
    sourceReconciliation: { ...W14_FIXED_INPUTS.sourceReconciliation },
    webReconciliation: { ...W14_FIXED_INPUTS.webReconciliation },
    registryReconciliation: { ...W14_FIXED_INPUTS.registryReconciliation },
    sourceTechnicalPacket: { ...W14_FIXED_INPUTS.sourceTechnical },
    privatePreservationSummary: {
      path: W14_FIXED_INPUTS.privateSummary.path,
      sha256: W14_FIXED_INPUTS.privateSummary.sha256,
      byteLength: W14_FIXED_INPUTS.privateSummary.byteLength,
      fullRestoreClaimed: false,
    },
    m01ArchiveManifest: { ...W14_FIXED_INPUTS.m01Manifest },
    extensionArchiveManifests: context.extensionArchiveDescriptors,
  };
}

const W14_CLAIM_LIMITS = Object.freeze([
  'The W13 owner candidate is a digest-bound review basis only; it remains not selected and publicationEligible=false.',
  'Private M02/M03/M04 preservation records aggregate remote verification plus 11 sample restores; no full restore is claimed.',
  'M05/M06/M07/M08 and W15 announcements remain explicitly deferred and are not counted as completed W14 migration.',
  'The 260-row weapon registry records source membership and exact current joins; it is not an availability or full catalog claim.',
]);

export async function buildW14OutcomeSet({ webRoot = process.cwd(), sourceRoot, sourceTechnicalPath, outputRoot, mode = 'all' } = {}) {
  if (!['all', 'a', 'mods'].includes(mode)) throw new Error('mode must be all, a, or mods');
  if (typeof sourceRoot !== 'string' || !sourceRoot || typeof outputRoot !== 'string' || !outputRoot) {
    throw new TypeError('explicit sourceRoot and a new outputRoot are required');
  }
  const absoluteWebRoot = path.resolve(webRoot);
  const absoluteSourceRoot = path.resolve(sourceRoot);
  const absoluteOutputRoot = path.resolve(outputRoot);
  await ensureNewDirectoryTarget(absoluteOutputRoot);
  const context = await loadW14OutcomeContext({ webRoot: absoluteWebRoot, sourceRoot: absoluteSourceRoot, sourceTechnicalPath });
  const stagingRoot = await mkdtemp(path.join(path.dirname(absoluteOutputRoot), '.w14-outcomes-stage-'));
  const outputs = {};
  try {
    if (mode === 'all' || mode === 'a') {
      outputs.a = await buildAOverlay(context, path.join(stagingRoot, 'a'));
    }
    if (mode === 'all' || mode === 'mods') {
      outputs.mods = await buildModsOverlay(context, path.join(stagingRoot, 'mods'));
    }
    const summary = {
      schemaVersion: W14_OUTCOME_SET_SCHEMA,
      status: 'generated-candidate; not-a-content-approval-or-publication',
      mode,
      currentIdentity: expectedW14CurrentIdentity(),
      ownerCandidate: expectedW14OwnerCandidate(context),
      inputs: expectedW14Inputs(context),
      outputs: {},
      claimLimits: [...W14_CLAIM_LIMITS],
    };
    for (const name of Object.keys(outputs)) {
      const manifestBytes = await readFile(path.join(stagingRoot, name, 'manifest.json'));
      const overlayManifest = parseJson(manifestBytes, `W14 ${name} overlay manifest`);
      summary.outputs[name] = {
        path: `${name}/manifest.json`,
        byteLength: manifestBytes.length,
        sha256: sha256(manifestBytes),
        entryCount: overlayManifest.entryCount,
        shardCount: overlayManifest.shardCount,
        groupCount: overlayManifest.groupCount,
        countsByGroup: overlayManifest.countsByGroup,
        countsByDisposition: overlayManifest.countsByDisposition,
        countsByOutcome: overlayManifest.countsByOutcome,
        countsByReviewState: overlayManifest.countsByReviewState,
      };
    }
    const summaryBytes = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(path.join(stagingRoot, 'manifest.json'), summaryBytes, { flag: 'wx' });
    await rename(stagingRoot, absoluteOutputRoot);
    return { outputRoot: absoluteOutputRoot, manifest: summary, manifestSha256: sha256(summaryBytes), manifestByteLength: summaryBytes.length };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

/** Reopen a generated W14 set and revalidate its fixed inputs, shards, and per-row evidence. */
export async function verifyW14OutcomeSet({ webRoot = process.cwd(), sourceRoot, sourceTechnicalPath, outputRoot } = {}) {
  if (typeof sourceRoot !== 'string' || !sourceRoot || typeof outputRoot !== 'string' || !outputRoot) {
    throw new TypeError('explicit sourceRoot and existing outputRoot are required');
  }
  const absoluteWebRoot = path.resolve(webRoot);
  const absoluteSourceRoot = path.resolve(sourceRoot);
  const absoluteOutputRoot = path.resolve(outputRoot);
  const outputInfo = await lstat(absoluteOutputRoot);
  if (outputInfo.isSymbolicLink() || !outputInfo.isDirectory()) throw new Error('W14 output root must be an existing regular non-symlink directory');
  const summaryBytes = await readRegularFile(path.join(absoluteOutputRoot, 'manifest.json'), 'W14 output-set manifest');
  const summary = parseJson(summaryBytes, 'W14 output-set manifest');
  if (!isObject(summary) || summary.schemaVersion !== W14_OUTCOME_SET_SCHEMA
    || summary.status !== 'generated-candidate; not-a-content-approval-or-publication'
    || !['all', 'a', 'mods'].includes(summary.mode)) {
    throw new Error('W14 output-set manifest header is invalid');
  }

  const context = await loadW14OutcomeContext({ webRoot: absoluteWebRoot, sourceRoot: absoluteSourceRoot, sourceTechnicalPath });
  if (!sameJson(summary.currentIdentity, expectedW14CurrentIdentity())
    || !sameJson(summary.ownerCandidate, expectedW14OwnerCandidate(context))
    || !sameJson(summary.inputs, expectedW14Inputs(context))
    || !sameJson(summary.claimLimits, W14_CLAIM_LIMITS)) {
    throw new Error('W14 output-set manifest does not match the fixed identity, owner candidate, inputs, or claim limits');
  }

  const expectedNames = summary.mode === 'all' ? ['a', 'mods'] : [summary.mode];
  if (!isObject(summary.outputs) || !sameJson(Object.keys(summary.outputs).sort(), [...expectedNames].sort())) {
    throw new Error('W14 output-set manifest has an unexpected output set');
  }
  const results = {};
  for (const name of expectedNames) {
    const indexed = summary.outputs[name];
    const expectedManifestPath = `${name}/manifest.json`;
    if (!isObject(indexed) || indexed.path !== expectedManifestPath) throw new Error(`W14 ${name} output path is invalid`);
    const overlayRoot = path.resolve(absoluteOutputRoot, name);
    if (!overlayRoot.startsWith(`${absoluteOutputRoot}${path.sep}`)) throw new Error(`W14 ${name} output path escapes the output root`);
    const overlay = await verifyW14Overlay({
      docRoot: path.join(absoluteWebRoot, 'docs/contracts/w03'),
      overlayRoot,
      readArtifact: context.readArtifact,
      verifyApprovedReuse: context.verifyApprovedReuse,
      verifyPrivateRestoration: context.verifyPrivateRestoration,
      walkShards: name === 'mods' ? walkW03ModsLedgerShards : walkW03LedgerShards,
      ledgerRelativePath: name === 'mods' ? 'mods/mapping-ledger.json' : 'mapping-ledger.json',
      ledgerDisplayPath: name === 'mods' ? W14_FIXED_INPUTS.w03ModsLedger.path : W14_FIXED_INPUTS.w03ALedger.path,
    });
    const childManifestBytes = await readRegularFile(path.join(overlayRoot, 'manifest.json'), `W14 ${name} overlay manifest`);
    const actualIndex = {
      path: expectedManifestPath,
      byteLength: childManifestBytes.length,
      sha256: sha256(childManifestBytes),
      entryCount: overlay.entryCount,
      shardCount: overlay.shardCount,
      groupCount: overlay.groupCount,
      countsByGroup: overlay.countsByGroup,
      countsByDisposition: overlay.countsByDisposition,
      countsByOutcome: overlay.countsByOutcome,
      countsByReviewState: overlay.countsByReviewState,
    };
    if (!sameJson(indexed, actualIndex)) throw new Error(`W14 ${name} output summary does not match its reopened overlay`);
    results[name] = { ...overlay, manifestSha256: actualIndex.sha256, manifestByteLength: actualIndex.byteLength };
  }
  return {
    integrityVerified: true,
    completionProofsVerified: true,
    outputSetManifestSha256: sha256(summaryBytes),
    outputSetManifestByteLength: summaryBytes.length,
    mode: summary.mode,
    outputs: results,
  };
}

async function initializeContextFiles({ webRoot, sourceRoot, matrix, candidate, candidateDescriptor, candidateBytes,
  sourceReportFile, webReportFile, registryReportFile, privateSummaryFile, domains, extensionFiles, m01Files,
  m01Manifest, m01ManifestDescriptor, sourceTechnicalBytes, sourceArchive, sourceTechnical, sourceRecordIndexes,
  sourceTargetIndex, webTargetIndex, sourceRows, sourceReportRowIndexes, webRows, webReportRowIndexes, registryRows, pinnedObjects }) {
  const workspaceFiles = new Map();
  for (const file of [
    { ...W14_FIXED_INPUTS.sourceReconciliation, bytes: sourceReportFile.bytes },
    { ...W14_FIXED_INPUTS.webReconciliation, bytes: webReportFile.bytes },
    { ...W14_FIXED_INPUTS.registryReconciliation, bytes: registryReportFile.bytes },
    { ...W14_FIXED_INPUTS.privateSummary, bytes: privateSummaryFile.bytes },
  ]) addUnique(workspaceFiles, repositoryKey('web', 'working-tree', file.path), file.bytes, 'W14 workspace artifact');

  const context = {
    webRoot, sourceRoot, matrix, candidate,
    candidateDescriptor: { ...candidateDescriptor, repoId: 'web' },
    candidateBytes, domains, extensionFiles, m01Files, m01Manifest, m01ManifestDescriptor,
    sourceArchive,
    sourcePacketDescriptor: W14_FIXED_INPUTS.sourceTechnical,
    sourceTechnicalBytes, sourceTechnical, sourceRecordIndexes, sourceTargetIndex, webTargetIndex,
    sourceRows, sourceReportRowIndexes, webRows, webReportRowIndexes, registryRows,
    sourceReport: sourceReportFile.value, sourceReportBytes: sourceReportFile.bytes,
    sourceReportDescriptor: sourceReportFile.descriptor,
    webReport: webReportFile.value, webReportBytes: webReportFile.bytes,
    webReportDescriptor: webReportFile.descriptor,
    registryReport: registryReportFile.value, registryReportBytes: registryReportFile.bytes,
    privateSummary: privateSummaryFile.value, privateSummaryBytes: privateSummaryFile.bytes,
    workspaceFiles, pinnedObjects,
    extensionArchiveDescriptors: matrix.extensionArchives.map(archive => ({ ...archive.manifest })),
  };

  context.readArtifact = async ({ repoId, commit, path: filePath, releaseId, archiveSha256 }) => {
    if (!safeRepoPath(filePath)) throw new Error('W14 artifact request contains an unsafe path');
    if (repoId === 'source' && releaseId) {
      if (releaseId !== context.sourceArchive.releaseId || archiveSha256 !== context.sourceArchive.archiveSha256
        || filePath !== 'technical.json') throw new Error('W14 Source packet request differs from the fixed public archive');
      return Buffer.from(sourceTechnicalBytes);
    }
    const key = repositoryKey(repoId, commit, filePath);
    if (repoId === 'web' && commit === 'working-tree') {
      const bytes = workspaceFiles.get(key);
      if (!bytes) throw new Error(`W14 workspace artifact is not in the fixed report allowlist: ${filePath}`);
      return Buffer.from(bytes);
    }
    const pinned = pinnedObjects.get(key);
    if (pinned) return Buffer.from(pinned);
    if (repoId !== 'source' || commit !== W14_FIXED_INPUTS.m01Manifest.commit
      || !['content/legacy/w14/extension-inputs/', 'content/legacy/w14/extension-additional-inputs/']
        .some(prefix => filePath.startsWith(prefix))) {
      throw new Error(`W14 artifact request is outside its pinned read allowlist: ${repoId}:${commit}:${filePath}`);
    }
    return gitCommitPathBytes(sourceRoot, commit, filePath);
  };
  context.verifyApprovedReuse = async ({ sourceEntry, decision }) => {
    const evidence = decision.review?.evidence;
    const closure = decision.actualOutcome?.approvedCoverClosure;
    if (decision.actualOutcome?.migrationKind === 'approved-source-target-reuse') {
      const row = context.sourceReport.rows?.[closure?.rowIndex];
      const set = context.sourceReport.rowEvidenceIndex?.approvalEvidenceSets?.[closure?.approvalEvidenceSetId];
      const rowDecisionSha256 = row?.decision
        ? sha256(Buffer.from(JSON.stringify(row.decision), 'utf8')) : null;
      if (!closure || closure.reportPath !== W14_FIXED_INPUTS.sourceReconciliation.path
        || closure.reportSha256 !== reportDescriptor(context, 'source').sha256
        || closure.reportByteLength !== reportDescriptor(context, 'source').byteLength
        || row?.entryId !== sourceEntry?.entryId || row.sourceRowSha256 !== rowSha256(sourceEntry)
        || row.decision?.status !== closure.decisionStatus || rowDecisionSha256 !== closure.decisionSha256
        || row.decision?.approvalEvidenceSetId !== closure.approvalEvidenceSetId
        || !Array.isArray(set) || set.length !== closure.references?.length) return false;
      const used = new Set();
      for (const reference of closure.references) {
        const matches = set.map((reportEvidence, index) => ({ reportEvidence, index })).filter(({ reportEvidence }) => {
          const attestation = reportEvidence?.candidateReceipt ?? reportEvidence;
          const coveredBy = reportEvidence?.coveredBy === undefined ? null : {
            fieldPath: reportEvidence.coveredBy.fieldPath,
            dimension: reportEvidence.coveredBy.dimension,
          };
          return JSON.stringify(reference.coveredBy) === JSON.stringify(coveredBy)
            && reference.attestation?.gameReleaseId === attestation?.gameReleaseId
            && reference.attestation?.recordId === attestation?.recordId
            && reference.attestation?.fieldPath === attestation?.fieldPath
            && reference.attestation?.dimension === attestation?.dimension
            && reference.attestation?.targetDigest === attestation?.targetDigest
            && reference.attestation?.dependenciesDigest === attestation?.dependenciesDigest;
        });
        if (matches.length !== 1 || used.has(matches[0].index)) return false;
        used.add(matches[0].index);
      }
    }
    const references = closure?.references?.map(item => item.candidateEvidence) ?? [evidence];
    const verified = [];
    for (const proof of references) {
      const match = /^\/review\/(sourceTargets|targets)\/(0|[1-9][0-9]*)$/u.exec(proof?.selector?.locator ?? '');
      if (!match || proof.repoId !== 'web' || proof.commit !== context.candidateDescriptor.commit
        || proof.path !== context.candidateDescriptor.path || proof.fileSha256 !== context.candidateDescriptor.sha256
        || proof.byteLength !== context.candidateDescriptor.byteLength || proof.gitBlobOid !== context.candidateDescriptor.gitBlobOid) return false;
      const index = Number(match[2]);
      if (match[1] === 'sourceTargets') {
        const target = candidate.review.sourceTargets[index];
        if (target === undefined || proof.targetId !== `source:${target.gameReleaseId}:${target.recordId}:${target.fieldPath}:${target.dimension}`
          || target.state !== 'approved' || target.targetDigest !== proof.targetSha256
          || target.dependenciesDigest !== proof.dependencySha256
          || !hasApprovedHumanReceipt(candidate, target)) return false;
        const closureRef = closure?.references?.find(item => item.candidateEvidence === proof
          || JSON.stringify(item.candidateEvidence) === JSON.stringify(proof));
        if (closureRef && (closureRef.attestation.gameReleaseId !== target.gameReleaseId
          || closureRef.attestation.recordId !== target.recordId
          || closureRef.attestation.fieldPath !== target.fieldPath
          || closureRef.attestation.dimension !== target.dimension
          || closureRef.attestation.targetDigest !== target.targetDigest
          || closureRef.attestation.dependenciesDigest !== target.dependenciesDigest)) return false;
        verified.push({ proof, target });
        continue;
      }
      const target = candidate.review.targets[index];
      if (target === undefined || target.target.targetId !== proof.targetId
        || target.state !== 'approved' || target.targetDigest !== proof.targetSha256
        || target.dependenciesDigest !== proof.dependencySha256
        || !hasApprovedHumanReceipt(candidate, target, { web: true })) return false;
      verified.push({ proof, target });
    }
    const sourceTargetReuse = decision.actualOutcome?.migrationKind === 'approved-source-target-reuse';
    return verified.length > 0 && verified.some(({ proof, target }) => JSON.stringify(proof) === JSON.stringify(evidence)
      && (!sourceTargetReuse || (target.fieldPath === decision.actualOutcome.approvedCoverFieldPath
        && target.dimension === decision.actualOutcome.approvedCoverDimension)));
  };
  context.verifyPrivateRestoration = async ({ sourceEntry, decision }) => {
    const destination = decision.destination;
    const groupId = decision.actualOutcome?.scopeGroupId;
    const summary = context.privateSummary;
    return sourceEntry.source?.repoId === 'mods'
      && sourceEntry.source.commit === W14_FIXED_INPUTS.modsSourceCommit
      && sourceEntry.review?.basisRefs?.includes(`W03/${groupId}`)
      && ['M02', 'M03', 'M04'].includes(groupId)
      && summary.scopeGroups.includes(groupId)
      && summary.groupCounts[groupId] > 0
      && summary.sourcePathCount === 79014
      && summary.modsLedgerSha256 === W14_FIXED_INPUTS.w03ModsLedger.sha256
      && summary.scopeInventorySha256 === 'd279f907b38ae414a6f693812a267c24c7246ed8c20e4a0a630bac9ce47faac6'
      && summary.remoteRetrievedBytesVerified === true
      && summary.allCrcAndSha256AndGitBlobHashesVerified === true
      && summary.fixedGitTreeMembershipVerified === true
      && summary.fullRestoreClaimed === false
      && destination.receiptPath === W14_FIXED_INPUTS.privateSummary.path
      && destination.receiptSha256 === W14_FIXED_INPUTS.privateSummary.sha256
      && destination.receiptBytes === W14_FIXED_INPUTS.privateSummary.byteLength
      && destination.scopeInventorySha256 === summary.scopeInventorySha256
      && destination.sourcePath === sourceEntry.source.path
      && destination.sourceGitBlobOid === sourceEntry.source.gitBlobOid
      && destination.modsGroupId === groupId;
  };
  return context;
}

async function loadW14OutcomeContext({ webRoot, sourceRoot, sourceTechnicalPath }) {
  const fixed = W14_FIXED_INPUTS;
  const [matrixFile, sourceReportFile, webReportFile, registryReportFile, privateSummaryFile] = await Promise.all([
    readPinnedWorkspaceJson(webRoot, fixed.domainMatrix, 'W14 domain matrix'),
    readPinnedWorkspaceJson(webRoot, fixed.sourceReconciliation, 'W14 Source row reconciliation'),
    readPinnedWorkspaceJson(webRoot, fixed.webReconciliation, 'W14 Web row reconciliation'),
    readPinnedWorkspaceJson(webRoot, fixed.registryReconciliation, 'W14 registry reconciliation'),
    readPinnedWorkspaceJson(webRoot, fixed.privateSummary, 'W14 public-safe private preservation summary'),
  ]);
  const matrix = matrixFile.value;
  const candidateDescriptor = {
    repoId: 'web', commit: matrix.current.reviewCandidate.commit,
    path: matrix.current.reviewCandidate.path, gitBlobOid: matrix.current.reviewCandidate.gitBlobOid,
    byteLength: matrix.current.reviewCandidate.byteLength, sha256: matrix.current.reviewCandidate.sha256,
  };
  if (matrix.current.gameVersion !== '1.13.2' || matrix.current.gameReleaseId !== 'darktide:1.13.2'
    || matrix.current.gameBuild !== '25681127'
    || candidateDescriptor.commit !== fixed.w13OwnerCandidate.commit
    || candidateDescriptor.path !== fixed.w13OwnerCandidate.path
    || candidateDescriptor.gitBlobOid !== fixed.w13OwnerCandidate.gitBlobOid
    || candidateDescriptor.byteLength !== fixed.w13OwnerCandidate.byteLength
    || candidateDescriptor.sha256 !== fixed.w13OwnerCandidate.sha256
    || matrix.current.reviewCandidate.selectedOrPublishedByThisMatrix !== false
    || matrix.current.reviewCandidate.publicationEligible !== false) {
    throw new Error('W14 fixed current identity or W13 candidate basis differs from the reviewed matrix');
  }
  const pinnedObjects = new Map();
  const candidateBytes = await addPinnedGitObject({ map: pinnedObjects, repoId: 'web', repoRoot: webRoot, descriptor: candidateDescriptor });
  const candidate = parseJson(candidateBytes, 'W13 owner candidate');
  if (candidate.candidateOnly !== true || candidate.publicationEligible !== false
    || candidate.review?.sourceTargets?.length !== 823 || candidate.review?.targets?.length !== 80
    || candidate.review?.receipts?.length !== 908) throw new Error('W13 review candidate has unexpected approval or selection state');

  const domains = [];
  for (const descriptor of matrix.current.sharedDomains) {
    const inputDescriptor = {
      repoId: 'web', commit: candidateDescriptor.commit, path: descriptor.path,
      gitBlobOid: descriptor.gitBlobOid, byteLength: descriptor.byteLength ?? descriptor.sizeBytes, sha256: descriptor.sha256,
    };
    const bytes = await addPinnedGitObject({ map: pinnedObjects, repoId: 'web', repoRoot: webRoot, descriptor: inputDescriptor });
    const value = parseJson(bytes, `W13 ${descriptor.name} domain`);
    if (value.kind !== descriptor.name || value.gameReleaseId !== 'darktide:1.13.2') throw new Error(`W13 domain identity mismatch: ${descriptor.name}`);
    domains.push({ descriptor: inputDescriptor, value });
  }

  const extensionFiles = new Map();
  for (const archive of matrix.extensionArchives) {
    const descriptor = archive.manifest;
    const inputDescriptor = { repoId: 'source', commit: descriptor.commit, path: descriptor.path,
      gitBlobOid: descriptor.gitBlobOid, byteLength: descriptor.byteLength, sha256: descriptor.sha256 };
    const bytes = await addPinnedGitObject({ map: pinnedObjects, repoId: 'source', repoRoot: sourceRoot, descriptor: inputDescriptor });
    const manifest = parseJson(bytes, `W14 ${archive.label} manifest`);
    for (const file of manifest.files ?? []) {
      const key = `${file.sourceCommit}\u0000${file.sourcePath}\u0000${file.gitBlobOid}`;
      if (extensionFiles.has(key)) throw new Error(`W14 Extension archives contain a duplicate source locator: ${file.sourcePath}`);
      extensionFiles.set(key, { archiveDescriptor: inputDescriptor, archiveRootPath: path.posix.dirname(inputDescriptor.path), file });
    }
  }

  const m01ManifestDescriptor = { ...fixed.m01Manifest };
  const m01ManifestBytes = await addPinnedGitObject({ map: pinnedObjects, repoId: 'source', repoRoot: sourceRoot, descriptor: m01ManifestDescriptor });
  const m01Manifest = parseJson(m01ManifestBytes, 'W14 M01 archive manifest');
  const m01Files = new Map();
  for (const file of m01Manifest.files ?? []) {
    const key = `${file.sourcePath}\u0000${file.gitBlobOid}`;
    if (m01Files.has(key)) throw new Error(`M01 archive manifest repeats a source locator: ${file.sourcePath}`);
    m01Files.set(key, file);
  }
  const m01RawBlobs = await readPinnedArchiveBlobsFromGit(sourceRoot, m01ManifestDescriptor.commit, m01Manifest.files ?? []);
  for (const [archivePath, bytes] of m01RawBlobs) {
    addUnique(pinnedObjects, repositoryKey('source', m01ManifestDescriptor.commit,
      `content/legacy/mods/241ad76/${archivePath}`), bytes, 'M01 archived raw bytes');
  }

  let sourceTechnicalBytes;
  let sourceArchive = {
    releaseId: fixed.sourceTechnical.releaseId,
    archiveSha256: matrix.current.reviewCandidate.sourceArchiveSha256,
    sourceRevision: matrix.current.reviewCandidate.sourceRevision,
  };
  if (sourceTechnicalPath) {
    sourceTechnicalBytes = await readRegularFile(path.resolve(sourceTechnicalPath), 'W09 technical.json packet');
  } else {
    const resolved = await resolvePublishedW09SourceArchive({ releaseId: fixed.sourceTechnical.releaseId });
    if (resolved.status !== 'verified' || resolved.archiveSha256 !== fixed.sourceTechnical.archiveSha256) {
      throw new Error('the fixed public W09 Source archive is not currently verified');
    }
    sourceArchive = { releaseId: resolved.releaseId, archiveSha256: resolved.archiveSha256, sourceRevision: resolved.request.sourceRevision };
    sourceTechnicalBytes = Buffer.from(resolved.files.get('technical.json') ?? []);
  }
  if (sourceTechnicalBytes.length !== fixed.sourceTechnical.byteLength || sha256(sourceTechnicalBytes) !== fixed.sourceTechnical.sha256
    || sourceArchive.archiveSha256 !== fixed.sourceTechnical.archiveSha256 || sourceArchive.releaseId !== fixed.sourceTechnical.releaseId
    || sourceArchive.sourceRevision !== fixed.sourceTechnical.sourceRevision) {
    throw new Error('W09 technical packet or its fixed public archive identity differs from W14 pins');
  }
  const sourceTechnical = parseJson(sourceTechnicalBytes, 'W09 Source technical packet');
  if (!Array.isArray(sourceTechnical.records) || sourceTechnical.records.length !== 236
    || !Array.isArray(sourceTechnical.sourceRefs) || sourceTechnical.sourceRefs.length !== 174
    || !Array.isArray(sourceTechnical.sourceSnapshots) || sourceTechnical.sourceSnapshots.length !== 3) {
    throw new Error('W09 technical packet has an unexpected fixed record/source-ref/snapshot inventory');
  }
  const sourceRecordIndexes = new Map();
  sourceTechnical.records.forEach((record, index) => {
    const key = `${record.gameReleaseId}\u0000${record.recordId}`;
    const rows = sourceRecordIndexes.get(key) ?? [];
    rows.push(index);
    sourceRecordIndexes.set(key, rows);
  });
  const sourceRows = indexUniqueRows(sourceReportFile.value.rows, 'W14 Source reconciliation');
  const sourceReportRowIndexes = new Map(sourceReportFile.value.rows.map((row, index) => [row.entryId, index]));
  const webRows = indexUniqueRows(webReportFile.value.rows, 'W14 Web reconciliation');
  const webReportRowIndexes = new Map(webReportFile.value.rows.map((row, index) => [row.entryId, index]));
  const registryRows = indexUniqueRows(registryReportFile.value.rows, 'W14 registry reconciliation');
  return initializeContextFiles({
    webRoot, sourceRoot, matrix, candidate, candidateDescriptor, candidateBytes, sourceReportFile, webReportFile,
    registryReportFile, privateSummaryFile, domains, extensionFiles, m01Files, m01Manifest, m01ManifestDescriptor,
    sourceTechnicalBytes, sourceArchive, sourceTechnical, sourceRecordIndexes,
    sourceTargetIndex: buildSourceTargetIndex(candidate), webTargetIndex: buildWebTargetIndex(candidate),
    sourceRows, sourceReportRowIndexes, webRows, webReportRowIndexes, registryRows, pinnedObjects,
  });
}

const W14_CURRENT_PREFLIGHT_GROUPS = Object.freeze([
  'source-w01-candidates',
  'web-w01-inputs',
  'web-source-lock',
]);

/** Classify only the frozen current-candidate rows before the full historical overlay build. */
export async function preflightW14CurrentRows({ webRoot = process.cwd(), sourceRoot, sourceTechnicalPath } = {}) {
  if (typeof sourceRoot !== 'string' || !sourceRoot) throw new TypeError('an explicit sourceRoot is required');
  const absoluteWebRoot = path.resolve(webRoot);
  const ledgerPath = path.join(absoluteWebRoot, 'docs/contracts/w03/mapping-ledger.json');
  const ledgerBytes = await readFile(ledgerPath);
  const ledgerSha256 = sha256(ledgerBytes);
  assertW14ALedgerPin(ledgerSha256);
  const ledger = parseJson(ledgerBytes, 'fixed W03 A mapping ledger');
  const context = await loadW14OutcomeContext({
    webRoot: absoluteWebRoot,
    sourceRoot: path.resolve(sourceRoot),
    sourceTechnicalPath,
  });
  const verifyCompletion = createW14CompletionVerifier({
    readArtifact: context.readArtifact,
    verifyApprovedReuse: context.verifyApprovedReuse,
    verifyPrivateRestoration: context.verifyPrivateRestoration,
  });
  const expectedCounts = { 'source-w01-candidates': 3584, 'web-w01-inputs': 3988, 'web-source-lock': 9 };
  const entries = [];
  const shardCounts = {};
  for (const groupId of W14_CURRENT_PREFLIGHT_GROUPS) {
    const group = ledger.groups?.[groupId];
    if (!group || group.entryCount !== expectedCounts[groupId] || !Array.isArray(group.shardPaths)) {
      throw new Error(`fixed W03 current group differs from the preflight scope: ${groupId}`);
    }
    const descriptors = ledger.shards.filter(item => item?.groupId === groupId);
    if (descriptors.length !== group.shardPaths.length
      || descriptors.some(item => !group.shardPaths.includes(item.path))) {
      throw new Error(`fixed W03 current group shard membership is inconsistent: ${groupId}`);
    }
    let groupCount = 0;
    for (const descriptor of descriptors) {
      const containerBytes = await readFile(path.join(absoluteWebRoot, 'docs/contracts/w03', ...descriptor.path.split('/')));
      const checked = verifyW03LedgerShard(ledger, descriptor, containerBytes);
      if (!checked.valid) throw new Error(`fixed W03 current shard failed verification: ${descriptor.path}`);
      for (const entry of checked.entries) {
        if (entry.scope?.releaseScope === 'current-snapshot-candidate') entries.push({ groupId, entry });
      }
      groupCount += checked.entries.length;
    }
    if (groupCount !== expectedCounts[groupId]) throw new Error(`fixed W03 current group row count mismatch: ${groupId}`);
    shardCounts[groupId] = { entryCount: groupCount, shardCount: descriptors.length };
  }

  const gapRows = [];
  const gapStatusCounts = {};
  const outcomesByStatus = {};
  const outcomesByOwner = {};
  for (const { groupId, entry } of entries) {
    const decision = classifyW14AEntry(entry, context);
    await verifyCompletion({ sourceEntry: entry, decision });
    const status = decision?.actualOutcome?.status ?? 'invalid-decision';
    outcomesByStatus[status] = (outcomesByStatus[status] ?? 0) + 1;
    const ownerCounts = outcomesByOwner[entry.owner] ?? (outcomesByOwner[entry.owner] = {});
    ownerCounts[status] = (ownerCounts[status] ?? 0) + 1;
    if (status === 'gap') {
      const sourceReportRow = entry.owner === 'source' ? context.sourceRows.get(entry.entryId) : null;
      const webReportRow = entry.owner === 'web' ? context.webRows.get(entry.entryId) : null;
      const reportStatus = sourceReportRow?.decision?.status ?? webReportRow?.disposition ?? 'missing-report-row';
      gapStatusCounts[reportStatus] = (gapStatusCounts[reportStatus] ?? 0) + 1;
      gapRows.push({
        groupId,
        entryId: entry.entryId,
        owner: entry.owner,
        reason: decision.actualOutcome.reason,
        reportStatus,
        originalTarget: entry.target ? { recordId: entry.target.recordId, gameReleaseId: entry.target.gameReleaseId, fieldPath: entry.target.fieldPath, status: entry.target.status } : null,
        reconciledTarget: sourceReportRow?.decision?.target ?? null,
        sourceEntityKey: entry.sourceEntityKey ?? null,
      });
    }
  }
  return {
    schemaVersion: 'w14.current-row-preflight.v1',
    status: gapRows.length === 0 ? 'current-candidates-resolved' : 'current-candidates-have-gaps',
    w03ALedgerSha256: ledgerSha256,
    groups: shardCounts,
    selectedRows: Object.values(shardCounts).reduce((sum, item) => sum + item.entryCount, 0),
    currentCandidateRows: entries.length,
    outcomesByStatus,
    outcomesByOwner,
    gapStatusCounts,
    gapCount: gapRows.length,
    gaps: gapRows.slice(0, 100),
    gapsTruncated: gapRows.length > 100,
  };
}

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (!name.startsWith('--')) throw new Error(`unexpected argument: ${name}`);
    if (name === '--help') return { help: true };
    const value = args[index + 1];
    if (!value || value.startsWith('--') || values.has(name)) throw new Error(`argument ${name} requires one unique value`);
    values.set(name, value);
    index++;
  }
  return {
    sourceRoot: values.get('--source-root'),
    sourceTechnicalPath: values.get('--source-technical'),
    outputRoot: values.get('--output-root'),
    mode: values.get('--mode') ?? 'all',
  };
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/content/build-w14-outcomes.mjs --source-root <Source clone> --output-root <new directory> [--mode all|a|mods] [--source-technical <verified technical.json>]',
    '       node scripts/content/build-w14-outcomes.mjs --source-root <Source clone> --output-root <existing directory> --mode verify [--source-technical <verified technical.json>]',
    '       node scripts/content/build-w14-outcomes.mjs --source-root <Source clone> --mode current-preflight [--source-technical <verified technical.json>]',
    'When --source-technical is omitted, the command resolves and verifies the fixed public W09 Source release archive.',
    'The output path must not already exist. This command writes only the selected output directory.',
  ].join('\n') + '\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) printHelp();
    else if (args.mode === 'current-preflight') {
      process.stdout.write(`${JSON.stringify(await preflightW14CurrentRows({
        webRoot: process.cwd(), sourceRoot: args.sourceRoot, sourceTechnicalPath: args.sourceTechnicalPath,
      }), null, 2)}\n`);
    }
    else if (args.mode === 'verify') {
      process.stdout.write(`${JSON.stringify(await verifyW14OutcomeSet({
        webRoot: process.cwd(), sourceRoot: args.sourceRoot, sourceTechnicalPath: args.sourceTechnicalPath, outputRoot: args.outputRoot,
      }), null, 2)}\n`);
    }
    else {
      const result = await buildW14OutcomeSet(args);
      process.stdout.write(`${JSON.stringify({ outputRoot: result.outputRoot, manifestSha256: result.manifestSha256, manifestByteLength: result.manifestByteLength, outputs: result.manifest.outputs }, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`W14 outcome build failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
