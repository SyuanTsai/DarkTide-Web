import test from 'node:test';
import assert from 'node:assert/strict';
import { deployVerifiedArtifact, assertDeploymentConfig, verifyOrigin } from '../src/deploy/cloudflare.mjs';
import { sha256 } from '../src/static/common.mjs';

const settings = { account_id:'38d350980998e83d3f405aff0170921a', name:'darktide-zh-tw',
 workers_dev:true, compatibility_date:'2026-10-12',
 assets:{directory:'./dist',not_found_handling:'none'},
 routes:[{pattern:'darktide.tw-syuan.com',custom_domain:true}] };
const artifact = { package_kind:'published',build_id:'a'.repeat(64),data_revision:'b'.repeat(64) };
function harness({failAt}={}) {
 const calls=[];
 const deps={
  verify:async()=>artifact,
  api:async(endpoint, options={})=>{
   calls.push(['api',endpoint,options]);
   if(endpoint.endsWith('/deployments') && !options.method)return {deployments:[{versions:[{version_id:'old-id',percentage:100}]}]};
   return {};
  },
  deploy:async(config)=>{calls.push(['deploy',config]);if(failAt===config)throw new Error('failed');},
  check:async(origin)=>{calls.push(['check',origin]);if(failAt===origin)throw new Error('check failed');},
  record:async(value)=>calls.push(['record',value])
 };
 return {calls,deps};
}
// Scenario: Missing credential while a valid artifact is present.
// Purpose: Stop before any API call or upload; never prompt for OAuth automatically.
test('UnitT10_missing_token_stops_before_external_calls',async()=>{
 const h=harness();
 await assert.rejects(deployVerifiedArtifact({token:'',config:settings},h.deps),/CLOUDFLARE_API_TOKEN/);
 assert.deepEqual(h.calls,[]);
});
// Scenario: A verified fixture is accidentally selected.
// Purpose: Prevent demonstration data from reaching either public Worker.
test('UnitT20_fixture_cannot_be_deployed',async()=>{
 const h=harness();h.deps.verify=async()=>({...artifact,package_kind:'fixture'});
 await assert.rejects(deployVerifiedArtifact({token:'secret',config:settings},h.deps),/published/);
 assert.deepEqual(h.calls,[]);
});
// Scenario: Runtime settings add an application entry or wrong origin.
// Purpose: Preserve the pure static deployment boundary.
test('UnitT30_rejects_backend_or_wrong_domain',()=>{
 assert.throws(()=>assertDeploymentConfig({...settings,main:'worker/index.mjs'}),/static/);
 assert.throws(()=>assertDeploymentConfig({...settings,routes:[{pattern:'other.example',custom_domain:true}]}),/domain/);
});
// Scenario: An authentication or authorization error occurs before deployment.
// Purpose: Do not upload either Worker when preflight access failed.
test('UnitT35_preflight_permission_failure_stops_all_uploads',async()=>{
 const h=harness();h.deps.api=async()=>{throw new Error('HTTP 403');};
 await assert.rejects(deployVerifiedArtifact({token:'secret',config:settings},h.deps),/403/);
 assert.ok(!h.calls.some(x=>x[0]==='deploy'));
});
// Scenario: Editor is granted only to the production and preview Workers, not the account.
// Purpose: Update existing Workers without requiring broader account permissions.
test('UnitT36_scoped_editor_never_queries_account_metadata',async()=>{
 const h=harness();const api=h.deps.api;
 h.deps.api=async(p,o)=>{assert.notEqual(o?.allowMissing,true,'existing Worker is required');assert.match(p,/\/workers\/scripts\/(darktide-zh-tw|darktide-zh-tw-preview)\/deployments$/);return api(p,o);};
 await deployVerifiedArtifact({token:'secret',config:settings},h.deps);
 assert.ok(h.calls.some(x=>x[0]==='api'&&x[1].includes('/darktide-zh-tw-preview/deployments')));
 assert.equal(h.calls.filter(x=>x[0]==='deploy').length,2);
});
// Scenario: Production is readable but the preview Worker is outside the token scope.
// Purpose: Require both Worker permissions before any upload.
test('UnitT37_preview_permission_failure_stops_all_uploads',async()=>{
 const h=harness();const api=h.deps.api;
 h.deps.api=async(p,o)=>{if(p.includes('/darktide-zh-tw-preview/'))throw new Error('HTTP 403');return api(p,o);};
 await assert.rejects(deployVerifiedArtifact({token:'secret',config:settings},h.deps),/403/);
 assert.ok(!h.calls.some(x=>x[0]==='deploy'));
});
// Scenario: Valid artifact, token, and successful preview.
// Purpose: Require preview verification before production and preserve artifact identity.
test('UnitT40_preview_precedes_production',async()=>{
 const h=harness();
 await deployVerifiedArtifact({token:'secret',config:settings},h.deps);
 const phases=h.calls.filter(x=>x[0]==='deploy'||x[0]==='check');
 assert.deepEqual(phases,[
 ['deploy','wrangler.preview.json'],['check','https://darktide-zh-tw-preview.syuan-tsai.workers.dev'],
 ['deploy','wrangler.json'],['check','https://darktide.tw-syuan.com']
 ]);
 const saved=h.calls.filter(x=>x[0]==='record').at(-1)[1];
 assert.equal(saved.status,'verified');assert.equal(saved.build_id,artifact.build_id);
 assert.ok(!JSON.stringify(saved).includes('secret'));
});
// Scenario: Preview check fails.
// Purpose: Do not mutate the production deployment when its candidate failed.
test('UnitT50_preview_failure_never_deploys_production',async()=>{
 const h=harness({failAt:'https://darktide-zh-tw-preview.syuan-tsai.workers.dev'});
 await assert.rejects(deployVerifiedArtifact({token:'secret',config:settings},h.deps));
 assert.ok(!h.calls.some(x=>x[0]==='deploy'&&x[1]==='wrangler.json'));
});
// Scenario: Deployment changed the local package after successful preview.
// Purpose: Block production when preview and production would use different artifacts.
test('UnitT55_changed_artifact_never_reaches_production',async()=>{
 const h=harness();h.deps.verifyUnchanged=async()=>{throw new Error('artifact changed');};
 await assert.rejects(deployVerifiedArtifact({token:'secret',config:settings},h.deps));
 assert.ok(!h.calls.some(x=>x[0]==='deploy'&&x[1]==='wrangler.json'));
});
// Scenario: Production HTTP check fails with a previous version available.
// Purpose: Restore the full prior version set instead of guessing the latest version.
test('UnitT60_failed_production_restores_previous_version',async()=>{
 const h=harness({failAt:'https://darktide.tw-syuan.com'});
 await assert.rejects(deployVerifiedArtifact({token:'secret',config:settings},h.deps));
 const rollback=h.calls.find(x=>x[0]==='api'&&x[2].method==='POST');
 assert.deepEqual(rollback[2].body.versions,[{version_id:'old-id',percentage:100}]);
});
// Scenario: The first production deployment fails and there is no old version.
// Purpose: Report the missing rollback target rather than inventing a successful rollback.
test('UnitT65_first_deployment_failure_records_no_previous_version',async()=>{
 const h=harness({failAt:'wrangler.json'});
 const api=h.deps.api;h.deps.api=async(p,o={})=>p.endsWith('/deployments')&&!o.method?null:api(p,o);
 await assert.rejects(deployVerifiedArtifact({token:'secret',config:settings},h.deps));
 assert.equal(h.calls.filter(x=>x[0]==='record').at(-1)[1].status,'failed-first-deployment');
 assert.ok(!h.calls.some(x=>x[0]==='api'&&x[2].method==='POST'));
});
// Scenario: A stale or HTML version response reaches the checker.
// Purpose: Never treat an old build or HTML fallback as successful publication.
test('UnitT70_origin_rejects_stale_build',async()=>{
 await assert.rejects(verifyOrigin('https://example.test',artifact,{fetch:async()=>new Response(JSON.stringify({...artifact,build_id:'c'.repeat(64)}),{headers:{'content-type':'application/json'}})}),/build/);
});

// Scenario: A deployment version URL responds with an HTML shell instead of JSON.
// Purpose: Reject routing fallback before declaring a working site.
test('UnitT75_origin_rejects_html_version_response',async()=>{
 await assert.rejects(verifyOrigin('https://example.test',artifact,{fetch:async()=>new Response('<html>',{headers:{'content-type':'text/html'}})}),/MIME/);
});

test('InterT10_shared_origin_verifies_legacy_catalog_and_every_retained_W02_URL_hash',async()=>{
 const sharedRevision='d'.repeat(64);const runtimeRevision='e'.repeat(64);
 const manifestBytes=Buffer.from('{"manifest":true}\n');
 const pointer={game_version:'1.13.2',content_version:'1.13.2.1',data_revision:sharedRevision,
  manifest_path:'/data/'+sharedRevision+'/manifest.json',manifest_sha256:sha256(manifestBytes)};
 const version={schema_version:2,data_revision:sharedRevision,build_id:artifact.build_id,game_version:'1.13.2',
  package_kind:'published',game_releases:[pointer]};
 const sharedBodies=new Map([
  [pointer.manifest_path,manifestBytes],
  ['/data/'+sharedRevision+'/skills.json',Buffer.from('{"domain":"skills"}\n')],
  ['/source-locks/'+('a'.repeat(64))+'/'+('b'.repeat(64))+'.json',Buffer.from('{"lock":true}\n')],
 ]);
 const sharedFiles=[...sharedBodies].map(([path,bytes])=>({path,size_bytes:bytes.byteLength,sha256:sha256(bytes)}));
 const expected={...artifact,data_revision:sharedRevision,runtime_data_revision:runtimeRevision,shared_data_revision:sharedRevision,
  game_releases:[pointer],shared_files:sharedFiles};
 const calls=[];
 const fetch=async(url)=>{
  const pathname=new URL(url).pathname;calls.push(pathname);
  if(pathname==='/version.json')return new Response(JSON.stringify(version),{headers:{'content-type':'application/json','cache-control':'no-store'}});
  if(pathname==='/data/'+runtimeRevision+'/catalog.json')return new Response(JSON.stringify({game_version:'1.13.2',entries:[
   {kind:'skill',id:'skill-a',detail_path:'details/skill-a.json'},
   {kind:'weapon',id:'weapon-a',detail_path:'details/weapon-a.json'},
   {kind:'blessing',id:'blessing-a',detail_path:'details/blessing-a.json'}]}),{headers:{'content-type':'application/json','cache-control':'public,max-age=31536000,immutable'}});
  if(pathname.startsWith('/data/'+runtimeRevision+'/details/'))return new Response('{}',{headers:{'content-type':'application/json'}});
  if(sharedBodies.has(pathname))return new Response(sharedBodies.get(pathname),{headers:{'content-type':'application/json'}});
  if(pathname.startsWith('/data/')||pathname.startsWith('/assets/'))return new Response('missing',{status:404});
  return new Response('<html><body>Games Lantern '+artifact.build_id+'</body></html>',{headers:{'content-type':'text/html'}});
 };
 const result=await verifyOrigin('https://example.test',expected,{fetch});
 assert.equal(result.runtime_data_revision,runtimeRevision);
 assert.ok(calls.includes('/data/'+runtimeRevision+'/catalog.json'));
 for(const row of sharedFiles)assert.ok(calls.includes(row.path),row.path);
 assert.ok(calls.includes('/data/'+runtimeRevision+'/not-present.json'));
});

// Scenario: A deployment contains the fixed historical player package.
// Purpose: Verify both history documents and exact manifest/index bytes at the public origin without following a routing fallback.
test('InterT20_origin_verifies_history_documents_files_and_missing_paths', async () => {
 const historyManifest=Buffer.from('{"history":"manifest"}\n');
 const playerIndex=Buffer.from('{"entries":[]}\n');
 const historyFiles=[
  {path:'/history/1.13.1/manifest.json',size_bytes:historyManifest.byteLength,sha256:sha256(historyManifest)},
  {path:'/history/1.13.1/player-index.json',size_bytes:playerIndex.byteLength,sha256:sha256(playerIndex)},
 ];
 const historyBodies=new Map(historyFiles.map((row,index)=>[row.path,index===0?historyManifest:playerIndex]));
 const version={schema_version:2,data_revision:artifact.data_revision,build_id:artifact.build_id,game_version:'1.13.2',package_kind:'published'};
 const catalog={game_version:'1.13.2',entries:[
  {kind:'skill',id:'skill-a',detail_path:'details/skill-a.json'},
  {kind:'weapon',id:'weapon-a',detail_path:'details/weapon-a.json'},
  {kind:'blessing',id:'blessing-a',detail_path:'details/blessing-a.json'},
 ]};
 const calls=[];
 const fetch=async(url,init={})=>{
  const path=new URL(url).pathname;calls.push({path,redirect:init.redirect});
  if(path==='/version.json')return new Response(JSON.stringify(version),{headers:{'content-type':'application/json','cache-control':'no-store'}});
  if(path==='/data/'+artifact.data_revision+'/catalog.json')return new Response(JSON.stringify(catalog),{headers:{'content-type':'application/json','cache-control':'public,max-age=31536000,immutable'}});
  if(path.startsWith('/data/'+artifact.data_revision+'/details/'))return new Response('{}',{headers:{'content-type':'application/json'}});
  if(path==='/history/1.13.1'||path==='/history/1.13.1/')return new Response('<html>'+artifact.build_id+' Games Lantern</html>',{headers:{'content-type':'text/html','cache-control':'no-cache'}});
  if(historyBodies.has(path))return new Response(historyBodies.get(path),{headers:{'content-type':'application/json','cache-control':'no-cache'}});
  if(path.startsWith('/history/1.13.1/'))return new Response('missing',{status:404,headers:{'content-type':'application/json'}});
  if(path.startsWith('/data/')||path.startsWith('/assets/'))return new Response('missing',{status:404});
  return new Response('<html><body>Games Lantern '+artifact.build_id+'</body></html>',{headers:{'content-type':'text/html'}});
 };
 await verifyOrigin('https://example.test',{...artifact,history_files:historyFiles},{fetch});
 for(const path of ['/history/1.13.1','/history/1.13.1/'])assert.ok(calls.some(call=>call.path===path),'missing history document check '+path);
 for(const row of historyFiles)assert.ok(calls.some(call=>call.path===row.path&&call.redirect==='error'),'missing redirect:error pinned history request '+row.path);
 for(const path of ['/history/1.13.1/source-content.json','/history/1.13.1/missing.json'])assert.ok(calls.some(call=>call.path===path&&call.redirect==='error'),'missing history 404 check '+path);
});
