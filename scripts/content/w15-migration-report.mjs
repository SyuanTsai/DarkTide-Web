import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadW15M05Entries,
  buildW15M06MigrationReport,
  buildW15M07MigrationReport,
  buildW15M08MigrationReport,
  buildW15A17MigrationReport,
  mapW15AnnouncementRows,
} from './contract-w15-migration.mjs';
import { buildW15AnnouncementCandidate } from './w15-announcement-import.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'docs/contracts/w15');
const JSON_PATH = path.join(OUTPUT_ROOT, 'm06-row-map.json');
const MARKDOWN_PATH = path.join(OUTPUT_ROOT, 'm06-workflow-migration.md');
const M07_JSON_PATH = path.join(OUTPUT_ROOT, 'm07-tool-map.json');
const M07_MARKDOWN_PATH = path.join(OUTPUT_ROOT, 'm07-tool-migration.md');
const M08_JSON_PATH = path.join(OUTPUT_ROOT, 'm08-row-map.json');
const M08_MARKDOWN_PATH = path.join(OUTPUT_ROOT, 'm08-terminology-migration.md');
const M08_CANDIDATE_PATH = path.join(REPO_ROOT, 'content/authoring/v2/w15/term-candidates.json');
const M05_JSON_PATH = path.join(OUTPUT_ROOT, 'm05-announcement-row-map.json');
const M05_MARKDOWN_PATH = path.join(OUTPUT_ROOT, 'm05-announcement-row-migration.md');
const A17_JSON_PATH = path.join(OUTPUT_ROOT, 'a17-legacy-candidate-map.json');
const A17_MARKDOWN_PATH = path.join(OUTPUT_ROOT, 'a17-legacy-candidate-migration.md');
const OVERLAY_JSON_PATH = path.join(OUTPUT_ROOT, 'row-outcome-overlay.json');
const OVERLAY_MARKDOWN_PATH = path.join(OUTPUT_ROOT, 'migration-index.md');

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeWindowsLineEndings(value) {
  return value.replace(/\r\n/gu, '\n');
}

function renderMarkdown(report) {
  const owners = report.destinationOwners.map(owner =>
    `| ${owner.repoId} | ${owner.rowCount} |`).join('\n');
  return [
    '# M06 workflow migration',
    '',
    `This report maps ${report.source.entryCount} fixed W03 M06 prompt rows to owner-maintained workflow documents. It is a deterministic migration candidate, not a game-data approval or a publication action.`,
    '',
    `Source: [fixed W03 M06 entries](https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/tree/${report.source.commit}/AI%20Prompt), index SHA-256 ${report.source.indexSha256}.`,
    '',
    '| Destination owner | Rows |',
    '| --- | ---: |',
    owners,
    '',
    'The full row map preserves each source path, blob OID, selector, fragment SHA-256, source link, owner, and destination section in [m06-row-map.json](./m06-row-map.json). The historical prompt contents remain on their fixed source commit; the new owner documents describe the maintained workflow and do not execute archived prompt instructions.',
    '',
    'All rows are marked `mapped-to-owner-workflow`; this report creates no game-content review receipt, release identity, selection, or deployment.',
    '',
  ].join('\n');
}

function renderOwnerTable(report) {
  return report.destinationOwners.map(owner => `| ${owner.repoId} | ${owner.rowCount} |`).join('\n');
}

function renderM07Markdown(report) {
  return [
    '# M07 tool ownership map', '',
    `This report maps all ${report.rows.length} fixed W03 M07 tool paths to owner-maintained replacements. It is not a game-data approval or a publication action.`, '',
    `Source commit: [${report.source.commit}](https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/tree/${report.source.commit}/scripts/game-info); W03 index SHA-256 ${report.source.indexSha256}.`, '',
    '| Destination owner | Rows |', '| --- | ---: |', renderOwnerTable(report), '',
    `The nine-file Private tool export is read back against fixed commit ${report.privateToolBundle.fixedCommit} (${report.privateToolBundle.files.length} files, ${report.privateToolBundle.totalBytes} bytes). The three Python tools used by M07 are retained from that fixed Private bundle and compare byte-identically after CRLF/LF normalization; their W04 decoder provenance remains unchanged. The Limn README is copied byte-exact as documentation only. Source now carries the fixed local Markdown-reference checker and its two existing synthetic tests. These tools do not create game facts, fetch remote links, or reproduce the full legacy HTML/TSV output.`, '',
    'See [m07-tool-map.json](./m07-tool-map.json) for every entry ID, source blob, path, selector, target, and compatibility limit.', '',
  ].join('\n');
}

function renderM08Markdown(report) {
  return [
    '# M08 terminology and reference migration', '',
    `This report accounts for ${report.rows.length} fixed W03 M08 rows and ${report.termReferences.length} distinct text fragments by exact source path, byte selector, and fragment hash. New Source/Web terminology remains pending; no gameplay receipt or release is created.`, '',
    `Source commit: [${report.source.commit}](https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/tree/${report.source.commit}); W03 index SHA-256 ${report.source.indexSha256}.`, '',
    '| Destination owner | Rows |', '| --- | ---: |', renderOwnerTable(report), '',
    'MOD-only glossary/localization and workspace-archive rows remain at their exact fixed Mods paths. Source concepts and Web Traditional Chinese labels are separate pending candidate references; repeated text in different contexts remains separate. Historical notes are listed as reference material, not current mechanics.', '',
    'The full row map and excerpts are in [m08-row-map.json](./m08-row-map.json). The separate Web candidate is `content/authoring/v2/w15/term-candidates.json`; the Source reference-only candidate is `docs/references/w15/term-candidates.json` in DarkTide-Source-Data. Both remain pending and are outside the shared release inputs. Rebuild the Source copy from this repository with `node scripts/content/w15-migration-report.mjs --write-source-m08 <Source-repository-root>`; verify it with `--verify-source-m08 <Source-repository-root>`.', '',
  ].join('\n');
}

function sourceUrl(row) {
  const encoded = row.source.path.split('/').map(segment => encodeURIComponent(segment)).join('/');
  const match = row.source.selector?.locator?.match(/^L(\d+)(?:-L(\d+))?/u);
  const anchor = match ? `#L${match[1]}${match[2] ? `-L${match[2]}` : ''}` : '';
  return `https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/blob/${row.source.commit}/${encoded}${anchor}`;
}

export async function buildW15M05MigrationReport({ repoRoot = REPO_ROOT } = {}) {
  const root = path.resolve(repoRoot);
  const candidate = await buildW15AnnouncementCandidate({ repoRoot: root });
  const entries = await loadW15M05Entries({ repoRoot: root });
  const sourceBytesByPath = new Map(await Promise.all(candidate.announcements.map(async announcement => [
    announcement.sourceBinding.path,
    new Uint8Array(await readFile(path.join(root, announcement.sourceBinding.inputPath))),
  ])));
  const mapped = mapW15AnnouncementRows({ entries, candidate, sourceBytesByPath });
  const byId = new Map(candidate.announcements.map(announcement => [announcement.announcementId, announcement]));
  const rows = mapped.map(row => ({
    ...row,
    source: { ...row.source, url: sourceUrl(row) },
    status: 'candidate-pending-review',
    reviewState: 'pending',
    target: { ...row.target, owner: 'web', candidatePath: 'content/authoring/v2/w15/announcement-candidate.json' },
    sourceAnnouncement: {
      publishedOn: byId.get(row.target.announcementId).publishedOn,
      sourceSha256: byId.get(row.target.announcementId).source.sha256,
    },
  }));
  return {
    format: 'w15.m05-announcement-row-migration.v1',
    candidateOnly: true,
    publicationEligible: false,
    source: {
      repository: 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods',
      commit: '241ad76ce62330472aa423055a5b85db59bb6c0d',
      indexPath: 'docs/contracts/w03/mods/mapping-ledger.json',
      indexSha256: '90d1d27ed7673db16ff3c5b82640f2af7847466fc5a7a4fcd7d1f9795ee9af16',
      groupId: 'M05', entryCount: 1291,
    },
    decisions: {
      status: 'all-source-fragments-mapped-to-exact-candidate-occurrences',
      reviewState: 'pending', gameContentApprovalCreated: false,
      gitOrPublicationAction: false,
    },
    rows,
  };
}

export function buildW15SourceTermCandidate(report) {
  if (report?.format !== 'w15.m08-reference-migration.v1'
      || !Array.isArray(report.rows) || !Array.isArray(report.termReferences)) {
    throw new Error('Source term candidate requires the verified fixed M08 row report');
  }
  const sourceRows = report.rows.filter(row => row.target?.repoId === 'source');
  const sourceReferences = report.termReferences.filter(reference =>
    reference.owners?.some(owner => owner.repoId === 'source'));
  if (sourceRows.length !== 1332 || sourceReferences.length !== 1332) {
    throw new Error('fixed M08 Source row/reference count changed');
  }
  const terms = sourceReferences.map(reference => {
    const matches = sourceRows.filter(row => row.source?.path === reference.source?.path
      && row.source?.fragmentSha256 === reference.source?.fragmentSha256
      && JSON.stringify(row.source?.selector) === JSON.stringify(reference.source?.selector));
    if (matches.length !== 1 || matches[0].sourceText !== reference.sourceText) {
      throw new Error(`Source M08 reference does not bind one exact row: ${reference.referenceId}`);
    }
    return {
      referenceId: reference.referenceId,
      sourceText: reference.sourceText,
      source: reference.source,
      sourceRows: matches.map(row => ({
        repoId: 'mods',
        entryId: row.entryId,
        path: row.source.path,
        selector: row.source.selector,
        fragmentSha256: row.source.fragmentSha256,
      })),
      contexts: reference.owners.filter(owner => owner.repoId === 'source').map(owner => ({
        owner: 'source', fieldPath: owner.fieldPath, targetPath: owner.targetPath,
      })),
      status: 'candidate-pending-review',
      reviewState: 'pending',
      publicationEligible: false,
    };
  });
  if (new Set(terms.flatMap(term => term.sourceRows.map(row => row.entryId))).size !== sourceRows.length) {
    throw new Error('Source M08 candidate rows are not a one-to-one projection');
  }
  return {
    format: 'w15.source-term-reference-candidate.v1',
    candidateOnly: true,
    publicationEligible: false,
    reviewState: 'pending',
    source: report.source,
    decisions: {
      status: 'reference-candidate-only',
      approvalReceiptCreated: false,
      sourceReleaseAssigned: false,
      gameplayFactAsserted: false,
    },
    terms,
  };
}

export async function buildW15MigrationOverlay({ repoRoot = REPO_ROOT } = {}) {
  const root = path.resolve(repoRoot);
  const [m05, m06, m07, m08, a17] = await Promise.all([
    buildW15M05MigrationReport({ repoRoot: root }),
    buildW15M06MigrationReport({ repoRoot: root }),
    buildW15M07MigrationReport({ repoRoot: root }),
    buildW15M08MigrationReport({ repoRoot: root }),
    buildW15A17MigrationReport({ repoRoot: root }),
  ]);
  const reportGroups = [
    ['M05', m05], ['M06', m06], ['M07', m07], ['M08', m08], ['A17', a17],
  ];
  const groups = reportGroups.map(([groupId, report]) => {
    const counts = new Map();
    for (const row of report.rows) {
      const status = row.status ?? row.migrationStatus ?? 'unclassified';
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return {
      groupId,
      rowCount: report.rows.length,
      sourceIndexPath: report.source.indexPath ?? report.source.ledgerPath,
      sourceIndexSha256: report.source.indexSha256 ?? report.source.ledgerSha256,
      dispositions: [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => ({ status, count })),
    };
  });
  const rows = reportGroups.flatMap(([groupId, report]) => report.rows.map(row => ({
    ...row,
    w15Group: groupId,
    disposition: row.status ?? row.migrationStatus,
  })));
  if (groups.map(group => group.rowCount).join(',') !== '1291,771,8,2623,17'
      || rows.length !== 4710 || new Set(rows.map(row => row.entryId)).size !== rows.length
      || rows.some(row => !row.source?.path || !row.source?.commit || !row.target?.repoId || !row.target?.path || !row.disposition)) {
    throw new Error('fixed W15 migration rows are incomplete, duplicated, or missing their owner destination');
  }
  const pendingReviewRows = rows.filter(row => row.reviewState === 'pending').length;
  const privateToolReadbackPendingRows = rows.filter(row => row.status === 'owner-transfer-needs-fixed-tool-readback').length;
  return {
    format: 'w15.row-outcome-overlay.v1',
    candidateOnly: true,
    publicationEligible: false,
    source: {
      modsRepository: 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods',
      modsCommit: '241ad76ce62330472aa423055a5b85db59bb6c0d',
      modsIndexSha256: '90d1d27ed7673db16ff3c5b82640f2af7847466fc5a7a4fcd7d1f9795ee9af16',
      a17Index: a17.source,
    },
    totals: {
      originalRows: rows.length,
      groupCounts: groups,
      pendingReviewRows,
      privateToolReadbackPendingRows,
      retainedAtFixedSourceRows: rows.filter(row => row.status === 'retained-at-fixed-source').length,
      historicalReferenceRows: rows.filter(row => row.status === 'historical-reference-candidate').length,
      ownerWorkflowMappedRows: rows.filter(row => row.status === 'mapped-to-owner-workflow').length,
    },
    decisions: {
      status: 'all-fixed-rows-mapped; content review remains pending',
      gameContentApprovalCreated: false,
      selectionOrPublicationAction: false,
      pendingReviewRows,
      privateToolReadbackPendingRows,
      m05AnnouncementReviewState: 'pending',
      m08SourceAndWebTermReviewState: 'pending',
      a17ReviewState: 'pending-w01-candidate',
    },
    groups,
    rows,
  };
}

function renderOverlayMarkdown(overlay) {
  return [
    '# W15 migration index', '',
    'This index records fixed source-row destinations. It is not a content approval, selection, release allocation, or publication record.', '',
    `Total: ${overlay.totals.originalRows} rows (M05 ${overlay.groups[0].rowCount}, M06 ${overlay.groups[1].rowCount}, M07 ${overlay.groups[2].rowCount}, M08 ${overlay.groups[3].rowCount}, A17 ${overlay.groups[4].rowCount}).`, '',
    '| Group | Rows | Disposition |', '| --- | ---: | --- |',
    ...overlay.groups.flatMap(group => group.dispositions.map(disposition =>
      `| ${group.groupId} | ${disposition.count} | ${disposition.status} |`)), '',
    'M05 announcement rows map to five exact-source candidates and remain pending human review. A17 remains a separate pending W01 status candidate. M08 Source and Web terminology references remain pending; 78 MOD-only rows remain at their fixed source. M06 rows map to owner-maintained workflow documentation. All five M07 Private rows now have fixed-source and destination evidence; three Python tools are newline-normalized code reuse, the Limn README is byte-identical documentation, and the Private runbook records the supported scope. This does not create game-content approval.', '',
    '| Group detail | Fixed rows |', '| --- | ---: |',
    '| [M05 announcement row map](./m05-announcement-row-map.json) | 1,291 |',
    '| [M06 workflow row map](./m06-row-map.json) | 771 |',
    '| [M07 tool ownership map](./m07-tool-map.json) | 8 |',
    '| [M08 terminology row map](./m08-row-map.json) | 2,623 |',
    '| [A17 pending legacy candidate](./a17-legacy-candidate-map.json) | 17 |', '',
    'The Web announcement and terminology candidates are under `content/authoring/v2/w15/`; the Source-owned reference candidate is `docs/references/w15/term-candidates.json` in DarkTide-Source-Data. All remain outside release inputs until the existing owner review flow approves exact digests.', '',
    'See [row-outcome-overlay.json](./row-outcome-overlay.json) for every entry ID, source selector and hash, owner, target path/field, disposition, and review state. Rebuild or verify all reports with `node scripts/content/w15-migration-report.mjs --write-overlay` or `--verify-overlay` from the Web repository root. Rebuild or verify the Source-owned reference candidate with `node scripts/content/w15-migration-report.mjs --write-source-m08 <Source-repository-root>` or `--verify-source-m08 <Source-repository-root>`.', '',
  ].join('\n');
}

function renderM05Markdown(report) {
  return [
    '# M05 announcement row migration', '',
    `All ${report.rows.length} fixed W03 source rows map to exact typed occurrences in the five pending official-document candidates. The map does not create approval or assign a game release.`, '',
    `Source: [fixed W03 M05 entries](https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/tree/${report.source.commit}/公告); index SHA-256 ${report.source.indexSha256}.`, '',
    'Each row retains its exact source selector/fragment digest, target announcement/block, transformation rule, and pending review state in [m05-announcement-row-map.json](./m05-announcement-row-map.json).', '',
  ].join('\n');
}

function renderA17Markdown(report) {
  return [
    '# A17 legacy candidate preservation', '',
    'The 17 W03 fields remain the separate pending W01 candidate `web:announcement:w01-real-candidate-003`. Its source is an old W01 scope/status record, not one of the five official M05 documents; no rows were deduplicated or promoted.', '',
    `Fixed source: [${report.source.path} at ${report.source.commit}](https://github.com/SyuanTsai/DarkTide-Web/blob/${report.source.commit}/${report.source.path}); blob ${report.source.gitBlobOid}.`, '',
    'See [a17-legacy-candidate-map.json](./a17-legacy-candidate-map.json) for the 17 original entry IDs, selectors, fragment pins, scope, and pending state.', '',
  ].join('\n');
}

async function writeOrVerify({ mode, report, jsonPath, markdownPath, markdown, extraFiles = [] }) {
  const jsonBytes = serializeJson(report);
  const files = [[jsonPath, jsonBytes], [markdownPath, markdown], ...extraFiles];
  if (mode.startsWith('--write-')) {
    await mkdir(path.dirname(jsonPath), { recursive: true });
    for (const [filePath, contents] of files) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, 'utf8');
    }
    process.stdout.write(`${mode.match(/m0[5678]$/u)?.[0] ?? 'W15'} report written: ${report.rows.length} rows\n`);
    return;
  }
  for (const [filePath, expected] of files) {
    const actual = await readFile(filePath, 'utf8');
    if (actual !== expected) throw new Error(`${path.relative(REPO_ROOT, filePath)} differs from fixed W03 inputs`);
  }
  process.stdout.write(`${mode.match(/m0[5678]$/u)?.[0] ?? 'W15'} report verified: ${report.rows.length} rows\n`);
}

function m08CandidateProjection(report) {
  return {
    format: 'w15.web-term-reference-candidate.v1',
    candidateOnly: true,
    publicationEligible: false,
    reviewState: 'pending',
    sourceCommit: report.source.commit,
    sourceIndexSha256: report.source.indexSha256,
    approvalReceiptCreated: false,
    terms: report.termReferences.filter(reference => reference.owners.some(owner => owner.repoId === 'web'))
      .map(reference => ({
        referenceId: reference.referenceId,
        sourceText: reference.sourceText,
        source: reference.source,
        contexts: reference.owners.filter(owner => owner.repoId === 'web').map(owner => ({
          fieldPath: owner.fieldPath, destination: owner.targetPath,
        })),
        sourceRows: reference.rowIds,
        reviewState: 'pending',
      })),
  };
}

async function run() {
  const mode = process.argv[2];
  if (!['--write-m05','--verify-m05','--write-m06','--verify-m06','--write-m07','--verify-m07','--write-m08','--verify-m08','--write-a17','--verify-a17','--write-source-m08','--verify-source-m08','--write-overlay','--verify-overlay'].includes(mode)) {
    throw new Error('Usage: node scripts/content/w15-migration-report.mjs --write-{m05,m06,m07,m08,a17,overlay}|--verify-{m05,m06,m07,m08,a17,overlay}; Source export: --write-source-m08 <Source-repo-root>|--verify-source-m08 <Source-repo-root>');
  }
  if (mode.endsWith('overlay')) {
    const report = await buildW15MigrationOverlay();
    await writeOrVerify({ mode, report, jsonPath: OVERLAY_JSON_PATH, markdownPath: OVERLAY_MARKDOWN_PATH, markdown: renderOverlayMarkdown(report) });
    return;
  }
  if (mode.endsWith('source-m08')) {
    const sourceRoot = process.argv[3] && path.resolve(process.argv[3]);
    if (!sourceRoot) throw new Error(`${mode} requires a Source repository root`);
    const report = await buildW15M08MigrationReport();
    const candidate = buildW15SourceTermCandidate(report);
    const outputPath = path.join(sourceRoot, 'docs/references/w15/term-candidates.json');
    const expected = serializeJson(candidate);
    if (mode === '--write-source-m08') {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, expected, 'utf8');
      process.stdout.write(`Source M08 reference candidate written: ${candidate.terms.length} rows; pending, not publication eligible\n`);
      return;
    }
    const actual = await readFile(outputPath, 'utf8');
    if (normalizeWindowsLineEndings(actual) !== expected) throw new Error('Source M08 reference candidate differs from fixed W03 inputs');
    process.stdout.write(`Source M08 reference candidate verified: ${candidate.terms.length} rows; pending, not publication eligible\n`);
    return;
  }
  if (mode.endsWith('m05')) {
    const report = await buildW15M05MigrationReport();
    await writeOrVerify({ mode, report, jsonPath: M05_JSON_PATH, markdownPath: M05_MARKDOWN_PATH, markdown: renderM05Markdown(report) });
    return;
  }
  if (mode.endsWith('a17')) {
    const report = await buildW15A17MigrationReport();
    await writeOrVerify({ mode, report, jsonPath: A17_JSON_PATH, markdownPath: A17_MARKDOWN_PATH, markdown: renderA17Markdown(report) });
    return;
  }
  if (mode.endsWith('m07')) {
    const report = await buildW15M07MigrationReport();
    await writeOrVerify({ mode, report, jsonPath: M07_JSON_PATH, markdownPath: M07_MARKDOWN_PATH, markdown: renderM07Markdown(report) });
    return;
  }
  if (mode.endsWith('m08')) {
    const report = await buildW15M08MigrationReport();
    await writeOrVerify({ mode, report, jsonPath: M08_JSON_PATH, markdownPath: M08_MARKDOWN_PATH,
      markdown: renderM08Markdown(report), extraFiles: [[M08_CANDIDATE_PATH, serializeJson(m08CandidateProjection(report))]] });
    return;
  }
  const report = await buildW15M06MigrationReport();
  const jsonBytes = serializeJson(report);
  const markdown = renderMarkdown(report);
  if (mode === '--write-m06') {
    await mkdir(OUTPUT_ROOT, { recursive: true });
    await writeFile(JSON_PATH, jsonBytes, 'utf8');
    await writeFile(MARKDOWN_PATH, markdown, 'utf8');
    process.stdout.write(`M06 report written: ${report.rows.length} rows\n`);
    return;
  }
  const [actualJson, actualMarkdown] = await Promise.all([
    readFile(JSON_PATH, 'utf8'), readFile(MARKDOWN_PATH, 'utf8'),
  ]);
  if (actualJson !== jsonBytes || actualMarkdown !== markdown) throw new Error('M06 report differs from fixed W03 inputs');
  process.stdout.write(`M06 report verified: ${report.rows.length} rows\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
