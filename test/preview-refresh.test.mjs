import test from 'node:test';import assert from 'node:assert/strict';import {createDataClient} from '../web/client.mjs';
const build={schema_version:2,data_revision:'a'.repeat(64),build_id:'b'.repeat(64),game_version:'1.13.1',package_kind:'published'};
const response=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
// Scenario: Data is unchanged but the published front-end build has changed.
// Purpose: Detect UI-only updates, which cannot be detected by missing data files.
test('UnitT10_detects_frontend_only_update_without_waiting_for_404',async()=>{
 const calls=[];const client=createDataClient({build,fetchImpl:async(url,options)=>{calls.push({url,options});return response({...build,build_id:'c'.repeat(64)});}});
 assert.equal(typeof client.hasBuildUpdate,'function');assert.equal(await client.hasBuildUpdate(),true);
 assert.deepEqual(calls,[{url:'/version.json',options:{cache:'no-store'}}]);
});
// Scenario: The running app and published build still match.
// Purpose: Avoid pointless page reloads and retain normal navigation.
test('UnitT20_matching_build_keeps_current_page',async()=>{
 const client=createDataClient({build,fetchImpl:async()=>response(build)});
 assert.equal(typeof client.hasBuildUpdate,'function');assert.equal(await client.hasBuildUpdate(),false);
});
// Scenario: The version endpoint is unreachable or returns invalid data.
// Purpose: Keep existing read-only browsing available without claiming the version is current.
test('UnitT30_unavailable_version_does_not_force_reload',async()=>{
 for(const fetchImpl of [async()=>{throw new Error('offline');},async()=>response({}),async()=>new Response('bad',{status:503})]){
 const client=createDataClient({build,fetchImpl});assert.equal(typeof client.hasBuildUpdate,'function');assert.equal(await client.hasBuildUpdate(),null);
 }
});
