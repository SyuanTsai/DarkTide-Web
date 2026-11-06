import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const env={...process.env,CLOUDFLARE_API_TOKEN:'',WRANGLER_SEND_METRICS:'false',CI:'true'};
const buildArgs=process.argv.slice(2);
if(!buildArgs.includes('--source-data'))throw new Error('Usage: npm run prepare:deploy -- --source-data <checkout> --source-data-commit <SHA>');
const commands=[
 ['scripts/verify-deploy-config.mjs'],
 ['scripts/build.mjs',...buildArgs,'--site-origin','https://darktide.tw-syuan.com'],
 ['scripts/verify-static.mjs'],
 ['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.preview.json','--dry-run','--outdir','.cloudflare-dry-run/preview'],
 ['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.json','--dry-run','--outdir','.cloudflare-dry-run/production'],
 ['scripts/cloudflare-runtime-smoke.mjs'],
 ['scripts/browser-smoke.mjs','dist']
];
for(const args of commands){
 console.log('Checking: '+args.join(' '));
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit'});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Predeployment validation failed: '+args[0]+' exit '+code)));
 });
}
console.log('Predeployment checks passed. Waiting for CLOUDFLARE_API_TOKEN; no Cloudflare deployment was made.');
