import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { validGitSourcePath } from './source-path.mjs';

const run = promisify(execFile);
const commitPattern = /^[a-f0-9]{40}$/;
const shaPattern = /^[a-f0-9]{64}$/;
const sourceIdPattern = /^[a-z][a-z0-9._-]{0,127}$/;

async function git(checkout, ...arguments_) {
  const { stdout } = await run('git', ['-C', checkout, ...arguments_], {
    encoding: 'buffer', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' }
  });
  return stdout;
}

function validLock(lock) {
  if (lock?.kind !== 'git_file' || !sourceIdPattern.test(lock.source_id ?? '') ||
      typeof lock.repository_url !== 'string' || !lock.repository_url.startsWith('https://') ||
      !commitPattern.test(lock.commit_sha ?? '') || !shaPattern.test(lock.sha256 ?? '') ||
      !validGitSourcePath(lock.path)) {
    throw new Error(`invalid Git source path or lock: ${lock?.source_id}`);
  }
}

function originMatches(expected, actual) {
  if (actual === expected) return true;
  if (!expected.startsWith('https://github.com/')) return false;
  return actual === `git@github.com:${expected.slice('https://github.com/'.length)}`;
}

// Reads local Git objects only. External image bytes remain a separate, manual input.
export async function loadGitSourceBytes(sourceLocks, checkouts) {
  if (!Array.isArray(sourceLocks) || !(checkouts instanceof Map)) {
    throw new Error('Git source locks and checkout map are required');
  }
  const bytesById = new Map();
  const verifiedOrigins = new Set();
  for (const lock of sourceLocks) {
    if (lock?.kind !== 'git_file') continue;
    validLock(lock);
    if (bytesById.has(lock.source_id)) throw new Error(`duplicate Git source ID: ${lock.source_id}`);
    const checkout = checkouts.get(lock.repository_url);
    if (typeof checkout !== 'string' || !isAbsolute(checkout)) {
      throw new Error(`missing absolute checkout for Git source: ${lock.source_id}`);
    }
    if (!verifiedOrigins.has(lock.repository_url)) {
      let origin;
      try { origin = (await git(checkout, 'config', '--get', 'remote.origin.url')).toString('utf8').trim(); }
      catch { throw new Error(`Git checkout origin is unavailable: ${lock.source_id}`); }
      if (!originMatches(lock.repository_url, origin)) throw new Error(`Git checkout origin mismatch: ${lock.source_id}`);
      verifiedOrigins.add(lock.repository_url);
    }
    let bytes;
    try {
      const kind = (await git(checkout, 'cat-file', '-t', lock.commit_sha)).toString('utf8').trim();
      if (kind !== 'commit') throw new Error('not a commit');
      const expression = `${lock.commit_sha}:${lock.path}`;
      const objectKind = (await git(checkout, 'cat-file', '-t', expression)).toString('utf8').trim();
      if (objectKind !== 'blob') throw new Error('not a blob');
      bytes = await git(checkout, 'cat-file', 'blob', expression);
    } catch {
      throw new Error(`Git blob is unavailable at locked commit and path: ${lock.source_id}`);
    }
    if (createHash('sha256').update(bytes).digest('hex') !== lock.sha256) {
      throw new Error(`Git blob hash mismatch: ${lock.source_id}`);
    }
    bytesById.set(lock.source_id, new Uint8Array(bytes));
  }
  return bytesById;
}
