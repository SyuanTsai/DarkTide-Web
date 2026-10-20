import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const W09_SOURCE_REPOSITORY = 'SyuanTsai/DarkTide-Source-Data';
export const W09_WEB_REPOSITORY = 'SyuanTsai/DarkTide-Web';
export const W09_SOURCE_ORIGIN = 'https://github.com/SyuanTsai/DarkTide-Source-Data.git';
export const W09_ACCEPTED_W07_BASELINE_COMMIT = '8e48334619f448794aab666f1805cb2bd6adf11a';
export const W09_ACCEPTED_W07_BASELINE_SHA256 = 'a728b2e8dc65078ade88b01f87537323eb781fc8665f16c8166140292eb63acb';
export const W09_SOURCE_PACKET_FILES = Object.freeze([
  'analysis.md', 'source-revision.json', 'source-revision.md', 'source-manifest.json', 'source-receipt.json', 'technical.json'
]);
export const W09_SOURCE_INPUT_PATHS = Object.freeze({
  w05: 'content/authoring/v2/w05-psyker.json',
  w06: 'content/authoring/v2/w06-skills-blessings.json',
  w07: 'content/authoring/v2/w07-weapons.json'
});
export const W09_SOURCE_INPUT_PRESETS = Object.freeze({
  acceptedW07: Object.freeze({
    baseline: Object.freeze({ commit: W09_ACCEPTED_W07_BASELINE_COMMIT, path: W09_SOURCE_INPUT_PATHS.w07, sha256: W09_ACCEPTED_W07_BASELINE_SHA256 }),
    authoring: Object.freeze({ commit: 'current', path: W09_SOURCE_INPUT_PATHS.w07 }),
    candidate: Object.freeze({ commit: 'current', path: W09_SOURCE_INPUT_PATHS.w07 })
  })
});

const REQUEST_SCHEMA = 'w09-source-request/1';
const ARCHIVE_SCHEMA = 'w09-source-release-archive/1';
const SHA256_RE = /^[a-f0-9]{64}$/u;
const COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SOURCE_ROLES = Object.freeze(['baseline', 'authoring', 'candidate']);
const ALLOWED_INPUT_PATHS = new Set(Object.values(W09_SOURCE_INPUT_PATHS));
const ALLOWED_KINDS = new Set([
  'skill', 'blessing', 'blessing-variant', 'weapon', 'attack-profile', 'stat-definition', 'stat-curve',
  'damage-profile', 'armor-class', 'target-profile', 'modifier-rule', 'claim', 'evidence', 'term', 'catalog',
  'curio', 'perk', 'classification', 'game-change', 'release-compatibility'
]);
const REGISTRIES = Object.freeze(['gameReleases', 'sourceSnapshots', 'sourceRefs', 'records', 'tombstones']);
const MANIFEST_FILE_NAMES = Object.freeze(['analysis.md', 'source-revision.json', 'source-revision.md', 'technical.json']);
const PINNED_BUILD_FILES = Object.freeze([
  'scripts/content/contract-w05-build.mjs',
  'scripts/content/contract-w05-merge.mjs',
  'scripts/content/contract-validator.mjs',
  'content/schema/v2/source-contract.schema.json'
]);
const DISPATCH_ENDPOINT = `https://api.github.com/repos/${W09_WEB_REPOSITORY}/dispatches`;
const SOURCE_RELEASES_ENDPOINT = `https://api.github.com/repos/${W09_SOURCE_REPOSITORY}/releases`;
const SOURCE_GIT_ENDPOINT = `https://api.github.com/repos/${W09_SOURCE_REPOSITORY}/git`;
const SOURCE_ARCHIVE_ASSET_PREFIX = 'w09-source-archive-';
const SOURCE_ARCHIVE_ASSET_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const MAX_SOURCE_ARCHIVE_REDIRECTS = 3;
const ARCHIVE_REQUEST_HEADERS = Object.freeze({
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'User-Agent': 'darktide-source-w09-handoff',
  'X-GitHub-Api-Version': '2026-03-10'
});
const DEFAULT_MODE = 'candidate';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeJsonValue(value, label = 'value') {
  const active = new WeakSet();
  const visit = (node, pointer) => {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) throw new Error(`${label} has a non-finite number at ${pointer || '/'}`);
      return;
    }
    if (typeof node !== 'object') throw new Error(`${label} is not JSON data at ${pointer || '/'}`);
    if (active.has(node)) throw new Error(`${label} is circular at ${pointer || '/'}`);
    active.add(node);
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${pointer}/${index}`));
    } else {
      if (!isPlainObject(node)) throw new Error(`${label} contains a non-plain object at ${pointer || '/'}`);
      for (const [key, child] of Object.entries(node)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`${label} contains an unsafe key`);
        visit(child, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
      }
    }
    active.delete(node);
  };
  visit(value, '');
  return value;
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  assertSafeJsonValue(value);
  return JSON.stringify(sortJson(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Canonical(value) {
  return sha256(canonicalJson(value));
}

function compareLexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(sortJson(value), null, 2)}\n`, 'utf8');
}

function exactKeys(value, expected, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) throw new Error(`${label} has missing or unsupported fields`);
}

function nonEmptyString(value, label, { max = 500 } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function validateDigest(value, label) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

function releaseIdFor(sourceRevision, gameReleaseId) {
  return `w09-${sha256Canonical({ sourceRevision, gameReleaseId }).slice(0, 32)}`;
}

function requestIdFor({ repository, sourceRevision, manifestSha256, gameReleaseId }) {
  return sha256Canonical({ schema: REQUEST_SCHEMA, repository, sourceRevision, manifestSha256, gameReleaseId });
}

function validateInputRefs(sourceInputs, sourceCommit) {
  if (!Array.isArray(sourceInputs) || sourceInputs.length !== SOURCE_ROLES.length) {
    throw new Error('sourceInputs must pin the baseline, authoring, and candidate inputs');
  }
  sourceInputs.forEach((input, index) => {
    exactKeys(input, ['role', 'commit', 'path', 'sha256'], `sourceInputs[${index}]`);
    if (input.role !== SOURCE_ROLES[index]) throw new Error('sourceInputs must be ordered baseline, authoring, candidate');
    if (typeof input.commit !== 'string' || !COMMIT_RE.test(input.commit)) throw new Error(`sourceInputs[${index}].commit must be a full Git commit SHA`);
    if (!ALLOWED_INPUT_PATHS.has(input.path)) throw new Error(`sourceInputs[${index}] path is not an approved fixed authoring input`);
    validateDigest(input.sha256, `sourceInputs[${index}].sha256`);
    if (input.role !== 'baseline' && input.commit !== sourceCommit) {
      throw new Error(`${input.role} must be pinned to request.sourceCommit`);
    }
    if (input.role === 'baseline' && input.commit !== sourceCommit) {
      if (input.commit === W09_ACCEPTED_W07_BASELINE_COMMIT
          && (input.path !== W09_SOURCE_INPUT_PATHS.w07 || input.sha256 !== W09_ACCEPTED_W07_BASELINE_SHA256)) {
        throw new Error('the accepted W07 baseline commit must keep its fixed path and hash');
      }
    }
  });
}

function validatePacketFiles(packetFiles) {
  if (!Array.isArray(packetFiles) || packetFiles.length !== W09_SOURCE_PACKET_FILES.length) {
    throw new Error('packetFiles must describe the exact six-file W05 packet');
  }
  packetFiles.forEach((file, index) => {
    exactKeys(file, ['path', 'sha256', 'sizeBytes'], `packetFiles[${index}]`);
    if (file.path !== W09_SOURCE_PACKET_FILES[index]) throw new Error('packetFiles must use the fixed W05 file list and order');
    validateDigest(file.sha256, `packetFiles[${index}].sha256`);
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) throw new Error(`packetFiles[${index}].sizeBytes must be a non-negative safe integer`);
  });
}

function validateChangedRecords(changedRecords) {
  if (!Array.isArray(changedRecords)) throw new Error('changedRecords must be an array');
  const seen = new Set();
  for (const [index, item] of changedRecords.entries()) {
    const keys = ['registry', 'gameReleaseId', 'recordId', 'kind', 'change'];
    if (item && Object.hasOwn(item, 'fields')) keys.push('fields');
    exactKeys(item, keys, `changedRecords[${index}]`);
    if (!['records', 'tombstones'].includes(item.registry)) throw new Error(`changedRecords[${index}].registry is invalid`);
    nonEmptyString(item.gameReleaseId, `changedRecords[${index}].gameReleaseId`);
    nonEmptyString(item.recordId, `changedRecords[${index}].recordId`);
    if (item.kind !== null && (typeof item.kind !== 'string' || !ALLOWED_KINDS.has(item.kind))) {
      throw new Error(`changedRecords[${index}].kind must be a known Source kind or null`);
    }
    if (!['added', 'updated', 'removed'].includes(item.change)) throw new Error(`changedRecords[${index}].change is invalid`);
    if (item.change === 'updated') {
      if (!Array.isArray(item.fields) || item.fields.length === 0 || item.fields.some((field) => typeof field !== 'string' || !field.startsWith('/'))) {
        throw new Error(`changedRecords[${index}].fields must contain JSON Pointer paths for updates`);
      }
    } else if (Object.hasOwn(item, 'fields')) {
      throw new Error(`changedRecords[${index}] may include fields only for updates`);
    }
    const key = canonicalJson([item.registry, item.gameReleaseId, item.recordId, item.change]);
    if (seen.has(key)) throw new Error('changedRecords contains a duplicate tuple');
    seen.add(key);
  }
}

function deriveEligibility({ mode, manifest, receipt, technical }) {
  const publicationEligible = technical.publicationEligible === true && receipt.publicationEligible === true;
  const buildIdentityVerified = manifest.buildIdentity?.verified === true && receipt.buildIdentityVerified === true;
  const fixtureOnly = technical.fixtureOnly === true;
  const reasons = [];
  if (mode !== 'formal') reasons.push('candidate mode is preview-only');
  if (receipt.validation?.result !== 'valid') reasons.push('Source contract validation is not valid');
  if (fixtureOnly) reasons.push('fixture-only Source data cannot be formally released');
  if (!publicationEligible) reasons.push('Source contract does not contain current human approvals');
  if (!buildIdentityVerified) reasons.push('game build identity is not verified');
  const status = mode === 'formal' && reasons.length === 0 ? 'eligible' : 'pending';
  return { mode, status, publicationEligible, buildIdentityVerified, fixtureOnly, reasons };
}

function validateEligibility(eligibility) {
  exactKeys(eligibility, ['mode', 'status', 'publicationEligible', 'buildIdentityVerified', 'fixtureOnly', 'reasons'], 'eligibility');
  if (!['candidate', 'formal'].includes(eligibility.mode)) throw new Error('eligibility.mode must be candidate or formal');
  if (!['pending', 'eligible'].includes(eligibility.status)) throw new Error('eligibility.status is invalid');
  for (const key of ['publicationEligible', 'buildIdentityVerified', 'fixtureOnly']) {
    if (typeof eligibility[key] !== 'boolean') throw new Error(`eligibility.${key} must be boolean`);
  }
  if (!Array.isArray(eligibility.reasons) || eligibility.reasons.some((reason) => typeof reason !== 'string' || reason.length === 0)) {
    throw new Error('eligibility.reasons must be an array of non-empty strings');
  }
  const shouldBeEligible = eligibility.mode === 'formal' && eligibility.publicationEligible
    && eligibility.buildIdentityVerified && !eligibility.fixtureOnly && eligibility.reasons.length === 0;
  if (eligibility.status !== (shouldBeEligible ? 'eligible' : 'pending')) throw new Error('eligibility.status does not match its gate evidence');
}

export function validateW09SourceRequest(request) {
  exactKeys(request, [
    'schema', 'repository', 'sourceCommit', 'sourceRevision', 'manifestSha256', 'gameReleaseId', 'releaseId', 'requestId',
    'sourceInputs', 'packetFiles', 'changedRecords', 'changedClaims', 'eligibility'
  ], 'request');
  if (request.schema !== REQUEST_SCHEMA) throw new Error(`request.schema must be ${REQUEST_SCHEMA}`);
  if (request.repository !== W09_SOURCE_REPOSITORY) throw new Error('request.repository is not the fixed Source repository');
  if (typeof request.sourceCommit !== 'string' || !COMMIT_RE.test(request.sourceCommit)) throw new Error('request.sourceCommit must be a full Git commit SHA');
  validateDigest(request.sourceRevision, 'request.sourceRevision');
  validateDigest(request.manifestSha256, 'request.manifestSha256');
  nonEmptyString(request.gameReleaseId, 'request.gameReleaseId');
  if (request.releaseId !== releaseIdFor(request.sourceRevision, request.gameReleaseId)) throw new Error('request.releaseId does not match the derived Source revision identity');
  if (request.requestId !== requestIdFor(request)) throw new Error('request.requestId does not match the immutable Source request identity');
  validateInputRefs(request.sourceInputs, request.sourceCommit);
  validatePacketFiles(request.packetFiles);
  validateChangedRecords(request.changedRecords);
  if (!Array.isArray(request.changedClaims)) throw new Error('changedClaims must be an array');
  const expectedClaims = request.changedRecords.filter((item) => item.kind === 'claim');
  if (canonicalJson(request.changedClaims) !== canonicalJson(expectedClaims)) {
    throw new Error('changedClaims must include every proven claim tuple from changedRecords and no unproven records');
  }
  validateEligibility(request.eligibility);
  return request;
}

function parseJson(bytes, label) {
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (!isPlainObject(parsed)) throw new Error('must contain a JSON object');
    return parsed;
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

async function assertNoSymlinkComponents(absolutePath) {
  const parsed = path.parse(absolutePath);
  const segments = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error(`path contains a symbolic link: ${current}`);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
}

async function readPacketBundle(packetDir) {
  if (typeof packetDir !== 'string' || packetDir.trim().length === 0) throw new Error('explicit packetDir is required');
  const absoluteDir = path.resolve(packetDir);
  await assertNoSymlinkComponents(absoluteDir);
  const directoryInfo = await lstat(absoluteDir);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('packetDir must be a regular directory');
  const actualNames = (await readdir(absoluteDir)).sort();
  const expectedNames = [...W09_SOURCE_PACKET_FILES].sort();
  if (canonicalJson(actualNames) !== canonicalJson(expectedNames)) throw new Error('packet directory must contain exactly the six fixed W05 files');
  const files = new Map();
  for (const name of W09_SOURCE_PACKET_FILES) {
    const filePath = path.join(absoluteDir, name);
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`packet file is not a regular file: ${name}`);
    files.set(name, await readFile(filePath));
  }
  const manifestBytes = files.get('source-manifest.json');
  const manifest = parseJson(manifestBytes, 'source-manifest.json');
  const receipt = parseJson(files.get('source-receipt.json'), 'source-receipt.json');
  const revision = parseJson(files.get('source-revision.json'), 'source-revision.json');
  const technical = parseJson(files.get('technical.json'), 'technical.json');
  const actualManifestSha = sha256(manifestBytes);
  if (manifest.schema !== 'w05-source-manifest/1' || !SHA256_RE.test(manifest.sourceRevision || '')) throw new Error('W05 manifest identity is invalid');
  if (!['candidate', 'formal'].includes(manifest.mode)) throw new Error('W05 manifest mode is invalid');
  if (revision.sourceRevision !== manifest.sourceRevision || revision.mode !== manifest.mode) throw new Error('W05 revision and manifest identities disagree');
  if (receipt.schema !== 'w05-source-build-receipt/1' || receipt.sourceRevision !== manifest.sourceRevision
      || receipt.mode !== manifest.mode || receipt.outputDirectory !== manifest.sourceRevision
      || receipt.manifestSha256 !== actualManifestSha || receipt.previewOnly !== (manifest.mode === 'candidate')) {
    throw new Error('W05 receipt does not bind to its manifest and source revision');
  }
  const { algorithm, receiptSha256, ...receiptCore } = receipt;
  if (algorithm !== 'sha256' || receiptSha256 !== sha256Canonical(receiptCore)) throw new Error('W05 receipt hash is invalid');
  if (revision.schema !== 'w05-source-revision/1' && revision.schema !== 'w05-source-revision/2') throw new Error('W05 revision schema is unsupported');
  if (!isPlainObject(revision.changes) || Object.keys(revision.changes).some((name) => !REGISTRIES.includes(name))) {
    throw new Error('W05 revision change registry list is invalid');
  }
  if (!Array.isArray(technical.gameReleases) || !Array.isArray(technical.sourceRefs)
      || !Array.isArray(technical.records) || !Array.isArray(technical.tombstones)) {
    throw new Error('W05 technical contract is missing required registries');
  }
  const expectedManifestFiles = MANIFEST_FILE_NAMES.map((name) => ({
    path: name,
    sha256: sha256(files.get(name)),
    sizeBytes: files.get(name).length
  }));
  if (canonicalJson(manifest.files) !== canonicalJson(expectedManifestFiles)) throw new Error('W05 manifest file hashes or sizes do not match packet bytes');
  const expectedBuildIdentity = {
    verified: [...technical.gameReleases.map((item) => item.gameBuild), ...technical.sourceRefs.map((item) => item.gameBuild)]
      .every((value) => typeof value === 'string' && value.trim().length > 0 && value.trim().toUpperCase() !== 'UNVERIFIED'),
    gameReleases: technical.gameReleases.map((item) => ({ gameReleaseId: item.gameReleaseId, gameBuild: item.gameBuild })),
    sourceRefs: technical.sourceRefs.map((item) => ({ gameReleaseId: item.gameReleaseId, sourceId: item.sourceId, gameBuild: item.gameBuild }))
  };
  if (canonicalJson(manifest.buildIdentity) !== canonicalJson(expectedBuildIdentity)
      || receipt.buildIdentityVerified !== expectedBuildIdentity.verified
      || receipt.publicationEligible !== (technical.publicationEligible === true)) {
    throw new Error('W05 gate metadata is not derived from technical.json');
  }
  const validation = receipt.validation;
  if (!isPlainObject(validation) || validation.contractSha256 !== sha256Canonical(technical)
      || !['valid', 'invalid'].includes(validation.result)) {
    throw new Error('W05 validation receipt does not bind to technical.json');
  }
  const { algorithm: validationAlgorithm, receiptSha256: validationSha, ...validationCore } = validation;
  if (validationAlgorithm !== 'sha256' || validationSha !== sha256Canonical(validationCore)) throw new Error('W05 validation receipt hash is invalid');
  return { packetDir: absoluteDir, files, manifest, receipt, revision, technical, manifestSha256: actualManifestSha };
}

function packetFileMetadata(bundle) {
  return W09_SOURCE_PACKET_FILES.map((filePath) => ({
    path: filePath,
    sha256: sha256(bundle.files.get(filePath)),
    sizeBytes: bundle.files.get(filePath).length
  }));
}

function ensureRequestMatchesBundle(request, bundle) {
  if (request.sourceRevision !== bundle.manifest.sourceRevision
      || request.manifestSha256 !== bundle.manifestSha256
      || request.eligibility.mode !== bundle.manifest.mode) {
    throw new Error('request identity does not match the verified W05 packet');
  }
  if (canonicalJson(request.packetFiles) !== canonicalJson(packetFileMetadata(bundle))) throw new Error('request packet file hashes or sizes disagree with packet bytes');
  const expectedEligibility = deriveEligibility({
    mode: bundle.manifest.mode,
    manifest: bundle.manifest,
    receipt: bundle.receipt,
    technical: bundle.technical
  });
  if (canonicalJson(request.eligibility) !== canonicalJson(expectedEligibility)) throw new Error('request eligibility is not derived from W05 packet evidence');
  const releaseIds = new Set(bundle.technical.gameReleases.map((release) => release.gameReleaseId));
  if (!releaseIds.has(request.gameReleaseId) && !changedGameReleaseIds(bundle).has(request.gameReleaseId)) {
    throw new Error('request gameReleaseId is absent from current or changed Source data');
  }
}

export async function verifyW09SourcePacket({ request, packetDir } = {}) {
  validateW09SourceRequest(request);
  const bundle = await readPacketBundle(packetDir);
  ensureRequestMatchesBundle(request, bundle);
  return bundle;
}

export function w09SourceArchiveTag(releaseId) {
  if (typeof releaseId !== 'string' || !/^w09-[a-f0-9]{32}$/u.test(releaseId)) throw new Error('releaseId must be a derived W09 identity');
  return `w09-source-${releaseId}`;
}

export function w09SourceArchiveAssetName(releaseId) {
  return `${SOURCE_ARCHIVE_ASSET_PREFIX}${w09SourceArchiveTag(releaseId).slice('w09-source-'.length)}.json`;
}

function makeW09SourceArchive(request, bundle) {
  const archive = {
    schema: ARCHIVE_SCHEMA,
    repository: W09_SOURCE_REPOSITORY,
    tagName: w09SourceArchiveTag(request.releaseId),
    assetName: w09SourceArchiveAssetName(request.releaseId),
    request,
    packetFiles: W09_SOURCE_PACKET_FILES.map((filePath) => ({
      path: filePath,
      sha256: sha256(bundle.files.get(filePath)),
      sizeBytes: bundle.files.get(filePath).length,
      base64: bundle.files.get(filePath).toString('base64')
    }))
  };
  return stableJsonBytes(archive);
}

export async function createW09SourceArchive({ request, packetDir } = {}) {
  const bundle = await verifyW09SourcePacket({ request, packetDir });
  const bytes = makeW09SourceArchive(request, bundle);
  verifyW09SourceArchive({ bytes, request });
  return bytes;
}

export function verifyW09SourceArchive({ bytes, request } = {}) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array) && typeof bytes !== 'string') {
    throw new Error('archive bytes are required');
  }
  const archive = parseJson(bytes, 'W09 Source release archive');
  exactKeys(archive, ['schema', 'repository', 'tagName', 'assetName', 'request', 'packetFiles'], 'archive');
  if (archive.schema !== ARCHIVE_SCHEMA || archive.repository !== W09_SOURCE_REPOSITORY) throw new Error('W09 Source archive identity is invalid');
  validateW09SourceRequest(archive.request);
  if (archive.tagName !== w09SourceArchiveTag(archive.request.releaseId)
      || archive.assetName !== w09SourceArchiveAssetName(archive.request.releaseId)) {
    throw new Error('W09 Source archive release tag or asset name is not derived from the request');
  }
  if (request !== undefined) {
    validateW09SourceRequest(request);
    if (canonicalJson(archive.request) !== canonicalJson(request)) throw new Error('published archive does not contain the exact requested Source provenance');
  }
  if (!Array.isArray(archive.packetFiles) || archive.packetFiles.length !== W09_SOURCE_PACKET_FILES.length) {
    throw new Error('W09 Source archive must contain the exact six-file packet');
  }
  const files = new Map();
  archive.packetFiles.forEach((entry, index) => {
    exactKeys(entry, ['path', 'sha256', 'sizeBytes', 'base64'], `archive.packetFiles[${index}]`);
    const expectedPath = W09_SOURCE_PACKET_FILES[index];
    if (entry.path !== expectedPath) throw new Error('W09 Source archive packet file order or names are invalid');
    validateDigest(entry.sha256, `archive.packetFiles[${index}].sha256`);
    if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 || typeof entry.base64 !== 'string') {
      throw new Error(`archive.packetFiles[${index}] has invalid bytes metadata`);
    }
    const data = Buffer.from(entry.base64, 'base64');
    if (data.toString('base64') !== entry.base64 || data.length !== entry.sizeBytes || sha256(data) !== entry.sha256) {
      throw new Error(`archive bytes do not match the declared hash or size for ${entry.path}`);
    }
    const requested = archive.request.packetFiles[index];
    if (requested.path !== entry.path || requested.sha256 !== entry.sha256 || requested.sizeBytes !== entry.sizeBytes) {
      throw new Error(`archive packet bytes disagree with request metadata for ${entry.path}`);
    }
    files.set(entry.path, data);
  });
  return { archive, files };
}

function gitResult(sourceRoot, args, { maxBuffer = 32 * 1024 * 1024 } = {}) {
  const result = spawnSync('git', ['-C', sourceRoot, ...args], { encoding: null, maxBuffer, windowsHide: true });
  if (result.error) throw new Error(`git ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${Buffer.from(result.stderr ?? '').toString('utf8').trim()}`);
  return Buffer.from(result.stdout ?? '');
}

function gitText(sourceRoot, args) {
  return gitResult(sourceRoot, args).toString('utf8').trim();
}

async function assertSourceRepository(sourceRoot, expectedCommit) {
  if (typeof sourceRoot !== 'string' || sourceRoot.trim().length === 0) throw new Error('explicit sourceRoot is required');
  const absoluteRoot = await realpath(path.resolve(sourceRoot));
  const topLevel = await realpath(gitText(absoluteRoot, ['rev-parse', '--show-toplevel']));
  if (topLevel !== absoluteRoot) throw new Error('sourceRoot must be the Source Git repository root');
  const origin = gitText(absoluteRoot, ['remote', 'get-url', 'origin']).replace(/\/$/u, '');
  const officialOriginWithoutGitSuffix = W09_SOURCE_ORIGIN.slice(0, -'.git'.length);
  if (origin !== W09_SOURCE_ORIGIN && origin !== officialOriginWithoutGitSuffix) {
    throw new Error(`Source origin must be the fixed official repository ${W09_SOURCE_ORIGIN}`);
  }
  const currentCommit = gitText(absoluteRoot, ['rev-parse', 'HEAD']);
  if (!COMMIT_RE.test(currentCommit)) throw new Error('Source HEAD is not a full Git commit SHA');
  if (gitText(absoluteRoot, ['status', '--porcelain', '--untracked-files=no']).length > 0) {
    throw new Error('Source tracked files must be clean before building or verifying a request');
  }
  const sourceCommit = expectedCommit ?? currentCommit;
  if (typeof sourceCommit !== 'string' || !COMMIT_RE.test(sourceCommit)) throw new Error('Source commit pin must be a full Git commit SHA');
  gitResult(absoluteRoot, ['cat-file', '-e', `${sourceCommit}^{commit}`]);
  return { sourceRoot: absoluteRoot, sourceCommit, currentCommit };
}

function assertRegularGitFile(sourceRoot, commit, relativePath) {
  const line = gitText(sourceRoot, ['ls-tree', commit, '--', relativePath]);
  const [mode, type] = line.split('\t', 1)[0].split(' ');
  if (type !== 'blob' || !['100644', '100755'].includes(mode)) throw new Error(`pinned Source input is not a regular Git file: ${relativePath}`);
}

function readGitBlob(sourceRoot, commit, relativePath) {
  assertRegularGitFile(sourceRoot, commit, relativePath);
  return gitResult(sourceRoot, ['show', `${commit}:${relativePath}`], { maxBuffer: 32 * 1024 * 1024 });
}

async function assertPinnedBuildCode(sourceRoot, sourceCommit) {
  for (const relativePath of PINNED_BUILD_FILES) {
    const absolutePath = path.join(sourceRoot, relativePath);
    await assertNoSymlinkComponents(absolutePath);
    const workingBytes = await readFile(absolutePath);
    const pinnedBytes = readGitBlob(sourceRoot, sourceCommit, relativePath);
    if (!workingBytes.equals(pinnedBytes)) throw new Error(`W05 build code differs from the pinned Source commit: ${relativePath}`);
  }
}

async function readPinnedSourceInputs(sourceRoot, sourceCommit, inputRefs) {
  const result = [];
  for (const ref of inputRefs) {
    const { role, commit, path: relativePath } = ref;
    if (!ALLOWED_INPUT_PATHS.has(relativePath)) throw new Error(`${role} must use an approved fixed Source input path`);
    const pin = commit ?? sourceCommit;
    if (role !== 'baseline' && pin !== sourceCommit) throw new Error(`${role} must use the fixed source commit`);
    if (role === 'baseline' && pin !== sourceCommit) {
      try { gitResult(sourceRoot, ['merge-base', '--is-ancestor', pin, sourceCommit]); }
      catch { throw new Error('baseline commit must be an explicit ancestor of the pinned Source commit'); }
    }
    const bytes = readGitBlob(sourceRoot, pin, relativePath);
    const digest = sha256(bytes);
    if (ref.sha256 !== undefined && ref.sha256 !== digest) throw new Error(`${role} Git input hash does not match its explicit ref`);
    result.push({ role, commit: pin, path: relativePath, sha256: digest, bytes, document: parseJson(bytes, `${role} Git input`) });
  }
  return result;
}

function inputPathsFromRequest(request) {
  return request.sourceInputs.map(({ role, commit, path: inputPath, sha256: digest }) => ({ role, commit, path: inputPath, sha256: digest }));
}

function registryKeyTuple(value, name) {
  if (typeof value !== 'string') throw new Error(`W05 ${name} change key must be a JSON tuple string`);
  let tuple;
  try { tuple = JSON.parse(value); }
  catch { throw new Error(`W05 ${name} change key is not valid JSON`); }
  if (!Array.isArray(tuple) || tuple.some((part) => typeof part !== 'string' || part.length === 0)) {
    throw new Error(`W05 ${name} change key must contain non-empty string tuple members`);
  }
  return tuple;
}

function changedGameReleaseIds(bundle) {
  const ids = new Set(bundle.technical.gameReleases.map((item) => item.gameReleaseId));
  const changes = bundle.revision.changes;
  for (const name of ['gameReleases', 'sourceRefs', 'records', 'tombstones']) {
    const diff = changes[name];
    if (!diff) continue;
    for (const value of [...(diff.added ?? []), ...(diff.removed ?? []), ...(diff.updated ?? []).map((item) => item.key)]) {
      const tuple = registryKeyTuple(value, name);
      if (name === 'gameReleases' || name === 'sourceRefs' || name === 'records' || name === 'tombstones') ids.add(tuple[0]);
    }
  }
  if (changes.sourceSnapshots && ['added', 'removed', 'updated'].some((name) => (changes.sourceSnapshots[name] ?? []).length > 0)) {
    for (const item of bundle.technical.gameReleases) ids.add(item.gameReleaseId);
  }
  return ids;
}

function indexRecordKinds(document) {
  const result = new Map();
  for (const registry of ['records', 'tombstones']) {
    for (const item of document[registry] ?? []) {
      const key = canonicalJson([item.gameReleaseId, item.recordId]);
      if (typeof item.kind === 'string' && ALLOWED_KINDS.has(item.kind)) result.set(key, item.kind);
    }
  }
  return result;
}

function deriveChangedRecords(bundle, baseline) {
  const currentKinds = indexRecordKinds(bundle.technical);
  const baselineKinds = indexRecordKinds(baseline);
  const changed = [];
  for (const registry of ['records', 'tombstones']) {
    const diff = bundle.revision.changes[registry];
    if (!diff) continue;
    for (const key of diff.added ?? []) {
      const [gameReleaseId, recordId] = registryKeyTuple(key, registry);
      changed.push({ registry, gameReleaseId, recordId, kind: currentKinds.get(canonicalJson([gameReleaseId, recordId])) ?? null, change: 'added' });
    }
    for (const item of diff.updated ?? []) {
      const [gameReleaseId, recordId] = registryKeyTuple(item.key, registry);
      if (!Array.isArray(item.fields) || item.fields.length === 0) throw new Error(`W05 ${registry} update must list changed fields`);
      changed.push({
        registry, gameReleaseId, recordId,
        kind: currentKinds.get(canonicalJson([gameReleaseId, recordId])) ?? null,
        change: 'updated', fields: [...item.fields]
      });
    }
    for (const key of diff.removed ?? []) {
      const [gameReleaseId, recordId] = registryKeyTuple(key, registry);
      changed.push({ registry, gameReleaseId, recordId, kind: baselineKinds.get(canonicalJson([gameReleaseId, recordId])) ?? null, change: 'removed' });
    }
  }
  changed.sort((left, right) => compareLexical(
    canonicalJson([left.registry, left.gameReleaseId, left.recordId, left.change]),
    canonicalJson([right.registry, right.gameReleaseId, right.recordId, right.change])
  ));
  return changed;
}

export function deriveW09ChangedRecords({ revision, technical, baseline } = {}) {
  if (!isPlainObject(revision) || !isPlainObject(revision.changes) || !isPlainObject(technical) || !isPlainObject(baseline)) {
    throw new Error('revision, technical, and baseline contracts are required to derive changed Source records');
  }
  return deriveChangedRecords({ revision, technical }, baseline);
}

function buildRequestsFromBundle({ bundle, sourceCommit, sourceInputs, baseline }) {
  const changedRecords = deriveChangedRecords(bundle, baseline);
  const sourceRefs = sourceInputs.map(({ role, commit, path: inputPath, sha256: digest }) => ({ role, commit, path: inputPath, sha256: digest }));
  const packetFiles = packetFileMetadata(bundle);
  const eligibility = deriveEligibility({
    mode: bundle.manifest.mode,
    manifest: bundle.manifest,
    receipt: bundle.receipt,
    technical: bundle.technical
  });
  return [...changedGameReleaseIds(bundle)].sort().map((gameReleaseId) => {
    const identity = {
      repository: W09_SOURCE_REPOSITORY,
      sourceRevision: bundle.manifest.sourceRevision,
      manifestSha256: bundle.manifestSha256,
      gameReleaseId
    };
    const request = {
      schema: REQUEST_SCHEMA,
      repository: W09_SOURCE_REPOSITORY,
      sourceCommit,
      sourceRevision: bundle.manifest.sourceRevision,
      manifestSha256: bundle.manifestSha256,
      gameReleaseId,
      releaseId: releaseIdFor(bundle.manifest.sourceRevision, gameReleaseId),
      requestId: requestIdFor(identity),
      sourceInputs: sourceRefs,
      packetFiles,
      changedRecords: changedRecords.filter((item) => item.gameReleaseId === gameReleaseId),
      changedClaims: changedRecords.filter((item) => item.gameReleaseId === gameReleaseId && item.kind === 'claim'),
      eligibility
    };
    return validateW09SourceRequest(request);
  });
}

function pickRequestFromCollection(requests, identity) {
  const request = requests.find((item) => item.gameReleaseId === identity.gameReleaseId);
  if (!request) throw new Error('request gameReleaseId is not present in the derived Source request set');
  if (request.requestId !== identity.requestId) throw new Error('derived request identity conflict');
  return request;
}

export async function verifyW09SourceRevision({ request, packetDir, sourceRoot, expectedCommit } = {}) {
  validateW09SourceRequest(request);
  if (typeof expectedCommit !== 'string' || !COMMIT_RE.test(expectedCommit)) throw new Error('expectedCommit must be a full Git commit SHA');
  if (expectedCommit !== request.sourceCommit) throw new Error('expected commit does not match the request pin');
  const bundle = await verifyW09SourcePacket({ request, packetDir });
  const repository = await assertSourceRepository(sourceRoot, expectedCommit);
  await assertPinnedBuildCode(repository.sourceRoot, expectedCommit);
  const sourceInputs = await readPinnedSourceInputs(repository.sourceRoot, expectedCommit, inputPathsFromRequest(request));
  for (const input of sourceInputs) {
    const expected = request.sourceInputs.find((entry) => entry.role === input.role);
    if (!expected || expected.commit !== input.commit || expected.path !== input.path || expected.sha256 !== input.sha256) {
      throw new Error(`pinned ${input.role} input hash does not match the request`);
    }
  }
  const builderPath = path.join(repository.sourceRoot, 'scripts', 'content', 'contract-w05-build.mjs');
  await assertNoSymlinkComponents(builderPath);
  const builder = await import(pathToFileURL(builderPath).href);
  if (typeof builder.buildContractCandidate !== 'function') throw new Error('pinned W05 builder does not expose buildContractCandidate');
  const replayRoot = await mkdtemp(path.join(os.tmpdir(), 'w09-revision-replay-'));
  try {
    const replay = await builder.buildContractCandidate({
      baseline: sourceInputs.find((item) => item.role === 'baseline').document,
      authoring: sourceInputs.find((item) => item.role === 'authoring').document,
      candidate: sourceInputs.find((item) => item.role === 'candidate').document,
      outRoot: replayRoot,
      mode: bundle.manifest.mode
    });
    for (const fileName of W09_SOURCE_PACKET_FILES) {
      const replayBytes = replay.files.get(fileName);
      const packetBytes = bundle.files.get(fileName);
      if (!replayBytes || !packetBytes.equals(replayBytes)) throw new Error(`W05 replay bytes differ from packet file ${fileName}`);
    }
  } finally {
    await rm(replayRoot, { recursive: true, force: true });
  }
  const expectedRequests = buildRequestsFromBundle({
    bundle,
      sourceCommit: expectedCommit,
    sourceInputs,
    baseline: sourceInputs.find((item) => item.role === 'baseline').document
  });
  const derived = pickRequestFromCollection(expectedRequests, request);
  if (canonicalJson(derived) !== canonicalJson(request)) throw new Error('request changed claims, records, gates, or pins are not derived from the pinned packet and Git inputs');
  return {
    valid: true,
    sourceCommit: expectedCommit,
    sourceRevision: bundle.manifest.sourceRevision,
    manifestSha256: bundle.manifestSha256,
    sourceInputs: sourceInputs.map(({ role, commit, path: inputPath, sha256: digest }) => ({ role, commit, path: inputPath, sha256: digest }))
  };
}

function githubHeaders(token, extra = {}) {
  return {
    ...ARCHIVE_REQUEST_HEADERS,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra
  };
}

async function responseJson(response, label) {
  if (!response || typeof response.json !== 'function') throw new Error(`${label} returned an invalid HTTP response`);
  try { return await response.json(); }
  catch (error) { throw new Error(`${label} returned invalid JSON: ${error.message}`); }
}

async function fetchSourceRelease({ releaseId, fetchImpl, token, allowDraft = false } = {}) {
  const tagName = w09SourceArchiveTag(releaseId);
  const response = await fetchImpl(`${SOURCE_RELEASES_ENDPOINT}/tags/${encodeURIComponent(tagName)}`, {
    method: 'GET', headers: githubHeaders(token), redirect: 'error'
  });
  if (response?.status === 404) return null;
  if (!response || response.ok !== true) throw new Error(`Source release lookup failed with HTTP ${response?.status ?? 'unknown'}`);
  const release = await responseJson(response, 'Source release lookup');
  const draftAllowed = allowDraft && release?.draft === true;
  if (!isPlainObject(release) || release.tag_name !== tagName || (!draftAllowed && release.draft !== false) || release.prerelease !== true
      || !Number.isSafeInteger(release.id) || release.id <= 0 || !Array.isArray(release.assets)) {
    throw new Error('Source release does not match the required published W09 archive identity');
  }
  return release;
}

async function fetchSourceArchiveTagCommit({ releaseId, fetchImpl, token } = {}) {
  const tagName = w09SourceArchiveTag(releaseId);
  const refResponse = await fetchImpl(`${SOURCE_GIT_ENDPOINT}/ref/tags/${encodeURIComponent(tagName)}`, {
    method: 'GET', headers: githubHeaders(token), redirect: 'error'
  });
  if (refResponse?.status === 404) return null;
  if (!refResponse || refResponse.ok !== true) throw new Error(`Source archive Git tag lookup failed with HTTP ${refResponse?.status ?? 'unknown'}`);
  const ref = await responseJson(refResponse, 'Source archive Git tag lookup');
  if (ref?.ref !== `refs/tags/${tagName}` || !isPlainObject(ref.object) || !COMMIT_RE.test(ref.object.sha ?? '')
      || !['commit', 'tag'].includes(ref.object.type)) {
    throw new Error('Source archive Git tag reference is malformed');
  }
  let object = ref.object;
  for (let depth = 0; object.type === 'tag' && depth < 5; depth += 1) {
    const tagResponse = await fetchImpl(`${SOURCE_GIT_ENDPOINT}/tags/${encodeURIComponent(object.sha)}`, {
      method: 'GET', headers: githubHeaders(token), redirect: 'error'
    });
    if (!tagResponse || tagResponse.ok !== true) throw new Error(`Source archive annotated Git tag lookup failed with HTTP ${tagResponse?.status ?? 'unknown'}`);
    const annotatedTag = await responseJson(tagResponse, 'Source archive annotated Git tag lookup');
    if (annotatedTag?.sha !== object.sha || !isPlainObject(annotatedTag.object)
        || !COMMIT_RE.test(annotatedTag.object.sha ?? '') || !['commit', 'tag'].includes(annotatedTag.object.type)) {
      throw new Error('Source archive annotated Git tag target is malformed');
    }
    object = annotatedTag.object;
  }
  if (object.type !== 'commit' || !COMMIT_RE.test(object.sha ?? '')) throw new Error('Source archive Git tag does not resolve to a commit');
  return object.sha;
}

async function ensureSourceArchiveTag({ releaseId, expectedCommit, fetchImpl, token, createIfMissing = false } = {}) {
  if (typeof expectedCommit !== 'string' || !COMMIT_RE.test(expectedCommit)) throw new Error('Source archive Git tag requires a full commit SHA');
  const tagName = w09SourceArchiveTag(releaseId);
  let actualCommit = await fetchSourceArchiveTagCommit({ releaseId, fetchImpl, token });
  if (actualCommit !== null) {
    if (actualCommit !== expectedCommit) throw new Error('Source archive Git tag points to a different commit than its verified request');
    return actualCommit;
  }
  if (!createIfMissing) throw new Error('Source archive Git tag is missing');
  const created = await fetchImpl(`${SOURCE_GIT_ENDPOINT}/refs`, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({ ref: `refs/tags/${tagName}`, sha: expectedCommit }),
    redirect: 'error'
  });
  if (created?.status === 422) {
    actualCommit = await fetchSourceArchiveTagCommit({ releaseId, fetchImpl, token });
    if (actualCommit === expectedCommit) return actualCommit;
    throw new Error('Source archive Git tag was concurrently created with a conflicting commit');
  }
  if (!created || created.ok !== true) throw new Error(`Source archive Git tag creation failed with HTTP ${created?.status ?? 'unknown'}`);
  const createdRef = await responseJson(created, 'Source archive Git tag creation');
  if (createdRef?.ref !== `refs/tags/${tagName}` || createdRef.object?.type !== 'commit' || createdRef.object?.sha !== expectedCommit) {
    throw new Error('Source archive Git tag creation returned an unexpected target');
  }
  actualCommit = await fetchSourceArchiveTagCommit({ releaseId, fetchImpl, token });
  if (actualCommit !== expectedCommit) throw new Error('Source archive Git tag did not retain its requested commit');
  return actualCommit;
}

async function verifyReleaseAsset({ release, request, releaseId = request?.releaseId, fetchImpl, token } = {}) {
  if (typeof releaseId !== 'string' || !/^w09-[a-f0-9]{32}$/u.test(releaseId)) throw new Error('releaseId must be a derived W09 identity');
  const assetName = w09SourceArchiveAssetName(releaseId);
  const matches = release.assets.filter((asset) => asset?.name === assetName);
  if (matches.length !== 1) throw new Error(matches.length === 0
    ? 'published Source release is missing its immutable W09 archive asset'
    : 'published Source release has duplicate W09 archive assets');
  const asset = matches[0];
  const expectedAssetPrefix = `https://api.github.com/repos/${W09_SOURCE_REPOSITORY}/releases/assets/`;
  const assetId = typeof asset.url === 'string' && asset.url.startsWith(expectedAssetPrefix)
    ? asset.url.slice(expectedAssetPrefix.length)
    : '';
  if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || asset.state !== 'uploaded' || typeof asset.url !== 'string'
      || !/^[1-9][0-9]*$/u.test(assetId) || Number(assetId) !== asset.id) {
    throw new Error('published W09 archive asset metadata is invalid');
  }
  const response = await fetchSourceArchiveAsset({ assetUrl: asset.url, fetchImpl, token });
  if (!response || response.ok !== true || typeof response.arrayBuffer !== 'function') {
    throw new Error(`published Source archive download failed with HTTP ${response?.status ?? 'unknown'}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const verified = verifyW09SourceArchive({ bytes, ...(request ? { request } : {}) });
  if (verified.archive.request.releaseId !== releaseId) throw new Error('published W09 archive request does not match the requested release_id');
  return { asset, bytes, verified };
}

async function verifyExistingArchiveForRequest({ existing, request, bundle, packetDir, sourceRoot } = {}) {
  const archiveRequest = existing?.verified?.archive?.request;
  if (!archiveRequest || canonicalJson(requestContentIdentity(archiveRequest)) !== canonicalJson(requestContentIdentity(request))) {
    throw new Error('existing Source archive conflicts with the derived revision, manifest, or input content');
  }
  for (const filePath of W09_SOURCE_PACKET_FILES) {
    const currentBytes = bundle.files.get(filePath);
    const archivedBytes = existing.verified.files.get(filePath);
    if (!currentBytes || !archivedBytes || !currentBytes.equals(archivedBytes)) {
      throw new Error(`existing Source archive packet differs from the current verified packet: ${filePath}`);
    }
  }
  await verifyW09SourceRevision({
    request: archiveRequest,
    packetDir,
    sourceRoot,
    expectedCommit: archiveRequest.sourceCommit
  });
  return archiveRequest;
}

async function fetchSourceArchiveAsset({ assetUrl, fetchImpl, token } = {}) {
  let currentUrl = assetUrl;
  let redirects = 0;
  const seenUrls = new Set([currentUrl]);
  while (true) {
    let response;
    try {
      response = await fetchImpl(currentUrl, {
        method: 'GET',
        headers: redirects === 0
          ? githubHeaders(token, { Accept: 'application/octet-stream' })
          : { Accept: 'application/octet-stream', 'User-Agent': 'darktide-source-w09-handoff' },
        redirect: 'manual'
      });
    } catch {
      throw new Error('published Source archive download request failed');
    }
    if (![301, 302, 303, 307, 308].includes(response?.status)) return response;
    if (redirects >= MAX_SOURCE_ARCHIVE_REDIRECTS) throw new Error('published Source archive download exceeded the redirect limit');
    const location = response.headers?.get?.('location');
    if (typeof location !== 'string' || location.length === 0) throw new Error('published Source archive redirect is missing its destination');
    let nextUrl;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      throw new Error('published Source archive redirect destination is invalid');
    }
    if (nextUrl.protocol !== 'https:' || !SOURCE_ARCHIVE_ASSET_HOSTS.has(nextUrl.hostname)
        || nextUrl.username || nextUrl.password || (nextUrl.port && nextUrl.port !== '443') || nextUrl.hash) {
      throw new Error('published Source archive redirect destination is not an allowed HTTPS GitHub asset host');
    }
    const serializedUrl = nextUrl.href;
    if (seenUrls.has(serializedUrl)) throw new Error('published Source archive download contains a redirect loop');
    seenUrls.add(serializedUrl);
    currentUrl = serializedUrl;
    redirects += 1;
  }
}

export async function resolvePublishedW09SourceArchive({ releaseId, fetchImpl = globalThis.fetch } = {}) {
  if (typeof releaseId !== 'string' || !/^w09-[a-f0-9]{32}$/u.test(releaseId)) throw new Error('releaseId must be a derived W09 identity');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function');
  const release = await fetchSourceRelease({ releaseId, fetchImpl });
  if (!release) return { status: 'pending', releaseId, reason: 'published Source archive release is not available yet' };
  const verified = await verifyReleaseAsset({ release, releaseId, fetchImpl });
  const tagCommit = await fetchSourceArchiveTagCommit({ releaseId, fetchImpl });
  if (tagCommit !== verified.verified.archive.request.sourceCommit) {
    throw new Error('Source archive Git tag does not point to the archive request commit');
  }
  return {
    status: 'verified',
    releaseId,
    request: verified.verified.archive.request,
    files: verified.verified.files,
    providerImmutable: release.immutable === true ? true : release.immutable === false ? false : null,
    archiveSha256: sha256(verified.bytes),
    packetFiles: verified.verified.archive.packetFiles.map(({ path: filePath, sha256: digest, sizeBytes }) => ({ path: filePath, sha256: digest, sizeBytes }))
  };
}

export async function verifyPublishedW09SourceArchive({ request, fetchImpl = globalThis.fetch } = {}) {
  validateW09SourceRequest(request);
  const resolved = await resolvePublishedW09SourceArchive({ releaseId: request.releaseId, fetchImpl });
  if (resolved.status !== 'verified') return resolved;
  if (canonicalJson(resolved.request) !== canonicalJson(request)) throw new Error('published archive does not contain the exact requested Source provenance');
  return {
    ...resolved,
    requestId: request.requestId,
    sourceCommit: resolved.request.sourceCommit
  };
}

export async function publishW09SourceArchive({
  request,
  packetDir,
  sourceRoot,
  expectedCommit,
  token = process.env.SOURCE_ARCHIVE_TOKEN,
  fetchImpl = globalThis.fetch
} = {}) {
  const bundle = await verifyW09SourcePacket({ request, packetDir });
  await verifyW09SourceRevision({ request, packetDir, sourceRoot, expectedCommit });
  const eligibility = deriveEligibility({ mode: bundle.manifest.mode, manifest: bundle.manifest, receipt: bundle.receipt, technical: bundle.technical });
  if (eligibility.status !== 'eligible') return { status: 'pending', releaseId: request.releaseId, reason: eligibility.reasons.join('; ') };
  if (typeof token !== 'string' || token.trim().length === 0) {
    return { status: 'pending', releaseId: request.releaseId, reason: 'Source release archive credential is not configured' };
  }
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function');
  const archiveBytes = makeW09SourceArchive(request, bundle);
  verifyW09SourceArchive({ bytes: archiveBytes, request });
  let release = await fetchSourceRelease({ releaseId: request.releaseId, fetchImpl, token, allowDraft: true });
  let archiveRequest = request;
  let verifiedArchiveBytes = archiveBytes;
  if (release && !release.draft) {
    const existing = await verifyReleaseAsset({ release, releaseId: request.releaseId, fetchImpl, token });
    archiveRequest = await verifyExistingArchiveForRequest({ existing, request, bundle, packetDir, sourceRoot });
    await ensureSourceArchiveTag({ releaseId: request.releaseId, expectedCommit: archiveRequest.sourceCommit, fetchImpl, token });
    verifiedArchiveBytes = existing.bytes;
    return {
      status: 'reused', releaseId: request.releaseId, requestId: archiveRequest.requestId, sourceCommit: archiveRequest.sourceCommit, request: archiveRequest,
      providerImmutable: release.immutable === true ? true : release.immutable === false ? false : null,
      archiveSha256: sha256(verifiedArchiveBytes)
    };
  }
  if (!release) {
    await ensureSourceArchiveTag({ releaseId: request.releaseId, expectedCommit: request.sourceCommit, fetchImpl, token, createIfMissing: true });
    const tagName = w09SourceArchiveTag(request.releaseId);
    const created = await fetchImpl(SOURCE_RELEASES_ENDPOINT, {
      method: 'POST',
      headers: githubHeaders(token),
      body: JSON.stringify({ tag_name: tagName, target_commitish: request.sourceCommit, name: tagName, body: `W09 Source handoff ${request.requestId}`, draft: true, prerelease: true }),
      redirect: 'error'
    });
    if (created?.status === 422) {
      release = await fetchSourceRelease({ releaseId: request.releaseId, fetchImpl, token, allowDraft: true });
    } else if (created?.ok === true) {
      release = await responseJson(created, 'Source release creation');
    } else {
      throw new Error(`Source release creation failed with HTTP ${created?.status ?? 'unknown'}`);
    }
  }
  if (!release || release.tag_name !== w09SourceArchiveTag(request.releaseId) || release.draft !== true || release.prerelease !== true
      || !Number.isSafeInteger(release.id) || release.id <= 0 || !Array.isArray(release.assets)) {
    throw new Error('Source draft creation did not return the required W09 archive identity');
  }
  const assetName = w09SourceArchiveAssetName(request.releaseId);
  const existing = release.assets.filter((asset) => asset?.name === assetName);
  if (existing.length > 1) throw new Error('Source release contains duplicate W09 archive assets');
  if (existing.length === 1) {
    const verified = await verifyReleaseAsset({ release, releaseId: request.releaseId, fetchImpl, token });
    archiveRequest = await verifyExistingArchiveForRequest({ existing: verified, request, bundle, packetDir, sourceRoot });
    await ensureSourceArchiveTag({ releaseId: request.releaseId, expectedCommit: archiveRequest.sourceCommit, fetchImpl, token });
    verifiedArchiveBytes = verified.bytes;
  } else {
    await ensureSourceArchiveTag({ releaseId: request.releaseId, expectedCommit: request.sourceCommit, fetchImpl, token, createIfMissing: true });
    const uploadUrl = `https://uploads.github.com/repos/${W09_SOURCE_REPOSITORY}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`;
    const uploaded = await fetchImpl(uploadUrl, {
      method: 'POST',
      headers: githubHeaders(token, { Accept: 'application/vnd.github+json', 'Content-Type': 'application/octet-stream' }),
      body: archiveBytes,
      redirect: 'error'
    });
    if (!uploaded || uploaded.ok !== true) throw new Error(`Source archive upload failed with HTTP ${uploaded?.status ?? 'unknown'}`);
    release = await fetchSourceRelease({ releaseId: request.releaseId, fetchImpl, token, allowDraft: true });
    if (!release) throw new Error('Source release disappeared after archive upload');
    const verified = await verifyReleaseAsset({ release, request, fetchImpl, token });
    if (!verified.bytes.equals(archiveBytes)) throw new Error('published Source archive bytes differ from the verified request');
  }
  await ensureSourceArchiveTag({ releaseId: request.releaseId, expectedCommit: archiveRequest.sourceCommit, fetchImpl, token });
  const published = await fetchImpl(`${SOURCE_RELEASES_ENDPOINT}/${release.id}`, {
    method: 'PATCH',
    headers: githubHeaders(token),
    body: JSON.stringify({ draft: false, prerelease: true }),
    redirect: 'error'
  });
  if (!published || published.ok !== true) throw new Error(`Source archive release publication failed with HTTP ${published?.status ?? 'unknown'}`);
  const publishedRelease = await responseJson(published, 'Source archive release publication');
  if (publishedRelease.draft !== false || publishedRelease.prerelease !== true
      || publishedRelease.tag_name !== w09SourceArchiveTag(request.releaseId)) {
    throw new Error('Source archive was not published under the required Source release identity');
  }
  const publicVerification = await verifyPublishedW09SourceArchive({ request: archiveRequest, fetchImpl });
  if (publicVerification.status !== 'verified' || publicVerification.archiveSha256 !== sha256(verifiedArchiveBytes)) {
    throw new Error('published Source archive did not pass public identity and byte verification');
  }
  return {
    status: 'published', releaseId: request.releaseId, requestId: archiveRequest.requestId, sourceCommit: archiveRequest.sourceCommit, request: archiveRequest,
    providerImmutable: publishedRelease.immutable === true ? true : publishedRelease.immutable === false ? false : null,
    archiveSha256: sha256(verifiedArchiveBytes)
  };
}

export async function createW09SourceRequests({ packetDir, sourceRoot, expectedCommit, inputPreset = 'acceptedW07', inputRefs } = {}) {
  if (typeof expectedCommit !== 'string' || !COMMIT_RE.test(expectedCommit)) throw new Error('expectedCommit must be a full Git commit SHA');
  const bundle = await readPacketBundle(packetDir);
  const repository = await assertSourceRepository(sourceRoot, expectedCommit);
  const sourceInputs = await resolveInputRefs({ sourceRoot: repository.sourceRoot, sourceCommit: expectedCommit, inputPreset, inputRefs });
  const requests = buildRequestsFromBundle({
    bundle,
    sourceCommit: expectedCommit,
    sourceInputs,
    baseline: sourceInputs.find((item) => item.role === 'baseline').document
  });
  if (requests.length === 0) throw new Error('W09 Source packet has no game-release identities');
  await verifyW09SourceRevision({ request: requests[0], packetDir, sourceRoot: repository.sourceRoot, expectedCommit });
  return requests;
}

function validateInputPreset(inputPreset) {
  if (typeof inputPreset !== 'string' || !Object.hasOwn(W09_SOURCE_INPUT_PRESETS, inputPreset)) {
    throw new Error(`inputPreset must be one of: ${Object.keys(W09_SOURCE_INPUT_PRESETS).join(', ')}`);
  }
  return W09_SOURCE_INPUT_PRESETS[inputPreset];
}

async function resolveInputRefs({ sourceRoot, sourceCommit, inputPreset = 'acceptedW07', inputRefs } = {}) {
  const preset = inputRefs ? undefined : validateInputPreset(inputPreset);
  const configuredRefs = inputRefs ?? SOURCE_ROLES.map((role) => ({ role, ...preset[role] }));
  if (!Array.isArray(configuredRefs) || configuredRefs.length !== SOURCE_ROLES.length) {
    throw new Error('inputRefs must explicitly pin baseline, authoring, and candidate');
  }
  const refs = configuredRefs.map((ref, index) => {
    exactKeys(ref, inputRefs ? ['role', 'commit', 'path', 'sha256'] : ['role', 'commit', 'path', ...(ref.sha256 === undefined ? [] : ['sha256'])], `inputRefs[${index}]`);
    if (ref.role !== SOURCE_ROLES[index]) throw new Error('inputRefs must be ordered baseline, authoring, candidate');
    return { ...ref, commit: ref.commit === 'current' ? sourceCommit : ref.commit };
  });
  if (inputRefs) validateInputRefs(refs, sourceCommit);
  const inputs = await readPinnedSourceInputs(sourceRoot, sourceCommit, refs);
  const persistedRefs = inputs.map(({ role, commit, path: inputPath, sha256: digest }) => ({ role, commit, path: inputPath, sha256: digest }));
  validateInputRefs(persistedRefs, sourceCommit);
  return inputs;
}

function isPathWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function assertOutputOutsideSource(outputRoot, sourceRoot) {
  if (typeof outputRoot !== 'string' || outputRoot.trim().length === 0) throw new Error('explicit outputRoot is required');
  const absoluteOutput = path.resolve(outputRoot);
  const absoluteSource = await realpath(sourceRoot);
  const existingParent = await realpath(path.dirname(absoluteOutput)).catch(() => path.dirname(absoluteOutput));
  if (isPathWithin(absoluteOutput, absoluteSource) || isPathWithin(existingParent, absoluteSource)) {
    throw new Error('W09 outputRoot must be outside the Source repository');
  }
  await assertNoSymlinkComponents(absoluteOutput);
  return absoluteOutput;
}

function requestContentIdentity(request) {
  const { sourceCommit: _sourceCommit, sourceInputs, ...identity } = request;
  return {
    ...identity,
    sourceInputs: sourceInputs.map(({ commit: _commit, ...input }) => input)
  };
}

async function writeImmutableRequestFiles(outputRoot, requests) {
  const requestRoot = path.join(outputRoot, 'requests');
  await assertNoSymlinkComponents(requestRoot);
  await mkdir(requestRoot, { recursive: true });
  const directoryInfo = await lstat(requestRoot);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('request output directory must be a regular directory');
  const paths = [];
  const persistedRequests = [];
  for (const request of requests) {
    const destination = path.join(requestRoot, `${request.requestId}.json`);
    const bytes = stableJsonBytes(request);
    try {
      const existingInfo = await lstat(destination);
      if (!existingInfo.isFile() || existingInfo.isSymbolicLink()) throw new Error('existing request output is not a regular file');
      const existingBytes = await readFile(destination);
      if (!existingBytes.equals(bytes)) {
        const existing = parseJson(existingBytes, `existing request ${request.requestId}`);
        validateW09SourceRequest(existing);
          if (canonicalJson(requestContentIdentity(existing)) !== canonicalJson(requestContentIdentity(request))) {
          throw new Error('refusing to overwrite an immutable W09 request with conflicting revision or manifest identity');
        }
        persistedRequests.push(existing);
      } else {
        persistedRequests.push(request);
      }
      paths.push(destination);
      continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await writeFile(destination, bytes, { flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST') {
        const existingInfo = await lstat(destination);
        if (existingInfo.isFile() && !existingInfo.isSymbolicLink()) {
          const existingBytes = await readFile(destination);
          if (existingBytes.equals(bytes)) {
            paths.push(destination);
            persistedRequests.push(request);
            continue;
          }
          const existing = parseJson(existingBytes, `existing request ${request.requestId}`);
          validateW09SourceRequest(existing);
          if (canonicalJson(requestContentIdentity(existing)) === canonicalJson(requestContentIdentity(request))) {
            paths.push(destination);
            persistedRequests.push(existing);
            continue;
          }
        }
      }
      throw error;
    }
    paths.push(destination);
    persistedRequests.push(request);
  }
  return { paths, requests: persistedRequests };
}

export async function prepareW09SourceHandoff({
  sourceRoot = REPO_ROOT,
  outputRoot,
  mode = DEFAULT_MODE,
  inputPreset = 'acceptedW07',
  inputRefs,
  expectedCommit,
  fallbackCandidate = false
} = {}) {
  if (!['candidate', 'formal'].includes(mode)) throw new Error('mode must be candidate or formal');
  if (typeof fallbackCandidate !== 'boolean') throw new Error('fallbackCandidate must be boolean');
  const repository = await assertSourceRepository(sourceRoot, expectedCommit);
  const absoluteOutputRoot = await assertOutputOutsideSource(outputRoot, repository.sourceRoot);
  const sourceInputs = await resolveInputRefs({
    sourceRoot: repository.sourceRoot,
    sourceCommit: repository.sourceCommit,
    inputPreset,
    inputRefs
  });
  const builderPath = path.join(repository.sourceRoot, 'scripts', 'content', 'contract-w05-build.mjs');
  await assertNoSymlinkComponents(builderPath);
  const builder = await import(pathToFileURL(builderPath).href);
  if (typeof builder.buildContractCandidate !== 'function') throw new Error('pinned W05 builder does not expose buildContractCandidate');
  const packetRoot = path.join(absoluteOutputRoot, 'packets');
  let actualMode = mode;
  let formalBlockReason = null;
  let built;
  try {
    built = await builder.buildContractCandidate({
      baseline: sourceInputs.find((item) => item.role === 'baseline').document,
      authoring: sourceInputs.find((item) => item.role === 'authoring').document,
      candidate: sourceInputs.find((item) => item.role === 'candidate').document,
      outRoot: packetRoot,
      mode
    });
  } catch (error) {
    const isFormalGateBlock = /^formal output (?:blocked:|requires )/u.test(error.message);
    if (mode !== 'formal' || !fallbackCandidate || !isFormalGateBlock) throw error;
    formalBlockReason = error.message;
    actualMode = 'candidate';
    built = await builder.buildContractCandidate({
      baseline: sourceInputs.find((item) => item.role === 'baseline').document,
      authoring: sourceInputs.find((item) => item.role === 'authoring').document,
      candidate: sourceInputs.find((item) => item.role === 'candidate').document,
      outRoot: packetRoot,
      mode: 'candidate'
    });
  }
  const packetDir = path.join(packetRoot, built.receipt.outputDirectory);
  const requests = await createW09SourceRequests({
    packetDir,
    sourceRoot: repository.sourceRoot,
    expectedCommit: repository.sourceCommit,
    inputPreset,
    inputRefs
  });
  const persisted = await writeImmutableRequestFiles(absoluteOutputRoot, requests);
  return {
    sourceRoot: repository.sourceRoot,
    sourceCommit: repository.sourceCommit,
    packetDir,
    requests: persisted.requests,
    requestPaths: persisted.paths,
    mode: actualMode,
    formalBlockReason,
    handoff: mode === 'formal' && !formalBlockReason
      ? { status: 'pending', reason: 'formal request prepared; cross-repository dispatch requires explicit credentials and dispatch authorization' }
      : { status: 'pending', reason: formalBlockReason || 'candidate request is preview-only and awaits human review' }
  };
}

export async function dispatchW09SourceRequest({
  request,
  packetDir,
  sourceRoot,
  expectedCommit,
  token = process.env.WEB_HANDOFF_TOKEN,
  fetchImpl = globalThis.fetch
} = {}) {
  const bundle = await verifyW09SourcePacket({ request, packetDir });
  await verifyW09SourceRevision({ request, packetDir, sourceRoot, expectedCommit });
  const eligibility = deriveEligibility({
    mode: bundle.manifest.mode,
    manifest: bundle.manifest,
    receipt: bundle.receipt,
    technical: bundle.technical
  });
  if (eligibility.status !== 'eligible') return { status: 'pending', releaseId: request.releaseId, reason: eligibility.reasons.join('; ') };
  if (typeof token !== 'string' || token.trim().length === 0) {
    return { status: 'pending', releaseId: request.releaseId, reason: 'cross-repository dispatch credential is not configured' };
  }
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function');
  const archive = await verifyPublishedW09SourceArchive({ request, fetchImpl });
  if (archive.status !== 'verified') {
    return { status: 'pending', releaseId: request.releaseId, reason: archive.reason };
  }
  const response = await fetchImpl(DISPATCH_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'darktide-source-w09-handoff',
      'X-GitHub-Api-Version': '2026-03-10'
    },
    body: JSON.stringify({ event_type: 'w09-source-release', client_payload: { release_id: request.releaseId } }),
    redirect: 'error'
  });
  if (!response || response.ok !== true) throw new Error(`Web repository dispatch failed with HTTP ${response?.status ?? 'unknown'}`);
  return { status: 'dispatched', releaseId: request.releaseId, requestId: request.requestId, sourceCommit: request.sourceCommit };
}

export async function handoffW09SourceRequest({
  request,
  packetDir,
  sourceRoot,
  expectedCommit,
  sourceArchiveToken = process.env.SOURCE_ARCHIVE_TOKEN || process.env.GITHUB_TOKEN,
  webHandoffToken = process.env.WEB_HANDOFF_TOKEN,
  fetchImpl = globalThis.fetch
} = {}) {
  const archive = await publishW09SourceArchive({
    request, packetDir, sourceRoot, expectedCommit, token: sourceArchiveToken, fetchImpl
  });
  const verifiedRequest = archive.request ?? request;
  const dispatch = archive.status === 'published' || archive.status === 'reused'
    ? await dispatchW09SourceRequest({
      request: verifiedRequest, packetDir, sourceRoot, expectedCommit: verifiedRequest.sourceCommit, token: webHandoffToken || '', fetchImpl
    })
    : archive;
  return { releaseId: request.releaseId, archive, dispatch };
}

function parseCliArguments(argv) {
  const values = new Map();
  const flags = new Set(['--prepare', '--dispatch', '--publish-archive', '--all-releases', '--fallback-candidate']);
  const allowed = new Set([
    '--prepare', '--dispatch', '--publish-archive', '--all-releases', '--fallback-candidate', '--source-root', '--output-root', '--mode', '--input-preset', '--release-id',
    '--baseline-ref', '--authoring-ref', '--candidate-ref'
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) throw new Error(`unknown argument: ${flag}`);
    if (values.has(flag)) throw new Error(`duplicate argument: ${flag}`);
    if (flags.has(flag)) {
      values.set(flag, true);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  if (!values.has('--prepare')) throw new Error('explicit --prepare is required to write a Source handoff');
  if (!values.has('--output-root')) throw new Error('--output-root is required for an explicit prepare');
  if ((values.has('--dispatch') || values.has('--publish-archive')) && (!values.has('--mode') || values.get('--mode') !== 'formal')) {
    throw new Error('--dispatch and --publish-archive require --mode formal');
  }
  if (values.has('--publish-archive') && !values.has('--dispatch')) throw new Error('--publish-archive must be followed by the verified dispatch orchestration');
  if (values.has('--dispatch') && !values.has('--publish-archive')) throw new Error('--dispatch requires --publish-archive first');
  if ((values.has('--dispatch') || values.has('--publish-archive'))
      && (values.has('--release-id') === values.has('--all-releases'))) {
    throw new Error('formal dispatch requires exactly one derived --release-id or --all-releases');
  }
  if (values.has('--all-releases') && !values.has('--dispatch')) throw new Error('--all-releases requires --dispatch');
  if (values.has('--all-releases') && values.has('--release-id')) throw new Error('choose --all-releases or one --release-id');
  if (values.has('--release-id') && !/^w09-[a-f0-9]{32}$/u.test(values.get('--release-id'))) throw new Error('--release-id is not a W09 derived release identifier');
  const refs = ['--baseline-ref', '--authoring-ref', '--candidate-ref'];
  if (refs.some((flag) => values.has(flag)) && !refs.every((flag) => values.has(flag))) throw new Error('explicit input refs require all three role refs');
  for (const flag of refs) {
    if (!values.has(flag)) continue;
    const parts = values.get(flag).split('|');
    if (parts.length !== 3 || !COMMIT_RE.test(parts[0]) || !ALLOWED_INPUT_PATHS.has(parts[1]) || !SHA256_RE.test(parts[2])) {
      throw new Error(`${flag} must be <full-commit>|<approved-path>|<sha256>`);
    }
  }
  return values;
}

async function runCli(argv) {
  if (argv.length === 0 || (argv.length === 1 && ['--help', '-h'].includes(argv[0]))) {
    process.stdout.write('Read-only by default. Usage: node contract-w09-request.mjs --prepare --source-root <repo> --output-root <new-path> [--mode candidate|formal] [--input-preset acceptedW07] [--baseline-ref <commit|path|sha256> --authoring-ref <commit|path|sha256> --candidate-ref <commit|path|sha256>] [--fallback-candidate] [--publish-archive --dispatch (--release-id <derived-id>|--all-releases)]\n');
    return;
  }
  const values = parseCliArguments(argv);
  const roleFlags = ['--baseline-ref', '--authoring-ref', '--candidate-ref'];
  const inputRefs = roleFlags.every((flag) => values.has(flag))
    ? roleFlags.map((flag, index) => {
      const [commit, inputPath, digest] = values.get(flag).split('|');
      return { role: SOURCE_ROLES[index], commit, path: inputPath, sha256: digest };
    })
    : undefined;
  const prepared = await prepareW09SourceHandoff({
    sourceRoot: values.get('--source-root') || process.cwd(),
    outputRoot: values.get('--output-root'),
    mode: values.get('--mode') || DEFAULT_MODE,
    inputPreset: values.get('--input-preset') || 'acceptedW07',
    inputRefs,
    fallbackCandidate: values.has('--fallback-candidate')
  });
  const summary = {
    sourceCommit: prepared.sourceCommit,
    sourceRevision: prepared.requests[0]?.sourceRevision ?? null,
    manifestSha256: prepared.requests[0]?.manifestSha256 ?? null,
    mode: prepared.mode,
    requests: prepared.requests.map(({ requestId, releaseId, gameReleaseId, changedRecords, changedClaims, eligibility }) => ({
      requestId, releaseId, gameReleaseId, changedRecords: changedRecords.length, changedClaims: changedClaims.length, eligibility
    })),
    formalBlockReason: prepared.formalBlockReason,
    handoff: prepared.handoff
  };
  if (values.has('--dispatch')) {
    const requests = values.has('--all-releases')
      ? prepared.requests
      : prepared.requests.filter((item) => item.releaseId === values.get('--release-id'));
    if (requests.length === 0) {
      summary.handoff = { status: 'pending', reason: 'requested release_id does not match a request derived from the pinned Source packet' };
    } else {
      const outcomes = [];
      for (const request of requests) {
        outcomes.push(await handoffW09SourceRequest({
          request,
          packetDir: prepared.packetDir,
          sourceRoot: prepared.sourceRoot,
          expectedCommit: request.sourceCommit,
          sourceArchiveToken: process.env.SOURCE_ARCHIVE_TOKEN || process.env.GITHUB_TOKEN,
          webHandoffToken: process.env.WEB_HANDOFF_TOKEN
        }));
      }
      summary.handoff = outcomes.length === 1 ? outcomes[0] : outcomes;
    }
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
