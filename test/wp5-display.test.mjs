import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sourceItemPresentation } from '../web/shared-view.mjs';
// Scenario: Source items contain explanations, unknown parameters, glossary and tiers.
// Purpose: Keep display fields distinct and suppress empty sections.
test('UnitT10_直接欄位顯示五節勘誤未知值與祝福等級', async () => {
  const read = async category => JSON.parse(await readFile(new URL(`./fixtures/source-data/data/9.9.2/${category}.json`, import.meta.url))).items;
  const skills = await read('skills'); const blessings = await read('blessings');
  const first = sourceItemPresentation(skills[0]);
  assert.equal(first.sections.length, 5); assert.equal(first.official.zh, '官方原文');
  assert.ok(first.params.some(p => p.value === '原始碼未公開'));
  const second = sourceItemPresentation(skills[1]); assert.equal(second.sections.length, 1); assert.equal(second.unofficial, true);
  assert.deepEqual(sourceItemPresentation(blessings[0]).tiers.map(t=>t.label), ['LV1', 'LV2', 'LV3', 'LV4']);
  assert.ok(sourceItemPresentation(blessings[0]).errata.length > 0);
});
