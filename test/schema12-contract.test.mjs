import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSourceData } from '../src/build/source-data.mjs';
import { buildSiteData } from '../src/build/site-data.mjs';
import { sourceItemPresentation } from '../web/shared-view.mjs';

const fixture = fileURLToPath(new URL('./fixtures/source-data-1.2/', import.meta.url));
async function check(category, change, shouldPass = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'schema12-'));
  try {
    await cp(fixture, dir, { recursive: true });
    const file = path.join(dir, 'data/0.0.0', `${category}.json`);
    const data = JSON.parse(await readFile(file));
    change(data.items[0]);
    await writeFile(file, JSON.stringify(data));
    const load = loadSourceData({ directory: dir, fixture: true });
    if (shouldPass) await load; else await assert.rejects(load, /Source-Data/);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
test('schema12 接受完整 fixture 與不解析關聯的引用', async () => {
  await check('skills', i => { i.source.valueSources['/missing'] = [{ path: 'x', line: 1 }]; }, true);
});
test('schema12 接受 mechanics 各種 scalar 與 array', async () => {
  await check('skills', i => { i.values.mechanics = { a:{value:0}, b:{value:'x'}, c:{value:false}, d:{value:null,unknown:'DYNAMIC_VALUE'}, e:{value:[1,'x',true,null]} }; }, true);
});
test('schema12 接受與資料無關的合法 citation 和 anchor', async () => {
  await check('skills', i => { i.citations = [{section:'notes',text:'unrelated',codeRefs:[],valueRefs:['/missing']}]; i.errata[0].anchor.itemId = 'darktide:term:missing'; }, true);
});
test('schema12 資料原樣傳遞且不顯示新增欄位', async () => {
  const source = await loadSourceData({directory:fixture, fixture:true});
  const site = buildSiteData({source});
  const raw = site.files.get('source-data/0.0.0/skills.json');
  assert.deepEqual(raw, source.rawFiles.get('0.0.0/skills.json'));
  const skill = source.dataByVersion['0.0.0'].skills.items[0];
  const domain = [...site.files].find(([name]) => name.endsWith('/domains/skills.json'))[1];
  assert.deepEqual(JSON.parse(domain).items[0], skill);
  const blessing = source.dataByVersion['0.0.0'].blessings.items[0];
  const shard = [...site.files].find(([name]) => name.includes('/domains/blessings/') && name.endsWith('.json'))[1];
  assert.deepEqual(JSON.parse(shard).items[0], blessing);
  const presentation = sourceItemPresentation(skill, '1.2.0');
  for (const key of ['mechanics','valueSources','codeRefs','citations']) assert.equal(Object.hasOwn(presentation, key), false);
  assert.deepEqual(presentation.errata.map(x => [x.official,x.corrected]), [['1','2']]);
});
const cases = [
  ['mechanics key', 'skills', i => { i.values.mechanics['Bad'] = {value: 1}; }],
  ['mechanics value type', 'skills', i => { i.values.mechanics['buff.duration'].value = {}; }],
  ['mechanics unknown', 'skills', i => { i.values.mechanics['buff.duration'].value = null; }],
  ['mechanics extra key', 'skills', i => { i.values.mechanics['buff.duration'].extra = 1; }],
  ['mechanics unit', 'skills', i => { i.values.mechanics['buff.duration'].unit = 'Bad'; }],
  ['weapons mechanics', 'weapons', i => { i.values.mechanics = {}; }],
  ['terms mechanics', 'terms', i => { i.values.mechanics = {}; }],
  ['tier mechanics', 'blessings', i => { i.values.tiers[0].mechanics.bad = {value: null}; }],
  ['valueSources pointer', 'skills', i => { i.source.valueSources = {'invalid': [{path:'x',line:1}]}; }],
  ['valueSources empty', 'skills', i => { i.source.valueSources['/mechanics/buff.duration'] = []; }],
  ['valueSources location', 'skills', i => { i.source.valueSources['/mechanics/buff.duration'][0].line = 0; }],
  ['codeRefs key', 'skills', i => { i.source.codeRefs = {'bad': {path:'x',symbol:'y',sha256:'a'.repeat(64)}}; }],
  ['codeRefs consistency', 'skills', i => { i.source.codeRefs['scripts/example.lua#templates.example'].path = 'other'; }],
  ['codeRefs hash', 'skills', i => { i.source.codeRefs['scripts/example.lua#templates.example'].sha256 = 'A'.repeat(64); }],
  ['citations section', 'skills', i => { i.citations[0].section = 'other'; }],
  ['citations empty references', 'skills', i => { i.citations[0].codeRefs = []; i.citations[0].valueRefs = []; }],
  ['citations duplicate', 'skills', i => { i.citations[0].valueRefs.push(i.citations[0].valueRefs[0]); }],
  ['citations category', 'weapons', i => { i.citations = []; }],
  ['errata singular', 'skills', i => { i.errata[0].valueRef = '/params/bonus'; }],
  ['errata sources', 'skills', i => { i.errata[0].sources = []; }],
  ['errata valueRefs', 'skills', i => { i.errata[0].valueRefs = []; }],
  ['anchor locale', 'skills', i => { i.errata[0].anchor.locale = 'zh'; }],
  ['anchor itemId', 'skills', i => { i.errata[0].anchor.itemId = 'invalid'; }],
  ['displayParameter param', 'skills', i => { delete i.errata[0].anchor.param; }],
  ['displayParameter blessing tier', 'blessings', i => { delete i.errata[0].anchor.tier; }],
  ['official anchor forbids param', 'skills', i => { i.errata[0].anchor.field = 'official'; }],
  ['mechanics object', 'skills', i => { i.values.mechanics = []; }],
  ['mechanics key depth', 'skills', i => { i.values.mechanics['a.b.c.d.e.f.g.h.i'] = {value:1}; }],
  ['mechanics array member', 'skills', i => { i.values.mechanics['buff.duration'].value = [1, {}]; }],
  ['mechanics missing value', 'skills', i => { delete i.values.mechanics['buff.duration'].value; }],
  ['mechanics invalid unknown', 'blessings', i => { i.values.tiers[0].mechanics['buff.tier'].unknown = 'invalid'; }],
  ['mechanics unexpected unknown', 'skills', i => { i.values.mechanics['buff.duration'].unknown = 'NOT_VERIFIED'; }],
  ['valueSources object', 'skills', i => { i.source.valueSources = []; }],
  ['valueSources path', 'skills', i => { i.source.valueSources['/mechanics/buff.duration'][0].path = ''; }],
  ['valueSources extra property', 'skills', i => { i.source.valueSources['/mechanics/buff.duration'][0].extra = 1; }],
  ['codeRefs object', 'skills', i => { i.source.codeRefs = []; }],
  ['codeRefs symbol consistency', 'skills', i => { i.source.codeRefs['scripts/example.lua#templates.example'].symbol = 'other'; }],
  ['codeRefs extra property', 'skills', i => { i.source.codeRefs['scripts/example.lua#templates.example'].line = 1; }],
  ['citations array', 'skills', i => { i.citations = {}; }],
  ['citations text', 'skills', i => { i.citations[0].text = ''; }],
  ['citations extra property', 'skills', i => { i.citations[0].extra = 1; }],
  ['citations codeRefs array', 'skills', i => { i.citations[0].codeRefs = 'scripts/example.lua#templates.example'; }],
  ['citations codeRef syntax', 'skills', i => { i.citations[0].codeRefs = ['bad']; }],
  ['citations codeRef duplicate', 'skills', i => { i.citations[0].codeRefs.push(i.citations[0].codeRefs[0]); }],
  ['citations valueRefs array', 'skills', i => { i.citations[0].valueRefs = '/x'; }],
  ['citations valueRef pointer', 'skills', i => { i.citations[0].valueRefs = ['bad']; }],
  ['errata array', 'skills', i => { i.errata = {}; }],
  ['errata locale', 'skills', i => { delete i.errata[0].anchor; i.errata[0].locale = 'bad'; }],
  ['errata official', 'skills', i => { i.errata[0].official = 1; }],
  ['errata corrected', 'skills', i => { i.errata[0].corrected = 1; }],
  ['errata pointer', 'skills', i => { i.errata[0].valueRefs = ['bad']; }],
  ['errata source path', 'skills', i => { i.errata[0].sources[0].path = ''; }],
  ['errata source extra', 'skills', i => { i.errata[0].sources[0].extra = 1; }],
  ['errata extra property', 'skills', i => { i.errata[0].extra = 1; }],
  ['displayParameter param pattern', 'skills', i => { i.errata[0].anchor.param = 'Bad'; }],
  ['displayParameter tier range', 'blessings', i => { i.errata[0].anchor.tier = 5; }],
  ['citations terms', 'terms', i => { i.citations = []; }],
  ['codeRefs missing path', 'skills', i => { delete i.source.codeRefs['scripts/example.lua#templates.example'].path; }],
  ['codeRefs missing symbol', 'skills', i => { delete i.source.codeRefs['scripts/example.lua#templates.example'].symbol; }],
  ['codeRefs missing sha256', 'skills', i => { delete i.source.codeRefs['scripts/example.lua#templates.example'].sha256; }],
  ['valueSources line integer', 'skills', i => { i.source.valueSources['/mechanics/buff.duration'][0].line = 1.5; }],
  ['valueSources missing path', 'skills', i => { delete i.source.valueSources['/mechanics/buff.duration'][0].path; }],
  ['valueSources missing line', 'skills', i => { delete i.source.valueSources['/mechanics/buff.duration'][0].line; }],
  ['errata source line', 'skills', i => { i.errata[0].sources[0].line = 0; }],
  ['errata valueRefs not array', 'skills', i => { i.errata[0].valueRefs = '/params/bonus'; }],
  ['errata sources not array', 'skills', i => { i.errata[0].sources = {}; }],
  ['displayParameter tier integer', 'blessings', i => { i.errata[0].anchor.tier = 1.5; }],
  ['name anchor forbids tier', 'blessings', i => { i.errata[0].anchor.field = 'name'; delete i.errata[0].anchor.param; }],
];
for (const field of ['section','text','codeRefs','valueRefs']) cases.push([`citations missing ${field}`, 'skills', i => { delete i.citations[0][field]; }]);
for (const field of ['locale','official','corrected','valueRefs','sources']) cases.push([`errata missing ${field}`, 'skills', i => { if (field === 'locale') delete i.errata[0].anchor; delete i.errata[0][field]; }]);
for (const [name, category, mutate] of cases) test(`schema12 rejects ${name}`, () => check(category, mutate));

for (const version of ['1.0.0', '1.1.0']) for (const field of ['mechanics', 'valueSources', 'codeRefs', 'citations']) {
  test(`schema ${version} rejects ${field}`, async () => {
    const source = version === '1.0.0' ? './fixtures/source-data/' : './fixtures/source-data-1.1/';
    const dir = await mkdtemp(path.join(os.tmpdir(), 'schema12-legacy-'));
    try {
      await cp(fileURLToPath(new URL(source, import.meta.url)), dir, { recursive: true });
      const current = JSON.parse(await readFile(path.join(dir, 'data/current.json')));
      const file = path.join(dir, 'data', current.gameVersion, 'skills.json');
      const data = JSON.parse(await readFile(file)); const item = data.items[0];
      if (field === 'mechanics') item.values.mechanics = {};
      else if (field === 'citations') item.citations = [];
      else item.source[field] = {};
      await writeFile(file, JSON.stringify(data));
      await assert.rejects(loadSourceData({directory:dir, fixture:true}), new RegExp(field));
    } finally { await rm(dir, {recursive:true, force:true}); }
  });
}
for (const version of ['1.0.0', '1.1.0']) test(`schema ${version} rejects tier mechanics`, async () => {
  const source = version === '1.0.0' ? './fixtures/source-data/' : './fixtures/source-data-1.1/';
  const dir = await mkdtemp(path.join(os.tmpdir(), 'schema12-tier-'));
  try {
    await cp(fileURLToPath(new URL(source, import.meta.url)), dir, {recursive:true});
    const current = JSON.parse(await readFile(path.join(dir,'data/current.json')));
    const file = path.join(dir, 'data', current.gameVersion, 'blessings.json');
    const data = JSON.parse(await readFile(file)); data.items[0].values.tiers[0].mechanics = {};
    await writeFile(file, JSON.stringify(data));
    await assert.rejects(loadSourceData({directory:dir,fixture:true}), /tier mechanics/);
  } finally { await rm(dir, {recursive:true,force:true}); }
});
