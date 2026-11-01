import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import path from 'node:path';

import { FIXED_HISTORY_SOURCE } from '../scripts/content/contract-w14-history.mjs';
import {
  buildRetainedNameEvidenceMap,
  RETAINED_NAME_ROOT_ENV,
  retainedNameRootsFromEnvironment,
} from '../scripts/content/retained-name-evidence.mjs';

const markId = 'combataxe_p1_m1';
const familyId = 'combataxe_p1';
const templatePath = `scripts/settings/equipment/weapon_templates/${markId}.lua`;
const localizedName = '戰鬥斧 拉沙德 Mk III';
const hex = bytes => createHash('sha256').update(bytes).digest('hex');
const blobSha1 = bytes => createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');

function makeFixture({ historicalMarkId = markId, modsMarkId = markId, currentBytes = Buffer.from('return { fixture = true }\n') } = {}) {
  const pins = {
    history: { gameVersion: '1.13.1', sourcePath: 'content/history/1.13.1/source-content.json', sourceSha256: '' },
    mods: {
      repository: 'SyuanTsai/Warhammer-40-000-DARKTIDE-Mods', commit: '1'.repeat(40), path: 'fixture/MAP.json',
      blobSha1: '', byteLength: 0, sha256: '', nameSourceId: 'mods-release-1-13-x',
    },
    current: {
      repository: 'Aussiemon/Darktide-Source-Code', commit: '2'.repeat(40),
      gameReleaseId: 'darktide:1.13.4', gameVersion: '1.13.4',
    },
  };
  const historySourceBytes = Buffer.from(JSON.stringify({
    game_version: pins.history.gameVersion,
    package_kind: FIXED_HISTORY_SOURCE.packageKind,
    schema_version: FIXED_HISTORY_SOURCE.schemaVersion,
    weapons: [{ weapon_id: familyId }],
    marks: [{
      mark_id: historicalMarkId,
      weapon_id: familyId,
      name_zh_tw: localizedName,
      source_ids: [pins.mods.nameSourceId],
    }],
  }));
  pins.history.sourceSha256 = hex(historySourceBytes);

  const modsBytes = Buffer.from(JSON.stringify({ weapons: [{
    id: familyId,
    marks: [{
      id: modsMarkId,
      name: localizedName,
      template_file: templatePath,
      name_keys: { weapon_family_display_name: 'loc_weapon_family_combataxe' },
    }],
  }] }));
  pins.mods.blobSha1 = blobSha1(modsBytes);
  pins.mods.byteLength = modsBytes.byteLength;
  pins.mods.sha256 = hex(modsBytes);
  const modsBlob = {
    repository: pins.mods.repository,
    commit: pins.mods.commit,
    path: pins.mods.path,
    blobSha1: pins.mods.blobSha1,
    byteLength: pins.mods.byteLength,
    sha256: pins.mods.sha256,
    bytes: modsBytes,
  };
  const currentBlob = {
    repository: pins.current.repository,
    commit: pins.current.commit,
    path: templatePath,
    blobSha1: blobSha1(currentBytes),
    sha256: hex(currentBytes),
    byteLength: currentBytes.byteLength,
    bytes: currentBytes,
  };
  return {
    pins, historySourceBytes, modsBlob, currentBlob,
    currentPins: pins.current,
    readCurrentBlob: async requestedPath => requestedPath === templatePath ? currentBlob : null,
  };
}

test('UnitT10_ScenarioExactPinnedSources_PurposeBuildsImmutableIdentityMap', async () => {
  // Scenario: exact historical, Mods-map, and current-template bytes all match their pins.
  // Purpose: prove only verified exact mark identities produce retained-name evidence.
  const fixture = makeFixture();
  const map = await buildRetainedNameEvidenceMap(fixture);
  const evidence = map.evidenceByIdentity['darktide:1.13.4\0' + markId];
  assert.equal(evidence.name, localizedName);
  assert.equal(evidence.sourceGameVersion, '1.13.1');
  assert.equal(evidence.currentIdentity.blobSha1, fixture.currentBlob.blobSha1);
  assert.equal(map.coverage.verifiedNameMappings, 1);
  assert.equal(Object.isFrozen(map), true);
  assert.equal(Object.isFrozen(evidence.currentIdentity), true);
});

test('UnitT20_ScenarioChangedHistoricalBytes_PurposeRejectsUnpinnedNameSource', async () => {
  // Scenario: history JSON changes while the fixed history digest remains unchanged.
  // Purpose: prevent caller-supplied localized names from replacing the pinned source.
  const fixture = makeFixture();
  fixture.historySourceBytes = Buffer.from(fixture.historySourceBytes.toString('utf8').replace(localizedName, '偽造名稱'));
  await assert.rejects(buildRetainedNameEvidenceMap(fixture), /historical release/);
});

test('UnitT30_ScenarioChangedModsBlob_PurposeRejectsUnpinnedMarkName', async () => {
  // Scenario: the Mods map bytes are altered but metadata still claims the fixed blob hash.
  // Purpose: bind retained naming evidence to verified Git-blob and raw-byte digests.
  const fixture = makeFixture();
  fixture.modsBlob.bytes = Buffer.from(fixture.modsBlob.bytes.toString('utf8').replace(localizedName, '偽造名稱'));
  await assert.rejects(buildRetainedNameEvidenceMap(fixture), /Mods map bytes or Git identity/);
});

test('UnitT40_ScenarioDifferentMarkIds_PurposeDoesNotInferIdentityFromSimilarNames', async () => {
  // Scenario: history and Mods sources have the same display name but different exact IDs.
  // Purpose: ensure name equality never substitutes for a stable mark-ID match.
  const fixture = makeFixture({ historicalMarkId: 'other_mark_p1_m1', modsMarkId: markId });
  const map = await buildRetainedNameEvidenceMap(fixture);
  assert.equal(map.evidenceByIdentity['darktide:1.13.4\0other_mark_p1_m1'], undefined);
  assert.deepEqual(map.coverage.missingModsIdentity, [{ markId: 'other_mark_p1_m1', reason: 'pinned Mods map has no exact mark ID' }]);
});

test('UnitT50_ScenarioChangedCurrentTemplateBytes_PurposeRejectsForgedSourceBlob', async () => {
  // Scenario: current Source reader returns bytes inconsistent with its claimed blob identity.
  // Purpose: reject fabricated current identity, even when history and Mods match.
  const fixture = makeFixture();
  fixture.currentBlob.bytes = Buffer.from('return { forged = true }\n');
  await assert.rejects(buildRetainedNameEvidenceMap(fixture), /current Source template bytes or provenance/);
});

test('UnitT60_ScenarioCurrentCheckoutMismatch_PurposeRejectsWrongReleaseIdentity', async () => {
  // Scenario: all bytes are valid but the Source checkout claims a different release.
  // Purpose: keep retained names scoped to the fixed current game release.
  const fixture = makeFixture();
  fixture.currentPins = { ...fixture.currentPins, gameReleaseId: 'darktide:1.13.3' };
  await assert.rejects(buildRetainedNameEvidenceMap(fixture), /does not match the fixed game release/);
});

// Scenario: W07 runs inside the compiler and receives the two public pinned checkouts through CI environment variables.
// Purpose: Let the W08 and W09 call paths share the same verified evidence loader without accepting half-configured roots.
test('UnitT70_ScenarioCompletePinnedCheckoutEnvironment_PurposeResolvesRetainedNameRoots', () => {
  const roots = retainedNameRootsFromEnvironment({
    [RETAINED_NAME_ROOT_ENV.modsRoot]: '.tmp/retained-mods',
    [RETAINED_NAME_ROOT_ENV.sourceRoot]: '.tmp/retained-source',
    [RETAINED_NAME_ROOT_ENV.sourceBytesRoot]: '.tmp/retained-source-bytes',
  });
  assert.deepEqual(roots, {
    modsRoot: path.resolve('.tmp/retained-mods'),
    sourceRoot: path.resolve('.tmp/retained-source'),
    sourceBytesRoot: path.resolve('.tmp/retained-source-bytes'),
  });
});

// Scenario: CI has not configured retained-name inputs because no fixed checkouts are available.
// Purpose: Preserve ordinary W07 authoring behavior when no retained names are present.
test('UnitT80_ScenarioAbsentPinnedCheckoutEnvironment_PurposeKeepsRootsOptional', () => {
  assert.equal(retainedNameRootsFromEnvironment({}), null);
});

// Scenario: Only one public checkout or an orphaned raw-bytes root is configured.
// Purpose: Fail closed rather than silently skipping exact source-byte verification.
test('UnitT90_ScenarioPartialPinnedCheckoutEnvironment_PurposeRejectsIncompleteRoots', () => {
  assert.throws(() => retainedNameRootsFromEnvironment({
    [RETAINED_NAME_ROOT_ENV.modsRoot]: '.tmp/retained-mods',
  }), /must be configured together/u);
  assert.throws(() => retainedNameRootsFromEnvironment({
    [RETAINED_NAME_ROOT_ENV.sourceBytesRoot]: '.tmp/retained-source-bytes',
  }), /must be configured together/u);
});
