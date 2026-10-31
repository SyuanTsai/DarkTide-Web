import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { filterSkillSearchRows, historySkillSearchRows } from '../web/shared-render.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const HISTORY_INDEX = path.join(REPO_ROOT, 'content', 'history', '1.13.1', 'player-index.json');

// Scenario: The fixed 1.13.1 player index contains localized historical skills for seven archetypes.
// Purpose: Keep every searchable historical result tied to its explicit archetype and the isolated history detail route.
test('UnitT10_maps_all_historical-skills-to-archetypes-and-versioned-details', async () => {
  const projection = JSON.parse(await readFile(HISTORY_INDEX, 'utf8'));
  const rows = historySkillSearchRows(projection);
  const counts = Object.groupBy(rows, row => row.archetype);

  assert.equal(rows.length, 645);
  assert.deepEqual(Object.keys(counts).sort(), ['arbites', 'ogryn', 'psyker', 'scum', 'skitarii', 'veteran', 'zealot']);
  assert.equal(rows.filter(row => !row.archetype).length, 0);
  assert.ok(rows.every(row => row.version === '1.13.1' && row.href.startsWith('/history/1.13.1/?')));
  assert.equal(rows.find(row => row.id === 'arbites/adamant_ammo_belt')?.href,
    '/history/1.13.1/?id=arbites%2Fadamant_ammo_belt&type=skill');
});

// Scenario: Current and historical entries share a search term while version and archetype filters change.
// Purpose: Prevent old skill summaries from appearing as current results and keep both filters composable with name or summary search.
test('UnitT20_filters_combined_skills_by_query_version_and_archetype', () => {
  const rows = [
    { version: '1.13.4', archetype: 'psyker', searchText: '靈能爆破 brain burst' },
    { version: '1.13.1', archetype: 'arbites', searchText: '彈藥腰帶 技能 彈藥容量' },
    { version: '1.13.1', archetype: 'psyker', searchText: '靈能爆破 歷史摘要' },
  ];

  assert.deepEqual(filterSkillSearchRows(rows, { query: '靈能爆破' }), [rows[0], rows[2]]);
  assert.deepEqual(filterSkillSearchRows(rows, { query: '彈藥容量', version: '1.13.1', archetype: 'arbites' }), [rows[1]]);
  assert.deepEqual(filterSkillSearchRows(rows, { query: '彈藥容量', version: '1.13.4', archetype: 'arbites' }), []);
});
