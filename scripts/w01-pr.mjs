import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertExactKeys,
  assertPlainObject,
  jsonBytes,
  parseJson,
  sha256
} from '../src/static/common.mjs';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Web';
const WEB_BRANCH = 'codex/SYP-311-w01';
const BASE_BRANCH = 'main';

function fail(message) {
  throw new Error(message);
}

export function normalizeWebRepositoryUrl(value) {
  if (typeof value !== 'string') return null;
  const candidates = [
    /^https:\/\/github\.com\/SyuanTsai\/DarkTide-Web(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/SyuanTsai\/DarkTide-Web(?:\.git)?$/i,
    /^git@github\.com:SyuanTsai\/DarkTide-Web(?:\.git)?$/i
  ];
  return candidates.some(pattern => pattern.test(value.trim())) ? WEB_REPOSITORY : null;
}

function verifyReceipt(receipt) {
  assertPlainObject(receipt, 'composition receipt');
  assertExactKeys(receipt, [
    'schemaVersion', 'requestId', 'request', 'sourceLockSha256', 'artifacts', 'candidate',
    'fixtureOnly', 'publicationEligible', 'formalPublishAllowed'
  ], 'composition receipt');
  assertExactKeys(receipt.request, ['repository', 'commit', 'sourceRevision', 'manifestSha256'], 'composition request');
  assertExactKeys(receipt.candidate, ['repository', 'branch', 'baseBranch'], 'candidate');
  if (receipt.request.repository !== 'https://github.com/SyuanTsai/DarkTide-Source-Data' ||
      !/^[a-f0-9]{40}$/.test(receipt.request.commit) || !/^[a-f0-9]{64}$/.test(receipt.request.sourceRevision) ||
      !/^[a-f0-9]{64}$/.test(receipt.request.manifestSha256)) {
    fail('composition receipt has an invalid public Source pin');
  }
  if (receipt.schemaVersion !== '1.0.0' || receipt.requestId !== sha256(jsonBytes(receipt.request)) ||
      receipt.candidate.repository !== WEB_REPOSITORY || receipt.candidate.branch !== WEB_BRANCH ||
      receipt.candidate.baseBranch !== BASE_BRANCH || typeof receipt.fixtureOnly !== 'boolean' ||
      receipt.publicationEligible !== false || receipt.formalPublishAllowed !== false) {
    fail('composition receipt is not the fixed quarantined W01 candidate');
  }
  return { fixtureOnly: receipt.fixtureOnly };
}

function parsePrList(output, branch) {
  let prs;
  try {
    prs = JSON.parse(output);
  } catch {
    fail('gh returned an invalid pull request list');
  }
  if (!Array.isArray(prs)) fail('gh pull request list is not an array');
  const matching = prs.filter(pr => pr.headRefName === branch && pr.baseRefName === BASE_BRANCH);
  const open = matching.filter(pr => pr.state === 'OPEN');
  if (open.length > 1) fail('more than one open pull request exists for the W01 candidate branch');
  if (open.length === 1) {
    const pr = open[0];
    if (!Number.isInteger(pr.number) || typeof pr.url !== 'string') fail('gh returned an incomplete pull request identity');
    return { pullRequest: { number: pr.number, url: pr.url, state: pr.state }, closedExists: false };
  }
  return { pullRequest: null, closedExists: matching.some(pr => pr.state !== 'OPEN') };
}

export function ensureCandidatePullRequest({ receipt, runGh } = {}) {
  const { fixtureOnly } = verifyReceipt(receipt);
  if (typeof runGh !== 'function') fail('runGh executor is required');
  const lookup = () => parsePrList(
    runGh(['pr', 'list', '--head', WEB_BRANCH, '--base', BASE_BRANCH, '--state', 'all', '--json', 'number,url,state,headRefName,baseRefName']),
    WEB_BRANCH
  );
  const existing = lookup();
  if (existing.pullRequest) return { created: false, ...existing.pullRequest };
  if (existing.closedExists) fail('a closed W01 pull request already exists for this candidate branch; refusing to create a duplicate');

  const quarantineDescription = fixtureOnly
    ? 'This package is fixture-only and publication-ineligible. Formal content still requires human review.'
    : 'This package is a non-fixture pending preview and publication-ineligible. Formal content still requires human review.';
  const body = [
    'Compose the pinned public Source preview request into the W01 Web candidate.',
    '',
    'Source commit: ' + receipt.request.commit,
    'Source revision: ' + receipt.request.sourceRevision,
    'Source manifest SHA-256: ' + receipt.request.manifestSha256,
    'Composition request ID: ' + receipt.requestId,
    '',
    quarantineDescription
  ].join('\n');
  const bodyDirectory = mkdtempSync(path.join(tmpdir(), 'syp-311-w01-pr-'));
  try {
    const bodyPath = path.join(bodyDirectory, 'pull-request-body.md');
    writeFileSync(bodyPath, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try {
      runGh(['pr', 'create', '--base', BASE_BRANCH, '--head', WEB_BRANCH,
        '--title', 'SYP-311: Compose the W01 Source preview', '--body-file', bodyPath]);
    } catch {
      const raced = lookup();
      if (raced.pullRequest) return { created: false, ...raced.pullRequest };
      fail('gh could not create the W01 pull request; no matching open pull request was found');
    }
  } finally {
    rmSync(bodyDirectory, { recursive: true, force: true });
  }
  const created = lookup();
  if (!created.pullRequest) fail('gh completed without an open pull request for the W01 candidate branch');
  return { created: true, ...created.pullRequest };
}

function runGh(args) {
  try {
    return execFileSync('gh', args, { cwd: WEB_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    fail('gh command failed; confirm the local GitHub CLI is authenticated and can read this repository');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: WEB_ROOT, encoding: 'utf8' }).trim();
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: WEB_ROOT, encoding: 'utf8' }).trim();
    if (normalizeWebRepositoryUrl(origin) !== WEB_REPOSITORY || branch !== WEB_BRANCH) fail('run the W01 pull request executor from its fixed Web candidate branch');
    const receipt = parseJson(await readFile(path.join(WEB_ROOT, 'content', 'w01', 'composition-receipt.json')), 'composition receipt');
    const result = ensureCandidatePullRequest({ receipt, runGh });
    process.stdout.write((result.created ? 'Created' : 'Reused') + ' W01 pull request #' + result.number + ' ' + result.url + '\n');
  } catch (error) {
    process.stderr.write('W01 pull request step failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = 1;
  }
}
