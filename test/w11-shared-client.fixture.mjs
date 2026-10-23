import { createHash } from 'node:crypto';
import { computeDataRevision } from '../scripts/content/contract-release.mjs';

export const TEST_ORIGIN = 'https://web.test';
export const TEST_RELEASE = 'darktide:test-release';
export const TEST_VERSION = '1.13.2';
const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
const CORE_KINDS = ['skills', 'blessings', 'weapons', 'terms'];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const emptyDomain = (kind, presentation = null) => Buffer.from(JSON.stringify({
  schemaVersion: 'w08-shared-domain/1.0.0',
  kind,
  gameReleaseId: TEST_RELEASE,
  source: {
    repository: SOURCE_REPOSITORY,
    gameReleases: [], sourceSnapshots: [], sourceRefs: [], records: [], tombstones: [], reviewReceipts: [],
  },
  web: {
    presentations: presentation ? [presentation] : [],
    officialInputs: { sources: [] },
    termLocalizations: [], termRules: null, announcements: [], gameChanges: [],
    officialTextChanges: [], reviewTargets: [], reviewReceipts: [],
  },
}));

export function makeSharedPackage({ wrongKind = null, extraGameChanges = false, wrongManifestHash = false } = {}) {
  const dataRevisionPlaceholder = 'f'.repeat(64);
  const manifest = {
    schemaVersion: '2.0.0',
    gameReleaseId: TEST_RELEASE,
    gameVersion: TEST_VERSION,
    contentVersion: `${TEST_VERSION}.1`,
    dataRevision: dataRevisionPlaceholder,
    source: {
      repository: SOURCE_REPOSITORY,
      commit: 'a'.repeat(40),
      sourceRevision: 'b'.repeat(64),
      manifestSha256: 'c'.repeat(64),
    },
    web: { authoringCommit: 'd'.repeat(40), compilerCommit: 'e'.repeat(40) },
    compatibility: {
      dataContractMajor: 2,
      requiredFeatures: ['official-errata-details-v1', 'official-native-localizations-v1', 'blessing-tier-presentations-v1'],
      gameSnapshotRefs: ['snapshot-opaque-id'],
    },
    files: [],
    changeIndexPath: null,
  };
  const domainBytes = new Map();
  for (const kind of CORE_KINDS) {
    const presentation = kind === wrongKind ? { locale: 'en', name: 'English must be rejected' } : null;
    const path = `${kind}.json`;
    const bytes = emptyDomain(kind, presentation);
    domainBytes.set(path, bytes);
    manifest.files.push({ kind, path, sizeBytes: bytes.byteLength, sha256: sha256(bytes), dependencies: [] });
  }
  if (extraGameChanges) {
    const path = 'game-changes.json';
    const bytes = emptyDomain('game-changes');
    domainBytes.set(path, bytes);
    manifest.files.push({ kind: 'game-changes', path, sizeBytes: bytes.byteLength, sha256: sha256(bytes), dependencies: [] });
    manifest.changeIndexPath = path;
  }
  manifest.dataRevision = computeDataRevision(manifest);
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const pointer = {
    game_version: TEST_VERSION,
    content_version: manifest.contentVersion,
    data_revision: manifest.dataRevision,
    manifest_path: `/data/${manifest.dataRevision}/manifest.json`,
    manifest_sha256: wrongManifestHash ? '0'.repeat(64) : sha256(manifestBytes),
  };
  const unrelated = {
    game_version: '1.13.3', content_version: '1.13.3.9', data_revision: '9'.repeat(64),
    manifest_path: `/data/${'9'.repeat(64)}/manifest.json`, manifest_sha256: '8'.repeat(64),
  };
  const build = {
    game_version: 'legacy-only-version', data_revision: '7'.repeat(64),
    shared_game_version: TEST_VERSION,
    shared_data_revision: manifest.dataRevision,
    game_releases: [pointer, unrelated],
    shared_files: [
      { path: pointer.manifest_path, size_bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
      ...[...domainBytes].map(([path, bytes]) => ({
        path: `/data/${manifest.dataRevision}/${path}`, size_bytes: bytes.byteLength, sha256: sha256(bytes),
      })),
    ],
  };
  const responses = new Map([[pointer.manifest_path, manifestBytes]]);
  for (const [path, bytes] of domainBytes) responses.set(`/data/${manifest.dataRevision}/${path}`, bytes);
  return { build, pointer, manifest, manifestBytes, domainBytes, responses };
}

export function jsonResponse(url, bytes, { status = 200, contentType = 'application/json; charset=utf-8', redirected = false, finalUrl = url } = {}) {
  const response = new Response(bytes, { status, headers: { 'content-type': contentType } });
  return { status, ok: status >= 200 && status < 300, url: finalUrl, redirected, headers: response.headers, body: response.body };
}

export function installTestLocation(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(TEST_ORIGIN) });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor);
    else delete globalThis.location;
  });
}

export function responseFetch(responses, { calls = [], alter } = {}) {
  return async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url: parsed.href, init });
    const bytes = responses.get(parsed.pathname);
    if (!bytes) return jsonResponse(parsed.href, Buffer.from('{}'), { status: 404 });
    const changed = alter?.(parsed.pathname, Buffer.from(bytes));
    return jsonResponse(parsed.href, changed ?? bytes);
  };
}
