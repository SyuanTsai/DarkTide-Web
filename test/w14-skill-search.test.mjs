import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  combineSkillSearchRows,
  filterSkillSearchRows,
  historySkillSearchRows,
} from '../web/shared-render.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const HISTORY_INDEX = path.join(REPO_ROOT, 'content', 'history', '1.13.1', 'player-index.json');
const CURRENT_ID = 'darktide:skill:psyker:brain-burst-improved';
const LEGACY_ID = 'psyker/psyker_brain_burst_improved';

function catalogFor(entries) {
  return { entries: entries.map(({ id, route }) => ({ id, route, kind: 'skill' })) };
}

// Scenario: The pinned 1.13.1 index has 645 localized player skills and canonical routes from its retained catalog.
// Purpose: Keep all searchable baseline rows connected to the complete original skill pages rather than summary-only history pages.
test('UnitT10_maps_retained_history_skills_to_their_catalog_routes', async () => {
  const projection = JSON.parse(await readFile(HISTORY_INDEX, 'utf8'));
  const catalog = catalogFor(projection.entries
    .filter(entry => entry.kind === 'skill')
    .map(entry => ({ id: entry.id, route: `/skills/${entry.id}/` })));
  const rows = historySkillSearchRows(projection, catalog);
  const counts = Object.groupBy(rows, row => row.archetype);

  assert.equal(rows.length, 645);
  assert.deepEqual(Object.keys(counts).sort(), ['arbites', 'ogryn', 'psyker', 'scum', 'skitarii', 'veteran', 'zealot']);
  assert.equal(rows.filter(row => !row.archetype || !row.href.startsWith('/skills/')).length, 0);
  assert.equal(rows.find(row => row.id === 'arbites/adamant_ammo_belt')?.href,
    '/skills/arbites/adamant_ammo_belt/');
});

// Scenario: A current Source ID and the retained Source skill ID are a known identity pair, while an unrelated same-name skill is not.
// Purpose: Merge only the evidence-backed Brain Burst pair, prefer its verified current presentation, and preserve lookalikes as separate rows.
test('UnitT20_merges_only_the_exact_verified_current_and_legacy_skill_identity', () => {
  const projection = {
    gameVersion: '1.13.1',
    entries: [
      { kind: 'skill', id: LEGACY_ID, name: '顱腦崩裂', category: '閃擊', summary: '舊版技能效果' },
      { kind: 'skill', id: 'psyker/other-node', name: '同名技能', category: '天賦', summary: '另一節點' },
    ],
  };
  const catalog = catalogFor([
    { id: LEGACY_ID, route: '/skills/psyker/psyker_brain_burst_improved/' },
    { id: 'psyker/other-node', route: '/skills/psyker/other-node/' },
  ]);
  const historyRows = historySkillSearchRows(projection, catalog);
  const currentRows = [
    {
      archetype: 'psyker', id: CURRENT_ID, name: '顱腦崩裂（已核對現版）', category: '',
      summary: '目前已核對效果', searchText: '顱腦崩裂（已核對現版） 目前已核對效果',
      href: `/skills/?id=${encodeURIComponent(CURRENT_ID)}`,
    },
    {
      archetype: 'psyker', id: 'darktide:skill:psyker:other-unmapped', name: '同名技能', category: '',
      summary: '不同 Source 身分', searchText: '同名技能 不同 Source 身分', href: '/skills/?id=darktide%3Askill%3Apsyker%3Aother-unmapped',
    },
  ];

  const rows = combineSkillSearchRows(currentRows, historyRows);
  const merged = rows.filter(row => row.id === CURRENT_ID);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, '顱腦崩裂（已核對現版）');
  assert.equal(merged[0].summary, '目前已核對效果');
  assert.equal(merged[0].href, `/skills/?id=${encodeURIComponent(CURRENT_ID)}`);
  assert.match(merged[0].searchText, /舊版技能效果/u);
  assert.equal(rows.filter(row => row.name === '同名技能').length, 2);
  assert.equal(rows.find(row => row.id === 'psyker/other-node')?.href, '/skills/psyker/other-node/');
});

// Scenario: A user searches a single skill list and optionally narrows it to one archetype.
// Purpose: Keep text and class filtering available without introducing historical/current version groups.
test('UnitT30_filters_unified_skill_rows_by_query_and_archetype', () => {
  const rows = [
    { archetype: 'psyker', searchText: '顱腦崩裂 brain burst' },
    { archetype: 'arbites', searchText: '彈藥腰帶 彈藥容量' },
    { archetype: 'psyker', searchText: '靈能爆破' },
  ];

  assert.deepEqual(filterSkillSearchRows(rows, { query: '顱腦崩裂' }), [rows[0]]);
  assert.deepEqual(filterSkillSearchRows(rows, { query: '彈藥容量', archetype: 'arbites' }), [rows[1]]);
  assert.deepEqual(filterSkillSearchRows(rows, { query: '彈藥容量', archetype: 'psyker' }), []);
});
