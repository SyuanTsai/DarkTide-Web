import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadSourceData } from '../src/build/source-data.mjs';
import { buildSiteData, weaponFamilyPaths } from '../src/build/site-data.mjs';
import { createSourceClient } from '../web/source-client.mjs';
// Scenario: A history filter refers to a version without a data manifest.
// Purpose: Fetch only the selected Source-Data version.
test('UnitT05_紀錄篩選不載入其他版本的 manifest', async () => {
  const source = await loadSourceData({ directory: fileURLToPath(new URL('./fixtures/source-data/', import.meta.url)), fixture: true });
  const bundle = buildSiteData({ source }); const paths = [];
  const client = createSourceClient({ build: { game_version: '9.9.2', game_releases: bundle.pointers }, fetchImpl: async url => { paths.push(url); return new Response(bundle.files.get(url.slice(1)), { headers: { 'content-type': 'application/json' } }); } });
  const result = await client.load({ pathname: '/game-changes/', search: '?version=9.9.2&changes_version=1.13.3' });
  assert.equal(result.manifest.gameVersion, '9.9.2');
  assert.equal(paths.filter(path => path.endsWith('/manifest.json')).length, 1);
});
// Scenario: Weapon families include parentheses, Chinese and spaces.
// Purpose: Every generated shard path is accepted by the browser manifest validator.
test('UnitT07_特殊型號分檔可由用戶端讀取', async () => {
  const source = await loadSourceData({ directory: fileURLToPath(new URL('./fixtures/source-data/', import.meta.url)), fixture: true });
  const families = ['family(test)', '中文', 'family test'];
  const items = source.dataByVersion['9.9.2'].weapons.items;
  source.dataByVersion['9.9.2'].weapons.items = families.map((family, i) => ({ ...items[i % items.length], id: `weapon-${i}`, values: { ...items[i % items.length].values, family } }));
  const bundle = buildSiteData({ source });
  const client = createSourceClient({ build: { game_version: '9.9.2', game_releases: bundle.pointers }, fetchImpl: async url => new Response(bundle.files.get(url.slice(1)), { headers: { 'content-type': 'application/json' } }) });
  for (const family of families) {
    const result = await client.load({ pathname: '/weapons/', search: `?family=${encodeURIComponent(family)}` });
    assert.equal(result.domains.find(domain => domain.kind === 'weapon-family').document.items[0].values.family, family);
  }
});
// Scenario: The browser receives verified manifests and domains, then corrupted bytes.
// Purpose: Keep version selection exact and refuse a file which differs from its manifest pin.
test('UnitT10_用戶端驗證版本與分檔雜湊並拒絕損毀資料',async()=>{
  const source=await loadSourceData({directory:fileURLToPath(new URL('./fixtures/source-data/',import.meta.url)),fixture:true});
  const bundle=buildSiteData({source});const build={source_data:true,game_version:'9.9.2',package_kind:'fixture',game_releases:bundle.pointers};
  let corrupt=false;
  const fetchImpl=async url=>new Response(corrupt&&url.endsWith('skills.json')?'{}':bundle.files.get(url.slice(1)),{headers:{'content-type':'application/json; charset=utf-8'}});
  const client=createSourceClient({build,fetchImpl});
  const first=await client.load({search:'?version=9.9.1'});assert.equal(first.manifest.gameVersion,'9.9.1');
  const current=await client.load({pathname:'/skills/'});assert.equal(current.manifest.gameVersion,'9.9.2');
  assert.deepEqual(current.domains.find(d=>d.kind==='skills').document.items,source.dataByVersion['9.9.2'].skills.items);
  await assert.rejects(client.load({search:'?version=9.9.3'}),/Unknown/);
  corrupt=true;await assert.rejects(client.load({pathname:'/skills/',force:true}),/hash mismatch/);
});

// Scenario: Navigate only to skills, then one weapon family.
// Purpose: Lists use indexes and details fetch only the selected shard.
test('UnitT20_路由僅讀取需要的分檔',async()=>{
  const source=await loadSourceData({directory:fileURLToPath(new URL('./fixtures/source-data/',import.meta.url)),fixture:true});const bundle=buildSiteData({source});const paths=[];
  const client=createSourceClient({build:{game_version:'9.9.2',game_releases:bundle.pointers},fetchImpl:async url=>{paths.push(url);return new Response(bundle.files.get(url.slice(1)),{headers:{'content-type':'application/json'}});}});
  await client.load({pathname:'/skills/'});
  assert.deepEqual(paths.map(p=>p.split('/').at(-1)).sort(),['manifest.json','skills.json','terms.json']);
  paths.length=0;await client.load({pathname:'/weapons/',search:'?family=family_a'});
  const names=weaponFamilyPaths(['family_a','family_b']);
  assert.ok(paths.some(p=>p.endsWith(names.get('family_a'))));assert.ok(!paths.some(p=>p.endsWith(names.get('family_b'))));
});
