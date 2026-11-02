import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const FILE_SHA_PATTERN = /^[a-f0-9]{64}$/;
const RELEASE_ORIGIN = 'https://github.com';

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0')) {
    fail(`${label} must be a non-empty portable relative path`);
  }
  const normalized = path.posix.normalize(value.replace(/^\.\//, ''));
  if (normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    fail(`${label} escapes the retained-history root`);
  }
  return normalized;
}

function childPath(root, relative, label) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...safeRelativePath(relative, label).split('/'));
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    fail(`${label} escapes the retained-history root`);
  }
  return resolved;
}

function validateEntry(entry, index) {
  if (!isRecord(entry)) fail(`history.entries[${index}] must be an object`);
  const expectedKeys = ['build', 'commit', 'freeze', 'retain', 'verify', 'version'];
  if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(expectedKeys)) {
    fail(`history.entries[${index}] has unexpected fields`);
  }
  if (typeof entry.version !== 'string' || entry.version.length === 0) fail(`history.entries[${index}].version is invalid`);
  if (typeof entry.commit !== 'string' || !SHA_PATTERN.test(entry.commit)) fail(`history.entries[${index}].commit is invalid`);
  if (!Array.isArray(entry.build) || entry.build.length === 0 || entry.build.some(value => typeof value !== 'string' || value.length === 0)) {
    fail(`history.entries[${index}].build must be a non-empty string array`);
  }
  if (typeof entry.retain !== 'boolean' || typeof entry.verify !== 'boolean') fail(`history.entries[${index}] flags are invalid`);
  if (entry.freeze !== null) safeRelativePath(entry.freeze, `history.entries[${index}].freeze`);
  return entry;
}

export function validateHistory(history) {
  if (!isRecord(history) || history.schemaVersion !== 1 || !Array.isArray(history.entries) || history.entries.length === 0) {
    fail('history must use schemaVersion 1 and contain entries');
  }
  if (!isRecord(history.release)) fail('history.release is required');
  const releaseKeys = ['archiveAsset', 'manifestAsset', 'repository', 'tag'];
  if (JSON.stringify(Object.keys(history.release).sort()) !== JSON.stringify(releaseKeys)) fail('history.release has unexpected fields');
  for (const key of releaseKeys) {
    if (typeof history.release[key] !== 'string' || history.release[key].length === 0) fail(`history.release.${key} is invalid`);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(history.release.repository)) fail('history.release.repository is invalid');
  if (!/^[A-Za-z0-9_.-]+$/.test(history.release.tag)) fail('history.release.tag is invalid');
  for (const key of ['archiveAsset', 'manifestAsset']) {
    if (!/^[A-Za-z0-9_.-]+$/.test(history.release[key])) fail(`history.release.${key} is invalid`);
  }
  const entries = history.entries.map(validateEntry);
  if (new Set(entries.map(entry => entry.version)).size !== entries.length) fail('history versions must be unique');
  const freezes = entries.filter(entry => entry.freeze !== null).map(entry => entry.freeze);
  if (new Set(freezes).size !== freezes.length) fail('history freeze names must be unique');
  return history;
}

export async function rebuildRetainedHistory({
  history,
  materializeEntry,
  runEntry,
  freezeEntry = async () => {},
  cleanupEntry = async () => {},
}) {
  validateHistory(history);
  for (const entry of history.entries) {
    const sourceRoot = await materializeEntry(entry);
    try {
      await runEntry(entry, sourceRoot);
      if (entry.freeze !== null) await freezeEntry(entry, sourceRoot);
    } finally {
      await cleanupEntry(entry, sourceRoot);
    }
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

async function sha256File(file) {
  const bytes = await readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

async function listFiles(root, relative = '') {
  const current = relative ? childPath(root, relative, 'retained-history path') : path.resolve(root);
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) fail(`retained-history contains a symbolic link: ${next}`);
    if (entry.isDirectory()) files.push(...await listFiles(root, next));
    else if (entry.isFile()) files.push(next);
    else fail(`retained-history contains an unsupported file: ${next}`);
  }
  return files;
}

export async function verifyRetainedFiles(root, rows) {
  if (!Array.isArray(rows)) fail('retained-history files must be an array');
  const expected = [];
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row) || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(['path', 'sha256', 'sizeBytes'])) {
      fail(`retained-history files[${index}] is invalid`);
    }
    const relative = safeRelativePath(row.path, `retained-history files[${index}].path`);
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0 || typeof row.sha256 !== 'string' || !FILE_SHA_PATTERN.test(row.sha256)) {
      fail(`retained-history files[${index}] has an invalid size or SHA-256`);
    }
    const file = childPath(root, relative, `retained-history files[${index}].path`);
    let info;
    try {
      info = await lstat(file);
    } catch (error) {
      if (error?.code === 'ENOENT') fail(`retained-history file is missing: ${relative}`);
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) fail(`retained-history path is not a regular file: ${relative}`);
    if (info.size !== row.sizeBytes) fail(`size mismatch for retained-history file: ${relative}`);
    if (await sha256File(file) !== row.sha256) fail(`SHA-256 mismatch for retained-history file: ${relative}`);
    expected.push(relative);
  }
  const actual = await listFiles(root);
  expected.sort((left, right) => left.localeCompare(right, 'en'));
  if (new Set(expected).size !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('retained-history archive file set does not match its manifest');
  }
}

async function createManifest(bundleRoot, historyBytes, retainedPreviewManifestBytes, archiveName, freezes) {
  const files = [];
  for (const relative of await listFiles(bundleRoot)) {
    const file = childPath(bundleRoot, relative, 'bundle file');
    const info = await stat(file);
    files.push({ path: relative, sizeBytes: info.size, sha256: await sha256File(file) });
  }
  return {
    schemaVersion: 1,
    archive: archiveName,
    historySha256: createHash('sha256').update(historyBytes).digest('hex'),
    retainedPreviewManifestSha256: createHash('sha256').update(retainedPreviewManifestBytes).digest('hex'),
    freezes,
    files,
  };
}

async function validateArchiveListing(archivePath) {
  const lines = [];
  await new Promise((resolve, reject) => {
    const child = spawn('tar', ['-tf', archivePath], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.setEncoding('utf8');
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('exit', code => {
      if (code !== 0) return reject(new Error(`tar listing failed (exit ${code})`));
      lines.push(...output.split(/\r?\n/).filter(Boolean));
      resolve();
    });
  });
  for (const entry of lines) {
    const portable = entry.replace(/^\.\//, '').replace(/\/$/, '');
    if (portable.length > 0) safeRelativePath(portable, 'archive entry');
  }
}

async function copyRequiredDirectory(source, destination, label) {
  const info = await lstat(source).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (!info?.isDirectory() || info.isSymbolicLink()) fail(`${label} directory is missing`);
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
}

export async function restoreRetainedHistory({ archivePath, manifestPath, historyPath, retainedPreviewManifestPath, outputRoot, freezeRoot, stagingRoot }) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!isRecord(manifest) || manifest.schemaVersion !== 1 || manifest.archive !== path.basename(archivePath)
      || !FILE_SHA_PATTERN.test(manifest.historySha256)
      || !FILE_SHA_PATTERN.test(manifest.retainedPreviewManifestSha256)
      || !Array.isArray(manifest.freezes)) {
    fail('retained-history manifest is invalid');
  }
  const historyBytes = await readFile(historyPath);
  const history = validateHistory(JSON.parse(historyBytes.toString('utf8')));
  const expectedFreezes = history.entries.filter(entry => entry.freeze !== null).map(entry => entry.freeze);
  if (JSON.stringify(manifest.freezes) !== JSON.stringify(expectedFreezes)) fail('retained-history freeze list does not match history.json');
  if (createHash('sha256').update(historyBytes).digest('hex') !== manifest.historySha256) fail('retained-history was built from a different history.json');
  const retainedPreviewManifestBytes = await readFile(retainedPreviewManifestPath);
  if (createHash('sha256').update(retainedPreviewManifestBytes).digest('hex') !== manifest.retainedPreviewManifestSha256) {
    fail('retained-history was built from a different retained-preview-manifest.json');
  }

  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  await validateArchiveListing(archivePath);
  await run('tar', ['-xf', archivePath, '--no-same-owner', '--no-same-permissions', '-C', stagingRoot]);
  await verifyRetainedFiles(stagingRoot, manifest.files);
  await copyRequiredDirectory(path.join(stagingRoot, 'dist-w01'), outputRoot, 'retained dist-w01');
  for (const freeze of manifest.freezes) {
    await copyRequiredDirectory(childPath(stagingRoot, `freezes/${freeze}`, 'freeze source'), path.join(freezeRoot, freeze), `retained ${freeze}`);
  }
}

export async function prepareRetainedHistory({ forceRebuild, downloadRelease, restoreRelease, rebuild }) {
  if (forceRebuild) {
    await rebuild();
    return { mode: 'rebuild', reason: 'requested' };
  }
  const release = await downloadRelease();
  if (!release.found) {
    await rebuild();
    return { mode: 'rebuild', reason: 'release-not-found' };
  }
  await restoreRelease(release);
  return { mode: 'restore', reason: 'release-found' };
}

async function downloadFile(url, destination) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
  if (response.status === 404) return false;
  if (!response.ok) fail(`retained-history download failed with HTTP ${response.status}: ${url.pathname}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
  return true;
}

async function downloadRelease(history, downloadRoot) {
  const base = new URL(`/${history.release.repository}/releases/download/${encodeURIComponent(history.release.tag)}/`, RELEASE_ORIGIN);
  const archivePath = path.join(downloadRoot, history.release.archiveAsset);
  const manifestPath = path.join(downloadRoot, history.release.manifestAsset);
  const archiveFound = await downloadFile(new URL(encodeURIComponent(history.release.archiveAsset), base), archivePath);
  const manifestFound = await downloadFile(new URL(encodeURIComponent(history.release.manifestAsset), base), manifestPath);
  if (archiveFound !== manifestFound) fail('retained-history release is incomplete');
  return { found: archiveFound, archivePath, manifestPath };
}

async function fullRebuild({ history, historyPath, retainedPreviewManifestPath, repoRoot, outputRoot, freezeRoot, workRoot, bundleRoot, archivePath, manifestPath }) {
  await rm(outputRoot, { recursive: true, force: true });
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(workRoot, { recursive: true });
  const worktrees = new Map();
  let baselineRoot;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const materializeEntry = async entry => {
    // A shallow fetch would truncate the full-history checkout that pinned-commit tests rely on.
    try { await run('git', ['cat-file', '-e', entry.commit + '^{commit}'], { cwd: repoRoot }); }
    catch { await run('git', ['fetch', '--no-tags', 'origin', entry.commit], { cwd: repoRoot }); }
    const sourceRoot = path.join(workRoot, entry.version.replace(/[^A-Za-z0-9_.-]/g, '-'));
    await rm(sourceRoot, { recursive: true, force: true });
    await run('git', ['worktree', 'add', '--detach', sourceRoot, entry.commit], { cwd: repoRoot });
    worktrees.set(entry.version, sourceRoot);
    return sourceRoot;
  };
  const cleanupEntry = async entry => {
    if (entry.version === 'baseline') return;
    const sourceRoot = worktrees.get(entry.version);
    await run('git', ['worktree', 'remove', '--force', sourceRoot], { cwd: repoRoot });
    worktrees.delete(entry.version);
  };

  try {
    await rebuildRetainedHistory({
      history,
      materializeEntry,
      runEntry: async (entry, sourceRoot) => {
        if (entry.version === 'baseline') baselineRoot = sourceRoot;
        const [script, ...buildArgs] = entry.build;
        const args = ['run', script];
        if (buildArgs.length > 0 || script === 'w01:build') args.push('--', ...buildArgs);
        if (script === 'w01:build') args.push('--output', outputRoot);
        await run(npm, args, { cwd: sourceRoot });
        if (entry.retain) {
          if (!baselineRoot) fail('baseline must be built before retained history entries');
          await run(npm, ['run', 'w01:retain', '--', '--baseline-root', baselineRoot, '--output', outputRoot], { cwd: sourceRoot });
        }
        if (entry.verify) await run(npm, ['run', 'w01:verify', '--', outputRoot], { cwd: sourceRoot });
      },
      freezeEntry: async entry => {
        await copyRequiredDirectory(outputRoot, path.join(freezeRoot, entry.freeze), entry.freeze);
      },
      cleanupEntry,
    });
  } finally {
    for (const sourceRoot of [...worktrees.values()].reverse()) {
      await run('git', ['worktree', 'remove', '--force', sourceRoot], { cwd: repoRoot }).catch(() => {});
    }
    await run('git', ['worktree', 'prune'], { cwd: repoRoot }).catch(() => {});
  }

  await mkdir(bundleRoot, { recursive: true });
  await copyRequiredDirectory(outputRoot, path.join(bundleRoot, 'dist-w01'), 'rebuilt dist-w01');
  const freezes = history.entries.filter(entry => entry.freeze !== null).map(entry => entry.freeze);
  for (const freeze of freezes) {
    await copyRequiredDirectory(path.join(freezeRoot, freeze), path.join(bundleRoot, 'freezes', freeze), freeze);
  }
  const historyBytes = await readFile(historyPath);
  const retainedPreviewManifestBytes = await readFile(retainedPreviewManifestPath);
  const manifest = await createManifest(bundleRoot, historyBytes, retainedPreviewManifestBytes, path.basename(archivePath), freezes);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await mkdir(path.dirname(archivePath), { recursive: true });
  await rm(archivePath, { force: true });
  await run('tar', ['-cf', archivePath, '-C', bundleRoot, '.']);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined) fail('arguments must be --name value pairs');
    values.set(name.slice(2), value);
  }
  return values;
}

async function main(argv) {
  const args = parseArguments(argv);
  if (args.get('command') !== 'prepare') fail('only --command prepare is supported');
  const repoRoot = path.resolve(args.get('repo-root') ?? '.');
  const historyPath = path.resolve(repoRoot, args.get('history') ?? 'docs/w01/history.json');
  const retainedPreviewManifestPath = path.resolve(repoRoot, args.get('retained-preview-manifest') ?? 'docs/w01/retained-preview-manifest.json');
  const history = validateHistory(JSON.parse(await readFile(historyPath, 'utf8')));
  const outputRoot = path.resolve(args.get('output'));
  const freezeRoot = path.resolve(args.get('freeze-root'));
  const workRoot = path.resolve(args.get('work-root') ?? await mkdtemp(path.join(os.tmpdir(), 'w01-history-work-')));
  const bundleRoot = path.resolve(args.get('bundle-root') ?? path.join(workRoot, 'bundle'));
  const archivePath = path.resolve(args.get('archive'));
  const manifestPath = path.resolve(args.get('manifest-out'));
  const downloadRoot = path.join(workRoot, 'download');
  const stagingRoot = path.join(workRoot, 'restore');
  const forceRebuild = args.get('force-rebuild') === 'true';

  const result = await prepareRetainedHistory({
    forceRebuild,
    downloadRelease: () => downloadRelease(history, downloadRoot),
    restoreRelease: release => restoreRetainedHistory({ ...release, historyPath, retainedPreviewManifestPath, outputRoot, freezeRoot, stagingRoot }),
    rebuild: () => fullRebuild({ history, historyPath, retainedPreviewManifestPath, repoRoot, outputRoot, freezeRoot, workRoot: path.join(workRoot, 'sources'), bundleRoot, archivePath, manifestPath }),
  });
  const summary = result.mode === 'restore'
    ? 'Restored and verified retained W01 history from the fixed GitHub Release.'
    : result.reason === 'release-not-found'
      ? 'Retained W01 history Release was not found; rebuilt all history from docs/w01/history.json.'
      : 'Rebuilt all retained W01 history as requested.';
  if (args.has('summary')) await appendFile(path.resolve(args.get('summary')), `\n### W01 retained history\n\n${summary}\n`, 'utf8');
  if (args.has('github-output')) {
    await appendFile(path.resolve(args.get('github-output')), `mode=${result.mode}\nreason=${result.reason}\nrebuilt=${result.mode === 'rebuild'}\n`, 'utf8');
  }
  process.stdout.write(summary + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
