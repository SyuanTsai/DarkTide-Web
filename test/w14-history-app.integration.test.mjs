import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildStaticSite } from '../src/static/build.mjs';
import { createStaticServer } from '../scripts/serve.mjs';
import { fixturePublicContent } from '../src/static/fixture.mjs';
import { createBuildRoot, disposeBuildRoot } from './static-test-helpers.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const chromePath = process.env.SYP_W10_CHROMIUM_EXE;

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

// Scenario: A built static site contains an independent 1.13.1 player history package and a separate fixture catalog.
// Purpose: Verify direct routes, keyboard filtering, reloadable details, mobile layout, and strict history/current separation.
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
    await buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent() });
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

    const response = await page.goto(`${hosted.origin}/history/1.13.1`, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    await page.locator('.history-page h1').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.history-page h1').innerText(), '1.13.1 歷史資料');
    assert.match(await page.locator('.history-notice').innerText(), /不是目前遊戲版本/u);
    assert.doesNotMatch(await page.locator('main').innerText(), /演示步槍/u, 'current fixture data must not appear in the history reader');
    assert.equal(await page.locator('.primary-nav a[aria-current="page"]').getAttribute('href'), '/history/1.13.1/');
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
    const firstLink = page.locator('.history-results a').first();
    const historyName = await firstLink.innerText();
    await firstLink.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.pathname === '/history/1.13.1/' && Boolean(url.searchParams.get('id')));
    await page.getByRole('heading', { name: historyName, exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.history-page h1').innerText(), historyName);
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
