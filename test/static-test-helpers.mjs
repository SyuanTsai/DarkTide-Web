import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixturePublicContent } from '../src/static/fixture.mjs';
import { buildStaticSite } from '../src/static/build.mjs';
import { compareUtf8, hashNamedFiles, safeRelativePath, sha256 } from '../src/static/common.mjs';

export function publishedRemotePackage() {
  const data = fixturePublicContent();
  const sourceUrl = 'https://github.com/user-attachments/assets/12345678-1234-4234-9234-123456789abc';
  const assetId = 'github-' + createHash('sha256').update(sourceUrl).digest('hex');
  data.package_kind = 'published';
  data.game_version = '1.13.2';
  data.sources = [{ source_id: 'public-source', label: '公開來源', url: 'https://example.test/public-source' }];
  data.variants[0].effect_zh_tw = null;
  for (const row of [...data.skills, ...data.weapons, ...data.marks, ...data.blessings, ...data.variants]) {
    row.source_ids = ['public-source'];
  }
  data.skills[0].asset_ids = [assetId];
  data.routes.push({
    route_kind: 'canonical', content_kind: 'mechanics', content_key: 'veteran/practice-guard',
    source_route: null, target_route: '/skills/veteran/practice-guard/mechanics/', decision: 'keep'
  });
  data.assets = [{
    asset_id: assetId,
    path: null,
    sha256: null,
    media_type: null,
    source_url: sourceUrl,
    attribution: { href: 'https://darktide.gameslantern.com/credits/', text: '資料來源：Games Lantern', follow_required: true }
  }];
  return data;
}

export async function createBuildRoot({ withSpaces = false, productionWeb = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), withSpaces ? 'darktide static cli test-' : 'darktide-static-test-'));
  const webDirectory = join(root, 'web');
  if (productionWeb) {
    await cp(fileURLToPath(new URL('../web', import.meta.url)), webDirectory, { recursive: true });
    return root;
  }
  await mkdir(webDirectory, { recursive: true });
  await writeFile(join(root, 'web', 'index.html'),
    '<!doctype html><html lang="zh-Hant-TW"><head><link rel="stylesheet" href="./style.css"></head><body><main></main><footer>__GAMES_LANTERN_CREDIT__</footer><script>window.__BUILD__=__BUILD_CONTEXT__</script><script type="module" src="./app.mjs"></script></body></html>',
    'utf8');
  await writeFile(join(root, 'web', 'app.mjs'),
    "import { label } from './client.mjs';\nwindow.appLabel = label;\n",
    'utf8');
  await writeFile(join(root, 'web', 'client.mjs'), "export const label = 'fixture';\n", 'utf8');
  await writeFile(join(root, 'web', 'style.css'), 'body{color:#fff}\n', 'utf8');
  return root;
}

export async function buildFixture(root) {
  return buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent() });
}

export async function disposeBuildRoot(root) {
  await rm(root, { recursive: true, force: true });
}

export async function resealStaticDataFile(distPath, relativePath, bytes) {
  safeRelativePath(relativePath, 'test public data path');
  const manifest = JSON.parse(await readFile(join(distPath, 'artifact-manifest.json'), 'utf8'));
  const version = JSON.parse(await readFile(join(distPath, 'version.json'), 'utf8'));
  const oldRoot = 'data/' + version.data_revision + '/';
  const outputs = new Map();
  for (const row of manifest.files) outputs.set(row.path, await readFile(join(distPath, ...row.path.split('/'))));
  const dataFiles = new Map();
  for (const [name, content] of outputs) {
    if (name.startsWith(oldRoot)) dataFiles.set(name.slice(oldRoot.length), content);
  }
  if (!dataFiles.has(relativePath)) throw new Error('test data file is absent from the static package');
  dataFiles.set(relativePath, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  const dataRevision = hashNamedFiles(dataFiles);

  const rewritten = new Map();
  for (const [name, content] of outputs) {
    if (name.startsWith(oldRoot)) {
      const relative = name.slice(oldRoot.length);
      rewritten.set('data/' + dataRevision + '/' + relative, dataFiles.get(relative));
    } else rewritten.set(name, content);
  }
  const index = rewritten.get('index.html').toString('utf8');
  const contextMatch = /<script>\s*window\.__BUILD__\s*=\s*(\{[^<]*?\})\s*;?\s*<\/script>/.exec(index);
  if (!contextMatch) throw new Error('test static package has no build context');
  const normalizedIndex = index.replace(contextMatch[0], '<script>window.__BUILD__=__BUILD_CONTEXT__</script>');
  const buildInputs = new Map([...rewritten].filter(([name]) => /^assets\//.test(name)));
  buildInputs.set('index.html', normalizedIndex);
  for (const [name, content] of dataFiles) buildInputs.set('data/' + name, content);
  buildInputs.set('_redirects', rewritten.get('_redirects'));
  buildInputs.set('_headers', rewritten.get('_headers'));
  buildInputs.set('robots.txt', rewritten.get('robots.txt'));
  if (rewritten.has('sitemap.xml')) buildInputs.set('sitemap.xml', rewritten.get('sitemap.xml'));

  version.data_revision = dataRevision;
  version.build_id = hashNamedFiles(buildInputs);
  const updatedContext = JSON.stringify(version);
  rewritten.set('index.html', Buffer.from(index.replace(contextMatch[0], '<script>window.__BUILD__=' + updatedContext + '</script>'), 'utf8'));
  rewritten.set('version.json', Buffer.from(JSON.stringify(version, null, 2) + '\n', 'utf8'));

  const files = [...rewritten.entries()].sort((a, b) => compareUtf8(a[0], b[0])).map(([name, content]) => ({
    path: name,
    size_bytes: content.byteLength,
    sha256: sha256(content)
  }));
  rewritten.set('artifact-manifest.json', Buffer.from(JSON.stringify({
    schema_version: 1,
    package_kind: version.package_kind,
    build_id: version.build_id,
    data_revision: version.data_revision,
    files
  }, null, 2) + '\n', 'utf8'));

  const stage = await mkdtemp(join(dirname(distPath), '.static-reseal-test-'));
  const backup = distPath + '.reseal-backup-' + process.pid + '-' + Math.random().toString(16).slice(2);
  try {
    for (const [name, content] of rewritten) {
      const target = join(stage, ...name.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await rename(distPath, backup);
    try { await rename(stage, distPath); }
    catch (error) {
      await rename(backup, distPath);
      throw error;
    }
    await rm(backup, { recursive: true, force: false });
  } finally {
    await rm(stage, { recursive: true, force: true });
    const backupExists = await readFile(join(backup, 'artifact-manifest.json')).then(() => true, () => false);
    if (backupExists) await rm(backup, { recursive: true, force: true });
  }
}

