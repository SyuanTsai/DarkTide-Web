import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import test from 'node:test';
import { buildW15AnnouncementCandidate } from '../scripts/content/w15-announcement-import.mjs';
import { createStaticServer } from '../scripts/serve.mjs';
import { buildStaticSite } from '../src/static/build.mjs';
import { fixturePublicContent } from '../src/static/fixture.mjs';
import { createBuildRoot, disposeBuildRoot } from './static-test-helpers.mjs';
import { makeCompiledAnnouncementFixture } from './w13-announcement-fixture.mjs';

const chromePath = process.env.SYP_W10_CHROMIUM_EXE;

function authoringRow(candidateRow) {
  return {
    announcementId: 'fixture:announcement:w13-site',
    scope: candidateRow.scope,
    title: candidateRow.title,
    publishedOn: candidateRow.publishedOn,
    revision: candidateRow.revision,
    source: candidateRow.source,
    blocks: candidateRow.blocks,
    assets: candidateRow.assets,
  };
}

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

// Scenario: A current gameplay page navigates to a pending historical official document in an optional-domain fixture.
// Purpose: Keep the current package footer distinct from an announcement's publication context across SPA navigation.
test('InterT10_official_announcement_renders_typed_source_without_implying_current_game_version', { timeout: 120000 }, async () => {
  const candidate = await buildW15AnnouncementCandidate();
  const source = candidate.announcements[2];
  const fixture = await makeCompiledAnnouncementFixture({ announcement: authoringRow(source) });
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
    await page.route('https://**/*', route => route.abort());
    const currentFooter = `遊戲版本 ${fixture.version.game_version} · 資料修訂 ${fixture.version.data_revision.slice(0, 12)}`;
    const response = await page.goto(`${hosted.origin}/`, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    await page.locator('.shared-home-links').waitFor({ state: 'visible' });
    assert.equal(await page.locator('h1').first().innerText(), '查閱技能、武器與祝福資料');
    assert.equal(await page.locator('#build-meta').innerText(), currentFooter);
    const announcementListFooter = `公告資料 · 資料修訂 ${fixture.version.data_revision.slice(0, 12)}`;
    const historicalAnnouncementFooter = `歷史公告 · 發布日期 ${source.publishedOn}`;
    await page.locator('.shared-home-links a[href="/announcements/"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.pathname === '/announcements/' && !url.search);
    await page.locator('.shared-announcement-list').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.shared-announcement-list a').first().innerText(), source.title);
    assert.equal(await page.locator('#build-meta').innerText(), announcementListFooter);

    const detailLink = page.locator('.shared-announcement-list a').first();
    await detailLink.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.pathname === '/announcements/'
      && url.searchParams.get('id') === 'fixture:announcement:w13-site');
    const article = page.locator('.shared-announcement-content');
    await article.locator('h1').waitFor({ state: 'visible' });
    assert.equal(await article.locator('h1').innerText(), source.title);
    const scopeNote = await article.locator('.shared-announcement-scope-note').innerText();
    assert.equal(scopeNote, '歷史公告');
    assert.equal(await page.locator('#build-meta').innerText(), historicalAnnouncementFooter);
    assert.doesNotMatch(await page.locator('#build-meta').innerText(), /遊戲版本\s*1\.13\.[012]/u);
    assert.equal(await article.locator('iframe').count(), 0);
    assert.equal(await article.locator('thead th').count(), 9);
    assert.equal(await article.locator('tbody td').count(), 72);
    assert.ok(await article.locator('strong').count() > 0);
    assert.ok(await article.locator('em').count() > 0);
    assert.ok(await article.locator('code').count() > 0);
    const originalSource = page.locator('.shared-announcement-meta a').first();
    assert.equal(await originalSource.getAttribute('href'), source.source.locator);
    const spillwayAlias = article.locator('a[href^="/announcements/?id="]').first();
    assert.equal(new URL(await spillwayAlias.getAttribute('href'), hosted.origin).searchParams.get('id'),
      'official:darktide:announcement:2026-09-23-spillway-feature');
    assert.equal(await article.locator('a[href="https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/blob/241ad76ce62330472aa423055a5b85db59bb6c0d/Referneces/Translation.md"]').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    assert.equal(await page.locator('#build-meta').innerText(), historicalAnnouncementFooter);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.shared-announcement-content h1').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#build-meta').innerText(), historicalAnnouncementFooter);
    await page.goBack();
    await page.locator('.shared-announcement-list').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#build-meta').innerText(), announcementListFooter);
    await page.goBack();
    await page.locator('.shared-home-links').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#build-meta').innerText(), currentFooter);
    await page.goForward();
    await page.locator('.shared-announcement-list').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#build-meta').innerText(), announcementListFooter);
    await page.goForward();
    await page.locator('.shared-announcement-content h1').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#build-meta').innerText(), historicalAnnouncementFooter);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await closeServer(server);
    await disposeBuildRoot(root);
  }
});
