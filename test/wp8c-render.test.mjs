import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderWeapon,allNodes} from './wp8c-helper.mjs';
const read=async name=>JSON.parse(await readFile(new URL(`./fixtures/wp8c/${name}.json`,import.meta.url)));
const tables=(page,kind)=>allNodes(page).filter(x=>x.dataset.sourceTable===kind);
const rows=table=>allNodes(table).find(x=>x.tagName==='tbody').childNodes;
const cell=(row,index)=>row.childNodes[index].textContent;
const pageFor=(item,index,blessings)=>renderWeapon(item,index,blessings);

// Scenario: render a real conditional chain with confirmed steps. Purpose: expose the truncated chain's reason in the same table.
test('UnitT10_條件連段同時顯示步驟與原因',async()=>{
 const item=await read('conditional-chain'); const combo=item.values.attackCombos.find(x=>x.unknown==='CONDITIONAL_CHAIN');
 assert.ok(combo.steps.length); const table=tables(pageFor(item,[],[]),'attack-combos')[item.values.attackCombos.indexOf(combo)];
 assert.equal(rows(table).filter(r=>/^\d+$/.test(cell(r,0))).length,combo.steps.length);
 assert.ok(rows(table).some(r=>cell(r,2)==='連段包含條件'));
});

// Scenario: render sampled weapons from source data. Purpose: verify values in their precise table cells and preserve links and null handling.
test('UnitT20_武器表格顯示正確比較點曲線祝福與威力',async()=>{
 const weapons=(await read('weapons')).items, blessings=(await read('blessings-index')).items, index=(await read('weapons-index')).items, online=await read('online');
 for(const sample of online.pages){
  const item=weapons.find(x=>x.id===sample.weaponId), page=pageFor(item,index,blessings);
  for(const kind of ['stat-comparison','curves','damage-profiles','family-marks','blessings']) assert.ok(tables(page,kind).length,`${item.key} ${kind}`);
  assert.doesNotMatch(page.textContent,/未翻譯原因/);
  for(const stat of sample.tables.statComparison?.samples??[]){
   const barIndex=item.values.bars.findIndex(b=>b.stats.some(s=>s.key===stat.statKey)); const bar=item.values.bars[barIndex]; const statIndex=bar.stats.findIndex(s=>s.key===stat.statKey);
   const row=rows(tables(page,'stat-comparison')[barIndex])[statIndex]; assert.equal(cell(row,0),bar.stats[statIndex].name.zh || stat.statKey);
   assert.equal(Number(cell(row,3)),stat.p60); assert.equal(Number(cell(row,4)),stat.p80);
  }
  for(const sampleCurve of sample.tables.curves.samples??[]){
   const curve=item.values.curves.find(c=>c.id.includes(sampleCurve.curveIdContains)); assert.ok(curve);
   const bars=[...new Set(item.values.curves.map(c=>c.bar))], curveIndex=item.values.curves.filter(c=>c.bar===curve.bar).indexOf(curve);
   const row=rows(tables(page,'curves')[bars.indexOf(curve.bar)])[curveIndex]; assert.equal(cell(row,0),curve.name.zh || curve.stat);
   const knots=[...cell(row,3).matchAll(/(\d+(?:\.\d+)?)\s*→\s*(\d+(?:\.\d+)?)/g)].map(m=>[Number(m[1]),Number(m[2])]); assert.deepEqual(knots,sampleCurve.knots);
  }
  const blessingRows=rows(tables(page,'blessings')[0]); assert.equal(blessingRows.length,item.values.blessings.length); assert.equal(blessingRows.length,{'chainaxe_p1_m1':8,'autogun_p1_m1':14,'lasgun_p1_m1':10}[item.key]);
  item.values.blessings.forEach((id,i)=>{const a=allNodes(blessingRows[i]).find(n=>n.tagName==='a'); assert.equal(a.textContent,(blessings.find(b=>b.id===id).name.zh || '名稱待確認')); const url=new URL(a.href,'https://example.test'); assert.equal(url.pathname,'/blessings/'); assert.equal(url.searchParams.get('id'),id); assert.equal(url.searchParams.get('version'),'1.13.4');});
  const bindingTables=tables(page,'damage-profiles').filter(t=>t.childNodes[0].textContent.includes('綁定')); const powerCells=bindingTables.flatMap(rows).map(r=>cell(r,3)); assert.ok(powerCells.every(v=>v!=='0'));
  if(item.key==='autogun_p1_m1') assert.ok(powerCells.includes('700')); if(item.key==='lasgun_p1_m1') assert.ok(powerCells.includes('來源未提供')); {for(const profile of item.values.damageProfiles) for(const binding of profile.bindings.filter(b=>b.powerLevel)) {const table=bindingTables.find(t=>t.childNodes[0].textContent.startsWith(profile.id+' 綁定')); const row=rows(table)[profile.bindings.indexOf(binding)]; assert.equal(cell(row,0),binding.action); assert.equal(cell(row,3),binding.powerLevel.value===null?'來源未提供':String(binding.powerLevel.value));}}
  for(const mark of sample.tables.familyMarks.marks) assert.ok(allNodes(tables(page,'family-marks')[0]).some(x=>x.tagName==='a'&&x.href?.includes(encodeURIComponent(mark))),mark);
 }
 const chain=weapons.find(x=>x.key==='chainaxe_p1_m1'); assert.match(tables(pageFor(chain,index,blessings),'attack-combos')[0].textContent,/連段起始動作不明確/);
});

// Scenario: render the first light-combo step using action bindings or an explicit profile.
// Purpose: verify the complete ordered fallback list and ensure an explicit profile takes precedence without a fallback label.
test('UnitT25_連段傷害設定依綁定完整對應並優先顯示指定設定',async()=>{
 const item=(await read('weapons')).items.find(x=>x.key==='chainaxe_p1_m2');
 const comboIndex=item.values.attackCombos.findIndex(x=>x.id==='light'); const combo=item.values.attackCombos[comboIndex]; const step=combo.steps[0];
 assert.equal(step.action,'action_left_down_light'); assert.equal(step.damageProfile,null);
 const expected=item.values.damageProfiles.filter(p=>p.bindings.some(b=>b.action===step.action)).map(p=>p.id);
 assert.ok(expected.length>1);
 const profileCell=weapon=>cell(rows(tables(pageFor(weapon,[],[]),'attack-combos')[comboIndex])[0],3);
 assert.equal(profileCell(item),`${expected.join('、')}（依動作綁定對應）`);
 const explicit=structuredClone(item); explicit.values.attackCombos[comboIndex].steps[0].damageProfile=expected[0];
 assert.equal(profileCell(explicit),expected[0]);
});

// Scenario: render a legacy weapon. Purpose: preserve the 1.0.0 output byte for byte.
test('UnitT30_1.0.0 武器頁與修改前快照完全一致',async()=>{const legacy=JSON.parse(await readFile(new URL('./fixtures/source-data/data/9.9.2/weapons.json',import.meta.url))).items[0];const family=[{id:legacy.id,family:legacy.values.family,name:legacy.name}];const snapshot=await read('legacy-snapshot');assert.deepEqual(JSON.parse(JSON.stringify(renderWeapon(legacy,family,[],'1.0.0'))),snapshot);});

// Scenario: The blessing index is absent from a weapon detail result.
// Purpose: Preserve each blessing ID in its link and display the fallback name.
test('UnitT40_缺少祝福索引時保留連結與待確認名稱', async () => {
 const item=(await read('weapons')).items[0]; const page=pageFor(item,[],null);
 const links=allNodes(tables(page,'blessings')[0]).filter(n=>n.tagName==='a');
 assert.equal(links.length,item.values.blessings.length);
 links.forEach((link,i)=>{assert.equal(link.textContent,'名稱待確認'); assert.equal(new URL(link.href,'https://example.test').searchParams.get('id'),item.values.blessings[i]);});
});
