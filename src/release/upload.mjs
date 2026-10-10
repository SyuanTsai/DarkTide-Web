import { verifyReleaseArtifactBytes } from './verify.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function snapshotBytes(value, label) {
  if (typeof value === 'string') return encoder.encode(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  throw new Error(`${label} must be a string or Uint8Array`);
}

function sameBytes(left, right) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

async function readBytes(bucket, key) {
  const object = await bucket.get(key);
  if (!object || typeof object.arrayBuffer !== 'function') throw new Error(`missing R2 object: ${key}`);
  return new Uint8Array(await object.arrayBuffer());
}

async function readStaticFiles(bucket, prefix, manifest) {
  const files = new Map();
  for (const entry of manifest.files) {
    files.set(entry.path, await readBytes(bucket, `${prefix}${entry.path}`));
  }
  return files;
}

// Requires a complete, separately approved manifest. This only uploads and verifies
// an immutable release prefix; it never changes the active Worker binding.
export async function uploadVerifiedRelease({ manifestBytes, files, workerBytes,
  expectedReleaseId, bucket } = {}) {
  const manifestSnapshot = snapshotBytes(manifestBytes, 'release manifest');
  if (!(files instanceof Map)) throw new Error('release files must be a Map');
  const fileSnapshots = new Map([...files].map(([path, bytes]) => [
    path, snapshotBytes(bytes, `file ${path}`)
  ]));
  const workerSnapshot = snapshotBytes(workerBytes, 'Worker bundle');
  if (!bucket || typeof bucket.get !== 'function' || typeof bucket.put !== 'function') {
    throw new Error('R2 bucket must provide get and put');
  }
  await verifyReleaseArtifactBytes({
    manifestBytes: manifestSnapshot, files: fileSnapshots,
    workerBytes: workerSnapshot, expectedReleaseId
  });
  const manifest = JSON.parse(decoder.decode(manifestSnapshot));
  const prefix = `releases/${manifest.release_id}/`;
  const manifestKey = `${prefix}build-manifest.json`;
  const existing = await bucket.get(manifestKey);
  if (existing) {
    if (typeof existing.arrayBuffer !== 'function' ||
        !sameBytes(new Uint8Array(await existing.arrayBuffer()), manifestSnapshot)) {
      throw new Error('existing release manifest conflict');
    }
    const remoteFiles = await readStaticFiles(bucket, prefix, manifest);
    await verifyReleaseArtifactBytes({
      manifestBytes: manifestSnapshot, files: remoteFiles,
      workerBytes: workerSnapshot, expectedReleaseId
    });
    return { release_id: manifest.release_id, file_count: manifest.files.length, upload_state: 'existing' };
  }

  const onlyIf = new Headers({ 'If-None-Match': '*' });
  for (const entry of manifest.files) {
    const key = `${prefix}${entry.path}`;
    const bytes = fileSnapshots.get(entry.path);
    const result = await bucket.put(key, bytes, {
      onlyIf, httpMetadata: { contentType: entry.content_type }
    });
    if (result === null && !sameBytes(await readBytes(bucket, key), bytes)) {
      throw new Error(`existing release object conflict: ${entry.path}`);
    }
    if (result === undefined) throw new Error(`R2 upload result missing: ${entry.path}`);
  }
  const remoteFiles = await readStaticFiles(bucket, prefix, manifest);
  await verifyReleaseArtifactBytes({
    manifestBytes: manifestSnapshot, files: remoteFiles,
    workerBytes: workerSnapshot, expectedReleaseId
  });
  const manifestResult = await bucket.put(manifestKey, manifestSnapshot, {
    onlyIf, httpMetadata: { contentType: 'application/json; charset=utf-8' }
  });
  if (manifestResult === undefined) throw new Error('R2 manifest upload result missing');
  if (!sameBytes(await readBytes(bucket, manifestKey), manifestSnapshot)) {
    throw new Error('release manifest readback mismatch');
  }
  return { release_id: manifest.release_id, file_count: manifest.files.length,
    upload_state: manifestResult === null ? 'existing' : 'created' };
}
