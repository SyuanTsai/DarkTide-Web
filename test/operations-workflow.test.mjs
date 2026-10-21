import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
const load = async name => parse(await readFile(new URL('../.github/workflows/' + name, import.meta.url), 'utf8'));

// Scenario: PR builds, scheduled probes, and post-deploy backups run with distinct authority.
// Purpose: No PR/monitor/backup can acquire the Cloudflare deploy secret; only trusted main creates backups/incidents.
test('UnitT10_operations_workflows_keep_credentials_out_of_PR_and_backup', async () => {
  const ci = await load('static-ci.yml');
  const backup = ci.jobs.backup;
  assert.deepEqual(backup.needs, ['static-package', 'deploy']);
  assert.match(backup.if, /needs\.deploy\.outputs\.verified == 'true'/);
  assert.match(backup.if, /event_name != 'pull_request'/);
  assert.equal(backup.permissions.contents, 'write');
  assert.ok(!JSON.stringify(backup).includes('secrets.'));
  const monitor = await load('operations-monitor.yml');
  assert.equal(monitor.on.schedule[0].cron, '17,47 * * * *');
  assert.ok(!JSON.stringify(monitor).includes('secrets.'));
  assert.match(monitor.jobs.monitor.if, /event_name != 'pull_request'/);
  assert.match(monitor.jobs.monitor.if, /refs\/heads\/main/);
  assert.equal(monitor.jobs.monitor.permissions.issues, 'write');
  assert.equal(monitor.jobs.contract.permissions, undefined);
});

// Scenario: An operator chooses an old retained package and leaves publication disabled.
// Purpose: Restore verification cannot silently deploy; explicit publication consumes the verified package without rebuilding it.
test('UnitT20_recovery_is_manual_main_only_and_defaults_to_isolated_verification', async () => {
  const recovery = await load('operations-restore.yml');
  assert.deepEqual(Object.keys(recovery.on), ['workflow_dispatch']);
  assert.equal(recovery.on.workflow_dispatch.inputs.publish.default, false);
  assert.match(recovery.jobs.restore.if, /refs\/heads\/main/);
  const steps = recovery.jobs.restore.steps;
  const deploy = steps.find(step => step.run === 'npm run deploy:cloudflare');
  assert.equal(deploy.if, 'inputs.publish == true');
  assert.ok(steps.some(step => step.run?.includes('operations-restore.mjs --backup .operations/retained --output dist')));
  assert.ok(steps.some(step => step.run === 'npm run smoke:cloudflare'));
  assert.ok(!steps.some(step => /npm run build|prepare:deploy/.test(step.run || '')));
  assert.equal(recovery.jobs.restore.concurrency.group, 'darktide-cloudflare-production');
});
