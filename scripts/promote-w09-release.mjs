import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  currentW09ActiveSnapshot,
  promoteW09SelectedComposition,
  readW09ReleaseState,
  rollbackW09SharedComposition,
} from './content/contract-w09-release.mjs';
import { validateW09SelectedComposition } from './content/contract-w09-compose.mjs';
import { createW09StateBranchStore } from './content/contract-w09-state-branch.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const selectedPath = 'content/contracts/w09/source-handoff/selected.json';
const siteOrigin = 'https://darktide.tw-syuan.com';
const USAGE = [
  'Usage:',
  '  node scripts/promote-w09-release.mjs',
  '  node scripts/promote-w09-release.mjs --rollback --target-release-ids <web-id[,web-id...]>',
  '    --target-runtime-snapshot-build <sha256> --expected-current-file <repo-relative-json-file>',
].join('\n');

function run(command, args, { cwd = repoRoot, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(command + ' exited with ' + code)));
  });
}

function readSelectedFromHead() {
  const bytes = execFileSync('git', ['-C', repoRoot, 'show', 'HEAD:' + selectedPath], {
    encoding: null,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  try { return validateW09SelectedComposition(JSON.parse(Buffer.from(bytes).toString('utf8'))); }
  catch { throw new Error('tracked W09 selected composition is malformed; refusing the legacy publisher fallback'); }
}

async function deployExactArtifact({ artifact }) {
  const deploymentEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' };
  delete deploymentEnv.GITHUB_TOKEN;
  delete deploymentEnv.W09_GIT_TOKEN;
  const checks = [
    ['scripts/verify-deploy-config.mjs'],
    ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'wrangler.preview.json', '--dry-run', '--outdir', '.cloudflare-dry-run/preview'],
    ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'wrangler.json', '--dry-run', '--outdir', '.cloudflare-dry-run/production'],
    ['scripts/cloudflare-runtime-smoke.mjs'],
    ['scripts/browser-smoke.mjs', 'dist'],
  ];
  for (const [script, ...args] of checks) {
    await run(process.execPath, [script, ...args], {
      env: deploymentEnv,
    });
  }
  if (!process.env.CLOUDFLARE_API_TOKEN?.trim()) {
    throw new Error('CLOUDFLARE_API_TOKEN is required; verified shared package and retryable W09 journal were preserved without deployment');
  }
  await run(process.execPath, ['scripts/cloudflare-deploy.mjs'], {
    env: deploymentEnv,
  });
  const receipt = JSON.parse(await readFile(path.join(repoRoot, '.deployment', 'last-deployment.json'), 'utf8'));
  if (receipt.status !== 'verified' || receipt.build_id !== artifact.build_id
      || receipt.data_revision !== artifact.data_revision || receipt.production_origin !== siteOrigin) {
    throw new Error('Cloudflare deployment receipt does not match the prepared W09 artifact');
  }
  return receipt;
}

async function readRollbackArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--target-release-ids', '--target-runtime-snapshot-build', '--expected-current-file'].includes(flag)
        || typeof value !== 'string' || !value || values.has(flag)) {
      throw new Error(USAGE);
    }
    values.set(flag, value);
  }
  if (values.size !== 3) throw new Error(USAGE);
  const targetReleaseIds = values.get('--target-release-ids').split(',');
  if (targetReleaseIds.some(id => !/^w09-[a-f0-9]{32}$/u.test(id)) || new Set(targetReleaseIds).size !== targetReleaseIds.length) {
    throw new Error('rollback target IDs must be unique allocated W09 Web release IDs');
  }
  const targetRuntimeSnapshotBuildId = values.get('--target-runtime-snapshot-build');
  if (!/^[a-f0-9]{64}$/u.test(targetRuntimeSnapshotBuildId)) throw new Error('rollback target runtime snapshot must be a full SHA-256 build ID');
  const expectedPath = path.resolve(repoRoot, values.get('--expected-current-file'));
  const relativeExpectedPath = path.relative(repoRoot, expectedPath);
  if (!relativeExpectedPath || relativeExpectedPath === '..' || relativeExpectedPath.startsWith('..' + path.sep) || path.isAbsolute(relativeExpectedPath)) {
    throw new Error('rollback expected-current file must be inside the checked-out Web repository');
  }
  const info = await lstat(expectedPath);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('rollback expected-current input must be a regular repository file');
  const expectedCurrent = JSON.parse((await readFile(expectedPath)).toString('utf8'));
  if (!expectedCurrent || typeof expectedCurrent !== 'object' || Array.isArray(expectedCurrent)
      || !Array.isArray(expectedCurrent.activeByGame) || !Object.hasOwn(expectedCurrent, 'runtimeSnapshotBuildId')) {
    throw new Error('rollback expected-current file must contain the complete active pointer and runtime-build snapshot');
  }
  return { targetReleaseIds, targetRuntimeSnapshotBuildId, expectedCurrent };
}

try {
  const args = process.argv.slice(2);
  if (args[0] === '--help') throw new Error(USAGE);
  let rollbackArguments = null;
  if (args[0] === '--rollback') rollbackArguments = await readRollbackArguments(args.slice(1));
  else if (args.length !== 0) throw new Error(USAGE);

  const stateStore = await createW09StateBranchStore({
    repoRoot,
    branch: process.env.W09_STATE_BRANCH ?? 'w09-release-state',
    token: process.env.W09_GIT_TOKEN,
  });
  await stateStore.restore();

  let result;
  if (rollbackArguments) {
    result = await rollbackW09SharedComposition({
      repoRoot,
      ...rollbackArguments,
      siteOrigin,
      promoteVerifiedArtifact: deployExactArtifact,
      persistDurableState: stateStore.persist,
      requireDurableState: true,
    });
  } else {
    const selected = readSelectedFromHead();
    const statePath = path.join(repoRoot, 'content/contracts/w09/release-state.json');
    const state = await readW09ReleaseState(statePath);
    result = await promoteW09SelectedComposition({
      repoRoot,
      sourceRoot: process.env.W09_SOURCE_ROOT ?? path.resolve(repoRoot, '..', 'source'),
      sourceReleaseIds: selected.proposals.map(row => row.releaseId),
      expectedCurrent: currentW09ActiveSnapshot(state),
      siteOrigin,
      promoteVerifiedArtifact: deployExactArtifact,
      persistDurableState: stateStore.persist,
      requireDurableState: true,
    });
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!['verified-and-active', 'verified-and-rolled-back', 'already-active', 'waiting-for-credentials'].includes(result.status)) {
    throw new Error('W09 selected composition is not publishable: ' + JSON.stringify(result));
  }
} catch (error) {
  process.stderr.write(String(error?.message ?? error) + '\n');
  process.exitCode = 1;
}
