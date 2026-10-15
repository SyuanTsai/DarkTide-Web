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
  assert.match(candidateText, /已收錄的攻擊數值：80、140。/);
  assert.match(candidateText, /已收錄的護甲修正值：1\.035、1\.965。/);
  assert.match(candidateText, /其他攻擊資料尚未補齊。/);
  assert.doesNotMatch(candidateText, /Brain Rupture|Movement Speed/);
  assert.doesNotMatch(candidateText, /Source|claim|point|ratio|Steam Build|SYP-311|W01/);

  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const contentNodes = descendants(candidatePage.get('content'));
  const lists = contentNodes.filter(node => node.tagName === 'ul');
  const listItems = contentNodes.filter(node => node.tagName === 'li');
  assert.equal(lists.length, 9);
  assert.equal(listItems.length, 20);
  assert.ok(lists.every(list => list.children.length > 0));
  const skillCardNodes = descendants(candidatePage.get('content').children[0]);
  assert.equal(skillCardNodes.filter(node => node.tagName === 'ul').length, 5);
  assert.equal(skillCardNodes.filter(node => node.tagName === 'li').length, 15);
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
    candidatePage.get('announcement-content'), candidatePage.get('changes-content'), candidatePage.get('terms-content'),
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

  const skillsPath = new URL(manifest.files.find(file => file.kind === 'skills').path, manifestUrl).pathname;
  const badHashPage = await runPreviewModule(fixtureOutput, async (input, init, packageFetch) => {
    const response = await packageFetch(input, init);
    const url = new URL(input, 'http://w01.test');
    if (url.pathname !== skillsPath) return response;
    const bytes = new Uint8Array(await response.arrayBuffer());
    bytes[bytes.length - 1] ^= 1;
    return new Response(bytes, { status: 200 });
  });
  assert.equal(badHashPage.get('status').dataset.state, 'error');
  assert.match(badHashPage.get('status').textContent, /雜湊不符/);
  assert.equal(badHashPage.get('content')?.children.length ?? 0, 0);
  assert.equal(badHashPage.get('terms-content')?.children.length ?? 0, 0);
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
  assert.equal(rejectedPage.get('terms-content')?.children.length ?? 0, 0);
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
