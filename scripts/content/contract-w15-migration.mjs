import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { validateMappingEntry, verifyEntryFragment } from './contract-w03-mods.mjs';
import { validateMappingEntry as validateAEntry } from './contract-w03-ledger.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const W03_MODS_INDEX_PATH = 'docs/contracts/w03/mods/mapping-ledger.json';
const W03_MODS_INDEX_SHA256 = '90d1d27ed7673db16ff3c5b82640f2af7847466fc5a7a4fcd7d1f9795ee9af16';
const W03_M06_GROUP = Object.freeze({ entryCount: 771, ownerCounts: Object.freeze({ web: 191, source: 464, private: 116 }) });
const W03_M07_GROUP = Object.freeze({ entryCount: 8, ownerCounts: Object.freeze({ web: 1, source: 2, private: 5 }) });
const W03_M08_GROUP = Object.freeze({ entryCount: 2623 });
const W03_A17_SOURCE = Object.freeze({
  indexPath: 'docs/contracts/w03/mapping-ledger.json',
  indexSha256: 'bdf4b02c278e9dafef9aea00ac8263fe7929b29e9dc0eb90325cf7c55daa2288',
  groupId: 'web-w01-inputs',
  entryCount: 3988,
  shardPaths: Object.freeze([
    'extension/web-w01-inputs-0001.json',
    'extension/web-w01-inputs-0002.json',
  ]),
  recordId: 'web:announcement:w01-real-candidate-003',
  sourceCommit: '2816042d4a7380288ac8e73d1058a8accfe5687b',
  sourcePath: 'content/w01/web-authoring.json',
  sourceGitBlobOid: 'abd12fff64c1f32c80f59ef6e0d2ecff9cb83593',
  gameReleaseId: 'darktide:1.13.2',
  rowCount: 17,
});
const M08_SOURCE_INPUTS = Object.freeze([
  Object.freeze({
    sourcePath: 'Referneces/Translation.md',
    inputPath: 'docs/contracts/w15/source-inputs/translation-reference.md',
    sizeBytes: 45684,
    sha256: 'fb60e9e8b7beb81765ca50acb3483b9a10e3148e82f630bdf43878a8e45543a0',
    gitBlobOid: 'e7ad3b0524ad0ed0d64ef47bc8ebb7b6229640f4',
  }),
  Object.freeze({
    sourcePath: 'Darktide Translation Workspace/Term Candidates.md',
    inputPath: 'docs/contracts/w15/source-inputs/term-candidates.md',
    sizeBytes: 28390,
    sha256: '870fcda45b6978c7b48884f7d80c6fc43f38627948464a9cbe5bc15d7190f370',
    gitBlobOid: '22fa2612d66ab9d407aff63207595e3af0321e9a',
  }),
]);
const M05_GROUP = Object.freeze({
  entryCount: 1291,
  sourcePathCount: 5,
  sourceInventorySha256: '5c22f993d6241a27d27fda3c0cc57edbd7500a778d96e56651382696623a764d',
  shard: Object.freeze({
    path: 'mods/shards/m05-001.json',
    entryCount: 1291,
    sizeBytes: 2084584,
    sha256: '20a599a2ae8fa7c959df4cd9df8154e16d5428b4da101545ba7099f3165c7ae2',
  }),
});
const M06_WORKFLOW_TARGETS = Object.freeze({
  'AI Prompt/AI-Darktide-Announcement-Translation-Workflow.md': Object.freeze({
    owner: 'web', path: 'docs/workflows/announcements.md', section: 'official-announcement-intake',
  }),
  'AI Prompt/Blessings-Workflow.md': Object.freeze({
    owner: 'source', path: 'docs/workflows/blessings.md', section: 'blessing-variants-and-evidence',
  }),
  'AI Prompt/Dialogue-Text-Workflow.md': Object.freeze({
    owner: 'private', path: 'docs/workflows/dialogue-text.md', section: 'dialogue-source-boundary',
  }),
  'AI Prompt/Game-Info-Workflow.md': Object.freeze({
    owner: 'source', path: 'docs/workflows/content.md', section: 'game-info-source-workflow-handoff',
  }),
  'AI Prompt/Skill-Info-Workflow.md': Object.freeze({
    owner: 'source', path: 'docs/workflows/skills.md', section: 'skill-record-authoring',
  }),
  'AI Prompt/Skill-Pages-Workflow.md': Object.freeze({
    owner: 'web', path: 'docs/workflows/presentation.md', section: 'shared-skill-presentation',
  }),
});
const PRIVATE_TOOL_FIXED_COMMIT = '194e8b043f18f9f3c877ed6790118add47401a5e';
const PRIVATE_TOOL_BUNDLE_FILES = Object.freeze([
  Object.freeze({ path: 'tools/game-data/.gitattributes', gitBlobOid: 'a0003043c3fc17e265ad91d924c439bb5d99dc74', sha256: '21496524b31497586f8e3670b3d409c7bca059bde1fb13b9aad6b2d608dbdb43', bytes: 499 }),
  Object.freeze({ path: 'tools/game-data/.gitignore', gitBlobOid: '509e998cf9fb3d8be39e2356afb91619d0e800ca', sha256: '764b12c43e715cf3f6b7bb20052f8036064d570519ea119e7dc02ab330b6ca08', bytes: 241 }),
  Object.freeze({ path: 'tools/game-data/README.md', gitBlobOid: 'f0987d26588993b85b5c74172446adba1c558b81', sha256: 'a26aece8081511381bb3b5e668d2d70b9702d9b937235867ae38dee14c210b13', bytes: 8194 }),
  Object.freeze({ path: 'tools/game-data/SOURCE.json', gitBlobOid: '563f904fa9f0e6c7990d7b66268b93e6df9a17b7', sha256: '850e2c41e387e153635c6be53960a4bc76dcff86c11f23138b588194e5728360', bytes: 1038 }),
  Object.freeze({ path: 'tools/game-data/decode_strings.py', gitBlobOid: '624e377f6fdeb18ee16eb7ca26ad90c6e10d4cd9', sha256: 'fcc7fbac2b2e4cf51440388b496eafa85ac10cbea549c0af6dce03d90a18c230', bytes: 6786 }),
  Object.freeze({ path: 'tools/game-data/compare_text_exports.py', gitBlobOid: 'd05698916e6d6022bd825653890d53686e243f59', sha256: 'd3142596091e02dce186fc3cf05cc513d94c77237c591ec9eae2246d89e59784', bytes: 4974 }),
  Object.freeze({ path: 'tools/game-data/verify_exports.py', gitBlobOid: '2a4d75b99913530dd52cb54c26a3d7ece280d228', sha256: '99717f100eb3b0cee40cdc0b326d673e74c3172e93114b146fff41c0a5dfdc98', bytes: 2271 }),
  Object.freeze({ path: 'tools/game-data/export_w04_candidate.py', gitBlobOid: '5f43aba5784401ff3fbade106458699205862d0d', sha256: 'c927804f7845ae8c888c59aa14cc9e3c5156bbb5032f188104f72d0944fa49d5', bytes: 21214 }),
  Object.freeze({ path: 'tools/game-data/test_export_w04_candidate.py', gitBlobOid: 'af65be66c770b97feb5c67fa184af6c1bf33a64c', sha256: '99a1f5c2702c37aff67287d72a87241090db83ff8b269e73f5d8191362d1685c', bytes: 24019 }),
]);
const PRIVATE_TOOL_SOURCE_COMPARISONS = Object.freeze({
  'scripts/game-info/compare_text_exports.py': Object.freeze({ sourceSha256: 'e6cc60d14004e494ddbb1d37c5bba69f87e713580adec28eac0022d1fc9db71e', sourceBytes: 4901, targetSha256: 'd3142596091e02dce186fc3cf05cc513d94c77237c591ec9eae2246d89e59784', targetBytes: 4974, targetBlobOid: 'd05698916e6d6022bd825653890d53686e243f59' }),
  'scripts/game-info/decode_strings.py': Object.freeze({ sourceSha256: '06f9604ef036b2ce47a2442709be94620a51ef511ab9f1869dfd2d9f232dc51b', sourceBytes: 6656, targetSha256: 'fcc7fbac2b2e4cf51440388b496eafa85ac10cbea549c0af6dce03d90a18c230', targetBytes: 6786, targetBlobOid: '624e377f6fdeb18ee16eb7ca26ad90c6e10d4cd9' }),
  'scripts/game-info/verify_exports.py': Object.freeze({ sourceSha256: '7d030495d2c9c2bea6d56d2cc84b95992f6008ec557eab45bd56c2295b9e1dd9', sourceBytes: 2233, targetSha256: '99717f100eb3b0cee40cdc0b326d673e74c3172e93114b146fff41c0a5dfdc98', targetBytes: 2271, targetBlobOid: '2a4d75b99913530dd52cb54c26a3d7ece280d228' }),
});
const M07_TOOL_TARGETS = Object.freeze({
  'scripts/game-info/README.md': Object.freeze({
    owner: 'private', path: 'tools/game-data/README.md', status: 'private-owner-runbook-extended-for-m07',
    note: 'The existing Private runbook is retained and extended with M07 scope, fixed tool provenance, and compatibility limits; it is not a byte-for-byte copy of this older Mods README.',
    destinationEvidence: Object.freeze({ fixedCommit: PRIVATE_TOOL_FIXED_COMMIT, fixedBlobOid: 'f0987d26588993b85b5c74172446adba1c558b81', fixedSha256: 'a26aece8081511381bb3b5e668d2d70b9702d9b937235867ae38dee14c210b13', currentWorktreeSha256: 'dddca98d3fd8bd3f60c0c9fb5ccea8dda76c9c148f9f17073d041f1425e5ffa4', currentWorktreeBytes: 9252 }),
  }),
  'scripts/game-info/compare_text_exports.py': Object.freeze({
    owner: 'private', path: 'tools/game-data/compare_text_exports.py', status: 'private-fixed-tool-reused-line-endings-only',
    note: 'Existing fixed Private W04 comparator is retained; the pinned M07 source and destination are identical after CRLF/LF normalization.',
    sourceComparison: Object.freeze({ ...PRIVATE_TOOL_SOURCE_COMPARISONS['scripts/game-info/compare_text_exports.py'], method: 'crlf-lf-normalization', normalizedContentEqual: true }),
    destinationEvidence: Object.freeze({ fixedCommit: PRIVATE_TOOL_FIXED_COMMIT, fixedBlobOid: 'd05698916e6d6022bd825653890d53686e243f59', sha256: 'd3142596091e02dce186fc3cf05cc513d94c77237c591ec9eae2246d89e59784', bytes: 4974 }),
  }),
  'scripts/game-info/decode_strings.py': Object.freeze({
    owner: 'private', path: 'tools/game-data/decode_strings.py', status: 'private-fixed-tool-reused-line-endings-only',
    note: 'Existing fixed Private W04 decoder is retained so the pinned exporter decoder SHA remains valid; source behavior is identical after CRLF/LF normalization.',
    sourceComparison: Object.freeze({ ...PRIVATE_TOOL_SOURCE_COMPARISONS['scripts/game-info/decode_strings.py'], method: 'crlf-lf-normalization', normalizedContentEqual: true }),
    destinationEvidence: Object.freeze({ fixedCommit: PRIVATE_TOOL_FIXED_COMMIT, fixedBlobOid: '624e377f6fdeb18ee16eb7ca26ad90c6e10d4cd9', sha256: 'fcc7fbac2b2e4cf51440388b496eafa85ac10cbea549c0af6dce03d90a18c230', bytes: 6786 }),
  }),
  'scripts/game-info/verify_exports.py': Object.freeze({
    owner: 'private', path: 'tools/game-data/verify_exports.py', status: 'private-fixed-tool-reused-line-endings-only',
    note: 'Existing fixed Private W04 verifier is retained; the pinned M07 source and destination are identical after CRLF/LF normalization.',
    sourceComparison: Object.freeze({ ...PRIVATE_TOOL_SOURCE_COMPARISONS['scripts/game-info/verify_exports.py'], method: 'crlf-lf-normalization', normalizedContentEqual: true }),
    destinationEvidence: Object.freeze({ fixedCommit: PRIVATE_TOOL_FIXED_COMMIT, fixedBlobOid: '2a4d75b99913530dd52cb54c26a3d7ece280d228', sha256: '99717f100eb3b0cee40cdc0b326d673e74c3172e93114b146fff41c0a5dfdc98', bytes: 2271 }),
  }),
  'scripts/game-info/vendor/limn/README.md': Object.freeze({
    owner: 'private', path: 'tools/game-data/vendor/limn/README.md', status: 'private-limn-readme-copied-byte-exact',
    note: 'The fixed Limn README is retained as documentation only; no executable, DLL, dictionary, or game data is copied.',
    sourceComparison: Object.freeze({ method: 'byte-identical', sourceSha256: '1687543a46def668a7c7f74232e8e2bcbf3d7509984a5b13c16b154efb50eb32', targetSha256: '1687543a46def668a7c7f74232e8e2bcbf3d7509984a5b13c16b154efb50eb32', sourceBytes: 2680, targetBytes: 2680 }),
    destinationEvidence: Object.freeze({ gitBlobOid: '87b20c77d20067e1db2411abaae458d5826200a7', sha256: '1687543a46def668a7c7f74232e8e2bcbf3d7509984a5b13c16b154efb50eb32', bytes: 2680 }),
  }),
  'scripts/game-info/render_skill_pages.mjs': Object.freeze({
    owner: 'web', path: 'web/shared-render.mjs', status: 'replaced-with-scoped-player-renderer',
    note: 'The shared renderer presents validated player content; it does not recreate full mechanics HTML or TSV exports.',
  }),
  'scripts/game-info/validate_game_info.py': Object.freeze({
    owner: 'source', path: 'scripts/game-info/validate_game_info.py', status: 'migrated-exact-local-markdown-reference-check',
    note: 'Preserves the separate local Markdown link/image/anchor check; it does not replace the typed Source content validator and does not fetch remote references.',
    sourceComparison: Object.freeze({ method: 'byte-identical', sourceSha256: '3743e6a7bac14768a5bae64fe0c78e70803d0c1c8e74a280a8229bf9f37b7ec3', targetSha256: '3743e6a7bac14768a5bae64fe0c78e70803d0c1c8e74a280a8229bf9f37b7ec3', sourceBytes: 3597, targetBytes: 3597 }),
    destinationEvidence: Object.freeze({ gitBlobOid: '0d0babf7ebcef8c486c3387209a713a85d6b5b16', sha256: '3743e6a7bac14768a5bae64fe0c78e70803d0c1c8e74a280a8229bf9f37b7ec3', bytes: 3597 }),
  }),
  'scripts/game-info/tests/test_validate_game_info.py': Object.freeze({
    owner: 'source', path: 'scripts/game-info/tests/test_validate_game_info.py', status: 'migrated-existing-synthetic-local-reference-tests',
    note: 'Preserves the two existing synthetic tests for explicit history exclusions and source inclusion; it is not a game-content approval test.',
    sourceComparison: Object.freeze({ method: 'byte-identical', sourceSha256: '3101239bc15555b6f673048211f0b5a71b8dc750df2294b55d3dfee3ffec82ce', targetSha256: '3101239bc15555b6f673048211f0b5a71b8dc750df2294b55d3dfee3ffec82ce', sourceBytes: 2490, targetBytes: 2490 }),
    destinationEvidence: Object.freeze({ gitBlobOid: '783c33b6b6fd5a2e4af16342cd147434a0ee548b', sha256: '3101239bc15555b6f673048211f0b5a71b8dc750df2294b55d3dfee3ffec82ce', bytes: 2490 }),
  }),
});
const ROW_KIND = Object.freeze({
  'announcement.blocks.paragraph': 'paragraph',
  'announcement.blocks.heading': 'heading',
  'announcement.blocks.listitem': 'list-item',
  'announcement.blocks.tablecell': 'table-cell',
  'announcement.blocks.spoilercontainer': 'spoiler',
  'announcement.assets.reference': 'image',
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function parseJson(bytes, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error(`${label} is not valid UTF-8 JSON`); }
}

function readSelector(entry) {
  const locator = entry.selector?.locator;
  let match;
  if (typeof locator !== 'string') throw new Error(`M05 selector is missing: ${entry.entryId}`);
  match = locator.match(/^L(\d+)(?:-L(\d+))?:paragraph$/u);
  if (match) return { kind: 'paragraph', sourceLineStart: Number(match[1]), sourceLineEnd: Number(match[2] ?? match[1]) };
  match = locator.match(/^L(\d+):heading$/u);
  if (match) return { kind: 'heading', sourceLine: Number(match[1]) };
  match = locator.match(/^L(\d+):listitem$/u);
  if (match) return { kind: 'list-item', sourceLine: Number(match[1]) };
  match = locator.match(/^L(\d+):cell:(\d+)$/u);
  if (match) return { kind: 'table-cell', sourceLine: Number(match[1]), sourceCellIndex: Number(match[2]) };
  match = locator.match(/^L(\d+):C\d+:image$/u);
  if (match) return { kind: 'image', sourceLine: Number(match[1]) };
  match = locator.match(/^L(\d+)-L(\d+):spoilercontainer$/u);
  if (match) return { kind: 'spoiler', sourceLineStart: Number(match[1]), sourceLineEnd: Number(match[2]) };
  throw new Error(`M05 selector is unsupported: ${entry.entryId}`);
}

function matchesSelector(occurrence, selector) {
  if (occurrence.kind !== selector.kind || !occurrence.location || typeof occurrence.location !== 'object') return false;
  const location = occurrence.location;
  if (selector.sourceLine !== undefined) return location.sourceLine === selector.sourceLine
    && (selector.sourceCellIndex === undefined || location.sourceCellIndex === selector.sourceCellIndex);
  return location.sourceLineStart === selector.sourceLineStart && location.sourceLineEnd === selector.sourceLineEnd;
}

function blockForOccurrence(announcement, occurrence) {
  return collectBlockIds(announcement.blocks).get(occurrence.blockId);
}

function fixedModsSourceUrl({ commit, path: sourcePath, selector }) {
  const encodedPath = sourcePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
  const lineMatch = selector?.locator?.match(/^L(\d+)(?:-L(\d+))?/u);
  const lineAnchor = lineMatch ? `#L${lineMatch[1]}${lineMatch[2] ? `-L${lineMatch[2]}` : ''}` : '';
  return `https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/blob/${commit}/${encodedPath}${lineAnchor}`;
}

function mapParagraphSelector({ announcement, selector, sourceLines }) {
  const direct = announcement.occurrenceMap.filter(row => row.kind === 'paragraph'
    && (selector.sourceLineStart === selector.sourceLineEnd
      ? (row.location.sourceLine === selector.sourceLineStart
        || (row.location.sourceLineStart === selector.sourceLineStart && row.location.sourceLineEnd === selector.sourceLineEnd))
      : (row.location.sourceLineStart === selector.sourceLineStart && row.location.sourceLineEnd === selector.sourceLineEnd)));
  if (direct.length === 1) return { occurrences: direct, candidateFieldPath: 'announcement.blocks.paragraph', resolution: 'direct' };
  if (direct.length > 1) throw new Error('W15 paragraph occurrence is ambiguous');

  if (selector.sourceLineStart === selector.sourceLineEnd) {
    const line = sourceLines[selector.sourceLineStart - 1]?.trim();
    const image = line?.match(/^!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)$/u);
    if (image) {
      const mediaOccurrences = announcement.occurrenceMap.filter(row => row.kind === 'image'
        && row.location.sourceLine === selector.sourceLineStart && row.location.sourceUri === image[2]);
      if (mediaOccurrences.length === 1 && blockForOccurrence(announcement, mediaOccurrences[0])?.alt === image[1]) {
        return {
          occurrences: mediaOccurrences,
          candidateFieldPath: 'announcement.blocks.image.alt',
          resolution: 'legacy-paragraph-to-image-alt',
        };
      }
    }

    const summary = line?.match(/^<summary>([^<]+)<\/summary>$/u);
    if (summary) {
      const spoilerOccurrences = announcement.occurrenceMap.filter(row => row.kind === 'spoiler'
        && row.location.sourceLineStart < selector.sourceLineStart
        && row.location.sourceLineEnd > selector.sourceLineStart);
      const matches = spoilerOccurrences.filter(row => blockForOccurrence(announcement, row)?.label === summary[1].trim());
      if (matches.length === 1) {
        return {
          occurrences: matches,
          candidateFieldPath: 'announcement.blocks.spoiler.label',
          resolution: 'legacy-paragraph-to-spoiler-label',
        };
      }
    }
  }

  const lineOccurrences = [];
  for (let sourceLine = selector.sourceLineStart; sourceLine <= selector.sourceLineEnd; sourceLine++) {
    const matches = announcement.occurrenceMap.filter(row => row.kind === 'paragraph' && row.location.sourceLine === sourceLine);
    if (matches.length !== 1) return null;
    lineOccurrences.push(matches[0]);
  }
  return lineOccurrences.length > 1
    ? { occurrences: lineOccurrences, candidateFieldPath: 'announcement.blocks.paragraph', resolution: 'legacy-paragraph-split-across-blocks' }
    : null;
}

function collectBlockIds(blocks, output = new Map()) {
  for (const block of blocks ?? []) {
    if (typeof block?.blockId === 'string') output.set(block.blockId, block);
    for (const row of block?.rows ?? []) for (const cell of row.cells ?? []) {
      if (typeof cell.blockId === 'string') output.set(cell.blockId, cell);
    }
    for (const item of block?.items ?? []) {
      if (typeof item.blockId === 'string') output.set(item.blockId, item);
      if (item.children) collectBlockIds(item.children, output);
    }
    if (block?.blocks) collectBlockIds(block.blocks, output);
  }
  return output;
}

/** Load the one fixed M05 W03 shard, validating the immutable index and shard pins. */
export async function loadW15M05Entries({ repoRoot = REPO_ROOT } = {}) {
  const root = path.resolve(repoRoot);
  const indexBytes = await readFile(path.join(root, W03_MODS_INDEX_PATH));
  if (sha256(indexBytes) !== W03_MODS_INDEX_SHA256) throw new Error('fixed W03 Mods index SHA-256 mismatch');
  const index = parseJson(indexBytes, 'fixed W03 Mods index');
  if (index.format !== 'w03-mods-mapping-ledger.v1' || index.entrySchemaVersion !== 'w03.mapping-entry.v1'
      || index.source?.repoId !== 'mods' || index.source?.commit !== '241ad76ce62330472aa423055a5b85db59bb6c0d') {
    throw new Error('fixed W03 Mods index identity mismatch');
  }
  const group = index.groups?.find(row => row.groupId === 'M05');
  if (!group || group.entryCount !== M05_GROUP.entryCount || group.sourcePathCount !== M05_GROUP.sourcePathCount
      || group.sourceInventorySha256 !== M05_GROUP.sourceInventorySha256 || group.shards?.length !== 1
      || JSON.stringify(group.shards[0]) !== JSON.stringify(M05_GROUP.shard)) {
    throw new Error('fixed W03 M05 group descriptor mismatch');
  }
  const shardBytes = await readFile(path.join(root, 'docs/contracts/w03', M05_GROUP.shard.path));
  if (shardBytes.length !== M05_GROUP.shard.sizeBytes || sha256(shardBytes) !== M05_GROUP.shard.sha256) {
    throw new Error('fixed W03 M05 shard raw bytes mismatch');
  }
  const entries = parseJson(shardBytes, 'fixed W03 M05 shard');
  if (!Array.isArray(entries) || entries.length !== M05_GROUP.entryCount) throw new Error('fixed W03 M05 row count mismatch');
  for (const entry of entries) {
    const issues = validateMappingEntry(entry);
    if (issues.length) throw new Error(`fixed W03 M05 row is invalid: ${entry?.entryId ?? 'unknown'}`);
    if (entry.source.repoId !== 'mods' || entry.source.commit !== index.source.commit || entry.owner !== 'web'
        || entry.scope?.releaseScope !== 'announcement-original' || entry.intendedDisposition !== 'migrated') {
      throw new Error(`fixed W03 M05 row identity mismatch: ${entry.entryId}`);
    }
  }
  return entries;
}

/** Load a W15-relevant fixed W03 Mods group using only the W03 index's pinned shard descriptors. */
export async function loadW15GroupEntries({ groupId, repoRoot = REPO_ROOT } = {}) {
  if (!['M05', 'M06', 'M07', 'M08'].includes(groupId)) throw new Error('W15 group is outside the fixed migration scope');
  const root = path.resolve(repoRoot);
  const indexBytes = await readFile(path.join(root, W03_MODS_INDEX_PATH));
  if (sha256(indexBytes) !== W03_MODS_INDEX_SHA256) throw new Error('fixed W03 Mods index SHA-256 mismatch');
  const index = parseJson(indexBytes, 'fixed W03 Mods index');
  if (index.format !== 'w03-mods-mapping-ledger.v1' || index.entrySchemaVersion !== 'w03.mapping-entry.v1'
      || index.source?.repoId !== 'mods' || index.source?.commit !== '241ad76ce62330472aa423055a5b85db59bb6c0d') {
    throw new Error('fixed W03 Mods index identity mismatch');
  }
  const group = index.groups?.find(row => row.groupId === groupId);
  if (!group || !Number.isSafeInteger(group.entryCount) || !Array.isArray(group.shards) || !group.shards.length) {
    throw new Error(`fixed W03 ${groupId} group descriptor is invalid`);
  }
  const entries = [];
  for (const descriptor of group.shards) {
    if (typeof descriptor.path !== 'string' || descriptor.path.startsWith('/') || descriptor.path.includes('..')
        || !Number.isSafeInteger(descriptor.entryCount) || !Number.isSafeInteger(descriptor.sizeBytes)
        || !/^[a-f0-9]{64}$/u.test(descriptor.sha256)) {
      throw new Error(`fixed W03 ${groupId} shard descriptor is invalid`);
    }
    const shardBytes = await readFile(path.join(root, 'docs/contracts/w03', descriptor.path));
    if (shardBytes.length !== descriptor.sizeBytes || sha256(shardBytes) !== descriptor.sha256) {
      throw new Error(`fixed W03 ${groupId} shard raw bytes mismatch`);
    }
    const shardEntries = parseJson(shardBytes, `fixed W03 ${groupId} shard`);
    if (!Array.isArray(shardEntries) || shardEntries.length !== descriptor.entryCount) {
      throw new Error(`fixed W03 ${groupId} shard row count mismatch`);
    }
    entries.push(...shardEntries);
  }
  if (entries.length !== group.entryCount) throw new Error(`fixed W03 ${groupId} group row count mismatch`);
  const seen = new Set();
  for (const entry of entries) {
    const issues = validateMappingEntry(entry);
    if (issues.length) throw new Error(`fixed W03 ${groupId} row is invalid: ${entry?.entryId ?? 'unknown'}`);
    if (entry.source.repoId !== 'mods' || entry.source.commit !== index.source.commit || seen.has(entry.entryId)) {
      throw new Error(`fixed W03 ${groupId} row identity is invalid: ${entry?.entryId ?? 'unknown'}`);
    }
    seen.add(entry.entryId);
  }
  return entries;
}

/** Bind fixed M06 prompt rows to workflow documentation in their preassigned owner repository. */
export function mapW15WorkflowRows({ entries } = {}) {
  if (!Array.isArray(entries) || entries.length !== W03_M06_GROUP.entryCount) {
    throw new Error('fixed W03 M06 workflow rows are incomplete');
  }
  const seen = new Set();
  const mappings = entries.map(entry => {
    if (seen.has(entry.entryId)) throw new Error(`W15 M06 source row is repeated: ${entry.entryId}`);
    seen.add(entry.entryId);
    const target = M06_WORKFLOW_TARGETS[entry.source?.path];
    if (!target || entry.owner !== target.owner || entry.source?.repoId !== 'mods'
        || entry.source?.commit !== '241ad76ce62330472aa423055a5b85db59bb6c0d'
        || !['workflow.promptSection', 'promptArchive.dialogueWorkflow'].includes(entry.target?.fieldPath)) {
      throw new Error(`W15 M06 row has no matching owner workflow: ${entry.entryId}`);
    }
    return {
      entryId: entry.entryId,
      source: {
        repoId: entry.source.repoId, commit: entry.source.commit, path: entry.source.path,
        gitBlobOid: entry.source.gitBlobOid, selector: structuredClone(entry.selector),
        fragmentSha256: entry.fragment.sha256,
        url: fixedModsSourceUrl({ commit: entry.source.commit, path: entry.source.path, selector: entry.selector }),
      },
      status: 'mapped-to-owner-workflow',
      reviewState: 'not-applicable',
      target: {
        repoId: target.owner, path: target.path, section: target.section,
        sourceDisposition: entry.intendedDisposition,
      },
    };
  });
  const ownerCounts = Object.fromEntries(Object.entries(Object.groupBy(mappings, row => row.target.repoId))
    .map(([owner, rows]) => [owner, rows.length]));
  if (ownerCounts.web !== W03_M06_GROUP.ownerCounts.web || ownerCounts.source !== W03_M06_GROUP.ownerCounts.source
      || ownerCounts.private !== W03_M06_GROUP.ownerCounts.private) {
    throw new Error('fixed W03 M06 owner counts changed');
  }
  return mappings;
}

/** Build a deterministic owner crosswalk for every pinned M06 prompt row. */
export async function buildW15M06MigrationReport({ repoRoot = REPO_ROOT } = {}) {
  const entries = await loadW15GroupEntries({ groupId: 'M06', repoRoot });
  const rows = mapW15WorkflowRows({ entries });
  return {
    format: 'w15.m06-workflow-migration.v1',
    candidateOnly: true,
    publicationEligible: false,
    source: {
      repository: 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods',
      commit: '241ad76ce62330472aa423055a5b85db59bb6c0d',
      indexPath: W03_MODS_INDEX_PATH,
      indexSha256: W03_MODS_INDEX_SHA256,
      groupId: 'M06',
      entryCount: W03_M06_GROUP.entryCount,
    },
    destinationOwners: [
      { repoId: 'source', rowCount: W03_M06_GROUP.ownerCounts.source },
      { repoId: 'web', rowCount: W03_M06_GROUP.ownerCounts.web },
      { repoId: 'private', rowCount: W03_M06_GROUP.ownerCounts.private },
    ],
    decisions: {
      status: 'mapped-to-owner-workflow',
      reviewState: 'not-applicable',
      gameContentApprovalCreated: false,
      gitOrPublicationAction: false,
    },
    rows,
  };
}

function sourceLineUrl(entry) {
  const match = entry.selector?.locator?.match(/^L(\d+)(?:-L(\d+))?/u);
  const encodedPath = entry.source.path.split('/').map(segment => encodeURIComponent(segment)).join('/');
  const anchor = match ? `#L${match[1]}${match[2] ? `-L${match[2]}` : ''}` : '';
  return `https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/blob/${entry.source.commit}/${encodedPath}${anchor}`;
}

/** Map every fixed M07 tool path to its current owner and record compatibility limits. */
export function mapW15ToolRows({ entries } = {}) {
  if (!Array.isArray(entries) || entries.length !== W03_M07_GROUP.entryCount) {
    throw new Error('fixed W03 M07 tool rows are incomplete');
  }
  const seen = new Set();
  const rows = entries.map(entry => {
    if (seen.has(entry.entryId)) throw new Error(`W15 M07 source row is repeated: ${entry.entryId}`);
    seen.add(entry.entryId);
    const target = M07_TOOL_TARGETS[entry.source?.path];
    if (!target || entry.owner !== target.owner || entry.source?.repoId !== 'mods'
        || entry.source?.commit !== '241ad76ce62330472aa423055a5b85db59bb6c0d'
        || entry.selector?.kind !== 'file' || entry.selector.locator !== 'file'
        || entry.fragment?.normalization !== 'git-blob' || entry.fragment.gitBlobOid !== entry.source.gitBlobOid) {
      throw new Error(`fixed W03 M07 tool row has no exact owner mapping: ${entry.entryId}`);
    }
    return {
      entryId: entry.entryId,
      source: {
        repoId: entry.source.repoId, commit: entry.source.commit, path: entry.source.path,
        gitBlobOid: entry.source.gitBlobOid, fragmentGitBlobOid: entry.fragment.gitBlobOid,
        selector: structuredClone(entry.selector), url: sourceLineUrl(entry),
      },
      status: target.status,
      reviewState: 'not-applicable',
      target: { repoId: target.owner, path: target.path, note: target.note },
      ...(target.sourceComparison ? { sourceComparison: structuredClone(target.sourceComparison) } : {}),
      ...(target.destinationEvidence ? { destinationEvidence: structuredClone(target.destinationEvidence) } : {}),
    };
  });
  const ownerCounts = Object.fromEntries(Object.entries(Object.groupBy(rows, row => row.target.repoId))
    .map(([owner, grouped]) => [owner, grouped.length]));
  if (ownerCounts.web !== W03_M07_GROUP.ownerCounts.web || ownerCounts.source !== W03_M07_GROUP.ownerCounts.source
      || ownerCounts.private !== W03_M07_GROUP.ownerCounts.private) throw new Error('fixed W03 M07 owner counts changed');
  return rows;
}

/** Build a deterministic M07 owner map without implying byte transfer or tool approval. */
export async function buildW15M07MigrationReport({ repoRoot = REPO_ROOT } = {}) {
  const entries = await loadW15GroupEntries({ groupId: 'M07', repoRoot });
  const rows = mapW15ToolRows({ entries });
  return {
    format: 'w15.m07-tool-migration.v1', candidateOnly: true, publicationEligible: false,
    source: {
      repository: 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods',
      commit: '241ad76ce62330472aa423055a5b85db59bb6c0d', indexPath: W03_MODS_INDEX_PATH,
      indexSha256: W03_MODS_INDEX_SHA256, groupId: 'M07', entryCount: W03_M07_GROUP.entryCount,
    },
    destinationOwners: [
      { repoId: 'source', rowCount: W03_M07_GROUP.ownerCounts.source },
      { repoId: 'web', rowCount: W03_M07_GROUP.ownerCounts.web },
      { repoId: 'private', rowCount: W03_M07_GROUP.ownerCounts.private },
    ],
    privateToolBundle: {
      fixedCommit: PRIVATE_TOOL_FIXED_COMMIT,
      files: PRIVATE_TOOL_BUNDLE_FILES.map(file => ({ ...file })),
      totalBytes: PRIVATE_TOOL_BUNDLE_FILES.reduce((total, file) => total + file.bytes, 0),
    },
    decisions: {
      status: 'owner-mapped-with-explicit-compatibility-limits', reviewState: 'not-applicable',
      gameContentApprovalCreated: false, gitOrPublicationAction: false,
      privateToolReadbackCommit: PRIVATE_TOOL_FIXED_COMMIT,
      privateToolReadbackStatus: 'fixed-private-export-byte-verified',
      privateToolReadbackFileCount: PRIVATE_TOOL_BUNDLE_FILES.length,
    },
    rows,
  };
}

async function readPinnedM08SourceInputs({ repoRoot }) {
  const inputs = new Map();
  for (const descriptor of M08_SOURCE_INPUTS) {
    const bytes = await readFile(path.join(repoRoot, descriptor.inputPath));
    const blobOid = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`, 'utf8')).update(bytes).digest('hex');
    if (bytes.length !== descriptor.sizeBytes || sha256(bytes) !== descriptor.sha256 || blobOid !== descriptor.gitBlobOid) {
      throw new Error(`fixed M08 source input bytes changed: ${descriptor.sourcePath}`);
    }
    inputs.set(descriptor.sourcePath, bytes);
  }
  return inputs;
}

function targetForM08Entry(entry) {
  const fieldPath = entry.target.fieldPath;
  if (entry.owner === 'mods' && (fieldPath === 'workspaceArchive.originalFile' || fieldPath.startsWith('localization.mod'))) {
    return { repoId: 'mods', path: entry.source.path, fieldPath, status: 'retained-at-fixed-source', reviewState: 'not-applicable' };
  }
  if (fieldPath === 'legacyAnalysis.historicalTermNote') {
    return { repoId: 'source', path: 'docs/references/w15/historical-term-notes.json', fieldPath,
      status: 'historical-reference-candidate', reviewState: 'not-applicable' };
  }
  if (entry.owner === 'source' && (fieldPath === 'terms.unverifiedCandidate'
      || fieldPath.endsWith('.conceptCandidate') || fieldPath.endsWith('.technicalClassificationCandidate'))) {
    return { repoId: 'source', path: 'docs/references/w15/term-candidates.json', fieldPath,
      status: 'candidate-pending-review', reviewState: 'pending' };
  }
  if (entry.owner === 'web' && fieldPath.endsWith('.zhTwLabelCandidate')) {
    return { repoId: 'web', path: 'content/authoring/v2/w15/term-candidates.json', fieldPath,
      status: 'candidate-pending-review', reviewState: 'pending' };
  }
  throw new Error(`fixed W03 M08 row has no typed owner route: ${entry.entryId}`);
}

/** Map all M08 rows, validating each terminology fragment against the exact pinned Git blob snapshot. */
export function mapW15ReferenceRows({ entries, sourceBytesByPath } = {}) {
  if (!Array.isArray(entries) || entries.length !== W03_M08_GROUP.entryCount
      || !(sourceBytesByPath instanceof Map)) throw new Error('fixed W03 M08 migration inputs are invalid');
  const seen = new Set();
  return entries.map(entry => {
    if (seen.has(entry.entryId)) throw new Error(`W15 M08 source row is repeated: ${entry.entryId}`);
    seen.add(entry.entryId);
    const target = targetForM08Entry(entry);
    const row = {
      entryId: entry.entryId,
      source: {
        repoId: entry.source.repoId, commit: entry.source.commit, path: entry.source.path,
        gitBlobOid: entry.source.gitBlobOid, selector: structuredClone(entry.selector),
        fragmentNormalization: entry.fragment.normalization,
        ...(entry.fragment.sha256 ? { fragmentSha256: entry.fragment.sha256 } : { fragmentGitBlobOid: entry.fragment.gitBlobOid }),
        url: sourceLineUrl(entry),
      },
      status: target.status, reviewState: target.reviewState,
      target: { repoId: target.repoId, path: target.path, fieldPath: target.fieldPath },
    };
    const sourceBytes = sourceBytesByPath.get(entry.source.path);
    if (sourceBytes) {
      const issues = verifyEntryFragment(entry, Buffer.from(sourceBytes));
      if (issues.length) throw new Error(`fixed W03 M08 source fragment does not match its pinned blob: ${entry.entryId}`);
      const selected = Buffer.from(sourceBytes).subarray(entry.selector.startByte, entry.selector.endByte);
      row.sourceText = new TextDecoder('utf-8', { fatal: true }).decode(selected);
    } else if (entry.source.path === 'Referneces/Translation.md'
        || entry.source.path === 'Darktide Translation Workspace/Term Candidates.md') {
      throw new Error(`fixed W03 M08 source input is missing: ${entry.source.path}`);
    }
    return row;
  });
}

/** Build an exact M08 row map and candidate text references; all new terminology remains pending. */
export async function buildW15M08MigrationReport({ repoRoot = REPO_ROOT } = {}) {
  const entries = await loadW15GroupEntries({ groupId: 'M08', repoRoot });
  const sourceBytesByPath = await readPinnedM08SourceInputs({ repoRoot });
  const rows = mapW15ReferenceRows({ entries, sourceBytesByPath });
  const grouped = new Map();
  for (const row of rows) {
    if (typeof row.sourceText !== 'string' || row.target.repoId === 'mods') continue;
    const selector = row.source.selector;
    const key = `${row.source.path}\0${selector.startByte}\0${selector.endByte}\0${row.source.fragmentSha256}`;
    const existing = grouped.get(key) ?? {
      referenceId: `w15-ref-${sha256(Buffer.from(key, 'utf8')).slice(0, 20)}`,
      source: {
        repoId: row.source.repoId, commit: row.source.commit, path: row.source.path,
        gitBlobOid: row.source.gitBlobOid, selector: structuredClone(selector),
        fragmentSha256: row.source.fragmentSha256, url: row.source.url,
      },
      sourceText: row.sourceText, rowIds: [], owners: [], status: 'candidate-pending-review',
      reviewState: 'pending', publicationEligible: false,
    };
    if (existing.sourceText !== row.sourceText) throw new Error(`M08 rows disagree on exact source fragment: ${row.entryId}`);
    existing.rowIds.push(row.entryId);
    existing.owners.push({ repoId: row.target.repoId, fieldPath: row.target.fieldPath, targetPath: row.target.path });
    grouped.set(key, existing);
  }
  const termReferences = [...grouped.values()].sort((left, right) => left.source.path.localeCompare(right.source.path)
    || left.source.selector.startByte - right.source.selector.startByte || left.referenceId.localeCompare(right.referenceId));
  const ownerCounts = Object.fromEntries(Object.entries(Object.groupBy(rows, row => row.target.repoId))
    .map(([owner, groupedRows]) => [owner, groupedRows.length]));
  return {
    format: 'w15.m08-reference-migration.v1', candidateOnly: true, publicationEligible: false,
    source: {
      repository: 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods',
      commit: '241ad76ce62330472aa423055a5b85db59bb6c0d', indexPath: W03_MODS_INDEX_PATH,
      indexSha256: W03_MODS_INDEX_SHA256, groupId: 'M08', entryCount: W03_M08_GROUP.entryCount,
      pinnedTextInputs: M08_SOURCE_INPUTS.map(input => ({ ...input })),
    },
    destinationOwners: Object.entries(ownerCounts).sort(([left], [right]) => left.localeCompare(right))
      .map(([repoId, rowCount]) => ({ repoId, rowCount })),
    decisions: {
      status: 'row-mapped-with-pending-terminology-candidates', gameContentApprovalCreated: false,
      reviewState: 'pending', gitOrPublicationAction: false,
      modGlossaryAndWorkspaceArchiveCopied: false,
    },
    rows, termReferences,
  };
}

/** Load and verify only the fixed W03 web-w01-inputs shards needed to preserve the A17 row decisions. */
export async function loadW15A17Entries({ repoRoot = REPO_ROOT } = {}) {
  const root = path.resolve(repoRoot);
  const indexBytes = await readFile(path.join(root, W03_A17_SOURCE.indexPath));
  if (sha256(indexBytes) !== W03_A17_SOURCE.indexSha256) throw new Error('fixed W03 A index SHA-256 mismatch');
  const index = parseJson(indexBytes, 'fixed W03 A index');
  if (index.schemaVersion !== 1 || index.entrySchemaVersion !== 'w03.mapping-entry.v1') {
    throw new Error('fixed W03 A index identity mismatch');
  }
  const group = index.groups?.[W03_A17_SOURCE.groupId];
  if (group?.entryCount !== W03_A17_SOURCE.entryCount
      || JSON.stringify(group.shardPaths) !== JSON.stringify(W03_A17_SOURCE.shardPaths)) {
    throw new Error('fixed W03 A17 group descriptor mismatch');
  }
  const entries = [];
  for (const shardPath of W03_A17_SOURCE.shardPaths) {
    const descriptor = index.shards?.find(row => row.path === shardPath);
    if (!descriptor || descriptor.groupId !== W03_A17_SOURCE.groupId || descriptor.encoding !== 'gzip-base64') {
      throw new Error(`fixed W03 A17 shard descriptor is missing: ${shardPath}`);
    }
    const containerBytes = await readFile(path.join(root, 'docs/contracts/w03', shardPath));
    if (containerBytes.length !== descriptor.containerBytes || sha256(containerBytes) !== descriptor.containerSha256) {
      throw new Error(`fixed W03 A17 shard container changed: ${shardPath}`);
    }
    const envelope = parseJson(containerBytes, `fixed W03 A17 shard ${shardPath}`);
    if (envelope.encoding !== 'gzip-base64' || typeof envelope.data !== 'string'
        || Object.keys(envelope).length !== 2 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(envelope.data)) {
      throw new Error(`fixed W03 A17 shard envelope is invalid: ${shardPath}`);
    }
    const compressed = Buffer.from(envelope.data, 'base64');
    if (compressed.toString('base64') !== envelope.data || compressed.length !== descriptor.compressedBytes
        || sha256(compressed) !== descriptor.compressedSha256) throw new Error(`fixed W03 A17 compressed shard changed: ${shardPath}`);
    const content = gunzipSync(compressed, { maxOutputLength: descriptor.contentBytes + 1 });
    if (content.length !== descriptor.contentBytes || sha256(content) !== descriptor.contentSha256) {
      throw new Error(`fixed W03 A17 shard content changed: ${shardPath}`);
    }
    const shard = parseJson(content, `fixed W03 A17 entries ${shardPath}`);
    if (shard.groupId !== W03_A17_SOURCE.groupId || shard.entrySchemaVersion !== 'w03.mapping-entry.v1'
        || !Array.isArray(shard.entries) || shard.entries.length !== descriptor.entryCount) {
      throw new Error(`fixed W03 A17 shard shape is invalid: ${shardPath}`);
    }
    for (const entry of shard.entries) {
      const issues = validateAEntry(entry);
      if (issues.length) throw new Error(`fixed W03 A17 row is invalid: ${entry?.entryId ?? 'unknown'}`);
    }
    entries.push(...shard.entries);
  }
  if (entries.length !== W03_A17_SOURCE.entryCount) throw new Error('fixed W03 A17 group row count mismatch');
  const selected = entries.filter(entry => entry.target?.recordId === W03_A17_SOURCE.recordId);
  if (selected.length !== W03_A17_SOURCE.rowCount || selected.some(entry => entry.source?.path !== W03_A17_SOURCE.sourcePath
      || entry.source?.commit !== W03_A17_SOURCE.sourceCommit || entry.source?.gitBlobOid !== W03_A17_SOURCE.sourceGitBlobOid
      || entry.target?.gameReleaseId !== W03_A17_SOURCE.gameReleaseId || entry.scope?.releaseScope !== 'current-snapshot-candidate'
      || entry.review?.state !== 'pending' || entry.intendedDisposition !== 'kept')) {
    throw new Error('fixed W03 A17 rows do not match the preserved pending legacy candidate');
  }
  return selected;
}

/** Preserve A17 as a distinct pending W01 candidate; it is not one of the five M05 official documents. */
export async function buildW15A17MigrationReport({ repoRoot = REPO_ROOT } = {}) {
  const entries = await loadW15A17Entries({ repoRoot });
  return {
    format: 'w15.a17-legacy-candidate-preservation.v1',
    candidateOnly: true,
    publicationEligible: false,
    source: {
      repository: 'https://github.com/SyuanTsai/DarkTide-Web',
      commit: W03_A17_SOURCE.sourceCommit,
      path: W03_A17_SOURCE.sourcePath,
      gitBlobOid: W03_A17_SOURCE.sourceGitBlobOid,
      ledgerPath: W03_A17_SOURCE.indexPath,
      ledgerSha256: W03_A17_SOURCE.indexSha256,
      groupId: W03_A17_SOURCE.groupId,
      entryCount: W03_A17_SOURCE.rowCount,
    },
    decisions: {
      status: 'retained-pending-w01-candidate',
      reviewState: 'pending',
      deduplicatedIntoM05: false,
      gameContentApprovalCreated: false,
      gitOrPublicationAction: false,
    },
    rows: entries.map(entry => ({
      entryId: entry.entryId,
      source: {
        repoId: entry.source.repoId, commit: entry.source.commit, path: entry.source.path,
        gitBlobOid: entry.source.gitBlobOid, selector: structuredClone(entry.selector),
        fragment: structuredClone(entry.fragment),
      },
      status: 'retained-pending-w01-candidate',
      reviewState: 'pending',
      originalScope: structuredClone(entry.scope),
      target: {
        repoId: 'web', path: W03_A17_SOURCE.sourcePath,
        recordId: W03_A17_SOURCE.recordId, fieldPath: entry.target.fieldPath,
        gameReleaseId: entry.target.gameReleaseId,
      },
    })),
  };
}

/** Map every fixed M05 source fragment to one typed occurrence in the pending W15 candidate. */
export function mapW15AnnouncementRows({ entries, candidate, sourceBytesByPath } = {}) {
  if (!Array.isArray(entries) || !candidate || candidate.contractKind !== 'w15-announcement-candidate'
      || !Array.isArray(candidate.announcements) || !(sourceBytesByPath instanceof Map)) {
    throw new Error('W15 announcement migration inputs are invalid');
  }
  const seenIds = new Set();
  const mappings = [];
  for (const entry of entries) {
    if (seenIds.has(entry.entryId)) throw new Error(`W15 source row is repeated: ${entry.entryId}`);
    seenIds.add(entry.entryId);
    const expectedKind = ROW_KIND[entry.target?.fieldPath];
    if (!expectedKind || entry.owner !== 'web' || entry.source?.commit !== '241ad76ce62330472aa423055a5b85db59bb6c0d') {
      throw new Error(`W15 source row has no supported candidate mapping: ${entry.entryId}`);
    }
    const sourceBytes = sourceBytesByPath.get(entry.source.path);
    if (!(sourceBytes instanceof Uint8Array)) throw new Error(`W15 source bytes are missing: ${entry.entryId}`);
    const fragmentIssues = verifyEntryFragment(entry, Buffer.from(sourceBytes));
    if (fragmentIssues.length) throw new Error(`W15 source fragment does not match its fixed bytes: ${entry.entryId}`);
    const announcement = candidate.announcements.find(row => row.sourceBinding?.path === entry.source.path);
    if (!announcement || announcement.sourceBinding?.commit !== entry.source.commit
        || announcement.sourceBinding?.blobOid !== entry.source.gitBlobOid
        || !Array.isArray(announcement.occurrenceMap)) {
      throw new Error(`W15 announcement candidate does not bind the fixed source: ${entry.entryId}`);
    }
    const selector = readSelector(entry);
    if (selector.kind !== expectedKind) throw new Error(`W15 source selector kind conflicts with its target: ${entry.entryId}`);
    const sourceLines = Buffer.from(sourceBytes).toString('utf8').split(/\r?\n/u);
    const paragraphMap = expectedKind === 'paragraph'
      ? mapParagraphSelector({ announcement, selector, sourceLines })
      : null;
    const matches = paragraphMap?.occurrences ?? announcement.occurrenceMap.filter(occurrence => matchesSelector(occurrence, selector));
    if (!matches.length || (expectedKind !== 'paragraph' && matches.length !== 1)) {
      throw new Error(`W15 candidate occurrence is missing or ambiguous: ${entry.entryId}`);
    }
    const blocks = matches.map(occurrence => blockForOccurrence(announcement, occurrence));
    if (blocks.some(block => !block || (expectedKind === 'list-item' || expectedKind === 'table-cell'
        ? typeof block.text !== 'string'
        : (expectedKind !== 'paragraph' && block.kind !== expectedKind)))
        || (expectedKind === 'image' && blocks.some(block => !block.assetRef
          || !announcement.assets.some(asset => asset.assetId === block.assetRef.assetId)))) {
      throw new Error(`W15 candidate occurrence does not resolve to its typed block: ${entry.entryId}`);
    }
    const resolution = paragraphMap?.resolution ?? 'direct';
    const candidateFieldPath = paragraphMap?.candidateFieldPath ?? entry.target.fieldPath;
    mappings.push({
      entryId: entry.entryId,
      source: {
        repoId: entry.source.repoId, commit: entry.source.commit, path: entry.source.path,
        gitBlobOid: entry.source.gitBlobOid, selector: structuredClone(entry.selector),
        fragmentSha256: entry.fragment.sha256,
      },
      migrationStatus: 'mapped-pending-review',
      reviewState: 'pending',
      target: {
        repoId: 'web', path: 'content/authoring/v2/w15/announcement-candidate.json',
        announcementId: announcement.announcementId,
        ...(blocks.length === 1 ? { blockId: blocks[0].blockId } : { blockIds: blocks.map(block => block.blockId) }),
        kind: expectedKind, fieldPath: entry.target.fieldPath, candidateFieldPath, resolution,
      },
    });
  }
  if (entries.length !== M05_GROUP.entryCount || mappings.length !== M05_GROUP.entryCount) {
    throw new Error('W15 M05 mapping is incomplete');
  }
  return mappings;
}
