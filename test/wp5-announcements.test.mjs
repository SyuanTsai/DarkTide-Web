import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadAnnouncements } from '../src/build/announcements.mjs';
import { fileURLToPath } from 'node:url';
import { announcementsNewestFirst } from '../web/shared-render.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
// Scenario: The announcement list page. Purpose: the newest announcement is shown first, same-day posts keep a stable order.
test('UnitT30_公告列表依發布日期倒序且同日依ID倒序', async () => {
  const actual = await loadAnnouncements(root);
  const ordered = announcementsNewestFirst(actual.items);
  assert.equal(ordered[0].announcementId, 'official:darktide:announcement:2026-11-19-sisters-novitiate-weapons');
  assert.equal(ordered.at(-1).announcementId, 'official:darktide:announcement:2026-09-18-balance-preview');
  for (let i = 1; i < ordered.length; i++) {
    const [prev, cur] = [ordered[i - 1], ordered[i]];
    assert.ok(prev.publishedOn > cur.publishedOn || (prev.publishedOn === cur.publishedOn && prev.announcementId > cur.announcementId), cur.announcementId);
  }
  assert.equal(actual.items[0].announcementId, 'official:darktide:announcement:2026-09-18-balance-preview', 'source order is unchanged');
});
const project = x=>{const text={announcementId:x.announcementId}; const walk=(v,p)=>{if(Array.isArray(v))v.forEach((r,i)=>walk(r,p+'['+i+']'));else if(v&&typeof v==='object')for(const [k,r]of Object.entries(v)){if(typeof r==='string'&&/^(?:text|title|alt|caption|label|heading)$/.test(k))text[p?p+'.'+k:k]=r;else if(r&&typeof r==='object')walk(r,p?p+'.'+k:k);}};walk(x,'');return text;};
const NEW_IDS = [
  'official:darktide:announcement:2026-11-05-expeditions-map-layout-update',
  'official:darktide:announcement:2026-11-10-teaser-trailer',
  'official:darktide:announcement:2026-11-12-grandfathers-gifts-event',
  'official:darktide:announcement:2026-11-12-sisters-novitiate-announcement',
  'official:darktide:announcement:2026-11-16-sisters-novitiate-class-design',
  'official:darktide:announcement:2026-11-19-sisters-novitiate-weapons'
];
// Scenario: Load the Web authoring batches without compose. Purpose: preserve the earlier eight announcements unchanged.
test('UnitT10_既有八筆公告ID與顯示欄位維持不變', async () => {
  const actual = await loadAnnouncements(root);
  const expected = JSON.parse(await readFile(new URL('./fixtures/wp5/announcements-expected.json', import.meta.url)));
  assert.match(expected.source.sha256, /^[a-f0-9]{64}$/);
  const expectedIds = new Set(expected.items.map(item => item.announcementId));
  const earlier = actual.items.filter(item => expectedIds.has(item.announcementId));
  assert.deepStrictEqual(earlier.map(project), expected.items);
  assert.ok(actual.items.length >= 14);
});
// Keep the six published additions and apply the record invariants to every batch.
test('UnitT20_保留20261125六筆ID且所有公告皆符合通用條件', async () => {
  const actual = await loadAnnouncements(root);
  const added = actual.items.filter(item => NEW_IDS.includes(item.announcementId));
  assert.deepStrictEqual(added.map(item => item.announcementId), NEW_IDS);
  for (const item of actual.items) {
    assert.equal(item.scope, 'official-document');
    assert.match(item.source.locator, /^https:\/\/forums\.fatsharkgames\.com\/t\/[\w-]+\/\d+$/);
    assert.match(item.source.sha256, /^[a-f0-9]{64}$/);
    assert.match(item.title, /[一-鿿]/);
    const assetIds = new Set(item.assets.map(asset => asset.assetId));
    const blockIds = [];
    const checkLinks = inline => {
      for (const part of inline ?? []) {
        if (part.kind !== 'link') continue;
        // Earlier records also cross-link to the site's migrated announcement routes.
        assert.match(part.href, /^(?:https:\/\/|\/announcements\/\?id=official%3Adarktide%3Aannouncement%3A[\w.-]+$)/);
      }
    };
    const visit = block => {
      blockIds.push(block.blockId);
      if (block.kind === 'image') assert.ok(assetIds.has(block.assetRef.assetId), block.blockId);
      checkLinks(block.inline);
      for (const child of block.blocks ?? []) visit(child);
      for (const listItem of block.items ?? []) visitListItem(listItem);
    };
    const visitListItem = item => {
      blockIds.push(item.blockId);
      checkLinks(item.inline);
      for (const child of item.children ?? []) visitListItem(child);
    };
    item.blocks.forEach(visit);
    assert.equal(new Set(blockIds).size, blockIds.length, item.announcementId + ' block ids must be unique');
    for (const asset of item.assets) assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    for (const [field, value] of Object.entries(project(item))) {
      if (!/text$/.test(field) || value.length < 40) continue;
      assert.match(value, /[一-鿿]/, item.announcementId + ' ' + field + ' must be translated');
    }
  }
});
