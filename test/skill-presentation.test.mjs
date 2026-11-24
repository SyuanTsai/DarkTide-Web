import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkillPresentation } from '../src/build/skill-presentation.mjs';
import { buildSourceSite } from '../src/build/build.mjs';
import { loadSourceData } from '../src/build/source-data.mjs';
import { buildSiteData } from '../src/build/site-data.mjs';
import { verifyStaticPackage } from '../src/static/verify.mjs';
import { createSourceClient } from '../web/source-client.mjs';
import { renderSharedPage } from '../web/shared-render.mjs';
import { Element, allNodes } from './wp8c-helper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = join(root, 'test/fixtures/source-data');
const publishedContent = JSON.parse(await readFile(join(root, 'content/published/content.json')));
const gameVersion = '1.13.4';
const art = (archetype, nodeType, key) =>
  `https://gameslantern.com/storage/sites/darktide/exporter/talents/${archetype}/${nodeType}/${key}.webp`;
const skill = (archetype, key, { tree = `${archetype}_tree`, nodeType = 'stat' } = {}) => ({
  id: `darktide:skill:${archetype}:${key}`, key,
  values: { archetype, tree, nodeType, maxPoints: 1, parents: [] },
  name: { zh: '堅韌', origin: 'official' }, official: { zh: '增加{toughness:%s}堅韌上限。', en: null }, errata: [],
  explanation: { effect: '堅韌上限增加 10%。', conditions: '', calculation: '', notes: '', extra: '' },
});
const armor = skill('adamant', 'adamant_armor', { nodeType: 'default' });
const missingIcon = skill('broker', 'broker_stimm_activation_talent', { tree: 'broker_stimm_tree', nodeType: 'broker_stimm' });
const armorArt = art('adamant', 'default', armor.key);
const sourceNode = {
  node_id: 'armor', type: 'stat', x: 100.5, y: 200, skill_id: armor.key, children: [],
};
const layout = (archetype, nodes = [{ node_id: 'start', type: 'start', x: 0, y: 0, skill_id: null, children: [] }]) =>
  ({ archetype, version: 1, nodes });
const project = (published, items, version = gameVersion) =>
  buildSkillPresentation({ published, skills: { items }, gameVersion: version });

test('技能版面對照職業與已發布圖示，並依 UTF-8 順序輸出', () => {
  const safe = skill('adamant', 'z');
  const unsafe = skill('adamant', '../escape');
  const forged = skill('adamant', 'forged');
  const assets = [
    { attribution: { href: art('adamant', 'stat', 'z'), text: '來源署名' } },
    { attribution: { href: armorArt } },
    { attribution: { href: art('adamant', 'stat', '../escape') } },
    { attribution: { href: art('adamant', 'stat', 'forged').replace('gameslantern.com', 'example.test') } },
  ];
  const trees = [layout('zealot'), layout('skitarii'), layout('scum'), layout('arbites', [sourceNode])];
  const items = [missingIcon, safe, unsafe, forged, armor];
  const result = project({ game_version: '1.13.1', assets, talent_trees: trees }, items);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.document.trees.map(tree => tree.tree), ['adamant_tree', 'broker_tree', 'cryptic_tree', 'zealot_tree']);
  assert.deepEqual(result.document.trees[0], {
    archetype: 'adamant', tree: 'adamant_tree', version: 1, layoutGameVersion: '1.13.1',
    nodes: [{ nodeId: 'armor', type: 'stat', x: 100.5, y: 200, skillId: armor.id, children: [] }],
  });
  assert.deepEqual(Object.keys(result.document.icons), [armor.id, safe.id]);
  assert.deepEqual(result.document.icons[armor.id], { src: armorArt, creditHref: armorArt, creditText: '圖示 © Games Lantern' });
  assert.equal(result.document.icons[safe.id].creditText, '來源署名');
  const reversed = project({ game_version: '1.13.1', assets: assets.toReversed(), talent_trees: trees.toReversed() }, items.toReversed());
  assert.equal(JSON.stringify(reversed), JSON.stringify(result));
});

test('版面驗證失敗時省略整棵樹並回傳原因', () => {
  for (const [nodes, items, reason] of [
    [[sourceNode], [], /skill .* is missing/],
    [[sourceNode], [{ ...armor, values: { ...armor.values, archetype: 'broker' } }], /belongs to another tree/],
    [[sourceNode], [{ ...armor, values: { ...armor.values, tree: 'adamant_extra' } }], /belongs to another tree/],
    [[sourceNode, sourceNode], [armor], /duplicate node ID/],
    [[{ ...sourceNode, children: ['dangling'] }], [armor], /unknown child/],
    [[{ ...sourceNode, y: Infinity }], [armor], /invalid coordinates/],
  ]) {
    const { document, warnings } = project({ game_version: '1.13.1', talent_trees: [layout('arbites', nodes), layout('ogryn')] }, items);
    assert.deepEqual(document.trees.map(tree => tree.archetype), ['ogryn']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /1\.13\.4\/adamant_tree/);
    assert.match(warnings[0], reason);
  }
});

test('真實 published 資料可映射到 Source-Data 技能', () => {
  const { document } = project(publishedContent, [armor, missingIcon]);
  assert.deepEqual(Object.keys(document.icons), [armor.id]);
  assert.equal(document.icons[armor.id].src, armorArt);
});

test('本機 Source-Data 1.13.4 有至少 617 個圖示與 7 棵樹', async t => {
  const path = 'F:/GitFile/Persion - Games/DarkTide-Source-Data/data/1.13.4/skills.json';
  const bytes = await readFile(path).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (!bytes) return t.skip('本機預設 Source-Data 工作目錄沒有 1.13.4 skills.json');
  const { document, warnings } = buildSkillPresentation({ published: publishedContent, skills: JSON.parse(bytes), gameVersion });
  assert.ok(Object.keys(document.icons).length >= 617);
  assert.equal(document.trees.length, 7);
  assert.deepEqual(warnings, []);
});

test('建置、靜態驗證與技能頁載入支援選用的 skill-presentation domain', async t => {
  const source = await loadSourceData({ directory: fixture, fixture: true });
  const oldBundle = buildSiteData({ source });
  assert.deepEqual(buildSiteData({ source, published: null }), oldBundle);
  assert.ok(![...oldBundle.files.keys()].some(path => path.endsWith('/skill-presentation.json')));

  const temp = await mkdtemp(join(tmpdir(), 'syp540-site-data-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  for (const name of ['web', 'content/history', 'content/authoring/v2', 'content/reference']) {
    await cp(join(root, name), join(temp, name), { recursive: true });
  }
  const item = source.dataByVersion[source.current.gameVersion].skills.items[0];
  const src = art(item.values.archetype, item.values.nodeType, item.key);
  await mkdir(join(temp, 'content/published'), { recursive: true });
  await writeFile(join(temp, 'content/published/content.json'), JSON.stringify({
    game_version: '1.13.1', assets: [{ attribution: { href: src } }], talent_trees: [],
  }));
  const build = await buildSourceSite({ root: temp, sourceData: fixture, fixture: true });
  await verifyStaticPackage(build.outputDirectory);
  const client = createSourceClient({ build, fetchImpl: async path => new Response(
    await readFile(join(build.outputDirectory, path.slice(1))), { headers: { 'content-type': 'application/json' } },
  ) });
  const result = await client.load({ pathname: '/skills/' });
  assert.ok(result.manifest.files.some(row => row.kind === 'skill-presentation' && row.path === 'domains/skill-presentation.json'));
  assert.equal(result.domains.find(row => row.kind === 'skill-presentation').document.icons[item.id].src, src);
});

class SkillElement extends Element {
  style = {};
  events = new Map();
  scrollWidth = 500;
  clientWidth = 300;
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, handler) { this.events.set(name, handler); }
}

const previousDocument = globalThis.document;
const createElement = tag => new SkillElement(tag);
before(() => {
  globalThis.document = { head: createElement('head'), createElement, createElementNS: (_namespace, tag) => createElement(tag),
    querySelector: () => null, querySelectorAll: () => [] };
});
after(() => { globalThis.document = previousDocument; });

function renderSkills(query, document, items) {
  const url = new URL(`https://example.test/skills/?version=${gameVersion}&${query}`);
  const main = new SkillElement('main');
  renderSharedPage({ main, url, buildMeta: createElement('p'), result: {
    sourceData: true, manifest: { gameVersion, dataRevision: 'a'.repeat(64) }, versions: [],
    domains: [{ kind: 'skills', document: { schemaVersion: '1.1.0', items } }, { kind: 'skill-presentation', document }],
  } });
  return allNodes(main);
}

const selectedTree = 'archetype=adamant&tree=adamant_tree';
const presentation = project({
  game_version: '1.13.1', assets: [{ attribution: { href: armorArt } }],
  talent_trees: [layout('arbites', [
    { node_id: 'start', type: 'start', x: 0, y: 0, skill_id: null, children: ['armor'] }, sourceNode,
  ])],
}, [armor, missingIcon]).document;

test('技能頁渲染天賦樹、縮放、連線與指定版本的官方技能效果', t => {
  const tree = renderSkills(selectedTree, presentation, [armor, missingIcon]);
  assert.match(tree[0].textContent, /天賦樹版面沿用 1\.13\.1 遊戲原始碼/);
  assert.ok(tree.some(row => row.tagName === 'line' && row.attributes.x2 === 180.5));
  assert.ok(tree.some(row => row.href === 'https://darktide.gameslantern.com/' && row.textContent.includes('圖示素材來源')));
  assert.ok(tree.some(row => row.href?.includes(`version=${gameVersion}&${selectedTree}&view=list`)));
  const [start, button] = tree.filter(row => row.tagName === 'button');
  assert.equal(start.title, '天賦樹起點');
  assert.equal(start.style.width, '96px');
  assert.equal(button.attributes['aria-label'], armor.name.zh);
  assert.equal(button.style.width, '50px');
  assert.equal(button.childNodes.find(row => row.tagName === 'img').src, armorArt);
  const slider = tree.find(row => row.tagName === 'input');
  assert.deepEqual([slider.min, slider.max], ['50', '150']);
  slider.value = '150';
  slider.events.get('input')();
  assert.equal(button.style.width, '75px');
  const window = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  t.after(() => { globalThis.window = window; });
  button.events.get('click')();
  assert.equal(button.attributes['aria-pressed'], 'true');
  const detail = tree.find(row => row.className?.includes('tree-detail'));
  assert.match(detail.textContent, /堅韌上限增加 10%/);
  assert.doesNotMatch(detail.textContent, /\{toughness/);
  assert.equal(detail.childNodes.find(row => row.tagName === 'a').href, `/skills/?id=${encodeURIComponent(armor.id)}&version=${gameVersion}`);
  start.events.get('click')();
  assert.equal(button.attributes['aria-pressed'], 'false');
});

test('清單與詳情顯示技能圖示，載入失敗或資料不合格時顯示通用圖示', () => {
  const list = renderSkills(`${selectedTree}&view=list`, presentation, [armor, missingIcon]);
  assert.ok(!list.some(row => row.tagName === 'button'));
  assert.ok(list.some(row => row.textContent === '法務官／天賦樹'));
  assert.ok(list.some(row => row.textContent === '巢都敗類／興奮劑樹'));
  const icon = list.find(row => row.className === 'entry-icon');
  const [fallback, image] = icon.childNodes;
  assert.deepEqual([image.loading, image.decoding, image.alt, image.hidden], ['lazy', 'async', armor.name.zh, true]);
  assert.ok(!Object.hasOwn(fallback.attributes, 'hidden'));
  image.events.get('load')();
  assert.ok(Object.hasOwn(fallback.attributes, 'hidden'));
  assert.equal(image.hidden, false);
  image.events.get('error')();
  assert.ok(!Object.hasOwn(fallback.attributes, 'hidden'));
  assert.equal(image.hidden, true);

  const id = `id=${encodeURIComponent(armor.id)}`;
  const detail = renderSkills(`${selectedTree}&${id}`, presentation, [armor]);
  assert.ok(detail.some(row => row.tagName === 'img' && row.src === armorArt));
  assert.ok(detail.some(row => row.href === armorArt && row.textContent === '圖示 © Games Lantern'));
  for (const badIcon of [
    { src: 'https://example.test/icon.webp', creditHref: 'https://example.test/icon.webp' },
    { src: armorArt, creditHref: 'javascript:alert(1)' },
  ]) {
    const damaged = { ...presentation, icons: { [armor.id]: { ...badIcon, creditText: '署名' } } };
    const rejected = renderSkills(id, damaged, [armor]);
    assert.ok(rejected.some(row => row.attributes.class === 'talent-icon-fallback'));
    assert.ok(!rejected.some(row => row.tagName === 'img' || row.textContent === '署名'));
  }
  const stimm = renderSkills('archetype=broker&tree=broker_stimm_tree', presentation, [missingIcon]);
  assert.ok(stimm.some(row => row.attributes.class === 'talent-icon-fallback'));
  assert.ok(stimm.some(row => row.dataset.itemId === missingIcon.id));
});
