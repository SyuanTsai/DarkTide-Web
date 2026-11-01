import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildManifestPath,
  computeDataRevision,
  selectConsumerFiles,
  validateManifest,
} from './contract-release.mjs';
import {
  computeReviewDigests,
  hasVerifiedRetainedNameEvidenceMap,
  getReviewState,
  loadWebAuthoringInputs,
  validateRetainedWeaponNameForCandidate,
  validateWebAuthoring,
} from './contract-authoring.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INPUT_LOCK_PATH = 'content/contracts/w08/compiler-inputs.lock.json';
const COMPILER_LOCK_PATH = 'content/contracts/w08/compiler.lock.json';
const CANDIDATE_SCHEMA_PATH = 'content/schema/v2/shared-candidate.schema.json';
const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
const W08_DOMAIN_SCHEMA = 'w08-shared-domain/1.0.0';
const W08_CANDIDATE_SCHEMA = 'w08-shared-candidate/1.0.0';
const SHA1_RE = /^[a-f0-9]{40}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const CORE_DOMAIN_KINDS = Object.freeze(['blessings', 'skills', 'terms', 'weapons']);
const EXPECTED_COMPILER_FILES = Object.freeze([
  'content/schema/v2/shared-candidate.schema.json',
  'scripts/content/contract-authoring.mjs',
  'scripts/content/contract-release.mjs',
  'scripts/content/contract-w08-build.mjs',
  'scripts/content/retained-name-evidence.mjs',
  'scripts/content/contract-w14-history.mjs',
  'src/published/contract.mjs',
]);
const ACCEPTED_LIMITATION_KEYS = Object.freeze([
  'obtainable-ranges',
  'unresolved-hit-zone-references',
  'steam-build',
  'weapon-artwork',
]);
const LIMITATION_DETAILS = Object.freeze({
  'obtainable-ranges': { status: 'unknown', reasonCode: 'NOT_EXPOSED_BY_SOURCE' },
  'unresolved-hit-zone-references': { status: 'preserved' },
  'steam-build': { status: 'UNVERIFIED' },
  'weapon-artwork': { status: 'NOT_REVIEWED' },
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) fail(label + ' must be an object');
  return value;
}

function fail(message) {
  throw new Error(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const result = {};
    for (const key of Object.keys(value).sort(compareUtf8)) result[key] = canonicalize(value[key]);
    return result;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function jsonBytes(value) {
  return Buffer.from(JSON.stringify(canonicalize(value), null, 2) + '\n', 'utf8');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(String(left), 'utf8'), Buffer.from(String(right), 'utf8'));
}

function sourceRecordKey(value) {
  return value.gameReleaseId + '\u0000' + value.recordId;
}

function sourceRefKey(value) {
  return value.gameReleaseId + '\u0000' + value.sourceId;
}

function sourceSnapshotKey(value) {
  return value.gameReleaseId + '\u0000' + value.snapshot?.snapshotId;
}

function sourceReviewTargetKey(value) {
  return [value.gameReleaseId, value.recordId, value.fieldPath, value.dimension].join('\u0000');
}

function requireSha(value, length, label) {
  const pattern = length === 40 ? SHA1_RE : SHA256_RE;
  if (typeof value !== 'string' || !pattern.test(value)) fail(label + ' must be a lowercase SHA-' + length * 4);
}

function requireRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.startsWith('\\')
    || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes('\\') || value.includes('%')) {
    fail(label + ' must be a safe repository-relative slash path');
  }
  const parts = value.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..')) fail(label + ' contains an empty or traversal segment');
  return value;
}

function packagePathForManifestUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) fail('candidate manifest URL path must be absolute from the site root');
  const relative = value.slice(1);
  requireRelativePath(relative, 'candidate manifest package path');
  return relative;
}

function requireExactKeys(value, keys, label) {
  if (!isRecord(value)) fail(label + ' must be an object');
  const allowed = new Set(keys);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(label + ' is missing ' + key);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(label + ' has unexpected property ' + key);
}

function parseJson(bytes, label) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    fail(label + ' is not valid UTF-8 JSON: invalid byte sequence');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) fail(label + ' is not valid UTF-8 JSON: ' + error.message);
    throw error;
  }
  if (!isRecord(value)) fail(label + ' must contain a JSON object');
  return value;
}

async function lstatRegular(pathname, label) {
  let info;
  try {
    info = await lstat(pathname);
  } catch (error) {
    if (error?.code === 'ENOENT') fail(label + ' is missing');
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) fail(label + ' must be a regular file without a symlink');
  return info;
}

async function lstatDirectory(pathname, label) {
  let info;
  try {
    info = await lstat(pathname);
  } catch (error) {
    if (error?.code === 'ENOENT') fail(label + ' is missing');
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) fail(label + ' must be a real directory without a symlink');
  return info;
}

async function readPinnedFile(root, relativePath, expected, label) {
  requireRelativePath(relativePath, label + ' path');
  const absolute = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, absolute);
  if (relative === '' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail(label + ' escapes its root');
  const rootReal = await realpath(root);
  const absoluteParent = path.dirname(absolute);
  const parentRelative = path.relative(rootReal, absoluteParent);
  let cursor = rootReal;
  if (parentRelative && parentRelative !== '.') {
    for (const segment of parentRelative.split(path.sep)) {
      cursor = path.join(cursor, segment);
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) fail(label + ' path contains a symlink or non-directory parent');
    }
  }
  const info = await lstatRegular(absolute, label);
  const bytes = await readFile(absolute);
  if (expected) {
    if (bytes.byteLength !== expected.sizeBytes) fail(label + ' size does not match its pin');
    if (sha256(bytes) !== expected.sha256) fail(label + ' SHA-256 does not match its pin');
  }
  return { bytes, absolute, sizeBytes: info.size, sha256: sha256(bytes) };
}

function optionalGitBlob(repoRoot, commit, relativePath) {
  try {
    execFileSync('git', ['-C', repoRoot, 'cat-file', '-e', commit + '^{commit}'], { stdio: 'ignore' });
  } catch {
    return null;
  }
  try {
    return execFileSync('git', ['-C', repoRoot, 'show', commit + ':' + relativePath], { encoding: null, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    fail('pinned Git commit is present but cannot read ' + relativePath + ': ' + error.message);
  }
}

function verifyCompilerLockShape(lock) {
  requireExactKeys(lock, ['schemaVersion', 'commit', 'files'], 'W08 compiler lock');
  if (lock.schemaVersion !== 'w08-compiler/1') fail('W08 compiler lock schemaVersion is unsupported');
  requireSha(lock.commit, 40, 'W08 compiler lock commit');
  if (!Array.isArray(lock.files)) fail('W08 compiler lock files must be an array');
  const rows = new Map();
  for (const [index, row] of lock.files.entries()) {
    requireExactKeys(row, ['path', 'sizeBytes', 'sha256'], 'W08 compiler lock files[' + index + ']');
    requireRelativePath(row.path, 'W08 compiler file path');
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1) fail('W08 compiler file size must be a positive safe integer');
    requireSha(row.sha256, 64, 'W08 compiler file hash');
    if (rows.has(row.path)) fail('W08 compiler lock duplicates a file path: ' + row.path);
    rows.set(row.path, row);
  }
  if (rows.size !== EXPECTED_COMPILER_FILES.length || EXPECTED_COMPILER_FILES.some(file => !rows.has(file))) {
    fail('W08 compiler lock must pin exactly the compiler, candidate schema, and their direct contract modules');
  }
  return rows;
}

function verifyInputLockShape(lock) {
  requireExactKeys(lock, ['schemaVersion', 'authoringCommit', 'gameReleaseId', 'proposedContentVersion', 'source', 'authoringModes', 'inputFiles'], 'W08 compiler input lock');
  if (lock.schemaVersion !== 'w08-compiler-inputs/1') fail('W08 compiler input lock schemaVersion is unsupported');
  requireSha(lock.authoringCommit, 40, 'W08 authoring commit');
  if (lock.gameReleaseId !== 'darktide:1.13.2') fail('W08 compiler input lock must pin the reviewed game release');
  if (lock.proposedContentVersion !== '1.13.2.1') fail('W08 compiler input lock proposed version differs from the reviewed candidate');
  if (canonicalJson(lock.authoringModes) !== canonicalJson(['w06', 'w07'])) fail('W08 compiler input lock must include exactly W06 and W07 authoring modes');
  requireExactKeys(lock.source, ['repository', 'commit', 'sourceRevision', 'manifestSha256', 'root', 'files'], 'W08 Source candidate pin');
  if (lock.source.repository !== SOURCE_REPOSITORY) fail('W08 Source candidate repository is not the pinned public repository');
  requireSha(lock.source.commit, 40, 'W08 Source commit');
  requireSha(lock.source.sourceRevision, 64, 'W08 Source revision');
  requireSha(lock.source.manifestSha256, 64, 'W08 Source manifest hash');
  requireRelativePath(lock.source.root, 'W08 Source candidate root');
  const expectedSourceFiles = ['analysis.md', 'source-manifest.json', 'source-receipt.json', 'source-revision.json', 'source-revision.md', 'technical.json'];
  if (!Array.isArray(lock.source.files) || canonicalJson(lock.source.files.map(row => row.path).sort(compareUtf8)) !== canonicalJson(expectedSourceFiles)) {
    fail('W08 Source candidate lock must pin the fixed six-file build artifact');
  }
  const verifyRows = (rows, label) => {
    if (!Array.isArray(rows) || rows.length === 0) fail(label + ' must be a nonempty array');
    const seen = new Set();
    for (const [index, row] of rows.entries()) {
      requireExactKeys(row, ['path', 'sizeBytes', 'sha256'], label + '[' + index + ']');
      requireRelativePath(row.path, label + ' path');
      if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1) fail(label + ' sizeBytes must be positive');
      requireSha(row.sha256, 64, label + ' sha256');
      if (seen.has(row.path)) fail(label + ' has a duplicate path: ' + row.path);
      seen.add(row.path);
    }
  };
  verifyRows(lock.source.files, 'W08 Source files');
  verifyRows(lock.inputFiles, 'W08 input files');
  return lock;
}

async function verifyCompilerFiles(repoRoot, compilerLock) {
  const pinned = verifyCompilerLockShape(compilerLock);
  let gitHistoryAvailable = true;
  for (const relativePath of EXPECTED_COMPILER_FILES) {
    const row = pinned.get(relativePath);
    const current = await readPinnedFile(repoRoot, relativePath, row, 'W08 compiler dependency ' + relativePath);
    const committed = optionalGitBlob(repoRoot, compilerLock.commit, relativePath);
    if (committed === null) gitHistoryAvailable = false;
    else if (committed.byteLength !== row.sizeBytes || sha256(committed) !== row.sha256) {
      fail('W08 compiler provenance commit blob differs from its locked bytes: ' + relativePath);
    }
    if (current.sha256 !== row.sha256) fail('W08 compiler working bytes differ from the immutable compiler lock: ' + relativePath);
  }
  return { compilerCommit: compilerLock.commit, compilerFiles: [...pinned.values()], gitHistoryAvailable };
}

export async function verifyW08CompilerFiles(repoRoot, compilerLock) {
  if (typeof repoRoot !== 'string' || !repoRoot) fail('W08 compiler verification requires a repository root');
  return verifyCompilerFiles(path.resolve(repoRoot), compilerLock);
}

function requireCanonicalMapRows(leftRows, rightRows, keyOf, label, { subset = false } = {}) {
  if (!Array.isArray(leftRows) || !Array.isArray(rightRows)) fail(label + ' rows must be arrays');
  const right = new Map();
  for (const row of rightRows) {
    const key = keyOf(row);
    if (right.has(key)) fail(label + ' contains a duplicate identity in the superset: ' + key);
    right.set(key, row);
  }
  const seen = new Set();
  for (const row of leftRows) {
    const key = keyOf(row);
    if (seen.has(key)) fail(label + ' contains a duplicate identity: ' + key);
    seen.add(key);
    const target = right.get(key);
    if (!target) {
      if (subset) fail(label + ' contains an identity absent from the W07 superset: ' + key);
      continue;
    }
    if (canonicalJson(row) !== canonicalJson(target)) fail(label + ' has conflicting immutable content for ' + key);
  }
  if (!subset && seen.size !== right.size) fail(label + ' identity sets differ');
  return right;
}

function verifySourceOverlap(w06Source, w07Source, sourceCandidate) {
  requireCanonicalMapRows(w06Source.records, w07Source.records, sourceRecordKey, 'W06/W07 Source records', { subset: true });
  requireCanonicalMapRows(w06Source.sourceRefs, w07Source.sourceRefs, sourceRefKey, 'W06/W07 Source refs', { subset: true });
  requireCanonicalMapRows(w06Source.gameReleases, w07Source.gameReleases, row => row.gameReleaseId, 'W06/W07 game releases');
  requireCanonicalMapRows(w06Source.sourceSnapshots ?? [], w07Source.sourceSnapshots ?? [], sourceSnapshotKey, 'W06/W07 source snapshots', { subset: true });
  requireCanonicalMapRows(w07Source.records, sourceCandidate.records, sourceRecordKey, 'W07/Source candidate records');
  requireCanonicalMapRows(w07Source.sourceRefs, sourceCandidate.sourceRefs, sourceRefKey, 'W07/Source candidate refs');
  requireCanonicalMapRows(w07Source.gameReleases, sourceCandidate.gameReleases, row => row.gameReleaseId, 'W07/Source candidate game releases');
  requireCanonicalMapRows(w07Source.sourceSnapshots ?? [], sourceCandidate.sourceSnapshots ?? [], sourceSnapshotKey, 'W07/Source candidate snapshots', { subset: true });
  requireCanonicalMapRows(w07Source.tombstones ?? [], sourceCandidate.tombstones ?? [], row => row.gameReleaseId + '\u0000' + row.recordId, 'W07/Source candidate tombstones');
}

function parseSourceCandidateArtifacts(sourceFiles, sourcePin) {
  const byName = new Map(sourceFiles.map(file => [file.path, file.bytes]));
  const manifestBytes = byName.get('source-manifest.json');
  const manifest = parseJson(manifestBytes, 'Source candidate source-manifest.json');
  if (sha256(manifestBytes) !== sourcePin.manifestSha256) fail('Source candidate manifest hash differs from compiler-inputs lock');
  if (manifest.schema !== 'w05-source-manifest/1' || manifest.mode !== 'candidate' || manifest.sourceRevision !== sourcePin.sourceRevision) {
    fail('Source candidate manifest does not identify the pinned candidate revision');
  }
  if (manifest.buildIdentity?.verified !== false) fail('Source candidate must retain buildIdentity.verified=false');
  if (!Array.isArray(manifest.files)) fail('Source candidate manifest files must be an array');
  const actualRows = new Map(sourceFiles.map(file => [file.path, file]));
  const declaredRows = new Map(manifest.files.map(file => [file.path, file]));
  if (declaredRows.size !== manifest.files.length) fail('Source candidate manifest has duplicate file paths');
  for (const [name, row] of declaredRows) {
    const actual = actualRows.get(name);
    if (!actual || actual.sha256 !== row.sha256 || actual.sizeBytes !== row.sizeBytes) fail('Source candidate manifest file bytes differ: ' + name);
  }
  for (const name of ['analysis.md', 'source-revision.json', 'source-revision.md', 'technical.json']) {
    if (!declaredRows.has(name)) fail('Source candidate manifest omits ' + name);
  }
  const receipt = parseJson(byName.get('source-receipt.json'), 'Source candidate source-receipt.json');
  if (receipt.schema !== 'w05-source-build-receipt/1' || receipt.mode !== 'candidate' || receipt.previewOnly !== true
    || receipt.publicationEligible !== false || receipt.buildIdentityVerified !== false
    || receipt.sourceRevision !== sourcePin.sourceRevision || receipt.manifestSha256 !== sourcePin.manifestSha256
    || receipt.validation?.result !== 'valid' || receipt.validation?.publicationEligible !== false) {
    fail('Source candidate receipt is not the fixed non-publishable validated candidate');
  }
  const revision = parseJson(byName.get('source-revision.json'), 'Source candidate source-revision.json');
  if (revision.schema !== 'w05-source-revision/2' || revision.mode !== 'candidate' || revision.sourceRevision !== sourcePin.sourceRevision) {
    fail('Source candidate revision record differs from its pin');
  }
  const technical = parseJson(byName.get('technical.json'), 'Source candidate technical.json');
  if (technical.fixtureOnly !== false || technical.publicationEligible !== false) fail('Source candidate technical contract must be non-fixture and non-publishable');
  return { manifest, receipt, revision, technical };
}

async function loadVerifiedW08CompilerInputs({ repoRoot = REPO_ROOT, retainedNameRoots = null } = {}) {
  const absoluteRoot = await realpath(repoRoot);
  const inputLockFile = await readPinnedFile(absoluteRoot, INPUT_LOCK_PATH, null, 'W08 compiler input lock');
  const inputLock = verifyInputLockShape(parseJson(inputLockFile.bytes, INPUT_LOCK_PATH));
  const compilerLockFile = await readPinnedFile(absoluteRoot, COMPILER_LOCK_PATH, null, 'W08 compiler lock');
  const compilerLock = parseJson(compilerLockFile.bytes, COMPILER_LOCK_PATH);
  const compiler = await verifyW08CompilerFiles(absoluteRoot, compilerLock);

  for (const row of inputLock.inputFiles) {
    const pinned = await readPinnedFile(absoluteRoot, row.path, row, 'W08 input ' + row.path);
    const committed = optionalGitBlob(absoluteRoot, inputLock.authoringCommit, row.path);
    if (committed !== null && (committed.byteLength !== row.sizeBytes || sha256(committed) !== row.sha256)) {
      fail('W08 input authoring commit blob differs from its lock: ' + row.path);
    }
  }

  const sourceRoot = path.resolve(absoluteRoot, ...inputLock.source.root.split('/'));
  const sourceRootRelative = path.relative(absoluteRoot, sourceRoot);
  if (sourceRootRelative === '' || sourceRootRelative.startsWith('..' + path.sep) || path.isAbsolute(sourceRootRelative)) {
    fail('W08 Source candidate root escapes the Web repository');
  }
  await ensureNoSymlinkAncestors(sourceRoot);
  await lstatDirectory(sourceRoot, 'W08 Source candidate root');
  const sourceFiles = [];
  for (const row of inputLock.source.files) {
    const file = await readPinnedFile(sourceRoot, row.path, row, 'W08 Source cache ' + row.path);
    sourceFiles.push({ path: row.path, sizeBytes: file.sizeBytes, sha256: file.sha256, bytes: file.bytes });
  }
  const sourceArtifacts = parseSourceCandidateArtifacts(sourceFiles, inputLock.source);

  const [w06, w07] = await Promise.all([
    loadWebAuthoringInputs({ repoRoot: absoluteRoot, mode: 'w06' }),
    loadWebAuthoringInputs({ repoRoot: absoluteRoot, mode: 'w07', ...(retainedNameRoots ? { retainedNameRoots } : {}) }),
  ]);
  for (const inputs of [w06, w07]) {
    const validation = validateWebAuthoring(inputs.authoring, inputs);
    if (!validation.valid) fail(inputs.mode.toUpperCase() + ' authoring validation failed: ' + validation.issues.map(issue => issue.path + ' ' + issue.message).join('; '));
    inputs.webValidation = validation;
  }
  const sourceValidation = w07.sourceValidator.validateSourceContract(sourceArtifacts.technical, { schema: w07.sourceSchema });
  if (!sourceValidation.valid) fail('Source candidate technical contract failed pinned W07 Source validation: ' + sourceValidation.issues.map(issue => issue.path + ' ' + issue.message).join('; '));
  verifySourceOverlap(w06.sourceContract, w07.sourceContract, sourceArtifacts.technical);

  return {
    repoRoot: absoluteRoot,
    compilerIdentity: {
      commit: compiler.compilerCommit,
      files: compiler.compilerFiles,
      inputLockSha256: inputLockFile.sha256,
      authoringCommit: inputLock.authoringCommit,
      gitHistoryAvailable: compiler.gitHistoryAvailable,
    },
    sourceContract: sourceArtifacts.technical,
    sourceBuild: {
      repository: inputLock.source.repository,
      commit: inputLock.source.commit,
      sourceRevision: inputLock.source.sourceRevision,
      manifestSha256: inputLock.source.manifestSha256,
      mode: sourceArtifacts.manifest.mode,
      buildIdentityVerified: sourceArtifacts.receipt.buildIdentityVerified,
      publicationEligible: sourceArtifacts.receipt.publicationEligible,
      receiptSha256: sourceArtifacts.receipt.receiptSha256,
    },
    gameReleaseId: inputLock.gameReleaseId,
    proposedContentVersion: inputLock.proposedContentVersion,
    webIdentity: {
      authoringCommit: inputLock.authoringCommit,
      compilerCommit: compiler.compilerCommit,
      inputLockSha256: inputLockFile.sha256,
    },
    w06,
    w07,
    inputLock,
    sourceCache: sourceFiles.map(({ path: filePath, sizeBytes, sha256: digest }) => ({ path: filePath, sizeBytes, sha256: digest })),
  };
}

export async function loadW08CompilerInputs(options = {}) {
  return loadVerifiedW08CompilerInputs(options);
}

export async function buildW08CandidateFromRepository(options = {}) {
  const input = await loadVerifiedW08CompilerInputs(options);
  return compileW08Candidate(input);
}

function collectTypedRecordPointers(value, pointers = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectTypedRecordPointers(item, pointers);
    return pointers;
  }
  if (!isRecord(value)) return pointers;
  if (typeof value.recordId === 'string' && typeof value.gameReleaseId === 'string') pointers.push(value);
  for (const child of Object.values(value)) collectTypedRecordPointers(child, pointers);
  return pointers;
}

function collectSourcePointers(value, pointers = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectSourcePointers(item, pointers);
    return pointers;
  }
  if (!isRecord(value)) return pointers;
  if (typeof value.sourceId === 'string' && typeof value.gameReleaseId === 'string') pointers.push(value);
  for (const child of Object.values(value)) collectSourcePointers(child, pointers);
  return pointers;
}

function recordClosure(seedRecords, sourceContract) {
  const all = new Map(sourceContract.records.map(record => [sourceRecordKey(record), record]));
  const selected = new Map();
  const queue = [...seedRecords];
  while (queue.length) {
    const record = queue.pop();
    const key = sourceRecordKey(record);
    if (selected.has(key)) continue;
    const canonicalRecord = all.get(key);
    if (!canonicalRecord || canonicalJson(canonicalRecord) !== canonicalJson(record)) fail('domain seed is not an exact Source-owned record: ' + key.replace('\u0000', ':'));
    selected.set(key, canonicalRecord);
    for (const ref of collectTypedRecordPointers(canonicalRecord)) {
      const target = all.get(sourceRecordKey(ref));
      if (!target) fail('Source typed reference is unresolved: ' + ref.gameReleaseId + ':' + ref.recordId);
      if (ref.kind && ref.kind !== target.kind) fail('Source typed reference kind conflicts for ' + ref.recordId);
      queue.push(target);
    }
  }
  return [...selected.values()].sort((left, right) => compareUtf8(sourceRecordKey(left), sourceRecordKey(right)));
}

function sourceRegistryForRecords(records, sourceContract, releaseId, additionalSourcePointers = [], additionalGameReleaseIds = []) {
  const sourceRefMap = new Map(sourceContract.sourceRefs.map(ref => [sourceRefKey(ref), ref]));
  const selectedSourceRefs = new Map();
  const sourceSnapshotIds = new Set();
  const releaseIds = new Set([releaseId]);
  const comparisonSnapshotIds = new Set();
  const knownReleases = new Map(sourceContract.gameReleases.map(release => [release.gameReleaseId, release]));
  const includeComparisonRelease = (comparisonReleaseId, snapshotId = null) => {
    if (typeof comparisonReleaseId !== 'string' || !knownReleases.has(comparisonReleaseId)) {
      fail('comparison references an unknown Source game release: ' + String(comparisonReleaseId));
    }
    releaseIds.add(comparisonReleaseId);
    if (snapshotId !== null) {
      if (typeof snapshotId !== 'string' || snapshotId.length === 0) fail('comparison snapshot identity is invalid for ' + comparisonReleaseId);
      comparisonSnapshotIds.add(comparisonReleaseId + '\u0000' + snapshotId);
    }
  };
  for (const record of records) {
    releaseIds.add(record.gameReleaseId);
    if (record.kind === 'game-change') {
      const comparison = record.payload?.comparison;
      if (!isRecord(comparison)) fail('Source game-change record has no comparison release identity: ' + record.recordId);
      includeComparisonRelease(comparison.fromGameReleaseId, comparison.fromSnapshotId);
      includeComparisonRelease(comparison.toGameReleaseId, comparison.toSnapshotId);
    }
  }
  for (const comparisonReleaseId of additionalGameReleaseIds) {
    includeComparisonRelease(comparisonReleaseId);
  }
  for (const ref of [...collectSourcePointers(records), ...additionalSourcePointers]) {
      const found = sourceRefMap.get(sourceRefKey(ref));
      if (!found) fail('Source provenance reference is unresolved: ' + ref.gameReleaseId + ':' + ref.sourceId);
      if (ref.snapshot && found.snapshot && canonicalJson(ref.snapshot) !== canonicalJson(found.snapshot)) fail('Source provenance snapshot identity conflicts for ' + ref.sourceId);
      selectedSourceRefs.set(sourceRefKey(found), found);
      releaseIds.add(found.gameReleaseId);
      if (found.snapshot?.snapshotId) sourceSnapshotIds.add(found.gameReleaseId + '\u0000' + found.snapshot.snapshotId);
  }
  const releases = sourceContract.gameReleases.filter(release => releaseIds.has(release.gameReleaseId));
  for (const release of releases) if (release.snapshot?.snapshotId) sourceSnapshotIds.add(release.gameReleaseId + '\u0000' + release.snapshot.snapshotId);
  for (const key of comparisonSnapshotIds) sourceSnapshotIds.add(key);
  const snapshots = (sourceContract.sourceSnapshots ?? []).filter(snapshot => releaseIds.has(snapshot.gameReleaseId)
    && sourceSnapshotIds.has(sourceSnapshotKey(snapshot)));
  const snapshotKeys = new Set(snapshots.map(sourceSnapshotKey));
  for (const key of sourceSnapshotIds) {
    if (!releases.some(release => release.gameReleaseId + '\u0000' + release.snapshot?.snapshotId === key) && !snapshotKeys.has(key)) {
      fail('Source snapshot reference is unresolved: ' + key.replace('\u0000', ':'));
    }
  }
  const tombstones = (sourceContract.tombstones ?? []).filter(item => releaseIds.has(item.gameReleaseId));
  const recordIds = new Set(records.map(record => sourceRecordKey(record)));
  const selectedTargets = new Set(records.flatMap(record => (record.reviewTargets ?? []).map(target => sourceReviewTargetKey({
    gameReleaseId: record.gameReleaseId,
    recordId: record.recordId,
    fieldPath: target.fieldPath,
    dimension: target.dimension,
  }))));
  const sourceReceipts = (sourceContract.reviewReceipts ?? []).filter(receipt =>
    isRecord(receipt.target) && selectedTargets.has(sourceReviewTargetKey(receipt.target)));
  return {
    repository: SOURCE_REPOSITORY,
    gameReleases: releases.sort((left, right) => compareUtf8(left.gameReleaseId, right.gameReleaseId)),
    sourceSnapshots: snapshots.sort((left, right) => compareUtf8(sourceSnapshotKey(left), sourceSnapshotKey(right))),
    sourceRefs: [...selectedSourceRefs.values()].sort((left, right) => compareUtf8(sourceRefKey(left), sourceRefKey(right))),
    records,
    tombstones,
    reviewReceipts: sourceReceipts,
  };
}

function collectOfficialSourceIds(value, result = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectOfficialSourceIds(item, result);
    return result;
  }
  if (!isRecord(value)) return result;
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'officialSourceId' || key.endsWith('OfficialSourceId')) && typeof child === 'string') result.add(child);
    collectOfficialSourceIds(child, result);
  }
  return result;
}

function collectAssetRefs(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectAssetRefs(item, result);
    return result;
  }
  if (!isRecord(value)) return result;
  if (isRecord(value.assetRef) && typeof value.assetRef.assetId === 'string') result.push(value.assetRef.assetId);
  for (const child of Object.values(value)) collectAssetRefs(child, result);
  return result;
}

function targetState(mode, target) {
  if (mode.sourceRecordMap && mode.sourceContract && mode.officialInputs) {
    return getReviewState(mode.authoring, target.targetId, mode);
  }
  const explicit = mode.reviewStates?.[target.targetId];
  if (['approved', 'pending', 'stale', 'rejected'].includes(explicit)) return explicit;
  return 'pending';
}

function reviewRow(mode, modeName, target) {
  let targetDigest = null;
  let dependenciesDigest = null;
  if (mode.sourceRecordMap && mode.sourceContract && mode.officialInputs) {
    const digests = computeReviewDigests(mode.authoring, target, mode);
    targetDigest = digests.targetDigest;
    dependenciesDigest = digests.dependenciesDigest;
  }
  return {
    mode: modeName,
    target: structuredClone(target),
    state: targetState(mode, target),
    targetDigest,
    dependenciesDigest,
  };
}

function stateCounts(rows) {
  const result = { approved: 0, pending: 0, stale: 0, rejected: 0 };
  for (const row of rows) {
    const state = row.state;
    if (!Object.hasOwn(result, state)) fail('review target has an invalid state: ' + String(state));
    result[state] += 1;
  }
  return result;
}

function isApprovalReceiptForTarget(row, receiptRow) {
  const receiptRows = receiptRow.filter(item => {
    if (!isRecord(item) || item.mode !== row.mode || !isRecord(item.receipt)) return false;
    const receipt = item.receipt;
    const sameTarget = row.mode === 'source'
      ? isRecord(receipt.target) && sourceReviewTargetKey(receipt.target) === sourceReviewTargetKey(row)
      : isRecord(row.target) && receipt.targetId === row.target.targetId;
    return sameTarget && receipt.targetDigest === row.targetDigest && receipt.dependenciesDigest === row.dependenciesDigest;
  });
  if (receiptRows.length === 0 || !/^[a-f0-9]{64}$/.test(row.targetDigest ?? '') || !/^[a-f0-9]{64}$/.test(row.dependenciesDigest ?? '')) return false;
  for (const { receipt } of receiptRows) {
    if (!['approved', 'rejected'].includes(receipt.decision) || !isRecord(receipt.reviewer) || receipt.reviewer.kind !== 'human'
      || typeof receipt.reviewer.id !== 'string' || receipt.reviewer.id.trim() === ''
      || !isValidW08UtcTimestamp(receipt.reviewedAt)) return false;
  }
  let latest = [];
  for (const { receipt } of receiptRows) {
    if (latest.length === 0) {
      latest = [receipt];
      continue;
    }
    const order = compareW08UtcInstants(receipt.reviewedAt, latest[0].reviewedAt);
    if (order > 0) latest = [receipt];
    else if (order === 0) latest.push(receipt);
  }
  const decisions = new Set(latest.map(receipt => receipt.decision));
  return decisions.size === 1 && decisions.has('approved');
}

function isValidW08UtcTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.([0-9]+))?Z$/);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return false;
  return Number.isFinite(Date.parse(match[1] + '-' + match[2] + '-' + match[3] + 'T' + match[4] + ':' + match[5] + ':' + match[6] + 'Z'));
}

function compareW08UtcInstants(left, right) {
  const leftParts = left.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.([0-9]+))?Z$/);
  const rightParts = right.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.([0-9]+))?Z$/);
  if (!leftParts || !rightParts) return compareUtf8(left, right);
  const leftWholeSecond = Date.parse(leftParts[1] + 'Z');
  const rightWholeSecond = Date.parse(rightParts[1] + 'Z');
  if (!Number.isFinite(leftWholeSecond) || !Number.isFinite(rightWholeSecond)) return compareUtf8(left, right);
  if (leftWholeSecond !== rightWholeSecond) return leftWholeSecond < rightWholeSecond ? -1 : 1;
  const leftFraction = (leftParts[2] ?? '').replace(/0+$/, '');
  const rightFraction = (rightParts[2] ?? '').replace(/0+$/, '');
  const length = Math.max(leftFraction.length, rightFraction.length);
  for (let index = 0; index < length; index += 1) {
    const leftDigit = leftFraction[index] ?? '0';
    const rightDigit = rightFraction[index] ?? '0';
    if (leftDigit !== rightDigit) return leftDigit < rightDigit ? -1 : 1;
  }
  return 0;
}

export function evaluateW08PublicationGate({ sourceBuild, review, requiredContent = [] }) {
  const blockers = [];
  if (sourceBuild?.buildIdentityVerified !== true) blockers.push('source-build-identity-unverified');
  if (sourceBuild?.publicationEligible !== true) blockers.push('source-build-not-publication-eligible');
  const hasTargetRows = isRecord(review) && Array.isArray(review.targets) && Array.isArray(review.sourceTargets);
  const webTargets = hasTargetRows ? review.targets : [];
  const sourceTargets = hasTargetRows ? review.sourceTargets : [];
  const allTargets = [...webTargets, ...sourceTargets];
  if (!hasTargetRows || allTargets.length === 0) blockers.push('review-target-coverage-missing');
  const counts = stateCounts(allTargets);
  if (!isRecord(review?.states)) blockers.push('review-state-counts-missing');
  else if (canonicalJson(review.states) !== canonicalJson(counts)) blockers.push('review-state-counts-mismatch');
  const expectedCounts = {
    targetCount: allTargets.length,
    webTargetCount: webTargets.length,
    sourceTargetCount: sourceTargets.length,
  };
  for (const [field, actual] of Object.entries(expectedCounts)) {
    if (review?.[field] !== actual) blockers.push('review-coverage-count-mismatch');
  }
  if (!Number.isSafeInteger(review?.receiptCount) || !Array.isArray(review?.receipts) || review.receiptCount !== review.receipts.length) {
    blockers.push('review-receipt-count-mismatch');
  }
  const receipts = Array.isArray(review?.receipts) ? review.receipts : [];
  if (allTargets.some(row => row.state === 'approved' && !isApprovalReceiptForTarget(row, receipts))) {
    blockers.push('approved-review-target-lacks-matching-receipt');
  }
  if (counts.rejected > 0) blockers.push('review-target-rejected');
  if (counts.stale > 0) blockers.push('review-target-stale');
  if (counts.pending > 0) blockers.push('review-target-pending');
  for (const item of Array.isArray(requiredContent) ? requiredContent : []) {
    if (item.present !== true) blockers.push('required-zh-tw-content-missing:' + item.id);
  }
  return {
    status: blockers.length ? 'blocked' : 'ready-for-release-allocation',
    publicationEligible: false,
    blockers: [...new Set(blockers)].sort(compareUtf8),
  };
}

function makeDomainDocument({ kind, releaseId, sourceContract, sourceRecords, modeRows, termRules = null }) {
  const presentations = modeRows.flatMap(({ mode }) => mode.authoring.presentations.filter(item => item.entityRef.gameReleaseId === releaseId
    && ((kind === 'skills' && item.entityRef.kind === 'skill') || (kind === 'blessings' && item.entityRef.kind === 'blessing')
      || (kind === 'weapons' && item.entityRef.kind === 'weapon'))));
  const termLocalizations = kind === 'terms'
    ? modeRows.flatMap(({ mode }) => mode.authoring.termLocalizations ?? []).filter(item => item.termRef?.gameReleaseId === releaseId)
    : [];
  const announcements = kind === 'announcements'
    ? modeRows.flatMap(({ mode }) => mode.authoring.announcements ?? [])
    : [];
  const gameChanges = kind === 'game-changes'
    ? modeRows.flatMap(({ mode }) => mode.authoring.gameChanges ?? [])
    : [];
  const officialTextChanges = kind === 'game-changes'
    ? modeRows.flatMap(({ mode }) => mode.authoring.officialTextChanges ?? [])
    : [];
  const webItems = [...presentations, ...termLocalizations, ...announcements, ...gameChanges, ...officialTextChanges];
  const comparisonReleaseIds = officialTextChanges.flatMap(change => [change.fromGameReleaseId, change.toGameReleaseId]);
  const source = sourceRegistryForRecords(sourceRecords, sourceContract, releaseId, collectSourcePointers(webItems), comparisonReleaseIds);
  const ownerIds = new Set([
    ...presentations.flatMap(item => [item.authoringId, item.entityRef.recordId]),
    ...termLocalizations.map(item => item.authoringId),
    ...announcements.map(item => item.announcementId),
    ...gameChanges.map(item => item.changeId),
    ...officialTextChanges.map(item => item.changeId),
  ]);
  const reviewRows = modeRows.flatMap(({ mode, name }) => (mode.authoring.reviewTargets ?? [])
    .filter(target => ownerIds.has(target.ownerId)).map(target => reviewRow(mode, name, target)))
    .sort((left, right) => compareUtf8(left.mode + '\u0000' + left.target.targetId, right.mode + '\u0000' + right.target.targetId));
  const reviewIds = new Set(reviewRows.map(row => row.target.targetId));
  const reviewReceipts = modeRows.flatMap(({ mode, name }) => (mode.authoring.reviewReceipts ?? [])
    .filter(receipt => reviewIds.has(receipt.targetId)).map(receipt => ({ mode: name, receipt: structuredClone(receipt) })));
  const officialSources = [];
  const referencedOfficialSources = collectOfficialSourceIds(webItems);
  for (const { mode } of modeRows) {
    for (const source of mode.officialInputs?.sources ?? []) if (referencedOfficialSources.has(source.officialSourceId)) officialSources.push(source);
  }
  const uniqueOfficialSources = new Map();
  for (const source of officialSources) {
    const prior = uniqueOfficialSources.get(source.officialSourceId);
    if (prior && canonicalJson(prior) !== canonicalJson(source)) fail('official source identity has conflicting content: ' + source.officialSourceId);
    uniqueOfficialSources.set(source.officialSourceId, source);
  }
  const document = {
    schemaVersion: W08_DOMAIN_SCHEMA,
    kind,
    gameReleaseId: releaseId,
    source,
    web: {
      presentations,
      officialInputs: { sources: [...uniqueOfficialSources.values()].sort((left, right) => compareUtf8(left.officialSourceId, right.officialSourceId)) },
      termLocalizations,
      ...(termRules ? { termRules: structuredClone(termRules) } : {}),
      announcements,
      gameChanges,
      officialTextChanges,
      reviewTargets: reviewRows,
      reviewReceipts,
    },
  };
  return canonicalize(document);
}

function makeRegistryDomainSeeds(kind, sourceContract, releaseId, webRows) {
  const seeds = [];
  const addKind = recordKind => seeds.push(...sourceContract.records.filter(record => record.kind === recordKind && record.gameReleaseId === releaseId));
  if (kind === 'skills') addKind('skill');
  else if (kind === 'blessings') addKind('blessing');
  else if (kind === 'weapons') addKind('weapon');
  else if (kind === 'terms') addKind('term');
  if (kind === 'weapons') addKind('armor-class');
  if (CORE_DOMAIN_KINDS.includes(kind)) {
    seeds.push(...sourceContract.records.filter(record => record.kind === 'release-compatibility'
      && (record.gameReleaseId === releaseId || record.payload?.toGameReleaseId === releaseId)));
  }
  const presentationKind = kind === 'skills' ? 'skill' : kind === 'blessings' ? 'blessing' : kind === 'weapons' ? 'weapon' : null;
  for (const { mode } of webRows) {
    const authored = kind === 'announcements'
      ? [...(mode.authoring.announcements ?? [])]
      : kind === 'game-changes'
        ? [...(mode.authoring.gameChanges ?? []), ...(mode.authoring.officialTextChanges ?? [])]
        : kind === 'terms'
          ? [...(mode.authoring.termLocalizations ?? [])].filter(item => item.termRef?.gameReleaseId === releaseId)
          : [...(mode.authoring.presentations ?? [])].filter(item => item.entityRef?.gameReleaseId === releaseId && item.entityRef.kind === presentationKind);
    for (const item of authored) {
      for (const ref of collectTypedRecordPointers(item)) {
        const record = sourceContract.records.find(row => sourceRecordKey(row) === sourceRecordKey(ref));
        if (!record) fail('Web authoring typed reference is unresolved: ' + ref.gameReleaseId + ':' + ref.recordId);
        if (ref.kind && ref.kind !== record.kind) fail('Web authoring typed reference kind conflicts: ' + ref.recordId);
        seeds.push(record);
      }
    }
  }
  if (!seeds.length && kind === 'terms') fail('terms domain has no Source term record');
  if (!seeds.length && ['skills', 'blessings', 'weapons'].includes(kind)) fail(kind + ' domain has no Source-owned records');
  return recordClosure(seeds, sourceContract);
}

function assertModeShape(mode, name) {
  if (!isRecord(mode) || !isRecord(mode.authoring) || !Array.isArray(mode.authoring.presentations)
    || !Array.isArray(mode.authoring.termLocalizations) || !Array.isArray(mode.authoring.announcements)
    || !Array.isArray(mode.authoring.gameChanges) || !Array.isArray(mode.authoring.officialTextChanges)
    || !Array.isArray(mode.authoring.reviewTargets) || !Array.isArray(mode.authoring.reviewReceipts)) {
    fail(name + ' authoring input is incomplete');
  }
  if (!isRecord(mode.officialInputs) || !Array.isArray(mode.officialInputs.sources)) fail(name + ' official inputs are incomplete');
}

function collectWebContentRows(domainDocuments, sourceContract) {
  const documents = [...domainDocuments];
  const localizedSubjects = collectLocalizedSubjectWeb(documents.map(document => document.web));
  return documents.flatMap(document => collectRequiredContentFromWeb(document.web, sourceContract, localizedSubjects));
}

function collectLocalizedSubjectWeb(webDocuments) {
  return {
    presentations: webDocuments.flatMap(web => web.presentations ?? []),
    termLocalizations: webDocuments.flatMap(web => web.termLocalizations ?? []),
  };
}

export function collectRequiredContentFromWeb(web, sourceContract = null, localizedSubjects = web) {
  const content = [];
  for (const item of web.presentations ?? []) {
    content.push({ id: item.authoringId, present: item.locale === 'zh-TW' && nonemptyText(item.name) });
  }
  for (const item of web.termLocalizations ?? []) {
    content.push({ id: item.authoringId, present: item.locale === 'zh-TW' && nonemptyText(item.label) && nonemptyText(item.definition) });
  }
  for (const item of web.announcements ?? []) {
    content.push({ id: item.announcementId ?? item.recordId, present: announcementHasRequiredText(item) });
  }
  for (const item of web.gameChanges ?? []) {
    const fieldSummariesPresent = Array.isArray(item.fieldSummaries) && item.fieldSummaries.length > 0
      && item.fieldSummaries.every(field => isRecord(field) && nonemptyText(field.summary)
        && ((field.beforeRule === undefined && field.afterRule === undefined)
          || (localizedSummaryHasRequiredText(field.beforeRule) && localizedSummaryHasRequiredText(field.afterRule))));
    const entityNamePresent = item.entityName === undefined
      ? gameChangeHasExistingLocalizedSubject(item, localizedSubjects, sourceContract)
      : localizedSummaryHasRequiredText(item.entityName);
    content.push({ id: item.changeId, present: localizedSummaryHasRequiredText(item.summary) && fieldSummariesPresent && entityNamePresent });
  }
  for (const item of web.officialTextChanges ?? []) {
    content.push({ id: item.changeId, present: localizedSummaryHasRequiredText(item.summary) });
  }
  return content;
}

function gameChangeHasExistingLocalizedSubject(change, web, sourceContract) {
  if (!isRecord(sourceContract) || !Array.isArray(sourceContract.records) || !isRecord(change.sourceRef)) return false;
  const keyFor = ref => isRecord(ref) && typeof ref.gameReleaseId === 'string' && typeof ref.recordId === 'string'
    ? sourceRecordKey(ref) : null;
  const records = new Map(sourceContract.records.map(record => [sourceRecordKey(record), record]));
  const sourceChange = records.get(keyFor(change.sourceRef));
  if (sourceChange?.kind !== 'game-change' || sourceChange.recordId !== change.changeId) return false;
  const target = records.get(keyFor(sourceChange.payload?.entityRef));
  const resolve = (record, visited = new Set()) => {
    if (!isRecord(record)) return false;
    const key = sourceRecordKey(record);
    if (visited.has(key)) return false;
    const next = new Set(visited).add(key);
    if (['skill', 'blessing', 'weapon'].includes(record.kind)) {
      const matches = (web.presentations ?? []).filter(row => row?.locale === 'zh-TW' && row.entityRef?.recordId === record.recordId
        && row.entityRef?.gameReleaseId === record.gameReleaseId && row.entityRef?.kind === record.kind && nonemptyText(row.name));
      return matches.length === 1;
    }
    if (record.kind === 'term') {
      const matches = (web.termLocalizations ?? []).filter(row => row?.locale === 'zh-TW' && row.termRef?.recordId === record.recordId
        && row.termRef?.gameReleaseId === record.gameReleaseId && nonemptyText(row.label));
      return matches.length === 1;
    }
    let parents = [];
    if (record.kind === 'claim') {
      const parent = records.get(keyFor(record.payload?.targetRef));
      if (parent) parents = [parent];
    } else if (record.kind === 'blessing-variant') {
      const parent = records.get(keyFor(record.payload?.blessingRef));
      if (parent) parents = [parent];
    } else if (record.kind === 'stat-definition') {
      parents = sourceContract.records.filter(candidate => candidate.kind === 'weapon'
        && (candidate.payload.statRefs ?? []).some(ref => keyFor(ref) === key));
    } else if (record.kind === 'stat-curve') {
      const definitions = sourceContract.records.filter(candidate => candidate.kind === 'stat-definition'
        && keyFor(candidate.payload?.curveRef) === key);
      const definitionKeys = new Set(definitions.map(sourceRecordKey));
      parents = sourceContract.records.filter(candidate => candidate.kind === 'weapon'
        && (candidate.payload.statRefs ?? []).some(ref => definitionKeys.has(keyFor(ref))));
    }
    const uniqueParents = new Map(parents.map(parent => [sourceRecordKey(parent), parent]));
    return uniqueParents.size === 1 && resolve([...uniqueParents.values()][0], next);
  };
  return resolve(target);
}

function announcementHasRequiredText(announcement) {
  return isRecord(announcement)
    && Array.isArray(announcement.blocks) && announcement.blocks.length > 0
    && announcement.blocks.every(announcementBlockHasRequiredText)
    && (announcement.scope !== 'official-document' || nonemptyText(announcement.title))
    && Array.isArray(announcement.assets)
    && announcement.assets.every(asset => isRecord(asset) && nonemptyText(asset.alt));
}

function announcementBlockHasRequiredText(block) {
  if (!isRecord(block)) return false;
  if (['heading', 'paragraph', 'link'].includes(block.kind)) return nonemptyText(block.text);
  if (block.kind === 'list') {
    return Array.isArray(block.items) && block.items.length > 0
      && block.items.every(item => isRecord(item) && nonemptyText(item.text)
        && (!item.children || (Array.isArray(item.children) && item.children.every(announcementBlockHasRequiredText))));
  }
  if (block.kind === 'table') {
    return Array.isArray(block.rows) && block.rows.length > 0
      && block.rows.every(row => isRecord(row) && Array.isArray(row.cells) && row.cells.length > 0
        && row.cells.every(cell => isRecord(cell) && nonemptyText(cell.text)));
  }
  if (block.kind === 'image') return nonemptyText(block.alt);
  if (block.kind === 'quote') {
    return Array.isArray(block.blocks) && block.blocks.length > 0
      && block.blocks.every(announcementBlockHasRequiredText);
  }
  if (block.kind === 'spoiler') {
    return nonemptyText(block.label) && Array.isArray(block.blocks) && block.blocks.length > 0
      && block.blocks.every(announcementBlockHasRequiredText);
  }
  return false;
}

function localizedSummaryHasRequiredText(summary) {
  return isRecord(summary) && summary.locale === 'zh-TW' && nonemptyText(summary.text);
}

function nonemptyText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function countUnresolvedHitZones(sourceContract) {
  return sourceContract.records.filter(record => record.kind === 'target-profile')
    .reduce((count, record) => count + (record.payload?.sourceStatic?.unresolvedZoneReferences?.length ?? 0), 0);
}

function makeLimitations(sourceContract, modes) {
  const weapons = sourceContract.records.filter(record => record.kind === 'weapon');
  const assetIds = [...new Set(modes.flatMap(({ mode }) => collectAssetRefs(mode.authoring.presentations.filter(item => item.entityRef.kind === 'weapon'))))].sort(compareUtf8);
  return ACCEPTED_LIMITATION_KEYS.map(key => ({
    key,
    ...LIMITATION_DETAILS[key],
    ...(key === 'unresolved-hit-zone-references' ? { count: countUnresolvedHitZones(sourceContract) } : {}),
    ...(key === 'steam-build' ? { gameBuilds: [...new Set(sourceContract.gameReleases.map(release => release.gameBuild))].sort(compareUtf8) } : {}),
    ...(key === 'weapon-artwork' ? { declaredAssetRefCount: assetIds.length, assetIds } : {}),
  }));
}

function requireCandidateInputs(input) {
  if (!isRecord(input)) fail('W08 compiler input must be an object');
  for (const key of ['sourceContract', 'sourceBuild', 'compilerIdentity', 'webIdentity', 'w06', 'w07']) {
    if (!isRecord(input[key])) fail('W08 compiler input is missing ' + key);
  }
  requireSha(input.compilerIdentity.commit, 40, 'W08 compiler identity commit');
  requireSha(input.compilerIdentity.inputLockSha256, 64, 'W08 input lock digest');
  requireSha(input.webIdentity.authoringCommit, 40, 'W08 authoring commit');
  requireSha(input.webIdentity.compilerCommit, 40, 'W08 compiler commit');
  if (input.webIdentity.compilerCommit !== input.compilerIdentity.commit) fail('W08 Web compiler identity differs from compiler pin');
  for (const [mode, label] of [[input.w06, 'W06'], [input.w07, 'W07']]) assertModeShape(mode, label);
  if (!Array.isArray(input.compilerIdentity.files) || !input.compilerIdentity.files.length) fail('W08 compiler identity must include pinned runtime files');
  if (input.sourceBuild.repository !== SOURCE_REPOSITORY) fail('W08 Source build repository differs from the fixed repository');
  requireSha(input.sourceBuild.commit, 40, 'W08 Source commit');
  requireSha(input.sourceBuild.sourceRevision, 64, 'W08 Source revision');
  requireSha(input.sourceBuild.manifestSha256, 64, 'W08 Source manifest hash');
  if (input.sourceBuild.mode !== undefined && input.sourceBuild.mode !== 'candidate') fail('W08 Source build must be a candidate build');
  if (input.sourceContract.fixtureOnly !== false || input.sourceContract.publicationEligible !== false) fail('W08 Source contract must be real non-fixture input and remain non-publishable');
}

function authoringPresentationIds(modes) {
  const ids = new Set();
  for (const { mode, name } of modes) {
    for (const item of mode.authoring.presentations) {
      if (typeof item.authoringId !== 'string' || ids.has(item.authoringId)) fail('duplicate Web presentation authoringId across modes: ' + String(item.authoringId));
      ids.add(item.authoringId);
      if (item.locale !== 'zh-TW' || typeof item.name !== 'string' || item.name.trim() === '') fail(name + ' has a missing required zh-TW presentation name: ' + item.authoringId);
    }
  }
}

function createDomainBytes(sourceContract, modes, releaseId) {
  const docs = new Map();
  for (const kind of CORE_DOMAIN_KINDS) {
    const records = makeRegistryDomainSeeds(kind, sourceContract, releaseId, modes);
    const termRules = kind === 'terms' ? modes.find(row => row.name === 'w06')?.mode.termRules ?? null : null;
    const document = makeDomainDocument({ kind, releaseId, sourceContract, sourceRecords: records, modeRows: modes, termRules });
    docs.set(kind, document);
  }
  const announcements = modes.flatMap(({ mode }) => mode.authoring.announcements);
  if (announcements.length) {
    const rows = modes.map(({ mode, name }) => ({ mode, name }));
    docs.set('announcements', makeDomainDocument({ kind: 'announcements', releaseId, sourceContract,
      sourceRecords: makeRegistryDomainSeeds('announcements', sourceContract, releaseId, rows), modeRows: rows }));
  }
  const gameChanges = modes.flatMap(({ mode }) => [...mode.authoring.gameChanges, ...mode.authoring.officialTextChanges]);
  if (gameChanges.length) {
    const rows = modes.map(({ mode, name }) => ({ mode, name }));
    docs.set('game-changes', makeDomainDocument({ kind: 'game-changes', releaseId, sourceContract,
      sourceRecords: makeRegistryDomainSeeds('game-changes', sourceContract, releaseId, rows), modeRows: rows }));
  }
  return docs;
}

function emittedWebReviewTargets(domainDocuments) {
  const targetsByKey = new Map();
  for (const document of domainDocuments) {
    for (const row of document.web.reviewTargets) {
      const key = row.mode + '\u0000' + row.target.targetId;
      const prior = targetsByKey.get(key);
      if (prior && canonicalJson(prior) !== canonicalJson(row)) fail('emitted Web domains contain conflicting review targets: ' + row.target.targetId);
      targetsByKey.set(key, row);
    }
  }
  return [...targetsByKey.values()]
    .sort((left, right) => compareUtf8(left.mode + '\u0000' + left.target.targetId, right.mode + '\u0000' + right.target.targetId));
}

function emittedSourceRecords(domainDocuments) {
  const recordsByKey = new Map();
  for (const document of domainDocuments) {
    for (const record of document.source.records) {
      const key = sourceRecordKey(record);
      const prior = recordsByKey.get(key);
      if (prior && canonicalJson(prior) !== canonicalJson(record)) fail('emitted Source domains contain conflicting records: ' + key.replace('\u0000', ':'));
      recordsByKey.set(key, record);
    }
  }
  return [...recordsByKey.values()];
}

function reviewCoverage(domainDocuments) {
  const targets = emittedWebReviewTargets(domainDocuments);
  const receiptsByCanonicalJson = new Map();
  for (const document of domainDocuments) {
    for (const row of document.web.reviewReceipts) receiptsByCanonicalJson.set(canonicalJson(row), row);
  }
  const receipts = [...receiptsByCanonicalJson.values()]
    .sort((left, right) => compareUtf8(canonicalJson(left), canonicalJson(right)));
  const rowsWithStates = stateCounts(targets);
  return {
    receiptCount: receipts.length,
    targetCount: targets.length,
    webTargetCount: targets.length,
    sourceTargetCount: 0,
    states: rowsWithStates,
    targets,
    sourceTargets: [],
    receipts,
  };
}

function sourceReviewTargets(sourceContract, sourceValidator = null, emittedRecords = sourceContract.records) {
  if (!Array.isArray(sourceContract.records)) fail('W08 Source records must be an array');
  if (!Array.isArray(emittedRecords)) fail('W08 emitted Source records must be an array');
  const emittedRecordKeys = new Set(emittedRecords.map(sourceRecordKey));
  const targets = [];
  const seen = new Set();
  for (const record of sourceContract.records) {
    if (!emittedRecordKeys.has(sourceRecordKey(record))) continue;
    if (!['approved', 'pending', 'stale', 'rejected'].includes(record.reviewState)) fail('W08 Source record has an invalid reviewState: ' + record.recordId);
    for (const target of record.reviewTargets ?? []) {
      if (typeof target.fieldPath !== 'string' || !target.fieldPath.startsWith('/') || typeof target.dimension !== 'string' || target.dimension.length === 0) {
        fail('W08 Source review target must identify its fieldPath and dimension: ' + record.recordId);
      }
      const row = {
        mode: 'source',
        gameReleaseId: record.gameReleaseId,
        recordId: record.recordId,
        fieldPath: target.fieldPath,
        dimension: target.dimension,
        state: record.reviewState,
        targetDigest: null,
        dependenciesDigest: null,
      };
      if (record.reviewState === 'approved') {
        if (typeof sourceValidator?.computeReviewDigests !== 'function') fail('approved Source target requires the pinned digest validator');
        const digests = sourceValidator.computeReviewDigests(sourceContract, {
          gameReleaseId: record.gameReleaseId,
          recordId: record.recordId,
          fieldPath: target.fieldPath,
        });
        row.targetDigest = digests.targetDigest;
        row.dependenciesDigest = digests.dependenciesDigest;
      }
      const key = sourceReviewTargetKey(row);
      if (seen.has(key)) fail('W08 Source review target is duplicated: ' + key.replaceAll('\u0000', ':'));
      seen.add(key);
      targets.push(row);
    }
  }
  return targets.sort((left, right) => compareUtf8(sourceReviewTargetKey(left), sourceReviewTargetKey(right)));
}

function sourceReviewReceipts(sourceContract, targets) {
  const targetKeys = new Set(targets.map(sourceReviewTargetKey));
  const declaredTargetKeys = new Set(sourceContract.records.flatMap(record => (record.reviewTargets ?? []).map(target => sourceReviewTargetKey({
    gameReleaseId: record.gameReleaseId,
    recordId: record.recordId,
    fieldPath: target.fieldPath,
    dimension: target.dimension,
  }))));
  const receipts = [];
  for (const receipt of sourceContract.reviewReceipts ?? []) {
    if (!isRecord(receipt.target) || ['gameReleaseId', 'recordId', 'fieldPath', 'dimension'].some(key => typeof receipt.target[key] !== 'string')) {
      fail('W08 Source review receipt has an invalid target');
    }
    const key = sourceReviewTargetKey(receipt.target);
    if (!declaredTargetKeys.has(key)) fail('W08 Source review receipt points to a missing review target');
    if (targetKeys.has(key)) receipts.push({ mode: 'source', receipt: structuredClone(receipt) });
  }
  return receipts;
}

function utf8JsonDocument(value, label) {
  const bytes = jsonBytes(value);
  if (bytes.byteLength === 0) fail(label + ' serialized to empty bytes');
  return bytes;
}

export function compileW08Candidate(input) {
  requireCandidateInputs(input);
  const sourceContract = input.sourceContract;
  const modes = [{ name: 'w06', mode: input.w06 }, { name: 'w07', mode: input.w07 }];
  authoringPresentationIds(modes);
  for (const { name, mode } of modes) {
    const retainedPresentations = mode.authoring.presentations.filter(item => Object.hasOwn(item, 'retainedName'));
    if (!retainedPresentations.length) continue;
    if (name !== 'w07' || !hasVerifiedRetainedNameEvidenceMap(mode)) {
      fail(name + ' retained-name presentations require a fixed-source evidence map from the W07 input loader');
    }
    for (const presentation of retainedPresentations) {
      const validation = validateRetainedWeaponNameForCandidate(presentation, mode);
      if (!validation.valid) {
        fail(name + ' retained-name evidence validation failed: ' + validation.issues.map(issue => issue.path + ' ' + issue.message).join('; '));
      }
    }
  }
  if (input.w06.sourceContract && input.w07.sourceContract) verifySourceOverlap(input.w06.sourceContract, input.w07.sourceContract, sourceContract);

  const requestedReleaseId = input.gameReleaseId ?? input.w07.authoring.presentations[0]?.entityRef.gameReleaseId
    ?? input.w06.authoring.presentations[0]?.entityRef.gameReleaseId;
  if (typeof requestedReleaseId !== 'string') fail('W08 gameReleaseId is required');
  const gameRelease = sourceContract.gameReleases.find(release => release.gameReleaseId === requestedReleaseId);
  if (!gameRelease) fail('W08 game release is missing from the Source registry: ' + requestedReleaseId);
  const gameVersion = gameRelease.gameVersion;
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(gameVersion)) fail('W08 game release version is invalid');
  if (input.proposedContentVersion && input.proposedContentVersion !== gameVersion + '.1') fail('W08 proposed content version must be a candidate identifier for the selected game release');

  const builtDomainDocuments = createDomainBytes(sourceContract, modes, requestedReleaseId);
  const emittedDomainDocuments = [...builtDomainDocuments.values()];
  const domainBytes = new Map([...builtDomainDocuments].map(([kind, document]) => [
    'domains/' + kind + '.json',
    utf8JsonDocument(document, kind + ' domain'),
  ]));
  const files = [...domainBytes].map(([filePath, bytes]) => ({
    kind: filePath.slice('domains/'.length, -'.json'.length),
    path: filePath,
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
    dependencies: [],
  })).sort((left, right) => compareUtf8(left.path, right.path));

  const snapshotIds = new Set();
  for (const release of sourceContract.gameReleases) if (release.snapshot?.snapshotId) snapshotIds.add(release.snapshot.snapshotId);
  for (const snapshot of sourceContract.sourceSnapshots ?? []) if (snapshot.snapshot?.snapshotId) snapshotIds.add(snapshot.snapshot.snapshotId);
  const manifest = {
    schemaVersion: '2.0.0',
    gameReleaseId: requestedReleaseId,
    gameVersion,
    contentVersion: input.proposedContentVersion ?? gameVersion + '.1',
    dataRevision: '0'.repeat(64),
    source: {
      repository: input.sourceBuild.repository,
      commit: input.sourceBuild.commit,
      sourceRevision: input.sourceBuild.sourceRevision,
      manifestSha256: input.sourceBuild.manifestSha256,
    },
    web: { authoringCommit: input.webIdentity.authoringCommit, compilerCommit: input.compilerIdentity.commit },
    compatibility: {
      dataContractMajor: 2,
      requiredFeatures: ['official-errata-details-v1', 'official-native-localizations-v1', 'blessing-tier-presentations-v1'],
      gameSnapshotRefs: [...snapshotIds].sort(compareUtf8),
    },
    files,
    changeIndexPath: domainBytes.has('domains/game-changes.json') ? 'domains/game-changes.json' : null,
  };
  manifest.dataRevision = computeDataRevision(manifest);
  validateManifest(manifest);
  const manifestBytes = utf8JsonDocument(manifest, 'shared manifest');
  const manifestPath = buildManifestPath(manifest.dataRevision);
  const webReview = reviewCoverage(emittedDomainDocuments);
  const emittedRecords = emittedSourceRecords(emittedDomainDocuments);
  const sourceStateRows = sourceReviewTargets(sourceContract, input.w07.sourceValidator, emittedRecords);
  const sourceStates = stateCounts(sourceStateRows.map(row => ({ state: row.state })));
  const combinedStates = {
    approved: webReview.states.approved + sourceStates.approved,
    pending: webReview.states.pending + sourceStates.pending,
    stale: webReview.states.stale + sourceStates.stale,
    rejected: webReview.states.rejected + sourceStates.rejected,
  };
  const retainedSourceReceipts = sourceReviewReceipts(sourceContract, sourceStateRows);
  const review = {
    receiptCount: webReview.receipts.length + retainedSourceReceipts.length,
    targetCount: webReview.targetCount + sourceStateRows.length,
    webTargetCount: webReview.webTargetCount,
    sourceTargetCount: sourceStateRows.length,
    states: combinedStates,
    targets: webReview.targets.map(row => ({ mode: row.mode, target: row.target, state: row.state, targetDigest: row.targetDigest, dependenciesDigest: row.dependenciesDigest })),
    sourceTargets: sourceStateRows,
    receipts: [...webReview.receipts, ...retainedSourceReceipts],
  };
  const requiredContent = collectWebContentRows(emittedDomainDocuments, sourceContract);
  const gate = evaluateW08PublicationGate({ sourceBuild: input.sourceBuild, review: { ...review, states: combinedStates }, requiredContent });
  const limitations = makeLimitations(sourceContract, modes);
  const compilerFiles = input.compilerIdentity.files.map(row => ({ path: row.path, sizeBytes: row.sizeBytes, sha256: row.sha256 }))
    .sort((left, right) => compareUtf8(left.path, right.path));
  const webInputRows = modes.map(({ name, mode }) => ({
    mode: name,
    authoringSha256: mode.webLock?.authoring?.sha256 ?? null,
    officialInputsSha256: mode.webLock?.officialInputs?.sha256 ?? null,
    termRulesSha256: mode.webLock?.termRules?.sha256 ?? null,
    baselineSha256: mode.webLock?.baseline?.sha256 ?? null,
  }));
  const envelope = {
    schemaVersion: W08_CANDIDATE_SCHEMA,
    candidateOnly: true,
    fixtureOnly: false,
    publicationEligible: false,
    proposedContentVersion: manifest.contentVersion,
    gameReleaseId: requestedReleaseId,
    sourceBuild: {
      repository: input.sourceBuild.repository,
      commit: input.sourceBuild.commit,
      sourceRevision: input.sourceBuild.sourceRevision,
      manifestSha256: input.sourceBuild.manifestSha256,
      buildIdentityVerified: input.sourceBuild.buildIdentityVerified === true,
      publicationEligible: input.sourceBuild.publicationEligible === true,
      receiptSha256: input.sourceBuild.receiptSha256 ?? null,
    },
    compiler: {
      commit: input.compilerIdentity.commit,
      inputLockSha256: input.compilerIdentity.inputLockSha256,
      files: compilerFiles,
      authoringCommit: input.webIdentity.authoringCommit,
    },
    webInputs: webInputRows,
    manifest: { path: manifestPath, sha256: sha256(manifestBytes), dataRevision: manifest.dataRevision },
    review,
    publicationGate: gate,
    acceptedLimitations: limitations,
  };
  const result = { envelope: canonicalize(envelope), manifest: canonicalize(manifest), files: domainBytes, manifestBytes };
  validateW08Candidate(result);
  return result;
}

function expectedDomainPath(revision, relativePath) {
  return 'data/' + revision + '/' + relativePath;
}

function resolveFileBytes(files, relativePath) {
  if (files instanceof Map) return files.get(relativePath) ?? null;
  if (isRecord(files)) return files[relativePath] ?? null;
  return null;
}

function validateDomainDocument(document, row, releaseId) {
  requireExactKeys(document, ['schemaVersion', 'kind', 'gameReleaseId', 'source', 'web'], row.path);
  if (document.schemaVersion !== W08_DOMAIN_SCHEMA || document.kind !== row.kind || document.gameReleaseId !== releaseId) {
    fail('domain file identity does not match the manifest: ' + row.path);
  }
  requireExactKeys(document.source, ['repository', 'gameReleases', 'sourceSnapshots', 'sourceRefs', 'records', 'tombstones', 'reviewReceipts'], row.path + '.source');
  if (document.source.repository !== SOURCE_REPOSITORY) fail('domain file Source repository is invalid: ' + row.path);
  for (const field of ['gameReleases', 'sourceSnapshots', 'sourceRefs', 'records', 'tombstones', 'reviewReceipts']) {
    if (!Array.isArray(document.source[field])) fail('domain file source.' + field + ' must be an array: ' + row.path);
  }
  const records = new Map();
  for (const record of document.source.records) {
    if (!isRecord(record) || typeof record.recordId !== 'string' || typeof record.gameReleaseId !== 'string' || typeof record.kind !== 'string') fail('domain file contains an invalid Source record: ' + row.path);
    const key = sourceRecordKey(record);
    if (records.has(key)) fail('domain file duplicates a Source record: ' + record.recordId);
    records.set(key, record);
  }
  for (const record of records.values()) {
    for (const ref of collectTypedRecordPointers(record)) {
      const target = records.get(sourceRecordKey(ref));
      if (!target) fail('domain Source closure is incomplete for ' + ref.recordId);
      if (ref.kind && ref.kind !== target.kind) fail('domain Source reference kind mismatch for ' + ref.recordId);
    }
  }
  const sourceRefs = new Map(document.source.sourceRefs.map(ref => [sourceRefKey(ref), ref]));
  if (sourceRefs.size !== document.source.sourceRefs.length) fail('domain Source provenance has duplicate identities');
  for (const ref of collectSourcePointers(document.source.records)) if (!sourceRefs.has(sourceRefKey(ref))) fail('domain Source provenance closure is incomplete for ' + ref.sourceId);

  const allowedWebKeys = new Set(['presentations', 'officialInputs', 'termLocalizations', 'termRules', 'announcements', 'gameChanges', 'officialTextChanges', 'reviewTargets', 'reviewReceipts']);
  if (!isRecord(document.web) || Object.keys(document.web).some(key => !allowedWebKeys.has(key))) fail('domain Web projection contains unexpected properties: ' + row.path);
  for (const key of ['presentations', 'termLocalizations', 'announcements', 'gameChanges', 'officialTextChanges', 'reviewTargets', 'reviewReceipts']) {
    if (!Array.isArray(document.web[key])) fail('domain Web projection is missing array ' + key + ': ' + row.path);
  }
  if (!isRecord(document.web.officialInputs) || !Array.isArray(document.web.officialInputs.sources)) fail('domain official inputs are missing: ' + row.path);
  const officialIds = new Set(document.web.officialInputs.sources.map(source => source.officialSourceId));
  if (officialIds.size !== document.web.officialInputs.sources.length) fail('domain official inputs contain duplicate source IDs');
  for (const presentation of document.web.presentations) {
    if (!isRecord(presentation) || presentation.locale !== 'zh-TW' || typeof presentation.name !== 'string' || presentation.name.trim() === '') {
      fail('domain presentation is missing required zh-TW content: ' + row.path);
    }
    for (const sourceId of collectOfficialSourceIds(presentation)) if (!officialIds.has(sourceId)) fail('domain official input closure is incomplete: ' + sourceId);
  }
  const webItems = [
    ...document.web.presentations,
    ...document.web.termLocalizations,
    ...document.web.announcements,
    ...document.web.gameChanges,
    ...document.web.officialTextChanges,
  ];
  for (const ref of collectTypedRecordPointers(webItems)) {
    const target = records.get(sourceRecordKey(ref));
    if (!target) fail('domain Web typed Source reference is unresolved: ' + ref.recordId);
    if (ref.kind && ref.kind !== target.kind) fail('domain Web typed Source reference kind mismatch: ' + ref.recordId);
  }
  for (const ref of collectSourcePointers(webItems)) if (!sourceRefs.has(sourceRefKey(ref))) {
    fail('domain Web provenance reference is unresolved: ' + ref.sourceId);
  }
  const targetKeys = new Set([...records.values()].flatMap(record => (record.reviewTargets ?? []).map(target => sourceReviewTargetKey({
    gameReleaseId: record.gameReleaseId,
    recordId: record.recordId,
    fieldPath: target.fieldPath,
    dimension: target.dimension,
  }))));
  for (const receipt of document.source.reviewReceipts) {
    if (!isRecord(receipt.target) || !targetKeys.has(sourceReviewTargetKey(receipt.target))) fail('domain Source review receipt points outside its record closure');
  }
  const targetIds = new Set();
  for (const targetRow of document.web.reviewTargets) {
    if (!isRecord(targetRow) || typeof targetRow.mode !== 'string' || !isRecord(targetRow.target) || typeof targetRow.target.targetId !== 'string'
      || !['approved', 'pending', 'stale', 'rejected'].includes(targetRow.state)) fail('domain review target is invalid: ' + row.path);
    const targetKey = targetRow.mode + '\u0000' + targetRow.target.targetId;
    if (targetIds.has(targetKey)) fail('domain duplicates a review target: ' + targetRow.target.targetId);
    targetIds.add(targetKey);
  }
}

function validateEnvelopeShape(envelope) {
  requireExactKeys(envelope, [
    'schemaVersion', 'candidateOnly', 'fixtureOnly', 'publicationEligible', 'proposedContentVersion', 'gameReleaseId',
    'sourceBuild', 'compiler', 'webInputs', 'manifest', 'review', 'publicationGate', 'acceptedLimitations',
  ], 'W08 candidate envelope');
  if (envelope.schemaVersion !== W08_CANDIDATE_SCHEMA || envelope.candidateOnly !== true || envelope.fixtureOnly !== false || envelope.publicationEligible !== false) {
    fail('W08 candidate envelope must remain candidate-only, non-fixture, and non-publishable');
  }
  if (typeof envelope.gameReleaseId !== 'string' || typeof envelope.proposedContentVersion !== 'string') fail('W08 candidate release identity is missing');
  requireExactKeys(envelope.sourceBuild, ['repository', 'commit', 'sourceRevision', 'manifestSha256', 'buildIdentityVerified', 'publicationEligible', 'receiptSha256'], 'W08 candidate sourceBuild');
  if (envelope.sourceBuild.repository !== SOURCE_REPOSITORY || envelope.sourceBuild.buildIdentityVerified !== false || envelope.sourceBuild.publicationEligible !== false) {
    fail('W08 Source build identity must remain explicitly unverified and non-publishable');
  }
  requireSha(envelope.sourceBuild.commit, 40, 'candidate Source commit');
  requireSha(envelope.sourceBuild.sourceRevision, 64, 'candidate Source revision');
  requireSha(envelope.sourceBuild.manifestSha256, 64, 'candidate Source manifest hash');
  if (envelope.sourceBuild.receiptSha256 !== null) requireSha(envelope.sourceBuild.receiptSha256, 64, 'candidate Source receipt hash');
  requireExactKeys(envelope.compiler, ['commit', 'inputLockSha256', 'files', 'authoringCommit'], 'W08 candidate compiler');
  requireSha(envelope.compiler.commit, 40, 'candidate compiler commit');
  requireSha(envelope.compiler.authoringCommit, 40, 'candidate authoring commit');
  requireSha(envelope.compiler.inputLockSha256, 64, 'candidate input lock hash');
  if (!Array.isArray(envelope.compiler.files) || envelope.compiler.files.length !== EXPECTED_COMPILER_FILES.length) fail('candidate compiler file pin list is incomplete');
  const compilerPaths = new Set();
  for (const [index, row] of envelope.compiler.files.entries()) {
    requireExactKeys(row, ['path', 'sizeBytes', 'sha256'], 'candidate compiler.files[' + index + ']');
    requireRelativePath(row.path, 'candidate compiler file path');
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1) fail('candidate compiler file size is invalid');
    requireSha(row.sha256, 64, 'candidate compiler file hash');
    if (compilerPaths.has(row.path)) fail('candidate compiler file pin is duplicated');
    compilerPaths.add(row.path);
  }
  if (canonicalJson([...compilerPaths].sort(compareUtf8)) !== canonicalJson([...EXPECTED_COMPILER_FILES].sort(compareUtf8))) {
    fail('candidate compiler file pin paths differ from the fixed compiler dependencies');
  }
  if (!Array.isArray(envelope.webInputs) || envelope.webInputs.length !== 2 || canonicalJson(envelope.webInputs.map(row => row.mode)) !== canonicalJson(['w06', 'w07'])) {
    fail('candidate must record W06 and W07 inputs exactly once');
  }
  for (const [index, row] of envelope.webInputs.entries()) {
    requireExactKeys(row, ['mode', 'authoringSha256', 'officialInputsSha256', 'termRulesSha256', 'baselineSha256'], 'candidate webInputs[' + index + ']');
    for (const field of ['authoringSha256', 'officialInputsSha256', 'termRulesSha256', 'baselineSha256']) {
      if (row[field] !== null) requireSha(row[field], 64, 'candidate ' + row.mode + ' ' + field);
    }
  }
  requireExactKeys(envelope.manifest, ['path', 'sha256', 'dataRevision'], 'W08 candidate manifest ref');
  requireSha(envelope.manifest.sha256, 64, 'candidate manifest hash');
  requireSha(envelope.manifest.dataRevision, 64, 'candidate data revision');
  requireExactKeys(envelope.review, ['receiptCount', 'targetCount', 'webTargetCount', 'sourceTargetCount', 'states', 'targets', 'sourceTargets', 'receipts'], 'W08 candidate review');
  for (const field of ['receiptCount', 'targetCount', 'webTargetCount', 'sourceTargetCount']) if (!Number.isSafeInteger(envelope.review[field]) || envelope.review[field] < 0) fail('candidate review count is invalid: ' + field);
  requireExactKeys(envelope.review.states, ['approved', 'pending', 'stale', 'rejected'], 'W08 review state counts');
  if (!Array.isArray(envelope.review.targets) || !Array.isArray(envelope.review.sourceTargets) || !Array.isArray(envelope.review.receipts)) fail('candidate review details must be arrays');
  const webTargets = new Set();
  for (const [index, row] of envelope.review.targets.entries()) {
    requireExactKeys(row, ['mode', 'target', 'state', 'targetDigest', 'dependenciesDigest'], 'candidate review.targets[' + index + ']');
    if (!['w06', 'w07'].includes(row.mode) || !isRecord(row.target) || typeof row.target.targetId !== 'string'
      || typeof row.target.ownerId !== 'string' || typeof row.target.fieldPath !== 'string' || typeof row.target.dimension !== 'string'
      || !['approved', 'pending', 'stale', 'rejected'].includes(row.state)) fail('candidate Web review target is malformed');
    if (row.targetDigest !== null) requireSha(row.targetDigest, 64, 'candidate Web target digest');
    if (row.dependenciesDigest !== null) requireSha(row.dependenciesDigest, 64, 'candidate Web dependency digest');
    const key = row.mode + '\u0000' + row.target.targetId;
    if (webTargets.has(key)) fail('candidate Web review target is duplicated');
    webTargets.add(key);
  }
  const sourceTargets = new Set();
  for (const [index, row] of envelope.review.sourceTargets.entries()) {
    requireExactKeys(row, ['mode', 'gameReleaseId', 'recordId', 'fieldPath', 'dimension', 'state', 'targetDigest', 'dependenciesDigest'], 'candidate review.sourceTargets[' + index + ']');
    if (row.mode !== 'source' || typeof row.gameReleaseId !== 'string' || typeof row.recordId !== 'string'
      || typeof row.fieldPath !== 'string' || typeof row.dimension !== 'string' || !['approved', 'pending', 'stale', 'rejected'].includes(row.state)) {
      fail('candidate Source review target is malformed');
    }
    if (row.targetDigest !== null) requireSha(row.targetDigest, 64, 'candidate Source target digest');
    if (row.dependenciesDigest !== null) requireSha(row.dependenciesDigest, 64, 'candidate Source dependency digest');
    const key = sourceReviewTargetKey(row);
    if (sourceTargets.has(key)) fail('candidate Source review target is duplicated');
    sourceTargets.add(key);
  }
  for (const [index, row] of envelope.review.receipts.entries()) {
    requireExactKeys(row, ['mode', 'receipt'], 'candidate review.receipts[' + index + ']');
    if (!['w06', 'w07', 'source'].includes(row.mode) || !isRecord(row.receipt)) fail('candidate review receipt is malformed');
  }
  requireExactKeys(envelope.publicationGate, ['status', 'publicationEligible', 'blockers'], 'W08 candidate publication gate');
  if (!['blocked', 'ready-for-release-allocation'].includes(envelope.publicationGate.status) || envelope.publicationGate.publicationEligible !== false || !Array.isArray(envelope.publicationGate.blockers)) {
    fail('W08 publication gate result is invalid');
  }
  if ((envelope.publicationGate.status === 'blocked' && envelope.publicationGate.blockers.length === 0)
    || (envelope.publicationGate.status === 'ready-for-release-allocation' && envelope.publicationGate.blockers.length !== 0)) {
    fail('W08 candidate publication gate status disagrees with its blockers');
  }
  if (!Array.isArray(envelope.acceptedLimitations) || envelope.acceptedLimitations.length !== ACCEPTED_LIMITATION_KEYS.length) fail('candidate accepted limitations are incomplete');
  if (canonicalJson(envelope.acceptedLimitations.map(row => row.key)) !== canonicalJson(ACCEPTED_LIMITATION_KEYS)) fail('candidate accepted limitations differ from the fixed W07 set');
}

export function validateW08Candidate(candidate, options = {}) {
  if (!isRecord(candidate)) fail('W08 candidate must be an object');
  requireExactKeys(candidate, ['envelope', 'manifest', 'files', 'manifestBytes'], 'W08 compiled candidate');
  validateEnvelopeShape(candidate.envelope);
  validateManifest(candidate.manifest);
  if (candidate.manifest.gameReleaseId !== candidate.envelope.gameReleaseId
    || candidate.manifest.contentVersion !== candidate.envelope.proposedContentVersion
    || candidate.manifest.source.repository !== candidate.envelope.sourceBuild.repository
    || candidate.manifest.source.commit !== candidate.envelope.sourceBuild.commit
    || candidate.manifest.source.sourceRevision !== candidate.envelope.sourceBuild.sourceRevision
    || candidate.manifest.source.manifestSha256 !== candidate.envelope.sourceBuild.manifestSha256
    || candidate.manifest.web.compilerCommit !== candidate.envelope.compiler.commit
    || candidate.manifest.web.authoringCommit !== candidate.envelope.compiler.authoringCommit
    || candidate.manifest.dataRevision !== candidate.envelope.manifest.dataRevision) fail('candidate envelope and shared manifest identities differ');
  if (candidate.envelope.manifest.path !== buildManifestPath(candidate.manifest.dataRevision)) fail('candidate manifest path is not the immutable dataRevision path');
  const expectedManifestBytes = jsonBytes(candidate.manifest);
  if (!Buffer.isBuffer(candidate.manifestBytes) || !candidate.manifestBytes.equals(expectedManifestBytes)
    || sha256(candidate.manifestBytes) !== candidate.envelope.manifest.sha256) fail('candidate manifest bytes do not match their immutable hash');
  const filePaths = new Set();
  const kinds = new Set();
  const domainDocuments = new Map();
  for (const row of candidate.manifest.files) {
    if (![...CORE_DOMAIN_KINDS, 'announcements', 'game-changes'].includes(row.kind) || row.path !== 'domains/' + row.kind + '.json') {
      fail('W08 manifest contains an unsupported domain path: ' + row.path);
    }
    if (filePaths.has(row.path) || kinds.has(row.kind)) fail('W08 candidate must contain one file per domain kind');
    filePaths.add(row.path);
    kinds.add(row.kind);
    const bytes = resolveFileBytes(candidate.files, row.path);
    if (!Buffer.isBuffer(bytes) || bytes.byteLength !== row.sizeBytes || sha256(bytes) !== row.sha256) fail('domain file bytes do not match their manifest pin: ' + row.path);
    const document = parseJson(bytes, row.path);
    validateDomainDocument(document, row, candidate.manifest.gameReleaseId);
    domainDocuments.set(row.kind, document);
  }
  for (const kind of CORE_DOMAIN_KINDS) if (!kinds.has(kind)) fail('W08 candidate is missing required core domain: ' + kind);
  const providedPaths = candidate.files instanceof Map ? [...candidate.files.keys()] : Object.keys(candidate.files ?? {});
  if (providedPaths.length !== filePaths.size || providedPaths.some(relativePath => !filePaths.has(relativePath))) fail('candidate file set differs from the shared manifest');
  const expectedLimitations = new Set(ACCEPTED_LIMITATION_KEYS);
  for (const limitation of candidate.envelope.acceptedLimitations) {
    requireRecord(limitation, 'accepted limitation');
    if (!expectedLimitations.has(limitation.key)) fail('candidate contains an unrecognized W07 limitation');
    const expected = LIMITATION_DETAILS[limitation.key];
    for (const [key, value] of Object.entries(expected)) if (limitation[key] !== value) fail('candidate changed accepted limitation ' + limitation.key + '.' + key);
  }
  const actualStates = stateCounts(candidate.envelope.review.targets.map(row => ({ state: row.state })));
  const sourceStates = stateCounts(candidate.envelope.review.sourceTargets.map(row => ({ state: row.state })));
  const combined = Object.fromEntries(Object.keys(actualStates).map(key => [key, actualStates[key] + sourceStates[key]]));
  if (canonicalJson(combined) !== canonicalJson(candidate.envelope.review.states)) fail('candidate review state counts do not match target rows');
  if (candidate.envelope.review.webTargetCount !== candidate.envelope.review.targets.length
    || candidate.envelope.review.sourceTargetCount !== candidate.envelope.review.sourceTargets.length
    || candidate.envelope.review.targetCount !== candidate.envelope.review.targets.length + candidate.envelope.review.sourceTargets.length) {
    fail('candidate review target counts do not match retained target rows');
  }
  if (candidate.envelope.review.receiptCount !== candidate.envelope.review.receipts.length) fail('candidate receipt count does not match retained receipts');

  const documents = [...domainDocuments.values()];
  const webTargets = emittedWebReviewTargets(documents)
    .map(row => ({ mode: row.mode, target: row.target, state: row.state, targetDigest: row.targetDigest, dependenciesDigest: row.dependenciesDigest }));
  if (canonicalJson(webTargets) !== canonicalJson(candidate.envelope.review.targets)) fail('candidate Web review target coverage differs from domain documents');

  const sourceTargetMap = new Map();
  const webReceiptMap = new Map();
  for (const document of documents) {
    for (const record of document.source.records) {
      for (const target of record.reviewTargets ?? []) {
        const row = {
          mode: 'source',
          gameReleaseId: record.gameReleaseId,
          recordId: record.recordId,
          fieldPath: target.fieldPath,
          dimension: target.dimension,
          state: record.reviewState,
        };
        const key = sourceReviewTargetKey(row);
        const prior = sourceTargetMap.get(key);
        if (prior && canonicalJson(prior) !== canonicalJson(row)) fail('candidate Source review target has conflicting domain states');
        sourceTargetMap.set(key, row);
      }
    }
    for (const receipt of document.web.reviewReceipts) webReceiptMap.set(canonicalJson(receipt), receipt);
  }
  const expectedSourceTargets = [...sourceTargetMap.values()].sort((left, right) => compareUtf8(sourceReviewTargetKey(left), sourceReviewTargetKey(right)));
  const actualSourceTargetIdentity = candidate.envelope.review.sourceTargets.map(({ targetDigest, dependenciesDigest, ...row }) => row);
  if (canonicalJson(expectedSourceTargets) !== canonicalJson(actualSourceTargetIdentity)) {
    const actualKeys = new Set(expectedSourceTargets.map(sourceReviewTargetKey));
    const claimedKeys = new Set(candidate.envelope.review.sourceTargets.map(sourceReviewTargetKey));
    const missing = [...claimedKeys].filter(key => !actualKeys.has(key)).slice(0, 3).map(key => key.replaceAll('\u0000', ':'));
    const unexpected = [...actualKeys].filter(key => !claimedKeys.has(key)).slice(0, 3).map(key => key.replaceAll('\u0000', ':'));
    fail('candidate Source review target coverage differs from domain documents (missing=' + missing.join('|') + '; unexpected=' + unexpected.join('|') + ')');
  }
  const actualSourceReceiptRows = candidate.envelope.review.receipts.filter(row => row.mode === 'source');
  const expectedSourceReceiptRows = [...new Map(documents.flatMap(document => document.source.reviewReceipts
    .filter(receipt => isRecord(receipt.target))
    .map(receipt => [canonicalJson(receipt), { mode: 'source', receipt }]))).values()]
    .sort((left, right) => compareUtf8(canonicalJson(left), canonicalJson(right)));
  if (canonicalJson(actualSourceReceiptRows.slice().sort((left, right) => compareUtf8(canonicalJson(left), canonicalJson(right))))
    !== canonicalJson(expectedSourceReceiptRows)) fail('candidate Source receipts differ from retained Source registry receipts');
  const actualWebReceiptRows = candidate.envelope.review.receipts.filter(row => row.mode !== 'source')
    .slice().sort((left, right) => compareUtf8(canonicalJson(left), canonicalJson(right)));
  const expectedWebReceiptRows = [...webReceiptMap.values()].sort((left, right) => compareUtf8(canonicalJson(left), canonicalJson(right)));
  if (canonicalJson(actualWebReceiptRows) !== canonicalJson(expectedWebReceiptRows)) fail('candidate Web receipts differ from domain documents');
  const webTargetKeys = new Set(candidate.envelope.review.targets.map(row => row.mode + '\u0000' + row.target.targetId));
  const sourceTargetKeys = new Set(candidate.envelope.review.sourceTargets.map(sourceReviewTargetKey));
  for (const row of candidate.envelope.review.receipts) {
    if (!isRecord(row) || !['w06', 'w07', 'source'].includes(row.mode) || !isRecord(row.receipt)) fail('candidate review receipt row is invalid');
    if (row.mode === 'source') {
      if (!isRecord(row.receipt.target) || !sourceTargetKeys.has(sourceReviewTargetKey(row.receipt.target))) fail('candidate Source receipt points to a missing target');
    } else if (typeof row.receipt.targetId !== 'string' || !webTargetKeys.has(row.mode + '\u0000' + row.receipt.targetId)) {
      fail('candidate Web receipt points to a missing target');
    }
  }

  const localizedSubjects = collectLocalizedSubjectWeb(documents.map(document => document.web));
  const emittedSourceContract = { records: emittedSourceRecords(documents) };
  const requiredContent = documents.flatMap(document => collectRequiredContentFromWeb(document.web, emittedSourceContract, localizedSubjects));
  const expectedGate = evaluateW08PublicationGate({
    sourceBuild: candidate.envelope.sourceBuild,
    review: candidate.envelope.review,
    requiredContent,
  });
  if (canonicalJson(expectedGate) !== canonicalJson(candidate.envelope.publicationGate)) fail('candidate publication gate differs from its target/content evidence');

  const expectedCandidate = options.expectedInputs
    ? compileW08Candidate(options.expectedInputs)
    : options.expectedBuild
      ? options.expectedBuild.envelope ? options.expectedBuild : compileW08Candidate(options.expectedBuild)
      : null;
  if (expectedCandidate) assertCandidatePackagesEqual(candidate, expectedCandidate, 'expected pinned inputs/build');
  return candidate;
}

function assertCandidatePackagesEqual(actual, expected, label) {
  const actualFiles = candidateFileBytes(actual);
  const expectedFiles = candidateFileBytes(expected);
  if (actualFiles.size !== expectedFiles.size) fail('candidate package differs from ' + label);
  for (const [relativePath, expectedBytes] of expectedFiles) {
    const actualBytes = actualFiles.get(relativePath);
    if (!Buffer.isBuffer(actualBytes) || !actualBytes.equals(expectedBytes)) fail('candidate package differs from ' + label + ': ' + relativePath);
  }
  return true;
}

function candidateFileBytes(candidate) {
  validateW08Candidate(candidate);
  const output = new Map([
    ['candidate.json', jsonBytes(candidate.envelope)],
    [packagePathForManifestUrl(candidate.envelope.manifest.path), candidate.manifestBytes],
  ]);
  for (const row of candidate.manifest.files) output.set(expectedDomainPath(candidate.manifest.dataRevision, row.path), resolveFileBytes(candidate.files, row.path));
  return output;
}

async function ensureNoSymlinkAncestors(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  const rest = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const segment of rest) {
    cursor = path.join(cursor, segment);
    let info;
    try { info = await lstat(cursor); }
    catch (error) { if (error?.code === 'ENOENT') break; throw error; }
    if (info.isSymbolicLink()) fail('candidate output path may not traverse a symlink: ' + cursor);
  }
}

export async function writeW08Candidate(candidate, outRoot) {
  if (typeof outRoot !== 'string' || outRoot.trim() === '') fail('W08 output directory is required');
  const outputRoot = path.resolve(outRoot);
  await ensureNoSymlinkAncestors(outputRoot);
  const parent = path.dirname(outputRoot);
  await lstatDirectory(parent, 'W08 output parent');
  try {
    await lstat(outputRoot);
    fail('W08 output directory already exists; immutable candidates are never overwritten');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const files = candidateFileBytes(candidate);
  let created = false;
  try {
    await mkdir(outputRoot, { recursive: false });
    created = true;
    for (const [relativePath, bytes] of files) {
      requireRelativePath(relativePath, 'candidate output path');
      const absolute = path.resolve(outputRoot, ...relativePath.split('/'));
      const relative = path.relative(outputRoot, absolute);
      if (relative === '' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail('candidate output path escapes output directory');
      const parentPath = path.dirname(absolute);
      await mkdir(parentPath, { recursive: true });
      await writeFile(absolute, bytes, { flag: 'wx' });
    }
    await validateW08CandidateDirectory(outputRoot, { expectedCandidate: candidate });
    return outputRoot;
  } catch (error) {
    if (created) await rm(outputRoot, { recursive: true, force: true });
    throw error;
  }
}

async function collectPackageFiles(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    const absolute = path.join(root, ...relative.split('/'));
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) fail('candidate package contains a symlink: ' + relative);
    if (info.isDirectory()) result.push(...await collectPackageFiles(root, relative));
    else if (info.isFile()) result.push(relative);
    else fail('candidate package contains an unsupported filesystem entry: ' + relative);
  }
  return result.sort(compareUtf8);
}

export async function validateW08CandidateDirectory(packageRoot, options = {}) {
  if (typeof packageRoot !== 'string' || packageRoot.trim() === '') fail('W08 candidate package root is required');
  const absoluteRoot = path.resolve(packageRoot);
  await lstatDirectory(absoluteRoot, 'W08 candidate package root');
  const root = await realpath(absoluteRoot);
  const candidateBytes = (await readPinnedFile(root, 'candidate.json', null, 'candidate.json')).bytes;
  const envelope = parseJson(candidateBytes, 'candidate.json');
  if (!isRecord(envelope.manifest) || typeof envelope.manifest.path !== 'string'
    || envelope.manifest.path !== buildManifestPath(envelope.manifest.dataRevision)) {
    fail('candidate envelope does not declare its immutable manifest path');
  }
  const manifestPackagePath = packagePathForManifestUrl(envelope.manifest.path);
  const manifestBytes = (await readPinnedFile(root, manifestPackagePath, null, manifestPackagePath)).bytes;
  const manifest = parseJson(manifestBytes, envelope.manifest.path);
  const files = new Map();
  for (const row of manifest.files ?? []) {
    const relativePath = expectedDomainPath(manifest.dataRevision, row.path);
    const file = await readPinnedFile(root, relativePath, row, relativePath);
    files.set(row.path, file.bytes);
  }
  const candidate = { envelope, manifest, files, manifestBytes };
  validateW08Candidate(candidate);
  const expectedCandidate = options.expectedCandidate
    ?? (options.expectedInputs ? compileW08Candidate(options.expectedInputs) : null)
    ?? (options.expectedBuild ? options.expectedBuild.envelope ? options.expectedBuild : compileW08Candidate(options.expectedBuild) : null);
  if (expectedCandidate) assertCandidatePackagesEqual(candidate, expectedCandidate, 'expected pinned inputs');
  else {
    const rebuilt = await buildW08CandidateFromRepository({
      repoRoot: options.repoRoot ?? REPO_ROOT,
      ...(options.retainedNameRoots ? { retainedNameRoots: options.retainedNameRoots } : {}),
    });
    assertCandidatePackagesEqual(candidate, rebuilt, 'pinned repository inputs');
  }
  const expected = ['candidate.json', manifestPackagePath, ...manifest.files.map(row => expectedDomainPath(manifest.dataRevision, row.path))].sort(compareUtf8);
  const actual = await collectPackageFiles(root);
  if (canonicalJson(actual) !== canonicalJson(expected)) fail('candidate package contains missing or unlisted files');
  if (actual.includes('version.json')) fail('candidate package must not contain a published version pointer');
  return { candidate, files: actual };
}

export function selectW08ConsumerFiles(manifest, selection) {
  return selectConsumerFiles(manifest, selection);
}

export function parseW08CliArgs(args) {
  const options = { command: 'validate', outRoot: null, candidateRoot: null, retainedModsRoot: null, retainedSourceRoot: null, retainedSourceBytesRoot: null };
  let commandSelected = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--out-root' && !commandSelected && args[index + 1] && !args[index + 1].startsWith('--')) {
      options.command = 'write';
      options.outRoot = args[++index];
      commandSelected = true;
    } else if (argument === '--check-gate' && !commandSelected) {
      options.command = 'gate';
      if (args[index + 1] && !args[index + 1].startsWith('--')) options.candidateRoot = args[++index];
      commandSelected = true;
    } else if (argument === '--retained-mods-root' && args[index + 1] && !args[index + 1].startsWith('--')) {
      options.retainedModsRoot = args[++index];
    } else if (argument === '--retained-source-root' && args[index + 1] && !args[index + 1].startsWith('--')) {
      options.retainedSourceRoot = args[++index];
    } else if (argument === '--retained-source-bytes-root' && args[index + 1] && !args[index + 1].startsWith('--')) {
      options.retainedSourceBytesRoot = args[++index];
    } else {
      fail('Usage: contract-w08-build.mjs [--out-root <new-directory> | --check-gate [candidate-directory]] [--retained-mods-root <checkout> --retained-source-root <checkout> [--retained-source-bytes-root <root>]]');
    }
  }
  if (Boolean(options.retainedModsRoot) !== Boolean(options.retainedSourceRoot)) {
    fail('retained-name verification requires both --retained-mods-root and --retained-source-root');
  }
  if (options.retainedModsRoot) options.retainedNameRoots = {
    modsRoot: options.retainedModsRoot,
    sourceRoot: options.retainedSourceRoot,
    ...(options.retainedSourceBytesRoot ? { sourceBytesRoot: options.retainedSourceBytesRoot } : {}),
  };
  delete options.retainedModsRoot;
  delete options.retainedSourceRoot;
  delete options.retainedSourceBytesRoot;
  return options;
}

async function runW08Cli(args = process.argv.slice(2)) {
  const options = parseW08CliArgs(args);
  const candidate = options.candidateRoot
    ? (await validateW08CandidateDirectory(options.candidateRoot, options)).candidate
    : await buildW08CandidateFromRepository(options);
  if (options.command === 'write') {
    const outputRoot = await writeW08Candidate(candidate, options.outRoot);
    process.stdout.write(JSON.stringify({ valid: true, candidateOnly: true, outputRoot,
      dataRevision: candidate.manifest.dataRevision, publicationGate: candidate.envelope.publicationGate }) + '\n');
    return;
  }
  if (options.command === 'gate') {
    const gate = candidate.envelope.publicationGate;
    process.stdout.write(JSON.stringify({ valid: true, publicationGate: gate }) + '\n');
    if (gate.status === 'blocked') process.exitCode = 2;
    return;
  }
  validateW08Candidate(candidate);
  process.stdout.write(JSON.stringify({ valid: true, candidateOnly: true,
    dataRevision: candidate.manifest.dataRevision, domainCount: candidate.manifest.files.length,
    publicationGate: candidate.envelope.publicationGate }) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runW08Cli().catch(error => {
    process.stderr.write('W08: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
