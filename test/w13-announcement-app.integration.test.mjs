import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildStaticSite } from '../src/static/build.mjs';
import { fixturePublicContent } from '../src/static/fixture.mjs';
import { createStaticServer } from '../scripts/serve.mjs';
import { createBuildRoot, disposeBuildRoot } from './static-test-helpers.mjs';
import { makeCompiledAnnouncementFixture } from './w13-announcement-fixture.mjs';

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

// Scenario: The actual W08 compiler emits one schema-valid but non-publishable site announcement.
// Purpose: Prove the normal static app exposes the announcement list route and renders the compiled record.
// Given a marked fixture package, When Chromium opens /announcements/, Then the typed announcement list is visible.
test('InterT10_compiled_announcement_renders_on_static_list_route', { timeout: 120000 }, async () => {
  const fixture = await makeCompiledAnnouncementFixture();
  assert.equal(fixture.bundle.metadata.shared_fixture_only, true);
  assert.equal(fixture.bundle.metadata.fixture_id, 'synthetic-w13-announcement-renderer');
  const root = await createBuildRoot({ productionWeb: true });
  let server;
  let browser;
  try {
    await buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), sharedRelease: fixture.bundle });
    const hosted = await listen(path.join(root, 'dist'));
    server = hosted.server;
    browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const response = await page.goto(`${hosted.origin}/announcements/`, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['cache-control'], 'no-cache, must-revalidate');
    await page.locator('.shared-announcement-list').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await page.locator('.shared-announcement-list > li').count(), 1);
    assert.match(await page.locator('.shared-announcement-list').innerText(), /W13 公告展示測試（不可發布）/u);
    assert.equal(await page.locator('.primary-nav a[aria-current="page"]').getAttribute('href'), '/announcements/');
    assert.equal(await page.locator('.shared-preview-notice').innerText(), '不可發布的資料預覽；此處版本標記僅供驗證。');

    const detailLink = page.locator('.shared-announcement-list a').first();
    await detailLink.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.pathname === '/announcements/'
      && url.searchParams.get('id') === 'fixture:announcement:w13-site');
    await page.locator('.shared-announcement-content h1').waitFor({ state: 'visible' });
    assert.equal(await page.title(), 'W13 公告展示測試（不可發布）｜黑潮繁體資料庫');
    assert.equal(await page.locator('.shared-announcement-meta dd').nth(0).innerText(), '2026-10-24');
    assert.match(await page.locator('.shared-announcement-meta dd').nth(1).innerText(), /網站維護者 · W13 G02 公告呈現測試資料；不是正式公告/u);
    assert.equal(await page.locator('.shared-announcement-meta dd').nth(2).innerText(), '1');
    assert.deepEqual(await page.locator('.shared-announcement-items > li').allTextContents(), ['合成清單第一項', '合成清單第二項']);
    assert.deepEqual(await page.locator('.shared-announcement-table td').allTextContents(), ['合成表格欄一', '合成表格欄二']);
    const images = page.locator('.shared-announcement-figure img');
    assert.equal(await images.count(), 2);
    assert.deepEqual(await images.evaluateAll(rows => rows.map(row => row.getAttribute('src'))), [
      'https://github.com/user-attachments/assets/dfaa4318-92c8-4f5e-909a-5b5cc6fd100e',
      'https://github.com/user-attachments/assets/dfaa4318-92c8-4f5e-909a-5b5cc6fd100e',
    ]);
    assert.deepEqual(await images.evaluateAll(rows => rows.map(row => row.alt)), ['測試分隔圖第一次出現', '測試分隔圖第二次出現']);
    assert.equal(await page.locator('iframe').count(), 0);
    const videoLink = page.locator('.shared-announcement-link');
    assert.equal(await videoLink.getAttribute('href'), 'https://example.invalid/w13-announcement-video');
    const spoiler = page.locator('.shared-announcement-spoiler');
    assert.equal(await spoiler.evaluate(element => element.open), false);
    await spoiler.locator('summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await spoiler.evaluate(element => element.open), true);
    assert.deepEqual(await page.locator('[data-block-id]').evaluateAll(elements => elements.map(element => element.dataset.blockId)), [
      'fixture:block:heading', 'fixture:block:body', 'fixture:block:list',
      'fixture:block:list-item-one', 'fixture:block:list-item-two',
      'fixture:block:table', 'fixture:block:table-cell-one', 'fixture:block:table-cell-two',
      'fixture:block:image-one', 'fixture:block:image-two', 'fixture:block:spoiler',
      'fixture:block:spoiler-body', 'fixture:block:w13-video-link',
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.shared-announcement-content h1').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).searchParams.get('id'), 'fixture:announcement:w13-site');
    assert.equal(await page.locator('.shared-announcement-meta dd').nth(0).innerText(), '2026-10-24');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await closeServer(server);
    await disposeBuildRoot(root);
  }
});
