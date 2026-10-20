import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateFixtureMarker, validateManifest, validateReleaseDirectory, validateVersion } from '../../scripts/content/contract-release.mjs';
import { safeRelativePath, sha256 } from './common.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]));
  }
  return value;
}

function parseJson(bytes, label) {
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')); }
  catch (error) { throw new Error(label + ' is not valid JSON', { cause: error }); }
}

function validateRetainedPointer(pointer, label) {
  if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer)) throw new TypeError(label + ' must be an object');
  const keys = Object.keys(pointer).sort();
  if (keys.join(',') !== 'content_version,data_revision,game_version,manifest_path,manifest_sha256') {
    throw new Error(label + ' has unsupported fields');
  }
  const contentPrefix = typeof pointer.game_version === 'string' ? pointer.game_version + '.' : '';
  if (typeof pointer.game_version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(pointer.game_version)
      || typeof pointer.content_version !== 'string' || !pointer.content_version.startsWith(contentPrefix)
      || !/^[1-9]\d*$/u.test(pointer.content_version.slice(contentPrefix.length))
      || !SHA256.test(pointer.data_revision) || !SHA256.test(pointer.manifest_sha256)
      || pointer.manifest_path !== '/data/' + pointer.data_revision + '/manifest.json') {
    throw new Error(label + ' is not a canonical W02 release pointer');
  }
}

function validateStaticSharedBundle({ version, fixtureMarker = null, fileBytes, retainedReleaseRows = [] }) {
  if (!(fileBytes instanceof Map)) throw new TypeError('shared release fileBytes must be a Map');
  if (!version || typeof version !== 'object' || Array.isArray(version)) throw new TypeError('shared release version must be an object');
  const fixtureOnly = version.package_kind === 'fixture';
  if (fixtureOnly) {
    if (!fixtureMarker) throw new Error('fixture shared release requires its explicit non-publishable marker');
    validateFixtureMarker(fixtureMarker);
  } else if (version.package_kind !== 'published' || fixtureMarker !== null) {
    throw new Error('shared release package kind or fixture marker is invalid');
  }

  const contractVersion = fixtureOnly ? { ...version, package_kind: 'published' } : version;
  validateVersion(contractVersion);
  if (!Array.isArray(retainedReleaseRows)) throw new TypeError('retainedReleases must be an array');
  if (!Number.isSafeInteger(version.schema_version) || !SHA256.test(version.build_id)) {
    throw new Error('shared release version has an invalid site identity');
  }

  const outputFiles = new Map();
  const verifiedRetainedReleases = [];
  const publicSourceLocks = [];
  const verifiedSharedFiles = [];
  const expectedPaths = new Set();
  const pointerByPath = new Map();
  const allPointers = [...contractVersion.game_releases, ...retainedReleaseRows];
  for (const [index, pointer] of allPointers.entries()) {
    if (index >= contractVersion.game_releases.length) validateRetainedPointer(pointer, 'retainedReleases[' + (index - contractVersion.game_releases.length) + ']');
    const oldPointer = pointerByPath.get(pointer.manifest_path);
    if (oldPointer) {
      if (JSON.stringify(oldPointer) !== JSON.stringify(pointer)) throw new Error('retained W02 manifest URL has conflicting release identities');
      continue;
    }
    pointerByPath.set(pointer.manifest_path, structuredClone(pointer));
  }
  const normalizedRetained = [...pointerByPath.values()];
  for (const pointer of normalizedRetained) {
    const manifestPath = pointer.manifest_path;
    const manifestBytes = fileBytes.get(manifestPath);
    if (!manifestBytes) throw new Error('shared release is missing its manifest URL: ' + manifestPath);
    if (sha256(manifestBytes) !== pointer.manifest_sha256) throw new Error('shared release manifest hash mismatch: ' + manifestPath);
    const manifest = validateManifest(parseJson(manifestBytes, manifestPath));
    if (manifest.dataRevision !== pointer.data_revision || manifest.gameVersion !== pointer.game_version
        || manifest.contentVersion !== pointer.content_version) {
      throw new Error('shared release manifest and version pointer do not match: ' + manifestPath);
    }

    const manifestRelativePath = manifestPath.slice(1);
    safeRelativePath(manifestRelativePath, 'shared manifest URL');
    expectedPaths.add(manifestRelativePath);
    outputFiles.set(manifestRelativePath, Buffer.from(manifestBytes));
    verifiedSharedFiles.push({ path: manifestPath, size_bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) });
    for (const row of manifest.files) {
      const urlPath = '/data/' + manifest.dataRevision + '/' + row.path;
      const relativePath = urlPath.slice(1);
      safeRelativePath(relativePath, 'shared domain URL');
      const bytes = fileBytes.get(urlPath);
      if (!bytes) throw new Error('shared release is missing its manifest-listed domain URL: ' + urlPath);
      if (bytes.byteLength !== row.sizeBytes || sha256(bytes) !== row.sha256) {
        throw new Error('shared release domain integrity mismatch: ' + urlPath);
      }
      expectedPaths.add(relativePath);
      outputFiles.set(relativePath, Buffer.from(bytes));
      verifiedSharedFiles.push({ path: urlPath, size_bytes: bytes.byteLength, sha256: sha256(bytes) });
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
    const sourceLockBytes = Buffer.from(JSON.stringify(sourceLock, null, 2) + '\n', 'utf8');
    const sourceLockPath = 'source-locks/' + manifest.source.sourceRevision + '/' + sha256(sourceLockBytes) + '.json';
    safeRelativePath(sourceLockPath, 'public Source lock path');
    outputFiles.set(sourceLockPath, sourceLockBytes);
    verifiedSharedFiles.push({ path: '/' + sourceLockPath, size_bytes: sourceLockBytes.byteLength, sha256: sha256(sourceLockBytes) });
    publicSourceLocks.push({ path: '/' + sourceLockPath, sha256: sha256(sourceLockBytes) });
    verifiedRetainedReleases.push({
      ...structuredClone(pointer),
      source_lock_path: '/' + sourceLockPath,
      source_lock_sha256: sha256(sourceLockBytes),
    });
  }
  for (const urlPath of fileBytes.keys()) {
    if (!expectedPaths.has(urlPath.slice(1))) throw new Error('shared release contains an unreferenced file: ' + urlPath);
  }

  const selected = contractVersion.game_releases.find(row => row.game_version === contractVersion.game_version);
  if (!selected || selected.data_revision !== contractVersion.data_revision) throw new Error('shared static release has no selected top-level pointer');
  const metadata = {
    shared_data_revision: contractVersion.data_revision,
    shared_game_version: contractVersion.game_version,
    shared_package_kind: fixtureOnly ? 'fixture' : 'published',
    game_releases: structuredClone(contractVersion.game_releases),
    retained_releases: verifiedRetainedReleases,
    source_locks: publicSourceLocks,
    shared_files: verifiedSharedFiles.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))),
    ...(fixtureOnly ? { shared_fixture_only: true, fixture_id: fixtureMarker.fixtureId } : {}),
  };
  return {
    packageKind: fixtureOnly ? 'fixture' : 'published',
    version: structuredClone(version),
    fixtureMarker: fixtureOnly ? structuredClone(fixtureMarker) : null,
    selected,
    files: outputFiles,
    metadata,
  };
}

export async function loadSharedReleaseFixture({ repoRoot, fixtureName = 'valid' } = {}) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) throw new TypeError('repoRoot is required');
  if (!/^[a-z0-9-]+$/u.test(fixtureName)) throw new TypeError('fixtureName must be a safe fixture identifier');
  const fixtureRoot = path.resolve(repoRoot, 'content/fixtures/v2/shared-release', fixtureName);
  const allowedRoot = path.resolve(repoRoot, 'content/fixtures/v2/shared-release') + path.sep;
  if (!fixtureRoot.startsWith(allowedRoot)) throw new Error('shared release fixture path escaped its fixed root');
  const info = await lstat(fixtureRoot);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('shared release fixture must be a real directory');
  const validation = await validateReleaseDirectory(fixtureRoot);
  if (!validation.fixtureOnly) throw new Error('shared static fixture must carry the explicit non-publishable fixture marker');
  const publishedVersion = parseJson(await readFile(path.join(fixtureRoot, 'version.json')), 'shared fixture version');
  const version = { ...publishedVersion, package_kind: 'fixture' };
  const fixtureMarker = parseJson(await readFile(path.join(fixtureRoot, 'fixture.json')), 'shared fixture marker');
  const fileBytes = new Map();
  for (const pointer of version.game_releases) {
    const manifestPath = pointer.manifest_path;
    const manifestRelativePath = manifestPath.slice(1);
    const manifestBytes = await readFile(path.join(fixtureRoot, ...manifestRelativePath.split('/')));
    fileBytes.set(manifestPath, manifestBytes);
    const manifest = parseJson(manifestBytes, manifestPath);
    for (const row of manifest.files) {
      const urlPath = '/data/' + manifest.dataRevision + '/' + row.path;
      fileBytes.set(urlPath, await readFile(path.join(fixtureRoot, ...urlPath.slice(1).split('/'))));
    }
  }
  return validateStaticSharedBundle({ version, fixtureMarker, fileBytes });
}

export function validateSharedStaticFiles({ version, fixtureMarker = null, files, retainedReleases = [] } = {}) {
  if (!(files instanceof Map)) throw new TypeError('static files must be a Map');
  const fileBytes = new Map();
  for (const [relativePath, value] of files) {
    if (typeof relativePath !== 'string' || !relativePath.startsWith('data/')) continue;
    fileBytes.set('/' + relativePath, Buffer.from(value));
  }
  const bundle = validateStaticSharedBundle({ version, fixtureMarker, fileBytes, retainedReleaseRows: retainedReleases });
  for (const relativePath of bundle.files.keys()) {
    const bundled = bundle.files.get(relativePath);
    const actual = files.get(relativePath);
    if (!actual || !Buffer.from(actual).equals(bundled)) throw new Error('static shared file differs from its validated W02 bytes: ' + relativePath);
  }
  const expectedPaths = new Set(bundle.files.keys());
  const actualPaths = new Set([...files.keys()].filter(relativePath => typeof relativePath === 'string'
    && (relativePath.startsWith('data/') || relativePath.startsWith('source-locks/'))));
  if (actualPaths.size !== expectedPaths.size || [...actualPaths].some(relativePath => !expectedPaths.has(relativePath))) {
    throw new Error('static shared file set differs from its validated W02 bytes');
  }
  return bundle;
}

export function createSharedReleaseIdentity(bundle) {
  if (!bundle || typeof bundle !== 'object' || !bundle.version || !bundle.metadata) {
    throw new TypeError('validated shared release bundle is required');
  }
  const identity = {
    schema: 'w09-static-shared-identity/1',
    version: {
      schema_version: bundle.version.schema_version,
      data_revision: bundle.version.data_revision,
      game_version: bundle.version.game_version,
      game_releases: bundle.version.game_releases,
    },
    metadata: bundle.metadata,
  };
  return Buffer.from(JSON.stringify(sortJson(identity), null, 2) + '\n', 'utf8');
}
