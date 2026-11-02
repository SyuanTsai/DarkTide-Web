import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

const config = JSON.parse(await readFile(new URL('../wrangler.w01-preview.json', import.meta.url), 'utf8'));
const history = JSON.parse(await readFile(new URL('../docs/w01/history.json', import.meta.url), 'utf8'));
const retainedHistory = JSON.parse(await readFile(new URL('../docs/w01/retained-history.json', import.meta.url), 'utf8'));
const historyScript = await readFile(new URL('../scripts/w01-history.mjs', import.meta.url), 'utf8');
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
  const receipt = steps.find(step => step.name === 'Verify the deployed preview and write a deployment receipt');
  assert.equal(receipt['working-directory'], 'web');
  assert.equal(receipt.env.W01_DEPLOYMENT_RECEIPT, '${{ runner.temp }}/w01-preview-deployment-receipt.json');
  assert.equal(receipt.env.W01_PREVIOUS_PACKAGE_ROOT, '${{ runner.temp }}/w01-real-r16');
});

// Scenario: preview history is unchanged on an ordinary pull request, or explicitly rebuilt by workflow dispatch.
// Purpose: describe history once, restore only verified Release bytes by default, and preserve every lifecycle fixture needed by tests.
test('UnitT02_workflow-restores-or-rebuilds-history-from-the-committed-list', () => {
  const expectedVersions = ['baseline', '0.0.1', '0.0.2', '0.0.3', '0.0.4', '0.0.5', '0.0.6', '0.0.7', '0.0.8', '0.0.9', '0.0.10', '0.0.11', '0.0.12', '0.0.13', '0.0.14', '0.0.15', '0.0.16'];
  const expectedCommits = [
    '8a4b3db2b1e835f0757f387ca89a19b9092b35ee',
    '872bd72bad255d40af62329b8ffe97a357935275',
    'a7fabea66f56cd5c8236b6e84a3f6c6586175840',
    'e516a5b896f78273544c16047126c327337a8424',
    'b401ae50d7ebb7e44aeb59a8c864a8b93628aead',
    'a09863ceac2bfca3944d09081c315d62b704563c',
    'f2a465e9858e57c3a4850126522dacc71226453d',
    'a11bdb73d4e00b735051bfcb55685623c05c9c12',
    'b55cc3e21024b364bc6aa95f4ad46a9a3f6c48a1',
    'd4a99510ea355b4703cf715c7f0978209cb04dd0',
    '9c84344642cef3a82085dac3e6d4874bf9d2a4c5',
    '3cf93b2e8c9acdcdc7ea5695c24e57a49c04b9b1',
    '869f03f829b377ed4779ec73f55baf8a7507d6c4',
    '58487ee15c16e398b091c9ad2c29322f3bf5548e',
    'b57d6268a470009a560eb03a8a3da4ba6748f106',
    'b3836b0e4ed8698aefff2973ad77a507709a39a9',
    'd0b39c44df0905783d24e1dd1aa5ab0306a18d55',
  ];
  const expectedFreezes = ['w01-real-r3', 'w01-real-r4', 'w01-real-r5', 'w01-real-r6', 'w01-real-r7', 'w01-real-r12', 'w01-real-r13', 'w01-real-r14', 'w01-real-r15', 'w01-real-r16'];

  assert.equal(history.schemaVersion, 1);
  assert.deepEqual(history.entries.map(entry => entry.version), expectedVersions);
  assert.deepEqual(history.entries.map(entry => entry.commit), expectedCommits);
  assert.ok(history.entries.slice(3).every(entry => entry.build.includes('--candidate-preview')));
  assert.deepEqual(history.entries.filter(entry => entry.freeze).map(entry => entry.freeze), expectedFreezes);
  assert.equal(history.release.tag, 'w01-retained-history');
  assert.deepEqual(retainedHistory.freezes, expectedFreezes);

  const job = workflow.jobs['isolated-preview'];
  const steps = job.steps;
  const checkouts = steps.filter(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkouts.length, 4);
  assert.equal(checkouts[0].with['fetch-depth'], 0, 'web candidate needs full history for pinned-commit tests');
  assert.deepEqual(checkouts.slice(1).map(step => step.with['fetch-depth']), [1, 1, 1]);
  assert.equal(checkouts.some(step => step.with.path?.startsWith('prior-real-')), false);
  assert.ok(workflow.on.workflow_dispatch.inputs.full_rebuild);
  assert.ok(workflow.on.workflow_dispatch.inputs.publish_history);
  assert.ok(workflow.on.pull_request.paths.includes('docs/w01/history.json'));
  assert.ok(workflow.on.pull_request.paths.includes('docs/w01/retained-history.json'));

  const policy = steps.find(step => step.name === 'Classify retained-history policy');
  assert.match(policy.run, /docs\/w01\/history\.json docs\/w01\/retained-history\.json docs\/w01\/retained-preview-manifest\.json/);
  assert.match(policy.run, /W01_FULL_REBUILD/);
  assert.match(policy.run, /W01_PUBLISH_HISTORY/);
  const prepare = steps.find(step => step.name === 'Restore or rebuild retained W01 history');
  assert.equal(prepare.id, 'retained-history');
  assert.match(prepare.run, /scripts\/w01-history\.mjs/);
  assert.match(prepare.run, /--force-rebuild/);
  assert.match(prepare.run, /--summary/);
  assert.match(historyScript, /SHA-256 mismatch/);
  assert.match(historyScript, /release-not-found/);
  assert.match(historyScript, /worktree.*add/s);

  const currentBuild = steps.findIndex(step => step.name === 'Build current pending 0.0.17 candidate preview');
  const currentRetain = steps.findIndex(step => step.name === 'Retain the pinned baseline in current 0.0.17 candidate');
  const currentVerify = steps.findIndex(step => step.name === 'Verify current 0.0.17 and retained historical data URLs');
  const runTests = steps.findIndex(step => step.name === 'Run Web tests against pinned lifecycle packages');
  assert.ok(steps.indexOf(prepare) < currentBuild && currentBuild < currentRetain && currentRetain < currentVerify && currentVerify < runTests);
  const testEnv = steps[runTests].env;
  assert.equal(testEnv.W01_PRIOR_R1_ROOT, '${{ github.workspace }}/prior-r1');
  assert.equal(testEnv.W01_PRIOR_R2_ROOT, '${{ github.workspace }}/prior-r2');
  assert.equal(testEnv.W01_BASELINE_ROOT, '${{ github.workspace }}/baseline');
  assert.equal(Object.hasOwn(testEnv, 'W01_PRIOR_REAL_R14_ROOT'), false);
  assert.deepEqual(Object.keys(testEnv).filter(key => key.startsWith('W01_PRIOR_REAL_')).sort(), [
    'W01_PRIOR_REAL_R12_ROOT', 'W01_PRIOR_REAL_R13_ROOT', 'W01_PRIOR_REAL_R15_ROOT', 'W01_PRIOR_REAL_R16_ROOT',
    'W01_PRIOR_REAL_R3_ROOT', 'W01_PRIOR_REAL_R4_ROOT', 'W01_PRIOR_REAL_R5_ROOT', 'W01_PRIOR_REAL_R6_ROOT', 'W01_PRIOR_REAL_R7_ROOT',
  ]);

  const releaseAssets = steps.find(step => step.name === 'Upload rebuilt retained-history release assets');
  assert.match(releaseAssets.if, /workflow_dispatch/);
  assert.match(releaseAssets.if, /inputs\.publish_history == true/);
  assert.equal(workflow.jobs['publish-retained-history'].permissions.contents, 'write');
  assert.match(workflow.jobs['publish-retained-history'].if, /inputs\.publish_history == true/);
  assert.match(workflow.jobs['publish-retained-history'].steps.at(-1).run, /gh release upload w01-retained-history/);
});

// Scenario: a push contains only contract/schema/fixture/docs/test and deploy-guard changes.
// Purpose: keep the existing 0.0.17 preview build available while preventing deployment, receipt creation, and receipt upload.
test('UnitT03_workflow-gates-deployment-and-receipts-on-runtime-paths', () => {
  const steps = workflow.jobs['isolated-preview'].steps;
  const scope = steps.find(step => step.name === 'Classify W01 deployment scope');
  assert.ok(scope);
  assert.equal(scope.id, 'deployment-scope');
  assert.equal(scope.if, "github.event_name == 'push'");
  assert.equal(scope['working-directory'], 'web');
  assert.equal(scope.env.W01_DEPLOYMENT_SCOPE_BASE, '${{ github.event.before }}');
  assert.equal(scope.env.W01_DEPLOYMENT_SCOPE_HEAD, '${{ github.sha }}');
  assert.match(scope.run, /w01-preview-deploy-scope\.mjs/);

  const deploymentSteps = [
    steps.find(step => step.name === 'Deploy only the fixed W01 preview worker'),
    steps.find(step => step.name === 'Verify the deployed preview and write a deployment receipt'),
    steps.find(step => step.name === 'Upload the public preview deployment receipt'),
  ];
  assert.ok(deploymentSteps.every(Boolean));
  assert.equal(new Set(deploymentSteps.map(step => step.if)).size, 1);
  assert.match(deploymentSteps[0].if, /steps\.deployment-scope\.outputs\.should_deploy == 'true'/);
  assert.ok(deploymentSteps.every(step => step.if.includes("github.event_name == 'push'")));
  assert.ok(deploymentSteps.every(step => step.if.includes("github.repository == 'SyuanTsai/DarkTide-Web'")));
  assert.ok(deploymentSteps.every(step => step.if.includes("github.ref == 'refs/heads/codex/SYP-311-w01'")));
});
