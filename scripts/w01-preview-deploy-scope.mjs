import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const SAFE_PACKAGE_COMMAND = /^node scripts\/content\/contract[^/\s]*\.mjs$/;
const SAFE_REASONS = new Set(['no-changes', 'contract-only', 'runtime-change']);

const CONTRACT_ONLY_PATHS = [
  /^content\/schema\/v2\/[\s\S]+$/,
  /^content\/fixtures\/v2\/[\s\S]+$/,
  /^content\/contracts\/[\s\S]+$/,
  /^scripts\/content\/contract[^/]*\.mjs$/,
  /^test\/contract[^/]*\.test\.mjs$/,
  /^docs\/contracts\/[\s\S]+$/,
  /^\.github\/workflows\/w01-preview\.yml$/,
  /^scripts\/w01-preview-deploy-scope\.mjs$/,
  /^test\/w01-preview-deploy-scope\.test\.mjs$/,
  /^test\/w01-preview-config\.test\.mjs$/,
];

export function validateCommitSha(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(label + ' commit SHA is required');
  }
  if (!SHA_PATTERN.test(value)) {
    throw new Error(label + ' commit SHA is invalid');
  }
  return value;
}

export function parseGitNameOnlyZ(output) {
  if (!Buffer.isBuffer(output)) {
    throw new TypeError('git name-only output must be a Buffer');
  }
  if (output.length === 0) return [];
  if (output[output.length - 1] !== 0) {
    throw new Error('git name-only output is not NUL-terminated');
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const paths = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    if (index === start) {
      throw new Error('git name-only output contains an empty path');
    }
    try {
      paths.push(decoder.decode(output.subarray(start, index)));
    } catch {
      throw new Error('git name-only output contains a non-UTF-8 path');
    }
    start = index + 1;
  }
  return paths;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isSafeContractPackageAddition(basePackage, headPackage) {
  if (!isRecord(basePackage) || !isRecord(headPackage)) return false;

  const topLevelKeys = new Set([...Object.keys(basePackage), ...Object.keys(headPackage)]);
  topLevelKeys.delete('scripts');
  for (const key of topLevelKeys) {
    if (!Object.hasOwn(basePackage, key) || !Object.hasOwn(headPackage, key)) return false;
    if (!isDeepStrictEqual(basePackage[key], headPackage[key])) return false;
  }

  const before = basePackage.scripts;
  const after = headPackage.scripts;
  if (!isRecord(before) || !isRecord(after)) return false;

  for (const [name, command] of Object.entries(before)) {
    if (!Object.hasOwn(after, name) || !isDeepStrictEqual(after[name], command)) return false;
  }

  const additions = Object.keys(after).filter(name => !Object.hasOwn(before, name));
  if (additions.length !== 1 || !/validate/i.test(additions[0])) return false;
  return typeof after[additions[0]] === 'string' && SAFE_PACKAGE_COMMAND.test(after[additions[0]]);
}

function isContractOnlyPath(path) {
  return CONTRACT_ONLY_PATHS.some(pattern => pattern.test(path));
}

export function classifyChangedPaths(paths, { basePackage, headPackage } = {}) {
  if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || path.length === 0)) {
    throw new TypeError('changed paths must be non-empty strings');
  }
  if (paths.length === 0) {
    return { shouldDeploy: false, reason: 'no-changes', changedPathCount: 0 };
  }

  const packageIsSafe = paths.includes('package.json')
    && isSafeContractPackageAddition(basePackage, headPackage);
  const shouldDeploy = paths.some(path => {
    if (path === 'package.json' && packageIsSafe) return false;
    return !isContractOnlyPath(path);
  });
  return {
    shouldDeploy,
    reason: shouldDeploy ? 'runtime-change' : 'contract-only',
    changedPathCount: paths.length,
  };
}

function assertCommitExists(sha, label, cwd) {
  try {
    execFileSync('git', ['cat-file', '-e', sha + '^{commit}'], {
      cwd,
      stdio: 'ignore',
    });
  } catch {
    throw new Error(label + ' commit SHA does not resolve to an available commit');
  }
}

function readPackageJsonAt(sha, cwd) {
  let content;
  try {
    content = execFileSync('git', ['show', sha + ':package.json'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    if (typeof error.status === 'number') return undefined;
    throw new Error('unable to read package.json from a validated commit');
  }
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

export function resolveDeploymentScope({ base, head, cwd = process.cwd() }) {
  const baseSha = validateCommitSha(base, 'base');
  const headSha = validateCommitSha(head, 'head');
  assertCommitExists(baseSha, 'base', cwd);
  assertCommitExists(headSha, 'head', cwd);

  let diffOutput;
  try {
    diffOutput = execFileSync('git', [
      'diff',
      '--name-only',
      '-z',
      '--no-renames',
      baseSha,
      headSha,
      '--',
    ], { cwd, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const status = Number.isInteger(error.status) ? String(error.status) : 'unknown';
    throw new Error('unable to compute changed paths for validated commits (git exit ' + status + ')');
  }

  const paths = parseGitNameOnlyZ(diffOutput);
  let basePackage;
  let headPackage;
  if (paths.includes('package.json')) {
    basePackage = readPackageJsonAt(baseSha, cwd);
    headPackage = readPackageJsonAt(headSha, cwd);
  }
  return classifyChangedPaths(paths, { basePackage, headPackage });
}

export function parseCliArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name !== '--base' && name !== '--head') {
      throw new Error('unexpected argument');
    }
    if (values.has(name)) throw new Error('duplicate ' + name + ' argument');
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.startsWith('--')) {
      throw new Error(name.slice(2) + ' commit SHA is required');
    }
    values.set(name, value);
    index += 1;
  }
  if (!values.has('--base')) throw new Error('base commit SHA is required');
  if (!values.has('--head')) throw new Error('head commit SHA is required');
  return { base: values.get('--base'), head: values.get('--head') };
}

export function formatGithubOutput(scope) {
  if (
    !scope
    || typeof scope.shouldDeploy !== 'boolean'
    || !SAFE_REASONS.has(scope.reason)
  ) {
    throw new TypeError('deployment scope result is invalid');
  }
  return 'should_deploy=' + String(scope.shouldDeploy) + '\nreason=' + scope.reason + '\n';
}

function main() {
  try {
    const { base, head } = parseCliArguments(process.argv.slice(2));
    const outputFile = process.env.GITHUB_OUTPUT;
    if (!outputFile) throw new Error('GITHUB_OUTPUT is required');
    const scope = resolveDeploymentScope({ base, head });
    appendFileSync(outputFile, formatGithubOutput(scope), 'utf8');
    process.stdout.write(
      'W01 deployment scope: ' + scope.reason
      + ' (changed paths: ' + scope.changedPathCount
      + '; deploy: ' + String(scope.shouldDeploy) + ')\n',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write('W01 deployment scope check failed: ' + message + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}