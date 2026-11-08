import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport, verifyTransport, SHARD_THRESHOLD, MAX_OUTPUT_FILE_BYTES } from '../src/build/transport.mjs';
const options = { threshold: 4, maxBytes: 6 };
const create = bytes => createTransport('1.2.3', 'weapons', bytes, options);
const verify = ({manifest, files}) => verifyTransport(manifest, files, '1.2.3', 'weapons', options);
const fixture = () => create(Buffer.from('abcdefgh'));
// Scenario: Input sizes straddle both transport limits. Purpose: Preserve the exact representation and legacy availability at each boundary.
test('UnitT10_transport_boundaries_and_default_constants', () => {
  assert.equal(SHARD_THRESHOLD, 20971520); assert.equal(MAX_OUTPUT_FILE_BYTES, 26214400);
  for (const [size, representation, legacy, count] of [[4,'single',true,1],[5,'raw-byte-shards',true,2],[6,'raw-byte-shards',true,2],[7,'raw-byte-shards',false,2]]) {
    const result = create(Buffer.alloc(size, 65));
    assert.equal(result.manifest.representation, representation); assert.equal(result.files.has('weapons.json'), legacy); assert.equal(result.manifest.parts.length, count);
    assert.deepEqual(verify(result), Buffer.alloc(size, 65));
  }
});
// Scenario: BOM, CRLF and a multibyte character cross a byte boundary. Purpose: Prove byte preservation and deterministic output without decoding.
test('UnitT20_transport_preserves_bytes_and_is_deterministic', () => {
  const bytes = Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), Buffer.from('中\r\n')]);
  const a = create(bytes), b = create(bytes);
  assert.deepEqual(a, b); assert.deepEqual(verify(a), bytes);
  assert.deepEqual(a.files.get('weapons.part-0001.bin'), bytes.subarray(0,4));
});
const cases = [
  ['missing part', x => x.files.delete('weapons.part-0002.bin')],
  ['extra manifest part', x => x.manifest.parts.push({...x.manifest.parts[1],index:3})],
  ['duplicate part', x => x.manifest.parts[1] = {...x.manifest.parts[0]}],
  ['reordered parts', x => x.manifest.parts.reverse()],
  ['wrong index', x => x.manifest.parts[0].index = 2],
  ['wrong offset', x => x.manifest.parts[1].offset++],
  ['wrong size', x => x.manifest.parts[0].sizeBytes--],
  ['wrong part hash', x => x.manifest.parts[0].sha256 = '0'.repeat(64)],
  ['wrong total hash', x => x.manifest.totalSha256 = '0'.repeat(64)],
  ['extra manifest key', x => x.manifest.extra = true],
  ['missing manifest key', x => delete x.manifest.category],
  ['extra part key', x => x.manifest.parts[0].extra = true],
  ['missing part key', x => delete x.manifest.parts[0].offset],
  ['wrong representation', x => x.manifest.representation = 'single'],
  ['unexpected legacy', x => x.files.set('weapons.json', Buffer.from('abcdefgh'))],
  ['parent path', x => x.manifest.parts[0].path = '../weapons.part-0001.bin'],
  ['nested path', x => x.manifest.parts[0].path = 'sub/weapons.part-0001.bin'],
];
// Scenario: Each manifest or part invariant is independently corrupted. Purpose: Reject inconsistent and unsafe transport descriptions.
test('UnitT30_transport_rejects_independent_corruptions', async t => {
  for (const [name, mutate] of cases) await t.test(name, () => { const x = fixture(); mutate(x); assert.throws(() => verify(x)); });
});
// Scenario: A permitted legacy copy is missing or differs from the reconstructed bytes. Purpose: Enforce the dual-output contract.
test('UnitT40_transport_rejects_missing_or_different_legacy', () => {
  const missing = create(Buffer.from('abcde')); missing.files.delete('weapons.json'); assert.throws(() => verify(missing));
  const different = create(Buffer.from('abcde')); different.files.set('weapons.json', Buffer.from('xxxxx')); assert.throws(() => verify(different));
});

// Scenario: An extra zero-byte tail has valid index, path, offset, size and hash, preserving total bytes/hash.
// Purpose: Isolate the part-count invariant from every other validation check.
test('UnitT50_transport_rejects_empty_tail_even_when_all_other_checks_match', () => {
  const x = fixture(), empty = Buffer.alloc(0);
  x.manifest.parts.push({ index: 3, path: 'weapons.part-0003.bin', offset: 8, sizeBytes: 0, sha256: create(empty).manifest.totalSha256 });
  x.files.set('weapons.part-0003.bin', empty);
  assert.throws(() => verify(x), /invalid source transport/);
});
