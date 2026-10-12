import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertExactKeys, compareUtf8, hashNamedFiles, parseJson, safeRelativePath, sha256
} from './common.mjs';
import { validateCacheHeaders } from './header-policy.mjs';
import { renderStaticRewrites } from './routing-policy.mjs';
import { verifyHashedModuleGraph } from './module-graph.mjs';
import { validatePublicFiles } from '../published/contract.mjs';

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

function scanPublicBoundary(value, location = '$') {
  if (typeof value === 'string') {
    if (/(?:^|[\s"'(])[A-Za-z]:[\\/]/.test(value)) fail('public JSON contains an absolute source path at ' + location);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanPublicBoundary(item, location + '[' + index + ']'));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(normalizePrivateKey(key))) fail('public JSON contains a private field: ' + key);
    scanPublicBoundary(item, location + '.' + key);
  }
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

function validateOutputPaths(files, revision) {
  for (const required of FIXED_REQUIRED) if (!files.has(required)) fail('static artifact is missing ' + required);
  for (const name of files.keys()) {
    if (FIXED_REQUIRED.has(name) || name === 'sitemap.xml' || HASHED_ASSET.test(name)) continue;
    const prefix = 'data/' + revision + '/';
    if (name.startsWith(prefix)) {
      safeRelativePath(name.slice(prefix.length), 'published data path');
      continue;
    }
    fail('artifact contains an unsupported file path: ' + name);
  }
  const html = [...files.keys()].filter(name => name.endsWith('.html'));
  if (html.length !== 1 || html[0] !== 'index.html') fail('artifact must contain exactly one HTML file named index.html');
}

function validateHeaders(bytes, catalog, hasSitemap) {
  try {
    validateCacheHeaders(bytes, catalog, { hasSitemap });
  } catch (error) {
    fail(error.message);
  }
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

function validateBuildContext(indexBytes, version) {
  const index = Buffer.from(indexBytes).toString('utf8');
  const matches = [...index.matchAll(/<script>\s*window\.__BUILD__\s*=\s*(\{[^<]*?\})\s*;?\s*<\/script>/g)];
  if (matches.length !== 1) fail('index.html must inject one build context');
  const context = parseJson(Buffer.from(matches[0][1], 'utf8'), 'build context');
  assertExactKeys(context, VERSION_FIELDS, 'build context');
  for (const field of VERSION_FIELDS) if (context[field] !== version[field]) fail('build context does not match version.json');
  if (index.includes('__BUILD_CONTEXT__')) fail('index.html has an unreplaced build context placeholder');
  return {
    index,
    normalized: index.replace(matches[0][0], '<script>window.__BUILD__=__BUILD_CONTEXT__</script>')
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
  assertExactKeys(version, VERSION_FIELDS, 'version');
  if (version.schema_version !== 2 || version.package_kind !== manifest.package_kind ||
      version.build_id !== manifest.build_id || version.data_revision !== manifest.data_revision) {
    fail('version.json does not match artifact manifest');
  }
  if (typeof version.game_version !== 'string' || !version.game_version.trim()) fail('version game_version must be a nonempty string');
  if (!/^[a-f0-9]{64}$/.test(version.data_revision)) fail('version data_revision is invalid');
  validateOutputPaths(files, version.data_revision);

  for (const [name, bytes] of files) {
    if (name.endsWith('.json') && name !== 'artifact-manifest.json') scanPublicBoundary(parseJson(bytes, name), name);
  }

  const dataRoot = 'data/' + version.data_revision + '/';
  const dataFiles = new Map();
  for (const [name, bytes] of files) if (name.startsWith(dataRoot)) dataFiles.set(name.slice(dataRoot.length), bytes);
  if (version.package_kind === 'published' && [...dataFiles.keys()].some(name => !name.endsWith('.json'))) {
    fail('published static data must contain JSON only; downloaded image bytes are not allowed');
  }
  if (hashNamedFiles(dataFiles) !== version.data_revision) fail('data_revision does not match sorted public file names and bytes');
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

  if (Buffer.from(files.get('_redirects') ?? []).toString('utf8') !== renderStaticRewrites(catalog)) fail('Cloudflare document rewrites do not match catalog');
  validateHeaders(files.get('_headers'), catalog, files.has('sitemap.xml'));
  const siteOrigin = validateRobotsAndSitemap(files, catalog);
  const { index, normalized } = validateBuildContext(files.get('index.html'), version);
  validateInitialGamesLanternCredit(index, catalog, dataFiles);
  const assetFiles = new Map([...files].filter(([name]) => name.startsWith('assets/')));
  verifyHashedModuleGraph(Buffer.from(files.get('index.html')).toString('utf8'), assetFiles);

  const buildInputs = new Map(assetFiles);
  buildInputs.set('index.html', normalized);
  for (const [name, bytes] of dataFiles) buildInputs.set('data/' + name, bytes);
  buildInputs.set('_redirects', files.get('_redirects'));
  buildInputs.set('_headers', files.get('_headers'));
  buildInputs.set('robots.txt', files.get('robots.txt'));
  if (siteOrigin) buildInputs.set('sitemap.xml', files.get('sitemap.xml'));
  if (hashNamedFiles(buildInputs) !== version.build_id) fail('build_id does not match website assets, index template, static policy, and public data');

  return {
    schema_version: version.schema_version,
    package_kind: version.package_kind,
    data_revision: version.data_revision,
    build_id: version.build_id,
    file_count: files.size,
    catalog_counts: catalog.counts,
    site_origin: siteOrigin
  };
}
