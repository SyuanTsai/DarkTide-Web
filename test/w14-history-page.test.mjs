import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

import { loadW14HistoryPackage } from '../web/history-page.mjs';

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
