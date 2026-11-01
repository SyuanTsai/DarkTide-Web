import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateW09CompositionInputLock,
  validateW09SelectedComposition,
} from './contract-w09-compose.mjs';

const SELECTED_PATH = 'content/contracts/w09/source-handoff/selected.json';
const LOCK_DIRECTORY = 'content/contracts/w09/source-handoff/locks';
const W08_INPUT_LOCK_PATH = 'content/contracts/w08/compiler-inputs.lock.json';
const W07_AUTHORING_PATH = 'content/authoring/v2/w07-weapons.json';
const SHA256_RE = /^[a-f0-9]{64}$/u;
const COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function readGitText(repositoryRoot, args, label) {
  return execFileSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function readGitBlob(repositoryRoot, revision, relativePath, { allowMissing = false } = {}) {
  if (!COMMIT_RE.test(revision)) throw new TypeError('retained-name scan Git revision must be a full commit SHA');
  if (typeof relativePath !== 'string' || relativePath.includes('\\') || relativePath.startsWith('/')
      || relativePath.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new TypeError('retained-name scan path must be a normalized repository-relative path');
  }
  const entry = readGitText(repositoryRoot, ['ls-tree', revision, '--', relativePath], 'Git tree lookup');
  if (!entry && allowMissing) return null;
  const match = /^([0-7]{6}) blob ([a-f0-9]{40,64})\t(.+)$/u.exec(entry);
  if (!match || !['100644', '100755'].includes(match[1]) || match[3] !== relativePath) {
    throw new Error('retained-name scan requires a regular tracked Git blob: ' + relativePath);
  }
  return execFileSync('git', ['-C', repositoryRoot, 'show', revision + ':' + relativePath], {
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseJson(bytes, label) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(label + ' is not valid UTF-8'); }
  let value;
  try { value = JSON.parse(text); }
  catch (error) { throw new Error(label + ' is not valid JSON: ' + error.message); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(label + ' must be a JSON object');
  return value;
}

function hasRetainedName(value, label) {
  if (!Array.isArray(value.presentations)) throw new TypeError(label + ' must include a presentations array');
  for (const [index, presentation] of value.presentations.entries()) {
    if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation)) {
      throw new TypeError(label + ' presentations[' + index + '] must be an object');
    }
    if (Object.hasOwn(presentation, 'retainedName')) return true;
  }
  return false;
}

function sourceRequestFromLock(lock, selectedRow) {
  return {
    requestId: selectedRow.requestId,
    releaseId: selectedRow.releaseId,
    gameReleaseId: selectedRow.gameReleaseId,
    sourceCommit: lock.source?.sourceCommit,
    sourceRevision: lock.source?.sourceRevision,
    manifestSha256: lock.source?.manifestSha256,
    packetFiles: lock.source?.packetFiles,
  };
}

/**
 * Inspect only fixed Git objects used by the W08 base and selected W09 overlays.
 * Missing selection is allowed; malformed or mismatched pinned inputs fail closed.
 */
export function retainedNameInputsRequired({ repoRoot = process.cwd(), revision = null, readBlob = null } = {}) {
  const repositoryRoot = path.resolve(repoRoot);
  const head = revision ?? readGitText(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}'], 'Git HEAD');
  if (!COMMIT_RE.test(head)) throw new TypeError('retained-name scan revision must be a full commit SHA');
  const blobAt = readBlob ?? ((commit, relativePath, options) => readGitBlob(repositoryRoot, commit, relativePath, options));

  const inputLock = parseJson(blobAt(head, W08_INPUT_LOCK_PATH), 'W08 compiler input lock');
  if (inputLock.schemaVersion !== 'w08-compiler-inputs/1' || !Array.isArray(inputLock.inputFiles)) {
    throw new Error('retained-name scan requires the fixed W08 compiler input lock');
  }
  const authoringRows = inputLock.inputFiles.filter(row => row?.path === W07_AUTHORING_PATH);
  if (authoringRows.length !== 1) throw new Error('W08 input lock must pin exactly one W07 authoring file');
  const baseRow = authoringRows[0];
  if (!Number.isSafeInteger(baseRow.sizeBytes) || baseRow.sizeBytes < 1 || !SHA256_RE.test(baseRow.sha256 ?? '')) {
    throw new Error('W08 W07 authoring input pin is malformed');
  }
  const baseBytes = blobAt(head, W07_AUTHORING_PATH);
  if (baseBytes.byteLength !== baseRow.sizeBytes || sha256(baseBytes) !== baseRow.sha256) {
    throw new Error('W07 authoring bytes differ from the exact W08 input pin');
  }
  if (hasRetainedName(parseJson(baseBytes, 'W07 base authoring'), 'W07 base authoring')) return true;

  const selectedBytes = blobAt(head, SELECTED_PATH, { allowMissing: true });
  if (!selectedBytes) return false;
  const selection = validateW09SelectedComposition(parseJson(selectedBytes, 'selected W09 composition'));
  for (const selectedRow of selection.proposals) {
    const lockPath = LOCK_DIRECTORY + '/' + selectedRow.requestId + '.json';
    const lock = parseJson(blobAt(head, lockPath), 'selected W09 composition input lock');
    validateW09CompositionInputLock(lock, sourceRequestFromLock(lock, selectedRow), {
      archiveSha256: selectedRow.archiveSha256,
    });
    if (lock.source.sourceRevision !== selection.sourceRevision
        || lock.source.manifestSha256 !== selectedRow.manifestSha256) {
      throw new Error('selected W09 composition lock conflicts with its selected Source revision');
    }
    const row = lock.authoringOverlay.find(item => item.mode === 'w07' && item.target === 'authoring');
    if (!row) continue;
    const overlayBytes = blobAt(lock.web.overlayCommit, row.path);
    if (overlayBytes.byteLength !== row.sizeBytes || sha256(overlayBytes) !== row.sha256) {
      throw new Error('selected W07 authoring overlay differs from its exact pinned Git bytes: ' + row.path);
    }
    if (hasRetainedName(parseJson(overlayBytes, 'selected W07 authoring overlay'), 'selected W07 authoring overlay')) return true;
  }
  return false;
}

function cli() {
  const rootIndex = process.argv.indexOf('--repo-root');
  const repositoryRoot = rootIndex === -1 ? process.cwd() : process.argv[rootIndex + 1];
  if (!repositoryRoot || (rootIndex !== -1 && repositoryRoot.startsWith('--'))) {
    throw new Error('--repo-root requires a repository path');
  }
  const required = retainedNameInputsRequired({ repoRoot: repositoryRoot });
  const output = 'required=' + String(required) + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  else process.stdout.write(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
