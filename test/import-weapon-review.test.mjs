import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { importWeaponReviewCandidates } from '../src/content/import-weapon-review.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const mark = (id, status, template = null) => ({
  mark_id: id, item_kind: 'ranged', item_path: `content/items/weapons/player/ranged/${id}`,
  ui_item_line: 10, ui_name_line: 11,
  template_path: template, template_git_blob: template ? 'b'.repeat(40) : null,
  template_raw_sha256: template ? 'c'.repeat(64) : null,
  base_stat_category_candidates: status === 'map_ui_template_matched' ? ['damage'] : null,
  base_stat_category_parse_rule: status === 'map_ui_template_matched' ? 'mark_id_prefix' : null,
  source_status: status, review_status: 'pending'
});

function input() {
  const mapTemplate = 'scripts/settings/equipment/weapon_templates/practice/practice_rifle_p1_m1.lua';
  const queue = {
    queue_schema: 1, source_commit: 'a'.repeat(40),
    input_receipt_sha256: { map: '1'.repeat(64), registry: '2'.repeat(64),
      ui: '3'.repeat(64), stats: '4'.repeat(64) },
    summary: { ui_family_candidates: 2, ui_mark_candidates: 3,
      map_weapon_families: 1, ui_only_families: 1,
      item_kind_counts: { ranged: 2 },
      mark_source_status_counts: { map_ui_template_matched: 1,
        ui_missing_registered_template: 1, ui_registry_outside_map: 1 },
      registered_marks_absent_from_ui: 1,
      source_tree_marks_absent_from_registry_and_ui: 0 },
    weapons: [{ weapon_id: 'practice_rifle_p1', item_kind: 'ranged',
      canonical_route_candidate: '/weapons/practice_rifle_p1/', in_blessing_map: true,
      marks: [mark('practice_rifle_p1_m1', 'map_ui_template_matched', mapTemplate),
        mark('practice_rifle_p1_m2', 'ui_missing_registered_template')],
      review_status: 'pending', publish_decision: 'pending' },
    { weapon_id: 'practice_knife_p1', item_kind: 'ranged',
      canonical_route_candidate: '/weapons/practice_knife_p1/', in_blessing_map: false,
      marks: [mark('practice_knife_p1_m1', 'ui_registry_outside_map',
        'scripts/settings/equipment/weapon_templates/practice/practice_knife_p1_m1.lua')],
      review_status: 'pending', publish_decision: 'pending' }],
    registered_marks_absent_from_ui: [{ mark_id: 'practice_rifle_p1_m3',
      lexical_family_candidate: 'practice_rifle_p1', template_path: mapTemplate,
      template_git_blob: 'b'.repeat(40), template_raw_sha256: 'c'.repeat(64), review_status: 'pending' }],
    source_tree_marks_absent_from_registry_and_ui: [], publication_ready: false,
    limits: 'Fictional technical review metadata only.'
  };
  const blessingMap = { candidate_kind: 'blessing-map-import', review_status: 'pending',
    weapons: [{ weapon_id: 'practice_rifle_p1', kind: 'ranged', name_zh_tw: '虛構步槍',
      mark_ids: ['practice_rifle_p1_m1'], source_fields: { name_zh_tw: {
        source_id: 'fictional-map', selector: 'json:/weapons/0/name_zh_tw' } }, review_status: 'pending' }],
    marks: [{ mark_id: 'practice_rifle_p1_m1', weapon_id: 'practice_rifle_p1',
      name_zh_tw: '虛構一型', template_file: mapTemplate,
      source_fields: { name_zh_tw: { source_id: 'fictional-map',
        selector: 'json:/weapons/0/marks/0/name' } }, review_status: 'pending' }] };
  const queueBytes = new TextEncoder().encode(JSON.stringify(queue));
  return { queue, queueBytes, queueSha256: sha(queueBytes),
    sourceCommit: 'a'.repeat(40), blessingMap };
}

// Scenario: A fixed UI queue has one map weapon, an extra UI mark, and a UI-only weapon.
// Purpose: Join verified map text to technical IDs while withholding unreviewed UI-only names and publication.
test('UnitT10_joins_weapon_queue_to_map_as_pending_candidates', async () => {
  const result = await importWeaponReviewCandidates(input());
  assert.deepEqual(result.counts, { weapons: 2, marks: 3, map_weapons: 1, ui_only_weapons: 1 });
  assert.equal(result.weapons.find(row => row.weapon_id === 'practice_rifle_p1').name_zh_tw, '虛構步槍');
  assert.equal(result.weapons.find(row => row.weapon_id === 'practice_knife_p1').name_zh_tw, null);
  assert.equal(result.marks.find(row => row.mark_id === 'practice_rifle_p1_m2').name_zh_tw, null);
  assert.equal(result.marks.find(row => row.mark_id === 'practice_rifle_p1_m1').base_stat_category_candidates[0], 'damage');
  assert.deepEqual(result.registered_marks_absent_from_ui, ['practice_rifle_p1_m3']);
  assert.equal(result.publication_ready, false);
  assert.ok(result.weapons.every(row => row.review_status === 'pending'));
  assert.ok(result.marks.every(row => row.review_status === 'pending'));
  assert.equal(JSON.stringify(result).includes('Fictional technical review metadata only.'), false);
});

// Scenario: The queue bytes differ from the caller's fixed digest or commit.
// Purpose: Refuse a stale or substituted review receipt before joining candidates.
test('UnitT20_rejects_queue_hash_or_commit_drift', async () => {
  const data = input();
  await assert.rejects(() => importWeaponReviewCandidates({ ...data, queueSha256: '0'.repeat(64) }), /hash.*drift/i);
  await assert.rejects(() => importWeaponReviewCandidates({ ...data, sourceCommit: '0'.repeat(40) }), /commit.*mismatch/i);
});

// Scenario: A queue claims that a map mark belongs to a different weapon.
// Purpose: Prevent a false owner join even when the queue digest itself is valid.
test('UnitT30_rejects_map_mark_owner_mismatch', async () => {
  const data = input();
  data.blessingMap.marks[0].weapon_id = 'practice_other_p1';
  await assert.rejects(() => importWeaponReviewCandidates(data), /map.*mark|mark.*map/i);
});

// Scenario: The queue asserts release approval or repeats a UI mark.
// Purpose: Keep technical review input separate from publication and unambiguous by ID.
test('UnitT40_rejects_publishable_or_duplicate_queue', async () => {
  for (const change of [
    queue => { queue.publication_ready = true; },
    queue => { queue.weapons[1].marks[0].mark_id = 'practice_rifle_p1_m1'; }
  ]) {
    const data = input();
    change(data.queue);
    data.queueBytes = new TextEncoder().encode(JSON.stringify(data.queue));
    data.queueSha256 = sha(data.queueBytes);
    await assert.rejects(() => importWeaponReviewCandidates(data));
  }
});

// Scenario: A technical queue carries an unexpected player-facing name on a UI-only row.
// Purpose: Keep unchecked text out of imported review candidates despite a valid queue digest.
test('UnitT50_does_not_import_unreviewed_ui_text', async () => {
  const data = input();
  data.queue.weapons[1].name_zh_tw = '未審核名稱';
  data.queueBytes = new TextEncoder().encode(JSON.stringify(data.queue));
  data.queueSha256 = sha(data.queueBytes);
  const result = await importWeaponReviewCandidates(data);
  assert.equal(result.weapons.find(row => row.weapon_id === 'practice_knife_p1').name_zh_tw, null);
  assert.equal(JSON.stringify(result).includes('未審核名稱'), false);
});

// Scenario: A queue summary claims a larger catalog than the rows actually contain.
// Purpose: Refuse a partial queue rather than treating its missing records as absent weapons.
test('UnitT60_rejects_queue_summary_count_mismatch', async () => {
  const data = input();
  data.queue.summary.ui_mark_candidates += 1;
  data.queueBytes = new TextEncoder().encode(JSON.stringify(data.queue));
  data.queueSha256 = sha(data.queueBytes);
  await assert.rejects(() => importWeaponReviewCandidates(data), /count mismatch/i);
});
