import {
  lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertChildPath, compareUtf8, hashNamedFiles, jsonBytes, safeRelativePath,
  sha256, toBytes
} from './common.mjs';
import { renderCacheHeaders } from './header-policy.mjs';
import { renderStaticRewrites } from './routing-policy.mjs';
import { buildHashedAssets } from './module-graph.mjs';
import {
  createPublicFiles, projectPublicContent, validatePublishedContent,
  validatePublicFiles as validateGeneratedPublicFiles
} from '../published/contract.mjs';
import { verifyStaticPackage } from './verify.mjs';
import { createSharedReleaseIdentity, validateSharedStaticFiles } from './shared-release.mjs';
import { SHARED_ANNOUNCEMENT_ROUTING_CAPABILITY } from '../../web/shared-render.mjs';
import { loadW14HistoryStaticFiles, W14_HISTORY_DIRECTORY } from '../../scripts/content/contract-w14-history.mjs';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD_CONTEXT_MARKER = '__BUILD_CONTEXT__';
const INITIAL_GAMES_LANTERN_MARKER = '__GAMES_LANTERN_CREDIT__';
const INITIAL_GAMES_LANTERN_CREDIT = '<p class="asset-credit">本網站部分圖片素材經 <a href="https://darktide.gameslantern.com/">Games Lantern</a> 許可使用。</p>';

async function checkedFile(root, relative, label) {
  const safe = safeRelativePath(relative, label);
  let current = root;
  const segments = safe.split('/');
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const info = await lstat(current).catch(error => {
      if (error.code === 'ENOENT') throw new Error(label + ' is missing: ' + relative);
      throw error;
    });
    if (info.isSymbolicLink()) throw new Error(label + ' must not be a symbolic link: ' + relative);
    if (index < segments.length - 1 && !info.isDirectory()) throw new Error(label + ' parent is not a directory: ' + relative);
    if (index === segments.length - 1 && !info.isFile()) throw new Error(label + ' is not a regular file: ' + relative);
  }
  return readFile(current);
}

async function readTree(root, relativeDirectory, allowedExtensions) {
  const directory = path.join(root, relativeDirectory);
  const info = await lstat(directory).catch(error => {
    if (error.code === 'ENOENT') throw new Error('website source directory is missing: ' + relativeDirectory);
    throw error;
  });
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('website source path must be a real directory: ' + relativeDirectory);
  const files = new Map();
  const pathsLower = new Set();
  const walk = async (absolute, parentRelative) => {
    const entries = await readdir(absolute, { withFileTypes: true });
    entries.sort((a, b) => compareUtf8(a.name, b.name));
    for (const entry of entries) {
      const fileRelative = parentRelative ? parentRelative + '/' + entry.name : entry.name;
      safeRelativePath(fileRelative, 'website source path');
      const target = path.join(absolute, entry.name);
      const childInfo = await lstat(target);
      if (childInfo.isSymbolicLink()) throw new Error('website source must not contain symbolic links: ' + fileRelative);
      if (childInfo.isDirectory()) await walk(target, fileRelative);
      else if (childInfo.isFile()) {
        const extension = path.posix.extname(fileRelative);
        if (extension === '.md') continue;
        if (!allowedExtensions.has(extension) && fileRelative !== 'index.html') {
          throw new Error('unsupported website source file: ' + fileRelative);
        }
        const key = fileRelative.toLowerCase();
        if (pathsLower.has(key)) throw new Error('website source has a case-insensitive path collision: ' + fileRelative);
        pathsLower.add(key);
        files.set(fileRelative, await readFile(target));
      } else throw new Error('website source contains an unsupported filesystem entry: ' + fileRelative);
    }
  };
  await walk(directory, '');
  return files;
}

async function loadPublishedPackage(root) {
  const contentPath = 'content/published/content.json';
  const bytes = await checkedFile(root, contentPath, 'published content');
  const packageDirectory = path.join(root, 'content', 'published');
  const directoryInfo = await lstat(packageDirectory);
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
    throw new Error('published content path must be a real directory');
  }
  const entries = await readdir(packageDirectory, { withFileTypes: true });
  if (entries.length !== 1 || entries[0].name !== 'content.json' || !entries[0].isFile()) {
    throw new Error('formal published input must contain only content.json; local image files are not allowed');
  }
  let raw;
  try { raw = JSON.parse(bytes.toString('utf8')); }
  catch (error) { throw new Error('published content/published/content.json is not valid JSON', { cause: error }); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.package_kind !== 'published') {
    throw new Error('formal build requires package_kind "published" in content/published/content.json');
  }
  if (!Array.isArray(raw.assets)) throw new Error('published content assets must be an array');
  const assetBytes = new Map();
  validatePublishedContent(raw, { assetBytes });
  if (raw.package_kind !== 'published') throw new Error('formal build requires package_kind published');
  return { data: raw, assetBytes };
}

async function loadPublishedRuntimeSnapshot(snapshotRoot) {
  const { verifyStaticPackage } = await import('./verify.mjs');
  const verified = await verifyStaticPackage(snapshotRoot);
  if (verified.package_kind !== 'published') throw new Error('runtime snapshot must be a verified published static artifact');
  const manifest = JSON.parse((await checkedFile(snapshotRoot, 'artifact-manifest.json', 'runtime snapshot manifest')).toString('utf8'));
  const files = new Map();
  for (const row of manifest.files) files.set(row.path, await checkedFile(snapshotRoot, row.path, 'runtime snapshot file'));
  const runtimeRevision = verified.runtime_data_revision ?? verified.data_revision;
  const dataPrefix = 'data/' + runtimeRevision + '/';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const publicFiles = new Map([...files]
    .filter(([name]) => name.startsWith(dataPrefix))
    .map(([name, bytes]) => {
      const text = decoder.decode(bytes);
      if (!Buffer.from(text, 'utf8').equals(bytes)) {
        throw new Error('runtime snapshot public JSON is not canonical UTF-8: ' + name);
      }
      return [name.slice(dataPrefix.length), text];
    }));
  validateGeneratedPublicFiles(publicFiles);
  const catalog = JSON.parse(Buffer.from(publicFiles.get('catalog.json')).toString('utf8'));
  const index = Buffer.from(files.get('index.html') ?? []).toString('utf8');
  const contextMatches = [...index.matchAll(/<script>\s*window\.__BUILD__\s*=\s*(\{[^<]*?\})\s*;?\s*<\/script>/gu)];
  if (contextMatches.length !== 1) throw new Error('runtime snapshot must contain one verified build context');
  const indexTemplate = index.replace(contextMatches[0][0], '<script>window.__BUILD__=__BUILD_CONTEXT__</script>');
  const assetFiles = new Map([...files].filter(([name]) => name.startsWith('assets/')));
  return {
    data: { game_version: catalog.game_version, package_kind: catalog.package_kind },
    assetBytes: new Map(),
    publicFiles,
    assetFiles,
    indexTemplate,
  };
}

function validatePublicFiles(files) {
  if (!(files instanceof Map) || files.size === 0) throw new Error('public file generator returned no files');
  const lowerNames = new Set();
  for (const [name, value] of files) {
    safeRelativePath(name, 'public output path');
    if (name.startsWith('data/') || name === 'artifact-manifest.json' || name === 'index.html' || name === 'version.json') {
      throw new Error('public data generator returned a reserved path: ' + name);
    }
    const lower = name.toLowerCase();
    if (lowerNames.has(lower)) throw new Error('public file names collide on a case-insensitive filesystem: ' + name);
    lowerNames.add(lower);
    toBytes(value, name);
  }
}

function replaceSiteReferences(template, modulePath, stylePath) {
  const markerCount = template.split(BUILD_CONTEXT_MARKER).length - 1;
  if (markerCount !== 1) throw new Error('web/index.html must contain exactly one __BUILD_CONTEXT__ placeholder');
  const scriptTags = [...template.matchAll(/<script\b[^>]*>/gi)].map(match => match[0]);
  const appTags = scriptTags.filter(tag => /\bsrc\s*=\s*(['"])\.\/app\.mjs\1/i.test(tag));
  if (appTags.length !== 1 || !/\btype\s*=\s*(['"])module\1/i.test(appTags[0])) {
    throw new Error('web/index.html must load ./app.mjs exactly once as a module');
  }
  const stylesheetLinks = [...template.matchAll(/<link\b[^>]*>/gi)].map(match => match[0])
    .filter(tag => /\bhref\s*=\s*(['"])\.\/style\.css\1/i.test(tag));
  if (stylesheetLinks.length !== 1) throw new Error('web/index.html must link ./style.css exactly once');
  let html = template.replace(/\bsrc\s*=\s*(['"])\.\/app\.mjs\1/i, 'src="' + modulePath + '"');
  html = html.replace(/\bhref\s*=\s*(['"])\.\/style\.css\1/i, 'href="' + stylePath + '"');
  return html;
}

function injectInitialGamesLanternCredit(template, required) {
  const markerCount = template.split(INITIAL_GAMES_LANTERN_MARKER).length - 1;
  if (markerCount !== 1) throw new Error('web/index.html must contain exactly one __GAMES_LANTERN_CREDIT__ placeholder');
  return template.replace(INITIAL_GAMES_LANTERN_MARKER, required ? INITIAL_GAMES_LANTERN_CREDIT : '');
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => ({
    '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029'
  })[character]);
}
function makeHeaders(publicFiles, siteOrigin, includeAnnouncements = false, includeHistory = false) {
  const catalog = JSON.parse(Buffer.from(publicFiles.get('catalog.json')).toString('utf8'));
  return renderCacheHeaders(catalog, { hasSitemap: Boolean(siteOrigin), includeAnnouncements, includeHistory });
}
function hasAnnouncementRoutingCapability(assets) {
  const marker = Buffer.from(SHARED_ANNOUNCEMENT_ROUTING_CAPABILITY, 'utf8');
  const matches = [...assets].filter(([name, bytes]) => /^assets\/[a-f0-9]{64}\.(?:mjs|js)$/u.test(name)
    && Buffer.from(bytes).includes(marker));
  if (matches.length > 1) throw new Error('website asset graph duplicates the announcement routing capability marker');
  return matches.length === 1;
}
function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character]);
}
function normalizeSiteOrigin(value) {
  if (value === undefined || value === null || value === '') return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('site origin must be an absolute HTTPS origin'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('site origin must be an HTTPS origin without credentials, path, query, or fragment');
  }
  return url.origin;
}
function makeSitemap(publicFiles, siteOrigin, includeHistory = false) {
  if (!siteOrigin) return null;
  const catalog = JSON.parse(Buffer.from(publicFiles.get('catalog.json')).toString('utf8'));
  const routes = [...new Set(['/', ...catalog.entries.map(entry => entry.route), ...(includeHistory ? ['/history/1.13.1/'] : [])])].sort(compareUtf8);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    routes.map(route => '  <url><loc>' + escapeXml(siteOrigin + route) + '</loc></url>').join('\n') +
    '\n</urlset>\n';
}
function makeRobots(siteOrigin) {
  return 'User-agent: *\nAllow: /\n' + (siteOrigin ? 'Sitemap: ' + siteOrigin + '/sitemap.xml\n' : '');
}
function isGamesLanternUrl(value) {
  if (typeof value !== 'string') return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  const hostname = url.hostname.toLowerCase();
  return url.protocol === 'https:' && (hostname === 'gameslantern.com' || hostname.endsWith('.gameslantern.com'));
}

function usesGamesLanternAssets(data) {
  const referencedAssetIds = new Set();
  for (const row of [...data.skills, ...data.weapons, ...data.marks, ...data.blessings, ...data.variants]) {
    for (const assetId of row.asset_ids) referencedAssetIds.add(assetId);
  }
  return data.assets.some(asset => referencedAssetIds.has(asset.asset_id) &&
    (isGamesLanternUrl(asset.source_url) || isGamesLanternUrl(asset.attribution?.href)));
}

function makeVersion(data, dataRevision, buildId, sharedBundle = null) {
  if (sharedBundle) {
    return {
      schema_version: 2,
      data_revision: sharedBundle.version.data_revision,
      build_id: buildId,
      game_version: sharedBundle.version.game_version,
      package_kind: sharedBundle.packageKind,
      game_releases: structuredClone(sharedBundle.version.game_releases),
    };
  }
  return {
    schema_version: 2,
    data_revision: dataRevision,
    build_id: buildId,
    game_version: data.game_version,
    package_kind: data.package_kind
  };
}
function makeArtifactManifest(files, version) {
  const listed = [...files.entries()]
    .sort((a, b) => compareUtf8(a[0], b[0]))
    .map(([name, value]) => {
      const bytes = toBytes(value, name);
      return { path: name, size_bytes: bytes.byteLength, sha256: sha256(bytes) };
    });
  return {
    schema_version: 1,
    package_kind: version.package_kind,
    build_id: version.build_id,
    data_revision: version.data_revision,
    files: listed
  };
}

async function writeStage(stage, files) {
  const lowerNames = new Set();
  for (const [name, value] of files) {
    safeRelativePath(name, 'static output path');
    const lower = name.toLowerCase();
    if (lowerNames.has(lower)) throw new Error('static output has a case-insensitive path collision: ' + name);
    lowerNames.add(lower);
    const destination = assertChildPath(stage, path.join(stage, ...name.split('/')), 'static output path');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, toBytes(value, name));
  }
}

async function ensureNoSymlinks(directory) {
  const visit = async absolute => {
    const entries = await readdir(absolute, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(absolute, entry.name);
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error('existing dist contains a symbolic link');
      if (info.isDirectory()) await visit(target);
      else if (!info.isFile()) throw new Error('existing dist contains an unsupported filesystem entry');
    }
  };
  await visit(directory);
}

export async function replaceDirectory(stagingDirectory, outputDirectory, { renameDirectory = rename } = {}) {
  const staging = path.resolve(stagingDirectory);
  const output = path.resolve(outputDirectory);
  const parent = path.dirname(output);
  if (path.dirname(staging) !== parent || staging === output) throw new Error('staging and dist must be sibling directories');
  const stagingInfo = await lstat(staging);
  if (stagingInfo.isSymbolicLink() || !stagingInfo.isDirectory()) throw new Error('staging path must be a real directory');
  const outputInfo = await lstat(output).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (outputInfo && (outputInfo.isSymbolicLink() || !outputInfo.isDirectory())) throw new Error('dist path must be a real directory');
  const hasPrevious = Boolean(outputInfo);
  if (hasPrevious) await ensureNoSymlinks(output);
  const backup = path.join(parent, '.static-build-backup-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  if (hasPrevious) await renameDirectory(output, backup);
  try {
    await renameDirectory(staging, output);
  } catch (error) {
    if (hasPrevious) {
      try { await renameDirectory(backup, output); }
      catch (restoreError) {
        throw new AggregateError([error, restoreError], 'new static package install failed and prior dist could not be restored');
      }
    }
    throw error;
  }
  if (hasPrevious) {
    const backupInfo = await lstat(backup);
    if (backupInfo.isSymbolicLink() || !backupInfo.isDirectory() || path.dirname(backup) !== parent) {
      throw new Error('previous dist backup failed path validation');
    }
    await rm(backup, { recursive: true, force: false });
  }
}

async function loadFixturePackage(data) {
  if (!data) throw new Error('build:fixture requires an explicit fixture package');
  const projected = projectPublicContent(data);
  if (projected.package_kind !== 'fixture') throw new Error('fixture build requires package_kind "fixture"');
  return { data: projected, assetBytes: new Map() };
}

async function collectStaticSources(root) {
  const sourceFiles = await readTree(root, 'web', new Set(['.mjs', '.js', '.css']));
  return sourceFiles;
}

function validateSharedReleaseInput(sharedRelease, mode) {
  if (sharedRelease === undefined || sharedRelease === null) return null;
  if (!sharedRelease || typeof sharedRelease !== 'object' || !(sharedRelease.files instanceof Map)) {
    throw new TypeError('sharedRelease must be a validated W02 bundle with an exact file Map');
  }
  const bundle = validateSharedStaticFiles({
    version: sharedRelease.version,
    fixtureMarker: sharedRelease.fixtureMarker ?? null,
    retainedReleases: sharedRelease.retainedReleases ?? [],
    files: sharedRelease.files,
  });
  if (bundle.packageKind !== sharedRelease.packageKind) throw new Error('shared release package kind differs from its W02 validated version');
  if (mode === 'fixture' && bundle.packageKind !== 'fixture') throw new Error('fixture mode requires an explicitly non-publishable shared bundle');
  return bundle;
}

export async function buildStaticSite({ root = DEFAULT_ROOT, mode = 'published', data, siteOrigin, sharedRelease, runtimeSnapshot } = {}) {
  if (mode !== 'published' && mode !== 'fixture') throw new Error('build mode must be published or fixture');
  const projectRoot = path.resolve(root);
  const normalizedSiteOrigin = normalizeSiteOrigin(siteOrigin);
  const rootInfo = await lstat(projectRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('repository root must be a real directory');
  const outputDirectory = assertChildPath(projectRoot, path.join(projectRoot, 'dist'), 'dist path');
  if (runtimeSnapshot !== undefined && mode !== 'published') throw new Error('runtime snapshots are supported only for published builds');
  const input = mode === 'published'
    ? runtimeSnapshot ? await loadPublishedRuntimeSnapshot(path.resolve(runtimeSnapshot)) : await loadPublishedPackage(projectRoot)
    : await loadFixturePackage(data);
  const publicData = input.data;
  const assetBytes = input.assetBytes;
  if (runtimeSnapshot === undefined) validatePublishedContent(publicData, { assetBytes });
  if (mode === 'published' && publicData.package_kind !== 'published') throw new Error('formal build requires package_kind published');
  if (mode === 'fixture' && publicData.package_kind !== 'fixture') throw new Error('fixture build requires package_kind fixture');
  const sharedBundle = validateSharedReleaseInput(sharedRelease, mode);

  const publicFiles = input.publicFiles ?? createPublicFiles(publicData, { assetBytes });
  validatePublicFiles(publicFiles);
  validateGeneratedPublicFiles(publicFiles);
  const historyDirectory = path.join(projectRoot, ...W14_HISTORY_DIRECTORY.split('/'));
  const historyDirectoryInfo = await lstat(historyDirectory).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  const historyOutputFiles = historyDirectoryInfo ? await loadW14HistoryStaticFiles(projectRoot) : new Map();
  const includeHistory = historyOutputFiles.size > 0;
  if (mode === 'published' && [...publicFiles.keys()].some(name => !name.endsWith('.json'))) {
    throw new Error('formal published data output must contain JSON only; image bytes are hosted externally');
  }
  const dataRevision = hashNamedFiles(publicFiles);
  const dataRoot = 'data/' + dataRevision + '/';
  const outputData = new Map([...publicFiles].map(([name, value]) => [dataRoot + name, value]));
  if (sharedBundle && sharedBundle.version.data_revision === dataRevision) {
    throw new Error('shared and legacy runtime data revisions cannot use the same URL root');
  }
  const sharedOutputFiles = new Map();
  if (sharedBundle) {
    for (const [name, value] of sharedBundle.files) {
      safeRelativePath(name, 'shared static output path');
      if (outputData.has(name)) throw new Error('shared static output collides with legacy runtime path: ' + name);
      sharedOutputFiles.set(name, Buffer.from(value));
    }
    if (sharedBundle.packageKind === 'fixture') {
      sharedOutputFiles.set('shared-fixture.json', Buffer.from(JSON.stringify(sharedBundle.fixtureMarker, null, 2) + '\n', 'utf8'));
    }
  }

  const snapshot = runtimeSnapshot === undefined ? null : input;
  const hashed = snapshot
    ? { assets: snapshot.assetFiles }
    : await buildHashedAssets(await collectStaticSources(projectRoot));
  const includeAnnouncements = Boolean(sharedBundle && hasAnnouncementRoutingCapability(hashed.assets));
  let indexTemplate = snapshot
    ? snapshot.indexTemplate
    : replaceSiteReferences(hashed.index, hashed.moduleEntry, hashed.styleEntry);
  if (!snapshot) indexTemplate = injectInitialGamesLanternCredit(indexTemplate, usesGamesLanternAssets(publicData));
  const normalizedIndex = indexTemplate;
  const headers = makeHeaders(publicFiles, normalizedSiteOrigin, includeAnnouncements, includeHistory);
  const buildInputs = new Map([...hashed.assets]);
  buildInputs.set('index.html', normalizedIndex);
  if (sharedBundle) {
    for (const [name, value] of outputData) buildInputs.set(name, value);
    for (const [name, value] of sharedOutputFiles) buildInputs.set(name, value);
    buildInputs.set('shared-release-identity.json', createSharedReleaseIdentity(sharedBundle));
  } else {
    for (const [name, value] of publicFiles) buildInputs.set('data/' + name, value);
  }
  for (const [name, value] of historyOutputFiles) buildInputs.set(name, value);
  const rewrites = renderStaticRewrites(JSON.parse(Buffer.from(publicFiles.get('catalog.json')).toString('utf8')),
    { includeAnnouncements, includeHistory });
  buildInputs.set('_redirects', rewrites);
  buildInputs.set('_headers', headers);
  const sitemap = makeSitemap(publicFiles, normalizedSiteOrigin, includeHistory);
  const robots = makeRobots(normalizedSiteOrigin);
  if (sitemap !== null) buildInputs.set('sitemap.xml', sitemap);
  buildInputs.set('robots.txt', robots);
  const buildId = hashNamedFiles(buildInputs);
  const version = makeVersion(publicData, dataRevision, buildId, sharedBundle);
  const buildContext = sharedBundle ? {
    ...makeVersion(publicData, dataRevision, buildId),
    ...structuredClone(sharedBundle.metadata),
  } : version;
  const serializedContext = escapeScriptJson(buildContext);
  indexTemplate = indexTemplate.replace(BUILD_CONTEXT_MARKER, serializedContext);

  const outputFiles = new Map([
    ['index.html', indexTemplate],
    ...hashed.assets,
    ...outputData,
    ...sharedOutputFiles,
    ...historyOutputFiles,
    ['version.json', Buffer.from(JSON.stringify(version, null, 2) + '\n', 'utf8')],
    ['_headers', headers],
    ['_redirects', rewrites],
    ['robots.txt', robots],
    ...(sitemap === null ? [] : [['sitemap.xml', sitemap]])
  ]);
  const manifest = makeArtifactManifest(outputFiles, version);
  outputFiles.set('artifact-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));

  const stagingDirectory = await mkdtemp(path.join(projectRoot, '.static-build-staging-'));
  let installed = false;
  try {
    await writeStage(stagingDirectory, outputFiles);
    await verifyStaticPackage(stagingDirectory);
    await replaceDirectory(stagingDirectory, outputDirectory);
    installed = true;
  } finally {
    if (!installed) {
      const stagingInfo = await lstat(stagingDirectory).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (stagingInfo) {
        if (stagingInfo.isSymbolicLink() || !stagingInfo.isDirectory() ||
            path.dirname(stagingDirectory) !== projectRoot ||
            !path.basename(stagingDirectory).startsWith('.static-build-staging-')) {
          throw new Error('staging cleanup path failed validation');
        }
        await rm(stagingDirectory, { recursive: true, force: false });
      }
    }
  }
  return {
    schema_version: version.schema_version,
    package_kind: version.package_kind,
    game_version: version.game_version,
    data_revision: version.data_revision,
    build_id: version.build_id,
    file_count: outputFiles.size,
    outputDirectory,
    ...(sharedBundle ? {
      runtime_package_kind: publicData.package_kind,
      runtime_data_revision: dataRevision,
    } : {}),
  };
}

