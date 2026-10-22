import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
const load = async name => parse(await readFile(new URL('../.github/workflows/' + name, import.meta.url), 'utf8'));

// Scenario: PR builds, scheduled probes, and post-deploy backups run with distinct authority.
// Purpose: No PR/monitor/backup can acquire the Cloudflare deploy secret; only trusted main creates backups/incidents, after W09 authority permits a real legacy deployment.
test('UnitT10_operations_workflows_keep_credentials_out_of_PR_and_backup', async () => {
  const ci = await load('static-ci.yml');
  const backup = ci.jobs.backup;
  const deploySteps = ci.jobs.deploy.steps;
  const publish = deploySteps.find(step => step.id === 'publish');
  assert.equal(publish.run, 'npm run deploy:cloudflare');
  for (const guard of ["steps.credential.outputs.ready == 'true'", "steps.freshness.outputs.current == 'true'", "steps.legacy-authority.outputs.allowed == 'true'"]) {
    assert.ok(publish.if.includes(guard), 'publication requires ' + guard);
    assert.ok(ci.jobs.deploy.outputs.verified.includes(guard), 'backup verification requires ' + guard);
  }
  assert.ok(ci.jobs.deploy.outputs.verified.includes("steps.publish.outcome == 'success'"));
  assert.match(ci.jobs.deploy.if, /selected_shared != 'true'/);
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

// Scenario: A legacy backup is chosen after a W09 selection, active release, or interrupted promotion exists.
// Purpose: Execute the workflow's real prepublication gate and prevent retained packages from bypassing W09 whole-site CAS rollback; isolated verification stays available.
test('UnitT25_legacy_restore_refuses_W09_authority_and_state_lookup_failures_before_publication', async t => {
  const recovery = await load('operations-restore.yml');
  const steps = recovery.jobs.restore.steps;
  const gate = steps.find(step => step.name === 'Prevent legacy recovery from bypassing W09 release authority');
  assert.ok(gate, 'legacy recovery needs a W09 publication authority gate');
  assert.equal(gate.if, 'inputs.publish == true');
  assert.ok(!JSON.stringify(gate).includes('secrets.'));
  assert.ok(steps.indexOf(gate) < steps.findIndex(step => step.run === 'npm run deploy:cloudflare'));
  const match = /^node --input-type=module <<'NODE'\n([\s\S]+)\nNODE\n?$/u.exec(gate.run);
  assert.ok(match, 'the tested gate must be the executable workflow body');
  const root = await mkdtemp(path.join(tmpdir(), 'w09 legacy restore guard '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'scripts/content'), { recursive: true });
  const helper = path.join(root, 'scripts/content/contract-w09-state-branch.mjs');
  const selected = path.join(root, 'content/contracts/w09/source-handoff/selected.json');
  const setOwner = text => writeFile(helper, `export async function readW09OwnerStateBranch() { ${text} }\n`);
  const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', match[1]], {
    cwd: root, encoding: 'utf8', windowsHide: true,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH }
  });
  await setOwner('return { status: "empty", active: false };');
  assert.equal(run().status, 0, 'an empty W09 owner permits legacy recovery');
  for (const reason of ['active release', 'pending promotion']) {
    await setOwner(`return { active: true, reason: ${JSON.stringify(reason)} };`);
    const result = run();
    assert.notEqual(result.status, 0, reason);
    assert.match(result.stderr, /W09|shared-release/u);
  }
  await setOwner('throw new Error("owner lookup failed");');
  const failedLookup = run();
  assert.notEqual(failedLookup.status, 0);
  assert.match(failedLookup.stderr, /owner lookup failed/u);
  await setOwner('throw new Error("selected marker must be checked first");');
  await mkdir(path.dirname(selected), { recursive: true });
  await writeFile(selected, '{"selection":"present"}');
  const selectedResult = run();
  assert.notEqual(selectedResult.status, 0);
  assert.match(selectedResult.stderr, /selected W09/u);
  assert.doesNotMatch(selectedResult.stderr, /selected marker must be checked first/u);
  await writeFile(selected, 'invalid json');
  assert.match(run().stderr, /selected W09/u, 'a malformed selection cannot permit legacy publication');
  await rm(selected);
  await mkdir(selected);
  assert.match(run().stderr, /selected W09/u, 'a non-file selection cannot permit legacy publication');
});
