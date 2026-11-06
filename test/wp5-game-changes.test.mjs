import test from 'node:test';
import assert from 'node:assert/strict';
import { diffGameVersions, buildGameChangesDomain } from '../src/build/game-changes.mjs';

const categories = ['skills', 'weapons', 'blessings', 'terms'];
const item = (id, value, source = 'a') => ({ id, name: { zh: id }, official: {}, values: { value }, explanation: {}, errata: [], source });
const version = items => Object.fromEntries(categories.map(category => [category, { items: category === 'skills' ? items : [] }]));

// Scenario: Two versions add, remove and change items while source metadata also changes.
// Purpose: Preserve stable, precise changes and ignore source-only differences.
test('UnitT10_比較版本並忽略來源差異', () => {
  const previous = version([item('a', 1), item('b', 2), item('d', 4)]);
  const current = version([item('b', 2.125, 'b'), item('c', 3), item('d', 4, 'b')]);
  const changes = diffGameVersions({ previous, current });
  assert.deepStrictEqual(changes.map(x => [x.category, x.id, x.type]), [
    ['skills', 'a', 'removed'], ['skills', 'b', 'changed'], ['skills', 'c', 'added']
  ]);
  assert.deepStrictEqual(changes[1].fields, [{ path: 'values.value', previous: 2, current: 2.125 }]);
  assert.deepStrictEqual(changes[1].name, { zh: 'b' });
  assert.equal(JSON.stringify(changes), JSON.stringify(diffGameVersions({ previous, current })));
});

// Scenario: The first version has no predecessor, with and without frozen data.
// Purpose: Do not invent changes and retain a frozen historical domain.
test('UnitT20_第一版採用凍結資料或不產生紀錄', () => {
  const frozen = { legacy: true };
  const args = { versions: ['1.0', '1.1'], dataByVersion: { '1.0': version([]), '1.1': version([]) }, gameVersion: '1.0' };
  assert.equal(buildGameChangesDomain(args), null);
  assert.deepStrictEqual(buildGameChangesDomain({ ...args, frozen }), frozen);
  assert.deepStrictEqual(buildGameChangesDomain({ ...args, gameVersion: '1.1' }), { gameVersion: '1.1', previousGameVersion: '1.0', changes: [] });
});

// Scenario: Nested arrays change one value and object keys arrive in different orders.
// Purpose: Report the exact changed path without spurious differences from key ordering.
test('UnitT30_巢狀陣列欄位路徑與物件鍵順序', () => {
  const oldItem = item('a', 1);
  const newItem = item('a', 1);
  oldItem.values = { tiers: [{ tier: 1, params: { power: 0.123456789 } }], other: { a: 1, b: 2 } };
  newItem.values = { other: { b: 2, a: 1 }, tiers: [{ params: { power: 0.123456788 }, tier: 1 }] };
  assert.deepStrictEqual(diffGameVersions({ previous: version([oldItem]), current: version([newItem]) })[0].fields,
    [{ path: 'values.tiers.0.params.power', previous: 0.123456789, current: 0.123456788 }]);
});

// Scenario: The frozen historical domain is read from the repository.
// Purpose: Detect changes to the exact bytes recorded in the provenance document.
test('UnitT40_凍結歷史資料雜湊與來源紀錄一致', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const bytes = await readFile(new URL('../content/history/1.13.4/game-changes.json', import.meta.url));
  const description = await readFile(new URL('../content/history/1.13.4/README.md', import.meta.url), 'utf8');
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, '2569ddfeb2b8e1250a69869163a66f132776569e64558ab8ff8806f6cb66bc5c');
  assert.ok(description.includes(hash));
});
// Scenario: Read the portable module source. Purpose: prevent Web dependencies.
test('UnitT50_模組僅可依賴Node內建模組', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/build/game-changes.mjs', import.meta.url), 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g)) assert.ok(match[1].startsWith('node:'));
});
