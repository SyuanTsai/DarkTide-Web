import { validateReleaseManifest } from './manifest.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function snapshotBytes(value, label) {
  if (typeof value === 'string') return encoder.encode(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  throw new Error(`${label} must be a string or Uint8Array`);
}

async function digest(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(part => part.toString(16).padStart(2, '0')).join('');
}

// Checks an already approved manifest against the exact bytes supplied for upload.
// It does not approve content or change the manifest's validation state.
export async function verifyReleaseArtifactBytes({ manifestBytes, files, workerBytes, expectedReleaseId } = {}) {
  const manifestSnapshot = snapshotBytes(manifestBytes, 'release manifest');
  if (!(files instanceof Map)) throw new Error('release files must be a Map');
  const fileSnapshots = new Map([...files].map(([path, bytes]) => [
    path, snapshotBytes(bytes, `file ${path}`)
  ]));
  const workerSnapshot = snapshotBytes(workerBytes, 'Worker bundle');
  let manifest;
  try {
    manifest = JSON.parse(decoder.decode(manifestSnapshot));
  } catch {
    throw new Error('release manifest JSON is invalid');
  }
  await validateReleaseManifest(manifest, expectedReleaseId);

  const listedPaths = new Set(manifest.files.map(file => file.path));
  for (const file of manifest.files) {
    if (!fileSnapshots.has(file.path)) throw new Error(`missing release file: ${file.path}`);
  }
  for (const path of fileSnapshots.keys()) {
    if (!listedPaths.has(path)) throw new Error(`extra release file: ${path}`);
  }
  for (const file of manifest.files) {
    const bytes = fileSnapshots.get(file.path);
    if (bytes.byteLength !== file.raw_bytes || await digest(bytes) !== file.sha256) {
      throw new Error(`release file ${file.path} byte mismatch`);
    }
  }
  if (workerSnapshot.byteLength !== manifest.worker.raw_bytes ||
      await digest(workerSnapshot) !== manifest.worker.sha256) {
    throw new Error('Worker bundle byte mismatch');
  }
  return {
    release_id: manifest.release_id,
    file_count: manifest.totals.file_count,
    raw_bytes: manifest.totals.raw_bytes,
    worker_sha256: manifest.worker.sha256
  };
}
