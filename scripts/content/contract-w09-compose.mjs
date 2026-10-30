import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const W09_WEB_REPOSITORY = 'SyuanTsai/DarkTide-Web';
export const W09_SOURCE_REPOSITORY = 'SyuanTsai/DarkTide-Source-Data';
export const W09_SELECTED_COMPOSITION_PATH = 'content/contracts/w09/source-handoff/selected.json';

const W09_WEB_ORIGIN = 'https://github.com/' + W09_WEB_REPOSITORY + '.git';
const SOURCE_CACHE_LOCK_PATH = 'content/contracts/w09/source-request.lock.json';
const SOURCE_CACHE_PATH = 'content/contracts/w09/source-request/contract-w09-request.mjs';
const W09_COMPILER_LOCK_PATH = 'content/contracts/w09/compiler.lock.json';
const W09_COMPILER_FILE_PATHS = Object.freeze([
  SOURCE_CACHE_LOCK_PATH,
  SOURCE_CACHE_PATH,
  'scripts/content/contract-w09-compose.mjs',
  'scripts/content/contract-w09-release.mjs',
]);
const W08_INPUT_LOCK_PATH = 'content/contracts/w08/compiler-inputs.lock.json';
const W08_COMPILER_LOCK_PATH = 'content/contracts/w08/compiler.lock.json';
const W09_LOCK_ROOT = 'content/contracts/w09/source-handoff/locks/';
const W09_OVERLAY_ROOT = 'content/contracts/w09/authoring-overlays/';
const SOURCE_PACKET_PATHS = Object.freeze([
  'analysis.md', 'source-revision.json', 'source-revision.md', 'source-manifest.json', 'source-receipt.json', 'technical.json',
]);
const SHA256_RE = /^[a-f0-9]{64}$/u;
const COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const HEX_RE = /^[a-f0-9]+$/u;
const OVERLAY_TARGETS = new Set(['authoring', 'officialInputs', 'termRules', 'baseline', 'baselineLock']);
const ALLOWED_TARGETS_BY_MODE = Object.freeze({
  w06: new Set(['authoring', 'officialInputs', 'termRules']),
  w07: new Set(['authoring', 'officialInputs', 'termRules', 'baseline', 'baselineLock']),
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonicalJson = value => Array.isArray(value)
  ? '[' + value.map(canonicalJson).join(',') + ']'
  : isRecord(value)
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
    : JSON.stringify(value);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function exactKeys(value, keys, label) {
  if (!isRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    throw new TypeError(label + ' has missing or unsupported fields');
  }
}

function assertText(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(label + ' must be a non-empty safe string');
  }
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) throw new TypeError(label + ' must be a lowercase SHA-256 digest');
}

function assertCommit(value, label) {
  if (typeof value !== 'string' || !COMMIT_RE.test(value)) throw new TypeError(label + ' must be a full Git commit SHA');
}

function assertSafeRelativePath(value, label) {
  if (typeof value !== 'string' || value.includes('\\') || value.startsWith('/') || value.includes('\0')) {
    throw new TypeError(label + ' must be a safe repository-relative POSIX path');
  }
  const parts = value.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..') || path.posix.normalize(value) !== value) {
    throw new TypeError(label + ' must not contain empty, dot, or parent path components');
  }
  if (!/^[A-Za-z0-9._/-]+$/u.test(value)) throw new TypeError(label + ' contains unsupported path characters');
}

function validatePacketFileRows(rows, request) {
  if (!Array.isArray(rows) || rows.length !== SOURCE_PACKET_PATHS.length) throw new TypeError('source.packetFiles must pin the exact six-file Source packet');
  if (!Array.isArray(request.packetFiles) || request.packetFiles.length !== SOURCE_PACKET_PATHS.length) {
    throw new TypeError('Source request packetFiles must pin the exact six-file packet');
  }
  rows.forEach((row, index) => {
    exactKeys(row, ['path', 'sha256', 'sizeBytes'], 'source.packetFiles[' + index + ']');
    const requested = request.packetFiles[index];
    if (!isRecord(requested) || row.path !== SOURCE_PACKET_PATHS[index] || requested.path !== row.path
        || requested.sha256 !== row.sha256 || requested.sizeBytes !== row.sizeBytes) {
      throw new Error('source.packetFiles differ from the exact pinned Source request');
    }
    assertSha256(row.sha256, 'source.packetFiles[' + index + '].sha256');
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0) throw new TypeError('source.packetFiles[' + index + '].sizeBytes must be a non-negative safe integer');
  });
}

function validateOverlayRows(rows, web) {
  if (!Array.isArray(rows)) throw new TypeError('authoringOverlay must be an array');
  const targets = new Set();
  const paths = new Set();
  for (const [index, row] of rows.entries()) {
    exactKeys(row, ['mode', 'target', 'path', 'sizeBytes', 'sha256'], 'authoringOverlay[' + index + ']');
    if (!Object.hasOwn(ALLOWED_TARGETS_BY_MODE, row.mode) || !OVERLAY_TARGETS.has(row.target)
        || !ALLOWED_TARGETS_BY_MODE[row.mode].has(row.target)) {
      throw new TypeError('authoringOverlay mode/target is not an approved Web input overlay');
    }
    assertSafeRelativePath(row.path, 'authoringOverlay[' + index + '].path');
    const expectedPrefix = W09_OVERLAY_ROOT + row.mode + '/' + row.target + '/';
    if (!row.path.startsWith(expectedPrefix) || !row.path.endsWith('.json')) {
      throw new TypeError('authoringOverlay path is outside its fixed mode/target directory');
    }
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1) throw new TypeError('authoringOverlay sizeBytes must be positive');
    assertSha256(row.sha256, 'authoringOverlay[' + index + '].sha256');
    const targetKey = row.mode + '\0' + row.target;
    if (targets.has(targetKey) || paths.has(row.path)) throw new TypeError('authoringOverlay contains a duplicate target or path');
    targets.add(targetKey);
    paths.add(row.path);
  }
  if (rows.filter(row => row.target === 'termRules').length > 1) throw new TypeError('termRules must have one shared overlay across W06 and W07');
  if (rows.length === 0) {
    if (web.overlayCommit !== null || web.authoringCommit !== web.w08AuthoringCommit) {
      throw new TypeError('empty authoringOverlay must retain the W08 authoring commit and have no overlayCommit');
    }
  } else if (web.overlayCommit === null || web.authoringCommit !== web.overlayCommit) {
    throw new TypeError('authoringOverlay requires authoringCommit to equal its pinned overlayCommit');
  }
}

export function validateW09CompositionInputLock(lock, request, { archiveSha256 } = {}) {
  exactKeys(lock, ['schema', 'repository', 'source', 'web', 'gameReleaseId', 'authoringOverlay'], 'W09 composition input lock');
  if (lock.schema !== 'w09-web-inputs-lock/1' || lock.repository !== 'https://github.com/' + W09_WEB_REPOSITORY) {
    throw new Error('W09 composition lock must use the fixed Web repository and schema');
  }
  if (!isRecord(request)) throw new TypeError('verified Source request is required');
  exactKeys(lock.source, ['releaseId', 'requestId', 'sourceCommit', 'sourceRevision', 'manifestSha256', 'archiveSha256', 'packetFiles'], 'W09 lock source');
  for (const field of ['releaseId', 'requestId', 'sourceCommit', 'sourceRevision', 'manifestSha256']) {
    if (lock.source[field] !== request[field]) throw new Error('W09 lock Source ' + field + ' differs from the verified request');
  }
  if (lock.gameReleaseId !== request.gameReleaseId) throw new Error('W09 lock gameReleaseId differs from the verified request');
  assertCommit(lock.source.sourceCommit, 'source.sourceCommit');
  assertSha256(lock.source.sourceRevision, 'source.sourceRevision');
  assertSha256(lock.source.manifestSha256, 'source.manifestSha256');
  assertSha256(lock.source.archiveSha256, 'source.archiveSha256');
  const expectedArchiveSha = archiveSha256 ?? request.archiveSha256;
  if (expectedArchiveSha !== undefined && lock.source.archiveSha256 !== expectedArchiveSha) {
    throw new Error('W09 lock archiveSha256 differs from the verified public Source archive');
  }
  validatePacketFileRows(lock.source.packetFiles, request);

  exactKeys(lock.web, [
    'w08InputLockSha256', 'w08CompilerLockSha256', 'w08AuthoringCommit', 'w08CompilerCommit',
    'w09CompilerLockSha256', 'compilerFileSetSha256', 'compilerCommit', 'overlayCommit', 'authoringCommit',
  ], 'W09 lock web');
  for (const field of ['w08InputLockSha256', 'w08CompilerLockSha256', 'w09CompilerLockSha256', 'compilerFileSetSha256']) {
    assertSha256(lock.web[field], 'web.' + field);
  }
  for (const field of ['w08AuthoringCommit', 'w08CompilerCommit', 'compilerCommit', 'authoringCommit']) assertCommit(lock.web[field], 'web.' + field);
  if (lock.web.overlayCommit !== null) assertCommit(lock.web.overlayCommit, 'web.overlayCommit');
  validateOverlayRows(lock.authoringOverlay, lock.web);
  return lock;
}

export function deriveW09CandidateBranch(sourceRevision) {
  assertSha256(sourceRevision, 'sourceRevision');
  return 'codex/syp-341-w09-' + sourceRevision;
}

export function createW09AuthoringSourcePin(sourceLock) {
  exactKeys(sourceLock, ['schemaVersion', 'repository', 'commit', 'schemaId', 'files'], 'W09 Source contract pin');
  const repository = 'https://github.com/' + W09_SOURCE_REPOSITORY;
  const schemaPath = 'content/schema/v2/source-contract.schema.json';
  const validatorPath = 'scripts/content/contract-validator.mjs';
  if (sourceLock.schemaVersion !== 'w09-source-contract-pin/1' || sourceLock.repository !== repository
      || sourceLock.schemaId !== repository + '/' + schemaPath) {
    throw new Error('W09 Source contract pin must use the fixed Source repository and schema identity');
  }
  assertCommit(sourceLock.commit, 'W09 Source contract commit');
  exactKeys(sourceLock.files, ['schema', 'data', 'validator'], 'W09 Source contract files');
  const files = sourceLock.files;
  for (const [name, row] of Object.entries(files)) {
    exactKeys(row, ['path', 'sha256'], 'W09 Source contract files.' + name);
    assertSafeRelativePath(row.path, 'W09 Source contract files.' + name + '.path');
    assertSha256(row.sha256, 'W09 Source contract files.' + name + '.sha256');
  }
  if (files.schema.path !== schemaPath || files.validator.path !== validatorPath || !files.data.path.startsWith('content/')) {
    throw new Error('W09 Source contract pin has unexpected schema, data, or validator paths');
  }
  return {
    repository,
    commit: sourceLock.commit,
    schemaId: sourceLock.schemaId,
    schemaSha256: files.schema.sha256,
    dataSha256: files.data.sha256,
    validatorSha256: files.validator.sha256,
  };
}

function proposalIdentity(request, archiveSha256) {
  if (!isRecord(request)) throw new TypeError('Source proposal request must be an object');
  for (const field of ['requestId', 'releaseId', 'gameReleaseId', 'sourceCommit', 'sourceRevision', 'manifestSha256']) assertText(request[field], 'request.' + field);
  assertSha256(request.requestId, 'request.requestId');
  assertSha256(request.sourceRevision, 'request.sourceRevision');
  assertSha256(request.manifestSha256, 'request.manifestSha256');
  assertCommit(request.sourceCommit, 'request.sourceCommit');
  assertSha256(archiveSha256, 'archiveSha256');
  if (request.releaseId !== 'w09-' + createHash('sha256').update(canonicalJson({ sourceRevision: request.sourceRevision, gameReleaseId: request.gameReleaseId })).digest('hex').slice(0, 32)) {
    throw new Error('proposal releaseId is not derived from its Source revision and gameReleaseId');
  }
  if (!Array.isArray(request.packetFiles) || request.packetFiles.length !== SOURCE_PACKET_PATHS.length) throw new TypeError('proposal must include the exact Source packet pins');
  const packetFiles = request.packetFiles.map((row, index) => {
    exactKeys(row, ['path', 'sha256', 'sizeBytes'], 'proposal.packetFiles[' + index + ']');
    if (row.path !== SOURCE_PACKET_PATHS[index]) throw new Error('proposal packet file paths are not the fixed W05 packet list');
    assertSha256(row.sha256, 'proposal.packetFiles[' + index + '].sha256');
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0) throw new TypeError('proposal packet size is invalid');
    return { path: row.path, sha256: row.sha256, sizeBytes: row.sizeBytes };
  });
  return {
    requestId: request.requestId,
    releaseId: request.releaseId,
    gameReleaseId: request.gameReleaseId,
    sourceCommit: request.sourceCommit,
    sourceRevision: request.sourceRevision,
    manifestSha256: request.manifestSha256,
    archiveSha256,
    packetFiles,
  };
}

function validateProposalIdentity(proposal, sourceRevision) {
  exactKeys(proposal, [
    'requestId', 'releaseId', 'gameReleaseId', 'sourceCommit', 'sourceRevision', 'manifestSha256', 'archiveSha256', 'packetFiles',
  ], 'candidate PR proposal');
  const rebuilt = proposalIdentity(proposal, proposal.archiveSha256);
  if (canonicalJson(rebuilt) !== canonicalJson(proposal) || proposal.sourceRevision !== sourceRevision) {
    throw new Error('candidate PR proposal identity is malformed or belongs to a different Source revision');
  }
  return proposal;
}

function normalizeProposalSet(sourceRevision, proposals) {
  assertSha256(sourceRevision, 'sourceRevision');
  if (!Array.isArray(proposals) || proposals.length === 0) throw new TypeError('at least one Source game proposal is required');
  const rows = proposals.map(item => {
    const request = item?.request ?? item;
    const archiveSha256 = item?.archiveSha256 ?? request?.archiveSha256;
    const proposal = proposalIdentity(request, archiveSha256);
    if (proposal.sourceRevision !== sourceRevision) throw new Error('proposal belongs to a different Source revision');
    return proposal;
  });
  const first = rows[0];
  for (const row of rows.slice(1)) {
    if (row.manifestSha256 !== first.manifestSha256 || canonicalJson(row.packetFiles) !== canonicalJson(first.packetFiles)) {
      throw new Error('per-game proposals for one Source revision conflict on the shared manifest or packet bytes');
    }
  }
  rows.sort((left, right) => left.gameReleaseId.localeCompare(right.gameReleaseId, 'en') || left.requestId.localeCompare(right.requestId, 'en'));
  return rows;
}

function mergeProposalRows(existing, incoming) {
  const byGame = new Map(existing.map(row => [row.gameReleaseId, row]));
  for (const row of incoming) {
    const previous = byGame.get(row.gameReleaseId);
    if (previous && canonicalJson(previous) !== canonicalJson(row)) {
      throw new Error('candidate PR contains a conflicting per-game manifest/archive identity');
    }
    byGame.set(row.gameReleaseId, row);
  }
  const rows = [...byGame.values()].sort((left, right) => left.gameReleaseId.localeCompare(right.gameReleaseId, 'en'));
  const first = rows[0];
  for (const row of rows.slice(1)) {
    if (row.manifestSha256 !== first.manifestSha256 || canonicalJson(row.packetFiles) !== canonicalJson(first.packetFiles)) {
      throw new Error('candidate PR per-game proposals disagree on the Source revision manifest or packet bytes');
    }
  }
  return rows;
}

function encodeProposal(proposal) {
  return Buffer.from(canonicalJson(proposal), 'utf8').toString('base64url');
}

function renderCandidatePullRequestBody(sourceRevision, proposals, humanText) {
  const narrative = typeof humanText === 'string' && humanText.trim()
    ? humanText.trim()
    : [
      'W09 Source-to-Web candidate composition for Source revision ' + sourceRevision + '.',
      'The per-game proposal identities below are verified against their published Source archives before Web composition.',
    ].join('\n');
  return [
    narrative,
    '',
    '<!-- W09-SOURCE-REVISION: ' + sourceRevision + ' -->',
    ...proposals.map(proposal => '<!-- W09-PROPOSAL: ' + encodeProposal(proposal) + ' -->'),
  ].join('\n');
}

function candidatePullRequestHumanText(body) {
  if (typeof body !== 'string') throw new Error('candidate PR body is missing its W09 identity');
  return body.split(/\r?\n/u)
    .filter(line => !/^\s*<!-- W09-SOURCE-REVISION: [a-f0-9]{64} -->\s*$/u.test(line)
      && !/^\s*<!-- W09-PROPOSAL: [A-Za-z0-9_-]+ -->\s*$/u.test(line))
    .join('\n')
    .trim();
}

function parseCandidatePullRequestBody(body, expectedSourceRevision) {
  if (typeof body !== 'string') throw new Error('candidate PR body is missing its W09 identity');
  const revisionRows = [...body.matchAll(/<!-- W09-SOURCE-REVISION: ([a-f0-9]{64}) -->/gu)];
  if (revisionRows.length !== 1 || revisionRows[0][1] !== expectedSourceRevision) {
    throw new Error('candidate PR Source revision identity mismatch');
  }
  const proposalRows = [...body.matchAll(/<!-- W09-PROPOSAL: ([A-Za-z0-9_-]+) -->/gu)];
  if (proposalRows.length === 0) throw new Error('candidate PR has no per-game W09 proposal identities');
  const proposals = proposalRows.map(([_, encoded]) => {
    let value;
    try { value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
    catch { throw new Error('candidate PR proposal marker is not valid JSON'); }
    return validateProposalIdentity(value, expectedSourceRevision);
  });
  if (new Set(proposals.map(row => row.gameReleaseId)).size !== proposals.length) {
    throw new Error('candidate PR contains duplicate per-game proposal markers');
  }
  return mergeProposalRows([], proposals);
}

function parseGhJson(value, label) {
  if (typeof value !== 'string') throw new TypeError(label + ' command must return JSON text');
  let rows;
  try { rows = JSON.parse(value); }
  catch (error) { throw new Error(label + ' returned invalid JSON: ' + error.message); }
  if (!Array.isArray(rows) || rows.some(row => !isRecord(row))) throw new Error(label + ' must return an array of pull requests');
  return rows;
}

function assertExactCandidatePr(pr, branch) {
  if (pr.headRefName !== branch || pr.baseRefName !== 'main') throw new Error('candidate PR head/base identity mismatch');
  if (pr.isCrossRepository !== false || pr.headRepository?.nameWithOwner !== W09_WEB_REPOSITORY
      || pr.headRepositoryOwner?.login !== W09_WEB_REPOSITORY.split('/')[0]) {
    throw new Error('candidate PR repository identity mismatch');
  }
  if (pr.state !== 'OPEN') throw new Error('candidate PR for this Source revision is closed; refusing a duplicate');
  if (!Number.isSafeInteger(pr.number) || typeof pr.url !== 'string' || !pr.url.startsWith('https://github.com/' + W09_WEB_REPOSITORY + '/pull/')) {
    throw new Error('candidate PR response has an invalid identity');
  }
}

async function withCandidatePullRequestBodyFile(body, runGhWithPath) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'w09-candidate-pr-'));
  const bodyPath = path.join(temporaryDirectory, 'body.md');
  try {
    await writeFile(bodyPath, body, { flag: 'wx' });
    return await runGhWithPath(bodyPath);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function ensureW09CandidatePullRequest({ sourceRevision, proposals, runGh } = {}) {
  assertSha256(sourceRevision, 'sourceRevision');
  if (typeof runGh !== 'function') throw new TypeError('runGh must be a function accepting a fixed argument array');
  const incoming = normalizeProposalSet(sourceRevision, proposals);
  const branch = deriveW09CandidateBranch(sourceRevision);
  const listArgs = [
    'pr', 'list', '--repo', W09_WEB_REPOSITORY, '--head', branch, '--base', 'main', '--state', 'all', '--limit', '100',
    '--json', 'number,url,state,headRefName,baseRefName,headRepository,headRepositoryOwner,isCrossRepository,body',
  ];
  const lookup = async () => parseGhJson(await runGh(listArgs), 'gh pr list');
  const current = await lookup();
  if (current.length > 1) throw new Error('multiple candidate PRs exist for the same Source revision');
  if (current.length === 0) {
    const body = renderCandidatePullRequestBody(sourceRevision, incoming);
    const title = 'W09 Source revision ' + sourceRevision.slice(0, 12) + ' composition';
    try {
      await withCandidatePullRequestBodyFile(body, bodyPath => runGh([
        'pr', 'create', '--repo', W09_WEB_REPOSITORY, '--head', branch, '--base', 'main', '--title', title, '--body-file', bodyPath,
      ]));
    } catch (error) {
      const raced = await lookup();
      if (raced.length === 0) throw error;
      if (raced.length > 1) throw new Error('candidate PR creation race produced multiple PRs');
    }
    const created = await lookup();
    if (created.length !== 1) throw new Error('candidate PR creation was not visible on relookup');
    assertExactCandidatePr(created[0], branch);
    const stored = parseCandidatePullRequestBody(created[0].body, sourceRevision);
    if (canonicalJson(stored) !== canonicalJson(incoming)) throw new Error('created candidate PR did not retain the exact per-game proposal identities');
    return { created: true, updated: false, number: created[0].number, url: created[0].url, branch, sourceRevision, proposals: stored, body };
  }

  const pr = current[0];
  assertExactCandidatePr(pr, branch);
  const existing = parseCandidatePullRequestBody(pr.body, sourceRevision);
  const merged = mergeProposalRows(existing, incoming);
  const body = renderCandidatePullRequestBody(sourceRevision, merged, candidatePullRequestHumanText(pr.body));
  if (body === pr.body) {
    return { created: false, updated: false, number: pr.number, url: pr.url, branch, sourceRevision, proposals: merged, body };
  }
  await withCandidatePullRequestBodyFile(body, bodyPath => runGh([
    'pr', 'edit', String(pr.number), '--repo', W09_WEB_REPOSITORY, '--body-file', bodyPath,
  ]));
  const updated = await lookup();
  if (updated.length !== 1) throw new Error('candidate PR update was not visible on relookup');
  assertExactCandidatePr(updated[0], branch);
  const stored = parseCandidatePullRequestBody(updated[0].body, sourceRevision);
  if (canonicalJson(stored) !== canonicalJson(merged)) throw new Error('candidate PR update did not preserve every game proposal');
  return { created: false, updated: true, number: updated[0].number, url: updated[0].url, branch, sourceRevision, proposals: stored, body };
}

function gitBytes(repoRoot, args, label = 'Git') {
  try {
    return Buffer.from(execFileSync('git', ['-C', repoRoot, ...args], { encoding: null, maxBuffer: 64 * 1024 * 1024, windowsHide: true }));
  } catch (error) {
    throw new Error(label + ' verification failed: ' + (error.stderr?.toString('utf8').trim() || error.message));
  }
}

function gitText(repoRoot, args, label = 'Git') {
  return gitBytes(repoRoot, args, label).toString('utf8').trim();
}

function gitBlob(repoRoot, commit, relativePath, { checkWorktree = true } = {}) {
  assertCommit(commit, 'Git pin');
  assertSafeRelativePath(relativePath, 'Git path');
  const treeEntry = gitText(repoRoot, ['ls-tree', commit, '--', relativePath], 'Git tree lookup');
  const match = treeEntry.match(/^([0-7]{6}) blob ([a-f0-9]{40,64})\t(.+)$/u);
  if (!match || !['100644', '100755'].includes(match[1]) || match[3] !== relativePath) {
    throw new Error('pinned path is not a regular tracked Git blob: ' + relativePath);
  }
  const bytes = gitBytes(repoRoot, ['show', commit + ':' + relativePath], 'Git blob read');
  if (checkWorktree) {
    const absolute = path.join(repoRoot, ...relativePath.split('/'));
    const worktreeBytes = readFileSyncNoLinks(absolute);
    if (!worktreeBytes.equals(bytes)) throw new Error('tracked working file differs from its pinned Git blob: ' + relativePath);
  }
  return bytes;
}

function readFileSyncNoLinks(absolutePath) {
  const parsed = path.parse(absolutePath);
  let cursor = parsed.root;
  for (const segment of absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let info;
    try { info = lstatSync(cursor); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error('pinned working path is missing: ' + cursor);
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error('pinned working path may not traverse a symbolic link: ' + cursor);
  }
  return readFileSync(absolutePath);
}

function parseJson(bytes, label) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(label + ' is not valid UTF-8'); }
  try {
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error('root must be an object');
    return parsed;
  } catch (error) {
    throw new Error(label + ' is not valid JSON: ' + error.message);
  }
}

function readGitJson(repoRoot, commit, relativePath, label) {
  const bytes = gitBlob(repoRoot, commit, relativePath);
  return { bytes, value: parseJson(bytes, label) };
}

export function validateW09CompilerCodeLock(lock) {
  exactKeys(lock, ['schema', 'repository', 'commit', 'files', 'fileSetSha256'], 'W09 compiler code lock');
  if (lock.schema !== 'w09-web-compiler-lock/1' || lock.repository !== 'https://github.com/' + W09_WEB_REPOSITORY) {
    throw new Error('W09 compiler code lock repository or schema is invalid');
  }
  assertCommit(lock.commit, 'W09 compiler code commit');
  if (!Array.isArray(lock.files) || lock.files.length !== W09_COMPILER_FILE_PATHS.length) {
    throw new TypeError('W09 compiler code lock must pin the exact fixed executable file set');
  }
  let previous = null;
  for (const [index, row] of lock.files.entries()) {
    exactKeys(row, ['path', 'sizeBytes', 'sha256'], 'W09 compiler code files[' + index + ']');
    if (row.path !== W09_COMPILER_FILE_PATHS[index]) throw new Error('W09 compiler code lock file set is not the fixed sorted path list');
    if (previous !== null && previous.localeCompare(row.path, 'en') >= 0) throw new Error('W09 compiler code lock files must be sorted and unique');
    previous = row.path;
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1) throw new TypeError('W09 compiler code file size is invalid');
    assertSha256(row.sha256, 'W09 compiler code file sha256');
  }
  assertSha256(lock.fileSetSha256, 'W09 compiler file-set sha256');
  const expected = sha256(Buffer.from(canonicalJson(lock.files), 'utf8'));
  if (lock.fileSetSha256 !== expected) throw new Error('W09 compiler file-set digest does not match its sorted raw file pins');
  return lock;
}

export function loadW09CompilerCodePin({ repoRoot, head = gitText(repoRoot, ['rev-parse', 'HEAD']) } = {}) {
  if (typeof repoRoot !== 'string') throw new TypeError('repoRoot is required to verify the W09 compiler code pin');
  const lockBytes = gitBlob(repoRoot, head, W09_COMPILER_LOCK_PATH);
  const lock = validateW09CompilerCodeLock(parseJson(lockBytes, 'W09 compiler code lock'));
  const resolvedCommit = gitText(repoRoot, ['rev-parse', lock.commit + '^{commit}'], 'W09 compiler commit resolution');
  if (resolvedCommit !== lock.commit) throw new Error('W09 compiler code pin must use a full canonical Git commit SHA');
  for (const row of lock.files) {
    const pinnedBytes = gitBlob(repoRoot, lock.commit, row.path);
    const currentBytes = gitBlob(repoRoot, head, row.path);
    if (pinnedBytes.byteLength !== row.sizeBytes || sha256(pinnedBytes) !== row.sha256
        || !pinnedBytes.equals(currentBytes)) {
      throw new Error('W09 compiler tracked file differs from its immutable code pin: ' + row.path);
    }
  }
  return {
    commit: lock.commit,
    files: structuredClone(lock.files),
    fileSetSha256: lock.fileSetSha256,
    lockSha256: sha256(lockBytes),
    lockPath: W09_COMPILER_LOCK_PATH,
  };
}

function assertOfficialWebOrigin(repoRoot) {
  const origin = gitText(repoRoot, ['remote', 'get-url', 'origin'], 'Web origin check').replace(/\/$/u, '');
  if (origin !== W09_WEB_ORIGIN && origin !== W09_WEB_ORIGIN.slice(0, -'.git'.length)) {
    throw new Error('Web origin must be the fixed official repository');
  }
}

async function loadPinnedSourceApi(repoRoot, head) {
  const lockFile = readGitJson(repoRoot, head, SOURCE_CACHE_LOCK_PATH, 'Source request cache lock');
  const lock = lockFile.value;
  exactKeys(lock, ['schema', 'repository', 'commit', 'sourcePath', 'cachePath', 'sizeBytes', 'sha256'], 'Source request cache lock');
  if (lock.schema !== 'w09-source-request-lock/1' || lock.repository !== W09_SOURCE_REPOSITORY
      || lock.sourcePath !== 'scripts/content/contract-w09-request.mjs' || lock.cachePath !== SOURCE_CACHE_PATH) {
    throw new Error('Source request cache lock identity is invalid');
  }
  assertCommit(lock.commit, 'Source request code commit');
  assertSha256(lock.sha256, 'Source request cache sha256');
  if (!Number.isSafeInteger(lock.sizeBytes) || lock.sizeBytes < 1) throw new TypeError('Source request cache sizeBytes is invalid');
  const moduleBytes = gitBlob(repoRoot, head, lock.cachePath);
  if (moduleBytes.byteLength !== lock.sizeBytes || sha256(moduleBytes) !== lock.sha256) {
    throw new Error('cached Source request module differs from its fixed raw Git lock');
  }
  const modulePath = path.join(repoRoot, ...lock.cachePath.split('/'));
  const module = await import(pathToFileURL(modulePath).href + '?sha256=' + lock.sha256);
  for (const exportName of [
    'validateW09SourceRequest',
    'resolvePublishedW09SourceArchive',
    'verifyW09SourcePacket',
    'verifyW09SourceRevision',
    'loadW09ApprovedSourceRuntime',
    'cleanupW09ApprovedSourceRuntime',
  ]) {
    if (typeof module[exportName] !== 'function') throw new Error('pinned Source request cache omits ' + exportName);
  }
  return module;
}

export function validateW09SelectedComposition(selection) {
  exactKeys(selection, ['schema', 'repository', 'sourceRevision', 'proposals'], 'selected W09 composition');
  if (selection.schema !== 'w09-selected-composition/1' || selection.repository !== W09_WEB_REPOSITORY) {
    throw new Error('selected W09 composition must use the fixed repository and schema');
  }
  assertSha256(selection.sourceRevision, 'selected sourceRevision');
  if (!Array.isArray(selection.proposals) || selection.proposals.length === 0) throw new TypeError('selected W09 composition must include at least one per-game proposal');
  const gameIds = new Set();
  let manifestSha256 = null;
  for (const [index, row] of selection.proposals.entries()) {
    exactKeys(row, ['gameReleaseId', 'releaseId', 'requestId', 'manifestSha256', 'archiveSha256'], 'selected proposals[' + index + ']');
    assertText(row.gameReleaseId, 'selected gameReleaseId');
    assertSha256(row.requestId, 'selected requestId');
    assertSha256(row.manifestSha256, 'selected manifestSha256');
    assertSha256(row.archiveSha256, 'selected archiveSha256');
    if (typeof row.releaseId !== 'string' || !/^w09-[a-f0-9]{32}$/u.test(row.releaseId)) throw new TypeError('selected releaseId is invalid');
    const expectedReleaseId = 'w09-' + createHash('sha256')
      .update(canonicalJson({ sourceRevision: selection.sourceRevision, gameReleaseId: row.gameReleaseId }), 'utf8')
      .digest('hex').slice(0, 32);
    if (row.releaseId !== expectedReleaseId) throw new Error('selected releaseId is not derived from its Source revision and game release');
    if (manifestSha256 !== null && row.manifestSha256 !== manifestSha256) throw new Error('selected per-game proposals conflict on the Source manifest identity');
    manifestSha256 = row.manifestSha256;
    if (gameIds.has(row.gameReleaseId)) throw new Error('selected composition contains a duplicate gameReleaseId');
    gameIds.add(row.gameReleaseId);
  }
  return selection;
}

async function loadSelectedComposition(repoRoot, head) {
  try {
    const { value } = readGitJson(repoRoot, head, W09_SELECTED_COMPOSITION_PATH, 'selected W09 composition');
    return validateW09SelectedComposition(value);
  } catch (error) {
    if (/does not exist|not a regular tracked Git blob|Git tree lookup verification failed/iu.test(error.message)) return null;
    throw error;
  }
}

async function loadSelectedAuthoringOverlay(repoRoot, head, selection) {
  const rowsByTarget = new Map();
  let overlayCommit = null;
  for (const selectedRow of selection.proposals) {
    const lockPath = W09_LOCK_ROOT + selectedRow.requestId + '.json';
    const lock = parseJson(gitBlob(repoRoot, head, lockPath), 'selected W09 composition input lock');
    const priorRequest = {
      releaseId: selectedRow.releaseId,
      requestId: selectedRow.requestId,
      gameReleaseId: selectedRow.gameReleaseId,
      sourceCommit: lock.source?.sourceCommit,
      sourceRevision: lock.source?.sourceRevision,
      manifestSha256: lock.source?.manifestSha256,
      packetFiles: lock.source?.packetFiles,
    };
    validateW09CompositionInputLock(lock, priorRequest, { archiveSha256: selectedRow.archiveSha256 });
    if (lock.source.sourceRevision !== selection.sourceRevision || lock.source.manifestSha256 !== selectedRow.manifestSha256) {
      throw new Error('selected W09 authoring overlay lock conflicts with its selected Source revision');
    }
    if (lock.authoringOverlay.length) {
      if (overlayCommit !== null && overlayCommit !== lock.web.overlayCommit) {
        throw new Error('selected per-game composition locks disagree on their shared Web authoring commit');
      }
      overlayCommit = lock.web.overlayCommit;
    }
    for (const row of lock.authoringOverlay) {
      const bytes = gitBlob(repoRoot, lock.web.overlayCommit, row.path);
      if (bytes.byteLength !== row.sizeBytes || sha256(bytes) !== row.sha256) {
        throw new Error('selected Web authoring overlay does not match its pinned raw Git bytes: ' + row.path);
      }
      const key = row.mode + '\0' + row.target;
      const previous = rowsByTarget.get(key);
      if (previous && canonicalJson(previous) !== canonicalJson(row)) {
        throw new Error('selected per-game composition locks contain conflicting authoring overlays for ' + row.mode + '/' + row.target);
      }
      rowsByTarget.set(key, row);
    }
  }
  return {
    rows: [...rowsByTarget.values()].sort((left, right) => left.mode.localeCompare(right.mode, 'en') || left.target.localeCompare(right.target, 'en')),
    overlayCommit,
  };
}

async function makeSourceLock(request, sourceRoot, sourceApi) {
  const dataInput = request.sourceInputs.find(input => input.role === 'candidate');
  if (!dataInput) throw new Error('verified Source request omits its candidate input pin');
  const schemaPath = 'content/schema/v2/source-contract.schema.json';
  const validatorPath = 'scripts/content/contract-validator.mjs';
  if (typeof sourceApi?.loadW09ApprovedSourceRuntime !== 'function'
      || typeof sourceApi?.cleanupW09ApprovedSourceRuntime !== 'function') {
    const error = new Error('pinned Source request API omits the approved runtime loader or cleanup helper');
    error.code = 'ERR_W09_UNTRUSTED_SOURCE_RUNTIME';
    throw error;
  }
  let runtime;
  let cleaned = false;
  const cleanup = async () => {
    if (!runtime || cleaned) return;
    await sourceApi.cleanupW09ApprovedSourceRuntime(runtime);
    cleaned = true;
  };
  try {
    runtime = await sourceApi.loadW09ApprovedSourceRuntime({ sourceRoot, sourceCommit: request.sourceCommit });
    if (runtime?.identity?.sourceCommit !== request.sourceCommit
        || typeof runtime.validator?.validateSourceContract !== 'function'
        || typeof runtime.validator?.assertSchemaValidatorParity !== 'function'
        || !isRecord(runtime.schema) || !Array.isArray(runtime.identity.files)) {
      throw new Error('approved Source runtime identity or validator interface is invalid');
    }
    const runtimeFiles = new Map(runtime.identity.files.map(row => [row.path, row]));
    const schemaPin = runtimeFiles.get(schemaPath);
    const validatorPin = runtimeFiles.get(validatorPath);
    if (!schemaPin || !validatorPin) throw new Error('approved Source runtime does not include the pinned schema and validator');
    const schema = runtime.schema;
    const sourceValidator = runtime.validator;
    if (sourceValidator.CONTRACT_SCHEMA_ID !== schema.$id) throw new Error('pinned Source schema/validator identity mismatch');
    sourceValidator.assertSchemaValidatorParity(schema);
    return {
      lock: {
        schemaVersion: 'w09-source-contract-pin/1',
        repository: 'https://github.com/' + W09_SOURCE_REPOSITORY,
        commit: request.sourceCommit,
        schemaId: sourceValidator.CONTRACT_SCHEMA_ID,
        files: {
          schema: { path: schemaPath, sha256: schemaPin.sha256 },
          data: { path: dataInput.path, sha256: dataInput.sha256 },
          validator: { path: validatorPath, sha256: validatorPin.sha256 },
        },
      },
      schema,
      validator: sourceValidator,
      runtimeIdentity: structuredClone(runtime.identity),
      cleanup,
    };
  } catch (cause) {
    try { await cleanup(); }
    catch (cleanupError) {
      const error = new AggregateError([cause, cleanupError], 'approved Source runtime loading and cleanup both failed');
      error.code = 'ERR_W09_UNTRUSTED_SOURCE_RUNTIME';
      throw error;
    }
    if (cause?.code === 'ERR_W09_UNTRUSTED_SOURCE_RUNTIME') throw cause;
    const error = new Error('approved Source runtime verification failed: ' + (cause?.message ?? String(cause)), { cause });
    error.code = 'ERR_W09_UNTRUSTED_SOURCE_RUNTIME';
    throw error;
  }
}

function applyOverlayRows(modeInputs, rows, web) {
  const parsedRows = new Map();
  for (const row of rows) {
    const bytes = gitBlob(modeInputs.repoRoot, web.overlayCommit, row.path);
    if (bytes.byteLength !== row.sizeBytes || sha256(bytes) !== row.sha256) throw new Error('typed Web overlay raw Git pin mismatch: ' + row.path);
    const value = parseJson(bytes, 'W09 Web overlay ' + row.path);
    parsedRows.set(row.mode + '\0' + row.target, { row, value });
  }

  for (const modeName of ['w06', 'w07']) {
    const input = modeInputs[modeName];
    const modeLock = input.webLock;
    const apply = target => {
      const found = parsedRows.get(modeName + '\0' + target);
      if (!found) return;
      const { row, value } = found;
      if (target === 'authoring') {
        input.authoring = value;
        modeLock.authoring = { ...modeLock.authoring, path: row.path, sha256: row.sha256 };
      } else if (target === 'officialInputs') {
        input.officialInputs = value;
        input.officialInputsBytes = gitBlob(modeInputs.repoRoot, web.overlayCommit, row.path);
        modeLock.officialInputs = { ...modeLock.officialInputs, path: row.path, sha256: row.sha256 };
      } else if (target === 'termRules') {
        input.termRules = value;
        modeLock.termRules = { ...modeLock.termRules, path: row.path, sha256: row.sha256 };
      } else if (target === 'baseline') {
        input.baseline = value;
        modeLock.baseline = { ...modeLock.baseline, path: row.path, sha256: row.sha256 };
      } else if (target === 'baselineLock') {
        input.baselineLock = value;
      }
    };
    for (const target of OVERLAY_TARGETS) apply(target);
  }

  const termRuleRows = rows.filter(row => row.target === 'termRules');
  if (termRuleRows.length) {
    const rules = parsedRows.get(termRuleRows[0].mode + '\0termRules')?.value;
    modeInputs.w06.termRules = structuredClone(rules);
    modeInputs.w07.termRules = structuredClone(rules);
    for (const modeName of ['w06', 'w07']) {
      modeInputs[modeName].webLock.termRules = {
        ...(modeInputs[modeName].webLock.termRules ?? {}),
        path: termRuleRows[0].path,
        sha256: termRuleRows[0].sha256,
      };
    }
  }
}

async function createW09CompilerProjection({ repoRoot, request, packet, replay, lock, sourceApi }) {
  const w08 = await import('./contract-w08-build.mjs');
  const authoring = await import('./contract-authoring.mjs');
  const head = gitText(repoRoot, ['rev-parse', 'HEAD']);
  const codePin = loadW09CompilerCodePin({ repoRoot, head });
  const compilerInput = await w08.loadW08CompilerInputs({ repoRoot });
  const inputLockBytes = gitBlob(repoRoot, head, W08_INPUT_LOCK_PATH);
  const compilerLockBytes = gitBlob(repoRoot, head, W08_COMPILER_LOCK_PATH);
  if (sha256(inputLockBytes) !== lock.web.w08InputLockSha256
      || sha256(compilerLockBytes) !== lock.web.w08CompilerLockSha256
      || compilerInput.compilerIdentity.inputLockSha256 !== lock.web.w08InputLockSha256
      || compilerInput.inputLock.authoringCommit !== lock.web.w08AuthoringCommit
      || compilerInput.compilerIdentity.commit !== lock.web.w08CompilerCommit
      || codePin.commit !== lock.web.compilerCommit
      || codePin.fileSetSha256 !== lock.web.compilerFileSetSha256
      || codePin.lockSha256 !== lock.web.w09CompilerLockSha256) {
    throw new Error('W09 Web input lock does not match the fixed W08 compiler and authoring baseline');
  }
  const compilerFiles = [W08_INPUT_LOCK_PATH, W08_COMPILER_LOCK_PATH,
    ...compilerInput.compilerIdentity.files.map(row => row.path)];
  for (const filePath of compilerFiles) gitBlob(repoRoot, head, filePath);

  const sourcePin = await makeSourceLock(request, replay.sourceRoot, sourceApi);
  try {
  const authoringSourcePin = createW09AuthoringSourcePin(sourcePin.lock);
  const sourceContract = structuredClone(packet.technical);
  if (sourceContract.fixtureOnly !== false || sourceContract.publicationEligible !== true) {
    throw new Error('formal W09 Source technical contract must be non-fixture and eligible before projection');
  }
  const sourceValidation = sourcePin.validator.validateSourceContract(sourceContract, { schema: sourcePin.schema });
  if (!sourceValidation.valid || sourceValidation.publicationEligible !== true) {
    throw new Error('original formal Source contract failed its pinned schema: ' + sourceValidation.issues.map(issue => issue.path + ' ' + issue.message).join('; '));
  }
  const w08SourceProjection = structuredClone(sourceContract);
  // The verified Source gate and original validation stay in W09. Only the root eligibility flag is projected for W08.
  w08SourceProjection.publicationEligible = false;
  assertW09SourceProjectionPreservesReviewProof(
    sourceContract, w08SourceProjection, sourcePin.validator, sourcePin.schema, sourceValidation,
  );

  for (const modeName of ['w06', 'w07']) {
    const mode = compilerInput[modeName];
    mode.sourceContract = structuredClone(sourceContract);
    mode.sourceLock = structuredClone(sourcePin.lock);
    mode.sourceSchema = sourcePin.schema;
    mode.sourceValidator = sourcePin.validator;
    mode.sourceValidation = sourceValidation;
    mode.sourceRecordMap = new Map(mode.sourceContract.records.map(record => [record.gameReleaseId + '\0' + record.recordId, record]));
    mode.sourceReleaseMap = new Map(mode.sourceContract.gameReleases.map(release => [release.gameReleaseId, release]));
    mode.authoring.sourcePin = structuredClone(authoringSourcePin);
  }

  applyOverlayRows({ ...compilerInput, repoRoot }, lock.authoringOverlay, lock.web);
  for (const modeName of ['w06', 'w07']) {
    const mode = compilerInput[modeName];
    mode.authoring.sourcePin = structuredClone(authoringSourcePin);
    mode.authoring.officialInputsSha256 = mode.webLock.officialInputs.sha256;
    const validation = authoring.validateWebAuthoring(mode.authoring, mode);
    if (!validation.valid) throw new Error(modeName.toUpperCase() + ' W09 authoring overlay failed validation: ' + validation.issues.map(issue => issue.path + ' ' + issue.message).join('; '));
    mode.webValidation = validation;
  }

  const gameReleaseId = request.gameReleaseId;
  const gameRelease = sourceContract.gameReleases.find(item => item.gameReleaseId === gameReleaseId);
  if (!gameRelease) throw new Error('Source request gameReleaseId is absent from the verified Source contract');
  const w08ProjectionInput = {
    ...compilerInput,
    compilerIdentity: {
      ...compilerInput.compilerIdentity,
      commit: codePin.commit,
    },
    sourceContract: w08SourceProjection,
    sourceBuild: {
      repository: 'https://github.com/' + W09_SOURCE_REPOSITORY,
      commit: request.sourceCommit,
      sourceRevision: request.sourceRevision,
      manifestSha256: request.manifestSha256,
      mode: 'candidate',
      buildIdentityVerified: false,
      publicationEligible: false,
      receiptSha256: request.packetFiles.find(row => row.path === 'source-receipt.json').sha256,
    },
    gameReleaseId,
    proposedContentVersion: gameRelease.gameVersion + '.1',
    webIdentity: {
      ...compilerInput.webIdentity,
      compilerCommit: codePin.commit,
      authoringCommit: lock.web.authoringCommit,
    },
  };
  const candidate = w08.compileW08Candidate(w08ProjectionInput);
  const sourceOnlyBlockers = new Set(['source-build-identity-unverified', 'source-build-not-publication-eligible']);
  const blockers = candidate.envelope.publicationGate.blockers.filter(blocker => !sourceOnlyBlockers.has(blocker));
  if (candidate.envelope.publicationGate.blockers.filter(blocker => sourceOnlyBlockers.has(blocker)).length !== 2) {
    throw new Error('W08 candidate did not retain the fixed non-publishable Source projection blockers');
  }
  const sourceGate = request.eligibility;
  if (sourceGate?.mode !== 'formal' || sourceGate?.status !== 'eligible' || sourceGate.publicationEligible !== true
      || sourceGate.buildIdentityVerified !== true || sourceGate.fixtureOnly !== false || sourceGate.reasons?.length !== 0) {
    blockers.push('verified-source-release-gate-not-eligible');
  }
  const gate = {
    status: blockers.length === 0 ? 'ready-for-release-allocation' : 'blocked',
    publicationEligible: false,
    blockers: [...new Set(blockers)].sort(),
  };
  const inputDigest = sha256(Buffer.from(canonicalJson({
    source: {
      requestId: request.requestId,
      releaseId: request.releaseId,
      sourceRevision: request.sourceRevision,
      manifestSha256: request.manifestSha256,
      archiveSha256: lock.source.archiveSha256,
      sourceInputs: request.sourceInputs,
      packetFiles: lock.source.packetFiles,
    },
    web: {
      gameReleaseId,
      w08InputLockSha256: lock.web.w08InputLockSha256,
      w08CompilerLockSha256: lock.web.w08CompilerLockSha256,
      w08CompilerCommit: lock.web.w08CompilerCommit,
      compilerFileSetSha256: lock.web.compilerFileSetSha256,
      compilerCommit: lock.web.compilerCommit,
      authoringCommit: lock.web.authoringCommit,
      overlays: lock.authoringOverlay,
      webInputs: candidate.envelope.webInputs,
    },
  }), 'utf8'));
  return {
    status: 'verified',
    request,
    selectedSource: sourceContract,
    verifiedSource: {
      releaseId: request.releaseId,
      requestId: request.requestId,
      sourceCommit: request.sourceCommit,
      sourceRevision: request.sourceRevision,
      manifestSha256: request.manifestSha256,
      archiveSha256: lock.source.archiveSha256,
      eligibility: structuredClone(sourceGate),
      packetFiles: lock.source.packetFiles,
      sourceInputs: structuredClone(request.sourceInputs),
      sourceBuildIdentityVerified: true,
      publicationEligible: true,
      providerImmutable: replay.providerImmutable,
    },
    inputLock: lock,
    candidate,
    gate,
    inputDigest,
  };
  } finally {
    await sourcePin.cleanup();
  }
}

export function assertW09SourceProjectionPreservesReviewProof(original, projection, validator, schema, originalValidation) {
  if (projection.publicationEligible !== false || original.fixtureOnly !== false || original.publicationEligible !== true) {
    throw new Error('W09 Source projection must only lower the root publicationEligible flag');
  }
  if (!isRecord(originalValidation) || originalValidation.valid !== true || originalValidation.publicationEligible !== true
      || !Array.isArray(originalValidation.issues) || originalValidation.issues.length !== 0) {
    throw new Error('W09 original Source review proof must be valid and publication eligible');
  }
  const restored = structuredClone(projection);
  restored.publicationEligible = original.publicationEligible;
  if (canonicalJson(restored) !== canonicalJson(original)) {
    throw new Error('W09 Source candidate projection changed content, review state, or receipts');
  }

  if (!schema || typeof validator?.validateSourceContract !== 'function') {
    throw new Error('W09 Source projection requires the pinned validator and schema');
  }
  const projectedValidation = validator.validateSourceContract(projection, { schema });
  const expectedFlagIssue = {
    path: '/publicationEligible',
    code: 'publication-state-mismatch',
    message: 'publicationEligible must be true based on fixture and review state',
  };
  if (!isRecord(projectedValidation) || projectedValidation.valid !== false || projectedValidation.publicationEligible !== true
      || !Array.isArray(projectedValidation.issues) || projectedValidation.issues.length !== 1
      || canonicalJson(projectedValidation.issues[0]) !== canonicalJson(expectedFlagIssue)) {
    throw new Error('W09 Source candidate projection review proof is invalid or has an unexpected validation issue');
  }
  return projectedValidation;
}

async function writeW09ProposalDirectory(directory, files) {
  const absolute = path.resolve(directory);
  const parent = path.dirname(absolute);
  await mkdir(parent, { recursive: true });
  let cursor = path.parse(absolute).root;
  for (const segment of path.relative(cursor, parent).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const info = await lstat(cursor).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (info?.isSymbolicLink() || (info && !info.isDirectory())) throw new Error('W09 proposal path may not traverse a symbolic link or file');
  }
  const expectedEntries = new Set();
  for (const relativePath of files.keys()) {
    assertSafeRelativePath(relativePath, 'W09 proposal file path');
    const segments = relativePath.split('/');
    for (let index = 1; index < segments.length; index += 1) expectedEntries.add(segments.slice(0, index).join('/') + '\0directory');
    expectedEntries.add(relativePath + '\0file');
  }
  const expectedSorted = [...expectedEntries].sort();
  const existing = await lstat(absolute).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error('existing W09 proposal must be a regular directory');
    const actualEntries = [];
    const visit = async (folder, prefix = '') => {
      for (const name of (await readdir(folder)).sort()) {
        const entryPath = path.join(folder, name);
        const relativePath = prefix ? prefix + '/' + name : name;
        const info = await lstat(entryPath);
        if (info.isSymbolicLink()) throw new Error('W09 proposal may not contain symbolic links');
        if (info.isDirectory()) {
          actualEntries.push(relativePath + '\0directory');
          await visit(entryPath, relativePath);
        } else if (info.isFile()) actualEntries.push(relativePath + '\0file');
        else throw new Error('W09 proposal may contain only regular files and directories');
      }
    };
    await visit(absolute);
    if (JSON.stringify(actualEntries.sort()) !== JSON.stringify(expectedSorted)) throw new Error('existing W09 proposal has conflicting paths');
    for (const [relativePath, bytes] of files) {
      const current = await readFile(path.join(absolute, ...relativePath.split('/')));
      if (!current.equals(bytes)) throw new Error('existing W09 proposal conflicts with its immutable bytes: ' + relativePath);
    }
    return { path: absolute, reused: true };
  }

  const temporary = absolute + '.' + process.pid + '.' + Math.random().toString(16).slice(2) + '.tmp';
  await mkdir(temporary, { recursive: false });
  try {
    for (const [relativePath, bytes] of files) {
      assertSafeRelativePath(relativePath, 'W09 proposal file path');
      const destination = path.join(temporary, ...relativePath.split('/'));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: 'wx' });
    }
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return { path: absolute, reused: false };
}

function w09ProposalJson(value) {
  return Buffer.from(canonicalJson(value) + '\n', 'utf8');
}

function makeProposalCompositionLock(request, archiveSha256, compilerInput, webPins, codePin, authoringOverlay = []) {
  return validateW09CompositionInputLock({
    schema: 'w09-web-inputs-lock/1',
    repository: 'https://github.com/' + W09_WEB_REPOSITORY,
    source: {
      releaseId: request.releaseId,
      requestId: request.requestId,
      sourceCommit: request.sourceCommit,
      sourceRevision: request.sourceRevision,
      manifestSha256: request.manifestSha256,
      archiveSha256,
      packetFiles: structuredClone(request.packetFiles),
    },
    web: {
      w08InputLockSha256: webPins.w08InputLockSha256,
      w08CompilerLockSha256: webPins.w08CompilerLockSha256,
      w08AuthoringCommit: compilerInput.inputLock.authoringCommit,
      w08CompilerCommit: compilerInput.compilerIdentity.commit,
      w09CompilerLockSha256: codePin.lockSha256,
      compilerFileSetSha256: codePin.fileSetSha256,
      compilerCommit: codePin.commit,
      overlayCommit: authoringOverlay.length ? webPins.overlayCommit : null,
      authoringCommit: authoringOverlay.length ? webPins.overlayCommit : compilerInput.inputLock.authoringCommit,
    },
    gameReleaseId: request.gameReleaseId,
    authoringOverlay,
  }, request, { archiveSha256 });
}

/**
 * Resolve a Source release_id event into a durable, explicitly unselected Web proposal.
 * This path verifies the public archive and Source Git replay, but never allocates a content
 * version or writes the selected composition pointer.
 */
export async function prepareW09SourceProposal({ repoRoot, sourceRoot, releaseId, fetchImpl = globalThis.fetch } = {}) {
  if (typeof repoRoot !== 'string' || typeof sourceRoot !== 'string') throw new Error('explicit Web repoRoot and official Source sourceRoot are required');
  if (typeof releaseId !== 'string' || !/^w09-[a-f0-9]{32}$/u.test(releaseId)) throw new Error('releaseId must be a derived W09 identity');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const absoluteWebRoot = await realpath(repoRoot);
  const absoluteSourceRoot = await realpath(sourceRoot);
  assertOfficialWebOrigin(absoluteWebRoot);
  const head = gitText(absoluteWebRoot, ['rev-parse', 'HEAD']);
  const codePin = loadW09CompilerCodePin({ repoRoot: absoluteWebRoot, head });
  const sourceApi = await loadPinnedSourceApi(absoluteWebRoot, head);
  const resolved = await sourceApi.resolvePublishedW09SourceArchive({ releaseId, fetchImpl });
  if (resolved.status !== 'verified') return { status: 'pending', releaseId, reason: resolved.reason, proposalWritten: false };
  sourceApi.validateW09SourceRequest(resolved.request);
  if (resolved.request.releaseId !== releaseId) throw new Error('public Source archive release_id does not match the triggering event');

  const packetTemp = await mkdtemp(path.join(os.tmpdir(), 'w09-web-proposal-packet-'));
  let sourcePin;
  try {
    for (const filePath of SOURCE_PACKET_PATHS) {
      const bytes = resolved.files.get(filePath);
      if (!bytes) throw new Error('verified Source archive omits packet file ' + filePath);
      await writeFile(path.join(packetTemp, filePath), bytes, { flag: 'wx' });
    }
    const packet = await sourceApi.verifyW09SourcePacket({ request: resolved.request, packetDir: packetTemp });
    const replay = await sourceApi.verifyW09SourceRevision({
      request: resolved.request,
      packetDir: packetTemp,
      sourceRoot: absoluteSourceRoot,
      expectedCommit: resolved.request.sourceCommit,
    });
    sourcePin = await makeSourceLock(resolved.request, absoluteSourceRoot, sourceApi);
    const compilerModule = await import('./contract-w08-build.mjs');
    const compilerInput = await compilerModule.loadW08CompilerInputs({ repoRoot: absoluteWebRoot });
    const previousSelection = await loadSelectedComposition(absoluteWebRoot, head);
    const carriedOverlay = previousSelection
      ? await loadSelectedAuthoringOverlay(absoluteWebRoot, head, previousSelection)
      : { rows: [], overlayCommit: null };
    const webPins = {
      w08InputLockSha256: sha256(gitBlob(absoluteWebRoot, head, W08_INPUT_LOCK_PATH)),
      w08CompilerLockSha256: sha256(gitBlob(absoluteWebRoot, head, W08_COMPILER_LOCK_PATH)),
      overlayCommit: carriedOverlay.overlayCommit,
    };
    const lock = makeProposalCompositionLock(resolved.request, resolved.archiveSha256, compilerInput, webPins, codePin, carriedOverlay.rows);
    const proposalOnly = {
      schema: 'w09-source-composition-proposal/1',
      proposalOnly: true,
      selected: false,
      allocationReserved: false,
      publicationEligible: false,
      releaseId,
      requestId: resolved.request.requestId,
      gameReleaseId: resolved.request.gameReleaseId,
      sourceCommit: resolved.request.sourceCommit,
      sourceRevision: resolved.request.sourceRevision,
      manifestSha256: resolved.request.manifestSha256,
      archiveSha256: resolved.archiveSha256,
      packetFiles: structuredClone(resolved.request.packetFiles),
      proposalLockSha256: sha256(w09ProposalJson(lock)),
      sourceMode: packet.manifest.mode,
      sourceEligibility: resolved.request.eligibility,
      sourceReplay: { valid: replay.valid, sourceCommit: replay.sourceCommit, sourceRevision: replay.sourceRevision },
      providerImmutable: resolved.providerImmutable,
      status: 'source-review-required',
    };
    const sourceLock = {
      schema: 'w09-source-proposal-lock/1',
      repository: 'https://github.com/' + W09_SOURCE_REPOSITORY,
      ...sourcePin.lock,
      releaseId,
      requestId: resolved.request.requestId,
      sourceRevision: resolved.request.sourceRevision,
      manifestSha256: resolved.request.manifestSha256,
      archiveSha256: resolved.archiveSha256,
      packetFiles: structuredClone(resolved.request.packetFiles),
      sourceInputs: structuredClone(resolved.request.sourceInputs),
    };
    let composition = null;
    let projectionError = null;
    if (packet.manifest.mode === 'formal' && resolved.request.eligibility?.status === 'eligible') {
      try {
        composition = await createW09CompilerProjection({
          repoRoot: absoluteWebRoot,
          request: resolved.request,
          packet,
          replay: { ...replay, sourceRoot: absoluteSourceRoot, providerImmutable: resolved.providerImmutable },
          lock,
          sourceApi,
        });
      } catch (error) {
        if (error?.code === 'ERR_W09_UNTRUSTED_SOURCE_RUNTIME') throw error;
        projectionError = error?.message ?? String(error);
      }
    }
    const reviewCandidate = {
      schema: 'w09-web-dependency-review-candidate/1',
      proposalOnly: true,
      selected: false,
      allocationReserved: false,
      source: {
        requestId: resolved.request.requestId,
        releaseId,
        sourceRevision: resolved.request.sourceRevision,
        manifestSha256: resolved.request.manifestSha256,
        changedRecords: structuredClone(resolved.request.changedRecords),
        changedClaims: structuredClone(resolved.request.changedClaims),
      },
      web: composition ? {
        status: composition.gate.status,
        inputDigest: composition.inputDigest,
        gate: composition.gate,
        review: composition.candidate.envelope.review,
        webInputs: composition.candidate.envelope.webInputs,
      } : {
        status: packet.manifest.mode === 'formal' && resolved.request.eligibility?.status === 'eligible'
          ? 'web-authoring-required'
          : 'waiting-for-formal-source-review',
        gate: { status: 'blocked', publicationEligible: false, blockers: ['proposal-is-not-selected-or-approved'] },
        ...(projectionError ? { reason: projectionError } : {}),
      },
    };
    const files = new Map([
      ['proposal.json', w09ProposalJson(proposalOnly)],
      ['source-lock.json', w09ProposalJson(sourceLock)],
      ['web-input-lock.json', w09ProposalJson(lock)],
      ['review-candidate.json', w09ProposalJson(reviewCandidate)],
    ]);
    if (composition) {
      const candidate = composition.candidate;
      proposalOnly.status = composition.gate.status === 'ready-for-release-allocation' ? 'ready-for-web-review' : 'web-review-required';
      proposalOnly.inputDigest = composition.inputDigest;
      proposalOnly.gate = composition.gate;
      files.set('proposal.json', w09ProposalJson(proposalOnly));
      const proposalCandidateRoot = 'candidate/';
      files.set(proposalCandidateRoot + 'manifest.json', candidate.manifestBytes);
      for (const [relativePath, bytes] of candidate.files) files.set(proposalCandidateRoot + relativePath, bytes);
      reviewCandidate.candidate = {
        manifest: {
          ...candidate.envelope.manifest,
          proposalPath: proposalCandidateRoot + 'manifest.json',
          externalPath: candidate.envelope.manifest.path,
        },
        files: [...candidate.files].map(([relativePath, bytes]) => ({
          proposalPath: proposalCandidateRoot + relativePath,
          externalPath: 'data/' + candidate.manifest.dataRevision + '/' + relativePath,
          sizeBytes: bytes.byteLength,
          sha256: sha256(bytes),
        }))
          .sort((left, right) => left.proposalPath.localeCompare(right.proposalPath, 'en')),
      };
      files.set('review-candidate.json', w09ProposalJson(reviewCandidate));
    }
    const proposalIdentitySha256 = sha256(w09ProposalJson({
      sourceRevision: resolved.request.sourceRevision,
      releaseId,
      compositionLockSha256: sha256(w09ProposalJson(lock)),
    }));
    const proposalDirectory = path.join(absoluteWebRoot, 'content/contracts/w09/proposals', proposalIdentitySha256);
    const persisted = await writeW09ProposalDirectory(proposalDirectory, files);
    return {
      status: composition ? 'proposal' : 'pending',
      releaseId,
      requestId: resolved.request.requestId,
      sourceRevision: resolved.request.sourceRevision,
      gameReleaseId: resolved.request.gameReleaseId,
      proposalDirectory: persisted.path,
      proposalWritten: true,
      reused: persisted.reused,
      selected: false,
      allocationReserved: false,
      publicationEligible: false,
      sourceReplay: proposalOnly.sourceReplay,
      ...(composition ? { gate: composition.gate, inputDigest: composition.inputDigest } : { reason: projectionError ?? 'Source archive is not formally eligible yet' }),
    };
  } finally {
    try {
      if (sourcePin) await sourcePin.cleanup();
    } finally {
      await rm(packetTemp, { recursive: true, force: true });
    }
  }
}

export async function loadW09VerifiedComposition({ repoRoot, sourceRoot, releaseId, fetchImpl = globalThis.fetch } = {}) {
  if (typeof repoRoot !== 'string' || typeof sourceRoot !== 'string') throw new Error('explicit Web repoRoot and official Source sourceRoot are required');
  if (typeof releaseId !== 'string' || !/^w09-[a-f0-9]{32}$/u.test(releaseId)) throw new Error('releaseId must be a derived W09 identity');
  const absoluteWebRoot = await realpath(repoRoot);
  assertOfficialWebOrigin(absoluteWebRoot);
  const head = gitText(absoluteWebRoot, ['rev-parse', 'HEAD']);
  const codePin = loadW09CompilerCodePin({ repoRoot: absoluteWebRoot, head });
  const selection = await loadSelectedComposition(absoluteWebRoot, head);
  if (!selection) return { status: 'pending', releaseId, reason: 'no reviewed W09 selected composition is present in tracked Web inputs' };
  const selected = selection.proposals.find(row => row.releaseId === releaseId);
  if (!selected) return { status: 'pending', releaseId, reason: 'release_id is not selected for Web composition' };
  const sourceApi = await loadPinnedSourceApi(absoluteWebRoot, head);
  const lockPath = W09_LOCK_ROOT + selected.requestId + '.json';
  const lockBytes = gitBlob(absoluteWebRoot, head, lockPath);
  const lock = parseJson(lockBytes, 'W09 composition input lock');
  const { compilerInput } = await import('./contract-w08-build.mjs').then(async w08 => ({
    compilerInput: await w08.loadW08CompilerInputs({ repoRoot: absoluteWebRoot }),
  }));
  const compilerLockRaw = gitBlob(absoluteWebRoot, head, W08_COMPILER_LOCK_PATH);
  const resolved = await sourceApi.resolvePublishedW09SourceArchive({ releaseId, fetchImpl });
  if (resolved.status !== 'verified') return { status: 'pending', releaseId, reason: resolved.reason };
  sourceApi.validateW09SourceRequest(resolved.request);
  if (resolved.request.releaseId !== selected.releaseId || resolved.request.requestId !== selected.requestId
      || resolved.request.gameReleaseId !== selected.gameReleaseId || resolved.request.manifestSha256 !== selected.manifestSha256
      || resolved.archiveSha256 !== selected.archiveSha256 || resolved.request.sourceRevision !== selection.sourceRevision) {
    throw new Error('published Source archive identity differs from the selected W09 composition');
  }
  validateW09CompositionInputLock(lock, resolved.request, { archiveSha256: resolved.archiveSha256 });
  if (lock.web.compilerCommit !== codePin.commit || lock.web.compilerFileSetSha256 !== codePin.fileSetSha256
      || lock.web.w09CompilerLockSha256 !== codePin.lockSha256) {
    throw new Error('selected W09 composition lock does not match the fixed W09 compiler code file set');
  }
  if (sha256(gitBlob(absoluteWebRoot, head, W08_INPUT_LOCK_PATH)) !== lock.web.w08InputLockSha256
      || sha256(compilerLockRaw) !== lock.web.w08CompilerLockSha256
      || compilerInput.compilerIdentity.commit !== lock.web.w08CompilerCommit
      || compilerInput.inputLock.authoringCommit !== lock.web.w08AuthoringCommit) {
    throw new Error('selected W09 composition lock does not match the verified W08 compiler baseline');
  }

  const packetTemp = await mkdtemp(path.join(os.tmpdir(), 'w09-web-source-packet-'));
  try {
    for (const filePath of SOURCE_PACKET_PATHS) {
      const bytes = resolved.files.get(filePath);
      if (!bytes) throw new Error('verified Source archive omits packet file ' + filePath);
      await writeFile(path.join(packetTemp, filePath), bytes, { flag: 'wx' });
    }
    const packet = await sourceApi.verifyW09SourcePacket({ request: resolved.request, packetDir: packetTemp });
    const replay = await sourceApi.verifyW09SourceRevision({
      request: resolved.request,
      packetDir: packetTemp,
      sourceRoot,
      expectedCommit: resolved.request.sourceCommit,
    });
    if (packet.manifest.mode !== 'formal' || resolved.request.eligibility.status !== 'eligible') {
      return { status: 'pending', releaseId, reason: 'published Source packet is not formally eligible' };
    }
    const composition = await createW09CompilerProjection({
      repoRoot: absoluteWebRoot,
      request: resolved.request,
      packet,
      replay: { ...replay, sourceRoot: await realpath(sourceRoot), providerImmutable: resolved.providerImmutable },
      lock,
      sourceApi,
    });
    return {
      ...composition,
      selectedSourceRevision: selection.sourceRevision,
      selectedProposals: selection.proposals,
      repositoryHead: head,
      lockPath,
      inputLockBytes: Buffer.from(lockBytes),
      inputLockSha256: sha256(lockBytes),
      sourceRequestArchiveBytesVerified: true,
      sourceReplay: { valid: replay.valid, sourceCommit: replay.sourceCommit, sourceRevision: replay.sourceRevision },
    };
  } finally {
    await rm(packetTemp, { recursive: true, force: true });
  }
}
