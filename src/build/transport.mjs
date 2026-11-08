import { sha256 } from '../static/common.mjs';
export const SHARD_THRESHOLD = 20 * 1024 * 1024;
export const MAX_OUTPUT_FILE_BYTES = 25 * 1024 * 1024;
const keys = (o, names) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join(',') === names.sort().join(',');
export function createTransport(gameVersion, category, raw, { threshold = SHARD_THRESHOLD, maxBytes = MAX_OUTPUT_FILE_BYTES } = {}) {
  const files = new Map(), parts = [];
  const single = raw.length <= threshold;
  if (raw.length <= maxBytes) files.set(`${category}.json`, raw);
  if (single) parts.push({ index: 1, path: `${category}.json`, offset: 0, sizeBytes: raw.length, sha256: sha256(raw) });
  else for (let offset = 0, index = 1; offset < raw.length; offset += threshold, index++) {
    if (index > 9999) throw new Error('too many transport parts');
    const path = `${category}.part-${String(index).padStart(4, '0')}.bin`, bytes = raw.subarray(offset, offset + threshold);
    files.set(path, bytes); parts.push({ index, path, offset, sizeBytes: bytes.length, sha256: sha256(bytes) });
  }
  return { manifest: { transportSchemaVersion: '1.0.0', representation: single ? 'single' : 'raw-byte-shards', gameVersion, category, totalBytes: raw.length, totalSha256: sha256(raw), parts }, files };
}
export function verifyTransport(manifest, files, gameVersion, category, { threshold = SHARD_THRESHOLD, maxBytes = MAX_OUTPUT_FILE_BYTES } = {}) {
  const fail = () => { throw new Error(`invalid source transport ${gameVersion}/${category}`); };
  if (!keys(manifest,['transportSchemaVersion','representation','gameVersion','category','totalBytes','totalSha256','parts']) || manifest.transportSchemaVersion !== '1.0.0' || manifest.gameVersion !== gameVersion || manifest.category !== category || !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0 || !/^[a-f0-9]{64}$/.test(manifest.totalSha256) || !Array.isArray(manifest.parts)) fail();
  const single = manifest.totalBytes <= threshold;
  if (manifest.representation !== (single ? 'single' : 'raw-byte-shards') || manifest.parts.length !== (single ? 1 : Math.ceil(manifest.totalBytes / threshold)) || manifest.parts.length > 9999) fail();
  let offset = 0; const chunks = [];
  for (const [i, part] of manifest.parts.entries()) {
    const name = single ? `${category}.json` : `${category}.part-${String(i+1).padStart(4,'0')}.bin`;
    const size = single ? manifest.totalBytes : Math.min(threshold, manifest.totalBytes-offset);
    if (!keys(part,['index','path','offset','sizeBytes','sha256']) || part.index !== i+1 || part.path !== name || part.offset !== offset || part.sizeBytes !== size || !/^[a-f0-9]{64}$/.test(part.sha256)) fail();
    const bytes = files.get(name); if (!Buffer.isBuffer(bytes) || bytes.length !== size || sha256(bytes) !== part.sha256) fail();
    chunks.push(bytes); offset += size;
  }
  const raw = Buffer.concat(chunks); if (raw.length !== manifest.totalBytes || sha256(raw) !== manifest.totalSha256) fail();
  const legacy = files.get(`${category}.json`);
  if ((raw.length <= maxBytes) !== Boolean(legacy) || (legacy && !legacy.equals(raw))) fail();
  return raw;
}
