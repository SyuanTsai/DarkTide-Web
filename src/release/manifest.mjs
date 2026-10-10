const releaseIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const sourceIdPattern = /^[a-z][a-z0-9._-]{0,127}$/;
const filePathPattern = /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:html|css|js|svg|png|webp)$/;
const shaPattern = /^[a-f0-9]{64}$/;

export async function createFixtureManifest(files) {
  const entries = {};
  let totalBytes = 0;
  for (const [path, content] of files) {
    if (!filePathPattern.test(path)) throw new Error(`invalid output path: ${path}`);
    const bytes = new TextEncoder().encode(content);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    entries[path] = { sha256, bytes: bytes.length };
    totalBytes += bytes.length;
  }
  return {
    schema_version: 1,
    package_kind: 'fixture',
    release_ready: false,
    release_id: null,
    source_lock_ids: [],
    total_files: files.size,
    total_bytes: totalBytes,
    files: entries
  };
}

export function validateReleaseManifest(manifest, expectedReleaseId) {
  if (!releaseIdPattern.test(expectedReleaseId ?? '') || manifest?.schema_version !== 1 ||
      manifest.package_kind !== 'release' || manifest.release_ready !== true || manifest.release_id !== expectedReleaseId) {
    throw new Error('release identity is invalid');
  }
  const sourceIds = manifest.source_lock_ids;
  if (!Array.isArray(sourceIds) || sourceIds.length === 0 || new Set(sourceIds).size !== sourceIds.length ||
      sourceIds.some(id => typeof id !== 'string' || !sourceIdPattern.test(id))) {
    throw new Error('source lock references are invalid');
  }
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('release files are invalid');
  }
  const entries = Object.entries(manifest.files);
  if (!Object.hasOwn(manifest.files, 'index.html')) throw new Error('release homepage is missing');
  let totalBytes = 0;
  for (const [path, entry] of entries) {
    if (!filePathPattern.test(path) || path === 'build-manifest.json') throw new Error(`invalid release path: ${path}`);
    if (!entry || typeof entry !== 'object' || !shaPattern.test(entry.sha256) ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new Error(`invalid release file metadata: ${path}`);
    }
    totalBytes += entry.bytes;
    if (!Number.isSafeInteger(totalBytes)) throw new Error('release total bytes overflow');
  }
  if (manifest.total_files !== entries.length || manifest.total_bytes !== totalBytes) {
    throw new Error('release totals do not match file entries');
  }
  return manifest;
}
