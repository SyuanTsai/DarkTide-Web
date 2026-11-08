import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
export const transportOptions = { threshold: 4096, maxBytes: 6144 };
export const sourceSizes = {
  '9.9.1': { skills: 4096, weapons: 6144, blessings: 6145, terms: 4097 },
  '9.9.2': { skills: 4097, weapons: 6145, blessings: 6144, terms: 4096 },
};

export async function mixedSourceFixture(t) {
  const root = await mkdtemp(path.join(repo, '.static-build-staging-syp391-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['web', 'content/history', 'content/authoring/v2', 'content/reference']) {
    await cp(path.join(repo, name), path.join(root, name), { recursive: true });
  }
  const sourceData = path.join(root, 'source');
  await cp(path.join(repo, 'test/fixtures/source-data'), sourceData, { recursive: true });
  const rawFiles = new Map([['current.json', await readFile(path.join(sourceData, 'data/current.json'))]]);
  for (const [version, categories] of Object.entries(sourceSizes)) for (const [category, size] of Object.entries(categories)) {
    const name = `${version}/${category}.json`, target = path.join(sourceData, 'data', name);
    const original = await readFile(target);
    assert.ok(original.length <= size, `fixture size for ${name}`);
    // JSON whitespace changes transport bytes without inflating derived domains.
    const bytes = Buffer.concat([original, Buffer.alloc(size - original.length, 32)]);
    await writeFile(target, bytes); rawFiles.set(name, bytes);
  }
  return { root, sourceData, rawFiles, fixture: true, transportOptions };
}

export async function collectFiles(dir, prefix = '') {
  const files = new Map();
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name, target = path.join(dir, entry.name);
    if (entry.isDirectory()) for (const row of await collectFiles(target, name + '/')) files.set(...row);
    else files.set(name, await readFile(target));
  }
  return files;
}

// An in-memory origin: every request is recorded; no external fetch is possible.
export function publicationFetch(files) {
  const requests = [], version = { ...JSON.parse(files.get('version.json')), package_kind: 'published' };
  const fetch = async (url, options = {}) => {
    const name = new URL(url).pathname, method = options.method ?? 'GET';
    requests.push({ name, method });
    const headers = {
      'content-type': name.endsWith('.bin') ? 'application/octet-stream' : 'application/json; charset=utf-8',
      'cache-control': name === '/version.json' || name === '/source-data/current.json' ? 'no-cache' : 'public, max-age=31536000, immutable',
    };
    if (name.startsWith('/source-data/')) Object.assign(headers, {
      'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD',
    });
    if (name === '/version.json') return new Response(JSON.stringify(version), { headers });
    const bytes = files.get(name.slice(1));
    if (bytes) return new Response(method === 'HEAD' ? null : bytes, { headers });
    if (['/', '/skills/', '/weapons/', '/blessings/', '/terms/', '/game-changes/', '/announcements/', '/history/1.13.1', '/history/1.13.1/'].includes(name)) {
      return new Response(files.get('index.html'), { headers: { 'content-type': 'text/html', 'cache-control': 'no-cache' } });
    }
    return new Response(method === 'HEAD' ? null : 'missing', { status: 404 });
  };
  return { fetch, requests, version };
}
