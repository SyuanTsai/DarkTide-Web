import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const SOURCE_REPOSITORY = 'SyuanTsai/DarkTide-Source-Data';
const PROPOSAL_ROOT = 'content/contracts/w09/proposals';
const MANIFEST_NAME = 'manifest.json';
const MANIFEST_LIMIT_BYTES = 200 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const RELEASE_ID = /^w09-[a-f0-9]{32}$/u;
const PROPOSAL_ID = /^[a-f0-9]{64}$/u;
const REQUIRED_FILES = Object.freeze([
  'proposal.json',
  'review-candidate.json',
  'source-lock.json',
  'web-input-lock.json',
]);
const PACKET_PATHS = Object.freeze([
  'analysis.md',
  'source-revision.json',
  'source-revision.md',
  'source-manifest.json',
  'source-receipt.json',
  'technical.json',
]);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sortPaths = rows => rows.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
const canonicalJson = value => Array.isArray(value)
  ? '[' + value.map(canonicalJson).join(',') + ']'
  : isRecord(value)
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
    : JSON.stringify(value);

function exactKeys(value, keys, label) {
  if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError(label + ' has missing or unsupported fields');
  }
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || value.includes('\\') || value.startsWith('/') || value.includes('\0')) {
    throw new TypeError(label + ' must be a safe POSIX relative path');
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..') || path.posix.normalize(value) !== value
      || !/^[A-Za-z0-9._/-]+$/u.test(value)) {
    throw new TypeError(label + ' must not escape its proposal directory');
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(label + ' must be a lowercase SHA-256 digest');
}

function validateProposalIdentity(proposal, label = 'W09 proposal manifest proposal') {
  exactKeys(proposal, [
    'requestId',
    'releaseId',
    'gameReleaseId',
    'sourceCommit',
    'sourceRevision',
    'manifestSha256',
    'archiveSha256',
    'packetFiles',
  ], label);
  assertSha256(proposal.requestId, label + '.requestId');
  if (!RELEASE_ID.test(proposal.releaseId)) throw new TypeError(label + '.releaseId must be a derived W09 release identity');
  if (typeof proposal.gameReleaseId !== 'string' || proposal.gameReleaseId.trim() === '') throw new TypeError(label + '.gameReleaseId is required');
  if (!COMMIT.test(proposal.sourceCommit)) throw new TypeError(label + '.sourceCommit must be a full Git commit');
  assertSha256(proposal.sourceRevision, label + '.sourceRevision');
  assertSha256(proposal.manifestSha256, label + '.manifestSha256');
  assertSha256(proposal.archiveSha256, label + '.archiveSha256');
  const derivedReleaseId = 'w09-' + createHash('sha256')
    .update(canonicalJson({ gameReleaseId: proposal.gameReleaseId, sourceRevision: proposal.sourceRevision }))
    .digest('hex')
    .slice(0, 32);
  if (proposal.releaseId !== derivedReleaseId) throw new Error(label + '.releaseId is not derived from its Source identity');
  if (!Array.isArray(proposal.packetFiles) || proposal.packetFiles.length !== PACKET_PATHS.length) {
    throw new TypeError(label + '.packetFiles must pin the exact Source packet');
  }
  proposal.packetFiles.forEach((row, index) => {
    exactKeys(row, ['path', 'sha256', 'sizeBytes'], label + '.packetFiles[' + index + ']');
    if (row.path !== PACKET_PATHS[index]) throw new Error(label + '.packetFiles paths are not the fixed Source packet');
    assertSha256(row.sha256, label + '.packetFiles[' + index + '].sha256');
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0) throw new TypeError(label + '.packetFiles size must be a non-negative safe integer');
  });
  return proposal;
}

function proposalIdentity(proposal) {
  return validateProposalIdentity({
    requestId: proposal.requestId,
    releaseId: proposal.releaseId,
    gameReleaseId: proposal.gameReleaseId,
    sourceCommit: proposal.sourceCommit,
    sourceRevision: proposal.sourceRevision,
    manifestSha256: proposal.manifestSha256,
    archiveSha256: proposal.archiveSha256,
    packetFiles: proposal.packetFiles,
  }, 'W09 proposal');
}

function assertExpectedIdentity(proposal, expectedReleaseId, expectedSourceRevision) {
  if (expectedReleaseId !== undefined && proposal.releaseId !== expectedReleaseId) {
    throw new Error('W09 proposal manifest releaseId differs from the verified Source release event');
  }
  if (expectedSourceRevision !== undefined && proposal.sourceRevision !== expectedSourceRevision) {
    throw new Error('W09 proposal manifest sourceRevision differs from the verified Source replay');
  }
}

export function validateW09ProposalManifest(manifest, { expectedReleaseId, expectedSourceRevision } = {}) {
  exactKeys(manifest, ['schema', 'source', 'proposal', 'files'], 'W09 proposal manifest');
  if (manifest.schema !== 'w09-proposal-manifest/1') throw new TypeError('W09 proposal manifest schema is unsupported');
  exactKeys(manifest.source, ['repository', 'releaseId', 'archiveSha256'], 'W09 proposal manifest source');
  if (manifest.source.repository !== SOURCE_REPOSITORY) throw new Error('W09 proposal manifest Source repository is not official');
  if (!RELEASE_ID.test(manifest.source.releaseId)) throw new TypeError('W09 proposal manifest Source releaseId is malformed');
  assertSha256(manifest.source.archiveSha256, 'W09 proposal manifest source.archiveSha256');
  const proposal = validateProposalIdentity(manifest.proposal);
  if (manifest.source.releaseId !== proposal.releaseId || manifest.source.archiveSha256 !== proposal.archiveSha256) {
    throw new Error('W09 proposal manifest Source locator differs from its proposal identity');
  }
  assertExpectedIdentity(proposal, expectedReleaseId, expectedSourceRevision);
  if (!Array.isArray(manifest.files) || manifest.files.length < REQUIRED_FILES.length) {
    throw new TypeError('W09 proposal manifest must pin every generated proposal file');
  }
  const paths = [];
  for (const [index, row] of manifest.files.entries()) {
    exactKeys(row, ['path', 'sizeBytes', 'sha256'], 'W09 proposal manifest files[' + index + ']');
    safeRelativePath(row.path, 'W09 proposal manifest files[' + index + '].path');
    if (!REQUIRED_FILES.includes(row.path) && !row.path.startsWith('candidate/')) {
      throw new Error('W09 proposal manifest contains a path outside the generated proposal file set');
    }
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0) throw new TypeError('W09 proposal manifest file size must be a non-negative safe integer');
    assertSha256(row.sha256, 'W09 proposal manifest files[' + index + '].sha256');
    paths.push(row.path);
  }
  if (new Set(paths).size !== paths.length || JSON.stringify(paths) !== JSON.stringify(sortPaths([...paths]))) {
    throw new Error('W09 proposal manifest file paths must be unique and sorted');
  }
  if (REQUIRED_FILES.some(required => !paths.includes(required))) throw new Error('W09 proposal manifest omits a required proposal file');
  return manifest;
}

async function regularDirectory(directory, label) {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(label + ' must be a regular directory');
}

async function regularFile(filePath, label) {
  const info = await lstat(filePath);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(label + ' must be a regular file');
  return readFile(filePath);
}

async function candidatePaths(proposalDirectory) {
  const root = path.join(proposalDirectory, 'candidate');
  const rootInfo = await lstat(root).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!rootInfo) return [];
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('W09 proposal candidate must be a regular directory');
  const files = [];
  const visit = async (directory, prefix) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix + '/' + entry.name;
      safeRelativePath(relativePath, 'W09 generated proposal path');
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error('W09 generated proposal may not contain symbolic links');
      if (info.isDirectory()) await visit(absolute, relativePath);
      else if (info.isFile()) files.push(relativePath);
      else throw new Error('W09 generated proposal may contain only regular files and directories');
    }
  };
  await visit(root, 'candidate');
  return files;
}

async function generatedPaths(proposalDirectory) {
  for (const required of REQUIRED_FILES) await regularFile(path.join(proposalDirectory, required), 'W09 generated proposal file ' + required);
  return sortPaths([...REQUIRED_FILES, ...await candidatePaths(proposalDirectory)]);
}

async function readManifest(proposalDirectory, expected = {}) {
  const manifestBytes = await regularFile(path.join(proposalDirectory, MANIFEST_NAME), 'W09 proposal manifest');
  if (manifestBytes.byteLength >= MANIFEST_LIMIT_BYTES) throw new Error('W09 proposal manifest exceeds the 200 KiB candidate PR limit');
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error('W09 proposal manifest is not valid JSON');
  }
  return { manifest: validateW09ProposalManifest(manifest, expected), manifestBytes };
}

async function verifyProposalMetadata(proposalDirectory, manifest, expected) {
  const proposalBytes = await regularFile(path.join(proposalDirectory, 'proposal.json'), 'W09 proposal.json');
  let proposal;
  try {
    proposal = JSON.parse(proposalBytes.toString('utf8'));
  } catch {
    throw new Error('W09 proposal.json is not valid JSON');
  }
  if (proposal.schema !== 'w09-source-composition-proposal/1' || proposal.selected !== false
      || proposal.allocationReserved !== false || proposal.publicationEligible !== false) {
    throw new Error('W09 proposal metadata is not an unselected review candidate');
  }
  const identity = proposalIdentity(proposal);
  assertExpectedIdentity(identity, expected.expectedReleaseId, expected.expectedSourceRevision);
  if (canonicalJson(identity) !== canonicalJson(manifest.proposal)) {
    throw new Error('W09 proposal manifest identity differs from proposal.json');
  }
  return proposal;
}

export async function verifyW09ProposalManifestDirectory({
  proposalDirectory,
  expectedReleaseId,
  expectedSourceRevision,
} = {}) {
  if (typeof proposalDirectory !== 'string') throw new TypeError('proposalDirectory is required');
  const absolute = path.resolve(proposalDirectory);
  await regularDirectory(absolute, 'W09 proposal directory');
  const expected = { expectedReleaseId, expectedSourceRevision };
  const { manifest, manifestBytes } = await readManifest(absolute, expected);
  const actualPaths = await generatedPaths(absolute);
  const manifestPaths = manifest.files.map(row => row.path);
  if (JSON.stringify(actualPaths) !== JSON.stringify(manifestPaths)) {
    throw new Error('W09 proposal reconstruction file set differs from its manifest');
  }
  for (const row of manifest.files) {
    const bytes = await regularFile(path.join(absolute, ...row.path.split('/')), 'W09 reconstructed proposal file ' + row.path);
    if (bytes.byteLength !== row.sizeBytes || sha256(bytes) !== row.sha256) {
      throw new Error('W09 proposal reconstruction differs from its manifest SHA-256: ' + row.path);
    }
  }
  const proposal = await verifyProposalMetadata(absolute, manifest, expected);
  return {
    proposal,
    manifest,
    manifestBytes,
    manifestPath: path.join(absolute, MANIFEST_NAME),
    generatedPaths: manifestPaths,
  };
}

export async function writeW09ProposalManifest({
  proposalDirectory,
  expectedReleaseId,
  expectedSourceRevision,
  expectedManifestBytes,
} = {}) {
  if (typeof proposalDirectory !== 'string') throw new TypeError('proposalDirectory is required');
  const absolute = path.resolve(proposalDirectory);
  await regularDirectory(absolute, 'W09 proposal directory');
  const paths = await generatedPaths(absolute);
  const proposalBytes = await regularFile(path.join(absolute, 'proposal.json'), 'W09 proposal.json');
  let proposalDocument;
  try {
    proposalDocument = JSON.parse(proposalBytes.toString('utf8'));
  } catch {
    throw new Error('W09 proposal.json is not valid JSON');
  }
  if (proposalDocument.schema !== 'w09-source-composition-proposal/1' || proposalDocument.selected !== false
      || proposalDocument.allocationReserved !== false || proposalDocument.publicationEligible !== false) {
    throw new Error('W09 proposal metadata is not an unselected review candidate');
  }
  const proposal = proposalIdentity(proposalDocument);
  assertExpectedIdentity(proposal, expectedReleaseId, expectedSourceRevision);
  const files = [];
  for (const relativePath of paths) {
    const bytes = await regularFile(path.join(absolute, ...relativePath.split('/')), 'W09 generated proposal file ' + relativePath);
    files.push({ path: relativePath, sizeBytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const manifest = validateW09ProposalManifest({
    schema: 'w09-proposal-manifest/1',
    source: {
      repository: SOURCE_REPOSITORY,
      releaseId: proposal.releaseId,
      archiveSha256: proposal.archiveSha256,
    },
    proposal,
    files,
  }, { expectedReleaseId, expectedSourceRevision });
  const manifestBytes = Buffer.from(canonicalJson(manifest) + '\n');
  if (manifestBytes.byteLength >= MANIFEST_LIMIT_BYTES) throw new Error('W09 proposal manifest exceeds the 200 KiB candidate PR limit');
  if (expectedManifestBytes !== undefined && !manifestBytes.equals(Buffer.from(expectedManifestBytes))) {
    throw new Error('W09 proposal reconstruction differs from its existing manifest');
  }
  const manifestPath = path.join(absolute, MANIFEST_NAME);
  const existing = await readFile(manifestPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (existing) {
    if (!existing.equals(manifestBytes)) throw new Error('existing W09 proposal manifest conflicts with reconstructed bytes');
  } else {
    await writeFile(manifestPath, manifestBytes, { flag: 'wx' });
  }
  await verifyW09ProposalManifestDirectory({ proposalDirectory: absolute, expectedReleaseId, expectedSourceRevision });
  return { manifest, manifestBytes, manifestPath, generatedPaths: paths };
}

async function restoreReviewArtifacts(backupDirectory, proposalDirectory, generated) {
  const visit = async (source, relative = '') => {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const relativePath = relative ? relative + '/' + entry.name : entry.name;
      safeRelativePath(relativePath, 'W09 retained proposal review path');
      if (relativePath === MANIFEST_NAME || generated.has(relativePath)) continue;
      const sourcePath = path.join(source, entry.name);
      const info = await lstat(sourcePath);
      if (info.isSymbolicLink()) throw new Error('W09 retained proposal review paths may not contain symbolic links');
      const destination = path.join(proposalDirectory, ...relativePath.split('/'));
      if (info.isDirectory()) {
        await mkdir(destination, { recursive: true });
        await visit(sourcePath, relativePath);
      } else if (info.isFile()) {
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, await readFile(sourcePath), { flag: 'wx' });
      } else {
        throw new Error('W09 retained proposal review paths may contain only regular files and directories');
      }
    }
  };
  await visit(backupDirectory);
}

function proposalDirectoryPath(repoRoot, proposalDirectory) {
  const root = path.resolve(repoRoot, PROPOSAL_ROOT);
  const absolute = path.resolve(proposalDirectory);
  const relative = path.relative(root, absolute);
  if (!PROPOSAL_ID.test(relative) || path.dirname(relative) !== '.') {
    throw new Error('W09 proposal writer returned a path outside the immutable proposal namespace');
  }
  return { root, absolute };
}

export async function replayW09ProposalFromManifest({ repoRoot, releaseId, replay } = {}) {
  if (typeof repoRoot !== 'string' || typeof replay !== 'function') throw new TypeError('repoRoot and replay are required');
  if (typeof releaseId !== 'string' || !RELEASE_ID.test(releaseId)) throw new TypeError('releaseId must be a derived W09 Source identity');
  const proposalRoot = path.resolve(repoRoot, PROPOSAL_ROOT);
  await mkdir(proposalRoot, { recursive: true });
  await regularDirectory(proposalRoot, 'W09 proposal root');
  const backupRoot = await mkdtemp(path.join(proposalRoot, '.manifest-replay-'));
  const detached = [];
  let replayedDirectory = null;
  try {
    for (const entry of await readdir(proposalRoot, { withFileTypes: true })) {
      if (!PROPOSAL_ID.test(entry.name)) continue;
      const original = path.join(proposalRoot, entry.name);
      const manifestInfo = await lstat(path.join(original, MANIFEST_NAME)).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (!manifestInfo) continue;
      if (manifestInfo.isSymbolicLink() || !manifestInfo.isFile()) throw new Error('W09 proposal manifest must be a regular file');
      const { manifest, manifestBytes } = await readManifest(original);
      if (manifest.source.releaseId !== releaseId) continue;
      const backup = path.join(backupRoot, entry.name);
      await rename(original, backup);
      detached.push({ original, backup, manifest, manifestBytes });
    }

    const result = await replay();
    if (!result?.proposalWritten) {
      for (const item of detached) await rename(item.backup, item.original);
      return result;
    }
    if (typeof result.sourceRevision !== 'string' || !SHA256.test(result.sourceRevision)) {
      throw new Error('W09 proposal replay did not return a full sourceRevision');
    }
    const resolved = proposalDirectoryPath(repoRoot, result.proposalDirectory);
    replayedDirectory = resolved.absolute;
    const prior = detached.find(item => item.original === replayedDirectory);
    const written = await writeW09ProposalManifest({
      proposalDirectory: replayedDirectory,
      expectedReleaseId: releaseId,
      expectedSourceRevision: result.sourceRevision,
      ...(prior ? { expectedManifestBytes: prior.manifestBytes } : {}),
    });

    for (const item of detached) {
      if (item.original === replayedDirectory) {
        await restoreReviewArtifacts(item.backup, replayedDirectory, new Set(item.manifest.files.map(row => row.path)));
        await rm(item.backup, { recursive: true, force: true });
      } else {
        await rename(item.backup, item.original);
      }
    }
    return {
      ...result,
      manifestPath: written.manifestPath,
      manifest: written.manifest,
      generatedPaths: written.generatedPaths,
    };
  } catch (error) {
    if (replayedDirectory) await rm(replayedDirectory, { recursive: true, force: true });
    for (const item of detached) {
      await rm(item.original, { recursive: true, force: true });
      const backupInfo = await lstat(item.backup).catch(inner => inner.code === 'ENOENT' ? null : Promise.reject(inner));
      if (backupInfo) await rename(item.backup, item.original);
    }
    throw error;
  } finally {
    await rm(backupRoot, { recursive: true, force: true });
  }
}
