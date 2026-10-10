import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGitSourceBytes } from '../src/content/git-source.mjs';

const checkout = dirname(dirname(fileURLToPath(import.meta.url)));
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
const origin = git('config', '--get', 'remote.origin.url');
const remote = origin.startsWith('git@github.com:')
  ? `https://github.com/${origin.slice('git@github.com:'.length)}` : origin;
const commit = git('rev-parse', 'HEAD');
const bytes = execFileSync('git', ['-C', checkout, 'cat-file', 'blob', `${commit}:README.md`]);
const sha = value => createHash('sha256').update(value).digest('hex');
const lock = () => ({
  source_id: 'site-readme', kind: 'git_file', repository_url: remote,
  commit_sha: commit, path: 'README.md', sha256: sha(bytes)
});

// Scenario: A lock identifies a byte-exact file at this checkout's fixed commit.
// Purpose: Populate source bytes from a real Git blob instead of a caller's arbitrary byte map.
test('InterT10_reads_and_hashes_exact_git_blob_bytes', async () => {
  const loaded = await loadGitSourceBytes([lock()], new Map([[remote, checkout]]));
  assert.deepEqual(loaded.get('site-readme'), new Uint8Array(bytes));
});

// Scenario: A checkout origin or blob digest differs from the locked source.
// Purpose: Reject a checkout or file that does not represent the locked source.
test('InterT20_rejects_origin_or_blob_hash_mismatch', async () => {
  const wrongRemote = 'https://example.test/other.git';
  await assert.rejects(() => loadGitSourceBytes([{ ...lock(), repository_url: wrongRemote }],
    new Map([[wrongRemote, checkout]])), /origin.*mismatch/i);
  await assert.rejects(() => loadGitSourceBytes([{ ...lock(), sha256: '0'.repeat(64) }],
    new Map([[remote, checkout]])), /hash.*mismatch/i);
});

// Scenario: A lock requests a nonexistent commit, an escaping path, or a tree object.
// Purpose: Accept only an existing regular Git blob under the fixed commit.
test('InterT30_rejects_missing_commit_unsafe_path_or_tree', async () => {
  const checkouts = new Map([[remote, checkout]]);
  await assert.rejects(() => loadGitSourceBytes([{ ...lock(), commit_sha: '0'.repeat(40) }], checkouts), /git blob/i);
  await assert.rejects(() => loadGitSourceBytes([{ ...lock(), path: '../README.md' }], checkouts), /path/i);
  await assert.rejects(() => loadGitSourceBytes([{ ...lock(), path: 'src' }], checkouts), /git blob/i);
});

// Scenario: A safe Git path has a space inside a directory name but no matching blob.
// Purpose: Reach Git object lookup rather than rejecting the real repository path shape.
test('InterT40_accepts_spaced_git_path_syntax_before_object_lookup', async () => {
  await assert.rejects(() => loadGitSourceBytes([{ ...lock(), path: 'Game Info/missing.md' }],
    new Map([[remote, checkout]])), /git blob/i);
});
