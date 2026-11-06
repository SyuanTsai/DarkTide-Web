import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSourceData, CATEGORIES } from '../src/build/source-data.mjs';
import { buildSiteData, MAX_DOMAIN_BYTES } from '../src/build/site-data.mjs';
import { sha256 } from '../src/static/common.mjs';
import { fileURLToPath } from 'node:url';
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
