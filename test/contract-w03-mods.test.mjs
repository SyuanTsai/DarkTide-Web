import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  extractAnnouncementBlocks,
  parseGitTreeBuffer,
  classifyTranslationBlock,
  verifyEntryFragment,
  validateMappingEntry,
} from '../scripts/content/contract-w03-mods.mjs';

const MODS_COMMIT = '241ad76ce62330472aa423055a5b85db59bb6c0d';
const M02_PATH = 'Game Info/對話文本/COVERAGE.md';
const M02_BLOB = '6b72bf3c289b2f624a300f608d208f8b8920a1d2';

function m02Entry(overrides = {}) {
  return {
    entryId: 'mods-m02-000001',
    schemaVersion: 'w03.mapping-entry.v1',
    source: {
      repoId: 'mods',
      commit: MODS_COMMIT,
      path: M02_PATH,
      gitBlobOid: M02_BLOB,
    },
    sourceEntityKey: { kind: 'path-scope', value: M02_PATH, reason: null },
    selector: { kind: 'file', locator: 'file' },
    fragment: { normalization: 'git-blob', gitBlobOid: M02_BLOB },
    owner: 'private',
    target: {
      repoId: null,
      commit: null,
      path: null,
      fieldPath: 'archiveEntry',
      gameReleaseId: null,
      gameReleaseIdNotApplicableReason: 'archive-entry-is-not-a-versioned-game-record',
      recordId: null,
      recordIdNotApplicableReason: 'archive-entry-is-not-a-game-record',
      kind: 'private-archive',
      status: 'not-generated',
      reason: 'restricted-original-relative-path-not-published',
    },
    scope: {
      gameReleaseId: null,
      releaseScope: 'release-unspecified',
      reason: 'dialogue-source-does-not-assert-game-release',
    },
    mappingStatus: 'planned',
    intendedDisposition: 'private-restorable',
    actualOutcome: { status: 'not-started' },
    review: {
      carryForward: 'not-assumed',
      basisRefs: ['v17-B §1 M02'],
      state: 'not-applicable',
    },
    linkDisposition: 'preserve-original-relative-path',
    rollback: {
      repoId: 'mods',
      commit: MODS_COMMIT,
      path: M02_PATH,
      gitBlobOid: M02_BLOB,
    },
    ...overrides,
  };
}

// Scenario: a file-level archive plan is not yet a Private archive object.
// Purpose: bind it to its exact Git blob while preserving the not-generated/not-started boundary.
test('UnitT10_whole-file-private-archive-uses-git-blob-union-and-explicit-unversioned-scope', () => {
  assert.deepEqual(validateMappingEntry(m02Entry()), []);
  const missingSchemaVersion = m02Entry();
  delete missingSchemaVersion.schemaVersion;
  assert.ok(validateMappingEntry(missingSchemaVersion).some(issue => issue.code === 'entry-schema-version'));

  const falseSha = m02Entry({ fragment: { normalization: 'raw', sha256: M02_BLOB } });
  assert.ok(validateMappingEntry(falseSha).some(issue => issue.code === 'fragment-union'));

  const wrongBlob = m02Entry({ fragment: { normalization: 'git-blob', gitBlobOid: '0'.repeat(40) } });
  assert.ok(validateMappingEntry(wrongBlob).some(issue => issue.code === 'fragment-source-mismatch'));

  const falselyGenerated = m02Entry({
    target: {
      repoId: 'private',
      commit: 'a'.repeat(40),
      path: 'must-not-be-published',
      fieldPath: 'archiveEntry',
      gameReleaseId: null,
      kind: 'private-archive',
      status: 'generated',
      reason: null,
    },
    actualOutcome: { status: 'private-restorable' },
    mappingStatus: 'migrated',
  });
  assert.ok(validateMappingEntry(falselyGenerated).some(issue => issue.code === 'planned-outcome'));
});

// Scenario: a valid owner label is paired with the wrong typed target or a row evades the M02 path policy by changing both.
// Purpose: enforce owner/target-kind alignment and keep every dialogue tree row in the restricted Private archive group.
test('UnitT15_owner-target-and-restricted-path-policies-cannot-be-bypassed', () => {
  const wrongOwner = m02Entry({ owner: 'web' });
  assert.ok(validateMappingEntry(wrongOwner).some(issue => issue.code === 'owner-target-kind'));
  assert.ok(validateMappingEntry(wrongOwner).some(issue => issue.code === 'm02-restricted-owner'));

  const changedKind = m02Entry({
    owner: 'web',
    target: {
      ...m02Entry().target,
      kind: 'web-record',
      fieldPath: 'content.domain',
      reason: 'future-target-not-generated',
    },
  });
  assert.ok(validateMappingEntry(changedKind).some(issue => issue.code === 'm02-restricted-owner'));

  const wrongNullReason = m02Entry({
    target: { ...m02Entry().target, gameReleaseIdNotApplicableReason: '' },
  });
  assert.ok(validateMappingEntry(wrongNullReason).some(issue => issue.code === 'target-game-release-reason'));

  const disguisedMaintenancePath = m02Entry({
    source: { ...m02Entry().source, path: 'README.md' },
    sourceEntityKey: { kind: 'path-scope', value: 'README.md', reason: null },
    rollback: { ...m02Entry().rollback, path: 'README.md' },
  });
  assert.ok(validateMappingEntry(disguisedMaintenancePath).some(issue => issue.code === 'mods-retained-owner'));

  const retainedReadme = m02Entry({
    source: { ...m02Entry().source, path: 'README.md' },
    sourceEntityKey: { kind: 'path-scope', value: 'README.md', reason: null },
    rollback: { ...m02Entry().rollback, path: 'README.md' },
    owner: 'mods',
    target: {
      repoId: 'mods',
      commit: MODS_COMMIT,
      path: 'README.md',
      fieldPath: 'originalFile',
      gameReleaseId: null,
      gameReleaseIdNotApplicableReason: 'maintenance-file-is-not-game-versioned',
      recordId: null,
      recordIdNotApplicableReason: 'retained-file-is-not-a-game-record',
      kind: 'mods-file',
      status: 'retained',
      reason: 'retained-at-exact-source-location',
    },
    intendedDisposition: 'kept',
    review: { carryForward: 'not-assumed', basisRefs: ['W03/K02'], state: 'not-applicable' },
  });
  assert.deepEqual(validateMappingEntry(retainedReadme), []);

  const changedOwnerAndKind = {
    ...retainedReadme,
    owner: 'source',
    target: {
      ...retainedReadme.target,
      repoId: null,
      commit: null,
      path: null,
      fieldPath: 'sourceDocument',
      kind: 'source-document',
      status: 'not-generated',
      reason: 'planned-source-target',
    },
    intendedDisposition: 'archived-readable',
  };
  assert.ok(validateMappingEntry(changedOwnerAndKind).some(issue => issue.code === 'mods-retained-owner'));
});

// Scenario: a source explicitly marked as a historical release or announcement has a null stable gameReleaseId.
// Purpose: allow truthful scope distinctions without rewriting all records as unversioned historical data.
test('UnitT16_scope-preserves-explicit-historical-and-announcement-markers', () => {
  const historical = m02Entry({
    source: { ...m02Entry().source, path: 'Game Info/releases/1.13.X/source/README.md' },
    sourceEntityKey: { kind: 'path-scope', value: 'Game Info/releases/1.13.X/source/README.md', reason: null },
    selector: { kind: 'file', locator: 'file' },
    rollback: { ...m02Entry().rollback, path: 'Game Info/releases/1.13.X/source/README.md' },
    target: {
      ...m02Entry().target,
      fieldPath: 'legacyArchive',
      gameReleaseIdNotApplicableReason: 'historical-marker-is-not-stable-release-id',
    },
    scope: { gameReleaseId: null, releaseScope: 'historical-game-release', reason: 'path-marker-1.13.X-no-stable-game-release-id' },
  });
  assert.deepEqual(validateMappingEntry(historical), []);

  const announcement = m02Entry({
    source: { ...m02Entry().source, path: '公告/2026-10-06_1.13.2熱修更新公告_繁中翻譯.md' },
    sourceEntityKey: { kind: 'path-scope', value: '公告/2026-10-06_1.13.2熱修更新公告_繁中翻譯.md', reason: null },
    rollback: { ...m02Entry().rollback, path: '公告/2026-10-06_1.13.2熱修更新公告_繁中翻譯.md' },
    owner: 'web',
    target: {
      ...m02Entry().target,
      kind: 'web-announcement',
      fieldPath: 'announcement.originalBlock',
      gameReleaseIdNotApplicableReason: 'announcement-date-does-not-prove-game-release-id',
      reason: 'announcement-block-target-not-generated',
    },
    scope: { gameReleaseId: null, releaseScope: 'announcement-original', reason: 'dated-announcement-retains-own-scope' },
    intendedDisposition: 'migrated',
  });
  assert.deepEqual(validateMappingEntry(announcement), []);
});

// Scenario: Git tree records contain Unicode, tabs, or newlines in filenames.
// Purpose: parse NUL-delimited Git metadata without line-based path truncation or lossy decoding.
test('UnitT20_git-tree-parser-preserves-nul-delimited-unicode-paths', () => {
  const oid = 'a'.repeat(40);
  const bytes = Buffer.from([
    '100644 blob ' + oid + ' 3\tGame Info/對話文本/一\t二.md\0',
    '100644 blob ' + 'b'.repeat(40) + ' 4\tGame Info/對話文本/line\nbreak.md\0',
  ].join(''), 'utf8');

  const records = parseGitTreeBuffer(bytes);
  assert.equal(records.length, 2);
  assert.equal(records[0].path, 'Game Info/對話文本/一\t二.md');
  assert.equal(records[0].gitBlobOid, oid);
  assert.equal(records[0].size, 3);
  assert.equal(records[1].path, 'Game Info/對話文本/line\nbreak.md');
});

// Scenario: an announcement contains repeated image links and every required Markdown block type.
// Purpose: retain occurrence identity and exact selectors for paragraphs, list items, table cells, image references, and spoiler containers.
test('UnitT30_announcement-selector-scan-preserves-blocks-and-repeated-image-occurrences', () => {
  const markdown = [
    '# 標題',
    '',
    '一段說明。行內示例 ' + '\u0060' + '<details>' + '\u0060' + ' 仍是文字。',
    '',
    '- 第一項 ![圖](https://example.invalid/a.png)',
    '- 第二項 ![圖](https://example.invalid/a.png)',
    '',
    '| 欄一 | 欄二 |',
    '| --- | --- |',
    '| 值一 | 值二 |',
    '',
    '<details>',
    '<summary>劇透</summary>',
    '內容。',
    '</details>',
    '',
  ].join('\n');

  const bytes = Buffer.from(markdown, 'utf8');
  const blocks = extractAnnouncementBlocks(bytes);
  const counts = Object.groupBy(blocks, item => item.kind);
  assert.equal(counts.heading?.length, 1);
  assert.equal(counts.paragraph?.length, 3);
  assert.equal(counts.listitem?.length, 2);
  assert.equal(counts.tablecell?.length, 4);
  assert.equal(counts.imageoccurrence?.length, 2);
  assert.equal(counts.spoilercontainer?.length, 1);
  assert.equal(blocks.filter(item => item.kind === 'imageoccurrence' && item.dedupGroupId).length, 2);
  assert.ok(blocks.find(item => item.kind === 'paragraph').selector.locator.endsWith(':paragraph'));
  assert.ok(blocks.find(item => item.kind === 'spoilercontainer').selector.locator.endsWith(':spoilercontainer'));
  assert.ok(blocks.every(item => Number.isInteger(item.selector.startByte) && Number.isInteger(item.selector.endByte)));
  assert.ok(blocks.every(item => verifyEntryFragment({ selector: item.selector, fragment: item.fragment }, bytes).length === 0));
  assert.ok(blocks.every(item => /^[a-f0-9]{64}$/.test(item.fragment.sha256)));
});

// Scenario: an unapproved term candidate remains in the planned review path.
// Purpose: prevent "excluded" from silently treating pending candidates as out of scope.
test('UnitT35_candidate-disposition-does-not-exclude-unapproved-terms', () => {
  const sourcePath = 'Referneces/Translation.md';
  const base = m02Entry({
    source: { ...m02Entry().source, path: sourcePath },
    sourceEntityKey: { kind: 'path-scope', value: sourcePath, reason: null },
    rollback: { ...m02Entry().rollback, path: sourcePath },
    owner: 'web',
    target: {
      ...m02Entry().target,
      kind: 'candidate',
      fieldPath: 'terms.enemies.zhTwLabelCandidate',
      recordIdNotApplicableReason: 'candidate-has-no-approved-record-id',
      gameReleaseIdNotApplicableReason: 'candidate-does-not-prove-game-release',
      reason: 'candidate-not-approved-or-generated',
    },
    scope: { gameReleaseId: null, releaseScope: 'historical-legacy-marker', reason: 'candidate-release-scope-not-yet-verified' },
    intendedDisposition: 'migrated',
    review: { carryForward: 'not-assumed', basisRefs: ['W03/M08'], state: 'pending' },
  });
  assert.deepEqual(validateMappingEntry(base), []);
  const falselyExcluded = { ...base, intendedDisposition: 'excluded' };
  assert.ok(validateMappingEntry(falselyExcluded).some(issue => issue.code === 'candidate-disposition'));
});

// Scenario: Translation.md mixes historical version notes, native game terms, and MOD-specific terminology.
// Purpose: preserve owner, release evidence, review state, and domain splits from the selector's actual section context.
test('UnitT36_translation-mixed-terms-retain-domain-and-historical-release-basis', () => {
  const historicalNote = classifyTranslationBlock({
    sectionPath: '遊戲內容與任務詞 / 怪物相關 / Hit Mass',
    text: '定義待人工確認；來源標記 1.13.1，Steam Build 25606770。',
    kind: 'paragraph',
  });
  assert.equal(historicalNote.length, 1);
  assert.equal(historicalNote[0].owner, 'source');
  assert.equal(historicalNote[0].targetKind, 'legacy-artifact');
  assert.equal(historicalNote[0].evidenceKind, 'historical-release-note');

  const sections = [
    ['遊戲內容與任務詞 / 怪物相關 / BOSS', 'Admonition Champion'],
    ['遊戲內容與任務詞 / 武器', 'Chainsword'],
    ['遊戲內容與任務詞 / 職業與天賦 / Psyker', 'Psyker talent'],
  ];
  for (const [sectionPath, text] of sections) {
    const plans = classifyTranslationBlock({ sectionPath, text: text + '（待人工確認）', kind: 'listitem' });
    assert.deepEqual(plans.map(plan => plan.owner), ['source', 'web']);
    assert.ok(plans.every(plan => plan.candidate === true));
    assert.ok(plans.every(plan => plan.reviewState === 'pending'));
  }

  const pendingTerm = classifyTranslationBlock({
    sectionPath: '遊戲內容與任務詞 / BOSS',
    text: 'Champion label needs review',
    kind: 'listitem',
  });
  assert.ok(pendingTerm.every(plan => plan.owner !== 'private'));

  const unreviewed = classifyTranslationBlock({
    sectionPath: '待確認定義',
    text: 'Term remains unconfirmed',
    kind: 'listitem',
  });
  assert.equal(unreviewed[0].owner, 'private');

  const perk = classifyTranslationBlock({
    sectionPath: 'MOD Enhanced descriptions 專用詞表',
    text: 'Perk 是遊戲原生用詞',
    kind: 'listitem',
  });
  assert.deepEqual(perk.map(plan => plan.owner), ['source', 'web']);
});

// Scenario: a fragment selector points into CRLF source bytes and may be shifted or LF-normalized.
// Purpose: verify the recorded SHA against the exact source byte interval before emitting a mapping row.
test('UnitT37_fragment-hash-is-checked-against-exact-selector-byte-range', () => {
  const bytes = Buffer.from('# 標題\r\n\r\n內容文字。', 'utf8');
  const blocks = extractAnnouncementBlocks(bytes);
  const paragraph = blocks.find(block => block.kind === 'paragraph');
  assert.ok(paragraph);
  const entry = { source: { gitBlobOid: 'a'.repeat(40) }, selector: paragraph.selector, fragment: paragraph.fragment };
  assert.deepEqual(verifyEntryFragment(entry, bytes), []);

  const shifted = {
    ...entry,
    selector: { ...entry.selector, startByte: entry.selector.startByte + 1 },
  };
  assert.ok(verifyEntryFragment(shifted, bytes).some(issue => issue.code === 'fragment-range-hash'));

  const missingByteRange = m02Entry({
    selector: { kind: 'occurrence', locator: 'L1', startByte: 0, endByte: 0 },
    fragment: { normalization: 'raw', sha256: '1'.repeat(64) },
  });
  assert.ok(validateMappingEntry(missingByteRange).some(issue => issue.code === 'selector-byte-range'));

  const normalized = Buffer.from('a\r\nb', 'utf8');
  const normalizedEntry = {
    selector: { kind: 'line-range', locator: 'L1-L2', startByte: 0, endByte: normalized.length },
    fragment: { normalization: 'lf', sha256: createHash('sha256').update(Buffer.from('a\nb', 'utf8')).digest('hex') },
  };
  assert.deepEqual(verifyEntryFragment(normalizedEntry, normalized), []);
});

// Scenario: a known enemy identity has only availability and translation pending.
// Purpose: keep its technical candidate in Source quarantine and its label in Web review, never Private archive.
test('UnitT38_known-enemy-identity-splits-technical-and-label-pending-owners', () => {
  const plans = classifyTranslationBlock({
    sectionPath: '待確認定義 / 遊戲內容與任務詞 / 怪物相關',
    text: 'Scab Radio Operator；可取得狀態與繁中譯名仍待確認。',
    kind: 'listitem',
  });
  assert.deepEqual(plans.map(plan => plan.owner), ['source', 'web']);
  assert.equal(plans[0].targetKind, 'quarantine');
  assert.equal(plans[0].fieldPath, 'terms.enemies.technicalClassificationCandidate');
  assert.equal(plans[1].targetKind, 'candidate');
  assert.equal(plans[1].fieldPath, 'terms.enemies.zhTwLabelCandidate');
  assert.ok(plans.every(plan => plan.candidate && plan.reviewState === 'pending'));
  assert.ok(plans.every(plan => plan.owner !== 'private'));
});