import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertExactKeys, compareUtf8, hashNamedFiles, parseJson, safeRelativePath, sha256
} from './common.mjs';
import { validateCacheHeaders } from './header-policy.mjs';
import { renderStaticRewrites } from './routing-policy.mjs';
import { verifyHashedModuleGraph } from './module-graph.mjs';
import { validatePublicFiles } from '../published/contract.mjs';
import { validateVersion as validateW02Version } from '../../scripts/content/contract-release.mjs';
import { createSharedReleaseIdentity, validateSharedStaticFiles } from './shared-release.mjs';
import { SHARED_ANNOUNCEMENT_ROUTING_CAPABILITY } from '../../web/shared-render.mjs';

const MANIFEST_FIELDS = ['schema_version', 'package_kind', 'build_id', 'data_revision', 'files'];
const FILE_FIELDS = ['path', 'size_bytes', 'sha256'];
const VERSION_FIELDS = ['schema_version', 'data_revision', 'build_id', 'game_version', 'package_kind'];
const HASHED_ASSET = /^assets\/[a-f0-9]{64}\.(?:mjs|js|css)$/;
const INITIAL_GAMES_LANTERN_MARKER = '__GAMES_LANTERN_CREDIT__';
const INITIAL_GAMES_LANTERN_CREDIT = '<p class="asset-credit">本網站部分圖片素材經 <a href="https://darktide.gameslantern.com/">Games Lantern</a> 許可使用。</p>';
const FIXED_REQUIRED = new Set(['index.html', 'version.json', '_headers', '_redirects', 'robots.txt', 'artifact-manifest.json']);
const PRIVATE_KEYS = new Set([
  'evidence', 'private', 'privatepath', 'privatesourcepath', 'sourcepath',
  'templatesourceid', 'review', 'reviewnotes', 'reviewstatus', 'rights',
  'rightsledger', 'rightsevidence', 'sourcecommit', 'sourcecheckout',
  'gitcommit', 'rawbytes', 'secret', 'apikey', 'token', 'password'
]);

function fail(message) { throw new Error(message); }

function normalizePrivateKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const OFFICIAL_INPUT_SOURCE_PATH = /^(data\/[a-f0-9]{64}\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.json)\.web\.officialInputs\.sources\[\d+\]$/u;
const OFFICIAL_PRESENTATION_SOURCE_PATH = /^(data\/[a-f0-9]{64}\/(?:domains\/)?(?:skills|blessings|weapons)\.json)\.web\.presentations\[\d+\]\.official$/u;
const OFFICIAL_PARAMETER_TOKEN_PATH = /^(data\/[a-f0-9]{64}\/(?:domains\/)?(?:skills|blessings|weapons)\.json)\.web\.(?:officialInputs\.sources\[\d+\]|presentations\[\d+\]\.official)\.segments\[\d+\]\.token$/u;
const GAME_CHANGE_PARAMETER_TOKEN_PATH = /^(data\/[a-f0-9]{64}\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.json)\.web\.officialInputs\.sources\[\d+\]\.segments\[\d+\]\.token$/u;
const WEAPON_PARAMETER_TOKEN_PATH = /^(data\/[a-f0-9]{64}\/(?:domains\/)?weapons\.json)\.web\.officialInputs\.sources\[\d+\]\.segments\[\d+\]\.token$/u;

function validatePublicOfficialInput(source, location, validatedParameterSegments = null) {
  const sourceRequired = [
    'officialSourceId', 'entityRef', 'origin', 'sourceLocale', 'resource', 'key', 'occurrence',
    'sourceText', 'sourceTextSha256', 'segments', 'params', 'resolvedText', 'resolvedTextSha256',
  ];
  const sourceAllowed = new Set([...sourceRequired, 'sourceHash', 'bindingContext']);
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      sourceRequired.some(key => !Object.hasOwn(source, key)) || Object.keys(source).some(key => !sourceAllowed.has(key)) ||
      typeof source.officialSourceId !== 'string' || !/^[a-z0-9][a-z0-9:._-]{1,127}$/u.test(source.officialSourceId) ||
      !['game-localization', 'official-patch-notes', 'official-ui'].includes(source.origin) ||
      typeof source.sourceLocale !== 'string' || source.sourceLocale.length < 2 || source.sourceLocale.length > 35 ||
      typeof source.resource !== 'string' || source.resource.length < 1 || source.resource.length > 10000 ||
      (source.key !== null && (typeof source.key !== 'string' || !/^[a-z0-9][a-z0-9:._-]{1,127}$/u.test(source.key))) ||
      !Number.isSafeInteger(source.occurrence) || source.occurrence < 0 ||
      !Array.isArray(source.segments) || source.segments.length === 0 || !Array.isArray(source.params) ||
      typeof source.sourceText !== 'string' || typeof source.sourceTextSha256 !== 'string' ||
      typeof source.resolvedText !== 'string' || typeof source.resolvedTextSha256 !== 'string') {
    fail('public official input has an invalid formal segment shape at ' + location);
  }
  if (!source.entityRef || typeof source.entityRef !== 'object' || Array.isArray(source.entityRef) ||
      !['recordId', 'gameReleaseId', 'kind'].every(key => Object.hasOwn(source.entityRef, key)) ||
      Object.keys(source.entityRef).some(key => !['recordId', 'gameReleaseId', 'kind', 'compatibilityRef'].includes(key)) ||
      typeof source.entityRef.recordId !== 'string' || !/^[a-z0-9][a-z0-9:._-]{1,127}$/u.test(source.entityRef.recordId) ||
      typeof source.entityRef.gameReleaseId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{1,127}$/u.test(source.entityRef.gameReleaseId) ||
      typeof source.entityRef.kind !== 'string') {
    fail('public official input has an invalid entity reference at ' + location);
  }
  if (source.sourceHash !== undefined && (typeof source.sourceHash !== 'string' || !/^[a-f0-9]{8,64}$/u.test(source.sourceHash))) {
    fail('public official input has an invalid fixed source hash at ' + location);
  }
  const parameters = new Map();
  for (const parameter of source.params) {
    if (!parameter || typeof parameter !== 'object' || Array.isArray(parameter) ||
        !['parameterId', 'sourceKey', 'value'].every(key => Object.hasOwn(parameter, key)) ||
        Object.keys(parameter).some(key => !['parameterId', 'sourceKey', 'value', 'officialNameRef'].includes(key)) ||
        typeof parameter.parameterId !== 'string' || typeof parameter.value !== 'string' ||
        !/^[a-z0-9][a-z0-9:._-]{1,127}$/u.test(parameter.parameterId) ||
        typeof parameter.sourceKey !== 'string' || !/^[a-z0-9][a-z0-9:._-]{1,127}$/u.test(parameter.sourceKey) ||
        parameters.has(parameter.parameterId)) {
      fail('public official input has an invalid or duplicate parameter binding at ' + location);
    }
    parameters.set(parameter.parameterId, parameter.value);
  }
  const segmentIds = new Set();
  const usedParameters = new Set();
  const sourceParts = [];
  const renderedParts = [];
  for (const segment of source.segments) {
    if (!segment || typeof segment !== 'object' || Array.isArray(segment) ||
        typeof segment.segmentId !== 'string' || !/^[a-z0-9][a-z0-9:._-]{1,127}$/u.test(segment.segmentId) || segmentIds.has(segment.segmentId) ||
        typeof segment.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(segment.sha256)) {
      fail('public official input has an invalid or duplicate segment at ' + location);
    }
    segmentIds.add(segment.segmentId);
    if (segment.kind === 'text') {
      if (Object.keys(segment).sort().join(',') !== 'kind,segmentId,sha256,text' || typeof segment.text !== 'string' ||
          sha256(Buffer.from(segment.text, 'utf8')) !== segment.sha256) {
        fail('public official text segment does not match its formal bytes at ' + location);
      }
      sourceParts.push(segment.text);
      renderedParts.push(segment.text);
    } else if (segment.kind === 'parameter') {
      if (Object.keys(segment).sort().join(',') !== 'kind,parameterId,segmentId,sha256,token' ||
          typeof segment.parameterId !== 'string' || typeof segment.token !== 'string' || segment.token.length === 0 ||
          sha256(Buffer.from(segment.token, 'utf8')) !== segment.sha256 || !parameters.has(segment.parameterId)) {
        fail('public official parameter segment does not match its formal binding at ' + location);
      }
      usedParameters.add(segment.parameterId);
      validatedParameterSegments?.add(segment);
      sourceParts.push(segment.token);
      renderedParts.push(parameters.get(segment.parameterId));
    } else {
      fail('public official input has an unsupported segment kind at ' + location);
    }
  }
  if (usedParameters.size !== parameters.size || [...parameters.keys()].some(id => !usedParameters.has(id))) {
    fail('public official input has an unbound parameter at ' + location);
  }
  if (source.sourceText !== sourceParts.join('') || source.resolvedText !== renderedParts.join('') ||
      sha256(Buffer.from(source.sourceText, 'utf8')) !== source.sourceTextSha256 ||
      sha256(Buffer.from(source.resolvedText, 'utf8')) !== source.resolvedTextSha256) {
    fail('public official input text does not match its ordered segments and bindings at ' + location);
  }
}

function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedJsonValue(value[key])]));
  }
  return value;
}

function collectOfficialInputSources(filePath, value, officialInputFiles) {
  if (!officialInputFiles.has(filePath)) return null;
  const sources = value?.web?.officialInputs?.sources;
  if (!Array.isArray(sources)) return new Map();
  const byId = new Map();
  for (const source of sources) {
    if (!source || typeof source !== 'object' || typeof source.officialSourceId !== 'string' || byId.has(source.officialSourceId)) {
      fail('public official input sources have invalid or duplicate identities at ' + filePath);
    }
    byId.set(source.officialSourceId, source);
  }
  return byId;
}

function collectOfficialPresentationObjects(filePath, value, officialInputFiles) {
  const objects = new WeakSet();
  if (!officialInputFiles.has(filePath)) return objects;
  const presentations = value?.web?.presentations;
  if (Array.isArray(presentations)) {
    for (const presentation of presentations) {
      const official = presentation?.official;
      if (official && typeof official === 'object' && !Array.isArray(official)) objects.add(official);
    }
  }
  return objects;
}

function scanPublicBoundary(value, location = '$', {
  officialInputFiles = new Set(), gameChangeInputFiles = new Set(), weaponInputFiles = new Set(),
  validatedParameterSegments = new WeakSet(), officialInputSources = new Map(), officialPresentationObjects = new WeakSet()
} = {}) {
  if (typeof value === 'string') {
    if (/(?:^|[\s"'(])[A-Za-z]:[\\/]/.test(value)) fail('public JSON contains an absolute source path at ' + location);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanPublicBoundary(item, location + '[' + index + ']', {
      officialInputFiles, gameChangeInputFiles, weaponInputFiles, validatedParameterSegments, officialInputSources, officialPresentationObjects,
    }));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const officialInputMatch = OFFICIAL_INPUT_SOURCE_PATH.exec(location);
  const officialPresentationMatch = OFFICIAL_PRESENTATION_SOURCE_PATH.exec(location);
  if (officialInputMatch && officialInputFiles.has(officialInputMatch[1])) {
    const pinnedSource = officialInputSources.get(officialInputMatch[1])?.get(value.officialSourceId);
    if (!pinnedSource || pinnedSource !== value) {
      fail('public official input source is not the canonical object from its sources array at ' + location);
    }
    validatePublicOfficialInput(value, location, validatedParameterSegments);
  }
  if (officialPresentationMatch && officialInputFiles.has(officialPresentationMatch[1])) {
    if (!officialPresentationObjects.has(value)) {
      fail('public presentation official input is not from its actual presentations array at ' + location);
    }
    validatePublicOfficialInput(value, location, validatedParameterSegments);
    const pinnedSource = officialInputSources.get(officialPresentationMatch[1])?.get(value.officialSourceId);
    if (!pinnedSource || JSON.stringify(sortedJsonValue(pinnedSource)) !== JSON.stringify(sortedJsonValue(value))) {
      fail('public presentation official input does not match its validated official source identity at ' + location);
    }
  }
  for (const [key, item] of Object.entries(value)) {
    const childLocation = location + '.' + key;
    const coreOfficialParameterMatch = key === 'token' ? OFFICIAL_PARAMETER_TOKEN_PATH.exec(childLocation) : null;
    const gameChangeParameterMatch = key === 'token' ? GAME_CHANGE_PARAMETER_TOKEN_PATH.exec(childLocation) : null;
    const weaponParameterMatch = key === 'token' ? WEAPON_PARAMETER_TOKEN_PATH.exec(childLocation) : null;
    const allowedOfficialParameterToken = Boolean(
      (coreOfficialParameterMatch && officialInputFiles.has(coreOfficialParameterMatch[1]) && validatedParameterSegments.has(value)) ||
      (gameChangeParameterMatch && gameChangeInputFiles.has(gameChangeParameterMatch[1]) && validatedParameterSegments.has(value)) ||
      (weaponParameterMatch && weaponInputFiles.has(weaponParameterMatch[1]) && validatedParameterSegments.has(value))
    );
    if (PRIVATE_KEYS.has(normalizePrivateKey(key)) && !allowedOfficialParameterToken) fail('public JSON contains a private field: ' + key);
    scanPublicBoundary(item, childLocation, {
      officialInputFiles, gameChangeInputFiles, weaponInputFiles, validatedParameterSegments, officialInputSources, officialPresentationObjects,
    });
  }
}

function collectOfficialInputDomainFiles(sharedBundle) {
  const files = new Set();
  const gameChangeFiles = new Set();
  const weaponFiles = new Set();
  if (!sharedBundle) return { files, gameChangeFiles, weaponFiles };
  for (const pointer of sharedBundle.metadata.retained_releases) {
    const manifestPath = pointer.manifest_path.slice(1);
    const bytes = sharedBundle.files.get(manifestPath);
    if (!bytes) continue;
    const manifest = parseJson(bytes, manifestPath);
    for (const row of manifest.files) {
      const isCoreDomain = (row.kind === 'skills' || row.kind === 'blessings') &&
        (row.path === row.kind + '.json' || row.path === 'domains/' + row.kind + '.json');
      const isWeaponDomain = row.kind === 'weapons' && (row.path === 'weapons.json' || row.path === 'domains/weapons.json');
      // Optional game-change official inputs are trusted only at the exact manifest-declared index path.
      const isDeclaredChangeIndex = row.kind === 'game-changes' && manifest.changeIndexPath === row.path;
      if (isCoreDomain || isWeaponDomain || isDeclaredChangeIndex) {
        const publicPath = 'data/' + pointer.data_revision + '/' + row.path;
        files.add(publicPath);
        if (isDeclaredChangeIndex) gameChangeFiles.add(publicPath);
        if (isWeaponDomain) weaponFiles.add(publicPath);
      }
    }
  }
  return { files, gameChangeFiles, weaponFiles };
}

async function collectDirectory(root) {
  const rootInfo = await lstat(root).catch(error => {
    if (error.code === 'ENOENT') fail('static artifact path does not exist');
    throw error;
  });
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) fail('static artifact path must be a real directory');
  const files = new Map();
  const directories = new Set();
  const visit = async relative => {
    const absolute = relative ? path.join(root, ...relative.split('/')) : root;
    const entries = await readdir(absolute, { withFileTypes: true });
    entries.sort((a, b) => compareUtf8(a.name, b.name));
    for (const entry of entries) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      safeRelativePath(name, 'artifact path');
      const target = path.join(root, ...name.split('/'));
      const info = await lstat(target);
      if (info.isSymbolicLink()) fail('static artifact contains a symbolic link: ' + name);
      if (info.isDirectory()) {
        directories.add(name);
        await visit(name);
      } else if (info.isFile()) {
        files.set(name, await readFile(target));
      } else fail('static artifact contains an unsupported filesystem entry: ' + name);
    }
  };
  await visit('');
  return { files, directories };
}

function validateManifest(manifest, actualFiles) {
  assertExactKeys(manifest, MANIFEST_FIELDS, 'artifact manifest');
  if (manifest.schema_version !== 1) fail('unsupported artifact manifest schema_version');
  if (manifest.package_kind !== 'published' && manifest.package_kind !== 'fixture') fail('artifact package_kind is invalid');
  if (!/^[a-f0-9]{64}$/.test(manifest.build_id) || !/^[a-f0-9]{64}$/.test(manifest.data_revision)) {
    fail('artifact build_id or data_revision is invalid');
  }
  if (!Array.isArray(manifest.files)) fail('artifact manifest files must be an array');
  let previous = null;
  const listed = new Set();
  const folded = new Set();
  for (const row of manifest.files) {
    assertExactKeys(row, FILE_FIELDS, 'artifact manifest file');
    safeRelativePath(row.path, 'manifest file path');
    if (row.path === 'artifact-manifest.json') fail('artifact manifest may not list itself');
    if (!Number.isSafeInteger(row.size_bytes) || row.size_bytes < 0) fail('artifact file size is invalid: ' + row.path);
    if (typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) fail('artifact file SHA-256 is invalid: ' + row.path);
    if (previous !== null && compareUtf8(previous, row.path) >= 0) fail('artifact manifest files must be sorted and unique');
    previous = row.path;
    const foldedPath = row.path.toLowerCase();
    if (folded.has(foldedPath)) fail('artifact manifest has a case-insensitive path collision');
    folded.add(foldedPath);
    listed.add(row.path);
  }
  const actual = new Set([...actualFiles.keys()].filter(name => name !== 'artifact-manifest.json'));
  if (actual.size !== listed.size || [...actual].some(name => !listed.has(name))) {
    const missing = [...listed].filter(name => !actual.has(name));
    const extra = [...actual].filter(name => !listed.has(name));
    fail('artifact file set mismatch; missing: ' + missing.join(', ') + '; extra: ' + extra.join(', '));
  }
  for (const row of manifest.files) {
    const bytes = actualFiles.get(row.path);
    if (bytes.byteLength !== row.size_bytes || sha256(bytes) !== row.sha256) fail('artifact integrity check failed for ' + row.path);
  }
}

function validateDirectorySet(files, directories) {
  const expected = new Set();
  for (const name of files.keys()) {
    const segments = name.split('/');
    for (let index = 1; index < segments.length; index++) expected.add(segments.slice(0, index).join('/'));
  }
  if (expected.size !== directories.size || [...directories].some(name => !expected.has(name))) {
    fail('artifact contains an unexpected or empty directory');
  }
}

function validateOutputPaths(files, revision, { sharedBundle = null, runtimeRevision = revision } = {}) {
  for (const required of FIXED_REQUIRED) if (!files.has(required)) fail('static artifact is missing ' + required);
  const allowedDataRoots = new Set(['data/' + revision + '/', 'data/' + runtimeRevision + '/']);
  if (sharedBundle) for (const relativePath of sharedBundle.files.keys()) {
    const match = /^(data\/[^/]+\/)/u.exec(relativePath);
    if (match) allowedDataRoots.add(match[1]);
  }
  const allowedSourceLocks = new Set(sharedBundle ? [...sharedBundle.files.keys()].filter(name => name.startsWith('source-locks/')) : []);
  for (const name of files.keys()) {
    if (FIXED_REQUIRED.has(name) || name === 'sitemap.xml' || HASHED_ASSET.test(name)) continue;
    if (name === 'shared-fixture.json' && sharedBundle?.packageKind === 'fixture') continue;
    const prefix = [...allowedDataRoots].find(value => name.startsWith(value));
    if (prefix) {
      safeRelativePath(name.slice(prefix.length), 'published data path');
      continue;
    }
    if (allowedSourceLocks.has(name)) continue;
    fail('artifact contains an unsupported file path: ' + name);
  }
  const html = [...files.keys()].filter(name => name.endsWith('.html'));
  if (html.length !== 1 || html[0] !== 'index.html') fail('artifact must contain exactly one HTML file named index.html');
}

function validateHeaders(bytes, catalog, hasSitemap, includeAnnouncements = false) {
  try {
    validateCacheHeaders(bytes, catalog, { hasSitemap, includeAnnouncements });
  } catch (error) {
    fail(error.message);
  }
}

function hasAnnouncementRoutingCapability(assetFiles) {
  const marker = Buffer.from(SHARED_ANNOUNCEMENT_ROUTING_CAPABILITY, 'utf8');
  const matches = [...assetFiles].filter(([name, bytes]) => /^assets\/[a-f0-9]{64}\.(?:mjs|js)$/u.test(name)
    && Buffer.from(bytes).includes(marker));
  if (matches.length > 1) fail('artifact duplicates the announcement routing capability marker');
  return matches.length === 1;
}

function validateRobotsAndSitemap(files, catalog) {
  const robots = Buffer.from(files.get('robots.txt') ?? []).toString('utf8');
  const lines = robots.split(/\r?\n/);
  const sitemapLines = lines.filter(line => line.startsWith('Sitemap: '));
  if (lines[0] !== 'User-agent: *' || lines[1] !== 'Allow: /' ||
      lines.length !== (sitemapLines.length ? 4 : 3) || lines.at(-1) !== '' || sitemapLines.length > 1) {
    fail('robots.txt is invalid');
  }
  const sitemapBytes = files.get('sitemap.xml');
  if (!sitemapBytes) {
    if (sitemapLines.length !== 0) fail('robots.txt declares a missing sitemap');
    return null;
  }
  if (sitemapLines.length !== 1) fail('robots.txt must declare the generated sitemap');
  const xml = Buffer.from(sitemapBytes).toString('utf8');
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n') || !xml.includes('<urlset ')) fail('sitemap.xml is invalid');
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  const routes = ['/', ...catalog.entries.map(entry => entry.route)].sort(compareUtf8);
  if (locations.length !== routes.length || new Set(locations).size !== locations.length) fail('sitemap routes do not match the public catalog');
  let origin = null;
  const actualRoutes = [];
  for (const location of locations) {
    let url;
    try { url = new URL(location); } catch { fail('sitemap URLs must be absolute HTTPS URLs'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
      fail('sitemap URLs must be absolute HTTPS URLs without credentials, query, or fragment');
    }
    if (origin === null) origin = url.origin;
    if (origin !== url.origin) fail('sitemap URLs must use one explicit site origin');
    actualRoutes.push(url.pathname);
  }
  actualRoutes.sort(compareUtf8);
  if (actualRoutes.some((route, index) => route !== routes[index])) fail('sitemap routes do not match the public catalog');
  if (sitemapLines[0] !== 'Sitemap: ' + origin + '/sitemap.xml') fail('robots.txt sitemap origin does not match sitemap URLs');
  return origin;
}

function validateBuildContext(indexBytes, version, { sharedBundle = null, runtimeGameVersion = null, runtimePackageKind = null } = {}) {
  const index = Buffer.from(indexBytes).toString('utf8');
  const matches = [...index.matchAll(/<script>\s*window\.__BUILD__\s*=\s*(\{[^<]*?\})\s*;?\s*<\/script>/g)];
  if (matches.length !== 1) fail('index.html must inject one build context');
  const context = parseJson(Buffer.from(matches[0][1], 'utf8'), 'build context');
  if (!sharedBundle) {
    assertExactKeys(context, VERSION_FIELDS, 'build context');
    for (const field of VERSION_FIELDS) if (context[field] !== version[field]) fail('build context does not match version.json');
  } else {
    const sharedFields = ['shared_data_revision', 'shared_game_version', 'shared_package_kind', 'game_releases', 'retained_releases', 'source_locks', 'shared_files'];
    const fixtureFields = sharedBundle.packageKind === 'fixture' ? ['shared_fixture_only', 'fixture_id'] : [];
    assertExactKeys(context, [...VERSION_FIELDS, ...sharedFields, ...fixtureFields], 'shared build context');
    for (const field of VERSION_FIELDS) {
      if (field === 'data_revision' || field === 'game_version' || field === 'package_kind') continue;
      if (context[field] !== version[field]) fail('legacy build context does not match version.json');
    }
    if (!/^[a-f0-9]{64}$/.test(context.data_revision) || typeof runtimeGameVersion !== 'string'
        || context.game_version !== runtimeGameVersion || context.package_kind !== runtimePackageKind
        || !['published', 'fixture'].includes(context.package_kind)) {
      fail('shared build context does not match the retained legacy runtime package');
    }
    if (context.shared_data_revision !== version.data_revision || context.shared_game_version !== version.game_version ||
        context.shared_package_kind !== version.package_kind ||
        JSON.stringify(context.game_releases) !== JSON.stringify(version.game_releases) ||
        JSON.stringify(context.retained_releases) !== JSON.stringify(sharedBundle.metadata.retained_releases) ||
        JSON.stringify(context.source_locks) !== JSON.stringify(sharedBundle.metadata.source_locks) ||
        JSON.stringify(context.shared_files) !== JSON.stringify(sharedBundle.metadata.shared_files)) {
      fail('shared build context does not match the W02 shared release pointers');
    }
    if (sharedBundle.packageKind === 'fixture' && (context.shared_fixture_only !== true ||
        context.fixture_id !== sharedBundle.fixtureMarker.fixtureId)) {
      fail('shared fixture build context is missing its explicit non-publishable marker');
    }
  }
  if (index.includes('__BUILD_CONTEXT__')) fail('index.html has an unreplaced build context placeholder');
  return {
    index,
    normalized: index.replace(matches[0][0], '<script>window.__BUILD__=__BUILD_CONTEXT__</script>'),
    context,
  };
}

function isGamesLanternUrl(value) {
  if (typeof value !== 'string') return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  const hostname = url.hostname.toLowerCase();
  return url.protocol === 'https:' && (hostname === 'gameslantern.com' || hostname.endsWith('.gameslantern.com'));
}

function hasGamesLanternAsset(catalog, dataFiles) {
  for (const entry of catalog.entries) {
    const detail = parseJson(dataFiles.get(entry.detail_path), entry.detail_path);
    if (detail.assets.some(asset => isGamesLanternUrl(asset.source_url) || isGamesLanternUrl(asset.attribution?.href))) return true;
  }
  return false;
}

function validateInitialGamesLanternCredit(index, catalog, dataFiles) {
  if (index.includes(INITIAL_GAMES_LANTERN_MARKER)) fail('index.html has an unreplaced initial Games Lantern credit placeholder');
  const required = hasGamesLanternAsset(catalog, dataFiles);
  const footerStart = index.indexOf('<footer');
  const footerEnd = footerStart < 0 ? -1 : index.indexOf('</footer>', footerStart);
  const footer = footerEnd < 0 ? '' : index.slice(footerStart, footerEnd + '</footer>'.length);
  const creditCount = index.split(INITIAL_GAMES_LANTERN_CREDIT).length - 1;
  if (required) {
    if (footerEnd < 0 || creditCount !== 1 || !footer.includes(INITIAL_GAMES_LANTERN_CREDIT)) {
      fail('index.html is missing its required initial HTML Games Lantern credit');
    }
  } else if (creditCount !== 0) {
    fail('index.html declares a Games Lantern credit without using Games Lantern assets');
  }
}
export async function verifyStaticPackage(directory) {
  const root = path.resolve(directory);
  const { files, directories } = await collectDirectory(root);
  const manifestBytes = files.get('artifact-manifest.json');
  if (!manifestBytes) fail('static artifact is missing artifact-manifest.json');
  const manifest = parseJson(manifestBytes, 'artifact-manifest.json');
  validateManifest(manifest, files);
  validateDirectorySet(files, directories);

  const versionBytes = files.get('version.json');
  if (!versionBytes) fail('static artifact is missing version.json');
  const version = parseJson(versionBytes, 'version.json');
  const hasSharedRelease = Object.hasOwn(version, 'game_releases');
  assertExactKeys(version, hasSharedRelease ? [...VERSION_FIELDS, 'game_releases'] : VERSION_FIELDS, 'version');
  if (version.schema_version !== 2 || version.package_kind !== manifest.package_kind ||
      version.build_id !== manifest.build_id || version.data_revision !== manifest.data_revision) {
    fail('version.json does not match artifact manifest');
  }
  if (typeof version.game_version !== 'string' || !version.game_version.trim()) fail('version game_version must be a nonempty string');
  if (!/^[a-f0-9]{64}$/.test(version.data_revision)) fail('version data_revision is invalid');
  let sharedBundle = null;
  let runtimeRevision = version.data_revision;
  if (hasSharedRelease) {
    const contextMatch = /<script>\s*window\.__BUILD__\s*=\s*(\{[^<]*?\})\s*;?\s*<\/script>/u.exec(Buffer.from(files.get('index.html') ?? []).toString('utf8'));
    if (!contextMatch) fail('index.html must inject one build context');
    const initialContext = parseJson(Buffer.from(contextMatch[1], 'utf8'), 'build context');
    runtimeRevision = initialContext.data_revision;
    if (!Array.isArray(initialContext.retained_releases)) fail('shared build context is missing retained release pointers');
    const retainedReleases = initialContext.retained_releases.map(pointer => ({
      game_version: pointer.game_version,
      content_version: pointer.content_version,
      data_revision: pointer.data_revision,
      manifest_path: pointer.manifest_path,
      manifest_sha256: pointer.manifest_sha256,
    }));
    const sharedFiles = new Map([...files].filter(([name]) => (name.startsWith('data/') && !name.startsWith('data/' + runtimeRevision + '/')) || name.startsWith('source-locks/')));
    if (version.package_kind === 'fixture') {
      const markerBytes = files.get('shared-fixture.json');
      if (!markerBytes) fail('shared fixture is missing its non-publishable marker');
      const fixtureMarker = parseJson(markerBytes, 'shared-fixture.json');
      sharedBundle = validateSharedStaticFiles({ version, fixtureMarker, retainedReleases, files: sharedFiles });
    } else {
      sharedBundle = validateSharedStaticFiles({ version, retainedReleases, files: sharedFiles });
    }
    if (!/^[a-f0-9]{64}$/.test(runtimeRevision) || runtimeRevision === version.data_revision) {
      fail('shared static package must preserve a distinct legacy runtime data revision');
    }
    for (const [relativePath, expectedBytes] of sharedBundle.files) {
      const actualBytes = files.get(relativePath);
      if (!actualBytes || !Buffer.from(actualBytes).equals(expectedBytes)) fail('shared static lock or data bytes differ: ' + relativePath);
    }
    const actualLocks = new Set([...files.keys()].filter(name => name.startsWith('source-locks/')));
    const expectedLocks = new Set([...sharedBundle.files.keys()].filter(name => name.startsWith('source-locks/')));
    if (actualLocks.size !== expectedLocks.size || [...actualLocks].some(name => !expectedLocks.has(name))) {
      fail('shared static package contains an unreferenced Source lock');
    }
  }
  if (hasSharedRelease) {
    try { validateW02Version({ ...version, package_kind: 'published' }); }
    catch (error) { fail('shared version.json violates the closed W02 version contract: ' + error.message); }
    if (sharedBundle.packageKind !== version.package_kind) fail('shared package kind differs from its validated marker');
  }
  validateOutputPaths(files, version.data_revision, { sharedBundle, runtimeRevision });

  const {
    files: officialInputFiles,
    gameChangeFiles: gameChangeInputFiles,
    weaponFiles: weaponInputFiles,
  } = collectOfficialInputDomainFiles(sharedBundle);
  const validatedParameterSegments = new WeakSet();
  for (const [name, bytes] of files) {
    if (name.endsWith('.json') && name !== 'artifact-manifest.json') {
      const parsed = parseJson(bytes, name);
      const officialInputSources = collectOfficialInputSources(name, parsed, officialInputFiles);
      const officialPresentationObjects = collectOfficialPresentationObjects(name, parsed, officialInputFiles);
      scanPublicBoundary(parsed, name, {
        officialInputFiles,
        gameChangeInputFiles,
        weaponInputFiles,
        validatedParameterSegments,
        officialInputSources: new Map([[name, officialInputSources]]),
        officialPresentationObjects,
      });
    }
  }

  const dataRoot = 'data/' + runtimeRevision + '/';
  const dataFiles = new Map();
  for (const [name, bytes] of files) if (name.startsWith(dataRoot)) dataFiles.set(name.slice(dataRoot.length), bytes);
  const expectedRuntimeRevision = hasSharedRelease ? runtimeRevision : version.data_revision;
  // Reject downloaded files at the publication boundary before the immutable runtime digest check
  // obscures the more specific policy error for an otherwise listed local image.
  const earlyCatalogBytes = dataFiles.get('catalog.json');
  if (earlyCatalogBytes) {
    const earlyCatalog = parseJson(earlyCatalogBytes, dataRoot + 'catalog.json');
    if (earlyCatalog.package_kind === 'published' && [...dataFiles.keys()].some(name => !name.endsWith('.json'))) {
      fail('published static data must contain JSON only; downloaded image bytes are not allowed');
    }
  }
  if (hashNamedFiles(dataFiles) !== expectedRuntimeRevision) fail('legacy runtime data revision does not match its sorted public file names and bytes');
  const validationFiles = new Map();
  for (const [name, bytes] of dataFiles) {
    if (!name.endsWith('.json')) {
      validationFiles.set(name, bytes);
      continue;
    }
    try { validationFiles.set(name, new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch (error) { throw new Error(name + ' is not UTF-8 JSON', { cause: error }); }
  }
  const { catalog } = validatePublicFiles(validationFiles);

  const siteOrigin = validateRobotsAndSitemap(files, catalog);
  const { index, normalized, context } = validateBuildContext(files.get('index.html'), version, {
    sharedBundle,
    ...(sharedBundle ? { runtimeGameVersion: catalog.game_version, runtimePackageKind: catalog.package_kind } : {}),
  });
  validateInitialGamesLanternCredit(index, catalog, dataFiles);
  const assetFiles = new Map([...files].filter(([name]) => name.startsWith('assets/')));
  verifyHashedModuleGraph(Buffer.from(files.get('index.html')).toString('utf8'), assetFiles);
  const includeAnnouncements = hasSharedRelease && hasAnnouncementRoutingCapability(assetFiles);
  if (Buffer.from(files.get('_redirects') ?? []).toString('utf8') !== renderStaticRewrites(catalog,
    { includeAnnouncements })) fail('Cloudflare document rewrites do not match catalog');
  validateHeaders(files.get('_headers'), catalog, files.has('sitemap.xml'), includeAnnouncements);

  const buildInputs = new Map(assetFiles);
  buildInputs.set('index.html', normalized);
  if (sharedBundle) {
    for (const [name, bytes] of dataFiles) buildInputs.set('data/' + runtimeRevision + '/' + name, bytes);
    for (const [name, bytes] of sharedBundle.files) buildInputs.set(name, bytes);
    if (sharedBundle.packageKind === 'fixture') buildInputs.set('shared-fixture.json', files.get('shared-fixture.json'));
    buildInputs.set('shared-release-identity.json', createSharedReleaseIdentity(sharedBundle));
  } else {
    for (const [name, bytes] of dataFiles) buildInputs.set('data/' + name, bytes);
  }
  buildInputs.set('_redirects', files.get('_redirects'));
  buildInputs.set('_headers', files.get('_headers'));
  buildInputs.set('robots.txt', files.get('robots.txt'));
  if (siteOrigin) buildInputs.set('sitemap.xml', files.get('sitemap.xml'));
  if (hashNamedFiles(buildInputs) !== version.build_id) fail('build_id does not match website assets, index template, static policy, and public data');

  return {
    schema_version: version.schema_version,
    package_kind: version.package_kind,
    data_revision: version.data_revision,
    ...(sharedBundle ? {
      runtime_package_kind: context.package_kind,
      runtime_data_revision: runtimeRevision,
      shared_data_revision: version.data_revision,
      shared_game_version: version.game_version,
      game_releases: version.game_releases,
      retained_releases: sharedBundle.metadata.retained_releases,
      source_locks: sharedBundle.metadata.source_locks,
      shared_files: sharedBundle.metadata.shared_files,
    } : {}),
    build_id: version.build_id,
    file_count: files.size,
    catalog_counts: catalog.counts,
    site_origin: siteOrigin
  };
}
