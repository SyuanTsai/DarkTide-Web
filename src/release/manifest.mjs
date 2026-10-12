const shaPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const sourceIdPattern = /^[a-z][a-z0-9._-]{0,127}$/;
const releaseIdPattern = /^sha256:[a-f0-9]{64}$/;
const filePathPattern = /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:html|css|js|svg|png|webp)$/;
const workerPathPattern = /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:js|mjs)$/;

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) {
    throw new Error(`${label} has missing or unknown fields`);
  }
}

// The manifest preimage uses the RFC 8785 ordering and JSON number rules for
// its restricted domain: strings, booleans, null, safe integers, arrays, objects.
// Decimal game values remain strings; noninteger JSON numbers are rejected.
export function canonicalize(value) {
  const seen = new WeakSet();
  function encode(current) {
    if (current === null || typeof current === 'boolean') return JSON.stringify(current);
    if (typeof current === 'string') return JSON.stringify(current.normalize('NFC'));
    if (typeof current === 'number') {
      if (!Number.isSafeInteger(current)) throw new Error('canonical JSON requires safe integers');
      return JSON.stringify(current);
    }
    if (!current || typeof current !== 'object') throw new Error('unsupported canonical JSON value');
    if (seen.has(current)) throw new Error('cyclic canonical JSON value');
    seen.add(current);
    if (Array.isArray(current)) {
      const encoded = `[${current.map(encode).join(',')}]`;
      seen.delete(current);
      return encoded;
    }
    const pairs = new Map();
    for (const [key, item] of Object.entries(current)) {
      const normalized = key.normalize('NFC');
      if (pairs.has(normalized)) throw new Error('duplicate normalized canonical JSON key');
      pairs.set(normalized, item);
    }
    const encoded = `{${[...pairs.keys()].sort().map(key => `${JSON.stringify(key)}:${encode(pairs.get(key))}`).join(',')}}`;
    seen.delete(current);
    return encoded;
  }
  return encode(value);
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function releasePreimage(manifest) {
  return {
    schema_version: manifest.schema_version,
    files: manifest.files,
    worker_sha256: manifest.worker.sha256,
    source_lock_ids: manifest.source_lock_ids,
    source_lock_digest: manifest.source_lock_digest,
    rights_ledger_digest: manifest.rights_ledger_digest,
    taxonomy_sha256: manifest.taxonomy_sha256,
    field_requirement_sha256: manifest.field_requirement_sha256,
    tool_commit_sha: manifest.tool_commit_sha
  };
}

export async function computeReleaseId(manifest) {
  return `sha256:${await sha256Hex(canonicalize(releasePreimage(manifest)))}`;
}

export async function createFixtureManifest(files) {
  const entries = {};
  let totalBytes = 0;
  for (const [path, content] of files) {
    if (!filePathPattern.test(path)) throw new Error(`invalid output path: ${path}`);
    const bytes = new TextEncoder().encode(content);
    entries[path] = { sha256: await sha256Hex(content), bytes: bytes.length };
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

export async function validateReleaseManifest(manifest, expectedReleaseId) {
  exactKeys(manifest, [
    'schema_version', 'package_kind', 'release_id', 'source_lock_ids', 'source_lock_digest',
    'rights_ledger_digest', 'taxonomy_sha256', 'field_requirement_sha256', 'tool_commit_sha',
    'files', 'worker', 'totals', 'validation'
  ], 'release manifest');
  if (manifest.schema_version !== 1 || manifest.package_kind !== 'release' ||
      !releaseIdPattern.test(manifest.release_id) || manifest.release_id !== expectedReleaseId) {
    throw new Error('release identity is invalid');
  }
  if (!Array.isArray(manifest.source_lock_ids) || manifest.source_lock_ids.length === 0 ||
      manifest.source_lock_ids.some(id => typeof id !== 'string' || !sourceIdPattern.test(id)) ||
      manifest.source_lock_ids.some((id, index) => index > 0 && manifest.source_lock_ids[index - 1] >= id)) {
    throw new Error('source lock IDs must be nonempty, unique, and sorted');
  }
  for (const field of ['source_lock_digest', 'rights_ledger_digest', 'taxonomy_sha256', 'field_requirement_sha256']) {
    if (typeof manifest[field] !== 'string' || !shaPattern.test(manifest[field])) throw new Error(`invalid ${field}`);
  }
  if (typeof manifest.tool_commit_sha !== 'string' || !commitPattern.test(manifest.tool_commit_sha)) {
    throw new Error('invalid tool commit SHA');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('release files are missing');
  let totalBytes = 0;
  let previousPath = '';
  for (const file of manifest.files) {
    exactKeys(file, ['path', 'raw_bytes', 'sha256', 'content_type'], 'release file');
    if (typeof file.path !== 'string' || !filePathPattern.test(file.path) || file.path === 'build-manifest.json') {
      throw new Error(`invalid release path: ${file.path}`);
    }
    if (previousPath >= file.path) throw new Error('release files must be unique and sorted');
    previousPath = file.path;
    if (!Number.isSafeInteger(file.raw_bytes) || file.raw_bytes < 0 || !shaPattern.test(file.sha256) ||
        typeof file.content_type !== 'string' || !/^[a-z]+\/[a-z0-9.+-]+(?:; charset=utf-8)?$/.test(file.content_type)) {
      throw new Error(`invalid release file metadata: ${file.path}`);
    }
    totalBytes += file.raw_bytes;
    if (!Number.isSafeInteger(totalBytes)) throw new Error('release total bytes overflow');
  }
  if (!manifest.files.some(file => file.path === 'index.html')) throw new Error('release homepage is missing');
  exactKeys(manifest.worker, ['path', 'raw_bytes', 'sha256'], 'worker');
  if (typeof manifest.worker.path !== 'string' || !workerPathPattern.test(manifest.worker.path) ||
      !Number.isSafeInteger(manifest.worker.raw_bytes) || manifest.worker.raw_bytes < 0 ||
      !shaPattern.test(manifest.worker.sha256)) throw new Error('invalid worker bundle');
  exactKeys(manifest.totals, ['file_count', 'raw_bytes'], 'release totals');
  if (manifest.totals.file_count !== manifest.files.length || manifest.totals.raw_bytes !== totalBytes) {
    throw new Error('release totals do not match file entries');
  }
  exactKeys(manifest.validation, ['complete', 'checks'], 'release validation');
  if (manifest.validation.complete !== true || !Array.isArray(manifest.validation.checks) ||
      manifest.validation.checks.length === 0 || new Set(manifest.validation.checks).size !== manifest.validation.checks.length ||
      manifest.validation.checks.some(check => typeof check !== 'string' || !/^[a-z][a-z0-9-]*-v[0-9]+$/.test(check))) {
    throw new Error('release validation is incomplete');
  }
  if (await computeReleaseId(manifest) !== manifest.release_id) throw new Error('release ID mismatch');
  return manifest;
}
