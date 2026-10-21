import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../web/client.mjs';
const catalog={entries:[{kind:'weapon',id:'a',name_zh_tw:'步槍'},{kind:'weapon',id:'b',name_zh_tw:'手槍'}]};
const level=(weapon,effect,value='5',state='known')=>({record:{weapon_id:weapon,variant_id:weapon+'-v',effect_zh_tw:effect,defined_tiers:[1],tier_claims:[{tier:1,claims:[{claim_id:'damage',state,value,unit:'percent',unit_note:null}]}]},sources:[]});
// Scenario: Two weapons differ only in the explicitly identified weapon-name prefix.
// Purpose: Show one shared effect instead of duplicate weapon cards.
test('UnitT10_groups_matching_effects_without_weapon_prefix',()=>{
 assert.equal(typeof client.groupBlessingEffects,'function');
 const groups=client.groupBlessingEffects([level('a','步槍：命中加成。'),level('b','手槍：命中加成。')],catalog);
 assert.equal(groups.length,1); assert.equal(groups[0].effect,'命中加成。');assert.equal(groups[0].levels.length,2);
});
// Scenario: Conditions, tier values, or confirmation status differ for the same blessing.
// Purpose: Do not erase meaningful weapon differences or treat unknown as known.
test('UnitT20_keeps_different_values_conditions_and_missing_evidence_separate',()=>{
 assert.equal(typeof client.groupBlessingEffects,'function');
 for(const other of [level('b','命中加成。','6'),level('b','擊殺加成。'),level('b','命中加成。',null,'unknown')])
  assert.equal(client.groupBlessingEffects([level('a','命中加成。'),other],catalog).length,2);
 assert.equal(client.groupBlessingEffects([level('a','步槍擊殺時：命中加成。'),level('b','命中加成。')],catalog).length,2);
 assert.deepEqual(client.groupBlessingEffects([],catalog),[]);
});
// Scenario: A class has tree metadata and the visitor enters its ordinary URL or explicitly chooses list.
// Purpose: Make the requested tree visible without a hidden URL flag, preserving list fallback.
test('UnitT30_defaults_to_tree_and_honors_explicit_list',()=>{
 assert.equal(typeof client.preferredSkillView,'function');
 assert.equal(client.preferredSkillView(new URL('https://example.test/skills/arbites/'),true),'tree');
 assert.equal(client.preferredSkillView(new URL('https://example.test/skills/arbites/?view=list'),true),'list');
 assert.equal(client.preferredSkillView(new URL('https://example.test/skills/arbites/?q=guard'),true),'list');
 assert.equal(client.preferredSkillView(new URL('https://example.test/skills/arbites/?view=tree'),false),'list');
});
// Scenario: A skill description contains Chinese sentence/semicolon boundaries and decimal values.
// Purpose: Render separate points without damaging numbers, punctuation, or English abbreviations.
test('UnitT40_splits_skill_effect_sentences_and_preserves_decimal_values',()=>{
 assert.deepEqual(client.mechanicsItems('持續 0.5 秒；命中刷新。\n最多 3 層。'),['持續 0.5 秒；','命中刷新。','最多 3 層。']);
 assert.deepEqual(client.mechanicsItems('1.5 seconds. Keep 2.0 stacks; next.'),['1.5 seconds. Keep 2.0 stacks; next.']);
});
// Scenario: A blessing displays source-defined tiers while availability is unknown for one or more applicable weapons.
// Purpose: Prevent readers from treating defined numerical levels as verified in-game obtainability.
test('UnitT50_discloses_unknown_tier_availability_without_changing_records',()=>{
 assert.equal(typeof client.blessingAvailabilityNote,'function');
 const rows=[{defined_tiers:[1,2,3,4],available_tiers:null},{defined_tiers:[1,2],available_tiers:[2]}];
 const before=structuredClone(rows);
 const note=client.blessingAvailabilityNote(rows);
 assert.equal(note,'以下為來源定義的等級與數值；各等級在遊戲內是否可取得，尚未核實。');
 assert.equal(client.blessingAvailabilityNote([rows[0]]),note);
 assert.equal(client.blessingAvailabilityNote([{defined_tiers:[1]}]),note);
 assert.equal(client.blessingAvailabilityNote([rows[1]]),null);
 assert.equal(client.blessingAvailabilityNote([{defined_tiers:[1],available_tiers:[]}]),null);
 assert.equal(client.blessingAvailabilityNote([]),null);
 assert.deepEqual(rows,before);
});
