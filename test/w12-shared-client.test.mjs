import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSharedRelease } from '../web/shared-client.mjs';
import { installTestLocation, makeSharedPackage, responseFetch } from './w11-shared-client.fixture.mjs';

// Scenario: The selected manifest pins an optional game-changes index alongside the four required domains.
// Purpose: Load the exact optional file only when the verified manifest declares it.
// Given a same-origin package with a pinned game-changes index, When the release is loaded, Then the index is validated, returned and fetched once.
test('UnitT10_loads_exact_manifest_pinned_optional_game_changes_index', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage({ extraGameChanges: true });
  const calls = [];

  const result = await loadSharedRelease({ build: pack.build, fetchImpl: responseFetch(pack.responses, { calls }) });

  assert.equal(result.status, 'ready');
  assert.equal(result.domains.find(domain => domain.kind === 'game-changes')?.kind, 'game-changes');
  assert.ok(result.rawFiles.has(`/data/${pack.manifest.dataRevision}/game-changes.json`));
  assert.equal(calls.length, 6);
  assert.equal(calls.filter(call => call.url.endsWith('/game-changes.json')).length, 1);
});

// Scenario: The selected manifest has no optional game-changes index.
// Purpose: Preserve the legal empty-index release without probing for undeclared files.
// Given changeIndexPath is null, When the release is loaded, Then only the manifest and four core files are requested.
test('UnitT20_keeps_null_change_index_empty_without_extra_requests', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage();
  const calls = [];

  const result = await loadSharedRelease({ build: pack.build, fetchImpl: responseFetch(pack.responses, { calls }) });

  assert.equal(result.status, 'ready');
  assert.equal(result.domains.length, 4);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => !call.url.endsWith('/game-changes.json')));
});

// Scenario: The optional index path is pinned but its response differs from the manifest bytes.
// Purpose: Reject a corrupt optional domain as part of the release rather than returning a partial shared view.
// Given a tampered game-changes response, When the release is loaded, Then the client rejects the whole package.
test('UnitT30_rejects_tampered_optional_game_changes_domain', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage({ extraGameChanges: true });
  const fetchImpl = responseFetch(pack.responses, { alter: (path, bytes) => {
    if (!path.endsWith('/game-changes.json')) return null;
    return Buffer.from(bytes.toString('utf8').replace('darktide:test-release', 'darktide:test-releasf'));
  } });

  await assert.rejects(loadSharedRelease({ build: pack.build, fetchImpl }), /domain bytes do not match/i);
});
