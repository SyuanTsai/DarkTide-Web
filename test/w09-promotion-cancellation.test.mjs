import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  cancelW09RetryablePromotion,
  createW09ReleaseState,
  currentW09ActiveSnapshot,
  encodeW09RuntimeSnapshotArchive,
  planW09ContentVersion,
  readW09ReleaseState,
  reserveW09ContentVersion,
  validateW09ReleaseState,
  writeW09ReleaseStateAtomic,
} from '../scripts/content/contract-w09-release.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const fixed = character => character.repeat(64);
const sourceReleaseId = 'w09-' + 'a'.repeat(32);
const runId = 41323284305;
const jobId = 124897843101;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function jsonResponse(value, url = '') {
  const response = new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url) Object.defineProperty(response, 'url', { value: url });
  return response;
}

async function setupFixture(t, { logContentType = 'text/plain; charset=utf-8', logBuildId = null } = {}) {
  const tempRoot = path.join(REPO_ROOT, '.tmp');
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(path.join(tempRoot, 'w09-promotion-cancellation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousGitHubRef = process.env.GITHUB_REF;
  process.env.GITHUB_REF = 'refs/heads/main';
  t.after(() => {
    if (previousGitHubRef === undefined) delete process.env.GITHUB_REF;
    else process.env.GITHUB_REF = previousGitHubRef;
  });
  const statePath = path.join(root, 'content/contracts/w09/release-state.json');
  const oldBuildId = fixed('1');
  const pendingBuildId = fixed('2');
  let state = createW09ReleaseState();
  const oldAllocation = planW09ContentVersion(state, {
    gameVersion: '1.13.4', gameReleaseId: 'darktide:1.13.4',
    inputDigest: fixed('3'), manifestSha256: fixed('4'), dataRevision: fixed('5'),
  });
  state = reserveW09ContentVersion(state, oldAllocation);
  const oldReservation = state.reservations.find(row => row.releaseId === oldAllocation.releaseId);
  oldReservation.status = 'approved';
  state.activeByGame = [{ gameReleaseId: oldReservation.gameReleaseId, releaseId: oldReservation.releaseId }];
  state.activeRuntimeSnapshotBuildId = oldBuildId;
  state.approvedRuntimeSnapshots = [{
    buildId: oldBuildId,
    activeByGame: [{ gameReleaseId: oldReservation.gameReleaseId, releaseId: oldReservation.releaseId }],
  }];
  const pendingAllocation = planW09ContentVersion(state, {
    gameVersion: '1.13.4', gameReleaseId: 'darktide:1.13.4',
    inputDigest: fixed('6'), manifestSha256: fixed('7'), dataRevision: fixed('8'),
  });
  state = reserveW09ContentVersion(state, pendingAllocation);
  state.reservations.find(row => row.releaseId === pendingAllocation.releaseId).status = 'prepared';
  const current = currentW09ActiveSnapshot(state);
  const artifactManifestBytes = Buffer.from(JSON.stringify({
    package_kind: 'published', build_id: pendingBuildId, data_revision: pendingAllocation.dataRevision,
  }));
  const archive = encodeW09RuntimeSnapshotArchive(pendingBuildId, new Map([['artifact-manifest.json', artifactManifestBytes]]));
  const snapshotDirectory = path.join(root, 'content/contracts/w09/runtime-snapshots', pendingBuildId);
  await mkdir(snapshotDirectory, { recursive: true });
  await writeFile(path.join(snapshotDirectory, 'snapshot.json.gz'), archive, { flag: 'wx' });
  state.pendingPromotion = {
    schema: 'w09-promotion-journal/1',
    transactionId: fixed('9'),
    releaseIds: [pendingAllocation.releaseId],
    sourceReleaseIds: [sourceReleaseId],
    expectedActive: current,
    buildId: pendingBuildId,
    dataRevision: pendingAllocation.dataRevision,
    artifactManifestSha256: sha(artifactManifestBytes),
    runtimeSnapshotBuildId: pendingBuildId,
    phase: 'retryable',
    lastFailure: 'pre-deploy browser smoke failed',
  };
  assert.equal(validateW09ReleaseState(state), true);
  await writeW09ReleaseStateAtomic(statePath, state);

  const selectedBytes = Buffer.from(JSON.stringify({ proposals: [{ releaseId: sourceReleaseId }] }));
  const promoterBytes = Buffer.from([
    'const checks = [[\'scripts/browser-smoke.mjs\', \'dist\']];',
    'for (const [script, ...args] of checks) { await run(script, args); }',
    "if (!process.env.CLOUDFLARE_API_TOKEN?.trim()) throw new Error('missing');",
    "await run(process.execPath, ['scripts/cloudflare-deploy.mjs'], {});",
  ].join('\n'));
  const logBytes = Buffer.from([
    `Cloudflare local runtime verified: deep routes, JSON, strict 404, cache, build ${logBuildId ?? pendingBuildId}`,
    '\u001b[31mBrowser smoke failed:\u001b[0m locator.waitFor: Timeout 15000ms exceeded.',
    "waiting for locator('.shared-official-text') to be visible",
  ].join('\n'));
  const expectedProduction = {
    schema_version: 2,
    package_kind: 'published',
    build_id: oldBuildId,
    game_version: oldReservation.gameVersion,
    data_revision: oldReservation.dataRevision,
    game_releases: [{
      game_version: oldReservation.gameVersion,
      content_version: oldReservation.contentVersion,
      data_revision: oldReservation.dataRevision,
      manifest_path: `/data/${oldReservation.dataRevision}/manifest.json`,
      manifest_sha256: oldReservation.manifestSha256,
    }],
  };
  const api = 'https://api.github.com/repos/SyuanTsai/DarkTide-Web';
  const responses = new Map([
    [`${api}/actions/runs/${runId}`, {
      id: runId, status: 'completed', conclusion: 'failure', path: '.github/workflows/shared-release.yml',
      head_branch: 'main', head_repository: { full_name: 'SyuanTsai/DarkTide-Web' },
      head_sha: 'a'.repeat(40), event: 'workflow_run',
    }],
    [`${api}/contents/content/contracts/w09/source-handoff/selected.json?ref=${'a'.repeat(40)}`, {
      type: 'file', encoding: 'base64', content: selectedBytes.toString('base64'),
    }],
    [`${api}/contents/scripts/promote-w09-release.mjs?ref=${'a'.repeat(40)}`, {
      type: 'file', encoding: 'base64', content: promoterBytes.toString('base64'),
    }],
    [`${api}/actions/runs/${runId}/jobs?per_page=100`, {
      jobs: [{ id: jobId, name: 'shared-release', status: 'completed', conclusion: 'failure', steps: [
        { name: 'Promote the selected shared composition', conclusion: 'failure' },
      ] }],
    }],
  ]);
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url: url.href, init });
    if (url.href === `${api}/actions/jobs/${jobId}/logs`) {
      return new Response(logBytes, { status: 200, headers: { 'content-type': logContentType } });
    }
    if (url.href === 'https://darktide.tw-syuan.com/version.json') return jsonResponse(expectedProduction, url.href);
    const value = responses.get(url.href);
    if (value) return jsonResponse(value, url.href);
    return new Response('not found', { status: 404 });
  };
  return { root, statePath, state, current, oldReservation, pendingAllocation, pendingBuildId, archive, calls, fetchImpl };
}

test('UnitT10_cancels-only-verified-undeployed-retryable-promotion-and-preserves-all-identities', async t => {
  const fixture = await setupFixture(t);
  const checkpointPhases = [];
  const result = await cancelW09RetryablePromotion({
    repoRoot: fixture.root,
    expectedCurrent: fixture.current,
    transactionId: fixture.state.pendingPromotion.transactionId,
    workflowRunId: runId,
    token: 'test-token',
    fetchImpl: fixture.fetchImpl,
    requireDurableState: true,
    persistDurableState: async ({ phase, statePath }) => {
      checkpointPhases.push(phase);
      const saved = await readW09ReleaseState(statePath);
      assert.equal(saved.pendingPromotion, null);
      assert.equal(saved.promotionCancellations.length, 1);
      return { status: 'persisted' };
    },
  });

  const state = await readW09ReleaseState(fixture.statePath);
  assert.equal(result.status, 'cancelled-without-deployment');
  assert.deepEqual(checkpointPhases, ['cancelled']);
  assert.deepEqual(currentW09ActiveSnapshot(state), fixture.current);
  assert.equal(state.pendingPromotion, null);
  assert.deepEqual(state.promotionCancellations[0].pendingPromotion, fixture.state.pendingPromotion,
    'the complete original retryable journal remains auditable');
  assert.equal(state.promotionCancellations[0].evidence.workflow.runtimeBuildId, fixture.pendingBuildId,
    'the proof records the exact build ID observed in this failed run log');
  assert.equal(state.reservations.find(row => row.releaseId === fixture.pendingAllocation.releaseId)?.status, 'prepared');
  assert.equal(state.reservations.find(row => row.releaseId === fixture.oldReservation.releaseId)?.status, 'approved');
  assert.deepEqual(await readFile(path.join(fixture.root, 'content/contracts/w09/runtime-snapshots', fixture.pendingBuildId, 'snapshot.json.gz')),
    fixture.archive, 'the failed build snapshot remains byte-for-byte available');
  assert.ok(fixture.calls.some(call => call.url === 'https://darktide.tw-syuan.com/version.json'),
    'cancellation re-reads the actual formal site build');
  assert.ok(fixture.calls.some(call => call.url === `https://api.github.com/repos/SyuanTsai/DarkTide-Web/actions/jobs/${jobId}/logs`),
    'cancellation verifies the exact failed workflow job logs');
});

test('UnitT20_rejects-stale-transaction-active-state-and-unverified-production-build-without-clearing-journal', async t => {
  const fixture = await setupFixture(t);
  const options = {
    repoRoot: fixture.root,
    expectedCurrent: fixture.current,
    transactionId: fixture.state.pendingPromotion.transactionId,
    workflowRunId: runId,
    token: 'test-token',
    fetchImpl: fixture.fetchImpl,
    requireDurableState: true,
    persistDurableState: async () => ({ status: 'persisted' }),
  };

  await assert.rejects(cancelW09RetryablePromotion({ ...options, transactionId: fixed('0') }), /does not match/u);
  await assert.rejects(cancelW09RetryablePromotion({ ...options, expectedCurrent: { ...fixture.current, runtimeSnapshotBuildId: fixed('f') } }), /CAS failed/u);
  assert.equal((await readW09ReleaseState(fixture.statePath)).pendingPromotion.phase, 'retryable');

  const wrongSite = async (input, init) => {
    const url = new URL(input);
    if (url.href === 'https://darktide.tw-syuan.com/version.json') {
      const response = await fixture.fetchImpl(input, init);
      const version = await response.json();
      version.build_id = fixed('e');
      return jsonResponse(version, url.href);
    }
    return fixture.fetchImpl(input, init);
  };
  await assert.rejects(cancelW09RetryablePromotion({ ...options, fetchImpl: wrongSite }), /previous whole-site build remains active/u);
  const preserved = await readW09ReleaseState(fixture.statePath);
  assert.equal(preserved.pendingPromotion.phase, 'retryable');
  assert.equal(preserved.promotionCancellations.length, 0);
});

test('UnitT21_rejects-a-failed-run-that-smoked-a-different-journal-build-without-changing-state', async t => {
  const fixture = await setupFixture(t, { logBuildId: fixed('f') });
  await assert.rejects(cancelW09RetryablePromotion({
    repoRoot: fixture.root,
    expectedCurrent: fixture.current,
    transactionId: fixture.state.pendingPromotion.transactionId,
    workflowRunId: runId,
    token: 'test-token',
    fetchImpl: fixture.fetchImpl,
    requireDurableState: true,
    persistDurableState: async () => ({ status: 'persisted' }),
  }), /failed run tested the exact retryable journal build ID/u);
  const state = await readW09ReleaseState(fixture.statePath);
  assert.deepEqual(state.pendingPromotion, fixture.state.pendingPromotion);
  assert.equal(state.promotionCancellations.length, 0);
  assert.deepEqual(currentW09ActiveSnapshot(state), fixture.current);
});

test('UnitT22_requires-the-real-job-logs-endpoint-text-shape', async t => {
  const fixture = await setupFixture(t, { logContentType: 'application/zip' });
  await assert.rejects(cancelW09RetryablePromotion({
    repoRoot: fixture.root,
    expectedCurrent: fixture.current,
    transactionId: fixture.state.pendingPromotion.transactionId,
    workflowRunId: runId,
    token: 'test-token',
    fetchImpl: fixture.fetchImpl,
    requireDurableState: true,
    persistDurableState: async () => ({ status: 'persisted' }),
  }), /GitHub job logs endpoint did not return plain text/u);
  const state = await readW09ReleaseState(fixture.statePath);
  assert.equal(state.pendingPromotion.transactionId, fixture.state.pendingPromotion.transactionId,
    'an unexpected ZIP response cannot clear the pending journal');
  assert.deepEqual(currentW09ActiveSnapshot(state), fixture.current);
});

test('UnitT30_restores-local-retryable-journal-when-owner-checkpoint-is-uncertain', async t => {
  const fixture = await setupFixture(t);
  await assert.rejects(cancelW09RetryablePromotion({
    repoRoot: fixture.root,
    expectedCurrent: fixture.current,
    transactionId: fixture.state.pendingPromotion.transactionId,
    workflowRunId: runId,
    token: 'test-token',
    fetchImpl: fixture.fetchImpl,
    requireDurableState: true,
    persistDurableState: async () => { throw new Error('simulated owner branch CAS uncertainty'); },
  }), /owner-state checkpoint is uncertain/u);
  const state = await readW09ReleaseState(fixture.statePath);
  assert.deepEqual(state.pendingPromotion, fixture.state.pendingPromotion);
  assert.equal(state.promotionCancellations.length, 0);
  assert.deepEqual(currentW09ActiveSnapshot(state), fixture.current);
});

test('UnitT40_cli-validates-the-exact-cancellation-command-before-owner-state-access', () => {
  const invalidTransaction = spawnSync(process.execPath, [
    'scripts/promote-w09-release.mjs', '--cancel-pending-promotion',
    '--transaction-id', 'invalid', '--workflow-run-id', String(runId),
    '--expected-current-file', '.tmp/w09-cancel-cli-unused.json',
  ], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(invalidTransaction.status, 1);
  assert.match(invalidTransaction.stderr, /full SHA-256 digest/u);
  assert.doesNotMatch(invalidTransaction.stderr, /owner state branch/u);

  const absentSnapshot = spawnSync(process.execPath, [
    'scripts/promote-w09-release.mjs', '--cancel-pending-promotion',
    '--transaction-id', fixed('a'), '--workflow-run-id', String(runId),
    '--expected-current-file', `.tmp/w09-cancel-cli-absent-${process.pid}.json`,
  ], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(absentSnapshot.status, 1);
  assert.match(absentSnapshot.stderr, /ENOENT|no such file/u);
  assert.doesNotMatch(absentSnapshot.stderr, /owner state branch/u);
});
