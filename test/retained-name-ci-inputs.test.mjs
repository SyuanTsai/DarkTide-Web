import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modsCommit = '241ad76ce62330472aa423055a5b85db59bb6c0d';
const sourceCommit = 'e46b8926cfa3fa35503e4b80b15aab7a804314e4';
const checkoutAction = 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803';
const currentCompositionCommit = 'bfa9fd93c74eef47353f71b94d8cede987cd2b9e';
const retainedRootsEnv = ['SYP_W07_RETAINED_MODS_ROOT', 'SYP_W07_RETAINED_SOURCE_ROOT'];
const retainedInputsAction = './.github/actions/retained-name-inputs';

async function workflow(name) {
  return parseYaml(await readFile(path.join(repoRoot, '.github', 'workflows', name), 'utf8'));
}

async function retainedInputs() {
  return parseYaml(await readFile(path.join(repoRoot, '.github', 'actions', 'retained-name-inputs', 'action.yml'), 'utf8'));
}

function stepWithName(job, name) {
  const step = job.steps.find(row => row.name === name);
  assert.ok(step, `workflow step exists: ${name}`);
  return step;
}

function assertPinnedCheckout(step, name, repository, commit, pathPrefix, sparsePath) {
  assert.equal(step.name, name);
  assert.equal(step.uses, checkoutAction);
  assert.equal(step.with.repository, repository);
  assert.equal(step.with.ref, commit);
  assert.equal(step.with.path, pathPrefix);
  assert.equal(step.with['fetch-depth'], 1);
  assert.equal(step.with['persist-credentials'], false);
  assert.ok(String(step.with['sparse-checkout']).split(/\r?\n/u).includes(sparsePath));
  assert.equal(step.if, "steps.detect.outputs.required == 'true'");
}

function assertConditionalRoots(step) {
  assert.equal(step.env[retainedRootsEnv[0]], '${{ steps.retained-name-inputs.outputs.mods-root }}');
  assert.equal(step.env[retainedRootsEnv[1]], '${{ steps.retained-name-inputs.outputs.source-root }}');
}

function assertRetainedInputsUseAction(job, name = 'Acquire retained-name inputs') {
  const step = stepWithName(job, name);
  assert.equal(step.id, 'retained-name-inputs');
  assert.equal(step.uses, retainedInputsAction);
  return step;
}

// Scenario: static CI validates Web without retained names in its fixed W07 input.
// Purpose: avoid making unrelated existing runs depend on public Mods or Source availability.
test('UnitT10_ScenarioStaticCiWithoutRetainedNames_PurposeSkipsUpstreamCheckouts', async () => {
  const config = await workflow('static-ci.yml');
  const job = config.jobs['static-package'];
  const inputs = assertRetainedInputsUseAction(job);
  assert.ok(job.steps.indexOf(inputs) < job.steps.indexOf(stepWithName(job, 'Test')));
  const action = await retainedInputs();
  assert.equal(action.outputs.required.value, '${{ steps.detect.outputs.required }}');
  assert.equal(action.outputs['mods-root'].value, "${{ steps.detect.outputs.required == 'true' && format('{0}/retained-name-mods', github.workspace) || '' }}");
  assert.equal(action.outputs['source-root'].value, "${{ steps.detect.outputs.required == 'true' && format('{0}/retained-name-source', github.workspace) || '' }}");
  const detector = stepWithName(action.runs, 'Detect fixed retained-name inputs');
  assert.equal(detector.id, 'detect');
  assert.match(detector.run, /retained-name-overlay-scan\.mjs/u);
  assertPinnedCheckout(stepWithName(action.runs, 'Check out the pinned public Mods identity map for retained weapon names'),
    'Check out the pinned public Mods identity map for retained weapon names', 'SyuanTsai/Warhammer-40-000-DARKTIDE-Mods', modsCommit, 'retained-name-mods', 'Game Info/releases/1.13.X/blessings/data');
  assertPinnedCheckout(stepWithName(action.runs, 'Check out pinned public 1.13.4 weapon templates'),
    'Check out pinned public 1.13.4 weapon templates', 'Aussiemon/Darktide-Source-Code', sourceCommit, 'retained-name-source', 'scripts/settings/equipment/weapon_templates');
  const testStep = stepWithName(job, 'Test');
  assertConditionalRoots(testStep);
});

// Scenario: W09 candidate/release workflows replay old selected content and may later contain retained names.
// Purpose: gate both pinned external roots on verified W07 authoring bytes while preserving fail-closed compiler inputs.
test('UnitT20_ScenarioW09OverlayHasRetainedNames_PurposeChecksOutAndPassesPinnedRoots', async () => {
  const candidate = await workflow('shared-candidate.yml');
  const candidateJob = candidate.jobs['proposal-candidate'];
  const candidateInputs = assertRetainedInputsUseAction(candidateJob);
  assert.ok(candidateJob.steps.indexOf(candidateInputs)
    < candidateJob.steps.indexOf(stepWithName(candidateJob, 'Prepare or update the revision-scoped candidate PR')),
  'the scanner must decide which roots are needed before a new Source proposal is prepared');
  assertConditionalRoots(stepWithName(candidateJob, 'Prepare or update the revision-scoped candidate PR'));

  const release = await workflow('shared-release.yml');
  const releaseJob = release.jobs['shared-release'];
  const historyCheckout = stepWithName(releaseJob, 'Check out the pinned historical W09 composition inputs');
  assert.equal(historyCheckout.uses, checkoutAction);
  assert.equal(historyCheckout.with.repository, 'SyuanTsai/DarkTide-Web');
  assert.equal(historyCheckout.with.ref, currentCompositionCommit);
  assert.equal(historyCheckout.with.path, 'composition-inputs');
  assert.equal(historyCheckout.with['persist-credentials'], false);
  const releaseInputs = assertRetainedInputsUseAction(releaseJob);
  assert.ok(releaseJob.steps.indexOf(releaseInputs) < releaseJob.steps.indexOf(historyCheckout));
  assert.match(releaseInputs.if, /steps\.selected\.outputs\.run == 'true'/u);
  assert.match(releaseInputs.if, /steps\.freshness\.outputs\.current == 'true'/u);
  assert.match(releaseInputs.if, /inputs\.action != 'rollback'/u);
  const promoteStep = stepWithName(releaseJob, 'Promote the selected shared composition');
  assertConditionalRoots(promoteStep);
  assert.equal(promoteStep.env.W09_COMPOSITION_ROOT, '${{ github.workspace }}/composition-inputs');
  assert.equal(promoteStep.env.W09_EXPECTED_COMPOSITION_COMMIT, currentCompositionCommit);
  assert.doesNotMatch(String(stepWithName(releaseJob, 'Restore the explicit approved whole-site snapshot').env.SYP_W07_RETAINED_MODS_ROOT ?? ''), /retained-name-mods/u,
    'rollback does not acquire retained-name upstream checkouts');
});

// Scenario: retained-name inputs are acquired by three CI workflows.
// Purpose: keep external immutable pins in one composite action and account identity out of workflow env.
test('UnitT25_ScenarioWorkflowInputs_PurposeUsesOneActionAndNoWorkflowAccountId', async () => {
  for (const name of ['static-ci.yml', 'shared-candidate.yml', 'shared-release.yml']) {
    const document = await workflow(name);
    const job = document.jobs[name === 'static-ci.yml' ? 'static-package' : name === 'shared-candidate.yml' ? 'proposal-candidate' : 'shared-release'];
    assertRetainedInputsUseAction(job);
  }
  const workflowRoot = path.join(repoRoot, '.github', 'workflows');
  const actionRoot = path.join(repoRoot, '.github', 'actions', 'retained-name-inputs', 'action.yml');
  const workflowTexts = await Promise.all(['static-ci.yml', 'shared-candidate.yml', 'shared-release.yml', 'operations-restore.yml']
    .map(name => readFile(path.join(workflowRoot, name), 'utf8')));
  const allWorkflowText = workflowTexts.join('\n');
  for (const pin of [modsCommit, sourceCommit]) assert.equal(allWorkflowText.includes(pin), false, `${pin} only belongs to the composite action`);
  assert.equal((await readFile(actionRoot, 'utf8')).includes(modsCommit), true);
  assert.equal((await readFile(actionRoot, 'utf8')).includes(sourceCommit), true);
  assert.equal(allWorkflowText.includes('38d350980998e83d3f405aff0170921a'), false, 'workflows do not set Cloudflare account identity');
});

// Scenario: A fresh Windows checkout enables core.autocrlf while the W08 compiler hashes tracked executable bytes.
// Purpose: Keep every pinned compiler file byte-identical to its Git blob on Windows, including newly added transitive modules.
test('UnitT30_ScenarioWindowsAutocrlfCheckout_PurposeKeepsPinnedExecutableBytesExact', async () => {
  const pinnedPaths = [
    'scripts/content/retained-name-evidence.mjs',
    'src/published/contract.mjs',
  ];
  const temporaryRoot = await mkdtemp(path.join(repoRoot, '.tmp-autocrlf-fixture-'));
  const sourceRoot = path.join(temporaryRoot, 'source');
  const checkoutRoot = sourceRoot;
  await mkdir(sourceRoot);
  const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  try {
    await writeFile(path.join(sourceRoot, '.gitattributes'), await readFile(path.join(repoRoot, '.gitattributes')));
    for (const relativePath of pinnedPaths) {
      const sourcePath = path.join(repoRoot, ...relativePath.split('/'));
      const destination = path.join(sourceRoot, ...relativePath.split('/'));
      await mkdir(path.dirname(destination), { recursive: true });
      const sourceText = (await readFile(sourcePath)).toString('utf8').replace(/\r\n?/gu, '\n');
      await writeFile(destination, sourceText, 'utf8');
    }
    git(sourceRoot, 'init', '--quiet', '--initial-branch=main');
    git(sourceRoot, 'config', 'user.name', 'Windows checkout fixture');
    git(sourceRoot, 'config', 'user.email', 'windows-checkout@example.test');
    git(sourceRoot, 'config', 'core.autocrlf', 'false');
    git(sourceRoot, 'add', '--', '.gitattributes', ...pinnedPaths);
    git(sourceRoot, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Create pinned executable byte fixture');

    git(checkoutRoot, 'config', 'core.autocrlf', 'true');
    await rm(path.join(checkoutRoot, '.gitattributes'));
    for (const relativePath of pinnedPaths) await rm(path.join(checkoutRoot, ...relativePath.split('/')));
    git(checkoutRoot, 'checkout', '--quiet', 'HEAD', '--', '.gitattributes');
    git(checkoutRoot, 'checkout', '--quiet', 'HEAD', '--', ...pinnedPaths);
    assert.equal(git(checkoutRoot, 'config', '--get', 'core.autocrlf'), 'true');

    for (const relativePath of pinnedPaths) {
      assert.match(git(checkoutRoot, 'check-attr', 'eol', '--', relativePath), /: eol: lf$/u,
        `${relativePath} has an explicit LF checkout rule`);
      const workingBytes = await readFile(path.join(checkoutRoot, ...relativePath.split('/')));
      const committedBytes = execFileSync('git', ['-C', checkoutRoot, 'show', 'HEAD:' + relativePath], {
        encoding: null,
        windowsHide: true,
      });
      assert.deepEqual(workingBytes, committedBytes, `${relativePath} checkout bytes equal the pinned Git blob`);
      assert.equal(createHash('sha256').update(workingBytes).digest('hex'),
        createHash('sha256').update(committedBytes).digest('hex'), `${relativePath} pin SHA-256 remains stable`);
    }
  } finally {
    const resolved = path.resolve(temporaryRoot);
    if (path.dirname(resolved) !== path.resolve(repoRoot)
        || !path.basename(resolved).startsWith('.tmp-autocrlf-fixture-')) {
      throw new Error('refusing to remove a test directory outside its exact temp root');
    }
    await rm(resolved, { recursive: true, force: true });
  }
});
