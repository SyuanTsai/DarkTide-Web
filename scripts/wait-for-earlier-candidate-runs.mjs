import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// GitHub concurrency groups keep only one pending run and cancel the rest, so a Source
// handoff that dispatches several release IDs would lose candidates. Instead every
// candidate run waits until all earlier runs of this workflow have finished.
const WORKFLOW_FILE = 'shared-candidate.yml';
const ACTIVE_STATUSES = Object.freeze(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

export function earlierActiveRunIds(runs, ownRunId) {
  return runs
    .filter(run => ACTIVE_STATUSES.includes(run.status) && Number(run.id) < ownRunId)
    .map(run => Number(run.id))
    .sort((left, right) => left - right);
}

async function listActiveRuns({ repository, token, fetchImpl }) {
  const runs = [];
  for (const status of ACTIVE_STATUSES) {
    const url = `https://api.github.com/repos/${repository}/actions/workflows/${WORKFLOW_FILE}/runs?status=${status}&per_page=100`;
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error(`listing ${status} candidate runs failed with HTTP ${response.status}`);
    const body = await response.json();
    runs.push(...(body.workflow_runs ?? []));
  }
  return runs;
}

export async function waitForEarlierCandidateRuns({
  repository,
  token,
  ownRunId,
  fetchImpl = globalThis.fetch,
  sleep = delay,
  pollMs = 20_000,
  maxWaitMs = 100 * 60_000,
  now = () => Date.now(),
  log = message => process.stdout.write(message + '\n'),
} = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository ?? '')) throw new TypeError('repository must be owner/name');
  if (!Number.isSafeInteger(ownRunId) || ownRunId <= 0) throw new TypeError('ownRunId must be a positive run ID');
  const deadline = now() + maxWaitMs;
  for (;;) {
    const earlier = earlierActiveRunIds(await listActiveRuns({ repository, token, fetchImpl }), ownRunId);
    if (earlier.length === 0) return { waited: true };
    if (now() >= deadline) throw new Error('earlier W09 candidate runs are still active: ' + earlier.join(', '));
    log('Waiting for earlier W09 candidate runs: ' + earlier.join(', '));
    await sleep(pollMs);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  waitForEarlierCandidateRuns({
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GH_TOKEN,
    ownRunId: Number(process.env.GITHUB_RUN_ID),
  }).catch(error => {
    process.stderr.write('W09 candidate queue wait failed: ' + String(error?.message ?? error) + '\n');
    process.exitCode = 1;
  });
}
