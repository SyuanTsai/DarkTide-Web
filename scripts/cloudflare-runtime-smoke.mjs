import {spawn,execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyStaticPackage} from '../src/static/verify.mjs';
import {verifyOrigin} from '../src/deploy/cloudflare.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const artifact=await verifyStaticPackage(path.join(root,'dist'));
if(artifact.package_kind!=='published')throw new Error('Cloudflare smoke requires published artifact');
const port=await new Promise((resolve,reject)=>{
 const s=net.createServer();s.once('error',reject);
 s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
});
const child=spawn(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','--config','wrangler.preview.json','--ip','127.0.0.1','--port',String(port)],{
 cwd:root,env:{...process.env,CLOUDFLARE_API_TOKEN:'',WRANGLER_SEND_METRICS:'false',CI:'true'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
let failed=false;child.on('error',()=>{failed=true;});
try{
 const origin='http://127.0.0.1:'+port;let ready=false;
 for(let i=0;i<150;i++){
  if(failed||child.exitCode!==null)throw new Error('Wrangler local runtime exited: '+logs);
  try{if((await fetch(origin+'/version.json',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,200));
 }
 if(!ready)throw new Error('Wrangler local runtime timeout: '+logs);
 await verifyOrigin(origin,artifact);
 console.log('Cloudflare local runtime verified: deep routes, JSON, strict 404, cache, build '+artifact.build_id);
}finally{
 if(process.platform==='win32'){await new Promise(resolve=>execFile('taskkill',['/PID',String(child.pid),'/T','/F'],()=>resolve()));}else{child.kill();}
 await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,3000).unref();});
}
