import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadSourceData } from '../src/build/source-data.mjs';
import { buildSourceSite } from '../src/build/build.mjs';

const fixture = fileURLToPath(new URL('./fixtures/source-data-1.1/', import.meta.url));
const cases = [
  ['武器effectOrigin', 'weapons', i => { i.explanation.effectOrigin = 'official'; }],
  ['術語effectOrigin', 'terms', i => { i.explanation.effectOrigin = 'official'; }],
  ['未知explanation欄位', 'skills', i => { i.explanation.surprise = 'x'; }],
  ['重複curve id', 'weapons', i => { i.values.curves.push(structuredClone(i.values.curves[0])); }],
  ['curve額外欄位', 'weapons', i => { i.values.curves[0].extra = 1; }],
  ['curve input額外欄位', 'weapons', i => { i.values.curves[0].input.extra = 1; }],
  ['knot額外欄位', 'weapons', i => { i.values.curves[0].knots[0].extra = 1; }],
  ['knot範圍', 'weapons', i => { i.values.curves[0].knots[0].input = 2; }],
  ['interpolation enum', 'weapons', i => { i.values.curves[0].interpolation = 'cubic'; }],
  ['combo kind enum', 'weapons', i => { i.values.attackCombos[0].kind = 'other'; }],
  ['combo額外欄位', 'weapons', i => { i.values.attackCombos[0].extra = 1; }],
  ['combo step額外欄位', 'weapons', i => { i.values.attackCombos[0].steps[0].extra = 1; }],
  ['retainedFrom textBatch格式', 'skills', i => { i.retainedFrom = {gameVersion:'1.0', sourceCommit:'a'.repeat(40), textBatch:'bad value'}; }],
  ['retainedFrom額外欄位', 'skills', i => { i.retainedFrom = {gameVersion:'1.0', sourceCommit:'a'.repeat(40), textBatch:'ok', extra:1}; }],
  ['anchor occurrence下界', 'skills', i => { i.errata = [{locale:'en',official:'x',corrected:'x',valueRef:'/x',anchor:{field:'official',locale:'en',text:'x',occurrence:0}}]; }],
  ['anchor額外欄位', 'skills', i => { i.errata = [{locale:'en',official:'x',corrected:'x',valueRef:'/x',anchor:{field:'official',locale:'en',text:'x',occurrence:1,extra:1}}]; }],
  ['curve source line下界', 'weapons', i => { i.values.curves[0].source.line = 0; }],
  ['curve source空path', 'weapons', i => { i.values.curves[0].source.path = ''; }],
  ['curve未知原因enum', 'weapons', i => { i.values.curves[0].unknown = 'invalid'; }],
  ['curve unknown與輸出衝突', 'weapons', i => { i.values.curves[0].interpolation = 'unknown'; }],
  ['curve knot數量', 'weapons', i => { i.values.curves[0].knots.pop(); }],
  ['combo loopsTo下界', 'weapons', i => { i.values.attackCombos[0].loopsTo = -1; }],
  ['combo未知原因enum', 'weapons', i => { i.values.attackCombos[0].unknown = 'invalid'; }],
  ['combo傷害原因不一致', 'weapons', i => { i.values.attackCombos[0].steps[0].damageProfile = null; i.values.attackCombos[0].steps[0].damageProfileUnknown = null; }],
  ['anchor field enum', 'skills', i => { i.errata = [{locale:'en',official:'x',corrected:'x',valueRef:'/x',anchor:{field:'other',locale:'en',text:'x',occurrence:1}}]; }],
  ['anchor locale enum', 'skills', i => { i.errata = [{locale:'en',official:'x',corrected:'x',valueRef:'/x',anchor:{field:'official',locale:'other',text:'x',occurrence:1}}]; }],
  ['anchor空text', 'skills', i => { i.errata = [{locale:'en',official:'x',corrected:'x',valueRef:'/x',anchor:{field:'official',locale:'en',text:'',occurrence:1}}]; }],
];
for (const [label, select, fields] of [
  ['curve', i => i.values.curves[0], ['id','bar','stat','name','input','interpolation','knots','outputUnit','unknown','source']],
  ['curve input', i => i.values.curves[0].input, ['source','unit','min','max']],
  ['knot', i => i.values.curves[0].knots[0], ['input','output']],
  ['curve source', i => i.values.curves[0].source, ['path','line']],
  ['combo', i => i.values.attackCombos[0], ['id','kind','start','steps','loopsTo','unknown','source']],
  ['combo step', i => i.values.attackCombos[0].steps[0], ['action','input','name','damageProfile','damageProfileUnknown']],
  ['stat', i => i.values.bars[0].stats[0], ['curveId']],
]) for (const field of fields) cases.push([`${label}缺少${field}`, 'weapons', i => { delete select(i)[field]; }]);
for (const field of ['gameVersion','sourceCommit','textBatch']) cases.push([`retainedFrom缺少${field}`, 'skills', i => { i.retainedFrom = {gameVersion:'1.0',sourceCommit:'a'.repeat(40),textBatch:'ok'}; delete i.retainedFrom[field]; }]);
for (const field of ['field','locale','text','occurrence']) cases.push([`anchor缺少${field}`, 'skills', i => { i.errata = [{locale:'en',official:'x',corrected:'x',valueRef:'/x',anchor:{field:'official',locale:'en',text:'x',occurrence:1}}]; delete i.errata[0].anchor[field]; }]);
for (const [label, select, fields] of [
  ['curve', i => i.values.curves[0], ['id','bar','stat','name','input','interpolation','knots','outputUnit','unknown','source']],
  ['curve input', i => i.values.curves[0].input, ['source','unit','min','max']],
  ['knot', i => i.values.curves[0].knots[0], ['input','output']],
  ['curve source', i => i.values.curves[0].source, ['path','line']],
  ['combo', i => i.values.attackCombos[0], ['id','kind','start','steps','loopsTo','unknown','source']],
  ['combo step', i => i.values.attackCombos[0].steps[0], ['action','input','name','damageProfile','damageProfileUnknown']],
  ['stat', i => i.values.bars[0].stats[0], ['curveId']],
]) for (const field of fields) cases.push([`${label}的${field}型別錯誤`, 'weapons', i => { select(i)[field] = {}; }]);
for (const field of ['gameVersion','sourceCommit','textBatch']) cases.push([`retainedFrom的${field}型別錯誤`, 'skills', i => { i.retainedFrom = {gameVersion:'1.0',sourceCommit:'a'.repeat(40),textBatch:'ok'}; i.retainedFrom[field] = {}; }]);
for (const field of ['field','locale','text','occurrence']) cases.push([`anchor的${field}型別錯誤`, 'skills', i => { i.errata = [{locale:'en',official:'x',corrected:'x',valueRef:'/x',anchor:{field:'official',locale:'en',text:'x',occurrence:1}}]; i.errata[0].anchor[field] = {}; }]);
for (const [name, category, mutate] of cases) {
  // Scenario: A single schema field is malformed in an otherwise valid fixture.
  // Purpose: Reject the named contract violation before building.
  test(`InterT30_拒絕${name}`, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wp8b-contract-'));
    try {
      await cp(fixture, dir, {recursive:true});
      const file = path.join(dir, 'data/0.0.0', `${category}.json`);
      const data = JSON.parse(await readFile(file)); mutate(data.items[0]);
      await writeFile(file, JSON.stringify(data));
      await assert.rejects(loadSourceData({directory:dir, fixture:true}), /Source-Data/);
    } finally { await rm(dir, {recursive:true, force:true}); }
  });
}

// Scenario: A legacy item in each category carries the 1.1-only origin field.
// Purpose: The version gate applies consistently to all four categories.
for (const category of ['skills','weapons','blessings','terms']) test(`InterT35_拒絕1.0的${category}帶effectOrigin`, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wp8b-legacy-'));
  try {
    await cp(fileURLToPath(new URL('./fixtures/source-data/', import.meta.url)), dir, {recursive:true});
    const file = path.join(dir, 'data/9.9.1', `${category}.json`);
    const data = JSON.parse(await readFile(file)); data.items[0].explanation.effectOrigin = 'official';
    await writeFile(file, JSON.stringify(data));
    await assert.rejects(loadSourceData({directory:dir,fixture:true}), /effectOrigin/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

// Scenario: Each damaged sidecar is used by a complete build over an existing dist.
// Purpose: Input rejection must preserve the previous output bytes.
test('InterT40_損壞sidecar的完整建置保留dist', async () => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wp8b-build-'));
  try {
    for (const name of ['web','content/history','content/authoring/v2','content/reference']) await cp(path.join(repo,name), path.join(dir,name), {recursive:true});
    const opts = {root:dir,sourceData:path.join(repo,'test/fixtures/source-data'),fixture:true};
    await buildSourceSite(opts);
    const collect = async (folder, prefix = '') => { const result = {}; for (const e of await readdir(folder,{withFileTypes:true})) { const name = prefix + e.name; if (e.isDirectory()) Object.assign(result, await collect(path.join(folder,e.name), name + '/')); else result[name] = await readFile(path.join(folder,e.name)); } return result; };
    const before = await collect(path.join(dir,'dist'));
    const sidecar = path.join(dir,'content/reference/term-rules/v1.json');
    const original = await readFile(sidecar);
    for (const damage of ['missing','json','duplicate','target']) {
      if (damage === 'missing') await rm(sidecar);
      else if (damage === 'json') await writeFile(sidecar, '{');
      else { const x = JSON.parse(original); if (damage === 'duplicate') x.rules.rules[1].ruleId = x.rules.rules[0].ruleId; else delete x.rules.rules[0].targetText; await writeFile(sidecar, JSON.stringify(x)); }
      await assert.rejects(buildSourceSite(opts), undefined, damage);
      assert.deepEqual(await collect(path.join(dir,'dist')), before, damage);
      await writeFile(sidecar, original);
    }
  } finally { await rm(dir, {recursive:true,force:true}); }
});
