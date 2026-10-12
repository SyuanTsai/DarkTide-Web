import assert from 'node:assert/strict';
export const ACCOUNT_ID='38d350980998e83d3f405aff0170921a';
export const SITE_ORIGIN='https://darktide.tw-syuan.com';
export const PREVIEW_ORIGIN='https://darktide-zh-tw-preview.syuan-tsai.workers.dev';
export function parseUploadedWorkerVersion(text,workerName) {
 let entries;
 try { entries=text.split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line)); }
 catch { throw new Error('Invalid Wrangler version upload output'); }
 const uploads=entries.filter(entry=>entry?.type==='version-upload');
 assert.equal(uploads.length,1,'expected exactly one uploaded version');
 const upload=uploads[0];
 assert.equal(upload.version,1,'unsupported version output schema');
 assert.equal(upload.worker_name,workerName,'uploaded Worker name mismatch');
 assert.equal(typeof upload.version_id,'string','uploaded version ID must be a string');
 assert.match(upload.version_id,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,'invalid uploaded version ID');
 return upload.version_id;
}
export function assertDeploymentConfig(config,{preview=false}={}) {
 assert.equal(config.account_id,ACCOUNT_ID,'unexpected Cloudflare account');
 assert.equal(config.name,preview?'darktide-zh-tw-preview':'darktide-zh-tw','unexpected Worker name');
 assert.ok(!config.main&&!config.build&&!config.kv_namespaces&&!config.r2_buckets&&!config.d1_databases,'deployment must remain pure static');
 assert.deepEqual(config.assets,{directory:'./dist',not_found_handling:'none'},'unexpected assets settings');
 assert.equal(config.workers_dev,true);
 assert.deepEqual(config.routes??[],preview?[]:[{pattern:'darktide.tw-syuan.com',custom_domain:true}],'unexpected custom domain');
}
export async function verifyOrigin(origin,expected,{fetch:fetcher=globalThis.fetch}={}) {
 const get=async(p,options={})=>fetcher(new URL(p,origin),{redirect:'follow',signal:AbortSignal.timeout(15000),...options});
 const versionResponse=await get('/version.json',{cache:'no-store'});
 assert.equal(versionResponse.status,200,'version HTTP status');
 assert.match(versionResponse.headers.get('content-type')??'',/application\/json/i,'version MIME');
 const version=await versionResponse.json();
 assert.equal(version.build_id,expected.build_id,'deployed build mismatch');
 assert.equal(version.data_revision,expected.data_revision,'deployed data revision mismatch');
 assert.equal(version.package_kind,'published','deployed package is not published');
 assert.match(versionResponse.headers.get('cache-control')??'',/no-cache|no-store/,'version must revalidate');
 for(const route of ['/','/skills/ogryn/','/weapons/bolter_p1/','/blessings/terrifying-barrage/']){
  const r=await get(route,{headers:{'Sec-Fetch-Mode':'navigate'}});
  assert.equal(r.status,200,'document status '+route);
  assert.match(r.headers.get('content-type')??'',/text\/html/i);
  const body=await r.text();
  assert.ok(body.includes(expected.build_id),'document is stale '+route);
  assert.match(body,/Games Lantern/,'missing initial attribution');
 }
 const catalogResponse=await get('/data/'+expected.data_revision+'/catalog.json');
 assert.equal(catalogResponse.status,200);
 assert.match(catalogResponse.headers.get('content-type')??'',/application\/json/i);
 assert.match(catalogResponse.headers.get('cache-control')??'',/immutable/);
 const catalog=await catalogResponse.json();
 for(const kind of ['skill','weapon','blessing']){
  const row=catalog.entries.find(x=>x.kind===kind);assert.ok(row,'missing catalog '+kind);
  const r=await get('/data/'+expected.data_revision+'/'+row.detail_path);
  assert.equal(r.status,200);assert.match(r.headers.get('content-type')??'',/application\/json/i);
  await r.json();
 }
 for(const p of ['/data/'+expected.data_revision+'/not-present.json','/assets/not-present.mjs']){
  for(const mode of ['cors','navigate']){
   const r=await get(p,{headers:{'Sec-Fetch-Mode':mode}});
   assert.equal(r.status,404,'missing asset must be 404 '+p);
   assert.ok(!(await r.text()).includes(expected.build_id),'missing asset returned HTML shell');
  }
 }
 return {origin,build_id:version.build_id,data_revision:version.data_revision};
}
export async function deployVerifiedArtifact({token,config},deps) {
 if(typeof token!=='string'||!token.trim())throw new Error('CLOUDFLARE_API_TOKEN is required; no network request or deployment was made');
 assertDeploymentConfig(config);
 const artifact=await deps.verify();
 if(artifact.package_kind!=='published')throw new Error('only verified published artifacts may deploy');
 const endpoint='/accounts/'+ACCOUNT_ID+'/workers/scripts/'+config.name+'/deployments';
 // Preflight permissions and capture a complete prior version set before mutations.
 const previous=await deps.api(endpoint);
 const prior=previous?.deployments?.[0]?.versions??[];
 await deps.api('/accounts/'+ACCOUNT_ID+'/workers/scripts/darktide-zh-tw-preview/deployments');
 const receipt={status:'prepared',build_id:artifact.build_id,data_revision:artifact.data_revision,previous_versions:prior,production_origin:SITE_ORIGIN};
 await deps.record(receipt);
 await deps.deploy('wrangler.preview.json');
 await deps.check(PREVIEW_ORIGIN,artifact);
 let attempted=false;
 try{
  await deps.verifyUnchanged?.(artifact);
  attempted=true;
  await deps.deploy('wrangler.json');
  await deps.check(SITE_ORIGIN,artifact);
  const deployed=await deps.api(endpoint);
  receipt.deployed_versions=deployed?.deployments?.[0]?.versions??[];
  receipt.preview_origin=PREVIEW_ORIGIN;
  receipt.status='verified';await deps.record(receipt);
  return receipt;
 }catch(error){
  receipt.status='failed';
  if(attempted&&prior.length){
   try{await deps.api(endpoint,{method:'POST',body:{strategy:'percentage',versions:prior.map(v=>({version_id:v.version_id,percentage:v.percentage}))}});
    receipt.status='rolled-back';receipt.rollback_verification='api-accepted';
   }catch{receipt.status='rollback-failed';}
  }else if(attempted){receipt.status='failed-first-deployment';}
  await deps.record(receipt);
  throw new Error('production deployment/check failed; '+receipt.status,{cause:error});
 }
}
