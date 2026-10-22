import { execFileSync } from 'node:child_process';
import { lstat, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveW09CandidateBranch,
  ensureW09CandidatePullRequest,
  prepareW09SourceProposal,
} from './content/contract-w09-compose.mjs';

const GIT_MAX_BUFFER = 256 * 1024 * 1024;
const PROPOSAL_ROOT = 'content/contracts/w09/proposals/';
const OFFICIAL_ORIGIN = /^https:\/\/github\.com\/SyuanTsai\/DarkTide-Web(?:\.git)?\/?$/u;
const RELEASE_ID = /^w09-[a-f0-9]{32}$/u;
const SOURCE_REVISION = /^[a-f0-9]{64}$/u;

function gitEnv(token) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
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

function git(root, args, { token = '', encoding = 'utf8' } = {}) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding,
      env: gitEnv(token),
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const operation = String(args[0] ?? 'unknown');
    let detail = error?.stderr ? Buffer.from(error.stderr).toString('utf8').trim() : '';
    if (token) detail = detail.split(token).join('[redacted]');
    detail = detail.replace(/(authorization\s*:\s*basic\s+)\S+/giu, '$1[redacted]')
      .replace(/https?:\/\/[^\s]+\?[^\s]+/giu, '[redacted-url]')
      .slice(0, 240);
    throw new Error('W09 candidate Git ' + operation + ' failed' + (detail ? ': ' + detail : ''));
  }
}

function cleanGhToken(token) {
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  delete env.W09_GIT_TOKEN;
  delete env.GH_TOKEN;
  if (typeof token === 'string' && token.trim()) env.GH_TOKEN = token;
  return env;
}

function ghRunner(token) {
  return async args => {
    try {
      return execFileSync('gh', args, {
        encoding: 'utf8',
        env: cleanGhToken(token),
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      let detail = error?.stderr ? Buffer.from(error.stderr).toString('utf8').trim() : '';
      if (token) detail = detail.split(token).join('[redacted]');
      detail = detail.replace(/(authorization\s*:\s*bearer\s+)\S+/giu, '$1[redacted]').slice(0, 400);
      throw new Error('gh ' + args.slice(0, 2).join(' ') + ' failed' + (detail ? ': ' + detail : ''));
    }
  };
}

function parseRemoteHead(output, expectedRef) {
  const rows = String(output).trim() ? String(output).trim().split(/\r?\n/u) : [];
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error('W09 candidate branch lookup returned duplicate refs');
  const match = /^([a-f0-9]{40}|[a-f0-9]{64})\s+([^\s]+)$/u.exec(rows[0]);
  if (!match || match[2] !== expectedRef) throw new Error('W09 candidate branch lookup returned a malformed ref');
  return match[1];
}

async function readProposal(root, proposalDirectory, expectedRevision, expectedReleaseId) {
  const absolute = path.resolve(proposalDirectory);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (!relative.startsWith(PROPOSAL_ROOT) || !/^[a-f0-9]{64}$/u.test(relative.slice(PROPOSAL_ROOT.length))) {
    throw new Error('W09 proposal writer returned a path outside the immutable proposal namespace');
  }
  const info = await lstat(absolute);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('W09 proposal directory must be a regular directory');
  const proposal = JSON.parse(await readFile(path.join(absolute, 'proposal.json'), 'utf8'));
  if (proposal.schema !== 'w09-source-composition-proposal/1' || proposal.selected !== false
      || proposal.allocationReserved !== false || proposal.publicationEligible !== false
      || proposal.sourceRevision !== expectedRevision || proposal.releaseId !== expectedReleaseId) {
    throw new Error('W09 proposal metadata does not match its verified Source release event');
  }
  return { proposal, relative };
}

async function cleanupWorktree(repoRoot, worktreePath, token) {
  if (!worktreePath) return;
  try { git(repoRoot, ['worktree', 'remove', '--force', worktreePath], { token }); } catch { /* filesystem cleanup below is best-effort */ }
  await rm(worktreePath, { recursive: true, force: true });
}

/**
 * Resolve a release_id-only Source event into an immutable proposal on a revision-scoped
 * candidate branch. Existing branch ancestry is retained and main is merged normally.
 */
export async function runW09CandidateHandoff({
  repoRoot,
  sourceRoot,
  releaseId,
  fetchImpl = globalThis.fetch,
  gitToken = process.env.W09_GIT_TOKEN ?? process.env.GITHUB_TOKEN ?? '',
  ghToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '',
  prepareProposal = prepareW09SourceProposal,
  ensurePullRequest = ensureW09CandidatePullRequest,
  runGh = ghRunner(ghToken),
  tempRoot = os.tmpdir(),
} = {}) {
  if (typeof repoRoot !== 'string' || typeof sourceRoot !== 'string') throw new TypeError('repoRoot and sourceRoot are required');
  if (typeof releaseId !== 'string' || !RELEASE_ID.test(releaseId)) throw new TypeError('release_id must be a derived W09 Source identity');
  if (typeof prepareProposal !== 'function' || typeof ensurePullRequest !== 'function' || typeof runGh !== 'function') {
    throw new TypeError('W09 proposal and PR handlers must be functions');
  }
  const root = path.resolve(repoRoot);
  const source = path.resolve(sourceRoot);
  const origin = String(git(root, ['config', '--get', 'remote.origin.url'])).trim();
  if (!OFFICIAL_ORIGIN.test(origin)) throw new Error('W09 candidate handoff requires the official DarkTide-Web HTTPS origin');
  git(root, ['fetch', '--no-tags', 'origin', 'main'], { token: gitToken });
  const latestMain = String(git(root, ['rev-parse', 'FETCH_HEAD'])).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(latestMain)) throw new Error('W09 candidate handoff did not resolve a full main commit');

  let probePath;
  let candidatePath;
  try {
    probePath = await mkdtemp(path.join(tempRoot, 'w09-source-probe-'));
    await rm(probePath, { recursive: true, force: true });
    git(root, ['worktree', 'add', '--detach', probePath, latestMain], { token: gitToken });
    const probe = await prepareProposal({ repoRoot: probePath, sourceRoot: source, releaseId, fetchImpl });
    if (!probe?.proposalWritten) return { status: 'pending', releaseId, reason: probe?.reason ?? 'verified Source event did not produce a proposal', proposalWritten: false };
    if (typeof probe.sourceRevision !== 'string' || !SOURCE_REVISION.test(probe.sourceRevision)) {
      throw new Error('W09 Source resolver did not return a full sourceRevision');
    }
    const branch = deriveW09CandidateBranch(probe.sourceRevision);
    const branchRef = 'refs/heads/' + branch;
    const remoteCommit = parseRemoteHead(git(root, ['ls-remote', '--heads', 'origin', branchRef], { token: gitToken }), branchRef);
    if (remoteCommit) {
      git(root, ['fetch', '--no-tags', 'origin', branchRef + ':refs/remotes/origin/' + branch], { token: gitToken });
      const fetchedCommit = String(git(root, ['rev-parse', 'refs/remotes/origin/' + branch])).trim();
      if (fetchedCommit !== remoteCommit) throw new Error('W09 candidate branch changed during fetch');
    }
    await cleanupWorktree(root, probePath, gitToken);
    probePath = null;

    candidatePath = await mkdtemp(path.join(tempRoot, 'w09-candidate-'));
    await rm(candidatePath, { recursive: true, force: true });
    const branchBase = remoteCommit ?? latestMain;
    git(root, ['worktree', 'add', '--detach', candidatePath, branchBase], { token: gitToken });
    try {
      git(candidatePath, ['merge', '--no-edit', latestMain], { token: gitToken });
    } catch {
      return {
        status: 'pending', releaseId, sourceRevision: probe.sourceRevision, branch,
        reason: 'candidate branch conflicts with latest main; existing branch and PR were left unchanged',
        proposalWritten: false,
      };
    }

    const proposalResult = await prepareProposal({ repoRoot: candidatePath, sourceRoot: source, releaseId, fetchImpl });
    if (!proposalResult?.proposalWritten || proposalResult.sourceRevision !== probe.sourceRevision) {
      return {
        status: 'pending', releaseId, sourceRevision: probe.sourceRevision, branch,
        reason: proposalResult?.reason ?? 'Source revision changed while merging latest main',
        proposalWritten: Boolean(proposalResult?.proposalWritten),
      };
    }
    const { proposal, relative: proposalRelative } = await readProposal(candidatePath, proposalResult.proposalDirectory, probe.sourceRevision, releaseId);
    git(candidatePath, ['add', '--', proposalRelative], { token: gitToken });
    const staged = String(git(candidatePath, ['diff', '--cached', '--name-only', '-z'], { token: gitToken })).split('\0').filter(Boolean);
    if (staged.some(file => file !== proposalRelative && !file.startsWith(proposalRelative + '/'))) {
      throw new Error('W09 candidate commit attempted to include a path outside its immutable proposal directory');
    }
    if (staged.length > 0) git(candidatePath, ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', 'SYP-341', '-m', 'feat: add an immutable W09 Source proposal candidate', '-m', 'zh-TW:\n新增：W09 Source 不可變提案候選資料'], { token: gitToken });
    const currentBranch = String(git(candidatePath, ['branch', '--show-current'])).trim();
    if (currentBranch !== '') throw new Error('W09 candidate worktree must remain detached until its non-force push');
    const currentCommit = String(git(candidatePath, ['rev-parse', 'HEAD'])).trim();
    if (remoteCommit && currentCommit === remoteCommit) {
      // Same source request and same Web inputs already exist on this branch.
    } else {
      try {
        git(candidatePath, ['push', 'origin', 'HEAD:' + branchRef], { token: gitToken });
      } catch {
        return {
          status: 'pending', releaseId, sourceRevision: probe.sourceRevision, branch,
          reason: 'candidate branch push was rejected; no force update was attempted and a retry can reuse the existing branch',
          proposalWritten: true,
        };
      }
    }
    let pullRequest;
    try {
      pullRequest = await ensurePullRequest({
        sourceRevision: probe.sourceRevision,
        proposals: [{ request: proposal, archiveSha256: proposal.archiveSha256 }],
        runGh,
      });
    } catch (error) {
      const detail = String(error?.message ?? error).replace(/https?:\/\/[^\s]+\?[^\s]+/giu, '[redacted-url]').slice(0, 400);
      return {
        status: 'pending', releaseId, sourceRevision: probe.sourceRevision, branch,
        reason: 'proposal branch is preserved but PR creation or update is pending: ' + detail,
        proposalWritten: true,
      };
    }
    return {
      status: 'candidate', releaseId, sourceRevision: probe.sourceRevision, branch,
      proposalPath: proposalRelative, proposalWritten: true,
      pullRequest,
    };
  } finally {
    await cleanupWorktree(root, probePath, gitToken);
    await cleanupWorktree(root, candidatePath, gitToken);
  }
}

async function main() {
  const repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const sourceRoot = process.env.W09_SOURCE_ROOT ?? path.join(repoRoot, 'source');
  const releaseId = process.env.W09_RELEASE_ID;
  if (!releaseId) throw new Error('W09_RELEASE_ID must contain the release_id-only event value');
  const result = await runW09CandidateHandoff({ repoRoot, sourceRoot, releaseId });
  const summary = result.status === 'candidate'
    ? 'W09 proposal branch ' + result.branch + ' now carries ' + result.releaseId + ' under one Source revision; PR ' + result.pullRequest.url + '. This is an unselected review candidate with no content allocation or deployment.\n'
    : 'W09 candidate handoff remains pending for ' + result.releaseId + ': ' + result.reason + '\n';
  if (process.env.GITHUB_STEP_SUMMARY) await import('node:fs/promises').then(({ appendFile }) => appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8'));
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write('W09 candidate handoff failed: ' + String(error?.message ?? error).slice(0, 500) + '\n');
    process.exitCode = 1;
  });
}
