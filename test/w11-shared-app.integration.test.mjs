import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { computeDataRevision } from '../scripts/content/contract-release.mjs';
import { buildStaticSite } from '../src/static/build.mjs';
import { validateSharedStaticFiles } from '../src/static/shared-release.mjs';
import { fixturePublicContent } from '../src/static/fixture.mjs';
import { createStaticServer } from '../scripts/serve.mjs';
import { createBuildRoot, disposeBuildRoot } from './static-test-helpers.mjs';
import { createSharedViewModel } from '../web/shared-view.mjs';

const TEST_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TASK_ROOT = path.dirname(TEST_ROOT);
const candidateDir = process.env.SYP_W11_APPROVED_PACKAGE_DIR;
const chromePath = process.env.SYP_W10_CHROMIUM_EXE;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function candidateBundle(root, { invalidSkillLocale = false } = {}) {
  const originalManifestBytes = await readFile(path.join(root, 'manifest.json'));
  assert.equal(sha256(originalManifestBytes), 'bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7');
  const manifest = JSON.parse(originalManifestBytes.toString('utf8'));
  assert.equal(manifest.dataRevision, '808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62');
  const domainBytes = new Map();
  const originalHashes = new Map();
  for (const row of manifest.files) {
    const bytes = await readFile(path.join(root, ...row.path.split('/')));
    assert.equal(bytes.byteLength, row.sizeBytes, `${row.path} byte length`);
    assert.equal(sha256(bytes), row.sha256, `${row.path} raw SHA-256`);
    originalHashes.set(row.path, sha256(bytes));
    if (invalidSkillLocale && row.kind === 'skills') {
      const domain = JSON.parse(bytes.toString('utf8'));
      domain.web.presentations[0].locale = 'en';
      domainBytes.set(row.path, Buffer.from(JSON.stringify(domain, null, 2) + '\n'));
    } else domainBytes.set(row.path, bytes);
  }
  if (invalidSkillLocale) {
    for (const row of manifest.files) {
      const bytes = domainBytes.get(row.path);
      row.sizeBytes = bytes.byteLength;
      row.sha256 = sha256(bytes);
    }
    manifest.dataRevision = computeDataRevision(manifest);
  }
  const manifestBytes = invalidSkillLocale
    ? Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
    : originalManifestBytes;
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
  for (const [relativePath, bytes] of domainBytes) files.set(`data/${manifest.dataRevision}/${relativePath}`, bytes);
  const sourceLock = {
    schema: 'w09-public-source-lock/1',
    repository: manifest.source.repository,
    source_revision: manifest.source.sourceRevision,
    source_manifest_sha256: manifest.source.manifestSha256,
    game_release_id: manifest.gameReleaseId,
    game_version: manifest.gameVersion,
    content_version: manifest.contentVersion,
  };
  const sourceLockBytes = Buffer.from(JSON.stringify(sourceLock, null, 2) + '\n');
  files.set(`source-locks/${manifest.source.sourceRevision}/${sha256(sourceLockBytes)}.json`, sourceLockBytes);
  const bundle = validateSharedStaticFiles({
    version,
    fixtureMarker: { fixtureOnly: true, publicationEligible: false, fixtureId: 'synthetic-w11-candidate' },
    files,
  });
  return { bundle, manifest, manifestBytes, domainBytes, originalHashes };
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
async function build(root, sharedRelease) {
  return buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), sharedRelease });
}
function routeFor(origin, route) { return new URL(route, origin).href; }

// Scenario: The isolated fixed candidate is built into the ordinary Web app and read through its actual static same-origin routes.
// Purpose: Verify the live app uses one verified four-domain release for desktop/mobile, blessing tiers, weapon marks, keyboard navigation, and fail-closed integrity errors.
// Given the pinned raw candidate package, When pages and controls are used in Chromium, Then displayed values match the validated view-model and failures never expose legacy fixture content.
test('InterT10_shared_web_app_renders_fixed_candidate_and_fails_closed_in_chromium', {
  skip: candidateDir && chromePath ? false : 'Set SYP_W11_APPROVED_PACKAGE_DIR and SYP_W10_CHROMIUM_EXE for the real Chromium package integration.',
  timeout: 120000,
}, async t => {
  const packageInput = await candidateBundle(candidateDir);
  const root = await createBuildRoot({ productionWeb: true });
  let server;
  let browser;
  try {
    await build(root, packageInput.bundle);
    const smoke = spawnSync(process.execPath, [
      path.join(TEST_ROOT, 'scripts', 'browser-smoke.mjs'),
      path.join(root, 'dist'),
    ], { encoding: 'utf8', timeout: 120000 });
    assert.equal(smoke.status, 0,
      `The ordinary browser-smoke CLI must accept the verified W11 shared artifact.\n${smoke.stdout}\n${smoke.stderr}`);
    const hosted = await listen(path.join(root, 'dist'));
    server = hosted.server;
    browser = await chromium.launch({ headless: true, executablePath: chromePath });
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
    const page = await context.newPage();
    await page.goto(hosted.origin, { waitUntil: 'domcontentloaded' });
    await page.locator('.shared-hero h1').waitFor({ state: 'visible' });
    await page.evaluate(() => {
      let robots = document.querySelector('meta[name="robots"]');
      if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.append(robots); }
      robots.content = 'noindex';
      history.pushState(null, '', '/skills/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.locator('.shared-entry-list').waitFor({ state: 'visible' });
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex', 'shared rendering preserves the build noindex boundary');
    assert.equal((await page.locator('#build-meta').innerText()).includes('遊戲版本 1.13.2'), true);
    assert.equal(await page.locator('body').innerText().then(text => text.includes('演示防護')), false,
      'shared context must not render legacy fixture records');
    await page.goto(routeFor(hosted.origin, '/game-changes/?version=1.13.2&type=weapon'));
    await page.locator('.shared-change-empty').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.shared-change-empty').innerText(), '目前篩選條件下沒有已確認的遊戲變動。',
      'the approved package with changeIndexPath=null keeps valid current-version/type filters');
    assert.equal(await page.locator('select[name="version"] option:checked').textContent(), '1.13.2');
    assert.equal(await page.locator('select[name="type"] option:checked').textContent(), '武器');
    assert.deepEqual(await page.locator('select[name="type"] option').allTextContents(), ['全部類型', '技能', '祝福', '武器']);

    const domains = [...packageInput.domainBytes].map(([filePath, bytes]) => JSON.parse(bytes.toString('utf8')));
    const view = createSharedViewModel({ domains, gameReleaseId: packageInput.manifest.gameReleaseId });
    const skillDomain = domains.find(domain => domain.kind === 'skills');
    const skillRef = skillDomain.web.presentations[0].entityRef;
    const skill = view.getSkill(skillRef);
    assert.equal(skill.status, 'ready');
    await page.goto(routeFor(hosted.origin, `/skills/?id=${encodeURIComponent(skillRef.recordId)}`));
    await page.locator('main h1').waitFor({ state: 'visible' });
    assert.equal(await page.locator('main h1').innerText(), skill.name);
    assert.equal(await page.locator('.shared-official-text').innerText(), skill.official.resolvedText);
    assert.equal(new URL(await page.locator('link[rel="canonical"]').getAttribute('href')).searchParams.get('id'), skillRef.recordId,
      'canonical URL retains the displayed content identity');
    const sectionNames = await page.locator('.shared-detail-sections .shared-detail-section > h3').allTextContents();
    assert.deepEqual(sectionNames, skill.sections.map(section => section.heading));
    const detailsSummary = page.locator('details.shared-detail-sections > summary');
    assert.equal(await detailsSummary.innerText(), '詳細說明');
    await detailsSummary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('details.shared-detail-sections').evaluate(node => node.open), true,
      'native keyboard activation must expand the section');
    await page.screenshot({ path: path.join(TASK_ROOT, 'phase2-web-desktop.png'), fullPage: true });

    const blessingDomain = domains.find(domain => domain.kind === 'blessings');
    const blessingPresentation = blessingDomain.web.presentations.find(row => row.tierApplicability?.length);
    const blessingRef = blessingPresentation.entityRef;
    const variantRef = blessingPresentation.tierApplicability[0].variantRef;
    const tier1 = view.getBlessing({ blessingRef, variantRef, tier: 1 });
    const tier4 = view.getBlessing({ blessingRef, variantRef, tier: 4 });
    assert.equal(tier1.status, 'ready');
    assert.equal(tier4.status, 'ready');
    await page.goto(routeFor(hosted.origin, `/blessings/?id=${encodeURIComponent(blessingRef.recordId)}&variant=${encodeURIComponent(variantRef.recordId)}`));
    await page.locator('.shared-official-text').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.shared-official-text').innerText(), tier4.official.resolvedText,
      'known four-tier variant keeps the existing LV4 initial view');
    assert.equal(await page.locator('.shared-applicability').innerText(), '適用武器尚未驗證；此頁只顯示已確認的祝福與等級資料。');
    assert.equal(await page.getByRole('link', { name: 'LV4' }).getAttribute('aria-current'), 'page');
    const blessingCanonical = new URL(await page.locator('link[rel="canonical"]').getAttribute('href'));
    assert.equal(blessingCanonical.searchParams.get('id'), blessingRef.recordId);
    assert.equal(blessingCanonical.searchParams.get('variant'), variantRef.recordId);
    assert.equal(blessingCanonical.searchParams.get('tier'), '4');
    await page.getByRole('link', { name: 'LV1' }).focus();
    await page.keyboard.press('Enter');
    await page.locator('.shared-official-text').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.shared-official-text').innerText(), tier1.official.resolvedText);
    await page.goto(routeFor(hosted.origin, `/blessings/?id=${encodeURIComponent(blessingRef.recordId)}&variant=${encodeURIComponent(variantRef.recordId)}&tier=99`));
    await page.locator('.shared-failure').waitFor({ state: 'visible' });
    assert.match(await page.locator('.shared-failure').innerText(), /無法顯示|無法確認/u);

    const weaponDomain = domains.find(domain => domain.kind === 'weapons');
    const firstPresentation = weaponDomain.web.presentations.find(row => row.weaponView?.sourceWeaponRef);
    const firstRecord = weaponDomain.source.records.find(row => row.kind === 'weapon' && row.recordId === firstPresentation.weaponView.sourceWeaponRef.recordId);
    const family = view.getWeaponFamily(firstRecord.payload.familyId);
    assert.equal(family.status, 'ready');
    assert.ok(family.marks.length >= 2);
    const markViews = family.marks.slice(0, 2);
    const familyListUrl = routeFor(hosted.origin, '/weapons/');
    await page.goto(familyListUrl);
    await page.locator('.shared-entry-list').waitFor({ state: 'visible' });
    const familyRows = await page.locator('.shared-entry-list > .shared-entry').count();
    const uniqueFamilies = new Set(weaponDomain.source.records.filter(row => row.kind === 'weapon').map(row => row.payload.familyId));
    assert.equal(familyRows, uniqueFamilies.size, 'directory has one entry per family');
    for (const mark of markViews) {
      await page.goto(routeFor(hosted.origin, `/weapons/?family=${encodeURIComponent(mark.familyId)}&mark=${encodeURIComponent(mark.markId)}`));
      await page.locator('.shared-official-text').waitFor({ state: 'visible' });
      assert.equal(await page.locator('main h1').innerText(), mark.name);
      assert.equal(await page.locator('.shared-erratum').count(), mark.errata.length,
        'only the weapon view’s exact official-source errata are visible');
      const expectedTermsBlock = mark.terms.length || mark.termRules.length ? 1 : 0;
      assert.equal(await page.locator('main details.shared-expandable > summary').filter({ hasText: '術語' }).count(), expectedTermsBlock,
        'weapon terminology renders only when the verified typed-context view contains terms');
      assert.ok(await page.locator('.shared-stat-list').allInnerTexts().then(rows => rows.join('\n').includes(mark.statSections[0].claims[0].payload.displayValue.decimal)));
      assert.ok(await page.locator('.shared-expandable summary').allInnerTexts().then(rows => rows.includes('其他來源數值、素質語意與連段條件')));
      const sourceDetails = page.locator('details.shared-source-details');
      assert.equal(await sourceDetails.count(), 1, 'the source details panel is present once');
      await sourceDetails.locator('summary').click();
      const sourceText = await sourceDetails.innerText();
      const statText = (await page.locator('.shared-stat-list').allInnerTexts()).join('\n');
      const expectedArmorClasses = [...new Set(mark.statSections.flatMap(section => section.claims
        .map(claim => claim.payload.property?.match(/\[armor_types\.([a-z_]+)\]/u)?.[1]).filter(Boolean)))];
      assert.ok(expectedArmorClasses.length >= 3, 'the fixed weapon marks include multiple independently named armor classes');
      const displayedArmorRows = await page.locator('.shared-stat-list').evaluateAll(lists => lists.flatMap(list =>
        [...list.querySelectorAll('dt')].map(label => ({ label: label.textContent ?? '', value: label.nextElementSibling?.textContent ?? '' }))
          .filter(row => row.label.includes('來源護甲類別'))));
      for (const classKey of expectedArmorClasses) {
        const row = displayedArmorRows.find(candidate => candidate.label.includes(classKey));
        assert.ok(row, `armor class ${classKey} remains independently identifiable`);
        assert.match(row.label, /尚無已確認顯示名/u);
        assert.ok(row.value.trim(), `armor class ${classKey} keeps its corresponding source value`);
      }
      const displayedClaimRows = await page.locator('.shared-stat-list dt').evaluateAll(labels => labels.map(label => ({
        label: label.innerText,
        property: label.querySelector('code.shared-source-property-key')?.textContent,
        profile: label.querySelector('code.shared-source-profile-key')?.textContent,
        locationOpen: label.querySelector('details.shared-source-location')?.open ?? null,
        locationSummary: label.querySelector('details.shared-source-location summary')?.innerText ?? '',
        locationText: label.querySelector('details.shared-source-location code')?.textContent ?? '',
        value: label.nextElementSibling?.innerText ?? '',
      })));
      const expectedClaims = mark.statSections.flatMap(section => section.claims).filter(claim =>
        typeof claim.payload.context?.profile === 'string' && typeof claim.payload.property === 'string'
        && (claim.payload.displayValue?.status === 'known' || claim.payload.value?.status === 'known'));
      assert.ok(expectedClaims.length > 0);
      for (const claim of expectedClaims) {
        const expectedValue = claim.payload.displayValue?.status === 'known' ? claim.payload.displayValue : claim.payload.value;
        const row = displayedClaimRows.find(candidate => candidate.profile === claim.payload.context.profile
          && candidate.property === claim.payload.property && candidate.value.includes(expectedValue.decimal)
          && (claim.payload.context.comparisonStat?.status !== 'known'
            || candidate.label.includes(`面板比較點 ${claim.payload.context.comparisonStat.decimal}%`)));
        assert.ok(row, `claim keeps the exact profile, property, comparison point, and value: ${claim.recordId}`);
        assert.equal(row.locationOpen, false, 'the long property path is collapsed by default');
        assert.equal(row.locationSummary, '來源定位');
        assert.equal(row.locationText, claim.payload.property, 'the collapsed row retains its exact property path in textContent');
        assert.ok(!row.label.includes(claim.payload.property), 'the main stat label stays readable without the full engine path');
      }
      const propertyLocation = page.locator('.shared-stat-list dt details.shared-source-location').first();
      const propertyLocationPath = await propertyLocation.locator('code').textContent();
      assert.ok(expectedClaims.some(claim => claim.payload.property === propertyLocationPath));
      assert.ok(!(await propertyLocation.evaluate(element => element.parentElement.innerText)).includes(propertyLocationPath));
      await propertyLocation.locator('summary').click();
      assert.equal(await propertyLocation.evaluate(element => element.open), true, 'source location details open by keyboard or pointer');
      assert.equal(await propertyLocation.locator('code').innerText(), propertyLocationPath);
      const displayedTables = await sourceDetails.locator('.shared-source-table').evaluateAll(tables => tables.map(table => ({
        statKey: table.querySelector('code.shared-source-table-stat-key')?.textContent,
        tableKey: table.querySelector('code.shared-source-table-key')?.textContent,
        properties: [...table.querySelectorAll('.shared-source-table-property')].map(row => ({
          property: row.querySelector('code.shared-source-property-key')?.textContent,
          text: row.innerText,
        })),
      })));
      for (const table of mark.source.statTables) {
        const renderedTable = displayedTables.find(candidate => candidate.statKey === table.statKey && candidate.tableKey === table.tableKey);
        assert.ok(renderedTable, `source table keeps its stat and table identity: ${table.tableKey}`);
        for (const property of table.properties) {
          const values = property.orderedValues.map(value => value.decimal).filter(Boolean);
          if (!values.length) continue;
          const renderedProperty = renderedTable.properties.find(candidate => candidate.property === property.property);
          assert.ok(renderedProperty, `table property remains individually identifiable: ${property.property}`);
          for (const value of values) assert.ok(renderedProperty.text.includes(value), `property ${property.property} keeps value ${value}`);
        }
      }
      const tableValues = mark.source.statTables.flatMap(table => table.properties.flatMap(property => property.orderedValues.map(value => value.decimal).filter(Boolean)));
      assert.ok(tableValues.length > 0);
      assert.ok(tableValues.every(value => sourceText.includes(value)), 'all raw source stat-table values are displayed');
      const semanticBindings = mark.source.statTableSemantics.flatMap(row => row.bindings ?? []);
      assert.equal(await sourceDetails.locator('.shared-source-semantic').count(), semanticBindings.length,
        'all source stat-table semantics are presented');
      const displayedSemantics = await sourceDetails.locator('.shared-source-semantic').evaluateAll(items => items.map(item => ({
        statKey: item.querySelector('code.shared-source-semantic-stat-key')?.textContent,
        groupKey: item.querySelector('code.shared-source-semantic-group-key')?.textContent,
        property: item.querySelector('code.shared-source-semantic-property-key')?.textContent,
        quantity: item.querySelector('code.shared-source-semantic-quantity')?.textContent,
        text: item.innerText,
      })));
      for (const binding of semanticBindings) {
        const sourceRow = mark.source.statTableSemantics.find(row => row.bindings.includes(binding));
        const displayed = displayedSemantics.find(item => item.statKey === sourceRow.statKey && item.groupKey === sourceRow.groupKey
          && item.property === binding.property && item.quantity === binding.quantityKind);
        assert.ok(displayed, `semantic binding keeps its stat/group/property identity: ${binding.property}`);
        const range = binding.theoreticalInputRange;
        if (range?.status === 'known' && typeof range.min === 'string' && typeof range.max === 'string') {
          assert.ok(displayed.text.includes(`${range.min} 至 ${range.max}`), 'the theoretical source input bounds stay attached to their binding');
        }
        if (binding.obtainableInputRange?.status === 'unknown') assert.ok(displayed.text.includes('來源未提供實際可取得範圍'));
      }
      for (const section of mark.statSections) {
        for (const claim of section.claims) {
          const value = claim.payload.displayValue?.status === 'known' ? claim.payload.displayValue : claim.payload.value;
          if (value?.status === 'known') assert.ok(statText.includes(value.decimal), 'each mark claim value is displayed');
        }
        for (const curve of section.curves) {
          for (const knot of curve.payload.knots ?? []) {
            assert.ok(statText.includes(knot.input), 'each curve input point is displayed');
            assert.ok(statText.includes(knot.output), 'each curve source output is displayed');
          }
        }
      }
      const displayedSegmentCount = mark.source.displayedAttacks.reduce((sum, attack) => sum + attack.segments.length, 0);
      assert.equal(await sourceDetails.locator('.shared-displayed-attack-segment').count(), displayedSegmentCount,
        'every source displayed-attack segment is presented');
      for (const attack of mark.source.displayedAttacks) {
        const mode = attack.mode === 'light' ? '輕攻擊' : attack.mode === 'heavy' ? '重攻擊' : null;
        for (const segment of attack.segments) {
          assert.ok(sourceText.includes(`${mode}第 ${segment.index} 段`));
          if (segment.targetRole === 'single-target') assert.ok(sourceText.includes('單一目標'));
          if (segment.targetRole === 'multi-target-cleave') assert.ok(sourceText.includes('多目標劈砍'));
          assert.ok(sourceText.includes(segment.attackType), 'the source attack type remains visible as a source token');
        }
      }
      assert.equal(await sourceDetails.locator('.shared-action-continuation').count(), mark.source.actionContinuations.length,
        'every source action continuation and condition is presented');
      const displayedContinuations = await sourceDetails.locator('.shared-action-continuation').evaluateAll(rows => rows.map(row => ({
        fromAction: row.querySelector('code.shared-action-from')?.textContent,
        toAction: row.querySelector('code.shared-action-to')?.textContent,
        inputKey: row.querySelector('code.shared-action-input')?.textContent,
        text: row.innerText,
      })));
      for (const continuation of mark.source.actionContinuations) {
        const rendered = displayedContinuations.find(row => row.fromAction === continuation.fromAction
          && row.toAction === continuation.toAction && row.inputKey === continuation.inputKey);
        assert.ok(rendered, `action continuation keeps from/to/input identity: ${continuation.fromAction} → ${continuation.toAction}`);
        for (const condition of continuation.conditions ?? []) {
          if (condition.fieldPath.endsWith('.chain_time')) assert.ok(rendered.text.includes(`連段時間 ${condition.rawValue} 秒`));
          if (condition.fieldPath.endsWith('.chain_until')) assert.ok(rendered.text.includes(`連段窗口 ${condition.rawValue} 秒`));
        }
      }
      const displayedProfiles = await sourceDetails.locator('.shared-source-profile').evaluateAll(articles => articles.map(article => ({
        profile: article.querySelector('code.shared-attack-profile-key')?.textContent,
        action: article.querySelector('code.shared-attack-action')?.textContent,
        entries: [...article.querySelectorAll('.shared-attack-profile-entry')].map(row => ({
          fromAction: row.querySelector('code.shared-action-from')?.textContent,
          toAction: row.querySelector('code.shared-action-to')?.textContent,
          inputKey: row.querySelector('code.shared-action-input')?.textContent,
          text: row.innerText,
        })),
        branches: [...article.querySelectorAll('.shared-attack-profile-branch')].map(row => ({
          branch: row.querySelector('code.shared-branch-key')?.textContent,
          rawValue: row.querySelector('code.shared-branch-value')?.textContent,
          profileRef: row.querySelector('code.shared-branch-profile-ref')?.textContent,
        })),
      })));
      for (const profile of mark.attackProfiles) {
        const rendered = displayedProfiles.find(row => row.profile === profile.recordId && row.action === profile.payload.action);
        assert.ok(rendered, `attack profile keeps its own ID and action: ${profile.recordId}`);
        for (const entry of profile.payload.actionResolution?.entryBindings ?? []) {
          assert.ok(rendered.entries.some(row => row.fromAction === entry.fromAction && row.toAction === entry.toAction
            && row.inputKey === entry.inputKey), `profile entry keeps its action route and input: ${entry.fromAction} → ${entry.toAction}`);
        }
        for (const branch of profile.payload.actionResolution?.branchBindings ?? []) {
          assert.ok(rendered.branches.some(row => row.branch === branch.branch && row.rawValue === branch.rawValue
            && row.profileRef === branch.profileRef?.recordId), `profile branch keeps its value and target: ${branch.rawValue}`);
        }
      }
      const otherMark = markViews.find(candidate => candidate.markId !== mark.markId);
      await page.getByRole('link', { name: otherMark.markLabel }).focus();
      await page.keyboard.press('Enter');
      await page.locator('.shared-stat-list').first().waitFor({ state: 'visible' });
      assert.equal(await page.locator('main h1').innerText(), otherMark.name, 'keyboard mark navigation switches the complete mark view');
      const otherValue = otherMark.statSections[0].claims[0].payload.displayValue?.decimal;
      assert.ok(await page.locator('.shared-stat-list').allInnerTexts().then(rows => rows.join('\n').includes(otherValue)), 'keyboard navigation switches to the other mark values');
      await page.goto(routeFor(hosted.origin, `/weapons/?family=${encodeURIComponent(mark.familyId)}&mark=unknown-mark`));
      await page.locator('.shared-failure').waitFor({ state: 'visible' });
      assert.match(await page.locator('.shared-failure').innerText(), /武器型號/u);
      assert.match(await page.title(), /型號.*確認/u, 'unknown mark has current Traditional Chinese metadata');
    }
    const searchUrl = routeFor(hosted.origin, `/skills/?q=${encodeURIComponent(skill.name)}`);
    await page.goto(searchUrl);
    await page.locator('.shared-search-label input').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.shared-entry:visible').count(), 1, 'initial search query is applied before interaction');
    assert.equal(new URL(await page.locator('link[rel="canonical"]').getAttribute('href')).search, '', 'pure search query is excluded from canonical URL');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(routeFor(hosted.origin, `/weapons/?family=${encodeURIComponent(markViews[1].familyId)}&mark=${encodeURIComponent(markViews[1].markId)}`));
    await page.locator('.shared-official-text').waitFor({ state: 'visible' });
    const mobileSourceDetails = page.locator('details.shared-source-details');
    await mobileSourceDetails.locator('summary').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'long source action/profile tokens remain inside the mobile viewport when expanded');
    await mobileSourceDetails.locator('summary').click();
    await page.screenshot({ path: path.join(TASK_ROOT, 'phase2-web-mobile.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile layout must not overflow horizontally');

    // Integrity failure 1: the exact manifest URL returns altered but syntactically valid bytes.
    const manifestPath = packageInput.bundle.selected.manifest_path;
    const originalManifest = packageInput.manifestBytes;
    await page.route(`**${manifestPath}`, route => route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: Buffer.concat([originalManifest, Buffer.from(' ')]) }));
    await page.goto(hosted.origin, { waitUntil: 'domcontentloaded' });
    await page.locator('.shared-failure').waitFor({ state: 'visible' });
    assert.equal((await page.locator('body').innerText()).includes('演示防護'), false);
    await page.unroute(`**${manifestPath}`);

    // Integrity failure 2: a same-length domain mutation retains valid JSON but violates the manifest digest.
    const skillRow = packageInput.manifest.files.find(row => row.kind === 'skills');
    const skillUrl = `/data/${packageInput.manifest.dataRevision}/${skillRow.path}`;
    const skillBytes = packageInput.domainBytes.get(skillRow.path);
    const changedSkill = Buffer.from(skillBytes.toString('utf8').replace('w08-shared-domain/1.0.0', 'w08-shared-domain/1.0.1'));
    await page.route(`**${skillUrl}`, route => route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: changedSkill }));
    await page.goto(hosted.origin, { waitUntil: 'domcontentloaded' });
    await page.locator('.shared-failure').waitFor({ state: 'visible' });
    assert.equal((await page.locator('body').innerText()).includes('演示防護'), false);
    await page.unroute(`**${skillUrl}`);

    // Schema failure 3: a correctly re-sealed package with an English-only presentation is rejected by the same consumer.
    await closeServer(server);
    server = null;
    const invalidPackage = await candidateBundle(candidateDir, { invalidSkillLocale: true });
    await build(root, invalidPackage.bundle);
    const invalidHosted = await listen(path.join(root, 'dist'));
    server = invalidHosted.server;
    await page.goto(invalidHosted.origin, { waitUntil: 'domcontentloaded' });
    await page.locator('.shared-failure').waitFor({ state: 'visible' });
    assert.match(await page.locator('.shared-failure').innerText(), /繁體中文|驗證/u);
    assert.equal((await page.locator('body').innerText()).includes('演示防護'), false);

    for (const [filePath, expectedHash] of packageInput.originalHashes) {
      const bytes = await readFile(path.join(candidateDir, ...filePath.split('/')));
      assert.equal(sha256(bytes), expectedHash, `${filePath} input bytes remain unchanged`);
    }
    await context.close();
  } finally {
    await browser?.close();
    await closeServer(server);
    await disposeBuildRoot(root);
  }
});
