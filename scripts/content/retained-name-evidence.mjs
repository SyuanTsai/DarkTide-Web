import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FIXED_HISTORY_SOURCE, W14_HISTORY_DIRECTORY, verifyW14HistoryPackage } from './contract-w14-history.mjs';

export const FIXED_RETAINED_NAME_PINS = Object.freeze({
  history: Object.freeze({
    gameVersion: '1.13.1',
    sourcePath: `${W14_HISTORY_DIRECTORY}/source-content.json`,
    sourceSha256: FIXED_HISTORY_SOURCE.sha256,
  }),
  mods: Object.freeze({
    repository: 'SyuanTsai/Warhammer-40-000-DARKTIDE-Mods',
    commit: '241ad76ce62330472aa423055a5b85db59bb6c0d',
    path: 'Game Info/releases/1.13.X/blessings/data/BLESSING_WEAPON_MAP.json',
    blobSha1: '9952f7fcd3d0d6e14c769a1b4cf49dbd33f5fe4e',
    byteLength: 2087188,
    sha256: '22b7b82a1f7d59334cfda5a09dc4a9f9bc02bcf02611c4bc1ed5c1afba0717ab',
    nameSourceId: 'mods-release-1-13-x',
  }),
  current: Object.freeze({
    repository: 'Aussiemon/Darktide-Source-Code',
    commit: 'e46b8926cfa3fa35503e4b80b15aab7a804314e4',
    gameReleaseId: 'darktide:1.13.4',
    gameVersion: '1.13.4',
  }),
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlobSha1 = bytes => createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const verifiedFixedMaps = new WeakSet();

export const RETAINED_NAME_ROOT_ENV = Object.freeze({
  modsRoot: 'SYP_W07_RETAINED_MODS_ROOT',
  sourceRoot: 'SYP_W07_RETAINED_SOURCE_ROOT',
  sourceBytesRoot: 'SYP_W07_RETAINED_SOURCE_BYTES_ROOT',
});

export function retainedNameRootsFromEnvironment(environment = process.env) {
  const readRoot = key => {
    const value = environment?.[key];
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new TypeError(`${key} must be a non-empty filesystem path`);
    }
    return path.resolve(value.trim());
  };
  const modsRoot = readRoot(RETAINED_NAME_ROOT_ENV.modsRoot);
  const sourceRoot = readRoot(RETAINED_NAME_ROOT_ENV.sourceRoot);
  const sourceBytesRoot = readRoot(RETAINED_NAME_ROOT_ENV.sourceBytesRoot);
  if (Boolean(modsRoot) !== Boolean(sourceRoot) || (sourceBytesRoot && !sourceRoot)) {
    throw new Error(`${RETAINED_NAME_ROOT_ENV.modsRoot} and ${RETAINED_NAME_ROOT_ENV.sourceRoot} must be configured together`);
  }
  return modsRoot ? { modsRoot, sourceRoot, ...(sourceBytesRoot ? { sourceBytesRoot } : {}) } : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validateRepoPath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/')
      || value.split('/').some(part => !part || part === '.' || part === '..') || value.includes('\0')) {
    throw new TypeError(`${label} must be a normalized repository-relative path`);
  }
  return value;
}

function gitText(root, args, label) {
  const result = execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const value = result.trim();
  if (!value) throw new Error(`${label} returned no value`);
  return value;
}

function gitBytes(root, args, label) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function canonicalGitHubRemote(value) {
  const ssh = /^git@github\.com:([^\s]+)$/iu.exec(value);
  const normalized = ssh ? `https://github.com/${ssh[1]}` : value;
  return normalized.replace(/\.git$/u, '').replace(/\/$/u, '').toLowerCase();
}

export function readPinnedGitBlob({ repositoryRoot, rawFilesRoot = null, commit, repository, repoName, filePath, expectedBlobSha1 = null }) {
  const safePath = validateRepoPath(filePath, `${repoName} path`);
  if (!/^[a-f0-9]{40}$/u.test(commit ?? '')) throw new TypeError(`${repoName} commit must be a lowercase Git SHA-1`);
  const resolvedHead = gitText(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}'], `${repoName} HEAD`);
  if (resolvedHead !== commit) throw new Error(`${repoName} checkout HEAD differs from the fixed commit ${commit}`);
  const remote = canonicalGitHubRemote(gitText(repositoryRoot, ['remote', 'get-url', 'origin'], `${repoName} origin`));
  const expectedRemote = `https://github.com/${repository}`;
  if (remote !== canonicalGitHubRemote(expectedRemote)) throw new Error(`${repoName} origin does not match ${expectedRemote}`);
  const expression = `${commit}:${safePath}`;
  const treeBlobSha1 = gitText(repositoryRoot, ['rev-parse', '--verify', expression], `${repoName} tree entry`);
  if (!/^[a-f0-9]{40}$/u.test(treeBlobSha1)) throw new Error(`${repoName} tree entry is not a Git blob: ${safePath}`);
  let bytes;
  if (rawFilesRoot) {
    const rawPath = path.resolve(rawFilesRoot, ...safePath.split('/'));
    const relativePath = path.relative(path.resolve(rawFilesRoot), rawPath);
    if (!relativePath || relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
      throw new Error(`${repoName} raw-byte root escaped for ${safePath}`);
    }
    bytes = readFileSync(rawPath);
  } else {
    bytes = gitBytes(repositoryRoot, ['cat-file', 'blob', treeBlobSha1], `${repoName} pinned blob`);
  }
  const actualBlobSha1 = gitBlobSha1(bytes);
  if (actualBlobSha1 !== treeBlobSha1) throw new Error(`${repoName} raw bytes differ from their pinned tree blob: ${safePath}`);
  if (expectedBlobSha1 && actualBlobSha1 !== expectedBlobSha1) throw new Error(`${repoName} blob differs from the fixed blob identity: ${safePath}`);
  return { bytes, blobSha1: actualBlobSha1, sha256: sha256(bytes), byteLength: bytes.byteLength, repository, commit, path: safePath };
}

function recordsById(rows, idField, label) {
  const map = new Map();
  for (const row of rows) {
    const id = row?.[idField];
    if (typeof id !== 'string' || !id.trim()) throw new Error(`${label} has a row without a stable ${idField}`);
    if (map.has(id)) throw new Error(`${label} contains a duplicate identity: ${id}`);
    map.set(id, row);
  }
  return map;
}

function parseBytes(bytes, label) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError(`${label} must be raw bytes`);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error(`${label} is not valid UTF-8 JSON`); }
}

export function isFixedRetainedNameEvidenceMap(value) {
  return isObject(value) && verifiedFixedMaps.has(value);
}

/** Build names only from pinned 1.13.1 history, the exact Mods map blob, and exact current Source Git blobs. */
export async function buildRetainedNameEvidenceMap({ historySourceBytes, modsBlob, currentPins, readCurrentBlob, pins = FIXED_RETAINED_NAME_PINS }) {
  if (!Buffer.isBuffer(historySourceBytes) || sha256(historySourceBytes) !== pins.history.sourceSha256) {
    throw new Error('retained-name history source bytes differ from the fixed historical release');
  }
  if (modsBlob?.repository !== pins.mods.repository || modsBlob?.commit !== pins.mods.commit
      || modsBlob?.path !== pins.mods.path || modsBlob?.blobSha1 !== pins.mods.blobSha1
      || modsBlob?.byteLength !== pins.mods.byteLength || modsBlob?.sha256 !== pins.mods.sha256
      || !Buffer.isBuffer(modsBlob?.bytes) || gitBlobSha1(modsBlob.bytes) !== pins.mods.blobSha1
      || sha256(modsBlob.bytes) !== pins.mods.sha256 || modsBlob.bytes.byteLength !== pins.mods.byteLength) {
    throw new Error('retained-name Mods map bytes or Git identity differ from the fixed source');
  }
  if (currentPins?.repository !== pins.current.repository || currentPins?.commit !== pins.current.commit
      || currentPins?.gameReleaseId !== pins.current.gameReleaseId || currentPins?.gameVersion !== pins.current.gameVersion
      || typeof readCurrentBlob !== 'function') {
    throw new Error('current retained-name Source checkout does not match the fixed game release');
  }

  const history = parseBytes(historySourceBytes, 'fixed 1.13.1 source content');
  if (history.game_version !== pins.history.gameVersion || history.package_kind !== FIXED_HISTORY_SOURCE.packageKind
      || history.schema_version !== FIXED_HISTORY_SOURCE.schemaVersion || !Array.isArray(history.weapons) || !Array.isArray(history.marks)) {
    throw new Error('fixed historical source content has an unexpected identity or collection shape');
  }
  const historicalWeapons = recordsById(history.weapons, 'weapon_id', 'historical weapon catalog');
  const historicalMarks = recordsById(history.marks, 'mark_id', 'historical weapon mark catalog');
  const mods = parseBytes(modsBlob.bytes, 'pinned Mods weapon map');
  if (!Array.isArray(mods.weapons)) throw new Error('pinned Mods weapon map has no weapon collection');
  recordsById(mods.weapons, 'id', 'Mods weapon map');
  const modsMarks = new Map();
  for (const family of mods.weapons) {
    if (!Array.isArray(family.marks)) throw new Error(`Mods weapon family has no mark list: ${family.id}`);
    for (const mark of family.marks) {
      if (typeof mark?.id !== 'string' || !mark.id.trim() || modsMarks.has(mark.id)) {
        throw new Error(`Mods weapon map has a missing or duplicate mark identity: ${mark?.id ?? ''}`);
      }
      modsMarks.set(mark.id, { family, mark });
    }
  }

  const entries = [];
  const missingHistoryName = [];
  const missingModsIdentity = [];
  for (const [markId, historicalMark] of historicalMarks) {
    if (!historicalMark.name_zh_tw) {
      missingHistoryName.push(markId);
      continue;
    }
    const oldSources = historicalMark.source_ids ?? [];
    if (!oldSources.includes(pins.mods.nameSourceId)) {
      missingModsIdentity.push({ markId, reason: 'historical mark does not cite the pinned Mods release source' });
      continue;
    }
    const mapped = modsMarks.get(markId);
    if (!mapped) {
      missingModsIdentity.push({ markId, reason: 'pinned Mods map has no exact mark ID' });
      continue;
    }
    const oldFamily = historicalWeapons.get(historicalMark.weapon_id);
    if (!oldFamily || mapped.family.id !== historicalMark.weapon_id || mapped.mark.name !== historicalMark.name_zh_tw) {
      throw new Error(`historical and pinned Mods identity/name disagree for ${markId}`);
    }
    const templatePath = validateRepoPath(mapped.mark.template_file, `Mods template path for ${markId}`);
    const fileName = path.posix.basename(templatePath, '.lua');
    if (!templatePath.startsWith('scripts/settings/equipment/weapon_templates/') || fileName !== markId
        || typeof mapped.mark.name !== 'string' || !mapped.mark.name.trim()
        || typeof mapped.mark.name_keys?.weapon_family_display_name !== 'string') {
      throw new Error(`pinned Mods row does not bind the exact mark name and template identity for ${markId}`);
    }
    const currentBlob = await readCurrentBlob(templatePath);
    if (!Buffer.isBuffer(currentBlob?.bytes) || currentBlob.repository !== pins.current.repository
        || currentBlob.commit !== pins.current.commit || currentBlob.path !== templatePath
        || gitBlobSha1(currentBlob.bytes) !== currentBlob.blobSha1 || currentBlob.sha256 !== sha256(currentBlob.bytes)
        || currentBlob.byteLength !== currentBlob.bytes.byteLength) {
      throw new Error(`current Source template bytes or provenance do not verify for ${markId}`);
    }
    const evidence = {
      name: historicalMark.name_zh_tw,
      sourceGameVersion: history.game_version,
      sourceMarkId: markId,
      historyEvidence: {
        repository: FIXED_HISTORY_SOURCE.repository,
        commit: FIXED_HISTORY_SOURCE.commit,
        path: pins.history.sourcePath,
        sourceSha256: pins.history.sourceSha256,
        sourceIds: [...oldSources].sort(),
      },
      modsEvidence: {
        repository: pins.mods.repository,
        commit: pins.mods.commit,
        path: pins.mods.path,
        blobSha1: modsBlob.blobSha1,
        sha256: modsBlob.sha256,
        familyId: mapped.family.id,
        nameKey: mapped.mark.name_keys.weapon_family_display_name,
        templatePath,
      },
      currentIdentity: {
        gameReleaseId: pins.current.gameReleaseId,
        familyId: mapped.family.id,
        markId,
        templateKey: fileName,
        repository: pins.current.repository,
        commit: pins.current.commit,
        path: templatePath,
        blobSha1: currentBlob.blobSha1,
        sourceSha256: currentBlob.sha256,
      },
      identityMethod: 'exact-mark-id-family-id-template-path-and-pinned-source-blob',
    };
    entries.push({ identityKey: `${pins.current.gameReleaseId}\0${markId}`, evidence });
  }

  const byIdentity = Object.create(null);
  for (const { identityKey, evidence } of entries) {
    if (Object.hasOwn(byIdentity, identityKey)) throw new Error(`retained-name evidence key collides: ${identityKey}`);
    byIdentity[identityKey] = evidence;
  }
  return deepFreeze({
    schemaVersion: 'retained-name-evidence-map/1',
    history: { gameVersion: history.game_version, sourceSha256: pins.history.sourceSha256 },
    mods: { repository: pins.mods.repository, commit: pins.mods.commit, path: pins.mods.path, blobSha1: pins.mods.blobSha1, sha256: pins.mods.sha256 },
    current: { repository: pins.current.repository, commit: pins.current.commit, gameReleaseId: pins.current.gameReleaseId, gameVersion: pins.current.gameVersion },
    evidenceByIdentity: byIdentity,
    coverage: {
      historicalMarks: historicalMarks.size,
      modsMarks: modsMarks.size,
      verifiedNameMappings: entries.length,
      missingHistoryName: missingHistoryName.sort(),
      missingModsIdentity: missingModsIdentity.sort((left, right) => left.markId.localeCompare(right.markId)),
    },
  });
}

export async function loadFixedRetainedNameEvidenceMap({ webRoot, modsRoot, sourceRoot, sourceBytesRoot = null, pins = FIXED_RETAINED_NAME_PINS }) {
  const historyDirectory = path.join(webRoot, ...W14_HISTORY_DIRECTORY.split('/'));
  const [historySourceBytes, projectionBytes, manifestBytes] = await Promise.all([
    readFile(path.join(historyDirectory, 'source-content.json')),
    readFile(path.join(historyDirectory, 'player-index.json')),
    readFile(path.join(historyDirectory, 'manifest.json')),
  ]);
  verifyW14HistoryPackage({ sourceBytes: historySourceBytes, projectionBytes, manifestBytes });
  if (pins !== FIXED_RETAINED_NAME_PINS) throw new Error('production retained-name pins cannot be overridden');
  const modsBlob = readPinnedGitBlob({
    repositoryRoot: modsRoot,
    commit: pins.mods.commit,
    repository: pins.mods.repository,
    repoName: 'pinned Mods source',
    filePath: pins.mods.path,
    expectedBlobSha1: pins.mods.blobSha1,
  });
  if (modsBlob.byteLength !== pins.mods.byteLength || modsBlob.sha256 !== pins.mods.sha256) {
    throw new Error('pinned Mods map does not match its fixed byte length and SHA-256');
  }
  const readCurrentBlob = templatePath => readPinnedGitBlob({
    repositoryRoot: sourceRoot,
    rawFilesRoot: sourceBytesRoot,
    commit: pins.current.commit,
    repository: pins.current.repository,
    repoName: 'pinned current Source',
    filePath: templatePath,
  });
  const evidence = await buildRetainedNameEvidenceMap({
    historySourceBytes,
    modsBlob,
    currentPins: pins.current,
    readCurrentBlob,
    pins,
  });
  verifiedFixedMaps.add(evidence);
  return evidence;
}
