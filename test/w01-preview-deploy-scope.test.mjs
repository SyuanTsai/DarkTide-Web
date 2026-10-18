import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  classifyChangedPaths,
  formatGithubOutput,
  isSafeContractGitattributesChange,
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

const CONTRACT_EOL_RULES = [
  '/content/schema/v2/** text eol=lf',
  '/content/fixtures/v2/** text eol=lf',
  '/content/contracts/** text eol=lf',
  '/scripts/content/contract*.mjs text eol=lf',
  '/test/contract*.test.mjs text eol=lf',
  '/docs/contracts/** text eol=lf',
];
const contractEolAttributes = CONTRACT_EOL_RULES.join('\n') + '\n';

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

// Scenario: only the two fixed W06 data inputs change.
// Purpose: keep this input-only contract work out of the active 0.0.17 preview deploy while rejecting nearby paths.
test('UnitT05_only-the-two-exact-W06-input-paths-are-deployment-neutral', () => {
  const paths = [
    'content/authoring/v2/w06-skills-blessings.json',
    'content/terms/w06-rules.json',
  ];
  assert.deepEqual(classifyChangedPaths(paths), {
    shouldDeploy: false,
    reason: 'contract-only',
    changedPathCount: 2,
  });
  for (const path of [
    'content/authoring/v2/w06-skills-blessings-extra.json',
    'content/authoring/v2/other.json',
    'content/terms/w06-other.json',
    'content/terms/w06-rules.json/child',
  ]) {
    assert.equal(classifyChangedPaths([path]).shouldDeploy, true, path);
  }
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

// Scenario: .gitattributes changes add or remove only the six exact contract-scope LF rules.
// Purpose: make those EOL-only policy changes deployment-neutral while unknown patterns and attributes remain runtime changes.
test('UnitT60_only-exact-contract-lf-rules-are-deployment-neutral', () => {
  assert.equal(classifyChangedPaths(['.gitattributes']).shouldDeploy, true);
  assert.equal(isSafeContractGitattributesChange(undefined, undefined), false);
  assert.equal(isSafeContractGitattributesChange(undefined, ''), false);
  assert.equal(isSafeContractGitattributesChange(contractEolAttributes, contractEolAttributes), false);
  assert.equal(isSafeContractGitattributesChange(undefined, contractEolAttributes), true);
  assert.equal(isSafeContractGitattributesChange(contractEolAttributes, undefined), true);
  assert.equal(isSafeContractGitattributesChange(undefined, contractEolAttributes + '* text eol=lf\n'), false);
  assert.equal(isSafeContractGitattributesChange(undefined, '*.json text eol=lf\n'), false);
  assert.equal(isSafeContractGitattributesChange(contractEolAttributes, contractEolAttributes + '*.mjs text eol=crlf\n'), false);
  assert.equal(isSafeContractGitattributesChange(undefined, contractEolAttributes.replace('text eol=lf', 'binary')), false);
  assert.equal(isSafeContractGitattributesChange(undefined, contractEolAttributes.split('').reverse().join('')), false);
  assert.deepEqual(classifyChangedPaths(['.gitattributes'], {
    baseGitattributes: undefined,
    headGitattributes: contractEolAttributes,
  }), { shouldDeploy: false, reason: 'contract-only', changedPathCount: 1 });
  assert.equal(classifyChangedPaths(['.gitattributes'], {
    baseGitattributes: undefined,
    headGitattributes: '*.json text eol=lf\n',
  }).shouldDeploy, true);
});

// Scenario: the W06 data files receive only exact LF attributes.
// Purpose: let those two bytes-stable contract inputs remain deployment-neutral without broadening attribute trust.
test('UnitT65_W06-gitattributes-add-only-the-two-exact-lf-rules', () => {
  const extended = [
    ...CONTRACT_EOL_RULES,
    '/content/authoring/v2/w06-skills-blessings.json text eol=lf',
    '/content/terms/w06-rules.json text eol=lf',
  ].join('\n') + '\n';
  assert.equal(isSafeContractGitattributesChange(contractEolAttributes, extended), true);
  assert.equal(isSafeContractGitattributesChange(undefined, extended.replace('/content/terms/w06-rules.json text eol=lf\n', '')), true);
  assert.equal(isSafeContractGitattributesChange(undefined, extended.replace('/content/terms/w06-rules.json text eol=lf', '/content/terms/** text eol=lf')), false);
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

// Scenario: Git history changes .gitattributes from absent to the exact contract LF rules, then adds a wildcard rule.
// Purpose: prove classification reads both committed blobs and treats only the bounded rule change as contract-only.
test('InterT70_git-attribute-blobs-bound-contract-eol-scope', async t => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'w01-attribute-scope-'));
  const repoRoot = fileURLToPath(new URL('../', import.meta.url));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: tempRoot, encoding: 'utf8', timeout: 30_000 });
  const commit = message => {
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', message]);
    return git(['rev-parse', 'HEAD']).trim();
  };

  git(['init', '--quiet']);
  git(['config', 'user.name', 'attribute-scope-test']);
  git(['config', 'user.email', 'attribute-scope-test@example.invalid']);
  git(['config', 'core.autocrlf', 'false']);
  await fs.writeFile(path.join(tempRoot, 'base.txt'), 'base');
  const base = commit('base');

  const attributesPath = path.join(repoRoot, '.gitattributes');
  const exactRules = await fs.readFile(attributesPath, 'utf8');
  await fs.writeFile(path.join(tempRoot, '.gitattributes'), exactRules);
  const boundedHead = commit('contract LF rules');
  assert.deepEqual(resolveDeploymentScope({ base, head: boundedHead, cwd: tempRoot }), {
    shouldDeploy: false,
    reason: 'contract-only',
    changedPathCount: 1,
  });

  await fs.appendFile(path.join(tempRoot, '.gitattributes'), '* text eol=lf\n');
  const wildcardHead = commit('global wildcard rule');
  assert.deepEqual(resolveDeploymentScope({ base: boundedHead, head: wildcardHead, cwd: tempRoot }), {
    shouldDeploy: true,
    reason: 'runtime-change',
    changedPathCount: 1,
  });

  assert.equal(isSafeContractGitattributesChange(undefined, exactRules), true);
});

// Scenario: a temporary repository with core.autocrlf=true is checked out with the contract .gitattributes rules.
// Purpose: ensure fixture bytes, manifest hashes, and the read-only CLI remain valid after a real Git checkout conversion.
test('InterT80_core-autocrlf-checkout-preserves-fixture-bytes-and-cli-validation', async t => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { execFileSync, spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'w01-autocrlf-fixtures-'));
  const repoRoot = fileURLToPath(new URL('../', import.meta.url));
  const sourceRepo = path.join(tempRoot, 'source');
  const checkout = path.join(tempRoot, 'checkout');
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));

  const copyFile = async (source, destination) => {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  };
  await fs.mkdir(sourceRepo, { recursive: true });
  await copyFile(path.join(repoRoot, '.gitattributes'), path.join(sourceRepo, '.gitattributes'));
  await fs.cp(
    path.join(repoRoot, 'content', 'fixtures', 'v2', 'shared-release'),
    path.join(sourceRepo, 'content', 'fixtures', 'v2', 'shared-release'),
    { recursive: true },
  );
  await copyFile(
    path.join(repoRoot, 'content', 'schema', 'v2', 'shared-release.schema.json'),
    path.join(sourceRepo, 'content', 'schema', 'v2', 'shared-release.schema.json'),
  );
  await copyFile(
    path.join(repoRoot, 'scripts', 'content', 'contract-release.mjs'),
    path.join(sourceRepo, 'scripts', 'content', 'contract-release.mjs'),
  );

  const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 });
  git(sourceRepo, ['init', '--quiet']);
  git(sourceRepo, ['config', 'user.name', 'autocrlf-test']);
  git(sourceRepo, ['config', 'user.email', 'autocrlf-test@example.invalid']);
  git(sourceRepo, ['config', 'core.autocrlf', 'false']);
  git(sourceRepo, ['add', '--all']);
  git(sourceRepo, ['commit', '--quiet', '-m', 'fixture bytes']);
  execFileSync('git', ['-c', 'core.autocrlf=true', 'clone', '--quiet', sourceRepo, checkout], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  git(checkout, ['config', 'core.autocrlf', 'true']);
  git(checkout, ['checkout-index', '--all', '--force']);
  assert.equal(git(checkout, ['config', '--get', 'core.autocrlf']).trim(), 'true');
  assert.match(
    git(checkout, ['check-attr', 'eol', '--', 'content/fixtures/v2/shared-release/valid/version.json']),
    /eol: lf/,
  );

  const fixturesPath = path.join(checkout, 'content', 'fixtures', 'v2', 'shared-release');
  const listFiles = async (directory, prefix = '') => {
    const files = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await listFiles(absolute, relative));
      else files.push(relative);
    }
    return files;
  };
  const fixtureFiles = await listFiles(path.join(repoRoot, 'content', 'fixtures', 'v2', 'shared-release'));
  for (const relative of fixtureFiles) {
    const sourceBytes = await fs.readFile(path.join(repoRoot, 'content', 'fixtures', 'v2', 'shared-release', relative));
    const checkoutPath = path.join(fixturesPath, ...relative.split('/'));
    const checkoutBytes = await fs.readFile(checkoutPath);
    assert.deepEqual(checkoutBytes, sourceBytes, relative);
    const blobBytes = execFileSync('git', ['show', 'HEAD:content/fixtures/v2/shared-release/' + relative], {
      cwd: checkout,
      timeout: 30_000,
    });
    assert.deepEqual(blobBytes, sourceBytes, relative + ' Git blob');
    assert.equal(
      createHash('sha256').update(checkoutBytes).digest('hex'),
      createHash('sha256').update(sourceBytes).digest('hex'),
      relative + ' SHA-256',
    );
  }

  for (const name of ['valid', 'announcement-only']) {
    const cli = spawnSync(process.execPath, [
      path.join(checkout, 'scripts', 'content', 'contract-release.mjs'),
      '--root',
      path.join(fixturesPath, name),
    ], { cwd: checkout, encoding: 'utf8', timeout: 10_000 });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /contract validation passed/);
  }
});
