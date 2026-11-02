import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
const load = async name => parse(await readFile(new URL('../.github/workflows/' + name, import.meta.url), 'utf8'));

// Scenario: static CI succeeds before the shared-release workflow deploys and retains an exact W09 package.
// Purpose: Keep one production publisher while separating Cloudflare credentials from retained Release creation.
test('UnitT10_operations_workflows_keep_credentials_out_of_PR_and_backup', async () => {
  const ci = await load('static-ci.yml');
  assert.deepEqual(Object.keys(ci.jobs), ['static-package']);
  assert.ok(!JSON.stringify(ci).includes('CLOUDFLARE_API_TOKEN'));
  assert.ok(!ci.jobs['static-package'].steps.some(step => step.uses?.startsWith('actions/upload-artifact@')));

  const release = await load('shared-release.yml');
  const publish = release.jobs['shared-release'];
  const backup = release.jobs.backup;
  assert.equal(backup.needs, 'shared-release');
  assert.match(backup.if, /verified-and-active/);
  assert.match(backup.if, /verified-and-rolled-back/);
  assert.match(backup.if, /promotion_status == 'already-active'/);
  assert.equal(backup.permissions.contents, 'write');
  assert.ok(!JSON.stringify(backup).includes('secrets.'));
  assert.ok(publish.steps.some(step => step.uses?.startsWith('actions/upload-artifact@')));
  assert.ok(backup.steps.some(step => step.uses?.startsWith('actions/download-artifact@')));
  const lookup = backup.steps.find(step => step.run === 'node scripts/operations-backup-lookup.mjs');
  assert.equal(lookup.if, "needs.shared-release.outputs.promotion_status == 'already-active'");
  assert.equal(lookup.env.ACTIVE_BUILD_ID, '${{ needs.shared-release.outputs.active_build_id }}');
  const publishBackup = backup.steps.find(step => step.run === 'node scripts/operations-publish.mjs');
  assert.match(publishBackup.if, /promotion_status != 'already-active'/);
  assert.match(publishBackup.if, /backup-lookup\.outputs\.backup_required == 'true'/);
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
  assert.equal(deploy.env.CLOUDFLARE_ACCOUNT_ID, undefined, 'the deploy script supplies its configured account to Wrangler');
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
