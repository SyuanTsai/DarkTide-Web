import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import * as w14LedgerContract from '../scripts/content/contract-w14-ledger.mjs';
import * as w14OutcomeBuilder from '../scripts/content/build-w14-outcomes.mjs';

import {
  buildW14Overlay,
  createW14OverlayEntry,
  createW14CompletionVerifier,
  validateW14OverlayShard,
  verifyW14CompletionEvidence,
  verifyW03LedgerShard,
  walkW03ModsLedgerShards,
  classifyW14CurrentFieldEvidence,
} from '../scripts/content/contract-w14-ledger.mjs';

function sourceEntry(entryId = 'w03-source-row-1') {
  const source = {
    repoId: 'source',
    commit: '1'.repeat(40),
    path: 'content/authoring/v2/w07-weapons.json',
    gitBlobOid: '2'.repeat(40),
  };
  return {
    schemaVersion: 'w03.mapping-entry.v1',
    entryId,
    source,
    sourceEntityKey: { kind: 'stable-id', value: 'darktide:weapon:test', reason: null },
    selector: { kind: 'json-pointer', locator: '/records/0/payload/name' },
    fragment: { serialization: 'json-value-json-stringify', sha256: '3'.repeat(64) },
    owner: 'source',
    target: {
      repoId: 'source', commit: '1'.repeat(40), path: 'content/authoring/v2/w07-weapons.json',
      fieldPath: '/records/0/payload/name', gameReleaseId: 'darktide:1.13.2', recordId: 'darktide:weapon:test',
      kind: 'source-record', status: 'existing',
    },
    scope: { gameReleaseId: 'darktide:1.13.2', releaseScope: 'current-snapshot-candidate' },
    mappingStatus: 'planned', intendedDisposition: 'migrated', actualOutcome: { status: 'not-started' },
    review: { carryForward: 'not-assumed', basisRefs: ['W03 fixed input; approval is not inherited'], state: 'pending' },
    linkDisposition: 'candidate-only',
    rollback: source,
  };
}

function pendingDecision() {
  return {
    disposition: 'migrated',
    actualOutcome: { status: 'gap', reason: 'current target needs a field-level mapping' },
    review: { state: 'pending', basisRefs: ['W14 field-level review required'], carryForward: false },
    destination: null,
  };
}

// Scenario: a W14 row is derived from a frozen W03 mapping row.
// Purpose: preserve the source identity and rollback pointer while recording a non-inherited W14 result.
// Given one valid W03 row; when creating its W14 overlay entry; then all frozen bindings remain exact.
test('UnitT10_overlay-entry-retains-frozen-source-target-and-rollback-bindings', () => {
  const base = sourceEntry();
  const overlay = createW14OverlayEntry(base, pendingDecision());

  assert.equal(overlay.entryId, base.entryId);
  assert.equal(overlay.owner, base.owner);
  assert.equal(overlay.sourceRowSha256.length, 64);
  assert.deepEqual(overlay.source, base.source);
  assert.deepEqual(overlay.sourceTarget, base.target);
  assert.deepEqual(overlay.rollback, base.rollback);
  assert.equal(overlay.review.carryForward, false);
  assert.deepEqual(validateW14OverlayShard([base], [overlay]), []);
});

// Scenario: a pinned Source template registry is compared with exact current-release weapon records.
// Purpose: prove the join uses the member's singular templateKey and exact release identity, while groups remain unversioned registry facts.
// Given one current weapon record, one historical record with the same key, and a repeated registry key in a different role; when reconciling; then only the exact current member is joined and never treated as availability proof.
test('UnitT15_registry-reconciliation-uses-exact-template-key-and-release', () => {
  assert.equal(typeof w14LedgerContract.reconcileW14WeaponRegistry, 'function');
  const entries = [
    { entryId: 'group-chain', registryKind: 'template-group', registryKey: 'chain_axes', selector: 'template_groups[0].group-key' },
    { entryId: 'member-chain', registryKind: 'template-member', registryKey: 'chainaxe_p1_m1', selector: 'template_groups[0].members[0]' },
    { entryId: 'member-unmatched', registryKind: 'template-member', registryKey: 'chainaxe_p1_m2', selector: 'template_groups[0].members[1]' },
    { entryId: 'group-unarmed', registryKind: 'template-group', registryKey: 'unarmed', selector: 'template_groups[1].group-key' },
    { entryId: 'member-unarmed', registryKind: 'template-member', registryKey: 'unarmed', selector: 'template_groups[1].members[0]' },
  ];
  const currentRecord = {
    recordId: 'darktide:weapon:chainaxe:p1-m1',
    gameReleaseId: 'darktide:1.13.2',
    kind: 'weapon',
    payload: { templateKey: 'chainaxe_p1_m1', familyId: 'chainaxe_p1' },
  };
  const historicalRecord = {
    recordId: 'darktide:weapon:chainaxe:old',
    gameReleaseId: 'darktide:1.13.1',
    kind: 'weapon',
    payload: { templateKey: 'chainaxe_p1_m1' },
  };
  const result = w14LedgerContract.reconcileW14WeaponRegistry({
    registryEntries: entries,
    currentRecords: [currentRecord, historicalRecord],
    gameReleaseId: 'darktide:1.13.2',
    approvalEvidence: [{
      recordId: currentRecord.recordId,
      gameReleaseId: currentRecord.gameReleaseId,
      decision: 'approved',
      state: 'approved',
      targetDigestMatches: true,
      dependenciesDigestMatches: true,
      targetDigest: 'a'.repeat(64),
      dependenciesDigest: 'b'.repeat(64),
    }],
  });

  assert.equal(result.valid, true);
  assert.equal(result.summary.registryEntries, 5);
  assert.equal(result.summary.memberEntries, 3);
  assert.equal(result.summary.exactCurrentRecordMatches, 1);
  assert.equal(result.summary.unmatchedMembers, 2);
  assert.equal(result.rows.find(row => row.entryId === 'member-chain').classification, 'exact-current-source-record-with-approved-digest-evidence');
  assert.deepEqual(result.rows.find(row => row.entryId === 'member-chain').currentRecordIds, [currentRecord.recordId]);
  assert.equal(result.rows.find(row => row.entryId === 'member-unmatched').classification, 'no-exact-current-source-record');
  assert.equal(result.rows.find(row => row.entryId === 'group-chain').gameReleaseId, null);
  assert.deepEqual(result.rows.find(row => row.entryId === 'group-chain').associatedCurrentRecordIds, [currentRecord.recordId]);
  assert.equal(result.rows.find(row => row.entryId === 'group-unarmed').classification, 'registry-group-without-current-record-link');
  assert.equal(result.rows.find(row => row.entryId === 'member-unarmed').classification, 'no-exact-current-source-record');
});

// Scenario: current registry matching is ambiguous or has no current approved digest evidence.
// Purpose: prevent a duplicate current templateKey or stale/unverified review row from being presented as safely reusable.
// Given duplicate matching current records and an invalid approval; when reconciling; then the report keeps the ambiguity and missing approval visible.
test('UnitT16_registry-reconciliation-rejects-ambiguous-or-unverified-current-matches', () => {
  assert.equal(typeof w14LedgerContract.reconcileW14WeaponRegistry, 'function');
  const group = { entryId: 'group-x', registryKind: 'template-group', registryKey: 'group_x', selector: 'template_groups[0].group-key' };
  const entry = { entryId: 'member-x', registryKind: 'template-member', registryKey: 'same_key', selector: 'template_groups[0].members[0]' };
  const record = suffix => ({
    recordId: `darktide:weapon:${suffix}`,
    gameReleaseId: 'darktide:1.13.2',
    kind: 'weapon',
    payload: { templateKey: 'same_key' },
  });
  const approvalEvidence = [{
    recordId: 'darktide:weapon:one',
    gameReleaseId: 'darktide:1.13.2',
    decision: 'approved',
    state: 'approved',
    targetDigestMatches: true,
    dependenciesDigestMatches: false,
  }];
  const result = w14LedgerContract.reconcileW14WeaponRegistry({
    registryEntries: [group, entry],
    currentRecords: [record('one'), record('two')],
    gameReleaseId: 'darktide:1.13.2',
    approvalEvidence,
  });
  assert.equal(result.valid, true);
  assert.equal(result.rows.find(row => row.entryId === entry.entryId).classification, 'ambiguous-current-source-record');
  assert.deepEqual(result.rows.find(row => row.entryId === entry.entryId).currentRecordIds, ['darktide:weapon:one', 'darktide:weapon:two']);

  const single = w14LedgerContract.reconcileW14WeaponRegistry({
    registryEntries: [group, entry],
    currentRecords: [record('one')],
    gameReleaseId: 'darktide:1.13.2',
    approvalEvidence,
  });
  assert.equal(single.rows.find(row => row.entryId === entry.entryId).classification, 'exact-current-source-record-without-valid-approved-digest-evidence');
});

// Scenario: the generated W14 registry reconciliation is matched back to its frozen W03 shard.
// Purpose: keep the actual 260-row artifact bound to source entry IDs, selectors, fragments, and the approved current package digests.
// Given the fixed W03 registry shard and generated report; when checking every row; then unmatched keys remain explicitly unproven and the three exact joins retain all verified review fields.
test('UnitT17_generated-registry-report-is-row-bound-and-not-an-availability-claim', async () => {
  const report = JSON.parse(await readFile(new URL('../docs/contracts/w14/weapon-registry-current-reconciliation.json', import.meta.url), 'utf8'));
  const ledger = JSON.parse(await readFile(new URL('../docs/contracts/w03/mapping-ledger.json', import.meta.url), 'utf8'));
  const descriptor = ledger.shards.find(shard => shard.groupId === 'source-code-registry');
  assert.ok(descriptor);
  const container = await readFile(new URL(`../docs/contracts/w03/${descriptor.path}`, import.meta.url));
  const checked = verifyW03LedgerShard(ledger, descriptor, container);
  assert.equal(checked.valid, true);
  assert.equal(report.inputBindings.w03Ledger.sha256.length, 64);
  assert.equal(report.inputBindings.registryShard.containerSha256, descriptor.containerSha256);
  assert.equal(report.inputBindings.sourceCode.commit, 'ba6c148f3c2768ca3ce20d846a12e56e2f433f3e');
  assert.equal(report.inputBindings.sourceCode.verifiedEntryFragments, 260);
  assert.equal(report.inputBindings.currentSourcePackageReviewBasis.approvedCurrentSourceTargetCount, 817);
  assert.equal(report.inputBindings.currentSourcePackageReviewBasis.contentVersion, '1.13.2.1');
  assert.equal(report.inputBindings.activePublishedData.contentVersion, '1.13.2.2');
  assert.equal(report.inputBindings.activePublishedData.sameDataRevisionAsReviewBasis, true);
  assert.equal(report.summary.playerAvailabilityInferred, false);
  assert.equal(report.interpretation.playerAvailabilityInferred, false);
  assert.equal(report.rows.length, checked.entries.length);

  const byId = new Map(report.rows.map(row => [row.entryId, row]));
  assert.equal(byId.size, 260);
  for (const entry of checked.entries) {
    const row = byId.get(entry.entryId);
    assert.ok(row, `missing W03 registry row ${entry.entryId}`);
    assert.equal(row.registryKey, entry.sourceEntityKey.value);
    assert.equal(row.selector.locator, entry.selector.locator);
    assert.equal(row.sourceFragmentSha256, entry.fragment.sha256);
    assert.equal(row.sourceByteRange.start, entry.selector.startByte);
    assert.equal(row.sourceByteRange.end, entry.selector.endByte);
  }

  const matched = report.rows.filter(row => row.registryKind === 'template-member' && row.currentRecordIds?.length);
  assert.deepEqual(matched.map(row => [row.registryKey, row.currentRecordIds[0]]).sort(), [
    ['chainaxe_p1_m1', 'darktide:weapon:chainaxe:p1-m1'],
    ['chainaxe_p1_m2', 'darktide:weapon:chainaxe:p1-m2'],
    ['lasgun_p1_m1', 'darktide:weapon:lasgun:p1-m1'],
  ]);
  assert.deepEqual(matched.map(row => row.currentRecordEvidence[0].approvedFields.length).sort((a, b) => a - b), [5, 9, 9]);
  const unmatched = report.rows.filter(row => row.registryKind === 'template-member' && !row.currentRecordIds?.length);
  assert.equal(unmatched.length, 200);
  assert.ok(unmatched.every(row => row.classification === 'no-exact-current-source-record'));
  const groups = report.rows.filter(row => row.registryKind === 'template-group');
  assert.equal(groups.length, 57);
  assert.ok(groups.every(row => row.gameReleaseId === null));
  assert.equal(groups.filter(row => row.associatedCurrentRecordIds.length > 0).length, 2);
});

// Scenario: one frozen W03 shard is overlaid with an omitted or duplicated entry.
// Purpose: ensure the W14 overlay cannot silently lose or double-count any indexed row.
// Given two source rows; when one is omitted or repeated; then coverage validation reports the exact mismatch.
test('UnitT20_overlay-shard-requires-every-source-entry-exactly-once', () => {
  const first = sourceEntry('w03-source-row-1');
  const second = sourceEntry('w03-source-row-2');
  const firstOverlay = createW14OverlayEntry(first, pendingDecision());
  const secondOverlay = createW14OverlayEntry(second, pendingDecision());

  assert.ok(validateW14OverlayShard([first, second], [firstOverlay]).some(issue => issue.code === 'overlay-entry-missing'));
  assert.ok(validateW14OverlayShard([first, second], [firstOverlay, secondOverlay, secondOverlay])
    .some(issue => issue.code === 'overlay-entry-duplicate'));
});

// Scenario: an overlay row is copied to a different W03 target or points at another source-row digest.
// Purpose: reject cross-row substitution even when the entryId remains plausible.
// Given an overlay row with a stale source hash; when validating its shard; then the binding mismatch is rejected.
test('UnitT30_overlay-shard-rejects-row-substitution-and-target-drift', () => {
  const base = sourceEntry();
  const validOverlay = createW14OverlayEntry(base, pendingDecision());
  const wrongHash = { ...validOverlay, sourceRowSha256: 'f'.repeat(64) };
  const wrongTarget = { ...validOverlay, sourceTarget: { ...base.target, recordId: 'darktide:weapon:other' } };

  assert.ok(validateW14OverlayShard([base], [wrongHash]).some(issue => issue.code === 'overlay-source-hash'));
  assert.ok(validateW14OverlayShard([base], [wrongTarget]).some(issue => issue.code === 'overlay-source-binding'));
});

function indexedW03Shard(entryOrEntries) {
  const entries = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries];
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  const contentBytes = Buffer.from(JSON.stringify({
    entrySchemaVersion: 'w03.mapping-entry.v1', groupId: 'test-current', entries,
  }), 'utf8');
  const compressedBytes = gzipSync(contentBytes, { level: 9, mtime: 0 });
  const containerBytes = Buffer.from(JSON.stringify({ encoding: 'gzip-base64', data: compressedBytes.toString('base64') }), 'utf8');
  const descriptor = {
    path: 'extension/test-current-0001.json', groupId: 'test-current', entryCount: entries.length, encoding: 'gzip-base64',
    containerBytes: containerBytes.length, containerSha256: sha256(containerBytes),
    compressedBytes: compressedBytes.length, compressedSha256: sha256(compressedBytes),
    contentBytes: contentBytes.length, contentSha256: sha256(contentBytes),
  };
  const ledger = {
    schemaVersion: 1,
    entrySchemaVersion: 'w03.mapping-entry.v1',
    groups: { 'test-current': { entryCount: entries.length, shardPaths: [descriptor.path] } },
    shards: [descriptor],
  };
  return { ledger, descriptor, containerBytes };
}

// Scenario: a W03 compressed shard is verified one at a time.
// Purpose: bind every W14 source row to the exact indexed container, compressed payload, and bounded content bytes.
// Given one correctly indexed W03 shard; when its source bytes are verified; then the row is returned and any container mutation fails closed.
test('UnitT40_w03-shard-verification-checks-container-and-content-digests', () => {
  const source = sourceEntry();
  const { ledger, descriptor, containerBytes } = indexedW03Shard(source);

  const valid = verifyW03LedgerShard(ledger, descriptor, containerBytes);
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.entries, [source]);

  const changed = Buffer.from(containerBytes);
  changed[changed.length - 2] ^= 1;
  const invalid = verifyW03LedgerShard(ledger, descriptor, changed);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some(issue => issue.code === 'shard-container-integrity'));
});

// Scenario: one complete W03 index and shard are supplied to the W14 overlay writer.
// Purpose: preserve one-to-one row coverage while emitting a deterministic compressed shard bound to the exact W03 index and source container.
// Given a verified one-row W03 shard; when building the W14 overlay; then its manifest and gzip payload prove exact row and source integrity.
test('UnitT50_overlay-writer-emits-deterministic-indexed-shard-and-coverage', async () => {
  const tempRoot = await mkdtemp(path.join(process.cwd(), '.tmp-w14-overlay-writer-'));
  try {
    const docRoot = path.join(tempRoot, 'docs', 'contracts', 'w03');
    const outputRoot = path.join(tempRoot, 'overlay');
    const secondOutputRoot = path.join(tempRoot, 'overlay-second');
    const entry = sourceEntry();
    const fixture = indexedW03Shard(entry);
    await mkdir(path.join(docRoot, 'extension'), { recursive: true });
    await writeFile(path.join(docRoot, 'mapping-ledger.json'), JSON.stringify(fixture.ledger));
    await writeFile(path.join(docRoot, ...fixture.descriptor.path.split('/')), fixture.containerBytes);

    const options = { docRoot, outputRoot, classifyEntry: () => pendingDecision() };
    const first = await buildW14Overlay(options);
    const firstManifestBytes = await readFile(path.join(outputRoot, 'manifest.json'));
    const firstManifest = JSON.parse(firstManifestBytes.toString('utf8'));
    const shard = firstManifest.shards[0];
    const compressed = await readFile(path.join(outputRoot, ...shard.path.split('/')));
    const payload = JSON.parse(gunzipSync(compressed).toString('utf8'));

    assert.equal(first.entryCount, 1);
    assert.equal(first.shardCount, 1);
    assert.equal(firstManifest.sourceLedger.sha256, createHash('sha256').update(JSON.stringify(fixture.ledger)).digest('hex'));
    assert.equal(shard.sourcePath, fixture.descriptor.path);
    assert.equal(shard.sourceContainerSha256, fixture.descriptor.containerSha256);
    assert.equal(payload.entries.length, 1);
    assert.equal(payload.entries[0].entryId, entry.entryId);
    assert.equal(payload.entries[0].sourceRowSha256.length, 64);

    const second = await buildW14Overlay({ ...options, outputRoot: secondOutputRoot });
    const secondManifestBytes = await readFile(path.join(secondOutputRoot, 'manifest.json'));
    const secondCompressed = await readFile(path.join(secondOutputRoot, ...shard.path.split('/')));
    assert.deepEqual(second, first);
    assert.deepEqual(secondManifestBytes, firstManifestBytes);
    assert.deepEqual(secondCompressed, compressed);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// Scenario: a generated W14 overlay is reopened against its exact W03 ledger and compressed shard bytes.
// Purpose: provide a portable integrity verifier that detects missing, substituted, or corrupt shard output before a reviewer consumes the bundle.
// Given a valid one-row W03 source and generated overlay; when verifying the bundle; then its one-to-one source bindings and gzip digest pass, while a changed compressed byte is rejected.
test('UnitT56_overlay-verifier-reopens-indexed-shards_and_rejects_corruption', async () => {
  const tempRoot = await mkdtemp(path.join(process.cwd(), '.tmp-w14-overlay-verify-'));
  try {
    const docRoot = path.join(tempRoot, 'docs', 'contracts', 'w03');
    const outputRoot = path.join(tempRoot, 'overlay');
    const entry = sourceEntry('w03-overlay-verification');
    const fixture = indexedW03Shard(entry);
    await mkdir(path.join(docRoot, 'extension'), { recursive: true });
    await writeFile(path.join(docRoot, 'mapping-ledger.json'), JSON.stringify(fixture.ledger));
    await writeFile(path.join(docRoot, ...fixture.descriptor.path.split('/')), fixture.containerBytes);
    const built = await buildW14Overlay({ docRoot, outputRoot, classifyEntry: () => pendingDecision() });

    const verified = await w14LedgerContract.verifyW14Overlay({ docRoot, overlayRoot: outputRoot });
    assert.equal(verified.integrityVerified, true);
    assert.equal(verified.entryCount, 1);
    assert.equal(verified.completionGapCount, 1);
    assert.equal(verified.manifestSha256, built.outputManifestSha256);

    const shardPath = path.join(outputRoot, ...verified.shards[0].path.split('/'));
    const compressed = await readFile(shardPath);
    compressed[compressed.length - 1] ^= 1;
    await writeFile(shardPath, compressed);
    await assert.rejects(w14LedgerContract.verifyW14Overlay({ docRoot, overlayRoot: outputRoot }), /compressed shard integrity/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// Scenario: a portable W14 output-set has a malformed top-level manifest.
// Purpose: fail closed before loading any external Source checkout or consuming child overlays.
// Given a temporary output directory with an unsupported schema; when invoking the set verifier; then it rejects the header immediately.
test('UnitT57_output-set-verifier-rejects-an-unsupported-manifest-before-reading-pinned-inputs', async () => {
  const tempRoot = await mkdtemp(path.join(process.cwd(), '.tmp-w14-output-set-verify-'));
  try {
    const outputRoot = path.join(tempRoot, 'output');
    await mkdir(outputRoot, { recursive: true });
    await writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify({ schemaVersion: 'w14.unknown.v1' }));
    await assert.rejects(w14OutcomeBuilder.verifyW14OutcomeSet({
      webRoot: tempRoot,
      sourceRoot: tempRoot,
      outputRoot,
    }), /W14 output-set manifest header is invalid/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// Scenario: two W03 rows resolve through one immutable current artifact descriptor.
// Purpose: reuse its verified bytes within one build without letting the cached artifact bypass row-specific identity or digest checks.
// Given two fields from the same current record; when building and then probing an invalid row against the same bytes; then the artifact is read once for the valid build and wrong identity or pins still fail closed.
test('UnitT55_overlay-verifies-shared-artifact-once-and-still-checks-each-row', async () => {
  const tempRoot = await mkdtemp(path.join(process.cwd(), '.tmp-w14-overlay-cache-'));
  try {
    const docRoot = path.join(tempRoot, 'docs', 'contracts', 'w03');
    const outputRoot = path.join(tempRoot, 'overlay');
    const nameEntry = sourceEntry('w03-source-row-name');
    nameEntry.selector.locator = '/records/0/payload/name';
    nameEntry.fragment.sha256 = createHash('sha256').update(JSON.stringify('legacy name'), 'utf8').digest('hex');
    nameEntry.target.fieldPath = nameEntry.selector.locator;
    const descriptionEntry = sourceEntry('w03-source-row-description');
    descriptionEntry.selector.locator = '/records/0/payload/description';
    descriptionEntry.fragment.sha256 = createHash('sha256').update(JSON.stringify('legacy description'), 'utf8').digest('hex');
    descriptionEntry.target.fieldPath = descriptionEntry.selector.locator;
    const fixture = indexedW03Shard([nameEntry, descriptionEntry]);
    await mkdir(path.join(docRoot, 'extension'), { recursive: true });
    await writeFile(path.join(docRoot, 'mapping-ledger.json'), JSON.stringify(fixture.ledger));
    await writeFile(path.join(docRoot, ...fixture.descriptor.path.split('/')), fixture.containerBytes);

    const artifactBytes = Buffer.from(JSON.stringify({ records: [{ payload: { name: 'current name', description: 'current description' } }] }) + '\n', 'utf8');
    const fileSha256 = createHash('sha256').update(artifactBytes).digest('hex');
    const gitBlobOid = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${artifactBytes.length}\0`, 'utf8'), artifactBytes])).digest('hex');
    let reads = 0;
    const readArtifact = async locator => {
      reads++;
      assert.deepEqual(locator, { repoId: 'source', commit: 'a'.repeat(40), path: 'content/current.json' });
      return artifactBytes;
    };
    const decisionFor = (entry, overrides = {}) => {
      const selectedValue = valueAtTestPointer(JSON.parse(artifactBytes.toString('utf8')), entry.selector.locator);
      const destination = {
        kind: 'repository-file', repoId: 'source', commit: 'a'.repeat(40), path: 'content/current.json',
        fileSha256, byteLength: artifactBytes.length, gitBlobOid,
        selector: { kind: 'json-pointer', locator: entry.selector.locator },
        fragmentSha256: createHash('sha256').update(JSON.stringify(selectedValue), 'utf8').digest('hex'),
        gameReleaseId: entry.scope.gameReleaseId, recordId: entry.target.recordId,
        ...overrides,
      };
      return {
        disposition: 'migrated', actualOutcome: { status: 'migrated' },
        review: { state: 'pending', carryForward: false, basisRefs: ['fixed current artifact field mapping'] },
        destination,
      };
    };
    const build = (targetRoot, decisionForEntry) => buildW14Overlay({
      docRoot, outputRoot: targetRoot, classifyEntry: entry => decisionForEntry(entry), readArtifact,
    });

    const valid = await build(outputRoot, entry => decisionFor(entry));
    assert.equal(valid.entryCount, 2);
    assert.equal(reads, 1);

    await assert.rejects(build(path.join(tempRoot, 'overlay-wrong-identity'), entry => decisionFor(entry,
      entry.entryId === descriptionEntry.entryId ? { recordId: 'darktide:weapon:other' } : {})), /stable record identity/);
    assert.equal(reads, 2);

    await assert.rejects(build(path.join(tempRoot, 'overlay-wrong-digest'), entry => decisionFor(entry,
      entry.entryId === descriptionEntry.entryId ? { fileSha256: 'f'.repeat(64) } : {})), /artifact integrity mismatch/);
    assert.equal(reads, 4);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function valueAtTestPointer(document, locator) {
  return locator.slice(1).split('/').map(token => token.replace(/~1/gu, '/').replace(/~0/gu, '~'))
    .reduce((value, token) => value[token], document);
}

// Scenario: a W03 current-snapshot row is labeled migrated without a destination or review evidence.
// Purpose: prevent the W14 overlay from counting an unlocated, unreviewed assertion as completed migration.
// Given the exact incomplete completion probe; when validating the one-row overlay; then the completion proof is rejected and current rows cannot be kept or excluded to hide the missing target.
test('UnitT60_current_completion_requires_a_bound_target_and_never_uses_kept_or_excluded', () => {
  const base = sourceEntry();
  const incomplete = {
    ...createW14OverlayEntry(base, pendingDecision()),
    disposition: 'migrated',
    actualOutcome: { status: 'migrated' },
    review: { state: 'pending', carryForward: false, basisRefs: [] },
    destination: null,
  };
  assert.ok(validateW14OverlayShard([base], [incomplete]).some(item => item.code === 'overlay-completion-destination'));

  const kept = {
    ...createW14OverlayEntry(base, pendingDecision()),
    disposition: 'kept',
    actualOutcome: { status: 'kept' },
  };
  const excluded = {
    ...createW14OverlayEntry(base, pendingDecision()),
    disposition: 'excluded',
    actualOutcome: { status: 'excluded', reason: 'avoid current scope' },
  };
  assert.ok(validateW14OverlayShard([base], [kept]).some(item => item.code === 'overlay-current-kept'));
  assert.ok(validateW14OverlayShard([base], [excluded]).some(item => item.code === 'overlay-current-excluded'));

  const reuseWithoutReceipt = {
    ...createW14OverlayEntry(base, pendingDecision()),
    disposition: 'migrated',
    actualOutcome: { status: 'migrated' },
    destination: {
      kind: 'repository-file', repoId: 'source', commit: 'a'.repeat(40), path: 'content/current.json',
      fileSha256: 'b'.repeat(64), byteLength: 10, gitBlobOid: 'c'.repeat(40),
      selector: { kind: 'json-pointer', locator: '/records/0' }, fragmentSha256: 'd'.repeat(64),
    },
    review: { state: 'verified-reuse', carryForward: true, basisRefs: ['arbitrary:approval'] },
  };
  assert.ok(validateW14OverlayShard([base], [reuseWithoutReceipt]).some(item => item.code === 'overlay-completion-reuse-proof'));
});

// Scenario: a completed current W03 row points to a pinned current repository artifact.
// Purpose: verify the target Git object bytes and selected JSON value rather than trusting destination/hash strings.
// Given a migration decision with exact file and selector digests; when the proof verifier reopens the pinned file; then it accepts exact bytes and rejects a changed target digest.
test('UnitT70_migrated_completion_reopens_exact_target_bytes_and_selector', async () => {
  const source = sourceEntry();
  const bytes = Buffer.from('{"records":[{"payload":{"name":"mapped current value"}}]}\n', 'utf8');
  const selectorValue = 'mapped current value';
  const destination = {
    kind: 'repository-file',
    repoId: 'source',
    commit: 'a'.repeat(40),
    path: 'content/authoring/v2/current.json',
    fileSha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    gitBlobOid: createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex'),
    selector: { kind: 'json-pointer', locator: '/records/0/payload/name' },
    fragmentSha256: createHash('sha256').update(JSON.stringify(selectorValue), 'utf8').digest('hex'),
    gameReleaseId: 'darktide:1.13.2',
    recordId: source.target.recordId,
  };
  const decision = {
    disposition: 'migrated',
    actualOutcome: { status: 'migrated' },
    review: { state: 'pending', carryForward: false, basisRefs: ['current candidate artifact'] },
    destination,
  };
  const readArtifact = async locator => {
    assert.deepEqual(locator, { repoId: 'source', commit: destination.commit, path: destination.path });
    return bytes;
  };

  assert.deepEqual(await verifyW14CompletionEvidence({ sourceEntry: source, decision, readArtifact }), {
    verified: true, status: 'migrated', entryId: source.entryId,
  });
  await assert.rejects(verifyW14CompletionEvidence({
    sourceEntry: source,
    decision: { ...decision, destination: { ...destination, fileSha256: 'f'.repeat(64) } },
    readArtifact,
  }), /artifact integrity mismatch/);
});

// Scenario: a current row owned by Source is pointed at an otherwise valid Web artifact.
// Purpose: keep a completion proof within the frozen W03 owner boundary instead of accepting cross-repository substitution.
// Given exact target bytes and selector hashes under the wrong repository; when verifying completion; then the owner mismatch is rejected.
test('UnitT80_current_migration_rejects_a_verified_artifact_under_another_owner', async () => {
  const source = sourceEntry();
  const bytes = Buffer.from('{"records":[{"payload":{"name":"mapped current value"}}]}\n', 'utf8');
  const selectedValue = 'mapped current value';
  const destination = {
    kind: 'repository-file',
    repoId: 'web',
    commit: 'a'.repeat(40),
    path: 'content/current.json',
    fileSha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    gitBlobOid: createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes])).digest('hex'),
    selector: { kind: 'json-pointer', locator: '/records/0/payload/name' },
    fragmentSha256: createHash('sha256').update(JSON.stringify(selectedValue), 'utf8').digest('hex'),
    gameReleaseId: 'darktide:1.13.2',
    recordId: source.target.recordId,
  };
  const decision = {
    disposition: 'migrated',
    actualOutcome: { status: 'migrated' },
    review: { state: 'pending', carryForward: false, basisRefs: ['current candidate artifact'] },
    destination,
  };
  const readArtifact = async locator => {
    assert.deepEqual(locator, { repoId: 'web', commit: destination.commit, path: destination.path });
    return bytes;
  };

  await assert.rejects(verifyW14CompletionEvidence({ sourceEntry: source, decision, readArtifact }), /overlay-current-owner/);
});

// Scenario: a W03 current field has a verified W13 target receipt or a receipt-bound dependency.
// Purpose: distinguish exact approved reuse, approved rewrites, metadata, and genuinely unreviewed current content.
// Given receipt digests recomputed by the pinned Source validator; when classifying the exact field mapping; then only complete approved evidence counts as reusable.
test('UnitT90_current-field-classification-requires-current-target-and-digest-valid-approval', () => {
  const receipt = { decision: 'approved', state: 'approved', targetDigestMatches: true, dependenciesDigestMatches: true };
  const common = { identityMatches: true, targetExists: true, metadataOnly: false, sourceMatchesTarget: true };

  assert.equal(classifyW14CurrentFieldEvidence({ ...common, directReceipts: [receipt] }).status, 'approved-exact-field-reuse');
  assert.equal(classifyW14CurrentFieldEvidence({ ...common, sourceMatchesTarget: false, directReceipts: [receipt] }).status, 'approved-field-rewrite');
  assert.equal(classifyW14CurrentFieldEvidence({ ...common, dependencyReceipts: [receipt] }).status, 'approved-exact-dependency-reuse');
  assert.equal(classifyW14CurrentFieldEvidence({ ...common, sourceMatchesTarget: false, dependencyReceipts: [receipt] }).status, 'approved-dependency-rewrite');
  assert.equal(classifyW14CurrentFieldEvidence({ ...common, metadataOnly: true }).status, 'verified-metadata-mapping');
  assert.equal(classifyW14CurrentFieldEvidence({ ...common, directReceipts: [{ ...receipt, state: 'stale' }] }).status, 'review-required');
  assert.equal(classifyW14CurrentFieldEvidence({ ...common, directReceipts: [{ ...receipt, dependenciesDigestMatches: false }] }).status, 'review-required');
  assert.equal(classifyW14CurrentFieldEvidence({ ...common, identityMatches: false, directReceipts: [receipt] }).status, 'identity-conflict');
  assert.equal(classifyW14CurrentFieldEvidence({ ...common, targetExists: false, directReceipts: [receipt] }).status, 'target-missing');
});

// Scenario: a legacy child path is absent from the current typed payload, but an approved receipt covers an existing parent value.
// Purpose: report the actual approved container and its hash instead of claiming approval for a virtual child field.
// Given an empty current weaponRefs array and an approved parent receipt; when resolving the legacy child; then the real parent is selected, while unrelated or missing parents are rejected.
test('UnitT100_missing-current-child-resolves-only-to-existing-approved-parent', () => {
  const resolve = w14LedgerContract.resolveW14ApprovedCurrentParent;
  assert.equal(typeof resolve, 'function');

  const current = {
    payload: {
      weaponRefs: [],
      theoreticalInputRange: { min: '0.25', max: '0.75', unit: 'ratio' },
    },
  };
  assert.deepEqual(resolve({
    currentRecord: current,
    proposedFieldPath: '/payload/weaponRefs/0',
    approvedFieldPath: '/payload/weaponRefs',
  }), {
    fieldPath: '/payload/weaponRefs',
    value: [],
    proposedFieldAbsent: true,
  });
  assert.deepEqual(resolve({
    currentRecord: current,
    proposedFieldPath: '/payload/theoreticalInputRange/step',
    approvedFieldPath: '/payload',
  }), {
    fieldPath: '/payload',
    value: current.payload,
    proposedFieldAbsent: true,
  });
  assert.equal(resolve({
    currentRecord: current,
    proposedFieldPath: '/payload/theoreticalInputRange/step',
    approvedFieldPath: '/payload/weaponRefs',
  }), null);
  assert.equal(resolve({
    currentRecord: current,
    proposedFieldPath: '/payload/missing/child',
    approvedFieldPath: '/payload/missing',
  }), null);
});

// Scenario: fixed Source rewrites refer to 38 legacy leaves that have no same-path value in the approved W13 records.
// Purpose: ensure their report points at the real approved container and carries its recomputed value hash.
// Given the generated candidate-only crosswalk; when reviewing every parent replacement; then no absent leaf is reported as an actual approved target.
test('UnitT110_source-current-parent-rewrites-retain-real-locator-and-hash', async () => {
  const report = JSON.parse(await readFile(new URL('../docs/contracts/w14/source-current-row-reconciliation.json', import.meta.url), 'utf8'));
  const replacements = report.rows.map(row => row.decision)
    .filter(decision => decision?.target?.sourceFieldResolution?.relation === 'legacy-child-absent-current-approved-parent-container');

  assert.equal(replacements.length, 38);
  assert.equal(new Set(replacements.map(decision => decision.target.sourceFieldResolution.sourceFieldPath)).size, 10);
  for (const decision of replacements) {
    const resolution = decision.target.sourceFieldResolution;
    assert.equal(resolution.currentFieldExists, false);
    assert.equal(resolution.approvedParentFieldPath, decision.target.fieldPath);
    assert.match(resolution.parentValueSha256, /^[a-f0-9]{64}$/u);
    assert.equal(decision.target.actualValueCanonicalSha256, resolution.parentValueSha256);
    assert.ok(decision.target.fieldPath === '/payload' || decision.target.fieldPath === '/payload/weaponRefs');
  }
});

// Scenario: a W03 metadata row is mapped through the fixed row-reconciliation report.
// Purpose: verify a metadata outcome is attached to the exact report decision and cannot be completed by a free-form reason.
// Given one fixed source row and a report row with its exact source hash; when verifying metadata mapping; then the report is reopened and a changed report or decision binding fails.
test('UnitT120_metadata-mapping-reopens-the-exact-reconciliation-row', async () => {
  const source = sourceEntry();
  const reportRow = {
    entryId: source.entryId,
    sourceRowSha256: createHash('sha256').update(JSON.stringify(source), 'utf8').digest('hex'),
    decision: { status: 'metadata-replaced-by-current-shared-domain-schema', reason: 'fixed schema mapping' },
  };
  const reportBytes = Buffer.from(JSON.stringify({ schemaVersion: 'w14.test-reconciliation.v1', rows: [reportRow] }), 'utf8');
  const destination = {
    kind: 'reconciliation-row', repoId: 'web',
    path: 'docs/contracts/w14/source-current-row-reconciliation.json',
    reportSha256: createHash('sha256').update(reportBytes).digest('hex'),
    reportByteLength: reportBytes.length, rowIndex: 0, entryId: source.entryId,
    sourceRowSha256: reportRow.sourceRowSha256,
    decisionStatus: reportRow.decision.status,
    decisionSha256: createHash('sha256').update(JSON.stringify(reportRow.decision), 'utf8').digest('hex'),
  };
  const decision = {
    disposition: 'migrated',
    actualOutcome: { status: 'migrated', migrationKind: 'metadata-mapping', reportStatus: reportRow.decision.status },
    review: { state: 'not-applicable', carryForward: false, basisRefs: ['fixed W14 row reconciliation'] },
    destination,
  };
  const readArtifact = async locator => {
    assert.deepEqual(locator, { repoId: 'web', commit: 'working-tree', path: destination.path });
    return reportBytes;
  };
  assert.equal((await verifyW14CompletionEvidence({ sourceEntry: source, decision, readArtifact })).verified, true);
  await assert.rejects(verifyW14CompletionEvidence({
    sourceEntry: source, decision: { ...decision, destination: { ...destination, reportSha256: 'f'.repeat(64) } }, readArtifact,
  }), /metadata reconciliation report integrity mismatch/);
  await assert.rejects(verifyW14CompletionEvidence({
    sourceEntry: source, decision: { ...decision, destination: { ...destination, decisionSha256: 'f'.repeat(64) } }, readArtifact,
  }), /metadata reconciliation row does not match the fixed source/);
});

// Scenario: a noncurrent row is retained at its exact frozen source locator.
// Purpose: record preservation without carrying review or claiming that the row became current content.
// Given a historical W03 source row; when verifying its kept outcome; then the source commit/path/blob and row digest must all remain exact, and the same outcome is forbidden for current candidates.
test('UnitT130_kept-outcomes-bind-the-original-source-and-cannot-hide-current-rows', async () => {
  const historical = sourceEntry('w03-historical-kept-row');
  historical.scope = { releaseScope: 'historical-game-release', gameReleaseId: null, reason: 'historical source scope' };
  const sourceRowSha256 = createHash('sha256').update(JSON.stringify(historical), 'utf8').digest('hex');
  const destination = {
    kind: 'pinned-source-object', repoId: historical.source.repoId, commit: historical.source.commit,
    path: historical.source.path, gitBlobOid: historical.source.gitBlobOid,
    sourceRowSha256, verification: 'fixed-source-ledger-pointer',
  };
  const decision = {
    disposition: 'kept',
    actualOutcome: { status: 'kept', reason: 'Retained at the original W03 owner; no current approval is inferred.' },
    review: { state: 'not-applicable', carryForward: false, basisRefs: ['exact frozen W03 source locator'] },
    destination,
  };
  assert.deepEqual(await verifyW14CompletionEvidence({ sourceEntry: historical, decision }), {
    verified: true, status: 'kept', entryId: historical.entryId,
  });
  await assert.rejects(verifyW14CompletionEvidence({
    sourceEntry: historical, decision: { ...decision, destination: { ...destination, path: 'content/other.json' } },
  }), /overlay-kept-source-proof/);
  await assert.rejects(verifyW14CompletionEvidence({ sourceEntry: sourceEntry(), decision }), /overlay-current-kept/);
});

// Scenario: a fixed current Web announcement row remains explicitly deferred to W15.
// Purpose: permit the bounded announcement exception without allowing any other current row to disappear into a future scope.
// Given an actual W03 announcement row; when its W15 deferral is validated; then that exact path is allowed and a neighboring current non-announcement row is rejected.
test('UnitT140_only_fixed_current_web_announcement_rows_may_be_deferred_to_w15', async () => {
  const ledger = JSON.parse(await readFile(new URL('../docs/contracts/w03/mapping-ledger.json', import.meta.url), 'utf8'));
  const descriptor = ledger.shards.find(item => item.groupId === 'web-w01-inputs');
  const container = await readFile(new URL(`../docs/contracts/w03/${descriptor.path}`, import.meta.url));
  const checked = verifyW03LedgerShard(ledger, descriptor, container);
  assert.equal(checked.valid, true);
  const announcement = checked.entries.find(entry => entry.owner === 'web'
    && entry.source.path === 'content/w01/web-authoring.json'
    && entry.scope.releaseScope === 'current-snapshot-candidate'
    && entry.selector.locator.startsWith('/announcements/'));
  assert.ok(announcement);
  const decision = {
    disposition: 'deferred-w15',
    actualOutcome: { status: 'deferred-w15', scopeOwner: 'W15', reason: 'Fixed announcement scope is handled in W15.' },
    review: { state: 'not-applicable', carryForward: false, basisRefs: ['fixed W03 announcement scope'] },
    destination: null,
  };
  assert.equal(createW14OverlayEntry(announcement, decision).actualOutcome.status, 'deferred-w15');
  const unrelated = structuredClone(announcement);
  unrelated.selector.locator = '/presentations/0/name';
  unrelated.entryId = `${announcement.entryId}-unrelated`;
  assert.throws(() => createW14OverlayEntry(unrelated, decision), /invalid W14 decision: overlay-w15-deferral-scope/);
});

// Scenario: frozen Mods announcements and workflow records have web/private target owners.
// Purpose: bind W15 deferral to the exact W03 Mods group instead of mistaking target owner for source owner.
// Given verified M05, M07, and K01 rows; when deferring by group; then only the matching Mods source groups are accepted.
test('UnitT150_mods_w15_deferral_uses_fixed_source_group_not_target_owner', async () => {
  const docRoot = path.join(process.cwd(), 'docs', 'contracts', 'w03');
  const indexBytes = await readFile(path.join(docRoot, 'mods', 'mapping-ledger.json'));
  const index = JSON.parse(indexBytes.toString('utf8'));
  const loadFirst = async (group) => {
    const shard = index.shards.find(item => item.path.toLowerCase().includes(`/${group.toLowerCase()}-`));
    assert.ok(shard, `expected fixed ${group} shard`);
    const bytes = await readFile(path.join(docRoot, ...shard.path.split('/')));
    assert.equal(bytes.length, shard.sizeBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), shard.sha256);
    return JSON.parse(bytes.toString('utf8'))[0];
  };
  const m05 = await loadFirst('m05');
  const m07 = await loadFirst('m07');
  const k01 = await loadFirst('k01');
  const m08Current = await (async () => {
    for (const shard of index.shards.filter(item => item.path.toLowerCase().includes('/m08-'))) {
      const bytes = await readFile(path.join(docRoot, ...shard.path.split('/')));
      assert.equal(bytes.length, shard.sizeBytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), shard.sha256);
      const found = JSON.parse(bytes.toString('utf8')).find(entry => entry.entryId === 'mods-m08-0000057');
      if (found) return found;
    }
    assert.fail('expected the fixed M08 current-snapshot row mods-m08-0000057');
  })();
  assert.equal(m05.source.repoId, 'mods');
  assert.equal(m05.owner, 'web');
  assert.equal(m07.source.repoId, 'mods');
  assert.equal(m07.owner, 'private');
  assert.equal(m08Current.scope.releaseScope, 'current-snapshot-candidate');
  assert.equal(m08Current.owner, 'source');

  const deferral = groupId => ({
    disposition: 'deferred-w15',
    actualOutcome: { status: 'deferred-w15', scopeGroupId: groupId, scopeOwner: 'W15', reason: 'Fixed W15 scope.' },
    review: { state: 'not-applicable', carryForward: false, basisRefs: ['W03 fixed Mods shard'] },
    destination: null,
  });
  assert.equal(createW14OverlayEntry(m05, deferral('M05')).actualOutcome.scopeGroupId, 'M05');
  assert.equal(createW14OverlayEntry(m07, deferral('M07')).actualOutcome.scopeGroupId, 'M07');
  assert.equal(createW14OverlayEntry(m08Current, deferral('M08')).actualOutcome.scopeGroupId, 'M08');
  assert.throws(() => createW14OverlayEntry(k01, deferral('M05')), /invalid W14 decision/);
});

// Scenario: an exact W03 M01 source fragment has a public raw-byte archive destination.
// Purpose: distinguish the Source-owned M01 archive manifest from the Extension gzip archive and bind each completion to its original Mods row.
// Given a fixed M01 Mods shard row; when validating its archive outcome; then only the pinned Source manifest/path and original source locator are accepted.
test('UnitT160_m01_archive_outcome_binds_the_fixed_source_manifest_and_mods_row', async () => {
  const modsIndex = JSON.parse(await readFile(new URL('../docs/contracts/w03/mods/mapping-ledger.json', import.meta.url), 'utf8'));
  const m01 = modsIndex.groups.find(group => group.groupId === 'M01');
  assert.ok(m01);
  const shard = m01.shards[0];
  const rows = JSON.parse(await readFile(new URL(`../docs/contracts/w03/${shard.path}`, import.meta.url), 'utf8'));
  const source = rows[0];
  assert.equal(source.source.repoId, 'mods');
  assert.ok(source.review.basisRefs.includes('W03/M01'));

  const destination = {
    kind: 'm01-legacy-archive-entry',
    manifestRepoId: 'source',
    manifestCommit: '805fa5ea3df2482419c967b4e82d019b65338065',
    manifestPath: 'content/legacy/mods/241ad76/m01-manifest.json',
    manifestSha256: '9437100b28c375d2a49df1f8e65d8848d61ed7187a3fb104d60ec63d03d1fd99',
    manifestByteLength: 2133770,
    manifestGitBlobOid: 'c8acb5612a14b11df5e75f7c76351f00ed22e79c',
    sourceCommit: source.source.commit,
    sourcePath: source.source.path,
    sourceGitBlobOid: source.source.gitBlobOid,
    archivePath: `content/legacy/mods/241ad76/${source.source.path}`,
    sourceSha256: 'a'.repeat(64),
    sourceByteLength: 0,
  };
  const decision = {
    disposition: 'archived-readable',
    actualOutcome: { status: 'archived-readable', reason: 'Historical M01 source bytes are preserved at the fixed Source archive.' },
    review: { state: 'not-applicable', carryForward: false, basisRefs: ['W03/M01', 'fixed Source archive manifest'] },
    destination,
  };

  assert.equal(createW14OverlayEntry(source, decision).destination.kind, 'm01-legacy-archive-entry');
  assert.throws(() => createW14OverlayEntry(source, {
    ...decision,
    destination: { ...destination, manifestCommit: '1'.repeat(40) },
  }), /overlay-completion-m01-archive-proof/);
  assert.throws(() => createW14OverlayEntry(source, {
    ...decision,
    destination: { ...destination, archivePath: 'content/legacy/other/file.md' },
  }), /overlay-completion-m01-archive-proof/);
});

// Scenario: the Mods index is read from the W03 root and its descriptor paths are resolved from that same root.
// Purpose: prevent a `mods/mods/shards/...` lookup caused by mixing index-root and descriptor-root conventions.
// Given the fixed W03 Mods index; when the first verified shard is reached; then its callback is invoked before the test stops the walk.
test('UnitT170_mods_walker_uses_one_w03_root_for_index_and_shard_paths', async () => {
  const docRoot = fileURLToPath(new URL('../docs/contracts/w03/', import.meta.url));
  await assert.rejects(
    walkW03ModsLedgerShards({
      docRoot,
      onShard: async () => { throw new Error('unit-test-stop-after-first-mods-shard'); },
    }),
    /unit-test-stop-after-first-mods-shard/,
  );
});

// Scenario: a W03 Source leaf is covered by an approved parent target and its exact dependency evidence set.
// Purpose: keep the real current packet selector while requiring the candidate target and human receipt that cover the leaf.
// Given a source reconciliation row bound to one approved parent receipt; when classifying it; then the actual leaf selector is emitted, while a changed leaf hash or missing human receipt remains a gap.
test('UnitT180_source_parent_and_dependency_receipts_cover_only_the_exact_current_packet_leaf', () => {
  const releaseId = 'darktide:1.13.2';
  const recordId = 'fixture:term:damage-range';
  const entry = sourceEntry('w03-parent-covered-field');
  entry.target.recordId = recordId;
  entry.target.gameReleaseId = releaseId;
  entry.scope.gameReleaseId = releaseId;
  const value = 'source';
  const valueSha256 = createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
  const rowSha256 = createHash('sha256').update(JSON.stringify(entry), 'utf8').digest('hex');
  const targetDigest = 'a'.repeat(64);
  const dependenciesDigest = 'b'.repeat(64);
  const approvalEvidenceSetId = 'evidence-fixture-parent';
  const sourceTarget = {
    gameReleaseId: releaseId, recordId, fieldPath: '/payload', dimension: 'technical',
    state: 'approved', targetDigest, dependenciesDigest, mode: 'source',
  };
  const receipt = {
    decision: 'approved', targetDigest, dependenciesDigest,
    reviewer: { kind: 'human', id: 'fixture-reviewer' },
  };
  const reconciliationRow = {
    entryId: entry.entryId,
    sourceRowSha256: rowSha256,
    decision: {
      status: 'approved-current-dependency-reviewed-rewrite',
      sourceValueExactAtTarget: false,
      target: { gameReleaseId: releaseId, recordId, kind: 'term', fieldPath: '/owner', actualValueCanonicalSha256: valueSha256 },
      approvalEvidenceSetId,
    },
  };
  const context = {
    sourceRows: new Map([[entry.entryId, reconciliationRow]]),
    sourceReport: { rows: [reconciliationRow], rowEvidenceIndex: { approvalEvidenceSets: {
      [approvalEvidenceSetId]: [{
        recordId, gameReleaseId: releaseId,
        coveredBy: { dimension: 'technical', fieldPath: '/payload' },
        targetDigest, dependenciesDigest,
        candidateReceipt: sourceTarget,
      }],
    } } },
    sourceReportBytes: Buffer.from('fixed fixture report'),
    sourceReportRowIndexes: new Map([[entry.entryId, 0]]),
    candidate: { review: { sourceTargets: [sourceTarget], receipts: [{ receipt }] } },
    candidateDescriptor: { commit: 'c'.repeat(40), path: 'candidate.json', gitBlobOid: 'd'.repeat(40), byteLength: 1024, sha256: 'e'.repeat(64) },
    sourceTargetIndex: new Map([[`${releaseId}\u0000${recordId}\u0000/payload\u0000technical`, [{ row: sourceTarget, index: 0 }]]]),
    sourceRecordIndexes: new Map([[`${releaseId}\u0000${recordId}`, [0]]]),
    sourceTechnical: { records: [{ gameReleaseId: releaseId, recordId, kind: 'term', owner: value, payload: { range: { min: 0.25, max: 0.75 } } }] },
    sourcePacketDescriptor: { sha256: 'f'.repeat(64), byteLength: 2048 },
    sourceArchive: { releaseId: 'w09-fixed-fixture', archiveSha256: '1'.repeat(64) },
  };

  const decision = w14OutcomeBuilder.classifyW14AEntry(entry, context);
  assert.equal(decision.actualOutcome.status, 'migrated');
  assert.equal(decision.actualOutcome.approvedCoverFieldPath, '/payload');
  assert.equal(decision.destination.selector.locator, '/records/0/owner');
  assert.equal(decision.review.evidence.selector.locator, '/review/sourceTargets/0');
  assert.equal(decision.review.evidence.targetSha256, targetDigest);
  assert.equal(decision.review.evidence.dependencySha256, dependenciesDigest);

  const changedValueRow = {
    ...reconciliationRow,
    decision: { ...reconciliationRow.decision, target: { ...reconciliationRow.decision.target, actualValueCanonicalSha256: '9'.repeat(64) } },
  };
  assert.equal(w14OutcomeBuilder.classifyW14AEntry(entry, { ...context, sourceRows: new Map([[entry.entryId, changedValueRow]]) }).actualOutcome.status, 'gap');
  assert.equal(w14OutcomeBuilder.classifyW14AEntry(entry, {
    ...context,
    candidate: { review: { sourceTargets: [sourceTarget], receipts: [] } },
  }).actualOutcome.status, 'gap');
  const directReceiptContext = structuredClone(context);
  directReceiptContext.sourceReportBytes = Buffer.from(context.sourceReportBytes);
  directReceiptContext.sourceReport.rowEvidenceIndex.approvalEvidenceSets[approvalEvidenceSetId] = [sourceTarget];
  const directDecision = w14OutcomeBuilder.classifyW14AEntry(entry, directReceiptContext);
  assert.equal(directDecision.actualOutcome.status, 'migrated', JSON.stringify(directDecision));
  const falseCover = structuredClone(context);
  falseCover.sourceReport.rowEvidenceIndex.approvalEvidenceSets[approvalEvidenceSetId][0].coveredBy.fieldPath = '/payload/forged';
  assert.equal(w14OutcomeBuilder.classifyW14AEntry(entry, falseCover).actualOutcome.status, 'gap');
});

// Scenario: an approved dependency leaf is covered by several exact, independently receipted targets with no path-prefix relation.
// Purpose: preserve the complete fixed evidence closure while selecting a deterministic technical primary only for dependency rows.
// Given the exact report row and all valid target receipts; when classifying the dependency leaf; then technical is the primary cover, every closure ref is retained, and a field row cannot use the multi-cover fallback.
test('UnitT181_dependency_cover_set_is_complete_and_uses_a_deterministic_primary', async () => {
  const releaseId = 'darktide:1.13.2';
  const recordId = 'fixture:term:shared-dependency';
  const entry = sourceEntry('w03-multiple-dependency-covers');
  entry.target.recordId = recordId;
  entry.target.gameReleaseId = releaseId;
  entry.scope.gameReleaseId = releaseId;
  const value = 'fixed-value';
  const valueSha256 = createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
  const sourceRowSha256 = createHash('sha256').update(JSON.stringify(entry), 'utf8').digest('hex');
  const approvalEvidenceSetId = 'evidence-fixture-multiple-covers';
  const technicalTarget = {
    gameReleaseId: releaseId, recordId, fieldPath: '/payload', dimension: 'technical',
    state: 'approved', targetDigest: 'a'.repeat(64), dependenciesDigest: 'b'.repeat(64), mode: 'source',
  };
  const evidenceTarget = {
    gameReleaseId: releaseId, recordId, fieldPath: '/payload/claimRefs', dimension: 'evidence',
    state: 'approved', targetDigest: 'c'.repeat(64), dependenciesDigest: 'd'.repeat(64), mode: 'source',
  };
  const receiptFor = target => ({ receipt: {
    decision: 'approved', targetDigest: target.targetDigest, dependenciesDigest: target.dependenciesDigest,
    reviewer: { kind: 'human', id: 'fixture-reviewer' },
  } });
  const reportRow = {
    entryId: entry.entryId,
    sourceRowSha256,
    decision: {
      status: 'approved-current-dependency-reviewed-rewrite',
      sourceValueExactAtTarget: false,
      target: { gameReleaseId: releaseId, recordId, kind: 'term', fieldPath: '/owner', actualValueCanonicalSha256: valueSha256 },
      approvalEvidenceSetId,
    },
  };
  const evidenceSet = [
    { recordId, gameReleaseId: releaseId, coveredBy: { dimension: 'evidence', fieldPath: '/payload/claimRefs' }, candidateReceipt: evidenceTarget },
    { recordId, gameReleaseId: releaseId, coveredBy: { dimension: 'technical', fieldPath: '/payload' }, candidateReceipt: technicalTarget },
  ];
  const context = {
    sourceRows: new Map([[entry.entryId, reportRow]]),
    sourceReport: { rows: [reportRow], rowEvidenceIndex: { approvalEvidenceSets: { [approvalEvidenceSetId]: evidenceSet } } },
    sourceReportBytes: Buffer.from('fixed multiple-cover fixture report'),
    sourceReportRowIndexes: new Map([[entry.entryId, 0]]),
    candidate: { review: { sourceTargets: [evidenceTarget, technicalTarget], receipts: [receiptFor(evidenceTarget), receiptFor(technicalTarget)] } },
    candidateDescriptor: { commit: 'c'.repeat(40), path: 'candidate.json', gitBlobOid: 'd'.repeat(40), byteLength: 1024, sha256: 'e'.repeat(64) },
    sourceTargetIndex: new Map([
      [`${releaseId}\u0000${recordId}\u0000/payload/claimRefs\u0000evidence`, [{ row: evidenceTarget, index: 0 }]],
      [`${releaseId}\u0000${recordId}\u0000/payload\u0000technical`, [{ row: technicalTarget, index: 1 }]],
    ]),
    sourceRecordIndexes: new Map([[`${releaseId}\u0000${recordId}`, [0]]]),
    sourceTechnical: { records: [{ gameReleaseId: releaseId, recordId, kind: 'term', owner: value, payload: { claimRefs: [] } }] },
    sourcePacketDescriptor: { sha256: 'f'.repeat(64), byteLength: 2048 },
    sourceArchive: { releaseId: `w09-${'1'.repeat(32)}`, archiveSha256: '1'.repeat(64) },
  };

  const decision = w14OutcomeBuilder.classifyW14AEntry(entry, context);
  assert.equal(decision.actualOutcome.status, 'migrated');
  assert.equal(decision.actualOutcome.approvedCoverFieldPath, '/payload');
  assert.equal(decision.actualOutcome.approvedCoverDimension, 'technical');
  assert.equal(decision.actualOutcome.approvalEvidenceSetId, approvalEvidenceSetId);
  assert.deepEqual(decision.actualOutcome.approvedCoverClosure.references.map(item => [item.attestation.fieldPath, item.attestation.dimension]), [
    ['/payload', 'technical'], ['/payload/claimRefs', 'evidence'],
  ]);
  assert.equal(createW14OverlayEntry(entry, decision).actualOutcome.approvalEvidenceSetId, approvalEvidenceSetId);
  const mismatchedClosure = structuredClone(decision);
  mismatchedClosure.actualOutcome.approvedCoverClosure.references[1].candidateEvidence.dependencySha256 = '9'.repeat(64);
  assert.throws(() => createW14OverlayEntry(entry, mismatchedClosure), /overlay-source-approval-closure/);

  const missingReceipt = structuredClone(context);
  missingReceipt.candidate.review.receipts.pop();
  assert.equal(w14OutcomeBuilder.classifyW14AEntry(entry, missingReceipt).actualOutcome.status, 'gap');

  const ordinaryFieldRow = structuredClone(reportRow);
  ordinaryFieldRow.decision.status = 'approved-current-field-reviewed-rewrite';
  const ordinaryFieldContext = { ...context, sourceRows: new Map([[entry.entryId, ordinaryFieldRow]]) };
  assert.equal(w14OutcomeBuilder.classifyW14AEntry(entry, ordinaryFieldContext).actualOutcome.status, 'gap');

  const ordinaryExactRow = structuredClone(reportRow);
  ordinaryExactRow.decision.status = 'approved-current-field-exact-reuse';
  ordinaryExactRow.decision.sourceValueExactAtTarget = true;
  ordinaryExactRow.decision.target.fieldPath = '/payload/claimRefs';
  ordinaryExactRow.decision.target.actualValueCanonicalSha256 = createHash('sha256').update(JSON.stringify([]), 'utf8').digest('hex');
  const ordinaryExactReport = { ...context.sourceReport, rows: [ordinaryExactRow] };
  const ordinaryExactContext = {
    ...context,
    sourceRows: new Map([[entry.entryId, ordinaryExactRow]]),
    sourceReport: ordinaryExactReport,
    sourceReportBytes: Buffer.from(JSON.stringify(ordinaryExactReport), 'utf8'),
  };
  ordinaryExactContext.sourceReport.rowEvidenceIndex = {
    approvalEvidenceSets: { [approvalEvidenceSetId]: evidenceSet },
  };
  ordinaryExactContext.sourceReportRowIndexes = new Map([[entry.entryId, 0]]);
  const gitBlobOid = bytes => createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, 'utf8'), bytes])).digest('hex');
  const sourceTechnical = { records: [{
    gameReleaseId: releaseId, recordId, kind: 'term', owner: value, payload: { claimRefs: [] },
  }] };
  const sourceTechnicalBytes = Buffer.from(JSON.stringify(sourceTechnical), 'utf8');
  const sourceArchive = { releaseId: `w09-${'1'.repeat(32)}`, archiveSha256: '1'.repeat(64) };
  ordinaryExactContext.sourceTechnical = sourceTechnical;
  ordinaryExactContext.sourceTechnicalBytes = sourceTechnicalBytes;
  ordinaryExactContext.sourceRecordIndexes = new Map([[`${releaseId}\u0000${recordId}`, [0]]]);
  ordinaryExactContext.sourcePacketDescriptor = {
    sha256: createHash('sha256').update(sourceTechnicalBytes).digest('hex'),
    byteLength: sourceTechnicalBytes.length,
  };
  ordinaryExactContext.sourceArchive = sourceArchive;
  const candidate = { review: {
    sourceTargets: [evidenceTarget, technicalTarget],
    receipts: [receiptFor(evidenceTarget), receiptFor(technicalTarget)],
  } };
  const candidateBytes = Buffer.from(JSON.stringify(candidate), 'utf8');
  ordinaryExactContext.candidate = candidate;
  ordinaryExactContext.candidateDescriptor = {
    commit: 'c'.repeat(40), path: 'candidate.json', gitBlobOid: gitBlobOid(candidateBytes),
    byteLength: candidateBytes.length, sha256: createHash('sha256').update(candidateBytes).digest('hex'),
  };
  const ordinaryExactDecision = w14OutcomeBuilder.classifyW14AEntry(entry, ordinaryExactContext);
  assert.equal(ordinaryExactDecision.actualOutcome.status, 'migrated');
  assert.equal(ordinaryExactDecision.actualOutcome.approvedCoverFieldPath, '/payload/claimRefs');
  assert.equal(ordinaryExactDecision.actualOutcome.approvedCoverClosure.references.length, 2);
  assert.equal(createW14OverlayEntry(entry, ordinaryExactDecision).actualOutcome.status, 'migrated');
  const ordinaryExactReportBytes = ordinaryExactContext.sourceReportBytes;
  assert.equal(ordinaryExactDecision.actualOutcome.approvedCoverClosure.reportByteLength, ordinaryExactReportBytes.length);
  assert.equal(ordinaryExactDecision.actualOutcome.approvedCoverClosure.reportSha256,
    createHash('sha256').update(ordinaryExactReportBytes).digest('hex'));
  let artifactReadCount = 0;
  const readArtifact = async locator => {
    artifactReadCount++;
    if (locator.repoId === 'source' && locator.releaseId === sourceArchive.releaseId) return sourceTechnicalBytes;
    if (locator.repoId === 'web' && locator.commit === 'working-tree') return ordinaryExactReportBytes;
    if (locator.repoId === 'web' && locator.path === 'candidate.json') return candidateBytes;
    throw new Error(`unexpected fixture artifact ${JSON.stringify(locator)}`);
  };
  const verifyCompletion = createW14CompletionVerifier({ readArtifact, verifyApprovedReuse: async () => true });
  assert.equal((await verifyCompletion({ sourceEntry: entry, decision: ordinaryExactDecision })).verified, true);
  assert.equal((await verifyCompletion({ sourceEntry: entry, decision: ordinaryExactDecision })).verified, true);
  assert.equal(artifactReadCount, 3);
});

// Scenario: approved Web term-localization fields belong to the terms domain's termLocalizations collection.
// Purpose: prevent valid /label and /definition migrations from being misrouted to presentations or accepted under a mismatched Web owner identity.
// Given the exact owner target and human receipt; when classifying each field; then the selector points to the terms domain, and a wrong authoringId or absent receipt yields a gap.
test('UnitT190_web_term_localization_targets_resolve_to_the_terms_domain_and_exact_term_ref', () => {
  const releaseId = 'darktide:1.13.2';
  const recordId = 'darktide:term:psyker:smite-damage-multiplier-parameter';
  const ownerId = 'web:term-localization:psyker-smite-damage-multiplier-parameter';
  const domainDescriptor = { repoId: 'web', commit: '1'.repeat(40), path: 'domains/terms.json', gitBlobOid: '2'.repeat(40), byteLength: 512, sha256: '3'.repeat(64) };

  for (const fieldPath of ['/label', '/definition']) {
    const entry = sourceEntry(`w03-web-term-${fieldPath.slice(1)}`);
    entry.owner = 'web';
    entry.scope.gameReleaseId = releaseId;
    entry.target.recordId = ownerId;
    entry.target.gameReleaseId = releaseId;
    const value = fieldPath === '/label' ? '傷害倍率' : '限制倍率適用情境。';
    const sourceRowSha256 = createHash('sha256').update(JSON.stringify(entry), 'utf8').digest('hex');
    const targetId = `review:w06:term:${fieldPath.slice(1)}`;
    const targetDigest = 'a'.repeat(64);
    const dependenciesDigest = 'b'.repeat(64);
    const target = {
      target: { targetId, ownerId, ownerKind: 'term-localization', fieldPath, dimension: 'content' },
      state: 'approved', targetDigest, dependenciesDigest,
    };
    const ownerCandidateTarget = {
      targetId, ownerId, ownerKind: 'term-localization', fieldPath, dimension: 'content',
      targetDigest, dependenciesDigest, candidateState: 'approved', receiptMatchesPinnedOwnerCandidate: true,
    };
    const reportRow = {
      entryId: entry.entryId, sourceRowSha256, disposition: 'approved-current-reuse',
      currentMapping: { ownerId, ownerKind: 'term-localization', fieldPath, sourceValueMatchesCurrent: true },
      evidence: { ownerCandidateTargets: [ownerCandidateTarget] },
    };
    const context = {
      webRows: new Map([[entry.entryId, reportRow]]),
      webTargetIndex: new Map([[`${ownerId}\u0000term-localization\u0000${fieldPath}\u0000content`, [{ row: target, index: 0 }]]]),
      candidate: { review: { targets: [target], receipts: [{ receipt: {
        decision: 'approved', targetId, targetDigest, dependenciesDigest, reviewer: { kind: 'human' },
      } }] } },
      candidateDescriptor: { commit: '4'.repeat(40), path: 'candidate.json', gitBlobOid: '5'.repeat(40), byteLength: 1024, sha256: '6'.repeat(64) },
      domains: [{
        descriptor: domainDescriptor,
        value: { kind: 'terms', web: { termLocalizations: [{
          authoringId: ownerId, termRef: { gameReleaseId: releaseId, kind: 'term', recordId },
          label: '傷害倍率', definition: '限制倍率適用情境。',
        }] } },
      }],
    };
    const decision = w14OutcomeBuilder.classifyW14AEntry(entry, context);
    assert.equal(decision.actualOutcome.status, 'migrated');
    assert.equal(decision.destination.selector.locator, '/web/termLocalizations/0');
    assert.equal(decision.destination.path, 'domains/terms.json');
    assert.equal(decision.destination.mappedFieldPath, fieldPath);
    assert.equal(decision.destination.recordId, ownerId);
    assert.equal(decision.destination.entityRef.recordId, recordId);

    const wrongTermContext = {
      ...context,
      domains: [{ ...context.domains[0], value: { kind: 'terms', web: { termLocalizations: [{
        authoringId: 'web:term-localization:other', termRef: { gameReleaseId: releaseId, kind: 'term', recordId: 'darktide:term:other' },
        label: '傷害倍率', definition: '限制倍率適用情境。',
      }] } } }],
    };
    assert.equal(w14OutcomeBuilder.classifyW14AEntry(entry, wrongTermContext).actualOutcome.status, 'gap');
    assert.equal(w14OutcomeBuilder.classifyW14AEntry(entry, {
      ...context,
      candidate: { review: { targets: [target], receipts: [] } },
    }).actualOutcome.status, 'gap');
  }
});

// Scenario: a real W03 Web presentation row names its authoring owner while the approved domain points at a Source skill record.
// Purpose: preserve the frozen Web owner identity separately from the presentation's entityRef when creating a current Web destination.
// Given the exact W03 row and its pinned reconciliation/receipt target; when classifying the presentation name; then the destination keeps the Web owner ID and records the distinct skill entityRef, while a wrong authoringId is rejected.
test('UnitT195_web_presentation_owner_identity_stays_distinct_from_its_source_entity_ref', async () => {
  const ledger = JSON.parse(await readFile(new URL('../docs/contracts/w03/mapping-ledger.json', import.meta.url), 'utf8'));
  const descriptor = ledger.shards.find(item => item.groupId === 'web-w01-inputs' && item.path.endsWith('web-w01-inputs-0001.json'));
  assert.ok(descriptor);
  const container = await readFile(new URL(`../docs/contracts/w03/${descriptor.path}`, import.meta.url));
  const checked = verifyW03LedgerShard(ledger, descriptor, container);
  assert.equal(checked.valid, true);
  const entry = checked.entries.find(item => item.entryId === 'w03-363b5ef660cc42a3a8e72612');
  assert.ok(entry);
  const report = JSON.parse(await readFile(new URL('../docs/contracts/w14/web-current-row-reconciliation.json', import.meta.url), 'utf8'));
  const reportRow = report.rows.find(item => item.entryId === entry.entryId);
  assert.ok(reportRow);
  assert.equal(entry.target.recordId, 'web:presentation:psyker-brain-burst-improved');

  const pinned = reportRow.evidence.ownerCandidateTargets[0];
  const target = {
    target: {
      targetId: pinned.targetId, ownerId: pinned.ownerId, ownerKind: pinned.ownerKind,
      fieldPath: pinned.fieldPath, dimension: pinned.dimension,
    },
    state: 'approved', targetDigest: pinned.targetDigest, dependenciesDigest: pinned.dependenciesDigest,
  };
  const candidateDescriptor = { commit: '4'.repeat(40), path: 'candidate.json', gitBlobOid: '5'.repeat(40), byteLength: 1024, sha256: '6'.repeat(64) };
  const presentation = {
    authoringId: pinned.ownerId,
    entityRef: { gameReleaseId: entry.scope.gameReleaseId, kind: 'skill', recordId: 'darktide:skill:psyker:brain-burst-improved' },
    name: '顱腦崩裂',
  };
  const context = {
    webRows: new Map([[entry.entryId, reportRow]]),
    webTargetIndex: new Map([[`${pinned.ownerId}\u0000${pinned.ownerKind}\u0000${pinned.fieldPath}\u0000${pinned.dimension}`, [{ row: target, index: 0 }]]]),
    candidate: { review: { targets: [target], receipts: [{ receipt: {
      decision: 'approved', targetId: pinned.targetId, targetDigest: pinned.targetDigest,
      dependenciesDigest: pinned.dependenciesDigest, reviewer: { kind: 'human' },
    } }] } },
    candidateDescriptor,
    domains: [{ descriptor: { repoId: 'web', commit: '4'.repeat(40), path: 'domains/skills.json', gitBlobOid: '7'.repeat(40), byteLength: 4096, sha256: '8'.repeat(64) },
      value: { kind: 'skills', web: { presentations: [presentation] } } }],
  };
  const decision = w14OutcomeBuilder.classifyW14AEntry(entry, context);
  assert.equal(decision.actualOutcome.status, 'migrated');
  assert.equal(decision.destination.recordId, pinned.ownerId);
  assert.equal(decision.destination.ownerId, pinned.ownerId);
  assert.equal(decision.destination.entityRef.recordId, presentation.entityRef.recordId);

  assert.equal(w14OutcomeBuilder.classifyW14AEntry(entry, {
    ...context,
    domains: [{ ...context.domains[0], value: { kind: 'skills', web: { presentations: [{ ...presentation, authoringId: 'web:presentation:other' }] } } }],
  }).actualOutcome.status, 'gap');
});

// Scenario: a frozen Web official-input row points at a legacy localization ID while its exact approved current target is on the canonical presentation.
// Purpose: permit only the report-bound compiled-official owner reassignment without changing the original W03 record ID or accepting a different owner.
// Given the fixed W03 row, reconciliation report, candidate human receipt and current presentation; when classifying it; then both IDs remain explicit and the exact report proof is embedded.
test('UnitT200_compiled_official_input_reassignment_binds_legacy_row_to_exact_web_owner', async () => {
  const ledger = JSON.parse(await readFile(new URL('../docs/contracts/w03/mapping-ledger.json', import.meta.url), 'utf8'));
  const descriptors = ledger.shards.filter(item => item.groupId === 'web-w01-inputs');
  let entry;
  for (const descriptor of descriptors) {
    const envelope = JSON.parse(await readFile(new URL(`../docs/contracts/w03/${descriptor.path}`, import.meta.url), 'utf8'));
    const shard = JSON.parse(gunzipSync(Buffer.from(envelope.data, 'base64')).toString('utf8'));
    entry = shard.entries.find(item => item.entryId === 'w03-6ef7ce5434aedeb86c6e42bb');
    if (entry) break;
  }
  assert.ok(entry);
  const webReportBytes = await readFile(new URL('../docs/contracts/w14/web-current-row-reconciliation.json', import.meta.url));
  const webReport = JSON.parse(webReportBytes.toString('utf8'));
  const reportRowIndex = webReport.rows.findIndex(item => item.entryId === entry.entryId);
  const reportRow = webReport.rows[reportRowIndex];
  const ref = reportRow.evidence.ownerCandidateTargets[0];
  const target = {
    target: { targetId: ref.targetId, ownerId: ref.ownerId, ownerKind: ref.ownerKind,
      fieldPath: ref.fieldPath, dimension: ref.dimension },
    state: 'approved', targetDigest: ref.targetDigest, dependenciesDigest: ref.dependenciesDigest,
  };
  const candidate = { review: {
    targets: [target],
    receipts: [{ receipt: { decision: 'approved', targetId: ref.targetId, targetDigest: ref.targetDigest,
      dependenciesDigest: ref.dependenciesDigest, reviewer: { kind: 'human', id: 'fixed-w13-receipt' } } }],
  } };
  const domain = { kind: 'skills', web: { presentations: [{
    authoringId: ref.ownerId,
    entityRef: { gameReleaseId: entry.scope.gameReleaseId, kind: 'skill', recordId: 'darktide:skill:psyker:brain-burst-improved' },
  }] } };
  const domainBytes = Buffer.from(JSON.stringify(domain));
  const descriptor = { repoId: 'web', commit: '4'.repeat(40), path: 'domains/skills.json',
    gitBlobOid: '5'.repeat(40), byteLength: domainBytes.length, sha256: createHash('sha256').update(domainBytes).digest('hex') };
  const context = {
    webRows: new Map([[entry.entryId, reportRow]]), webReportBytes,
    webReportRowIndexes: new Map([[entry.entryId, reportRowIndex]]), candidate,
    candidateDescriptor: { commit: '6'.repeat(40), path: 'candidate.json', gitBlobOid: '7'.repeat(40), byteLength: 1024, sha256: '8'.repeat(64) },
    domains: [{ descriptor, value: domain }],
  };
  const decision = w14OutcomeBuilder.classifyW14AEntry(entry, context);
  assert.equal(decision.actualOutcome.status, 'migrated');
  assert.equal(decision.destination.recordId, entry.target.recordId);
  assert.equal(decision.destination.ownerId, ref.ownerId);
  assert.equal(decision.destination.ownerMappingProof.originalOwnerId, 'loc_talent_psyker_brain_burst_improved_description');
  assert.equal(decision.destination.ownerMappingProof.mappedOwnerId, ref.ownerId);
  assert.equal(createW14OverlayEntry(entry, decision).actualOutcome.ownerMappingKind, 'approved-compiled-official-input-field');

  const wrongMapping = { ...reportRow, currentMapping: { ...reportRow.currentMapping, kind: 'typed-presentation-field' } };
  assert.equal(w14OutcomeBuilder.classifyW14AEntry(entry, {
    ...context, webRows: new Map([[entry.entryId, wrongMapping]]),
  }).actualOutcome.status, 'gap');
  const wrongDomain = { ...domain, web: { presentations: [{ ...domain.web.presentations[0], authoringId: 'web:presentation:other' }] } };
  assert.equal(w14OutcomeBuilder.classifyW14AEntry(entry, {
    ...context, domains: [{ descriptor, value: wrongDomain }],
  }).actualOutcome.status, 'gap');
});

// Scenario: the frozen W03 row explicitly left its current Source target ungenerated, while the pinned row reconciliation assigns the stable target identity.
// Purpose: allow only this exact row-bound assignment to complete a current Source mapping; existing targets and altered report rows must remain rejected.
// Given a not-generated row, its exact reconciliation assignment and an approved current receipt; when building and reopening the outcome; then the assigned release/record/field are verified against both report and technical packet bytes.
test('UnitT230_not_generated_source_target_uses_exact_row_bound_identity_assignment', async () => {
  const releaseId = 'darktide:1.13.2';
  const recordId = 'darktide:term:fixture:assigned';
  const entry = sourceEntry('w03-not-generated-source-identity');
  entry.sourceEntityKey = { kind: 'stable-id', value: recordId, reason: null };
  entry.target = {
    ...entry.target, status: 'not-generated', repoId: null, commit: null, path: null,
    recordId: null, recordIdNotApplicableReason: 'canonical target ID is not assigned for this planned mapping',
    gameReleaseId: null, gameReleaseIdNotApplicableReason: 'planned target release has not been independently bound',
    reason: 'target mapping is planned and has not been generated', fieldPath: '/records/0/payload/value',
  };
  entry.scope.gameReleaseId = releaseId;
  const value = 'approved current term value';
  const valueSha256 = createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
  const targetDigest = 'a'.repeat(64);
  const dependenciesDigest = 'b'.repeat(64);
  const approvalEvidenceSetId = 'evidence-fixture-assigned-identity';
  const candidateTarget = {
    gameReleaseId: releaseId, recordId, fieldPath: '/payload/value', dimension: 'technical',
    state: 'approved', targetDigest, dependenciesDigest, mode: 'source',
  };
  const reportRow = {
    entryId: entry.entryId,
    sourceRowSha256: createHash('sha256').update(JSON.stringify(entry), 'utf8').digest('hex'),
    decision: {
      status: 'approved-current-field-exact-reuse', sourceValueExactAtTarget: true,
      target: { gameReleaseId: releaseId, recordId, kind: 'term', fieldPath: '/payload/value', actualValueCanonicalSha256: valueSha256 },
      approvalEvidenceSetId,
    },
  };
  const sourceReport = {
    schemaVersion: 'w14.source-current-row-reconciliation.v2',
    rows: [reportRow],
    rowEvidenceIndex: { approvalEvidenceSets: { [approvalEvidenceSetId]: [{
      candidateReceipt: candidateTarget,
      coveredBy: { dimension: 'technical', fieldPath: '/payload/value' },
    }] } },
  };
  const reportBytes = Buffer.from(JSON.stringify(sourceReport), 'utf8');
  const candidateBytes = Buffer.from(JSON.stringify({ review: { sourceTargets: [candidateTarget] } }), 'utf8');
  const gitBlobOid = bytes => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, 'utf8'), bytes])).digest('hex');
  const candidateDescriptor = {
    commit: 'c'.repeat(40), path: 'candidate.json', gitBlobOid: gitBlobOid(candidateBytes),
    byteLength: candidateBytes.length, sha256: createHash('sha256').update(candidateBytes).digest('hex'),
  };
  const technicalBytes = Buffer.from(JSON.stringify({ records: [{
    gameReleaseId: releaseId, recordId, kind: 'term', payload: { value },
  }] }), 'utf8');
  const sourceArchive = { releaseId: 'w09-' + '1'.repeat(32), archiveSha256: 'd'.repeat(64) };
  const context = {
    sourceRows: new Map([[entry.entryId, reportRow]]),
    sourceReport,
    sourceReportBytes: reportBytes,
    sourceReportRowIndexes: new Map([[entry.entryId, 0]]),
    sourceTargetIndex: new Map([[`${releaseId}\u0000${recordId}\u0000/payload/value\u0000technical`, [{ row: candidateTarget, index: 0 }]]]),
    candidate: { review: { sourceTargets: [candidateTarget], receipts: [{ receipt: {
      decision: 'approved', targetDigest, dependenciesDigest, reviewer: { kind: 'human', id: 'fixture-reviewer' },
    } }] } },
    candidateDescriptor,
    sourceRecordIndexes: new Map([[`${releaseId}\u0000${recordId}`, [0]]]),
    sourceTechnical: { records: [{ gameReleaseId: releaseId, recordId, kind: 'term', payload: { value } }] },
    sourceTechnicalBytes: technicalBytes,
    sourcePacketDescriptor: { sha256: createHash('sha256').update(technicalBytes).digest('hex'), byteLength: technicalBytes.length },
    sourceArchive,
  };

  const decision = w14OutcomeBuilder.classifyW14AEntry(entry, context);
  assert.equal(decision.actualOutcome.status, 'migrated');
  assert.equal(decision.destination.recordId, recordId);
  assert.deepEqual(decision.destination.identityAssignment.target, reportRow.decision.target);
  assert.equal(decision.destination.identityAssignment.entryId, entry.entryId);
  assert.equal(decision.destination.identityAssignment.sourceRowSha256, reportRow.sourceRowSha256);
  const overlay = createW14OverlayEntry(entry, decision);
  assert.equal(overlay.actualOutcome.status, 'migrated');

  const readArtifact = async locator => {
    if (locator.releaseId === sourceArchive.releaseId) return technicalBytes;
    if (locator.repoId === 'web' && locator.commit === 'working-tree') return reportBytes;
    if (locator.repoId === 'web' && locator.path === candidateDescriptor.path) return candidateBytes;
    throw new Error(`unexpected fixture artifact ${JSON.stringify(locator)}`);
  };
  const verifyApprovedReuse = async () => true;
  assert.equal((await verifyW14CompletionEvidence({ sourceEntry: entry, decision, readArtifact, verifyApprovedReuse })).verified, true);
  await assert.rejects(verifyW14CompletionEvidence({
    sourceEntry: entry,
    decision: { ...decision, destination: { ...decision.destination, identityAssignment: { ...decision.destination.identityAssignment, rowIndex: 1 } } },
    readArtifact, verifyApprovedReuse,
  }), /identity assignment report row/);

  const legacyEntry = structuredClone(entry);
  legacyEntry.entryId = 'w03-not-generated-legacy-id-assignment';
  const legacyRecordId = 'darktide:weapon:fixture:assigned-legacy';
  const legacyAlias = 'secondary';
  const legacyTargetPath = '/payload/displayedAttacks/1/sourceRefs/1';
  legacyEntry.sourceEntityKey = { kind: 'legacy-id', value: legacyAlias, reason: null };
  legacyEntry.target.fieldPath = '/records/0/payload/value';
  const legacyCandidateTarget = { ...candidateTarget, recordId: legacyRecordId, fieldPath: legacyTargetPath };
  const legacyCandidateReceipt = { receipt: {
    decision: 'approved', targetDigest, dependenciesDigest, reviewer: { kind: 'human', id: 'fixture-reviewer' },
  } };
  const legacyCandidateBytes = Buffer.from(JSON.stringify({ review: { sourceTargets: [legacyCandidateTarget] } }), 'utf8');
  const legacyCandidateDescriptor = {
    commit: candidateDescriptor.commit, path: candidateDescriptor.path, gitBlobOid: gitBlobOid(legacyCandidateBytes),
    byteLength: legacyCandidateBytes.length, sha256: createHash('sha256').update(legacyCandidateBytes).digest('hex'),
  };
  const legacyTechnical = { records: [{
    gameReleaseId: releaseId, recordId: legacyRecordId, kind: 'weapon',
    payload: {
      templateKey: 'fixture_weapon_template', value,
      displayedAttacks: [{ key: 'primary', sourceRefs: ['primary-source', 'primary-damage'] },
        { key: 'secondary', sourceRefs: ['secondary-source', value] }],
    },
  }] };
  const legacyTechnicalBytes = Buffer.from(JSON.stringify(legacyTechnical), 'utf8');
  const legacyReportRow = structuredClone(reportRow);
  legacyReportRow.entryId = legacyEntry.entryId;
  legacyReportRow.sourceRowSha256 = createHash('sha256').update(JSON.stringify(legacyEntry), 'utf8').digest('hex');
  legacyReportRow.decision.target = {
    gameReleaseId: releaseId, recordId: legacyRecordId, kind: 'weapon',
    fieldPath: legacyTargetPath, actualValueCanonicalSha256: valueSha256,
  };
  const legacyEvidenceSetId = 'evidence-fixture-assigned-legacy';
  legacyReportRow.decision.approvalEvidenceSetId = legacyEvidenceSetId;
  const legacySourceReport = {
    ...sourceReport,
    rows: [legacyReportRow],
    rowEvidenceIndex: { approvalEvidenceSets: { [legacyEvidenceSetId]: [{
      candidateReceipt: legacyCandidateTarget,
      coveredBy: { dimension: 'technical', fieldPath: legacyTargetPath },
    }] } },
  };
  const legacyReportBytes = Buffer.from(JSON.stringify(legacySourceReport), 'utf8');
  const legacyContext = {
    ...context,
    sourceRows: new Map([[legacyEntry.entryId, legacyReportRow]]),
    sourceReport: legacySourceReport,
    sourceReportBytes: legacyReportBytes,
    sourceReportRowIndexes: new Map([[legacyEntry.entryId, 0]]),
    sourceTargetIndex: new Map([[`${releaseId}\u0000${legacyRecordId}\u0000${legacyTargetPath}\u0000technical`, [{ row: legacyCandidateTarget, index: 0 }]]]),
    candidate: { review: { sourceTargets: [legacyCandidateTarget], receipts: [legacyCandidateReceipt] } },
    candidateDescriptor: legacyCandidateDescriptor,
    sourceRecordIndexes: new Map([[`${releaseId}\u0000${legacyRecordId}`, [0]]]),
    sourceTechnical: legacyTechnical,
    sourceTechnicalBytes: legacyTechnicalBytes,
    sourcePacketDescriptor: { sha256: createHash('sha256').update(legacyTechnicalBytes).digest('hex'), byteLength: legacyTechnicalBytes.length },
  };
  const legacyDecision = w14OutcomeBuilder.classifyW14AEntry(legacyEntry, legacyContext);
  assert.equal(legacyDecision.actualOutcome.status, 'migrated');
  assert.equal(legacyDecision.destination.identityAssignment.sourceEntityKey.kind, 'legacy-id');
  assert.equal(legacyDecision.destination.identityAssignment.sourceEntityKey.value, legacyAlias);
  assert.equal(legacyDecision.destination.identityAssignment.target.recordId, legacyRecordId);
  const legacyReadArtifact = async locator => {
    if (locator.releaseId === sourceArchive.releaseId) return legacyTechnicalBytes;
    if (locator.repoId === 'web' && locator.commit === 'working-tree') return legacyReportBytes;
    if (locator.repoId === 'web' && locator.path === legacyCandidateDescriptor.path) return legacyCandidateBytes;
    throw new Error(`unexpected legacy identity fixture artifact ${JSON.stringify(locator)}`);
  };
  assert.equal((await verifyW14CompletionEvidence({
    sourceEntry: legacyEntry, decision: legacyDecision, readArtifact: legacyReadArtifact, verifyApprovedReuse,
  })).verified, true);

  const wrongTemplateKey = structuredClone(legacyTechnical);
  wrongTemplateKey.records[0].payload.displayedAttacks[1].key = 'primary';
  const wrongTemplateBytes = Buffer.from(JSON.stringify(wrongTemplateKey), 'utf8');
  assert.equal(w14OutcomeBuilder.classifyW14AEntry(legacyEntry, {
    ...legacyContext,
    sourceTechnical: wrongTemplateKey,
    sourceTechnicalBytes: wrongTemplateBytes,
    sourcePacketDescriptor: { sha256: createHash('sha256').update(wrongTemplateBytes).digest('hex'), byteLength: wrongTemplateBytes.length },
  }).actualOutcome.status, 'gap');

  const recordIndexEntry = structuredClone(legacyEntry);
  recordIndexEntry.entryId = 'w03-not-generated-record-index-assignment';
  recordIndexEntry.sourceEntityKey = { kind: 'record-index', value: '1', reason: null };
  const recordIndexRow = structuredClone(legacyReportRow);
  recordIndexRow.entryId = recordIndexEntry.entryId;
  recordIndexRow.sourceRowSha256 = createHash('sha256').update(JSON.stringify(recordIndexEntry), 'utf8').digest('hex');
  const recordIndexReport = { ...legacySourceReport, rows: [recordIndexRow] };
  const recordIndexReportBytes = Buffer.from(JSON.stringify(recordIndexReport), 'utf8');
  const recordIndexContext = {
    ...legacyContext,
    sourceRows: new Map([[recordIndexEntry.entryId, recordIndexRow]]),
    sourceReport: recordIndexReport,
    sourceReportBytes: recordIndexReportBytes,
    sourceReportRowIndexes: new Map([[recordIndexEntry.entryId, 0]]),
  };
  const recordIndexDecision = w14OutcomeBuilder.classifyW14AEntry(recordIndexEntry, recordIndexContext);
  assert.equal(recordIndexDecision.actualOutcome.status, 'migrated');
  assert.equal(recordIndexDecision.destination.identityAssignment.sourceEntityKey.kind, 'record-index');
  assert.equal((await verifyW14CompletionEvidence({
    sourceEntry: recordIndexEntry,
    decision: recordIndexDecision,
    readArtifact: async locator => {
      if (locator.releaseId === sourceArchive.releaseId) return legacyTechnicalBytes;
      if (locator.repoId === 'web' && locator.commit === 'working-tree') return recordIndexReportBytes;
      if (locator.repoId === 'web' && locator.path === legacyCandidateDescriptor.path) return legacyCandidateBytes;
      throw new Error(`unexpected record-index fixture artifact ${JSON.stringify(locator)}`);
    },
    verifyApprovedReuse,
  })).verified, true);

  const alreadyGenerated = structuredClone(entry);
  alreadyGenerated.target.status = 'existing';
  alreadyGenerated.target.recordId = 'darktide:term:fixture:old';
  assert.equal(w14OutcomeBuilder.classifyW14AEntry(alreadyGenerated, context).actualOutcome.status, 'gap');
});

// Scenario: the fixed report replaces a legacy NOT_IMPORTED marker with a complete current action-profile target and its approved receipt set.
// Purpose: preserve the exact W03 row/report binding when the old report has no leaf hash, while refusing an incomplete packet or altered receipt row.
// Given the exact target and candidate human receipt; when classifying and reopening the outcome; then the packet selector, reconciliation row, receipt set, and seven required resolution sections all remain bound.
test('UnitT240_action_profile_resolution_requires_fixed_row_and_approved_receipt_set', async () => {
  const releaseId = 'darktide:1.13.2';
  const recordId = 'darktide:weapon:chainaxe:p1-m1';
  const entry = sourceEntry('w03-action-profile-resolution');
  entry.sourceEntityKey = { kind: 'legacy-id', value: 'chainaxe_p1_m1', reason: null };
  entry.target = {
    ...entry.target, status: 'not-generated', repoId: null, commit: null, path: null,
    recordId: null, recordIdNotApplicableReason: 'canonical target ID is not assigned for this planned mapping',
    gameReleaseId: null, gameReleaseIdNotApplicableReason: 'planned target release has not been independently bound',
    reason: 'target mapping is planned and has not been generated', fieldPath: '/records/0/payload/actionProfileResolution',
  };
  entry.scope.gameReleaseId = releaseId;
  const targetDigest = 'a'.repeat(64);
  const dependenciesDigest = 'b'.repeat(64);
  const approvedReceiptsSetId = 'evidence-fixture-action-profile-resolution';
  const reportRow = {
    entryId: entry.entryId,
    sourceRowSha256: createHash('sha256').update(JSON.stringify(entry), 'utf8').digest('hex'),
    decision: {
      status: 'legacy-not-imported-coverage-superseded-by-approved-current-action-profile-resolution',
      target: { gameReleaseId: releaseId, recordId, kind: 'weapon', fieldPath: '/payload/actionProfileResolution' },
      approvedReceiptsSetId,
    },
  };
  const sourceReport = {
    schemaVersion: 'w14.source-current-row-reconciliation.v2', rows: [reportRow],
    rowEvidenceIndex: { approvalEvidenceSets: { [approvedReceiptsSetId]: [{ targetDigest, dependenciesDigest, state: 'approved' }] } },
  };
  const reportBytes = Buffer.from(JSON.stringify(sourceReport), 'utf8');
  const candidateTarget = {
    gameReleaseId: releaseId, recordId, fieldPath: '/payload/actionProfileResolution', dimension: 'technical',
    state: 'approved', targetDigest, dependenciesDigest, mode: 'source',
  };
  const candidateBytes = Buffer.from(JSON.stringify({ review: { sourceTargets: [candidateTarget] } }), 'utf8');
  const gitBlobOid = bytes => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, 'utf8'), bytes])).digest('hex');
  const candidateDescriptor = {
    commit: 'c'.repeat(40), path: 'candidate.json', gitBlobOid: gitBlobOid(candidateBytes),
    byteLength: candidateBytes.length, sha256: createHash('sha256').update(candidateBytes).digest('hex'),
  };
  const resolution = {
    actionGenerators: [], executionPolicy: {}, fallbackActions: [], generatorBindings: [],
    inputSetup: {}, localActions: [], staticClosure: {},
  };
  const technicalBytes = Buffer.from(JSON.stringify({ records: [{
    gameReleaseId: releaseId, recordId, kind: 'weapon', payload: { templateKey: 'chainaxe_p1_m1', actionProfileResolution: resolution },
  }] }), 'utf8');
  const sourceArchive = { releaseId: 'w09-' + '1'.repeat(32), archiveSha256: 'd'.repeat(64) };
  const context = {
    sourceRows: new Map([[entry.entryId, reportRow]]), sourceReport, sourceReportBytes: reportBytes,
    sourceReportRowIndexes: new Map([[entry.entryId, 0]]),
    sourceTargetIndex: new Map([[`${releaseId}\u0000${recordId}\u0000/payload/actionProfileResolution\u0000technical`, [{ row: candidateTarget, index: 0 }]]]),
    candidate: { review: { sourceTargets: [candidateTarget], receipts: [{ receipt: {
      decision: 'approved', targetDigest, dependenciesDigest, reviewer: { kind: 'human', id: 'fixture-reviewer' },
    } }] } },
    candidateDescriptor,
    sourceRecordIndexes: new Map([[`${releaseId}\u0000${recordId}`, [0]]]),
    sourceTechnical: { records: [{ gameReleaseId: releaseId, recordId, kind: 'weapon', payload: { templateKey: 'chainaxe_p1_m1', actionProfileResolution: resolution } }] },
    sourceTechnicalBytes: technicalBytes,
    sourcePacketDescriptor: { sha256: createHash('sha256').update(technicalBytes).digest('hex'), byteLength: technicalBytes.length },
    sourceArchive,
  };
  const decision = w14OutcomeBuilder.classifyW14AEntry(entry, context);
  assert.equal(decision.actualOutcome.status, 'migrated');
  assert.equal(decision.actualOutcome.migrationKind, 'approved-source-action-profile-resolution');
  assert.equal(decision.destination.selector.locator, '/records/0/payload/actionProfileResolution');
  assert.equal(decision.destination.resolutionProof.approvedReceiptsSetId, approvedReceiptsSetId);
  assert.equal(createW14OverlayEntry(entry, decision).actualOutcome.status, 'migrated');

  const readArtifact = async locator => {
    if (locator.releaseId === sourceArchive.releaseId) return technicalBytes;
    if (locator.repoId === 'web' && locator.commit === 'working-tree') return reportBytes;
    if (locator.repoId === 'web' && locator.path === candidateDescriptor.path) return candidateBytes;
    throw new Error(`unexpected fixture artifact ${JSON.stringify(locator)}`);
  };
  const verifyApprovedReuse = async () => true;
  assert.equal((await verifyW14CompletionEvidence({ sourceEntry: entry, decision, readArtifact, verifyApprovedReuse })).verified, true);
  await assert.rejects(verifyW14CompletionEvidence({
    sourceEntry: entry,
    decision: { ...decision, destination: { ...decision.destination, resolutionProof: { ...decision.destination.resolutionProof, rowIndex: 1 } } },
    readArtifact, verifyApprovedReuse,
  }), /action-profile resolution report row/);
  await assert.rejects(verifyW14CompletionEvidence({
    sourceEntry: entry,
    decision: { ...decision, destination: { ...decision.destination, identityAssignment: undefined } },
    readArtifact, verifyApprovedReuse,
  }), /identity-assignment/);
  const wrongTemplateTechnical = structuredClone(context.sourceTechnical);
  wrongTemplateTechnical.records[0].payload.templateKey = 'chainaxe_p1_m2';
  assert.equal(w14OutcomeBuilder.classifyW14AEntry(entry, {
    ...context,
    sourceTechnical: wrongTemplateTechnical,
  }).actualOutcome.status, 'gap');

  const { staticClosure: _removedClosure, ...incomplete } = resolution;
  assert.equal(w14OutcomeBuilder.classifyW14AEntry(entry, {
    ...context,
    sourceTechnical: { records: [{ gameReleaseId: releaseId, recordId, kind: 'weapon', payload: { actionProfileResolution: incomplete } }] },
  }).actualOutcome.status, 'gap');
  assert.equal(w14OutcomeBuilder.classifyW14AEntry(entry, {
    ...context,
    candidate: { review: { sourceTargets: [candidateTarget], receipts: [] } },
  }).actualOutcome.status, 'gap');
});

// Scenario: a frozen current-scope row is explicitly corrected to its verified historical 1.13.1 identity.
// Purpose: record the historical identity correction as metadata evidence without relaxing the current-release Source selector guard.
// Given the exact row-bound reconciliation status; when classifying; then the result retains the 1.13.1 target as a correction and does not emit a current Source packet selector.
test('UnitT200_historical_analysis_release_correction_is_metadata_and_never_a_current_packet_migration', () => {
  const entry = sourceEntry('w03-historical-analysis-identity');
  const sourceRowSha256 = createHash('sha256').update(JSON.stringify(entry), 'utf8').digest('hex');
  const reportRow = {
    entryId: entry.entryId,
    sourceRowSha256,
    decision: {
      status: 'historical-analysis-retained-at-exact-1-13-1-release',
      target: {
        gameReleaseId: 'darktide:1.13.1',
        recordId: 'darktide:evidence:psyker:legacy-analysis',
        fieldPath: '/payload',
        actualValueCanonicalSha256: 'a'.repeat(64),
      },
    },
  };
  const report = { rows: [reportRow] };
  const decision = w14OutcomeBuilder.classifyW14AEntry(entry, {
    sourceRows: new Map([[entry.entryId, reportRow]]),
    sourceReport: report,
    sourceReportBytes: Buffer.from(JSON.stringify(report)),
  });

  assert.equal(decision.actualOutcome.status, 'migrated');
  assert.equal(decision.actualOutcome.migrationKind, 'metadata-mapping');
  assert.equal(decision.actualOutcome.metadataSubtype, 'historical-identity-correction');
  assert.equal(decision.actualOutcome.historicalTarget.gameReleaseId, 'darktide:1.13.1');
  assert.equal(decision.destination.kind, 'reconciliation-row');
  assert.equal(decision.destination.decisionStatus, 'historical-analysis-retained-at-exact-1-13-1-release');
  assert.equal(Object.hasOwn(decision.destination, 'selector'), false);
});

// Scenario: the A overlay is generated from the exact pinned W03 index.
// Purpose: prevent an otherwise valid re-indexed W03 ledger from being mislabeled with the frozen A-ledger SHA.
// Given the fixed ledger digest; when the producer validates its walker result; then only the exact fixed SHA is accepted.
test('UnitT210_a_overlay_requires_the_exact_frozen_w03_ledger_digest', () => {
  const expected = w14OutcomeBuilder.W14_FIXED_INPUTS.w03ALedger.sha256;
  assert.equal(w14OutcomeBuilder.assertW14ALedgerPin(expected), expected);
  assert.throws(() => w14OutcomeBuilder.assertW14ALedgerPin('9'.repeat(64)), /fixed W14 source index/);
});

// Scenario: the fixed M01 manifest stores sourceCommit once on its header rather than repeating it in every file.
// Purpose: resolve the archive file using the manifest's real schema while rejecting any conflicting per-file commit.
// Given a file row with only sourcePath and blob OID; when constructing its identity; then the manifest commit supplies the owner exactly.
test('UnitT220_m01_file_identity_uses_the_manifest_level_source_commit', () => {
  const manifest = { sourceCommit: 'a'.repeat(40) };
  const file = { sourcePath: 'Game Info/README.md', gitBlobOid: 'b'.repeat(40) };
  assert.equal(w14LedgerContract.m01ArchiveFileSourceKey(manifest, file), `${manifest.sourceCommit}\u0000${file.sourcePath}\u0000${file.gitBlobOid}`);
  assert.throws(() => w14LedgerContract.m01ArchiveFileSourceKey(manifest, { ...file, sourceCommit: 'c'.repeat(40) }), /invalid or conflicting source identity/);
});

// Scenario: a row-level Web reconciliation is missing a frozen W03 row or claims approval without its exact receipt closure.
// Purpose: make the generated W14 Web inventory one-to-one with W03 and prevent a mapped label from standing in for review evidence.
// Given a two-row fixed Web scope; when validating a report with a missing row, duplicate row, or incomplete receipt; then each malformed report is rejected.
test('UnitT95_web-row-reconciliation-requires-exact-row-coverage-and-approved-receipt-closure', () => {
  const validate = w14LedgerContract.validateW14WebRowReconciliation;
  assert.equal(typeof validate, 'function');
  const sourceRows = [
    { entryId: 'w03-web-1', source: { repoId: 'web', commit: '1'.repeat(40), path: 'content/w01/web-authoring.json', gitBlobOid: '2'.repeat(40) }, selector: { kind: 'json-pointer', locator: '/records/0/payload/name' }, fragment: { serialization: 'json-value-json-stringify', sha256: '3'.repeat(64) }, scope: { gameReleaseId: 'darktide:1.13.2', releaseScope: 'current-snapshot-candidate' }, owner: 'web' },
    { entryId: 'w03-web-2', source: { repoId: 'web', commit: '1'.repeat(40), path: 'content/w01/web-authoring.json', gitBlobOid: '2'.repeat(40) }, selector: { kind: 'json-pointer', locator: '/records/0/payload/detailSections/effects/0/text' }, fragment: { serialization: 'json-value-json-stringify', sha256: '4'.repeat(64) }, scope: { gameReleaseId: 'darktide:1.13.2', releaseScope: 'current-snapshot-candidate' }, owner: 'web' },
  ];
  const reviewTarget = { mode: 'w06', targetId: 'review:w06:test:name', ownerId: 'web:presentation:test', ownerKind: 'presentation', fieldPath: '/name', dimension: 'content', targetDigest: 'a'.repeat(64), dependenciesDigest: 'b'.repeat(64), candidateState: 'approved', receiptMatchesPinnedOwnerCandidate: true };
  const mapped = sourceRows.map((source, index) => ({
    entryId: source.entryId,
    sourceRowSha256: createHash('sha256').update(JSON.stringify(source), 'utf8').digest('hex'),
    source: source.source,
    selector: source.selector,
    sourceFragment: source.fragment,
    disposition: 'approved-current-reuse',
    currentMapping: { ownerId: 'web:presentation:test', fieldPath: index ? '/detailSections/0/items/0/text' : '/name' },
    evidence: { ownerCandidateTargets: [reviewTarget] },
  }));
  const report = { schemaVersion: 'w14.web-current-row-reconciliation.v1', sourceLedgerSha256: 'c'.repeat(64), rows: mapped };

  assert.deepEqual(validate(report, sourceRows), []);
  assert.ok(validate({ ...report, rows: mapped.slice(0, 1) }, sourceRows).some(item => item.code === 'web-row-coverage'));
  assert.ok(validate({ ...report, rows: [mapped[0], mapped[0]] }, sourceRows).some(item => item.code === 'web-row-duplicate'));
  assert.ok(validate({ ...report, rows: [mapped[0], { ...mapped[1], evidence: { ownerCandidateTargets: [{ ...reviewTarget, dependenciesDigest: 'd'.repeat(64), receiptMatchesPinnedOwnerCandidate: false }] } }] }, sourceRows).some(item => item.code === 'web-row-review-closure'));
});

// Scenario: a W03 current-snapshot row is labeled migrated without a destination or review evidence.
// Purpose: prevent the W14 overlay from counting an unlocated, unreviewed assertion as completed migration.
// Given the exact incomplete completion probe; when validating the one-row overlay; then the completion proof is rejected and current rows cannot be kept or excluded to hide the missing target.
