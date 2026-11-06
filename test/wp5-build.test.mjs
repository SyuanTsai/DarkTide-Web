import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourceSite } from '../src/build/build.mjs';
import { verifyStaticPackage } from '../src/static/verify.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
// Scenario: Build all fixture versions twice in an isolated workspace output.
// Purpose: Verify the complete byte closure, original data, headers and deterministic build.
test('InterT10_完整建置決定性來源原樣複製與history可讀', async () => {
  const temp=await mkdtemp(path.join(root,'.static-build-staging-wp5-test-'));
  try {
    for(const name of ['web','content/history','content/authoring/v2'])await cp(path.join(root,name),path.join(temp,name),{recursive:true});
    const opts={root:temp,sourceData:path.join(root,'test/fixtures/source-data'),fixture:true};
    await buildSourceSite(opts);
    const collect=async(dir,prefix='')=>{const files=new Map();for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())for(const [k,v] of await collect(path.join(dir,entry.name),name+'/'))files.set(k,v);else files.set(name,await readFile(path.join(dir,entry.name)));}return files;};
    const first=await collect(path.join(temp,'dist'));await buildSourceSite(opts);assert.deepEqual(await collect(path.join(temp,'dist')),first);
    const verified=await verifyStaticPackage(path.join(temp,'dist'));assert.equal(verified.game_releases.length,2);
    assert.ok(first.has('history/1.13.1/player-index.json'));
    assert.deepEqual(first.get('source-data/current.json'),await readFile(path.join(root,'test/fixtures/source-data/data/current.json')));
    const headers=first.get('_headers').toString();assert.match(headers,/Access-Control-Allow-Origin: \*/);assert.match(headers,/Access-Control-Allow-Methods: GET, HEAD/);
    assert.match(headers,/\/source-data\/current.json\n  ! Cache-Control\n  Cache-Control: no-cache/);
  } finally {await rm(temp,{recursive:true,force:true});}
});
