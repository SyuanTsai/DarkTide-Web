import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createBuildRoot,buildFixture,disposeBuildRoot} from './static-test-helpers.mjs';
// Scenario: A Cloudflare static artifact needs deep routes and strict data 404s.
// Purpose: Use restricted rewrites instead of globally returning HTML for missing JSON.
test('UnitT10_deep_page_rewrites_do_not_match_data_or_assets',async()=>{
 const root=await createBuildRoot();
 try {
  await buildFixture(root);
  const rules=await readFile(join(root,'dist','_redirects'),'utf8');
  assert.match(rules,/^\/skills\/\* \/ 200$/m);
  assert.match(rules,/^\/weapons\/\* \/ 200$/m);
  assert.match(rules,/^\/blessings\/\* \/ 200$/m);
  assert.doesNotMatch(rules,/^\/(?:\*|data|assets)/m);
 }finally{await disposeBuildRoot(root);}
});
