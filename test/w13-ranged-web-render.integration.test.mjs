import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = process.env.SYP_W10_CHROMIUM_EXE;

function rangedFixture() {
  const gameReleaseId = 'fixture:w13-ranged-browser';
  const weaponRef = { gameReleaseId, kind: 'weapon', recordId: 'fixture:weapon:lasgun-p1-m1' };
  const hipRef = { gameReleaseId, kind: 'attack-profile', recordId: 'fixture:attack:hipfire' };
  const adsRef = { gameReleaseId, kind: 'attack-profile', recordId: 'fixture:attack:ads' };
  const clipsRef = { gameReleaseId, kind: 'stat-definition', recordId: 'fixture:stat:ammunition-clips' };
  const reserveRef = { gameReleaseId, kind: 'stat-definition', recordId: 'fixture:stat:ammunition-reserve' };
  const clipsCurveRef = { gameReleaseId, kind: 'stat-curve', recordId: 'fixture:curve:ammunition-clips' };
  const reserveCurveRef = { gameReleaseId, kind: 'stat-curve', recordId: 'fixture:curve:ammunition-reserve' };
  const sourceRows = [
    ['"semi_auto"', 'weapon_template.displayed_attacks.primary.fire_mode'],
    ['"hipfire"', 'weapon_template.displayed_attacks.primary.type'],
    ['"ads"', 'weapon_template.displayed_attacks.secondary.type'],
    ['"flashlight"', 'weapon_template.displayed_attacks.special.type'],
    ['3', 'weapon_template.actions.action_shoot_hip.ammunition_usage'],
    ['true', 'weapon_template.actions.action_shoot_hip.allow_shots_with_less_than_required_ammo'],
    ['0.5', 'weapon_template.actions.action_shoot_hip.total_time'],
    ['0.275', 'weapon_template.actions.action_shoot_hip.allowed_chain_actions.shoot_pressed.chain_time'],
    ['3', 'weapon_template.actions.action_shoot_zoomed.ammunition_usage'],
    ['true', 'weapon_template.actions.action_shoot_zoomed.allow_shots_with_less_than_required_ammo'],
    ['0.4', 'weapon_template.actions.action_shoot_zoomed.total_time'],
    ['0.275', 'weapon_template.actions.action_shoot_zoomed.allowed_chain_actions.zoom_shoot.chain_time'],
    ['0', 'weapon_template.actions.action_toggle_flashlight.activation_time'],
    ['100', 'hitscan_templates.lasgun_p1_m1_beam.range'],
    ['777', 'hitscan_templates.lasgun_p1_m1_beam.extra.range'],
    ['"<img src=x onerror=alert(1)>"', 'weapon_template.actions.action_shoot_hip.unmapped_source_value'],
  ].map(([rawValue, fieldPath]) => ({ rawValue, sourceLocator: { fieldPath } }));
  const curve = (ref, low, high) => ({ ...ref, payload: { inputUnit: 'ratio', outputUnit: 'instance-count', knots: [
    { input: '0', output: low, sourceOrdinal: 1 }, { input: '1', output: high, sourceOrdinal: 2 },
  ] } });
  const records = [
    { ...weaponRef, reviewState: 'pending', dataCoverage: { status: 'partial', missing: [
      { field: '/payload/actionProfileResolution', reasonCode: 'NOT_IMPORTED' },
    ] }, payload: {
      familyId: 'lasgun_p1', markId: 'lasgun_p1_m1', templateKey: 'lasgun_p1_m1', statRefs: [clipsRef, reserveRef],
      attackProfileRefs: [hipRef, adsRef], sourceRows,
      statTables: [
        { statKey: 'ammunition_clips', tableKey: 'weapon_ammo_templates.fixture.ammunition_clips', properties: [{ property: 'ammunition_clips', unit: 'instance-count', orderedValues: [
          { key: 'lerp_basic', decimal: '80' }, { key: 'lerp_perfect', decimal: '120' },
        ] }] },
        { statKey: 'ammunition_reserve', tableKey: 'weapon_ammo_templates.fixture.ammunition_reserve', properties: [{ property: 'ammunition_reserve', unit: 'instance-count', orderedValues: [
          { key: 'lerp_basic', decimal: '480' }, { key: 'lerp_perfect', decimal: '960' },
        ] }] },
        { statKey: 'dodge', tableKey: 'weapon_template.fixture.dodge', properties: [{ property: 'dodge', unit: 'ratio', orderedValues: [
          { key: 'value', decimal: '1.15' },
        ] }] },
      ],
    } },
    { ...clipsRef, payload: { quantity: 'ammunition_clips', curveRef: clipsCurveRef,
      theoreticalInputRange: { status: 'known', min: '0', max: '1', unit: 'ratio' },
      obtainableInputRange: { status: 'unknown', reasonCode: 'NOT_EXPOSED_BY_SOURCE' } } },
    { ...reserveRef, payload: { quantity: 'ammunition_reserve', curveRef: reserveCurveRef,
      theoreticalInputRange: { status: 'known', min: '0', max: '1', unit: 'ratio' },
      obtainableInputRange: { status: 'unknown', reasonCode: 'NOT_EXPOSED_BY_SOURCE' } } },
    curve(clipsCurveRef, '80', '120'), curve(reserveCurveRef, '480', '960'),
    { ...hipRef, payload: { weaponRef, templateKey: 'lasgun_p1_m1', action: 'action_shoot_hip', mode: 'hipfire' } },
    { ...adsRef, payload: { weaponRef, templateKey: 'lasgun_p1_m1', action: 'action_shoot_zoomed', mode: 'ads' } },
  ];
  const officialInputs = { sources: [
    { officialSourceId: 'fixture:official:en', entityRef: weaponRef, sourceLocale: 'en', sourceText: 'Infantry Lasgun', resolvedText: 'Infantry Lasgun', segments: [] },
    { officialSourceId: 'fixture:official:zh', entityRef: weaponRef, sourceLocale: 'zh-TW', sourceText: '步兵鐳射槍', resolvedText: '步兵鐳射槍', segments: [] },
  ] };
  const weapons = {
    kind: 'weapons', gameReleaseId, source: { records },
    web: { presentations: [{ entityRef: weaponRef, locale: 'zh-TW', name: '步兵鐳射槍', nameOfficialSourceId: 'fixture:official:zh',
      nameOfficialLocaleRefs: [{ officialSourceId: 'fixture:official:en', sourceLocale: 'en' }, { officialSourceId: 'fixture:official:zh', sourceLocale: 'zh-TW' }],
      official: { officialSourceId: 'fixture:official:zh' },
      weaponView: { sourceWeaponRef: weaponRef, markLabel: '測試型號', attackHeading: '射擊與動作來源',
        comparisonHeading: '彈藥模板來源端點', note: '隔離測試資料，非正式遊戲內容。', statSections: [], attackProfileRefs: [hipRef, adsRef] },
      detailSections: [], errata: [],
    }], officialInputs, termLocalizations: [] },
  };
  return { gameReleaseId, domains: [weapons] };
}

function startServer(fixture) {
  const modulePaths = new Map([
    ['/web/shared-view.mjs', path.join(REPO_ROOT, 'web', 'shared-view.mjs')],
    ['/web/shared-render.mjs', path.join(REPO_ROOT, 'web', 'shared-render.mjs')],
    ['/web/style.css', path.join(REPO_ROOT, 'web', 'style.css')],
  ]);
  const moduleScript = `import { createSharedViewModel } from '/web/shared-view.mjs';
import { renderSharedPage } from '/web/shared-render.mjs';
const fixture = window.__W13_FIXTURE__;
const view = createSharedViewModel({ domains: fixture.domains, gameReleaseId: fixture.gameReleaseId, fixtureOnly: true });
const result = { status: 'ready', fixtureOnly: true, pointer: { game_version: '1.13.2', data_revision: 'f'.repeat(64) },
  manifest: { gameReleaseId: fixture.gameReleaseId }, domains: fixture.domains, view };
const render = value => renderSharedPage({ main: document.querySelector('main'), buildMeta: document.querySelector('#build-meta'),
  result: value, url: new URL(location.href) });
window.__w13RerenderWithoutFixtureOnly = () => render({ ...result, fixtureOnly: false });
render(result);`;
  const html = `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><link rel="stylesheet" href="/web/style.css"></head>
<body><p id="build-meta"></p><main></main><script type="module">${moduleScript}</script></body></html>`;
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (modulePaths.has(pathname)) {
      const bytes = await readFile(modulePaths.get(pathname));
      response.writeHead(200, { 'Content-Type': pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8' });
      response.end(bytes);
      return;
    }
    if (pathname.startsWith('/weapons/')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}`, fixture }));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

// Scenario: An explicit test-only W08-shaped fixture exercises the real Web view-model and page renderer.
// Purpose: Prove Chinese ranged labels, source-backed values, fail-closed coverage, text-only rendering, and 390px keyboard access; this fixture is not a live game or Games Lantern identity proof.
test('InterT10_w13-ranged-web-render-displays-source-rows-safely-on-mobile', {
  skip: chromePath ? false : 'Set SYP_W10_CHROMIUM_EXE to run the isolated Chromium renderer check.',
  timeout: 60000,
}, async () => {
  const hosted = await startServer(rangedFixture());
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: chromePath });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(value => { window.__W13_FIXTURE__ = value; }, hosted.fixture);
    await page.goto(hosted.origin + '/weapons/?family=lasgun_p1&mark=lasgun_p1_m1', { waitUntil: 'domcontentloaded' });
    const previewNotice = page.locator('.shared-preview-notice');
    assert.equal(await previewNotice.innerText(), '不可發布的資料預覽；此處版本標記僅供驗證。',
      'the true fixtureOnly flag is visible before rendered weapon content');
    await page.locator('.shared-source-details').waitFor({ state: 'visible' });
    const sourceDetails = page.locator('.shared-source-details');
    await sourceDetails.locator('summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await sourceDetails.evaluate(element => element.open), true, 'keyboard opens the source data details');
    const text = await sourceDetails.innerText();
    for (const phrase of [
      '腰射', '機瞄', '半自動', '每次射擊消耗', '3 彈藥單位', '彈藥不足需求量時仍允許射擊',
      '特殊動作啟動時間：0 秒', '命中掃描範圍：100（來源未提供單位）', '腰射動作總時長：0.5 秒', '腰射動作銜接時間：0.275 秒',
      '80 彈藥單位', '120 彈藥單位', '480 彈藥單位', '960 彈藥單位', '來源未提供實際可取得範圍', '來源明示未匯入',
    ]) assert.ok(text.includes(phrase), `visible source details include: ${phrase}`);
    assert.ok(!text.includes('命中掃描範圍：777'), 'a nested path cannot match the bounded hitscan template field');
    const scalarRow = await sourceDetails.locator('.shared-source-table-property').evaluateAll(rows => rows
      .map(row => row.textContent).find(row => row.includes('dodge')));
    assert.ok(scalarRow.includes('來源值 value 1.15'));
    assert.ok(!scalarRow.includes('模板端點不代表實際可取得範圍'), 'a scalar source value is not mislabeled as an endpoint');
    assert.equal(text.includes('semi_auto'), false, 'known fire mode has a Chinese label');
    const profileHeadings = await sourceDetails.locator('.shared-source-profile h4').allInnerTexts();
    assert.deepEqual(profileHeadings.map(value => value.split(' · ')[0]), ['腰射', '機瞄'],
      'known hipfire and ADS profiles keep their distinct Chinese headings');
    assert.equal(await sourceDetails.locator('img').count(), 0, 'raw source markup remains text and never becomes an element');
    assert.ok(text.includes('<img src=x onerror=alert(1)>'), 'unknown source text remains inspectable as literal text');
    assert.equal(await page.locator('main img').count(), 0, 'no HTML or script is created from a raw Source row');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      'long source locators fit the 390px viewport');
    await page.evaluate(() => window.__w13RerenderWithoutFixtureOnly());
    assert.equal(await page.locator('.shared-preview-notice').count(), 0, 'a formal-mode result does not show the fixture notice');
  } finally {
    await browser?.close();
    await closeServer(hosted.server);
  }
});
