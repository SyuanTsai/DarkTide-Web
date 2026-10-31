import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeSharedPackage } from './w11-shared-client.fixture.mjs';
import { assertExactDataRequestPaths, assertExactRequestedPaths, readVerifiedCoreDomains } from '../scripts/shared-browser-smoke.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function materializePackage(fixture) {
  const root = await mkdtemp(path.join(tmpdir(), 'shared-browser-smoke-'));
  for (const [urlPath, bytes] of fixture.responses) {
    const filePath = path.join(root, ...urlPath.slice(1).split('/'));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);
  }
  return root;
}

// Scenario: A published manifest declares a game-changes index beside the existing core domains.
// Purpose: Prove the smoke verifier includes and verifies only that exact declared file.
test('UnitT10_shared_smoke_includes_the_manifest_declared_game_changes_file', async () => {
  const fixture = makeSharedPackage({ extraGameChanges: true });
  const root = await materializePackage(fixture);
  try {
    const result = await readVerifiedCoreDomains(root, fixture.build);
    assert.ok(result.domains.some(domain => domain.kind === 'game-changes'));
    const gameChangesPath = `/data/${fixture.manifest.dataRevision}/game-changes.json`;
    assert.ok(result.requestedPaths.includes(gameChangesPath));
    assertExactRequestedPaths(result.requestedPaths, [...fixture.responses.keys()]);
    assert.throws(() => assertExactRequestedPaths([...result.requestedPaths, '/legacy/content.json'], result.requestedPaths),
      /manifest-declared game-changes index/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Scenario: A manifest lists a game-changes file but leaves changeIndexPath null.
// Purpose: Keep unselected files outside the request set and reject any request for them as extra.
test('UnitT20_shared_smoke_rejects_unselected_game_changes_requests', async () => {
  const fixture = makeSharedPackage({ unselectedGameChanges: true });
  const root = await materializePackage(fixture);
  try {
    const result = await readVerifiedCoreDomains(root, fixture.build);
    const unselectedPath = `/data/${fixture.manifest.dataRevision}/game-changes.json`;
    assert.equal(result.domains.some(domain => domain.kind === 'game-changes'), false);
    assert.equal(result.requestedPaths.includes(unselectedPath), false);
    assert.throws(() => assertExactRequestedPaths([...result.requestedPaths, unselectedPath], result.requestedPaths),
      /manifest-declared game-changes index/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Scenario: changeIndexPath is unknown or points at a listed non-game-changes file.
// Purpose: Preserve the manifest contract's fail-closed path and kind checks in the smoke verifier.
test('UnitT30_shared_smoke_rejects_unknown_or_wrong_kind_change_indexes', async () => {
  for (const [changeIndexPath, expected] of [
    ['missing-game-changes.json', /changeIndexPath must reference a listed file/u],
    ['skills.json', /changeIndexPath must identify a game-changes file/u],
  ]) {
    const fixture = makeSharedPackage({ extraGameChanges: true });
    const root = await materializePackage(fixture);
    try {
      const manifest = { ...fixture.manifest, changeIndexPath };
      const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
      const manifestPath = path.join(root, ...fixture.pointer.manifest_path.slice(1).split('/'));
      await writeFile(manifestPath, manifestBytes);
      const verification = {
        ...fixture.build,
        game_releases: fixture.build.game_releases.map(pointer => pointer.manifest_path === fixture.pointer.manifest_path
          ? { ...pointer, manifest_sha256: sha256(manifestBytes) }
          : pointer),
      };
      await assert.rejects(readVerifiedCoreDomains(root, verification), expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

// Scenario: The declared game-changes file has a mismatched metadata pin or changed raw bytes.
// Purpose: Require the same exact manifest, size, and digest checks as other requested shared domains.
test('UnitT40_shared_smoke_checks_game_changes_size_and_digest_pins', async () => {
  const fixture = makeSharedPackage({ extraGameChanges: true });
  const root = await materializePackage(fixture);
  const gameChangesPath = `/data/${fixture.manifest.dataRevision}/game-changes.json`;
  const gameChangesPin = fixture.build.shared_files.find(file => file.path === gameChangesPath);
  try {
    assert.ok(gameChangesPin);
    for (const pin of [
      { ...gameChangesPin, size_bytes: gameChangesPin.size_bytes + 1 },
      { ...gameChangesPin, sha256: '0'.repeat(64) },
    ]) {
      const verification = {
        ...fixture.build,
        shared_files: fixture.build.shared_files.map(file => file.path === gameChangesPath ? pin : file),
      };
      await assert.rejects(readVerifiedCoreDomains(root, verification), /game-changes pinned (?:size|digest) matches the manifest/u);
    }

    const rawPath = path.join(root, ...gameChangesPath.slice(1).split('/'));
    await writeFile(rawPath, Buffer.concat([await readFile(rawPath), Buffer.from(' ', 'utf8')]));
    await assert.rejects(readVerifiedCoreDomains(root, fixture.build), /game-changes raw byte length matches the manifest/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Scenario: The browser smoke observes current and fixed retained-version data requests together.
// Purpose: Reject requests for any undeclared file, including a second data revision that must not be hidden by filtering.
test('UnitT50_shared_smoke_rejects_unknown_data_revisions_and_unlisted_retained_files', () => {
  const currentRevision = 'a'.repeat(64);
  const retainedRevision = 'b'.repeat(64);
  const currentPaths = [
    `/data/${currentRevision}/manifest.json`,
    `/data/${currentRevision}/domains/skills.json`,
  ];
  const retainedPaths = [
    `/data/${retainedRevision}/catalog.json`,
    `/data/${retainedRevision}/trees/psyker.json`,
    `/data/${retainedRevision}/assets/psyker-icon.webp`,
  ];
  const expected = [...currentPaths, ...retainedPaths];
  assertExactDataRequestPaths(expected, currentPaths, retainedPaths);
  assert.throws(() => assertExactDataRequestPaths([
    ...expected, `/data/${'c'.repeat(64)}/domains/skills.json`,
  ], currentPaths, retainedPaths), /current pinned data/u,
  'an unexpected data revision cannot be hidden by the current-revision collection');
  assert.throws(() => assertExactDataRequestPaths([
    ...expected, `/data/${retainedRevision}/details/skills/psyker/unrequested.json`,
  ], currentPaths, retainedPaths), /current pinned data/u,
  'a file outside the retained catalog, trees, and requested assets is rejected');
});
