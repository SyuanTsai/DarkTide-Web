import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertChildPath,
  compareUtf8,
  isPathInside,
  jsonBytes,
  parseJson,
  safeRelativePath,
  sha256
} from '../src/static/common.mjs';
import { verifyW01Package } from './w01-build.mjs';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Web';
const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
const FIXED_SOURCE = {
  commit: '83fdd201f67c6c490f32832419ea61353d7066d1',
  sourceRevision: 'b48a8e6dcf61dcfbd8ca4ea8a89ebd636216c70907d82bd9fe6587b19c31851e',
  manifestSha256: '7546a19ff3396c712586e62af58d38d0ae707df1b279633de47658de091043f1'
};
const FIXED_R3 = {
  webAuthoringCommit: 'e516a5b896f78273544c16047126c327337a8424',
  contentVersion: '0.0.3',
  dataRevision: 'f406d32142fc9ef507a0884c211e6ae7364580f016f9f12389a8cf36448d7222',
  buildId: 'c948c9954e1eb4066517acd576b2e1e16c3b82780bf9a621582ebd355fca93ca',
  manifestSha256: '40468483602b8ac237585446f140455659eab39cf0537ae2a8f7d44d1c95260c',
  receiptSha256: '9b76851624e27c51a7453b42aa5f749fe60559cff2e5b2802de3814aae827bfa',
  fileCount: 2302,
  dataFileCount: 2295
};
const FIXED_R4 = {
  webAuthoringCommit: 'b401ae50d7ebb7e44aeb59a8c864a8b93628aead',
  contentVersion: '0.0.4',
  dataRevision: '8bfad784d6d1c1ec769393fbda0a4301228e4172a865331bc4b3be146580d060',
  buildId: '8c1b6869170381c70b4428da150a5f7eab60dd704ee3ba3533a9b48a66390421',
  manifestSha256: '294337395a5641c8413297714fec6c263e8b0c6945696e28ef7a74d341a11854',
  receiptSha256: 'beb251de031c20e0f54105af96e94e3e27165d366c97e286bea15f351a872156',
  fileCount: 2308,
  dataFileCount: 2301
};

function fail(message) {
  throw new Error(message);
}

function pathsOverlap(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  const same = process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
  return same || isPathInside(normalizedLeft, normalizedRight) || isPathInside(normalizedRight, normalizedLeft);
}

async function assertNoSymlinkAncestors(absolutePath, label) {
  let current = path.resolve(absolutePath);
  while (true) {
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) fail(label + ' has no existing filesystem ancestor');
      current = parent;
      continue;
    }
    if (info.isSymbolicLink()) fail(label + ' may not cross a symbolic link: ' + current);
    if (current === path.dirname(current)) break;
    current = path.dirname(current);
  }
}

async function assertRealDirectory(directory, label) {
  const absolute = path.resolve(directory);
  await assertNoSymlinkAncestors(absolute, label);
  const info = await lstat(absolute);
  if (info.isSymbolicLink() || !info.isDirectory()) fail(label + ' must be a real directory');
  return absolute;
}

async function assertAbsent(filePath, label) {
  try {
    await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  fail(label + ' already exists');
}

async function readReceipt(packageRoot, label) {
  const receiptPath = assertChildPath(packageRoot, path.join(packageRoot, 'receipt.json'), label + ' receipt');
  const receiptBytes = await readFile(receiptPath);
  return { receiptBytes, receipt: parseJson(receiptBytes, label + ' receipt') };
}

function assertPinnedIdentity(receipt, receiptBytes, expected, label) {
  if (sha256(receiptBytes) !== expected.receiptSha256 ||
      receipt.schemaVersion !== '1.0.0' || receipt.requestKind !== 'isolated-w01-preview-build' ||
      receipt.web?.authoringCommit !== expected.webAuthoringCommit || receipt.contentVersion !== expected.contentVersion ||
      receipt.dataRevision !== expected.dataRevision || receipt.buildId !== expected.buildId ||
      receipt.manifestSha256 !== expected.manifestSha256 ||
      receipt.source?.repository !== SOURCE_REPOSITORY || receipt.source?.commit !== FIXED_SOURCE.commit ||
      receipt.source?.sourceRevision !== FIXED_SOURCE.sourceRevision || receipt.source?.manifestSha256 !== FIXED_SOURCE.manifestSha256 ||
      receipt.fixtureOnly !== false || receipt.candidatePreviewOnly !== true ||
      receipt.publicationEligible !== false || receipt.formalPublishAllowed !== false || receipt.deploymentPerformed !== false ||
      receipt.files?.length !== expected.fileCount) {
    fail(label + ' is not the exact fixed W01 ' + expected.contentVersion + ' pending preview package');
  }
  const dataRows = receipt.files.filter(row => typeof row?.path === 'string' && row.path.startsWith('data/'));
  if (dataRows.length !== expected.dataFileCount) fail(label + ' has an unexpected immutable data inventory');
  return dataRows;
}

async function readVerifiedFile(root, row, label) {
  const relative = safeRelativePath(row.path, label + ' path');
  const absolute = assertChildPath(root, path.join(root, ...relative.split('/')), label + ' file');
  const info = await lstat(absolute);
  if (info.isSymbolicLink() || !info.isFile()) fail(label + ' must be a regular file: ' + relative);
  const bytes = await readFile(absolute);
  if (bytes.byteLength !== row.sizeBytes || sha256(bytes) !== row.sha256) fail(label + ' does not match its verified receipt: ' + relative);
  return bytes;
}

async function writeStagedFile(stageRoot, relativePath, bytes) {
  const safePath = safeRelativePath(relativePath, 'staging path');
  const target = assertChildPath(stageRoot, path.join(stageRoot, ...safePath.split('/')), 'staging file');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
}

function currentControllerCommit(repoRoot) {
  let commit;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    fail('controller checkout must be a Git repository');
  }
  if (!/^[a-f0-9]{40}$/.test(commit)) fail('controller checkout has an invalid commit identity');
  return commit;
}

export async function restorePinnedRealR3Preview({
  targetRoot,
  activeRoot,
  proofPath,
  repoRoot = SCRIPT_ROOT,
  renameImpl = rename
} = {}) {
  if (typeof targetRoot !== 'string' || targetRoot.length === 0) fail('targetRoot is required');
  if (typeof activeRoot !== 'string' || activeRoot.length === 0) fail('activeRoot is required');
  if (typeof proofPath !== 'string' || proofPath.length === 0) fail('proofPath is required');
  if (typeof renameImpl !== 'function') fail('renameImpl must be a filesystem rename function');

  targetRoot = await assertRealDirectory(targetRoot, 'fixed .3 target package');
  activeRoot = await assertRealDirectory(activeRoot, 'active .4 package');
  proofPath = path.resolve(proofPath);
  const proofDirectory = await assertRealDirectory(path.dirname(proofPath), 'recovery proof directory');
  repoRoot = await assertRealDirectory(repoRoot, 'controller checkout');
  if (pathsOverlap(targetRoot, activeRoot) || pathsOverlap(targetRoot, proofPath) || pathsOverlap(activeRoot, proofPath)) {
    fail('target, active, and proof paths must be separate');
  }
  await assertAbsent(proofPath, 'recovery proof path');

  const targetVerification = await verifyW01Package(targetRoot);
  const activeVerification = await verifyW01Package(activeRoot);
  const { receiptBytes: targetReceiptBytes, receipt: targetReceipt } = await readReceipt(targetRoot, 'fixed .3 target');
  const { receiptBytes: activeReceiptBytes, receipt: activeReceipt } = await readReceipt(activeRoot, 'active .4 package');
  const targetDataRows = assertPinnedIdentity(targetReceipt, targetReceiptBytes, FIXED_R3, 'target package');
  const activeDataRows = assertPinnedIdentity(activeReceipt, activeReceiptBytes, FIXED_R4, 'active package');
  if (targetVerification.fileCount !== FIXED_R3.fileCount || activeVerification.fileCount !== FIXED_R4.fileCount ||
      JSON.stringify(targetReceipt.retainedData) !== JSON.stringify(activeReceipt.retainedData) ||
      JSON.stringify(targetReceipt.source) !== JSON.stringify(activeReceipt.source)) {
    fail('fixed .3 and .4 packages do not share the expected source and pinned baseline');
  }

  const controllerCommit = currentControllerCommit(repoRoot);
  const activeParent = await assertRealDirectory(path.dirname(activeRoot), 'active package parent');
  const backupRoot = path.join(activeParent, path.basename(activeRoot) + '.before-r3-' + controllerCommit);
  await assertAbsent(backupRoot, 'generated .4 recovery backup');

  const stageRoot = await mkdtemp(path.join(activeParent, '.w01-r3-restore-stage-'));
  assertChildPath(activeParent, stageRoot, 'generated recovery staging directory');
  const proofTemporaryPath = path.join(proofDirectory, '.' + path.basename(proofPath) + '.tmp-' + randomUUID());
  let stageInstalled = false;
  let activeMovedToBackup = false;
  let proofPublished = false;

  try {
    const mergedRows = new Map();
    const targetBytesByPath = new Map();
    for (const row of targetReceipt.files) {
      const bytes = await readVerifiedFile(targetRoot, row, 'fixed .3 target');
      await writeStagedFile(stageRoot, row.path, bytes);
      mergedRows.set(row.path, row);
      if (row.path.startsWith('data/')) targetBytesByPath.set(row.path, bytes);
    }

    const activeDataInventory = [];
    for (const row of activeDataRows) {
      const bytes = await readVerifiedFile(activeRoot, row, 'active .4 data');
      const previousBytes = targetBytesByPath.get(row.path);
      if (previousBytes && !previousBytes.equals(bytes)) fail('fixed .3 and .4 packages conflict at immutable data URL: ' + row.path);
      if (!previousBytes) await writeStagedFile(stageRoot, row.path, bytes);
      mergedRows.set(row.path, row);
      activeDataInventory.push(row);
    }
    if (mergedRows.size !== FIXED_R4.fileCount) fail('restored package does not have the exact combined immutable inventory');

    const mergedReceipt = {
      ...targetReceipt,
      files: [...mergedRows.values()].sort((left, right) => compareUtf8(left.path, right.path))
    };
    const mergedReceiptBytes = jsonBytes(mergedReceipt);
    await writeStagedFile(stageRoot, 'receipt.json', mergedReceiptBytes);
    const stagedVerification = await verifyW01Package(stageRoot);
    if (stagedVerification.fileCount !== FIXED_R4.fileCount || stagedVerification.dataRevision !== FIXED_R3.dataRevision ||
        stagedVerification.buildId !== FIXED_R3.buildId || stagedVerification.candidatePreviewOnly !== true) {
      fail('staged recovery package does not match the exact .3 runtime identity');
    }

    const proof = {
      schemaVersion: '1.0.0',
      requestKind: 'w01-fixed-r4-to-r3-preview-recovery',
      deploymentPerformed: false,
      controllerCommit,
      source: {
        repository: SOURCE_REPOSITORY,
        commit: FIXED_SOURCE.commit,
        sourceRevision: FIXED_SOURCE.sourceRevision,
        manifestSha256: FIXED_SOURCE.manifestSha256
      },
      restored: {
        webAuthoringCommit: targetReceipt.web.authoringCommit,
        contentVersion: targetReceipt.contentVersion,
        buildId: targetReceipt.buildId,
        dataRevision: targetReceipt.dataRevision,
        manifestSha256: targetReceipt.manifestSha256,
        receiptSha256: sha256(targetReceiptBytes)
      },
      retained: {
        webAuthoringCommit: activeReceipt.web.authoringCommit,
        contentVersion: activeReceipt.contentVersion,
        buildId: activeReceipt.buildId,
        dataRevision: activeReceipt.dataRevision,
        manifestSha256: activeReceipt.manifestSha256,
        receiptSha256: sha256(activeReceiptBytes),
        dataFileCount: activeDataInventory.length,
        dataRowsSha256: sha256(jsonBytes(activeDataInventory.sort((left, right) => compareUtf8(left.path, right.path))))
      },
      restoredReceiptSha256: sha256(mergedReceiptBytes)
    };
    const proofBytes = jsonBytes(proof);
    await writeFile(proofTemporaryPath, proofBytes, { flag: 'wx' });

    await renameImpl(activeRoot, backupRoot);
    activeMovedToBackup = true;
    try {
      await renameImpl(stageRoot, activeRoot);
      stageInstalled = true;
      activeMovedToBackup = false;
    } catch (error) {
      try {
        await renameImpl(backupRoot, activeRoot);
        activeMovedToBackup = false;
      } catch (restoreError) {
        fail('recovery replacement failed and the .4 package remains at ' + backupRoot + ': ' + restoreError.message);
      }
      throw error;
    }

    try {
      await verifyW01Package(activeRoot);
      await renameImpl(proofTemporaryPath, proofPath);
      proofPublished = true;
    } catch (error) {
      try {
        await renameImpl(activeRoot, stageRoot);
        stageInstalled = false;
        await renameImpl(backupRoot, activeRoot);
        activeMovedToBackup = false;
      } catch (restoreError) {
        fail('recovery verification failed; the original .4 package remains at ' + backupRoot + ': ' + restoreError.message);
      }
      throw error;
    }

    return {
      controllerCommit,
      restoredContentVersion: FIXED_R3.contentVersion,
      restoredDataRevision: FIXED_R3.dataRevision,
      restoredBuildId: FIXED_R3.buildId,
      restoredManifestSha256: FIXED_R3.manifestSha256,
      restoredReceiptSha256: sha256(mergedReceiptBytes),
      retainedContentVersion: FIXED_R4.contentVersion,
      retainedDataRevision: FIXED_R4.dataRevision,
      retainedDataFileCount: activeDataInventory.length,
      fileCount: mergedRows.size,
      proofSha256: sha256(proofBytes),
      backupRoot
    };
  } finally {
    if (!proofPublished) {
      await rm(proofTemporaryPath, { force: true }).catch(() => {});
    }
    if (!stageInstalled && !activeMovedToBackup) {
      await rm(stageRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function parseArgs(args) {
  const options = { targetRoot: null, activeRoot: null, proofPath: null };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (['--target-root', '--active-root', '--proof-path'].includes(arg) && !seen.has(arg) && args[index + 1]) {
      seen.add(arg);
      options[{ '--target-root': 'targetRoot', '--active-root': 'activeRoot', '--proof-path': 'proofPath' }[arg]] = path.resolve(args[++index]);
    } else {
      fail('Usage: node scripts/w01-restore-preview.mjs --target-root exact-.3-package --active-root exact-.4-output --proof-path public-safe-proof.json');
    }
  }
  if (!options.targetRoot || !options.activeRoot || !options.proofPath) {
    fail('Usage: node scripts/w01-restore-preview.mjs --target-root exact-.3-package --active-root exact-.4-output --proof-path public-safe-proof.json');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await restorePinnedRealR3Preview(parseArgs(process.argv.slice(2)));
    const { backupRoot, ...safeResult } = result;
    process.stdout.write('Restored the exact pending .3 preview while retaining published .4 immutable data: ' + JSON.stringify(safeResult) + '\n');
  } catch (error) {
    process.stderr.write('W01 fixed preview recovery failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = 1;
  }
}
