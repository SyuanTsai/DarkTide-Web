import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertChildPath, assertExactKeys, jsonBytes, parseJson, safeRelativePath, sha256 } from '../src/static/common.mjs';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_ORIGIN = 'https://darktide-zh-tw-preview.syuan-tsai.workers.dev';
const DOMAIN_KINDS = ['skills', 'blessings', 'weapons', 'terms', 'game-changes'];
const CONTENT_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function fail(message) {
  throw new Error(message);
}

async function readArtifactFile(outputRoot, name) {
  const relative = safeRelativePath(name, 'W01 artifact path');
  const absolute = assertChildPath(outputRoot, path.join(outputRoot, ...relative.split('/')), 'W01 artifact file');
  const info = await lstat(absolute);
  if (info.isSymbolicLink() || !info.isFile()) fail('W01 artifact path must be a regular file: ' + relative);
  return readFile(absolute);
}

function validateRows(rows, label) {
  if (!Array.isArray(rows)) fail(label + ' must be an array');
  return rows.map((row, index) => {
    assertExactKeys(row, ['path', 'sizeBytes', 'sha256'], label + '[' + index + ']');
    const rowPath = safeRelativePath(row.path, label + '[' + index + '].path');
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0 || !/^[a-f0-9]{64}$/.test(row.sha256)) {
      fail(label + '[' + index + '] has invalid size or SHA-256');
    }
    return { path: rowPath, sizeBytes: row.sizeBytes, sha256: row.sha256 };
  }).sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

async function fetchVerified(fetchImpl, pathname, expectedBytes, label) {
  const url = new URL(pathname, PREVIEW_ORIGIN + '/');
  if (url.origin !== PREVIEW_ORIGIN || !url.pathname.startsWith('/')) fail(label + ' URL is outside the fixed W01 preview origin');
  const response = await fetchImpl(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (response.status !== 200) fail(label + ' returned HTTP ' + response.status);
  const robots = response.headers.get('x-robots-tag') ?? '';
  if (!robots.toLowerCase().includes('noindex')) fail(label + ' is missing the preview noindex response header');
  if (response.headers.get('access-control-allow-origin') !== '*') fail(label + ' is missing the preview CORS response header');
  const actualBytes = Buffer.from(await response.arrayBuffer());
  if (actualBytes.byteLength !== expectedBytes.byteLength || sha256(actualBytes) !== sha256(expectedBytes)) {
    fail(label + ' bytes do not match the verified local preview package');
  }
  return { status: response.status, robots, cors: response.headers.get('access-control-allow-origin') };
}

export async function createDeploymentReceipt({ repoRoot = SCRIPT_ROOT, outputRoot = path.join(repoRoot, 'dist-w01'), receiptPath, fetchImpl = fetch, createdAt = new Date().toISOString() } = {}) {
  if (typeof receiptPath !== 'string' || receiptPath.length === 0) fail('receiptPath is required');
  repoRoot = path.resolve(repoRoot);
  outputRoot = path.resolve(outputRoot);
  const receipt = parseJson(await readArtifactFile(outputRoot, 'receipt.json'), 'W01 build receipt');
  const baseReceiptKeys = ['schemaVersion', 'requestKind', 'buildId', 'dataRevision', 'contentVersion', 'manifestPath', 'manifestSha256', 'source', 'web', 'fixtureOnly', 'publicationEligible', 'formalPublishAllowed', 'deploymentPerformed', 'files', 'retainedData'];
  const hasCandidatePreviewFlag = Object.hasOwn(receipt, 'candidatePreviewOnly');
  assertExactKeys(receipt, [...baseReceiptKeys, ...(hasCandidatePreviewFlag ? ['candidatePreviewOnly'] : [])], 'W01 build receipt');
  const isFixturePreview = receipt.fixtureOnly === true && !hasCandidatePreviewFlag;
  const isPendingCandidate = receipt.fixtureOnly === false && hasCandidatePreviewFlag && receipt.candidatePreviewOnly === true;
  if (receipt.schemaVersion !== '1.0.0' || receipt.requestKind !== 'isolated-w01-preview-build' ||
      (!isFixturePreview && !isPendingCandidate) || receipt.publicationEligible !== false || receipt.formalPublishAllowed !== false ||
      receipt.deploymentPerformed !== false || !CONTENT_VERSION_PATTERN.test(receipt.contentVersion)) {
    fail('W01 receipt is not a versioned, quarantined preview build');
  }
  const localVersionBytes = await readArtifactFile(outputRoot, 'version.json');
  const version = parseJson(localVersionBytes, 'W01 version.json');
  if (version.build_id !== receipt.buildId || version.data_revision !== receipt.dataRevision ||
      version.package_kind !== (isPendingCandidate ? 'pending-preview' : 'fixture') || version.game_releases?.length !== 1 ||
      version.game_releases[0].content_version !== receipt.contentVersion) {
    fail('W01 version.json does not match its local receipt');
  }
  const manifestBytes = await readArtifactFile(outputRoot, receipt.manifestPath);
  if (sha256(manifestBytes) !== receipt.manifestSha256) fail('local W01 manifest does not match its receipt');
  const manifest = parseJson(manifestBytes, 'W01 manifest');
  if (manifest.dataRevision !== receipt.dataRevision || manifest.contentVersion !== receipt.contentVersion ||
      manifest.fixtureOnly !== isFixturePreview || manifest.publicationEligible !== false || manifest.files?.length !== DOMAIN_KINDS.length) {
    fail('local W01 manifest does not match the selected quarantined preview mode');
  }
  const remoteChecks = [];
  remoteChecks.push(await fetchVerified(fetchImpl, '/version.json', localVersionBytes, 'version.json'));
  remoteChecks.push(await fetchVerified(fetchImpl, version.game_releases[0].manifest_path, manifestBytes, 'manifest'));
  for (const [index, file] of manifest.files.entries()) {
    if (file.kind !== DOMAIN_KINDS[index] || file.path !== file.kind + '.json' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      fail('W01 manifest does not contain the exact ordered shared domains');
    }
    const localBytes = await readArtifactFile(outputRoot, 'data/' + receipt.dataRevision + '/' + file.path);
    if (sha256(localBytes) !== file.sha256) fail('local W01 domain hash does not match manifest: ' + file.kind);
    remoteChecks.push(await fetchVerified(fetchImpl, '/data/' + receipt.dataRevision + '/' + file.path, localBytes, file.kind));
  }

  const retainedManifest = parseJson(await readFile(path.join(repoRoot, 'docs', 'w01', 'retained-preview-manifest.json')), 'pinned retained preview manifest');
  assertExactKeys(retainedManifest, ['schemaVersion', 'baselineCommit', 'dataRevision', 'fileCount', 'totalBytes', 'files'], 'pinned retained preview manifest');
  const retainedRows = validateRows(retainedManifest.files, 'pinned retained preview manifest.files');
  const receiptRows = validateRows(receipt.files, 'W01 receipt.files');
  const actualRetainedRows = receiptRows.filter(row => row.path.startsWith('data/' + retainedManifest.dataRevision + '/'));
  if (retainedManifest.schemaVersion !== '1.0.0' || retainedRows.length !== retainedManifest.fileCount ||
      retainedRows.reduce((sum, row) => sum + row.sizeBytes, 0) !== retainedManifest.totalBytes ||
      JSON.stringify(actualRetainedRows) !== JSON.stringify(retainedRows) ||
      receipt.retainedData?.dataRevision !== retainedManifest.dataRevision ||
      receipt.retainedData?.baselineCommit !== retainedManifest.baselineCommit ||
      receipt.retainedData?.fileCount !== retainedManifest.fileCount ||
      receipt.retainedData?.totalBytes !== retainedManifest.totalBytes ||
      receipt.retainedData?.inventorySha256 !== sha256(jsonBytes(retainedManifest))) {
    fail('W01 receipt does not include the exact pinned baseline data subtree');
  }
  const retainedSample = retainedRows[0];
  const retainedBytes = await readArtifactFile(outputRoot, retainedSample.path);
  if (retainedBytes.byteLength !== retainedSample.sizeBytes || sha256(retainedBytes) !== retainedSample.sha256) {
    fail('local retained baseline sample does not match its pinned hash');
  }
  remoteChecks.push(await fetchVerified(fetchImpl, '/' + retainedSample.path, retainedBytes, 'retained baseline data'));

  const result = {
    schemaVersion: '1.0.0',
    requestKind: 'w01-preview-deployment-receipt',
    deploymentPerformed: true,
    repository: 'SyuanTsai/DarkTide-Web',
    branch: 'codex/SYP-311-w01',
    commit: process.env.GITHUB_SHA ?? null,
    origin: PREVIEW_ORIGIN,
    contentVersion: receipt.contentVersion,
    packageKind: version.package_kind,
    candidatePreviewOnly: isPendingCandidate,
    buildId: receipt.buildId,
    dataRevision: receipt.dataRevision,
    manifestPath: receipt.manifestPath,
    manifestSha256: receipt.manifestSha256,
    verifiedRemoteObjects: remoteChecks.length,
    retainedBaseline: {
      commit: retainedManifest.baselineCommit,
      dataRevision: retainedManifest.dataRevision,
      fileCount: retainedManifest.fileCount,
      samplePath: retainedSample.path,
      sampleSha256: retainedSample.sha256
    },
    createdAt
  };
  const absoluteReceiptPath = path.resolve(receiptPath);
  await mkdir(path.dirname(absoluteReceiptPath), { recursive: true });
  await writeFile(absoluteReceiptPath, jsonBytes(result), { flag: 'wx' });
  return result;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--output' && !options.receiptPath && args[index + 1]) options.receiptPath = args[++index];
    else fail('Usage: node scripts/w01-preview-deployment-receipt.mjs --output receipt.json');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await createDeploymentReceipt(parseArgs(process.argv.slice(2)));
    process.stdout.write('Verified W01 preview deployment content_version=' + result.contentVersion +
      ' data_revision=' + result.dataRevision + ' remote_objects=' + result.verifiedRemoteObjects + '\n');
  } catch (error) {
    process.stderr.write('W01 preview deployment receipt failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = 1;
  }
}
