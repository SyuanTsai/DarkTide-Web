import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseW15AnnouncementMarkdown } from './contract-w15-announcements.mjs';

export const W15_ANNOUNCEMENT_INPUT_PATH = 'content/authoring/v2/w15/announcement-source-inputs.json';
export const W15_ANNOUNCEMENT_INPUT_SHA256 = '223195240684eb958e262c74cebca4db1d0081cd254692b8ec8fc41743a0a93a';
export const W15_ANNOUNCEMENT_SOURCE_COMMIT = '241ad76ce62330472aa423055a5b85db59bb6c0d';
export const W15_ANNOUNCEMENT_SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXPECTED_ANNOUNCEMENTS = Object.freeze([
  { fileDate: '2026-09-18', id: 'official:darktide:announcement:2026-09-18-balance-preview',
    publishedOn: '2026-09-18', officialUrl: 'https://forums.fatsharkgames.com/t/preview-upcoming-balance-changes/125587',
    title: '即將推出的平衡性調整預覽', sourcePath: '公告/2026-09-18_詛咒深淵平衡性更新_繁中翻譯.md' },
  { fileDate: '2026-09-23', id: 'official:darktide:announcement:2026-09-23-spillway-feature',
    publishedOn: '2026-09-23', officialUrl: 'https://forums.fatsharkgames.com/t/feature-highlight-spillway-level-visual-design/125643',
    title: '特色介紹：溢洪道關卡與視覺設計', sourcePath: '公告/2026-09-23_詛咒深淵溢洪道關卡與視覺設計_繁中翻譯.md' },
  { fileDate: '2026-09-29', id: 'official:darktide:announcement:2026-09-29-1-13-0-patch-notes',
    publishedOn: '2026-09-29', officialUrl: 'https://forums.fatsharkgames.com/t/patch-1-13-0-patch-notes/125866',
    title: '1.13.0 更新公告：詛咒深淵', sourcePath: '公告/2026-09-29_1.13.0詛咒深淵更新公告_繁中翻譯.md' },
  { fileDate: '2026-10-01', id: 'official:darktide:announcement:2026-10-01-1-13-1-hotfix',
    publishedOn: '2026-10-01', officialUrl: 'https://forums.fatsharkgames.com/t/hotfix-1-13-1-patch-notes/126162',
    title: '1.13.1 熱修更新公告', sourcePath: '公告/2026-10-01_1.13.1熱修更新公告_繁中翻譯.md' },
  { fileDate: '2026-10-06', id: 'official:darktide:announcement:2026-10-06-1-13-2-hotfix',
    publishedOn: '2026-10-06', officialUrl: 'https://forums.fatsharkgames.com/t/hotfix-1-13-2-patch-notes/126370',
    title: '1.13.2 熱修更新公告', sourcePath: '公告/2026-10-06_1.13.2熱修更新公告_繁中翻譯.md' },
]);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);

function assertInputManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== '1.0.0' || manifest.contractKind !== 'w15-announcement-source-inputs'
      || manifest.fixtureOnly !== false || manifest.publicationEligible !== false
      || manifest.sourceInspection?.commit !== W15_ANNOUNCEMENT_SOURCE_COMMIT
      || manifest.sourceInspection?.repository !== W15_ANNOUNCEMENT_SOURCE_REPOSITORY
      || !Array.isArray(manifest.announcements) || manifest.announcements.length !== EXPECTED_ANNOUNCEMENTS.length) {
    throw new Error('W15 announcement source input manifest has an invalid fixed shape');
  }
  const rows = manifest.announcements;
  for (const [index, expected] of EXPECTED_ANNOUNCEMENTS.entries()) {
    const row = rows[index];
    if (row?.fileDate !== expected.fileDate || row.announcementId !== expected.id || row.publishedOn !== expected.publishedOn
        || row.officialUrl !== expected.officialUrl || row.title !== expected.title || row.source?.path !== expected.sourcePath
        || row.source?.repository !== W15_ANNOUNCEMENT_SOURCE_REPOSITORY || row.source?.commit !== W15_ANNOUNCEMENT_SOURCE_COMMIT
        || row.inputPath !== `content/authoring/v2/w15/source/${expected.fileDate}.md`
        || row.webAlias !== `/announcements/?id=${encodeURIComponent(expected.id)}`
        || !/^[a-f0-9]{40}$/u.test(row.source?.blobOid ?? '')
        || !/^[a-f0-9]{64}$/u.test(row.source?.sha256 ?? '')
        || !Number.isSafeInteger(row.source?.sizeBytes) || row.source.sizeBytes < 1
        || !Array.isArray(row.expectedImageUrls) || !Array.isArray(row.expectedOfficialAndVideoUrls)
        || !Array.isArray(row.assets)) {
      throw new Error(`W15 announcement input identity differs from its fixed source at row ${index}`);
    }
  }
  if (manifest.mediaPinVerification?.method !== 'ordinary GET with browser User-Agent'
      || manifest.mediaPinVerification.occurrences !== 44 || manifest.mediaPinVerification.uniqueUrls !== 27
      || manifest.mediaPinVerification.readable !== 27 || manifest.mediaPinVerification.bytesStored !== false) {
    throw new Error('W15 media pin verification metadata differs from the fixed read-only GET receipt');
  }
}

function sourceLinkResolver(current, allBySourcePath) {
  const aliases = new Map([
    ['../Referneces/Translation.md', 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/blob/241ad76ce62330472aa423055a5b85db59bb6c0d/Referneces/Translation.md'],
    ['./2026-09-23_詛咒深淵溢洪道關卡與視覺設計_繁中翻譯.md', allBySourcePath.get('公告/2026-09-23_詛咒深淵溢洪道關卡與視覺設計_繁中翻譯.md')],
  ]);
  return href => aliases.get(href) ?? href;
}

function collectUrls(blocks, output = []) {
  const inline = runs => {
    for (const run of runs ?? []) {
      if (run.kind === 'link') output.push(run.href);
      if (run.children) inline(run.children);
    }
  };
  for (const block of blocks) {
    if (block.kind === 'link') output.push(block.href);
    if (block.inline) inline(block.inline);
    for (const item of block.items ?? []) {
      inline(item.inline);
      if (item.children) collectUrls(item.children, output);
    }
    for (const row of block.rows ?? []) for (const cell of row.cells) inline(cell.inline);
    if (block.blocks) collectUrls(block.blocks, output);
  }
  return output;
}

function countBlocks(blocks, counts = {}) {
  for (const block of blocks) {
    counts[block.kind] = (counts[block.kind] ?? 0) + 1;
    if (block.kind === 'table') {
      counts.tableRows = (counts.tableRows ?? 0) + block.rows.length;
      counts.tableCells = (counts.tableCells ?? 0) + block.rows.reduce((sum, row) => sum + row.cells.length, 0);
    }
    for (const item of block.items ?? []) if (item.children) countBlocks(item.children, counts);
    if (block.blocks) countBlocks(block.blocks, counts);
  }
  return counts;
}

function firstImageAlt(parsed, url) {
  return parsed.assetOccurrences.find(item => item.sourceUri === url)?.alt ?? '';
}

function parseAnnouncement(row, rawBytes, text, allBySourcePath) {
  const assetsByUrl = new Map();
  for (const asset of row.assets) {
    if (!/^w15:asset:[0-9a-f-]{36}$/u.test(asset.assetId) || !/^image\/(?:jpeg|png)$/u.test(asset.mediaType)
        || asset.sourceUri !== `https://github.com/user-attachments/assets/${asset.assetId.slice('w15:asset:'.length)}`
        || !/^[a-f0-9]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 1) {
      throw new Error(`W15 announcement has an invalid pinned attachment: ${row.announcementId}`);
    }
    if (assetsByUrl.has(asset.sourceUri)) throw new Error(`W15 announcement repeats an asset pin: ${asset.sourceUri}`);
    assetsByUrl.set(asset.sourceUri, asset);
  }
  const parsed = parseW15AnnouncementMarkdown(text, {
    idPrefix: row.announcementId,
    assetsByUrl,
    resolveLink: sourceLinkResolver(row, allBySourcePath),
  });
  const imageUrls = parsed.assetOccurrences.map(item => item.sourceUri);
  if (canonical(imageUrls) !== canonical(row.expectedImageUrls)) {
    throw new Error(`W15 announcement image occurrence order differs from its fixed source inspection: ${row.announcementId}`);
  }
  const usedUrls = new Set(imageUrls);
  if (usedUrls.size !== row.assets.length || row.assets.some(asset => !usedUrls.has(asset.sourceUri))) {
    throw new Error(`W15 announcement image asset pins do not match its source occurrences: ${row.announcementId}`);
  }
  const actualLinks = new Set(collectUrls(parsed.blocks));
  for (const href of row.expectedOfficialAndVideoUrls) {
    if (!actualLinks.has(href)) throw new Error(`W15 announcement omitted an official/video source link: ${row.announcementId}`);
  }
  const usedAssetMetadata = row.assets.map(asset => ({
    assetId: asset.assetId, mediaType: asset.mediaType, alt: firstImageAlt(parsed, asset.sourceUri),
    sourceUri: asset.sourceUri, sha256: asset.sha256, sizeBytes: asset.sizeBytes,
  }));
  const announcement = {
    announcementId: row.announcementId,
    scope: 'official-document',
    title: row.title,
    publishedOn: row.publishedOn,
    revision: row.revision,
    source: { kind: 'official-game-source', locator: row.officialUrl, sha256: sha256(rawBytes) },
    blocks: parsed.blocks,
    assets: usedAssetMetadata,
  };
  return {
    announcement,
    sourceBinding: { ...row.source, inputPath: row.inputPath, sourceBytesSha256: sha256(rawBytes), sourceBytes: rawBytes.length },
    sourceAlias: { sourcePath: row.source.path, destination: row.webAlias },
    occurrenceMap: parsed.occurrences,
    imageOccurrences: parsed.assetOccurrences,
    blockCounts: countBlocks(parsed.blocks),
    linkUrls: [...actualLinks].sort(),
  };
}

export async function buildW15AnnouncementCandidate({ repoRoot = DEFAULT_ROOT } = {}) {
  const absoluteRoot = path.resolve(repoRoot);
  const manifestBytes = await readFile(path.join(absoluteRoot, W15_ANNOUNCEMENT_INPUT_PATH));
  if (sha256(manifestBytes) !== W15_ANNOUNCEMENT_INPUT_SHA256) throw new Error('W15 announcement source manifest raw SHA-256 mismatch');
  const manifestText = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
  const manifest = JSON.parse(manifestText);
  assertInputManifest(manifest);
  const allBySourcePath = new Map(manifest.announcements.map(row => [row.source.path, row.webAlias]));
  const rows = [];
  for (const source of manifest.announcements) {
    const rawBytes = await readFile(path.join(absoluteRoot, source.inputPath));
    if (rawBytes.length !== source.source.sizeBytes || sha256(rawBytes) !== source.source.sha256) {
      throw new Error(`W15 announcement fixed source bytes changed: ${source.source.path}`);
    }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes); }
    catch { throw new Error(`W15 announcement source is not valid UTF-8: ${source.source.path}`); }
    rows.push(parseAnnouncement(source, rawBytes, text, allBySourcePath));
  }
  const imageOccurrences = rows.flatMap(row => row.imageOccurrences);
  const uniqueAssetPins = new Map(rows.flatMap(row => row.announcement.assets).map(asset => [asset.sourceUri, asset]));
  return {
    schemaVersion: '1.0.0',
    contractKind: 'w15-announcement-candidate',
    sourceInputManifest: { path: W15_ANNOUNCEMENT_INPUT_PATH, sha256: W15_ANNOUNCEMENT_INPUT_SHA256 },
    fixtureOnly: false,
    publicationEligible: false,
    reviewState: 'pending',
    approvalReceipts: [],
    provenance: {
      sourceRepository: W15_ANNOUNCEMENT_SOURCE_REPOSITORY,
      sourceCommit: W15_ANNOUNCEMENT_SOURCE_COMMIT,
      sourceContentKind: 'repository-owned translated Markdown snapshot',
      sourceHashMeaning: 'The SHA-256 pins the exact translated Markdown source blob; it is not a digest of the original forum post bytes.',
      assetBytesStored: false,
      allAnnouncementsRequireWebBlocksReview: true,
    },
    announcements: rows.map(row => ({
      ...row.announcement,
      reviewState: 'pending',
      sourceBinding: row.sourceBinding,
      sourceAlias: row.sourceAlias,
      occurrenceMap: row.occurrenceMap,
      imageOccurrences: row.imageOccurrences,
      importCounts: row.blockCounts,
      sourceLinks: row.linkUrls,
    })),
    parity: {
      announcementCount: rows.length,
      imageOccurrenceCount: imageOccurrences.length,
      uniqueAssetCount: uniqueAssetPins.size,
      assetPinsVerified: [...uniqueAssetPins.values()].every(asset => /^[a-f0-9]{64}$/u.test(asset.sha256) && asset.sizeBytes > 0),
      sourceBytesVerified: true,
    },
  };
}

export async function writeW15AnnouncementCandidate({ repoRoot = DEFAULT_ROOT, outputPath } = {}) {
  if (typeof outputPath !== 'string' || !outputPath.trim()) throw new Error('an explicit new W15 candidate output path is required');
  const absoluteRoot = path.resolve(repoRoot);
  const absoluteOutput = path.resolve(absoluteRoot, outputPath);
  const relativeOutput = path.relative(absoluteRoot, absoluteOutput);
  if (!relativeOutput || relativeOutput.startsWith('..' + path.sep) || path.isAbsolute(relativeOutput)) {
    throw new Error('W15 announcement candidate output must stay inside the Web repository');
  }
  try { await readFile(absoluteOutput); throw new Error('W15 announcement candidate output already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const candidate = await buildW15AnnouncementCandidate({ repoRoot: absoluteRoot });
  const bytes = Buffer.from(JSON.stringify(candidate, null, 2) + '\n', 'utf8');
  await writeFile(absoluteOutput, bytes, { flag: 'wx' });
  return { path: relativeOutput.replaceAll(path.sep, '/'), bytes: bytes.length, sha256: sha256(bytes), candidate };
}

async function main(argv) {
  if (argv[0] !== '--write' || !argv[1] || argv.length !== 2) {
    throw new Error('usage: node scripts/content/w15-announcement-import.mjs --write <new-repository-relative-output-path>');
  }
  const result = await writeW15AnnouncementCandidate({ outputPath: argv[1] });
  process.stdout.write(JSON.stringify({ path: result.path, bytes: result.bytes, sha256: result.sha256,
    announcements: result.candidate.parity.announcementCount, images: result.candidate.parity.imageOccurrenceCount,
    uniqueAssets: result.candidate.parity.uniqueAssetCount, reviewState: result.candidate.reviewState }, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
