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

const OFFICIAL_ORIGIN = 'https://github.com/SyuanTsai/DarkTide-Web.git';
const SOURCE_REVISION = 'a'.repeat(64);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', root, ...args], { encoding, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

function commitAll(root, message) {
  git(root, ['add', '--all']);
  git(root, ['commit', '-m', message]);
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
    const proposalHash = createHash('sha256').update(releaseId).digest('hex');
    const proposalDirectory = path.join(repoRoot, 'content/contracts/w09/proposals', proposalHash);
    await mkdir(proposalDirectory, { recursive: true });
    const proposal = {
      schema: 'w09-source-composition-proposal/1',
      selected: false,
      allocationReserved: false,
      publicationEligible: false,
      sourceRevision: SOURCE_REVISION,
      releaseId,
      gameReleaseId: 'darktide:' + releaseId.slice(-1),
      archiveSha256: 'b'.repeat(64),
    };
    const proposalPath = path.join(proposalDirectory, 'proposal.json');
    try {
      await writeFile(proposalPath, JSON.stringify(proposal) + '\n', { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readFile(proposalPath, 'utf8');
      if (existing !== JSON.stringify(proposal) + '\n') throw new Error('candidate proposal mismatch: existing=' + existing + ' expected=' + (JSON.stringify(proposal) + '\n'));
    }
    return { proposalWritten: true, sourceRevision: SOURCE_REVISION, releaseId, proposalDirectory };
  };
}

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
  const firstId = 'w09-' + '1'.repeat(32);
  const secondId = 'w09-' + '2'.repeat(32);
  const thirdId = 'w09-' + '3'.repeat(32);
  const first = await runW09CandidateHandoff({ ...baseOptions, releaseId: firstId });
  assert.equal(first.status, 'candidate');
  assert.equal(first.proposalWritten, true);
  assert.equal(first.branch, 'codex/syp-341-w09-' + SOURCE_REVISION);
  assert.equal(first.pullRequest.number, 41);
  assert.equal(String(git(repoRoot, ['config', '--get', 'user.name'])).trim(), originalUserName, 'candidate commit identity must not alter shared repository config');
  assert.ok(String(git(repoRoot, ['worktree', 'list', '--porcelain'])).includes(path.basename(unrelatedWorktree)), 'candidate cleanup must preserve unrelated worktree registrations');

  const firstRemoteCommit = git(repoRoot, ['ls-remote', '--heads', 'origin', 'refs/heads/' + first.branch]).trim().split(/\s+/u)[0];
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
  git(secondRunner, ['config', 'user.name', 'W09 independent runner']);
  git(secondRunner, ['config', 'user.email', 'w09-runner-two@example.invalid']);
  const second = await runW09CandidateHandoff({ ...baseOptions, repoRoot: secondRunner, sourceRoot: secondRunner, releaseId: secondId });
  assert.equal(second.status, 'candidate');
  assert.equal(second.branch, first.branch, 'different game releases from the same Source revision share one candidate branch');
  assert.equal(prCalls.length, 3);
  assert.equal(prCalls[0].sourceRevision, prCalls[1].sourceRevision);
  assert.equal(prCalls[0].proposals[0].request.releaseId, firstId);
  assert.equal(prCalls[1].proposals[0].request.releaseId, firstId);
  assert.equal(prCalls[2].proposals[0].request.releaseId, secondId);

  git(secondRunner, ['fetch', 'origin', 'refs/heads/' + second.branch + ':refs/remotes/origin/' + second.branch]);
  const secondBranchCommit = String(git(secondRunner, ['rev-parse', 'refs/remotes/origin/' + second.branch])).trim();
  const secondProposalRelative = second.proposalPath + '/proposal.json';
  assert.ok(git(secondRunner, ['show', secondBranchCommit + ':' + first.proposalPath + '/proposal.json']).includes(firstId));
  assert.ok(git(secondRunner, ['show', secondBranchCommit + ':' + secondProposalRelative]).includes(secondId));
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
  assert.match(conflict.reason, /conflicts with latest main/u);
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
  assert.equal(job.concurrency.group, 'darktide-w09-candidate-proposals');
  assert.equal(job.concurrency['cancel-in-progress'], false);
  assert.equal(job.environment, undefined, 'candidate preparation must not use production environment credentials');

  const steps = job.steps;
  const checkouts = steps.filter(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkouts.length, 4, 'the two original checkouts plus two conditional pinned source inputs are expected');
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

  const detector = steps.find(step => step.name === 'Detect fixed retained-name inputs');
  assert.ok(detector);
  assert.equal(detector.id, 'retained-names');
  assert.equal(detector.run, 'node scripts/content/retained-name-overlay-scan.mjs --repo-root "$GITHUB_WORKSPACE"');
  assert.ok(steps.indexOf(detector) < steps.indexOf(historySource));

  const retainedMods = steps.find(step => step.name === 'Check out the pinned public Mods identity map for retained weapon names');
  assert.ok(retainedMods);
  assert.equal(retainedMods.if, "steps.retained-names.outputs.required == 'true'");
  assert.equal(retainedMods.with.repository, 'SyuanTsai/Warhammer-40-000-DARKTIDE-Mods');
  assert.equal(retainedMods.with.ref, '241ad76ce62330472aa423055a5b85db59bb6c0d');
  assert.equal(retainedMods.with.path, 'retained-name-mods');
  assert.equal(retainedMods.with['fetch-depth'], 1);
  assert.equal(retainedMods.with['persist-credentials'], false);
  assert.match(retainedMods.with['sparse-checkout'], /Game Info\/releases\/1\.13\.X\/blessings\/data/u);

  const retainedSource = steps.find(step => step.name === 'Check out pinned public 1.13.4 weapon templates');
  assert.ok(retainedSource);
  assert.equal(retainedSource.if, "steps.retained-names.outputs.required == 'true'");
  assert.equal(retainedSource.with.repository, 'Aussiemon/Darktide-Source-Code');
  assert.equal(retainedSource.with.ref, 'e46b8926cfa3fa35503e4b80b15aab7a804314e4');
  assert.equal(retainedSource.with.path, 'retained-name-source');
  assert.equal(retainedSource.with['fetch-depth'], 1);
  assert.equal(retainedSource.with['persist-credentials'], false);
  assert.match(retainedSource.with['sparse-checkout'], /scripts\/settings\/equipment\/weapon_templates/u);
  assert.ok(steps.indexOf(retainedMods) < steps.indexOf(retainedSource));

  const run = job.steps.find(step => step.name === 'Prepare or update the revision-scoped candidate PR');
  assert.equal(run.run, 'node scripts/prepare-w09-candidate.mjs');
  assert.equal(run.env.W09_RELEASE_ID, '$' + '{{ github.event.client_payload.release_id || inputs.release_id }}');
  assert.equal(run.env.GH_TOKEN, '$' + '{{ github.token }}');
  assert.equal(run.env.W09_GIT_TOKEN, '$' + '{{ github.token }}');
  assert.equal(run.env.SYP_W07_RETAINED_MODS_ROOT, '$' + "{{ steps.retained-names.outputs.required == 'true' && format('{0}/retained-name-mods', github.workspace) || '' }}");
  assert.equal(run.env.SYP_W07_RETAINED_SOURCE_ROOT, '$' + "{{ steps.retained-names.outputs.required == 'true' && format('{0}/retained-name-source', github.workspace) || '' }}");
  assert.ok(!steps.some(step => /deploy|publish|select|allocate/u.test([step.name, step.run].filter(Boolean).join(' '))),
    'candidate dispatch must not add a production publish, selection, or allocation route');
});
