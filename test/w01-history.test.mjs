import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  prepareRetainedHistory,
  rebuildRetainedHistory,
  verifyRetainedFiles,
} from '../scripts/w01-history.mjs';

// Scenario: a history manifest lists multiple releases in publication order.
// Purpose: ensure rebuild commands are completed sequentially so every release sees the retained output from its predecessor.
test('UnitT00_rebuild-runs-history-entries-sequentially', async () => {
  const events = [];
  const history = {
    schemaVersion: 1,
    release: {
      repository: 'example/project',
      tag: 'retained-history',
      archiveAsset: 'history.tar',
      manifestAsset: 'history.json',
    },
    entries: [
      { version: 'baseline', commit: 'a'.repeat(40), build: ['build'], retain: false, verify: false, freeze: null },
      { version: '0.0.1', commit: 'b'.repeat(40), build: ['w01:build'], retain: true, verify: true, freeze: 'w01-real-r1' },
      { version: '0.0.2', commit: 'c'.repeat(40), build: ['w01:build', '--candidate-preview'], retain: true, verify: true, freeze: null },
    ],
  };

  await rebuildRetainedHistory({
    history,
    materializeEntry: async entry => {
      events.push(`materialize:${entry.version}`);
      return `/fake/${entry.version}`;
    },
    runEntry: async (entry, sourceRoot) => {
      events.push(`run:${entry.version}:${sourceRoot}`);
    },
    freezeEntry: async entry => {
      events.push(`freeze:${entry.version}`);
    },
    cleanupEntry: async entry => {
      events.push(`cleanup:${entry.version}`);
    },
  });

  assert.deepEqual(events, [
    'materialize:baseline', 'run:baseline:/fake/baseline', 'cleanup:baseline',
    'materialize:0.0.1', 'run:0.0.1:/fake/0.0.1', 'freeze:0.0.1', 'cleanup:0.0.1',
    'materialize:0.0.2', 'run:0.0.2:/fake/0.0.2', 'cleanup:0.0.2',
  ]);
});

// Scenario: an extracted retained-history file differs from the release manifest.
// Purpose: fail closed before restored history can be used by the candidate build or lifecycle tests.
test('UnitT10_restore-rejects-a-retained-file-with-a-sha256-mismatch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'w01-history-hash-'));
  try {
    await mkdir(path.join(root, 'dist-w01'), { recursive: true });
    await writeFile(path.join(root, 'dist-w01', 'receipt.json'), 'tampered', 'utf8');

    await assert.rejects(
      verifyRetainedFiles(root, [{
        path: 'dist-w01/receipt.json',
        sizeBytes: 8,
        sha256: '0'.repeat(64),
      }]),
      /SHA-256 mismatch.*dist-w01\/receipt\.json/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Scenario: the fixed retained-history release does not exist yet.
// Purpose: automatically rebuild all history and report the fallback instead of silently accepting incomplete state.
test('UnitT20_missing-release-falls-back-to-a-full-rebuild', async () => {
  const events = [];
  const result = await prepareRetainedHistory({
    forceRebuild: false,
    downloadRelease: async () => ({ found: false }),
    restoreRelease: async () => events.push('restore'),
    rebuild: async () => events.push('rebuild'),
  });

  assert.deepEqual(events, ['rebuild']);
  assert.deepEqual(result, { mode: 'rebuild', reason: 'release-not-found' });
});
