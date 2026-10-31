import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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
const HISTORY_DATA_REVISION = '0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b';
const CURRENT_BRAIN_BURST_ID = 'darktide:skill:psyker:brain-burst-improved';
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

async function compiledSharedFixture({ retainedWeaponCrosswalk = false } = {}) {
  const compiled = await makeCompiledGameChangesPackage();
  const manifest = structuredClone(compiled.manifest);
  const domainFiles = new Map(compiled.files);
  if (retainedWeaponCrosswalk) {
    const weaponsFile = manifest.files.find(row => row.kind === 'weapons');
    const weapons = JSON.parse(domainFiles.get(weaponsFile.path).toString('utf8'));
    const currentWeapon = weapons.source.records.find(row => row.kind === 'weapon'
      && row.gameReleaseId === manifest.gameReleaseId);
    assert.ok(currentWeapon, 'the compiled fixture has a current weapon identity to crosswalk');
    currentWeapon.payload.familyId = 'chainaxe_p1';
    currentWeapon.payload.templateKey = 'chainaxe_p1_m1';
    domainFiles.set(weaponsFile.path, Buffer.from(JSON.stringify(weapons, null, 2) + '\n', 'utf8'));
  }
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
  const currentBrainBurstRef = {
    gameReleaseId: manifest.gameReleaseId,
    kind: 'skill',
    recordId: CURRENT_BRAIN_BURST_ID,
  };
  const currentBrainBurstName = officialInput('fixture:official:brain-burst-name', 'fixture:brain-burst-name', currentBrainBurstRef, '顱腦崩裂');
  const currentBrainBurstEffect = officialInput('fixture:official:brain-burst-effect', 'fixture:brain-burst-effect', currentBrainBurstRef, '測試用已核對現版效果。');
  skills.source.records.push({ ...currentBrainBurstRef, payload: {} });
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
  skills.web.presentations.push({
    authoringId: 'fixture:web:brain-burst-current',
    entityRef: currentBrainBurstRef,
    locale: 'zh-TW',
    name: '顱腦崩裂',
    nameOfficialSourceId: currentBrainBurstName.officialSourceId,
    official: currentBrainBurstEffect,
    errata: [],
    detailSections: [],
  });
  skills.web.officialInputs.sources.push(nameSource, descriptionSource, currentBrainBurstName, currentBrainBurstEffect);
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

// Scenario: The current skill page shares the exact 1.13.1 catalog, original details, and seven retained talent trees.
// Purpose: Verify one merged skill list, current identity priority, canonical legacy routes, restored tree interactions, and independent data failures.
test('InterT20_unified-skills-restored-trees-legacy-routes-and-independent-current-data', { timeout: 180000 }, async () => {
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
    const historicalSource = await readFile(path.join(sourceDirectory, 'source-content.json'));
    const publishedDirectory = path.join(root, 'content', 'published');
    await mkdir(publishedDirectory, { recursive: true });
    await writeFile(path.join(publishedDirectory, 'content.json'), historicalSource);
    const sharedRelease = await compiledSharedFixture();
    await buildStaticSite({ root, mode: 'published', sharedRelease });
    const historicalDataRoot = path.join(root, 'dist', 'data', HISTORY_DATA_REVISION);
    const hosted = await listen(path.join(root, 'dist'));
    server = hosted.server;
    browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
    const page = await browser.newPage();
    const currentVersion = sharedRelease.version.game_version;
    const currentPointer = sharedRelease.version.game_releases.find(row => row.game_version === currentVersion);

    await page.goto(`${hosted.origin}/skills/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '技能與天賦', exact: true }).waitFor({ state: 'visible' });
    await page.locator('.shared-entry:visible').first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('.shared-entry:visible').count(), 646,
      '645 retained skills and two current rows merge into one list with only the exact Brain Burst pair combined');
    assert.equal(await page.locator('select[name="version"]').count(), 0,
      'the unified list has no current/history version filter');
    assert.equal(await page.locator('.shared-skill-version').count(), 0,
      'the unified list does not label all old rows as historical');
    assert.equal(await page.locator('.shared-skill-version-note').innerText(),
      '技能搜尋以已驗證的 1.13.1 索引與原詳情為基準；已逐項核對的目前版本項目合併並優先顯示。');
    assert.equal(await page.locator('.shared-entry[data-skill-id="darktide:skill:psyker:brain-burst-improved"]').count(), 1,
      'the true current/legacy Brain Burst identity is shown exactly once');
    assert.equal(await page.locator('.shared-entry[data-skill-id="darktide:skill:psyker:brain-burst-improved"] a').getAttribute('href'),
      '/skills/?id=darktide%3Askill%3Apsyker%3Abrain-burst-improved',
      'the merged identity opens the confirmed current detail');
    assert.equal(await page.locator('.shared-entry a[href="/skills/arbites/adamant_ammo_belt/"]').count(), 1,
      'an old-only entry uses its catalog route to the complete skill detail');
    assert.equal(await page.locator('select[name="archetype"] option').count(), 8);
    const treeLinks = page.locator('.shared-talent-tree-links a');
    assert.deepEqual(await treeLinks.evaluateAll(links => links.map(link => link.getAttribute('href')).sort()), [
      '/skills/arbites/?view=tree', '/skills/ogryn/?view=tree', '/skills/psyker/?view=tree',
      '/skills/scum/?view=tree', '/skills/skitarii/?view=tree', '/skills/veteran/?view=tree',
      '/skills/zealot/?view=tree',
    ], 'the skills directory exposes all seven tree destinations from retained catalog metadata');
    assert.ok((await page.locator('#build-meta').innerText()).includes(`遊戲版本 ${currentVersion}`));

    await page.locator('.shared-talent-tree-links a[href="/skills/psyker/?view=tree"]').click();
    await page.waitForURL(url => url.pathname === '/skills/psyker/' && url.searchParams.get('view') === 'tree');
    await page.locator('.tree-layout').waitFor({ state: 'visible' });
    await page.goBack();
    await page.waitForURL(url => url.pathname === '/skills/' && !url.searchParams.has('view'));
    await page.locator('.shared-talent-tree-links a').first().waitFor({ state: 'visible' });

    await page.locator('#shared-skill-query').fill('brain_burst_improved');
    await page.waitForURL(url => url.searchParams.get('q') === 'brain_burst_improved');
    assert.equal(await page.locator('.shared-entry:visible').count(), 1,
      'the historical ID remains searchable on the merged current row');
    assert.equal(await page.locator('.shared-entry:visible a').getAttribute('href'),
      '/skills/?id=darktide%3Askill%3Apsyker%3Abrain-burst-improved');
    await page.locator('#shared-skill-query').fill('彈藥腰帶');
    await page.locator('#shared-skill-archetype').selectOption('arbites');
    await page.waitForURL(url => url.searchParams.get('q') === '彈藥腰帶' && url.searchParams.get('archetype') === 'arbites');
    assert.equal(await page.locator('.shared-entry:visible').count(), 1);
    assert.match(await page.locator('.shared-skill-result-count').innerText(), /找到 1 項技能/u);
    assert.equal(await page.locator('.shared-entry:visible a').getAttribute('href'), '/skills/arbites/adamant_ammo_belt/');

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileFilterLayout = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const controls = ['#shared-skill-query', '#shared-skill-archetype'].map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { width: rect.width, right: rect.right };
      });
      return { viewportWidth, documentWidth: document.documentElement.scrollWidth, controls };
    });
    assert.equal(mobileFilterLayout.viewportWidth, 390);
    assert.ok(mobileFilterLayout.documentWidth <= mobileFilterLayout.viewportWidth);
    for (const control of mobileFilterLayout.controls) {
      assert.ok(control.width > 0 && control.right <= mobileFilterLayout.viewportWidth,
        'the unified search and class filter fit a 390px viewport');
    }

    await page.locator('.shared-entry:visible a').click();
    await page.waitForURL(url => url.pathname === '/skills/arbites/adamant_ammo_belt/');
    await page.getByRole('heading', { name: '彈藥腰帶', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.detail-grid').count(), 1,
      'the old-only canonical route opens the full legacy mechanics/source detail');
    assert.ok((await page.locator('#build-meta').innerText()).includes(`遊戲版本 ${currentVersion}`));
    assert.match(await page.locator('#build-meta').innerText(), /資料基準 1\.13\.1/u,
      'legacy detail footer keeps the current release identity and states its actual data basis');
    await page.goBack();
    await page.waitForURL(url => url.pathname === '/skills/' && url.searchParams.get('q') === '彈藥腰帶'
      && url.searchParams.get('archetype') === 'arbites');
    assert.equal(await page.locator('.shared-entry:visible').count(), 1,
      'back restores the unified search and class filter');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.shared-entry:visible').first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('#shared-skill-query').inputValue(), '彈藥腰帶');

    const archetypes = ['arbites', 'scum', 'skitarii', 'ogryn', 'psyker', 'veteran', 'zealot'];
    for (const archetype of archetypes) {
      await page.goto(`${hosted.origin}/skills/${archetype}/?view=tree`, { waitUntil: 'domcontentloaded' });
      await page.locator('.tree-layout').waitFor({ state: 'visible' });
      const expectedTree = JSON.parse(await readFile(path.join(historicalDataRoot, 'trees', `${archetype}.json`), 'utf8'));
      assert.equal(await page.locator('.talent-node').count(), expectedTree.nodes.length,
        `${archetype} tree restores all nodes from its retained tree artifact`);
      assert.ok((await page.locator('#build-meta').innerText()).includes(`遊戲版本 ${currentVersion}`));
      assert.match(await page.locator('#build-meta').innerText(), /資料基準 1\.13\.1/u);
    }

    await page.goto(`${hosted.origin}/skills/psyker/?view=tree`, { waitUntil: 'domcontentloaded' });
    await page.locator('.tree-layout').waitFor({ state: 'visible' });
    const psykerTree = JSON.parse(await readFile(path.join(historicalDataRoot, 'trees', 'psyker.json'), 'utf8'));
    const brainBurstNode = psykerTree.nodes.find(node => node.skill_id === 'psyker_brain_burst_improved');
    assert.ok(brainBurstNode, 'the retained Psyker tree contains the verified mapped Brain Burst node');
    await page.locator(`#tree-zoom`).evaluate(input => {
      input.value = '125'; input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.locator('#tree-zoom + output').innerText(), '125%');
    await page.locator(`.talent-node[data-node-id="${brainBurstNode.node_id}"]`).click();
    assert.equal(await page.locator('#tree-detail-panel h2').innerText(), '顱腦崩裂');
    const currentDetailLink = page.locator('#tree-detail-panel a[href="/skills/?id=darktide%3Askill%3Apsyker%3Abrain-burst-improved"]');
    assert.equal(await currentDetailLink.count(), 1, 'the mapped tree node uses the same current identity as search');
    await currentDetailLink.click();
    await page.waitForURL(url => url.pathname === '/skills/' && url.searchParams.get('id') === 'darktide:skill:psyker:brain-burst-improved');
    await page.locator('.shared-official-text').waitFor({ state: 'visible' });
    assert.equal(await page.locator('main h1').innerText(), '顱腦崩裂');
    assert.equal(await page.locator('.shared-official-text').innerText(), '測試用已核對現版效果。');
    assert.ok((await page.locator('#build-meta').innerText()).includes(`遊戲版本 ${currentVersion}`));
    await page.goBack();
    await page.locator('.tree-layout').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#build-meta').innerText()).includes(`遊戲版本 ${currentVersion}`),
      'browser back from current detail restores the current release identity on the retained tree');
    assert.match(await page.locator('#build-meta').innerText(), /資料基準 1\.13\.1/u,
      'the tree footer continues to state the retained tree data basis');

    await page.locator('.primary-nav a[href="/history/1.13.1/"]').click();
    await page.getByRole('heading', { name: '1.13.1 歷史資料', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('#build-meta').innerText(), '歷史版本 1.13.1');
    await page.goBack();
    await page.locator('.tree-layout').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#build-meta').innerText()).includes(`遊戲版本 ${currentVersion}`),
      'browser back from history restores the current release identity on the tree');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.tree-layout').waitFor({ state: 'visible' });
    assert.match(await page.locator('#build-meta').innerText(), /資料基準 1\.13\.1/u,
      'direct refresh preserves the selected tree and its accurate baseline note');

    await page.goto(`${hosted.origin}/skills/psyker/psyker_brain_burst_improved/`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(url => url.pathname === '/skills/' && url.searchParams.get('id') === CURRENT_BRAIN_BURST_ID);
    assert.equal(await page.locator('main h1').innerText(), '顱腦崩裂',
      'the canonical old identity resolves to the exact current skill when its current record is available');

    const delayedNavigation = await browser.newPage();
    await delayedNavigation.goto(`${hosted.origin}/skills/`, { waitUntil: 'domcontentloaded' });
    await delayedNavigation.locator('.shared-talent-tree-links a[href="/skills/psyker/?view=tree"]').waitFor({ state: 'visible' });
    let releaseTree;
    let resolveTreeRequest;
    let resolveTreeResponse;
    const treeGate = new Promise(resolve => { releaseTree = resolve; });
    const treeRequested = new Promise(resolve => { resolveTreeRequest = resolve; });
    const treeReleased = new Promise(resolve => { resolveTreeResponse = resolve; });
    const holdTree = async route => {
      const response = await route.fetch();
      resolveTreeRequest();
      try { await treeGate; await route.fulfill({ response }); }
      finally { resolveTreeResponse(); }
    };
    const psykerTreePath = `**/data/${HISTORY_DATA_REVISION}/trees/psyker.json`;
    await delayedNavigation.route(psykerTreePath, holdTree);
    try {
      await delayedNavigation.locator('.shared-talent-tree-links a[href="/skills/psyker/?view=tree"]').click();
      await treeRequested;
      await delayedNavigation.locator('.primary-nav a[href="/weapons/"]').click();
      await delayedNavigation.waitForURL(url => url.pathname === '/weapons/');
      await delayedNavigation.getByRole('heading', { name: '武器', exact: true }).waitFor({ state: 'visible' });
      releaseTree();
      await treeReleased;
      await delayedNavigation.waitForTimeout(50);
      assert.equal(new URL(delayedNavigation.url()).pathname, '/weapons/',
        'a delayed tree response cannot replace a newer weapons navigation');
      assert.equal(await delayedNavigation.locator('main h1').innerText(), '武器',
        'the rendered weapons page survives the delayed tree response');
      assert.equal(await delayedNavigation.locator('.tree-layout').count(), 0);
      await delayedNavigation.locator('.primary-nav a[href="/skills/"]').click();
      await delayedNavigation.waitForURL(url => url.pathname === '/skills/');
      await delayedNavigation.locator('.shared-talent-tree-links a[href="/skills/psyker/?view=tree"]').click();
      await delayedNavigation.locator('.tree-layout').waitFor({ state: 'visible' });
    } finally {
      releaseTree();
      await treeReleased;
      await delayedNavigation.unroute(psykerTreePath, holdTree);
    }
    await delayedNavigation.close();

    const delayedDetailNavigation = await browser.newPage();
    await delayedDetailNavigation.goto(`${hosted.origin}/skills/`, { waitUntil: 'domcontentloaded' });
    await delayedDetailNavigation.locator('.shared-entry a[href="/skills/arbites/adamant_ammo_belt/"]').waitFor({ state: 'visible' });
    let releaseDetail;
    let resolveDetailRequest;
    let resolveDetailResponse;
    const detailGate = new Promise(resolve => { releaseDetail = resolve; });
    const detailRequested = new Promise(resolve => { resolveDetailRequest = resolve; });
    const detailReleased = new Promise(resolve => { resolveDetailResponse = resolve; });
    const holdDetail = async route => {
      const response = await route.fetch();
      resolveDetailRequest();
      try { await detailGate; await route.fulfill({ response }); }
      finally { resolveDetailResponse(); }
    };
    const detailPath = `**/data/${HISTORY_DATA_REVISION}/details/skills/arbites/adamant_ammo_belt.json`;
    await delayedDetailNavigation.route(detailPath, holdDetail);
    try {
      await delayedDetailNavigation.locator('.shared-entry a[href="/skills/arbites/adamant_ammo_belt/"]').click();
      await detailRequested;
      await delayedDetailNavigation.locator('.primary-nav a[href="/weapons/"]').click();
      await delayedDetailNavigation.waitForURL(url => url.pathname === '/weapons/');
      await delayedDetailNavigation.getByRole('heading', { name: '武器', exact: true }).waitFor({ state: 'visible' });
      releaseDetail();
      await detailReleased;
      await delayedDetailNavigation.waitForTimeout(50);
      assert.equal(new URL(delayedDetailNavigation.url()).pathname, '/weapons/',
        'a delayed legacy detail response cannot replace a newer weapons navigation');
      assert.equal(await delayedDetailNavigation.locator('main h1').innerText(), '武器',
        'the rendered weapons page survives the delayed legacy detail response');
      assert.equal(await delayedDetailNavigation.locator('.detail-grid').count(), 0);
      await delayedDetailNavigation.locator('.primary-nav a[href="/skills/"]').click();
      await delayedDetailNavigation.waitForURL(url => url.pathname === '/skills/');
      await delayedDetailNavigation.locator('.shared-entry a[href="/skills/arbites/adamant_ammo_belt/"]').click();
      await delayedDetailNavigation.locator('.detail-grid').waitFor({ state: 'visible' });
      await delayedDetailNavigation.getByRole('heading', { name: '彈藥腰帶', exact: true }).waitFor({ state: 'visible' });
    } finally {
      releaseDetail();
      await detailReleased;
      await delayedDetailNavigation.unroute(detailPath, holdDetail);
    }
    await delayedDetailNavigation.close();

    const failedCurrent = await browser.newPage();
    await failedCurrent.route(`**${currentPointer.manifest_path}`, route => route.abort('internetdisconnected'));
    await failedCurrent.goto(`${hosted.origin}/skills/`, { waitUntil: 'domcontentloaded' });
    await failedCurrent.locator('.shared-skill-current-unavailable').waitFor({ state: 'visible' });
    assert.equal(await failedCurrent.locator('.shared-entry:visible').count(), 645,
      'verified old skill search remains usable when current data fails');
    assert.equal(await failedCurrent.locator('.shared-failure').count(), 0);
    assert.ok((await failedCurrent.locator('#build-meta').innerText()).includes(`遊戲版本 ${currentVersion}`));
    await failedCurrent.close();

    const failedLegacy = await browser.newPage();
    await failedLegacy.route('**/data/0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b/catalog.json',
      route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }));
    await failedLegacy.goto(`${hosted.origin}/skills/`, { waitUntil: 'domcontentloaded' });
    await failedLegacy.locator('.shared-skill-history-unavailable').waitFor({ state: 'visible' });
    assert.equal(await failedLegacy.locator('.shared-talent-tree-links').count(), 0,
      'tree routes are not advertised when the retained catalog cannot be verified');
    assert.equal(await failedLegacy.locator('.shared-entry:visible').count(), 2,
      'current skills remain usable if the retained catalog cannot be read');
    assert.ok((await failedLegacy.locator('#build-meta').innerText()).includes(`遊戲版本 ${currentVersion}`));
    await failedLegacy.close();

    const failedIndex = await browser.newPage();
    await failedIndex.route('**/history/1.13.1/manifest.json', route =>
      route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }));
    await failedIndex.goto(`${hosted.origin}/skills/`, { waitUntil: 'domcontentloaded' });
    await failedIndex.locator('.shared-skill-history-unavailable').waitFor({ state: 'visible' });
    assert.equal(await failedIndex.locator('.shared-entry:visible').count(), 2,
      'current skills remain usable if the fixed old index cannot be verified');
    await failedIndex.close();

    process.stdout.write('Unified skills, seven legacy talent trees, exact current alias, canonical skill details, SPA history and independent data failure tests passed.\n');
  } finally {
    await browser?.close();
    await closeServer(server);
    await disposeBuildRoot(root);
  }
});

// Scenario: The current weapon and blessing pages share the exact retained 1.13.1 catalog and per-entry detail routes.
// Purpose: Verify all retained identities, current-first loading, exact-family deduplication, safe unresolved-current fallback, search, direct legacy details, tiers, applicability links, and mobile width.
test('InterT30_weapons-and-blessings-restore-full-catalog-and-details', { timeout: 180000 }, async () => {
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
    const historicalSource = await readFile(path.join(sourceDirectory, 'source-content.json'));
    const publishedDirectory = path.join(root, 'content', 'published');
    await mkdir(publishedDirectory, { recursive: true });
    await writeFile(path.join(publishedDirectory, 'content.json'), historicalSource);
    const sharedRelease = await compiledSharedFixture({ retainedWeaponCrosswalk: true });
    await buildStaticSite({ root, mode: 'published', sharedRelease });
    const hosted = await listen(path.join(root, 'dist'));
    server = hosted.server;
    browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    let releaseHistoryManifest;
    let resolveManifestRequest;
    const historyGate = new Promise(resolve => { releaseHistoryManifest = resolve; });
    const manifestRequested = new Promise(resolve => { resolveManifestRequest = resolve; });
    const delayedManifestBytes = await readFile(path.join(root, 'dist', 'history', '1.13.1', 'manifest.json'));
    const delayedManifest = async route => {
      resolveManifestRequest();
      await historyGate;
      await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: delayedManifestBytes }).catch(() => {});
    };
    await page.route('**/history/1.13.1/manifest.json', delayedManifest);
    try {
      await page.goto(`${hosted.origin}/weapons/`, { waitUntil: 'domcontentloaded' });
      await manifestRequested;
      const currentFamily = page.locator('.shared-weapon-family[data-current-family-id="chainaxe_p1"]');
      await currentFamily.waitFor({ state: 'visible', timeout: 10000 });
      assert.equal(await currentFamily.count(), 1,
        `current data should render while the manifest is held; main text: ${await page.locator('main').innerText()}`);
      assert.match(await page.locator('.shared-history-catalog').innerText(), /正在讀取 1\.13\.1/u,
        'the unified page shows current data while its retained manifest is deliberately held');
      assert.equal(await page.locator('[data-retained-weapon-id]').count(), 0,
        'no retained rows appear before their catalog is verified');
      await page.locator('#shared-search').fill('chainaxe_p1');
      await page.waitForURL(url => url.searchParams.get('q') === 'chainaxe_p1');
      assert.match(page.url(), /[?&]q=chainaxe_p1(?:&|$)/u,
        `a search typed before the retained data finishes loading is preserved in the URL; input=${await page.locator('#shared-search').inputValue()} url=${page.url()}`);
      releaseHistoryManifest();
      await page.locator('.shared-history-catalog[data-catalog-revision]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#shared-search').inputValue(), 'chainaxe_p1',
        'the delayed catalog render preserves the entered query');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'shared-search',
        'the delayed catalog render restores search focus');
      await page.locator('#shared-search').fill('');
      await page.waitForURL(url => !url.searchParams.has('q'));
    } finally {
      releaseHistoryManifest();
      await page.unroute('**/history/1.13.1/manifest.json', delayedManifest);
    }

    const retainedWeaponIds = await page.locator('[data-retained-weapon-id]').evaluateAll(nodes => nodes.map(row => row.dataset.retainedWeaponId));
    assert.equal(retainedWeaponIds.length, 70, 'all 70 retained weapon identities are visible exactly once');
    assert.equal(new Set(retainedWeaponIds).size, 70, 'retained weapon IDs are not duplicated');
    const retainedMarkIds = await page.locator('[data-retained-mark-id]').evaluateAll(nodes => nodes.map(row => row.dataset.retainedMarkId));
    assert.equal(retainedMarkIds.length, 135, 'all 135 retained mark identities remain linked');
    assert.equal(new Set(retainedMarkIds).size, 135, 'retained mark IDs are not duplicated');
    assert.equal(await page.locator('.shared-weapon-family[data-current-family-id="chainaxe_p1"][data-retained-weapon-id="chainaxe_p1"]').count(), 1,
      'the matching current and retained family IDs merge into one current row');
    assert.equal(await page.locator('.shared-weapon-family[data-current-family-id="chainaxe_p1"] .shared-current-weapon-name').count(), 1,
      'an unverified synthetic current detail remains visible by identity without inventing a current detail link');
    assert.equal(await page.locator('[data-retained-mark-id="chainaxe_p1_m1"] a[href="/weapons/chainaxe_p1/marks/chainaxe_p1_m1/"]').count(), 1,
      'when no current detail is verified, the retained model keeps its working legacy route');
    assert.equal(await page.locator('[data-retained-mark-id="chainaxe_p1_m2"] a[href="/weapons/chainaxe_p1/marks/chainaxe_p1_m2/"]').count(), 1,
      'the old-only mark keeps its original 1.13.1 detail route');
    assert.match(await page.locator('[data-retained-weapon-id="transonic_knife_p1"]').innerText(), /名稱待確認（transonic_knife_p1）/u,
      'the retained weapon without a Traditional Chinese name remains searchable by ID');
    assert.equal(await page.locator('[data-retained-mark-id="transonic_knife_p1_m1"]').count(), 1,
      'the retained mark without a localized name is not silently filtered out');
    assert.ok((await page.locator('#build-meta').innerText()).includes(`遊戲版本 ${sharedRelease.version.game_version}`));
    assert.match(await page.locator('.shared-history-note').innerText(), /部分武器的數值資料尚未整理/u,
      'the retained weapon catalog states the known limits of the source data');

    const sharedPointer = sharedRelease.version.game_releases.find(row => row.game_version === sharedRelease.version.game_version);
    const sharedManifest = JSON.parse(await readFile(path.join(root, 'dist', sharedPointer.manifest_path.slice(1)), 'utf8'));
    const currentWeaponsFile = sharedManifest.files.find(row => row.kind === 'weapons');
    assert.ok(currentWeaponsFile, 'the current fixture manifest identifies its weapons domain file');
    const currentWeaponsBytes = await readFile(path.join(root, 'dist', 'data', sharedRelease.version.data_revision, currentWeaponsFile.path));
    const delayedCurrent = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let releaseCurrentData;
    let resolveCurrentRequest;
    const currentGate = new Promise(resolve => { releaseCurrentData = resolve; });
    const currentRequested = new Promise(resolve => { resolveCurrentRequest = resolve; });
    const delayedCurrentPath = `**/data/${sharedRelease.version.data_revision}/${currentWeaponsFile.path}`;
    const delayedCurrentResponse = async route => {
      resolveCurrentRequest();
      await currentGate;
      await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: currentWeaponsBytes }).catch(() => {});
    };
    await delayedCurrent.route(delayedCurrentPath, delayedCurrentResponse);
    try {
      await delayedCurrent.goto(`${hosted.origin}/weapons/`, { waitUntil: 'domcontentloaded' });
      await currentRequested;
      await delayedCurrent.locator('.shared-history-catalog[data-catalog-revision]').waitFor({ state: 'visible' });
      assert.equal(await delayedCurrent.locator('[data-retained-weapon-id]').count(), 70,
        'the full retained weapon list becomes usable while current data is deliberately held');
      assert.match(await delayedCurrent.locator('#build-meta').innerText(), /目前資料載入中/u,
        'the page reports that current data is still loading rather than labelling retained rows as current');
      await delayedCurrent.locator('#shared-search').fill('transonic_knife_p1');
      await delayedCurrent.waitForURL(url => url.searchParams.get('q') === 'transonic_knife_p1');
      assert.equal(await delayedCurrent.locator('[data-retained-weapon-id="transonic_knife_p1"]:visible').count(), 1,
        'the retained catalogue remains searchable while current data is held');
      releaseCurrentData();
      await delayedCurrent.locator('.shared-weapon-family[data-current-family-id="chainaxe_p1"]').waitFor({ state: 'attached' });
      assert.equal(await delayedCurrent.locator('#shared-search').inputValue(), 'transonic_knife_p1',
        'late current data rendering preserves the retained search query');
      assert.equal(await delayedCurrent.evaluate(() => document.activeElement?.id), 'shared-search',
        'late current data rendering restores search focus');
    } finally {
      releaseCurrentData();
      await delayedCurrent.unroute(delayedCurrentPath, delayedCurrentResponse);
      await delayedCurrent.close();
    }

    await page.locator('#shared-search').fill('transonic_knife_p1');
    assert.equal(await page.locator('[data-retained-weapon-id="transonic_knife_p1"]:visible').count(), 1,
      'weapon search matches the fallback ID for an untranslated weapon');
    await page.locator('#shared-search').fill('');
    await page.locator('[data-retained-mark-id="chainaxe_p1_m2"] a').click();
    await page.waitForURL(url => url.pathname === '/weapons/chainaxe_p1/marks/chainaxe_p1_m2/');
    await page.getByRole('heading', { name: '突擊鏈斧 奧瑞斯特斯 Mk XII', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.detail-grid').count(), 1, 'the retained mark deep route restores its legacy detail');
    assert.match(await page.locator('#build-meta').innerText(), /遊戲版本 .*資料基準 1\.13\.1/u,
      'the old detail is labelled with its actual 1.13.1 baseline');
    await page.goto(`${hosted.origin}/weapons/transonic_knife_p1/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '名稱待確認（transonic_knife_p1）', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.detail-grid').count(), 1, 'an untranslated retained family still has a direct detail route');

    await page.goto(`${hosted.origin}/blessings/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '祝福', exact: true }).waitFor({ state: 'visible' });
    await page.locator('.shared-history-catalog[data-catalog-revision]').waitFor({ state: 'visible' });
    const retainedBlessingIds = await page.locator('[data-retained-blessing-id]').evaluateAll(nodes => nodes.map(row => row.dataset.retainedBlessingId));
    assert.equal(retainedBlessingIds.length, 167, 'all 167 retained blessings, including any exact current alias, are represented once');
    assert.equal(new Set(retainedBlessingIds).size, 167, 'retained blessing IDs are not duplicated');
    const retainedVariantIds = await page.locator('[data-retained-variant-id]').evaluateAll(nodes => nodes.map(row => row.dataset.retainedVariantId));
    assert.equal(retainedVariantIds.length, 605, 'all 605 retained variant detail routes remain linked');
    assert.equal(new Set(retainedVariantIds).size, 605, 'retained variant IDs are not duplicated');

    await page.goto(`${hosted.origin}/blessings/rev-it-up/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '提速', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.blessing-levels').count(), 1, 'retained blessing detail restores its tier view');
    assert.equal(await page.locator('.relation-list a[href^="/weapons/"]').count(), 3,
      'retained blessing detail restores its three linked weapon applicability relations');
    await page.goto(`${hosted.origin}/blessings/rev-it-up/variants/weapon_trait_bespoke_chainaxe_p1_movement_speed_on_activation/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '提速', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.blessing-levels').count(), 1, 'a direct retained variant route restores level detail');
    assert.match(await page.locator('.blessing-levels').innerText(), /等級 1、2、3、4/u,
      'the retained variant shows only its recorded tier availability');
    assert.equal(await page.locator('.relation-list a[href^="/weapons/"]').count(), 3,
      'the variant page restores its weapon and two model applicability links');

    await page.setViewportSize({ width: 390, height: 844 });
    const detailLayout = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    assert.equal(detailLayout.viewportWidth, 390);
    assert.ok(detailLayout.documentWidth <= detailLayout.viewportWidth, 'the retained blessing detail has no horizontal overflow at 390px');
    await page.goto(`${hosted.origin}/blessings/`, { waitUntil: 'domcontentloaded' });
    await page.locator('.shared-history-catalog[data-catalog-revision]').waitFor({ state: 'visible' });
    const layout = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      search: document.querySelector('#shared-search')?.getBoundingClientRect().toJSON(),
    }));
    assert.equal(layout.viewportWidth, 390);
    assert.ok(layout.documentWidth <= layout.viewportWidth, 'the unified blessing directory has no horizontal overflow at 390px');
    assert.ok(layout.search?.width > 0 && layout.search.right <= layout.viewportWidth, 'the unified search input fits the mobile viewport');
    assert.deepEqual(pageErrors, [], 'the SPA emitted no uncaught browser exceptions');
  } finally {
    await browser?.close();
    await closeServer(server);
    await disposeBuildRoot(root);
  }
});
