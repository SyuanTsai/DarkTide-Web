import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

import { loadW14HistoryPackage, renderW14HistoryPage } from '../web/history-page.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const HISTORY_ROOT = path.join(REPO_ROOT, 'content', 'history', '1.13.1');
const PAGE_URL = 'https://example.test/history/1.13.1/';

async function fixedBytes() {
  return {
    manifest: await readFile(path.join(HISTORY_ROOT, 'manifest.json')),
    projection: await readFile(path.join(HISTORY_ROOT, 'player-index.json')),
  };
}

function response(bytes, url, contentType = 'application/json; charset=utf-8', status = 200) {
  const result = new Response(bytes, { status, headers: { 'content-type': contentType } });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.childNodes = [];
    this.attributes = new Map();
    this._textContent = '';
  }
  append(...nodes) { this.childNodes.push(...nodes); }
  replaceChildren(...nodes) { this.childNodes = nodes; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  set textContent(value) { this._textContent = String(value); this.childNodes = []; }
  get textContent() { return this._textContent || this.childNodes.map(node => node.textContent ?? '').join(''); }
}

function historyRenderContext() {
  const main = new FakeElement('main');
  const buildMeta = new FakeElement('p');
  buildMeta.textContent = '遊戲版本 1.13.2 · 資料版本 82b79e47e887';
  const head = new FakeElement('head');
  const documentImpl = {
    head,
    title: '',
    createElement: tag => new FakeElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return { main, buildMeta, documentImpl };
}

function emptyHistoryResult() {
  return {
    manifest: {
      projection: { excludedCounts: { skills: 0, weapons: 0, marks: 0 } },
      source: { staticBackup: { releaseUrl: 'https://example.test/archive' }, repository: 'owner/repo', commit: 'abc', path: 'content.json' },
      fullPlayerSnapshot: 'https://example.test/snapshot',
      technicalSourceRepository: 'https://example.test/source',
    },
    projection: { entries: [] },
  };
}

// Scenario: The actual fixed 1.13.1 history files are served at their same-origin manifest paths.
// Purpose: Verify the historical reader fetches only its two fixed files and validates their pinned bytes.
test('UnitT10_loads-only-the-pinned-same-origin-history-files', async () => {
  const fixed = await fixedBytes();
  const seen = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    seen.push({ url: url.href, init });
    const bytes = url.pathname.endsWith('/manifest.json') ? fixed.manifest : fixed.projection;
    return response(bytes, url.href);
  };
  const result = await loadW14HistoryPackage({ fetchImpl, cryptoApi: webcrypto, pageUrl: PAGE_URL });
  assert.equal(result.manifest.gameVersion, '1.13.1');
  assert.equal(result.projection.entries.length, 1617);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map(row => new URL(row.url).pathname), [
    '/history/1.13.1/manifest.json', '/history/1.13.1/player-index.json',
  ]);
  assert.ok(seen.every(row => row.init.method === 'GET' && row.init.redirect === 'error'));
  assert.ok(seen.every(row => row.init.credentials === 'same-origin'));
});

// Scenario: The history document or one file is redirected, missing, or has bytes outside the pinned package.
// Purpose: Keep old data isolated from current or arbitrary origin data and fail closed on a tampered projection.
test('UnitT20_rejects-redirects-http-errors-and-projection-byte-tampering', async () => {
  const fixed = await fixedBytes();
  const calls = { count: 0 };
  const redirectingFetch = async input => {
    const url = new URL(String(input));
    calls.count += 1;
    return response(fixed.manifest, 'https://other.test' + url.pathname);
  };
  await assert.rejects(loadW14HistoryPackage({ fetchImpl: redirectingFetch, cryptoApi: webcrypto, pageUrl: PAGE_URL }), /same-origin final URL|redirect/u);
  assert.equal(calls.count, 1);

  const missingFetch = async input => {
    const url = new URL(String(input));
    return response('not found', url.href, 'text/plain; charset=utf-8', 404);
  };
  await assert.rejects(loadW14HistoryPackage({ fetchImpl: missingFetch, cryptoApi: webcrypto, pageUrl: PAGE_URL }), /HTTP 404|JSON/u);

  let projectionBytes = fixed.projection;
  const tamperedFetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/player-index.json')) projectionBytes = Buffer.from(fixed.projection).subarray(0, fixed.projection.length - 1);
    return response(url.pathname.endsWith('/manifest.json') ? fixed.manifest : projectionBytes, url.href);
  };
  await assert.rejects(loadW14HistoryPackage({ fetchImpl: tamperedFetch, cryptoApi: webcrypto, pageUrl: PAGE_URL }), /digest|byte length|fixed projection/u);
});

// Scenario: A current-page footer is already populated before the history renderer handles loading, error, invalid, or ready state.
// Purpose: Ensure every history route owns its footer immediately and never advertises the current data revision as historical data.
test('UnitT30_history-rendering-replaces-current-footer-before-every-route-state', () => {
  const cases = [
    { name: 'loading', options: { result: null } },
    { name: 'error', options: { error: new Error('offline') } },
    { name: 'invalid-history-query', options: { result: emptyHistoryResult(), url: new URL('https://example.test/history/1.13.1/?version=1.13.2') } },
    { name: 'ready', options: { result: emptyHistoryResult() } },
  ];
  for (const { name, options } of cases) {
    const context = historyRenderContext();
    renderW14HistoryPage({ ...context, url: new URL('https://example.test/history/1.13.1/'), ...options });
    assert.equal(context.buildMeta.textContent, '歷史版本 1.13.1', `${name} state must replace current footer metadata`);
    assert.doesNotMatch(context.buildMeta.textContent, /1\.13\.2|82b79e47e887/u, `${name} state must clear the current revision`);
  }
});
