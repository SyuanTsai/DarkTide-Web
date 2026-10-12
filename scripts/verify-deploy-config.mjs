import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
import {assertDeploymentConfig} from '../src/deploy/cloudflare.mjs';
for(const [name,preview]of [['wrangler.json',false],['wrangler.preview.json',true]]){
 assertDeploymentConfig(JSON.parse(await readFile(new URL('../'+name,import.meta.url),'utf8')),{preview});
}
const ci=parse(await readFile(new URL('../.github/workflows/static-ci.yml',import.meta.url),'utf8'));
assert.equal(ci.permissions.contents,'read');
assert.ok(Object.hasOwn(ci.on,'pull_request'));assert.deepEqual(ci.on.push.branches,['main']);
assert.ok(!ci.on.pull_request_target);
assert.ok(ci.jobs.deploy.needs.includes('static-package'));
assert.match(ci.jobs.deploy.if,/main/);
assert.equal(ci.jobs.deploy.concurrency['cancel-in-progress'],false);
const buildText=JSON.stringify(ci.jobs['static-package']);
assert.ok(!buildText.includes('secrets.'),'PR build must never receive secrets');
const deployText=JSON.stringify(ci.jobs.deploy);
assert.ok(deployText.includes('download-artifact'),'deploy must consume tested artifact');
assert.ok(!/npm run build/.test(deployText),'deploy must not rebuild');
assert.match(deployText,/CLOUDFLARE_API_TOKEN/);
console.log('Cloudflare config and CI boundaries verified');
