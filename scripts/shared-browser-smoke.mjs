import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { DOMAIN_KINDS, validateManifest } from './content/contract-release.mjs';
import { FIXED_HISTORY_SOURCE } from './content/contract-w14-history.mjs';
import { hashNamedFiles } from '../src/static/common.mjs';
import { createSharedViewModel } from '../web/shared-view.mjs';
import { revisionAssetUrl, validateCatalog, validateTalentTree } from '../web/client.mjs';
import { createStaticServer } from './serve.mjs';

const CORE_KINDS = ['skills', 'blessings', 'weapons', 'terms'];
const RETAINED_TREE_ARCHETYPES = ['arbites', 'ogryn', 'psyker', 'scum', 'skitarii', 'veteran', 'zealot'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function assertExactRequestedPaths(requestedPaths, expectedPaths) {
  assert.deepEqual([...requestedPaths].sort(), [...expectedPaths].sort(),
    'the app loads exactly the pinned manifest, core domains, announcements, and manifest-declared game-changes index without legacy data files');
}

export function assertExactDataRequestPaths(requestedPaths, currentPaths, retainedPaths) {
  const expectedPaths = [...new Set([...currentPaths, ...retainedPaths])];
  assert.deepEqual([...requestedPaths].sort(), expectedPaths.sort(),
    'the app loads exactly the current pinned data files plus the fixed retained catalog, trees, and assets');
}

function parseJson(bytes, label) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (error) { throw new Error(`${label} is not valid UTF-8`, { cause: error }); }
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`${label} is not valid JSON`, { cause: error }); }
}

function expectedSectionRows(sections) {
  return sections.filter(section => section.items?.length).flatMap(section => section.items.map(item =>
    Array.isArray(item.parts) ? item.parts.map(part => part.text ?? part.value ?? '').join('') : item.text ?? ''));
}

async function readVerifiedRetainedTreeData(distPath, verification) {
  const dataRevision = verification.runtime_data_revision;
  assert.equal(dataRevision, FIXED_HISTORY_SOURCE.staticBackup.dataRevision,
    'shared smoke requires the exact pinned retained 1.13.1 static data revision');
  assert.equal(verification.runtime_package_kind, FIXED_HISTORY_SOURCE.packageKind,
    'retained talent tree data must come from the pinned published package');
  const dataRoot = path.join(distPath, 'data', dataRevision);
  const files = new Map();
  async function collect(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const filePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`retained data package contains a link: ${name}`);
      if (entry.isDirectory()) await collect(filePath, name);
      else if (entry.isFile()) files.set(name, await readFile(filePath));
      else throw new Error(`retained data package contains a non-regular entry: ${name}`);
    }
  }
  await collect(dataRoot);
  assert.equal(hashNamedFiles(files), dataRevision,
    'retained static data file names and bytes match the exact revision pin');
  const catalog = parseJson(files.get('catalog.json'), 'Retained skill catalog');
  validateCatalog(catalog, {
    schema_version: 2,
    game_version: FIXED_HISTORY_SOURCE.gameVersion,
    package_kind: FIXED_HISTORY_SOURCE.packageKind,
    data_revision: dataRevision,
    build_id: verification.build_id,
  });
  const treeMetadata = catalog.talent_trees ?? [];
  assert.deepEqual(treeMetadata.map(row => row.archetype).sort(), [...RETAINED_TREE_ARCHETYPES].sort(),
    'the retained catalog declares exactly the seven expected tree archetypes');

  const prefix = `/data/${dataRevision}/`;
  const requestedPaths = new Set([`${prefix}catalog.json`]);
  for (const metadata of treeMetadata) {
    const tree = validateTalentTree(
      parseJson(files.get(metadata.tree_path), `Retained tree ${metadata.archetype}`), metadata, catalog,
    );
    requestedPaths.add(`${prefix}${metadata.tree_path}`);
    const details = new Map(tree.details.map(detail => [detail.record.skill_id, detail]));
    for (const node of tree.nodes) {
      const asset = details.get(node.skill_id)?.assets?.[0];
      if (!asset || asset.path === null) continue;
      const requestPath = revisionAssetUrl(dataRevision, asset.path);
      assert.ok(files.has(asset.path.replace(/^\//u, '')),
        `tree ${metadata.archetype} references an asset in its fixed data revision`);
      requestedPaths.add(requestPath);
    }
  }
  return { requestedPaths: [...requestedPaths].sort(), catalog, files, dataRevision };
}

export async function readVerifiedCoreDomains(distPath, verification) {
  assert.equal(typeof verification.shared_data_revision, 'string', 'shared smoke requires verified shared metadata');
  const pointers = verification.game_releases.filter(row => row.game_version === verification.shared_game_version
    && row.data_revision === verification.shared_data_revision);
  assert.equal(pointers.length, 1, 'verified shared artifact must have one exact current release pointer');
  const pointer = pointers[0];
  assert.equal(pointer.manifest_path, `/data/${verification.shared_data_revision}/manifest.json`);
  const manifestPath = path.join(distPath, ...pointer.manifest_path.slice(1).split('/'));
  const manifestBytes = await readFile(manifestPath);
  assert.equal(sha256(manifestBytes), pointer.manifest_sha256, 'published manifest retains the exact version pointer digest');
  const manifest = parseJson(manifestBytes, 'Shared manifest');
  assert.ok(Array.isArray(manifest.files), 'verified shared manifest lists its domain files');
  for (const row of manifest.files) {
    assert.ok(row && DOMAIN_KINDS.includes(row.kind), `shared manifest contains unsupported domain kind: ${row?.kind}`);
  }
  for (const kind of CORE_KINDS) {
    assert.equal(manifest.files.filter(row => row.kind === kind).length, 1,
      `verified shared manifest has one ${kind} core file`);
  }
  const announcementRows = manifest.files.filter(row => row.kind === 'announcements');
  assert.ok(announcementRows.length <= 1, 'verified shared manifest contains multiple announcements domains');
  validateManifest(manifest);
  assert.equal(manifest.dataRevision, verification.shared_data_revision);
  assert.equal(manifest.gameVersion, verification.shared_game_version);

  const domains = [];
  const requestedPaths = [pointer.manifest_path];
  const selectedRows = CORE_KINDS.map(kind => manifest.files.find(file => file.kind === kind));
  if (announcementRows.length) selectedRows.push(announcementRows[0]);
  if (manifest.changeIndexPath !== null) {
    const changeIndex = manifest.files.find(file => file.path === manifest.changeIndexPath);
    assert.ok(changeIndex, 'verified shared manifest changeIndexPath names a listed file');
    assert.equal(changeIndex.kind, 'game-changes', 'verified shared manifest changeIndexPath names a game-changes file');
    selectedRows.push(changeIndex);
  }
  for (const row of selectedRows) {
    const { kind } = row;
    const urlPath = `/data/${manifest.dataRevision}/${row.path}`;
    const pins = verification.shared_files.filter(file => file.path === urlPath);
    assert.equal(pins.length, 1, `static artifact has one exact pin for ${urlPath}`);
    const [pinned] = pins;
    assert.ok(pinned, `static artifact pins ${urlPath}`);
    assert.equal(pinned.sha256, row.sha256, `${kind} pinned digest matches the manifest`);
    assert.equal(pinned.size_bytes, row.sizeBytes, `${kind} pinned size matches the manifest`);
    const fileBytes = await readFile(path.join(distPath, ...urlPath.slice(1).split('/')));
    assert.equal(fileBytes.byteLength, row.sizeBytes, `${kind} raw byte length matches the manifest`);
    assert.equal(sha256(fileBytes), row.sha256, `${kind} raw digest matches the manifest`);
    const domain = parseJson(fileBytes, `Shared ${kind} domain`);
    assert.equal(domain.kind, kind);
    assert.equal(domain.gameReleaseId, manifest.gameReleaseId);
    domains.push(domain);
    requestedPaths.push(urlPath);
  }
  return {
    pointer,
    manifest,
    domains,
    requestedPaths: requestedPaths.sort(),
    view: createSharedViewModel({ domains, gameReleaseId: manifest.gameReleaseId, fixtureOnly: verification.package_kind === 'fixture' }),
  };
}

function selectSkill(domains, view) {
  const domain = domains.find(row => row.kind === 'skills');
  for (const presentation of domain.web.presentations ?? []) {
    if (presentation.locale !== 'zh-TW' || presentation.entityRef?.kind !== 'skill') continue;
    const result = view.getSkill(presentation.entityRef);
    if (result.status === 'ready' && result.sections.some(section => section.items?.length)) {
      return { presentation, result };
    }
  }
  throw new Error('verified shared package has no readable Traditional Chinese skill with detail sections');
}

function selectBlessing(domains, view) {
  const domain = domains.find(row => row.kind === 'blessings');
  for (const presentation of domain.web.presentations ?? []) {
    if (presentation.locale !== 'zh-TW' || presentation.entityRef?.kind !== 'blessing') continue;
    for (const applicability of presentation.tierApplicability ?? []) {
      if (![1, 2, 3, 4].every(tier => applicability.tiers?.includes(tier))) continue;
      const views = [1, 2, 3, 4].map(tier => view.getBlessing({
        blessingRef: presentation.entityRef,
        variantRef: applicability.variantRef,
        tier,
      }));
      if (views.every(item => item.status === 'ready')) return { presentation, applicability, views };
    }
  }
  throw new Error('verified shared package has no exact blessing variant with all four readable tiers');
}

function selectWeapon(domains, view, retained = null) {
  const domain = domains.find(row => row.kind === 'weapons');
  const records = domain.source.records.filter(row => row.kind === 'weapon' && row.gameReleaseId === domain.gameReleaseId);
  const familyIds = [...new Set(records.map(row => row.payload?.familyId).filter(value => typeof value === 'string'))];
  const retainedFamilyHasBlessings = familyId => {
    const entry = retained?.catalog?.entries.find(row => row.kind === 'weapon' && row.id === familyId);
    if (!entry) return false;
    const bytes = retained.files.get(entry.detail_path);
    if (!bytes) throw new Error(`retained family detail is missing from pinned revision: ${entry.detail_path}`);
    const detail = parseJson(bytes, `Retained family detail ${entry.id}`);
    return (detail.relations ?? []).some(relation => relation.kind === 'blessing');
  };
  for (const familyId of familyIds) {
    const family = view.getWeaponFamily(familyId);
    if (family.status === 'ready' && family.marks.length >= 2
      && retainedFamilyHasBlessings(familyId)
      && family.marks.slice(0, 2).every(mark => mark.statSections.some(section => section.claims.some(claim =>
        claim.payload?.displayValue?.status === 'known' || claim.payload?.value?.status === 'known')
        && mark.source.displayedAttacks?.some(attack => attack.segments?.length)
        && mark.source.actionContinuations?.length))) {
      return { familyId, marks: family.marks.slice(0, 2) };
    }
  }
  for (const familyId of familyIds) {
    const family = view.getWeaponFamily(familyId);
    if (family.status === 'ready' && family.marks.length >= 2
      && family.marks.slice(0, 2).every(mark => mark.statSections.some(section => section.claims.some(claim =>
        claim.payload?.displayValue?.status === 'known' || claim.payload?.value?.status === 'known')
        && mark.source.displayedAttacks?.some(attack => attack.segments?.length)
        && mark.source.actionContinuations?.length))) {
      return { familyId, marks: family.marks.slice(0, 2) };
    }
  }
  throw new Error('verified shared package has no readable weapon family with two marks and source values');
}

async function assertSections(page, sections) {
  const available = sections.filter(section => section.items?.length);
  const headings = await page.locator('.shared-detail-sections .shared-detail-section > h3').allTextContents();
  assert.deepEqual(headings, available.map(section => section.heading));
  const rows = await page.locator('.shared-detail-section-list .shared-detail-list > li').allTextContents();
  assert.deepEqual(rows, expectedSectionRows(sections), 'all displayed section rows match the verified consumer model');
}

async function waitForRenderedText(page, selector, expected, label) {
  try {
    await page.waitForFunction(({ query, text }) => document.querySelector(query)?.textContent === text,
      { query: selector, text: expected });
  } catch (error) {
    const actual = await page.locator(selector).allTextContents();
    throw new Error(`${label} did not render expected text at ${page.url()}; found ${JSON.stringify(actual)}`, { cause: error });
  }
}

function knownValue(claim) {
  if (claim.payload?.displayValue?.status === 'known') return claim.payload.displayValue;
  if (claim.payload?.value?.status === 'known') return claim.payload.value;
  return null;
}

async function assertWeaponView(page, mark) {
  await waitForRenderedText(page, '.shared-tab-list[aria-label="武器型號"] a[aria-current="page"]',
    mark.markLabel, 'selected weapon mark');
  await page.locator('.shared-stat-list').first().waitFor({ state: 'visible' });
  assert.equal(await page.locator('main h1').textContent(), mark.name);
  assert.equal(await page.locator('.shared-tab-list[aria-label="武器型號"] a[aria-current="page"]').textContent(), mark.markLabel);
  const lists = page.locator('.shared-stat-list');
  assert.equal(await lists.count(), mark.statSections.length);
  for (const [index, section] of mark.statSections.entries()) {
    const values = await lists.nth(index).locator('dd').allTextContents();
    for (const claim of section.claims) {
      const value = knownValue(claim);
      if (value?.decimal) assert.ok(values.some(text => text.includes(value.decimal)), `weapon claim ${claim.recordId} matches its Source value`);
    }
    for (const curve of section.curves) {
      for (const knot of curve.payload?.knots ?? []) {
        assert.ok(values.some(text => text.includes(knot.output)), `weapon curve output ${knot.output} is displayed`);
      }
    }
  }
  const official = page.locator('.shared-official-text');
  assert.equal(await official.textContent(), mark.official.resolvedText);
  assert.equal(await page.locator('.shared-erratum').count(), mark.errata.length);
  await assertSections(page, mark.sections);

  const details = page.locator('details.shared-source-details');
  assert.equal(await details.count(), 1, 'the selected mark exposes its verified source profile and attack details');
  if (!(await details.evaluate(node => node.open))) await details.locator('summary').click();
  const sourceText = await details.innerText();
  const expectedSegmentCount = (mark.source.displayedAttacks ?? []).reduce((sum, attack) => sum + (attack.segments?.length ?? 0), 0);
  assert.equal(await details.locator('.shared-displayed-attack-segment').count(), expectedSegmentCount);
  for (const attack of mark.source.displayedAttacks ?? []) {
    const mode = attack.mode === 'light' ? '輕攻擊' : attack.mode === 'heavy' ? '重攻擊' : null;
    for (const segment of attack.segments ?? []) {
      assert.ok(sourceText.includes(`${mode ?? '來源攻擊'}第 ${segment.index} 段`));
      if (segment.attackType) assert.ok(sourceText.includes(segment.attackType));
    }
  }
  const displayedContinuations = await details.locator('.shared-action-continuation').evaluateAll(rows => rows.map(row => ({
    fromAction: row.querySelector('code.shared-action-from')?.textContent,
    toAction: row.querySelector('code.shared-action-to')?.textContent,
    inputKey: row.querySelector('code.shared-action-input')?.textContent,
    text: row.innerText,
  })));
  assert.equal(displayedContinuations.length, mark.source.actionContinuations.length);
  for (const continuation of mark.source.actionContinuations ?? []) {
    assert.ok(displayedContinuations.some(row => row.fromAction === continuation.fromAction
      && row.toAction === continuation.toAction && row.inputKey === continuation.inputKey),
    'action continuation keeps its exact source, destination, and input route');
    for (const condition of continuation.conditions ?? []) {
      if (condition.fieldPath.endsWith('.chain_time')) assert.ok(sourceText.includes(`連段時間 ${condition.rawValue} 秒`));
      if (condition.fieldPath.endsWith('.chain_until')) assert.ok(sourceText.includes(`連段窗口 ${condition.rawValue} 秒`));
    }
  }
}

export async function runSharedBrowserSmoke(distPath, verification) {
  const shared = await readVerifiedCoreDomains(distPath, verification);
  const retained = await readVerifiedRetainedTreeData(distPath, verification);
  const skill = selectSkill(shared.domains, shared.view);
  const blessing = selectBlessing(shared.domains, shared.view);
  const weapon = selectWeapon(shared.domains, shared.view, retained);
  const expectedRetainedPaths = new Set(retained.requestedPaths);
  const retainedPrefix = `/data/${retained.dataRevision}/`;
  const addRetainedDetail = entry => {
    assert.ok(entry && retained.files.has(entry.detail_path), `fixed retained catalog declares detail ${entry?.detail_path}`);
    expectedRetainedPaths.add(`${retainedPrefix}${entry.detail_path}`);
  };

  let server;
  let browser;
  try {
    server = await createStaticServer({ distPath });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'shared smoke server did not bind an ephemeral TCP port');
    const origin = `http://127.0.0.1:${address.port}`;
    const launchOptions = { headless: true };
    if (process.env.SYP_W10_CHROMIUM_EXE) launchOptions.executablePath = process.env.SYP_W10_CHROMIUM_EXE;
    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    const pageErrors = [];
    const dataFailures = [];
    const requestedPaths = new Set();
    const requestedDataPaths = new Set();
    const historyFailures = [];
    const requestedHistoryPaths = new Set();
    const localOrigin = new URL(origin).origin;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === localOrigin && url.pathname.startsWith('/data/')) {
        requestedDataPaths.add(url.pathname);
        if (url.pathname.startsWith(`/data/${shared.pointer.data_revision}/`)) requestedPaths.add(url.pathname);
      }
      if (url.origin === localOrigin && url.pathname.startsWith('/history/1.13.1/')) requestedHistoryPaths.add(url.pathname);
    });
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === localOrigin && url.pathname.startsWith('/data/') && response.status() >= 400) {
        dataFailures.push(`${url.pathname} returned ${response.status()}`);
      }
      if (url.origin === localOrigin && url.pathname.startsWith('/history/1.13.1/') && response.status() >= 400) {
        historyFailures.push(`${url.pathname} returned ${response.status()}`);
      }
    });

    const skillPath = `/skills/?id=${encodeURIComponent(skill.presentation.entityRef.recordId)}`;
    await page.goto(new URL(skillPath, origin).href, { waitUntil: 'domcontentloaded' });
    await page.locator('.shared-official-text').waitFor({ state: 'visible' });
    assert.equal(await page.locator('main h1').textContent(), skill.result.name);
    assert.equal(await page.locator('.shared-official-text').textContent(), skill.result.official.resolvedText);
    assert.equal(await page.locator('.shared-erratum').count(), skill.result.errata.length);
    await assertSections(page, skill.result.sections);
    assert.ok((await page.locator('#build-meta').textContent()).includes(shared.pointer.game_version));
    assert.ok((await page.locator('#build-meta').textContent()).includes(shared.pointer.data_revision.slice(0, 12)));

    await page.goto(new URL('/skills/', origin).href, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '技能與天賦', exact: true }).waitFor({ state: 'visible' });
    await page.locator('.shared-talent-tree-links').waitFor({ state: 'visible' });
    await page.locator('.shared-entry:visible').first().waitFor({ state: 'visible' });
    const currentSkillCount = shared.domains.find(domain => domain.kind === 'skills').web.presentations
      .filter(row => row.locale === 'zh-TW' && row.entityRef?.kind === 'skill').length;
    assert.equal(await page.locator('.shared-entry:visible').count(), 645 + currentSkillCount - 1,
      'the true current Brain Burst identity merges into the verified retained skill list');
    assert.equal(await page.locator('select[name="version"]').count(), 0,
      'skill search has one list without a current/history version filter');
    assert.equal(await page.locator('.shared-skill-version').count(), 0,
      'unverified retained skills have no blanket historical badge');
    assert.equal(await page.locator('.shared-entry[data-skill-id="darktide:skill:psyker:brain-burst-improved"]').count(), 1,
      'the evidence-backed current/legacy identity appears once');
    assert.equal(await page.locator('.shared-entry a[href="/skills/arbites/adamant_ammo_belt/"]').count(), 1,
      'old-only results use their canonical detail route');
    assert.match(await page.locator('.shared-skill-version-note').textContent(), /已驗證的 1\.13\.1 索引.*已逐項核對/u);
    const visibleTreeLinks = page.locator('.shared-talent-tree-links a');
    assert.deepEqual(await visibleTreeLinks.evaluateAll(links => links.map(link => link.getAttribute('href')).sort()), [
      '/skills/arbites/?view=tree', '/skills/ogryn/?view=tree', '/skills/psyker/?view=tree',
      '/skills/scum/?view=tree', '/skills/skitarii/?view=tree', '/skills/veteran/?view=tree',
      '/skills/zealot/?view=tree',
    ], 'the skill directory exposes all seven retained tree routes');
    await page.locator('.shared-talent-tree-links a[href="/skills/psyker/?view=tree"]').click();
    await page.waitForURL(url => url.pathname === '/skills/psyker/' && url.searchParams.get('view') === 'tree');
    await page.locator('.tree-layout').waitFor({ state: 'visible' });
    await page.goBack();
    await page.waitForURL(url => url.pathname === '/skills/');
    await page.locator('.shared-talent-tree-links a').first().waitFor({ state: 'visible' });

    for (const archetype of ['arbites', 'scum', 'skitarii', 'ogryn', 'psyker', 'veteran', 'zealot']) {
      await page.goto(new URL(`/skills/${archetype}/?view=tree`, origin).href, { waitUntil: 'domcontentloaded' });
      await page.locator('.tree-layout').waitFor({ state: 'visible' });
      assert.ok((await page.locator('#build-meta').innerText()).includes(`遊戲版本 ${shared.pointer.game_version}`));
      assert.match(await page.locator('#build-meta').innerText(), /資料基準 1\.13\.1/u);
    }

    await page.goto(new URL('/weapons/', origin).href, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '武器', exact: true }).waitFor({ state: 'visible' });
    await page.locator('.shared-history-catalog[data-catalog-revision]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-retained-weapon-id]').count(), 70,
      'the unified weapons directory includes every retained family, including identities without a Traditional Chinese name');
    assert.equal(await page.locator('[data-retained-mark-id]').count(), 135,
      'the unified weapons directory retains every model identity');

    await page.goto(new URL('/blessings/', origin).href, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '祝福', exact: true }).waitFor({ state: 'visible' });
    await page.locator('.shared-history-catalog[data-catalog-revision]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-retained-blessing-id]').count(), 167,
      'the unified blessing directory includes all retained blessings');
    assert.equal(await page.locator('[data-retained-variant-id]').count(), 605,
      'the unified blessing directory links all retained variant details');

    const blessingPath = `/blessings/?id=${encodeURIComponent(blessing.presentation.entityRef.recordId)}&variant=${encodeURIComponent(blessing.applicability.variantRef.recordId)}`;
    await page.goto(new URL(blessingPath, origin).href, { waitUntil: 'domcontentloaded' });
    await page.locator('.shared-official-text').waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('link', { name: 'LV4', exact: true }).getAttribute('aria-current'), 'page',
      'the verified four-tier variant opens at its existing LV4 view');
    assert.match(await page.locator('.shared-applicability').textContent(), /尚未驗證/u,
      'unverified weapon applicability remains explicit');
    for (const tier of [1, 2, 3, 4]) {
      const expected = blessing.views[tier - 1];
      const link = page.getByRole('link', { name: `LV${tier}`, exact: true });
      await link.click();
      await waitForRenderedText(page, '.shared-official-text', expected.official.resolvedText, `blessing LV${tier}`);
      assert.equal(await page.locator('main h1').textContent(), expected.name);
      assert.equal(await page.locator('.shared-official-text').textContent(), expected.official.resolvedText);
      assert.equal(await link.getAttribute('aria-current'), 'page');
      await assertSections(page, expected.sections);
    }

    const retainedBlessing = retained.catalog.entries.find(row => row.kind === 'blessing' && row.id === 'rev-it-up');
    assert.ok(retainedBlessing, 'the fixed retained catalog contains the selected retained blessing');
    addRetainedDetail(retainedBlessing);
    const retainedBlessingDetail = parseJson(retained.files.get(retainedBlessing.detail_path), 'Retained blessing detail');
    for (const variantId of retainedBlessingDetail.record.variant_ids) {
      const entry = retained.catalog.entries.find(row => row.kind === 'variant' && row.id === variantId);
      addRetainedDetail(entry);
    }
    await page.goto(new URL('/blessings/rev-it-up/', origin).href, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '提速', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.blessing-levels').count(), 1,
      'the retained blessing detail loads its exact pinned tier shards');
    assert.equal(await page.locator('.relation-list a[href^="/weapons/"]').count(), 3,
      'retained blessing applicability links remain available to weapon families and models');

    const firstMark = weapon.marks[0];
    const weaponPath = `/weapons/?family=${encodeURIComponent(weapon.familyId)}&mark=${encodeURIComponent(firstMark.markId)}`;
    await page.goto(new URL(weaponPath, origin).href, { waitUntil: 'domcontentloaded' });
    await assertWeaponView(page, firstMark);
    const retainedFamily = retained.catalog.entries.find(row => row.kind === 'weapon' && row.id === weapon.familyId);
    if (retainedFamily) {
      addRetainedDetail(retainedFamily);
      const retainedFamilyDetail = parseJson(retained.files.get(retainedFamily.detail_path), 'Retained weapon family detail');
      const expectedBlessingRelations = [...new Map((retainedFamilyDetail.relations ?? [])
        .filter(relation => relation.kind === 'blessing').map(relation => [relation.id, relation])).values()];
      if (expectedBlessingRelations.length) {
        await page.locator('.shared-retained-weapon-blessings').waitFor({ state: 'visible' });
        const renderedRelations = await page.locator('.shared-retained-weapon-blessings a').evaluateAll(links =>
          links.map(link => ({ href: link.getAttribute('href'), id: link.closest('[data-retained-blessing-id]')?.dataset.retainedBlessingId })));
        assert.deepEqual(renderedRelations, expectedBlessingRelations.map(relation => ({ href: relation.route, id: relation.id })),
          'the current family detail links every exact blessing relation from its pinned retained family shard');
      }
    }
    const nextMark = weapon.marks[1];
    await page.getByRole('link', { name: nextMark.markLabel, exact: true }).click();
    await assertWeaponView(page, nextMark);
    const refresh = await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(refresh?.status(), 200, 'the selected shared mark survives a direct browser refresh');
    await assertWeaponView(page, nextMark);
    await page.setViewportSize({ width: 390, height: 844 });
    const sourceDetails = page.locator('details.shared-source-details');
    if (!(await sourceDetails.evaluate(node => node.open))) await sourceDetails.locator('summary').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'expanded source details fit the mobile viewport');

    const expectedPaths = [...shared.requestedPaths].sort();
    assertExactRequestedPaths(requestedPaths, expectedPaths);
    assertExactDataRequestPaths(requestedDataPaths, expectedPaths, [...expectedRetainedPaths]);
    assert.deepEqual([...requestedHistoryPaths].sort(), [
      '/history/1.13.1/manifest.json', '/history/1.13.1/player-index.json',
    ], 'the searchable history list requests exactly the existing fixed manifest and player index');
    assert.deepEqual(historyFailures, [], 'the verified historical package has no failed same-origin requests');
    assert.deepEqual(dataFailures, [], 'the valid shared artifact has no failed same-origin data requests');
    assert.deepEqual(pageErrors, [], 'valid shared pages have no uncaught browser errors');

    const failedPage = await context.newPage();
    const manifestRoute = `**${shared.pointer.manifest_path}`;
    await failedPage.route(manifestRoute, route => route.abort('internetdisconnected'), { times: 1 });
    await failedPage.goto(new URL('/skills/', origin).href, { waitUntil: 'domcontentloaded' });
    await failedPage.locator('.shared-skill-current-unavailable').waitFor({ state: 'visible' });
    assert.equal(await failedPage.locator('.shared-entry:visible').count(), 645,
      'the fixed verified index remains searchable when current shared data is unavailable');
    assert.equal(await failedPage.locator('.shared-failure').count(), 0,
      'the retained skill list remains independent of the current shared release');
    await failedPage.close();

    process.stdout.write(
      `Shared browser smoke passed: ${shared.pointer.game_version} / ${shared.pointer.data_revision.slice(0, 12)}, ` +
      'four exact core-domain bytes, any pinned announcements bytes, the declared game-changes index when present, unified skills/weapons/blessings directories, seven retained talent trees, exact retained weapon/blessing relation shards, skill sections, blessing LV1–LV4, two weapon marks/source values and continuations, ' +
      'direct refresh, 390px layout, and independent current/legacy failure behavior.\n'
    );
  } finally {
    if (browser) await browser.close();
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
