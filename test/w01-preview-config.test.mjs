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

// Scenario: a clean preview runner reconstructs R1 before compiling the current R2 candidate.
// Purpose: pin the historical input and enforce the build/retain/verify ordering that preserves every immutable data URL.
test('UnitT02_workflow-rebuilds-fixed-r1-before-r2', () => {
  const steps = workflow.jobs['isolated-preview'].steps;
  const priorR1Checkout = steps.find(step => step.name === 'Check out the exact pinned R1 preview source');
  const baselineBuild = steps.findIndex(step => step.name === 'Rebuild the pinned production baseline data');
  const r1Build = steps.findIndex(step => step.name === 'Rebuild exact R1 package into the candidate output');
  const r1Retain = steps.findIndex(step => step.name === 'Retain the pinned production baseline in R1 package');
  const r1Verify = steps.findIndex(step => step.name === 'Verify exact R1 package and retained data');
  const r2Build = steps.findIndex(step => step.name === 'Build the R2 isolated W01 fixture preview');
  const r2Retain = steps.findIndex(step => step.name === 'Retain the pinned production baseline in R2 package');
  const r2Verify = steps.findIndex(step => step.name === 'Verify R2 and the retained R1 and production data revisions');
  const order = [baselineBuild, r1Build, r1Retain, r1Verify, r2Build, r2Retain, r2Verify];

  assert.equal(priorR1Checkout.with.ref, '872bd72bad255d40af62329b8ffe97a357935275');
  assert.ok(order.every(index => index >= 0));
  assert.ok(baselineBuild < r1Build);
  assert.ok(r1Build < r1Retain && r1Retain < r1Verify);
  assert.ok(r1Verify < r2Build && r2Build < r2Retain && r2Retain < r2Verify);
  assert.equal(steps.some(step => step.name.includes('rollback')), false);
});
