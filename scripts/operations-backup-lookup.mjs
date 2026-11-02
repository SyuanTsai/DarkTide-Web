import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDeploymentReceipt, REPOSITORY } from '../src/operations/backup.mjs';
import { verifyStaticPackage } from '../src/static/verify.mjs';
import { sha256 } from '../src/static/common.mjs';
import { readW09ReleaseState } from './content/contract-w09-release.mjs';

const exec = promisify(execFile);
const RETAINED_TAG = /^site-[a-f0-9]{40}-\d+-\d+$/u;

export async function resolveW09BackupReceipt({ artifact, artifactManifestSha256, activeBuildId, state, listReleases }) {
  assert.match(activeBuildId ?? '', /^[a-f0-9]{64}$/u, 'active W09 build ID is required');
  assert.equal(artifact.build_id, activeBuildId,
    'dist build does not match the active build in W09 state; refusing retained backup');
  assert.equal(typeof listReleases, 'function', 'GitHub release lookup is required');
  const releases = await listReleases();
  assert.ok(Array.isArray(releases), 'GitHub release lookup must return an array');
  const release = releases.slice(0, 100).find(row => row && !row.draft && !row.prerelease
    && RETAINED_TAG.test(row.tag_name) && row.name === 'Static site ' + activeBuildId);
  if (release) return { status: 'already-retained', release };

  const receipts = state?.publicationReceipts;
  assert.ok(Array.isArray(receipts), 'W09 state is missing publication receipts');
  const receipt = receipts.find(row => row?.status === 'verified' && row.buildId === activeBuildId);
  assert.ok(receipt, 'No verified W09 publication receipt matches the active build ' + activeBuildId);
  validateDeploymentReceipt(receipt, artifact, artifactManifestSha256);
  return { status: 'backup-required', receipt };
}

export async function prepareW09BackupReceipt({
  dist = 'dist', statePath = 'content/contracts/w09/release-state.json',
  receiptPath = '.deployment/last-deployment.json', activeBuildId, listReleases,
} = {}) {
  const artifact = await verifyStaticPackage(dist);
  const manifestBytes = await readFile(path.join(dist, 'artifact-manifest.json'));
  const state = await readW09ReleaseState(statePath);
  const result = await resolveW09BackupReceipt({
    artifact, artifactManifestSha256: sha256(manifestBytes), activeBuildId, state, listReleases,
  });
  if (result.status === 'backup-required') {
    await mkdir(path.dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, JSON.stringify(result.receipt, null, 2) + '\n', { flag: 'wx' });
  }
  return result;
}

async function listGitHubReleases() {
  const response = await exec('gh', ['api', 'repos/' + REPOSITORY + '/releases?per_page=100'], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(response.stdout);
}

async function main() {
  const result = await prepareW09BackupReceipt({
    activeBuildId: process.env.ACTIVE_BUILD_ID,
    listReleases: listGitHubReleases,
  });
  const backupRequired = result.status === 'backup-required';
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, 'backup_required=' + String(backupRequired) + '\n');
  }
  if (backupRequired) console.log('Verified W09 receipt selected for active build ' + process.env.ACTIVE_BUILD_ID);
  else console.log('Retained backup already exists for active build: ' + result.release.html_url);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(String(error?.message ?? error) + '\n');
    process.exitCode = 1;
  });
}
