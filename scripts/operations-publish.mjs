import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createBackup, inspectBackup, restoreBackup, REPOSITORY } from '../src/operations/backup.mjs';
import { verifyStaticPackage } from '../src/static/verify.mjs';
import { sha256 } from '../src/static/common.mjs';
const exec = promisify(execFile);
assert.equal(process.env.GITHUB_REPOSITORY, REPOSITORY);
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
const commit = (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim();
assert.equal(commit, process.env.GITHUB_SHA, 'backup checkout must match verified run');
assert.match(process.env.GITHUB_RUN_ID, /^\d+$/);
assert.match(process.env.GITHUB_RUN_ATTEMPT, /^[1-9]\d*$/);
const tag = 'site-' + commit + '-' + process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT;
let existing;
try { existing = JSON.parse((await exec('gh', ['api', 'repos/' + REPOSITORY + '/releases/tags/' + tag])).stdout); }
catch (error) { if (!error.stderr?.includes('HTTP 404')) throw new Error('Cannot check existing backup release'); }
await mkdir('.operations', { recursive: true });
if (existing) {
  assert.equal(existing.draft, false);
  await exec('gh', ['release', 'download', tag, '--repo', REPOSITORY, '--dir', '.operations/existing']);
  const record = await inspectBackup('.operations/existing');
  const artifact = await verifyStaticPackage('dist');
  assert.equal(record.commit, commit);
  assert.equal(record.build_id, artifact.build_id);
  assert.equal(record.data_revision, artifact.data_revision);
  assert.equal(record.files.find(row => row.name === 'artifact-manifest.json').sha256, sha256(await readFile('dist/artifact-manifest.json')));
  console.log('Existing backup verified; no assets replaced: ' + existing.html_url);
} else {
  const record = await createBackup({ root: process.cwd(), dist: path.resolve('dist'), receiptPath: path.resolve('.deployment/last-deployment.json'), output: path.resolve('.operations/backup'),
    runUrl: 'https://github.com/' + REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT });
  const notes = 'Complete verified published static package and public source snapshot.\n\nCommit: `' + record.commit + '`\n\nBuild: `' + record.build_id + '`\n\nData revision: `' + record.data_revision + '`\n\nVerified deployment: ' + record.deployment_run + '\n\nSee `backup.json`, `deployment.json`, `artifact-manifest.json` and `SHA256SUMS`. Keep indefinitely; no automatic deletion. Restore using `scripts/operations-restore.mjs` from main. No private sources or credentials are included.\n';
  await writeFile('.operations/release-notes.md', notes);
  const files = [...record.files.map(row => row.name), 'backup.json', 'SHA256SUMS'].map(name => path.join('.operations/backup', name));
  await exec('gh', ['release', 'create', record.tag, ...files, '--repo', REPOSITORY, '--target', commit, '--title', 'Static site ' + record.build_id, '--notes-file', '.operations/release-notes.md', '--latest=false']);
  console.log('Published complete backup: https://github.com/' + REPOSITORY + '/releases/tag/' + record.tag);
}
// Verify a newly downloaded remote copy, not just the files we uploaded.
await exec('gh', ['release', 'download', tag, '--repo', REPOSITORY, '--dir', '.operations/roundtrip']);
const restored = await restoreBackup({ directory: path.resolve('.operations/roundtrip'), output: path.resolve('.operations/restored-site'), sourceOutput: path.resolve('.operations/restored-source') });
const cleanEnv = { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '', CLOUDFLARE_API_TOKEN: '' };
await exec(process.execPath, [path.resolve('.operations/restored-source/scripts/build.mjs'), '--site-origin', 'https://darktide.tw-syuan.com'], { cwd: path.resolve('.operations/restored-source'), env: cleanEnv });
const rebuilt = await verifyStaticPackage('.operations/restored-source/dist');
assert.equal(rebuilt.build_id, restored.build_id, 'backup source rebuild mismatch');
assert.equal(sha256(await readFile('.operations/restored-source/dist/artifact-manifest.json')), sha256(await readFile('.operations/roundtrip/artifact-manifest.json')), 'rebuilt inventory differs from retained package');
console.log('Remote backup retrieval, strict restore and source-only rebuild verified: ' + restored.build_id);
