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
import { computeDataRevision } from '../scripts/content/contract-release.mjs';
import { fixturePublicContent } from '../src/static/fixture.mjs';
import { createBuildRoot, disposeBuildRoot } from './static-test-helpers.mjs';
import { makeCompiledGameChangesPackage } from './w12-shared-view.fixture.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const chromePath = process.env.SYP_W10_CHROMIUM_EXE;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const officialInput = (officialSourceId, key, entityRef, text) => {
  const bytes = Buffer.from(text, 'utf8');
  const segmentId = `${key}-text`;
  return {
    officialSourceId,
    entityRef,
    origin: 'game-localization',
    sourceLocale: 'zh-TW',
    resource: 'synthetic_fixture',
    key,
    occurrence: 0,
    sourceText: text,
    sourceTextSha256: sha256(bytes),
    segments: [{ segmentId, kind: 'text', text, sha256: sha256(bytes) }],
    params: [],
    resolvedText: text,
    resolvedTextSha256: sha256(bytes),
  };
};

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
  const manifest = structuredClone(compiled.manifest);
  const domainFiles = new Map(compiled.files);
  const skillsFile = manifest.files.find(row => row.kind === 'skills');
  const skills = JSON.parse(domainFiles.get(skillsFile.path).toString('utf8'));
  const skillRef = {
    gameReleaseId: manifest.gameReleaseId,
    kind: 'skill',
    recordId: 'fixture:skill:current-search-sample',
  };
  const nameSource = officialInput('fixture:official:current-search-name', 'fixture:current-skill-name', skillRef, '目前版本測試技能');
  const descriptionSource = officialInput('fixture:official:current-search-description', 'fixture:current-skill-description', skillRef, '隔離測試用 current skill。');
  skills.source.records.push({ ...skillRef, payload: {} });
  skills.web.presentations.push({
    authoringId: 'fixture:web:current-search-sample',
    entityRef: skillRef,
    locale: 'zh-TW',
    name: '目前版本測試技能',
    nameOfficialSourceId: 'fixture:official:current-search-name',
    official: descriptionSource,
    errata: [],
    detailSections: [],
  });
  skills.web.officialInputs.sources.push(nameSource, descriptionSource);
  domainFiles.set(skillsFile.path, Buffer.from(JSON.stringify(skills, null, 2) + '\n', 'utf8'));
  for (const row of manifest.files) {
    const bytes = domainFiles.get(row.path);
    row.sizeBytes = bytes.byteLength;
    row.sha256 = sha256(bytes);
  }
  manifest.dataRevision = computeDataRevision(manifest);
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
  for (const [relativePath, bytes] of domainFiles) files.set(`data/${manifest.dataRevision}/${relativePath}`, bytes);
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

// Scenario: The current skill page is opened with a one-skill current fixture and the verified 1.13.1 player projection.
// Purpose: Keep both versions searchable with explicit identity, preserve query state across reload and browser navigation, and keep history failures from hiding verified current data.
test('InterT20_skill-page-default-searches-versioned-current-and-history-with-class-filter', { timeout: 120000 }, async () => {
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
    const page = await browser.newPage();

    await page.goto(`${hosted.origin}/skills/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '技能與天賦', exact: true }).waitFor({ state: 'visible' });
    await page.locator('.shared-entry[data-version="1.13.1"]').first().waitFor({ state: 'visible' });
    const currentVersion = sharedRelease.version.game_version;
    const currentRows = page.locator(`.shared-entry[data-version="${currentVersion}"]`);
    const historyRows = page.locator('.shared-entry[data-version="1.13.1"]');
    assert.ok(await currentRows.count() > 0, 'current version skills remain available in the default combined list');
    assert.equal(await historyRows.count(), 645, 'the full verified Traditional Chinese 1.13.1 skill projection is directly searchable');
    assert.match(await page.locator('.shared-skill-version-note').innerText(), /1\.13\.1.*不是目前遊戲版本/u);
    assert.equal(await page.locator('select[name="version"] option').count(), 3);
    assert.equal(await page.locator('select[name="archetype"] option').count(), 8);
    assert.match(await currentRows.first().innerText(), new RegExp(`目前版本 ${currentVersion}`, 'u'));
    assert.match(await historyRows.first().innerText(), /歷史版本 1\.13\.1/u);
    assert.match(await currentRows.first().locator('a').getAttribute('href'), /^\/skills\/\?id=/u);
    assert.match(await historyRows.first().locator('a').getAttribute('href'), /^\/history\/1\.13\.1\/\?id=/u);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileFilterLayout = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const controls = ['#shared-skill-query', '#shared-skill-archetype', '#shared-skill-version']
        .map(selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { width: rect.width, right: rect.right };
        });
      return {
        viewportWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        controls,
      };
    });
    assert.equal(mobileFilterLayout.viewportWidth, 390);
    assert.ok(mobileFilterLayout.documentWidth <= mobileFilterLayout.viewportWidth
      && mobileFilterLayout.bodyWidth <= mobileFilterLayout.viewportWidth,
    'the combined skill list and filters fit a 390px viewport without horizontal overflow');
    for (const control of mobileFilterLayout.controls) {
      assert.ok(control.width > 0 && control.right <= mobileFilterLayout.viewportWidth,
        'search, archetype, and version controls are visible within the mobile viewport');
    }

    await page.locator('#shared-skill-query').fill('彈藥腰帶');
    await page.locator('#shared-skill-archetype').selectOption('arbites');
    await page.waitForURL(url => url.pathname === '/skills/' && url.searchParams.get('q') === '彈藥腰帶'
      && url.searchParams.get('archetype') === 'arbites');
    assert.equal(await page.locator('.shared-entry:visible').count(), 1);
    assert.equal(await page.locator('.shared-entry:visible').getAttribute('data-version'), '1.13.1');
    assert.match(await page.locator('.shared-skill-result-count').innerText(), /找到 1 筆技能/u);

    await page.locator('#shared-skill-version').selectOption(currentVersion);
    await page.waitForURL(url => url.searchParams.get('version') === currentVersion);
    assert.equal(await page.locator('.shared-entry:visible').count(), 0,
      'the mobile current-version filter excludes the matching historical search result');
    await page.locator('#shared-skill-version').selectOption('1.13.1');
    await page.waitForURL(url => url.searchParams.get('version') === '1.13.1'
      && url.searchParams.get('archetype') === 'arbites' && url.searchParams.get('q') === '彈藥腰帶');
    assert.equal(await page.locator('.shared-entry:visible').count(), 1,
      'the mobile historical-version filter restores the matching skill');

    await page.locator('.shared-entry:visible a').first().click();
    await page.waitForURL(url => url.pathname === '/history/1.13.1/' && url.searchParams.get('type') === 'skill'
      && url.searchParams.get('id') === 'arbites/adamant_ammo_belt');
    await page.getByRole('heading', { name: '彈藥腰帶', exact: true }).waitFor({ state: 'visible' });
    assert.match(await page.locator('.history-badge').innerText(), /1\.13\.1/u);

    await page.goBack();
    await page.waitForURL(url => url.pathname === '/skills/' && url.searchParams.get('q') === '彈藥腰帶'
      && url.searchParams.get('archetype') === 'arbites' && url.searchParams.get('version') === '1.13.1');
    assert.equal(await page.locator('.shared-entry:visible').count(), 1, 'back restores the historical search and class filter');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.shared-entry:visible').first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('#shared-skill-query').inputValue(), '彈藥腰帶');
    assert.equal(await page.locator('#shared-skill-archetype').inputValue(), 'arbites');
    assert.equal(await page.locator('#shared-skill-version').inputValue(), '1.13.1');
    assert.equal(await page.locator('.shared-entry:visible').count(), 1, 'direct refresh reapplies the saved search and class filter');
    await page.goForward();
    await page.getByRole('heading', { name: '彈藥腰帶', exact: true }).waitFor({ state: 'visible' });
    assert.match(await page.locator('.history-badge').innerText(), /1\.13\.1/u, 'forward restores the version-specific historical detail');

    await page.goto(`${hosted.origin}/skills/?version=1.13.1`, { waitUntil: 'domcontentloaded' });
    await page.locator('.shared-entry[data-version="1.13.1"]').first().waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).searchParams.get('version'), '1.13.1');
    assert.equal(await page.locator('.shared-entry[data-version="1.13.1"]:visible').count(), 645);
    assert.equal(await page.locator(`.shared-entry[data-version="${currentVersion}"]:visible`).count(), 0,
      'the explicit historical selection never blends current-version details into the old list');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.shared-entry[data-version="1.13.1"]:visible').first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('#shared-skill-version').inputValue(), '1.13.1');
    assert.equal(await page.locator('.shared-entry[data-version="1.13.1"]:visible').count(), 645,
      'refresh preserves the explicit historical version filter');
    assert.equal(await page.locator(`.shared-entry[data-version="${currentVersion}"]:visible`).count(), 0);

    await page.route('**/history/1.13.1/manifest.json', route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }));
    await page.goto(`${hosted.origin}/skills/`, { waitUntil: 'domcontentloaded' });
    await page.locator(`.shared-entry[data-version="${currentVersion}"]:visible`).first().waitFor({ state: 'visible' });
    assert.ok(await page.locator(`.shared-entry[data-version="${currentVersion}"]:visible`).count() > 0,
      'a history-package validation failure must not hide the verified current version');
    assert.equal(await page.locator('.shared-entry[data-version="1.13.1"]:visible').count(), 0,
      'history entries remain fail-closed when their package cannot be verified');
    assert.match(await page.locator('.shared-skill-history-unavailable').innerText(), /歷史.*未能驗證/u);
  } finally {
    await browser?.close();
    await closeServer(server);
    await disposeBuildRoot(root);
  }
});
