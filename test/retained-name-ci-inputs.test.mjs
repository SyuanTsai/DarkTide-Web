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
const historicalCompositionCommit = '82e5ce23409e5b078aeb651d942003d519701a5a';
const retainedRootsEnv = ['SYP_W07_RETAINED_MODS_ROOT', 'SYP_W07_RETAINED_SOURCE_ROOT'];
const conditionalRootExpression = name => "${{ steps.retained-names.outputs.required == 'true' && format('{0}/" + name + "', github.workspace) || '' }}";

async function workflow(name) {
  return parseYaml(await readFile(path.join(repoRoot, '.github', 'workflows', name), 'utf8'));
}

function stepWithName(job, name) {
  const step = job.steps.find(row => row.name === name);
  assert.ok(step, `workflow step exists: ${name}`);
  return step;
}

function assertPinnedCheckout(job, name, repository, commit, pathPrefix, sparsePath) {
  const step = stepWithName(job, name);
  assert.equal(step.uses, checkoutAction);
  assert.equal(step.with.repository, repository);
  assert.equal(step.with.ref, commit);
  assert.equal(step.with.path, pathPrefix);
  assert.equal(step.with['fetch-depth'], 1);
  assert.equal(step.with['persist-credentials'], false);
  assert.ok(String(step.with['sparse-checkout']).split(/\r?\n/u).includes(sparsePath));
  assert.match(step.if, /steps\.retained-names\.outputs\.required == 'true'/u);
}

function assertConditionalRoots(step) {
  assert.equal(step.env[retainedRootsEnv[0]], conditionalRootExpression('retained-name-mods'), 'Mods path is present only after its pin is checked out');
  assert.equal(step.env[retainedRootsEnv[1]], conditionalRootExpression('retained-name-source'), 'Source path is present only after its pin is checked out');
}

// Scenario: static CI validates Web without retained names in its fixed W07 input.
// Purpose: avoid making unrelated existing runs depend on public Mods or Source availability.
test('UnitT10_ScenarioStaticCiWithoutRetainedNames_PurposeSkipsUpstreamCheckouts', async () => {
  const config = await workflow('static-ci.yml');
  const job = config.jobs['static-package'];
  const detector = stepWithName(job, 'Detect fixed retained-name inputs');
  assert.equal(detector.id, 'retained-names');
  assert.match(detector.run, /retained-name-overlay-scan\.mjs/u);
  assert.ok(job.steps.indexOf(detector)
    < job.steps.indexOf(stepWithName(job, 'Check out the pinned public Mods identity map for retained weapon names')));
  assertPinnedCheckout(job, 'Check out the pinned public Mods identity map for retained weapon names',
    'SyuanTsai/Warhammer-40-000-DARKTIDE-Mods', modsCommit, 'retained-name-mods', 'Game Info/releases/1.13.X/blessings/data');
  assertPinnedCheckout(job, 'Check out pinned public 1.13.4 weapon templates',
    'Aussiemon/Darktide-Source-Code', sourceCommit, 'retained-name-source', 'scripts/settings/equipment/weapon_templates');
  const testStep = stepWithName(job, 'Test');
  assertConditionalRoots(testStep);
});

// Scenario: W09 candidate/release workflows replay old selected content and may later contain retained names.
// Purpose: gate both pinned external roots on verified W07 authoring bytes while preserving fail-closed compiler inputs.
test('UnitT20_ScenarioW09OverlayHasRetainedNames_PurposeChecksOutAndPassesPinnedRoots', async () => {
  const candidate = await workflow('shared-candidate.yml');
  const candidateJob = candidate.jobs['proposal-candidate'];
  const candidateDetector = stepWithName(candidateJob, 'Detect fixed retained-name inputs');
  assert.equal(candidateDetector.id, 'retained-names');
  assert.ok(candidateJob.steps.indexOf(candidateDetector)
    < candidateJob.steps.indexOf(stepWithName(candidateJob, 'Prepare or update the revision-scoped candidate PR')),
  'the scanner must decide which roots are needed before a new Source proposal is prepared');
  assert.ok(candidateJob.steps.indexOf(candidateDetector)
    < candidateJob.steps.indexOf(stepWithName(candidateJob, 'Check out the pinned public Mods identity map for retained weapon names')));
  assertPinnedCheckout(candidateJob, 'Check out the pinned public Mods identity map for retained weapon names',
    'SyuanTsai/Warhammer-40-000-DARKTIDE-Mods', modsCommit, 'retained-name-mods', 'Game Info/releases/1.13.X/blessings/data');
  assertPinnedCheckout(candidateJob, 'Check out pinned public 1.13.4 weapon templates',
    'Aussiemon/Darktide-Source-Code', sourceCommit, 'retained-name-source', 'scripts/settings/equipment/weapon_templates');
  assertConditionalRoots(stepWithName(candidateJob, 'Prepare or update the revision-scoped candidate PR'));

  const release = await workflow('shared-release.yml');
  const releaseJob = release.jobs['shared-release'];
  const historyCheckout = stepWithName(releaseJob, 'Check out the pinned historical W09 composition inputs');
  assert.equal(historyCheckout.uses, checkoutAction);
  assert.equal(historyCheckout.with.repository, 'SyuanTsai/DarkTide-Web');
  assert.equal(historyCheckout.with.ref, historicalCompositionCommit);
  assert.equal(historyCheckout.with.path, 'composition-inputs');
  assert.equal(historyCheckout.with['persist-credentials'], false);
  const releaseDetector = stepWithName(releaseJob, 'Detect fixed retained-name inputs in the selected composition');
  assert.ok(releaseJob.steps.indexOf(releaseDetector) < releaseJob.steps.indexOf(historyCheckout));
  assert.match(releaseDetector.run, /--repo-root "\$GITHUB_WORKSPACE"/u);
  assert.ok(releaseJob.steps.indexOf(releaseDetector)
    < releaseJob.steps.indexOf(stepWithName(releaseJob, 'Check out the pinned public Mods identity map for retained weapon names')));
  assertPinnedCheckout(releaseJob, 'Check out the pinned public Mods identity map for retained weapon names',
    'SyuanTsai/Warhammer-40-000-DARKTIDE-Mods', modsCommit, 'retained-name-mods', 'Game Info/releases/1.13.X/blessings/data');
  assertPinnedCheckout(releaseJob, 'Check out pinned public 1.13.4 weapon templates',
    'Aussiemon/Darktide-Source-Code', sourceCommit, 'retained-name-source', 'scripts/settings/equipment/weapon_templates');
  const promoteStep = stepWithName(releaseJob, 'Promote the selected shared composition');
  assertConditionalRoots(promoteStep);
  assert.equal(promoteStep.env.W09_COMPOSITION_ROOT, '${{ github.workspace }}/composition-inputs');
  assert.equal(promoteStep.env.W09_EXPECTED_COMPOSITION_COMMIT, historicalCompositionCommit);
  assert.doesNotMatch(String(stepWithName(releaseJob, 'Restore the explicit approved whole-site snapshot').env.SYP_W07_RETAINED_MODS_ROOT ?? ''), /retained-name-mods/u,
    'rollback does not acquire retained-name upstream checkouts');
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