import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE_MANIFEST_PATH = 'docs/contracts/ARCHIVE.json';

export const ARCHIVE_PATHS = Object.freeze([
  'docs/contracts',
  'content/contracts',
]);

// Keep only inputs reached by npm test, package scripts, or the CI W09 release
// workflow. Everything else below the two archive roots is release-managed evidence.
export const ARCHIVE_EXCLUDED_PATHS = Object.freeze([
  'docs/contracts/w03/coverage.json',
  'docs/contracts/w03/mapping-ledger.json',
  'docs/contracts/w03/scope-manifest.json',
  'docs/contracts/w03/extension/extension-runtime-native-rules-0001.json',
  'docs/contracts/w03/extension/extension-runtime-static-data-0001.json',
  'docs/contracts/w03/extension/web-source-lock-0001.json',
  'docs/contracts/w03/extension/web-w01-inputs-0001.json',
  'docs/contracts/w03/extension/web-w01-inputs-0002.json',
  'docs/contracts/w03/mods/mapping-ledger.json',
  'docs/contracts/w03/mods/shards/m05-001.json',
  'docs/contracts/w03/mods/shards/m06-001.json',
  'docs/contracts/w03/mods/shards/m07-001.json',
  'docs/contracts/w03/mods/shards/m08-001.json',
  'docs/contracts/w15',
  'content/contracts/source-v2-snapshot',
  'content/contracts/source-v2.lock.json',
  'content/contracts/web-authoring.lock.json',
  'content/contracts/w06',
  'content/contracts/w07',
  'content/contracts/w08/compiler-inputs.lock.json',
  'content/contracts/w08/compiler.lock.json',
  'content/contracts/w09/authoring-overlays',
  'content/contracts/w09/compiler.lock.json',
  'content/contracts/w09/source-handoff',
  'content/contracts/w09/source-request',
  'content/contracts/w09/source-request.lock.json',
  'content/contracts/w09/test-source-runtime',
]);

function safeRelativePath(candidate) {
  return typeof candidate === 'string'
    && candidate.length > 0
    && !path.isAbsolute(candidate)
    && !candidate.split(/[\\/]/u).some(part => part === '..' || part.length === 0);
}

function normalizeArchivePaths(archivePaths, { allowEmpty = false } = {}) {
  if (!Array.isArray(archivePaths) || (!allowEmpty && archivePaths.length === 0)) throw new Error('archive paths are required');
  const normalized = archivePaths.map(item => item.replaceAll('\\', '/').replace(/\/$/u, ''));
  if (!normalized.every(safeRelativePath)) throw new Error('archive paths must be safe repository-relative paths');
  return [...new Set(normalized)].sort();
}

async function run(command, args, options = {}) {
  return execFile(command, args, { windowsHide: true, ...options });
}

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

async function listFiles(root, relative = '') {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const childRelative = relative ? path.posix.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, childRelative));
    } else if (entry.isFile()) {
      const absolute = path.join(root, ...childRelative.split('/'));
      files.push({
        path: childRelative,
        size: (await lstat(absolute)).size,
        sha256: await sha256File(absolute),
      });
    } else {
      throw new Error(`archive contains unsupported entry: ${childRelative}`);
    }
  }
  return files;
}

function assetFilename(sourceCommit) {
  return `contracts-archive-${sourceCommit}.tar.gz`;
}

export function createArchiveManifest({ sourceCommit, archivePaths, excludedPaths = [], releaseTag, repository, assetFilename: filename, tarSha256, files }) {
  return {
    schemaVersion: 1,
    purpose: 'Archived contract analysis evidence removed from the working tree; restore before running the documented manual contract CLIs.',
    sourceCommit,
    releaseTag,
    repository,
    assetFilename: filename,
    tarSha256,
    archivePaths: normalizeArchivePaths(archivePaths),
    excludedPaths: normalizeArchivePaths(excludedPaths, { allowEmpty: true }),
    files: [...files].sort((left, right) => left.path.localeCompare(right.path)),
  };
}

async function extractTar(archivePath, destination) {
  await mkdir(destination, { recursive: true });
  await run('tar', ['--force-local', '-xzf', archivePath, '-C', destination]);
}

export async function packArchive({
  repoRoot = REPO_ROOT,
  commit,
  outputDir,
  archivePaths = ARCHIVE_PATHS,
  excludedPaths = ARCHIVE_EXCLUDED_PATHS,
  releaseTag = 'contracts-archive-20261103',
  repository = 'SyuanTsai/DarkTide-Web',
  manifestPath = ARCHIVE_MANIFEST_PATH,
  writeManifest = true,
} = {}) {
  if (!commit) throw new Error('pack requires --commit <sha>');
  if (!outputDir) throw new Error('pack requires --output <dir>');
  const paths = normalizeArchivePaths(archivePaths);
  const exclusions = normalizeArchivePaths(excludedPaths, { allowEmpty: true });
  const { stdout } = await run('git', ['rev-parse', `${commit}^{commit}`], { cwd: repoRoot });
  const sourceCommit = stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error('commit did not resolve to a full SHA');
  const output = path.resolve(repoRoot, outputDir);
  await mkdir(output, { recursive: true });
  const filename = assetFilename(sourceCommit);
  const archivePath = path.join(output, filename);
  await run('git', ['archive', '--format=tar.gz', `--output=${archivePath}`, sourceCommit, '--', ...paths,
    ...exclusions.map(exclusion => `:(exclude)${exclusion}`)], { cwd: repoRoot });

  const staging = await mkdtemp(path.join(os.tmpdir(), 'contracts-archive-pack-'));
  try {
    await extractTar(archivePath, staging);
    const files = await listFiles(staging);
    if (files.length === 0) throw new Error('archive selection produced no files');
    const manifest = createArchiveManifest({
      sourceCommit,
      archivePaths: paths,
      excludedPaths: exclusions,
      releaseTag,
      repository,
      assetFilename: filename,
      tarSha256: await sha256File(archivePath),
      files,
    });
    if (writeManifest) {
      const destination = path.resolve(repoRoot, manifestPath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return { archivePath, manifest };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function downloadReleaseAsset({ releaseTag, repository, assetFilename: filename, destination }) {
  await mkdir(path.dirname(destination), { recursive: true });
  await run('gh', ['release', 'download', releaseTag, '--repo', repository, '--pattern', filename, '--dir', path.dirname(destination)]);
  const downloaded = path.join(path.dirname(destination), filename);
  if (path.resolve(downloaded) !== path.resolve(destination)) await copyFile(downloaded, destination);
}

async function verifyStagedFiles(staging, expectedFiles) {
  const actual = await listFiles(staging);
  const expected = [...expectedFiles].sort((left, right) => left.path.localeCompare(right.path));
  if (actual.length !== expected.length) throw new Error('archive file list does not match manifest');
  for (let index = 0; index < expected.length; index += 1) {
    const wanted = expected[index];
    const received = actual[index];
    if (!safeRelativePath(wanted.path) || received.path !== wanted.path || received.size !== wanted.size || received.sha256 !== wanted.sha256) {
      throw new Error(`archive file verification failed: ${wanted.path}`);
    }
  }
}

async function assertTargetsAreAbsent(repoRoot, files) {
  for (const file of files) {
    const destination = path.resolve(repoRoot, ...file.path.split('/'));
    if (!destination.startsWith(`${path.resolve(repoRoot)}${path.sep}`)) throw new Error(`unsafe restore path: ${file.path}`);
    try {
      await lstat(destination);
      throw new Error(`restore target already exists: ${file.path}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

export async function restoreArchive({
  repoRoot = REPO_ROOT,
  manifestPath = ARCHIVE_MANIFEST_PATH,
  manifest: providedManifest,
  downloadAsset = downloadReleaseAsset,
} = {}) {
  const manifest = providedManifest ?? JSON.parse(await readFile(path.resolve(repoRoot, manifestPath), 'utf8'));
  if (!manifest || !Array.isArray(manifest.files) || !/^[0-9a-f]{64}$/u.test(manifest.tarSha256)) throw new Error('invalid archive manifest');
  const staging = await mkdtemp(path.join(os.tmpdir(), 'contracts-archive-restore-'));
  try {
    const archivePath = path.join(staging, manifest.assetFilename);
    await downloadAsset({ ...manifest, destination: archivePath });
    if (await sha256File(archivePath) !== manifest.tarSha256) throw new Error('archive sha256 mismatch');
    const extracted = path.join(staging, 'extracted');
    await extractTar(archivePath, extracted);
    await verifyStagedFiles(extracted, manifest.files);
    await assertTargetsAreAbsent(repoRoot, manifest.files);
    for (const file of manifest.files) {
      const source = path.join(extracted, ...file.path.split('/'));
      const destination = path.join(repoRoot, ...file.path.split('/'));
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function optionValue(args, option) {
  const index = args.indexOf(option);
  return index === -1 ? undefined : args[index + 1];
}

async function main(args) {
  const [command] = args;
  if (command === 'pack') {
    const result = await packArchive({ commit: optionValue(args, '--commit'), outputDir: optionValue(args, '--output') });
    process.stdout.write(`${result.archivePath}\n${path.join(REPO_ROOT, ARCHIVE_MANIFEST_PATH)}\n`);
    return;
  }
  if (command === 'restore') {
    await restoreArchive();
    process.stdout.write('Contract archive restored. Restored files are local working copies; do not commit them.\n');
    return;
  }
  throw new Error('Usage: node scripts/contracts-archive.mjs pack --commit <sha> --output <dir> | restore');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
