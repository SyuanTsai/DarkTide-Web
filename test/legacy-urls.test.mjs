import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveLegacyUrl, applyLegacyUrl } from '../web/legacy-urls.mjs';
import { generateLegacyUrls } from '../scripts/generate-legacy-urls.mjs';
import runtimeMap from '../web/legacy-url-map.mjs';
import { renderSharedPage } from '../web/shared-render.mjs';
import { createSourceClient } from '../web/source-client.mjs';
import { buildSiteData } from '../src/build/site-data.mjs';
import { loadSourceData } from '../src/build/source-data.mjs';
import { fileURLToPath } from 'node:url';

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url)));
const map = await readJson('../content/compatibility/legacy-urls.json');
const inventory = await readJson('./fixtures/legacy-url-targets.json');
const examples = [
  ['/skills/?id=darktide%3Askill%3Apsyker%3Abrain-burst-improved', 'darktide:skill:psyker:psyker_brain_burst_improved', '顱腦崩裂'],
  ['/blessings/?id=darktide%3Ablessing%3Aarc_rifle%3Ap1-ammo-from-reserve-on-crit&variant=darktide%3Ablessing-variant%3Aarc_rifle%3Ap1-ammo-from-reserve-on-crit&tier=4', 'darktide:blessing:weapon_trait_bespoke_arc_rifle_p1_ammo_from_reserve_on_crit', '名稱待確認'],
  ['/skills/arbites/adamant_ammo_belt/', 'darktide:skill:adamant:adamant_ammo_belt', '彈藥腰帶'],
  ['/skills/arbites/adamant_area_buff_drone_improved/', 'darktide:skill:adamant:adamant_area_buff_drone_improved', '天鷹使節']
];
const url = path => new URL(path, 'https://example.test');

class Element {
  constructor(tag) { this.tagName = tag; this.childNodes = []; this.dataset = {}; this.value = ''; }
  append(...nodes) { this.childNodes.push(...nodes); }
  replaceChildren(...nodes) { this.childNodes = nodes; this.value = ''; }
  removeAttribute() {} setAttribute() {} focus() {}
  set textContent(value) { this.value = String(value); this.childNodes = []; }
  get textContent() { return this.value + this.childNodes.map(n => n.textContent).join(''); }
  querySelector(tag) { return this.childNodes.find(n => n.tagName === tag) ?? null; }
}
function render(path, domains) {
  const original = globalThis.document;
  const originalLocation = globalThis.location;
  globalThis.location = { href: url(path).href };
  globalThis.document = { head: new Element('head'), createElement: tag => new Element(tag), querySelector: () => null, querySelectorAll: () => [] };
  const main = new Element('main');
  try { renderSharedPage({ main, buildMeta: new Element('p'), url: url(path), result: { sourceData: true, manifest: { gameVersion: '1.13.4', dataRevision: 'a'.repeat(64) }, versions: [], domains } }); }
  finally { globalThis.document = original; globalThis.location = originalLocation; }
  return main;
}

// Scenario: Resolve the four production URLs and render small, committed Source-Data fixtures.
// Purpose: Protect URL replacement, the exact selected item, and removal of the obsolete variant.
test('InterT10_四個舊網址改寫並呈現正確項目', async () => {
  const domains = await readJson('./fixtures/legacy-url-details.json');
  const data = Object.fromEntries(['skills', 'weapons', 'blessings', 'terms'].map(category => [category,
    { schemaVersion: '1.1.0', gameVersion: '1.13.4', items: domains.filter(d => d.kind === category || (category === 'blessings' && d.kind === 'blessing')).flatMap(d => d.document.items) }]));
  const rawFiles = new Map([['current.json', Buffer.from('{}')], ...Object.entries(data).map(([category, document]) => [`1.13.4/${category}.json`, Buffer.from(JSON.stringify(document))])]);
  const bundle = buildSiteData({ source: { current: { versions: ['1.13.4'], gameVersion: '1.13.4' }, dataByVersion: { '1.13.4': data }, rawFiles, commit: inventory.commit } });
  const client = createSourceClient({ build: { game_version: '1.13.4', game_releases: bundle.pointers }, fetchImpl: async path => new Response(bundle.files.get(path.slice(1)), { headers: { 'content-type': 'application/json' } }) });
  for (const [old, id, name] of examples) {
    const calls = [];
    const resolved = applyLegacyUrl(url(old), map, { replaceState: (...args) => calls.push(args) });
    assert.equal(resolved.status, 'migrated');
    assert.equal(resolved.url.searchParams.get('id'), id);
    assert.equal(resolved.url.searchParams.get('version'), '1.13.4');
    assert.equal(resolved.url.pathname, old.startsWith('/skills/') ? '/skills/' : '/blessings/');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2], resolved.url.pathname + resolved.url.search + resolved.url.hash);
    const result = await client.load({ pathname: resolved.url.pathname, search: resolved.url.search });
    const page = render(resolved.url.href, result.domains);
    assert.ok(page.textContent.includes(name));
    assert.ok(page.childNodes.some(n => n.dataset.itemId === id));
    assert.equal(page.childNodes.filter(n => n.dataset.itemId).length, 1);
    if (old.includes('variant=')) {
      assert.equal(resolved.url.searchParams.has('variant'), false);
      assert.equal(resolved.url.searchParams.get('tier'), '4');
    }
  }
});

// Scenario: Every committed alias is followed once against the pinned Source-Data identity inventory.
// Purpose: Reject missing targets, collisions, chains and cycles across the entire map.
test('UnitT20_全量對應終止於固定來源且無鏈或循環', () => {
  assert.deepEqual(runtimeMap, { targetVersion: map.targetVersion, ids: map.ids, paths: map.paths, familyPaths: map.familyPaths });
  const targets = new Set(Object.values(inventory.categories).flat());
  assert.equal(inventory.commit, '93185bf9c070da578701fa398e85da9a08b8d4c4');
  assert.equal(Object.keys(map.ids).length, 694);
  for (const [old, id] of Object.entries(map.ids)) {
    assert.ok(targets.has(id), id); assert.ok(!Object.hasOwn(map.ids, id) || map.ids[id] === id, id);
    const kind = old.split(':')[1]; const domain = { skill: 'skills', weapon: 'weapons', blessing: 'blessings', term: 'terms' }[kind];
    const resolved = resolveLegacyUrl(url(`/${domain}/?id=${encodeURIComponent(old)}`), map);
    assert.equal(resolved.url.searchParams.get('id'), id);
    assert.equal(resolveLegacyUrl(resolved.url, map).status, 'unchanged');
  }
  for (const [path, id] of Object.entries(map.paths)) {
    assert.ok(targets.has(id), path);
    const resolved = resolveLegacyUrl(url(path), map);
    assert.equal(resolved.url.searchParams.get('id'), id);
    assert.equal(resolveLegacyUrl(resolved.url, map).status, 'unchanged');
  }
  for (const [path, family] of Object.entries(map.familyPaths)) {
    assert.ok(inventory.weaponFamilies.includes(family));
    const resolved = resolveLegacyUrl(url(path), map);
    assert.equal(resolved.url.pathname, '/weapons/'); assert.equal(resolved.url.searchParams.get('family'), family);
  }
});

// Scenario: All 645 retained index entries are compared by class plus internal key.
// Purpose: Fix the exact missing base-effect list and resolve the eight globally repeated keys safely.
test('UnitT30_留存技能逐筆核對與所有無對應網址顯示找不到', async () => {
  const retained = (await readJson('../content/history/1.13.1/player-index.json')).entries.filter(e => e.kind === 'skill');
  const missing = map.unmapped.filter(e => e.reason === 'missing-class-key:base-effect');
  const classes = {arbites:'adamant',scum:'broker',skitarii:'cryptic',veteran:'veteran',psyker:'psyker',ogryn:'ogryn',zealot:'zealot'};
  assert.equal(retained.length, 645); assert.equal(missing.length, 27);
  assert.equal(retained.filter(e => map.paths[`/skills/${e.id}/`]).length, 618);
  assert.deepEqual(missing.map(e => e.value).sort(), retained.filter(e => !map.paths[`/skills/${e.id}/`]).map(e => `/skills/${e.id}/`).sort());
  for (const row of retained) {
    const [oldClass, key] = row.id.split('/');
    const matches = inventory.skillIdentities.filter(([, archetype, internalKey]) => archetype === classes[oldClass] && internalKey === key);
    assert.ok(matches.length <= 1, row.id);
    assert.equal(map.paths[`/skills/${row.id}/`], matches[0]?.[0]);
  }
  const additional = map.unmapped.filter(e => e.reason.endsWith(':not-in-player-index'));
  assert.deepEqual(additional.map(e => e.value), ['/skills/veteran/veteran_cover_peeking/']);
  assert.equal(map.unmapped.length, 155);
  assert.deepEqual(Object.fromEntries(Object.entries(Object.groupBy(map.unmapped, r => r.reason)).map(([k,v]) => [k,v.length])), {'ambiguous-targets':122,'missing-class-key:base-effect':27,'missing-class-key:base-effect:not-in-player-index':1,'missing-mark-key':3,'missing-family':2});
  for (const row of missing) {
    assert.equal(row.reason, 'missing-class-key:base-effect');
    assert.equal(retained.find(e => `/skills/${e.id}/` === row.value).category, '基礎效果');
  }
  for (const row of map.unmapped) {
    const path = row.kind === 'id' ? `/${row.category}/?id=${encodeURIComponent(row.value)}` : row.value;
    assert.equal(resolveLegacyUrl(url(path), map).status, 'not-found', path);
    const page = render(path, []);
    assert.match(page.textContent, /找不到/); assert.equal(page.childNodes.filter(n => n.dataset.itemId).length, 0);
  }
  for (const c of ['arbites','ogryn','psyker','veteran','zealot']) assert.equal(map.paths[`/skills/${c}/base_toughness_damage_reduction_node_buff_medium_1/`], `darktide:skill:${c === 'arbites' ? 'adamant' : c}:base_toughness_damage_reduction_node_buff_medium_1`);
});

// Scenario: Unknown ids, empty ids and unknown detail paths arrive with a populated catalog.
// Purpose: Prevent a broken detail link from exposing an unfiltered list.
test('UnitT40_不存在的詳情明確找不到且不呈現列表', async () => {
  const domains = await readJson('./fixtures/legacy-url-details.json');
  for (const path of ['/skills/?id=darktide:skill:psyker:no-such-old-id', '/skills/?id=', '/skills/arbites/no-such-skill/', '/blessings/no-such-blessing/', '/weapons/no-such-weapon/', '/blessings/?id=missing', '/weapons/?id=missing']) {
    const page = render(path, domains);
    assert.match(page.textContent, /找不到/, path);
    assert.equal(page.childNodes.filter(n => n.dataset.itemId).length, 0, path);
  }
});

// Scenario: Old URLs explicitly select historical/unknown versions while current URLs select a version.
// Purpose: Old aliases always pin 1.13.4, and new identifiers keep their existing version semantics.
test('UnitT50_舊網址固定版本而新網址不改寫', () => {
  for (const version of ['1.13.2', 'does-not-exist']) {
    const old = url(examples[0][0]); old.searchParams.set('version', version); old.hash = '#notes';
    const resolved = resolveLegacyUrl(old, map);
    assert.equal(resolved.url.searchParams.get('version'), '1.13.4'); assert.equal(resolved.url.hash, '#notes');
  }
  const current = url(`/skills/?id=${examples[0][1]}&version=1.13.2`);
  const calls = []; const resolved = applyLegacyUrl(current, map, { replaceState: (...args) => calls.push(args) });
  assert.equal(resolved.status, 'unchanged'); assert.equal(resolved.url.href, current.href); assert.equal(calls.length, 0);
  assert.equal(resolveLegacyUrl(url('/skills/arbites/adamant_ammo_belt'), map).url.searchParams.get('id'), examples[2][1]);
});

// Scenario: A migration target disappears from the selected release after alias resolution.
// Purpose: Fail explicitly instead of rendering another item or a list.
test('UnitT60_對應目標缺失仍顯示找不到', () => {
  const resolved = resolveLegacyUrl(url(examples[0][0]), map);
  assert.match(render(resolved.url.href, []).textContent, /找不到/);
});

// Scenario: Weapon detail uses only id, or keeps an existing family/mark pair.
// Purpose: Fetch the required family shard and select precisely the requested weapon.
test('InterT70_武器id載入正確分檔且既有family與mark可精確選取', async () => {
  const source = await loadSourceData({ directory: fileURLToPath(new URL('./fixtures/source-data/', import.meta.url)), fixture: true });
  const bundle = buildSiteData({ source }); const item = source.dataByVersion['9.9.2'].weapons.items[0];
  const client = createSourceClient({ build: { game_version: '9.9.2', game_releases: bundle.pointers }, fetchImpl: async path => new Response(bundle.files.get(path.slice(1)), { headers: { 'content-type': 'application/json' } }) });
  const result = await client.load({ pathname: '/weapons/', search: '?id=' + encodeURIComponent(item.id) });
  assert.ok(result.domains.some(d => d.kind === 'weapon-family' && d.document.items.some(i => i.id === item.id)));
  const page = render('/weapons/?id=' + encodeURIComponent(item.id), result.domains);
  assert.ok(page.childNodes.some(n => n.dataset.itemId === item.id));
  const selected = render(`/weapons/?family=${item.values.family}&mark=${item.key}`, result.domains);
  assert.equal(selected.childNodes.filter(n => n.dataset.itemId).length, 1);
  assert.match(render(`/weapons/?family=${item.values.family}&mark=missing`, result.domains).textContent, /找不到/);
});

// Scenario: Two independent sources assign different targets, or introduce a mapping chain.
// Purpose: The offline generator must fail closed rather than silently overwrite aliases.
test('UnitT80_產生器拒絕衝突與對應鏈', () => {
  const input = { migration: { items: [{category:'skills',onlineId:'old',id:'new-a'},{category:'skills',onlineId:'old',id:'new-b'}] }, onlineSkills: {source:{records:[]}}, retainedIndex:{entries:[]}, retainedContent:{skills:[],routes:[],weapons:[],marks:[],blessings:[],variants:[]}, sourceData: { skills:{items:[{id:'new-a'},{id:'new-b'}]}, weapons:{items:[]},blessings:{items:[]},terms:{items:[]} } };
  assert.throws(() => generateLegacyUrls(input), /conflict/);
  input.migration.items = [{category:'skills',onlineId:'old',id:'new-a'},{category:'skills',onlineId:'new-a',id:'new-b'}];
  assert.throws(() => generateLegacyUrls(input), /chain|cycle/);
});

// Scenario: An online skill has an exact localization key shared by different classes.
// Purpose: Require both class and nameKey and keep unmatched lookalike names unmapped.
test('UnitT85_線上技能只用class與nameKey精確對應', () => {
  const item = (id, archetype, nameKey) => ({ id, key: 'shared-key', values: { archetype }, name: { zh: '相同名稱' }, source: { text: { keys: { name: nameKey } } } });
  const input = { migration: { items: [] }, onlineSkills: { source: { records: [
    {kind:'skill',recordId:'darktide:skill:arbites:old',payload:{nameKey:'loc_exact'}},
    {kind:'skill',recordId:'darktide:skill:arbites:lookalike',payload:{nameKey:'loc_similar'}}
  ] } }, retainedIndex:{entries:[]}, retainedContent:{skills:[],routes:[],weapons:[],marks:[],blessings:[],variants:[]}, sourceData: {
    skills:{items:[item('darktide:skill:adamant:actual','adamant','loc_exact'),item('darktide:skill:psyker:other','psyker','loc_exact')]},
    weapons:{items:[]},blessings:{items:[]},terms:{items:[]}
  } };
  const result = generateLegacyUrls(input);
  assert.deepEqual(result.ids, {'darktide:skill:arbites:old':'darktide:skill:adamant:actual'});
  assert.deepEqual(result.unmapped.map(r => [r.value,r.reason]), [['darktide:skill:arbites:lookalike','missing-class-nameKey']]);
  input.sourceData.skills.items.push(item('darktide:skill:adamant:duplicate','adamant','loc_exact'));
  assert.equal(generateLegacyUrls(input).unmapped.find(r => r.value.endsWith(':old')).reason, 'ambiguous-targets');
});

// Scenario: The supplied migration map references an item absent from the target category.
// Purpose: Missing targets must be listed as unmapped rather than shipped as broken redirects.
test('UnitT90_產生器明列缺失目標且不產生導向', () => {
  const result = generateLegacyUrls({migration:{items:[{category:'skills',onlineId:'old',id:'missing'}]},onlineSkills:{source:{records:[]}},retainedIndex:{entries:[]},retainedContent:{skills:[],routes:[],weapons:[],marks:[],blessings:[],variants:[]},sourceData:Object.fromEntries(['skills','weapons','blessings','terms'].map(c=>[c,{items:[]}]))});
  assert.deepEqual(result.ids, {});
  assert.deepEqual(result.unmapped, [{kind:'id',value:'old',category:'skills',reason:'target-not-in-1.13.4',candidates:['missing']}]);
});

// Scenario: Old blessing links contain an incompatible variant or unrelated query/hash state.
// Purpose: Refuse conflicting identities while retaining parameters that can still be used.
test('UnitT95_不相容變體找不到且可用參數與錨點保留', () => {
  const old = url(examples[1][0]); old.searchParams.set('q', '測試'); old.hash = '#notes';
  const migrated = resolveLegacyUrl(old, map);
  assert.equal(migrated.url.searchParams.get('q'), '測試'); assert.equal(migrated.url.hash, '#notes');
  old.searchParams.set('variant', 'unrelated');
  const calls = []; assert.equal(applyLegacyUrl(old, map, {replaceState:(...args)=>calls.push(args)}).status, 'not-found'); assert.equal(calls.length, 0);
  assert.equal(resolveLegacyUrl(url('/skills/?id=constructor'), map).status, 'unchanged');
  const wrongDomain = url(examples[0][0]); wrongDomain.pathname = '/blessings/';
  assert.equal(resolveLegacyUrl(wrongDomain, map).status, 'not-found');
});
