import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createW09StateBranchStore, readW09OwnerStateBranch } from '../scripts/content/contract-w09-state-branch.mjs';
import { createW09ReleaseState } from '../scripts/content/contract-w09-release.mjs';

const OFFICIAL_ORIGIN = 'https://github.com/SyuanTsai/DarkTide-Web';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'w09-state-branch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bare = path.join(root, 'remote.git');
  const checkout = path.join(root, 'checkout');
  await mkdir(checkout, { recursive: true });
  execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore', windowsHide: true });
  git(checkout, ['init', '--initial-branch=main']);
  git(checkout, ['config', 'user.name', 'W09 state test']);
  git(checkout, ['config', 'user.email', 'w09-state-test@example.invalid']);
  await writeFile(path.join(checkout, 'README.md'), 'isolated W09 state test\n', 'utf8');
  git(checkout, ['add', 'README.md']);
  git(checkout, ['commit', '-m', 'fixture main']);
  git(checkout, ['remote', 'add', 'origin', OFFICIAL_ORIGIN]);
  configureLocalRemoteRewrite(checkout, bare);
  git(checkout, ['push', '-u', 'origin', 'main']);
  return { root, bare, checkout };
}

function configureLocalRemoteRewrite(checkout, bare) {
  const localUrl = pathToFileURL(bare).href;
  git(checkout, ['config', 'url.' + localUrl + '.insteadOf', OFFICIAL_ORIGIN]);
}

function activeReleaseState() {
  const state = createW09ReleaseState();
  const gameVersion = '1.13.1';
  const gameReleaseId = 'fixture-game-release';
  const contentVersion = '1.13.1.1';
  const inputDigest = 'a'.repeat(64);
  const manifestSha256 = 'b'.repeat(64);
  const releaseId = 'w09-' + createHash('sha256').update(JSON.stringify([
    gameVersion, gameReleaseId, contentVersion, inputDigest, manifestSha256,
  ])).digest('hex').slice(0, 32);
  const buildId = 'c'.repeat(64);
  const activeByGame = [{ gameReleaseId, releaseId }];
  state.reservations.push({ gameVersion, gameReleaseId, contentVersion, inputDigest, manifestSha256, releaseId, status: 'approved' });
  state.activeByGame = activeByGame;
  state.activeRuntimeSnapshotBuildId = buildId;
  state.approvedRuntimeSnapshots.push({ buildId, activeByGame });
  return state;
}

async function cloneRunner(root, bare, name) {
  const checkout = path.join(root, name);
  execFileSync('git', ['clone', '--quiet', '-b', 'main', bare, checkout], { stdio: 'ignore', windowsHide: true });
  git(checkout, ['config', 'remote.origin.url', OFFICIAL_ORIGIN]);
  configureLocalRemoteRewrite(checkout, bare);
  git(checkout, ['config', 'user.name', 'W09 state test']);
  git(checkout, ['config', 'user.email', 'w09-state-test@example.invalid']);
  return checkout;
}

test('InterT25_owner-state-branch-restores-whitelisted-files-without-touching-checkout-index-or-head', async t => {
  const { root, bare, checkout } = await fixture(t);
  const originalHead = git(checkout, ['rev-parse', 'HEAD']);
  const store = await createW09StateBranchStore({ repoRoot: checkout });
  assert.deepEqual(await store.restore(), { status: 'empty', commit: null, fileCount: 0 });

  const statePath = path.join(checkout, 'content/contracts/w09/release-state.json');
  const preparedPath = path.join(checkout, 'content/contracts/w09/prepared/1.13.1/shared.json');
  const snapshotPath = path.join(checkout, 'content/contracts/w09/runtime-snapshots/build-a/snapshot.json');
  await mkdir(path.dirname(statePath), { recursive: true });
  await mkdir(path.dirname(preparedPath), { recursive: true });
  await mkdir(path.dirname(snapshotPath), { recursive: true });
  await writeFile(statePath, '{"schema":"w09-release-state/1","revision":1}\n', 'utf8');
  await writeFile(preparedPath, '{"fixture":"prepared"}\n', 'utf8');
  await writeFile(snapshotPath, '{"fixture":"runtime-snapshot"}\n', 'utf8');
  await writeFile(path.join(checkout, 'content/contracts/w09/publication.lock'), 'must not persist\n', 'utf8');
  await mkdir(path.join(checkout, '.tmp'), { recursive: true });
  await writeFile(path.join(checkout, '.tmp/private'), 'must not persist\n', 'utf8');
  await mkdir(path.join(checkout, 'dist'), { recursive: true });
  await writeFile(path.join(checkout, 'dist/index.html'), 'must not persist\n', 'utf8');
  await mkdir(path.join(checkout, '.deployment'), { recursive: true });
  await writeFile(path.join(checkout, '.deployment/receipt.json'), 'must not persist\n', 'utf8');

  const first = await store.persist({ phase: 'reserved' });
  assert.equal(first.status, 'persisted');
  assert.equal(git(checkout, ['rev-parse', 'HEAD']), originalHead);
  assert.equal(git(checkout, ['diff', '--cached', '--name-only']), '');
  const paths = git(bare, ['--git-dir=' + bare, 'ls-tree', '-r', '--name-only', 'refs/heads/w09-release-state'])
    .split(/\r?\n/u).filter(Boolean).sort();
  assert.deepEqual(paths, [
    'content/contracts/w09/prepared/1.13.1/shared.json',
    'content/contracts/w09/release-state.json',
    'content/contracts/w09/runtime-snapshots/build-a/snapshot.json',
  ]);
  assert.ok(!paths.some(value => /publication\.lock|\.tmp|dist|\.deployment/u.test(value)));

  const fresh = await cloneRunner(root, bare, 'fresh-runner');
  const freshHead = git(fresh, ['rev-parse', 'HEAD']);
  const freshStore = await createW09StateBranchStore({ repoRoot: fresh });
  const restored = await freshStore.restore();
  assert.equal(restored.status, 'restored');
  assert.equal(restored.commit, first.commit);
  assert.equal(restored.fileCount, 3);
  assert.equal(await readFile(path.join(fresh, 'content/contracts/w09/release-state.json'), 'utf8'), '{"schema":"w09-release-state/1","revision":1}\n');
  assert.equal(await readFile(path.join(fresh, 'content/contracts/w09/prepared/1.13.1/shared.json'), 'utf8'), '{"fixture":"prepared"}\n');
  assert.equal(await readFile(path.join(fresh, 'content/contracts/w09/runtime-snapshots/build-a/snapshot.json'), 'utf8'), '{"fixture":"runtime-snapshot"}\n');
  assert.equal(git(fresh, ['rev-parse', 'HEAD']), freshHead);
  assert.equal(git(fresh, ['diff', '--cached', '--name-only']), '');
  assert.equal((await freshStore.persist({ phase: 'prepared' })).status, 'unchanged');
});

test('InterT25_owner-state-branch-rejects-stale-runner-with-non-fast-forward-CAS', async t => {
  const { root, bare, checkout } = await fixture(t);
  const firstStore = await createW09StateBranchStore({ repoRoot: checkout });
  await firstStore.restore();
  const statePath = path.join(checkout, 'content/contracts/w09/release-state.json');
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, '{"schema":"w09-release-state/1","revision":1}\n', 'utf8');
  const initial = await firstStore.persist({ phase: 'reserved' });

  const runnerA = await cloneRunner(root, bare, 'runner-a');
  const runnerB = await cloneRunner(root, bare, 'runner-b');
  const storeA = await createW09StateBranchStore({ repoRoot: runnerA });
  const storeB = await createW09StateBranchStore({ repoRoot: runnerB });
  await storeA.restore();
  await storeB.restore();

  const runnerAState = path.join(runnerA, 'content/contracts/w09/release-state.json');
  await writeFile(runnerAState, '{"schema":"w09-release-state/1","revision":2}\n', 'utf8');
  const winner = await storeA.persist({ phase: 'prepared' });
  assert.equal(winner.status, 'persisted');
  assert.notEqual(winner.commit, initial.commit);

  const runnerBState = path.join(runnerB, 'content/contracts/w09/release-state.json');
  await writeFile(runnerBState, '{"schema":"w09-release-state/1","revision":3}\n', 'utf8');
  await assert.rejects(storeB.persist({ phase: 'journal' }), /non-fast-forward CAS/i);
  assert.equal(git(bare, ['--git-dir=' + bare, 'rev-parse', 'refs/heads/w09-release-state']), winner.commit);
  assert.equal(await readFile(path.join(runnerB, 'content/contracts/w09/release-state.json'), 'utf8'), '{"schema":"w09-release-state/1","revision":3}\n');
  assert.equal(git(runnerB, ['diff', '--cached', '--name-only']), '');
});

test('InterT25_owner-state-branch-rejects-nonofficial-origin', async t => {
  const { checkout } = await fixture(t);
  git(checkout, ['config', 'remote.origin.url', 'https://github.com/SyuanTsai/DarkTide-Web-Fork.git']);
  await assert.rejects(createW09StateBranchStore({ repoRoot: checkout }), /official DarkTide-Web HTTPS origin/u);
});

test('InterT25_owner-state-branch-rejects-unwhitelisted-remote-tree-before-restoring-files', async t => {
  const { root, bare, checkout } = await fixture(t);
  const store = await createW09StateBranchStore({ repoRoot: checkout });
  await store.restore();
  await mkdir(path.join(checkout, 'content/contracts/w09'), { recursive: true });
  await writeFile(path.join(checkout, 'content/contracts/w09/release-state.json'), '{"schema":"w09-release-state/1"}\n', 'utf8');
  await store.persist({ phase: 'reserved' });

  const attacker = await cloneRunner(root, bare, 'branch-writer');
  git(attacker, ['fetch', 'origin', 'w09-release-state']);
  git(attacker, ['checkout', '--track', '-b', 'w09-release-state', 'origin/w09-release-state']);
  const blockedPath = path.join(attacker, 'content/contracts/w09/publication.lock');
  await mkdir(path.dirname(blockedPath), { recursive: true });
  await writeFile(blockedPath, 'must never be in owner state\n', 'utf8');
  git(attacker, ['add', '-f', '--', 'content/contracts/w09/publication.lock']);
  git(attacker, ['commit', '-m', 'malformed owner state fixture']);
  git(attacker, ['push', 'origin', 'w09-release-state']);
  const malformedCommit = git(attacker, ['rev-parse', 'HEAD']);

  const freshStore = await createW09StateBranchStore({ repoRoot: checkout });
  await assert.rejects(freshStore.restore(), /closed publication whitelist/u);
  const remoteHead = git(checkout, ['ls-remote', 'origin', 'refs/heads/w09-release-state']).split(/\s/u)[0];
  assert.equal(remoteHead, malformedCommit, 'rejected remote tree must not rewrite the authoritative branch');
  assert.equal(await readFile(path.join(checkout, 'content/contracts/w09/release-state.json'), 'utf8'), '{"schema":"w09-release-state/1"}\n',
    'remote validation must complete before restoring any branch files');
});

test('InterT25_owner-state-branch-refuses-junctions-at-state-and-allowed-tree-roots', async t => {
  for (const relativeLink of [
    'content/contracts/w09',
    'content/contracts/w09/prepared',
    'content/contracts/w09/runtime-snapshots',
  ]) {
    const { root, checkout } = await fixture(t);
    const outside = path.join(root, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'synthetic-canary.txt'), 'must stay outside\n', 'utf8');
    const linkPath = path.join(checkout, ...relativeLink.split('/'));
    await mkdir(path.dirname(linkPath), { recursive: true });
    await symlink(outside, linkPath, 'junction');
    const store = await createW09StateBranchStore({ repoRoot: checkout });
    await store.restore();
    await assert.rejects(store.persist({ phase: 'reserved' }), /symlink|junction/i, relativeLink);
    assert.equal(git(checkout, ['ls-remote', 'origin', 'refs/heads/w09-release-state']), '',
      'a junction must be rejected before an owner branch is created');
  }
});

test('InterT26_owner-state-read-distinguishes-empty-and-active-without-restoring-checkout-files', async t => {
  const { bare, checkout } = await fixture(t);
  const empty = await readW09OwnerStateBranch({ repoRoot: checkout });
  assert.deepEqual(empty, { status: 'empty', commit: null, active: false, state: null });

  const store = await createW09StateBranchStore({ repoRoot: checkout });
  await store.restore();
  const statePath = path.join(checkout, 'content/contracts/w09/release-state.json');
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(activeReleaseState(), null, 2) + '\n', 'utf8');
  const committed = await store.persist({ phase: 'active' });
  const beforeHead = git(checkout, ['rev-parse', 'HEAD']);
  const beforeIndex = git(checkout, ['diff', '--cached', '--name-only']);
  const inspected = await readW09OwnerStateBranch({ repoRoot: checkout });
  assert.equal(inspected.status, 'present');
  assert.equal(inspected.commit, committed.commit);
  assert.equal(inspected.active, true);
  assert.equal(inspected.state.activeByGame.length, 1);
  assert.equal(git(checkout, ['rev-parse', 'HEAD']), beforeHead);
  assert.equal(git(checkout, ['diff', '--cached', '--name-only']), beforeIndex);
  assert.deepEqual(git(bare, ['--git-dir=' + bare, 'show-ref', '--heads', 'w09-release-state']).split(/\s/u)[0], committed.commit);
});

test('InterT27_owner-state-branch-never-restores-or-persists-without-the-ledger', async t => {
  const { root, bare, checkout } = await fixture(t);
  git(checkout, ['checkout', '--orphan', 'w09-release-state']);
  git(checkout, ['rm', '--force', '--', 'README.md']);
  const preparedPath = path.join(checkout, 'content/contracts/w09/prepared/fixture/package.json');
  await mkdir(path.dirname(preparedPath), { recursive: true });
  await writeFile(preparedPath, '{"fixture":true}\n', 'utf8');
  git(checkout, ['add', 'content/contracts/w09/prepared/fixture/package.json']);
  git(checkout, ['commit', '-m', 'fixture owner branch without ledger']);
  git(checkout, ['push', 'origin', 'w09-release-state']);

  const fresh = await cloneRunner(root, bare, 'missing-ledger-runner');
  const missingLedgerStore = await createW09StateBranchStore({ repoRoot: fresh });
  await assert.rejects(missingLedgerStore.restore(), /required release-state\.json/u);
  await assert.rejects(readFile(path.join(fresh, 'content/contracts/w09/prepared/fixture/package.json')),
    error => error.code === 'ENOENT', 'a corrupt remote tree must be rejected before any allowed file is restored');

  const { bare: secondBare, checkout: secondCheckout } = await fixture(t);
  const newStore = await createW09StateBranchStore({ repoRoot: secondCheckout });
  await newStore.restore();
  const statePath = path.join(secondCheckout, 'content/contracts/w09/release-state.json');
  await assert.rejects(newStore.persist({ phase: 'reserved' }), /ledger must be present/u);
  assert.equal(git(secondCheckout, ['ls-remote', 'origin', 'refs/heads/w09-release-state']), '');

  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(createW09ReleaseState(), null, 2) + '\n', 'utf8');
  const valid = await newStore.persist({ phase: 'reserved' });
  await rm(statePath);
  await assert.rejects(newStore.persist({ phase: 'prepared' }), /ledger must be present/u);
  assert.equal(git(secondBare, ['--git-dir=' + secondBare, 'rev-parse', 'refs/heads/w09-release-state']), valid.commit);
});
