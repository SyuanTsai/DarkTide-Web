import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadAnnouncements } from '../src/build/announcements.mjs';
import { fileURLToPath } from 'node:url';
// Scenario: Load the two Web authoring batches without compose. Purpose: preserve all current announcement text.
test('UnitT10_公告八筆ID與顯示欄位符合現行分檔', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const actual = await loadAnnouncements(root);
  const old = JSON.parse(await readFile(new URL('../content/contracts/w09/proposals/00df56f240b76463ff8e29c80d17009ae7c2e67b120711715fca575b6ee4b045/candidate/domains/announcements.json', import.meta.url))).web.announcements;
  const display = x => Object.fromEntries(['announcementId', 'scope', 'title', 'publishedOn', 'revision', 'source', 'blocks', 'assets'].map(k=>[k,x[k]]));
  assert.deepStrictEqual(actual.items, old.map(display));
  assert.equal(actual.items.length, 8);
});
