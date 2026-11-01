import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import { createReviewReceipt, loadWebAuthoringInputs, validateWebAuthoring } from '../scripts/content/contract-authoring.mjs';
import { loadW08CompilerInputs } from '../scripts/content/contract-w08-build.mjs';
import { prepareW09SourceProposal } from '../scripts/content/contract-w09-compose.mjs';
import { loadW09CompilerCodePin } from '../scripts/content/contract-w09-compose.mjs';
import {
  createW09PublicSourceLockFile,
  createW09ReleaseState,
  currentW09ActiveSnapshot,
  encodeW09RuntimeSnapshotArchive,
  findW09ContentVersionSlot,
  materializeW09RuntimeSnapshotArchive,
  markW09ReleaseFailed,
  planW09CandidateAllocation,
  planW09ContentVersion,
  reserveW09ContentVersion,
  selectW09RetainedReleases,
  validateW09ReleaseState,
  withW09PublicationLock,
  readW09ReleaseState,
  promoteW09SelectedComposition,
  rollbackW09SharedComposition,
  restoreW09ActivePointersFromSnapshot,
  updateW09RetentionReferences,
  writeW09ReleaseStateAtomic,
} from '../scripts/content/contract-w09-release.mjs';
import { loadSharedReleaseFixture, validateSharedStaticFiles } from '../src/static/shared-release.mjs';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W09_TEST_GIT_ROOT = process.env.W09_TEST_GIT_ROOT ?? REPO_ROOT;
const W09_COMPILER_FILE_PATHS = [
  'content/contracts/w09/source-request.lock.json',
  'content/contracts/w09/source-request/contract-w09-request.mjs',
  'scripts/content/contract-w09-compose.mjs',
  'scripts/content/contract-w09-release.mjs',
];
const W09_SELECTED_COMPOSITION_PATH = 'content/contracts/w09/source-handoff/selected.json';

async function installW09CompilerFilesInFixture(webRoot) {
  for (const relativePath of W09_COMPILER_FILE_PATHS) {
    const sourcePath = path.join(REPO_ROOT, ...relativePath.split('/'));
    const destination = path.join(webRoot, ...relativePath.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    const existing = await lstat(destination).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
      throw new Error('isolated test clone compiler input must be a regular file: ' + relativePath);
    }
    const bytes = await readFile(sourcePath);
    await writeFile(destination, bytes, existing ? undefined : { flag: 'wx' });
  }
}

async function removeSelectedCompositionFromFixture(webRoot) {
  const absoluteRoot = path.resolve(webRoot);
  const relativeToTemp = path.relative(path.resolve(os.tmpdir()), absoluteRoot);
  if (!relativeToTemp || relativeToTemp.startsWith('..') || path.isAbsolute(relativeToTemp)) {
    throw new Error('selected composition may only be removed from a disposable test clone under the OS temp directory');
  }
  const selectedPath = path.join(absoluteRoot, ...W09_SELECTED_COMPOSITION_PATH.split('/'));
  const selectedStat = await lstat(selectedPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!selectedStat || selectedStat.isSymbolicLink() || !selectedStat.isFile()) {
    throw new Error('disposable test clone must contain a regular selected composition marker');
  }
  await rm(selectedPath);
  git(absoluteRoot, ['add', '--', W09_SELECTED_COMPOSITION_PATH]);
  git(absoluteRoot, ['commit', '-m', 'W09 isolated fixture without selected composition']);
  assert.equal(git(absoluteRoot, ['ls-tree', '-r', '--name-only', 'HEAD', '--', W09_SELECTED_COMPOSITION_PATH]), '',
    'the disposable fixture commit must not contain the selected marker');
  assert.equal(git(absoluteRoot, ['status', '--porcelain']), '', 'the isolated no-selection fixture must be committed and clean');
}

function initializeW09ReplayCloneBranch(webRoot) {
  assert.equal(git(webRoot, ['status', '--porcelain']), '', 'a disposable replay clone must be clean before branch initialization');
  const headBefore = git(webRoot, ['rev-parse', 'HEAD']);
  const indexTreeBefore = git(webRoot, ['write-tree']);
  git(webRoot, ['checkout', '-B', 'main', 'HEAD']);
  assert.equal(git(webRoot, ['branch', '--show-current']), 'main');
  assert.equal(git(webRoot, ['rev-parse', 'HEAD']), headBefore, 'branch initialization must preserve the checked-out commit');
  assert.equal(git(webRoot, ['write-tree']), indexTreeBefore, 'branch initialization must preserve the index tree');
  assert.equal(git(webRoot, ['status', '--porcelain']), '', 'branch initialization must leave the clone clean');
}

const sha = character => character.repeat(64);
const source = (gameVersion, gameReleaseId, inputDigest, manifestSha256 = sha('b')) => ({
  gameVersion, gameReleaseId, inputDigest, manifestSha256,
});

// Scenario: retries, failures, concurrent builds, and different patches share one durable allocator.
// Purpose: make allocation idempotent per exact source/authoring/compiler input and never reuse a failed slot.
test('UnitT13_allocates-idempotently-per-patch-and-never-reuses-failed-slots', () => {
  let ledger = createW09ReleaseState();
  const firstInput = source('1.13.1', 'release-a', sha('a'));
  const firstPlan = planW09ContentVersion(ledger, firstInput);
  assert.equal(firstPlan.contentVersion, '1.13.1.1');
  ledger = reserveW09ContentVersion(ledger, firstPlan);
  assert.equal(validateW09ReleaseState(ledger), true);

  const retry = planW09ContentVersion(ledger, firstInput);
  assert.equal(retry.releaseId, firstPlan.releaseId);
  assert.equal(retry.contentVersion, firstPlan.contentVersion);

  ledger = markW09ReleaseFailed(ledger, firstPlan.releaseId, 'fixture failure');
  const secondInput = source('1.13.1', 'release-a', sha('c'));
  const secondSlot = findW09ContentVersionSlot(ledger, secondInput);
  assert.equal(secondSlot.contentVersion, '1.13.1.2');
  const second = planW09ContentVersion(ledger, { ...secondInput, manifestSha256: sha('d') });
  assert.equal(second.contentVersion, '1.13.1.2');
  ledger = reserveW09ContentVersion(ledger, second);
  const secondRetry = planW09ContentVersion(ledger, { ...secondInput, manifestSha256: sha('d') });
  assert.equal(secondRetry.contentVersion, second.contentVersion);
  assert.equal(secondRetry.releaseId, second.releaseId);

  const otherPatch = planW09ContentVersion(ledger, source('1.13.2', 'release-b', sha('d')));
  assert.equal(otherPatch.contentVersion, '1.13.2.1');
  assert.throws(
    () => planW09ContentVersion(ledger, source('1.13.1', 'release-a', sha('a'), sha('e'))),
    /conflict|manifest/i,
  );
});

// Scenario: the manifest itself changes when its allocated contentVersion changes.
// Purpose: prove .2 retries rebuild and compare the final .2 manifest digest, not the preallocation .1 digest.
test('UnitT13_candidate-allocation-hashes-the-final-versioned-manifest-on-retry', async () => {
  let ledger = createW09ReleaseState();
  const build = async contentVersion => {
    const manifest = { gameVersion: '1.13.1', contentVersion };
    const manifestBytes = Buffer.from(JSON.stringify(manifest) + '\n', 'utf8');
    return { manifest, manifestBytes };
  };

  const firstIdentity = { gameVersion: '1.13.1', gameReleaseId: 'release-a', inputDigest: sha('a') };
  const first = await planW09CandidateAllocation(ledger, firstIdentity, build);
  assert.equal(first.contentVersion, '1.13.1.1');
  ledger = reserveW09ContentVersion(ledger, first.allocation);

  const secondIdentity = { ...firstIdentity, inputDigest: sha('c') };
  const second = await planW09CandidateAllocation(ledger, secondIdentity, build);
  assert.equal(second.contentVersion, '1.13.1.2');
  assert.equal(second.candidate.manifest.contentVersion, '1.13.1.2');
  ledger = reserveW09ContentVersion(ledger, second.allocation);

  const retry = await planW09CandidateAllocation(ledger, secondIdentity, build);
  assert.equal(retry.contentVersion, second.contentVersion);
  assert.equal(retry.manifestSha256, second.manifestSha256);
  assert.equal(retry.allocation.releaseId, second.allocation.releaseId);
  const wrongVersionHash = createHash('sha256').update(Buffer.from(JSON.stringify({ gameVersion: '1.13.1', contentVersion: '1.13.1.1' }) + '\n')).digest('hex');
  assert.throws(
    () => planW09ContentVersion(ledger, { ...secondIdentity, manifestSha256: wrongVersionHash }),
    /manifest hash conflict/i,
  );
});

test('UnitT13_same-dataRevision-cannot-own-different-immutable-manifest-bytes', () => {
  let ledger = createW09ReleaseState();
  const first = planW09ContentVersion(ledger, {
    ...source('1.13.1', 'release-a', sha('a'), sha('b')),
    dataRevision: sha('c'),
  });
  ledger = reserveW09ContentVersion(ledger, first);
  assert.throws(() => {
    const conflicting = planW09ContentVersion(ledger, {
      ...source('1.13.1', 'release-a', sha('d'), sha('e')),
      dataRevision: sha('c'),
    });
    reserveW09ContentVersion(ledger, conflicting);
  }, /same immutable dataRevision|manifest bytes/i);
  assert.equal(ledger.reservations.length, 1, 'the rejected URL conflict must not mutate the original ledger');
});

// Scenario: the same patch is prepared by two independent processes at once.
// Purpose: prove the durable publication lock serializes ledger read/reserve/build/promote operations.
test('InterT13_publication-lock-serializes-independent-processes-and-ledger-allocations', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'w09-publication-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = path.join(root, 'publication.lock');
  const statePath = path.join(root, 'release-state.json');
  const moduleUrl = pathToFileURL(path.resolve('scripts/content/contract-w09-release.mjs')).href;
  const workerPath = path.join(root, 'allocate-worker.mjs');
  const worker = [
    'import { findW09ContentVersionSlot, planW09ContentVersion, readW09ReleaseState, reserveW09ContentVersion, withW09PublicationLock, writeW09ReleaseStateAtomic } from ' + JSON.stringify(moduleUrl) + ';',
    'const [lockPath, statePath, token] = process.argv.slice(2);',
    'const digest = token.repeat(64);',
    'const manifestSha256 = String(token.charCodeAt(0) % 16).repeat(64);',
    'const result = await withW09PublicationLock({ lockPath, retryDelayMs: 5, timeoutMs: 5000, run: async () => {',
    '  const state = await readW09ReleaseState(statePath);',
    '  const identity = { gameVersion: "1.13.1", gameReleaseId: "release-a", inputDigest: digest };',
    '  findW09ContentVersionSlot(state, identity);',
    '  const allocation = planW09ContentVersion(state, { ...identity, manifestSha256 });',
    '  const next = reserveW09ContentVersion(state, allocation);',
    '  await new Promise(resolve => setTimeout(resolve, 30));',
    '  await writeW09ReleaseStateAtomic(statePath, next);',
    '  return allocation;',
    '} });',
    'process.stdout.write(JSON.stringify({ releaseId: result.releaseId, contentVersion: result.contentVersion }));',
  ].join('\n');
  await writeFile(workerPath, worker, 'utf8');
  const tokens = ['a', 'a', 'b', 'c'];
  const results = await Promise.all(tokens.map(async token => {
    const { stdout } = await execFileAsync(process.execPath, [workerPath, lockPath, statePath, token], { encoding: 'utf8' });
    return JSON.parse(stdout);
  }));
  assert.equal(new Set(results.map(row => row.contentVersion)).size, 3);
  assert.deepEqual(new Set(results.map(row => row.contentVersion)), new Set(['1.13.1.1', '1.13.1.2', '1.13.1.3']));
  assert.equal(new Set(results.filter(row => row.releaseId === results[0].releaseId).map(row => row.contentVersion)).size, 1);
  const ledger = await readW09ReleaseState(statePath);
  assert.equal(ledger.reservations.length, 3);
  assert.equal(validateW09ReleaseState(ledger), true);
});

// Scenario: retention is computed from approved releases and explicit references.
// Purpose: retain the latest three approved releases per patch plus active/baseline/history/rollback references.
test('UnitT13_retention-keeps-three-approved-per-patch-and-all-explicit-references', () => {
  const releases = [
    { releaseId: 'old', gameVersion: '1.13.1', contentVersion: '1.13.1.1', status: 'approved' },
    { releaseId: 'two', gameVersion: '1.13.1', contentVersion: '1.13.1.2', status: 'approved' },
    { releaseId: 'three', gameVersion: '1.13.1', contentVersion: '1.13.1.3', status: 'approved' },
    { releaseId: 'four', gameVersion: '1.13.1', contentVersion: '1.13.1.4', status: 'approved' },
    { releaseId: 'five', gameVersion: '1.13.1', contentVersion: '1.13.1.5', status: 'approved' },
    { releaseId: 'pending', gameVersion: '1.13.1', contentVersion: '1.13.1.6', status: 'pending' },
    { releaseId: 'other-patch', gameVersion: '1.13.2', contentVersion: '1.13.2.1', status: 'approved' },
  ];
  const retained = selectW09RetainedReleases(releases, {
    activeReleaseIds: ['five'],
    explicitReferenceIds: ['old', 'other-patch'],
    perGameVersionLimit: 3,
  });
  assert.deepEqual(new Set(retained), new Set(['old', 'three', 'four', 'five', 'other-patch']));
  assert.ok(!retained.includes('two'));
  assert.ok(!retained.includes('pending'));
  assert.throws(() => selectW09RetainedReleases(releases, { explicitReferenceIds: ['pending'] }), /approved/i);
});

// Scenario: a forged caller flag claims that an unverified candidate is approved.
// Purpose: ensure only the verified Source replay and pinned Web inputs can create a formal gate capability.
test('UnitT13_production-release-entry-rejects-forged-approval-flags', async () => {
  const { prepareW09SharedRelease } = await import('../scripts/content/contract-w09-release.mjs');
  await assert.rejects(
    prepareW09SharedRelease({
      repoRoot: process.cwd(),
      sourceBuild: { publicationEligible: true, buildIdentityVerified: true },
      publicationEligible: true,
      outputRoot: path.join(os.tmpdir(), 'w09-forged-release'),
    }),
    /releaseId|verified|locked|selection|formal/i,
  );
});

// Scenario: no reviewed Source/Web selection exists in the tracked input revision.
// Purpose: ensure the production entry exits pending before allocating a slot or writing a package, even in dry-run mode.
test('InterT13_missing-selected-composition-is-pending-without-allocation-or-package-write', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'w09-no-selection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'web');
  execFileSync('git', ['clone', '-c', 'core.autocrlf=false', '--quiet', '--no-hardlinks', REPO_ROOT, repoRoot], { encoding: 'utf8', windowsHide: true });
  git(repoRoot, ['config', 'core.autocrlf', 'false']);
  git(repoRoot, ['config', 'user.name', 'W09 isolated fixture']);
  git(repoRoot, ['config', 'user.email', 'w09-fixture@example.invalid']);
  git(repoRoot, ['remote', 'set-url', 'origin', 'https://github.com/SyuanTsai/DarkTide-Web.git']);
  await removeSelectedCompositionFromFixture(repoRoot);
  const { prepareW09SharedRelease } = await import('../scripts/content/contract-w09-release.mjs');
  const result = await prepareW09SharedRelease({
    repoRoot,
    sourceRoot: path.join(os.tmpdir(), 'w09-source-root-not-consulted-without-selection'),
    releaseId: 'w09-' + 'a'.repeat(32),
    dryRun: true,
  });
  assert.equal(result.status, 'pending');
  assert.match(result.reason, /no reviewed W09 selected composition/i);
  assert.equal(result.allocationReserved, undefined);
  assert.equal(result.packageWritten, undefined);
});

test('UnitT22_public-source-lock-files-match-the-static-verifier', async () => {
  const fixture = await loadSharedReleaseFixture({ repoRoot: REPO_ROOT, fixtureName: 'valid' });
  const validated = validateSharedStaticFiles({
    version: fixture.version,
    fixtureMarker: fixture.fixtureMarker,
    files: fixture.files,
    retainedReleases: fixture.retainedReleases,
  });
  for (const pointer of fixture.version.game_releases) {
    const manifest = JSON.parse(fixture.files.get(pointer.manifest_path.slice(1)).toString('utf8'));
    const lockFile = createW09PublicSourceLockFile(manifest);
    assert.deepEqual(fixture.files.get(lockFile.relativePath), lockFile.bytes,
      'W09 bundle producer must add the exact Source lock bytes derived by static validation');
    assert.deepEqual(validated.files.get(lockFile.relativePath), lockFile.bytes);
  }
});

// Scenario: a runtime archive contains the full prepared-domain size and is restored from a fresh checkout.
// Purpose: prevent large canonical base64 validation from overflowing while retaining byte and tamper checks.
test('UnitT23_runtime-snapshot-archive-preserves-large-domains-and-rejects-noncanonical-base64', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'w09-runtime-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const checkout = path.join(root, 'checkout');
  await mkdir(repo, { recursive: true });
  git(repo, ['init']);
  git(repo, ['checkout', '-b', 'main']);
  git(repo, ['config', 'core.autocrlf', 'true']);
  git(repo, ['config', 'user.name', 'W09 archive fixture']);
  git(repo, ['config', 'user.email', 'w09-archive@example.invalid']);
  await writeFile(path.join(repo, '.gitattributes'), '/content/contracts/** text eol=lf\n/content/contracts/w09/runtime-snapshots/** -text !eol\n');
  const buildId = sha('d');
  const longAssetPath = 'assets/' + 'a'.repeat(150) + '.mjs';
  const sourceBytes = Buffer.from('first\r\nsecond\r\n', 'utf8');
  const binaryBytes = Buffer.from([0, 13, 10, 255, 128, 65]);
  const largeDomainBytes = Buffer.alloc(6_662_191, 0x5a);
  const largeDomainSha256 = sha256(largeDomainBytes);
  const files = new Map([
    ['artifact-manifest.json', Buffer.from('{"fixtureOnly":true}\n', 'utf8')],
    [longAssetPath, sourceBytes],
    ['assets/opaque.bin', binaryBytes],
    ['data/shared/domains/weapons.json', largeDomainBytes],
  ]);
  const archiveBytes = encodeW09RuntimeSnapshotArchive(buildId, files);
  assert.equal(sha256(largeDomainBytes), largeDomainSha256, 'encoding must not mutate source domain bytes');
  const canonicalByteArchive = encodeW09RuntimeSnapshotArchive(buildId, new Map([
    ['artifact-manifest.json', Buffer.from('{"fixtureOnly":true}\n', 'utf8')],
    ['assets/pad.bin', Buffer.from('f', 'utf8')],
  ]));
  const canonicalEnvelope = gunzipSync(canonicalByteArchive).toString('utf8');
  const canonicalBase64 = JSON.parse(canonicalEnvelope).files.find(row => row.path === 'assets/pad.bin').base64;
  assert.equal(canonicalBase64, 'Zg==');
  for (const forgedBase64 of ['Zh==', 'Zg=!', 'Zg=']) {
    const forgedEnvelope = JSON.parse(canonicalEnvelope);
    forgedEnvelope.files.find(row => row.path === 'assets/pad.bin').base64 = forgedBase64;
    const forgedBytes = gzipSync(Buffer.from(JSON.stringify(sortJsonForTest(forgedEnvelope), null, 2) + '\n', 'utf8'), { level: 9, mtime: 0 });
    await assert.rejects(materializeW09RuntimeSnapshotArchive(forgedBytes, buildId), /base64|metadata|canonical/i);
  }
  assert.throws(() => encodeW09RuntimeSnapshotArchive(buildId, new Map([['C:/escape.txt', Buffer.from('x')]])), /unsafe file path/);
  assert.throws(() => encodeW09RuntimeSnapshotArchive(buildId, new Map([['assets/unsafe\0name', Buffer.from('x')]])), /unsafe file path/);
  for (const unsafePath of ['C:/escape.txt', 'assets/unsafe\0name']) {
    const forged = JSON.parse(gunzipSync(archiveBytes).toString('utf8'));
    forged.files[0].path = unsafePath;
    forged.files.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    const forgedBytes = gzipSync(Buffer.from(JSON.stringify(sortJsonForTest(forged), null, 2) + '\n', 'utf8'), { level: 9, mtime: 0 });
    await assert.rejects(materializeW09RuntimeSnapshotArchive(forgedBytes, buildId), /unsafe or unsorted path/);
  }
  const archivePath = path.join(repo, 'content/contracts/w09/runtime-snapshots', buildId, 'snapshot.json.gz');
  await mkdir(path.dirname(archivePath), { recursive: true });
  await writeFile(archivePath, archiveBytes, { flag: 'wx' });
  const attributes = git(repo, ['check-attr', 'text', 'eol', '--', 'content/contracts/w09/runtime-snapshots/' + buildId + '/snapshot.json.gz']);
  assert.match(attributes, /text: unset/);
  git(repo, ['add', '.gitattributes', 'content/contracts/w09/runtime-snapshots']);
  git(repo, ['commit', '-m', 'W09 runtime archive byte-preservation fixture']);
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', repo, checkout], { encoding: 'utf8', windowsHide: true });
  const checkedOutArchive = await readFile(path.join(checkout, 'content/contracts/w09/runtime-snapshots', buildId, 'snapshot.json.gz'));
  assert.deepEqual(checkedOutArchive, archiveBytes, 'fresh Git checkout must preserve the immutable archive byte-for-byte');
  const restored = await materializeW09RuntimeSnapshotArchive(checkedOutArchive, buildId);
  try {
    assert.deepEqual(await readFile(path.join(restored, ...longAssetPath.split('/'))), sourceBytes);
    assert.deepEqual(await readFile(path.join(restored, 'assets/opaque.bin')), binaryBytes);
    const restoredLargeDomain = await readFile(path.join(restored, 'data/shared/domains/weapons.json'));
    assert.equal(restoredLargeDomain.byteLength, 6_662_191);
    assert.equal(sha256(restoredLargeDomain), largeDomainSha256, 'runtime snapshot must preserve prepared-size domain bytes');
  } finally {
    await rm(restored, { recursive: true, force: true });
  }
  assert.ok(archivePath.length < 220, 'tracked snapshot path remains short on Windows');
});

test('UnitT24_rollback-requires-and-restores-a-complete-multigame-snapshot', async t => {
  let state = createW09ReleaseState();
  const addApproved = (gameVersion, gameReleaseId, digest) => {
    const allocation = planW09ContentVersion(state, {
      gameVersion, gameReleaseId, inputDigest: sha(digest), manifestSha256: sha(String.fromCharCode(digest.charCodeAt(0) + 1)),
    });
    state = reserveW09ContentVersion(state, allocation);
    const record = state.reservations.find(row => row.releaseId === allocation.releaseId);
    record.status = 'approved';
    return record;
  };
  const oldOne = addApproved('1.13.1', 'darktide:1.13.1', 'a');
  const oldTwo = addApproved('1.13.2', 'darktide:1.13.2', 'b');
  const newOne = addApproved('1.13.1', 'darktide:1.13.1', 'c');
  const newTwo = addApproved('1.13.2', 'darktide:1.13.2', 'd');
  const extra = addApproved('1.13.3', 'darktide:1.13.3', 'e');
  const targetBuildId = sha('8');
  const currentBuildId = sha('9');
  const targetPointers = [
    { gameReleaseId: oldOne.gameReleaseId, releaseId: oldOne.releaseId },
    { gameReleaseId: oldTwo.gameReleaseId, releaseId: oldTwo.releaseId },
  ];
  const currentPointers = [
    { gameReleaseId: newOne.gameReleaseId, releaseId: newOne.releaseId },
    { gameReleaseId: newTwo.gameReleaseId, releaseId: newTwo.releaseId },
    { gameReleaseId: extra.gameReleaseId, releaseId: extra.releaseId },
  ];
  state.activeByGame = currentPointers;
  state.activeRuntimeSnapshotBuildId = currentBuildId;
  state.approvedRuntimeSnapshots = [
    { buildId: targetBuildId, activeByGame: targetPointers },
    { buildId: currentBuildId, activeByGame: currentPointers },
  ];
  validateW09ReleaseState(state);
  const restored = restoreW09ActivePointersFromSnapshot(state, targetPointers);
  assert.deepEqual(restored.activeByGame, targetPointers,
    'rollback must replace all active game pointers from the chosen whole-build snapshot');
  assert.equal(restored.activeRuntimeSnapshotBuildId, currentBuildId,
    'the transaction commit updates the whole-build identity after deployment verification');

  const root = await mkdtemp(path.join(os.tmpdir(), 'w09-rollback-set-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, ['init']);
  git(root, ['checkout', '-b', 'main']);
  const statePath = path.join(root, 'content/contracts/w09/release-state.json');
  await writeW09ReleaseStateAtomic(statePath, state);
  const savedRef = process.env.GITHUB_REF;
  process.env.GITHUB_REF = 'refs/heads/main';
  t.after(() => {
    if (savedRef === undefined) delete process.env.GITHUB_REF;
    else process.env.GITHUB_REF = savedRef;
  });
  let callbackCalled = false;
  for (const releaseIds of [[oldOne.releaseId], [oldOne.releaseId, oldTwo.releaseId, extra.releaseId]]) {
    await assert.rejects(rollbackW09SharedComposition({
      repoRoot: root,
      targetReleaseIds: releaseIds,
      targetRuntimeSnapshotBuildId: targetBuildId,
      expectedCurrent: currentW09ActiveSnapshot(state),
      promoteVerifiedArtifact: async () => { callbackCalled = true; throw new Error('invalid whole-snapshot set must not deploy'); },
    }), /exactly match the full active release set/i);
  }
  assert.equal(callbackCalled, false, 'partial or expanded targets must fail before any deployment callback');
});

// Scenario: a disposable clone already has tracked compiler inputs at the pinned W09 paths.
// Purpose: replace regular fixture files safely and reject non-file destinations before reading compiler pins.
test('UnitT14_replaces-only-regular-pinned-files-in-a-disposable-clone', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'w09-compiler-pin-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const relativePath of W09_COMPILER_FILE_PATHS) {
    const destination = path.join(root, ...relativePath.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.from('preexisting tracked clone file'), { flag: 'wx' });
  }

  await installW09CompilerFilesInFixture(root);
  for (const relativePath of W09_COMPILER_FILE_PATHS) {
    const destination = path.join(root, ...relativePath.split('/'));
    const sourcePath = path.join(REPO_ROOT, ...relativePath.split('/'));
    assert.deepEqual(await readFile(destination), await readFile(sourcePath), relativePath);
  }

  const nonFileRoot = path.join(root, 'non-file-destination');
  const firstDestination = path.join(nonFileRoot, ...W09_COMPILER_FILE_PATHS[0].split('/'));
  await mkdir(firstDestination, { recursive: true });
  await assert.rejects(installW09CompilerFilesInFixture(nonFileRoot), /must be a regular file/i);
});

// Scenario: the isolated replay clone begins on main, another branch, or detached HEAD while a main ref exists.
// Purpose: prove fixture initialization is repeatable without changing the checked-out commit or tree.
test('UnitT15_replay-fixture-main-initialization-preserves-HEAD-and-tree-across-branch-states', async t => {
  for (const [testName, state] of [
    ['UnitT10_main-already-checked-out', 'main-already-checked-out'],
    ['UnitT20_other-branch-checked-out', 'other-branch-checked-out'],
    ['UnitT30_detached-head', 'detached-head'],
  ]) {
    await t.test(testName, async t => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'w09-branch-init-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      git(root, ['init', '-b', 'main']);
      git(root, ['config', 'core.autocrlf', 'false']);
      git(root, ['config', 'user.name', 'W09 branch fixture']);
      git(root, ['config', 'user.email', 'w09-branch-fixture@example.invalid']);
      await writeFile(path.join(root, 'tracked.txt'), 'base\n', 'utf8');
      git(root, ['add', '--', 'tracked.txt']);
      git(root, ['commit', '-m', 'W09 branch fixture base']);

      if (state === 'other-branch-checked-out') {
        git(root, ['checkout', '-b', 'fixture-other']);
        await writeFile(path.join(root, 'other.txt'), 'other branch\n', 'utf8');
        git(root, ['add', '--', 'other.txt']);
        git(root, ['commit', '-m', 'W09 branch fixture other branch']);
      } else if (state === 'detached-head') {
        git(root, ['checkout', '--detach', 'HEAD']);
      }

      const headBefore = git(root, ['rev-parse', 'HEAD']);
      const treeBefore = git(root, ['write-tree']);
      initializeW09ReplayCloneBranch(root);

      assert.equal(git(root, ['rev-parse', 'HEAD']), headBefore);
      assert.equal(git(root, ['write-tree']), treeBefore);
      assert.equal(git(root, ['status', '--porcelain']), '');
    });
  }
});

// Scenario: pinned formal Source bytes are published through the resolver and combined with reviewed Web overlays.
// Purpose: exercise W05 build/replay, source lock validation, W08 projection, allocation and immutable nested package retry.
// All synthetic human approvals and fake archive HTTP responses are confined to disposable local Git fixtures.
test('InterT14_formal-source-replay-prepares-a-candidate-package-and-reuses-its-nested-files', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'w09-formal-integration-'));
  const preserveFixture = process.env.W09_PRESERVE_FORMAL_FIXTURE === '1';
  if (!preserveFixture) t.after(() => rm(root, { recursive: true, force: true }));
  const webRoot = path.join(root, 'web');
  const sourceRoot = path.join(root, 'source');
  const packetRoot = path.join(root, 'packet');
  const buildRoot = path.join(root, 'source-build');
  const sourceBundleRoot = path.join(REPO_ROOT, 'content/contracts/w09/test-source-runtime');
  const sourceApiPath = path.join(REPO_ROOT, 'content/contracts/w09/source-request/contract-w09-request.mjs');
  const sourceApi = await import(pathToFileURL(sourceApiPath).href);
  const sourceBundleLock = JSON.parse(await readFile(path.join(sourceBundleRoot, 'lock.json'), 'utf8'));
  assert.equal(sourceBundleLock.fixtureOnly, true);
  assert.equal(sourceBundleLock.publicationEligible, false);
  assert.equal(sourceBundleLock.repository, 'SyuanTsai/DarkTide-Source-Data');

  execFileSync('git', ['clone', '-c', 'core.autocrlf=false', '--quiet', '--no-hardlinks', REPO_ROOT, webRoot], { encoding: 'utf8', windowsHide: true });
  git(webRoot, ['config', 'core.autocrlf', 'false']);
  git(webRoot, ['config', 'user.name', 'W09 isolated fixture']);
  git(webRoot, ['config', 'user.email', 'w09-fixture@example.invalid']);
  git(webRoot, ['remote', 'set-url', 'origin', 'https://github.com/SyuanTsai/DarkTide-Web.git']);
  initializeW09ReplayCloneBranch(webRoot);
  await removeSelectedCompositionFromFixture(webRoot);

  await mkdir(sourceRoot, { recursive: true });
  for (const row of sourceBundleLock.files) {
    const bytes = await readFile(path.join(REPO_ROOT, ...row.cachePath.split('/')));
    assert.equal(bytes.byteLength, row.sizeBytes, 'pinned Source test runtime size: ' + row.sourcePath);
    assert.equal(sha256(bytes), row.sha256, 'pinned Source test runtime hash: ' + row.sourcePath);
    const destination = path.join(sourceRoot, ...row.sourcePath.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
  }

  const sourceValidatorPath = path.join(sourceRoot, 'scripts/content/contract-validator.mjs');
  const sourceValidator = await import(pathToFileURL(sourceValidatorPath).href);
  const sourceSchema = JSON.parse(await readFile(path.join(sourceRoot, 'content/schema/v2/source-contract.schema.json'), 'utf8'));
  const pinnedWebInputs = await loadW08CompilerInputs({ repoRoot: REPO_ROOT });
  const formalSource = makeTestOnlyFormalSource(
    makeCompactFormalSource(pinnedWebInputs.w06.sourceContract, pinnedWebInputs.w07.sourceContract),
    sourceValidator,
  );
  const sourceValidation = sourceValidator.validateSourceContract(formalSource, { schema: sourceSchema });
  assert.equal(sourceValidation.valid, true, JSON.stringify(sourceValidation.issues.slice(0, 5)));
  assert.equal(sourceValidation.publicationEligible, true);

  const inputPath = sourceApi.W09_SOURCE_INPUT_PATHS.w07;
  const inputBytes = jsonBytes(formalSource);
  const inputFile = path.join(sourceRoot, ...inputPath.split('/'));
  await mkdir(path.dirname(inputFile), { recursive: true });
  await writeFile(inputFile, inputBytes, { flag: 'wx' });
  git(sourceRoot, ['init', '-b', 'main']);
  git(sourceRoot, ['config', 'core.autocrlf', 'false']);
  git(sourceRoot, ['config', 'user.name', 'W09 isolated fixture']);
  git(sourceRoot, ['config', 'user.email', 'w09-fixture@example.invalid']);
  git(sourceRoot, ['remote', 'add', 'origin', sourceApi.W09_SOURCE_ORIGIN]);
  git(sourceRoot, ['add', '--all']);
  git(sourceRoot, ['commit', '-m', 'W09 isolated source fixture']);
  const sourceCommit = git(sourceRoot, ['rev-parse', 'HEAD']);
  const committedInputBytes = gitBytes(sourceRoot, [
    'show', sourceCommit + ':' + inputPath,
  ]);
  assert.deepEqual(committedInputBytes, inputBytes, 'test input must retain its exact LF Git bytes');
  const inputSha256 = sha256(committedInputBytes);
  const inputRefs = ['baseline', 'authoring', 'candidate'].map(role => ({
    role,
    commit: 'current',
    path: inputPath,
    sha256: inputSha256,
  }));
  const builder = await import(pathToFileURL(path.join(sourceRoot, 'scripts/content/contract-w05-build.mjs')).href);
  const built = await builder.buildContractCandidate({
    baseline: formalSource,
    authoring: formalSource,
    candidate: formalSource,
    outRoot: buildRoot,
    mode: 'formal',
  });
  assert.equal(built.validation.valid, true);
  assert.equal(built.validation.publicationEligible, true);
  assert.equal(built.manifest.mode, 'formal');
  await mkdir(packetRoot, { recursive: true });
  for (const [name, bytes] of built.files) await writeFile(path.join(packetRoot, name), bytes, { flag: 'wx' });
  const requests = await sourceApi.createW09SourceRequests({
    packetDir: packetRoot,
    sourceRoot,
    expectedCommit: sourceCommit,
    inputRefs,
  });
  const request = requests.find(row => row.gameReleaseId === 'darktide:1.13.2');
  assert.ok(request, 'Source W05 packet must include the selected W07 game release');
  assert.equal(request.eligibility.status, 'eligible');
  const archivedRequests = await Promise.all(requests.map(async (row, index) => ({
    request: row,
    archiveBytes: await sourceApi.createW09SourceArchive({ request: row, packetDir: packetRoot }),
    releaseTag: sourceApi.w09SourceArchiveTag(row.releaseId),
    releaseAssetName: sourceApi.w09SourceArchiveAssetName(row.releaseId),
    assetId: index + 1,
    assetUrl: 'https://api.github.com/repos/SyuanTsai/DarkTide-Source-Data/releases/assets/' + (index + 1),
  })));
  const archiveRow = archivedRequests.find(row => row.request.releaseId === request.releaseId);
  const archiveBytes = archiveRow.archiveBytes;
  const archiveSha256 = sha256(archiveBytes);
  const fetchImpl = async url => {
    const parsed = new URL(String(url));
    const taggedArchive = archivedRequests.find(row => parsed.pathname === '/repos/SyuanTsai/DarkTide-Source-Data/releases/tags/' + row.releaseTag);
    if (taggedArchive) {
      return new Response(JSON.stringify({
        id: 1,
        tag_name: taggedArchive.releaseTag,
        draft: false,
        prerelease: true,
        assets: [{ id: taggedArchive.assetId, name: taggedArchive.releaseAssetName, state: 'uploaded', url: taggedArchive.assetUrl }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const assetArchive = archivedRequests.find(row => parsed.href === row.assetUrl);
    if (assetArchive) return new Response(assetArchive.archiveBytes, { status: 200 });
    const referencedArchive = archivedRequests.find(row => parsed.pathname === '/repos/SyuanTsai/DarkTide-Source-Data/git/ref/tags/' + row.releaseTag);
    if (referencedArchive) {
      return new Response(JSON.stringify({ ref: 'refs/tags/' + referencedArchive.releaseTag, object: { type: 'commit', sha: referencedArchive.request.sourceCommit } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('unexpected fixture Source API URL: ' + parsed.pathname);
  };

  const sourceSchemaBytes = gitBytes(sourceRoot, ['show', sourceCommit + ':content/schema/v2/source-contract.schema.json']);
  const sourceValidatorBytes = gitBytes(sourceRoot, ['show', sourceCommit + ':scripts/content/contract-validator.mjs']);
  const sourceLock = {
    schemaVersion: 'w09-source-contract-pin/1',
    repository: 'https://github.com/SyuanTsai/DarkTide-Source-Data',
    commit: sourceCommit,
    schemaId: sourceSchema.$id,
    files: {
      schema: { path: 'content/schema/v2/source-contract.schema.json', sha256: sha256(sourceSchemaBytes) },
      data: { path: inputPath, sha256: inputSha256 },
      validator: { path: 'scripts/content/contract-validator.mjs', sha256: sha256(sourceValidatorBytes) },
    },
  };
  const authoringSourcePin = (await import('../scripts/content/contract-w09-compose.mjs')).createW09AuthoringSourcePin(sourceLock);
  const sourceTechnicalBytes = built.files.get('technical.json');
  const sourceTechnical = JSON.parse(sourceTechnicalBytes.toString('utf8'));
  const sourceTechnicalValidation = sourceValidator.validateSourceContract(sourceTechnical, { schema: sourceSchema });
  assert.equal(sourceTechnicalValidation.valid, true, JSON.stringify(sourceTechnicalValidation.issues.slice(0, 5)));

  const compilerInput = await loadW08CompilerInputs({ repoRoot: webRoot });
  const w06Inputs = await loadWebAuthoringInputs({ repoRoot: REPO_ROOT, mode: 'w06' });
  const w07Inputs = await loadWebAuthoringInputs({ repoRoot: REPO_ROOT, mode: 'w07' });
  const inputLockBytes = gitBytes(webRoot, ['show', git(webRoot, ['rev-parse', 'HEAD']) + ':content/contracts/w08/compiler-inputs.lock.json']);
  const compilerLockBytes = gitBytes(webRoot, ['show', git(webRoot, ['rev-parse', 'HEAD']) + ':content/contracts/w08/compiler.lock.json']);
  const sourceRecordMap = new Map(sourceTechnical.records.map(record => [record.gameReleaseId + '\0' + record.recordId, record]));
  const sourceReleaseMap = new Map(sourceTechnical.gameReleases.map(release => [release.gameReleaseId, release]));
  const adaptAuthoring = (modeName, inputs, keepPresentation) => {
    const authoring = structuredClone(inputs.authoring);
    authoring.presentations = authoring.presentations.filter(keepPresentation);
    const hasSourceRef = ref => ref && sourceRecordMap.has(ref.gameReleaseId + '\0' + ref.recordId);
    for (const collection of ['termLocalizations']) {
      authoring[collection] = (authoring[collection] ?? []).filter(item => hasSourceRef(item.termRef));
    }
    const officialInputs = structuredClone(inputs.officialInputs);
    officialInputs.sources = officialInputs.sources.filter(item => hasSourceRef(item.entityRef)
      && (!item.bindingContext || hasSourceRef(item.bindingContext.variantRef)));
    const officialInputsBytes = modeName === 'w06' ? Buffer.from(inputs.officialInputsBytes) : jsonBytes(officialInputs);
    const retainedOwners = new Map([
      ['presentation', new Set(authoring.presentations.map(item => item.authoringId))],
      ['term-localization', new Set((authoring.termLocalizations ?? []).map(item => item.authoringId))],
      ['announcement', new Set((authoring.announcements ?? []).map(item => item.announcementId))],
      ['game-change', new Set((authoring.gameChanges ?? []).map(item => item.changeId))],
      ['official-text-change', new Set((authoring.officialTextChanges ?? []).map(item => item.changeId))],
    ]);
    authoring.reviewTargets = authoring.reviewTargets.filter(target => retainedOwners.get(target.ownerKind)?.has(target.ownerId));
    authoring.reviewReceipts = [];
    authoring.fixtureOnly = false;
    authoring.publicationEligible = false;
    authoring.sourcePin = authoringSourcePin;
    authoring.officialInputsSha256 = sha256(officialInputsBytes);
    if (modeName === 'w07') {
      const presentation = authoring.presentations[0];
      const sourceWeapon = sourceTechnical.records.find(record => record.recordId === presentation.entityRef.recordId
        && record.gameReleaseId === presentation.entityRef.gameReleaseId && record.kind === 'weapon');
      assert.ok(sourceWeapon, 'selected W07 weapon must resolve in the formal Source technical output');
      const selectedStat = sourceWeapon.payload.statBindings[0].statKey;
      const selectedAction = sourceWeapon.payload.attackProfileRefs[0];
      const originalView = presentation.weaponView;
      const statSection = originalView.statSections.find(section => section.sourceStat === selectedStat);
      const attackProfile = originalView.attackProfileRefs.find(ref => ref.recordId === selectedAction.recordId
        && ref.gameReleaseId === selectedAction.gameReleaseId);
      assert.ok(statSection, 'selected W07 Source stat group must have a Web view section');
      assert.ok(attackProfile, 'selected W07 Source action must have a Web view binding');
      const filterPinnedRefs = refs => refs.filter(ref => {
        const record = sourceRecordMap.get(ref.gameReleaseId + '\0' + ref.recordId);
        return record && (!ref.kind || ref.kind === record.kind);
      });
      for (const key of ['claimRefs', 'statDefinitionRefs', 'curveRefs']) {
        if (Array.isArray(statSection[key])) statSection[key] = filterPinnedRefs(statSection[key]);
      }
      presentation.weaponView.statSections = [statSection];
      presentation.weaponView.attackProfileRefs = [attackProfile];
      authoring.reviewTargets = authoring.reviewTargets.filter(target => {
        const match = /^\/weaponView\/(?:statSections|attackProfileRefs)\/(\d+)(?:\/|$)/u.exec(target.fieldPath);
        return !match || match[1] === '0';
      });
    }
    const reviewMode = {
      ...inputs,
      webLock: {
        ...inputs.webLock,
        officialInputs: { ...inputs.webLock.officialInputs, sha256: authoring.officialInputsSha256 },
      },
      sourceContract: sourceTechnical,
      sourceLock,
      sourcePin: authoringSourcePin,
      sourceSchema,
      sourceValidator,
      sourceValidation: sourceTechnicalValidation,
      sourceRecordMap,
      sourceReleaseMap,
      officialInputs,
      authoring,
    };
    authoring.reviewReceipts = authoring.reviewTargets.map(target => createReviewReceipt(authoring, target, {
      sourceContract: sourceTechnical,
      officialInputs,
      sourceValidator,
      sourceRecordMap,
      termRules: inputs.termRules,
      mode: modeName,
      reviewer: { kind: 'human', id: 'w09-isolated-test-fixture-only' },
      reviewedAt: '2026-10-20T00:00:00Z',
    }));
    const validation = validateWebAuthoring(authoring, reviewMode);
    assert.equal(validation.valid, true, modeName + ' pinned donor: ' + JSON.stringify(validation.issues.slice(0, 12)));
    return { authoring, officialInputs, officialInputsBytes };
  };
  const w06Adapted = adaptAuthoring('w06', w06Inputs, () => true);
  const selectedW07RecordId = 'darktide:weapon:chainaxe:p1-m2';
  const w07Adapted = adaptAuthoring('w07', w07Inputs, item => item.entityRef.recordId === selectedW07RecordId);
  const w06Authoring = w06Adapted.authoring;
  const w07Authoring = w07Adapted.authoring;

  const overlayRows = [];
  const writeOverlay = async (modeName, target, relativePath, value, bytes = jsonBytes(value)) => {
    const absolutePath = path.join(webRoot, ...relativePath.split('/'));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes, { flag: 'wx' });
    overlayRows.push({ mode: modeName, target, path: relativePath, sizeBytes: bytes.byteLength, sha256: sha256(bytes) });
  };
  await writeOverlay('w06', 'authoring', 'content/contracts/w09/authoring-overlays/w06/authoring/integration-fixture.json', w06Authoring);
  await writeOverlay('w06', 'officialInputs', 'content/contracts/w09/authoring-overlays/w06/officialInputs/integration-fixture.json', w06Adapted.officialInputs, w06Adapted.officialInputsBytes);
  await writeOverlay('w07', 'authoring', 'content/contracts/w09/authoring-overlays/w07/authoring/integration-fixture.json', w07Authoring);
  await writeOverlay('w07', 'officialInputs', 'content/contracts/w09/authoring-overlays/w07/officialInputs/integration-fixture.json', w07Adapted.officialInputs, w07Adapted.officialInputsBytes);

  await installW09CompilerFilesInFixture(webRoot);
  git(webRoot, ['add', '--all']);
  git(webRoot, ['commit', '-m', 'W09 isolated compiler code fixture']);
  const codeCommit = git(webRoot, ['rev-parse', 'HEAD']);
  const codeRows = W09_COMPILER_FILE_PATHS.map(relativePath => {
    const bytes = gitBytes(webRoot, ['show', codeCommit + ':' + relativePath]);
    return { path: relativePath, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
  });
  const compilerCodeLock = {
    schema: 'w09-web-compiler-lock/1',
    repository: 'https://github.com/SyuanTsai/DarkTide-Web',
    commit: codeCommit,
    files: codeRows,
    fileSetSha256: sha256(Buffer.from(canonicalW09Json(codeRows), 'utf8')),
  };
  const compilerCodeLockPath = path.join(webRoot, 'content/contracts/w09/compiler.lock.json');
  await mkdir(path.dirname(compilerCodeLockPath), { recursive: true });
  const compilerCodeLockBytes = jsonBytes(compilerCodeLock);
  let existingCompilerCodeLock = await lstat(compilerCodeLockPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!existingCompilerCodeLock) {
    await writeFile(compilerCodeLockPath, jsonBytes({ schema: 'w09-isolated-fixture-prior-lock/1' }), { flag: 'wx' });
    existingCompilerCodeLock = await lstat(compilerCodeLockPath);
  }
  if (existingCompilerCodeLock?.isSymbolicLink() || (existingCompilerCodeLock && !existingCompilerCodeLock.isFile())) {
    throw new Error('isolated test clone compiler lock must be a regular fixture file');
  }
  // This path is under the disposable test clone: replace the copied production pin with the fixture commit lock.
  await writeFile(compilerCodeLockPath, compilerCodeLockBytes, existingCompilerCodeLock ? undefined : { flag: 'wx' });
  git(webRoot, ['add', '--all']);
  git(webRoot, ['commit', '-m', 'W09 isolated compiler code lock']);
  const overlayCommit = git(webRoot, ['rev-parse', 'HEAD']);
  const baseHead = git(webRoot, ['rev-parse', 'HEAD^^']);

  const canaryGlobalKey = '__W09_SOURCE_RUNTIME_TEST_CANARY';
  assert.equal(Object.hasOwn(globalThis, canaryGlobalKey), false, 'isolated source-runtime canary global must be unused');
  const validatorCanaryPath = path.join(webRoot, '.w09-source-validator-canary.json');
  globalThis[canaryGlobalKey] = {
    path: validatorCanaryPath,
    credentials: { web: 'synthetic-web-token-only', cloudflare: 'synthetic-cloudflare-token-only' },
  };
  t.after(() => { delete globalThis[canaryGlobalKey]; });
  const untrustedValidator = await readFile(sourceValidatorPath, 'utf8');
  const validatorCanaryCode = `\nconst canary = globalThis[${JSON.stringify(canaryGlobalKey)}];\nif (canary) await (await import('node:fs/promises')).writeFile(canary.path, JSON.stringify(canary.credentials), 'utf8');\n`;
  await writeFile(sourceValidatorPath, untrustedValidator + validatorCanaryCode, 'utf8');
  git(sourceRoot, ['add', 'scripts/content/contract-validator.mjs']);
  git(sourceRoot, ['commit', '-m', 'SYP-341\n\nCreate an isolated unapproved Source validator fixture']);
  const unapprovedSourceCommit = git(sourceRoot, ['rev-parse', 'HEAD']);
  assert.notEqual(unapprovedSourceCommit, sourceCommit);

  const unapprovedRequest = structuredClone(request);
  unapprovedRequest.sourceCommit = unapprovedSourceCommit;
  unapprovedRequest.sourceInputs = unapprovedRequest.sourceInputs.map(input => ({ ...input, commit: unapprovedSourceCommit }));
  const originalArchiveRequest = archiveRow.request;
  const originalArchiveBytes = archiveRow.archiveBytes;
  archiveRow.request = unapprovedRequest;
  archiveRow.archiveBytes = await sourceApi.createW09SourceArchive({ request: unapprovedRequest, packetDir: packetRoot });
  try {
    await assert.rejects(
      prepareW09SourceProposal({ repoRoot: webRoot, sourceRoot, releaseId: request.releaseId, fetchImpl }),
      /pinned Source runtime|approved W09 code hash/i,
      'an unapproved Source validator pin must fail before its module can read synthetic Web/Cloudflare canaries',
    );
    await assert.rejects(readFile(validatorCanaryPath), { code: 'ENOENT' });
  } finally {
    archiveRow.request = originalArchiveRequest;
    archiveRow.archiveBytes = originalArchiveBytes;
  }

  const proposal = await prepareW09SourceProposal({ repoRoot: webRoot, sourceRoot, releaseId: request.releaseId, fetchImpl });
  await assert.rejects(readFile(validatorCanaryPath), { code: 'ENOENT' }, 'the old approved request must not execute the modified working-tree validator');
  assert.equal(proposal.proposalWritten, true, 'release_id-only handoff must persist a Web proposal');
  assert.equal(proposal.selected, false);
  assert.equal(proposal.allocationReserved, false);
  assert.equal(proposal.publicationEligible, false);
  const proposalState = JSON.parse(await readFile(path.join(proposal.proposalDirectory, 'proposal.json'), 'utf8'));
  assert.equal(proposalState.proposalOnly, true);
  assert.equal(proposalState.selected, false);
  const reviewState = JSON.parse(await readFile(path.join(proposal.proposalDirectory, 'review-candidate.json'), 'utf8'));
  assert.deepEqual(reviewState.source.changedRecords, request.changedRecords);
  assert.deepEqual(reviewState.source.changedClaims, request.changedClaims);
  assert.equal(reviewState.web.status, 'web-authoring-required');
  assert.match(reviewState.web.reason, /Source record reference is unresolved: .*chainaxe:p1-m1/,
    'before selection, incompatible baseline authoring remains a durable pending proposal');
  await assert.rejects(readFile(path.join(webRoot, 'content/contracts/w09/source-handoff/selected.json')), /ENOENT/);
  await assert.rejects(readFile(path.join(webRoot, 'content/contracts/w09/release-state.json')), /ENOENT/);
  const proposalRetry = await prepareW09SourceProposal({ repoRoot: webRoot, sourceRoot, releaseId: request.releaseId, fetchImpl });
  assert.equal(proposalRetry.reused, true, 'same event retry must reuse the immutable proposal bytes');

  const compilerIdentity = await loadW08CompilerInputs({ repoRoot: webRoot });
  const webLock = {
    w08InputLockSha256: sha256(gitBytes(webRoot, ['show', baseHead + ':content/contracts/w08/compiler-inputs.lock.json'])),
    w08CompilerLockSha256: sha256(gitBytes(webRoot, ['show', baseHead + ':content/contracts/w08/compiler.lock.json'])),
    w08AuthoringCommit: compilerIdentity.inputLock.authoringCommit,
    w08CompilerCommit: compilerIdentity.compilerIdentity.commit,
    w09CompilerLockSha256: sha256(compilerCodeLockBytes),
    compilerFileSetSha256: compilerCodeLock.fileSetSha256,
    compilerCommit: codeCommit,
    overlayCommit,
    authoringCommit: overlayCommit,
  };
  assert.equal(webLock.w08InputLockSha256, sha256(inputLockBytes));
  assert.equal(webLock.w08CompilerLockSha256, sha256(compilerLockBytes));
  const compositionLock = {
    schema: 'w09-web-inputs-lock/1',
    repository: 'https://github.com/SyuanTsai/DarkTide-Web',
    source: {
      releaseId: request.releaseId,
      requestId: request.requestId,
      sourceCommit: request.sourceCommit,
      sourceRevision: request.sourceRevision,
      manifestSha256: request.manifestSha256,
      archiveSha256,
      packetFiles: request.packetFiles,
    },
    web: webLock,
    gameReleaseId: request.gameReleaseId,
    authoringOverlay: overlayRows,
  };
  const selection = {
    schema: 'w09-selected-composition/1',
    repository: 'SyuanTsai/DarkTide-Web',
    sourceRevision: request.sourceRevision,
    proposals: [{
      gameReleaseId: request.gameReleaseId,
      releaseId: request.releaseId,
      requestId: request.requestId,
      manifestSha256: request.manifestSha256,
      archiveSha256,
    }],
  };
  const lockFile = path.join(webRoot, 'content/contracts/w09/source-handoff/locks', request.requestId + '.json');
  const selectionFile = path.join(webRoot, 'content/contracts/w09/source-handoff/selected.json');
  await mkdir(path.dirname(lockFile), { recursive: true });
  await writeFile(lockFile, jsonBytes(compositionLock), { flag: 'wx' });
  await writeFile(selectionFile, jsonBytes(selection), { flag: 'wx' });
  git(webRoot, ['add', '--all']);
  git(webRoot, ['commit', '-m', 'W09 isolated reviewed composition fixture']);

  const carriedProposal = await prepareW09SourceProposal({ repoRoot: webRoot, sourceRoot, releaseId: request.releaseId, fetchImpl });
  await assert.rejects(readFile(validatorCanaryPath), { code: 'ENOENT' }, 'proposal and compiler projection must use the approved historical runtime');
  assert.equal(carriedProposal.selected, false, 'the refreshed same-release proposal remains unselected');
  assert.notEqual(carriedProposal.proposalDirectory, proposal.proposalDirectory,
    'changed Web inputs must create a new immutable proposal version instead of conflicting with history');
  const carriedReview = JSON.parse(await readFile(path.join(carriedProposal.proposalDirectory, 'review-candidate.json'), 'utf8'));
  assert.ok(carriedReview.candidate, JSON.stringify(carriedReview.web));
  assert.equal(carriedReview.web.status, 'ready-for-release-allocation');
  assert.equal(carriedReview.candidate.manifest.proposalPath, 'candidate/manifest.json');
  assert.equal(carriedReview.candidate.manifest.externalPath, carriedReview.candidate.manifest.path);
  assert.ok(carriedReview.web.review.receipts.length > 0);
  assert.ok(carriedReview.web.review.receipts.every(row => row.receipt.decision === 'approved'
    && row.receipt.reviewer?.kind === 'human' && /^w09-isolated-test-fixture-only$/.test(row.receipt.reviewer.id)),
  'the selected-overlay fixture must use only explicitly synthetic test receipts');
  for (const row of carriedReview.candidate.files) {
    assert.ok(row.proposalPath.startsWith('candidate/domains/'));
    assert.equal(row.externalPath, 'data/' + carriedReview.candidate.manifest.dataRevision + '/' + row.proposalPath.slice('candidate/'.length));
    assert.equal((await readFile(path.join(carriedProposal.proposalDirectory, ...row.proposalPath.split('/')))).byteLength, row.sizeBytes);
    assert.ok(path.join(carriedProposal.proposalDirectory, ...row.proposalPath.split('/')).length < 240,
      'immutable proposal internal paths must remain safe for ordinary Windows checkouts');
  }
  const carriedLock = JSON.parse(await readFile(path.join(carriedProposal.proposalDirectory, 'web-input-lock.json'), 'utf8'));
  assert.equal(carriedLock.web.overlayCommit, overlayCommit, 'new Source event must retain the selected Web overlay pin');
  assert.deepEqual(carriedLock.authoringOverlay, overlayRows, 'new Source event must carry forward selected current authoring/official-input overlays');
  assert.ok(await readFile(path.join(proposal.proposalDirectory, 'web-input-lock.json')),
    'the prior immutable proposal version must remain available after Web inputs change');

  const savedGitHubRef = process.env.GITHUB_REF;
  process.env.GITHUB_REF = 'refs/heads/main';
  t.after(() => {
    if (savedGitHubRef === undefined) delete process.env.GITHUB_REF;
    else process.env.GITHUB_REF = savedGitHubRef;
  });
  const { prepareW09SharedRelease } = await import('../scripts/content/contract-w09-release.mjs');
  const statePath = path.join(webRoot, 'content/contracts/w09/release-state.json');
  const preparationCheckpoints = [];
  const first = await prepareW09SharedRelease({
    repoRoot: webRoot, sourceRoot, releaseId: request.releaseId, fetchImpl,
    requireDurableState: true,
    persistDurableState: async ({ phase, statePath: checkpointPath }) => {
      assert.equal(checkpointPath, statePath);
      const saved = JSON.parse(await readFile(statePath, 'utf8'));
      const reservation = saved.reservations.at(-1);
      const packagePath = path.join(webRoot, 'content/contracts/w09/prepared', reservation.releaseId);
      const packageExists = await lstat(packagePath).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error));
      if (phase === 'reserved') {
        assert.equal(reservation.status, 'reserved');
        assert.equal(packageExists, false, 'reservation ownership must be durable before package files are built');
      } else if (phase === 'prepared') {
        assert.equal(reservation.status, 'prepared');
        assert.equal(packageExists, true, 'prepared checkpoint must follow complete immutable package creation');
      }
      preparationCheckpoints.push({ phase, releaseId: reservation.releaseId, packageExists });
      return { status: 'persisted' };
    },
  });
  await assert.rejects(readFile(validatorCanaryPath), { code: 'ENOENT' }, 'selected-composition projection must not import the modified Source working-tree validator');
  assert.deepEqual(preparationCheckpoints.map(row => row.phase), ['reserved', 'prepared']);
  assert.equal(first.status, 'prepared', JSON.stringify(first.gate));
  assert.equal(first.gate.status, 'ready-for-release-allocation');
  assert.equal(first.allocationReserved, true);
  assert.equal(first.packageWritten, true);
  const candidate = JSON.parse(await readFile(path.join(first.packageRoot, 'candidate.json'), 'utf8'));
  assert.equal(candidate.candidateOnly, true);
  assert.equal(candidate.publicationEligible, false);
  assert.equal(candidate.source.publicationEligible, true);
  assert.equal(candidate.source.providerImmutable, null);
  assert.equal(candidate.web.compilerCommit, codeCommit, 'prepared provenance must pin the complete W09 executable commit');
  assert.equal(candidate.web.compilerFileSetSha256, compilerCodeLock.fileSetSha256);
  const preparedFiles = await listRegularFiles(first.packageRoot);
  const manifestRelativePath = candidate.manifest.path.slice(1);
  const packagedManifestBytes = await readFile(path.join(first.packageRoot, ...manifestRelativePath.split('/')));
  assert.equal(sha256(packagedManifestBytes), candidate.manifest.sha256, 'prepared package must retain the exact shared manifest URL bytes');
  const sharedManifest = JSON.parse(packagedManifestBytes.toString('utf8'));
  assert.equal(sharedManifest.dataRevision, candidate.manifest.dataRevision);
  assert.equal(sharedManifest.web.compilerCommit, codeCommit, 'shared manifest must identify the pinned W09 executable compiler');
  for (const row of sharedManifest.files) {
    const relativePath = 'data/' + sharedManifest.dataRevision + '/' + row.path;
    assert.ok(preparedFiles.includes(relativePath), 'prepared package must materialize manifest-relative URL ' + relativePath);
    const bytes = await readFile(path.join(first.packageRoot, ...relativePath.split('/')));
    assert.equal(bytes.byteLength, row.sizeBytes, 'prepared domain size must match shared manifest: ' + row.path);
    assert.equal(sha256(bytes), row.sha256, 'prepared domain hash must match shared manifest: ' + row.path);
  }
  assert.ok(preparedFiles.some(row => row.startsWith('data/' + sharedManifest.dataRevision + '/domains/')),
    'candidate package must contain nested revisioned compiler domains');

  const metadataOnly = path.join(webRoot, 'content/contracts/w09/source-handoff/metadata-only.txt');
  await writeFile(metadataOnly, 'metadata-only commit does not change W09 executable bytes\n', { flag: 'wx' });
  git(webRoot, ['add', '--all']);
  git(webRoot, ['commit', '-m', 'W09 isolated metadata-only retry fixture']);
  assert.equal(loadW09CompilerCodePin({ repoRoot: webRoot }).fileSetSha256, compilerCodeLock.fileSetSha256);
  const retry = await prepareW09SharedRelease({ repoRoot: webRoot, sourceRoot, releaseId: request.releaseId, fetchImpl });
  assert.equal(retry.status, 'prepared');
  assert.equal(retry.releaseId, first.releaseId);
  assert.equal(retry.contentVersion, first.contentVersion);
  assert.equal(retry.packageRoot, first.packageRoot);
  assert.equal(retry.inputDigest, first.inputDigest, 'metadata-only HEAD movement must not allocate a new input identity');
  assert.deepEqual(await listRegularFiles(retry.packageRoot), preparedFiles);
  const pinnedCodePath = path.join(webRoot, 'scripts/content/contract-w09-release.mjs');
  const pinnedCodeBytes = await readFile(pinnedCodePath);
  await writeFile(pinnedCodePath, Buffer.concat([pinnedCodeBytes, Buffer.from('\n') ]));
  assert.throws(() => loadW09CompilerCodePin({ repoRoot: webRoot }), /working file differs|working file|code pin/i,
    'unreviewed W09 executable bytes must fail the tracked compiler lock');
  await writeFile(pinnedCodePath, pinnedCodeBytes);
  let state = await readW09ReleaseState(statePath);
  assert.deepEqual(currentW09ActiveSnapshot(state), { activeByGame: [], runtimeSnapshotBuildId: null },
    'candidate allocation must not mutate shared or whole-site active pointers');
  const operationOrder = [];
  const deployer = async ({ artifact, transactionId }) => {
    operationOrder.push('external');
    const journal = await readW09ReleaseState(statePath);
    assert.equal(journal.pendingPromotion?.transactionId, transactionId,
      'the exact journal must be visible before any external deploy callback');
    assert.equal(journal.pendingPromotion?.phase, 'prepared');
    assert.ok(await readFile(path.join(webRoot, 'content/contracts/w09/runtime-snapshots', artifact.build_id, 'snapshot.json.gz')),
      'the runtime snapshot must be durable before external deployment');
    return {
      status: 'verified',
      build_id: artifact.build_id,
      data_revision: artifact.data_revision,
      production_origin: 'https://darktide.tw-syuan.com',
    };
  };
  const successCheckpoint = async ({ phase }) => {
    const saved = await readW09ReleaseState(statePath);
    if (phase === 'journal') {
      assert.ok(saved.pendingPromotion?.transactionId);
      assert.equal(saved.publicationReceipts.length, 0, 'a journal is not a publication receipt');
      operationOrder.push('journal');
    } else if (phase === 'active') {
      assert.equal(saved.pendingPromotion, null);
      assert.equal(saved.publicationReceipts.at(-1)?.status, 'verified');
      operationOrder.push('active');
    }
    return { status: 'persisted' };
  };
  await assert.rejects(promoteW09SelectedComposition({
    repoRoot: webRoot,
    sourceRoot,
    sourceReleaseIds: [request.releaseId],
    expectedCurrent: {
      activeByGame: [{ gameReleaseId: 'darktide:stale', releaseId: 'w09-' + 'f'.repeat(32) }],
      runtimeSnapshotBuildId: 'e'.repeat(64),
    },
    fetchImpl,
    promoteVerifiedArtifact: async () => { throw new Error('CAS failure must precede deploy'); },
  }), /CAS failed/i);

  let journalFailureDeployCalls = 0;
  await assert.rejects(promoteW09SelectedComposition({
    repoRoot: webRoot,
    sourceRoot,
    sourceReleaseIds: [request.releaseId],
    expectedCurrent: currentW09ActiveSnapshot(state),
    fetchImpl,
    requireDurableState: true,
    persistDurableState: async ({ phase }) => {
      if (phase === 'journal') throw new Error('simulated durable journal checkpoint failure');
      return { status: 'persisted' };
    },
    promoteVerifiedArtifact: async () => { journalFailureDeployCalls += 1; return {}; },
  }), /simulated durable journal checkpoint failure/i);
  assert.equal(journalFailureDeployCalls, 0, 'journal persistence failure must prevent external deployment');
  state = await readW09ReleaseState(statePath);
  const preparedJournalTransaction = state.pendingPromotion?.transactionId;
  assert.match(preparedJournalTransaction, /^[a-f0-9]{64}$/u);
  assert.equal(state.pendingPromotion.phase, 'prepared');

  await assert.rejects(promoteW09SelectedComposition({
    repoRoot: webRoot,
    sourceRoot,
    sourceReleaseIds: [request.releaseId],
    expectedCurrent: currentW09ActiveSnapshot(state),
    fetchImpl,
    requireDurableState: true,
    persistDurableState: async () => ({ status: 'persisted' }),
    promoteVerifiedArtifact: async ({ transactionId }) => {
      assert.equal(transactionId, preparedJournalTransaction, 'a failed journal attempt owns the retry transaction');
      throw new Error('simulated origin verification failure');
    },
  }), /simulated origin verification failure/i);
  state = await readW09ReleaseState(statePath);
  assert.deepEqual(currentW09ActiveSnapshot(state), { activeByGame: [], runtimeSnapshotBuildId: null },
    'failed origin verification must keep the previous shared and whole-site active pointers');
  assert.equal(state.pendingPromotion?.phase, 'retryable', 'the failed transaction journal must survive for a fresh runner');
  assert.equal(state.reservations.find(row => row.releaseId === first.releaseId)?.status, 'prepared',
    'the failed slot remains owned by its exact prepared release');

  const promoted = await promoteW09SelectedComposition({
    repoRoot: webRoot,
    sourceRoot,
    sourceReleaseIds: [request.releaseId],
    expectedCurrent: currentW09ActiveSnapshot(state),
    fetchImpl,
    requireDurableState: true,
    persistDurableState: successCheckpoint,
    promoteVerifiedArtifact: deployer,
  });
  assert.deepEqual(operationOrder, ['journal', 'external', 'active'],
    'the prepared journal must be durably checkpointed before deploy, and active receipt after verified origin');
  assert.equal(promoted.status, 'verified-and-active');
  assert.deepEqual(promoted.sourceReleaseIds, [request.releaseId]);
  assert.deepEqual(promoted.releaseIds, [first.releaseId], 'Source request IDs must map to the allocated Web release IDs');
  assert.equal(promoted.artifact.package_kind, 'published');
  assert.equal(promoted.receipt.build_id, promoted.artifact.build_id);
  state = await readW09ReleaseState(statePath);
  assert.deepEqual(currentW09ActiveSnapshot(state), {
    activeByGame: [{ gameReleaseId: first.gameReleaseId, releaseId: first.releaseId }],
    runtimeSnapshotBuildId: promoted.artifact.build_id,
  });
  assert.equal(state.reservations.find(row => row.releaseId === first.releaseId)?.status, 'approved');
  assert.equal(state.reservations.find(row => row.releaseId === first.releaseId)?.runtimeSnapshotBuildId, promoted.artifact.build_id);
  assert.equal(state.activeRuntimeSnapshotBuildId, promoted.artifact.build_id);
  assert.equal(state.pendingPromotion, null);
  assert.equal(state.publicationReceipts.length, 1);
  const firstPublicationReceipt = state.publicationReceipts[0];
  assert.deepEqual(Object.keys(firstPublicationReceipt).sort(), [
    'action', 'activeByGame', 'artifactManifestSha256', 'buildId', 'dataRevision', 'expectedActive',
    'productionOrigin', 'releaseIds', 'schema', 'status', 'transactionId',
  ]);
  assert.equal(firstPublicationReceipt.action, 'promote');
  assert.equal(firstPublicationReceipt.transactionId, promoted.transactionId);
  assert.deepEqual(firstPublicationReceipt.activeByGame, currentW09ActiveSnapshot(state).activeByGame);
  assert.equal(firstPublicationReceipt.artifactManifestSha256,
    sha256(await readFile(path.join(webRoot, 'dist/artifact-manifest.json'))));
  assert.equal(JSON.stringify(firstPublicationReceipt).includes('token'), false, 'durable receipt projection must omit credentials and raw provider receipt fields');
  const corruptReceipt = structuredClone(state);
  corruptReceipt.publicationReceipts[0].artifactManifestSha256 = sha('f');
  assert.throws(() => validateW09ReleaseState(corruptReceipt), /transactionId does not bind/u);
  corruptReceipt.publicationReceipts[0].extra = 'untrusted provider field';
  assert.throws(() => validateW09ReleaseState(corruptReceipt), /closed verified publication receipt/u);

  const originalApp = await readFile(path.join(webRoot, 'web/app.mjs'));
  const oldRuntimeArchive = await readRuntimeSnapshotArchive(webRoot, promoted.artifact.build_id);
  const oldRuntimeAssets = new Set(oldRuntimeArchive.artifactManifest.files
    .map(row => row.path).filter(name => name.startsWith('assets/')));
  await writeFile(path.join(webRoot, 'web/app.mjs'), Buffer.concat([originalApp, Buffer.from('\n// newer isolated runtime fixture\n')]));
  let failedRuntimeTransactionId;
  await assert.rejects(promoteW09SelectedComposition({
    repoRoot: webRoot,
    sourceRoot,
    sourceReleaseIds: [request.releaseId],
    expectedCurrent: currentW09ActiveSnapshot(state),
    fetchImpl,
    requireDurableState: true,
    persistDurableState: async ({ phase }) => {
      if (phase === 'active') throw new Error('simulated owner active checkpoint failure');
      return { status: 'persisted' };
    },
    promoteVerifiedArtifact: async ({ artifact, transactionId }) => {
      failedRuntimeTransactionId = transactionId;
      return {
        status: 'verified', build_id: artifact.build_id, data_revision: artifact.data_revision,
        production_origin: 'https://darktide.tw-syuan.com',
      };
    },
  }), /simulated owner active checkpoint failure/i);
  state = await readW09ReleaseState(statePath);
  assert.equal(state.pendingPromotion?.transactionId, failedRuntimeTransactionId,
    'failed active persistence must restore the durable retry journal in the local checkout');
  assert.equal(state.pendingPromotion?.phase, 'prepared');
  assert.equal(state.publicationReceipts.length, 1, 'an unpersisted active receipt must not replace the journal checkpoint');
  const runtimeOnlyPromotion = await promoteW09SelectedComposition({
    repoRoot: webRoot,
    sourceRoot,
    sourceReleaseIds: [request.releaseId],
    expectedCurrent: currentW09ActiveSnapshot(state),
    fetchImpl,
    requireDurableState: true,
    persistDurableState: async () => ({ status: 'persisted' }),
    promoteVerifiedArtifact: async ({ artifact, transactionId }) => {
      assert.equal(transactionId, failedRuntimeTransactionId, 'retry after uncertain active checkpoint must reuse exact transaction/artifact identity');
      return {
        status: 'verified', build_id: artifact.build_id, data_revision: artifact.data_revision,
        production_origin: 'https://darktide.tw-syuan.com',
      };
    },
  });
  assert.equal(runtimeOnlyPromotion.status, 'verified-and-active');
  assert.deepEqual(runtimeOnlyPromotion.releaseIds, [first.releaseId], 'a runtime-only update reuses the existing shared allocation');
  assert.notEqual(runtimeOnlyPromotion.artifact.build_id, promoted.artifact.build_id,
    'changed runtime assets produce a new whole-site build identity');
  state = await readW09ReleaseState(statePath);
  assert.equal(state.reservations.length, 1, 'runtime-only publication must not allocate a new content version');
  assert.equal(state.reservations[0].contentVersion, first.contentVersion);
  assert.equal(state.activeRuntimeSnapshotBuildId, runtimeOnlyPromotion.artifact.build_id);
  assert.equal(state.publicationReceipts.length, 2);
  assert.ok(state.approvedRuntimeSnapshots.some(row => row.buildId === promoted.artifact.build_id));
  assert.ok(state.approvedRuntimeSnapshots.some(row => row.buildId === runtimeOnlyPromotion.artifact.build_id));

  const { buildStaticSite } = await import('../src/static/build.mjs');
  const { verifyStaticPackage } = await import('../src/static/verify.mjs');
  const { computeDataRevision } = await import('../scripts/content/contract-release.mjs');
  const firstPointer = {
    game_version: sharedManifest.gameVersion,
    content_version: sharedManifest.contentVersion,
    data_revision: sharedManifest.dataRevision,
    manifest_path: '/data/' + sharedManifest.dataRevision + '/manifest.json',
    manifest_sha256: sha256(packagedManifestBytes),
  };
  const nextManifest = structuredClone(sharedManifest);
  nextManifest.contentVersion = sharedManifest.gameVersion + '.2';
  nextManifest.web.authoringCommit = '1'.repeat(40);
  nextManifest.dataRevision = computeDataRevision(nextManifest);
  const nextManifestBytes = jsonBytes(nextManifest);
  const nextManifestSha256 = sha256(nextManifestBytes);
  const nextPointer = {
    game_version: nextManifest.gameVersion,
    content_version: nextManifest.contentVersion,
    data_revision: nextManifest.dataRevision,
    manifest_path: '/data/' + nextManifest.dataRevision + '/manifest.json',
    manifest_sha256: nextManifestSha256,
  };
  const nextAllocation = planW09ContentVersion(state, {
    gameVersion: nextManifest.gameVersion,
    gameReleaseId: first.gameReleaseId,
    inputDigest: sha('e'),
    dataRevision: nextManifest.dataRevision,
    manifestSha256: nextManifestSha256,
  });
  const nextPackageRoot = path.join(webRoot, 'content/contracts/w09/prepared', nextAllocation.releaseId);
  const nextCandidate = {
    ...structuredClone(candidate),
    releaseId: nextAllocation.releaseId,
    inputDigest: nextAllocation.inputDigest,
    contentVersion: nextAllocation.contentVersion,
    manifest: { path: nextPointer.manifest_path, sha256: nextManifestSha256, dataRevision: nextManifest.dataRevision },
  };
  await mkdir(nextPackageRoot, { recursive: true });
  await writeFile(path.join(nextPackageRoot, 'candidate.json'), jsonBytes(nextCandidate), { flag: 'wx' });
  const nextPackageFiles = [[nextPointer.manifest_path.slice(1), nextManifestBytes]];
  for (const row of nextManifest.files) {
    nextPackageFiles.push(['data/' + nextManifest.dataRevision + '/' + row.path,
      await readFile(path.join(first.packageRoot, 'data', sharedManifest.dataRevision, row.path))]);
  }
  for (const [relative, bytes] of nextPackageFiles) {
    const absolute = path.join(nextPackageRoot, ...relative.split('/'));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes, { flag: 'wx' });
  }
  let twoReleaseState = reserveW09ContentVersion(state, nextAllocation);
  const nextReservation = twoReleaseState.reservations.find(row => row.releaseId === nextAllocation.releaseId);
  nextReservation.status = 'prepared';
  const sharedFiles = new Map([[firstPointer.manifest_path.slice(1), packagedManifestBytes],
    [nextPointer.manifest_path.slice(1), nextManifestBytes]]);
  for (const row of sharedManifest.files) {
    const oldRelative = 'data/' + sharedManifest.dataRevision + '/' + row.path;
    const bytes = await readFile(path.join(first.packageRoot, ...oldRelative.split('/')));
    sharedFiles.set(oldRelative, bytes);
    sharedFiles.set('data/' + nextManifest.dataRevision + '/' + row.path, Buffer.from(bytes));
  }
  for (const manifestBytes of [packagedManifestBytes, nextManifestBytes]) {
    const sourceLockFile = createW09PublicSourceLockFile(JSON.parse(manifestBytes.toString('utf8')));
    sharedFiles.set(sourceLockFile.relativePath, sourceLockFile.bytes);
  }
  const bundleFor = activePointer => ({
    packageKind: 'published',
    version: {
      schema_version: 2,
      data_revision: activePointer.data_revision,
      build_id: '0'.repeat(64),
      game_version: activePointer.game_version,
      package_kind: 'published',
      game_releases: [activePointer],
    },
    files: sharedFiles,
    retainedReleases: [firstPointer, nextPointer],
  });
  let newerRuntimeBuild;
  let oldOnlyAssets;
  let newerOnlyAssets;
  try {
    newerRuntimeBuild = await buildStaticSite({ root: webRoot, mode: 'published', sharedRelease: bundleFor(nextPointer), siteOrigin: 'https://darktide.tw-syuan.com' });
    const newerArtifact = await verifyStaticPackage(path.join(webRoot, 'dist'));
    const oldAssets = new Set(oldRuntimeArchive.artifactManifest.files
      .map(row => row.path).filter(name => name.startsWith('assets/')));
    const newerAssets = new Set(JSON.parse(await readFile(path.join(webRoot, 'dist/artifact-manifest.json'), 'utf8')).files
      .map(row => row.path).filter(name => name.startsWith('assets/')));
    oldOnlyAssets = [...oldAssets].filter(name => !newerAssets.has(name));
    newerOnlyAssets = [...newerAssets].filter(name => !oldAssets.has(name));
    assert.ok(oldOnlyAssets.length > 0 && newerOnlyAssets.length > 0, 'the fixture must contain distinct prior and newer runtime assets');
    assert.ok(newerArtifact.retained_releases.some(row => row.data_revision === nextManifest.dataRevision));
    const newerSnapshotFiles = new Map();
    for (const relative of await listRegularFiles(path.join(webRoot, 'dist'))) {
      newerSnapshotFiles.set(relative, await readFile(path.join(webRoot, 'dist', ...relative.split('/'))));
    }
    const newerSnapshotArchive = encodeW09RuntimeSnapshotArchive(newerRuntimeBuild.build_id, newerSnapshotFiles);
    const newerSnapshotDirectory = path.join(webRoot, 'content/contracts/w09/runtime-snapshots', newerRuntimeBuild.build_id);
    await mkdir(newerSnapshotDirectory, { recursive: true });
    await writeFile(path.join(newerSnapshotDirectory, 'snapshot.json.gz'), newerSnapshotArchive, { flag: 'wx' });
    const newerSnapshotPath = await materializeW09RuntimeSnapshotArchive(newerSnapshotArchive, newerRuntimeBuild.build_id);
    try {
      const verifiedNewerSnapshot = await verifyStaticPackage(newerSnapshotPath);
      assert.equal(verifiedNewerSnapshot.build_id, newerRuntimeBuild.build_id);
    } finally {
      await rm(newerSnapshotPath, { recursive: true, force: true });
    }
    nextReservation.status = 'approved';
    nextReservation.runtimeSnapshotBuildId = newerRuntimeBuild.build_id;
    twoReleaseState.activeByGame = [{ gameReleaseId: first.gameReleaseId, releaseId: nextAllocation.releaseId }];
    twoReleaseState.activeRuntimeSnapshotBuildId = newerRuntimeBuild.build_id;
    twoReleaseState.approvedRuntimeSnapshots.push({
      buildId: newerRuntimeBuild.build_id,
      activeByGame: [{ gameReleaseId: first.gameReleaseId, releaseId: nextAllocation.releaseId }],
    });
    validateW09ReleaseState(twoReleaseState);
    await writeW09ReleaseStateAtomic(statePath, twoReleaseState);

    let downgradeCallbackCalled = false;
    await assert.rejects(promoteW09SelectedComposition({
      repoRoot: webRoot,
      sourceRoot,
      sourceReleaseIds: [request.releaseId],
      expectedCurrent: currentW09ActiveSnapshot(twoReleaseState),
      fetchImpl,
      promoteVerifiedArtifact: async () => { downgradeCallbackCalled = true; throw new Error('implicit downgrade must be rejected before deploy'); },
    }), /cannot downgrade an approved contentVersion/i,
    'an accurate current CAS does not authorize replaying the older approved Web allocation');
    assert.equal(downgradeCallbackCalled, false);

    const currentPointers = currentW09ActiveSnapshot(twoReleaseState);
    let wrongRuntimeSnapshotCallbackCalled = false;
    await assert.rejects(rollbackW09SharedComposition({
      repoRoot: webRoot,
      targetReleaseIds: [first.releaseId],
      targetRuntimeSnapshotBuildId: 'f'.repeat(64),
      expectedCurrent: currentPointers,
      promoteVerifiedArtifact: async () => { wrongRuntimeSnapshotCallbackCalled = true; throw new Error('wrong snapshot must not deploy'); },
    }), /exactly match the full active release set/i);
    assert.equal(wrongRuntimeSnapshotCallbackCalled, false);
    await assert.rejects(rollbackW09SharedComposition({
      repoRoot: webRoot,
      targetReleaseIds: [first.releaseId],
      targetRuntimeSnapshotBuildId: promoted.artifact.build_id,
      expectedCurrent: currentPointers,
      promoteVerifiedArtifact: async () => { throw new Error('simulated rollback origin verification failure'); },
    }), /simulated rollback origin verification failure/i);
    let failedRollbackState = await readW09ReleaseState(statePath);
    assert.deepEqual(currentW09ActiveSnapshot(failedRollbackState), currentPointers,
      'failed rollback verification must keep the newer active release');
    assert.equal(failedRollbackState.pendingPromotion?.phase, 'retryable');
    assert.equal(failedRollbackState.pendingPromotion?.action, 'rollback');
    const rollbackResult = await rollbackW09SharedComposition({
      repoRoot: webRoot,
      targetReleaseIds: [first.releaseId],
      targetRuntimeSnapshotBuildId: promoted.artifact.build_id,
      expectedCurrent: currentPointers,
      promoteVerifiedArtifact: async ({ artifact }) => ({ status: 'verified', build_id: artifact.build_id,
        data_revision: artifact.data_revision, production_origin: 'https://darktide.tw-syuan.com' }),
    });
    assert.equal(rollbackResult.status, 'verified-and-rolled-back');
    assert.equal(rollbackResult.restoredRuntimeSnapshotBuildId, promoted.artifact.build_id);
    assert.equal(rollbackResult.artifact.runtime_data_revision, promoted.artifact.runtime_data_revision);
    assert.ok(rollbackResult.retainedReleases.some(row => row.data_revision === nextManifest.dataRevision),
      'whole-runtime rollback must retain the newer approved shared release');
    const rollbackFiles = new Set(JSON.parse(await readFile(path.join(webRoot, 'dist/artifact-manifest.json'), 'utf8')).files.map(row => row.path));
    assert.ok(oldOnlyAssets.some(name => rollbackFiles.has(name)), 'rollback must restore the older runtime assets');
    assert.ok(newerOnlyAssets.every(name => !rollbackFiles.has(name)), 'rollback must not use newer checkout assets');
    assert.ok(rollbackFiles.has(nextPointer.manifest_path.slice(1)), 'rollback must retain the newer shared manifest URL');
    for (const row of nextManifest.files) assert.ok(rollbackFiles.has('data/' + nextManifest.dataRevision + '/' + row.path),
      'rollback must retain each newer shared domain URL');
    failedRollbackState = await readW09ReleaseState(statePath);
    assert.deepEqual(currentW09ActiveSnapshot(failedRollbackState), {
      activeByGame: [{ gameReleaseId: first.gameReleaseId, releaseId: first.releaseId }],
      runtimeSnapshotBuildId: rollbackResult.artifact.build_id,
    });
    const rollbackReceipt = failedRollbackState.publicationReceipts.find(row => row.transactionId === rollbackResult.transactionId);
    assert.equal(rollbackReceipt?.action, 'rollback');
    assert.equal(rollbackReceipt?.buildId, rollbackResult.artifact.build_id);
    assert.deepEqual(rollbackReceipt?.activeByGame, currentW09ActiveSnapshot(failedRollbackState).activeByGame,
      'durable rollback evidence must bind the complete restored active set');
    let staleRollbackCallbackCalled = false;
    await assert.rejects(rollbackW09SharedComposition({
      repoRoot: webRoot,
      targetReleaseIds: [nextAllocation.releaseId],
      targetRuntimeSnapshotBuildId: newerRuntimeBuild.build_id,
      expectedCurrent: currentPointers,
      promoteVerifiedArtifact: async () => { staleRollbackCallbackCalled = true; throw new Error('stale rollback must not deploy'); },
    }), /CAS failed/i);
    assert.equal(staleRollbackCallbackCalled, false);
  } finally {
    await writeFile(path.join(webRoot, 'web/app.mjs'), originalApp);
  }

  state = await readW09ReleaseState(statePath);
  const repeated = await promoteW09SelectedComposition({
    repoRoot: webRoot,
    sourceRoot,
    sourceReleaseIds: [request.releaseId],
    expectedCurrent: currentW09ActiveSnapshot(state),
    fetchImpl,
    promoteVerifiedArtifact: async () => { throw new Error('an already active retry must be a no-op'); },
  });
  assert.equal(repeated.status, 'already-active');
  if (preserveFixture) {
    const runtimeSnapshotArchives = await Promise.all(state.approvedRuntimeSnapshots.map(async snapshot => {
      const archivePath = path.join(webRoot, 'content/contracts/w09/runtime-snapshots', snapshot.buildId, 'snapshot.json.gz');
      const bytes = await readFile(archivePath);
      return { buildId: snapshot.buildId, path: archivePath, archiveSha256: sha256(bytes) };
    }));
    const fixture = {
      purpose: 'isolated W09 formal-shape QA fixture; synthetic approvals and no publication authority',
      syntheticLedgerUncommitted: true,
      webRoot,
      sourceRoot,
      packageRoot: first.packageRoot,
      releaseStatePath: statePath,
      distPath: path.join(webRoot, 'dist'),
      webBaseCommit: git(webRoot, ['rev-parse', 'HEAD~4']),
      webOverlayCommit: overlayCommit,
      webSelectedCommit: git(webRoot, ['rev-parse', 'HEAD']),
      sourceCommit,
      sourceRevision: request.sourceRevision,
      manifestSha256: request.manifestSha256,
      sourceRequests: archivedRequests.map(row => ({
        requestId: row.request.requestId,
        releaseId: row.request.releaseId,
        gameReleaseId: row.request.gameReleaseId,
        archiveSha256: sha256(row.archiveBytes),
      })),
      selectedSourceRequestIds: [request.requestId],
      preparedWebReleases: state.reservations.map(row => ({
        releaseId: row.releaseId,
        gameReleaseId: row.gameReleaseId,
        contentVersion: row.contentVersion,
        status: row.status,
      })),
      approvedRuntimeSnapshots: state.approvedRuntimeSnapshots,
      activeSnapshot: currentW09ActiveSnapshot(state),
      runtimeSnapshotArchives,
    };
    await writeFile(path.join(root, 'fixture-descriptor.json'), jsonBytes(fixture), { flag: 'wx' });
    process.stdout.write('W09_PRESERVED_FORMAL_FIXTURE=' + path.join(root, 'fixture-descriptor.json') + '\n');
  }
});

function makeCompactFormalSource(w06Source, w07Source) {
  const contract = structuredClone(w07Source);
  const releaseId = 'darktide:1.13.2';
  const records = new Map(contract.records.map(record => [record.gameReleaseId + '\0' + record.recordId, record]));
  const weapon = records.get(releaseId + '\0darktide:weapon:chainaxe:p1-m2');
  assert.ok(weapon, 'W07 donor must contain the selected chainaxe weapon');
  const selectedProfileRef = weapon.payload.attackProfileRefs[0];
  const profile = records.get(selectedProfileRef.gameReleaseId + '\0' + selectedProfileRef.recordId);
  assert.ok(profile, 'selected W07 attack profile must resolve');
  const statGroup = weapon.payload.statBindings[0];
  const statBinding = statGroup.bindings.find(binding => binding.action === profile.payload.action && binding.claimRefs?.length);
  assert.ok(statBinding, 'selected W07 action must have a source claim binding');
  const selectedClaims = statBinding.claimRefs.map(ref => records.get(ref.gameReleaseId + '\0' + ref.recordId));
  assert.ok(selectedClaims.every(Boolean), 'selected W07 stat claims must resolve');
  const selectedClaimIds = new Set(selectedClaims.map(record => record.recordId));
  const statDefinitions = weapon.payload.statRefs.map(ref => records.get(ref.gameReleaseId + '\0' + ref.recordId))
    .filter(record => record?.payload.claimRefs?.some(ref => selectedClaimIds.has(ref.recordId)));
  assert.ok(statDefinitions.length > 0, 'selected W07 stat binding must have source stat definitions');
  const semantic = weapon.payload.statTableSemantics.find(row => row.statKey === statGroup.statKey);
  const semanticBinding = semantic?.bindings.find(row => row.property === statBinding.property);
  assert.ok(semanticBinding, 'selected W07 stat binding must have a matching table semantic');
  const target = contract.records
    .filter(record => record.gameReleaseId === releaseId && record.kind === 'target-profile'
      && record.payload.sourceStatic?.breedType === 'minion')
    .sort((left, right) => left.payload.sourceStatic.hitZones.length - right.payload.sourceStatic.hitZones.length)[0];
  assert.ok(target, 'W07 donor must have a static minion target profile');

  weapon.payload.attackProfileRefs = [{ recordId: profile.recordId, gameReleaseId: releaseId }];
  weapon.payload.statBindings = [{ ...statGroup, bindings: [statBinding] }];
  weapon.payload.statTableSemantics = [{ ...semantic, bindings: [semanticBinding] }];
  weapon.payload.claimRefs = selectedClaims.map(record => ({ recordId: record.recordId, gameReleaseId: record.gameReleaseId }));
  weapon.payload.statRefs = statDefinitions.map(record => ({ recordId: record.recordId, gameReleaseId: record.gameReleaseId }));
  for (const optionalArray of ['statTables', 'displayedAttacks', 'sourceRows', 'emptyTables']) weapon.payload[optionalArray] = [];
  weapon.payload.actionProfileResolution.staticClosure.profileBindingCount = profile.payload.actionResolution.branchBindings.length;

  profile.payload.targetProfileRefs = [{ recordId: target.recordId, gameReleaseId: releaseId }];
  const armorRefs = [target.payload.sourceStatic.baseArmorClassRef, target.payload.sourceStatic.toughnessArmorClassRef,
    ...target.payload.sourceStatic.hitZones.map(zone => zone.armorOverrideRef)].filter(Boolean);
  profile.payload.armorClassRefs = [...new Map(armorRefs.map(ref => [ref.recordId, ref])).values()];
  profile.payload.modifierRuleRefs = contract.records
    .filter(record => record.gameReleaseId === releaseId && record.kind === 'modifier-rule'
      && record.payload.sourceBranchModel?.schemaVersion === 'static-combat-relations/1')
    .map(record => ({ recordId: record.recordId, gameReleaseId: record.gameReleaseId }));

  const retained = new Map();
  for (const record of w06Source.records) retained.set(record.gameReleaseId + '\0' + record.recordId,
    records.get(record.gameReleaseId + '\0' + record.recordId) ?? record);
  retained.set(weapon.gameReleaseId + '\0' + weapon.recordId, weapon);
  const pending = [...retained.keys()];
  while (pending.length) {
    const record = records.get(pending.pop());
    if (!record) continue;
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value) && typeof value.recordId === 'string' && typeof value.gameReleaseId === 'string') {
        const key = value.gameReleaseId + '\0' + value.recordId;
        if (!retained.has(key) && records.has(key)) {
          retained.set(key, records.get(key));
          pending.push(key);
        }
      }
      for (const child of Object.values(value)) visit(child);
    };
    visit(record.payload);
  }

  const usedSources = new Set();
  const collectSources = value => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && typeof value.sourceId === 'string' && typeof value.gameReleaseId === 'string') {
      usedSources.add(value.sourceId + '\0' + value.gameReleaseId);
    }
    for (const child of Object.values(value)) collectSources(child);
  };
  for (const record of retained.values()) {
    for (const ref of record.sourceRefs ?? []) usedSources.add(ref.sourceId + '\0' + ref.gameReleaseId);
    collectSources(record.payload);
  }
  const sourceRefs = [...w06Source.sourceRefs, ...contract.sourceRefs];
  const uniqueSources = new Map(sourceRefs.map(ref => [ref.sourceId + '\0' + ref.gameReleaseId, ref]));
  contract.records = [...retained.values()];
  contract.sourceRefs = [...uniqueSources.values()].filter(ref => usedSources.has(ref.sourceId + '\0' + ref.gameReleaseId));
  contract.tombstones = [];
  contract.reviewReceipts = [];
  contract.fixtureOnly = false;
  contract.publicationEligible = true;
  return contract;
}

function makeTestOnlyFormalSource(source, sourceValidator) {
  const contract = structuredClone(source);
  contract.fixtureOnly = false;
  contract.publicationEligible = true;
  for (const release of contract.gameReleases) release.gameBuild = 'W09-isolated-test-build';
  for (const sourceRef of contract.sourceRefs) sourceRef.gameBuild = 'W09-isolated-test-build';
  contract.reviewReceipts = [];
  for (const record of contract.records) record.reviewState = 'approved';
  for (const item of contract.tombstones ?? []) item.reviewState = 'approved';
  const reviewer = { kind: 'human', id: 'w09-isolated-test-fixture-only' };
  const reviewedAt = '2026-10-20T00:00:00Z';
  for (const record of contract.records) {
    for (const target of record.reviewTargets ?? []) {
      contract.reviewReceipts.push(sourceValidator.createReviewReceipt(contract, {
        recordId: record.recordId,
        gameReleaseId: record.gameReleaseId,
        ...target,
      }, { reviewer, reviewedAt }));
    }
  }
  for (const item of contract.tombstones ?? []) {
    for (const target of item.reviewTargets ?? []) {
      contract.reviewReceipts.push(sourceValidator.createReviewReceipt(contract, {
        recordId: item.recordId,
        gameReleaseId: item.gameReleaseId,
        ...target,
      }, { reviewer, reviewedAt }));
    }
  }
  return contract;
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function gitBytes(root, args) {
  return Buffer.from(execFileSync('git', ['-C', root, ...args], { encoding: null, maxBuffer: 64 * 1024 * 1024, windowsHide: true }));
}

function assertCompositionInputsMatchCurrentHead(repoRoot, pinnedCommit) {
  assert.match(pinnedCommit, /^[0-9a-f]{40}$/u, 'the workflow must pin a full Git commit SHA');
  const currentHead = git(repoRoot, ['rev-parse', 'HEAD']);
  const currentSelectedBytes = gitBytes(repoRoot, ['show', currentHead + ':' + W09_SELECTED_COMPOSITION_PATH]);
  const pinnedSelectedBytes = gitBytes(repoRoot, ['show', pinnedCommit + ':' + W09_SELECTED_COMPOSITION_PATH]);
  assert.deepEqual(pinnedSelectedBytes, currentSelectedBytes,
    'pinned selected marker bytes must match current HEAD');

  const selected = JSON.parse(currentSelectedBytes.toString('utf8'));
  assert.ok(Array.isArray(selected.proposals) && selected.proposals.length > 0,
    'current selected marker must identify at least one composition request');
  for (const proposal of selected.proposals) {
    const lockPath = W09_COMPOSITION_LOCK_ROOT + proposal.requestId + '.json';
    const currentLockBytes = gitBytes(repoRoot, ['show', currentHead + ':' + lockPath]);
    const pinnedLockBytes = gitBytes(repoRoot, ['show', pinnedCommit + ':' + lockPath]);
    assert.deepEqual(pinnedLockBytes, currentLockBytes,
      'pinned request lock bytes must match current HEAD: ' + proposal.requestId);
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function sortJsonForTest(value) {
  if (Array.isArray(value)) return value.map(sortJsonForTest);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJsonForTest(value[key])]));
  }
  return value;
}

async function readRuntimeSnapshotArchive(repoRoot, buildId) {
  const archivePath = path.join(repoRoot, 'content/contracts/w09/runtime-snapshots', buildId, 'snapshot.json.gz');
  const archiveBytes = await readFile(archivePath);
  const archive = JSON.parse(gunzipSync(archiveBytes).toString('utf8'));
  const manifestRow = archive.files.find(row => row.path === 'artifact-manifest.json');
  assert.ok(manifestRow, 'runtime snapshot must carry its whole-artifact manifest');
  return { archive, archiveBytes, artifactManifest: JSON.parse(Buffer.from(manifestRow.base64, 'base64').toString('utf8')) };
}

function canonicalW09Json(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalW09Json).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalW09Json(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

async function listRegularFiles(root, prefix = '') {
  const rows = [];
  const { readdir, lstat } = await import('node:fs/promises');
  for (const name of (await readdir(path.join(root, prefix))).sort()) {
    const relative = prefix ? prefix + '/' + name : name;
    const absolute = path.join(root, ...relative.split('/'));
    const stat = await lstat(absolute);
    assert.equal(stat.isSymbolicLink(), false, 'prepared package must not contain symbolic links');
    if (stat.isDirectory()) rows.push(...await listRegularFiles(root, relative));
    else {
      assert.equal(stat.isFile(), true, 'prepared package may contain only files and directories');
      rows.push(relative);
    }
  }
  return rows.sort();
}

test('UnitT26_publication-receipt-dataRevision-is-bound-to-highest-numeric-active-gameVersion', () => {
  const sha = character => character.repeat(64);
  const makeReservation = ({ gameVersion, gameReleaseId, digestCharacter, revisionCharacter }) => {
    const contentVersion = gameVersion + '.1';
    const inputDigest = sha(digestCharacter);
    const manifestSha256 = sha(String.fromCharCode(digestCharacter.charCodeAt(0) + 1));
    const releaseId = 'w09-' + createHash('sha256').update(JSON.stringify([
      gameVersion, gameReleaseId, contentVersion, inputDigest, manifestSha256,
    ])).digest('hex').slice(0, 32);
    return { gameVersion, gameReleaseId, contentVersion, inputDigest, manifestSha256, dataRevision: sha(revisionCharacter), releaseId, status: 'approved' };
  };
  const lower = makeReservation({ gameVersion: '1.9.0', gameReleaseId: 'darktide:unit-low', digestCharacter: '1', revisionCharacter: 'a' });
  const higher = makeReservation({ gameVersion: '1.10.0', gameReleaseId: 'darktide:unit-high', digestCharacter: '3', revisionCharacter: 'b' });
  const activeByGame = [lower, higher]
    .map(row => ({ gameReleaseId: row.gameReleaseId, releaseId: row.releaseId }))
    .sort((left, right) => left.gameReleaseId.localeCompare(right.gameReleaseId, 'en'));
  const buildId = sha('c');
  const artifactManifestSha256 = sha('d');
  const releaseIds = [lower.releaseId, higher.releaseId].sort();
  const expectedActive = { activeByGame: [], runtimeSnapshotBuildId: null };
  const transactionId = createHash('sha256').update(JSON.stringify([
    releaseIds, expectedActive, buildId, artifactManifestSha256,
  ])).digest('hex');
  const state = createW09ReleaseState();
  state.reservations = [lower, higher];
  state.activeByGame = activeByGame;
  state.activeRuntimeSnapshotBuildId = buildId;
  state.approvedRuntimeSnapshots = [{ buildId, activeByGame }];
  state.publicationReceipts = [{
    schema: 'w09-publication-receipt/1',
    status: 'verified',
    action: 'promote',
    transactionId,
    releaseIds,
    expectedActive,
    buildId,
    dataRevision: higher.dataRevision,
    artifactManifestSha256,
    productionOrigin: 'https://darktide.tw-syuan.com',
    activeByGame,
  }];

  assert.equal(validateW09ReleaseState(state), true, 'the highest numeric gameVersion owns the shared package dataRevision');
  const tampered = structuredClone(state);
  tampered.publicationReceipts[0].dataRevision = lower.dataRevision;
  assert.throws(() => validateW09ReleaseState(tampered), /dataRevision must match the highest active gameVersion reservation/u);
});
test('UnitT25_formal-publication-entry-requires-durable-owner-state-capability', async () => {
  const releaseApi = await import('../scripts/content/contract-w09-release.mjs');
  await assert.rejects(releaseApi.prepareW09SharedRelease({ requireDurableState: true }), /owner Git state persistence hook/u);
  await assert.rejects(releaseApi.promoteW09SelectedComposition({ requireDurableState: true }), /owner Git state persistence hook/u);
  await assert.rejects(releaseApi.rollbackW09SharedComposition({ requireDurableState: true }), /owner Git state persistence hook/u);
  await assert.rejects(releaseApi.updateW09RetentionReferences({ requireDurableState: true }), /owner Git state persistence hook/u);
});

test('InterT25_explicit-retention-reference-changes-use-the-durable-owner-state-checkpoint', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'w09-retention-checkpoint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createW09ReleaseState();
  const input = source('1.13.1', 'fixture-release', sha('a'), sha('b'));
  const contentVersion = '1.13.1.1';
  const releaseId = 'w09-' + createHash('sha256').update(JSON.stringify([
    input.gameVersion, input.gameReleaseId, contentVersion, input.inputDigest, input.manifestSha256,
  ])).digest('hex').slice(0, 32);
  state.reservations.push({ ...input, contentVersion, releaseId, status: 'approved' });
  const statePath = path.join(root, 'content/contracts/w09/release-state.json');
  await writeW09ReleaseStateAtomic(statePath, state);
  const checkpoints = [];
  const references = await updateW09RetentionReferences({
    repoRoot: root,
    expectedReferences: [],
    releaseIds: [releaseId],
    requireDurableState: true,
    persistDurableState: async context => {
      checkpoints.push(context);
      return { status: 'persisted' };
    },
  });
  assert.deepEqual(references, [releaseId]);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].phase, 'retention-references');
  assert.equal(checkpoints[0].statePath, statePath);
  assert.deepEqual((await readW09ReleaseState(statePath)).referenceReleaseIds, [releaseId]);
});

const W09_HISTORICAL_COMPOSITION_COMMIT = '08c25ff58a01bac1a52a0531cde99288f68cfa31';
const W09_COMPILER_LOCK_PATH = 'content/contracts/w09/compiler.lock.json';
const W09_COMPOSITION_LOCK_ROOT = 'content/contracts/w09/source-handoff/locks/';

function gitCommitFixture(repoRoot, message, { allowEmpty = false } = {}) {
  execFileSync('git', [
    '-C', repoRoot,
    '-c', 'user.name=Codex W09 Fixture',
    '-c', 'user.email=codex-w09-fixture@example.invalid',
    'commit', '--quiet', ...(allowEmpty ? ['--allow-empty'] : []), '-m', message,
  ], { encoding: 'utf8', windowsHide: true });
}

function cloneW09Fixture(sourceRoot, destination) {
  execFileSync('git', ['clone', '-c', 'core.autocrlf=false', '-c', 'core.longpaths=true', '--shared', '--quiet', sourceRoot, destination], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  git(destination, ['remote', 'set-url', 'origin', 'https://github.com/SyuanTsai/DarkTide-Web.git']);
}

async function createDualRootW09Fixture(t) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'w09-dual-root-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const runtimeRoot = path.join(fixtureRoot, 'runtime');
  const compositionRoot = path.join(fixtureRoot, 'composition-inputs');
  cloneW09Fixture(W09_TEST_GIT_ROOT, runtimeRoot);
  cloneW09Fixture(W09_TEST_GIT_ROOT, compositionRoot);
  await symlink(path.join(REPO_ROOT, 'node_modules'), path.join(compositionRoot, 'node_modules'), 'junction');
  git(runtimeRoot, ['checkout', '--quiet', '-B', 'main', 'HEAD']);
  git(compositionRoot, ['checkout', '--quiet', '--detach', W09_HISTORICAL_COMPOSITION_COMMIT]);

  const historicalSelectedBytes = gitBytes(compositionRoot, [
    'show', 'HEAD:' + W09_SELECTED_COMPOSITION_PATH,
  ]);
  const historicalSelected = JSON.parse(historicalSelectedBytes.toString('utf8'));
  await writeFile(path.join(runtimeRoot, ...W09_SELECTED_COMPOSITION_PATH.split('/')), historicalSelectedBytes);
  const historicalRequestLockPaths = [];
  for (const proposal of historicalSelected.proposals ?? []) {
    const lockPath = W09_COMPOSITION_LOCK_ROOT + proposal.requestId + '.json';
    const lockBytes = gitBytes(compositionRoot, ['show', 'HEAD:' + lockPath]);
    await writeFile(path.join(runtimeRoot, ...lockPath.split('/')), lockBytes);
    historicalRequestLockPaths.push(lockPath);
  }

  const pinCommit = git(runtimeRoot, ['rev-parse', 'HEAD']);
  const compilerLock = JSON.parse(gitBytes(runtimeRoot, ['show', 'HEAD:' + W09_COMPILER_LOCK_PATH]).toString('utf8'));
  compilerLock.commit = pinCommit;
  compilerLock.files = W09_COMPILER_FILE_PATHS.map(relativePath => {
    const bytes = gitBytes(runtimeRoot, ['show', pinCommit + ':' + relativePath]);
    return { path: relativePath, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
  });
  compilerLock.fileSetSha256 = sha256(Buffer.from(canonicalW09Json(compilerLock.files), 'utf8'));
  await writeFile(path.join(runtimeRoot, ...W09_COMPILER_LOCK_PATH.split('/')), jsonBytes(compilerLock));
  git(runtimeRoot, ['add', '--', W09_COMPILER_LOCK_PATH, W09_SELECTED_COMPOSITION_PATH, ...historicalRequestLockPaths]);
  gitCommitFixture(runtimeRoot, 'test fixture: pin current runtime code');

  return {
    fixtureRoot,
    runtimeRoot,
    compositionRoot,
    runtimeHead: git(runtimeRoot, ['rev-parse', 'HEAD']),
  };
}

async function readOptionalBytes(filePath) {
  try { return await readFile(filePath); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Scenario: publication replays a fixed historical W09 composition while current main owns every runtime artifact.
// Purpose: prevent stale or mismatched historical inputs from reaching Source replay, allocation, build, or rollback.
// Given current/history roots with independent valid pins, When promotion resolves the composition context,
// Then only exact official ancestor inputs import and runtime state remains owned by current main.
test('InterT26_dual-root-replay-imports-pinned-history-with-runtime-state-owned-by-main', async t => {
  const releaseApi = await import('../scripts/content/contract-w09-release.mjs');
  const fixture = await createDualRootW09Fixture(t);
  const options = {
    repoRoot: fixture.runtimeRoot,
    compositionRepoRoot: fixture.compositionRoot,
    expectedCompositionCommit: W09_HISTORICAL_COMPOSITION_COMMIT,
  };
  const runtimeStatePath = path.join(fixture.runtimeRoot, 'content/contracts/w09/release-state.json');
  const historyStatePath = path.join(fixture.compositionRoot, 'content/contracts/w09/release-state.json');
  const runtimeStateBefore = await readOptionalBytes(runtimeStatePath);
  const historyStateBefore = await readOptionalBytes(historyStatePath);

  await t.test('InterT26_01_valid-roots-import-the-exact-historical-module-before-source-replay', async () => {
    const context = await releaseApi.resolveW09CompositionContext(options);
    assert.equal(context.dualRoot, true);
    assert.equal(context.runtimeHead, fixture.runtimeHead);
    assert.equal(context.expectedCompositionCommit, W09_HISTORICAL_COMPOSITION_COMMIT);
    assert.equal(context.moduleUrl, pathToFileURL(path.join(fixture.compositionRoot, 'scripts/content/contract-w09-compose.mjs')).href);
    assert.equal(context.historyPin.commit, '1aadf6652838bcee4c282c884b5363be8d0ecb87');
    assert.ok(context.runtimePin.commit !== context.historyPin.commit,
      'the current runtime pin and historical composition pin are verified independently');

    const selected = JSON.parse(gitBytes(fixture.runtimeRoot, ['show', 'HEAD:' + W09_SELECTED_COMPOSITION_PATH]).toString('utf8'));
    const stateSource = path.join(fixture.runtimeRoot, 'content/contracts/w09/release-state.json');
    const historySource = path.join(fixture.compositionRoot, 'content/contracts/w09/release-state.json');
    const requests = [];
    const result = await context.loadW09VerifiedComposition({
      repoRoot: context.compositionRoot,
      sourceRoot: fixture.runtimeRoot,
      releaseId: selected.proposals[0].releaseId,
      fetchImpl: async url => {
        requests.push(String(url));
        return new Response(null, { status: 404 });
      },
    });
    assert.equal(result.status, 'pending', 'the real historical loader ran and received the controlled unavailable-archive response');
    assert.equal(result.releaseId, selected.proposals[0].releaseId, 'the existing selected release identity passes through unchanged');
    assert.equal(requests.length, 1);
    assert.match(requests[0], /^https:\/\/api\.github\.com\/repos\/SyuanTsai\/DarkTide-Source-Data\//u);
    assert.deepEqual(await readOptionalBytes(stateSource), runtimeStateBefore,
      'resolving and replaying a pending historical composition does not allocate or write runtime state');
    assert.deepEqual(await readOptionalBytes(historySource), historyStateBefore,
      'historical composition input remains read-only');
  });

  await t.test('InterT26_02_root-options-must-be-paired-and-the-expected-commit-must-match', async () => {
    await assert.rejects(releaseApi.resolveW09CompositionContext({
      repoRoot: fixture.runtimeRoot,
      compositionRepoRoot: fixture.compositionRoot,
    }), /compositionRepoRoot and expectedCompositionCommit must be provided together/u);
    await assert.rejects(releaseApi.resolveW09CompositionContext({
      ...options,
      expectedCompositionCommit: 'f'.repeat(40),
    }), /does not match expectedCompositionCommit/u);
  });

  await t.test('InterT26_03_official-origin-and-ancestor-are-required', async () => {
    git(fixture.compositionRoot, ['remote', 'set-url', 'origin', 'https://example.invalid/DarkTide-Web.git']);
    await assert.rejects(releaseApi.resolveW09CompositionContext(options), /fixed official repository/u);
    git(fixture.compositionRoot, ['remote', 'set-url', 'origin', 'https://github.com/SyuanTsai/DarkTide-Web.git']);

    const tree = git(fixture.runtimeRoot, ['rev-parse', 'HEAD^{tree}']);
    const siblingHead = execFileSync('git', [
      '-C', fixture.runtimeRoot,
      '-c', 'user.name=Codex W09 Fixture',
      '-c', 'user.email=codex-w09-fixture@example.invalid',
      'commit-tree', tree, '-m', 'isolated unrelated history fixture',
    ], { encoding: 'utf8', windowsHide: true }).trim();
    git(fixture.runtimeRoot, ['update-ref', 'refs/heads/fixture-unrelated', siblingHead]);
    execFileSync('git', [
      '-C', fixture.compositionRoot, 'fetch', '--quiet', fixture.runtimeRoot,
      'refs/heads/fixture-unrelated:refs/heads/fixture-unrelated',
    ], { encoding: 'utf8', windowsHide: true });
    git(fixture.compositionRoot, ['checkout', '--quiet', '--detach', siblingHead]);
    await assert.rejects(releaseApi.resolveW09CompositionContext({
      ...options,
      expectedCompositionCommit: siblingHead,
    }), /must be an ancestor of current main/u);
    git(fixture.compositionRoot, ['checkout', '--quiet', '--detach', W09_HISTORICAL_COMPOSITION_COMMIT]);
  });

  await t.test('InterT26_04_both-current-and-historical-code-pins-must-match-their-worktrees', async () => {
    const compilerLockPath = path.join(fixture.runtimeRoot, ...W09_COMPILER_LOCK_PATH.split('/'));
    const currentLock = await readFile(compilerLockPath);
    try {
      await writeFile(compilerLockPath, Buffer.concat([currentLock, Buffer.from(' ')]));
      await assert.rejects(releaseApi.resolveW09CompositionContext(options), /working file differs|committed bytes/u);
    } finally {
      await writeFile(compilerLockPath, currentLock);
    }

    const historyLockPath = path.join(fixture.compositionRoot, ...W09_COMPILER_LOCK_PATH.split('/'));
    const historicalLock = await readFile(historyLockPath);
    try {
      await writeFile(historyLockPath, Buffer.concat([historicalLock, Buffer.from(' ')]));
      await assert.rejects(releaseApi.resolveW09CompositionContext(options), /working file differs|committed bytes/u);
    } finally {
      await writeFile(historyLockPath, historicalLock);
    }
  });

  await t.test('InterT26_05_committed-selected-marker-and-request-lock-bytes-must-match', async () => {
    const baseHead = git(fixture.runtimeRoot, ['rev-parse', 'HEAD']);
    const selectedBytes = gitBytes(fixture.runtimeRoot, ['show', baseHead + ':' + W09_SELECTED_COMPOSITION_PATH]);
    const selected = JSON.parse(selectedBytes.toString('utf8'));
    selected.sourceRevision = sha256(Buffer.from('different selected revision', 'utf8'));
    await writeFile(path.join(fixture.runtimeRoot, ...W09_SELECTED_COMPOSITION_PATH.split('/')), jsonBytes(selected));
    git(fixture.runtimeRoot, ['add', W09_SELECTED_COMPOSITION_PATH]);
    gitCommitFixture(fixture.runtimeRoot, 'test fixture: mismatch selected marker');
    await assert.rejects(releaseApi.resolveW09CompositionContext(options), /selected W09 marker differs/u);
    git(fixture.runtimeRoot, ['reset', '--quiet', '--hard', baseHead]);

    const proposal = JSON.parse(selectedBytes.toString('utf8')).proposals[0];
    const lockRelative = W09_COMPOSITION_LOCK_ROOT + proposal.requestId + '.json';
    const lockBytes = gitBytes(fixture.runtimeRoot, ['show', baseHead + ':' + lockRelative]);
    await writeFile(path.join(fixture.runtimeRoot, ...lockRelative.split('/')), Buffer.concat([lockBytes, Buffer.from(' ')]));
    git(fixture.runtimeRoot, ['add', lockRelative]);
    gitCommitFixture(fixture.runtimeRoot, 'test fixture: mismatch composition lock bytes');
    await assert.rejects(releaseApi.resolveW09CompositionContext(options), /request lock differs/u);
    git(fixture.runtimeRoot, ['reset', '--quiet', '--hard', baseHead]);
  });

  await t.test('InterT26_06_runtime-head-drift-during-replay-stops-before-allocation', async () => {
    const releaseId = JSON.parse(gitBytes(fixture.runtimeRoot, [
      'show', 'HEAD:' + W09_SELECTED_COMPOSITION_PATH,
    ]).toString('utf8')).proposals[0].releaseId;
    await assert.rejects(releaseApi.prepareW09SharedRelease({
      ...options,
      sourceRoot: fixture.runtimeRoot,
      releaseId,
      fetchImpl: async () => {
        gitCommitFixture(fixture.runtimeRoot, 'test fixture: runtime advanced during source replay', { allowEmpty: true });
        return new Response(null, { status: 404 });
      },
    }), /current main changed during W09 preflight replay/u);
    git(fixture.runtimeRoot, ['reset', '--quiet', '--hard', fixture.runtimeHead]);
    assert.deepEqual(await readOptionalBytes(runtimeStatePath), runtimeStateBefore,
      'runtime drift is rejected before reading or writing an allocation');
  });

  await t.test('InterT26_07_workflow-pins-readonly-composition-checkout-only-for-promotion', async () => {
    const workflow = parseYaml(await readFile(path.join(REPO_ROOT, '.github/workflows/shared-release.yml'), 'utf8'));
    const steps = workflow.jobs['shared-release'].steps;
    const checkout = steps.find(step => step.name === 'Check out the pinned historical W09 composition inputs');
    assert.ok(checkout);
    assert.equal(checkout.uses, 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803');
    assert.equal(checkout.with.repository, 'SyuanTsai/DarkTide-Web');
    assert.match(checkout.with.ref, /^[0-9a-f]{40}$/u, 'the workflow checkout must use a full pinned commit SHA');
    assert.equal(checkout.with.path, 'composition-inputs');
    assert.equal(checkout.with['persist-credentials'], false);
    assert.match(checkout.if, /inputs\.action != 'rollback'/u);
    const promote = steps.find(step => step.name === 'Promote the selected shared composition');
    assert.equal(promote.env.W09_COMPOSITION_ROOT, '${{ github.workspace }}/composition-inputs');
    assert.equal(promote.env.W09_EXPECTED_COMPOSITION_COMMIT, checkout.with.ref,
      'checkout ref and runtime-verified expected commit must name the same immutable input');
    assertCompositionInputsMatchCurrentHead(W09_TEST_GIT_ROOT, checkout.with.ref);
    assert.throws(
      () => assertCompositionInputsMatchCurrentHead(W09_TEST_GIT_ROOT, W09_HISTORICAL_COMPOSITION_COMMIT),
      /pinned selected marker bytes must match current HEAD/u,
      'both workflow fields pointing at the old composition commit must fail the selected/lock content relationship check',
    );
    const rollback = steps.find(step => step.name === 'Restore the explicit approved whole-site snapshot');
    assert.equal(Object.hasOwn(rollback.env, 'W09_COMPOSITION_ROOT'), false,
      'rollback remains on the exact-snapshot path and does not replay composition inputs');
  });

  await t.test('InterT26_08_cli-rejects-an-incomplete-root-pair-before-state-branch-restore', async () => {
    const childEnv = { ...process.env, W09_COMPOSITION_ROOT: fixture.compositionRoot };
    delete childEnv.W09_EXPECTED_COMPOSITION_COMMIT;
    const result = spawnSync(process.execPath, ['scripts/promote-w09-release.mjs'], {
      cwd: REPO_ROOT,
      env: childEnv,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /compositionRepoRoot and expectedCompositionCommit must be provided together/u);
    assert.equal(result.stderr.includes('owner state branch'), false,
      'the malformed configuration is rejected before the durable owner state store can be restored');
  });

  assert.deepEqual(await readOptionalBytes(runtimeStatePath), runtimeStateBefore,
    'all guard failures occur before any current-root state allocation');
  assert.deepEqual(await readOptionalBytes(historyStatePath), historyStateBefore,
    'no guard path writes the historical checkout');
});

test('InterT25_workflows-serialize-shared-publication-after-same-sha-CI-and-yield-legacy-route', async () => {
  const staticWorkflow = parseYaml(await readFile(path.join(REPO_ROOT, '.github/workflows/static-ci.yml'), 'utf8'));
  const sharedWorkflow = parseYaml(await readFile(path.join(REPO_ROOT, '.github/workflows/shared-release.yml'), 'utf8'));
  const staticSteps = staticWorkflow.jobs['static-package'].steps;
  const markerStep = staticSteps.find(step => step.name === 'Validate the selected shared-release authority marker');
  assert.ok(markerStep?.run.includes('validateW09SelectedComposition'));
  assert.ok(markerStep.run.includes("error.code !== 'ENOENT'"), 'missing and unreadable selected markers take different paths');
  assert.equal(staticWorkflow.jobs['static-package']['timeout-minutes'], 45);
  assert.equal(staticWorkflow.jobs['static-package'].outputs.selected_shared, '${{ steps.selected.outputs.selected }}');
  assert.match(staticWorkflow.jobs.deploy.if, /selected_shared != 'true'/u);
  const legacyPrepare = staticSteps.find(step => step.name === 'Build and verify deployable published package');
  assert.equal(legacyPrepare.if, "steps.selected.outputs.selected != 'true'");
  assert.equal(staticSteps.find(step => step.name === 'Upload the verified static artifact').if, "steps.selected.outputs.selected != 'true'");
  const legacyGuard = staticWorkflow.jobs.deploy.steps.find(step => step.name === 'Prevent legacy fallback after a W09 shared release is active');
  assert.ok(legacyGuard?.run.includes('readW09OwnerStateBranch'));
  assert.ok(legacyGuard?.run.includes('if (owner.active)'), 'active pointers or pending journal state block marker-free legacy deployment');
  assert.ok(staticWorkflow.jobs.deploy.steps.find(step => step.name === 'Verify preview, publish production, and verify HTTPS').if
    .includes("steps.legacy-authority.outputs.allowed == 'true'"));
  assert.ok(staticWorkflow.jobs.deploy.steps.find(step => step.name === 'Save deployment receipt').if
    .includes("steps.legacy-authority.outputs.allowed == 'true'"));

  assert.deepEqual(sharedWorkflow.on.workflow_run.workflows, ['Static package CI and Cloudflare deployment']);
  assert.deepEqual(sharedWorkflow.on.workflow_run.branches, ['main']);
  assert.ok(sharedWorkflow.on.workflow_dispatch.inputs.expected_current_json);
  assert.equal(sharedWorkflow.permissions.contents, 'write');
  const sharedJob = sharedWorkflow.jobs['shared-release'];
  assert.equal(sharedJob.concurrency.group, 'darktide-cloudflare-production');
  assert.equal(sharedJob.concurrency['cancel-in-progress'], false);
  assert.match(sharedJob.if, /conclusion == 'success'/u);
  assert.match(sharedJob.if, /head_repository\.full_name == github\.repository/u);
  assert.ok(sharedJob.steps.every(step => !step.uses?.startsWith('actions/checkout@')
    || (step.with?.['fetch-depth'] === 0 && step.with?.['persist-credentials'] === false)));
  const sameShaCi = sharedJob.steps.find(step => step.name === 'Confirm same-commit static CI success');
  assert.match(sameShaCi.run, /head_sha=\$EXPECTED_SHA/u);
  assert.match(sameShaCi.run, /conclusion == "success"/u);
  const selectedGate = sharedJob.steps.find(step => step.name === 'Check the selected composition gate');
  assert.ok(selectedGate.run.includes('readW09OwnerStateBranch'), 'missing selected marker must report active owner state');
  assert.ok(sharedJob.steps.some(step => step.name === 'Install Chromium for the exact-artifact browser smoke'
    && step.run === 'npx playwright install --with-deps chromium'));
  assert.ok(sharedJob.steps.some(step => step.name === 'Promote the selected shared composition'
    && step.run === 'node scripts/promote-w09-release.mjs'));
  assert.ok(sharedJob.steps.some(step => step.name === 'Restore the explicit approved whole-site snapshot'
    && step.run.includes('--expected-current-file')));

  const cli = await readFile(path.join(REPO_ROOT, 'scripts/promote-w09-release.mjs'), 'utf8');
  assert.match(cli, /createW09StateBranchStore/u);
  assert.match(cli, /await stateStore\.restore\(\)/u);
  assert.match(cli, /requireDurableState: true/u);
  assert.match(cli, /delete deploymentEnv\.W09_GIT_TOKEN/u);
});
