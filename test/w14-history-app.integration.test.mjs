import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildStaticSite } from '../src/static/build.mjs';
import { validateSharedStaticFiles } from '../src/static/shared-release.mjs';
import { createStaticServer } from '../scripts/serve.mjs';
import { fixturePublicContent } from '../src/static/fixture.mjs';
import { createBuildRoot, disposeBuildRoot } from './static-test-helpers.mjs';
import { makeCompiledGameChangesPackage } from './w12-shared-view.fixture.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const chromePath = process.env.SYP_W10_CHROMIUM_EXE;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function listen(distPath) {
  const server = await createStaticServer({ distPath });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

async function compiledSharedFixture() {
  const compiled = await makeCompiledGameChangesPackage();
  const manifest = compiled.manifest;
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const pointer = {
    game_version: manifest.gameVersion,
    content_version: manifest.contentVersion,
    data_revision: manifest.dataRevision,
    manifest_path: `/data/${manifest.dataRevision}/manifest.json`,
    manifest_sha256: sha256(manifestBytes),
  };
  const version = {
    schema_version: 2,
    data_revision: manifest.dataRevision,
    build_id: 'a'.repeat(64),
    game_version: manifest.gameVersion,
    package_kind: 'fixture',
    game_releases: [pointer],
  };
  const files = new Map([[`data/${manifest.dataRevision}/manifest.json`, manifestBytes]]);
  for (const [relativePath, bytes] of compiled.files) files.set(`data/${manifest.dataRevision}/${relativePath}`, bytes);
  const sourceLock = {
    schema: 'w09-public-source-lock/1',
    repository: manifest.source.repository,
    source_revision: manifest.source.sourceRevision,
    source_manifest_sha256: manifest.source.manifestSha256,
    game_release_id: manifest.gameReleaseId,
    game_version: manifest.gameVersion,
    content_version: manifest.contentVersion,
  };
  const sourceLockBytes = Buffer.from(JSON.stringify(sourceLock, null, 2) + '\n', 'utf8');
  files.set(`source-locks/${manifest.source.sourceRevision}/${sha256(sourceLockBytes)}.json`, sourceLockBytes);
  return validateSharedStaticFiles({
    version,
    fixtureMarker: { fixtureOnly: true, publicationEligible: false, fixtureId: 'synthetic-w14-history-navigation' },
    files,
  });
}

// Scenario: A built static site contains an independent 1.13.1 player history package and a shared current-release fixture.
// Purpose: Verify current/history footer ownership through real in-app and browser-history navigation, plus history search, reload, and mobile layout.
test('InterT10_history-page-direct-route-search-detail-reload-and-mobile-layout', { timeout: 120000 }, async () => {
  const root = await createBuildRoot({ productionWeb: true });
  let server;
  let browser;
  try {
    const sourceDirectory = path.join(REPO_ROOT, 'content', 'history', '1.13.1');
    const targetDirectory = path.join(root, 'content', 'history', '1.13.1');
    await mkdir(targetDirectory, { recursive: true });
    for (const name of ['source-content.json', 'player-index.json', 'manifest.json']) {
      await copyFile(path.join(sourceDirectory, name), path.join(targetDirectory, name));
    }
    const sharedRelease = await compiledSharedFixture();
    await buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), sharedRelease });
    const hosted = await listen(path.join(root, 'dist'));
    server = hosted.server;
    browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    const historyResponses = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => {
      if (new URL(response.url()).pathname.startsWith('/history/1.13.1/')) historyResponses.push(response);
    });

    for (const viewportWidth of [1280, 390]) {
      await page.setViewportSize({ width: viewportWidth, height: viewportWidth === 390 ? 844 : 900 });
      await page.goto(hosted.origin, { waitUntil: 'domcontentloaded' });
      await page.locator('.shared-hero h1').waitFor({ state: 'visible' });
      const currentFooter = await page.locator('#build-meta').innerText();
      assert.ok(currentFooter.includes(`遊戲版本 ${sharedRelease.version.game_version}`),
        'shared current rendering must populate its footer');
      assert.ok(currentFooter.includes(sharedRelease.version.data_revision.slice(0, 12)),
        'the shared current footer must be populated before in-app navigation');

      await page.locator('.primary-nav a[href="/history/1.13.1/"]').click();
      await page.waitForURL(url => url.pathname === '/history/1.13.1/');
      await page.getByRole('heading', { name: '1.13.1 歷史資料', exact: true }).waitFor({ state: 'visible' });
      const historyFooter = await page.locator('#build-meta').innerText();
      assert.equal(historyFooter, '歷史版本 1.13.1');
      assert.doesNotMatch(historyFooter, new RegExp(`${sharedRelease.version.game_version}|${sharedRelease.version.data_revision.slice(0, 12)}`, 'u'));
      if (viewportWidth === 390) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false,
          'the in-app historical list and footer must fit a 390px viewport');
      }

      await page.goBack();
      await page.locator('.shared-hero h1').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#build-meta').innerText(), currentFooter,
        'browser back must restore current shared version metadata');
      await page.goForward();
      await page.getByRole('heading', { name: '1.13.1 歷史資料', exact: true }).waitFor({ state: 'visible' });
      assert.equal(await page.locator('#build-meta').innerText(), '歷史版本 1.13.1',
        'browser forward must restore historical footer metadata');
      await page.locator('.brand').click();
      await page.locator('.shared-hero h1').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#build-meta').innerText(), currentFooter,
        'in-app navigation back to current content must restore the shared build footer');
    }

    const currentFailureFooters = [];
    for (const viewportWidth of [1280, 390]) {
      await page.setViewportSize({ width: viewportWidth, height: viewportWidth === 390 ? 844 : 900 });
      await page.goto(`${hosted.origin}/history/1.13.1/`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: '1.13.1 歷史資料', exact: true }).waitFor({ state: 'visible' });
      const historyFooter = await page.locator('#build-meta').innerText();
      let releaseBlocked;
      let resolveIntercepted;
      const blocked = new Promise(resolve => { releaseBlocked = resolve; });
      const intercepted = new Promise(resolve => { resolveIntercepted = resolve; });
      const interceptedUrls = [];
      const blockSharedData = async route => {
        interceptedUrls.push(route.request().url());
        resolveIntercepted();
        await blocked;
        await route.abort();
      };
      await page.route('**/data/**', blockSharedData);
      try {
        await page.locator('.brand').click();
        await page.locator('.loading-note').waitFor({ state: 'visible' });
        await intercepted;
        const loadingFooter = await page.locator('#build-meta').innerText();
        releaseBlocked();
        await page.locator('.shared-failure').waitFor({ state: 'visible' });
        const errorFooter = await page.locator('#build-meta').innerText();
        currentFailureFooters.push({ viewportWidth, historyFooter, loadingFooter, errorFooter, interceptedCount: interceptedUrls.length });
      } finally {
        releaseBlocked();
        await page.unroute('**/data/**', blockSharedData);
      }
      if (viewportWidth === 390) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false,
          'the current shared error and footer must fit a 390px viewport');
      }
    }
    assert.deepEqual(currentFailureFooters, [
      { viewportWidth: 1280, historyFooter: '歷史版本 1.13.1', loadingFooter: '', errorFooter: '', interceptedCount: 1 },
      { viewportWidth: 390, historyFooter: '歷史版本 1.13.1', loadingFooter: '', errorFooter: '', interceptedCount: 1 },
    ], 'a fresh current loading/error view must not retain the previously rendered historical footer');

    let releaseHistoryManifest;
    let resolveHistoryManifestRequest;
    let resolveHistoryManifestResponse;
    const historyManifestGate = new Promise(resolve => { releaseHistoryManifest = resolve; });
    const historyManifestRequested = new Promise(resolve => { resolveHistoryManifestRequest = resolve; });
    const historyManifestReleased = new Promise(resolve => { resolveHistoryManifestResponse = resolve; });
    const holdHistoryManifest = async route => {
      const response = await route.fetch();
      resolveHistoryManifestRequest();
      await historyManifestGate;
      try { await route.fulfill({ response }); }
      finally { resolveHistoryManifestResponse(); }
    };
    const historyManifestUrl = '**/history/1.13.1/manifest.json';
    await page.route(historyManifestUrl, holdHistoryManifest);
    try {
      const response = await page.goto(`${hosted.origin}/history/1.13.1`, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200);
      await historyManifestRequested;
      await page.getByRole('heading', { name: '正在載入 1.13.1 歷史資料…', exact: true }).waitFor({ state: 'visible' });
      assert.equal(await page.locator('.history-page h1').innerText(), '正在載入 1.13.1 歷史資料…',
        'the held history response must keep the loading heading visible until verified data arrives');
      releaseHistoryManifest();
      await page.getByRole('heading', { name: '1.13.1 歷史資料', exact: true }).waitFor({ state: 'visible' });
      assert.equal(await page.locator('.history-page h1').innerText(), '1.13.1 歷史資料');
    } finally {
      releaseHistoryManifest();
      await historyManifestReleased;
      await page.unroute(historyManifestUrl, holdHistoryManifest);
    }
    assert.match(await page.locator('.history-notice').innerText(), /不是目前遊戲版本/u);
    assert.doesNotMatch(await page.locator('main').innerText(), /演示步槍/u, 'current fixture data must not appear in the history reader');
    assert.equal(await page.locator('.primary-nav a[aria-current="page"]').getAttribute('href'), '/history/1.13.1/');
    const filterGeometry = await page.evaluate(() => {
      const measure = (labelFor, controlId) => {
        const label = document.querySelector(`label[for="${labelFor}"]`);
        const control = document.getElementById(controlId);
        const textNode = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const textRect = range.getBoundingClientRect();
        const controlRect = control.getBoundingClientRect();
        return { textLeft: textRect.left, controlLeft: controlRect.left, controlRight: controlRect.right, controlWidth: controlRect.width };
      };
      return {
        search: measure('history-query', 'history-query'),
        kind: measure('history-kind', 'history-kind'),
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    for (const field of [filterGeometry.search, filterGeometry.kind]) {
      assert.ok(Math.abs(field.textLeft - field.controlLeft) <= 1, 'each filter label must align with its visible control');
      assert.ok(field.controlWidth > 0 && field.controlRight <= filterGeometry.viewportWidth, 'each filter control must fit the viewport');
    }
    assert.ok(historyResponses.length >= 2);
    assert.ok(historyResponses.every(item => item.status() === 200));
    assert.equal((await page.request.get(`${hosted.origin}/history/1.13.1/missing.json`)).status(), 404);

    const kind = page.locator('#history-kind');
    await kind.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await kind.inputValue(), 'weapon');
    await page.locator('#history-query').focus();
    await page.locator('#history-query').fill('不存在的歷史項目');
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.pathname === '/history/1.13.1/' && url.searchParams.get('type') === 'weapon' && url.searchParams.get('q') === '不存在的歷史項目');
    await page.locator('.history-result-count').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.history-results li').count(), 0);
    assert.match(await page.locator('.history-empty').innerText(), /沒有符合條件/u);

    await page.goto(`${hosted.origin}/history/1.13.1/?type=weapon`, { waitUntil: 'domcontentloaded' });
    await page.locator('.history-results a').first().waitFor({ state: 'visible' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false,
      'the actual history list should fit a 390px viewport');
    await page.setViewportSize({ width: 1280, height: 900 });
    const firstLink = page.locator('.history-results a').first();
    const historyName = await firstLink.innerText();
    await firstLink.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.pathname === '/history/1.13.1/' && Boolean(url.searchParams.get('id')));
    await page.getByRole('heading', { name: historyName, exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.history-page h1').innerText(), historyName);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false,
      'the actual history detail should fit a 390px viewport');
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.match(await page.locator('.history-badge').innerText(), /1\.13\.1/u);
    const historyLinks = page.locator('.history-sources a');
    assert.equal(await historyLinks.count(), 4);
    assert.equal(await historyLinks.nth(2).getAttribute('href'), 'https://github.com/SyuanTsai/DarkTide-Web/blob/61f1dcda6cb80fb1ee2bf595b3b9a082825a912f/content/published/content.json');
    assert.equal(await historyLinks.nth(3).getAttribute('href'), 'https://github.com/SyuanTsai/DarkTide-Source-Data');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: historyName, exact: true }).waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).searchParams.get('id') !== null, true);
    assert.equal(await page.locator('.history-page h1').innerText(), historyName);

    await page.goto(`${hosted.origin}/history/1.13.1/?id=unknown%3Aitem`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '找不到歷史項目', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.history-page h1').innerText(), '找不到歷史項目');
    assert.doesNotMatch(await page.locator('main').innerText(), /演示步槍/u);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await closeServer(server);
    await disposeBuildRoot(root);
  }
});
