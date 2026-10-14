import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { buildW01 } from '../scripts/w01-build.mjs';
import { jsonBytes } from '../src/static/common.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
let runtimeImportId = 0;

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
    textContent: '',
    className: '',
    id: '',
    append(child) { this.children.push(child); },
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
  for (const [name, value] of Object.entries({ document, location, fetch, crypto: webcrypto })) {
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
  return page;
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
  assert.match(candidateText, /選用此天賦後，顱腦崩裂相關傷害會套用 1\.5 倍倍率；在其他條件相同時，相當於增加 50%。/);
  assert.match(candidateText, /成功造成傷害才會額外增加反噬；沒有其他加成時，基本增加量為 25%，不隨蓄力程度改變。/);
  assert.match(candidateText, /一般模式約 3 秒滿蓄；蓄力 1、2、3 秒時，反噬約為 6\.67%、13\.33%、20%。/);
  assert.match(candidateText, /鎖定目標模式需先取得有效目標；蓄力 1、2 秒時，反噬約為 10%、20%，約 2 秒滿蓄。/);
  assert.match(candidateText, /開始鎖定蓄力需要有效目標。從一般蓄力切換成鎖定時，可接續已累積的蓄力；重新開始蓄力則採一般模式的基本時間。/);
  assert.match(candidateText, /可受此攻擊僵直的目標：直接鎖定維持 1 秒會造成一次小幅僵直；從一般蓄力切換鎖定後，超過 0\.25 秒也會造成一次小幅僵直。/);
  assert.match(candidateText, /以下是既有分析的估算，假設蓄力速度沒有修正、沒有其他角色加成，並在滿蓄後立即成功造成傷害；尚未經遊戲內實測。/);
  assert.match(candidateText, /在上述條件下，3 秒滿蓄約累積 20%，成功造成傷害再加基本 25% 命中成本，合計約 45%/);
  assert.match(candidateText, /這是乘算，不是額外固定傷害。/);
  assert.match(candidateText, /傷害倍率：此天賦用來放大對應傷害的倍率；不能套用到所有靈能攻擊。/);
  assert.match(candidateText, /提速/);
  assert.match(candidateText, /第 1 階級的說明數值為 \+17%。/);
  assert.match(candidateText, /說明中的持續時間為 2 秒。/);
  assert.match(candidateText, /已收錄的攻擊數值：80、140。/);
  assert.match(candidateText, /已收錄的護甲修正值：1\.035、1\.965。/);
  assert.match(candidateText, /其他攻擊資料尚未補齊。/);
  assert.doesNotMatch(candidateText, /Brain Rupture|Movement Speed/);
  assert.doesNotMatch(candidateText, /Source|claim|point|ratio|Steam Build|SYP-311|W01/);

  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const contentNodes = descendants(candidatePage.get('content'));
  const lists = contentNodes.filter(node => node.tagName === 'ul');
  const listItems = contentNodes.filter(node => node.tagName === 'li');
  assert.equal(lists.length, 10);
  assert.equal(listItems.length, 24);
  assert.ok(lists.every(list => list.children.length > 0));
  const skillCardNodes = descendants(candidatePage.get('content').children[0]);
  assert.equal(skillCardNodes.filter(node => node.tagName === 'ul').length, 5);
  assert.equal(skillCardNodes.filter(node => node.tagName === 'li').length, 17);
  const images = contentNodes.filter(node => node.tagName === 'img');
  assert.equal(images.length, 2);
  assert.deepEqual(images.map(image => image.attributes.src), [
    'https://github.com/user-attachments/assets/215cb557-8544-4d05-876a-871e70dc093a',
    'https://github.com/user-attachments/assets/8a6ba0a3-cdaf-403f-a87b-3743b3fcfe97'
  ]);
  assert.ok(images.every(image => image.attributes.alt && image.attributes.width === '96' && image.attributes.height === '96'));
  const credits = contentNodes.filter(node => node.tagName === 'a');
  assert.equal(credits.length, 2);
  assert.ok(credits.every(link => link.attributes.href === 'https://darktide.gameslantern.com' && !link.attributes.rel));
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
  assert.equal(page.get('status').dataset.state, undefined);

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
