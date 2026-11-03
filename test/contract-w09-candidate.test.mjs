import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import { runW09CandidateHandoff } from '../scripts/prepare-w09-candidate.mjs';
import { earlierActiveRunIds, waitForEarlierCandidateRuns } from '../scripts/wait-for-earlier-candidate-runs.mjs';

const OFFICIAL_ORIGIN = 'https://github.com/SyuanTsai/DarkTide-Web.git';
const SOURCE_REVISION = 'a'.repeat(64);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKET_PATHS = [
  'analysis.md', 'source-revision.json', 'source-revision.md', 'source-manifest.json', 'source-receipt.json', 'technical.json',
];
const GAME_RELEASE_IDS = ['darktide:fixture-1', 'darktide:fixture-2', 'darktide:fixture-3'];
const RELEASE_IDS = GAME_RELEASE_IDS.map(gameReleaseId => 'w09-' + createHash('sha256')
  .update(JSON.stringify({ gameReleaseId, sourceRevision: SOURCE_REVISION }))
  .digest('hex')
  .slice(0, 32));
const GAME_RELEASE_BY_ID = new Map(RELEASE_IDS.map((releaseId, index) => [releaseId, GAME_RELEASE_IDS[index]]));

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', root, ...args], { encoding, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

function commitAll(root, message) {
  git(root, ['add', '--all']);
  git(root, ['-c', 'user.name=W09 candidate fixture', '-c', 'user.email=w09-candidate@example.invalid', 'commit', '-m', message]);
}

// Runs the handoff the way a CI runner does: no global, system, or repository Git identity.
async function withoutGitIdentity(tempRoot, run) {
  const emptyConfig = path.join(tempRoot, 'empty-gitconfig');
  await writeFile(emptyConfig, '', { flag: 'w' });
  const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = emptyConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function fixtureGit(t) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'w09-candidate-flow-'));
  const repoRoot = path.join(tempRoot, 'web');
  const bareRoot = path.join(tempRoot, 'remote.git');
  await mkdir(repoRoot, { recursive: true });
  git(tempRoot, ['init', '--bare', '--initial-branch=main', bareRoot]);
  git(tempRoot, ['init', '--initial-branch=main', repoRoot]);
  git(repoRoot, ['config', 'user.name', 'W09 candidate fixture']);
  git(repoRoot, ['config', 'user.email', 'w09-candidate@example.invalid']);
  await writeFile(path.join(repoRoot, '.gitattributes'), '/content/contracts/** text eol=lf\n', 'utf8');
  await writeFile(path.join(repoRoot, 'README.md'), 'base main\n', 'utf8');
  commitAll(repoRoot, 'fixture Web main');
  git(repoRoot, ['remote', 'add', 'origin', OFFICIAL_ORIGIN]);
  const configCount = Number(process.env.GIT_CONFIG_COUNT ?? '0');
  const oldCount = process.env.GIT_CONFIG_COUNT;
  const oldKey = process.env['GIT_CONFIG_KEY_' + configCount];
  const oldValue = process.env['GIT_CONFIG_VALUE_' + configCount];
  process.env.GIT_CONFIG_COUNT = String(configCount + 1);
  process.env['GIT_CONFIG_KEY_' + configCount] = 'url.' + pathToFileURL(bareRoot).href + '.insteadOf';
  process.env['GIT_CONFIG_VALUE_' + configCount] = OFFICIAL_ORIGIN;
  git(repoRoot, ['push', '--set-upstream', 'origin', 'main']);
  const unrelatedWorktree = path.join(tempRoot, 'unrelated-checkout');
  git(repoRoot, ['worktree', 'add', '--detach', unrelatedWorktree, 'main']);
  t.after(async () => {
    if (oldCount === undefined) delete process.env.GIT_CONFIG_COUNT;
    else process.env.GIT_CONFIG_COUNT = oldCount;
    if (oldKey === undefined) delete process.env['GIT_CONFIG_KEY_' + configCount];
    else process.env['GIT_CONFIG_KEY_' + configCount] = oldKey;
    if (oldValue === undefined) delete process.env['GIT_CONFIG_VALUE_' + configCount];
    else process.env['GIT_CONFIG_VALUE_' + configCount] = oldValue;
    await rm(tempRoot, { recursive: true, force: true });
  });
  return { tempRoot, repoRoot, bareRoot, unrelatedWorktree };
}

function createProposalWriter() {
  return async ({ repoRoot, releaseId }) => {
    const gameReleaseId = GAME_RELEASE_BY_ID.get(releaseId);
    if (!gameReleaseId) throw new Error('fixture received an unknown releaseId');
    const proposalHash = createHash('sha256').update(releaseId).digest('hex');
    const proposalDirectory = path.join(repoRoot, 'content/contracts/w09/proposals', proposalHash);
    await mkdir(proposalDirectory, { recursive: true });
    const proposal = {
      schema: 'w09-source-composition-proposal/1',
      proposalOnly: true,
      selected: false,
      allocationReserved: false,
      publicationEligible: false,
      requestId: '1'.repeat(64),
      sourceRevision: SOURCE_REVISION,
      releaseId,
      gameReleaseId,
      sourceCommit: '2'.repeat(40),
      manifestSha256: '3'.repeat(64),
      archiveSha256: 'b'.repeat(64),
      packetFiles: PACKET_PATHS.map((packetPath, index) => ({
        path: packetPath,
        sha256: '456789'[index].repeat(64),
        sizeBytes: index + 1,
      })),
    };
    const files = new Map([
      ['proposal.json', JSON.stringify(proposal) + '\n'],
      ['source-lock.json', '{"source":true}\n'],
      ['web-input-lock.json', '{"web":true}\n'],
      ['review-candidate.json', '{"review":true}\n'],
    ]);
    for (const [name, bytes] of files) {
      const filePath = path.join(proposalDirectory, name);
      try {
        await writeFile(filePath, bytes, { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        assert.equal(await readFile(filePath, 'utf8'), bytes);
      }
    }
    return { proposalWritten: true, sourceRevision: SOURCE_REVISION, releaseId, proposalDirectory };
  };
}

// Scenario: Candidate retries, a second Source release, a human review note, a main update, and a merge conflict share one revision branch.
// Purpose: Preserve branch history while committing only proposal manifests and leaving conflicting remote state untouched.
test('InterT28_revision-scoped-candidate-handoff-preserves-branch-history-merges-main-and-leaves-conflicts-pending', async t => {
  const { tempRoot, repoRoot, bareRoot, unrelatedWorktree } = await fixtureGit(t);
  const prepareProposal = createProposalWriter();
  const prCalls = [];
  const ensurePullRequest = async input => {
    prCalls.push(input);
    return { created: prCalls.length === 1, updated: prCalls.length > 1, number: 41, url: 'https://github.com/SyuanTsai/DarkTide-Web/pull/41' };
  };
  const baseOptions = { repoRoot, sourceRoot: repoRoot, prepareProposal, ensurePullRequest, runGh: async () => '' };
  const originalUserName = String(git(repoRoot, ['config', '--get', 'user.name'])).trim();
  const [firstId, secondId, thirdId] = RELEASE_IDS;
  const first = await runW09CandidateHandoff({ ...baseOptions, releaseId: firstId });
  assert.equal(first.status, 'candidate');
  assert.equal(first.proposalWritten, true);
  assert.equal(first.branch, 'codex/syp-341-w09-' + SOURCE_REVISION);
  assert.equal(first.pullRequest.number, 41);
  assert.equal(String(git(repoRoot, ['config', '--get', 'user.name'])).trim(), originalUserName, 'candidate commit identity must not alter shared repository config');
  assert.ok(String(git(repoRoot, ['worktree', 'list', '--porcelain'])).includes(path.basename(unrelatedWorktree)), 'candidate cleanup must preserve unrelated worktree registrations');

  const firstRemoteCommit = git(repoRoot, ['ls-remote', '--heads', 'origin', 'refs/heads/' + first.branch]).trim().split(/\s+/u)[0];
  assert.deepEqual(
    String(git(repoRoot, ['ls-tree', '-r', '--name-only', firstRemoteCommit, '--', first.proposalPath])).trim().split(/\r?\n/u),
    [first.proposalPath + '/manifest.json'],
    'the candidate commit must retain only the small proposal manifest',
  );
  const sameRunnerRetry = await runW09CandidateHandoff({ ...baseOptions, releaseId: firstId });
  const retriedRemoteCommit = git(repoRoot, ['ls-remote', '--heads', 'origin', 'refs/heads/' + first.branch]).trim().split(/\s+/u)[0];
  assert.equal(sameRunnerRetry.status, 'candidate');
  assert.equal(sameRunnerRetry.branch, first.branch);
  assert.equal(retriedRemoteCommit, firstRemoteCommit, 'same-runner retry must reuse the existing candidate commit');

  git(repoRoot, ['fetch', 'origin', 'refs/heads/' + first.branch + ':refs/remotes/origin/' + first.branch]);
  git(repoRoot, ['switch', '--create', 'fixture-human-edit', 'refs/remotes/origin/' + first.branch]);
  const firstProposalDirectory = path.join(repoRoot, ...first.proposalPath.split('/'));
  await writeFile(path.join(firstProposalDirectory, 'review-note.md'), 'Human-reviewed proposal note.\n', { flag: 'wx' });
  commitAll(repoRoot, 'fixture human proposal note');
  git(repoRoot, ['push', 'origin', 'HEAD:refs/heads/' + first.branch]);
  git(repoRoot, ['switch', 'main']);
  git(repoRoot, ['branch', '--delete', 'fixture-human-edit']);

  await writeFile(path.join(repoRoot, 'main-update.txt'), 'latest reviewed Web main\n', { flag: 'wx' });
  commitAll(repoRoot, 'fixture concurrent main update');
  git(repoRoot, ['push', 'origin', 'main']);

  const secondRunner = path.join(tempRoot, 'web-runner-2');
  git(tempRoot, ['clone', OFFICIAL_ORIGIN, secondRunner]);
  assert.throws(() => git(secondRunner, ['config', '--local', '--get', 'user.name']), 'the second runner has no repository identity, like CI');
  const second = await withoutGitIdentity(tempRoot,
    () => runW09CandidateHandoff({ ...baseOptions, repoRoot: secondRunner, sourceRoot: secondRunner, releaseId: secondId }));
  assert.equal(second.status, 'candidate');
  assert.equal(second.branch, first.branch, 'different game releases from the same Source revision share one candidate branch');
  assert.equal(prCalls.length, 3);
  assert.equal(prCalls[0].sourceRevision, prCalls[1].sourceRevision);
  assert.equal(prCalls[0].proposals[0].request.releaseId, firstId);
  assert.equal(prCalls[1].proposals[0].request.releaseId, firstId);
  assert.equal(prCalls[2].proposals[0].request.releaseId, secondId);

  git(secondRunner, ['fetch', 'origin', 'refs/heads/' + second.branch + ':refs/remotes/origin/' + second.branch]);
  const secondBranchCommit = String(git(secondRunner, ['rev-parse', 'refs/remotes/origin/' + second.branch])).trim();
  const secondProposalRelative = second.proposalPath + '/manifest.json';
  assert.ok(git(secondRunner, ['show', secondBranchCommit + ':' + first.proposalPath + '/manifest.json']).includes(firstId));
  assert.ok(git(secondRunner, ['show', secondBranchCommit + ':' + secondProposalRelative]).includes(secondId));
  assert.throws(() => git(secondRunner, ['show', secondBranchCommit + ':' + second.proposalPath + '/proposal.json']),
    'generated proposal bytes must remain reconstructible but untracked');
  assert.ok(git(secondRunner, ['show', secondBranchCommit + ':' + first.proposalPath + '/review-note.md']).includes('Human-reviewed'));
  assert.ok(git(secondRunner, ['show', secondBranchCommit + ':main-update.txt']).includes('latest reviewed Web main'));
  assert.throws(() => git(secondRunner, ['show', secondBranchCommit + ':content/contracts/w09/source-handoff/selected.json']),
    'candidate-only branch must not create a selected authority marker');

  git(secondRunner, ['switch', '--create', 'fixture-human-conflict', 'refs/remotes/origin/' + second.branch]);
  await writeFile(path.join(secondRunner, 'README.md'), 'human branch version\n', 'utf8');
  commitAll(secondRunner, 'fixture human branch edit');
  git(secondRunner, ['push', 'origin', 'HEAD:refs/heads/' + second.branch]);
  git(secondRunner, ['switch', 'main']);
  await writeFile(path.join(secondRunner, 'README.md'), 'main version\n', 'utf8');
  commitAll(secondRunner, 'fixture conflicting main edit');
  git(secondRunner, ['push', 'origin', 'main']);
  const branchBeforeConflict = git(secondRunner, ['ls-remote', '--heads', 'origin', 'refs/heads/' + second.branch]).trim().split(/\s+/u)[0];
  const prCallsBeforeConflict = prCalls.length;
  const conflict = await runW09CandidateHandoff({ ...baseOptions, repoRoot: secondRunner, sourceRoot: secondRunner, releaseId: thirdId });
  assert.equal(conflict.status, 'pending');
  assert.match(conflict.reason, /could not merge latest main.*(?:conflict|CONFLICT)/su);
  assert.equal(conflict.proposalWritten, false);
  assert.equal(prCalls.length, prCallsBeforeConflict, 'a conflicted branch does not edit or reopen its PR');
  const branchAfterConflict = git(secondRunner, ['ls-remote', '--heads', 'origin', 'refs/heads/' + second.branch]).trim().split(/\s+/u)[0];
  assert.equal(branchAfterConflict, branchBeforeConflict, 'a conflict must leave the prior proposal branch unchanged');
  assert.equal(git(bareRoot, ['symbolic-ref', 'HEAD']).trim(), 'refs/heads/main');
});

test('InterT29_candidate-workflow-is-a-serialized-unselected-repository-dispatch-route', async () => {
  const workflow = parseYaml(await readFile(path.join(REPO_ROOT, '.github/workflows/shared-candidate.yml'), 'utf8'));
  assert.deepEqual(workflow.on.repository_dispatch.types, ['w09-source-release']);
  assert.equal(workflow.on.workflow_dispatch.inputs.release_id.required, true);
  assert.equal(workflow.permissions.contents, 'write');
  assert.equal(workflow.permissions['pull-requests'], 'write');
  const job = workflow.jobs['proposal-candidate'];
  assert.match(job.if, /github\.repository == 'SyuanTsai\/DarkTide-Web'/u);
  assert.match(job.if, /github\.event_name == 'repository_dispatch' && github\.event\.action == 'w09-source-release'/u);
  assert.match(job.if, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/u);
  assert.equal(job.concurrency, undefined, 'a concurrency group keeps one pending run and cancels the other dispatched releases');
  assert.equal(workflow.permissions.actions, 'read');
  const queueWait = job.steps.find(step => step.name === 'Wait for earlier candidate runs to finish');
  assert.equal(queueWait?.run, 'node scripts/wait-for-earlier-candidate-runs.mjs');
  assert.ok(job.steps.indexOf(queueWait) < job.steps.findIndex(step => step.name === 'Prepare or update the revision-scoped candidate PR'),
    'runs are serialized before any candidate branch or PR work');
  assert.equal(job.environment, undefined, 'candidate preparation must not use production environment credentials');

  const steps = job.steps;
  const checkouts = steps.filter(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkouts.length, 2, 'the current Web and Source history checkouts; retained-name inputs come from the shared composite action');
  const currentWeb = steps.find(step => step.name === 'Check out current Web main without persisted credentials');
  assert.ok(currentWeb);
  assert.equal(currentWeb.uses, 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803');
  assert.equal(currentWeb.with.ref, 'main');
  assert.equal(currentWeb.with['fetch-depth'], 0);
  assert.equal(currentWeb.with['persist-credentials'], false);

  const historySource = steps.find(step => step.name === 'Check out public Source history for fixed-commit replay');
  assert.ok(historySource);
  assert.equal(historySource.uses, 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803');
  assert.equal(historySource.with.repository, 'SyuanTsai/DarkTide-Source-Data');
  assert.equal(historySource.with.ref, 'main');
  assert.equal(historySource.with.path, 'source');
  assert.equal(historySource.with['fetch-depth'], 0);
  assert.equal(historySource.with['persist-credentials'], false);

  const retainedInputs = steps.find(step => step.uses === './.github/actions/retained-name-inputs');
  assert.ok(retainedInputs, 'candidate preparation must use the shared retained-name inputs action');
  assert.equal(retainedInputs.id, 'retained-name-inputs');
  assert.equal(retainedInputs.if, undefined);
  assert.ok(steps.indexOf(retainedInputs) < steps.indexOf(historySource));

  const run = job.steps.find(step => step.name === 'Prepare or update the revision-scoped candidate PR');
  const entry = await readFile(path.join(REPO_ROOT, 'scripts/prepare-w09-candidate.mjs'), 'utf8');
  assert.match(entry, /createW09SourceFetch\(\{ token: process\.env\.W09_GIT_TOKEN \}\)/u,
    'candidate Source release lookups use the workflow token like promotion does');
  assert.match(entry, /runW09CandidateHandoff\(\{ repoRoot, sourceRoot, releaseId, fetchImpl \}\)/u);
  assert.equal(run.run, 'node scripts/prepare-w09-candidate.mjs');
  assert.equal(run.env.W09_RELEASE_ID, '$' + '{{ github.event.client_payload.release_id || inputs.release_id }}');
  assert.equal(run.env.GH_TOKEN, '$' + '{{ github.token }}');
  assert.equal(run.env.W09_GIT_TOKEN, '$' + '{{ github.token }}');
  assert.equal(run.env.SYP_W07_RETAINED_MODS_ROOT, '$' + '{{ steps.retained-name-inputs.outputs.mods-root }}');
  assert.equal(run.env.SYP_W07_RETAINED_SOURCE_ROOT, '$' + '{{ steps.retained-name-inputs.outputs.source-root }}');
  assert.ok(!steps.some(step => /deploy|publish|select|allocate/u.test([step.name, step.run].filter(Boolean).join(' '))),
    'candidate dispatch must not add a production publish, selection, or allocation route');
});

// Scenario: One Source handoff dispatches several release IDs at once.
// Purpose: Serialize candidate runs by run ID instead of a concurrency group that cancels queued dispatches.
test('UnitT30_candidate-runs-wait-only-for-earlier-active-runs-of-the-same-workflow', async () => {
  const runs = [
    { id: 10, status: 'completed' }, { id: 11, status: 'in_progress' }, { id: 12, status: 'queued' },
    { id: 13, status: 'in_progress' }, { id: 14, status: 'queued' },
  ];
  assert.deepEqual(earlierActiveRunIds(runs, 13), [11, 12]);
  assert.deepEqual(earlierActiveRunIds(runs, 11), []);

  let polls = 0;
  const fetchImpl = async url => {
    const status = new URL(url).searchParams.get('status');
    const active = polls < 6 ? [{ id: 5, status: 'in_progress' }] : [];
    if (status === 'in_progress') polls += 1;
    return { ok: true, json: async () => ({ workflow_runs: active.filter(run => run.status === status) }) };
  };
  const logs = [];
  const result = await waitForEarlierCandidateRuns({
    repository: 'SyuanTsai/DarkTide-Web', token: 't', ownRunId: 9, fetchImpl, sleep: async () => {}, log: line => logs.push(line),
  });
  assert.deepEqual(result, { waited: true });
  assert.ok(logs.length >= 1 && logs.every(line => line.includes('5')));

  let clock = 0;
  await assert.rejects(waitForEarlierCandidateRuns({
    repository: 'SyuanTsai/DarkTide-Web', token: 't', ownRunId: 9,
    fetchImpl: async url => ({ ok: true, json: async () => ({ workflow_runs: new URL(url).searchParams.get('status') === 'queued' ? [{ id: 7, status: 'queued' }] : [] }) }),
    sleep: async () => { clock += 60_000; }, now: () => clock, maxWaitMs: 120_000, log: () => {},
  }), /still active: 7/u);
});
