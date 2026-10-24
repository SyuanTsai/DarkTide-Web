import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadW13RangedPreviewInputs, readW13SelectedW09Snapshot } from '../scripts/content/w13-ranged-preview.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidateRoot = path.join(repoRoot, 'content', 'contracts', 'w13', 'ranged-candidate');

// Scenario: A candidate cache file changes without updating its fixed lock.
// Purpose: Reject altered preview inputs before reading or projecting Source/Web contracts.
test('UnitT23_w13-ranged-preview-rejects-candidate-bytes-outside-fixed-lock', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'w13-ranged-preview-'));
  try {
    const lock = await readFile(path.join(candidateRoot, 'candidate-lock.json'));
    const authoring = await readFile(path.join(candidateRoot, 'authoring.json'));
    await writeFile(path.join(temporaryRoot, 'candidate-lock.json'), lock);
    await writeFile(path.join(temporaryRoot, 'authoring.json'), Buffer.concat([authoring, Buffer.from(' ', 'utf8')]));
    await assert.rejects(
      loadW13RangedPreviewInputs({ repoRoot, candidateRoot: temporaryRoot }),
      /candidate file bytes differ from their lock: authoring\.json/u,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

// Scenario: A later approved W09 release changes the live selected composition pointer.
// Purpose: Keep this W13 preview bound to its cached historical selection and immutable request lock, not the live pointer.
test('UnitT24_w13-ranged-preview-uses-pinned-historical-w09-selection-snapshot', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'w13-w09-selection-'));
  const repoCopy = path.join(temporaryRoot, 'repo');
  const candidateCopy = path.join(temporaryRoot, 'candidate');
  const candidateLockBytes = await readFile(path.join(candidateRoot, 'candidate-lock.json'));
  const selectedSnapshotBytes = await readFile(path.join(candidateRoot, 'source-cache', 'selected-composition.json'));
  const originalLock = JSON.parse(candidateLockBytes.toString('utf8'));
  const liveSelectedPath = path.join(repoCopy, ...originalLock.candidate.selectedW09Request.selectedPath.split('/'));
  const cachedSelectedPath = path.join(candidateCopy, ...originalLock.candidate.selectedW09Request.selectedSnapshotPath.split('/'));
  const immutableRequestLockPath = path.join(repoCopy, ...originalLock.candidate.selectedW09Request.lockPath.split('/'));
  const actualImmutableRequestLockPath = path.join(repoRoot, ...originalLock.candidate.selectedW09Request.lockPath.split('/'));
  try {
    await mkdir(path.dirname(liveSelectedPath), { recursive: true });
    await mkdir(path.dirname(cachedSelectedPath), { recursive: true });
    await mkdir(path.dirname(immutableRequestLockPath), { recursive: true });
    await writeFile(path.join(candidateCopy, 'candidate-lock.json'), candidateLockBytes);
    await writeFile(cachedSelectedPath, selectedSnapshotBytes);
    await writeFile(liveSelectedPath, JSON.stringify({ schema: 'w09-selected-composition/1', proposals: [] }));
    await writeFile(immutableRequestLockPath, await readFile(actualImmutableRequestLockPath));

    const snapshot = await readW13SelectedW09Snapshot({ repoRoot: repoCopy, candidateRoot: candidateCopy });
    assert.equal(snapshot.selected.proposals[0].requestId, originalLock.candidate.selectedW09Request.requestId);
    assert.equal(snapshot.selectedSha256, originalLock.candidate.selectedW09Request.selectedSha256);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
