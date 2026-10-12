import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../web/client.mjs';
const rows=[{kind:'weapon',id:'gun',route:'/weapons/gun/'},{kind:'mark',id:'mk1',route:'/weapons/gun/mk1/'},{kind:'blessing',id:'hit',route:'/blessings/hit/'},{kind:'variant',id:'hit/gun',route:'/blessings/hit/gun/'},{kind:'blessing',id:'hit',route:'/blessings/hit/'}];
// Scenario: A blessing contains weapon, mark, and tier relations.
// Purpose: Show only main weapons without model or tier duplication.
test('UnitT10_blessing_relations_show_only_unique_weapons',()=>{
 assert.equal(typeof client.browsingRelations,'function');
 assert.deepEqual(client.browsingRelations('blessing',[...rows,rows[0]]),[rows[0]]);
});
// Scenario: A weapon contains model, blessing, and per-weapon tier links.
// Purpose: Link each canonical blessing once, without models or tier variants.
test('UnitT20_weapon_relations_show_only_unique_blessings',()=>{
 assert.equal(typeof client.browsingRelations,'function');
 assert.deepEqual(client.browsingRelations('weapon',rows),[rows[2]]);
 assert.deepEqual(client.browsingRelations('weapon',[]),[]);
});
// Scenario: A skill has reciprocal mechanics navigation.
// Purpose: Preserve unrelated navigation and source relation input.
test('UnitT30_other_relations_preserved_without_mutating_input',()=>{
 assert.equal(typeof client.browsingRelations,'function');
 const before=structuredClone(rows);
 assert.deepEqual(client.browsingRelations('skill',rows),rows);
 assert.deepEqual(rows,before);
});

// Scenario: Credits may link to an HTML page or an untrusted image host.
// Purpose: Only use original images from approved storage; preserve attachment fallback.
test('UnitT40_original_image_source_is_limited_to_approved_storage',()=>{
 const source='https://github.com/user-attachments/assets/12345678-1234-4234-9234-123456789abc';
 const entry={kind:'skill',id:'x',name_zh_tw:'技能'};
 const present=href=>client.assetPresentation('a'.repeat(64),entry,entry,{path:null,source_url:source,attribution:{href,text:'圖示 © Games Lantern',follow_required:true}}).src;
 const original='https://gameslantern.com/storage/sites/darktide/exporter/talents/veteran/stat/icon.webp';
 assert.equal(present(original),original);
 for(const href of ['https://darktide.gameslantern.com/abilities/example','https://evil.gameslantern.com/storage/sites/darktide/icon.webp','https://gameslantern.com/storage/sites/darktide/../private/icon.webp','https://gameslantern.com/storage/sites/darktide/icon.webp?x=1','https://gameslantern.com/storage/sites/darktide/icon.html']) assert.equal(present(href),source);
});
