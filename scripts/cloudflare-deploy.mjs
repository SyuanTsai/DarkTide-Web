import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyStaticPackage} from '../src/static/verify.mjs';
import {ACCOUNT_ID,assertDeploymentConfig,deployVerifiedArtifact,verifyOrigin,parseUploadedWorkerVersion} from '../src/deploy/cloudflare.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const token=process.env.CLOUDFLARE_API_TOKEN;
const redact=text=>token?String(text).split(token).join('[REDACTED]'):String(text);
try{
 if(process.argv.length!==2)throw new Error('Usage: node scripts/cloudflare-deploy.mjs');
 // Credential boundary precedes reads of deployment state and all external calls.
 if(!token?.trim())throw new Error('CLOUDFLARE_API_TOKEN is required; no network request or deployment was made');
 if(process.env.CLOUDFLARE_ACCOUNT_ID&&process.env.CLOUDFLARE_ACCOUNT_ID!==ACCOUNT_ID)throw new Error('CLOUDFLARE_ACCOUNT_ID does not match the configured account');
 const config=JSON.parse(await readFile(path.join(root,'wrangler.json'),'utf8'));
 const preview=JSON.parse(await readFile(path.join(root,'wrangler.preview.json'),'utf8'));
 assertDeploymentConfig(preview,{preview:true});
 const verify=async()=>{
  const result=await verifyStaticPackage(path.join(root,'dist'));
  const robots=await readFile(path.join(root,'dist/robots.txt'),'utf8');
  if(!robots.includes('Sitemap: https://darktide.tw-syuan.com/sitemap.xml'))throw new Error('Run npm run prepare:deploy to build the formal site origin before deployment');
  return result;
 };
 const api=async(endpoint,{method='GET',body,allowMissing=false}={})=>{
  const r=await fetch('https://api.cloudflare.com/client/v4'+endpoint,{
   method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  if(allowMissing&&r.status===404)return null;
  if(!r.ok)throw new Error('Cloudflare API HTTP '+r.status+' for '+endpoint);
  const json=await r.json();if(!json.success)throw new Error('Cloudflare API rejected '+endpoint);
  return json.result;
 };
 const upload=(configFile,workerName,outputPath)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'versions','upload','--config',configFile,'--name',workerName],{
   cwd:root,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:ACCOUNT_ID,WRANGLER_SEND_METRICS:'false',WRANGLER_OUTPUT_FILE_PATH:outputPath,CI:'true'},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  child.on('error',reject);child.on('exit',code=>{
   process.stdout.write(redact(stdout));process.stderr.write(redact(stderr));
   code===0?resolve():reject(new Error('Wrangler version upload failed with exit '+code));
  });
 });
 const deploy=async configFile=>{
  const workerConfig=configFile==='wrangler.preview.json'?preview:configFile==='wrangler.json'?config:null;
  if(!workerConfig)throw new Error('unexpected Worker configuration');
  const outputPath=path.join(root,'.deployment',workerConfig.name+'.version-upload.jsonl');
  await mkdir(path.dirname(outputPath),{recursive:true});
  await writeFile(outputPath,'');
  await upload(configFile,workerConfig.name,outputPath);
  const versionId=parseUploadedWorkerVersion(await readFile(outputPath,'utf8'),workerConfig.name);
  await api('/accounts/'+ACCOUNT_ID+'/workers/scripts/'+workerConfig.name+'/deployments',{
   method:'POST',body:{strategy:'percentage',versions:[{version_id:versionId,percentage:100}]}
  });
 };
 const check=async(origin,artifact)=>{
  let last;
  for(let i=0;i<12;i++){
   try{return await verifyOrigin(origin,artifact);}
   catch(error){last=error;if(i<11)await new Promise(r=>setTimeout(r,5000));}
  }
  throw new Error('HTTPS/asset verification failed for '+origin,{cause:last});
 };
 const record=async(value)=>{
  await mkdir(path.join(root,'.deployment'),{recursive:true});
  await writeFile(path.join(root,'.deployment','last-deployment.json'),JSON.stringify(value,null,2)+'\n');
 };
 const receipt=await deployVerifiedArtifact({token,config},{
  verify,api,deploy,check,record,
  verifyUnchanged:async expected=>{
   const actual=await verify();if(actual.build_id!==expected.build_id||actual.data_revision!==expected.data_revision)throw new Error('artifact changed after preview verification');
  }
 });
 console.log('Cloudflare deployment verified: '+receipt.production_origin);
}catch(error){
 const messages=[];
 for(let cause=error;cause&&messages.length<4;cause=cause.cause)messages.push(cause.message);
 console.error(redact(messages.join('; ')));process.exitCode=token?1:2;
}
