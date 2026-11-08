import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOrigin } from '../src/deploy/cloudflare.mjs';
import { sha256 } from '../src/static/common.mjs';
import { buildSourceSite } from '../src/build/build.mjs';
import { verifySourceStaticFiles } from '../src/build/verify.mjs';
import { mixedSourceFixture, collectFiles, publicationFetch, transportOptions } from './syp391-fixture.mjs';
import path from 'node:path';
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
  const wrongMime=async (url,options)=>{const response=await fetch(url,options);if(new URL(url).pathname==='/source-data/9.9.2/skills.json')return new Response(await response.arrayBuffer(),{headers:{...Object.fromEntries(response.headers),'content-type':'text/html'}});return response;};
  await assert.rejects(verifyOrigin('https://example.test',expected,{fetch:wrongMime}),/application/);
});

// Scenario: A two-version origin serves shards or individually corrupted transport responses.
// Purpose: Enforce MIME, per-part and total integrity independently of the outer file closure.
test('InterT20_deploy_validates_shards_and_transport_failures', async t => {
  const opts = await mixedSourceFixture(t); await buildSourceSite(opts);
  const original = await collectFiles(path.join(opts.root, 'dist'));
  const manifestName = 'source-data/9.9.2/weapons.manifest.json', partName = 'source-data/9.9.2/weapons.part-0002.bin';
  const wrongMime = type => async (url, response) => {
    const target = type === 'application/json' ? partName : manifestName;
    return new URL(url).pathname === '/' + target ? new Response(await response.arrayBuffer(), {
      headers: { ...Object.fromEntries(response.headers), 'content-type': type },
    }) : response;
  };
  const scenarios = [
    ['InterT10_shards_succeed', null, null],
    ['InterT20_missing_part', null, (url, response) => new URL(url).pathname === '/' + partName ? new Response('missing', { status: 404 }) : response, /source file status/],
    ['InterT30_wrong_part_hash', files => files.set(partName, Buffer.alloc(files.get(partName).length)), null, /invalid source transport/],
    ['InterT40_wrong_total_hash', files => {
      const manifest = JSON.parse(files.get(manifestName)); manifest.totalSha256 = '0'.repeat(64);
      files.set(manifestName, Buffer.from(JSON.stringify(manifest)));
    }, null, /invalid source transport/],
    ['InterT50_binary_with_JSON_MIME', null, wrongMime('application/json'), /octet-stream/],
    ['InterT60_manifest_with_binary_MIME', null, wrongMime('application/octet-stream'), /application/],
    ['InterT70_HTML_200', null, (url, response) => new URL(url).pathname === '/' + partName ? new Response('<!doctype html><html>SPA</html>', { headers: { 'content-type': 'text/html' } }) : response, /octet-stream/],
  ];
  for (const [name, mutate, intercept, error] of scenarios) {
    // Scenario: One response invariant changes while all unrelated responses remain valid.
    // Purpose: Attribute each rejection to its own transport check.
    await t.test(name, async () => {
      const files = new Map(original); mutate?.(files);
      const version = JSON.parse(files.get('version.json'));
      const expected = verifySourceStaticFiles(original, version, { transportOptions });
      // Reseal outer hashes, so the part/total failures must reach verifyTransport.
      expected.source_files = expected.source_files.map(row => {
        const bytes = files.get(row.path.slice(1)); return { ...row, size_bytes: bytes.length, sha256: sha256(bytes) };
      });
      const origin = publicationFetch(files);
      const fetch = async (url, options) => { const response = await origin.fetch(url, options); return intercept ? intercept(url, response) : response; };
      const run = () => verifyOrigin('https://example.test', expected, { fetch, transportOptions });
      if (error) await assert.rejects(run, error);
      else {
        assert.equal((await run()).source_commit, expected.source_commit);
        assert.ok(origin.requests.some(row => row.name === '/' + partName));
      }
    });
  }
});

// Scenario: A shards-only category has a forbidden legacy URL returning 404, JSON 200 or SPA 200.
// Purpose: Reject resurrected oversize files without downloading their bodies.
test('InterT30_deploy_requires_oversized_legacy_URL_to_be_404', async t => {
  const opts = await mixedSourceFixture(t); await buildSourceSite(opts);
  const files = await collectFiles(path.join(opts.root, 'dist'));
  const expected = verifySourceStaticFiles(files, JSON.parse(files.get('version.json')), { transportOptions });
  const legacy = '/source-data/9.9.2/weapons.json';
  for (const status of [200, 'SPA', 404]) {
    const origin = publicationFetch(files), probes = [];
    const fetch = async (url, options) => {
      if (new URL(url).pathname === legacy) {
        probes.push(options.method);
        return new Response(null, { status: status === 'SPA' ? 200 : status, headers: { 'content-type': status === 'SPA' ? 'text/html' : 'application/json' } });
      }
      return origin.fetch(url, options);
    };
    const run = () => verifyOrigin('https://example.test', expected, { fetch, transportOptions });
    if (status === 404) await run(); else await assert.rejects(run, /oversized legacy.*404/);
    assert.deepEqual(probes, ['HEAD']);
    assert.ok(!origin.requests.some(row => row.name === legacy && row.method === 'GET'));
  }
});

// Scenario: A valid shard loses its public origin, allowed methods or immutable cache policy.
// Purpose: Retain the deployment CORS and cache checks while adding binary MIME support.
test('InterT40_deploy_preserves_CORS_and_cache_validation', async t => {
  const opts = await mixedSourceFixture(t); await buildSourceSite(opts);
  const files = await collectFiles(path.join(opts.root, 'dist'));
  const expected = verifySourceStaticFiles(files, JSON.parse(files.get('version.json')), { transportOptions });
  for (const [header, value] of [['access-control-allow-origin', 'https://other.test'], ['access-control-allow-methods', 'GET'], ['cache-control', 'no-cache']]) {
    const origin = publicationFetch(files);
    const fetch = async (url, options) => {
      const response = await origin.fetch(url, options);
      if (new URL(url).pathname === '/source-data/9.9.2/weapons.part-0001.bin') return new Response(await response.arrayBuffer(), {
        headers: { ...Object.fromEntries(response.headers), [header]: value },
      });
      return response;
    };
    await assert.rejects(verifyOrigin('https://example.test', expected, { fetch, transportOptions }));
  }
});
