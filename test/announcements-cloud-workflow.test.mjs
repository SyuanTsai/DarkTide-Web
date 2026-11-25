import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const workflowUrl = new URL('../.github/workflows/announcements-intake.yml', import.meta.url);
const source = await readFile(workflowUrl, 'utf8');
const workflow = parse(source);
const watchWorkflowUrl = new URL('../.github/workflows/announcements-watch.yml', import.meta.url);
const watchWorkflow = parse(await readFile(watchWorkflowUrl, 'utf8'));
const job = workflow.jobs.intake;
const steps = job.steps;
const stepText = step => JSON.stringify(step);
const secretValueSteps = secret => steps.filter(step => Object.values(step.env ?? {}).includes(`\${{ secrets.${secret} }}`));

// Scenario: The cloud intake workflow is inspected without running it.
// Purpose: protect its trigger, trust boundary, least-privilege permissions, and concurrency contract.
test('UnitT10_cloud_intake_has_the_expected_triggers_guard_and_permissions', () => {
  assert.equal(workflow.on.schedule[0].cron, '0 11 * * *');
  assert.equal(watchWorkflow.on.schedule[0].cron, '0 13 * * *');
  assert.equal(workflow.on.workflow_dispatch.inputs.topics.required, false);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.batch, {
    description: 'Batch override (YYYYMMDD); dry runs only',
    required: false,
    type: 'string',
  });
  assert.equal(workflow.on.workflow_dispatch.inputs.dry_run.default, false);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.provider.options, ['default', 'openai', 'anthropic']);
  assert.match(job.if, /github\.repository == 'SyuanTsai\/DarkTide-Web'/);
  assert.match(job.if, /github\.ref == 'refs\/heads\/main'/);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency.group, 'announcements-intake');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job['timeout-minutes'], 90);
  assert.doesNotMatch(source, /gh\s+label\s+create\b/);
});

// Scenario: Repository variables choose either supported provider and validated model defaults.
// Purpose: allow provider/model changes without source edits while rejecting shell-hostile values.
test('UnitT20_cloud_intake_resolves_and_validates_provider_configuration', () => {
  const resolve = steps.find(step => step.id === 'ready');
  assert.ok(resolve);
  assert.match(stepText(resolve), /vars\.ANNOUNCEMENTS_TRANSLATOR/);
  assert.match(resolve.run, /openai/);
  assert.match(resolve.run, /anthropic/);
  assert.match(resolve.run, /gpt-5\.6-sol/);
  assert.match(resolve.run, /claude-opus-5-5/);
  assert.match(resolve.run, /\^\[A-Za-z0-9\._-\]\+\$/);
});

// Scenario: A manual dry run needs an unused batch to exercise translation after today's batch exists.
// Purpose: keep the override constrained to valid, dry-run-only batch names while preserving the Taipei default.
test('UnitT25_cloud_intake_validates_dry_run_batch_overrides', () => {
  const resolve = steps.find(step => step.id === 'ready');
  assert.equal(resolve.env.INPUT_BATCH, "${{ inputs.batch || '' }}");
  assert.match(resolve.run, /\[\[ ! "\$INPUT_BATCH" =~ \^\[0-9\]\{8\}\$ \]\]/);
  assert.match(resolve.run, /::error::batch must match \^\[0-9\]\{8\}\$/);
  assert.match(resolve.run, /\[\[ "\$DRY_RUN" != true \]\]/);
  assert.match(resolve.run, /::error::The batch override is only allowed for dry runs\./);
  assert.match(resolve.run, /batch=\$\(TZ=Asia\/Taipei date \+%Y%m%d\)/);
});

// Scenario: Required credentials are absent on a scheduled or manually dispatched run.
// Purpose: make readiness a successful notice-only stop and gate every operational step.
test('UnitT30_cloud_intake_readiness_gates_all_later_operational_steps', () => {
  const checkoutIndex = steps.findIndex(step => /checkout@/.test(step.uses ?? ''));
  const readyIndex = steps.findIndex(step => step.id === 'ready');
  assert.equal(readyIndex, checkoutIndex + 1);
  assert.match(steps[readyIndex].run, /GITHUB_STEP_SUMMARY/);
  assert.match(steps[readyIndex].run, /ready=false/);
  for (const step of steps.slice(readyIndex + 1)) {
    if (step.if === 'always()') continue;
    assert.match(String(step.if ?? ''), /steps\.ready\.outputs\.ready == 'true'/, step.name ?? step.id);
  }
});

// Scenario: Translation uses one tool-less Node process for either provider.
// Purpose: keep provider keys out of agents and GitHub-authenticated steps.
test('UnitT40_cloud_intake_uses_one_direct_API_step_and_isolates_provider_secrets', () => {
  assert.doesNotMatch(source, /\bnpx\b|\bcodex\b|claude-code/i);
  const translationSteps = steps.filter(step => /Translate with the provider API/.test(step.name ?? ''));
  assert.equal(translationSteps.length, 1);
  const [translation] = translationSteps;
  assert.ok(!('GH_TOKEN' in translation.env));
  assert.ok(!('GITHUB_TOKEN' in translation.env));
  assert.match(translation.run, /announcements-translate\.mjs/);
  assert.deepEqual(secretValueSteps('OPENAI_API_KEY'), [translation]);
  assert.deepEqual(secretValueSteps('ANTHROPIC_API_KEY'), [translation]);
});

// Scenario: Readiness, selection, or duplicate guards stop before capture.
// Purpose: prevent stale batch directories and logs from being uploaded on no-op runs.
test('UnitT45_cloud_intake_upload_requires_all_three_proceed_guards', () => {
  const upload = steps.find(step => /upload-artifact@/.test(step.uses ?? ''));
  assert.ok(upload);
  assert.match(String(upload.if), /always\(\)/);
  assert.match(String(upload.if), /steps\.ready\.outputs\.ready == 'true'/);
  assert.match(String(upload.if), /steps\.select\.outputs\.proceed == 'true'/);
  assert.match(String(upload.if), /steps\.guards\.outputs\.proceed == 'true'/);
  assert.equal(upload.with.name, 'announcements-${{ steps.ready.outputs.batch }}-artifacts');
});

// Scenario: The workflow moves from a dry run to authenticated Git/PR publication.
// Purpose: keep the PAT out of capture/translation and ensure dry runs cannot reach a write step.
test('UnitT50_cloud_intake_limits_the_pat_and_dry_run_stops_before_publication', () => {
  const patSteps = secretValueSteps('ANNOUNCEMENTS_PR_TOKEN');
  assert.ok(patSteps.length >= 2);
  for (const step of patSteps) {
    assert.match(step.name ?? '', /Configure Git identity|Push|Create pull request|Publish/i);
  }
  const writeSteps = steps.filter(step => /Configure Git identity|Push|Create pull request|Publish/i.test(step.name ?? ''));
  assert.ok(writeSteps.length >= 2);
  for (const step of writeSteps) assert.match(String(step.if), /dry_run.*false|DRY_RUN.*false/i);
  const dryRunStep = steps.find(step => /dry.run summary/i.test(step.name ?? ''));
  assert.ok(dryRunStep);
  assert.match(String(dryRunStep.if), /dry_run.*true|DRY_RUN.*true/i);
});

// Scenario: Third-party Actions and every Bash run block are statically inspected.
// Purpose: prevent floating action tags and catch shell syntax regressions before GitHub executes the workflow.
test('UnitT60_cloud_intake_actions_are_sha_pinned_and_bash_blocks_parse', t => {
  for (const step of steps.filter(step => step.uses)) {
    assert.match(step.uses, /^[^@]+@[0-9a-f]{40}$/, step.uses);
  }
  const probe = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT') {
    t.skip('bash is unavailable on PATH');
    return;
  }
  assert.equal(probe.status, 0, probe.stderr);
  for (const [index, step] of steps.entries()) {
    if (!step.run || (step.shell && step.shell !== 'bash')) continue;
    const parsed = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
    assert.equal(parsed.status, 0, `step ${index} ${step.name ?? ''}: ${parsed.stderr}`);
  }
});
