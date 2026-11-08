import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport, verifyTransport, SHARD_THRESHOLD, MAX_OUTPUT_FILE_BYTES } from '../src/build/transport.mjs';
// Scenario: production limits are used without injection. Purpose: protect the published contract.
test('UnitT10_ production transport limits', () => { assert.equal(SHARD_THRESHOLD,20971520); assert.equal(MAX_OUTPUT_FILE_BYTES,26214400); });
// Scenario: byte boundaries include a split UTF-8 sequence and BOM/CRLF. Purpose: preserve exact bytes and legacy policy.
test('UnitT20_ boundaries preserve raw bytes deterministically', () => {
 for (const n of [8,9,10,11]) { const raw=Buffer.from([0xef,0xbb,0xbf,13,10,65,65,0xe4,0xb8,0xad,...Array(12).fill(65)]).subarray(0,n); const result=createTransport('1.2.3','weapons',raw,{threshold:8,maxBytes:10}); assert.deepEqual(result,createTransport('1.2.3','weapons',raw,{threshold:8,maxBytes:10})); assert.equal(result.files.has('weapons.json'),n<=10); assert.ok(verifyTransport(result.manifest,result.files,'1.2.3','weapons',{threshold:8,maxBytes:10}).equals(raw)); }
});
// Scenario: corrupt or inconsistent manifests and part bytes. Purpose: reject incomplete or tampered transport.
test('UnitT30_ rejects malformed transport', () => {
 const raw=Buffer.from('abcdefghijk'); const original=createTransport('1.2.3','weapons',raw,{threshold:4,maxBytes:8});
 const cases=[m=>m.parts.pop(),m=>m.parts.push({...m.parts[0]}),m=>m.parts.reverse(),m=>m.parts[1].offset++,m=>m.parts[0].sha256='0'.repeat(64),m=>m.totalSha256='0'.repeat(64)];
 for(const mutate of cases){const manifest=structuredClone(original.manifest);mutate(manifest);assert.throws(()=>verifyTransport(manifest,original.files,'1.2.3','weapons',{threshold:4,maxBytes:8}));}
 const missing=new Map(original.files); missing.delete('weapons.part-0002.bin'); assert.throws(()=>verifyTransport(original.manifest,missing,'1.2.3','weapons',{threshold:4,maxBytes:8}));
});
