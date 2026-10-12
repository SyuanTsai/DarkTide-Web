import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUploadedWorkerVersion } from '../src/deploy/cloudflare.mjs';
const worker='darktide-zh-tw-preview';
const version='12345678-1234-4234-8234-123456789abc';
const entry={type:'version-upload',version:1,worker_name:worker,version_id:version};
// Scenario: Wrangler emits one completed upload for the configured Worker.
// Purpose: Deploy the exact uploaded version, never a guessed latest version.
test('UnitT10_reads_exact_uploaded_version_for_expected_worker',()=>{
 assert.equal(parseUploadedWorkerVersion(JSON.stringify({type:'other'})+'\n'+JSON.stringify(entry)+'\n',worker),version);
});
// Scenario: Upload output is empty, malformed, incomplete, or belongs to another Worker.
// Purpose: Fail closed before routing production traffic to an unverified version.
test('UnitT20_rejects_missing_or_untrusted_upload_identity',()=>{
 for(const value of ['', 'not json', JSON.stringify({...entry,worker_name:'another-worker'}), JSON.stringify({...entry,version_id:'latest'}),JSON.stringify({...entry,version_id:null}),JSON.stringify({...entry,version:2})])assert.throws(()=>parseUploadedWorkerVersion(value,worker));
});
// Scenario: Output has multiple uploaded versions, including duplicates.
// Purpose: Reject ambiguous version selection instead of publishing an arbitrary entry.
test('UnitT30_rejects_multiple_uploads',()=>{
 assert.throws(()=>parseUploadedWorkerVersion(JSON.stringify(entry)+'\n'+JSON.stringify(entry),worker));
});
