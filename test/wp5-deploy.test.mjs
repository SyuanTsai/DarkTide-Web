import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOrigin } from '../src/deploy/cloudflare.mjs';
import { sha256 } from '../src/static/common.mjs';
// Scenario: Online files have exact hashes, source CORS and the requested commit.
// Purpose: The deployment check must detect stale source.commit even when the site is reachable.
test('InterT10_線上檢查核對sourceCommit與來源檔案雜湊',async()=>{
  const commit='a'.repeat(40),revision='b'.repeat(64),buildId='c'.repeat(64);
  const pointer={game_version:'9.9.2',data_revision:revision,manifest_path:`/data/${revision}/manifest.json`};
  const manifest=Buffer.from(JSON.stringify({source:{commit}}));const current=Buffer.from('{}');
  const files=new Map([[pointer.manifest_path,manifest],['/source-data/current.json',current],['/source-data/9.9.2/skills.json',current]]);
  const expected={source_data:true,build_id:buildId,data_revision:revision,source_commit:commit,game_releases:[pointer],source_files:[...files].map(([path,bytes])=>({path,sha256:sha256(bytes),size_bytes:bytes.length}))};
  const version={...expected,game_version:'9.9.2',package_kind:'published'};
  const fetch=async url=>{
    const path=new URL(url).pathname;
    const headers={'content-type':'application/json; charset=utf-8','cache-control':path==='/version.json'||path==='/source-data/current.json'?'no-cache':'public, max-age=31536000, immutable'};
    if(path.startsWith('/source-data/'))Object.assign(headers,{'access-control-allow-origin':'*','access-control-allow-methods':'GET, HEAD'});
    if(path==='/version.json')return new Response(JSON.stringify(version),{headers});
    if(files.has(path))return new Response(files.get(path),{headers});
    if(path.startsWith('/data/')||path.startsWith('/source-data/')||path.startsWith('/assets/'))return new Response('missing',{status:404});
    return new Response(`<html>${buildId} Games Lantern</html>`,{headers:{'content-type':'text/html'}});
  };
  assert.equal((await verifyOrigin('https://example.test',expected,{fetch})).source_commit,commit);
  await assert.rejects(verifyOrigin('https://example.test',{...expected,source_commit:'d'.repeat(40)},{fetch}),/commit mismatch/);
});
