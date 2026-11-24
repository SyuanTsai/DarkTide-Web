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
import { formatSkillName } from '../web/skill-presentation.mjs';
import { sourceSkillPresentation } from '../web/shared-view.mjs';
import { Element, allNodes } from './wp8c-helper.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = join(root, 'test/fixtures/source-data');
const publishedContent = JSON.parse(await readFile(join(root, 'content/published/content.json')));
const reference = JSON.parse(await readFile(join(root, 'content/reference/talent-layouts/1.13.4.json')));
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

test('本機 Source-Data 1.13.4 有至少 617 個圖示，已發布版面有 7 棵樹', async t => {
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

const layoutSkills = reference.trees.flatMap(({ archetype, tree, nodes }) =>
  [...new Set(nodes.flatMap(node => node.talent === null ? [] : [node.talent]))].map(talent => skill(archetype, talent, { tree })));

test('相同版本的參考檔提供八棵樹與起點技能，版本不符時沿用已發布版面', () => {
  const skills = { items: layoutSkills };
  const input = { published: publishedContent, skills, gameVersion };
  const { document, warnings } = buildSkillPresentation({ ...input, layouts: reference });
  const fallback = buildSkillPresentation(input);
  assert.deepEqual(warnings, []);
  assert.equal(document.trees.length, 8);
  assert.deepEqual(document.icons, fallback.document.icons);
  for (const tree of document.trees) {
    assert.equal(tree.layoutGameVersion, gameVersion);
    assert.deepEqual(tree.layoutSource, { repository: reference.source.repository, commit: reference.source.commit });
  }
  const stimm = document.trees.find(tree => tree.tree === 'broker_stimm_tree');
  assert.equal(stimm.nodes.find(node => node.type === 'start').skillId, missingIcon.id);
  assert.equal(Object.keys(document.nameValues).length, 30);
  assert.deepEqual(document.nameValues['darktide:skill:broker:broker_stimm_combat_4b'], { tier: 'I' });
  assert.deepEqual(fallback.document.nameValues, {});
  const subset = buildSkillPresentation({ ...input, skills: { items: [missingIcon] }, layouts: reference }).document;
  assert.deepEqual(subset.nameValues, { [missingIcon.id]: { tier: '' } });
  assert.equal(fallback.document.trees.length, 7);
  assert.deepEqual(buildSkillPresentation({ ...input, layouts: { ...reference, gameVersion: '1.13.3' } }), fallback);
});

test('參考檔的技能、連線、座標或節點 ID 驗證失敗時省略整棵樹', () => {
  const stimm = reference.trees.find(tree => tree.tree === 'broker_stimm_tree');
  const [start, child, ...others] = stimm.nodes;
  for (const [replacement, reason] of [
    [{ ...start, talent: 'not_in_source_data' }, /skill .* is missing/],
    [{ ...start, talent: reference.trees.find(tree => tree.tree === 'broker_tree').nodes.find(node => node.talent).talent }, /belongs to another tree/],
    [{ ...start, children: ['absent'] }, /unknown child/],
    [{ ...start, x: Infinity }, /invalid coordinates/],
    [{ ...start, nodeId: child.nodeId }, /duplicate node ID/],
  ]) {
    const layouts = { ...reference, trees: reference.trees.map(tree =>
      tree === stimm ? { ...stimm, nodes: [replacement, child, ...others] } : tree) };
    const { document, warnings } = buildSkillPresentation({ published: publishedContent, skills: { items: layoutSkills }, gameVersion, layouts });
    assert.equal(document.trees.length, 7);
    assert.ok(!document.trees.some(tree => tree.tree === stimm.tree));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /1\.13\.4\/broker_stimm_tree/);
    assert.match(warnings[0], reason);
  }
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
  const layoutsPath = join(temp, 'content/reference/talent-layouts', `${source.current.gameVersion}.json`);
  const fixtureLayouts = {
    ...reference, gameVersion: source.current.gameVersion, trees: [{
      archetype: 'psyker', tree: 'psyker_tree', version: 2, backgroundHeight: 100,
      nodes: [{ nodeId: 'start', type: 'start', x: 50, y: 50, talent: null, children: [] }],
    }],
  };
  await writeFile(layoutsPath, JSON.stringify(fixtureLayouts));
  await mkdir(join(temp, 'content/published'), { recursive: true });
  await writeFile(join(temp, 'content/published/content.json'), JSON.stringify({
    game_version: '1.13.1', assets: [{ attribution: { href: src } }], talent_trees: [layout('psyker')],
  }));
  const build = await buildSourceSite({ root: temp, sourceData: fixture, fixture: true });
  await verifyStaticPackage(build.outputDirectory);
  const client = createSourceClient({ build, fetchImpl: async path => new Response(
    await readFile(join(build.outputDirectory, path.slice(1))), { headers: { 'content-type': 'application/json' } },
  ) });
  const result = await client.load({ pathname: '/skills/' });
  assert.ok(result.manifest.files.some(row => row.kind === 'skill-presentation' && row.path === 'domains/skill-presentation.json'));
  const current = result.domains.find(row => row.kind === 'skill-presentation').document;
  assert.equal(current.icons[item.id].src, src);
  assert.equal(current.trees[0].layoutGameVersion, source.current.gameVersion);
  assert.equal(current.trees[0].layoutSource.commit, reference.source.commit);
  const previous = build.game_releases.find(pointer => pointer.game_version !== source.current.gameVersion);
  const fallback = JSON.parse(await readFile(join(build.outputDirectory, 'data', previous.data_revision, 'domains/skill-presentation.json')));
  assert.equal(fallback.trees[0].layoutGameVersion, '1.13.1');
  assert.equal(fallback.trees[0].layoutSource, undefined);

  const options = { root: temp, sourceData: fixture, fixture: true };
  await writeFile(layoutsPath, '{');
  await assert.rejects(buildSourceSite(options), /Invalid talent layouts.*invalid JSON/);
  await writeFile(layoutsPath, JSON.stringify({ ...fixtureLayouts, source: { ...fixtureLayouts.source, files: [{ path: 'scripts/tree.lua', sha256: 'invalid' }] } }));
  await assert.rejects(buildSourceSite(options), /Invalid talent layouts.*source\.files/);
});

class SkillElement extends Element {
  className = '';
  classList = {
    add: (...tokens) => {
      this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...tokens])].join(' ');
    },
    remove: (...tokens) => {
      this.className = this.className.split(/\s+/).filter(token => token && !tokens.includes(token)).join(' ');
    },
    contains: token => this.className.split(/\s+/).includes(token),
  };
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

test('技能頁渲染天賦樹、縮放、連線與技能效果的翻譯來源', t => {
  const translated = skill('adamant', 'adamant_translated');
  translated.official.zh = null;
  translated.explanation.effect = '受到的傷害減少 5%。';
  const [adamantTree] = presentation.trees;
  const treeWithTranslation = { ...presentation, trees: [{
    ...adamantTree,
    nodes: [...adamantTree.nodes, { ...adamantTree.nodes[1], nodeId: 'translated', x: 200, skillId: translated.id }],
  }] };
  const tree = renderSkills(selectedTree, treeWithTranslation, [armor, translated]);
  assert.match(tree[0].textContent, /天賦樹版面沿用 1\.13\.1 遊戲原始碼/);
  assert.ok(tree.some(row => row.tagName === 'line' && row.attributes.x2 === 180.5));
  assert.ok(tree.some(row => row.href === 'https://darktide.gameslantern.com/' && row.textContent.includes('圖示素材來源')));
  assert.ok(tree.some(row => row.href?.includes(`version=${gameVersion}&${selectedTree}&view=list`)));
  const [start, button, translatedButton] = tree.filter(row => row.tagName === 'button');
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
  const detail = tree.find(row => row.classList.contains('tree-detail'));
  const translationNotice = '遊戲沒有提供繁體中文官方文字，此段由 AI 翻譯，僅供參考。';
  translatedButton.events.get('click')();
  const badge = detail.childNodes.find(row => row.classList.contains('source-effect-origin'));
  assert.equal(badge?.textContent, '非官方翻譯');
  assert.equal(badge.dataset.effectOrigin, 'unofficial-translation');
  assert.ok(detail.childNodes.some(row => row.tagName === 'p' && row.textContent === translationNotice));
  assert.ok(detail.childNodes.some(row => row.tagName === 'p' && row.textContent === translated.explanation.effect));
  button.events.get('click')();
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.ok(!detail.childNodes.some(row => row.classList.contains('source-effect-origin')));
  assert.ok(!detail.textContent.includes(translationNotice));
  assert.match(detail.textContent, /堅韌上限增加 10%/);
  assert.doesNotMatch(detail.textContent, /\{toughness/);
  assert.equal(detail.childNodes.find(row => row.tagName === 'a').href, `/skills/?id=${encodeURIComponent(armor.id)}&version=${gameVersion}`);
  start.events.get('click')();
  assert.equal(button.attributes['aria-pressed'], 'false');
  assert.equal(detail.childNodes[0].textContent, '天賦樹起點');
});

test('興奮劑樹預設顯示樹圖，起點顯示技能名稱與圖示並可開啟翻譯詳情', t => {
  const activation = { ...missingIcon, name: { zh: '啟用興奮劑', origin: 'glossary' },
    official: { ...missingIcon.official, zh: null }, explanation: { ...missingIcon.explanation, effect: '立即啟用興奮劑。' } };
  const stimm = reference.trees.find(tree => tree.tree === 'broker_stimm_tree');
  const items = layoutSkills.filter(item => item.values.tree === stimm.tree).map(item => item.id === activation.id ? activation : item);
  const icon = art('broker', 'broker_stimm', activation.key);
  const { document } = buildSkillPresentation({
    published: { assets: [{ attribution: { href: icon } }] }, skills: { items }, gameVersion,
    layouts: { ...reference, trees: [stimm] },
  });
  const query = 'archetype=broker&tree=broker_stimm_tree';
  const view = renderSkills(query, document, items);
  assert.ok(view.some(row => row.textContent === '巢都敗類／興奮劑樹'));
  assert.ok(view.some(row => row.textContent === '天賦樹版面取自 1.13.4 遊戲原始碼。點選節點查看詳情，可縮放或在樹內捲動。'));
  const findStart = rows => rows.find(row => row.tagName === 'button' && row.dataset.nodeType === 'start');
  const start = findStart(view);
  assert.equal(start.title, activation.name.zh);
  assert.equal(start.attributes['aria-label'], activation.name.zh);
  assert.equal(start.style.width, '96px');
  const image = start.childNodes.find(row => row.tagName === 'img');
  assert.equal(image.src, icon);
  image.events.get('load')();
  assert.equal(image.hidden, false);
  const fallback = findStart(renderSkills(query, { ...document, icons: {} }, items));
  assert.ok(!fallback.childNodes.some(row => row.tagName === 'img'));
  assert.equal(fallback.childNodes[0].attributes.class, 'talent-icon-fallback');
  assert.match(fallback.childNodes[0].childNodes[0].attributes.d, /^M16 3/);

  const window = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  t.after(() => { globalThis.window = window; });
  start.events.get('click')();
  const detail = view.find(row => row.classList.contains('tree-detail'));
  assert.equal(start.attributes['aria-pressed'], 'true');
  assert.equal(detail.childNodes[0].textContent, activation.name.zh);
  assert.ok(detail.childNodes.some(row => row.textContent === activation.explanation.effect));
  assert.ok(detail.childNodes.some(row => row.textContent === '非官方翻譯'));
  assert.equal(detail.childNodes.find(row => row.tagName === 'a').href, `/skills/?id=${encodeURIComponent(activation.id)}&version=${gameVersion}`);
});

test('興奮劑階級出現在清單、技能詳情、天賦樹與圖示替代文字', t => {
  const tree = reference.trees.find(tree => tree.tree === 'broker_stimm_tree');
  const ranked = skill('broker', 'broker_stimm_celerity_4', { tree: tree.tree, nodeType: 'broker_stimm' });
  ranked.name.zh = '激勵{tier:%s}';
  const unranked = skill('broker', 'broker_stimm_celerity_5b', { tree: tree.tree });
  unranked.name.zh = '技能 {tier:%s}  ';
  const icon = art('broker', ranked.values.nodeType, ranked.key);
  const replacements = new Map([ranked, unranked].map(item => [item.id, item]));
  const items = layoutSkills.filter(item => item.values.tree === tree.tree).map(item => replacements.get(item.id) ?? item);
  const { document } = buildSkillPresentation({
    published: { assets: [{ attribution: { href: icon } }] }, skills: { items }, gameVersion,
    layouts: { ...reference, trees: [tree] },
  });
  const query = 'archetype=broker&tree=broker_stimm_tree';
  const list = renderSkills(`${query}&view=list`, document, items);
  assert.ok(list.some(row => row.tagName === 'a' && row.textContent === '激勵 IV'));
  assert.ok(list.some(row => row.tagName === 'a' && row.textContent === '技能'));
  assert.ok(list.some(row => row.tagName === 'h2' && row.textContent === '激勵 IV'));
  assert.equal(list.find(row => row.tagName === 'img').alt, '激勵 IV');

  const detail = renderSkills(`id=${encodeURIComponent(ranked.id)}`, document, items);
  assert.ok(detail.some(row => row.tagName === 'h2' && row.textContent === '激勵 IV'));
  assert.equal(detail.find(row => row.tagName === 'img').alt, '激勵 IV');

  const view = renderSkills(query, document, items);
  const nodeId = tree.nodes.find(node => node.talent === ranked.key).nodeId;
  const button = view.find(row => row.tagName === 'button' && row.dataset.nodeId === nodeId);
  assert.equal(button.title, '激勵 IV');
  assert.equal(button.attributes['aria-label'], '激勵 IV');
  assert.equal(button.childNodes.find(row => row.tagName === 'img').alt, '激勵 IV');
  const window = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  t.after(() => { globalThis.window = window; });
  button.events.get('click')();
  assert.equal(view.find(row => row.classList.contains('tree-detail')).childNodes[0].textContent, '激勵 IV');
});

test('技能名稱只套用合法的格式值，並保留缺少值的範本', () => {
  const document = { ...presentation, nameValues: {
    [armor.id]: { tier: '<IV>', 'bad-key': 'IV', '1tier': 'I', _level2: 'Mark 2', count: 4, newline: 'IV\n' },
    'darktide:skill:broker:missing': { tier: 'V' },
  } };
  const { nameValues } = sourceSkillPresentation(document, gameVersion, new Map([[armor.id, armor]]));
  assert.deepEqual([...nameValues], [[armor.id, { _level2: 'Mark 2' }]]);
  assert.equal(formatSkillName('Spur  {tier:%s}', { tier: 'IV' }), 'Spur IV');
  assert.equal(formatSkillName('Spur {tier:%s}', nameValues.get(armor.id)), 'Spur {tier:%s}');
  assert.equal(formatSkillName('Spur{_level2:%s}', nameValues.get(armor.id)), 'Spur Mark 2');
});

test('清單與詳情顯示技能圖示，載入失敗或資料不合格時顯示通用圖示', () => {
  const list = renderSkills(`${selectedTree}&view=list`, presentation, [armor, missingIcon]);
  assert.ok(!list.some(row => row.tagName === 'button'));
  assert.ok(list.some(row => row.textContent === '法務官／天賦樹'));
  assert.ok(list.some(row => row.textContent === '巢都敗類／興奮劑樹'));
  const icon = list.find(row => row.className === 'entry-icon');
  const [fallback, image] = icon.childNodes;
  assert.deepEqual([image.loading, image.decoding, image.alt], ['lazy', 'async', armor.name.zh]);
  assert.ok(!image.hidden);
  assert.ok(image.classList.contains('icon-pending'));
  assert.ok(!Object.hasOwn(fallback.attributes, 'hidden'));
  image.events.get('load')();
  assert.ok(Object.hasOwn(fallback.attributes, 'hidden'));
  assert.ok(!image.classList.contains('icon-pending'));
  image.events.get('error')();
  assert.ok(!Object.hasOwn(fallback.attributes, 'hidden'));
  assert.ok(image.classList.contains('icon-pending'));

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
