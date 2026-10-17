import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyChangedPaths,
  formatGithubOutput,
  isSafeContractPackageAddition,
  parseCliArguments,
  parseGitNameOnlyZ,
  resolveDeploymentScope,
} from '../scripts/w01-preview-deploy-scope.mjs';

const basePackage = {
  name: 'darktide-zh-tw-web',
  type: 'module',
  scripts: {
    test: 'node --test',
    build: 'node scripts/build.mjs',
  },
};

function withContractValidateScript() {
  const headPackage = structuredClone(basePackage);
  headPackage.scripts['content:validate'] = 'node scripts/content/contract-validator.mjs';
  return headPackage;
}

// Scenario: only W02 contract, fixture, documentation, test, and guard paths change.
// Purpose: keep push-based CI useful without publishing a rebuilt 0.0.17 preview.
test('UnitT00_contract-only-paths-do-not-request-deployment', () => {
  const paths = [
    'content/schema/v2/schema.json',
    'content/fixtures/v2/valid record.json',
    'content/contracts/manifest.json',
    'scripts/content/contract-validator.mjs',
    'test/contract-validator.test.mjs',
    'docs/contracts/README.md',
    '.github/workflows/w01-preview.yml',
    'scripts/w01-preview-deploy-scope.mjs',
    'test/w01-preview-deploy-scope.test.mjs',
    'test/w01-preview-config.test.mjs',
  ];
  assert.deepEqual(classifyChangedPaths(paths), {
    shouldDeploy: false,
    reason: 'contract-only',
    changedPathCount: paths.length,
  });
});

// Scenario: W01 content, pinned source, runtime/compiler/build assets, or preview deployment config changes.
// Purpose: preserve the existing authorized deployment path for real preview changes.
test('UnitT10_runtime-and-preview-input-paths-request-deployment', () => {
  for (const path of [
    'content/w01/0.0.17/manifest.json',
    'source.lock.json',
    'src/published/contract.mjs',
    'scripts/w01-build.mjs',
    'wrangler.w01-preview.json',
    'package-lock.json',
    'unknown/new-file.txt',
  ]) {
    assert.equal(classifyChangedPaths([path]).shouldDeploy, true, path);
  }
});

// Scenario: a contract change is committed with one runtime path.
// Purpose: prevent a mixed commit from being downgraded to contract-only.
test('UnitT20_mixed-contract-and-runtime-paths-request-deployment', () => {
  assert.deepEqual(
    classifyChangedPaths(['content/schema/v2/schema.json', 'content/w01/0.0.17/manifest.json']),
    { shouldDeploy: true, reason: 'runtime-change', changedPathCount: 2 },
  );
});

// Scenario: package.json adds only the W02 validator command and leaves all other package metadata unchanged.
// Purpose: permit adding a contract CLI without treating unrelated dependency or build changes as safe.
test('UnitT30_only-a-contract-validation-script-addition-is-deployment-neutral', () => {
  const headPackage = withContractValidateScript();
  assert.equal(isSafeContractPackageAddition(basePackage, headPackage), true);
  assert.deepEqual(classifyChangedPaths(['package.json', 'docs/contracts/schema.md'], {
    basePackage,
    headPackage,
  }), { shouldDeploy: false, reason: 'contract-only', changedPathCount: 2 });

  const changedBuild = structuredClone(basePackage);
  changedBuild.scripts.build = 'node scripts/other-build.mjs';
  assert.equal(isSafeContractPackageAddition(basePackage, changedBuild), false);
  assert.equal(classifyChangedPaths(['package.json'], {
    basePackage,
    headPackage: changedBuild,
  }).shouldDeploy, true);

  const changedDependency = structuredClone(headPackage);
  changedDependency.devDependencies = { yaml: 'new-version' };
  assert.equal(isSafeContractPackageAddition(basePackage, changedDependency), false);
  assert.equal(classifyChangedPaths(['package.json'], {
    basePackage,
    headPackage: changedDependency,
  }).shouldDeploy, true);
  assert.equal(classifyChangedPaths(['package.json']).shouldDeploy, true);
});

// Scenario: a safe path contains spaces, a newline, or non-ASCII characters.
// Purpose: confirm Git NUL framing preserves complete paths and output values cannot be injected by filenames.
test('UnitT40_git-nul-paths-preserve-whitespace-and-output-is-fixed', () => {
  const paths = [
    'docs/contracts/space name.md',
    'docs/contracts/line\nbreak.md',
    'docs/contracts/規格.md',
  ];
  const bytes = Buffer.from(paths.join('\0') + '\0', 'utf8');
  assert.deepEqual(parseGitNameOnlyZ(bytes), paths);

  const scope = classifyChangedPaths(paths);
  assert.deepEqual(scope, { shouldDeploy: false, reason: 'contract-only', changedPathCount: 3 });
  assert.equal(formatGithubOutput(scope), 'should_deploy=false\nreason=contract-only\n');
  assert.throws(() => parseGitNameOnlyZ(Buffer.from('docs/contracts/no-terminator', 'utf8')), /NUL-terminated/);
});

// Scenario: the event omits a commit or supplies malformed SHA input.
// Purpose: fail visibly before writing any deployment decision instead of interpreting uncertainty as no deployment.
test('UnitT50_missing-or-invalid-commit-shas-fail-closed', () => {
  const sha = 'a'.repeat(40);
  assert.throws(() => parseCliArguments([]), /base commit SHA is required/);
  assert.throws(() => parseCliArguments(['--base', sha]), /head commit SHA is required/);
  assert.throws(() => resolveDeploymentScope({ base: '', head: sha }), /base commit SHA is required/);
  assert.throws(() => resolveDeploymentScope({ base: sha, head: 'invalid' }), /head commit SHA is invalid/);
  assert.throws(() => resolveDeploymentScope({ base: sha, head: sha, cwd: process.cwd() }), /base commit SHA does not resolve/);
});

// Scenario: Git reports a contract-only commit, a runtime commit, and a mixed commit between fixed object IDs.
// Purpose: exercise the real NUL-delimited Git diff and CLI output used by CI, including visible failure for a missing head.
test('InterT60_git-before-head-evidence-drives-cli-output-and-fails-on-missing-head', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { execFileSync, spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'w01-deploy-scope-'));
  const helperPath = fileURLToPath(new URL('../scripts/w01-preview-deploy-scope.mjs', import.meta.url));
  const git = args => execFileSync('git', args, { cwd: tempRoot, encoding: 'utf8' });
  const commit = message => {
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', message]);
    return git(['rev-parse', 'HEAD']).trim();
  };

  try {
    git(['init', '--quiet']);
    git(['config', 'user.name', 'scope-test']);
    git(['config', 'user.email', 'scope-test@example.invalid']);
    await fs.mkdir(path.join(tempRoot, 'content', 'w01'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify(basePackage));
    const base = commit('base');

    await fs.mkdir(path.join(tempRoot, 'docs', 'contracts'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'docs', 'contracts', 'space 規格.md'), 'contract');
    const contractHead = commit('contract');

    const contractPackage = structuredClone(basePackage);
    contractPackage.scripts['content:validate'] = 'node scripts/content/contract-validator.mjs';
    await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify(contractPackage));
    const packageHead = commit('contract package command');
    assert.equal(resolveDeploymentScope({ base, head: packageHead, cwd: tempRoot }).shouldDeploy, false);

    await fs.writeFile(path.join(tempRoot, 'content', 'w01', 'live.json'), '{"version":"0.0.17"}');
    const runtimeHead = commit('runtime');
    assert.equal(resolveDeploymentScope({ base: contractHead, head: runtimeHead, cwd: tempRoot }).shouldDeploy, true);

    await fs.writeFile(path.join(tempRoot, 'docs', 'contracts', 'mixed.md'), 'contract');
    await fs.writeFile(path.join(tempRoot, 'content', 'w01', 'mixed.json'), '{}');
    const mixedHead = commit('mixed');
    assert.equal(resolveDeploymentScope({ base: runtimeHead, head: mixedHead, cwd: tempRoot }).shouldDeploy, true);

    const outputPath = path.join(tempRoot, 'github-output.txt');
    const cli = spawnSync(process.execPath, [helperPath, '--base', base, '--head', contractHead], {
      cwd: tempRoot,
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
      encoding: 'utf8',
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /contract-only.*deploy: false/);
    assert.equal(await fs.readFile(outputPath, 'utf8'), 'should_deploy=false\nreason=contract-only\n');

    const packageOutputPath = path.join(tempRoot, 'safe-package-output.txt');
    const packageCli = spawnSync(process.execPath, [helperPath, '--base', base, '--head', packageHead], {
      cwd: tempRoot,
      env: { ...process.env, GITHUB_OUTPUT: packageOutputPath },
      encoding: 'utf8',
    });
    assert.equal(packageCli.status, 0, packageCli.stderr);
    assert.match(packageCli.stdout, /contract-only.*deploy: false/);
    assert.equal(await fs.readFile(packageOutputPath, 'utf8'), 'should_deploy=false\nreason=contract-only\n');

    const missingHeadOutput = path.join(tempRoot, 'missing-head-output.txt');
    const missingHead = spawnSync(process.execPath, [helperPath, '--base', base], {
      cwd: tempRoot,
      env: { ...process.env, GITHUB_OUTPUT: missingHeadOutput },
      encoding: 'utf8',
    });
    assert.equal(missingHead.status, 1);
    assert.match(missingHead.stderr, /head commit SHA is required/);
    await assert.rejects(fs.readFile(missingHeadOutput), { code: 'ENOENT' });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
