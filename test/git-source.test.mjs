import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash}from'node:crypto';
import {loadGitSourceBytes}from'../src/content/git-source.mjs';
import {createTestGitRepository}from'./helpers/git-repository.mjs';
const bytes=Buffer.from('公開來源測試資料\n','utf8');
async function setup(context){
 const repository=await createTestGitRepository(context,{'README.md':bytes,'src/fixture.mjs':'export const fixture = true;\n'});
 return{...repository,lock:{source_id:'site-readme',kind:'git_file',repository_url:repository.remote,commit_sha:repository.commit,path:'README.md',sha256:createHash('sha256').update(bytes).digest('hex')}};
}
// Scenario: A deterministic repository identifies a byte-exact file at its fixed commit.
// Purpose: Read a real Git blob without depending on this checkout's origin or history.
test('InterT10_reads_and_hashes_exact_git_blob_bytes',async t=>{
 const{checkout,remote,lock}=await setup(t);
 const loaded=await loadGitSourceBytes([lock],new Map([[remote,checkout]]));
 assert.deepEqual(loaded.get('site-readme'),new Uint8Array(bytes));
});
// Scenario: A fixture checkout origin or blob digest differs from its lock.
// Purpose: Reject sources that do not match the explicit remote and blob hash.
test('InterT20_rejects_origin_or_blob_hash_mismatch',async t=>{
 const{checkout,remote,lock}=await setup(t);
 const wrongRemote='https://example.test/other.git';
 await assert.rejects(()=>loadGitSourceBytes([{...lock,repository_url:wrongRemote}],new Map([[wrongRemote,checkout]])),/origin.*mismatch/i);
 await assert.rejects(()=>loadGitSourceBytes([{...lock,sha256:'0'.repeat(64)}],new Map([[remote,checkout]])),/hash.*mismatch/i);
});
// Scenario: A lock requests a nonexistent commit, escaping path, or actual tree.
// Purpose: Accept only an existing regular Git blob beneath the fixture commit.
test('InterT30_rejects_missing_commit_unsafe_path_or_tree',async t=>{
 const{checkout,remote,lock}=await setup(t);const checkouts=new Map([[remote,checkout]]);
 await assert.rejects(()=>loadGitSourceBytes([{...lock,commit_sha:'0'.repeat(40)}],checkouts),/git blob/i);
 await assert.rejects(()=>loadGitSourceBytes([{...lock,path:'../README.md'}],checkouts),/path/i);
 await assert.rejects(()=>loadGitSourceBytes([{...lock,path:'src'}],checkouts),/git blob/i);
});
// Scenario: A safe spaced Git path has no blob in the explicit fixture.
// Purpose: Reach object lookup rather than rejecting a legitimate path shape.
test('InterT40_accepts_spaced_git_path_syntax_before_object_lookup',async t=>{
 const{checkout,remote,lock}=await setup(t);
 await assert.rejects(()=>loadGitSourceBytes([{...lock,path:'Game Info/missing.md'}],new Map([[remote,checkout]])),/git blob/i);
});
