import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseW15AnnouncementMarkdown } from '../scripts/content/contract-w15-announcements.mjs';
import { buildW15AnnouncementCandidate } from '../scripts/content/w15-announcement-import.mjs';
import { loadW15GroupEntries, loadW15M05Entries, mapW15AnnouncementRows, mapW15WorkflowRows } from '../scripts/content/contract-w15-migration.mjs';

// Scenario: A pinned Markdown announcement contains headings, nested emphasis and links, a quote, a nested list, a table, images, and a spoiler.
// Purpose: Preserve the source order and every user-visible inline/block occurrence as closed typed data, without emitting HTML.
test('UnitT10_parses_typed_announcement_blocks_without_losing_inline_or_nested_content', () => {
  const markdown = [
    '# 標題',
    '',
    '前文 **粗體**、*斜體*、`代碼`與[官方來源](https://example.test/patch)。',
    '',
    '> 引文第一行',
    '> 引文第二行',
    '',
    '- 父項',
    '  - 子項 [連結](https://example.test/item)',
    '',
    '| 欄位 | 數值 |',
    '| --- | ---: |',
    '| 傷害 | **25%** |',
    '',
    '![封面](https://images.example.test/cover.png)',
    '',
    '<details>',
    '<summary>劇透</summary>',
    '',
    '隱藏內容。',
    '',
    '</details>',
  ].join('\n');

  const result = parseW15AnnouncementMarkdown(markdown, {
    idPrefix: 'w15:test',
    assetsByUrl: new Map([['https://images.example.test/cover.png', {
      assetId: 'w15:asset:cover', mediaType: 'image/png', alt: '封面',
      sourceUri: 'https://images.example.test/cover.png', sha256: 'a'.repeat(64), sizeBytes: 1,
    }]]),
  });

  assert.deepEqual(result.blocks.map(block => block.kind), ['heading', 'paragraph', 'quote', 'list', 'table', 'image', 'spoiler']);
  assert.deepEqual(result.blocks[1].inline, [
    { kind: 'text', text: '前文 ' },
    { kind: 'strong', text: '粗體' },
    { kind: 'text', text: '、' },
    { kind: 'emphasis', text: '斜體' },
    { kind: 'text', text: '、' },
    { kind: 'code', text: '代碼' },
    { kind: 'text', text: '與' },
    { kind: 'link', text: '官方來源', href: 'https://example.test/patch' },
    { kind: 'text', text: '。' },
  ]);
  assert.equal(result.blocks[2].blocks.map(block => block.text).join('\n'), '引文第一行\n引文第二行');
  assert.equal(result.blocks[3].items[0].children[0].items[0].text, '子項 連結');
  assert.equal(result.blocks[3].items[0].children[0].items[0].inline[1].href, 'https://example.test/item');
  assert.deepEqual(result.blocks[4].rows.map(row => row.cells.map(cell => cell.text)), [
    ['欄位', '數值'], ['傷害', '25%'],
  ]);
  assert.equal(result.blocks[5].assetRef.assetId, 'w15:asset:cover');
  assert.equal(result.blocks[6].label, '劇透');
  assert.equal(result.blocks[6].blocks[0].text, '隱藏內容。');
  assert.equal(result.occurrences.filter(item => item.kind === 'image').length, 1);
  assert.equal(result.assets.length, 1);
  assert.ok(result.blocks.every(block => !Object.hasOwn(block, 'html')));
});

// Scenario: The importer encounters a link with a non-HTTPS scheme or unsupported raw HTML.
// Purpose: Fail closed instead of dropping source meaning or passing executable markup into the renderer.
test('UnitT20_rejects_unsafe_links_and_unrecognized_html', () => {
  assert.throws(() => parseW15AnnouncementMarkdown('[不安全](javascript:alert(1))', { idPrefix: 'w15:test' }), /unsafe URL/u);
  assert.throws(() => parseW15AnnouncementMarkdown('<iframe src="https://example.test"></iframe>', { idPrefix: 'w15:test' }), /unsupported raw HTML/u);
});

// Scenario: A source snapshot carries a media occurrence but the immutable attachment bytes have not yet been pinned.
// Purpose: Preserve its source URL and alt text in a review candidate without inventing asset hashes or size metadata.
test('UnitT30_keeps_unpinned_media_explicit_and_never_fabricates_asset_metadata', () => {
  const result = parseW15AnnouncementMarkdown('![封面](https://images.example.test/cover.png)', {
    idPrefix: 'w15:pending', allowUnpinnedAssets: true,
  });
  assert.deepEqual(result.blocks[0], {
    blockId: 'w15:pending:block:1', kind: 'image', sourceUri: 'https://images.example.test/cover.png', alt: '封面',
  });
  assert.deepEqual(result.assetOccurrences, [{
    blockId: 'w15:pending:block:1', sourceUri: 'https://images.example.test/cover.png', alt: '封面',
  }]);
  assert.deepEqual(result.assets, []);
  assert.throws(() => parseW15AnnouncementMarkdown('![封面](https://images.example.test/cover.png)', { idPrefix: 'w15:strict' }), /metadata missing/u);
});

// Scenario: The five immutable Mods source snapshots and read-only GET asset receipt are present in the Web candidate checkout.
// Purpose: Prove exact source ownership, five-topic/date parity, all 44 image occurrences, all 27 asset pins, and the still-pending official-document scope.
test('UnitT40_imports_all_five_fixed_announcements_with_exact_source_and_asset_parity', async () => {
  const candidate = await buildW15AnnouncementCandidate();
  assert.equal(candidate.contractKind, 'w15-announcement-candidate');
  assert.equal(candidate.publicationEligible, false);
  assert.equal(candidate.reviewState, 'pending');
  assert.deepEqual(candidate.approvalReceipts, []);
  assert.equal(candidate.parity.announcementCount, 5);
  assert.equal(candidate.parity.imageOccurrenceCount, 44);
  assert.equal(candidate.parity.uniqueAssetCount, 27);
  assert.equal(candidate.parity.assetPinsVerified, true);
  assert.equal(candidate.parity.sourceBytesVerified, true);

  const expected = [
    ['2026-09-18', '即將推出的平衡性調整預覽', 6, 6],
    ['2026-09-23', '特色介紹：溢洪道關卡與視覺設計', 11, 10],
    ['2026-09-29', '1.13.0 更新公告：詛咒深淵', 19, 17],
    ['2026-10-01', '1.13.1 熱修更新公告', 4, 2],
    ['2026-10-06', '1.13.2 熱修更新公告', 4, 2],
  ];
  for (const [index, [date, title, images, assets]] of expected.entries()) {
    const row = candidate.announcements[index];
    assert.equal(row.publishedOn, date);
    assert.equal(row.title, title);
    assert.equal(row.scope, 'official-document');
    assert.equal(Object.hasOwn(row, 'gameReleaseId'), false);
    assert.equal(row.source.kind, 'official-game-source');
    assert.equal(row.sourceBinding.commit, '241ad76ce62330472aa423055a5b85db59bb6c0d');
    assert.match(row.sourceBinding.blobOid, /^[a-f0-9]{40}$/u);
    assert.equal(row.sourceBinding.sourceBytesSha256, row.source.sha256);
    assert.equal(row.reviewState, 'pending');
    assert.equal(row.imageOccurrences.length, images);
    assert.equal(row.assets.length, assets);
    assert.equal(new Set(row.occurrenceMap.map(item => item.blockId)).size, row.occurrenceMap.length);
  }

  const feature = candidate.announcements[1];
  assert.ok(feature.blocks.some(block => block.kind === 'quote'));
  assert.ok(feature.blocks.some(block => block.kind === 'paragraph' && block.inline.some(run => run.kind === 'link')));
  const patch = candidate.announcements[2];
  assert.equal(patch.importCounts.table, 3);
  assert.equal(patch.importCounts.tableRows, 27);
  assert.equal(patch.importCounts.tableCells, 81);
  assert.equal(patch.sourceLinks.filter(url => /^https:\/\/youtu\.be\//u.test(url)).length, 6);
  const historicalGlossary = 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/blob/241ad76ce62330472aa423055a5b85db59bb6c0d/Referneces/Translation.md';
  assert.equal(patch.sourceLinks.includes('/terms/'), false);
  assert.ok(patch.sourceLinks.includes(historicalGlossary));
  assert.ok(candidate.announcements.every(row => row.sourceLinks.includes(historicalGlossary)));
  const spillwayAlias = patch.sourceLinks.find(link => link.startsWith('/announcements/?id='));
  assert.ok(spillwayAlias);
  assert.equal(new URL(spillwayAlias, 'https://darktide.tw-syuan.com').searchParams.get('id'), 'official:darktide:announcement:2026-09-23-spillway-feature');
  assert.ok(candidate.announcements[3].blocks.some(block => block.kind === 'spoiler'));
  assert.ok(candidate.announcements.every(row => row.sourceLinks.includes(row.source.locator)));
});

// Scenario: One byte of a pinned announcement source snapshot changes after the manifest has been fixed.
// Purpose: Refuse stale or edited source content before producing a review candidate or route alias.
test('UnitT50_rejects_changed_source_snapshot_bytes', async t => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'w15-announcement-pin-'));
  t.after(async () => rm(temporaryRoot, { recursive: true, force: true }));
  await mkdir(path.join(temporaryRoot, 'content/authoring/v2/w15/source'), { recursive: true });
  await cp('content/authoring/v2/w15/announcement-source-inputs.json', path.join(temporaryRoot, 'content/authoring/v2/w15/announcement-source-inputs.json'), { recursive: true });
  for (const date of ['2026-09-18','2026-09-23','2026-09-29','2026-10-01','2026-10-06']) {
    await cp(`content/authoring/v2/w15/source/${date}.md`, path.join(temporaryRoot, `content/authoring/v2/w15/source/${date}.md`), { recursive: true });
  }
  const changedPath = path.join(temporaryRoot, 'content/authoring/v2/w15/source/2026-09-18.md');
  const changed = await readFile(changedPath);
  await writeFile(changedPath, Buffer.concat([changed, Buffer.from('\n', 'utf8')]));

  await assert.rejects(buildW15AnnouncementCandidate({ repoRoot: temporaryRoot }), /fixed source bytes changed/u);
});

// Scenario: The fixed M05 ledger points to all five imported announcement Markdown files and their individual source selectors.
// Purpose: Prove every original paragraph, list item, table cell, image, heading, and spoiler fragment resolves to one exact typed candidate occurrence.
test('UnitT60_maps_all_fixed_M05_rows_to_exact_candidate_occurrences', async () => {
  const candidate = await buildW15AnnouncementCandidate();
  const entries = await loadW15M05Entries();
  const sourceBytesByPath = new Map(await Promise.all(candidate.announcements.map(async row => [row.sourceBinding.path,
    new Uint8Array(await readFile(row.sourceBinding.inputPath))])));
  const mapped = mapW15AnnouncementRows({ entries, candidate, sourceBytesByPath });
  assert.equal(mapped.length, 1291);
  assert.equal(new Set(mapped.map(row => row.entryId)).size, 1291);
  assert.deepEqual(Object.fromEntries(Object.entries(Object.groupBy(mapped, row => row.target.kind)).map(([kind, rows]) => [kind, rows.length])), {
    paragraph: 273, 'table-cell': 81, heading: 60, image: 44, 'list-item': 832, spoiler: 1,
  });
  assert.ok(mapped.every(row => row.reviewState === 'pending' && row.target.announcementId
    && (row.target.blockId || row.target.blockIds?.length)));
  assert.deepEqual(Object.fromEntries(Object.entries(Object.groupBy(mapped, row => row.target.resolution))
    .map(([resolution, rows]) => [resolution, rows.length])), {
    direct: 1240,
    'legacy-paragraph-to-image-alt': 44,
    'legacy-paragraph-to-spoiler-label': 1,
    'legacy-paragraph-split-across-blocks': 6,
  });
  assert.ok(mapped.filter(row => row.target.resolution === 'legacy-paragraph-split-across-blocks')
    .every(row => row.target.blockIds.length > 1 && row.target.candidateFieldPath === 'announcement.blocks.paragraph'));

  const changed = structuredClone(entries[0]);
  changed.fragment.sha256 = '0'.repeat(64);
  assert.throws(() => mapW15AnnouncementRows({ entries: [changed], candidate, sourceBytesByPath }), /fragment/u);
  const missingOccurrence = structuredClone(candidate);
  missingOccurrence.announcements[0].occurrenceMap = missingOccurrence.announcements[0].occurrenceMap.filter(row => row.blockId !== mapped[0].target.blockId);
  assert.throws(() => mapW15AnnouncementRows({ entries: [entries[0]], candidate: missingOccurrence, sourceBytesByPath }), /occurrence/u);
});

// Scenario: Fixed M06 prompt rows are owned by Web, Source, and Private and need owner-specific maintained workflow destinations.
// Purpose: Preserve every source row and selector while preventing prompt text from being misfiled as game data or sent to the wrong owner.
test('UnitT70_maps_all_fixed_M06_prompt_rows_to_owner_workflows', async () => {
  const entries = await loadW15GroupEntries({ groupId: 'M06' });
  const mappings = mapW15WorkflowRows({ entries });
  assert.equal(entries.length, 771);
  assert.equal(mappings.length, 771);
  assert.equal(new Set(mappings.map(row => row.entryId)).size, 771);
  assert.deepEqual(Object.fromEntries(Object.entries(Object.groupBy(mappings, row => row.target.repoId))
    .map(([owner, rows]) => [owner, rows.length])), { web: 191, source: 464, private: 116 });
  assert.ok(mappings.every(row => row.status === 'mapped-to-owner-workflow'
    && row.source.fragmentSha256 && row.source.gitBlobOid && row.target.path.startsWith('docs/workflows/')));
  assert.equal(mappings.find(row => row.source.path.endsWith('/Dialogue-Text-Workflow.md')).target.repoId, 'private');
  assert.ok(mappings.filter(row => row.target.repoId === 'web').every(row => row.target.repoId !== 'source'));
});
