import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
// Scenario: Inspect the production workflow as structured YAML.
// Purpose: Keep deployment manually pinned and gate it with tests and online commit verification.
test('UnitT10_正式部署只接受手動指定commit並執行前後驗證', async () => {
  const workflow=YAML.parse(await readFile(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8'));
  assert.ok(!JSON.stringify(workflow).includes('retained-name-inputs'));
  assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);assert.equal(workflow.on.workflow_dispatch.inputs.source_data_commit.required,true);
  assert.deepEqual(workflow.permissions,{contents:'read'});assert.equal(workflow.concurrency.group,'darktide-cloudflare-production');assert.equal(workflow.concurrency['cancel-in-progress'],false);
  const job=workflow.jobs.deploy;assert.equal(job.environment,'production');assert.equal(job['runs-on'],'windows-latest');
  const steps=job.steps;const runs=steps.map(s=>s.run??'').join('\n');assert.ok(runs.includes('^[0-9a-f]{40}$'));
  const checkout=steps.find(s=>s.with?.repository==='SyuanTsai/DarkTide-Source-Data');assert.equal(checkout.with.ref,'${{ inputs.source_data_commit }}');assert.equal(checkout.with['persist-credentials'],false);
  const index=command=>steps.findIndex(s=>s.run?.includes(command));assert.ok(index('npm test')<index('scripts/build.mjs'));assert.ok(index('scripts/build.mjs')<index('scripts/cloudflare-deploy.mjs'));assert.ok(index('scripts/cloudflare-deploy.mjs')<index('scripts/cloudflare-runtime-smoke.mjs'));
  assert.ok(runs.includes('--source-data-commit $env:SOURCE_DATA_COMMIT'));assert.ok(runs.includes('--origin https://darktide.tw-syuan.com'));
  for(const step of steps.filter(s=>s.uses?.startsWith('actions/')))assert.match(step.uses,/@[0-9a-f]{40}$/);
  const ci=YAML.parse(await readFile(new URL('../.github/workflows/static-ci.yml',import.meta.url),'utf8'));assert.ok(!JSON.stringify(ci).includes('retained-name-inputs'));assert.ok(ci.on.pull_request===null);assert.ok(ci.on.push);
  assert.equal(ci.jobs['static-package'].steps.filter(s=>s.run?.includes('cloudflare-deploy')).length,0);
});
