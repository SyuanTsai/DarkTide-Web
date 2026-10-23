import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildStaticSite } from '../src/static/build.mjs';
import { computeDataRevision } from '../scripts/content/contract-release.mjs';
import { validateSharedStaticFiles } from '../src/static/shared-release.mjs';
import { fixturePublicContent } from '../src/static/fixture.mjs';
import { createStaticServer } from '../scripts/serve.mjs';
import { createBuildRoot, disposeBuildRoot } from './static-test-helpers.mjs';
import { makeCompiledGameChangesPackage } from './w12-shared-view.fixture.mjs';

const TEST_ROOT = fileURLToPath(new URL('../', import.meta.url));
const chromePath = process.env.SYP_W10_CHROMIUM_EXE;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function compiledBundle({ unrelatedPrivateToken = false, spoofOfficialTokenPath = false, mismatchedWeaponOfficialCopy = false,
  spoofWeaponPresentationPath = false, changeTargetKind = null, includeCorrectionChain = false } = {}) {
  const emitted = await makeCompiledGameChangesPackage({ knownRangeChange: true, changeTargetKind, includeCorrectionChain });
  const compiled = { ...emitted, manifest: structuredClone(emitted.manifest), files: new Map(emitted.files) };
  const manifest = compiled.manifest;
  if (mismatchedWeaponOfficialCopy) {
    const weaponRow = manifest.files.find(row => row.kind === 'weapons');
    const weapon = JSON.parse(compiled.files.get(weaponRow.path).toString('utf8'));
    weapon.web.presentations[0].official.resource += '/not-the-validated-copy';
    const changedBytes = Buffer.from(JSON.stringify(weapon, null, 2) + '\n', 'utf8');
    compiled.files.set(weaponRow.path, changedBytes);
    weaponRow.sizeBytes = changedBytes.byteLength;
    weaponRow.sha256 = sha256(changedBytes);
  }
  if (spoofWeaponPresentationPath) {
    const weaponRow = manifest.files.find(row => row.kind === 'weapons');
    const weapon = JSON.parse(compiled.files.get(weaponRow.path).toString('utf8'));
    weapon.web['presentations[0].official'] = structuredClone(weapon.web.presentations[0].official);
    const changedBytes = Buffer.from(JSON.stringify(weapon, null, 2) + '\n', 'utf8');
    compiled.files.set(weaponRow.path, changedBytes);
    weaponRow.sizeBytes = changedBytes.byteLength;
    weaponRow.sha256 = sha256(changedBytes);
  }
  if (unrelatedPrivateToken) {
    const indexPath = manifest.changeIndexPath;
    const domain = JSON.parse(compiled.files.get(indexPath).toString('utf8'));
    domain.web = { unrelatedPrivateMetadata: { token: 'must remain rejected' }, ...domain.web };
    const changedBytes = Buffer.from(JSON.stringify(domain, null, 2) + '\n', 'utf8');
    compiled.files.set(indexPath, changedBytes);
    const indexRow = manifest.files.find(row => row.path === indexPath);
    indexRow.sizeBytes = changedBytes.byteLength;
    indexRow.sha256 = sha256(changedBytes);
    manifest.dataRevision = computeDataRevision(manifest);
  }
  if (spoofOfficialTokenPath) {
    const indexPath = manifest.changeIndexPath;
    const domain = JSON.parse(compiled.files.get(indexPath).toString('utf8'));
    domain.web = {
      'officialInputs.sources[999]': structuredClone(domain.web.officialInputs.sources[0]),
      ...domain.web,
    };
    const changedBytes = Buffer.from(JSON.stringify(domain, null, 2) + '\n', 'utf8');
    compiled.files.set(indexPath, changedBytes);
    const indexRow = manifest.files.find(row => row.path === indexPath);
    indexRow.sizeBytes = changedBytes.byteLength;
    indexRow.sha256 = sha256(changedBytes);
    manifest.dataRevision = computeDataRevision(manifest);
  }
  manifest.dataRevision = computeDataRevision(manifest);
  const revision = manifest.dataRevision;
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const pointer = {
    game_version: manifest.gameVersion,
    content_version: manifest.contentVersion,
    data_revision: revision,
    manifest_path: `/data/${revision}/manifest.json`,
    manifest_sha256: sha256(manifestBytes),
  };
  const version = {
    schema_version: 2,
    data_revision: revision,
    build_id: 'a'.repeat(64),
    game_version: manifest.gameVersion,
    package_kind: 'fixture',
    game_releases: [pointer],
  };
  const files = new Map([[`data/${revision}/manifest.json`, manifestBytes]]);
  for (const [relativePath, bytes] of compiled.files) files.set(`data/${revision}/${relativePath}`, bytes);
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
  const bundle = validateSharedStaticFiles({
    version,
    fixtureMarker: { fixtureOnly: true, publicationEligible: false, fixtureId: 'synthetic-w12-game-changes' },
    files,
  });
  return { compiled, bundle };
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
  if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

// Scenario: The actual W08 compiler emits an isolated but schema-valid W12 game-change package.
// Purpose: Verify the ordinary built Web app loads the optional index, renders typed ranges and fixed official-input provenance, and serves the stable route with its document cache policy.
// Given a compiler-validated fixture package, When Chromium opens the list and two detail routes, Then filters, range semantics, source hashes and the same-version JSON link match the verified bytes.
test('InterT20_compiled_game_changes_render_in_static_app_and_preserve_source_identity', {
  timeout: 120000,
}, async () => {
  const { compiled, bundle } = await compiledBundle({ includeCorrectionChain: true });
  assert.equal(compiled.publicationEligible, false);
  const root = await createBuildRoot({ productionWeb: true });
  let variantRoot;
  let server;
  let variantServer;
  let browser;
  const pageErrors = [];
  try {
    await buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), sharedRelease: bundle });
    const hosted = await listen(path.join(root, 'dist'));
    server = hosted.server;
    browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => pageErrors.push(error.message));

    const routeResponse = await page.request.get(`${hosted.origin}/game-changes/?version=1.0.1&type=weapon`, {
      headers: { accept: 'text/html' },
    });
    assert.equal(routeResponse.status(), 200);
    assert.equal(routeResponse.headers()['cache-control'], 'no-cache, must-revalidate');
    await page.goto(`${hosted.origin}/game-changes/?version=1.0.1&type=weapon`);
    await page.locator('.shared-change-list').waitFor({ state: 'visible' });
    assert.equal(await page.locator('select[name="version"] option:checked').textContent(), '1.0.1');
    assert.equal(await page.locator('select[name="type"] option:checked').textContent(), '武器');
    assert.equal(await page.locator('.shared-change-list > li').count(), 2);

    await page.goto(`${hosted.origin}/game-changes/`);
    const versionFilter = page.locator('select[name="version"]');
    await versionFilter.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    const typeFilter = page.locator('select[name="type"]');
    await page.keyboard.press('End');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.searchParams.get('version') === '1.0.1'
      && url.searchParams.get('type') === 'weapon');
    assert.equal(await page.locator('select[name="version"] option:checked').textContent(), '1.0.1');
    assert.equal(await typeFilter.locator('option:checked').textContent(), '武器');
    assert.equal(await page.locator('.shared-change-list > li').count(), 2);

    const indexPath = `/data/${compiled.manifest.dataRevision}/${compiled.manifest.changeIndexPath}`;
    const changeDomain = compiled.domains.find(domain => domain.kind === 'game-changes');
    const sourceItem = changeDomain.web.gameChanges[0];
    const officialItem = changeDomain.web.officialTextChanges[0];
    assert.equal(sourceItem.supersedesChangeId, officialItem.changeId);
    await page.goto(`${hosted.origin}/game-changes/?id=${encodeURIComponent(sourceItem.changeId)}`);
    await page.locator('.shared-change-before-after').waitFor({ state: 'visible' });
    const valueText = await page.locator('.shared-change-before-after').innerText();
    assert.match(valueText, /後：0\.25–0\.75 比例（含下限、不含上限；步進 0\.05）/u);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'),
      `${hosted.origin}/game-changes/?id=${encodeURIComponent(sourceItem.changeId)}`);
    await page.reload();
    assert.equal(await page.locator('h1').textContent(), '合成武器範例');
    const evidenceSection = page.locator('section.shared-card').filter({ hasText: '公開來源證據' });
    assert.equal(await evidenceSection.count(), 1);
    const publicEvidenceLink = evidenceSection.locator('a.shared-source-link[href^="https://"]');
    assert.equal(await publicEvidenceLink.getAttribute('href'),
      'https://example.invalid/synthetic/game-code/blob/cccccccccccccccccccccccccccccccccccccccc/fixture.lua');
    const correctionSection = page.locator('section.shared-card').filter({ hasText: '紀錄更正鏈' });
    assert.equal(await correctionSection.count(), 1);
    const correctionLink = correctionSection.locator('a', { hasText: '前一筆紀錄：' });
    assert.equal(await correctionLink.getAttribute('href'), `/game-changes/?id=${encodeURIComponent(officialItem.changeId)}`);
    await correctionLink.click();
    await page.waitForURL(url => url.searchParams.get('id') === officialItem.changeId);
    assert.equal(await page.locator('.shared-change-value').count(), 2);
    await page.reload();
    assert.equal(new URL(page.url()).searchParams.get('id'), officialItem.changeId);

    await page.locator('.shared-change-value').first().waitFor({ state: 'visible' });
    const officialRows = page.locator('.shared-change-value');
    assert.equal(await officialRows.count(), 2);
    assert.ok((await officialRows.first().innerText()).includes('Synthetic official weapon value: 40.'));
    assert.ok((await officialRows.nth(1).innerText()).includes('Synthetic official weapon value: 41.'));
    assert.ok((await officialRows.first().innerText()).includes('fixture_weapon_alpha'));
    const templates = page.locator('details.shared-official-template');
    assert.equal(await templates.count(), 2,
      'the original source templates remain available separately from resolved official text');
    assert.equal(await templates.first().evaluate(element => element.open), false,
      'the parameter locator remains secondary to the fixed official text');
    await templates.first().locator('summary').click();
    await templates.nth(1).locator('summary').click();
    assert.ok((await templates.first().innerText()).includes('synthetic_damage_value'));
    assert.ok((await templates.first().innerText()).includes('40'));
    assert.ok((await templates.nth(1).innerText()).includes('synthetic_damage_value'));
    assert.ok((await templates.nth(1).innerText()).includes('41'));
    assert.ok((await officialRows.first().innerText()).includes('f288fa0d3cabc1b8328a745e5d1af49c4fdbd0660e99ba48660a83cd0cd5c1e2'));
    assert.ok((await officialRows.first().innerText()).includes('synthetic_localization'));
    const fixedLinks = page.locator('.shared-change-value a.shared-source-link', { hasText: '檢視同版固定共享資料檔' });
    assert.equal(await fixedLinks.count(), 2);
    assert.equal(await fixedLinks.first().getAttribute('href'), indexPath);
    const sourceResponse = await page.request.get(new URL(indexPath, hosted.origin).href);
    assert.equal(sourceResponse.status(), 200);
    assert.match(sourceResponse.headers()['content-type'], /^application\/json\b/u);
    const fixedIndex = await sourceResponse.json();
    assert.ok(fixedIndex.web.officialInputs.sources.some(row => row.officialSourceId === officialItem.fromOfficialSourceId
      && row.sourceTextSha256 === 'f288fa0d3cabc1b8328a745e5d1af49c4fdbd0660e99ba48660a83cd0cd5c1e2'));

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(overflow, false, 'the game-change detail must fit a 390px viewport without horizontal scrolling');

    const variantFixture = await compiledBundle({ changeTargetKind: 'blessing-variant' });
    assert.equal(variantFixture.compiled.publicationEligible, false);
    variantRoot = await createBuildRoot({ productionWeb: true });
    await buildStaticSite({ root: variantRoot, mode: 'fixture', data: fixturePublicContent(), sharedRelease: variantFixture.bundle });
    const variantHosted = await listen(path.join(variantRoot, 'dist'));
    variantServer = variantHosted.server;
    const variantDomain = variantFixture.compiled.domains.find(domain => domain.kind === 'game-changes');
    const variantChangeId = variantDomain.web.gameChanges[0].changeId;
    await page.goto(`${variantHosted.origin}/game-changes/?id=${encodeURIComponent(variantChangeId)}`);
    await page.locator('.shared-change-blessing-variant').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.shared-change-summary').textContent(), '合成技術變動摘要。');
    const variantText = (await page.locator('.shared-change-blessing-variant').innerText()).replace(/\s+/gu, ' ').trim();
    assert.equal(variantText,
      '祝福變體來源資料 來源定義階級：LV1、LV2、LV3、LV4 可取得階級尚未確認。 來源列出的適用武器：合成武器範例');
    assert.deepEqual(pageErrors, []);
  } finally {
    await closeServer(variantServer);
    await closeServer(server);
    await browser?.close();
    if (variantRoot) await disposeBuildRoot(variantRoot);
    await disposeBuildRoot(root);
  }
});

// Scenario: A compiler-emitted game-changes index is extended with a private token outside officialInputs.sources[].segments[].token.
// Purpose: Permit only the exact validated official-input token location while preserving the public JSON private-field boundary.
// Given a fully resealed isolated shared package, When the static verifier scans its declared change index, Then the unrelated token is rejected.
test('InterT30_rejects_private_token_outside_compiled_game_change_official_input_segments', async () => {
  const { bundle } = await compiledBundle({ unrelatedPrivateToken: true });
  const root = await createBuildRoot({ productionWeb: true });
  try {
    await assert.rejects(buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), sharedRelease: bundle }),
      /public JSON contains a private field: token/u);
  } finally {
    await disposeBuildRoot(root);
  }
});

// Scenario: A game-changes JSON object uses a dotted key and a cloned official source that imitate the canonical sources-array path.
// Purpose: Prevent a cloned source object from granting the narrow game-changes token exception based only on a string path.
// Given a resealed isolated index with a cloned source at a spoofed dotted key, When the static verifier scans it, Then the cloned source is rejected.
test('InterT40_rejects_dotted_key_that_spoofs_canonical_official_input_source', async () => {
  const { bundle } = await compiledBundle({ spoofOfficialTokenPath: true });
  const root = await createBuildRoot({ productionWeb: true });
  try {
    const error = await buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), sharedRelease: bundle })
      .then(() => null, caught => caught);
    assert.ok(error, 'the spoofed token path must be rejected');
    assert.match(error.message, /public official input source is not the canonical object from its sources array/u);
  } finally {
    await disposeBuildRoot(root);
  }
});

// Scenario: A valid weapon presentation official input is copied from officialInputs.sources, but a resealed package changes its source identity.
// Purpose: Ensure the narrowly permitted parameter token is granted only to the exact validated source object and identity.
// Given the real compiler package with a one-field mismatch in the weapon presentation copy, When the static verifier scans it, Then it rejects the copy before publication.
test('InterT50_rejects_weapon_presentation_parameter_tokens_when_official_copy_identity_differs', async () => {
  const { bundle } = await compiledBundle({ mismatchedWeaponOfficialCopy: true });
  const root = await createBuildRoot({ productionWeb: true });
  try {
    await assert.rejects(buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), sharedRelease: bundle }),
      /public presentation official input does not match its validated official source identity/u);
  } finally {
    await disposeBuildRoot(root);
  }
});

// Scenario: A weapons domain adds a dotted key whose text imitates an official presentation's array path.
// Purpose: Ensure a matching value copied from a valid official source cannot become a presentation outside the actual presentations array.
// Given a resealed weapons domain with a cloned official object under a spoofed key, When the static verifier scans it, Then the object is rejected.
test('InterT60_rejects_dotted_key_that_spoofs_weapon_presentation_location', async () => {
  const { bundle } = await compiledBundle({ spoofWeaponPresentationPath: true });
  const root = await createBuildRoot({ productionWeb: true });
  try {
    const error = await buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), sharedRelease: bundle })
      .then(() => null, caught => caught);
    assert.ok(error, 'the spoofed presentation object must be rejected');
    assert.match(error.message, /public presentation official input is not from its actual presentations array/u);
  } finally {
    await disposeBuildRoot(root);
  }
});
