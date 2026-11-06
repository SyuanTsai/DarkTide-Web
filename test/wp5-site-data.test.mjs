import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSourceData, CATEGORIES } from '../src/build/source-data.mjs';
import { buildSiteData, MAX_DOMAIN_BYTES, weaponFamilyPaths } from '../src/build/site-data.mjs';
import { sha256 } from '../src/static/common.mjs';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createSharedViewModel } from '../web/shared-view.mjs';
// Scenario: Two families map to the same generated name. Purpose: Fail with both identities rather than overwrite a shard.
test('UnitT05_型號檔名碰撞時列出衝突型號', () => {
  assert.throws(() => weaponFamilyPaths(['a?', 'a!'], () => '0'.repeat(64)), /a[?!].*a[?!]/);
});
// Scenario: Split both fixture versions twice. Purpose: preserve source items and deterministic manifests.
test('UnitT10_分檔保留完整item且雜湊大小與決定性正確', async () => {
  const source = await loadSourceData({ directory: fileURLToPath(new URL('./fixtures/source-data/', import.meta.url)), fixture: true });
  const a = buildSiteData({ source }); const b = buildSiteData({ source });
  assert.deepEqual(a, b);
  assert.equal(a.pointers.length, 2);
  for (const pointer of a.pointers) {
    const manifest = JSON.parse(a.files.get(pointer.manifest_path.slice(1)));
    for (const file of manifest.files) {
      const bytes = a.files.get(`data/${manifest.dataRevision}/${file.path}`);
      assert.equal(file.sha256, sha256(bytes)); assert.equal(file.sizeBytes, bytes.length);
      assert.ok(bytes.length <= MAX_DOMAIN_BYTES);
    }
    for (const category of CATEGORIES) {
      const docs = manifest.files.filter(f => f.kind === category || f.kind === ({ weapons: 'weapon-family', blessings: 'blessing' })[category]);
      const items = docs.flatMap(f => JSON.parse(a.files.get(`data/${manifest.dataRevision}/${f.path}`)).items).sort((a,b)=>a.id.localeCompare(b.id));
      assert.deepStrictEqual(items, source.dataByVersion[pointer.game_version][category].items);
    }
    assert.equal(manifest.files.some(f=>f.kind==='game-changes'), pointer.game_version==='9.9.2');
  }
  for (const [name, bytes] of source.rawFiles) assert.deepEqual(a.files.get(`source-data/${name}`), bytes);
});

// Scenario: First fixture version receives the exact frozen W12 domain.
// Purpose: Keep old-format history readable while generating new-format later changes.
test('UnitT20_凍結資料接入與fixture新增移除變動皆可讀', async () => {
  const source=await loadSourceData({directory:fileURLToPath(new URL('./fixtures/source-data/',import.meta.url)),fixture:true});
  const frozen=JSON.parse(await readFile(new URL('../content/history/1.13.4/game-changes.json',import.meta.url)));
  const bundle=buildSiteData({source,frozen:{'9.9.1':frozen}});
  const first=bundle.pointers[0];const old=JSON.parse(bundle.files.get(`data/${first.data_revision}/domains/game-changes.json`));
  assert.deepStrictEqual(old,frozen);
  const view=createSharedViewModel({domains:[old],gameReleaseId:old.gameReleaseId});assert.equal(view.getGameChanges({}).items.length,18);
  const next=bundle.pointers[1];const changes=JSON.parse(bundle.files.get(`data/${next.data_revision}/domains/game-changes.json`));
  assert.deepEqual([...new Set(changes.changes.map(c=>c.type))].sort(),['added','changed','removed']);
  assert.deepEqual(changes.changes.filter(c=>c.type==='changed').map(c=>c.fields.map(f=>f.path)),[['explanation.effect'],['explanation.effect'],['explanation.effect'],['explanation.effect']]);
});
