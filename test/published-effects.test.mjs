import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// Scenario: The published blessing pages were delivered with missing effects despite existing public source descriptions.
// Purpose: Prevent accepting a release with blank core blessing/weapon effects again.
test('InterT10_published_blessings_have_effects_for_every_weapon',()=>{
 const c=JSON.parse(fs.readFileSync(new URL('../content/published/content.json',import.meta.url)));
 assert.deepEqual(c.blessings.filter(b=>!b.effect_zh_tw).map(b=>b.blessing_id),[]);
 assert.deepEqual(c.variants.filter(b=>!b.effect_zh_tw).map(b=>b.variant_id),[]);
});
// Scenario: Reviewed blessing repairs and the Holy Tools correction change only their explicitly approved public records.
// Purpose: Reject accidental source, number, relation, or tree mutations during content recovery.
test('InterT20_effect_repairs_preserve_all_other_public_fields',()=>{
 const before=JSON.parse(fs.readFileSync(new URL('../docs/acceptance/content-ux-20261011/content.before.json',import.meta.url)));
 const after=JSON.parse(fs.readFileSync(new URL('../content/published/content.json',import.meta.url)));
 const report=JSON.parse(fs.readFileSync(new URL('../docs/acceptance/content-ux-20261011/player-text-repair.json',import.meta.url)));
 assert.equal(report.patches.length,45);
 for(const p of report.patches){const rows=p.kind==='blessing'?before.blessings:before.variants;const id=p.kind==='blessing'?'blessing_id':'variant_id';const row=rows.find(r=>r[id]===p.id);assert.equal(row.effect_zh_tw,null);row.effect_zh_tw=p.after;assert.match(p.pinned_sha256,/^[a-f0-9]{64}$/);}
 const review=JSON.parse(fs.readFileSync(new URL('../docs/acceptance/content-ux-20261011/inapplicable-claims-review.json',import.meta.url)));
 assert.equal(review.removed.length,276);
 for(const item of review.removed){const tier=before.variants.find(v=>v.variant_id===item.variant_id).tier_claims.find(t=>t.tier===item.tier);assert.equal(item.claim.state,'unknown');tier.claims=tier.claims.filter(c=>c.claim_id!==item.claim.claim_id);}
 for(const p of review.effectPatches){const b=before.blessings.find(b=>b.blessing_id===p.blessing_id);assert.equal(b.effect_zh_tw,p.before);b.effect_zh_tw=p.after;}
 const holyBefore=JSON.parse(fs.readFileSync(new URL('../docs/acceptance/holy-tools-20261011/before.json',import.meta.url)));
 const holyAfter=JSON.parse(fs.readFileSync(new URL('../docs/acceptance/holy-tools-20261011/after.json',import.meta.url)));
 const holySources=JSON.parse(fs.readFileSync(new URL('../docs/acceptance/holy-tools-20261011/public-sources.json',import.meta.url)));
 const holyIndex=before.skills.findIndex(s=>s.archetype==='zealot'&&s.skill_id==='zealot_weapon_special_damage');
 assert.deepEqual(before.skills[holyIndex],holyBefore,'Holy Tools baseline must match the reviewed before record');
 before.skills[holyIndex]=holyAfter;
 assert.equal(holySources.length,4);
 assert.ok(holySources.every(s=>s.source_id.startsWith('holy-tools-')));
 before.sources.push(...holySources);
 assert.deepEqual(after,before);
});
