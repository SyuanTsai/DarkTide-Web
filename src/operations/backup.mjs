import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyStaticPackage } from '../static/verify.mjs';
import { sha256 } from '../static/common.mjs';
import { SITE_ORIGIN, PREVIEW_ORIGIN } from '../deploy/cloudflare.mjs';

const exec = promisify(execFile);
export const REPOSITORY = 'SyuanTsai/DarkTide-Web';
const BACKUP_FILES = ['artifact-manifest.json', 'deployment.json', 'source.tar.gz', 'static-site.tar.gz'];
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function validateDeploymentReceipt(receipt, artifact) {
  assert.equal(artifact.package_kind, 'published', 'backup requires published package');
  const keys = ['status', 'build_id', 'data_revision', 'previous_versions', 'production_origin', 'deployed_versions', 'preview_origin'];
  assert.deepEqual(Object.keys(receipt).sort(), keys.sort(), 'unexpected deployment receipt fields');
  assert.equal(receipt.status, 'verified', 'backup requires verified deployment');
  assert.equal(receipt.build_id, artifact.build_id, 'receipt build mismatch');
  assert.equal(receipt.data_revision, artifact.data_revision, 'receipt data mismatch');
  assert.equal(receipt.production_origin, SITE_ORIGIN);
  assert.equal(receipt.preview_origin, PREVIEW_ORIGIN);
  for (const versions of [receipt.previous_versions, receipt.deployed_versions]) {
    assert.ok(Array.isArray(versions));
    for (const row of versions) {
      assert.deepEqual(Object.keys(row).sort(), ['percentage', 'version_id']);
      assert.match(row.version_id, uuid);
      assert.ok(Number.isFinite(row.percentage) && row.percentage > 0 && row.percentage <= 100);
    }
    assert.equal(versions.length ? versions.reduce((n, row) => n + row.percentage, 0) : 0, versions.length ? 100 : 0);
  }
  assert.ok(receipt.deployed_versions.length > 0, 'missing deployed version');
  return receipt;
}

export async function createBackup({ root, dist, receiptPath, output, runUrl, runAttempt = '1', sourceCommit }) {
  const artifact = await verifyStaticPackage(dist);
  const receipt = validateDeploymentReceipt(JSON.parse(await readFile(receiptPath, 'utf8')), artifact);
  if (sourceCommit) assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  const commit = sourceCommit || (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.match(runUrl, /^https:\/\/github\.com\/SyuanTsai\/DarkTide-Web\/actions\/runs\/\d+$/);
  assert.match(runAttempt, /^[1-9]\d*$/);
  await mkdir(output, { recursive: false });
  await exec('tar', ['-czf', path.join(output, 'static-site.tar.gz'), '-C', dist, '.']);
  await exec('git', ['-c', 'core.autocrlf=false', 'archive', '--format=tar.gz', '--output=' + path.join(output, 'source.tar.gz'), commit], { cwd: root });
  const manifestBytes = await readFile(path.join(dist, 'artifact-manifest.json'));
  await writeFile(path.join(output, 'artifact-manifest.json'), manifestBytes);
  await writeFile(path.join(output, 'deployment.json'), JSON.stringify(receipt, null, 2) + '\n');
  const version = JSON.parse(await readFile(path.join(dist, 'version.json'), 'utf8'));
  const publicInput = (await exec('git', ['show', commit + ':content/published/content.json'], { cwd: root, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })).stdout;
  const files = await Promise.all(BACKUP_FILES.map(async name => {
    const bytes = await readFile(path.join(output, name));
    return { name, size_bytes: bytes.length, sha256: sha256(bytes) };
  }));
  const record = { schema_version: 1, repository: REPOSITORY, commit, tag: 'site-' + commit + '-' + runUrl.split('/').at(-1) + '-' + runAttempt, run_attempt: runAttempt,
    created_at: new Date().toISOString(), deployment_run: runUrl, build_id: artifact.build_id,
    data_revision: artifact.data_revision, game_version: version.game_version, package_kind: 'published',
    file_count: artifact.file_count, public_input: { path: 'content/published/content.json', sha256: sha256(publicInput) },
    retention: 'Keep indefinitely; no automatic deletion. Preserve current and at least two preceding complete production packages.', files };
  const recordBytes = Buffer.from(JSON.stringify(record, null, 2) + '\n');
  await writeFile(path.join(output, 'backup.json'), recordBytes);
  await writeFile(path.join(output, 'SHA256SUMS'), files.map(row => row.sha256 + '  ' + row.name).join('\n') + '\n' + sha256(recordBytes) + '  backup.json\n');
  await inspectBackup(output);
  return record;
}

export async function inspectBackup(directory) {
  const recordBytes = await readFile(path.join(directory, 'backup.json'));
  const record = JSON.parse(recordBytes);
  assert.equal(record.schema_version, 1);
  assert.equal(record.repository, REPOSITORY);
  assert.equal(record.package_kind, 'published');
  assert.match(record.commit, /^[a-f0-9]{40}$/);
  assert.match(record.deployment_run, /^https:\/\/github\.com\/SyuanTsai\/DarkTide-Web\/actions\/runs\/\d+$/);
  assert.match(record.run_attempt, /^[1-9]\d*$/);
  assert.equal(record.tag, 'site-' + record.commit + '-' + record.deployment_run.split('/').at(-1) + '-' + record.run_attempt);
  assert.match(record.build_id, /^[a-f0-9]{64}$/);
  assert.match(record.data_revision, /^[a-f0-9]{64}$/);
  assert.equal(record.public_input.path, 'content/published/content.json');
  assert.match(record.public_input.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(record.file_count) && record.file_count > 0);
  assert.deepEqual(record.files.map(row => row.name), BACKUP_FILES, 'unexpected backup file set');
  for (const row of record.files) {
    const bytes = await readFile(path.join(directory, row.name));
    assert.equal(bytes.length, row.size_bytes, 'backup size mismatch: ' + row.name);
    assert.equal(sha256(bytes), row.sha256, 'backup hash mismatch: ' + row.name);
  }
  const sums = record.files.map(row => row.sha256 + '  ' + row.name).join('\n') + '\n' + sha256(recordBytes) + '  backup.json\n';
  assert.equal(await readFile(path.join(directory, 'SHA256SUMS'), 'utf8'), sums, 'backup checksum index mismatch');
  const manifest = JSON.parse(await readFile(path.join(directory, 'artifact-manifest.json'), 'utf8'));
  assert.equal(manifest.build_id, record.build_id);
  assert.equal(manifest.data_revision, record.data_revision);
  assert.equal(manifest.files.length + 1, record.file_count);
  validateDeploymentReceipt(JSON.parse(await readFile(path.join(directory, 'deployment.json'), 'utf8')), manifest);
  return record;
}

async function validateArchive(archive) {
  const listing = (await exec('tar', ['-tzf', archive], { maxBuffer: 16 * 1024 * 1024 })).stdout;
  for (const name of listing.split(/\r?\n/).filter(Boolean)) {
    const cleaned = name.replace(/^\.\//, '').replace(/\/$/, '');
    if (!cleaned) continue;
    assert.ok(!/^[\/\\]|[\\:\x00-\x1f]/.test(cleaned) && !cleaned.split('/').some(part => part === '..' || part === '.'), 'unsafe archive path');
  }
  const verbose = (await exec('tar', ['-tvzf', archive], { maxBuffer: 16 * 1024 * 1024 })).stdout;
  assert.ok(!verbose.split(/\r?\n/).some(line => /^[lh]/.test(line)), 'archive links are forbidden');
}

export async function restoreBackup({ directory, output, sourceOutput }) {
  const record = await inspectBackup(directory);
  const archive = path.join(directory, 'static-site.tar.gz');
  await validateArchive(archive);
  if (sourceOutput) await validateArchive(path.join(directory, 'source.tar.gz'));
  await mkdir(output, { recursive: false });
  await exec('tar', ['-xzf', archive, '-C', output]);
  const artifact = await verifyStaticPackage(output);
  assert.equal(artifact.build_id, record.build_id);
  assert.equal(artifact.data_revision, record.data_revision);
  assert.equal(artifact.file_count, record.file_count);
  assert.equal(sha256(await readFile(path.join(output, 'artifact-manifest.json'))), record.files.find(row => row.name === 'artifact-manifest.json').sha256);
  if (sourceOutput) {
    await mkdir(sourceOutput, { recursive: false });
    await exec('tar', ['-xzf', path.join(directory, 'source.tar.gz'), '-C', sourceOutput]);
    assert.equal(sha256(await readFile(path.join(sourceOutput, record.public_input.path))), record.public_input.sha256);
  }
  return { status: 'verified', commit: record.commit, build_id: artifact.build_id, data_revision: artifact.data_revision, file_count: artifact.file_count };
}
