import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceItemPresentation } from '../web/shared-view.mjs';
import { loadSourceData } from '../src/build/source-data.mjs';
import { buildSourceSite } from '../src/build/build.mjs';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Scenario: A 1.1 blessing has no official Chinese text.
// Purpose: Identify the effect as unofficial without changing the legacy presentation.
test('UnitT10_新版缺少官方中文時標示非官方翻譯', () => {
  const item = { id: 'darktide:blessing:test', name: { zh: '測試' }, official: { zh: null, en: 'test' }, errata: [], explanation: { effect: '效果', conditions: '', calculation: '', notes: '', extra: '' }, values: { params: {} } };
  assert.equal(sourceItemPresentation(item, '1.1.0').effectOrigin, 'unofficial-translation');
  assert.equal(sourceItemPresentation(item, '1.0.0').effectOrigin, undefined);
  item.official.zh = '官方'; item.explanation.conditions = '條件'; item.explanation.calculation = '計算'; item.explanation.notes = '補充'; item.explanation.extra = '額外';
  const official = sourceItemPresentation(item, '1.1.0'); assert.equal(official.effectOrigin, 'official'); assert.deepEqual(official.sections.map(s => s.key), ['effect','conditions','calculation','notes','extra']);
  item.explanation.effectOrigin = 'unofficial-translation'; assert.equal(sourceItemPresentation(item, '1.1.0').effectOrigin, 'unofficial-translation');
});

// Scenario: The checked-in fixtures independently describe each supported schema.
// Purpose: Verify both formats without requiring mixed versions.
test('InterT15_單一schema版本的fixture可載入', async () => {
  for (const name of ['source-data', 'source-data-1.1']) assert.ok((await loadSourceData({ directory: fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url)), fixture: true })).current.versions.length);
});

// Scenario: Independent 1.0 and 1.1 releases and malformed 1.1 extensions are loaded.
// Purpose: Enforce version-specific contracts and cross-file consistency.
test('InterT20_混合版本與新增欄位驗證', async () => {
  const root = await mkdtemp(path.join(fileURLToPath(new URL('../', import.meta.url)), '.wp8b-test-'));
  const read = async p => JSON.parse(await readFile(path.join(root, p)));
  const write = async (p, x) => writeFile(path.join(root, p), JSON.stringify(x));
  try {
    await cp(new URL('./fixtures/source-data/', import.meta.url), root, { recursive: true });
    await cp(new URL('./fixtures/source-data-1.1/data/0.0.0/', import.meta.url), path.join(root, 'data/9.9.3'), { recursive: true });
    for (const category of ['skills', 'weapons', 'blessings', 'terms']) { const p = `data/9.9.3/${category}.json`; const x = await read(p); x.gameVersion = '9.9.3'; await write(p, x); }
    const current = await read('data/current.json'); current.versions.push('9.9.3'); current.gameVersion = '9.9.3'; current.path = 'data/9.9.3'; current.schemaVersion = '1.1.0'; await write('data/current.json', current);
    const load = () => loadSourceData({ directory: root, fixture: true });
    assert.equal((await load()).dataByVersion['9.9.1'].skills.schemaVersion, '1.0.0');
    const repo = fileURLToPath(new URL('../', import.meta.url));
    for (const name of ['web','content/history','content/authoring/v2','content/reference']) await cp(path.join(repo,name),path.join(root,name),{recursive:true});
    await buildSourceSite({root,sourceData:root,fixture:true});
    current.schemaVersion = '1.0.0'; await write('data/current.json', current); await assert.rejects(load(), /current schemaVersion mismatch/); current.schemaVersion = '1.1.0'; await write('data/current.json', current);
    const wp = 'data/9.9.3/weapons.json'; const weapon = await read(wp); const badCurve = structuredClone(weapon); badCurve.items[0].values.bars[0].stats[0].curveId = 'missing'; await write(wp, badCurve); await assert.rejects(load(), /curveId/); await write(wp, weapon);
    const sp = 'data/9.9.3/skills.json'; const skill = await read(sp); const badOrigin = structuredClone(skill); badOrigin.items[0].explanation.effectOrigin = 'invalid'; await write(sp, badOrigin); await assert.rejects(load(), /effectOrigin/); await write(sp, skill);
    const legacyPath = 'data/9.9.1/skills.json'; const legacy = await read(legacyPath); const badLegacy = structuredClone(legacy); badLegacy.items[0].explanation.effectOrigin = 'official'; await write(legacyPath, badLegacy); await assert.rejects(load(), /effectOrigin/); await write(legacyPath, legacy);
    current.schemaVersion = '1.2.0'; await write('data/current.json', current); await assert.rejects(load(), /unsupported schemaVersion/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
