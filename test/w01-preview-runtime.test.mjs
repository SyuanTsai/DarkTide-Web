import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import { buildW01 } from '../scripts/w01-build.mjs';
import { jsonBytes } from '../src/static/common.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
let runtimeImportId = 0;
const tierVariantId = 'darktide:blessing-variant:chainaxe:p1-movement-speed-on-activation';
const tierClaimId = tier => 'darktide:claim:chainaxe:p1-movement-speed-on-activation-tier' + tier + '-display-percent';
const tierPercent = tier => String(16 + tier);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function mutatePublishedDomain(outputRoot, kind, mutate) {
  const versionPath = path.join(outputRoot, 'version.json');
  const version = JSON.parse(await readFile(versionPath, 'utf8'));
  const release = version.game_releases[0];
  const manifestPath = path.join(outputRoot, release.manifest_path.slice(1).split('/').join(path.sep));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const file = manifest.files.find(entry => entry.kind === kind);
  assert.ok(file, 'the published package contains its ' + kind + ' domain');
  const domainPath = path.join(outputRoot, new URL(file.path, new URL(release.manifest_path, 'http://w01.test')).pathname.slice(1).split('/').join(path.sep));
  const domain = JSON.parse(await readFile(domainPath, 'utf8'));
  mutate(domain);
  const domainBytes = jsonBytes(domain);
  await writeFile(domainPath, domainBytes);
  file.sha256 = sha256(domainBytes);
  file.sizeBytes = domainBytes.byteLength;
  const manifestBytes = jsonBytes(manifest);
  await writeFile(manifestPath, manifestBytes);
  release.manifest_sha256 = sha256(manifestBytes);
  await writeFile(versionPath, jsonBytes(version));
}

async function copyInputRoot(destination, fixture) {
  const source = fixture ? path.join(repoRoot, 'test', 'fixtures', 'w01') : repoRoot;
  await mkdir(path.join(destination, 'content'), { recursive: true });
  await cp(path.join(source, 'content', 'w01'), path.join(destination, 'content', 'w01'), { recursive: true });
  await cp(path.join(source, 'source.lock.json'), path.join(destination, 'source.lock.json'));
}

function fakeElement(tagName = '') {
  return {
    tagName,
    children: [],
    dataset: {},
    attributes: {},
    listeners: {},
    textContent: '',
    className: '',
    id: '',
    value: '',
    append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); },
    dispatchEvent(event) { for (const listener of this.listeners[event.type] ?? []) listener(event); },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

function renderedText(node) {
  return node.textContent + node.children.map(renderedText).join('');
}

async function runPreviewModule(outputRoot, fetchOverride) {
  const page = new Map();
  const document = {
    createElement: tagName => fakeElement(tagName),
    getElementById(id) {
      if (!page.has(id)) page.set(id, fakeElement());
      return page.get(id);
    }
  };
  const location = { origin: 'http://w01.test' };
  const packageFetch = async input => {
    const url = new URL(input, location.origin);
    const relative = url.pathname.slice(1).split('/').join(path.sep);
    try {
      return new Response(await readFile(path.join(outputRoot, relative)), { status: 200 });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return new Response(new Uint8Array(), { status: 404 });
    }
  };
  const fetch = fetchOverride
    ? (input, init) => fetchOverride(input, init, packageFetch)
    : packageFetch;
  const replacements = new Map();
  const globals = { document, location, fetch, crypto: webcrypto };
  for (const [name, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    replacements.set(name, descriptor);
    Object.defineProperty(globalThis, name, { configurable: true, enumerable: descriptor?.enumerable ?? false, writable: true, value });
  }
  try {
    const source = await readFile(path.join(outputRoot, 'preview.js'), 'utf8') + '\n// runtime import ' + (++runtimeImportId);
    await import('data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64'));
  } finally {
    for (const [name, descriptor] of replacements) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
  page.dispatchWithGlobals = (element, event) => {
    const descriptors = new Map();
    for (const [name, value] of Object.entries(globals)) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, enumerable: descriptors.get(name)?.enumerable ?? false, writable: true, value });
    }
    try {
      element.dispatchEvent(event);
    } finally {
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    }
  };
  return page;
}

async function makeTieredCandidateInput(destination) {
  await copyInputRoot(destination, false);
  const sourceRoot = path.join(destination, 'content', 'w01', 'source');
  const technicalPath = path.join(sourceRoot, 'technical.json');
  const technical = JSON.parse(await readFile(technicalPath, 'utf8'));
  const existingClaims = new Set(technical.records.map(record => record.recordId));
  const tierOne = technical.records.find(record => record.recordId === tierClaimId(1));
  assert.ok(tierOne, 'tier-one claim exists in the pinned source');
  if (![2, 3, 4].every(tier => existingClaims.has(tierClaimId(tier)))) {
    for (const tier of [2, 3, 4]) {
      if (existingClaims.has(tierClaimId(tier))) continue;
      const evidenceId = 'test-only:evidence:chainaxe:tier-' + tier + '-display-percent';
      technical.records.push({
        recordId: evidenceId, owner: 'source', kind: 'evidence', gameReleaseId: tierOne.gameReleaseId,
        payload: { sourceRef: 'public-code:trait-value-parser-ba6c148', safeSummary: 'TEST ONLY: synthetic tier binding evidence.' },
        sourceRefs: ['public-code:chainaxe-p1-traits-ba6c148', 'public-code:trait-value-parser-ba6c148'], reviewState: 'pending'
      });
      technical.records.push({
        ...structuredClone(tierOne),
        recordId: tierClaimId(tier),
        payload: {
          ...structuredClone(tierOne.payload),
          evidenceRefs: [...tierOne.payload.evidenceRefs, evidenceId],
          property: 'description.format_values.movement_speed.defined_tier_' + tier + '_display_percent',
          value: { status: 'known', decimal: tierPercent(tier), unit: 'percent' }
        }
      });
    }
    const technicalBytes = jsonBytes(technical);
    await writeFile(technicalPath, technicalBytes);
    const manifestPath = path.join(sourceRoot, 'source-manifest.json');
    const sourceManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const row = sourceManifest.files.find(file => file.path === 'technical.json');
    row.sha256 = sha256(technicalBytes);
    row.sizeBytes = technicalBytes.byteLength;
    const manifestBytes = jsonBytes(sourceManifest);
    await writeFile(manifestPath, manifestBytes);
    const lockPath = path.join(destination, 'source.lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.manifestSha256 = sha256(manifestBytes);
    await writeFile(lockPath, jsonBytes(lock));
  }

  const authoringPath = path.join(destination, 'content', 'w01', 'web-authoring.json');
  const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
  const presentation = authoring.records.find(record => record.recordId === 'web:presentation:chainaxe-p1-movement-speed');
  const claimFor = tier => tierClaimId(tier);
  const paramsFor = tier => presentation.payload.official.params.map(param => ({
    ...param,
    ...(param.name === 'movement_speed' ? { bindingRef: claimFor(tier) } : {})
  }));
  const sectionsFor = tier => {
    const sections = structuredClone(presentation.payload.detailSections);
    const claimRef = claimFor(tier);
    sections.effects = [{
      itemId: 'chainaxe-tier-display-parameter',
      parts: [
        { kind: 'literal', text: '你的移動速度提高 ' },
        { kind: 'unsigned-percent', bindingRef: claimRef },
        { kind: 'literal', text: '。' }
      ],
      claimRefs: [claimRef]
    }];
    return sections;
  };
  presentation.payload.official.params = paramsFor(4);
  presentation.payload.official.localizations['zh-TW'].params = paramsFor(4);
  presentation.payload.detailSections = sectionsFor(4);
  presentation.payload.tierPresentations = {
    variantRef: tierVariantId,
    defaultTier: 4,
    options: [1, 2, 3, 4].map(tier => ({ tier, params: paramsFor(tier), detailSections: sectionsFor(tier) }))
  };
  await writeFile(authoringPath, jsonBytes(authoring));
}

// Scenario: the real generated runtime loads a legacy fixture with no candidate flag and a native official pending candidate.
// Purpose: keep the optional legacy flag backward-compatible, require the pending flag for candidates, and reject mismatched package flags.
test('UnitT00_runtime-loads-fixture-and-native-candidate-and-rejects-mismatched-flags', async t => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-preview-runtime-'));
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));

  const fixtureRepo = path.join(tempRoot, 'fixture-repo');
  const fixtureOutput = path.join(tempRoot, 'fixture-output');
  await copyInputRoot(fixtureRepo, true);
  await buildW01({ repoRoot: fixtureRepo, outputRoot: fixtureOutput });

  const fixturePage = await runPreviewModule(fixtureOutput);
  assert.equal(fixturePage.get('status').dataset.state, undefined);
  assert.equal(fixturePage.get('status').textContent, '資料已載入，內容仍待審核。');
  const fixturePreview = JSON.parse(await readFile(path.join(fixtureOutput, 'preview.json'), 'utf8'));
  assert.equal(Object.hasOwn(fixturePreview, 'candidatePreviewOnly'), false);
  const fixtureHtml = await readFile(path.join(fixtureOutput, 'index.html'), 'utf8');
  assert.doesNotMatch(fixtureHtml, /名詞說明|terms-heading|terms-content/);
  assert.match(renderedText(fixturePage.get('content')), /合成詞條：只用於驗證共用術語與呈現的連結。/,
    'term references still resolve inline from the verified terms domain');

  const candidateRepo = path.join(tempRoot, 'candidate-repo');
  const candidateOutput = path.join(tempRoot, 'candidate-output');
  await copyInputRoot(candidateRepo, false);
  await buildW01({ repoRoot: candidateRepo, outputRoot: candidateOutput, mode: 'candidate-preview' });

  const candidatePage = await runPreviewModule(candidateOutput);
  assert.equal(candidatePage.get('status').dataset.state, undefined);
  assert.equal(candidatePage.get('status').textContent, '資料已載入，內容仍待審核。');
  assert.equal(candidatePage.get('package-warning').textContent, '說明文字與遊戲版本尚未核對，內容仍待審核。');
  assert.equal(candidatePage.get('content').children.length, 3);
  const candidateText = renderedText(candidatePage.get('content'));
  assert.match(candidateText, /顱腦崩裂/);
  assert.match(candidateText, /以下數值不含其他加成或減免。/);
  assert.match(candidateText, /相較於顱腦爆裂，顱腦崩裂傷害提高 50%（1\.5 倍）；這項加成不適用於所有靈能攻擊。/);
  assert.match(candidateText, /顱腦崩裂蓄力時，你會累積反噬；造成傷害後再增加 25%。/);
  assert.match(candidateText, /先蓄力再鎖定：未鎖定敵人也能蓄力；鎖定後接續蓄力進度。/);
  assert.match(candidateText, /直接鎖定蓄力：先鎖定敵人，再蓄力。/);
  assert.match(candidateText, /鎖定後，移開準星也不會更換目標。/);
  assert.match(candidateText, /你的反噬從 0% 起算，且蓄力不中斷：/);
  assert.match(candidateText, /先蓄力再鎖定：約 3 秒蓄滿；1／2／3 秒時，你的反噬約 6\.67%／13\.33%／20%。/);
  assert.match(candidateText, /直接鎖定蓄力：約 2 秒蓄滿；1／2 秒時，你的反噬約 10%／20%。/);
  assert.match(candidateText, /滿蓄後繼續蓄力，你的反噬每秒約增加 9%。/);
  assert.match(candidateText, /顱腦崩裂蓄滿後立即造成傷害，你的反噬約 45%；多維持 1 秒則約 54%。/);
  assert.match(candidateText, /顱腦崩裂未造成傷害時，你不會再累積 25% 反噬；蓄力時累積的反噬仍保留。/);
  assert.match(candidateText, /以下僅適用於會被顱腦崩裂打出踉蹌的敵人：/);
  assert.match(candidateText, /直接鎖定：鎖定同一敵人超過 1 秒，顱腦崩裂使其輕微踉蹌一次。/);
  assert.match(candidateText, /先蓄力再鎖定：鎖定敵人超過 0\.25 秒，顱腦崩裂使其輕微踉蹌一次。/);
  assert.match(candidateText, /提速/);
  assert.match(candidateText, /你的移動速度提高 20%。/);
  assert.match(candidateText, /Mk IV/);
  assert.match(candidateText, /Mk XII/);
  assert.match(candidateText, /第 1 段・單體/);
  assert.match(candidateText, /第 1 段・群體（順劈）/);
  assert.match(candidateText, /輕攻擊第一個目標攻擊威力60%：113\.00 → 80%：119\.00/);
  assert.match(candidateText, /輕攻擊對防彈護甲的敵人傷害倍率60%：160\.23% → 80%：176\.04%/);
  assert.match(candidateText, /對不屈的敵人傷害倍率/);
  assert.match(candidateText, /衝刺體力消耗60%：0\.97 耐力／秒 → 80%：0\.93 耐力／秒/);
  assert.match(candidateText, /耐力60%：\+4\.00 → 80%：\+4\.00/);
  assert.match(candidateText, /推擊耐力消耗60%：1\.80 耐力 → 80%：1\.40 耐力/);
  assert.match(candidateText, /輕攻擊特殊動作首段鋸擊威力/);
  assert.match(candidateText, /閃避距離修正/);
  assert.match(candidateText, /閃避速度修正60%：\+0\.00% → 80%：\+0\.00%/);
  assert.match(candidateText, /60% 與 80% 是比較點，不代表掉落上下限/);
  assert.match(candidateText, /攻擊威力和鋸擊威力不等於實際扣血/);
  assert.doesNotMatch(candidateText, /已收錄的攻擊數值：80、140。|已收錄的護甲修正值：1\.035、1\.965。|其他攻擊資料尚未補齊。/);
  assert.doesNotMatch(candidateText, /可取得範圍|全域範圍/);
  assert.doesNotMatch(candidateText, /Brain Rupture|Movement Speed/);
  assert.doesNotMatch(candidateText, /Source|claim|point|ratio|Steam Build|SYP-311|W01/);

  const parentByNode = new Map();
  const descendants = (node, parent = null) => {
    if (parent) parentByNode.set(node, parent);
    return [node, ...node.children.flatMap(child => descendants(child, node))];
  };
  const contentNodes = descendants(candidatePage.get('content'));
  const weaponCards = contentNodes.filter(node => node.className === 'card' &&
    descendants(node).some(child => child.className === 'chainaxe-mark-selector'));
  assert.equal(weaponCards.length, 1, 'both marks are presented in one weapon card');
  const weaponCard = weaponCards[0];
  const markButtons = descendants(weaponCard).filter(node => node.className === 'chainaxe-mark-button');
  assert.deepEqual(markButtons.map(renderedText), ['Mk IV', 'Mk XII']);
  assert.deepEqual(markButtons.map(button => button.attributes['aria-pressed']), ['true', 'false']);
  assert.equal(descendants(weaponCard).filter(node => node.tagName === 'h3').length, 1);
  assert.equal((renderedText(weaponCard).match(/突擊鏈斧/g) ?? []).length, 1, 'the type name appears once');
  assert.equal(descendants(weaponCard).filter(node => node.className === 'chainaxe-view').length, 1,
    'only the default Mk IV panel is rendered initially');
  assert.match(renderedText(weaponCard), /Mk IV/);
  assert.doesNotMatch(renderedText(weaponCard), /118\.50|125\.50|166\.00|178\.00|對被感染的敵人傷害倍率/,
    'Mk XII content is available only after selecting its button');
  const lists = contentNodes.filter(node => node.tagName === 'ul');
  const listItems = contentNodes.filter(node => node.tagName === 'li');
  assert.equal(lists.length, 12);
  assert.equal(listItems.length, 36);
  assert.ok(lists.every(list => list.children.length > 0));
  const skillCardNodes = descendants(candidatePage.get('content').children[0]);
  assert.equal(skillCardNodes.filter(node => node.tagName === 'ul').length, 5);
  assert.equal(skillCardNodes.filter(node => node.tagName === 'li').length, 15);
  const weaponViews = contentNodes.filter(node => node.className === 'chainaxe-view');
  assert.equal(weaponViews.length, 1);
  for (const view of weaponViews) {
    let card = parentByNode.get(view);
    while (card && card.className !== 'card') card = parentByNode.get(card);
    assert.ok(card, 'each Chainaxe view belongs to its weapon card');
    const cardText = renderedText(card);
    assert.doesNotMatch(cardText, /官方原句（忠實翻譯）|繁體中文官方原文（待審）/);
    assert.equal((cardText.match(/突擊鏈斧/g) ?? []).length, 1, 'the official weapon name appears once as the card title');
  }
  assert.equal(contentNodes.filter(node => node.className === 'chainaxe-stat-row').length, 19);
  const images = contentNodes.filter(node => node.tagName === 'img');
  assert.equal(images.length, 2);
  assert.deepEqual(images.map(image => image.attributes.src), [
    'https://github.com/user-attachments/assets/215cb557-8544-4d05-876a-871e70dc093a',
    'https://github.com/user-attachments/assets/8a6ba0a3-cdaf-403f-a87b-3743b3fcfe97'
  ]);
  assert.ok(images.every(image => image.attributes.alt && image.attributes.width === '128' && image.attributes.height === '128'));
  assert.ok(images.every(image => image.attributes.loading === 'lazy' && image.attributes.decoding === 'async'));
  const credits = contentNodes.filter(node => node.tagName === 'a');
  assert.equal(credits.length, 2);
  assert.ok(credits.every(link => link.attributes.href === 'https://darktide.gameslantern.com' &&
    link.attributes['aria-label'] === '圖示來源：Games Lantern' && link.attributes.title === '圖示來源：Games Lantern' &&
    link.textContent === '圖示來源：Games Lantern' && !link.attributes.rel));
  const playerCopy = [
    candidatePage.get('package-warning'), candidatePage.get('status'), candidatePage.get('content'),
    candidatePage.get('announcement-content'), candidatePage.get('changes-content'),
    candidatePage.get('revision')
  ].map(renderedText).join(' ');
  assert.doesNotMatch(playerCopy, /Source|claim|point|ratio|Steam Build|資料修訂|SYP-311|W01/);
  assert.equal(candidatePage.get('revision').textContent, '');

  await writeFile(path.join(candidateOutput, 'preview.json'), jsonBytes({
    ...JSON.parse(await readFile(path.join(candidateOutput, 'preview.json'), 'utf8')),
    candidatePreviewOnly: false
  }));
  const wrongCandidatePage = await runPreviewModule(candidateOutput);
  assert.equal(wrongCandidatePage.get('status').dataset.state, 'error');
  assert.equal(wrongCandidatePage.get('status').textContent, '預覽公告狀態不符。');

  await writeFile(path.join(fixtureOutput, 'preview.json'), jsonBytes({
    ...fixturePreview,
    candidatePreviewOnly: true
  }));
  const wrongFixturePage = await runPreviewModule(fixtureOutput);
  assert.equal(wrongFixturePage.get('status').dataset.state, 'error');
  assert.equal(wrongFixturePage.get('status').textContent, '預覽公告狀態不符。');
});

// Scenario: the generated pending-preview package contains Mk IV and Mk XII chainaxe presentations from one Source weapon family.
// Purpose: keep one accessible type card, show each mark's own full attack and 19-row stat data, and discard the previous panel on selection.
test('UnitT05_runtime-switches-one-chainaxe-card-between-mark-specific-attacks-and-stats', async t => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-chainaxe-switch-'));
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));

  const candidateRepo = path.join(tempRoot, 'candidate-repo');
  const candidateOutput = path.join(tempRoot, 'candidate-output');
  await copyInputRoot(candidateRepo, false);
  await buildW01({ repoRoot: candidateRepo, outputRoot: candidateOutput, mode: 'candidate-preview' });
  const page = await runPreviewModule(candidateOutput);

  const version = JSON.parse(await readFile(path.join(candidateOutput, 'version.json'), 'utf8'));
  const release = version.game_releases[0];
  const manifestRelativePath = release.manifest_path.slice(1).split('/').join(path.sep);
  const manifest = JSON.parse(await readFile(path.join(candidateOutput, manifestRelativePath), 'utf8'));
  const weaponsFile = manifest.files.find(file => file.kind === 'weapons');
  assert.ok(weaponsFile, 'the generated package contains its weapons domain');
  const weaponsUrl = new URL(weaponsFile.path, new URL(release.manifest_path, 'http://w01.test'));
  const weaponsRelativePath = weaponsUrl.pathname.slice(1).split('/').join(path.sep);
  const weapons = JSON.parse(await readFile(path.join(candidateOutput, weaponsRelativePath), 'utf8'));
  const presentations = new Map(weapons.records
    .filter(record => record.owner === 'web' && record.kind === 'presentation' && record.payload.weaponView)
    .map(record => [record.payload.weaponView.markLabel, record]));
  assert.deepEqual([...presentations.keys()].sort(), ['Mk IV', 'Mk XII']);

  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const contentNodes = descendants(page.get('content'));
  const weaponCards = contentNodes.filter(node => node.className === 'card' &&
    descendants(node).some(child => child.className === 'chainaxe-mark-selector'));
  assert.equal(weaponCards.length, 1, 'the two marks share one weapon card');
  const weaponCard = weaponCards[0];
  const title = descendants(weaponCard).find(node => node.tagName === 'h3');
  assert.equal(title.textContent, '突擊鏈斧');
  const selectors = descendants(weaponCard).filter(node => node.className === 'chainaxe-mark-selector');
  assert.equal(selectors.length, 1);
  assert.equal(selectors[0].attributes.role, 'group');
  assert.equal(selectors[0].attributes['aria-label'], '選擇型號');
  const buttons = descendants(selectors[0]).filter(node => node.className === 'chainaxe-mark-button');
  assert.deepEqual(buttons.map(node => renderedText(node)), ['Mk IV', 'Mk XII']);
  assert.ok(buttons.every(button => button.attributes.type === 'button'));
  assert.equal(buttons[0].attributes['aria-pressed'], 'true', 'Mk IV is selected by default');
  assert.equal(buttons[1].attributes['aria-pressed'], 'false');

  const expectedSegments = {
    'Mk IV': [
      { label: '輕攻擊', segments: ['第 1 段・單體', '第 2 段・單體', '第 3 段・單體', '第 4 段・單體'] },
      { label: '重攻擊', segments: ['第 1 段・群體（順劈）', '第 2 段・群體（順劈）'] }
    ],
    'Mk XII': [
      { label: '輕攻擊', segments: ['第 1 段・群體（順劈）', '第 2 段・群體（順劈）'] },
      { label: '重攻擊', segments: ['第 1 段・單體', '第 2 段・單體'] }
    ]
  };
  const assertSelectedMark = markLabel => {
    const viewNodes = descendants(weaponCard).filter(node => node.className === 'chainaxe-view');
    assert.equal(viewNodes.length, 1, 'only the selected mark panel is present');
    const viewNode = viewNodes[0];
    const headings = descendants(viewNode).filter(node => node.tagName === 'h4');
    assert.ok(headings.some(node => node.textContent === markLabel));

    const modes = descendants(viewNode).filter(node => node.className === 'chainaxe-attack-mode');
    const renderedModes = modes.map(mode => ({
      label: descendants(mode).find(node => node.tagName === 'h5').textContent,
      segments: descendants(mode).filter(node => node.className === 'chainaxe-attack-segment').map(renderedText)
    }));
    assert.deepEqual(renderedModes, expectedSegments[markLabel]);

    const presentation = presentations.get(markLabel);
    const expectedSections = presentation.payload.weaponView.statSections;
    const sections = descendants(viewNode).filter(node => node.className === 'chainaxe-stat-section');
    assert.equal(sections.length, 5, 'all five stat families are present');
    assert.deepEqual(sections.map(section => descendants(section).find(node => node.tagName === 'h5').textContent),
      expectedSections.map(section => section.label));
    const expectedRows = expectedSections.flatMap(section => section.rows);
    const rows = descendants(viewNode).filter(node => node.className === 'chainaxe-stat-row');
    assert.equal(rows.length, 19, 'the selected mark keeps all 19 stat rows');
    assert.equal(rows.length, expectedRows.length);
    rows.forEach((rowNode, index) => {
      const rowParts = descendants(rowNode);
      assert.equal(rowParts.find(node => node.className === 'chainaxe-stat-label').textContent, expectedRows[index].label);
      const valueText = rowParts.find(node => node.className === 'chainaxe-stat-value').textContent;
      assert.match(valueText, /60%：.+→ 80%：.+/);
      for (const value of expectedRows[index].values) {
        assert.ok(valueText.includes(value.displayValue.decimal), 'each comparison value comes from the selected mark row');
      }
    });
    const note = descendants(viewNode).find(node => node.className === 'chainaxe-view-note');
    assert.equal(note.textContent, presentation.payload.weaponView.note);
    return note;
  };

  const mkIvNote = assertSelectedMark('Mk IV');
  const mkIvText = renderedText(weaponCard);
  assert.match(mkIvText, /輕攻擊第一個目標攻擊威力60%：113\.00 → 80%：119\.00/);
  assert.match(mkIvText, /重攻擊第一個目標攻擊威力60%：232\.50 → 80%：247\.50/);
  assert.match(mkIvText, /一般輕攻擊末段鋸擊威力/);
  assert.doesNotMatch(mkIvText, /對被感染的敵人傷害倍率/);

  page.dispatchWithGlobals(buttons[1], { type: 'click' });
  assert.equal(buttons[0].attributes['aria-pressed'], 'false');
  assert.equal(buttons[1].attributes['aria-pressed'], 'true');
  const mkXiiNote = assertSelectedMark('Mk XII');
  assert.notEqual(mkXiiNote, mkIvNote, 'switching replaces the entire mark panel, including its note');
  const mkXiiText = renderedText(weaponCard);
  assert.match(mkXiiText, /輕攻擊第一個目標攻擊威力60%：118\.50 → 80%：125\.50/);
  assert.match(mkXiiText, /重攻擊第一個目標攻擊威力60%：166\.00 → 80%：178\.00/);
  assert.match(mkXiiText, /對被感染的敵人傷害倍率/);
  assert.doesNotMatch(mkXiiText, /輕攻擊普通動作末段鋸擊威力|113\.00|119\.00|232\.50|247\.50/);
  assert.equal(descendants(weaponCard).some(node => node.tagName === 'img'), false,
    'the type selector does not attach a mark-specific weapon image');

  page.dispatchWithGlobals(buttons[0], { type: 'click' });
  assert.equal(buttons[0].attributes['aria-pressed'], 'true');
  assert.equal(buttons[1].attributes['aria-pressed'], 'false');
  assertSelectedMark('Mk IV');
});

// Scenario: a hash-valid package contains a malformed non-default chainaxe mark.
// Purpose: reject both marks during initial load instead of exposing an invalid mark only after selection.
test('UnitT06_runtime-validates-non-default-chainaxe-view-before-rendering', async t => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-chainaxe-invalid-mark-'));
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));

  const candidateRepo = path.join(tempRoot, 'candidate-repo');
  const candidateOutput = path.join(tempRoot, 'candidate-output');
  await copyInputRoot(candidateRepo, false);
  await buildW01({ repoRoot: candidateRepo, outputRoot: candidateOutput, mode: 'candidate-preview' });
  await mutatePublishedDomain(candidateOutput, 'weapons', domain => {
    const mkXii = domain.records.find(record => record.recordId === 'web:presentation:chainaxe-p1-m2');
    assert.ok(mkXii, 'the generated weapons domain contains Mk XII');
    mkXii.payload.weaponView.attackModes[0].segments.pop();
  });

  const page = await runPreviewModule(candidateOutput);
  assert.equal(page.get('status').dataset.state, 'error');
  assert.equal(page.get('status').textContent, '鏈斧攻擊段定位資料無效。');
  assert.equal(page.get('content').children.length, 0, 'no presentation becomes visible from an invalid package');
});
// Scenario: all five domain responses are held by a barrier while the generated runtime starts loading.
// Purpose: prove the runtime starts every request before any domain response arrives, and still renders nothing when one domain hash is invalid.
test('UnitT10_domain-requests-start-together-before-first-response-and-hash-failure-renders-nothing', async t => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-preview-parallel-'));
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));

  const fixtureRepo = path.join(tempRoot, 'fixture-repo');
  const fixtureOutput = path.join(tempRoot, 'fixture-output');
  await copyInputRoot(fixtureRepo, true);
  await buildW01({ repoRoot: fixtureRepo, outputRoot: fixtureOutput });

  const version = JSON.parse(await readFile(path.join(fixtureOutput, 'version.json'), 'utf8'));
  const release = version.game_releases[0];
  const manifestPath = path.join(fixtureOutput, release.manifest_path.slice(1).split('/').join(path.sep));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const manifestUrl = new URL(release.manifest_path, 'http://w01.test/');
  const domainPaths = new Set(manifest.files.map(file => new URL(file.path, manifestUrl).pathname));
  const termsFile = manifest.files.find(file => file.kind === 'terms');
  assert.ok(termsFile, 'the shared manifest still includes terms');
  let notifyFirstDomainRequest;
  const firstDomainRequest = new Promise(resolve => { notifyFirstDomainRequest = resolve; });
  const requestedPaths = [];
  const pendingResponses = [];
  let releaseResponses = false;
  const controlledFetch = (input, init, packageFetch) => {
    const url = new URL(input, 'http://w01.test');
    if (!domainPaths.has(url.pathname)) return packageFetch(input, init);
    requestedPaths.push(url.pathname);
    if (requestedPaths.length === 1) notifyFirstDomainRequest();
    return new Promise((resolve, reject) => {
      const respond = async () => {
        try {
          resolve(await packageFetch(input, init));
        } catch (error) {
          reject(error);
        }
      };
      pendingResponses.push(respond);
      if (releaseResponses) void respond();
    });
  };

  const pagePromise = runPreviewModule(fixtureOutput, controlledFetch);
  const firstRequestStarted = await Promise.race([
    firstDomainRequest.then(() => true),
    pagePromise.then(() => false),
    new Promise(resolve => setTimeout(() => resolve(false), 1000))
  ]);
  const requestsBeforeAnyDomainResponse = requestedPaths.length;
  releaseResponses = true;
  await Promise.all(pendingResponses.map(respond => respond()));
  const page = await pagePromise;
  assert.equal(firstRequestStarted, true);
  assert.equal(requestsBeforeAnyDomainResponse, 5);
  assert.equal(new Set(requestedPaths).size, 5);
  assert.equal(page.get('status').dataset.state, undefined, page.get('status').textContent);

  const termsPath = new URL(termsFile.path, manifestUrl).pathname;
  const badHashPage = await runPreviewModule(fixtureOutput, async (input, init, packageFetch) => {
    const response = await packageFetch(input, init);
    const url = new URL(input, 'http://w01.test');
    if (url.pathname !== termsPath) return response;
    const bytes = new Uint8Array(await response.arrayBuffer());
    bytes[bytes.length - 1] ^= 1;
    return new Response(bytes, { status: 200 });
  });
  assert.equal(badHashPage.get('status').dataset.state, 'error');
  assert.match(badHashPage.get('status').textContent, /雜湊不符/);
  assert.equal(badHashPage.get('content')?.children.length ?? 0, 0);
  assert.equal(badHashPage.get('changes-content')?.children.length ?? 0, 0);
});

// Scenario: the shared package contains four compiler-bound blessing tiers and uses the source-defined tier 4 by default.
// Purpose: let players select only a verified option, keep the official EN/zh-TW template identity and duration fixed, and fail closed before partial rendering when the feature flag is absent.
test('UnitT11_runtime-selects-only-source-verified-tier-presentations', async t => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-tier-runtime-'));
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));

  const candidateRepo = path.join(tempRoot, 'candidate-repo');
  const candidateOutput = path.join(tempRoot, 'candidate-output');
  await makeTieredCandidateInput(candidateRepo);
  await buildW01({ repoRoot: candidateRepo, outputRoot: candidateOutput, mode: 'candidate-preview' });

  const page = await runPreviewModule(candidateOutput);
  assert.equal(page.get('status').dataset.state, undefined, page.get('status').textContent);
  const cards = page.get('content').children;
  assert.equal(cards.length, 3);
  const blessingCard = cards.find(card => card.children.some(child => child.tagName === 'label' && child.children.some(nested => nested.tagName === 'select')));
  assert.ok(blessingCard, 'the blessing card has an accessible tier selector');
  const selector = blessingCard.children.find(child => child.tagName === 'label')?.children.find(child => child.tagName === 'select');
  assert.ok(selector);
  assert.equal(selector.attributes['aria-label'], '選擇階級');
  assert.equal(selector.value, '4');
  assert.deepEqual(selector.children.map(option => option.value), ['1', '2', '3', '4']);
  assert.match(renderedText(blessingCard), /武器特殊啟動後\+20%移動速度，持續2秒。/);
  assert.match(renderedText(blessingCard), /你的移動速度提高 20%。/);

  for (const tier of [1, 2, 3, 4]) {
    selector.value = String(tier);
    page.dispatchWithGlobals(selector, { type: 'change' });
    const cardText = renderedText(blessingCard);
    assert.match(cardText, new RegExp('武器特殊啟動後\\+' + tierPercent(tier) + '%移動速度，持續2秒。'));
    assert.match(cardText, new RegExp('你的移動速度提高 ' + tierPercent(tier) + '%。'));
    assert.doesNotMatch(cardText, /Movement Speed|Weapon Special Activation/);
  }

  const wrongFeatureRoot = path.join(tempRoot, 'wrong-feature');
  await cp(candidateOutput, wrongFeatureRoot, { recursive: true });
  const versionPath = path.join(wrongFeatureRoot, 'version.json');
  const version = JSON.parse(await readFile(versionPath, 'utf8'));
  const manifestPath = path.join(wrongFeatureRoot, version.game_releases[0].manifest_path.slice(1).split('/').join(path.sep));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.compatibility.requiredFeatures = manifest.compatibility.requiredFeatures.filter(feature => feature !== 'blessing-tier-presentations-v1');
  const manifestBytes = jsonBytes(manifest);
  await writeFile(manifestPath, manifestBytes);
  version.game_releases[0].manifest_sha256 = sha256(manifestBytes);
  await writeFile(versionPath, jsonBytes(version));

  const rejectedPage = await runPreviewModule(wrongFeatureRoot);
  assert.equal(rejectedPage.get('status').dataset.state, 'error');
  assert.match(rejectedPage.get('status').textContent, /階級資料與套件功能標記不一致/);
  assert.equal(rejectedPage.get('content')?.children.length ?? 0, 0);
});

// Scenario: a verified tier-specific display claim resolves to zero percent.
// Purpose: keep the runtime expectation aligned with the compiler's signed-percent zero formatting on initial load and after selection.
test('UnitT12_runtime-accepts-zero-tier-display-value', async t => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-tier-zero-'));
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));
  const candidateRepo = path.join(tempRoot, 'candidate-repo');
  const candidateOutput = path.join(tempRoot, 'candidate-output');
  await makeTieredCandidateInput(candidateRepo);

  const sourceRoot = path.join(candidateRepo, 'content', 'w01', 'source');
  const technicalPath = path.join(sourceRoot, 'technical.json');
  const technical = JSON.parse(await readFile(technicalPath, 'utf8'));
  const variant = technical.records.find(record => record.recordId === tierVariantId);
  const claim = technical.records.find(record => record.recordId === tierClaimId(4));
  assert.ok(variant && claim);
  variant.payload.tierValues.find(value => value.tier === 4).value.decimal = '0';
  claim.payload.value.decimal = '0';
  const technicalBytes = jsonBytes(technical);
  await writeFile(technicalPath, technicalBytes);
  const sourceManifestPath = path.join(sourceRoot, 'source-manifest.json');
  const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
  const technicalRow = sourceManifest.files.find(file => file.path === 'technical.json');
  technicalRow.sizeBytes = technicalBytes.byteLength;
  technicalRow.sha256 = sha256(technicalBytes);
  const sourceManifestBytes = jsonBytes(sourceManifest);
  await writeFile(sourceManifestPath, sourceManifestBytes);
  const lockPath = path.join(candidateRepo, 'source.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.manifestSha256 = sha256(sourceManifestBytes);
  await writeFile(lockPath, jsonBytes(lock));

  await buildW01({ repoRoot: candidateRepo, outputRoot: candidateOutput, mode: 'candidate-preview' });
  const page = await runPreviewModule(candidateOutput);
  assert.equal(page.get('status').dataset.state, undefined, page.get('status').textContent);
  const blessing = page.get('content').children.find(card => card.children.some(child => child.tagName === 'label'));
  const selector = blessing.children.find(child => child.tagName === 'label').children.find(child => child.tagName === 'select');
  assert.equal(selector.value, '4');
  assert.match(renderedText(blessing), /武器特殊啟動後0%移動速度，持續2秒。/);
  assert.match(renderedText(blessing), /你的移動速度提高 0%。/);
  selector.value = '1';
  page.dispatchWithGlobals(selector, { type: 'change' });
  assert.match(renderedText(blessing), /你的移動速度提高 17%。/);
  selector.value = '4';
  page.dispatchWithGlobals(selector, { type: 'change' });
  assert.match(renderedText(blessing), /你的移動速度提高 0%。/);
});
