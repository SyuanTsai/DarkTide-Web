import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadSourceData} from '../src/build/source-data.mjs';
// Scenario: 載入含各種單一無效欄位的傷害設定。
// Purpose: 確保巢狀契約逐項拒收無效資料。
test('UnitT10_傷害設定巢狀契約拒收無效資料',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'wp8c-'));try{
 await cp(new URL('./fixtures/source-data-1.1/',import.meta.url),root,{recursive:true});
 const file=path.join(root,'data/0.0.0/weapons.json'), original=JSON.parse(await readFile(file));
 const loc={path:'test.lua',line:1},power={kind:'fixed',min:1,max:1,unknown:null,source:loc};
 const profile={id:'example_light',distributions:[{target:1,range:null,attack:structuredClone(power),impact:structuredClone(power)}],bindings:[{action:'a',kind:'action',template:null,source:loc}],unknown:null,source:loc};
 original.items[0].values.damageProfiles=[profile];
 const load=()=>loadSourceData({directory:root,fixture:true});
 const save=x=>writeFile(file,JSON.stringify(x));
 await save(original);await load();
 const cases=[x=>x.items[0].values.damageProfiles[0].extra=1,x=>x.items[0].values.damageProfiles[0].bindings[0].kind='invalid',x=>{const b=x.items[0].values.damageProfiles[0].bindings[0];b.kind='shotshell';b.powerLevel={value:1,unknown:null,source:loc}},x=>x.items[0].values.attackCombos[0].steps[0].damageProfile='missing'];
 for(const mutate of cases){const copy=structuredClone(original);mutate(copy);await save(copy);await assert.rejects(load());}
 for(const side of ['attack','impact']){
  const invalidPowers=[
   x=>x.min=null,
   x=>x.extra=1,
   x=>{x.kind='unknown';x.unknown='NOT_VERIFIED';},
  ];
  for(const mutate of invalidPowers){const copy=structuredClone(original);mutate(copy.items[0].values.damageProfiles[0].distributions[0][side]);await save(copy);await assert.rejects(load(),/damageProfiles invalid/,`${side} 應拒收無效的威力設定`);}
 }
 await save(original);
 const skillfile=path.join(root,'data/0.0.0/skills.json'), skill=JSON.parse(await readFile(skillfile));skill.items[0].values.damageProfiles=[];await writeFile(skillfile,JSON.stringify(skill));await assert.rejects(load(),/damageProfiles forbidden/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('舊版武器拒收新版傷害設定',async()=>{const root=await mkdtemp(path.join(tmpdir(),'wp8c-old-'));try{await cp(new URL('./fixtures/source-data/',import.meta.url),root,{recursive:true});const file=path.join(root,'data/9.9.1/weapons.json');const data=JSON.parse(await readFile(file));data.items[0].values.damageProfiles=[];await writeFile(file,JSON.stringify(data));await assert.rejects(loadSourceData({directory:root,fixture:true}),/damageProfiles forbidden/);}finally{await rm(root,{recursive:true,force:true});}});
