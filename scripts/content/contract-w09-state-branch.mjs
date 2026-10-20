import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const STATE_FILE = 'content/contracts/w09/release-state.json';
const ALLOWED_PREFIXES = [
  'content/contracts/w09/prepared/',
  'content/contracts/w09/runtime-snapshots/',
];
const DEFAULT_BRANCH = 'w09-release-state';
const REMOTE_REF_PREFIX = 'refs/remotes/origin/';
const GIT_OUTPUT_LIMIT = 256 * 1024 * 1024;

/**
 * Durable owner state for the serialized W09 publication transaction.
 * This writes an orphan/owner-only tree using a temporary index and a regular
 * non-fast-forward-rejecting push. It never changes the checkout index or HEAD.
 */
export async function createW09StateBranchStore({
  repoRoot,
  branch = DEFAULT_BRANCH,
  token = process.env.W09_GIT_TOKEN ?? process.env.GITHUB_TOKEN ?? '',
} = {}) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) throw new TypeError('repoRoot is required for W09 durable state');
  if (typeof branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/u.test(branch)
      || branch.includes('..') || branch.includes('\\') || branch.endsWith('/') || branch.includes('@{')) {
    throw new TypeError('W09 state branch must be a safe branch name');
  }
  const root = path.resolve(repoRoot);
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('W09 owner state repository root must be a real directory');
  const branchRef = 'refs/heads/' + branch;
  const trackingRef = REMOTE_REF_PREFIX + branch;
  let ownerCommit = null;
  let loaded = false;

  const baseEnv = makeGitEnvironment(token);
  // Inspect the configured URL rather than `remote get-url`, which expands
  // local insteadOf rewrites used by isolated tests and credential tooling.
  const officialRemote = await gitText(['config', '--get', 'remote.origin.url']);
  if (!isOfficialWebOrigin(officialRemote)) throw new Error('W09 durable state requires the official DarkTide-Web HTTPS origin');

  async function readRemoteHead() {
    const output = await gitText(['ls-remote', '--heads', 'origin', branchRef]);
    const rows = output.trim() ? output.trim().split(/\r?\n/u) : [];
    if (rows.length > 1) throw new Error('W09 owner state branch lookup returned duplicate refs');
    if (!rows.length) return null;
    const match = /^([a-f0-9]{40}|[a-f0-9]{64})\s+([^\s]+)$/u.exec(rows[0]);
    if (!match || match[2] !== branchRef) throw new Error('W09 owner state branch lookup returned a malformed ref');
    return match[1];
  }

  async function refreshRemoteTracking(commit) {
    if (commit) {
      await gitText(['fetch', '--no-tags', 'origin', '+' + branchRef + ':' + trackingRef]);
      const fetched = (await gitText(['rev-parse', trackingRef])).trim();
      if (fetched !== commit) throw new Error('W09 owner state branch changed during fetch');
    } else {
      try { await gitText(['update-ref', '-d', trackingRef]); } catch { /* no local tracking ref to clear */ }
    }
  }

  async function treeRows(commit) {
    if (!commit) return [];
    const bytes = await gitBytes(['ls-tree', '-r', '-z', '--full-tree', commit]);
    const rows = [];
    for (const entry of bytes.toString('utf8').split('\0').filter(Boolean)) {
      const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})\t([^\0]+)$/u.exec(entry);
      if (!match || match[2] !== 'blob' || match[1] !== '100644') {
        throw new Error('W09 owner state branch contains a non-regular file');
      }
      const filePath = match[4];
      assertAllowedPath(filePath);
      rows.push({ path: filePath, sha: match[3] });
    }
    return rows.sort((left, right) => comparePath(left.path, right.path));
  }

  async function restore() {
    const remoteCommit = await readRemoteHead();
    await refreshRemoteTracking(remoteCommit);
    const rows = await treeRows(remoteCommit);
    if (remoteCommit && !rows.some(row => row.path === STATE_FILE)) {
      throw new Error('W09 owner state branch exists without its required release-state.json');
    }
    for (const row of rows) {
      const bytes = await gitBytes(['cat-file', 'blob', row.sha]);
      await writeWorktreeFile(row.path, bytes);
    }
    ownerCommit = remoteCommit;
    loaded = true;
    return { status: remoteCommit ? 'restored' : 'empty', commit: remoteCommit, fileCount: rows.length };
  }

  async function persist({ phase = 'checkpoint' } = {}) {
    if (!loaded) throw new Error('W09 owner state must be restored before it can be persisted');
    if (typeof phase !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/u.test(phase)) throw new TypeError('W09 state phase must be a short safe identifier');
    const currentRemoteCommit = await readRemoteHead();
    if (currentRemoteCommit !== ownerCommit) {
      throw new Error('W09 owner state non-fast-forward CAS failed; reload the latest state before retrying');
    }
    const worktreeFiles = await collectAllowedWorktreeFiles();
    const previousRows = await treeRows(ownerCommit);
    const previousPaths = new Set(previousRows.map(row => row.path));
    const currentPaths = new Set(worktreeFiles.map(row => row.path));
    if (!currentPaths.has(STATE_FILE) || (ownerCommit && !previousPaths.has(STATE_FILE))) {
      throw new Error('W09 owner state ledger must be present before any state branch can be persisted');
    }
    const indexRoot = await mkdtemp(path.join(os.tmpdir(), 'w09-owner-index-'));
    const indexPath = path.join(indexRoot, 'index');
    const env = { ...baseEnv, GIT_INDEX_FILE: indexPath };
    try {
      if (ownerCommit) await gitText(['read-tree', ownerCommit], { env });
      else await gitText(['read-tree', '--empty'], { env });
      for (const oldPath of previousPaths) {
        if (!currentPaths.has(oldPath)) await gitText(['update-index', '--force-remove', '--', oldPath], { env });
      }
      for (const row of worktreeFiles) await gitText(['add', '-f', '--', row.path], { env });
      const stagedPaths = (await gitText(['ls-files', '--stage', '-z'], { env })).split('\0').filter(Boolean);
      for (const staged of stagedPaths) {
        const tab = staged.indexOf('\t');
        if (tab < 0) throw new Error('W09 owner state index entry is malformed');
        assertAllowedPath(staged.slice(tab + 1));
        if (!staged.startsWith('100644 ')) throw new Error('W09 owner state index contains a non-regular file');
      }
      const tree = (await gitText(['write-tree'], { env })).trim();
      if (ownerCommit && (await gitText(['rev-parse', ownerCommit + '^{tree}'])).trim() === tree) {
        return { status: 'unchanged', commit: ownerCommit, phase };
      }
      const commitArgs = ['commit-tree', tree];
      if (ownerCommit) commitArgs.push('-p', ownerCommit);
      commitArgs.push('-m', 'SYP-341', '-m', 'chore: checkpoint W09 release state (' + phase + ')', '-m', 'zh-TW:\n維護：W09 發布狀態檢查點（階段：' + phase + '）');
      const authorEnv = { ...env,
        GIT_AUTHOR_NAME: 'github-actions[bot]',
        GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
        GIT_COMMITTER_NAME: 'github-actions[bot]',
        GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
      };
      const nextCommit = (await gitText(commitArgs, { env: authorEnv })).trim();
      try {
        await gitText(['push', 'origin', nextCommit + ':' + branchRef]);
      } catch {
        throw new Error('W09 owner state push failed; the branch was preserved and the operation requires a fresh non-fast-forward retry');
      }
      const pushed = await readRemoteHead();
      if (pushed !== nextCommit) throw new Error('W09 owner state changed after push; reload before continuing');
      ownerCommit = nextCommit;
      return { status: 'persisted', commit: nextCommit, phase, fileCount: worktreeFiles.length };
    } finally {
      await rm(indexRoot, { recursive: true, force: true });
    }
  }

  async function gitText(args, { env = baseEnv } = {}) {
    const output = await runGit(root, args, { env, encoding: 'utf8' });
    return output;
  }

  async function gitBytes(args, { env = baseEnv } = {}) {
    return runGit(root, args, { env, encoding: null });
  }

  return Object.freeze({ restore, persist, get ownerCommit() { return ownerCommit; }, branch });

  async function writeWorktreeFile(relativePath, bytes) {
    assertAllowedPath(relativePath);
    const absolute = path.resolve(root, ...relativePath.split('/'));
    assertWithinRoot(root, absolute);
    await assertNoSymlinkParents(root, absolute);
    await mkdir(path.dirname(absolute), { recursive: true });
    const tempPath = absolute + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(tempPath, bytes, { flag: 'wx' });
      await rename(tempPath, absolute);
    } finally {
      await rm(tempPath, { force: true });
    }
  }

  async function collectAllowedWorktreeFiles() {
    const result = [];
    const statePath = path.join(root, ...STATE_FILE.split('/'));
    await assertNoSymlinkParents(root, statePath);
    try {
      const info = await lstat(statePath);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error('W09 state file must be a regular file');
      result.push({ path: STATE_FILE, bytes: await readFile(statePath) });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const prefix of ALLOWED_PREFIXES) {
      const absolute = path.join(root, ...prefix.slice(0, -1).split('/'));
      await assertNoSymlinkParents(root, absolute);
      await collectTree(absolute, prefix, result);
    }
    result.sort((left, right) => comparePath(left.path, right.path));
    return result;
  }

  async function collectTree(directory, prefix, rows) {
    await assertNoSymlinkParents(root, directory);
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const relative = prefix + entry.name;
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error('W09 owner state files may not contain symlinks');
      if (entry.isDirectory()) await collectTree(absolute + path.sep, relative + '/', rows);
      else if (entry.isFile()) {
        assertAllowedPath(relative);
        rows.push({ path: relative, bytes: await readFile(absolute) });
      } else throw new Error('W09 owner state path is not a regular file or directory');
    }
  }
}

/** Read the published owner branch without restoring its files into this checkout. */
export async function readW09OwnerStateBranch({ repoRoot, branch = DEFAULT_BRANCH } = {}) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) throw new TypeError('repoRoot is required to inspect W09 owner state');
  if (typeof branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/u.test(branch)
      || branch.includes('..') || branch.includes('\\') || branch.endsWith('/') || branch.includes('@{')) {
    throw new TypeError('W09 state branch must be a safe branch name');
  }
  const root = path.resolve(repoRoot);
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('W09 owner state repository root must be a real directory');
  const officialRemote = runGit(root, ['config', '--get', 'remote.origin.url'], { env: makeGitEnvironment(''), encoding: 'utf8' }).trim();
  if (!isOfficialWebOrigin(officialRemote)) throw new Error('W09 durable state requires the official DarkTide-Web HTTPS origin');
  const branchRef = 'refs/heads/' + branch;
  const trackingRef = REMOTE_REF_PREFIX + branch;
  const output = runGit(root, ['ls-remote', '--heads', 'origin', branchRef], { env: makeGitEnvironment(''), encoding: 'utf8' }).trim();
  const rows = output ? output.split(/\r?\n/u) : [];
  if (rows.length === 0) return { status: 'empty', commit: null, active: false, state: null };
  if (rows.length !== 1) throw new Error('W09 owner state branch lookup returned duplicate refs');
  const match = /^([a-f0-9]{40}|[a-f0-9]{64})\s+([^\s]+)$/u.exec(rows[0]);
  if (!match || match[2] !== branchRef) throw new Error('W09 owner state branch lookup returned a malformed ref');
  const commit = match[1];
  runGit(root, ['fetch', '--no-tags', 'origin', '+' + branchRef + ':' + trackingRef], { env: makeGitEnvironment(''), encoding: 'utf8' });
  const fetched = runGit(root, ['rev-parse', trackingRef], { env: makeGitEnvironment(''), encoding: 'utf8' }).trim();
  if (fetched !== commit) throw new Error('W09 owner state branch changed during inspection');
  const treeBytes = runGit(root, ['ls-tree', '-r', '-z', '--full-tree', commit], { env: makeGitEnvironment(''), encoding: null });
  const treePaths = new Set();
  for (const entry of treeBytes.toString('utf8').split('\0').filter(Boolean)) {
    const treeMatch = /^(\d{6}) (blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})\t([^\0]+)$/u.exec(entry);
    if (!treeMatch || treeMatch[1] !== '100644' || treeMatch[2] !== 'blob') {
      throw new Error('W09 owner state branch contains a non-regular file');
    }
    assertAllowedPath(treeMatch[4]);
    treePaths.add(treeMatch[4]);
  }
  if (!treePaths.has(STATE_FILE)) throw new Error('W09 owner state branch exists without its required release-state.json');
  let bytes;
  try {
    bytes = runGit(root, ['show', commit + ':' + STATE_FILE], { env: makeGitEnvironment(''), encoding: null });
  } catch {
    throw new Error('W09 owner state branch exists without its required release-state.json');
  }
  let state;
  try { state = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('W09 owner state branch release-state.json is not valid JSON'); }
  const { validateW09ReleaseState } = await import('./contract-w09-release.mjs');
  try { validateW09ReleaseState(state); }
  catch { throw new Error('W09 owner state branch release-state.json failed contract validation'); }
  const active = state.activeByGame.length > 0
    || (state.activeRuntimeSnapshotBuildId !== null && state.activeRuntimeSnapshotBuildId !== undefined)
    || (state.pendingPromotion !== null && state.pendingPromotion !== undefined);
  return { status: 'present', commit, active, state };
}

function makeGitEnvironment(token) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  delete env.GITHUB_TOKEN;
  delete env.W09_GIT_TOKEN;
  if (typeof token === 'string' && token.trim()) {
    const count = Number(env.GIT_CONFIG_COUNT ?? '0');
    if (!Number.isSafeInteger(count) || count < 0 || count > 98) throw new Error('too many temporary Git configuration entries');
    env.GIT_CONFIG_COUNT = String(count + 1);
    env['GIT_CONFIG_KEY_' + count] = 'http.https://github.com/.extraheader';
    env['GIT_CONFIG_VALUE_' + count] = 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + token, 'utf8').toString('base64');
  }
  return env;
}

function isOfficialWebOrigin(value) {
  return /^https:\/\/github\.com\/SyuanTsai\/DarkTide-Web(?:\.git)?\/?$/u.test(String(value ?? '').trim());
}

function assertAllowedPath(value) {
  if (typeof value !== 'string' || value.includes('\0') || value.includes('\\') || value.startsWith('/')
      || /^[A-Za-z]:/u.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('W09 owner state contains an unsafe repository path');
  }
  if (value !== STATE_FILE && !ALLOWED_PREFIXES.some(prefix => value.startsWith(prefix))) {
    throw new Error('W09 owner state branch contains a path outside the closed publication whitelist');
  }
}

function assertWithinRoot(root, absolute) {
  const relative = path.relative(root, absolute);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('W09 owner state checkout path escapes the repository root');
  }
}

async function assertNoSymlinkParents(root, absolute) {
  let current = root;
  const relative = path.relative(root, path.dirname(absolute));
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('W09 owner state checkout path may not traverse symlinks'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try { if ((await lstat(absolute)).isSymbolicLink()) throw new Error('W09 owner state checkout path may not replace a symlink'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function comparePath(left, right) { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }

function runGit(root, args, { env, encoding }) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding, env, maxBuffer: GIT_OUTPUT_LIMIT, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('W09 owner state Git command failed: ' + String(args[0] ?? 'unknown'));
  }
}
