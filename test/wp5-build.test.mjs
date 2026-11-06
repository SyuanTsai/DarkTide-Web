import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourceSite } from '../src/build/build.mjs';
import { verifyStaticPackage } from '../src/static/verify.mjs';
import { execFileSync } from 'node:child_process';
import { createStaticServer } from '../scripts/serve.mjs';
import { createSourceClient } from '../web/source-client.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
// Scenario: Legal blessing IDs contain enough repeated characters or separators to exceed filesystem filename limits.
// Purpose: A complete build keeps their shard names bounded and the browser can load each original ID.
test('InterT06_長祝福ID完整建置與用戶端讀取', async () => {
  const temp = await mkdtemp(path.join(root, '.static-build-staging-wp5-long-blessing-'));
  try {
    for (const name of ['web', 'content/history', 'content/authoring/v2', 'test/fixtures/source-data']) await cp(path.join(root, name), path.join(temp, name), { recursive: true });
    const source = path.join(temp, 'test/fixtures/source-data');
    const blessingsFile = path.join(source, 'data/9.9.2/blessings.json');
    const blessings = JSON.parse(await readFile(blessingsFile));
    const ids = ['darktide:blessing:' + 'a'.repeat(240), 'darktide:blessing:' + ':'.repeat(100)];
    blessings.items.slice(0, ids.length).forEach((item, i) => { item.id = ids[i]; });
    await writeFile(blessingsFile, JSON.stringify(blessings));
    const opts = { root: temp, sourceData: source, fixture: true };
    await buildSourceSite(opts);
    const version = JSON.parse(await readFile(path.join(temp, 'dist/version.json')));
    const pointer = version.game_releases.find(row => row.game_version === version.game_version);
    const manifest = JSON.parse(await readFile(path.join(temp, 'dist', pointer.manifest_path.slice(1))));
    const index = JSON.parse(await readFile(path.join(temp, 'dist', 'data', manifest.dataRevision, 'domains/blessings-index.json')));
    const shards = ids.map(id => index.items.find(item => item.id === id));
    assert.ok(shards.every(item => item && path.basename(item.path).length <= 64));
    const server = await createStaticServer({ distPath: path.join(temp, 'dist') });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const client = createSourceClient({ build: version, fetchImpl: url => fetch(new URL(url, origin)) });
      for (let i = 0; i < ids.length; i++) {
        const result = await client.load({ pathname: '/blessings/', search: `?id=${encodeURIComponent(ids[i])}` });
        assert.equal(result.domains.find(domain => domain.kind === 'blessing').document.items[0].id, ids[i]);
      }
    } finally { await new Promise(resolve => server.close(resolve)); }
  } finally { await rm(temp, { recursive: true, force: true }); }
});
// Scenario: A valid family exceeds typical Windows filename limits when hex encoded.
// Purpose: The complete build emits a bounded, deterministic filename and preserves the family.
test('InterT05_長型號完整建置與檔名長度', async () => {
  const temp = await mkdtemp(path.join(root, '.static-build-staging-wp5-long-'));
  try {
    for (const name of ['web', 'content/history', 'content/authoring/v2', 'test/fixtures/source-data']) await cp(path.join(root, name), path.join(temp, name), { recursive: true });
    const file = path.join(temp, 'test/fixtures/source-data/data/9.9.2/weapons.json');
    const data = JSON.parse(await readFile(file)); const family = 'family_' + 'a'.repeat(119);
    data.items[0].values.family = family; await writeFile(file, JSON.stringify(data));
    const opts = { root: temp, sourceData: path.join(temp, 'test/fixtures/source-data'), fixture: true };
    await buildSourceSite(opts);
    const version = JSON.parse(await readFile(path.join(temp, 'dist/version.json')));
    const pointer = version.game_releases.find(row => row.game_version === version.game_version);
    const manifest = JSON.parse(await readFile(path.join(temp, 'dist', pointer.manifest_path.slice(1))));
    const index = JSON.parse(await readFile(path.join(temp, 'dist', 'data', manifest.dataRevision, 'domains/weapons-index.json')));
    const shard = index.items.find(item => item.family === family).path;
    assert.ok(path.basename(shard).length <= 64);
    await buildSourceSite(opts);
    assert.ok(await readFile(path.join(temp, 'dist', 'data', manifest.dataRevision, shard)));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
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
    const server=await createStaticServer({distPath:path.join(temp,'dist')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const origin=`http://127.0.0.1:${server.address().port}`;
      for(const method of ['GET','HEAD']){const response=await fetch(origin+'/source-data/current.json',{method});assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');assert.equal(response.headers.get('access-control-allow-origin'),'*');assert.match(response.headers.get('cache-control'),/no-cache/);}
      assert.match((await fetch(origin+'/source-data/9.9.1/skills.json')).headers.get('cache-control'),/immutable/);
      assert.equal((await fetch(origin+'/source-data/current.json',{method:'POST'})).status,405);
    }finally{await new Promise(resolve=>server.close(resolve));}
  } finally {await rm(temp,{recursive:true,force:true});}
});

// Scenario: Invalid inputs are supplied before any output directory exists.
// Purpose: A missing current file, invalid data, validator failure or wrong commit never emits dist.
test('InterT20_驗證失敗不產生dist且先執行來源validator',async()=>{
  const temp=await mkdtemp(path.join(root,'.static-build-staging-wp5-fail-'));
  try{
    const source=path.join(temp,'source');await cp(path.join(root,'test/fixtures/source-data'),source,{recursive:true});
    const opts={root:temp,sourceData:source,fixture:true};
    const current=path.join(source,'data/current.json'),bytes=await readFile(current);await rm(current);
    await assert.rejects(buildSourceSite(opts),/current.json/);await assert.rejects(readFile(path.join(temp,'dist/index.html')),/ENOENT/);await writeFile(current,bytes);
    const skillFile=path.join(source,'data/9.9.2/skills.json');const skillBytes=await readFile(skillFile);const d=JSON.parse(skillBytes);d.gameVersion='9.9.1';await writeFile(skillFile,JSON.stringify(d));
    await assert.rejects(buildSourceSite(opts),/metadata invalid/);await writeFile(skillFile,skillBytes);
    const git=(...args)=>execFileSync('git',['-C',source,...args],{stdio:'pipe'});git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','fixture');
    await assert.rejects(buildSourceSite({...opts,sourceDataCommit:'0'.repeat(40)}),/HEAD/);
    await mkdir(path.join(source,'pipeline'),{recursive:true});await writeFile(path.join(source,'pipeline/validate.mjs'),'console.error("validator rejection");process.exit(1)');
    await assert.rejects(buildSourceSite(opts),/pipeline validation failed: validator rejection/);
    await assert.rejects(readFile(path.join(temp,'dist/index.html')),/ENOENT/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
