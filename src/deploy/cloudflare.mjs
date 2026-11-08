import { validateTransportManifest, verifyTransport, MAX_OUTPUT_FILE_BYTES } from '../build/transport.mjs';
import assert from 'node:assert/strict';
import { safeRelativePath, sha256 } from '../static/common.mjs';
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
export async function verifyOrigin(origin,expected,{fetch:fetcher=globalThis.fetch,transportOptions}={}) {
 const get=async(p,options={})=>fetcher(new URL(p,origin),{redirect:'follow',signal:AbortSignal.timeout(15000),...options});
 const versionResponse=await get('/version.json',{cache:'no-store'});
 assert.equal(versionResponse.status,200,'version HTTP status');
 assert.match(versionResponse.headers.get('content-type')??'',/application\/json/i,'version MIME');
 const version=await versionResponse.json();
 assert.equal(version.build_id,expected.build_id,'deployed build mismatch');
 assert.equal(version.data_revision,expected.data_revision,'deployed data revision mismatch');
 assert.equal(version.package_kind,'published','deployed package is not published');
 const runtimeRevision=expected.runtime_data_revision??expected.data_revision;
 if(expected.shared_data_revision){
  assert.equal(version.data_revision,expected.shared_data_revision,'deployed shared revision mismatch');
  assert.deepEqual(version.game_releases,expected.game_releases,'deployed shared release pointers mismatch');
  assert.ok(Array.isArray(expected.shared_files),'verified shared file closure is missing');
  for(const pointer of expected.game_releases){
   const manifest=expected.shared_files.find(row=>row.path===pointer.manifest_path);
   assert.ok(manifest,'verified shared file closure is missing a retained manifest');
   assert.equal(manifest.sha256,pointer.manifest_sha256,'retained manifest hash differs from version pointer');
  }
 }
 assert.match(versionResponse.headers.get('cache-control')??'',/no-cache|no-store/,'version must revalidate');
 for(const route of expected.source_data ? ['/','/skills/','/weapons/','/blessings/','/terms/','/game-changes/','/announcements/'] : ['/','/skills/ogryn/','/weapons/bolter_p1/','/blessings/terrifying-barrage/']){
  const r=await get(route,{headers:{'Sec-Fetch-Mode':'navigate'}});
  assert.equal(r.status,200,'document status '+route);
  assert.match(r.headers.get('content-type')??'',/text\/html/i);
  const body=await r.text();
  assert.ok(body.includes(expected.build_id),'document is stale '+route);
  assert.match(body,/Games Lantern/,'missing initial attribution');
 }
 if(expected.history_files){
  const fixedHistoryPaths=['/history/1.13.1/manifest.json','/history/1.13.1/player-index.json'];
  assert.ok(Array.isArray(expected.history_files),'verified history file closure is missing');
  assert.deepEqual(expected.history_files.map(row=>row.path),fixedHistoryPaths,'verified history file closure differs from the fixed player package');
  for(const route of ['/history/1.13.1','/history/1.13.1/']){
   const response=await get(route,{redirect:'error',headers:{'Sec-Fetch-Mode':'navigate'}});
   assert.equal(response.status,200,'historical document status '+route);
   assert.match(response.headers.get('content-type')??'',/text\/html/i,'historical document MIME '+route);
   assert.match(response.headers.get('cache-control')??'',/no-cache|no-store|must-revalidate/i,'historical document must revalidate '+route);
   const body=await response.text();
   assert.ok(body.includes(expected.build_id),'historical document is stale '+route);
   assert.match(body,/Games Lantern/,'missing initial attribution on '+route);
  }
  for(const row of expected.history_files){
   assert.ok(Number.isSafeInteger(row.size_bytes)&&row.size_bytes>=0,'verified history file size is invalid');
   assert.match(row.sha256,/^[a-f0-9]{64}$/,'verified history file hash is invalid');
   const response=await get(row.path,{redirect:'error'});
   assert.equal(response.status,200,'historical player file status '+row.path);
   assert.match(response.headers.get('content-type')??'',/application\/json/i,'historical player file MIME '+row.path);
   const bytes=Buffer.from(await response.arrayBuffer());
   assert.equal(bytes.byteLength,row.size_bytes,'historical player file size '+row.path);
   assert.equal(sha256(bytes),row.sha256,'historical player file hash '+row.path);
  }
  for(const route of ['/history/1.13.1/source-content.json','/history/1.13.1/missing.json']){
   const response=await get(route,{redirect:'error'});
   assert.equal(response.status,404,'unpublished history file must be 404 '+route);
   assert.doesNotMatch(await response.text(),/<!doctype html|<html/i,'missing history file returned an HTML shell '+route);
  }
 }
 if(expected.source_data===true){
  const transportFiles = new Map();
  const isTransportManifest = row => /^\/source-data\/[^/]+\/(skills|weapons|blessings|terms)\.manifest\.json$/.test(row.path);
  const orderedFiles = [...expected.source_files.filter(isTransportManifest), ...expected.source_files.filter(row => !isTransportManifest(row))];
  for(const row of orderedFiles){
   const response=await get(row.path,{redirect:'error'});assert.equal(response.status,200,'source file status '+row.path);
   assert.match(response.headers.get('content-type')??'',row.path.endsWith('.bin')?/^application\/octet-stream(?:\s*;|$)/i:/^application\/json(?:\s*;|$)/i);
   const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,row.size_bytes);assert.equal(sha256(bytes),row.sha256);
   transportFiles.set(row.path,bytes);
   if (isTransportManifest(row)) {
    const match = /^\/source-data\/([^/]+)\/(skills|weapons|blessings|terms)\.manifest\.json$/.exec(row.path);
    validateTransportManifest(JSON.parse(bytes), match[1], match[2], transportOptions);
   }
   if(row.path.startsWith('/source-data/')){
    assert.equal(response.headers.get('access-control-allow-origin'),'*');
    assert.equal(response.headers.get('access-control-allow-methods'),'GET, HEAD');
    assert.match(response.headers.get('cache-control')??'',row.path==='/source-data/current.json'?/no-cache|no-store/:/immutable/);
   }
  }
  for (const [name, bytes] of transportFiles) if (/^\/source-data\/[^/]+\/(skills|weapons|blessings|terms)\.manifest\.json$/.test(name)) {
   const manifest = JSON.parse(bytes), prefix = name.slice(0,name.lastIndexOf('/')+1), local = new Map();
   for (const [path, value] of transportFiles) if (path.startsWith(prefix)) local.set(path.slice(prefix.length),value);
   const match = /^\/source-data\/([^/]+)\/(skills|weapons|blessings|terms)\.manifest\.json$/.exec(name);
   verifyTransport(manifest, local, match[1], match[2], transportOptions);
   if (manifest.totalBytes > (transportOptions?.maxBytes ?? MAX_OUTPUT_FILE_BYTES)) {
    // HEAD verifies absence without transferring a forbidden oversized legacy body.
    const legacy = await get(`${prefix}${match[2]}.json`, { method: 'HEAD', redirect: 'error' });
    assert.equal(legacy.status, 404, 'oversized legacy URL must be 404 ' + prefix + match[2] + '.json');
   }
  }
  const pointer=version.game_releases.find(p=>p.game_version===version.game_version);
  const manifest=await(await get(pointer.manifest_path)).json();assert.equal(manifest.source.commit,expected.source_commit,'deployed Source-Data commit mismatch');
  for(const route of ['/data/'+runtimeRevision+'/missing.json','/source-data/missing.json','/assets/missing.mjs']){const r=await get(route,{headers:{'Sec-Fetch-Mode':'navigate'}});assert.equal(r.status,404);assert.doesNotMatch(await r.text(),/<!doctype html/i);}
  return {origin,build_id:version.build_id,data_revision:version.data_revision,source_commit:manifest.source.commit};
 }
 const catalogResponse=await get('/data/'+runtimeRevision+'/catalog.json');
 assert.equal(catalogResponse.status,200);
 assert.match(catalogResponse.headers.get('content-type')??'',/application\/json/i);
 assert.match(catalogResponse.headers.get('cache-control')??'',/immutable/);
 const catalog=await catalogResponse.json();
 for(const kind of ['skill','weapon','blessing']){
  const row=catalog.entries.find(x=>x.kind===kind);assert.ok(row,'missing catalog '+kind);
  const r=await get('/data/'+runtimeRevision+'/'+row.detail_path);
  assert.equal(r.status,200);assert.match(r.headers.get('content-type')??'',/application\/json/i);
  await r.json();
 }
 if(expected.shared_data_revision){
  for(const row of expected.shared_files){
   assert.ok(row&&typeof row.path==='string'&&row.path.startsWith('/'),'shared file closure path must be absolute and same-origin');
   const relative=row.path.slice(1);safeRelativePath(relative,'shared file closure path');
   assert.ok(relative.startsWith('data/')||relative.startsWith('source-locks/'),'shared file closure path is outside versioned shared data');
   assert.ok(Number.isSafeInteger(row.size_bytes)&&row.size_bytes>=0,'shared file closure size is invalid');
   assert.match(row.sha256,/^[a-f0-9]{64}$/,'shared file closure hash is invalid');
   const response=await get(row.path);
   assert.equal(response.status,200,'shared retained file status '+row.path);
   assert.match(response.headers.get('content-type')??'',/application\/json/i,'shared retained file MIME '+row.path);
   const bytes=Buffer.from(await response.arrayBuffer());
   assert.equal(bytes.byteLength,row.size_bytes,'shared retained file size '+row.path);
   assert.equal(sha256(bytes),row.sha256,'shared retained file hash '+row.path);
  }
 }
 for(const p of ['/data/'+runtimeRevision+'/not-present.json','/assets/not-present.mjs']){
  for(const mode of ['cors','navigate']){
   const r=await get(p,{headers:{'Sec-Fetch-Mode':mode}});
   assert.equal(r.status,404,'missing asset must be 404 '+p);
   assert.ok(!(await r.text()).includes(expected.build_id),'missing asset returned HTML shell');
  }
 }
 return {origin,build_id:version.build_id,data_revision:version.data_revision,...(expected.shared_data_revision?{runtime_data_revision:runtimeRevision}: {})};
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
