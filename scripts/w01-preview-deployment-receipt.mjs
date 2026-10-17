import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertChildPath, assertExactKeys, jsonBytes, parseJson, safeRelativePath, sha256 } from '../src/static/common.mjs';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_ORIGIN = 'https://darktide-zh-tw-preview.syuan-tsai.workers.dev';
const DOMAIN_KINDS = ['skills', 'blessings', 'weapons', 'terms', 'game-changes'];
const CONTENT_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const PINNED_PRIOR_CANDIDATE = Object.freeze({
  contentVersion: '0.0.16',
  authoringCommit: 'd0b39c44df0905783d24e1dd1aa5ab0306a18d55',
  buildId: '2765afeaa50f1bad6852c197046cdac8e6df4fd1402c79d54899d22b14616972',
  dataRevision: 'b225a0f02a5ca7e87a407603615e842ade19d230d8448f1e2f01a7dae2536b9a',
  manifestPath: 'data/b225a0f02a5ca7e87a407603615e842ade19d230d8448f1e2f01a7dae2536b9a/manifest.json',
  manifestSha256: 'fb2921e1411658275a3ff110f7804d3ee295a24548d2c8e4289b8bafdfde54a0',
  sourceRepository: 'https://github.com/SyuanTsai/DarkTide-Source-Data',
  sourceCommit: '285a06c8939ac505ac48e4d0e93b939a2b959211',
  sourceRevision: '3af04f0212a88e6b29f91f397178dd6d22c0c27d40566088eca8f8f06d4845c1',
  sourceManifestSha256: '3140d7c5f8f49b2cd9b8574819159079d8542cf165d870af96890ca8efe063d6',
  versionSha256: 'b6aab6c3aa0bec218e3e1e0ca6873e44fb72d94a61d0b0973bf6da7d8b813c30'
});
const PROPAGATION_RETRY_DELAYS_MS = Object.freeze([250, 500, 1000, 2000, 4000, 8000]);

function fail(message) {
  throw new Error(message);
}

function bytesEqual(left, right) {
  return left.byteLength === right.byteLength && Buffer.from(left).equals(Buffer.from(right));
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

async function requestVerified(fetchImpl, pathname, label, { allowNotFound = false } = {}) {
  const url = new URL(pathname, PREVIEW_ORIGIN + '/');
  if (url.origin !== PREVIEW_ORIGIN || !url.pathname.startsWith('/')) fail(label + ' URL is outside the fixed W01 preview origin');
  const response = await fetchImpl(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (response.url) {
    let responseUrl;
    try { responseUrl = new URL(response.url); } catch { fail(label + ' returned an invalid response URL'); }
    if (responseUrl.origin !== url.origin || responseUrl.pathname !== url.pathname || responseUrl.search !== url.search || responseUrl.hash !== url.hash) {
      fail(label + ' returned from an unexpected origin or path');
    }
  }
  if (response.status === 404 && allowNotFound) return { status: response.status };
  if (response.status !== 200) fail(label + ' returned HTTP ' + response.status);
  const robots = response.headers.get('x-robots-tag') ?? '';
  if (!robots.toLowerCase().includes('noindex')) fail(label + ' is missing the preview noindex response header');
  if (response.headers.get('access-control-allow-origin') !== '*') fail(label + ' is missing the preview CORS response header');
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    fail(label + ' has unexpected content-type: ' + (contentType || '(missing)'));
  }
  const actualBytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, robots, cors: response.headers.get('access-control-allow-origin'), actualBytes };
}

async function fetchVerified(fetchImpl, pathname, expectedBytes, label) {
  const response = await requestVerified(fetchImpl, pathname, label);
  const actualBytes = response.actualBytes;
  if (actualBytes.byteLength !== expectedBytes.byteLength || sha256(actualBytes) !== sha256(expectedBytes)) {
    fail(label + ' bytes do not match the verified local preview package');
  }
  return { status: response.status, robots: response.robots, cors: response.cors };
}

async function readPinnedPreviousVersion(previousOutputRoot) {
  if (typeof previousOutputRoot !== 'string' || previousOutputRoot.length === 0) {
    fail('a verified pinned 0.0.16 package is required for pending-preview deployment checks');
  }
  previousOutputRoot = path.resolve(previousOutputRoot);
  const rootInfo = await lstat(previousOutputRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) fail('the pinned 0.0.16 package root must be a regular directory');

  const previousReceipt = parseJson(await readArtifactFile(previousOutputRoot, 'receipt.json'), 'pinned 0.0.16 build receipt');
  const receiptKeys = ['schemaVersion', 'requestKind', 'buildId', 'dataRevision', 'contentVersion', 'manifestPath', 'manifestSha256', 'source', 'web', 'fixtureOnly', 'publicationEligible', 'candidatePreviewOnly', 'formalPublishAllowed', 'deploymentPerformed', 'files', 'retainedData'];
  assertExactKeys(previousReceipt, receiptKeys, 'pinned 0.0.16 build receipt');
  assertExactKeys(previousReceipt.source, ['repository', 'commit', 'sourceRevision', 'manifestSha256'], 'pinned 0.0.16 source identity');
  assertExactKeys(previousReceipt.web, ['authoringCommit'], 'pinned 0.0.16 Web identity');
  if (previousReceipt.schemaVersion !== '1.0.0' || previousReceipt.requestKind !== 'isolated-w01-preview-build' ||
      previousReceipt.contentVersion !== PINNED_PRIOR_CANDIDATE.contentVersion ||
      previousReceipt.buildId !== PINNED_PRIOR_CANDIDATE.buildId || previousReceipt.dataRevision !== PINNED_PRIOR_CANDIDATE.dataRevision ||
      previousReceipt.manifestPath !== PINNED_PRIOR_CANDIDATE.manifestPath || previousReceipt.manifestSha256 !== PINNED_PRIOR_CANDIDATE.manifestSha256 ||
      previousReceipt.source.repository !== PINNED_PRIOR_CANDIDATE.sourceRepository ||
      previousReceipt.source.commit !== PINNED_PRIOR_CANDIDATE.sourceCommit ||
      previousReceipt.source.sourceRevision !== PINNED_PRIOR_CANDIDATE.sourceRevision ||
      previousReceipt.source.manifestSha256 !== PINNED_PRIOR_CANDIDATE.sourceManifestSha256 ||
      previousReceipt.web.authoringCommit !== PINNED_PRIOR_CANDIDATE.authoringCommit || previousReceipt.fixtureOnly !== false ||
      previousReceipt.publicationEligible !== false || previousReceipt.candidatePreviewOnly !== true ||
      previousReceipt.formalPublishAllowed !== false || previousReceipt.deploymentPerformed !== false) {
    fail('local prior package is not the pinned quarantined 0.0.16 candidate');
  }

  const previousVersionBytes = await readArtifactFile(previousOutputRoot, 'version.json');
  if (sha256(previousVersionBytes) !== PINNED_PRIOR_CANDIDATE.versionSha256) {
    fail('local pinned 0.0.16 version.json does not match its fixed identity');
  }
  const previousVersion = parseJson(previousVersionBytes, 'pinned 0.0.16 version.json');
  assertExactKeys(previousVersion, ['schema_version', 'data_revision', 'build_id', 'game_version', 'package_kind', 'game_releases'], 'pinned 0.0.16 version.json');
  if (previousVersion.schema_version !== 2 || previousVersion.data_revision !== PINNED_PRIOR_CANDIDATE.dataRevision ||
      previousVersion.build_id !== PINNED_PRIOR_CANDIDATE.buildId || previousVersion.package_kind !== 'pending-preview' ||
      previousVersion.game_releases?.length !== 1) {
    fail('local pinned 0.0.16 version identity is invalid');
  }
  const previousRelease = previousVersion.game_releases[0];
  assertExactKeys(previousRelease, ['game_version', 'content_version', 'data_revision', 'manifest_path', 'manifest_sha256'], 'pinned 0.0.16 game release');
  if (previousRelease.game_version !== '1.13.2' || previousRelease.content_version !== PINNED_PRIOR_CANDIDATE.contentVersion ||
      previousRelease.data_revision !== PINNED_PRIOR_CANDIDATE.dataRevision ||
      previousRelease.manifest_path !== '/' + PINNED_PRIOR_CANDIDATE.manifestPath ||
      previousRelease.manifest_sha256 !== PINNED_PRIOR_CANDIDATE.manifestSha256) {
    fail('local pinned 0.0.16 game release does not match its fixed identity');
  }
  const previousRows = validateRows(previousReceipt.files, 'pinned 0.0.16 build receipt.files');
  const previousVersionRows = previousRows.filter(row => row.path === 'version.json');
  const previousVersionRow = previousVersionRows[0];
  if (previousVersionRows.length !== 1 || !previousVersionRow || previousVersionRow.sizeBytes !== previousVersionBytes.byteLength ||
      previousVersionRow.sha256 !== PINNED_PRIOR_CANDIDATE.versionSha256) {
    fail('local pinned 0.0.16 receipt does not bind its version.json bytes');
  }
  return previousVersionBytes;
}

function createPropagationRetryBudget() {
  let nextAttempt = 0;
  return {
    takeDelay() {
      if (nextAttempt >= PROPAGATION_RETRY_DELAYS_MS.length) return undefined;
      return PROPAGATION_RETRY_DELAYS_MS[nextAttempt++];
    }
  };
}

async function fetchVersionWithPropagation({ fetchImpl, expectedBytes, previousBytes, retryBudget, sleepImpl }) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await requestVerified(fetchImpl, '/version.json', 'version.json');
    const matchesExpected = bytesEqual(response.actualBytes, expectedBytes);
    if (matchesExpected) return { status: response.status, robots: response.robots, cors: response.cors };

    const matchesPinnedPrevious = previousBytes && bytesEqual(response.actualBytes, previousBytes);
    if (!matchesPinnedPrevious) fail('version.json bytes do not match the verified local preview package');
    const delay = retryBudget.takeDelay();
    if (delay === undefined) {
      fail('version.json still serves the pinned prior 0.0.16 package after ' + (attempt + 1) + ' checks');
    }
    await sleepImpl(delay);
  }
}

async function fetchContentAddressedObjectWithPropagation({ fetchImpl, pathname, expectedBytes, label, retryBudget, sleepImpl }) {
  for (;;) {
    const response = await requestVerified(fetchImpl, pathname, label, { allowNotFound: true });
    if (response.status === 200) {
      if (!bytesEqual(response.actualBytes, expectedBytes)) {
        fail(label + ' bytes do not match the verified local preview package');
      }
      return { status: response.status, robots: response.robots, cors: response.cors };
    }

    const delay = retryBudget.takeDelay();
    if (delay === undefined) {
      fail(label + ' returned HTTP 404; shared package-object propagation retry budget is exhausted');
    }
    await sleepImpl(delay);
  }
}

export async function createDeploymentReceipt({ repoRoot = SCRIPT_ROOT, outputRoot = path.join(repoRoot, 'dist-w01'), previousOutputRoot, receiptPath, fetchImpl = fetch, sleepImpl = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), createdAt = new Date().toISOString() } = {}) {
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
  const localVersionRows = validateRows(receipt.files, 'W01 receipt.files').filter(row => row.path === 'version.json');
  if (localVersionRows.length !== 1 || localVersionRows[0].sizeBytes !== localVersionBytes.byteLength ||
      localVersionRows[0].sha256 !== sha256(localVersionBytes)) {
    fail('local version.json bytes do not match the verified W01 receipt');
  }
  const release = version.game_releases[0];
  if (release.data_revision !== receipt.dataRevision || release.manifest_path !== '/' + receipt.manifestPath ||
      release.manifest_sha256 !== receipt.manifestSha256) {
    fail('W01 version.json manifest path or identity does not match its local receipt');
  }
  const manifestBytes = await readArtifactFile(outputRoot, receipt.manifestPath);
  if (sha256(manifestBytes) !== receipt.manifestSha256) fail('local W01 manifest does not match its receipt');
  const manifest = parseJson(manifestBytes, 'W01 manifest');
  if (release.game_version !== manifest.gameVersion || manifest.dataRevision !== receipt.dataRevision || manifest.contentVersion !== receipt.contentVersion ||
      manifest.fixtureOnly !== isFixturePreview || manifest.publicationEligible !== false || manifest.files?.length !== DOMAIN_KINDS.length) {
    fail('local W01 manifest does not match the selected quarantined preview mode');
  }
  const remoteChecks = [];
  const pinnedPreviousVersionBytes = isPendingCandidate ? await readPinnedPreviousVersion(previousOutputRoot) : undefined;
  if (typeof sleepImpl !== 'function') fail('sleepImpl must be a function');
  const retryBudget = createPropagationRetryBudget();
  remoteChecks.push(await fetchVersionWithPropagation({ fetchImpl, expectedBytes: localVersionBytes, previousBytes: pinnedPreviousVersionBytes, retryBudget, sleepImpl }));
  remoteChecks.push(await fetchContentAddressedObjectWithPropagation({
    fetchImpl, pathname: version.game_releases[0].manifest_path, expectedBytes: manifestBytes, label: 'manifest', retryBudget, sleepImpl
  }));
  for (const [index, file] of manifest.files.entries()) {
    if (file.kind !== DOMAIN_KINDS[index] || file.path !== file.kind + '.json' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      fail('W01 manifest does not contain the exact ordered shared domains');
    }
    const localBytes = await readArtifactFile(outputRoot, 'data/' + receipt.dataRevision + '/' + file.path);
    if (sha256(localBytes) !== file.sha256) fail('local W01 domain hash does not match manifest: ' + file.kind);
    remoteChecks.push(await fetchContentAddressedObjectWithPropagation({
      fetchImpl, pathname: '/data/' + receipt.dataRevision + '/' + file.path, expectedBytes: localBytes, label: file.kind, retryBudget, sleepImpl
    }));
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
    else if (args[index] === '--previous-package' && !options.previousOutputRoot && args[index + 1]) options.previousOutputRoot = args[++index];
    else fail('Usage: node scripts/w01-preview-deployment-receipt.mjs --output receipt.json [--previous-package pinned-0.0.16-package]');
  }
  if (!options.receiptPath) fail('Usage: node scripts/w01-preview-deployment-receipt.mjs --output receipt.json [--previous-package pinned-0.0.16-package]');
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
