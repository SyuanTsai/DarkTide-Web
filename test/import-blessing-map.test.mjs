import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { importBlessingMapCandidates } from '../src/content/import-blessing-map.mjs';

const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');

function input() {
  const map = {
    schema_version: 1, release: 'demo', source_commit: 'a'.repeat(40),
    blessings: [{ id: 'steady_example', name_zh_tw: '虛構穩定', effect: '虛構祝福效果',
      kind: 'ranged', page: 'blessings/entries/steady_example.md' }],
    weapons: [{ id: 'practice_rifle', name_zh_tw: '虛構步槍', kind: 'ranged',
      page: 'blessings/weapons/practice_rifle.md', marks: [{
        id: 'practice_rifle_m1', name: '虛構一型', template_file: 'weapons/practice_rifle_m1.lua'
      }] }],
    variants: [{ id: 'steady_example_rifle', blessing_id: 'steady_example', weapon_id: 'practice_rifle',
      page: 'blessings/entries/steady_example_rifle.md', defined_tiers: [1, 2],
      available_tiers: null, values: { per_stack_percent: [1, 2] } }],
    bindings: [{ blessing_id: 'steady_example', weapon_id: 'practice_rifle',
      mark_id: 'practice_rifle_m1', variant_id: 'steady_example_rifle',
      trait_item: 'traits/example', trait_category: 'ranged', available_tiers: null }]
  };
  const raw = bytes(map);
  const sourceLock = { source_id: 'blessing-map', kind: 'git_file',
    path: 'Game Info/releases/demo/blessings/data/BLESSING_WEAPON_MAP.json', sha256: sha(raw) };
  return { map, sourceLock, sourceBytes: new Map([[sourceLock.source_id, raw]]) };
}

// Scenario: A fixed map contains one complete fictional blessing and weapon relation.
// Purpose: Produce field-located review candidates while withholding numeric values and release approval.
test('UnitT10_imports_complete_map_as_pending_relationship_candidates', async () => {
  const data = input();
  const result = await importBlessingMapCandidates(data);
  assert.equal(result.candidate_kind, 'blessing-map-import');
  assert.equal(result.review_status, 'pending');
  assert.deepEqual(result.counts, { blessings: 1, weapons: 1, marks: 1, variants: 1, bindings: 1 });
  assert.equal(result.blessings[0].effect_zh_tw, '虛構祝福效果');
  assert.deepEqual(result.blessings[0].source_fields.effect_zh_tw,
    { source_id: 'blessing-map', selector: 'json:/blessings/0/effect' });
  assert.equal(result.weapons[0].canonical_route, '/weapons/practice_rifle/');
  assert.equal(result.variants[0].available_tiers, null);
  assert.deepEqual(result.variants[0].numeric_review_fields, ['per_stack_percent']);
  assert.match(result.variants[0].numeric_review_hashes.per_stack_percent, /^[a-f0-9]{64}$/);
  assert.equal(result.variants[0].tier_claims.length, 0);
  assert.equal(result.bindings[0].trait_item, 'traits/example');
  assert.deepEqual(result.bindings[0].source_fields.trait_item,
    { source_id: 'blessing-map', selector: 'json:/bindings/0/trait_item' });
  assert.ok(result.blessings.every(row => row.review_status === 'pending'));
});

// Scenario: The map bytes differ from the declared lock hash.
// Purpose: Refuse unverified bytes before selecting any text or relationship.
test('UnitT20_rejects_map_blob_hash_drift', async () => {
  const data = input();
  data.sourceLock.sha256 = '0'.repeat(64);
  await assert.rejects(() => importBlessingMapCandidates(data), /hash.*drift/i);
});

// Scenario: A binding names a mark owned by another weapon.
// Purpose: Reject a plausible but false blessing and weapon relation.
test('UnitT30_rejects_binding_with_wrong_mark_owner', async () => {
  const data = input();
  data.map.bindings[0].mark_id = 'other_m1';
  const raw = bytes(data.map);
  data.sourceLock.sha256 = sha(raw);
  data.sourceBytes.set('blessing-map', raw);
  await assert.rejects(() => importBlessingMapCandidates(data), /binding.*mark/i);
});

// Scenario: A variant declares an available tier outside its defined tiers.
// Purpose: Preserve the source distinction between defined and available tiers.
test('UnitT40_rejects_undefined_available_tier', async () => {
  const data = input();
  data.map.variants[0].available_tiers = [3];
  const raw = bytes(data.map);
  data.sourceLock.sha256 = sha(raw);
  data.sourceBytes.set('blessing-map', raw);
  await assert.rejects(() => importBlessingMapCandidates(data), /available tier/i);
});

// Scenario: A variant is left without any binding in the map.
// Purpose: Do not create an apparently usable blessing variant with no weapon mark relation.
test('UnitT50_rejects_unbound_variant', async () => {
  const data = input();
  data.map.bindings = [];
  const raw = bytes(data.map);
  data.sourceLock.sha256 = sha(raw);
  data.sourceBytes.set('blessing-map', raw);
  await assert.rejects(() => importBlessingMapCandidates(data), /variant.*binding/i);
});

// Scenario: A binding trait path escapes the relative source namespace.
// Purpose: Keep technical relation paths from becoming arbitrary file references.
test('UnitT60_rejects_unsafe_trait_item_path', async () => {
  const data = input();
  data.map.bindings[0].trait_item = '../outside';
  const raw = bytes(data.map);
  data.sourceLock.sha256 = sha(raw);
  data.sourceBytes.set('blessing-map', raw);
  await assert.rejects(() => importBlessingMapCandidates(data), /trait item path/i);
});

// Scenario: A fixed map changes one numeric value without changing field names or relationships.
// Purpose: Expose a reviewable digest change while keeping unapproved values out of candidates.
test('UnitT70_numeric_value_change_updates_review_hash_only', async () => {
  const original = await importBlessingMapCandidates(input());
  const data = input();
  data.map.variants[0].values.per_stack_percent = [1, 3];
  const raw = bytes(data.map);
  data.sourceLock.sha256 = sha(raw);
  data.sourceBytes.set('blessing-map', raw);
  const changed = await importBlessingMapCandidates(data);
  assert.notEqual(changed.variants[0].numeric_review_hashes.per_stack_percent,
    original.variants[0].numeric_review_hashes.per_stack_percent);
  assert.equal(changed.variants[0].tier_claims.length, 0);
  assert.equal(JSON.stringify(changed).includes('"per_stack_percent":[1,3]'), false);
});
