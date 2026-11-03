import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parse} from 'yaml';
import {assertDeploymentConfig} from '../src/deploy/cloudflare.mjs';

export function assertStaticCiWorkflow(ci){
 assert.equal(ci.permissions.contents,'read');
 assert.ok(Object.hasOwn(ci.on,'pull_request'));assert.deepEqual(ci.on.push.branches,['main']);
 assert.ok(!ci.on.pull_request_target);
 assert.ok(!Object.hasOwn(ci.jobs,'deploy'),'static CI must not deploy');
 assert.ok(!JSON.stringify(ci).includes('secrets.'),'static CI must never receive secrets');
}

export function assertSharedReleaseWorkflow(release){
 assert.ok(!Object.hasOwn(release.on,'pull_request'),'shared release must not run from pull_request');
 const deploy=release.jobs['shared-release'];
 assert.ok(deploy,'shared-release deployment job is required');
 assert.equal(deploy.concurrency['cancel-in-progress'],false);
 assert.ok(JSON.stringify(deploy).includes('CLOUDFLARE_API_TOKEN'));
 assert.ok(JSON.stringify(deploy).includes('secrets.CLOUDFLARE_API_TOKEN'));
}

async function main(){
 for(const [name,preview]of [['wrangler.json',false],['wrangler.preview.json',true]]){
  assertDeploymentConfig(JSON.parse(await readFile(new URL('../'+name,import.meta.url),'utf8')),{preview});
 }
 const ci=parse(await readFile(new URL('../.github/workflows/static-ci.yml',import.meta.url),'utf8'));
 assertStaticCiWorkflow(ci);
 const release=parse(await readFile(new URL('../.github/workflows/shared-release.yml',import.meta.url),'utf8'));
 assertSharedReleaseWorkflow(release);
 console.log('Cloudflare config and CI boundaries verified');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
