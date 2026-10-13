import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertChildPath,
  assertExactKeys,
  assertPlainObject,
  compareUtf8,
  jsonBytes,
  isPathInside,
  parseJson,
  safeRelativePath,
  sha256
} from '../src/static/common.mjs';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
const WEB_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Web';
const WEB_BRANCH = 'codex/SYP-311-w01';
const ARTIFACTS = ['technical.json', 'game-changes.json'];

function fail(message) {
  throw new Error(message);
}

function validateRequest(value) {
  assertPlainObject(value, 'composition request');
  assertExactKeys(value, ['repository', 'commit', 'sourceRevision', 'manifestSha256'], 'composition request');
  if (value.repository !== SOURCE_REPOSITORY) fail('composition request repository is not the pinned public Source repository');
  if (!/^[a-f0-9]{40}$/.test(value.commit)) fail('composition request commit must be a full Git SHA');
  if (!/^[a-f0-9]{64}$/.test(value.sourceRevision)) fail('composition request sourceRevision must be SHA-256');
  if (!/^[a-f0-9]{64}$/.test(value.manifestSha256)) fail('composition request manifestSha256 must be SHA-256');
  return value;
}

async function readSourceFile(revisionRoot, name) {
  const relative = safeRelativePath(name, 'Source artifact path');
  const absolute = assertChildPath(revisionRoot, path.join(revisionRoot, ...relative.split('/')), 'Source artifact');
  const info = await lstat(absolute);
  if (info.isSymbolicLink() || !info.isFile()) fail('Source artifact must be a regular file: ' + name);
  return readFile(absolute);
}

function verifyPinnedArtifact(sourceManifest, name, bytes) {
  const row = sourceManifest.files.find(file => file.path === name);
  if (!row) fail('Source manifest does not list ' + name);
  assertExactKeys(row, ['path', 'sizeBytes', 'sha256'], 'Source manifest row ' + name);
  if (bytes.byteLength !== row.sizeBytes || sha256(bytes) !== row.sha256) {
    fail('Source artifact does not match pinned manifest: ' + name);
  }
}

export async function applyCompositionRequest({ request, sourceRoot, webRoot = WEB_ROOT, verifyCheckout = true } = {}) {
  request = validateRequest(request);
  if (typeof sourceRoot !== 'string' || sourceRoot.length === 0) fail('sourceRoot is required');
  sourceRoot = path.resolve(sourceRoot);
  webRoot = path.resolve(webRoot);
  if (verifyCheckout) {
    let remote;
    let commit;
    try {
      remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: sourceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .trim().replace(/\.git$/i, '').replace(/\/+$/, '');
      commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      fail('sourceRoot must be a Git checkout of the pinned public Source repository');
    }
    if (remote !== SOURCE_REPOSITORY || commit !== request.commit) {
      fail('composition request does not match the local Source repository and exact commit');
    }
  }

  const sourceRealRoot = await realpath(sourceRoot);
  const revisionRoot = await realpath(path.join(sourceRealRoot, 'dist-w01', 'source', request.sourceRevision));
  if (!isPathInside(sourceRealRoot, revisionRoot)) fail('Source revision path escapes the pinned Source checkout');
  const manifestBytes = await readSourceFile(revisionRoot, 'source-manifest.json');
  if (sha256(manifestBytes) !== request.manifestSha256) fail('Source manifest hash does not match the composition request');
  const sourceManifest = parseJson(manifestBytes, 'Source manifest');
  assertExactKeys(sourceManifest, ['schemaVersion', 'gameReleaseId', 'gameVersion', 'sourceRevision', 'fixtureOnly', 'publicationEligible', 'files'], 'Source manifest');
  if (sourceManifest.schemaVersion !== '1.0.0' || sourceManifest.sourceRevision !== request.sourceRevision ||
      sourceManifest.fixtureOnly !== true || sourceManifest.publicationEligible !== false) {
    fail('composition request must reference a fixture-only Source preview manifest');
  }

  const artifacts = new Map();
  for (const name of ARTIFACTS) {
    const bytes = await readSourceFile(revisionRoot, name);
    verifyPinnedArtifact(sourceManifest, name, bytes);
    artifacts.set(name, bytes);
  }
  const lock = {
    schemaVersion: '1.0.0',
    repository: request.repository,
    commit: request.commit,
    sourceRevision: request.sourceRevision,
    manifestSha256: request.manifestSha256,
    gameReleaseId: sourceManifest.gameReleaseId,
    gameVersion: sourceManifest.gameVersion,
    artifacts: ARTIFACTS
  };
  const lockBytes = jsonBytes(lock);
  const requestId = sha256(jsonBytes(request));
  const receipt = {
    schemaVersion: '1.0.0',
    requestId,
    request,
    sourceLockSha256: sha256(lockBytes),
    artifacts: [...artifacts].map(([name, bytes]) => ({ path: name, sizeBytes: bytes.byteLength, sha256: sha256(bytes) }))
      .sort((left, right) => compareUtf8(left.path, right.path)),
    candidate: {
      repository: WEB_REPOSITORY,
      branch: WEB_BRANCH,
      baseBranch: 'main'
    },
    fixtureOnly: true,
    publicationEligible: false,
    formalPublishAllowed: false
  };
  const receiptBytes = jsonBytes(receipt);
  const destination = path.join(webRoot, 'content', 'w01', 'source');
  await mkdir(destination, { recursive: true });
  const planned = new Map([
    [path.join(destination, 'source-manifest.json'), manifestBytes],
    ...[...artifacts].map(([name, bytes]) => [path.join(destination, name), bytes]),
    [path.join(webRoot, 'source.lock.json'), lockBytes],
    [path.join(webRoot, 'content', 'w01', 'composition-receipt.json'), receiptBytes]
  ]);
  let changed = false;
  for (const [filePath, bytes] of planned) {
    let previous;
    try {
      previous = await readFile(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!previous?.equals(bytes)) {
      await writeFile(filePath, bytes);
      changed = true;
    }
  }
  return {
    requestId,
    changed,
    sourceRevision: request.sourceRevision,
    sourceLockSha256: sha256(lockBytes),
    candidateBranch: WEB_BRANCH,
    artifactHashes: [...artifacts].map(([name, bytes]) => ({ path: name, sizeBytes: bytes.byteLength, sha256: sha256(bytes) }))
      .sort((left, right) => compareUtf8(left.path, right.path))
  };
}

function parseArgs(args) {
  const options = { requestPath: null, sourceRoot: null, webRoot: WEB_ROOT };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--request' && !seen.has(arg) && args[index + 1]) {
      seen.add(arg);
      options.requestPath = path.resolve(args[++index]);
    } else if (arg === '--source-root' && !seen.has(arg) && args[index + 1]) {
      seen.add(arg);
      options.sourceRoot = path.resolve(args[++index]);
    } else if (arg === '--web-root' && !seen.has(arg) && args[index + 1]) {
      seen.add(arg);
      options.webRoot = path.resolve(args[++index]);
    } else {
      fail('Usage: node scripts/w01-compose-source.mjs --request request.json --source-root SourceRepository [--web-root WebRepository]');
    }
  }
  if (!options.requestPath || !options.sourceRoot) {
    fail('Usage: node scripts/w01-compose-source.mjs --request request.json --source-root SourceRepository [--web-root WebRepository]');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const request = parseJson(await readFile(options.requestPath), 'composition request');
    const result = await applyCompositionRequest({ request, sourceRoot: options.sourceRoot, webRoot: options.webRoot });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write('W01 Source composition failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = 1;
  }
}