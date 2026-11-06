import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadAnnouncements } from '../src/build/announcements.mjs';
import { fileURLToPath } from 'node:url';
// Scenario: Load the two Web authoring batches without compose. Purpose: preserve all current announcement text.
test('UnitT10_公告八筆ID與顯示欄位符合現行分檔', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const actual = await loadAnnouncements(root);
  const expected = JSON.parse(await readFile(new URL('./fixtures/wp5/announcements-expected.json', import.meta.url)));
  assert.match(expected.source.sha256, /^[a-f0-9]{64}$/);
  const project = x=>{const text={announcementId:x.announcementId}; const walk=(v,p)=>{if(Array.isArray(v))v.forEach((r,i)=>walk(r,p+'['+i+']'));else if(v&&typeof v==='object')for(const [k,r]of Object.entries(v)){if(typeof r==='string'&&/^(?:text|title|alt|caption|label|heading)$/.test(k))text[p?p+'.'+k:k]=r;else if(r&&typeof r==='object')walk(r,p?p+'.'+k:k);}};walk(x,'');return text;};
  assert.deepStrictEqual(actual.items.map(project), expected.items);
  assert.equal(actual.items.length, 8);
});
