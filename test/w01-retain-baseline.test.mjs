import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertExactDataInventory, copyRetainedData } from '../scripts/w01-retain-baseline.mjs';

const revision = '0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function withTempRoots(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-retain-'));
  const baselineRoot = path.join(root, 'baseline-dist');
  const outputRoot = path.join(root, 'dist-w01');
  try {
    await callback({ root, baselineRoot, outputRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// Scenario: the fixed base checkout produces a row set compared with the saved predeployment whitelist.
// Purpose: changed, missing, extra, or reordered old URL metadata cannot silently pass the retention gate.
test('UnitT00_pinned-baseline-inventory-requires-every-path-size-and-hash', () => {
  const expected = [
    { path: 'data/' + revision + '/catalog.json', sizeBytes: 3, sha256: 'a'.repeat(64) },
    { path: 'data/' + revision + '/details/skill.json', sizeBytes: 4, sha256: 'b'.repeat(64) }
  ];
  assert.equal(assertExactDataInventory([...expected].reverse(), expected).length, 2);
  assert.throws(() => assertExactDataInventory([expected[0]], expected), /path\/size\/hash inventory/);
  assert.throws(() => assertExactDataInventory([{ ...expected[0], sha256: 'c'.repeat(64) }, expected[1]], expected), /path\/size\/hash inventory/);
});

// Scenario: the exact historical data files are present in the pinned base build.
// Purpose: the W01 output keeps the old immutable URLs byte-for-byte and a repeated retention pass is a no-op.
test('UnitT10_retains_exact_old_data_bytes_without_overwriting_them', async () => {
  await withTempRoots(async ({ baselineRoot, outputRoot }) => {
    const bytes = Buffer.from('old-public-data');
    const row = {
      path: 'data/' + revision + '/catalog.json',
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes)
    };
    const baselineFile = path.join(baselineRoot, ...row.path.split('/'));
    await mkdir(path.dirname(baselineFile), { recursive: true });
    await writeFile(baselineFile, bytes);
    const first = await copyRetainedData({ baselineRoot, outputRoot, files: [row] });
    const destinationFile = path.join(outputRoot, ...row.path.split('/'));
    const second = await copyRetainedData({ baselineRoot, outputRoot, files: [row] });
    assert.deepEqual(first, second);
    assert.deepEqual(await readFile(destinationFile), bytes);
  });
});

// Scenario: the pinned base build or destination contains changed bytes for an old URL.
// Purpose: retention fails before replacing or introducing any mismatched public data.
test('UnitT20_retention-rejects-mismatch-without-partial-output', async () => {
  await withTempRoots(async ({ baselineRoot, outputRoot }) => {
    const expected = Buffer.from('expected');
    const row = {
      path: 'data/' + revision + '/catalog.json',
      sizeBytes: expected.byteLength,
      sha256: sha256(expected)
    };
    const baselineFile = path.join(baselineRoot, ...row.path.split('/'));
    await mkdir(path.dirname(baselineFile), { recursive: true });
    await writeFile(baselineFile, Buffer.from('changed!'));
    await assert.rejects(copyRetainedData({ baselineRoot, outputRoot, files: [row] }), /does not match pinned hash\/size/);
    await assert.rejects(readFile(path.join(outputRoot, ...row.path.split('/'))), { code: 'ENOENT' });
  });
});