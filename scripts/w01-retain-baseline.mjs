import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertChildPath,
  assertExactKeys,
  compareUtf8,
  jsonBytes,
  parseJson,
  safeRelativePath,
  sha256
} from '../src/static/common.mjs';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_COMMIT = '8a4b3db2b1e835f0757f387ca89a19b9092b35ee';
const BASELINE_REVISION = '0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b';
const INVENTORY_PATH = path.join(WEB_ROOT, 'docs', 'w01', 'retained-preview-manifest.json');
const EXPECTED_FILE_COUNT = 2277;
const EXPECTED_TOTAL_BYTES = 9709542;

function fail(message) {
  throw new Error(message);
}

function normalizeRows(rows, label) {
  if (!Array.isArray(rows)) fail(label + ' must be an array');
  return rows.map((row, index) => {
    assertExactKeys(row, ['path', 'sizeBytes', 'sha256'], label + '[' + index + ']');
    const safePath = safeRelativePath(row.path, label + '[' + index + '].path');
    if (!safePath.startsWith('data/' + BASELINE_REVISION + '/')) fail(label + '[' + index + '] is outside the pinned baseline data subtree');
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0) fail(label + '[' + index + '].sizeBytes is invalid');
    if (typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) fail(label + '[' + index + '].sha256 is invalid');
    return { path: safePath, sizeBytes: row.sizeBytes, sha256: row.sha256 };
  }).sort((left, right) => compareUtf8(left.path, right.path));
}

export function assertExactDataInventory(actualRows, expectedRows) {
  const actual = normalizeRows(actualRows, 'actual baseline inventory');
  const expected = normalizeRows(expectedRows, 'pinned baseline inventory');
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('pinned base data path/size/hash inventory does not match the preserved preview whitelist');
  }
  return expected;
}

export function mergeRetainedRows(receipt, copiedRows, inventory, inventorySha256) {
  const receiptKeys = [
    'schemaVersion', 'requestKind', 'buildId', 'dataRevision', 'contentVersion', 'manifestPath', 'manifestSha256',
    'source', 'web', 'fixtureOnly', 'publicationEligible', 'formalPublishAllowed', 'deploymentPerformed', 'files'
  ];
  const candidatePreviewOnly = Object.hasOwn(receipt, 'candidatePreviewOnly');
  assertExactKeys(receipt, [...receiptKeys, ...(candidatePreviewOnly ? ['candidatePreviewOnly'] : []), ...(Object.hasOwn(receipt, 'retainedData') ? ['retainedData'] : [])], 'W01 build receipt');
  const isFixture = receipt.fixtureOnly === true && !candidatePreviewOnly;
  const isPendingCandidate = receipt.fixtureOnly === false && receipt.candidatePreviewOnly === true;
  if (receipt.requestKind !== 'isolated-w01-preview-build' || (!isFixture && !isPendingCandidate) ||
      receipt.publicationEligible !== false || receipt.formalPublishAllowed !== false || receipt.deploymentPerformed !== false) {
    fail('retained baseline can only be added to a quarantined W01 fixture or pending-candidate preview');
  }
  if (typeof receipt.contentVersion !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(receipt.contentVersion)) {
    fail('W01 build receipt contentVersion must be numeric major.minor.patch');
  }
  if (!Array.isArray(receipt.files)) fail('W01 build receipt files must be an array');
  const retainedData = {
    baselineCommit: inventory.baselineCommit,
    dataRevision: inventory.dataRevision,
    fileCount: inventory.fileCount,
    totalBytes: inventory.totalBytes,
    inventorySha256
  };
  if (Object.hasOwn(receipt, 'retainedData')) {
    assertExactKeys(receipt.retainedData, ['baselineCommit', 'dataRevision', 'fileCount', 'totalBytes', 'inventorySha256'], 'W01 retainedData receipt');
    if (JSON.stringify(receipt.retainedData) !== JSON.stringify(retainedData)) fail('W01 receipt already pins a different retained baseline');
  }
  const byPath = new Map();
  for (const [index, row] of receipt.files.entries()) {
    assertExactKeys(row, ['path', 'sizeBytes', 'sha256'], 'W01 build receipt.files[' + index + ']');
    const name = safeRelativePath(row.path, 'W01 build receipt file path');
    if (byPath.has(name)) fail('W01 build receipt contains duplicate file paths');
    byPath.set(name, { path: name, sizeBytes: row.sizeBytes, sha256: row.sha256 });
  }
  for (const row of copiedRows) {
    const existing = byPath.get(row.path);
    if (existing && JSON.stringify(existing) !== JSON.stringify(row)) fail('retained data path collides with a different W01 output row: ' + row.path);
    byPath.set(row.path, row);
  }
  receipt.files = [...byPath.values()].sort((left, right) => compareUtf8(left.path, right.path));
  receipt.retainedData = retainedData;
  return receipt;
}

export async function copyRetainedData({ baselineRoot, outputRoot, files } = {}) {
  baselineRoot = path.resolve(baselineRoot);
  outputRoot = path.resolve(outputRoot);
  const expectedRows = normalizeRows(files, 'retained data whitelist');
  const verified = [];
  for (const row of expectedRows) {
    const relative = safeRelativePath(row.path);
    const sourcePath = assertChildPath(baselineRoot, path.join(baselineRoot, ...relative.split('/')), 'baseline data file');
    const info = await lstat(sourcePath);
    if (info.isSymbolicLink() || !info.isFile()) fail('baseline data path must be a regular file: ' + row.path);
    const bytes = await readFile(sourcePath);
    if (bytes.byteLength !== row.sizeBytes || sha256(bytes) !== row.sha256) fail('baseline data file does not match pinned hash/size: ' + row.path);
    const destinationPath = assertChildPath(outputRoot, path.join(outputRoot, ...relative.split('/')), 'retained data destination');
    let previous;
    try {
      previous = await readFile(destinationPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (previous && (previous.byteLength !== row.sizeBytes || sha256(previous) !== row.sha256)) {
      fail('retained immutable data URL already contains different bytes: ' + row.path);
    }
    verified.push({ row, sourcePath, destinationPath, bytes, exists: Boolean(previous) });
  }
  for (const file of verified) {
    if (file.exists) continue;
    await mkdir(path.dirname(file.destinationPath), { recursive: true });
    await copyFile(file.sourcePath, file.destinationPath);
  }
  return expectedRows;
}

async function readPinnedInventory() {
  const inventoryBytes = await readFile(INVENTORY_PATH);
  const inventory = parseJson(inventoryBytes, 'retained preview manifest');
  assertExactKeys(inventory, ['schemaVersion', 'baselineCommit', 'dataRevision', 'fileCount', 'totalBytes', 'files'], 'retained preview manifest');
  if (inventory.schemaVersion !== '1.0.0' || inventory.baselineCommit !== BASELINE_COMMIT ||
      inventory.dataRevision !== BASELINE_REVISION || inventory.fileCount !== EXPECTED_FILE_COUNT ||
      inventory.totalBytes !== EXPECTED_TOTAL_BYTES) {
    fail('retained preview manifest does not match the fixed W01 baseline identity');
  }
  const rows = normalizeRows(inventory.files, 'retained preview manifest files');
  if (rows.length !== EXPECTED_FILE_COUNT || rows.reduce((total, row) => total + row.sizeBytes, 0) !== EXPECTED_TOTAL_BYTES) {
    fail('retained preview manifest file count or total bytes do not match the fixed baseline');
  }
  return { inventory, inventorySha256: sha256(jsonBytes(inventory)), rows };
}

async function verifyBaselineBuild(baselineRoot, rows) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baselineRoot, encoding: 'utf8' }).trim();
  if (head !== BASELINE_COMMIT) fail('baseline checkout must be the fixed W01 source commit');
  const artifactManifest = parseJson(await readFile(path.join(baselineRoot, 'dist', 'artifact-manifest.json')), 'pinned base artifact manifest');
  if (artifactManifest.schema_version !== 1 || artifactManifest.package_kind !== 'published' ||
      artifactManifest.data_revision !== BASELINE_REVISION || !Array.isArray(artifactManifest.files)) {
    fail('pinned base build does not match the retained published data revision');
  }
  const prefix = 'data/' + BASELINE_REVISION + '/';
  const actualRows = artifactManifest.files.filter(file => file.path.startsWith(prefix)).map(file => ({
    path: file.path,
    sizeBytes: file.size_bytes,
    sha256: file.sha256
  }));
  assertExactDataInventory(actualRows, rows);
}

export async function retainPinnedBaseline({ baselineRoot, outputRoot = path.join(WEB_ROOT, 'dist-w01') } = {}) {
  if (typeof baselineRoot !== 'string' || baselineRoot.length === 0) fail('baselineRoot is required');
  baselineRoot = path.resolve(baselineRoot);
  outputRoot = path.resolve(outputRoot);
  const { inventory, inventorySha256, rows } = await readPinnedInventory();
  await verifyBaselineBuild(baselineRoot, rows);
  const copiedRows = await copyRetainedData({
    baselineRoot: path.join(baselineRoot, 'dist'),
    outputRoot,
    files: rows
  });

  const receiptPath = path.join(outputRoot, 'receipt.json');
  const receipt = parseJson(await readFile(receiptPath), 'W01 build receipt');
  mergeRetainedRows(receipt, copiedRows, inventory, inventorySha256);
  await writeFile(receiptPath, jsonBytes(receipt));
  return {
    baselineCommit: inventory.baselineCommit,
    dataRevision: inventory.dataRevision,
    fileCount: inventory.fileCount,
    totalBytes: inventory.totalBytes,
    inventorySha256,
    receiptPath
  };
}

function parseArgs(args) {
  const options = { baselineRoot: null, outputRoot: path.join(WEB_ROOT, 'dist-w01') };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--baseline-root' && !seen.has(arg) && args[index + 1]) {
      seen.add(arg);
      options.baselineRoot = path.resolve(args[++index]);
    } else if (arg === '--output' && !seen.has(arg) && args[index + 1]) {
      seen.add(arg);
      options.outputRoot = path.resolve(args[++index]);
    } else {
      fail('Usage: node scripts/w01-retain-baseline.mjs --baseline-root pinned-base-checkout [--output dist-w01]');
    }
  }
  if (!options.baselineRoot) fail('Usage: node scripts/w01-retain-baseline.mjs --baseline-root pinned-base-checkout [--output dist-w01]');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await retainPinnedBaseline(parseArgs(process.argv.slice(2)));
    process.stdout.write('Retained pinned W01 baseline data revision=' + result.dataRevision +
      ' files=' + result.fileCount + ' bytes=' + result.totalBytes + ' inventory_sha256=' + result.inventorySha256 + '\n');
  } catch (error) {
    process.stderr.write('W01 baseline retention failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = 1;
  }
}
