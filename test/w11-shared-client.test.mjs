import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadSharedRelease, selectSharedRelease } from '../web/shared-client.mjs';
import { computeDataRevision } from '../scripts/content/contract-release.mjs';
import { installTestLocation, jsonResponse, makeSharedPackage, responseFetch } from './w11-shared-client.fixture.mjs';

// Scenario: The build declares several game releases while its trusted shared tuple names one exact patch and revision.
// Purpose: Prevent a consumer from selecting a global maximum or mixing the legacy build identity with shared content.
test('UnitT10_selects_only_the_exact_shared_build_tuple', () => {
  const build = {
    game_version: 'legacy-version',
    data_revision: 'a'.repeat(64),
    shared_game_version: '1.13.2',
    shared_data_revision: 'b'.repeat(64),
    game_releases: [
      { game_version: '1.13.2', content_version: '1.13.2.1', data_revision: 'b'.repeat(64), manifest_path: '/data/' + 'b'.repeat(64) + '/manifest.json', manifest_sha256: 'c'.repeat(64) },
      { game_version: '1.13.3', content_version: '1.13.3.9', data_revision: 'd'.repeat(64), manifest_path: '/data/' + 'd'.repeat(64) + '/manifest.json', manifest_sha256: 'e'.repeat(64) },
    ],
    shared_files: [{ path: '/data/' + 'b'.repeat(64) + '/manifest.json', size_bytes: 1, sha256: 'c'.repeat(64) }],
  };

  assert.deepEqual(selectSharedRelease(build).pointer, build.game_releases[0]);
});

// Scenario: A valid build has a selected patch, an unrelated higher patch, four core domains, and a declared optional game-changes index.
// Purpose: Fetch only the exact manifest, required core domains, and the optional file selected by changeIndexPath.
// Given a verified same-origin package, When it is loaded, Then raw bytes, hashes, pins, and URLs cover exactly those files.
test('UnitT20_loads_exact_same_origin_core_domains_and_declared_index', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage({ extraGameChanges: true });
  const calls = [];
  const result = await loadSharedRelease({ build: pack.build, fetchImpl: responseFetch(pack.responses, { calls }) });

  assert.equal(result.status, 'ready');
  assert.equal(result.manifest.gameVersion, '1.13.2');
  assert.equal(result.manifest.changeIndexPath, 'game-changes.json');
  const coreKinds = ['skills', 'blessings', 'weapons', 'terms'];
  assert.deepEqual(result.domains.filter(domain => coreKinds.includes(domain.kind)).map(domain => domain.kind).sort(), coreKinds.sort());
  assert.equal(result.domains.filter(domain => domain.kind === 'game-changes').length, 1);

  const expectedPaths = [pack.pointer.manifest_path,
    ...pack.manifest.files.map(file => `/data/${pack.manifest.dataRevision}/${file.path}`)].sort();
  assert.deepEqual(pack.build.shared_files.map(file => file.path).sort(), expectedPaths,
    'the build pins the complete manifest and selected package, including the optional index');
  assert.deepEqual([...result.rawFiles.keys()].sort(), expectedPaths,
    'the returned raw package contains every declared core and selected optional file exactly once');
  assert.deepEqual(Buffer.from(result.manifestBytes), pack.manifestBytes,
    'the raw manifest bytes remain available for exact identity checks');
  for (const file of pack.manifest.files) {
    const rawPath = `/data/${pack.manifest.dataRevision}/${file.path}`;
    const rawBytes = Buffer.from(result.rawFiles.get(rawPath));
    assert.deepEqual(rawBytes, pack.domainBytes.get(file.path), `${file.kind} returns its pinned raw bytes`);
    assert.equal(rawBytes.byteLength, file.sizeBytes);
    assert.equal(createHash('sha256').update(rawBytes).digest('hex'), file.sha256);
  }
  assert.equal(calls.length, expectedPaths.length);
  assert.deepEqual(calls.map(call => new URL(call.url).pathname).sort(), expectedPaths,
    'requests target only the exact selected manifest and its declared file paths');
  assert.deepEqual(calls.map(call => call.url).sort(), expectedPaths.map(filePath => `https://web.test${filePath}`).sort(),
    'all requests use the exact configured same-origin URLs');
  assert.ok(calls.every(call => new URL(call.url).origin === 'https://web.test'));
  assert.ok(calls.every(call => call.init.redirect === 'error' && call.init.credentials === 'omit'));
});

// Scenario: A response differs from the manifest hash pinned into the build even though it is valid JSON.
// Purpose: Stop before any domain fetch so an altered manifest can never select or mix content.
// Given a changed raw manifest, When the shared release is loaded, Then it fails closed before requesting domains.
test('UnitT30_rejects_manifest_raw_hash_mismatch_before_domain_fetch', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage();
  const calls = [];
  const fetchImpl = responseFetch(pack.responses, { calls, alter: (path, bytes) => path === pack.pointer.manifest_path ? Buffer.concat([bytes, Buffer.from(' ')]) : null });

  await assert.rejects(loadSharedRelease({ build: pack.build, fetchImpl }), /manifest hash/i);
  assert.equal(calls.length, 1);
});

// Scenario: A manifest-pinned domain returns different bytes with an otherwise successful JSON response.
// Purpose: Prevent domain hash failure from falling back to the legacy catalog or returning a partial shared package.
// Given a tampered skills file, When the package is loaded, Then the whole shared load rejects.
test('UnitT40_rejects_a_domain_hash_mismatch_without_partial_result', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage();
  const fetchImpl = responseFetch(pack.responses, { alter: (path, bytes) => {
    if (!path.endsWith('/skills.json')) return null;
    return Buffer.from(bytes.toString('utf8').replace('w08-shared-domain/1.0.0', 'w08-shared-domain/1.0.1'));
  } });

  await assert.rejects(loadSharedRelease({ build: pack.build, fetchImpl }), /domain bytes do not match/i);
});

// Scenario: One selected domain contains a presentation without the required zh-TW locale.
// Purpose: Refuse malformed or English-only shared input instead of showing legacy or English text.
// Given a non-zh-TW presentation, When the package is loaded, Then validation rejects the complete release.
test('UnitT50_rejects_missing_zh_tw_presentation', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage({ wrongKind: 'skills' });

  await assert.rejects(loadSharedRelease({ build: pack.build, fetchImpl: responseFetch(pack.responses) }), /zh-TW/i);
});

// Scenario: The fixed-origin transport receives a missing response, challenge MIME, redirect, changed final URL, invalid UTF-8, or oversized manifest.
// Purpose: Keep the browser consumer bounded and same-origin, and reject non-JSON or incomplete transport before fetching any domain.
// Given six malformed manifest responses, When each package is requested, Then the client stops after its first response.
test('UnitT60_rejects_invalid_http_mime_redirect_utf8_and_oversized_manifest_responses', async t => {
  installTestLocation(t);
  const cases = [
    ['404', (url, bytes) => jsonResponse(url, bytes, { status: 404 }), /request failed/i],
    ['challenge MIME', (url, bytes) => jsonResponse(url, bytes, { contentType: 'text/html' }), /UTF-8 JSON/i],
    ['redirect flag', (url, bytes) => jsonResponse(url, bytes, { redirected: true }), /URL changed/i],
    ['changed final URL', (url, bytes) => jsonResponse(url, bytes, { finalUrl: `${url}?elsewhere=1` }), /URL changed/i],
    ['invalid UTF-8', (url) => jsonResponse(url, Buffer.from([0xc3, 0x28])), /UTF-8/i],
    ['oversized manifest', (url) => jsonResponse(url, Buffer.alloc(256 * 1024 + 1, 0x20)), /byte limit/i],
  ];
  for (const [label, makeResponse, expected] of cases) await t.test(label, async () => {
    const pack = makeSharedPackage();
    const manifestUrl = new URL(pack.pointer.manifest_path, 'https://web.test').href;
    const calls = [];
    const normal = responseFetch(pack.responses, { calls });
    const fetchImpl = async (url, init) => {
      if (url === manifestUrl) {
        calls.push({ url, init });
        return makeResponse(url, pack.manifestBytes);
      }
      return normal(url, init);
    };
    await assert.rejects(loadSharedRelease({ build: pack.build, fetchImpl }), expected);
    assert.equal(calls.length, 1, 'invalid manifest transport cannot trigger domain fetches');
  });
});

// Scenario: A hash-valid manifest has a different patch, unsupported schema or feature, or an incomplete file dependency.
// Purpose: Validate release metadata and the dependency graph before requesting any shared domain.
// Given a coherently re-pinned but incompatible manifest, When the client checks it, Then it rejects without fetching domains.
test('UnitT70_rejects_wrong_patch_schema_unsupported_feature_and_missing_dependency', async t => {
  installTestLocation(t);
  const cases = [
    ['wrong patch', manifest => { manifest.gameVersion = '1.13.1'; manifest.contentVersion = '1.13.1.1'; }, /identity does not match/i],
    ['unsupported schema', manifest => { manifest.schemaVersion = '3.0.0'; }, /schema is unsupported/i],
    ['unsupported required feature', manifest => { manifest.compatibility.requiredFeatures.push('unknown-feature-v9'); }, /unsupported required feature/i],
    ['missing dependency', manifest => { manifest.files[0].dependencies.push('missing.json'); }, /dependency is missing/i],
  ];
  for (const [label, mutate, expected] of cases) await t.test(label, async () => {
    const original = makeSharedPackage();
    const manifest = structuredClone(original.manifest);
    mutate(manifest);
    manifest.dataRevision = computeDataRevision(manifest);
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const revision = manifest.dataRevision;
    const manifestPath = `/data/${revision}/manifest.json`;
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const pointer = {
      game_version: original.pointer.game_version,
      content_version: original.pointer.content_version,
      data_revision: revision,
      manifest_path: manifestPath,
      manifest_sha256: hash(manifestBytes),
    };
    const unrelated = original.build.game_releases.find(row => row.game_version !== pointer.game_version);
    const sharedFiles = [
      { path: manifestPath, size_bytes: manifestBytes.byteLength, sha256: hash(manifestBytes) },
      ...[...original.domainBytes].map(([path, bytes]) => ({ path: `/data/${revision}/${path}`, size_bytes: bytes.byteLength, sha256: hash(bytes) })),
    ];
    const pack = {
      build: { ...original.build, shared_data_revision: revision, game_releases: [pointer, unrelated], shared_files: sharedFiles },
      pointer,
      manifest,
      manifestBytes,
      domainBytes: original.domainBytes,
      responses: new Map([
        [manifestPath, manifestBytes],
        ...[...original.domainBytes].map(([path, bytes]) => [`/data/${revision}/${path}`, bytes]),
      ]),
    };
    const calls = [];
    await assert.rejects(loadSharedRelease({ build: pack.build, fetchImpl: responseFetch(pack.responses, { calls }) }), expected);
    assert.equal(calls.length, 1, 'manifest metadata is rejected before domain requests');
  });
});

// Scenario: The first network response never completes, while a caller can also cancel a pending request.
// Purpose: Ensure the shared page leaves loading within the fixed transport deadline and preserves caller cancellation.
// Given an in-flight request, When the 30-second deadline or caller signal fires, Then the operation rejects and its fetch signal is aborted.
test('UnitT80_times_out_stalled_fetches_and_preserves_caller_abort', async t => {
  installTestLocation(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pack = makeSharedPackage();
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  let timeoutSignal;
  const stalledFetch = (url, init) => {
    timeoutSignal = init.signal;
    startedResolve();
    return new Promise(() => {});
  };
  const timedOut = loadSharedRelease({ build: pack.build, fetchImpl: stalledFetch });
  await started;
  assert.equal(timeoutSignal.aborted, false, 'the request is in flight before the deadline advances');
  t.mock.timers.tick(30_000);
  await assert.rejects(timedOut, /timed out/i);
  assert.equal(timeoutSignal.aborted, true, 'deadline aborts the active fetch signal');

  const controller = new AbortController();
  let callerSignal;
  const pending = loadSharedRelease({ build: pack.build, fetchImpl: (_url, init) => {
    callerSignal = init.signal;
    return new Promise(() => {});
  }, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /abort/i);
  assert.equal(callerSignal.aborted, true, 'caller cancellation reaches the active fetch signal');
});
