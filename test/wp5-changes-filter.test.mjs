import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSharedViewModel } from '../web/shared-view.mjs';
import { sourceChangesFilter } from '../web/shared-render.mjs';

// Scenario: Frozen 1.13.4 data contains records from earlier releases.
// Purpose: Keep data selection independent of the historical record filter.
test('UnitT10_凍結資料版本與紀錄版本獨立', () => {
  const changes = JSON.parse(readFileSync(new URL('../content/history/1.13.4/game-changes.json', import.meta.url)));
  const items = createSharedViewModel({ domains: [changes], gameReleaseId: changes.gameReleaseId }).getGameChanges({}).items;
  const all = sourceChangesFilter(new URL('https://example.test/game-changes/?version=1.13.4'), items);
  const filtered = sourceChangesFilter(new URL('https://example.test/game-changes/?version=1.13.4&changes_version=1.13.3'), items);
  assert.equal(all.length, 18);
  assert.ok(filtered.length > 0 && filtered.length < 18);
  assert.ok(filtered.every(item => item.gameVersion === '1.13.3'));
});
