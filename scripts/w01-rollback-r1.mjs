import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertExactKeys, parseJson, sha256 } from '../src/static/common.mjs';
import { verifyW01Package } from './w01-build.mjs';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PINNED_R1 = {
  commit: '872bd72bad255d40af62329b8ffe97a357935275',
  contentVersion: '0.0.1',
  dataRevision: 'ac4e659408e9be4c1e56226f2fecdbf9b1bd033b8f0e2d7f2ef52be0aa821701',
  buildId: '39c6ed446f9d526774d0404cf852042ffc2ffd38eb3ca8f4306088d070bf7265',
  manifestPath: 'data/ac4e659408e9be4c1e56226f2fecdbf9b1bd033b8f0e2d7f2ef52be0aa821701/manifest.json',
  manifestSha256: '368451efd002e16c1ce068643bc1cac8bb7a90b51d7200f31d68aaaf07e189f7'
};

function fail(message) {
  throw new Error(message);
}

async function readJson(filePath, label) {
  return parseJson(await readFile(filePath), label);
}

async function readRollbackSelector(webRoot) {
  const selector = await readJson(path.join(webRoot, 'content', 'w01', 'rollback.json'), 'W01 rollback selector');
  assertExactKeys(selector, ['schemaVersion', 'targetCommit', 'contentVersion', 'dataRevision', 'buildId', 'manifestSha256'], 'W01 rollback selector');
  if (selector.schemaVersion !== '1.0.0' || selector.targetCommit !== PINNED_R1.commit ||
      selector.contentVersion !== PINNED_R1.contentVersion || selector.dataRevision !== PINNED_R1.dataRevision ||
      selector.buildId !== PINNED_R1.buildId || selector.manifestSha256 !== PINNED_R1.manifestSha256) {
    fail('rollback selector must identify the exact fixed R1 package');
  }
  return selector;
}

export async function rollbackToPinnedR1({
  webRoot = WEB_ROOT,
  expectedR2Commit,
  sourceRoot,
  baselineRoot,
  outputRoot = path.join(webRoot, 'dist-w01')
} = {}) {
  if (typeof expectedR2Commit !== 'string' || !/^[a-f0-9]{40}$/.test(expectedR2Commit)) fail('expectedR2Commit must be an exact 40-character commit SHA');
  if (typeof sourceRoot !== 'string' || sourceRoot.length === 0) fail('sourceRoot is required');
  if (typeof baselineRoot !== 'string' || baselineRoot.length === 0) fail('baselineRoot is required');
  webRoot = path.resolve(webRoot);
  sourceRoot = path.resolve(sourceRoot);
  baselineRoot = path.resolve(baselineRoot);
  outputRoot = path.resolve(outputRoot);
  await readRollbackSelector(webRoot);

  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  if (sourceCommit !== PINNED_R1.commit) fail('rollback source checkout must be the exact fixed R1 commit');
  const sourceStatus = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: sourceRoot, encoding: 'utf8' });
  if (sourceStatus.trim()) fail('rollback source checkout must have no tracked or untracked changes');

  await verifyW01Package(outputRoot);
  const previousReceipt = await readJson(path.join(outputRoot, 'receipt.json'), 'current W01 receipt');
  if (previousReceipt.contentVersion !== '0.0.2' || previousReceipt.dataRevision === PINNED_R1.dataRevision ||
      previousReceipt.web?.authoringCommit !== expectedR2Commit) {
    fail('rollback requires the verified package from the exact published R2 commit');
  }
  const previousDataRows = previousReceipt.files.filter(row => row.path.startsWith('data/'));

  const r1BuildModule = await import(pathToFileURL(path.join(sourceRoot, 'scripts', 'w01-build.mjs')).href);
  const r1RetainModule = await import(pathToFileURL(path.join(sourceRoot, 'scripts', 'w01-retain-baseline.mjs')).href);
  await r1BuildModule.buildW01({ repoRoot: sourceRoot, outputRoot });
  await r1RetainModule.retainPinnedBaseline({ baselineRoot, outputRoot });
  await r1BuildModule.verifyW01Package(outputRoot);

  const receipt = await readJson(path.join(outputRoot, 'receipt.json'), 'restored R1 receipt');
  const version = await readJson(path.join(outputRoot, 'version.json'), 'restored R1 version.json');
  if (receipt.contentVersion !== PINNED_R1.contentVersion || receipt.dataRevision !== PINNED_R1.dataRevision ||
      receipt.buildId !== PINNED_R1.buildId || receipt.manifestPath !== PINNED_R1.manifestPath ||
      receipt.manifestSha256 !== PINNED_R1.manifestSha256 || receipt.web.authoringCommit !== PINNED_R1.commit ||
      version.game_releases?.[0]?.content_version !== PINNED_R1.contentVersion ||
      version.game_releases?.[0]?.data_revision !== PINNED_R1.dataRevision ||
      version.game_releases?.[0]?.manifest_path !== '/' + PINNED_R1.manifestPath ||
      version.game_releases?.[0]?.manifest_sha256 !== PINNED_R1.manifestSha256) {
    fail('rollback output does not match the exact fixed R1 package identity');
  }
  const manifestBytes = await readFile(path.join(outputRoot, ...PINNED_R1.manifestPath.split('/')));
  if (sha256(manifestBytes) !== PINNED_R1.manifestSha256) fail('rollback R1 manifest bytes do not match the fixed package hash');

  const restoredRows = new Map(receipt.files.map(row => [row.path, row]));
  for (const row of previousDataRows) {
    const restored = restoredRows.get(row.path);
    if (!restored || restored.sizeBytes !== row.sizeBytes || restored.sha256 !== row.sha256) {
      fail('rollback did not preserve prior immutable data URL: ' + row.path);
    }
  }
  return {
    requestKind: 'w01-exact-r1-preview-rollback',
    target: PINNED_R1,
    previousWebCommit: previousReceipt.web.authoringCommit,
    previousContentVersion: previousReceipt.contentVersion,
    previousDataRevision: previousReceipt.dataRevision,
    restoredDataFileCount: receipt.files.filter(row => row.path.startsWith('data/')).length,
    preservedPriorDataFileCount: previousDataRows.length,
    deploymentPerformed: false
  };
}

function parseArgs(args) {
  const options = { expectedR2Commit: null, sourceRoot: null, baselineRoot: null };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--expected-r2-commit' && !seen.has(arg) && args[index + 1]) {
      seen.add(arg);
      options.expectedR2Commit = args[++index];
    } else if (arg === '--source-root' && !seen.has(arg) && args[index + 1]) {
      seen.add(arg);
      options.sourceRoot = path.resolve(args[++index]);
    } else if (arg === '--baseline-root' && !seen.has(arg) && args[index + 1]) {
      seen.add(arg);
      options.baselineRoot = path.resolve(args[++index]);
    } else {
      fail('Usage: node scripts/w01-rollback-r1.mjs --expected-r2-commit exact-R2-SHA --source-root exact-R1-checkout --baseline-root pinned-baseline-checkout');
    }
  }
  if (!options.expectedR2Commit || !options.sourceRoot || !options.baselineRoot) {
    fail('Usage: node scripts/w01-rollback-r1.mjs --expected-r2-commit exact-R2-SHA --source-root exact-R1-checkout --baseline-root pinned-baseline-checkout');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await rollbackToPinnedR1(parseArgs(process.argv.slice(2)));
    process.stdout.write('Restored exact R1 preview identity ' + JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write('W01 R1 rollback failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = 1;
  }
}
