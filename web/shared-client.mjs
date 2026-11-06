import { createSharedViewModel } from './shared-view.mjs';
import { createSourceClient } from './source-client.mjs';

const CORE_KINDS = Object.freeze(['skills', 'blessings', 'weapons', 'terms']);
const SPLIT_CORE_KINDS = Object.freeze(['skills', 'terms', 'weapons-index', 'blessings-index']);
const DOMAIN_KINDS = new Set([
  ...CORE_KINDS, ...SPLIT_CORE_KINDS, 'weapon-family', 'blessing',
  'catalog', 'curios', 'perks', 'classifications', 'announcements', 'game-changes',
]);
const FEATURES = new Set([
  'official-errata-details-v1',
  'official-native-localizations-v1',
  'blessing-tier-presentations-v1',
  'split-weapon-blessing-domains-v1',
]);
const REQUIRED_FEATURES = Object.freeze([
  'official-errata-details-v1',
  'official-native-localizations-v1',
  'blessing-tier-presentations-v1',
]);
const SPLIT_DOMAIN_FEATURE = 'split-weapon-blessing-domains-v1';
const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
const GAME_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const CONTENT_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.([1-9][0-9]*)$/u;
const SHA1 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const RELEASE_ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/u;
const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RELATIVE_JSON_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/u;
const DOMAIN_SCHEMA = 'w08-shared-domain/1.0.0';
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_DOMAIN_BYTES = 16 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 24 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

function fail(message) { throw new Error(message); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function requireExactKeys(value, keys, label) {
  if (!isObject(value)) fail(`${label} must be an object`);
  const allowed = new Set(keys);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(`${label} is missing ${key}`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} contains unexpected ${key}`);
}
function requireSha(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${label} is invalid`);
}
function requireGameVersion(value, label) {
  if (typeof value !== 'string' || !GAME_VERSION.test(value)) fail(`${label} is invalid`);
}
function requireContentVersion(value, gameVersion, label) {
  if (typeof value !== 'string' || !CONTENT_VERSION.test(value) || value.slice(0, value.lastIndexOf('.')) !== gameVersion) {
    fail(`${label} does not match its game version`);
  }
}
function requireSafeRelativeJsonPath(value, label) {
  if (typeof value !== 'string' || !RELATIVE_JSON_PATH.test(value) || value.includes('%') || value.includes('\\') || value.startsWith('/')) {
    fail(`${label} is not a safe relative JSON path`);
  }
  if (value.split('/').some(part => !part || part === '.' || part === '..')) fail(`${label} contains a traversal segment`);
  return value;
}
function compareUtf8(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map(key => [key, canonicalize(value[key])]));
  return value;
}
function utf8Json(value) { return new TextEncoder().encode(JSON.stringify(canonicalize(value))); }
function dataRevisionMaterial(manifest) {
  const files = manifest.files.map(file => ({
    kind: file.kind,
    path: file.path,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    dependencies: [...file.dependencies].sort(compareUtf8),
  })).sort((left, right) => compareUtf8(left.path, right.path));
  return canonicalize({
    source: manifest.source,
    web: manifest.web,
    compatibility: {
      dataContractMajor: manifest.compatibility.dataContractMajor,
      requiredFeatures: [...manifest.compatibility.requiredFeatures].sort(compareUtf8),
      gameSnapshotRefs: [...manifest.compatibility.gameSnapshotRefs].sort(compareUtf8),
    },
    files,
    changeIndexPath: manifest.changeIndexPath,
  });
}
async function sha256(bytes, cryptoApi) {
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function versionManifestPath(revision) { return `/data/${revision}/manifest.json`; }

export function hasSharedContext(build) {
  if (build?.source_data === true) return true;
  return isObject(build) && ['shared_game_version', 'shared_data_revision', 'shared_files', 'shared_package_kind']
    .some(key => Object.hasOwn(build, key));
}

export function selectSharedRelease(build) {
  if (!isObject(build)) fail('shared build context is missing');
  requireGameVersion(build.shared_game_version, 'shared_game_version');
  requireSha(build.shared_data_revision, SHA256, 'shared_data_revision');
  if (!Array.isArray(build.game_releases) || !Array.isArray(build.shared_files)) fail('shared release pointers are incomplete');
  const selected = build.game_releases.filter(row => row?.game_version === build.shared_game_version);
  if (selected.length !== 1) fail('shared build must identify one exact game release');
  const pointer = selected[0];
  requireExactKeys(pointer, ['game_version', 'content_version', 'data_revision', 'manifest_path', 'manifest_sha256'], 'shared release pointer');
  requireGameVersion(pointer.game_version, 'release.game_version');
  requireContentVersion(pointer.content_version, pointer.game_version, 'release.content_version');
  requireSha(pointer.data_revision, SHA256, 'release.data_revision');
  requireSha(pointer.manifest_sha256, SHA256, 'release.manifest_sha256');
  if (pointer.data_revision !== build.shared_data_revision || pointer.manifest_path !== versionManifestPath(pointer.data_revision)) {
    fail('shared build tuple and release pointer contradict each other');
  }
  const staticFiles = new Map();
  const lowerPaths = new Set();
  for (const row of build.shared_files) {
    if (!isObject(row) || typeof row.path !== 'string') fail('shared_files contains an invalid row');
    requireSha(row.sha256, SHA256, 'shared_files.sha256');
    if (!Number.isSafeInteger(row.size_bytes) || row.size_bytes < 1) fail('shared_files.size_bytes is invalid');
    if (staticFiles.has(row.path) || lowerPaths.has(row.path.toLowerCase())) fail('shared_files contains a path collision');
    staticFiles.set(row.path, row);
    lowerPaths.add(row.path.toLowerCase());
  }
  const manifestFile = staticFiles.get(pointer.manifest_path);
  if (!manifestFile || manifestFile.sha256 !== pointer.manifest_sha256 || manifestFile.size_bytes > MAX_MANIFEST_BYTES) {
    fail('shared build does not pin the selected manifest bytes');
  }
  return Object.freeze({ pointer: Object.freeze({ ...pointer }), staticFiles });
}

function validateManifestShape(manifest, pointer) {
  requireExactKeys(manifest, [
    'schemaVersion', 'gameReleaseId', 'gameVersion', 'contentVersion', 'dataRevision',
    'source', 'web', 'compatibility', 'files', 'changeIndexPath',
  ], 'manifest');
  if (manifest.schemaVersion !== '2.0.0') fail('manifest schema is unsupported');
  if (typeof manifest.gameReleaseId !== 'string' || !RELEASE_ID.test(manifest.gameReleaseId)) fail('manifest gameReleaseId is invalid');
  requireGameVersion(manifest.gameVersion, 'manifest.gameVersion');
  requireContentVersion(manifest.contentVersion, manifest.gameVersion, 'manifest.contentVersion');
  requireSha(manifest.dataRevision, SHA256, 'manifest.dataRevision');
  if (manifest.gameVersion !== pointer.game_version || manifest.contentVersion !== pointer.content_version || manifest.dataRevision !== pointer.data_revision) {
    fail('manifest identity does not match the selected shared release');
  }
  requireExactKeys(manifest.source, ['repository', 'commit', 'sourceRevision', 'manifestSha256'], 'manifest.source');
  if (manifest.source.repository !== SOURCE_REPOSITORY) fail('manifest Source repository is unsupported');
  requireSha(manifest.source.commit, SHA1, 'manifest.source.commit');
  requireSha(manifest.source.sourceRevision, SHA256, 'manifest.source.sourceRevision');
  requireSha(manifest.source.manifestSha256, SHA256, 'manifest.source.manifestSha256');
  requireExactKeys(manifest.web, ['authoringCommit', 'compilerCommit'], 'manifest.web');
  requireSha(manifest.web.authoringCommit, SHA1, 'manifest.web.authoringCommit');
  requireSha(manifest.web.compilerCommit, SHA1, 'manifest.web.compilerCommit');
  requireExactKeys(manifest.compatibility, ['dataContractMajor', 'requiredFeatures', 'gameSnapshotRefs'], 'manifest.compatibility');
  if (manifest.compatibility.dataContractMajor !== 2) fail('manifest data contract is unsupported');
  const features = manifest.compatibility.requiredFeatures;
  const snapshots = manifest.compatibility.gameSnapshotRefs;
  if (!Array.isArray(features) || new Set(features).size !== features.length || features.some(feature => !FEATURES.has(feature))) {
    fail('manifest declares an unsupported required feature');
  }
  if (REQUIRED_FEATURES.some(feature => !features.includes(feature))) fail('manifest omits a feature required by the Web consumer');
  if (!Array.isArray(snapshots) || snapshots.length === 0 || new Set(snapshots).size !== snapshots.length
      || snapshots.some(id => typeof id !== 'string' || !SNAPSHOT_ID.test(id))) fail('manifest gameSnapshotRefs is invalid');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail('manifest files are missing');
  const filesByPath = new Map();
  const kinds = new Set();
  const lowerPaths = new Set();
  for (const [index, file] of manifest.files.entries()) {
    const label = `manifest.files[${index}]`;
    requireExactKeys(file, ['kind', 'path', 'sizeBytes', 'sha256', 'dependencies'], label);
    if (typeof file.kind !== 'string' || !DOMAIN_KINDS.has(file.kind)) fail(`${label}.kind is unknown`);
    requireSafeRelativeJsonPath(file.path, `${label}.path`);
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > MAX_DOMAIN_BYTES) fail(`${label}.sizeBytes exceeds the supported limit`);
    requireSha(file.sha256, SHA256, `${label}.sha256`);
    if (!Array.isArray(file.dependencies) || new Set(file.dependencies).size !== file.dependencies.length) fail(`${label}.dependencies is invalid`);
    for (const dependency of file.dependencies) requireSafeRelativeJsonPath(dependency, `${label}.dependencies`);
    if (filesByPath.has(file.path) || lowerPaths.has(file.path.toLowerCase())) fail('manifest has duplicate or case-colliding paths');
    filesByPath.set(file.path, file);
    lowerPaths.add(file.path.toLowerCase());
    kinds.add(file.kind);
  }
  const rows = kind => manifest.files.filter(file => file.kind === kind);
  const hasLegacy = rows('weapons').length > 0 || rows('blessings').length > 0;
  const hasSplit = rows('weapons-index').length > 0 || rows('weapon-family').length > 0
    || rows('blessings-index').length > 0 || rows('blessing').length > 0;
  const hasSplitFeature = features.includes(SPLIT_DOMAIN_FEATURE);
  if (hasLegacy && hasSplit) fail('manifest mixes legacy and split weapon/blessing domain kinds');
  if (!hasLegacy && !hasSplit) fail('manifest has no supported weapon/blessing domain format');
  const domainFormat = hasSplit ? 'split' : 'legacy';
  if (domainFormat === 'legacy') {
    if (hasSplitFeature) fail('legacy weapon/blessing domains must not declare the split feature');
    for (const kind of CORE_KINDS) if (rows(kind).length !== 1) fail(`legacy manifest requires exactly one ${kind} domain`);
  } else {
    if (!hasSplitFeature) fail('split weapon/blessing domains require their feature flag');
    for (const kind of SPLIT_CORE_KINDS) if (rows(kind).length !== 1) fail(`split manifest requires exactly one ${kind} domain`);
    if (rows('weapon-family').length === 0 || rows('blessing').length === 0) {
      fail('split manifest requires at least one weapon-family and one blessing domain');
    }
    const weaponIndex = rows('weapons-index')[0];
    const blessingIndex = rows('blessings-index')[0];
    if (weaponIndex.path !== 'domains/weapons-index.json' || weaponIndex.dependencies.length !== 0) {
      fail('weapons-index path or dependencies are invalid');
    }
    if (blessingIndex.path !== 'domains/blessings-index.json' || blessingIndex.dependencies.length !== 0) {
      fail('blessings-index path or dependencies are invalid');
    }
    for (const file of rows('weapon-family')) {
      if (!/^domains\/weapons\/[A-Za-z0-9._-]+\.json$/u.test(file.path)
          || file.dependencies.length !== 1 || file.dependencies[0] !== weaponIndex.path) {
        fail(`weapon-family path or dependencies are invalid: ${file.path}`);
      }
    }
    for (const file of rows('blessing')) {
      if (!/^domains\/blessings\/[A-Za-z0-9._-]+\.json$/u.test(file.path)
          || file.dependencies.length !== 1 || file.dependencies[0] !== blessingIndex.path) {
        fail(`blessing path or dependencies are invalid: ${file.path}`);
      }
    }
    const sortedPaths = manifest.files.map(file => file.path).slice().sort(compareUtf8);
    if (manifest.files.some((file, index) => file.path !== sortedPaths[index])) fail('split manifest files are not sorted by path');
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = filePath => {
    const file = filesByPath.get(filePath);
    if (!file) fail(`manifest dependency is missing: ${filePath}`);
    if (visiting.has(filePath)) fail('manifest contains a dependency cycle');
    if (visited.has(filePath)) return;
    visiting.add(filePath);
    for (const dep of file.dependencies) visit(dep);
    visiting.delete(filePath);
    visited.add(filePath);
  };
  for (const filePath of filesByPath.keys()) visit(filePath);
  if (manifest.changeIndexPath !== null) {
    requireSafeRelativeJsonPath(manifest.changeIndexPath, 'manifest.changeIndexPath');
    if (filesByPath.get(manifest.changeIndexPath)?.kind !== 'game-changes') fail('manifest changeIndexPath does not identify a listed game-changes file');
  }
  return { filesByPath, domainFormat };
}

function selectConsumerFiles(manifest, filesByPath, requiredKinds = CORE_KINDS) {
  const selected = new Map();
  const add = file => {
    if (!CORE_KINDS.includes(file.kind)) fail(`Web consumer cannot load dependency kind ${file.kind}`);
    if (selected.has(file.path)) return;
    selected.set(file.path, file);
    for (const dependency of file.dependencies) add(filesByPath.get(dependency));
  };
  for (const kind of requiredKinds) {
    const rows = manifest.files.filter(file => file.kind === kind);
    if (!rows.length) fail(`manifest is missing required ${kind} domain`);
    rows.forEach(add);
  }
  return [...selected.values()].sort((a, b) => compareUtf8(a.path, b.path));
}

function selectFilesWithDependencies(filesByPath, roots) {
  const selected = new Map();
  const add = file => {
    if (!file || selected.has(file.path)) return;
    selected.set(file.path, file);
    for (const dependency of file.dependencies) add(filesByPath.get(dependency));
  };
  for (const file of roots) add(file);
  return [...selected.values()].sort((left, right) => compareUtf8(left.path, right.path));
}

function blessingSlug(recordId) {
  const prefix = 'darktide:blessing:';
  if (typeof recordId !== 'string' || recordId.length === 0) fail('blessing route has no record identity');
  const unprefixed = recordId.startsWith(prefix) ? recordId.slice(prefix.length) : recordId;
  const slug = unprefixed.replace(/[^A-Za-z0-9._-]/gu, '-');
  if (!slug) fail('blessing route produces an empty domain slug');
  return slug;
}

function selectSplitRouteFiles(manifest, filesByPath, pathname, search) {
  const rows = kind => manifest.files.filter(file => file.kind === kind);
  const one = kind => {
    const matches = rows(kind);
    if (matches.length !== 1) fail(`split manifest requires one ${kind} domain`);
    return matches[0];
  };
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const oneParam = name => {
    const values = params.getAll(name);
    if (values.length > 1) fail(`route contains duplicate ${name} parameters`);
    return values[0] ?? null;
  };
  let roots;
  if (typeof pathname === 'string' && /^\/skills(?:\/|$)/u.test(pathname)) {
    roots = [one('skills'), one('terms')];
  } else if (typeof pathname === 'string' && /^\/weapons(?:\/|$)/u.test(pathname)) {
    const familyId = oneParam('family');
    if (familyId === null) roots = [one('weapons-index')];
    else {
      if (!/^[A-Za-z0-9._-]+$/u.test(familyId)) fail('weapon route familyId is not a safe domain segment');
      const family = filesByPath.get(`domains/weapons/${familyId}.json`);
      if (!family || family.kind !== 'weapon-family') fail('weapon route has no matching family domain');
      roots = [one('weapons-index'), family, one('blessings-index')];
    }
  } else if (typeof pathname === 'string' && /^\/blessings(?:\/|$)/u.test(pathname)) {
    const recordId = oneParam('id');
    if (recordId === null) roots = [one('blessings-index')];
    else {
      const blessing = filesByPath.get(`domains/blessings/${blessingSlug(recordId)}.json`);
      if (!blessing || blessing.kind !== 'blessing') fail('blessing route has no matching detail domain');
      roots = [one('blessings-index'), blessing, one('weapons-index')];
    }
  } else if (typeof pathname === 'string' && /^\/game-changes(?:\/|$)/u.test(pathname)) {
    const changeIndex = manifest.changeIndexPath === null ? null : filesByPath.get(manifest.changeIndexPath);
    roots = [changeIndex, one('skills'), one('terms'), one('weapons-index'), one('blessings-index')].filter(Boolean);
  } else if (typeof pathname === 'string' && /^\/announcements(?:\/|$)/u.test(pathname)) {
    const announcements = rows('announcements');
    if (announcements.length > 1) fail('manifest contains multiple announcements domains');
    roots = announcements;
  } else if (pathname === '/terms/' || pathname === '/terms') {
    roots = [one('terms')];
  } else {
    roots = [];
  }
  return selectFilesWithDependencies(filesByPath, roots);
}

function selectOptionalGameChangesFile(manifest, filesByPath) {
  if (manifest.changeIndexPath === null) return null;
  const file = filesByPath.get(manifest.changeIndexPath);
  if (!file || file.kind !== 'game-changes') fail('manifest changeIndexPath does not identify a game-changes file');
  for (const dependency of file.dependencies) {
    const dependencyFile = filesByPath.get(dependency);
    if (!dependencyFile || !CORE_KINDS.includes(dependencyFile.kind)) {
      fail('game-changes index has an unsupported dependency');
    }
  }
  return file;
}

function selectOptionalAnnouncementsFile(manifest, filesByPath) {
  const rows = manifest.files.filter(file => file.kind === 'announcements');
  if (rows.length > 1) fail('manifest contains multiple announcements domains');
  const file = rows[0] ?? null;
  if (!file) return null;
  for (const dependency of file.dependencies) {
    const dependencyFile = filesByPath.get(dependency);
    if (!dependencyFile || !CORE_KINDS.includes(dependencyFile.kind)) {
      fail('announcements domain has an unsupported dependency');
    }
  }
  return file;
}

function typedPointers(value, result = []) {
  if (Array.isArray(value)) { for (const item of value) typedPointers(item, result); return result; }
  if (!isObject(value)) return result;
  if (typeof value.recordId === 'string' && typeof value.gameReleaseId === 'string') result.push(value);
  for (const child of Object.values(value)) typedPointers(child, result);
  return result;
}
function sourcePointers(value, result = []) {
  if (Array.isArray(value)) { for (const item of value) sourcePointers(item, result); return result; }
  if (!isObject(value)) return result;
  if (typeof value.sourceId === 'string' && typeof value.gameReleaseId === 'string') result.push(value);
  for (const child of Object.values(value)) sourcePointers(child, result);
  return result;
}
function sourceRecordKey(record) { return `${record.gameReleaseId}\u0000${record.recordId}`; }
function sourceRefKey(ref) { return `${ref.gameReleaseId}\u0000${ref.sourceId}`; }
function officialSourceIds(value, result = new Set()) {
  if (Array.isArray(value)) { for (const item of value) officialSourceIds(item, result); return result; }
  if (!isObject(value)) return result;
  if (typeof value.officialSourceId === 'string') result.add(value.officialSourceId);
  for (const child of Object.values(value)) officialSourceIds(child, result);
  return result;
}
function validateDomain(document, file, releaseId) {
  requireExactKeys(document, ['schemaVersion', 'kind', 'gameReleaseId', 'source', 'web'], file.path);
  if (document.schemaVersion !== DOMAIN_SCHEMA || document.kind !== file.kind || document.gameReleaseId !== releaseId) {
    fail(`domain identity does not match the selected release: ${file.path}`);
  }
  requireExactKeys(document.source, ['repository', 'gameReleases', 'sourceSnapshots', 'sourceRefs', 'records', 'tombstones', 'reviewReceipts'], `${file.path}.source`);
  if (document.source.repository !== SOURCE_REPOSITORY) fail(`domain Source repository is invalid: ${file.path}`);
  for (const key of ['gameReleases', 'sourceSnapshots', 'sourceRefs', 'records', 'tombstones', 'reviewReceipts']) {
    if (!Array.isArray(document.source[key])) fail(`domain source.${key} is invalid: ${file.path}`);
  }
  const records = new Map();
  const isIndex = file.kind === 'weapons-index' || file.kind === 'blessings-index';
  const indexRecordKind = file.kind === 'weapons-index' ? 'weapon' : file.kind === 'blessings-index' ? 'blessing' : null;
  for (const record of document.source.records) {
    if (!isObject(record) || typeof record.recordId !== 'string' || typeof record.gameReleaseId !== 'string' || typeof record.kind !== 'string') fail(`domain contains an invalid Source record: ${file.path}`);
    const key = sourceRecordKey(record);
    if (records.has(key)) fail(`domain duplicates Source record ${record.recordId}`);
    records.set(key, record);
  }
  if (isIndex) {
    if (![...records.values()].some(record => record.kind === indexRecordKind && record.gameReleaseId === releaseId)) {
      fail(`split index has no ${indexRecordKind} records: ${file.path}`);
    }
    if ([...records.values()].some(record => ![indexRecordKind, 'release-compatibility'].includes(record.kind))) {
      fail(`split index contains a non-index Source record: ${file.path}`);
    }
  } else {
    for (const record of records.values()) {
      for (const ref of typedPointers(record)) {
        const target = records.get(sourceRecordKey(ref));
        if (!target || (ref.kind && ref.kind !== target.kind)) fail(`domain Source closure is incomplete: ${ref.recordId}`);
      }
    }
  }
  const sourceRefs = new Map(document.source.sourceRefs.map(ref => [sourceRefKey(ref), ref]));
  if (sourceRefs.size !== document.source.sourceRefs.length) fail(`domain provenance has duplicate identities: ${file.path}`);
  for (const ref of sourcePointers(document.source.records)) if (!sourceRefs.has(sourceRefKey(ref))) fail(`domain Source provenance is incomplete: ${ref.sourceId}`);
  const webKeys = new Set(['presentations', 'officialInputs', 'termLocalizations', 'termRules', 'announcements', 'gameChanges', 'officialTextChanges', 'reviewTargets', 'reviewReceipts']);
  if (!isObject(document.web) || Object.keys(document.web).some(key => !webKeys.has(key))) fail(`domain Web projection contains unsupported fields: ${file.path}`);
  for (const key of ['presentations', 'termLocalizations', 'announcements', 'gameChanges', 'officialTextChanges', 'reviewTargets', 'reviewReceipts']) {
    if (!Array.isArray(document.web[key])) fail(`domain Web projection is missing ${key}: ${file.path}`);
  }
  if (!isObject(document.web.officialInputs) || !Array.isArray(document.web.officialInputs.sources)) fail(`domain official inputs are missing: ${file.path}`);
  const officialIds = new Set(document.web.officialInputs.sources.map(source => source?.officialSourceId));
  if (officialIds.size !== document.web.officialInputs.sources.length) fail(`domain official IDs are duplicated: ${file.path}`);
  for (const presentation of document.web.presentations) {
    if (!isObject(presentation) || presentation.locale !== 'zh-TW' || typeof presentation.name !== 'string' || !presentation.name.trim()) {
      fail(`domain presentation has no required zh-TW name: ${file.path}`);
    }
    for (const id of officialSourceIds(presentation)) if (!officialIds.has(id)) fail(`domain official source closure is incomplete: ${id}`);
  }
  const webRows = [...document.web.presentations, ...document.web.termLocalizations, ...document.web.announcements, ...document.web.gameChanges, ...document.web.officialTextChanges];
  for (const ref of typedPointers(webRows)) {
    const target = records.get(sourceRecordKey(ref));
    if (!target && isIndex) continue;
    if (!target || (ref.kind && ref.kind !== target.kind)) fail(`domain Web typed reference is unresolved: ${ref.recordId}`);
  }
  for (const ref of sourcePointers(webRows)) if (!sourceRefs.has(sourceRefKey(ref))) fail(`domain Web provenance is unresolved: ${ref.sourceId}`);
  const targetIds = new Set();
  for (const row of document.web.reviewTargets) {
    if (!isObject(row) || typeof row.mode !== 'string' || !isObject(row.target) || typeof row.target.targetId !== 'string'
        || !['approved', 'pending', 'stale', 'rejected'].includes(row.state)) fail(`domain review target is invalid: ${file.path}`);
    const key = `${row.mode}\u0000${row.target.targetId}`;
    if (targetIds.has(key)) fail(`domain review target is duplicated: ${row.target.targetId}`);
    targetIds.add(key);
  }
}

function makeLoadLifecycle(callerSignal) {
  const controller = new AbortController();
  let rejectTimeout;
  let rejectCaller;
  let timedOut = false;
  const timeoutError = new Error('shared data request timed out');
  timeoutError.name = 'TimeoutError';
  const timeoutPromise = new Promise((_, reject) => { rejectTimeout = reject; });
  const callerPromise = new Promise((_, reject) => { rejectCaller = reject; });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(timeoutError);
    rejectTimeout(timeoutError);
  }, REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => {
    const reason = callerSignal?.reason instanceof Error
      ? callerSignal.reason
      : new DOMException('The shared data request was aborted.', 'AbortError');
    controller.abort(reason);
    rejectCaller(reason);
  };
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  return {
    signal: controller.signal,
    race: operation => Promise.race([Promise.resolve(operation), timeoutPromise, callerPromise]),
    dispose() {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

function cancelReader(reader, reason) {
  try { void reader.cancel(reason).catch(() => {}); } catch { /* The reader may already be released. */ }
}

async function readBoundedJson(fetchImpl, url, limit, lifecycle) {
  const expectedUrl = url.href;
  const response = await lifecycle.race(fetchImpl(expectedUrl, {
    method: 'GET', credentials: 'omit', redirect: 'error', signal: lifecycle.signal,
  }));
  if (!response || response.status !== 200 || response.ok !== true) fail(`shared data request failed (${response?.status ?? 'no response'})`);
  if (response.redirected || response.url !== expectedUrl) fail('shared data response URL changed');
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?)?\s*$/iu.test(contentType)) fail('shared data response must be UTF-8 JSON');
  if (!response.body?.getReader) fail('shared data response has no bounded readable body');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) fail('shared data response contains invalid bytes');
      total += value.byteLength;
      if (total > limit) {
        cancelReader(reader, 'size limit exceeded');
        fail('shared data response exceeds its byte limit');
      }
      chunks.push(value);
    }
  } catch (error) {
    cancelReader(reader, error);
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* A cancelled in-flight read may still be settling. */ }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (error) { throw new Error('shared data response is not valid UTF-8', { cause: error }); }
  let value;
  try { value = JSON.parse(text); }
  catch (error) { throw new Error('shared data response is not valid JSON', { cause: error }); }
  return { bytes, value };
}

function isSkillsPath(pathname) {
  return typeof pathname === 'string' && /^\/skills(?:\/|$)/u.test(pathname);
}

function sharedClientIdentity(pointer) {
  return [pointer.game_version, pointer.content_version, pointer.data_revision, pointer.manifest_path, pointer.manifest_sha256].join('\u0000');
}

function sharedDomainCacheKey(manifest, file) {
  return [manifest.gameReleaseId, manifest.dataRevision, file.path, file.sizeBytes, file.sha256].join('\u0000');
}

export async function loadSharedRelease({
  build,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  cryptoApi = globalThis.crypto,
  signal,
  pathname,
  search = '',
  cache = null,
  force = false,
} = {}) {
  const { pointer, staticFiles } = selectSharedRelease(build);
  const cacheIdentity = sharedClientIdentity(pointer);
  if (cache) {
    if (cache.identity !== null && cache.identity !== cacheIdentity) fail('shared client cache is bound to a different release pointer');
    cache.identity = cacheIdentity;
  }
  if (Object.hasOwn(build, 'shared_package_kind')
      && !['fixture', 'published'].includes(build.shared_package_kind)) {
    fail('shared package kind is unsupported');
  }
  const fixtureOnly = build.shared_package_kind === 'fixture';
  if (fixtureOnly && (build.shared_fixture_only !== true || typeof build.fixture_id !== 'string' || !build.fixture_id.trim())) {
    fail('shared fixture package is missing its non-publishable marker');
  }
  if (build.shared_package_kind === 'published'
      && (Object.hasOwn(build, 'shared_fixture_only') || Object.hasOwn(build, 'fixture_id'))) {
    fail('published shared package contains fixture-only markers');
  }
  if (typeof fetchImpl !== 'function' || !cryptoApi?.subtle || !globalThis.location?.origin) fail('shared data runtime is unavailable');
  const lifecycle = makeLoadLifecycle(signal);
  try {
  const baseOrigin = globalThis.location.origin;
  const makeUrl = path => {
    const url = new URL(path, `${baseOrigin}/`);
    if (url.origin !== baseOrigin || url.pathname !== path || url.search || url.hash) fail('shared data path escaped its same-origin release root');
    return url;
  };
  const loadManifest = async () => {
    const manifestUrl = makeUrl(pointer.manifest_path);
    const manifestResponse = await readBoundedJson(fetchImpl, manifestUrl, MAX_MANIFEST_BYTES, lifecycle);
    if (await lifecycle.race(sha256(manifestResponse.bytes, cryptoApi)) !== pointer.manifest_sha256) fail('shared manifest hash does not match the build pointer');
    const manifest = manifestResponse.value;
    const { filesByPath, domainFormat } = validateManifestShape(manifest, pointer);
    const material = utf8Json(dataRevisionMaterial(manifest));
    if (await lifecycle.race(sha256(material, cryptoApi)) !== manifest.dataRevision) fail('shared manifest canonical data revision is invalid');
    return { manifestResponse, manifest, filesByPath, domainFormat };
  };
  let manifestPromise = cache?.manifestPromise ?? null;
  if (!manifestPromise) {
    manifestPromise = Promise.resolve().then(loadManifest);
    if (cache) {
      cache.manifestPromise = manifestPromise;
      manifestPromise = manifestPromise.catch(error => {
        if (cache.manifestPromise === manifestPromise) cache.manifestPromise = null;
        throw error;
      });
      manifestPromise.catch(() => {});
      cache.manifestPromise = manifestPromise;
    }
  }
  const { manifestResponse, manifest, filesByPath, domainFormat } = cache
    ? await lifecycle.race(manifestPromise)
    : await manifestPromise;

  // Bind the complete manifest file set to the immutable build pins even when a route fetches only a shard.
  let selectedFiles;
  let pinnedFiles;
  let skillsOnly = false;
  let announcementsFile = null;
  let changeIndex = null;
  if (domainFormat === 'legacy') {
    const allCoreFiles = selectConsumerFiles(manifest, filesByPath);
    announcementsFile = selectOptionalAnnouncementsFile(manifest, filesByPath);
    changeIndex = selectOptionalGameChangesFile(manifest, filesByPath);
    pinnedFiles = new Map(allCoreFiles.map(file => [file.path, file]));
    if (changeIndex) pinnedFiles.set(changeIndex.path, changeIndex);
    if (announcementsFile) pinnedFiles.set(announcementsFile.path, announcementsFile);
    skillsOnly = isSkillsPath(pathname);
    const routeCoreFiles = skillsOnly
      ? selectConsumerFiles(manifest, filesByPath, ['skills', 'terms'])
      : allCoreFiles;
    const routeFiles = new Map(routeCoreFiles.map(file => [file.path, file]));
    if (!skillsOnly) {
      if (changeIndex) routeFiles.set(changeIndex.path, changeIndex);
      if (announcementsFile) routeFiles.set(announcementsFile.path, announcementsFile);
    }
    selectedFiles = [...routeFiles.values()];
  } else {
    announcementsFile = selectOptionalAnnouncementsFile(manifest, filesByPath);
    changeIndex = selectOptionalGameChangesFile(manifest, filesByPath);
    pinnedFiles = new Map(manifest.files.map(file => [file.path, file]));
    selectedFiles = selectSplitRouteFiles(manifest, filesByPath, pathname ?? '/', search);
  }
  const preflightCompleteLegacyPackage = domainFormat === 'legacy' && skillsOnly;
  let packageBytes = manifestResponse.bytes.byteLength;
  for (const file of pinnedFiles.values()) {
    const path = `/data/${manifest.dataRevision}/${file.path}`;
    const pinned = staticFiles.get(path);
    if (!pinned || pinned.sha256 !== file.sha256 || pinned.size_bytes !== file.sizeBytes) {
      if (file.path === changeIndex?.path) fail('build does not pin the optional game-changes index');
      if (file.path === announcementsFile?.path) fail('build does not pin the optional announcements domain');
      fail(`build does not pin selected domain ${file.path}`);
    }
    if (preflightCompleteLegacyPackage) {
      packageBytes += file.sizeBytes;
      if (packageBytes > MAX_PACKAGE_BYTES) fail('selected shared domains exceed the package byte limit');
    }
  }
  if (!preflightCompleteLegacyPackage) packageBytes = manifestResponse.bytes.byteLength;
  const loadedForRequest = new Map();
  const fetchDomain = async file => {
    const path = `/data/${manifest.dataRevision}/${file.path}`;
    const response = await readBoundedJson(fetchImpl, makeUrl(path), Math.min(MAX_DOMAIN_BYTES, file.sizeBytes), lifecycle);
    if (response.bytes.byteLength !== file.sizeBytes
        || await lifecycle.race(sha256(response.bytes, cryptoApi)) !== file.sha256) {
      fail(`shared domain bytes do not match manifest: ${file.path}`);
    }
    validateDomain(response.value, file, manifest.gameReleaseId);
    return { file, path, bytes: response.bytes, document: response.value };
  };
  for (const file of selectedFiles) {
    if (!preflightCompleteLegacyPackage && packageBytes + file.sizeBytes > MAX_PACKAGE_BYTES) {
      fail('selected shared domains exceed the package byte limit');
    }
    const key = sharedDomainCacheKey(manifest, file);
    let loaded;
    if (force && cache) {
      cache.domainPromises.delete(key);
      cache.domainValues.delete(key);
    }
    if (!cache) {
      loaded = await fetchDomain(file);
    } else {
      let promise = cache.domainPromises.get(key);
      if (!promise) {
        promise = Promise.resolve().then(() => fetchDomain(file))
          .then(value => {
            cache.domainValues.set(key, value);
            return value;
          })
          .catch(error => {
            if (cache.domainPromises.get(key) === promise) cache.domainPromises.delete(key);
            throw error;
          });
        promise.catch(() => {});
        cache.domainPromises.set(key, promise);
      }
      loaded = await lifecycle.race(promise);
    }
    loadedForRequest.set(key, loaded);
    if (!preflightCompleteLegacyPackage) packageBytes += loaded.bytes.byteLength;
  }

  const loadedValues = cache ? [...cache.domainValues.values()] : [...loadedForRequest.values()];
  loadedValues.sort((left, right) => compareUtf8(left.file.path, right.file.path));
  const domains = loadedValues.map(value => value.document);
  const rawFiles = new Map([[pointer.manifest_path, manifestResponse.bytes]]);
  for (const value of loadedValues) rawFiles.set(value.path, value.bytes);
  const view = createSharedViewModel({ domains, gameReleaseId: manifest.gameReleaseId, fixtureOnly });
  return Object.freeze({
    status: 'ready',
    fixtureOnly,
    fixtureId: fixtureOnly ? build.fixture_id : null,
    pointer,
    manifest,
    manifestBytes: manifestResponse.bytes,
    domains: Object.freeze(domains),
    rawFiles,
    view,
  });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
    throw error;
  } finally {
    lifecycle.dispose();
  }
}

export function createSharedClient(options = {}) {
  if (options.build?.source_data === true) return createSourceClient(options);
  const cache = { identity: null, manifestPromise: null, domainPromises: new Map(), domainValues: new Map() };
  return Object.freeze({
    load: ({ signal, pathname, search = '', force = false } = {}) => loadSharedRelease({
      ...options,
      signal,
      pathname,
      search,
      force,
      cache: signal ? null : cache,
    }),
  });
}
