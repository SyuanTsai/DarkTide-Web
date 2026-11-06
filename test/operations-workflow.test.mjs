import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { assertStaticCiWorkflow, assertDeployWorkflow } from '../scripts/verify-deploy-config.mjs';
const load = async name => parse(await readFile(new URL('../.github/workflows/' + name, import.meta.url), 'utf8'));
// Scenario: Scheduled public monitoring runs with incident writes confined to main.
// Purpose: Preserve the schedule, PR credential isolation and new deployment authority.
test('UnitT10_monitor_and_deploy_keep_credentials_and_authority_scoped', async () => {
  const ci = await load('static-ci.yml'); assertStaticCiWorkflow(ci);
  assert.deepEqual(Object.keys(ci.jobs), ['static-package']);
  assert.ok(!JSON.stringify(ci).includes('CLOUDFLARE_API_TOKEN'));
  assertDeployWorkflow(await load('deploy.yml'));
  const monitor = await load('operations-monitor.yml');
  assert.equal(monitor.on.schedule[0].cron, '17,47 * * * *');
  assert.ok(!JSON.stringify(monitor).includes('secrets.'));
  assert.match(monitor.jobs.monitor.if, /event_name != 'pull_request'/);
  assert.match(monitor.jobs.monitor.if, /refs\/heads\/main/);
  assert.equal(monitor.jobs.monitor.permissions.issues, 'write');
  assert.equal(monitor.jobs.contract.permissions, undefined);
  assert.deepEqual(monitor.jobs.monitor.steps[0].with['sparse-checkout'].trim().split(/\s+/u), ['scripts', 'src', 'web']);
});

// Scenario: static CI is changed to add a deploy job that references a Cloudflare secret.
// Purpose: Keep deployment credentials confined to deploy.yml and fail verification on any static-CI secret.
test('UnitT15_static_ci_rejects_secret_bearing_deploy_job', async () => {
  const ci = await load('static-ci.yml');
  ci.jobs.deploy = { env: { CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}' } };

  assert.throws(() => assertStaticCiWorkflow(ci), /static CI must not deploy|static CI must never receive secrets/u);
});
