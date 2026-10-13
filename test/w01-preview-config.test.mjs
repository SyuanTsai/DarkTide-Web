import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

const config = JSON.parse(await readFile(new URL('../wrangler.w01-preview.json', import.meta.url), 'utf8'));
const workflow = parse(await readFile(new URL('../.github/workflows/w01-preview.yml', import.meta.url), 'utf8'));

// Scenario: the W01 preview deploy config is used by the branch-only worker workflow.
// Purpose: pin the target worker and static output directory, and reject production routes or entrypoints.
test('UnitT00_preview-config-is-a-pure-fixed-static-worker', () => {
  assert.deepEqual(Object.keys(config).sort(), ['account_id', 'assets', 'compatibility_date', 'name', 'workers_dev']);
  assert.equal(config.name, 'darktide-zh-tw-preview');
  assert.equal(config.account_id, '38d350980998e83d3f405aff0170921a');
  assert.equal(config.workers_dev, true);
  assert.deepEqual(config.assets, { directory: './dist-w01', not_found_handling: 'none' });
  assert.equal(Object.hasOwn(config, 'routes'), false);
  assert.equal(Object.hasOwn(config, 'main'), false);
});

// Scenario: the W01 CI workflow receives a push event or a pull request.
// Purpose: keep CI read-only, deploy only the exact W01 branch head, and scope Cloudflare credentials to one step.
test('UnitT01_workflow-deploys-only-the-guarded-preview-worker', () => {
  assert.equal(workflow.permissions.contents, 'read');
  assert.deepEqual(workflow.on.push.branches, ['codex/SYP-311-w01']);
  assert.ok(workflow.on.pull_request);
  const steps = workflow.jobs['isolated-preview'].steps;
  const deploy = steps.find(step => step.name === 'Deploy only the fixed W01 preview worker');
  assert.ok(deploy);
  assert.match(deploy.if, /github\.repository == 'SyuanTsai\/DarkTide-Web'/);
  assert.match(deploy.if, /github\.ref == 'refs\/heads\/codex\/SYP-311-w01'/);
  assert.deepEqual(Object.keys(deploy.env), ['CLOUDFLARE_API_TOKEN']);
  assert.match(deploy.run, /GITHUB_REPOSITORY/);
  assert.match(deploy.run, /GITHUB_REF/);
  assert.match(deploy.run, /git fetch/);
  assert.match(deploy.run, /branch_head.*GITHUB_SHA/);
  assert.match(deploy.run, /wrangler deploy --config wrangler\.w01-preview\.json/);
  assert.doesNotMatch(deploy.run, /cloudflare-deploy\.mjs|deploy:cloudflare|wrangler\.json/);
  const secretConsumers = steps.filter(step => JSON.stringify(step).includes('secrets.'));
  assert.deepEqual(secretConsumers, [deploy]);
  assert.ok(steps.some(step => step.name === 'Verify the deployed preview and write a deployment receipt'));
});

// Scenario: the pending 0.0.4 candidate starts from an empty runner with historical preview URLs.
// Purpose: rebuild exact R1, A, and published 0.0.3 inputs, then compile and verify 0.0.4 before preview-only deploy.
test('UnitT02_workflow-builds-pending-candidate-after-pinned-history', () => {
  const steps = workflow.jobs['isolated-preview'].steps;
  const priorR1Checkout = steps.find(step => step.name === 'Check out the exact pinned R1 preview source');
  const priorR2Checkout = steps.find(step => step.name === 'Check out the exact published R2 A data source');
  const priorRealR1Checkout = steps.find(step => step.name === 'Check out the exact published pending 0.0.3 candidate source');
  const baselineBuild = steps.findIndex(step => step.name === 'Rebuild the pinned production baseline data');
  const r1Build = steps.findIndex(step => step.name === 'Rebuild exact R1 package into the candidate output');
  const r1Retain = steps.findIndex(step => step.name === 'Retain the pinned production baseline in R1 package');
  const r1Verify = steps.findIndex(step => step.name === 'Verify exact R1 package and retained data');
  const r2Build = steps.findIndex(step => step.name === 'Rebuild exact published R2 A package into the candidate output');
  const r2Retain = steps.findIndex(step => step.name === 'Retain the pinned production baseline in exact R2 A package');
  const r2Verify = steps.findIndex(step => step.name === 'Verify exact published R2 A and retained R1 and production data revisions');
  const priorRealR1Build = steps.findIndex(step => step.name === 'Rebuild exact published real 0.0.3 package into the candidate output');
  const priorRealR1Retain = steps.findIndex(step => step.name === 'Retain the pinned production baseline in exact 0.0.3 package');
  const priorRealR1Verify = steps.findIndex(step => step.name === 'Verify exact published real 0.0.3 and retained historical data URLs');
  const candidateBuild = steps.find(step => step.name === 'Build current pending W01 candidate preview');
  const candidateRetain = steps.findIndex(step => step.name === 'Retain the pinned baseline in the pending candidate');
  const candidateVerify = steps.findIndex(step => step.name === 'Verify the pending candidate and retained historical data URLs');
  const upload = steps.findIndex(step => step.name === 'Upload only the isolated W01 preview artifact');
  const deploy = steps.findIndex(step => step.name === 'Deploy only the fixed W01 preview worker');
  const deploymentReceipt = steps.findIndex(step => step.name === 'Verify the deployed preview and write a deployment receipt');
  const receiptUpload = steps.findIndex(step => step.name === 'Upload the public preview deployment receipt');
  const order = [baselineBuild, r1Build, r1Retain, r1Verify, r2Build, r2Retain, r2Verify, priorRealR1Build, priorRealR1Retain, priorRealR1Verify, steps.indexOf(candidateBuild), candidateRetain, candidateVerify, upload, deploy, deploymentReceipt, receiptUpload];

  assert.equal(priorR1Checkout.with.ref, '872bd72bad255d40af62329b8ffe97a357935275');
  assert.equal(priorR2Checkout.with.ref, 'a7fabea66f56cd5c8236b6e84a3f6c6586175840');
  assert.equal(priorR2Checkout.with.path, 'prior-r2');
  assert.equal(priorR2Checkout.with.repository, 'SyuanTsai/DarkTide-Web');
  assert.equal(priorR2Checkout.with['persist-credentials'], false);
  assert.equal(priorRealR1Checkout.with.ref, 'e516a5b896f78273544c16047126c327337a8424');
  assert.equal(priorRealR1Checkout.with.path, 'prior-real-0-0-3');
  assert.equal(priorRealR1Checkout.with.repository, 'SyuanTsai/DarkTide-Web');
  assert.equal(priorRealR1Checkout.with['persist-credentials'], false);
  assert.ok(order.every(index => index >= 0));
  assert.ok(baselineBuild < r1Build);
  assert.ok(r1Build < r1Retain && r1Retain < r1Verify);
  assert.ok(r1Verify < r2Build && r2Build < r2Retain && r2Retain < r2Verify);
  assert.ok(r2Verify < priorRealR1Build && priorRealR1Build < priorRealR1Retain && priorRealR1Retain < priorRealR1Verify);
  assert.ok(priorRealR1Verify < steps.indexOf(candidateBuild) && steps.indexOf(candidateBuild) < candidateRetain);
  assert.ok(candidateRetain < candidateVerify && candidateVerify < upload && upload < deploy);
  assert.equal(candidateBuild['working-directory'], 'web');
  assert.equal(steps[priorRealR1Build]['working-directory'], 'prior-real-0-0-3');
  assert.match(steps[priorRealR1Build].run, /w01:build -- --candidate-preview --output \.\.\/web\/dist-w01/);
  assert.match(steps[priorRealR1Retain].run, /--baseline-root \.\.\/baseline --output \.\.\/web\/dist-w01/);
  assert.match(steps[priorRealR1Verify].run, /w01:verify -- \.\.\/web\/dist-w01/);
  assert.match(candidateBuild.run, /w01:build -- --candidate-preview --output dist-w01/);
  assert.match(steps[candidateRetain].run, /--baseline-root \.\.\/baseline --output dist-w01/);
  assert.match(steps[candidateVerify].run, /w01:verify -- dist-w01/);
  assert.equal(steps.some(step => step.name === 'Restore fixed R1 from exact published R2 A'), false);
  assert.equal(steps.some(step => JSON.stringify(step).includes('w01:rollback-r1')), false);
  assert.ok(deploy < deploymentReceipt && deploymentReceipt < receiptUpload);
});
