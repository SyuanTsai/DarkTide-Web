import { createHash } from 'node:crypto';

const REPOSITORY = 'SyuanTsai/DarkTide-Web';
const WORKFLOW_PATH = '.github/workflows/shared-release.yml';
const PROMOTION_STEP = 'Promote the selected shared composition';
const MAX_LOG_BYTES = 32 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;

function fail(message) { throw new Error(message); }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function sameJson(left, right) { return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right)); }
function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]));
}

async function readBoundedJobLog(response) {
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (contentType && !/^text\/plain(?:\s*;|$)/iu.test(contentType)) {
    fail('GitHub job logs endpoint did not return plain text');
  }
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LOG_BYTES) fail('GitHub job log exceeds its bounded size');
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > MAX_LOG_BYTES) {
          await reader.cancel();
          fail('GitHub job log exceeds its bounded size');
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks, totalBytes);
    return { bytes, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_LOG_BYTES) fail('GitHub job log exceeds its bounded size');
  try { return { bytes, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; }
  catch (error) { throw new Error('GitHub job log is not valid UTF-8 text', { cause: error }); }
}

async function readJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response?.ok) fail(`GitHub evidence request failed (${response?.status ?? 'no response'})`);
  try { return await response.json(); }
  catch (error) { throw new Error('GitHub evidence response is invalid JSON', { cause: error }); }
}

async function readGitHubContent(fetchImpl, filePath, headSha, token) {
  const url = `https://api.github.com/repos/${REPOSITORY}/contents/${filePath}?ref=${headSha}`;
  const result = await readJson(fetchImpl, url, token);
  if (!result || result.type !== 'file' || result.encoding !== 'base64' || typeof result.content !== 'string') {
    fail(`GitHub evidence file is unavailable: ${filePath}`);
  }
  return Buffer.from(result.content.replace(/\s/gu, ''), 'base64');
}

function currentReleasePointers(state, activeSnapshot) {
  return activeSnapshot.activeByGame.map(active => {
    const reservation = state.reservations.find(row => row.releaseId === active.releaseId);
    if (!reservation || reservation.status !== 'approved' || reservation.gameReleaseId !== active.gameReleaseId
        || typeof reservation.dataRevision !== 'string') fail('current W09 active pointer has no approved immutable reservation');
    return {
      game_version: reservation.gameVersion,
      content_version: reservation.contentVersion,
      data_revision: reservation.dataRevision,
      manifest_path: `/data/${reservation.dataRevision}/manifest.json`,
      manifest_sha256: reservation.manifestSha256,
    };
  }).sort((left, right) => left.game_version.localeCompare(right.game_version, 'en', { numeric: true }));
}

function validateProductionVersion(version, state, pendingPromotion, expectedCurrent, siteOrigin) {
  if (!version || typeof version !== 'object' || Array.isArray(version) || version.schema_version !== 2
      || version.package_kind !== 'published' || !SHA256.test(version.build_id)
      || !SHA256.test(version.data_revision) || version.build_id !== expectedCurrent.runtimeSnapshotBuildId
      || version.build_id === pendingPromotion.buildId || !Array.isArray(version.game_releases)) {
    fail('formal production version does not prove that the previous whole-site build remains active');
  }
  const expected = currentReleasePointers(state, expectedCurrent);
  if (!expected.length || !sameJson(version.game_releases, expected)) {
    fail('formal production shared pointers do not match the expected current W09 state');
  }
  const selected = expected.find(row => row.game_version === version.game_version);
  if (!selected || selected.data_revision !== version.data_revision) {
    fail('formal production data revision does not match its current selected release');
  }
  return {
    origin: siteOrigin,
    buildId: version.build_id,
    dataRevision: version.data_revision,
    gameReleases: version.game_releases,
  };
}

export async function verifyW09UndeployedPromotion({
  pendingPromotion,
  state,
  expectedCurrent,
  workflowRunId,
  token,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  siteOrigin = 'https://darktide.tw-syuan.com',
} = {}) {
  if (!pendingPromotion || typeof pendingPromotion !== 'object' || pendingPromotion.phase !== 'retryable'
      || (pendingPromotion.action !== undefined && pendingPromotion.action !== 'promote')) {
    fail('only a retryable W09 promote journal can be verified for cancellation');
  }
  if (!SHA256.test(pendingPromotion.buildId)) fail('retryable W09 promotion journal has no valid pinned build ID');
  if (!Number.isSafeInteger(workflowRunId) || workflowRunId < 1 || typeof token !== 'string' || !token.trim()
      || typeof fetchImpl !== 'function') fail('workflow run ID, GitHub token, and fetch capability are required to verify cancellation');
  if (!expectedCurrent || expectedCurrent.runtimeSnapshotBuildId === null
      || pendingPromotion.expectedActive?.runtimeSnapshotBuildId !== expectedCurrent.runtimeSnapshotBuildId) {
    fail('cancellation requires a pinned previous formal runtime build');
  }

  const apiRoot = `https://api.github.com/repos/${REPOSITORY}`;
  const run = await readJson(fetchImpl, `${apiRoot}/actions/runs/${workflowRunId}`, token);
  if (run.id !== workflowRunId || run.status !== 'completed' || run.conclusion !== 'failure'
      || run.path !== WORKFLOW_PATH || run.head_branch !== 'main'
      || run.head_repository?.full_name !== REPOSITORY || !COMMIT_SHA.test(run.head_sha)
      || !['workflow_run', 'workflow_dispatch'].includes(run.event)) {
    fail('GitHub run is not the completed failed W09 main release workflow');
  }

  const selectedBytes = await readGitHubContent(fetchImpl,
    'content/contracts/w09/source-handoff/selected.json', run.head_sha, token);
  let selected;
  try { selected = JSON.parse(selectedBytes.toString('utf8')); }
  catch (error) { throw new Error('failed W09 run selected marker is invalid JSON', { cause: error }); }
  const selectedReleaseIds = Array.isArray(selected?.proposals)
    ? selected.proposals.map(row => row?.releaseId).sort()
    : [];
  const pendingSourceIds = [...(pendingPromotion.sourceReleaseIds ?? [])].sort();
  if (!pendingSourceIds.length || new Set(selectedReleaseIds).size !== selectedReleaseIds.length
      || !sameJson(selectedReleaseIds, pendingSourceIds)) {
    fail('failed W09 run selected composition does not match the retryable journal Source releases');
  }

  const promoterBytes = await readGitHubContent(fetchImpl, 'scripts/promote-w09-release.mjs', run.head_sha, token);
  const promoter = promoterBytes.toString('utf8');
  const browserSmoke = promoter.indexOf("['scripts/browser-smoke.mjs', 'dist']");
  const checkLoop = promoter.indexOf('for (const [script, ...args] of checks)');
  const credentialGuard = promoter.indexOf('if (!process.env.CLOUDFLARE_API_TOKEN?.trim())', checkLoop);
  const deployCall = promoter.indexOf("await run(process.execPath, ['scripts/cloudflare-deploy.mjs']", credentialGuard);
  if (browserSmoke < 0 || checkLoop < browserSmoke || credentialGuard < checkLoop || deployCall < credentialGuard) {
    fail('failed W09 run code does not prove browser smoke precedes every production deploy call');
  }

  const jobsResult = await readJson(fetchImpl, `${apiRoot}/actions/runs/${workflowRunId}/jobs?per_page=100`, token);
  if (!Array.isArray(jobsResult?.jobs)) fail('GitHub W09 run job list is invalid');
  const failedJobs = jobsResult.jobs.filter(job => job.name === 'shared-release' && job.conclusion === 'failure');
  if (failedJobs.length !== 1) fail('GitHub W09 run does not identify exactly one failed shared-release job');
  const job = failedJobs[0];
  const failedSteps = (job.steps ?? []).filter(step => step.conclusion === 'failure');
  if (!Number.isSafeInteger(job.id) || job.status !== 'completed' || failedSteps.length !== 1
      || failedSteps[0].name !== PROMOTION_STEP) {
    fail('GitHub W09 run did not fail exclusively in the selected composition promotion step');
  }

  const logsResponse = await fetchImpl(`${apiRoot}/actions/jobs/${job.id}/logs`, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!logsResponse?.ok) fail(`GitHub job logs request failed (${logsResponse?.status ?? 'no response'})`);
  const jobLog = await readBoundedJobLog(logsResponse);
  const logText = jobLog.text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '');
  if (!/Browser smoke failed:[\s\S]{0,1200}waiting for locator\('\.shared-official-text'\) to be visible/u.test(logText)) {
    fail('GitHub job logs do not prove the exact pre-deployment official-text browser-smoke failure');
  }
  const runtimeBuildMatches = [...logText.matchAll(/Cloudflare local runtime verified: deep routes, JSON, strict 404, cache, build ([a-f0-9]{64})/gu)];
  if (runtimeBuildMatches.length !== 1 || runtimeBuildMatches[0][1] !== pendingPromotion.buildId) {
    fail('GitHub job logs do not prove that the failed run tested the exact retryable journal build ID');
  }
  if (/Cloudflare deployment verified:|Wrangler version upload failed|production deployment\/check failed|wrangler versions upload/iu.test(logText)) {
    fail('GitHub job logs contain evidence that a Cloudflare deployment was attempted');
  }

  const versionUrl = new URL('/version.json', siteOrigin);
  const versionResponse = await fetchImpl(versionUrl.href, {
    cache: 'no-store',
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!versionResponse?.ok || (versionResponse.url && versionResponse.url !== versionUrl.href)
      || !/^application\/json(?:\s*;|$)/iu.test(versionResponse.headers?.get?.('content-type') ?? '')) {
    fail('formal production version endpoint could not be verified without redirects');
  }
  let version;
  try { version = await versionResponse.json(); }
  catch (error) { throw new Error('formal production version is invalid JSON', { cause: error }); }
  const production = validateProductionVersion(version, state, pendingPromotion, expectedCurrent, siteOrigin);
  const observedAt = new Date().toISOString();
  const proof = {
    schema: 'w09-undeployed-promotion-proof/1',
    observedAt,
    workflow: {
      runId: run.id,
      workflowPath: run.path,
      headSha: run.head_sha,
      headBranch: run.head_branch,
      conclusion: run.conclusion,
      jobId: job.id,
      failedStep: PROMOTION_STEP,
      failure: 'browser-smoke-official-text-timeout',
      runtimeBuildId: runtimeBuildMatches[0][1],
      selectedReleaseIds: selectedReleaseIds.sort(),
      selectedSha256: hash(selectedBytes),
      promoterSha256: hash(promoterBytes),
      logSha256: hash(jobLog.bytes),
    },
    production: { ...production, observedAt },
  };
  return proof;
}
