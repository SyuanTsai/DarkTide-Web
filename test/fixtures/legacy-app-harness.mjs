// Runs one real app startup in an isolated Node process; all fetches stay in memory.
import { mock } from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildSiteData } from '../../src/build/site-data.mjs';
import * as shared from '../../web/shared-client.mjs';

const { path, includeHistory = false, dist = null } = JSON.parse(process.argv[2]);
const loadCalls = [], pendingLoads = [], requests = [], replacements = [];
let build, files;
if (dist) {
  build = JSON.parse(await readFile(new URL('../../dist/version.json', import.meta.url)));
  files = { get: name => readFile(new URL(`../../dist/${name}`, import.meta.url)) };
} else {
  const details = JSON.parse(await readFile(new URL('./legacy-url-details.json', import.meta.url)));
  const versions = includeHistory ? ['1.13.2', '1.13.4'] : ['1.13.4'];
  const dataByVersion = Object.fromEntries(versions.map(version => [version, Object.fromEntries(
    ['skills', 'weapons', 'blessings', 'terms'].map(category => [category, {
      schemaVersion: '1.1.0', gameVersion: version,
      items: details.filter(d => d.kind === category || (category === 'blessings' && d.kind === 'blessing'))
        .flatMap(d => d.document.items).map(item => version === '1.13.2' ? { ...item, name: { ...item.name, zh: '歷史版本項目' } } : item)
    }])
  )]));
  const rawFiles = new Map([['current.json', Buffer.from('{}')], ...versions.flatMap(version =>
    Object.entries(dataByVersion[version]).map(([category, doc]) => [`${version}/${category}.json`, Buffer.from(JSON.stringify(doc))]))]);
  const bundle = buildSiteData({ source: { current: { versions, gameVersion: '1.13.4' }, dataByVersion, rawFiles, commit: '93185bf9c070da578701fa398e85da9a08b8d4c4' } });
  build = { source_data: true, game_version: '1.13.4', game_releases: bundle.pointers, data_revision: bundle.pointers.find(p => p.game_version === '1.13.4').data_revision };
  files = bundle.files;
}

// Observe the actual app -> client boundary while delegating every load to the real client.
mock.module('../../web/shared-client.mjs', { exports: { ...shared, createSharedClient(options) {
  const client = shared.createSharedClient(options);
  return { ...client, load(request) { loadCalls.push(request); const promise = client.load(request); pendingLoads.push(promise); return promise; } };
} } });

class Element {
  constructor(tag) { this.tagName = tag; this.childNodes = []; this.dataset = {}; this.value = ''; }
  append(...nodes) { this.childNodes.push(...nodes); }
  replaceChildren(...nodes) { this.childNodes = nodes; this.value = ''; }
  setAttribute() {} removeAttribute() {} addEventListener() {}
  focus() {}
  set textContent(value) { this.value = String(value); this.childNodes = []; }
  get textContent() { return this.value + this.childNodes.map(n => n.textContent).join(''); }
  querySelector(tag) { return this.childNodes.find(n => n.tagName === tag) ?? null; }
}
const main = new Element('main'), buildMeta = new Element('p');
globalThis.location = new URL(path, 'https://example.test');
globalThis.history = { replaceState(...args) { replacements.push(args); globalThis.location = new URL(args[2], location); window.location = location; } };
globalThis.window = { __BUILD__: build, location, addEventListener() {} };
globalThis.document = { head: new Element('head'), getElementById: id => id === 'main' ? main : buildMeta,
  createElement: tag => new Element(tag), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
globalThis.fetch = async path => {
  requests.push(path);
  const bytes = await files.get(path.slice(1));
  if (!bytes) throw new Error(`Unexpected offline request: ${path}`);
  return new Response(bytes, { headers: { 'content-type': 'application/json' } });
};
try {
  await import('../../web/app.mjs');
  await Promise.allSettled(pendingLoads);
  console.log(JSON.stringify({ replacements, loadCalls, requests, text: main.textContent, meta: buildMeta.textContent,
    itemIds: main.childNodes.filter(n => n.dataset.itemId).map(n => n.dataset.itemId) }));
} finally { mock.restoreAll(); }
