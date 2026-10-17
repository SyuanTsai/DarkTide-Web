import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import test from 'node:test';

import {
  collectJsonMappingEntries,
  FIXED_PINS,
  hashJsonValue,
  REPO_ROOT,
  W03_DOC_ROOT,
  validateMappingEntry,
  validateCoverageSummary,
  validateCoverageManifestBindings,
  validateIndexedFileList,
  validateScopeBindings,
  summarizeCurrentRepresentativeCandidate,
  validateCurrentRepresentativeCoverage,
  verifyEntryFragment,
  verifyLedgerBundle,
} from '../scripts/content/contract-w03-ledger.mjs';

const SOURCE_COMMIT = 'ba6c148f3c2768ca3ce20d846a12e56e2f433f3e';
const SOURCE_BLOB = 'b6bf7f855140e84803456f178c1cd23460ce90c4';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function registryEntry(overrides = {}) {
  const source = {
    repoId: 'source-code',
    commit: SOURCE_COMMIT,
    path: 'scripts/settings/equipment/weapon_templates/weapon_templates.lua',
    gitBlobOid: SOURCE_BLOB,
  };
  return {
    schemaVersion: 'w03.mapping-entry.v1',
    entryId: 'code-registry-chainsword-2h-p1-m1',
    source,
    sourceEntityKey: { kind: 'registry-key', value: 'chainsword_2h_p1_m1', reason: null },
    selector: { kind: 'line-range', locator: 'L61-L61', startByte: 0, endByte: 12 },
    fragment: { normalization: 'raw', sha256: '1'.repeat(64) },
    owner: 'source',
    target: {
      repoId: null,
      commit: null,
      path: null,
      fieldPath: 'weapon.templateKey',
      gameReleaseId: null,
      gameReleaseIdNotApplicableReason: 'registry-key-does-not-prove-game-release',
      recordId: null,
      recordIdNotApplicableReason: 'canonical-source-record-id-not-assigned-for-registry-candidate',
      kind: 'source-record',
      status: 'not-generated',
      reason: 'candidate identity is known but player availability and full-build compatibility are unverified',
    },
    scope: {
      gameReleaseId: null,
      releaseScope: 'registry-snapshot',
      reason: 'fixed code registry snapshot does not prove a game release',
    },
    mappingStatus: 'planned',
    intendedDisposition: 'migrated',
    actualOutcome: { status: 'not-started' },
    review: { carryForward: 'not-assumed', basisRefs: ['W03 code registry inventory'], state: 'pending' },
    linkDisposition: 'candidate-only-no-current-availability-proof',
    rollback: { ...source },
    ...overrides,
  };
}

// Scenario: a code-registry row has a concrete source entity and an uncreated, release-limited Source target.
// Purpose: keep planned identity mapping distinct from a generated or approved game record.
test('UnitT10_registry-candidate-entry-requires-explicit-owner-scope-and-uncreated-target', () => {
  assert.deepEqual(validateMappingEntry(registryEntry()), []);

  const wrongOwner = registryEntry({ owner: 'web' });
  assert.ok(validateMappingEntry(wrongOwner).some(item => item.code === 'owner-target-kind'));

  const falselyCreated = registryEntry({ target: { ...registryEntry().target, status: 'existing' } });
  assert.ok(validateMappingEntry(falselyCreated).some(item => item.code === 'target-locator'));
});

// Scenario: a row omits or changes its versioned shared-entry contract marker.
// Purpose: fail closed when A and B ledgers or a future importer disagree on the row schema.
test('UnitT11_mapping-entry-requires-the-shared-schema-version', () => {
  assert.ok(validateMappingEntry(registryEntry({ schemaVersion: undefined })).some(item => item.code === 'entry-schema-version'));
  assert.ok(validateMappingEntry(registryEntry({ schemaVersion: 'w03.mapping-entry.v2' })).some(item => item.code === 'entry-schema-version'));
});

// Scenario: a target has a null stable game or record ID without an explicit reason.
// Purpose: prevent unknown identities from silently becoming blank fields or invented canonical IDs.
test('UnitT20_null-target-identities-require-separate-reasons', () => {
  const target = { ...registryEntry().target, recordIdNotApplicableReason: '' };
  assert.ok(validateMappingEntry(registryEntry({ target })).some(item => item.code === 'target-record-reason'));

  const gameTarget = { ...registryEntry().target, gameReleaseIdNotApplicableReason: '' };
  assert.ok(validateMappingEntry(registryEntry({ target: gameTarget })).some(item => item.code === 'target-game-release-reason'));
});

// Scenario: a pointer selects a JSON value containing escaped quotes and non-ASCII text.
// Purpose: hash the parsed value's JSON.stringify UTF-8 representation without mislabeling it as a raw source-byte range.
test('UnitT30_json-value-hash-is-explicitly-not-a-raw-byte-hash', () => {
  const bytes = Buffer.from('{"records":[{"name":"顱腦\\n崩裂","value":40}]}', 'utf8');
  const selected = { name: '顱腦\n崩裂', value: 40 };
  const entry = registryEntry({
    selector: { kind: 'json-pointer', locator: '/records/0' },
    fragment: { serialization: 'json-value-json-stringify', sha256: hashJsonValue(selected) },
  });

  assert.equal(verifyEntryFragment(entry, bytes).valid, true);
  assert.notEqual(hashJsonValue(selected), sha256(bytes));
  assert.equal(verifyEntryFragment({ ...entry, fragment: { ...entry.fragment, sha256: 'f'.repeat(64) } }, bytes).valid, false);
});

// Scenario: a JSON pointer names an inherited property or an own property named __proto__.
// Purpose: resolve only keys present in the parsed JSON object while preserving legitimate JSON keys.
test('UnitT31_json-pointer-requires-own-properties-and-allows-own-proto-key', () => {
  const missingBytes = Buffer.from('{"real":1}', 'utf8');
  const inheritedEntry = registryEntry({
    selector: { kind: 'json-pointer', locator: '/__proto__' },
    fragment: { serialization: 'json-value-json-stringify', sha256: hashJsonValue({}) },
  });
  assert.equal(verifyEntryFragment(inheritedEntry, missingBytes).valid, false);

  const ownBytes = Buffer.from('{"__proto__":{"own":1},"real":1}', 'utf8');
  const ownEntry = registryEntry({
    selector: { kind: 'json-pointer', locator: '/__proto__' },
    fragment: { serialization: 'json-value-json-stringify', sha256: hashJsonValue({ own: 1 }) },
  });
  assert.equal(verifyEntryFragment(ownEntry, ownBytes).valid, true);

  const regularEntry = registryEntry({
    selector: { kind: 'json-pointer', locator: '/real' },
    fragment: { serialization: 'json-value-json-stringify', sha256: hashJsonValue(1) },
  });
  assert.equal(verifyEntryFragment(regularEntry, missingBytes).valid, true);
});

// Scenario: fixed published records contain both entity IDs and references, duplicate skills, and source citations.
// Purpose: keep each row attached to its owning identity and preserve occurrence context while assigning provenance to Source.
test('UnitT60_published-identities-distinguish-record-ids-from-weapon-refs-and-preserve-duplicates', () => {
  const commit = FIXED_PINS.web.commit;
  const sourcePath = 'content/published/content.json';
  const fixedBlobOid = '37c4a2d52c3d186ff233ed35b15dcb21496faa60';
  const headBlobOid = execFileSync('git', ['rev-parse', `HEAD:${sourcePath}`], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  assert.equal(headBlobOid, fixedBlobOid);
  const blobOid = fixedBlobOid;
  const bytes = execFileSync('git', ['cat-file', 'blob', blobOid], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
  const rows = collectJsonMappingEntries({ repoId: 'web', commit, sourcePath, blobOid, bytes });
  const byPointer = new Map(rows.map(row => [row.selector.locator, row]));

  assert.equal(byPointer.get('/variants/0/weapon_id').sourceEntityKey.value, 'weapon_trait_bespoke_arc_rifle_p1_ammo_from_reserve_on_crit');
  assert.equal(byPointer.get('/variants/0/tier_claims/0/claims/0/value').sourceEntityKey.value, 'bullets-transferred');
  assert.match(byPointer.get('/variants/0/tier_claims/0/claims/0/value').selector.locator, /^\/variants\/0\/tier_claims\/0\/claims\/0\//u);
  assert.equal(byPointer.get('/marks/0/weapon_id').sourceEntityKey.value, 'arc_rifle_p1_m1');
  assert.equal(byPointer.get('/sources/0/label').owner, 'source');
  assert.equal(byPointer.get('/sources/0/url').owner, 'source');

  const duplicatePointers = [88, 266, 564].map(index => `/skills/${index}/skill_id`);
  const duplicates = duplicatePointers.map(pointer => byPointer.get(pointer));
  assert.ok(duplicates.every(Boolean));
  assert.deepEqual(duplicates.map(row => row.sourceEntityKey.value), Array(3).fill('base_melee_damage_node_buff_medium_1'));
  assert.equal(new Set(duplicates.map(row => row.selector.locator)).size, 3);
});

// Scenario: a Source record payload contains a weapon mark reference and technical claim/stat references.
// Purpose: preserve the canonical enclosing Source record ID instead of promoting payload reference IDs to record identity.
test('UnitT61_source-record-payload-keeps-canonical-record-identity', () => {
  const bytes = Buffer.from(JSON.stringify({ records: [{
    recordId: 'darktide:weapon:chainaxe:p1-m1',
    kind: 'weapon',
    payload: { familyId: 'chainaxe_p1', markId: 'chainaxe_p1_m1', templateKey: 'chainaxe_p1_m1',
      statRefs: ['darktide:stat-definition:chainaxe-p1-m1-default-light-attack-power-table'],
      claimRefs: ['darktide:claim:chainaxe:p1-m1-default-light-attack-power-comparison-60'] },
  }] }), 'utf8');
  const rows = collectJsonMappingEntries({ repoId: 'source', commit: FIXED_PINS.sourceData.commit,
    sourcePath: 'content/authoring/w01-real-representative-candidate.json', blobOid: 'c'.repeat(40), bytes });
  const expectedId = 'darktide:weapon:chainaxe:p1-m1';
  for (const pointer of ['/records/0/payload/familyId', '/records/0/payload/markId', '/records/0/payload/statRefs/0', '/records/0/payload/claimRefs/0']) {
    const row = rows.find(item => item.selector.locator === pointer);
    assert.ok(row, `missing mapped field ${pointer}`);
    assert.equal(row.sourceEntityKey.value, expectedId);
    assert.equal(row.target.recordId, expectedId);
  }
});

// Scenario: the pinned representative Source fixture has sourceRefs nested under a canonical record.
// Purpose: preserve the enclosing record identity for every field in the Source records subtree, including reference IDs.
test('UnitT62_source-record-sourceRefs-keep-canonical-record-identity', () => {
  const sourcePath = 'content/fixtures/v2/representative-source.json';
  const snapshotPath = `content/contracts/source-v2-snapshot/${sourcePath}`;
  const blobOid = execFileSync('git', ['rev-parse', `HEAD:${snapshotPath}`], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const bytes = execFileSync('git', ['cat-file', 'blob', blobOid], { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(sha256(bytes), '849aaa1adba8d73a8c3963de70b5af5e8d4aa9c4c55b9d69c0f74152c79b7b75');

  const fixture = JSON.parse(bytes.toString('utf8'));
  const index = fixture.records.findIndex(record => Array.isArray(record.sourceRefs) && record.sourceRefs.length > 0);
  assert.notEqual(index, -1);
  const record = fixture.records[index];
  const rows = collectJsonMappingEntries({ repoId: 'source', commit: FIXED_PINS.source.commit,
    sourcePath, blobOid, bytes });
  const pointer = `/records/${index}/sourceRefs/0/sourceId`;
  const row = rows.find(item => item.selector.locator === pointer);
  assert.ok(row, `missing mapped Source reference field ${pointer}`);
  assert.equal(row.sourceEntityKey.value, record.recordId);
  assert.equal(row.target.recordId, record.recordId);
  assert.notEqual(record.sourceRefs[0].sourceId, record.recordId);
});

// Scenario: a fixed Extension player guide mixes displayed paragraphs, Source references, and review-state fields.
// Purpose: classify by explicit domain path and field semantics, never by text script or leaf array index.
test('UnitT70_player-guide-paragraphs-and-source-links-have-distinct-owners', () => {
  const bytes = Buffer.from(JSON.stringify({ records: [{
    sourceRefs: ['source:guide'],
    sections: [{
      heading: '範例標題',
      paragraphs: ['範例說明'],
      claims: [{ claim_id: 'claim:guide', value: '1', unit: 'count' }],
      review: { approved: false },
    }],
  }] }), 'utf8');
  const rows = collectJsonMappingEntries({
    repoId: 'extension',
    commit: FIXED_PINS.extensionInputs.commit,
    sourcePath: 'data/v1/mechanics/player-guides.json',
    blobOid: 'a'.repeat(40),
    bytes,
  });
  const byPointer = new Map(rows.map(row => [row.selector.locator, row]));

  assert.equal(byPointer.get('/records/0/sections/0/heading').owner, 'web');
  assert.equal(byPointer.get('/records/0/sections/0/paragraphs/0').owner, 'web');
  assert.equal(byPointer.get('/records/0/sourceRefs/0').owner, 'source');
  assert.equal(byPointer.get('/records/0/sections/0/claims/0/value').owner, 'source');
  assert.equal(byPointer.get('/records/0/sections/0/review/approved').owner, 'extension');
});

// Scenario: a W01 candidate document does not carry a gameReleaseId at the root.
// Purpose: keep a missing release identifier explicit instead of manufacturing the current candidate release.
test('UnitT80_candidate-without-explicit-release-remains-unversioned', () => {
  const rows = collectJsonMappingEntries({
    repoId: 'source',
    commit: FIXED_PINS.sourceData.commit,
    sourcePath: 'content/authoring/w01-real-claim-candidate.json',
    blobOid: 'b'.repeat(40),
    bytes: Buffer.from('{"records":[{"recordId":"claim:test","payload":{"value":0}}]}', 'utf8'),
  });
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => row.scope.gameReleaseId === null && row.scope.releaseScope === 'release-unspecified'));
  assert.ok(rows.every(row => /explicit gameReleaseId/u.test(row.scope.reason)));
});

// Scenario: a snippet is bound by an exact UTF-8 byte range and a whole file is bound by its Git blob object ID.
// Purpose: preserve the different hash domains and reject offsets or object IDs that do not match the fixed bytes.
test('UnitT40_byte-ranges-and-whole-file-git-blobs-are-verified-separately', () => {
  const bytes = Buffer.from('第1行\r\nkey = true\n', 'utf8');
  const startByte = Buffer.byteLength('第1行\r\n', 'utf8');
  const selected = bytes.subarray(startByte, bytes.length);
  const rangeEntry = registryEntry({
    selector: { kind: 'line-range', locator: 'L2-L2', startByte, endByte: bytes.length },
    fragment: { normalization: 'raw', sha256: sha256(selected) },
  });
  assert.equal(verifyEntryFragment(rangeEntry, bytes).valid, true);

  const blobOid = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`, 'ascii')).update(bytes).digest('hex');
  const fileEntry = registryEntry({
    selector: { kind: 'file', locator: 'file' },
    source: { ...registryEntry().source, gitBlobOid: blobOid },
    fragment: { normalization: 'git-blob', gitBlobOid: blobOid },
    rollback: { ...registryEntry().source, gitBlobOid: blobOid },
  });
  assert.equal(verifyEntryFragment(fileEntry, bytes).valid, true);
  assert.equal(verifyEntryFragment({ ...fileEntry, fragment: { ...fileEntry.fragment, gitBlobOid: '0'.repeat(40) } }, bytes).valid, false);
});

// Scenario: an index names one shard whose exact canonical JSON bytes, entry count, and SHA are supplied.
// Purpose: ensure a ledger can be verified offline and detects missing, extra, or byte-changed shards.
test('UnitT50_ledger-index-validates-exact-shard-bytes-counts-and-references', () => {
  const rows = [registryEntry()];
  const contentBytes = Buffer.from(`${JSON.stringify({ entrySchemaVersion: 'w03.mapping-entry.v1', groupId: 'code-registry', entries: rows })}\n`, 'utf8');
  const compressedBytes = gzipSync(contentBytes, { level: 9, mtime: 0 });
  const shardBytes = Buffer.from(`${JSON.stringify({ encoding: 'gzip-base64', data: compressedBytes.toString('base64') })}\n`, 'ascii');
  const ledger = {
    schemaVersion: 1,
    entrySchemaVersion: 'w03.mapping-entry.v1',
    groups: { 'code-registry': { entryCount: 1, shardPaths: ['extension/code-registry-0001.json'] } },
    shards: [{ path: 'extension/code-registry-0001.json', groupId: 'code-registry', entryCount: 1, encoding: 'gzip-base64',
      containerBytes: shardBytes.length, containerSha256: sha256(shardBytes),
      compressedBytes: compressedBytes.length, compressedSha256: sha256(compressedBytes),
      contentBytes: contentBytes.length, contentSha256: sha256(contentBytes) }],
  };

  assert.deepEqual(verifyLedgerBundle(ledger, new Map([[ledger.shards[0].path, shardBytes]])), []);
  assert.ok(verifyLedgerBundle(ledger, new Map([[ledger.shards[0].path, Buffer.from(shardBytes.subarray(0, -1))]]))
    .some(item => item.code === 'shard-container-integrity'));
  assert.ok(verifyLedgerBundle(ledger, new Map()).some(item => item.code === 'shard-missing'));
  assert.deepEqual(gzipSync(contentBytes, { level: 9, mtime: 0 }), compressedBytes);
  assert.ok(verifyLedgerBundle({ ...ledger, shards: [] }, new Map()).some(item => item.code === 'ledger-empty'));
});

// Scenario: the offline indexes and reports must agree on actual rows, fixed contract refs, and complete file membership.
// Purpose: reject empty-but-well-shaped ledgers, stale aggregate coverage, missing provenance, or unindexed output files.
test('UnitT90_offline-coherence-rejects-empty-incomplete-or-extra-output', () => {
  const coverage = JSON.parse(readFileSync(path.join(W03_DOC_ROOT, 'coverage.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(path.join(W03_DOC_ROOT, 'scope-manifest.json'), 'utf8'));
  const summary = Object.fromEntries(['totalEntries', 'byOwner', 'byTargetStatus', 'byReleaseScope', 'sourcePathEntryCounts', 'sourceArtifactEntries', 'groups']
    .map(field => [field, coverage[field]]));
  assert.deepEqual(validateCoverageSummary(coverage, summary), []);
  assert.deepEqual(validateCoverageManifestBindings(coverage, manifest), []);
  assert.ok(validateCoverageSummary({ ...coverage, totalEntries: 999999 }, summary).some(item => item.code === 'coverage-mismatch'));

  const missingGroup = { ...coverage, groups: { ...coverage.groups } };
  delete missingGroup.groups['web-published'];
  assert.ok(validateCoverageSummary(missingGroup, { ...summary, groups: missingGroup.groups })
    .some(item => item.code === 'coverage-required-groups'));
  const missingInputPath = { ...coverage, sourcePathEntryCounts: { ...coverage.sourcePathEntryCounts } };
  delete missingInputPath.sourcePathEntryCounts['extension/data/v1/catalog.json'];
  assert.ok(validateCoverageSummary(missingInputPath, { ...summary, sourcePathEntryCounts: missingInputPath.sourcePathEntryCounts })
    .some(item => item.code === 'coverage-required-source-paths'));
  assert.ok(validateCoverageManifestBindings({ ...coverage, publishedCounts: { ...coverage.publishedCounts, skills: 999 } }, manifest)
    .some(item => item.code === 'coverage-published-snapshot'));
  assert.ok(validateCoverageManifestBindings(coverage, { ...manifest, inputArtifacts: manifest.inputArtifacts.slice(1) })
    .some(item => item.code === 'scope-input-artifact-set'));
  const badInputBlob = structuredClone(manifest);
  badInputBlob.extensionInputProvenance.verifiedInputs[0].gitBlobOid = 'f'.repeat(40);
  assert.ok(validateCoverageManifestBindings(coverage, badInputBlob)
    .some(item => item.code === 'scope-extension-input-row-binding'));

  const aLedger = { shards: [{ path: 'extension/a-0001.json' }] };
  const modsIndex = { shards: [{ path: 'mods/shards/m-0001.json' }] };
  const expectedFiles = ['README.md', 'coverage.json', 'mapping-ledger.json', 'scope-manifest.json',
    'mods/README.md', 'mods/mapping-ledger.json', 'extension/a-0001.json', 'mods/shards/m-0001.json'];
  assert.deepEqual(validateIndexedFileList(aLedger, modsIndex, expectedFiles), []);
  assert.ok(validateIndexedFileList(aLedger, modsIndex, [...expectedFiles, 'extension/UNLISTED-negative.json'])
    .some(item => item.code === 'file-set-extra'));
  assert.ok(validateScopeBindings({}).some(item => item.code === 'scope-shape'));
  assert.ok(verifyLedgerBundle({ schemaVersion: 1, entrySchemaVersion: 'w03.mapping-entry.v1', groups: {}, shards: [] }, new Map())
    .some(item => item.code === 'ledger-empty'));
});

// Scenario: a representative candidate has explicit known zero, unknown, and NOT_IMPORTED coverage states.
// Purpose: report the three states separately and keep scope limited to the cited W01 candidate.
test('UnitT91_representative-coverage-separates-known-zero-unknown-and-not-imported', () => {
  const document = { gameReleaseId: 'fixture:r1', gameVersion: '0.0.0', records: [
    { recordId: 'claim:zero', kind: 'claim', payload: { value: { status: 'known', decimal: '0.000', unit: 'count' } } },
    { recordId: 'claim:unknown', kind: 'claim', payload: { value: { status: 'unknown', reasonCode: 'NOT_VERIFIED' } } },
    { recordId: 'weapon:partial', kind: 'weapon', payload: { dataCoverage: { status: 'partial', missing: [
      { field: 'action/profile override resolution', reasonCode: 'NOT_IMPORTED' },
    ] } } },
  ] };
  const artifact = { repoId: 'source', commit: FIXED_PINS.sourceData.commit,
    path: 'candidate.json', gitBlobOid: 'a'.repeat(40), byteLength: 10, rawSha256: 'b'.repeat(64) };
  const summary = summarizeCurrentRepresentativeCandidate(document, artifact);
  assert.equal(summary.valueCoverage.knownCount, 1);
  assert.equal(summary.valueCoverage.knownZeroCount, 1);
  assert.deepEqual(summary.valueCoverage.knownZeroFields.map(item => item.fieldPath), ['/records/0/payload/value']);
  assert.equal(summary.valueCoverage.unknownCount, 1);
  assert.equal(summary.valueCoverage.partialRecordCount, 1);
  assert.equal(summary.valueCoverage.notImportedCount, 1);
  assert.equal(summary.valueCoverage.unknownFields[0].reasonCode, 'NOT_VERIFIED');
  assert.equal(summary.valueCoverage.notImported[0].reasonCode, 'NOT_IMPORTED');
  assert.match(summary.requiredFields.semanticRequiredFields, /not-revalidated-in-W03/u);
});

function readW03GroupRows(groupId) {
  const ledger = JSON.parse(readFileSync(path.join(W03_DOC_ROOT, 'mapping-ledger.json'), 'utf8'));
  const group = ledger.groups[groupId];
  assert.ok(group, `missing checked group ${groupId}`);
  const entries = [];
  for (const shardPath of group.shardPaths) {
    const bytes = readFileSync(path.join(W03_DOC_ROOT, ...shardPath.split('/')));
    const envelope = JSON.parse(bytes.toString('utf8'));
    assert.equal(envelope.encoding, 'gzip-base64');
    const shard = JSON.parse(gunzipSync(Buffer.from(envelope.data, 'base64')).toString('utf8'));
    entries.push(...shard.entries);
  }
  return entries;
}

// Scenario: fixed Extension static data and native rules contain player prose, game facts, and UI bindings in adjacent arrays.
// Purpose: classify by root and ancestor field so array index keys do not turn text into Source data or DOM bindings into game facts.
test('UnitT92_static-extension-array-owners-follow-root-and-ancestor-field', () => {
  const staticRows = readW03GroupRows('extension-runtime-static-data');
  const data = new Map(staticRows.filter(row => row.source.path === 'extension/data.js').map(row => [row.selector.locator, row]));
  for (const pointer of ['/skill/fragments/0/0', '/skill/fragments/0/1', '/skill/details/0', '/blessing/details/0',
    '/curioEffects/0/suffix', '/weapons/0/perkEffects/0']) assert.equal(data.get(pointer)?.owner, 'web', pointer);
  for (const pointer of ['/classes/0/path', '/weapons/0/hashes/0', '/weapons/0/iconPath', '/skill/path', '/blessing/weaponPath']) {
    assert.equal(data.get(pointer)?.owner, 'extension', pointer);
  }
  for (const pointer of ['/version', '/revision', '/skill/id', '/blessing/tierValues/0', '/blessing/duration',
    '/skill/source', '/blessing/source', '/blessing/id']) {
    assert.equal(data.get(pointer)?.owner, 'source', pointer);
  }
  assert.ok(staticRows.filter(row => row.source.path === 'extension/data.js' && /\/perkEffects\/\d+$/u.test(row.selector.locator))
    .every(row => row.owner === 'web'));
  const nativeRows = readW03GroupRows('extension-runtime-native-rules');
  assert.ok(nativeRows.filter(row => row.selector.locator.includes('/domShape/')).every(row => row.owner === 'extension'));
  assert.equal(nativeRows.find(row => row.selector.locator === '/0/domShape/0')?.owner, 'extension');
  assert.equal(nativeRows.find(row => row.selector.locator === '/0/runs/0/english')?.owner, 'web');
  assert.equal(nativeRows.find(row => row.selector.locator === '/0/runs/0/kind')?.owner, 'extension');
  assert.equal(nativeRows.find(row => row.selector.locator === '/0/identity/id')?.owner, 'source');
});

// Scenario: the representative candidate is a fixed W01 1.13.2 snapshot with explicit release identity.
// Purpose: reject a summary that keeps the pinned bytes but changes its claimed game release or version.
test('UnitT93_representative-coverage-binds-fixed-release-and-version', () => {
  const coverage = JSON.parse(readFileSync(path.join(W03_DOC_ROOT, 'coverage.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(path.join(W03_DOC_ROOT, 'scope-manifest.json'), 'utf8'));
  const summary = coverage.currentRepresentativeCoverage;
  assert.deepEqual(validateCurrentRepresentativeCoverage(summary, manifest), []);

  const wrongVersion = structuredClone(summary);
  wrongVersion.candidate.gameVersion = '9.99.99';
  assert.ok(validateCurrentRepresentativeCoverage(wrongVersion, manifest)
    .some(item => item.code === 'representative-coverage-source'), 'changed gameVersion must be rejected');

  const wrongRelease = structuredClone(summary);
  wrongRelease.candidate.gameReleaseId = 'darktide:9.99.99';
  assert.ok(validateCurrentRepresentativeCoverage(wrongRelease, manifest)
    .some(item => item.code === 'representative-coverage-source'), 'changed gameReleaseId must be rejected');
});
