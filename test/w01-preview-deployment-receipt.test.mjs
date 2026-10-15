import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDeploymentReceipt } from '../scripts/w01-preview-deployment-receipt.mjs';
import { buildW01 } from '../scripts/w01-build.mjs';
import { jsonBytes } from '../src/static/common.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const publishedR14Root = process.env.W01_PRIOR_REAL_R14_ROOT;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Scenario: a deployed preview serves the local versioned package and one pinned old data URL.
// Purpose: the receipt is written only when remote bytes, noindex, CORS, and retained URL checks pass.
test('UnitT00_deployment-receipt-verifies-version-domains-and-retained-url', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-deploy-receipt-'));
  try {
    const copiedRoot = path.join(tempRoot, 'repo');
    const outputRoot = path.join(tempRoot, 'dist-w01');
    const fixtureRoot = path.join(repoRoot, 'test', 'fixtures', 'w01');
    await cp(path.join(fixtureRoot, 'content', 'w01'), path.join(copiedRoot, 'content', 'w01'), { recursive: true });
    await cp(path.join(fixtureRoot, 'source.lock.json'), path.join(copiedRoot, 'source.lock.json'));
    const build = await buildW01({ repoRoot: copiedRoot, outputRoot });
    const versionBytes = await readFile(path.join(outputRoot, 'version.json'));
    const version = JSON.parse(versionBytes);
    const manifestPath = path.join(outputRoot, ...version.game_releases[0].manifest_path.slice(1).split('/'));
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes);

    const oldBytes = Buffer.from('pinned old preview data');
    const oldRevision = 'a'.repeat(64);
    const oldRow = { path: 'data/' + oldRevision + '/old.json', sizeBytes: oldBytes.byteLength, sha256: sha256(oldBytes) };
    const retainedManifest = {
      schemaVersion: '1.0.0', baselineCommit: 'f'.repeat(40), dataRevision: oldRevision,
      fileCount: 1, totalBytes: oldBytes.byteLength, files: [oldRow]
    };
    await mkdir(path.join(copiedRoot, 'docs', 'w01'), { recursive: true });
    await writeFile(path.join(copiedRoot, 'docs', 'w01', 'retained-preview-manifest.json'), jsonBytes(retainedManifest));
    const oldPath = path.join(outputRoot, ...oldRow.path.split('/'));
    await mkdir(path.dirname(oldPath), { recursive: true });
    await writeFile(oldPath, oldBytes);
    const buildReceiptPath = path.join(outputRoot, 'receipt.json');
    const buildReceipt = JSON.parse(await readFile(buildReceiptPath, 'utf8'));
    buildReceipt.files.push(oldRow);
    buildReceipt.files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    buildReceipt.retainedData = {
      baselineCommit: retainedManifest.baselineCommit,
      dataRevision: oldRevision,
      fileCount: retainedManifest.fileCount,
      totalBytes: retainedManifest.totalBytes,
      inventorySha256: sha256(jsonBytes(retainedManifest))
    };
    await writeFile(buildReceiptPath, jsonBytes(buildReceipt));

    const objects = new Map([
      ['/version.json', versionBytes],
      [version.game_releases[0].manifest_path, manifestBytes],
      ['/' + oldRow.path, oldBytes]
    ]);
    for (const file of manifest.files) {
      objects.set('/data/' + build.dataRevision + '/' + file.path,
        await readFile(path.join(outputRoot, 'data', build.dataRevision, file.path)));
    }
    const fetchImpl = async url => new Response(objects.get(new URL(url).pathname) ?? new Uint8Array(), {
      status: objects.has(new URL(url).pathname) ? 200 : 404,
      headers: { 'access-control-allow-origin': '*', 'x-robots-tag': 'noindex, noarchive', 'content-type': 'application/json; charset=utf-8' }
    });
    const receiptPath = path.join(tempRoot, 'deployment-receipt.json');
    const result = await createDeploymentReceipt({
      repoRoot: copiedRoot, outputRoot, receiptPath, fetchImpl, createdAt: '2026-10-13T00:00:00.000Z'
    });
    assert.equal(result.requestKind, 'w01-preview-deployment-receipt');
    assert.equal(result.contentVersion, '0.0.2');
    assert.equal(result.verifiedRemoteObjects, 8);
    assert.equal(result.retainedBaseline.sampleSha256, oldRow.sha256);
    assert.equal(JSON.parse(await readFile(receiptPath, 'utf8')).deploymentPerformed, true);

    const missingHeadersFetch = async url => new Response(objects.get(new URL(url).pathname), {
      status: 200, headers: { 'x-robots-tag': 'noindex' }
    });
    await assert.rejects(
      createDeploymentReceipt({ repoRoot: copiedRoot, outputRoot, receiptPath: path.join(tempRoot, 'bad.json'), fetchImpl: missingHeadersFetch }),
      /CORS response header/
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// Scenario: the current non-fixture W01 candidate is deployed only to the isolated preview worker.
// Purpose: the receipt accepts the exact pending-preview flag combination and rejects mixed or missing mode flags before network access.
test('UnitT01_deployment-receipt-verifies-native-pending-candidate-and-quarantine-flags', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-native-deploy-receipt-'));
  try {
    const copiedRoot = path.join(tempRoot, 'repo');
    const outputRoot = path.join(tempRoot, 'dist-w01');
    await cp(path.join(repoRoot, 'content', 'w01'), path.join(copiedRoot, 'content', 'w01'), { recursive: true });
    await cp(path.join(repoRoot, 'source.lock.json'), path.join(copiedRoot, 'source.lock.json'));
    const build = await buildW01({ repoRoot: copiedRoot, outputRoot, mode: 'candidate-preview' });
    const versionBytes = await readFile(path.join(outputRoot, 'version.json'));
    const version = JSON.parse(versionBytes);
    const manifestPath = path.join(outputRoot, ...version.game_releases[0].manifest_path.slice(1).split('/'));
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes);

    const oldBytes = Buffer.from('pinned old preview data');
    const oldRevision = 'b'.repeat(64);
    const oldRow = { path: 'data/' + oldRevision + '/old.json', sizeBytes: oldBytes.byteLength, sha256: sha256(oldBytes) };
    const retainedManifest = {
      schemaVersion: '1.0.0', baselineCommit: 'e'.repeat(40), dataRevision: oldRevision,
      fileCount: 1, totalBytes: oldBytes.byteLength, files: [oldRow]
    };
    await mkdir(path.join(copiedRoot, 'docs', 'w01'), { recursive: true });
    await writeFile(path.join(copiedRoot, 'docs', 'w01', 'retained-preview-manifest.json'), jsonBytes(retainedManifest));
    const oldPath = path.join(outputRoot, ...oldRow.path.split('/'));
    await mkdir(path.dirname(oldPath), { recursive: true });
    await writeFile(oldPath, oldBytes);
    const buildReceiptPath = path.join(outputRoot, 'receipt.json');
    const buildReceipt = JSON.parse(await readFile(buildReceiptPath, 'utf8'));
    buildReceipt.files.push(oldRow);
    buildReceipt.files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    buildReceipt.retainedData = {
      baselineCommit: retainedManifest.baselineCommit,
      dataRevision: oldRevision,
      fileCount: retainedManifest.fileCount,
      totalBytes: retainedManifest.totalBytes,
      inventorySha256: sha256(jsonBytes(retainedManifest))
    };
    await writeFile(buildReceiptPath, jsonBytes(buildReceipt));

    const objects = new Map([
      ['/version.json', versionBytes],
      [version.game_releases[0].manifest_path, manifestBytes],
      ['/' + oldRow.path, oldBytes]
    ]);
    for (const file of manifest.files) {
      objects.set('/data/' + build.dataRevision + '/' + file.path,
        await readFile(path.join(outputRoot, 'data', build.dataRevision, file.path)));
    }
    const previousOutputRoot = path.join(tempRoot, 'pinned-prior-0.0.14');
    await mkdir(previousOutputRoot, { recursive: true });
    const previousRevision = '9bd96c5e5dead2999ef76ce9b86d0568724b761050ea3ec40b66e47ff815778d';
    const previousBuildId = '6591d2c886a7bb1bb41f8dc9cb7e261dea570ebd0d8e7e956ee5e4d3d536daa4';
    const previousManifestSha256 = '58c326e0777cda314bb9016e0d8f3cb748cc59de1ceb33bd0ac4b92fcd717492';
    const previousVersion = {
      schema_version: 2,
      data_revision: previousRevision,
      build_id: previousBuildId,
      game_version: '1.13.2',
      package_kind: 'pending-preview',
      game_releases: [{
        game_version: '1.13.2',
        content_version: '0.0.14',
        data_revision: previousRevision,
        manifest_path: '/data/' + previousRevision + '/manifest.json',
        manifest_sha256: previousManifestSha256
      }]
    };
    const previousVersionBytes = jsonBytes(previousVersion);
    assert.equal(sha256(previousVersionBytes), '86f853ffc0b38c17e31b7c224dcacaa9344c9fa4e8f9f2bee3ae1dbdf7fe5b2d');
    const previousReceipt = {
      ...buildReceipt,
      buildId: previousBuildId,
      dataRevision: previousRevision,
      contentVersion: '0.0.14',
      manifestPath: 'data/' + previousRevision + '/manifest.json',
      manifestSha256: previousManifestSha256,
      source: {
        repository: 'https://github.com/SyuanTsai/DarkTide-Source-Data',
        commit: '7f88a1368a29a79c0de654ee5cd17886dd360a47',
        sourceRevision: 'f9917e5f8c14e1fd768f502b9c0cafa59602cae1ac5e9bf8372e467268de38e2',
        manifestSha256: 'e8ec9697ce5b15d3e9e040a2c023f18db23e2fa7ab41ea25c28f75eb75e85835'
      },
      web: { authoringCommit: 'b57d6268a470009a560eb03a8a3da4ba6748f106' },
      fixtureOnly: false,
      publicationEligible: false,
      candidatePreviewOnly: true,
      formalPublishAllowed: false,
      deploymentPerformed: false,
      files: [{ path: 'version.json', sizeBytes: previousVersionBytes.byteLength, sha256: sha256(previousVersionBytes) }]
    };
    await writeFile(path.join(previousOutputRoot, 'version.json'), previousVersionBytes);
    await writeFile(path.join(previousOutputRoot, 'receipt.json'), jsonBytes(previousReceipt));

    let fetchCount = 0;
    let versionFetchCount = 0;
    const retryDelays = [];
    const fetchImpl = async url => {
      fetchCount += 1;
      const pathname = new URL(url).pathname;
      const isVersion = pathname === '/version.json';
      if (isVersion) versionFetchCount += 1;
      const body = isVersion && versionFetchCount <= 3
        ? previousVersionBytes
        : objects.get(pathname) ?? new Uint8Array();
      return new Response(body, {
        status: isVersion || objects.has(pathname) ? 200 : 404,
        headers: { 'access-control-allow-origin': '*', 'x-robots-tag': 'noindex, noarchive', 'content-type': 'application/json; charset=utf-8' }
      });
    };
    const receiptPath = path.join(tempRoot, 'deployment-receipt.json');
    const result = await createDeploymentReceipt({
      repoRoot: copiedRoot, outputRoot, previousOutputRoot, receiptPath, fetchImpl,
      sleepImpl: async milliseconds => retryDelays.push(milliseconds),
      createdAt: '2026-10-14T00:00:00.000Z'
    });
    assert.equal(result.requestKind, 'w01-preview-deployment-receipt');
    assert.equal(result.contentVersion, '0.0.15');
    assert.equal(result.packageKind, 'pending-preview');
    assert.equal(result.candidatePreviewOnly, true);
    assert.equal(result.verifiedRemoteObjects, 8);
    assert.equal(versionFetchCount, 4, 'only the exact pinned 0.0.14 version may be retried before 0.0.15');
    assert.deepEqual(retryDelays, [250, 500, 1000], 'the propagation wait is bounded and injectable');
    assert.equal(fetchCount, 11, 'all eight required objects are verified after three prior-version responses');
    assert.equal(result.retainedBaseline.sampleSha256, oldRow.sha256);
    assert.equal(JSON.parse(await readFile(receiptPath, 'utf8')).deploymentPerformed, true);

    const invalidPreviousRoot = path.join(tempRoot, 'wrong-pinned-prior');
    await cp(previousOutputRoot, invalidPreviousRoot, { recursive: true });
    const invalidPreviousReceiptPath = path.join(invalidPreviousRoot, 'receipt.json');
    const invalidPreviousReceipt = JSON.parse(await readFile(invalidPreviousReceiptPath, 'utf8'));
    invalidPreviousReceipt.web.authoringCommit = '0'.repeat(40);
    await writeFile(invalidPreviousReceiptPath, jsonBytes(invalidPreviousReceipt));
    let invalidPriorFetchCount = 0;
    await assert.rejects(
      createDeploymentReceipt({
        repoRoot: copiedRoot, outputRoot, previousOutputRoot: invalidPreviousRoot,
        receiptPath: path.join(tempRoot, 'wrong-prior.json'),
        fetchImpl: async () => { invalidPriorFetchCount += 1; return new Response(); }
      }),
      /local prior package is not the pinned quarantined 0\.0\.14 candidate/
    );
    assert.equal(invalidPriorFetchCount, 0, 'an invalid pinned prior package is rejected before any network request');

    const unrelatedRevision = 'f'.repeat(64);
    const unrelatedVersionBytes = jsonBytes({
      ...previousVersion,
      data_revision: unrelatedRevision,
      build_id: 'a'.repeat(64),
      game_releases: [{
        ...previousVersion.game_releases[0],
        content_version: '0.0.11',
        data_revision: unrelatedRevision,
        manifest_path: '/data/' + unrelatedRevision + '/manifest.json',
        manifest_sha256: 'b'.repeat(64)
      }]
    });
    let unrelatedFetchCount = 0;
    const unrelatedVersionFetch = async url => {
      unrelatedFetchCount += 1;
      const pathname = new URL(url).pathname;
      const body = pathname === '/version.json' ? unrelatedVersionBytes : objects.get(pathname) ?? new Uint8Array();
      return new Response(body, {
        status: pathname === '/version.json' || objects.has(pathname) ? 200 : 404,
        headers: { 'access-control-allow-origin': '*', 'x-robots-tag': 'noindex, noarchive', 'content-type': 'application/json; charset=utf-8' }
      });
    };
    await assert.rejects(
      createDeploymentReceipt({
        repoRoot: copiedRoot, outputRoot, previousOutputRoot,
        receiptPath: path.join(tempRoot, 'unrelated-version.json'), fetchImpl: unrelatedVersionFetch,
        sleepImpl: async milliseconds => retryDelays.push(milliseconds)
      }),
      /version\.json bytes do not match/
    );
    assert.equal(unrelatedFetchCount, 1, 'an unrelated version identity must fail without retrying');

    let staleFetchCount = 0;
    const staleRetryDelays = [];
    await assert.rejects(
      createDeploymentReceipt({
        repoRoot: copiedRoot, outputRoot, previousOutputRoot,
        receiptPath: path.join(tempRoot, 'stale-version.json'),
        fetchImpl: async url => {
          staleFetchCount += 1;
          const pathname = new URL(url).pathname;
          return new Response(pathname === '/version.json' ? previousVersionBytes : objects.get(pathname) ?? new Uint8Array(), {
            status: pathname === '/version.json' || objects.has(pathname) ? 200 : 404,
            headers: { 'access-control-allow-origin': '*', 'x-robots-tag': 'noindex, noarchive', 'content-type': 'application/json; charset=utf-8' }
          });
        },
        sleepImpl: async milliseconds => staleRetryDelays.push(milliseconds)
      }),
      /still serves the pinned prior 0\.0\.14 package after 7 checks/
    );
    assert.equal(staleFetchCount, 7, 'retry stops after the initial check plus six bounded retries');
    assert.deepEqual(staleRetryDelays, [250, 500, 1000, 2000, 4000, 8000]);

    const assertPackageObjectMismatchFailsImmediately = async (pathname, label) => {
      let versionChecks = 0;
      let mismatchedObjectChecks = 0;
      const delays = [];
      await assert.rejects(
        createDeploymentReceipt({
          repoRoot: copiedRoot, outputRoot, previousOutputRoot,
          receiptPath: path.join(tempRoot, label + '-mismatch.json'),
          fetchImpl: async url => {
            const requestPath = new URL(url).pathname;
            if (requestPath === '/version.json') versionChecks += 1;
            if (requestPath === pathname) {
              mismatchedObjectChecks += 1;
              return new Response('tampered package object', {
                status: 200,
                headers: { 'access-control-allow-origin': '*', 'x-robots-tag': 'noindex, noarchive', 'content-type': 'application/json; charset=utf-8' }
              });
            }
            return new Response(objects.get(requestPath) ?? new Uint8Array(), {
              status: objects.has(requestPath) ? 200 : 404,
              headers: { 'access-control-allow-origin': '*', 'x-robots-tag': 'noindex, noarchive', 'content-type': 'application/json; charset=utf-8' }
            });
          },
          sleepImpl: async milliseconds => delays.push(milliseconds)
        }),
        new RegExp(label + ' bytes do not match')
      );
      assert.equal(versionChecks, 1, label + ' mismatch must not retry version.json');
      assert.equal(mismatchedObjectChecks, 1, label + ' mismatch is checked once');
      assert.deepEqual(delays, [], label + ' mismatch must not trigger a propagation wait');
    };
    await assertPackageObjectMismatchFailsImmediately(version.game_releases[0].manifest_path, 'manifest');
    await assertPackageObjectMismatchFailsImmediately('/data/' + build.dataRevision + '/' + manifest.files[0].path, manifest.files[0].kind);
    await assertPackageObjectMismatchFailsImmediately('/' + oldRow.path, 'retained baseline data');

    let badStatusCount = 0;
    await assert.rejects(
      createDeploymentReceipt({
        repoRoot: copiedRoot, outputRoot, previousOutputRoot,
        receiptPath: path.join(tempRoot, 'bad-status.json'),
        fetchImpl: async url => {
          badStatusCount += 1;
          const pathname = new URL(url).pathname;
          return new Response(pathname === '/version.json' ? previousVersionBytes : objects.get(pathname) ?? new Uint8Array(), {
            status: pathname === '/version.json' ? 503 : 200,
            headers: { 'access-control-allow-origin': '*', 'x-robots-tag': 'noindex, noarchive', 'content-type': 'application/json; charset=utf-8' }
          });
        },
        sleepImpl: async milliseconds => staleRetryDelays.push(milliseconds)
      }),
      /version\.json returned HTTP 503/
    );
    assert.equal(badStatusCount, 1, 'a non-200 response is never retried');

    let missingHeaderCount = 0;
    await assert.rejects(
      createDeploymentReceipt({
        repoRoot: copiedRoot, outputRoot, previousOutputRoot,
        receiptPath: path.join(tempRoot, 'missing-header.json'),
        fetchImpl: async url => {
          missingHeaderCount += 1;
          const pathname = new URL(url).pathname;
          return new Response(pathname === '/version.json' ? previousVersionBytes : objects.get(pathname) ?? new Uint8Array(), {
            status: 200,
            headers: { 'x-robots-tag': 'noindex, noarchive' }
          });
        },
        sleepImpl: async milliseconds => staleRetryDelays.push(milliseconds)
      }),
      /version\.json is missing the preview CORS response header/
    );
    assert.equal(missingHeaderCount, 1, 'missing required headers are never retried');

    let wrongContentTypeCount = 0;
    const contentTypeRetryDelays = [];
    await assert.rejects(
      createDeploymentReceipt({
        repoRoot: copiedRoot, outputRoot, previousOutputRoot,
        receiptPath: path.join(tempRoot, 'wrong-content-type.json'),
        fetchImpl: async url => {
          wrongContentTypeCount += 1;
          const pathname = new URL(url).pathname;
          return new Response(pathname === '/version.json' ? versionBytes : objects.get(pathname) ?? new Uint8Array(), {
            status: pathname === '/version.json' || objects.has(pathname) ? 200 : 404,
            headers: {
              'access-control-allow-origin': '*', 'x-robots-tag': 'noindex, noarchive',
              'content-type': pathname === '/version.json' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8'
            }
          });
        },
        sleepImpl: async milliseconds => contentTypeRetryDelays.push(milliseconds)
      }),
      /version\.json has unexpected content-type/
    );
    assert.equal(wrongContentTypeCount, 1, 'a wrong JSON content type is rejected immediately');
    assert.deepEqual(contentTypeRetryDelays, [], 'a content-type error must not trigger a propagation wait');

    let wrongPathCount = 0;
    await assert.rejects(
      createDeploymentReceipt({
        repoRoot: copiedRoot, outputRoot, previousOutputRoot,
        receiptPath: path.join(tempRoot, 'wrong-path.json'),
        fetchImpl: async url => {
          wrongPathCount += 1;
          const pathname = new URL(url).pathname;
          const response = new Response(pathname === '/version.json' ? previousVersionBytes : objects.get(pathname) ?? new Uint8Array(), {
            status: 200,
            headers: { 'access-control-allow-origin': '*', 'x-robots-tag': 'noindex, noarchive', 'content-type': 'application/json; charset=utf-8' }
          });
          if (pathname === '/version.json') Object.defineProperty(response, 'url', { value: 'https://example.invalid/version.json' });
          return response;
        },
        sleepImpl: async milliseconds => staleRetryDelays.push(milliseconds)
      }),
      /unexpected origin or path/
    );
    assert.equal(wrongPathCount, 1, 'an unexpected response origin or path is never retried');

    const localVersionPath = path.join(outputRoot, 'version.json');
    const tamperedLocalVersion = JSON.parse(await readFile(localVersionPath, 'utf8'));
    tamperedLocalVersion.game_releases[0].manifest_path = '/wrong/path/manifest.json';
    await writeFile(localVersionPath, jsonBytes(tamperedLocalVersion));
    let tamperedLocalFetchCount = 0;
    await assert.rejects(
      createDeploymentReceipt({
        repoRoot: copiedRoot, outputRoot, previousOutputRoot,
        receiptPath: path.join(tempRoot, 'tampered-local-path.json'),
        fetchImpl: async () => { tamperedLocalFetchCount += 1; return new Response(); }
      }),
      /local version\.json bytes do not match the verified W01 receipt/
    );
    assert.equal(tamperedLocalFetchCount, 0, 'a locally tampered manifest path is rejected before network access');
    await writeFile(localVersionPath, versionBytes);

    const validReceipt = JSON.parse(await readFile(buildReceiptPath, 'utf8'));
    const invalidModes = [
      { ...validReceipt, fixtureOnly: true },
      { ...validReceipt, candidatePreviewOnly: false },
      Object.fromEntries(Object.entries(validReceipt).filter(([key]) => key !== 'candidatePreviewOnly'))
    ];
    for (const invalidReceipt of invalidModes) {
      await writeFile(buildReceiptPath, jsonBytes(invalidReceipt));
      fetchCount = 0;
      await assert.rejects(
        createDeploymentReceipt({ repoRoot: copiedRoot, outputRoot, receiptPath: path.join(tempRoot, 'invalid.json'), fetchImpl }),
        /quarantined preview build/
      );
      assert.equal(fetchCount, 0, 'an invalid preview mode must be rejected before fetching remote objects');
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// Scenario: version.json has switched to 0.0.15 while Cloudflare briefly returns 404 for new content-addressed package objects.
// Purpose: retry only exact-path 404 responses within one shared bounded budget; old or unknown bytes fail closed.
test('InterT02_deployment-receipt-retries-only-content-addressed-object-404', { skip: !publishedR14Root }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'darktide-w01-object-propagation-'));
  try {
    const copiedRoot = path.join(tempRoot, 'repo');
    const outputRoot = path.join(tempRoot, 'dist-w01');
    await cp(path.join(repoRoot, 'content', 'w01'), path.join(copiedRoot, 'content', 'w01'), { recursive: true });
    await cp(path.join(repoRoot, 'source.lock.json'), path.join(copiedRoot, 'source.lock.json'));
    const build = await buildW01({ repoRoot: copiedRoot, outputRoot, mode: 'candidate-preview' });
    const versionBytes = await readFile(path.join(outputRoot, 'version.json'));
    const version = JSON.parse(versionBytes);
    const manifestPath = version.game_releases[0].manifest_path;
    const manifestBytes = await readFile(path.join(outputRoot, ...manifestPath.slice(1).split('/')));
    const manifest = JSON.parse(manifestBytes);

    const retainedBytes = Buffer.from('test-only pinned retained preview bytes');
    const retainedRevision = 'b'.repeat(64);
    const retainedRow = { path: 'data/' + retainedRevision + '/retained.json', sizeBytes: retainedBytes.byteLength, sha256: sha256(retainedBytes) };
    const retainedManifest = {
      schemaVersion: '1.0.0', baselineCommit: 'e'.repeat(40), dataRevision: retainedRevision,
      fileCount: 1, totalBytes: retainedBytes.byteLength, files: [retainedRow]
    };
    await mkdir(path.join(copiedRoot, 'docs', 'w01'), { recursive: true });
    await writeFile(path.join(copiedRoot, 'docs', 'w01', 'retained-preview-manifest.json'), jsonBytes(retainedManifest));
    const retainedPath = path.join(outputRoot, ...retainedRow.path.split('/'));
    await mkdir(path.dirname(retainedPath), { recursive: true });
    await writeFile(retainedPath, retainedBytes);
    const buildReceiptPath = path.join(outputRoot, 'receipt.json');
    const buildReceipt = JSON.parse(await readFile(buildReceiptPath, 'utf8'));
    buildReceipt.files.push(retainedRow);
    buildReceipt.files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    buildReceipt.retainedData = {
      baselineCommit: retainedManifest.baselineCommit,
      dataRevision: retainedManifest.dataRevision,
      fileCount: retainedManifest.fileCount,
      totalBytes: retainedManifest.totalBytes,
      inventorySha256: sha256(jsonBytes(retainedManifest))
    };
    await writeFile(buildReceiptPath, jsonBytes(buildReceipt));

    const previousReceipt = JSON.parse(await readFile(path.join(publishedR14Root, 'receipt.json'), 'utf8'));
    const previousManifestBytes = await readFile(path.join(publishedR14Root, ...previousReceipt.manifestPath.split('/')));
    const previousManifest = JSON.parse(previousManifestBytes);
    const previousDomainBytes = new Map(await Promise.all(previousManifest.files.map(async file => [
      file.kind,
      await readFile(path.join(publishedR14Root, 'data', previousReceipt.dataRevision, file.path))
    ])));
    const currentObjects = new Map([
      ['/version.json', versionBytes],
      [manifestPath, manifestBytes],
      ['/' + retainedRow.path, retainedBytes]
    ]);
    for (const file of manifest.files) {
      currentObjects.set('/data/' + build.dataRevision + '/' + file.path,
        await readFile(path.join(outputRoot, 'data', build.dataRevision, file.path)));
    }

    const headers = { 'access-control-allow-origin': '*', 'x-robots-tag': 'noindex, noarchive', 'content-type': 'application/json; charset=utf-8' };
    const manifestRequestCount = { value: 0 };
    const skillsRequestCount = { value: 0 };
    const retryDelays = [];
    let fetchCount = 0;
    const skillsPath = '/data/' + build.dataRevision + '/skills.json';
    const fetchImpl = async url => {
      fetchCount += 1;
      const pathname = new URL(url).pathname;
      if (pathname === manifestPath) {
        manifestRequestCount.value += 1;
        if (manifestRequestCount.value === 1) return new Response('not propagated yet', { status: 404, headers });
      }
      if (pathname === skillsPath) {
        skillsRequestCount.value += 1;
        if (skillsRequestCount.value === 1) return new Response('not propagated yet', { status: 404, headers });
      }
      const body = currentObjects.get(pathname);
      return new Response(body ?? new Uint8Array(), { status: body ? 200 : 404, headers });
    };

    const result = await createDeploymentReceipt({
      repoRoot: copiedRoot, outputRoot, previousOutputRoot: publishedR14Root,
      receiptPath: path.join(tempRoot, 'deployment-receipt.json'), fetchImpl,
      sleepImpl: async milliseconds => retryDelays.push(milliseconds)
    });
    assert.equal(result.contentVersion, '0.0.15');
    assert.equal(result.verifiedRemoteObjects, 8);
    assert.equal(manifestRequestCount.value, 2, 'a transient manifest 404 is retried once');
    assert.equal(skillsRequestCount.value, 2, 'a transient domain 404 is retried once');
    assert.deepEqual(retryDelays, [250, 500]);
    assert.equal(fetchCount, 10);
    assert.equal(JSON.parse(await readFile(path.join(tempRoot, 'deployment-receipt.json'), 'utf8')).deploymentPerformed, true);

    for (const [pathname, pinnedBytes, label] of [
      [manifestPath, previousManifestBytes, 'manifest'],
      ['/data/' + build.dataRevision + '/weapons.json', previousDomainBytes.get('weapons'), 'weapons']
    ]) {
      let staleObjectCount = 0;
      const staleObjectDelays = [];
      await assert.rejects(
        createDeploymentReceipt({
          repoRoot: copiedRoot, outputRoot, previousOutputRoot: publishedR14Root,
          receiptPath: path.join(tempRoot, 'stale-' + label + '-at-new-path.json'),
          fetchImpl: async url => {
            const requestPath = new URL(url).pathname;
            if (requestPath === pathname) {
              staleObjectCount += 1;
              return new Response(pinnedBytes, { status: 200, headers });
            }
            const body = currentObjects.get(requestPath);
            return new Response(body ?? new Uint8Array(), { status: body ? 200 : 404, headers });
          },
          sleepImpl: async milliseconds => staleObjectDelays.push(milliseconds)
        }),
        new RegExp(label + ' bytes do not match')
      );
      assert.equal(staleObjectCount, 1, 'pinned 0.0.14 ' + label + ' bytes at a new revision URL are rejected immediately');
      assert.deepEqual(staleObjectDelays, [], 'old ' + label + ' content at a new revision URL is not retryable');
    }

    let exhaustedManifestCount = 0;
    let exhaustedSkillsCount = 0;
    let exhaustedBlessingsCount = 0;
    const exhaustedDelays = [];
    await assert.rejects(
      createDeploymentReceipt({
        repoRoot: copiedRoot, outputRoot, previousOutputRoot: publishedR14Root,
        receiptPath: path.join(tempRoot, 'shared-retry-budget-exhausted.json'),
        fetchImpl: async url => {
          const pathname = new URL(url).pathname;
          if (pathname === manifestPath && ++exhaustedManifestCount <= 5) {
            return new Response('not propagated yet', { status: 404, headers });
          }
          if (pathname === skillsPath && ++exhaustedSkillsCount === 1) {
            return new Response('not propagated yet', { status: 404, headers });
          }
          if (pathname === '/data/' + build.dataRevision + '/blessings.json') {
            exhaustedBlessingsCount += 1;
            return new Response('not propagated yet', { status: 404, headers });
          }
          const body = currentObjects.get(pathname);
          return new Response(body ?? new Uint8Array(), { status: body ? 200 : 404, headers });
        },
        sleepImpl: async milliseconds => exhaustedDelays.push(milliseconds)
      }),
      /shared package-object propagation retry budget is exhausted/
    );
    assert.equal(exhaustedManifestCount, 6, 'the manifest consumes five retries from the shared budget');
    assert.equal(exhaustedSkillsCount, 2, 'the first domain consumes the sixth and final retry');
    assert.equal(exhaustedBlessingsCount, 1, 'the next domain fails at its first 404 after the shared budget is exhausted');
    assert.deepEqual(exhaustedDelays, [250, 500, 1000, 2000, 4000, 8000]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
