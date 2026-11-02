import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { packArchive, restoreArchive } from '../scripts/contracts-archive.mjs';

const execFile = promisify(execFileCallback);

async function git(cwd, args) {
  await execFile('git', args, { cwd, windowsHide: true });
}

async function createArchiveRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contracts-archive-source-'));
  await git(root, ['init', '--initial-branch=main']);
  await git(root, ['config', 'user.name', 'Archive test']);
  await git(root, ['config', 'user.email', 'archive-test@example.test']);
  await writeFile(path.join(root, '.gitattributes'), '/docs/contracts/** text eol=lf\n');
  await mkdir(path.join(root, 'docs', 'contracts', 'w03', 'archive-me'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'contracts', 'w03', 'archive-me', 'proof.json'), '{"proof":true}\n');
  await writeFile(path.join(root, 'keep.txt'), 'keep me\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'archive fixture']);
  return root;
}

// Scenario: a fixed Git commit contains contract evidence selected for archival.
// Purpose: ensure packing is reproducible, inventories every archived file, and records the archive digest.
// Given a committed archive path; when packing it; then the manifest binds the source commit, file digest, and tar digest.
test('UnitT10_pack-creates-digest-bound-manifest-from-fixed-commit', async () => {
  const root = await createArchiveRepository();
  const output = await mkdtemp(path.join(os.tmpdir(), 'contracts-archive-output-'));
  try {
    const result = await packArchive({
      repoRoot: root,
      commit: 'HEAD',
      outputDir: output,
      archivePaths: ['docs/contracts/w03/archive-me'],
      releaseTag: 'contracts-archive-test',
      repository: 'example/contracts',
    });
    const archivedBytes = await readFile(path.join(output, result.manifest.assetFilename));
    assert.match(result.manifest.sourceCommit, /^[0-9a-f]{40}$/u);
    assert.equal(result.manifest.releaseTag, 'contracts-archive-test');
    assert.equal(result.manifest.files.length, 1);
    assert.deepEqual(result.manifest.files[0], {
      path: 'docs/contracts/w03/archive-me/proof.json',
      size: 15,
      sha256: createHash('sha256').update('{"proof":true}\n').digest('hex'),
    });
    assert.equal(result.manifest.tarSha256, createHash('sha256').update(archivedBytes).digest('hex'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
  }
});

// Scenario: a release asset is supplied by an injected downloader.
// Purpose: prove restore verifies all bytes before writing any archived path, without requiring network access in tests.
// Given a valid archive and a corrupted archive; when restoring each; then only the valid asset writes its original paths.
test('UnitT20_restore-verifies-download-and-files-before-writing-target', async () => {
  const source = await createArchiveRepository();
  const output = await mkdtemp(path.join(os.tmpdir(), 'contracts-archive-output-'));
  const restored = await mkdtemp(path.join(os.tmpdir(), 'contracts-archive-restore-'));
  const rejected = await mkdtemp(path.join(os.tmpdir(), 'contracts-archive-reject-'));
  try {
    const packed = await packArchive({
      repoRoot: source,
      commit: 'HEAD',
      outputDir: output,
      archivePaths: ['docs/contracts/w03/archive-me'],
      releaseTag: 'contracts-archive-test',
      repository: 'example/contracts',
    });
    const assetPath = path.join(output, packed.manifest.assetFilename);
    await restoreArchive({
      repoRoot: restored,
      manifest: packed.manifest,
      downloadAsset: ({ destination }) => copyFile(assetPath, destination),
    });
    assert.equal(await readFile(path.join(restored, 'docs/contracts/w03/archive-me/proof.json'), 'utf8'), '{"proof":true}\n');

    const corruptedPath = path.join(output, 'corrupt.tar.gz');
    const corrupt = Buffer.from(await readFile(assetPath));
    corrupt[corrupt.length - 1] ^= 1;
    await writeFile(corruptedPath, corrupt);
    await assert.rejects(
      restoreArchive({
        repoRoot: rejected,
        manifest: packed.manifest,
        downloadAsset: ({ destination }) => copyFile(corruptedPath, destination),
      }),
      /archive sha256 mismatch/u,
    );
    await assert.rejects(readFile(path.join(rejected, 'docs/contracts/w03/archive-me/proof.json')));

    const wrongFileDigest = {
      ...packed.manifest,
      files: [{ ...packed.manifest.files[0], sha256: '0'.repeat(64) }],
    };
    await assert.rejects(
      restoreArchive({
        repoRoot: rejected,
        manifest: wrongFileDigest,
        downloadAsset: ({ destination }) => copyFile(assetPath, destination),
      }),
      /archive file verification failed/u,
    );
    await assert.rejects(readFile(path.join(rejected, 'docs/contracts/w03/archive-me/proof.json')));
  } finally {
    await Promise.all([source, output, restored, rejected].map(directory => rm(directory, { recursive: true, force: true })));
  }
});
