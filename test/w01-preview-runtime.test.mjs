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

async function runPreviewModule(outputRoot) {
  const page = new Map();
  const document = {
    createElement: tagName => fakeElement(tagName),
    getElementById(id) {
      if (!page.has(id)) page.set(id, fakeElement());
      return page.get(id);
    }
  };
  const location = { origin: 'http://w01.test' };
  const fetch = async input => {
    const url = new URL(input, location.origin);
    const relative = url.pathname.slice(1).split('/').join(path.sep);
    try {
      return new Response(await readFile(path.join(outputRoot, relative)), { status: 200 });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return new Response(new Uint8Array(), { status: 404 });
    }
  };
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
  assert.match(candidateText, /遊戲說明中的傷害加成為 50%。/);
  assert.match(candidateText, /實際效果仍待確認。/);
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
  assert.equal(lists.length, 8);
  assert.equal(listItems.length, 10);
  assert.ok(lists.every(list => list.children.length > 0));
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
