import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { aggregateW17PathInventory, assertW15GroupRow, resolveSafeW17OutputRoot } from '../scripts/content/contract-w17-retirement.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

function sourceEntry(entryId, path, locator, groupId = 'M08') {
  const source = {
    repoId: 'mods',
    commit: '241ad76ce62330472aa423055a5b85db59bb6c0d',
    path,
    gitBlobOid: sha256(path).slice(0, 40),
  };
  return {
    entryId,
    schemaVersion: 'w03.mapping-entry.v1',
    source,
    sourceEntityKey: null,
    selector: { kind: 'line-range', locator, startByte: 0, endByte: 20 },
    fragment: { normalization: 'raw', sha256: sha256(entryId + ':' + locator) },
    owner: 'source',
    target: { repoId: 'source', commit: '1111111111111111111111111111111111111111', path: 'content/example.json', fieldPath: '/records/0', gameReleaseId: null, recordId: null, kind: 'source-record', status: 'not-generated' },
    scope: { gameReleaseId: null, releaseScope: 'historical-source-candidate' },
    mappingStatus: 'planned',
    intendedDisposition: 'migrated',
    actualOutcome: { status: 'not-started' },
    review: { carryForward: 'not-assumed', basisRefs: ['W03/' + groupId], state: 'pending' },
    linkDisposition: 'candidate-only',
    rollback: source,
  };
}

function deferredOverlay(entry, groupId = 'M08') {
  return {
    schemaVersion: 'w14.mapping-overlay-entry.v1',
    entryId: entry.entryId,
    sourceRowSha256: sha256(JSON.stringify(entry)),
    owner: entry.owner,
    source: entry.source,
    sourceTarget: entry.target,
    sourceScope: entry.scope,
    disposition: 'deferred-w15',
    actualOutcome: { status: 'deferred-w15', scopeGroupId: groupId, scopeOwner: 'W15', reason: 'fixed W15 scope' },
    review: { state: 'not-applicable', carryForward: false, basisRefs: ['W03/' + groupId, 'W15 deferred scope'] },
    destination: null,
    rollback: entry.rollback,
  };
}

function w15Completion(entry, groupId, disposition, owner, review = { scopeSha256: '3'.repeat(64), targetId: owner + ':fixture', targetDigest: '4'.repeat(64), dependenciesDigest: '5'.repeat(64) }) {
  const fragmentIdentity = entry.fragment.normalization === 'raw'
    ? { fragmentSha256: entry.fragment.sha256 }
    : { fragmentGitBlobOid: entry.fragment.gitBlobOid };
  return {
    entryId: entry.entryId,
    group: groupId,
    source: {
      ...entry.source,
      selector: entry.selector,
      ...fragmentIdentity,
      url: 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods',
    },
    disposition,
    target: { owner, commit: '2222222222222222222222222222222222222222', path: owner === 'mods' ? entry.source.path : 'docs/example.md' },
    review,
  };
}

function verified(entry, groupId = 'M08') {
  return { groupId, sourceEntry: entry, overlayEntry: deferredOverlay(entry, groupId), verification: { verified: false, status: 'deferred-w15', entryId: entry.entryId } };
}

// Scenario: selectors from one source file resolve partly to another owner and partly remain at Mods.
// Purpose: preserve a source file if any selector still has a fixed Mods destination, while retaining each exact selector decision.
// Given two deferred W03 selectors for one file and the fixed final W15 row bindings, When aggregated, Then the mixed source file is kept with deletionReady false.
test('UnitT10_path-with-a-retained-selector-is-preserved-with-each-selector-bound', () => {
  const first = sourceEntry('mods-m08-0000001', 'Game Info/shared.md', 'L1-L1:paragraph');
  const second = sourceEntry('mods-m08-0000002', 'Game Info/shared.md', 'L2-L2:paragraph');
  const result = aggregateW17PathInventory({
    verifiedRows: [verified(first), verified(second)],
    w15Rows: [
      w15Completion(first, 'M08', 'owner-workflow-handoff', 'web'),
      w15Completion(second, 'M08', 'retained-at-fixed-mods-source', 'mods'),
    ],
  });
  const [file] = result.paths;
  assert.equal(file.sourcePath, 'Game Info/shared.md');
  assert.equal(file.selectorCount, 2);
  assert.deepEqual(file.selectors.map(item => item.entryId), [first.entryId, second.entryId]);
  assert.ok(file.preserveReasons.includes('contains-retained-source-selector'));
  assert.equal(file.deletionReady, false);
  assert.equal(result.deletionReady, false);
});

// Scenario: selectors in one file are handed to distinct maintained owners with no retained selector.
// Purpose: distinguish legitimate one-to-many transfer from a mixed source-file blocker.
// Given two completed W15 rows for the same source path, When aggregated, Then both owners are recorded and the only remaining action is the external W16 acceptance gate.
test('UnitT20_multiple-owner-handoffs-are-recorded-without-a-false-mixed-selector-blocker', () => {
  const first = sourceEntry('mods-m08-0000003', 'Game Info/shared.md', 'L3-L3:paragraph');
  const second = sourceEntry('mods-m08-0000004', 'Game Info/shared.md', 'L4-L4:paragraph');
  const result = aggregateW17PathInventory({
    verifiedRows: [verified(first), verified(second)],
    w15Rows: [
      w15Completion(first, 'M08', 'owner-workflow-handoff', 'source'),
      w15Completion(second, 'M08', 'owner-workflow-handoff', 'web'),
    ],
  });
  const [file] = result.paths;
  assert.deepEqual(file.targetOwners, ['source', 'web']);
  assert.equal(file.multipleTargetOwners, true);
  assert.equal(file.preserveReasons.includes('mixed-target-owners'), false);
  assert.equal(file.preserveReasons.includes('w16-final-acceptance-not-passed'), true);
  assert.equal(file.deletionReady, false);
});

// Scenario: a W15 completion row reuses a W03 entry ID but changes its source blob identity.
// Purpose: reject a receipt row that is not bound to the exact frozen source selector.
// Given a deferred W03 selector and a W15 row with a different Git blob, When aggregated, Then the source binding fails closed.
test('UnitT30_receipt-row-must-bind-the-exact-frozen-source-and-selector', () => {
  const entry = sourceEntry('mods-m08-0000005', 'Game Info/shared.md', 'L5-L5:paragraph');
  const completion = w15Completion(entry, 'M08', 'owner-workflow-handoff', 'web');
  completion.source.gitBlobOid = 'f'.repeat(40);
  assert.throws(() => aggregateW17PathInventory({
    verifiedRows: [verified(entry)],
    w15Rows: [completion],
  }), /W15 completion row source locator mismatch/u);
});

// Scenario: a W14 row is deferred but its fixed final W15 receipt row is absent.
// Purpose: prevent a pending W15 candidate or an incomplete final receipt from resolving a selector.
// Given one deferred W03 row without a completion receipt row, When aggregated, Then no source path is reported as transferred.
test('UnitT40_missing-final-receipt-row-keeps-the-selector-unresolved', () => {
  const entry = sourceEntry('mods-m08-0000006', 'Game Info/shared.md', 'L6-L6:paragraph');
  assert.throws(() => aggregateW17PathInventory({
    verifiedRows: [verified(entry)],
    w15Rows: [],
  }), /missing its fixed W15 completion row/u);
});

// Scenario: a fully transferred source path is locally modified, untracked, or ignored.
// Purpose: preserve local state independently from remote handoff completeness.
// Given worktree metadata for a source path, When aggregated, Then the source remains preserved and the local state is reported.
test('UnitT50_local-dirty-untracked-or-ignored-state-always-preserves-the-source-path', () => {
  const entry = sourceEntry('mods-m08-0000007', 'Game Info/local.md', 'L7-L7:paragraph');
  const completion = w15Completion(entry, 'M08', 'owner-workflow-handoff', 'web');
  for (const state of ['modified', 'untracked', 'ignored', 'new-tracked']) {
    const result = aggregateW17PathInventory({
      verifiedRows: [{ ...verified(entry), worktreeState: { statuses: [state] } }],
      w15Rows: [completion],
    });
    assert.equal(result.paths[0].deletionReady, false);
    assert.ok(result.paths[0].preserveReasons.includes('local-' + state));
  }
});

// Scenario: a duplicate final receipt entry attempts to bind a second selector.
// Purpose: fail closed when the fixed completion set is not one-to-one by W03 entry ID.
// Given duplicate W15 rows for one deferred W03 entry, When aggregated, Then the duplicate is rejected.
test('UnitT60_duplicate-final-receipt-entry-is-rejected', () => {
  const entry = sourceEntry('mods-m08-0000008', 'Game Info/shared.md', 'L8-L8:paragraph');
  const completion = w15Completion(entry, 'M08', 'owner-workflow-handoff', 'web');
  assert.throws(() => aggregateW17PathInventory({
    verifiedRows: [verified(entry)],
    w15Rows: [completion, { ...completion }],
  }), /duplicate W15 completion entryId/u);
});

// Scenario: a fixed M06 workflow-handoff row has no review digest because it transfers procedure ownership, not game content approval.
// Purpose: keep the final W15 source binding while serializing the row without inventing review digests.
// Given a fixed-source deferred selector and an owner-workflow-handoff completion without review, When aggregated, Then the handoff remains bound and review is null.
test('UnitT70_workflow-handoff-without-content-review-remains-bound', () => {
  const entry = sourceEntry('mods-m06-0000001', 'AI Prompt/workflow.md', 'L1:heading', 'M06');
  const completion = w15Completion(entry, 'M06', 'owner-workflow-handoff', 'source', null);
  delete completion.review;
  const result = aggregateW17PathInventory({ verifiedRows: [verified(entry, 'M06')], w15Rows: [completion] });
  assert.equal(result.paths[0].selectors[0].w15.group, 'M06');
  assert.equal(result.paths[0].selectors[0].w15.review, null);
  assert.equal(result.paths[0].selectors[0].requiresPreservation, false);
});

// Scenario: an M08 reference-adoption row carries a scope-bound reference-use statement, not gameplay target/dependency digests.
// Purpose: preserve the reference-only approval semantics without promoting it to a current gameplay fact approval.
// Given a fixed-source deferred selector and the actual M08 review shape, When aggregated, Then its limits are preserved and absent gameplay digests remain null.
test('UnitT80_reference-adoption-review-keeps-its-non-gameplay-limits', () => {
  const entry = sourceEntry('mods-m08-0000009', 'References/Translation.md', 'L9-L9:term', 'M08');
  const review = {
    scopeSha256: '3'.repeat(64),
    usage: 'authoring-reference-only',
    originalProposalStatePreserved: true,
    currentGameplayFactApproved: false,
  };
  const completion = w15Completion(entry, 'M08', 'approved-owner-reference-adoption', 'web', review);
  const result = aggregateW17PathInventory({ verifiedRows: [verified(entry)], w15Rows: [completion] });
  assert.deepEqual(result.paths[0].selectors[0].w15.review, {
    scopeSha256: review.scopeSha256,
    usage: 'authoring-reference-only',
    originalProposalStatePreserved: true,
    currentGameplayFactApproved: false,
  });
});

// Scenario: an M07 operational handoff identifies a whole fixed Git blob rather than a raw text fragment.
// Purpose: bind the completion to the exact source object without requiring a nonexistent fragment SHA-256.
// Given a whole-file W03 selector and a review-free M07 handoff, When aggregated, Then the Git blob identity is retained exactly.
test('UnitT85_git-blob-selector-binds-without-a-raw-fragment-digest', () => {
  const entry = sourceEntry('mods-m07-0000001', 'scripts/game-info/README.md', 'file', 'M07');
  entry.fragment = { normalization: 'git-blob', gitBlobOid: entry.source.gitBlobOid };
  const completion = w15Completion(entry, 'M07', 'private-fixed-tool-reused-line-endings-only', 'private', undefined);
  delete completion.review;
  const result = aggregateW17PathInventory({ verifiedRows: [verified(entry, 'M07')], w15Rows: [completion] });
  const selector = result.paths[0].selectors[0];
  assert.equal(selector.fragmentNormalization, 'git-blob');
  assert.equal(selector.fragmentSha256, null);
  assert.equal(selector.fragmentGitBlobOid, entry.fragment.gitBlobOid);
  assert.equal(selector.w15.review, null);
});

// Scenario: an M08 retained selector is a raw line fragment inside the exact fixed Mods blob.
// Purpose: preserve both raw-fragment and whole-blob selector contracts without treating retained metadata as content review.
// Given a fixed-source retained W15 row with a raw SHA-256 fragment, When its group contract is validated, Then the exact pinned source blob and fragment are accepted and an absent fragment is rejected.
test('UnitT86_retained-m08-raw-fragment-remains-bound-to-its-fixed-blob', () => {
  const entry = sourceEntry('mods-m08-0000194', 'Referneces/Translation.md', 'L15:listitem', 'M08');
  const row = {
    entryId: entry.entryId,
    group: 'M08',
    source: {
      ...entry.source,
      selector: entry.selector,
      fragmentSha256: entry.fragment.sha256,
    },
    disposition: 'retained-at-fixed-mods-source',
    target: {
      owner: 'mods',
      commit: entry.source.commit,
      path: entry.source.path,
      gitBlob: entry.source.gitBlobOid,
      bodyRead: false,
    },
  };
  assert.equal(assertW15GroupRow(row), undefined);
  assert.throws(() => assertW15GroupRow({
    ...row,
    source: { ...row.source, fragmentSha256: undefined },
  }), /M08 retained selector/u);
});

// Scenario: identical input rows are supplied in different orders and include paths whose locale collation differs from UTF-8 byte order.
// Purpose: make the report and compressed payload deterministic across Windows user locales.
// Given three fixed selector rows, When aggregated, Then paths sort by UTF-8 bytes regardless of locale collation.
test('UnitT90_path-order-uses-fixed-utf8-byte-order', () => {
  const entries = [
    sourceEntry('mods-m08-0000010', 'Game Info/ä.md', 'L10-L10:paragraph'),
    sourceEntry('mods-m08-0000011', 'Game Info/b.md', 'L11-L11:paragraph'),
    sourceEntry('mods-m08-0000012', 'Game Info/a.md', 'L12-L12:paragraph'),
  ];
  const rows = entries.map(entry => verified(entry));
  const w15Rows = entries.map(entry => w15Completion(entry, 'M08', 'owner-workflow-handoff', 'web'));
  const result = aggregateW17PathInventory({ verifiedRows: rows, w15Rows });
  const expected = entries.map(entry => entry.source.path).sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')));
  assert.deepEqual(result.paths.map(item => item.sourcePath), expected);
});

// Scenario: a proposed output path is nested below an audited repository through either a direct path or a directory junction.
// Purpose: keep the read-only preflight from writing into or dirtying any audited source checkout.
// Given an audited directory and a new output name, When the path resolves inside that directory, Then it is rejected while a separate new location is accepted.
test('UnitT95_output-root-resolves-outside-audited-repositories-and-must-be-new', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'w17-output-boundary-'));
  const auditedRoot = path.join(tempRoot, 'audited');
  const junction = path.join(tempRoot, 'audited-alias');
  try {
    await mkdir(auditedRoot);
    await assert.rejects(resolveSafeW17OutputRoot(path.join(auditedRoot, 'new-output'), [auditedRoot]), /inside an audited repository/u);
    await symlink(auditedRoot, junction, 'junction');
    await assert.rejects(resolveSafeW17OutputRoot(path.join(junction, 'new-output'), [auditedRoot]), /inside an audited repository/u);
    await assert.rejects(resolveSafeW17OutputRoot('relative-is-not-absolute', [auditedRoot]), /absolute path/u);
    const output = await resolveSafeW17OutputRoot(path.join(tempRoot, 'safe-output'), [auditedRoot]);
    assert.equal(output, path.join(tempRoot, 'safe-output'));
    await mkdir(output);
    await assert.rejects(resolveSafeW17OutputRoot(output, [auditedRoot]), /already exists/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
