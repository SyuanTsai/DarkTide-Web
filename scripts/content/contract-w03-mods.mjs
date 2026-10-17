import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MODS_COMMIT = '241ad76ce62330472aa423055a5b85db59bb6c0d';
export const MODS_REPO_ID = 'mods';
export const ENTRY_SCHEMA_VERSION = 'w03.mapping-entry.v1';
const OWNER_SET = new Set(['source', 'web', 'private', 'mods', 'extension']);
const TARGET_SCOPE = new Map([
  ['private-archive', new Set(['private'])], ['mods-file', new Set(['mods'])],
  ['source-record', new Set(['source'])], ['source-document', new Set(['source'])],
  ['legacy-artifact', new Set(['source', 'extension'])],
  ['web-record', new Set(['web'])], ['web-announcement', new Set(['web'])],
  ['extension-runtime-binding', new Set(['extension'])],
  ['candidate', new Set(['source', 'web', 'private'])], ['quarantine', new Set(['private', 'source'])],
]);
const RELEASE_SCOPE_SET = new Set([
  'unversioned-historical', 'historical-game-release', 'current-snapshot-candidate',
  'registry-snapshot', 'synthetic-only', 'mixed-release-set', 'release-unspecified',
  'historical-legacy-marker', 'announcement-original', 'workflow-document',
  'tool-document', 'reference-document',
]);
const DISPOSITION_SET = new Set(['migrated', 'archived-readable', 'private-restorable', 'kept', 'deduplicated-with-evidence', 'excluded']);
const SHA1_RE = /^[a-f0-9]{40}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOC_ROOT = path.join(REPO_ROOT, 'docs/contracts/w03/mods');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const issue = (code, message, pathName = '/') => ({ code, message, path: pathName });

export function parseGitTreeBuffer(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Git tree output must be a Buffer');
  const records = [];
  let offset = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  while (offset < bytes.length) {
    const terminator = bytes.indexOf(0, offset);
    if (terminator < 0) throw new Error('Git tree output is not NUL-terminated');
    const record = bytes.subarray(offset, terminator);
    const tab = record.indexOf(9);
    if (tab < 0) throw new Error('Git tree record has no metadata/path separator');
    const metadata = record.subarray(0, tab).toString('ascii');
    const match = /^(\d{6}) blob ([a-f0-9]{40})\s+(\d+)$/u.exec(metadata);
    if (!match) throw new Error('Git tree record has unsupported metadata');
    let pathName;
    try { pathName = decoder.decode(record.subarray(tab + 1)); }
    catch { throw new Error('Git tree path is not valid UTF-8'); }
    if (!pathName || pathName.startsWith('/') || pathName.includes('\\') || pathName.split('/').some(piece => piece === '..' || piece === '.')) {
      throw new Error('Git tree path is unsafe');
    }
    records.push({ mode: match[1], gitBlobOid: match[2], size: Number(match[3]), path: pathName });
    offset = terminator + 1;
  }
  return records;
}

function gitBlobOid(bytes) {
  const header = Buffer.from('blob ' + bytes.length + String.fromCharCode(0), 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

export function verifyEntryFragment(entry, sourceBytes) {
  if (!Buffer.isBuffer(sourceBytes)) return [issue('source-bytes', 'source bytes must be a Buffer')];
  const selector = entry?.selector;
  const fragment = entry?.fragment;
  if (fragment?.normalization === 'git-blob') {
    if (selector?.kind !== 'file' || selector.locator !== 'file'
      || gitBlobOid(sourceBytes) !== entry?.source?.gitBlobOid
      || gitBlobOid(sourceBytes) !== fragment.gitBlobOid) {
      return [issue('fragment-source-mismatch', 'whole-file Git blob digest does not match source bytes', '/fragment/gitBlobOid')];
    }
    return [];
  }
  if (fragment?.normalization !== 'raw' && fragment?.normalization !== 'lf') {
    return [issue('fragment-normalization', 'fragment normalization must be raw, lf, or git-blob', '/fragment/normalization')];
  }
  const start = selector?.startByte;
  const end = selector?.endByte;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > sourceBytes.length) {
    return [issue('selector-byte-range', 'fragment byte range is outside the pinned source bytes', '/selector')];
  }
  const selected = sourceBytes.subarray(start, end);
  let digestBytes = selected;
  if (fragment.normalization === 'lf') {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(selected);
      digestBytes = Buffer.from(decoded.replace(/\r\n?/gu, '\n'), 'utf8');
    } catch {
      return [issue('fragment-encoding', 'LF-normalized fragments must be valid UTF-8', '/fragment')];
    }
  }
  if (sha256(digestBytes) !== fragment.sha256) {
    return [issue('fragment-range-hash', 'selected source byte range does not match its fragment digest', '/fragment/sha256')];
  }
  return [];
}

function validateFragment(entry, issues) {
  const { selector, source, fragment } = entry;
  if (!isObject(fragment)) {
    issues.push(issue('fragment-shape', 'fragment must be an object', '/fragment'));
    return;
  }
  if (fragment.normalization === 'git-blob') {
    if (selector?.kind !== 'file' || typeof fragment.gitBlobOid !== 'string' || !SHA1_RE.test(fragment.gitBlobOid)
      || Object.hasOwn(fragment, 'sha256') || fragment.gitBlobOid !== source?.gitBlobOid) {
      issues.push(issue('fragment-source-mismatch', 'git-blob fragments require a whole-file selector and the exact source Git blob OID, with no SHA-256 field', '/fragment'));
    }
    return;
  }
  if (fragment.normalization === 'raw' || fragment.normalization === 'lf') {
    if (Object.hasOwn(fragment, 'gitBlobOid') || typeof fragment.sha256 !== 'string' || !SHA256_RE.test(fragment.sha256)) {
      issues.push(issue('fragment-union', 'raw/lf fragments require only a lowercase SHA-256', '/fragment'));
    }
    return;
  }
  issues.push(issue('fragment-normalization', 'fragment normalization must be raw, lf, or git-blob', '/fragment/normalization'));
}

export function validateMappingEntry(entry) {
  const issues = [];
  if (!isObject(entry)) return [issue('entry-shape', 'entry must be an object')];
  if (entry.schemaVersion !== ENTRY_SCHEMA_VERSION) issues.push(issue('entry-schema-version', 'schemaVersion must be w03.mapping-entry.v1', '/schemaVersion'));
  if (typeof entry.entryId !== 'string' || !entry.entryId) issues.push(issue('entry-id', 'entryId is required', '/entryId'));
  if (!isObject(entry.source) || entry.source.repoId !== MODS_REPO_ID || entry.source.commit !== MODS_COMMIT
    || typeof entry.source.path !== 'string' || !SHA1_RE.test(entry.source.gitBlobOid ?? '')) {
    issues.push(issue('source-pin', 'source must reference the frozen Mods commit, safe path, and exact Git blob', '/source'));
  }
  const sourceEntityKinds = new Set(['stable-id', 'legacy-id', 'record-index', 'record-path', 'json-pointer', 'registry-key', 'path-scope', 'git-blob']);
  if (!isObject(entry.sourceEntityKey) || !sourceEntityKinds.has(entry.sourceEntityKey.kind)
    || (entry.sourceEntityKey.value !== null && (typeof entry.sourceEntityKey.value !== 'string' || !entry.sourceEntityKey.value.trim()))
    || (entry.sourceEntityKey.reason !== null && (typeof entry.sourceEntityKey.reason !== 'string' || !entry.sourceEntityKey.reason.trim()))
    || (entry.sourceEntityKey.value === null && (typeof entry.sourceEntityKey.reason !== 'string' || !entry.sourceEntityKey.reason.trim()))
    || (typeof entry.sourceEntityKey.value === 'string' && entry.sourceEntityKey.reason !== null)) {
    issues.push(issue('source-entity-key', 'sourceEntityKey requires a stable typed value or null with an explicit reason', '/sourceEntityKey'));
  }
  if (typeof entry.source?.path === 'string'
    && (entry.source.path.startsWith('/') || entry.source.path.includes('\\') || entry.source.path.split('/').some(piece => piece === '..' || piece === '.'))) {
    issues.push(issue('source-path', 'source path must be repository-relative and traversal-free', '/source/path'));
  }
  if (entry.sourceEntityKey?.kind === 'path-scope' && entry.sourceEntityKey.value !== entry.source?.path) issues.push(issue('source-entity-path', 'path-scope value must match the exact source path', '/sourceEntityKey/value'));
  const selectorKinds = new Set(['file', 'json-pointer', 'line-range', 'section', 'occurrence']);
  if (!isObject(entry.selector) || !selectorKinds.has(entry.selector.kind) || typeof entry.selector.locator !== 'string' || !entry.selector.locator) {
    issues.push(issue('selector-shape', 'selector kind and locator are required', '/selector'));
  } else if (['raw', 'lf'].includes(entry.fragment?.normalization)
    && (!Number.isInteger(entry.selector.startByte) || !Number.isInteger(entry.selector.endByte)
      || entry.selector.startByte < 0 || entry.selector.endByte <= entry.selector.startByte)) {
    issues.push(issue('selector-byte-range', 'raw/lf fragment selectors require a positive exact byte range', '/selector'));
  }
  validateFragment(entry, issues);
  if (!OWNER_SET.has(entry.owner)) issues.push(issue('owner', 'owner is outside the W03 owner set', '/owner'));
  if (!isObject(entry.target)) issues.push(issue('target-shape', 'target must be an object', '/target'));
  else {
    const status = entry.target.status;
    if (!['not-generated', 'existing', 'retained'].includes(status)) issues.push(issue('target-status', 'target status must be not-generated, existing, or retained', '/target/status'));
    if (!['private-archive', 'mods-file', 'source-record', 'web-record', 'extension-runtime-binding', 'legacy-artifact', 'candidate', 'quarantine', 'source-document', 'web-announcement'].includes(entry.target.kind)) {
      issues.push(issue('target-kind', 'target kind is outside the W03 owner vocabulary', '/target/kind'));
    }
    const requiredOwners = TARGET_SCOPE.get(entry.target.kind);
    if (requiredOwners && !requiredOwners.has(entry.owner)) {
      issues.push(issue('owner-target-kind', `target kind ${entry.target.kind} is incompatible with owner ${entry.owner}`, '/owner'));
    }
    if (typeof entry.target.fieldPath !== 'string' || !entry.target.fieldPath) issues.push(issue('target-field', 'target fieldPath is required even when target bytes are not generated', '/target/fieldPath'));
    if (entry.target.recordId === null) {
      if (typeof entry.target.recordIdNotApplicableReason !== 'string' || !entry.target.recordIdNotApplicableReason.trim()) {
        issues.push(issue('target-record-reason', 'null recordId requires a nonempty reason', '/target/recordIdNotApplicableReason'));
      }
    } else if (typeof entry.target.recordId !== 'string' || !entry.target.recordId.trim()
      || Object.hasOwn(entry.target, 'recordIdNotApplicableReason')) {
      issues.push(issue('target-record-id', 'recordId must be a stable identifier and cannot carry a not-applicable reason', '/target/recordId'));
    }
    if (entry.target.gameReleaseId === null) {
      if (typeof entry.target.gameReleaseIdNotApplicableReason !== 'string' || !entry.target.gameReleaseIdNotApplicableReason.trim()) {
        issues.push(issue('target-game-release-reason', 'null target gameReleaseId requires a nonempty reason', '/target/gameReleaseIdNotApplicableReason'));
      }
    } else if (typeof entry.target.gameReleaseId !== 'string' || !entry.target.gameReleaseId.trim()
      || Object.hasOwn(entry.target, 'gameReleaseIdNotApplicableReason')) {
      issues.push(issue('target-game-release-id', 'target gameReleaseId must be stable and cannot carry a not-applicable reason', '/target/gameReleaseId'));
    }
    if (status === 'not-generated') {
      if (entry.target.repoId !== null || entry.target.commit !== null || entry.target.path !== null || typeof entry.target.reason !== 'string' || !entry.target.reason) {
        issues.push(issue('target-not-generated', 'not-generated targets require null locator fields and a reason', '/target'));
      }
    } else if (typeof entry.target.repoId !== 'string' || !SHA1_RE.test(entry.target.commit ?? '') || typeof entry.target.path !== 'string' || !entry.target.path) {
      issues.push(issue('target-locator', 'existing or retained targets require an exact repo, commit, and path', '/target'));
    }
  }
  if (!isObject(entry.scope) || !RELEASE_SCOPE_SET.has(entry.scope.releaseScope)) {
    issues.push(issue('scope-shape', 'scope must use a closed W03 releaseScope value', '/scope'));
  } else if (entry.scope.gameReleaseId === null) {
    if (typeof entry.scope.reason !== 'string' || !entry.scope.reason.trim()) {
      issues.push(issue('scope-version', 'null scope gameReleaseId requires a scope-specific reason', '/scope/reason'));
    }
  } else if (typeof entry.scope.gameReleaseId !== 'string' || !entry.scope.gameReleaseId.trim()) {
    issues.push(issue('scope-version', 'non-null scope gameReleaseId must be a stable identifier', '/scope/gameReleaseId'));
  }
  if (entry.target?.kind === 'candidate' && entry.intendedDisposition === 'excluded') issues.push(issue('candidate-disposition', 'unapproved candidate rows cannot be marked excluded', '/intendedDisposition'));
  if (entry.mappingStatus !== 'planned' || !DISPOSITION_SET.has(entry.intendedDisposition)
    || !isObject(entry.actualOutcome) || entry.actualOutcome.status !== 'not-started') {
    issues.push(issue('planned-outcome', 'W03 rows remain planned with a canonical intended disposition and not-started actual outcome', '/actualOutcome'));
  }
  if (!isObject(entry.review) || entry.review.carryForward !== 'not-assumed'
    || !Array.isArray(entry.review.basisRefs)
    || !['pending', 'not-applicable'].includes(entry.review.state)) {
    issues.push(issue('review-state', 'review must remain pending or not-applicable without assumed carry-forward', '/review'));
  }
  if (typeof entry.linkDisposition !== 'string' || !entry.linkDisposition) issues.push(issue('link-disposition', 'linkDisposition is required', '/linkDisposition'));
  if (!isObject(entry.rollback) || entry.rollback.repoId !== entry.source?.repoId
    || entry.rollback.commit !== entry.source?.commit || entry.rollback.path !== entry.source?.path
    || entry.rollback.gitBlobOid !== entry.source?.gitBlobOid) {
    issues.push(issue('rollback-pointer', 'rollback must point to the exact frozen source Git blob', '/rollback'));
  }
  const sourcePath = entry.source?.path;
  if (typeof sourcePath === 'string' && sourcePath.startsWith('Game Info/對話文本/')) {
    if (entry.owner !== 'private' || entry.target?.kind !== 'private-archive'
      || entry.intendedDisposition !== 'private-restorable' || entry.selector?.kind !== 'file'
      || entry.fragment?.normalization !== 'git-blob') {
      issues.push(issue('m02-restricted-owner', 'M02 dialogue paths must remain whole-file Private archive plans', '/owner'));
    }
  }
  if (typeof sourcePath === 'string' && classifySourcePath(sourcePath).startsWith('K')) {
    if (entry.owner !== 'mods' || entry.target?.kind !== 'mods-file' || entry.target?.status !== 'retained'
      || entry.intendedDisposition !== 'kept') {
      issues.push(issue('mods-retained-owner', 'K01/K02 maintenance files must remain retained Mods rows', '/owner'));
    }
  }
  return issues;
}

function splitLines(bytes) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 10) {
      let contentEnd = i;
      if (contentEnd > start && bytes[contentEnd - 1] === 13) contentEnd--;
      lines.push({ start, end: i, contentEnd, text: bytes.subarray(start, contentEnd).toString('utf8') });
      start = i + 1;
    }
  }
  if (start < bytes.length || bytes.length === 0) {
    let contentEnd = bytes.length;
    if (contentEnd > start && bytes[contentEnd - 1] === 13) contentEnd--;
    lines.push({ start, end: bytes.length, contentEnd, text: bytes.subarray(start, contentEnd).toString('utf8') });
  }
  return lines;
}

function tableCells(text) {
  let value = text.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
  const cells = [];
  let current = '';
  let escaped = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '|' && !escaped) {
      cells.push(current);
      current = '';
      continue;
    }
    current += character;
    if (character === '\\' && !escaped) escaped = true;
    else escaped = false;
  }
  cells.push(current);
  return cells;
}

function isTableSeparator(text) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(text);
}

function pushBlock(result, bytes, kind, start, end, locator, occurrence = undefined, extra = {}) {
  const fragmentBytes = bytes.subarray(start, end);
  const typedLocator = ['paragraph', 'spoilercontainer', 'codeblock'].includes(kind) ? locator + ':' + kind : locator;
  const selector = {
    kind: kind === 'heading' ? 'section' : ['imageoccurrence', 'tablecell'].includes(kind) ? 'occurrence' : 'line-range',
    locator: typedLocator, startByte: start, endByte: end,
  };
  if (occurrence !== undefined) selector.occurrence = occurrence;
  const lineNumber = Number(/L(\d+)/u.exec(locator)?.[1] ?? 0);
  result.push({
    kind,
    selector,
    fragment: { normalization: 'raw', sha256: sha256(fragmentBytes) },
    text: fragmentBytes.toString('utf8'),
    sourceBytes: bytes,
    byteStart: start,
    byteEnd: end,
    lineNumber,
    ...extra,
  });
}

function maskInlineCode(text) {
  const chars = Array.from(text);
  for (let cursor = 0; cursor < chars.length;) {
    if (chars[cursor] !== '\u0060') {
      cursor++;
      continue;
    }
    let delimiterEnd = cursor + 1;
    while (chars[delimiterEnd] === '\u0060') delimiterEnd++;
    const delimiterLength = delimiterEnd - cursor;
    let searchAt = delimiterEnd;
    let closingEnd = -1;
    while (searchAt < chars.length) {
      if (chars[searchAt] !== '\u0060') {
        searchAt++;
        continue;
      }
      let runEnd = searchAt + 1;
      while (chars[runEnd] === '\u0060') runEnd++;
      if (runEnd - searchAt === delimiterLength) {
        closingEnd = runEnd;
        break;
      }
      searchAt = runEnd;
    }
    if (closingEnd < 0) {
      cursor = delimiterEnd;
      continue;
    }
    for (let index = cursor; index < closingEnd; index++) {
      if (chars[index] !== '\t') chars[index] = ' ';
    }
    cursor = closingEnd;
  }
  return chars.join('');
}
export function extractAnnouncementBlocks(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  decoder.decode(bytes);
  const lines = splitLines(bytes);
  const result = [];
  const detailsStack = [];
  let imageIndex = 0;
  let headingIndex = 0;
  let paragraphStart = null;
  let paragraphEnd = null;
  let codeFence = null;
  let codeStart = null;
  const headings = [];
  const sectionPath = () => headings.map(item => item.text).join(' / ');

  const flushParagraph = () => {
    if (paragraphStart === null) return;
    const first = lines[paragraphStart];
    const last = lines[paragraphEnd];
    pushBlock(result, bytes, 'paragraph', first.start, last.contentEnd, 'L' + (paragraphStart + 1) + '-L' + (paragraphEnd + 1), undefined, { sectionPath: sectionPath() });
    paragraphStart = null;
    paragraphEnd = null;
  };
  const addImageOccurrences = (line, lineIndex) => {
    const patterns = [
      /!\[[^\]]*\]\((?:<([^>]+)>|([^)]+))\)/gu,
      /<img\b[^>]*>/giu,
    ];
    for (const pattern of patterns) {
      for (const match of line.text.matchAll(pattern)) {
        const syntax = match[0];
        let url = match[1] ?? match[2] ?? '';
        if (pattern.source.startsWith('<img')) {
          url = /\bsrc\s*=\s*["']([^"']+)["']/iu.exec(syntax)?.[1] ?? '';
        } else {
          url = url.replace(/\s+["'][^"']*["']\s*$/u, '').trim();
        }
        const start = line.start + Buffer.byteLength(line.text.slice(0, match.index), 'utf8');
        const end = start + Buffer.byteLength(syntax, 'utf8');
        imageIndex++;
        const assetKey = url ? sha256(Buffer.from(url, 'utf8')) : undefined;
        pushBlock(result, bytes, 'imageoccurrence', start, end, 'L' + (lineIndex + 1) + ':C' + (match.index + 1) + ':image', imageIndex, {
          sectionPath: sectionPath(),
          ...(assetKey ? { assetKey } : {}),
        });
      }
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const text = line.text;
    const structuralText = maskInlineCode(text);
    const fence = /^\s*(`{3,}|~{3,})/u.exec(text)?.[1];
    if (codeFence) {
      if (fence && fence[0] === codeFence.character && fence.length >= codeFence.length) {
        pushBlock(result, bytes, 'codeblock', lines[codeStart].start, line.contentEnd, 'L' + (codeStart + 1) + '-L' + (index + 1), undefined, { sectionPath: sectionPath() });
        codeFence = null;
        codeStart = null;
      }
      continue;
    }
    if (fence) {
      flushParagraph();
      codeFence = { character: fence[0], length: fence.length };
      codeStart = index;
      continue;
    }
    const detailsOpen = /<details\b[^>]*>/iu.test(structuralText);
    const detailsClose = /<\/details\s*>/iu.test(structuralText);
    if (detailsOpen) detailsStack.push(index);
    if (detailsClose && detailsStack.length > 0) {
      const openIndex = detailsStack.pop();
      pushBlock(result, bytes, 'spoilercontainer', lines[openIndex].start, line.contentEnd, 'L' + (openIndex + 1) + '-L' + (index + 1), undefined, { sectionPath: sectionPath() });
    }
    if (!text.trim()) {
      flushParagraph();
      continue;
    }
    if (/^\s*<details\b|^\s*<\/details\s*>\s*$/iu.test(structuralText)) {
      flushParagraph();
      continue;
    }
    if (/^\s*\|.*\|\s*$/u.test(text)) {
      flushParagraph();
      if (!isTableSeparator(text)) {
        const trimmedLeft = text.search(/\S/u);
        const cells = tableCells(text);
        let cursor = Math.max(0, trimmedLeft);
        if (text[cursor] === '|') cursor++;
        for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
          const rawCell = cells[cellIndex];
          let cellAt = text.indexOf(rawCell, cursor);
          if (cellAt < 0) cellAt = cursor;
          const begin = line.start + Buffer.byteLength(text.slice(0, cellAt), 'utf8');
          const end = begin + Buffer.byteLength(rawCell, 'utf8');
          pushBlock(result, bytes, 'tablecell', begin, end, 'L' + (index + 1) + ':cell:' + (cellIndex + 1), cellIndex + 1, { sectionPath: sectionPath(), cellIndex: cellIndex + 1 });
          cursor = cellAt + rawCell.length + 1;
        }
      }
      addImageOccurrences(line, index);
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+\S/u.exec(text);
    if (heading) {
      flushParagraph();
      headingIndex++;
      const headingText = text.replace(/^\s{0,3}#{1,6}\s+/u, '').replace(/\s+#+\s*$/u, '').trim();
      const level = heading[1].length;
      while (headings.length && headings.at(-1).level >= level) headings.pop();
      headings.push({ level, text: headingText });
      pushBlock(result, bytes, 'heading', line.start, line.contentEnd, 'L' + (index + 1) + ':heading', headingIndex, { sectionPath: sectionPath(), headingLevel: level });
      addImageOccurrences(line, index);
      continue;
    }
    const list = /^\s*(?:[-+*]|\d+[.)])\s+\S/u.exec(text);
    if (list) {
      flushParagraph();
      pushBlock(result, bytes, 'listitem', line.start, line.contentEnd, 'L' + (index + 1) + ':listitem', undefined, { sectionPath: sectionPath() });
      addImageOccurrences(line, index);
      continue;
    }
    if (/^\s*<summary\b[^>]*>/iu.test(structuralText)) {
      flushParagraph();
      pushBlock(result, bytes, 'paragraph', line.start, line.contentEnd, 'L' + (index + 1) + '-L' + (index + 1), undefined, { sectionPath: sectionPath() });
      addImageOccurrences(line, index);
      continue;
    }
    if (paragraphStart === null) paragraphStart = index;
    paragraphEnd = index;
    addImageOccurrences(line, index);
  }
  flushParagraph();
  if (codeFence && codeStart !== null) {
    const last = lines.at(-1);
    pushBlock(result, bytes, 'codeblock', lines[codeStart].start, last.contentEnd, 'L' + (codeStart + 1) + '-L' + lines.length, undefined, { sectionPath: sectionPath() });
  }
  if (detailsStack.length) throw new Error('announcement contains an unclosed details/spoiler container');
  const assetCounts = new Map();
  for (const block of result) if (block.assetKey) assetCounts.set(block.assetKey, (assetCounts.get(block.assetKey) ?? 0) + 1);
  for (const block of result) {
    if (block.assetKey && assetCounts.get(block.assetKey) > 1) block.dedupGroupId = 'asset-ref-sha256:' + block.assetKey;
    delete block.assetKey;
  }
  return result.sort((left, right) => left.byteStart - right.byteStart || left.byteEnd - right.byteEnd || compare(left.kind, right.kind));
}

export function classifySourcePath(pathName) {
  if (pathName.startsWith('Game Info/對話文本/')) return 'M02';
  if (pathName.startsWith('Game Info/releases/1.13.X/source/')) return 'M03';
  if (pathName.startsWith('Game Info/')) return 'M01';
  if (pathName.startsWith('AI-LOGS/Game Info/')) return 'M04';
  if (pathName.startsWith('公告/')) return 'M05';
  if (pathName.startsWith('AI Prompt/')) {
    return /AI-(?:Auto-Update-MOD|MOD-Info-And-PR)-Workflow\.md$/u.test(pathName) ? 'K01' : 'M06';
  }
  if (pathName.startsWith('scripts/game-info/')) return 'M07';
  if (pathName.startsWith('Referneces/') || pathName.startsWith('Darktide Translation Workspace/')) return 'M08';
  if (['README.md', 'PROVENANCE.md', 'LICENSE-SCOPE.md', 'THIRD_PARTY_NOTICES.md'].includes(pathName)) return 'K02';
  return 'K01';
}

const GROUP_ORDER = ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'K01', 'K02'];
const groupNumber = new Map(GROUP_ORDER.map((group, index) => [group, index + 1]));

function stableId(prefix, value) {
  return prefix + ':' + sha256(Buffer.from(value, 'utf8')).slice(0, 24);
}

function scopeFor(group, override = undefined) {
  if (override) return override;
  const defaults = {
    M01: { releaseScope: 'historical-legacy-marker', reason: 'legacy-analysis-version-not-verified-against-target-build' },
    M02: { releaseScope: 'release-unspecified', reason: 'dialogue-source-does-not-assert-game-release' },
    M03: { releaseScope: 'historical-game-release', reason: 'path-marker-1.13.X-does-not-resolve-stable-release-id' },
    M04: { releaseScope: 'workflow-document', reason: 'analysis-log-is-not-a-pinned-game-release' },
    M05: { releaseScope: 'announcement-original', reason: 'dated-announcement-keeps-own-scope-no-game-release-inferred' },
    M06: { releaseScope: 'workflow-document', reason: 'prompt-document-is-not-a-pinned-game-release' },
    M07: { releaseScope: 'tool-document', reason: 'tool-repository-artifact-is-not-a-pinned-game-release' },
    M08: { releaseScope: 'reference-document', reason: 'reference-or-workspace-artifact-is-not-a-pinned-game-release' },
    K01: { releaseScope: 'release-unspecified', reason: 'retained-mods-file-does-not-assert-game-release' },
    K02: { releaseScope: 'release-unspecified', reason: 'maintenance-provenance-file-does-not-assert-game-release' },
  };
  return { gameReleaseId: null, ...defaults[group] };
}

function targetKindFor(owner, group, options = {}) {
  if (options.targetKind) return options.targetKind;
  if (owner === 'private') return 'private-archive';
  if (owner === 'mods') return 'mods-file';
  if (owner === 'extension') return 'extension-runtime-binding';
  if (owner === 'web') return group === 'M05' ? 'web-announcement' : 'web-record';
  if (owner === 'source') return group === 'M01' ? 'legacy-artifact' : 'source-document';
  throw new Error('unsupported W03 owner: ' + owner);
}

function dispositionFor(owner, group, options = {}) {
  if (options.disposition) return options.disposition;
  if (options.candidate) return 'migrated';
  if (owner === 'private') return 'private-restorable';
  if (owner === 'mods') return 'kept';
  if (owner === 'source' && (group === 'M01' || group === 'M03')) return 'archived-readable';
  return 'migrated';
}

function createEntryFactory(group, counterRef) {
  return function createEntry(record, owner, selector, fragment, options = {}) {
    counterRef.value++;
    const sequence = counterRef.value;
    const entryId = `mods-m${String(groupNumber.get(group)).padStart(2, '0')}-${String(sequence).padStart(7, '0')}`;
    const kind = targetKindFor(owner, group, options);
    const isRetained = owner === 'mods';
    const targetReason = isRetained ? 'retained-at-exact-source-location'
      : owner === 'private' ? 'restricted-original-relative-path-not-published'
        : options.candidate ? 'candidate-not-approved-or-generated'
          : 'planned-target-not-generated';
    const scope = scopeFor(group, options.scope);
    const entry = {
      entryId,
      schemaVersion: ENTRY_SCHEMA_VERSION,
      source: { repoId: MODS_REPO_ID, commit: MODS_COMMIT, path: record.path, gitBlobOid: record.gitBlobOid },
      sourceEntityKey: { kind: 'path-scope', value: record.path, reason: null },
      selector,
      fragment,
      owner,
      target: {
        repoId: isRetained ? MODS_REPO_ID : null,
        commit: isRetained ? MODS_COMMIT : null,
        path: isRetained ? record.path : null,
        fieldPath: options.fieldPath ?? (owner === 'private' ? 'archiveEntry' : owner === 'mods' ? 'originalFile' : owner === 'web' ? 'playerPresentation.fragment' : 'legacyAnalysis.fragment'),
        gameReleaseId: null,
        gameReleaseIdNotApplicableReason: options.targetGameReleaseReason ?? (group === 'M05'
          ? 'dated-announcement-does-not-prove-stable-game-release-id'
          : 'planned-target-does-not-assign-unverified-game-release'),
        recordId: null,
        recordIdNotApplicableReason: options.recordIdReason ?? (owner === 'private' ? 'archive-entry-is-not-a-game-record'
          : owner === 'mods' ? 'retained-file-is-not-a-game-record'
            : options.candidate ? 'candidate-has-no-approved-record-id'
              : owner === 'web' ? 'web-fragment-needs-curated-record-id' : 'source-fragment-needs-curated-record-id'),
        kind,
        status: isRetained ? 'retained' : 'not-generated',
        reason: targetReason,
      },
      scope,
      mappingStatus: 'planned',
      intendedDisposition: dispositionFor(owner, group, options),
      actualOutcome: { status: 'not-started' },
      review: {
        carryForward: 'not-assumed',
        basisRefs: options.basisRefs ?? ['W03/' + group, 'v17-B'],
        state: options.reviewState ?? (owner === 'mods' || owner === 'private' ? 'not-applicable' : 'pending'),
      },
      linkDisposition: options.linkDisposition ?? (owner === 'private' ? 'preserve-original-relative-path'
        : owner === 'mods' ? 'retain-exact-source-blob'
          : options.candidate ? 'candidate-pointer-only-no-publication' : 'planned-source-pointer-and-fragment-hash'),
      rollback: { repoId: MODS_REPO_ID, commit: MODS_COMMIT, path: record.path, gitBlobOid: record.gitBlobOid },
    };
    if (options.splitGroupId) entry.splitGroupId = options.splitGroupId;
    if (options.dedupGroupId) entry.dedupGroupId = options.dedupGroupId;
    if (options.evidenceRefs) entry.evidenceRefs = options.evidenceRefs;
    return entry;
  };
}

function wholeFileEntry(makeEntry, record, owner, group, options = {}) {
  return makeEntry(record, owner, { kind: 'file', locator: 'file' },
    { normalization: 'git-blob', gitBlobOid: record.gitBlobOid }, options);
}

function blockEntry(makeEntry, record, block, owner, group, options = {}) {
  if (!Buffer.isBuffer(block.sourceBytes)) throw new Error('source bytes were not supplied for a selected fragment');
  const entry = makeEntry(record, owner, block.selector,
    { normalization: block.fragment.normalization, sha256: block.fragment.sha256 }, {
      ...options,
      fieldPath: options.fieldPath ?? (owner === 'web' ? (group === 'M05' ? 'announcement.originalBlock' : 'playerPresentation.fragment')
        : owner === 'source' ? (group === 'M01' ? 'legacyAnalysis.fragment' : 'sourceEvidence.fragment') : undefined),
      linkDisposition: block.kind === 'imageoccurrence' ? 'preserve-image-occurrence-no-fetch' : options.linkDisposition,
      dedupGroupId: block.dedupGroupId,
    });
  const integrityIssues = verifyEntryFragment(entry, block.sourceBytes);
  if (integrityIssues.length) throw new Error('selector/hash verification failed: ' + integrityIssues[0].code);
  return entry;
}

function isM01WebBlock(block) {
  const context = `${block.sectionPath ?? ''}\n${block.text ?? ''}`;
  return /玩家(?:摘要|向|資訊|說明)|官方(?:原文|摘錄|公告)|繁中原文勘誤|原文勘誤|玩家可讀/u.test(context);
}

function ownerForPrompt(pathName, block) {
  if (pathName.includes('Dialogue-Text-Workflow')) return 'private';
  if (pathName.includes('Announcement-Translation') || pathName.includes('Skill-Pages-Workflow')) return 'web';
  const context = `${block.sectionPath ?? ''}\n${block.text ?? ''}`;
  if (/玩家摘要|玩家可讀|官網摘錄|公告翻譯|網頁呈現|技能頁/u.test(context)) return 'web';
  if (/對話原文|私有素材|本機raw|受限封存/u.test(context)) return 'private';
  return 'source';
}

function lineFragment(bytes, line, kind = 'line') {
  const start = line.start;
  const end = line.contentEnd;
  const fragmentBytes = bytes.subarray(start, end);
  return {
    selector: { kind: 'occurrence', locator: `L${line.number}:row`, occurrence: line.occurrence ?? 1, startByte: start, endByte: end },
    fragment: { normalization: 'raw', sha256: sha256(fragmentBytes) },
    text: fragmentBytes.toString('utf8'),
    sourceBytes: bytes,
    byteStart: start,
    byteEnd: end,
    kind,
    lineNumber: line.number,
  };
}

function markdownTableRows(bytes) {
  const lines = splitLines(bytes);
  const result = [];
  let inTable = false;
  let sawHeader = false;
  let occurrence = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*\|.*\|\s*$/u.test(line.text)) {
      if (!inTable) { inTable = true; sawHeader = false; }
      if (!isTableSeparator(line.text)) {
        occurrence++;
        if (sawHeader) result.push(lineFragment(bytes, { ...line, number: index + 1, occurrence }, 'tablerow'));
        sawHeader = true;
      }
    } else {
      inTable = false;
      sawHeader = false;
    }
  }
  return result;
}

export function classifyTranslationBlock({ sectionPath = '', text = '', kind = 'listitem' }) {
  if (kind === 'heading') return [];
  const sections = sectionPath.split(' / ').filter(Boolean);
  const section = sections.join(' / ');
if (/Scab Radio Operator/iu.test(text)) {
    return [
      { owner: 'source', targetKind: 'quarantine', fieldPath: 'terms.enemies.technicalClassificationCandidate', candidate: true, reviewState: 'pending', classificationDomain: 'enemies', linkDisposition: 'known-identity-availability-pending' },
      { owner: 'web', targetKind: 'candidate', fieldPath: 'terms.enemies.zhTwLabelCandidate', candidate: true, reviewState: 'pending', classificationDomain: 'enemies', linkDisposition: 'translation-pending-no-approved-label' },
    ];
  }
  const hasHistoricalReleaseNote = /(?:1\.13\.1|Build\s*25606770)/iu.test(text) && /怪物|Hit Mass|命中質量|機制說明/iu.test(section + '\n' + text);
  if (/待確認定義/u.test(section) && !hasHistoricalReleaseNote) {
    return [{ owner: 'private', targetKind: 'quarantine', fieldPath: 'terms.unreviewed.quarantine', disposition: 'private-restorable', reviewState: 'pending', reason: 'definition-requires-human-review' }];
  }
  if (/(?:1\.13\.1|Build\s*25606770)/iu.test(text) && /怪物|Hit Mass|命中質量|機制說明/u.test(`${section}\n${text}`)) {
    return [{ owner: 'source', targetKind: 'legacy-artifact', fieldPath: 'legacyAnalysis.historicalTermNote', disposition: 'archived-readable', reviewState: 'pending', scope: { gameReleaseId: null, releaseScope: 'historical-legacy-marker', reason: 'inline-version-marker-retained-no-current-claim' }, reason: 'historical-marker-retained-with-source-selector', evidenceKind: 'historical-release-note' }];
  }
  const split = (domain, suffix = 'Candidate') => [
    { owner: 'source', targetKind: 'candidate', fieldPath: `terms.${domain}.concept${suffix}`, candidate: true, reviewState: 'pending', classificationDomain: domain },
    { owner: 'web', targetKind: 'candidate', fieldPath: `terms.${domain}.zhTwLabel${suffix}`, candidate: true, reviewState: 'pending', classificationDomain: domain },
  ];
  const isCompanionModContext = /當MOD/u.test(text) && /電子獒犬/u.test(text);
  if (isCompanionModContext) return [{ owner: 'mods', fieldPath: 'localization.modContext.companion', linkDisposition: 'retain-mod-specific-companion-context' }];
  if (/支援單位/u.test(text) && /電子獒犬/u.test(text)) return split('Companion');
  const centerScreen = /中心[^\n]*?(?:用於表達畫面位置時)/u.exec(text);
  const centerArea = /中央[^\n]*?(?:用於表達遊戲區域)/u.exec(text);
  if (/Center/u.test(text) && centerScreen && centerArea) {
    return [
      { owner: 'mods', fieldPath: 'localization.modUi.screenPosition', slice: centerScreen[0], linkDisposition: 'retain-mod-specific-ui-context' },
      ...split('Center', 'Candidate').map(item => ({ ...item, slice: centerArea[0] })),
    ];
  }
  if (/Perk/u.test(text) && /遊戲原生用詞/u.test(text)) return split('Perk');
  const pureModHeadings = new Set(['MOD', 'MOD名稱', 'MOD名詞', 'MOD Enhanced descriptions 專用詞表']);
  const mixedModHeading = sections.some(value => /通稱、陣營與MOD名稱/u.test(value));
  if (sections.some(value => pureModHeadings.has(value.trim()))) {
    return [{ owner: 'mods', fieldPath: 'localization.modGlossary.entry', linkDisposition: 'retain-mod-specific-glossary-context' }];
  }
  if (mixedModHeading && /\b(?:MOD|AutoBlitz|Scoreboard|Radar|Enhanced descriptions)\b/u.test(text)) {
    return [{ owner: 'mods', fieldPath: 'localization.mixedModGlossary.entry', linkDisposition: 'retain-mod-specific-mixed-context' }];
  }
  let domain = 'general';
  if (/怪物相關|BOSS|專家|菁英|一般兵|特殊任務單位/u.test(section)) domain = 'enemies';
  else if (/武器祝福/u.test(section)) domain = 'blessings';
  else if (/裝備屬性|珍品屬性/u.test(section)) domain = 'equipment';
  else if (/武器|Melee Weapon|Ranged Weapon/u.test(section)) domain = 'weapons';
  else if (/職業與天賦|天賦相關|Psyker|Ogryn|Zealot|Veteran|Arbites|Hive Scum|Skitarius/u.test(section)) domain = 'classes';
  else if (/遊戲活動|興奮劑|遊戲詞條|浩劫/u.test(section)) domain = 'gameContent';
  else if (/基礎名詞|通用名詞|特殊情境詞|增益效果|減益效果|難度|其他/u.test(section)) domain = 'general';
  if (section) return split(domain);
  return [{ owner: 'mods', fieldPath: 'localization.reference.unclassified', linkDisposition: 'retain-unclassified-reference-context' }];
}

function historicalEvidenceId(record, block) {
  return stableId('source-evidence', record.gitBlobOid + '\n' + block.selector.locator + '\n' + block.fragment.sha256);
}

function translationTermEntries(makeEntry, record, bytes, block, group, historicalBasisRefs = []) {
  const plans = classifyTranslationBlock(block);
  const baseSplitId = stableId('split', `${record.path}\n${block.selector.locator}\n${record.gitBlobOid}`);
  return plans.flatMap((plan, planIndex) => {
    let selected = block;
    if (plan.slice) {
      const charIndex = block.text.indexOf(plan.slice);
      if (charIndex < 0) throw new Error(`classified term slice is not present in source block at ${block.selector.locator}`);
      const byteStart = block.byteStart + Buffer.byteLength(block.text.slice(0, charIndex), 'utf8');
      const bytesPart = Buffer.from(plan.slice, 'utf8');
      selected = {
        kind: 'term-context',
        selector: { kind: 'occurrence', locator: `L${block.lineNumber}:C${Buffer.byteLength(block.text.slice(0, charIndex), 'utf8') + 1}:term-context`, occurrence: planIndex + 1, startByte: byteStart, endByte: byteStart + bytesPart.length },
        fragment: { normalization: 'raw', sha256: sha256(bytesPart) },
        text: plan.slice, byteStart, byteEnd: byteStart + bytesPart.length, lineNumber: block.lineNumber,
        sourceBytes: bytes,
      };
    }
    const splitGroupId = plans.length > 1 ? stableId('split', `${baseSplitId}\n${selected.selector.locator}`) : undefined;
    return [blockEntry(makeEntry, record, selected, plan.owner, group, {
      candidate: plan.candidate,
      targetKind: plan.targetKind,
      fieldPath: plan.fieldPath,
      disposition: plan.disposition,
      scope: plan.scope,
      reviewState: plan.reviewState,
      linkDisposition: plan.linkDisposition,
      splitGroupId,
      basisRefs: [
        'W03/' + group, 'v17-B:translation-reference-split',
        ...(plan.classificationDomain === 'enemies' ? historicalBasisRefs : []),
      ],
      evidenceRefs: plan.evidenceKind === 'historical-release-note' ? [historicalEvidenceId(record, block)] : undefined,
    })];
  });
}

function createRecordEntries(record, group, bytes, makeEntry) {
  if (group === 'M02' || group === 'M03' || group === 'M04') {
    const scope = group === 'M03' ? scopeFor(group) : scopeFor(group);
    return [wholeFileEntry(makeEntry, record, 'private', group, { scope })];
  }
  if (group.startsWith('K')) return [wholeFileEntry(makeEntry, record, 'mods', group)];
  if (group === 'M07') {
    const owner = /scripts\/game-info\/(?:validate_game_info\.py|tests\/test_validate_game_info\.py)$/u.test(record.path) ? 'source'
      : /render_skill_pages\.mjs$/u.test(record.path) ? 'web' : 'private';
    return [wholeFileEntry(makeEntry, record, owner, group, {
      fieldPath: owner === 'private' ? 'toolArchive.source' : owner === 'source' ? 'sourceValidation.tool' : 'webRendering.tool',
      reviewState: 'not-applicable',
    })];
  }
  if (group === 'M08' && record.path !== 'Referneces/Translation.md' && !record.path.endsWith('Term Candidates.md')) {
    return [wholeFileEntry(makeEntry, record, 'mods', group, { fieldPath: 'workspaceArchive.originalFile' })];
  }
  if (group === 'M01' && !record.path.endsWith('.md')) {
    return [wholeFileEntry(makeEntry, record, 'source', group, {
      fieldPath: 'legacyAnalysis.structuredSource',
      reviewState: 'pending',
    })];
  }
  let blocks;
  try { blocks = extractAnnouncementBlocks(bytes); }
  catch (error) {
    const fallbackOwner = group === 'M05' ? 'web' : group === 'M08' ? 'mods' : 'source';
    return [wholeFileEntry(makeEntry, record, fallbackOwner, group, {
      fieldPath: 'legacyArchive.unsplitFile',
      reviewState: 'pending',
      linkDisposition: 'parser-could-not-bound-mixed-content-preserve-source-pointer',
      basisRefs: ['W03/' + group, 'selector-scan-fallback'],
    })];
  }
  if (group === 'M01') {
    const webBlocks = blocks.filter(isM01WebBlock);
    if (!webBlocks.length) return [wholeFileEntry(makeEntry, record, 'source', group, { fieldPath: 'legacyAnalysis.wholeDocument', reviewState: 'pending' })];
    return blocks.map(block => blockEntry(makeEntry, record, block, isM01WebBlock(block) ? 'web' : 'source', group, {
      disposition: isM01WebBlock(block) ? 'migrated' : 'archived-readable',
      scope: scopeFor(group),
      reviewState: 'pending',
    }));
  }
  if (group === 'M05') {
    return blocks.map(block => blockEntry(makeEntry, record, block, 'web', group, {
      fieldPath: block.kind === 'imageoccurrence' ? 'announcement.assets.reference' : 'announcement.blocks.' + block.kind,
      disposition: 'migrated', reviewState: 'pending',
    }));
  }
  if (group === 'M06') {
    if (record.path.includes('Dialogue-Text-Workflow')) {
      return blocks.map(block => blockEntry(makeEntry, record, block, 'private', group, { fieldPath: 'promptArchive.dialogueWorkflow' }));
    }
    return blocks.map(block => blockEntry(makeEntry, record, block, ownerForPrompt(record.path, block), group, {
      fieldPath: 'workflow.promptSection', reviewState: 'pending',
    }));
  }
  if (group === 'M08' && record.path.endsWith('Term Candidates.md')) {
    const rows = markdownTableRows(bytes);
    return rows.map(row => blockEntry(makeEntry, record, row, 'source', group, {
      candidate: true, targetKind: 'candidate', fieldPath: 'terms.unverifiedCandidate',
      scope: { gameReleaseId: null, releaseScope: 'current-snapshot-candidate', reason: 'candidate-source-does-not-prove-current-release-or-identity' },
      reviewState: 'pending', linkDisposition: 'candidate-row-pointer-only-not-approved',
    }));
  }
  if (group === 'M08' && record.path === 'Referneces/Translation.md') {
    const historicalBasisRefs = blocks.flatMap(block => {
      const plans = classifyTranslationBlock(block);
      return plans.some(plan => plan.evidenceKind === 'historical-release-note')
        ? [historicalEvidenceId(record, block)] : [];
    });
    return blocks.flatMap(block => translationTermEntries(makeEntry, record, bytes, block, group, historicalBasisRefs));
  }
  return [wholeFileEntry(makeEntry, record, 'mods', group)];
}

function inventoryDigest(records) {
  const canonical = records.slice().sort((a, b) => compare(a.path, b.path))
    .map(record => `${record.mode}\0${record.gitBlobOid}\0${record.size}\0${record.path}\0`).join('');
  return sha256(Buffer.from(canonical, 'utf8'));
}

function groupRecords(records) {
  const groups = new Map(GROUP_ORDER.map(group => [group, []]));
  for (const record of records) groups.get(classifySourcePath(record.path)).push(record);
  for (const group of groups.values()) group.sort((a, b) => compare(a.path, b.path));
  return groups;
}

function buildLedger(repoPath, commit) {
  if (commit !== MODS_COMMIT) throw new Error(`refusing non-pinned Mods commit: ${commit}`);
  const tree = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-tree', '-r', '-l', '-z', '--full-tree', commit], {
    cwd: repoPath, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024,
  });
  const records = parseGitTreeBuffer(tree);
  const byGroup = groupRecords(records);
  const expectedCounts = { M01: 3071, M02: 78489, M03: 3, M04: 522, M05: 5, M06: 6, M07: 8, M08: 62, K01: 1090, K02: 4 };
  for (const group of GROUP_ORDER) {
    if (byGroup.get(group).length !== expectedCounts[group]) {
      throw new Error(`source group ${group} count mismatch: expected ${expectedCounts[group]}, got ${byGroup.get(group).length}`);
    }
  }
  const entriesByGroup = new Map(GROUP_ORDER.map(group => [group, []]));
  const factories = new Map(GROUP_ORDER.map(group => [group, createEntryFactory(group, { value: 0 })]));
  for (const group of GROUP_ORDER) {
    for (const record of byGroup.get(group)) {
      let bytes;
      const needsContent = group === 'M01' && record.path.endsWith('.md')
        || group === 'M05' || group === 'M06'
        || group === 'M08' && (record.path === 'Referneces/Translation.md' || record.path.endsWith('Term Candidates.md'));
      if (needsContent) {
        bytes = execFileSync('git', ['cat-file', 'blob', record.gitBlobOid], {
          cwd: repoPath, encoding: 'buffer', maxBuffer: Math.min(Math.max(record.size + 1024, 1024 * 1024), 64 * 1024 * 1024),
        });
        if (bytes.length !== record.size) throw new Error(`blob size mismatch for pinned source path in ${group}`);
      }
      entriesByGroup.get(group).push(...createRecordEntries(record, group, bytes, factories.get(group)));
    }
  }
  return { records, byGroup, entriesByGroup };
}

function makeShards(entriesByGroup, byGroup, maxBytes = 8 * 1024 * 1024) {
  const shardFiles = [];
  const groupMetadata = [];
  for (const group of GROUP_ORDER) {
    const entries = entriesByGroup.get(group);
    const pieces = [];
    let current = [];
    let currentBytes = 2;
    for (const entry of entries) {
      const bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8') + (current.length ? 1 : 0);
      if (bytes + 2 > maxBytes) throw new Error(`single entry exceeds shard bound: ${entry.entryId}`);
      if (current.length && currentBytes + bytes > maxBytes) {
        pieces.push(current);
        current = [];
        currentBytes = 2;
      }
      current.push(entry);
      currentBytes += bytes;
    }
    if (current.length) pieces.push(current);
    const shards = [];
    for (let index = 0; index < pieces.length; index++) {
      const name = `${group.toLowerCase()}-${String(index + 1).padStart(3, '0')}.json`;
      const relativePath = `mods/shards/${name}`;
      const data = Buffer.from(JSON.stringify(pieces[index]), 'utf8');
      const shard = { path: relativePath, entryCount: pieces[index].length, sizeBytes: data.length, sha256: sha256(data) };
      shards.push(shard);
      shardFiles.push({ ...shard, data, groupId: group });
    }
    groupMetadata.push({
      groupId: group,
      sourcePathCount: byGroup.get(group).length,
      entryCount: entries.length,
      sourceInventorySha256: null,
      shards,
    });
  }
  return { shardFiles, groupMetadata };
}

export function validateLedgerSnapshot(index, shardBuffers) {
  const issues = [];
  if (!isObject(index) || index.format !== 'w03-mods-mapping-ledger.v1' || index.entrySchemaVersion !== ENTRY_SCHEMA_VERSION) {
    return [issue('index-format', 'mapping ledger index has unsupported format or entry schema')];
  }
  if (!Array.isArray(index.groups) || !Array.isArray(index.shards) || !isObject(shardBuffers)) {
    return [issue('index-shape', 'mapping ledger groups, shards, or shard bytes are missing')];
  }
  const declared = new Map(index.shards.map(shard => [shard.path, shard]));
  if (declared.size !== index.shards.length) issues.push(issue('duplicate-shard-path', 'top-level shard paths must be unique'));
  const declaredGroupIds = new Set();
  const ids = new Set();
  const files = new Set();
  const observedGroupEntries = new Map();
  const observedGroupPaths = new Map();
  let entryCount = 0;
  for (const [pathName, bytes] of Object.entries(shardBuffers)) {
    files.add(pathName);
    const meta = declared.get(pathName);
    if (!meta) { issues.push(issue('unlisted-shard', `shard is not listed: ${pathName}`)); continue; }
    if (!Buffer.isBuffer(bytes) || bytes.length !== meta.sizeBytes || sha256(bytes) !== meta.sha256) {
      issues.push(issue('shard-hash', `shard size or digest mismatch: ${pathName}`));
      continue;
    }
    let rows;
    try { rows = JSON.parse(bytes.toString('utf8')); }
    catch { issues.push(issue('shard-json', `shard is invalid JSON: ${pathName}`)); continue; }
    if (!Array.isArray(rows) || rows.length !== meta.entryCount) {
      issues.push(issue('shard-count', `shard entry count mismatch: ${pathName}`)); continue;
    }
    entryCount += rows.length;
    for (const entry of rows) {
      if (ids.has(entry.entryId)) issues.push(issue('duplicate-entry-id', `duplicate entry id: ${entry.entryId}`));
      ids.add(entry.entryId);
      const groupId = classifySourcePath(entry.source?.path ?? '');
      observedGroupEntries.set(groupId, (observedGroupEntries.get(groupId) ?? 0) + 1);
      if (!observedGroupPaths.has(groupId)) observedGroupPaths.set(groupId, new Set());
      observedGroupPaths.get(groupId).add(entry.source.path);
      const entryIssues = validateMappingEntry(entry);
      for (const validationIssue of entryIssues) issues.push(issue('entry-' + validationIssue.code, `${entry.entryId}: ${validationIssue.message}`, validationIssue.path));
    }
  }
  for (const pathName of declared.keys()) if (!files.has(pathName)) issues.push(issue('missing-shard', `listed shard is missing: ${pathName}`));
  const groupEntries = index.groups.reduce((sum, group) => sum + group.entryCount, 0);
  if (entryCount !== index.entryCount || groupEntries !== index.entryCount) issues.push(issue('index-entry-count', 'entry counts do not match index'));
  const groupShardCounts = index.groups.reduce((sum, group) => sum + group.shards.length, 0);
  if (groupShardCounts !== index.shards.length) issues.push(issue('index-shard-count', 'group and top-level shard lists differ'));
  for (const group of index.groups) {
    if (declaredGroupIds.has(group.groupId)) issues.push(issue('duplicate-group-id', `duplicate group id: ${group.groupId}`));
    declaredGroupIds.add(group.groupId);
    if (group.entryCount !== (observedGroupEntries.get(group.groupId) ?? 0)) issues.push(issue('group-entry-count', `entry count mismatch for ${group.groupId}`));
    if (group.sourcePathCount !== (observedGroupPaths.get(group.groupId)?.size ?? 0)) issues.push(issue('group-source-path-count', `source path count mismatch for ${group.groupId}`));
    for (const shard of group.shards) {
      if (!declared.has(shard.path) || JSON.stringify(declared.get(shard.path)) !== JSON.stringify(shard)) {
        issues.push(issue('group-shard-reference', `group shard reference differs from top-level index: ${shard.path}`));
      }
    }
  }
  if (index.source?.pathCount !== index.groups.reduce((sum, group) => sum + group.sourcePathCount, 0)) {
    issues.push(issue('source-path-count', 'group source path counts do not match source inventory total'));
  }
  return issues;
}

async function writeLedger(repoPath, commit, outputRoot) {
  const expected = path.resolve(DOC_ROOT);
  if (path.resolve(outputRoot) !== expected) throw new Error(`output root must be the B allowlisted docs path: ${expected}`);
  const built = buildLedger(repoPath, commit);
  const { shardFiles, groupMetadata } = makeShards(built.entriesByGroup, built.byGroup);
  for (let index = 0; index < groupMetadata.length; index++) {
    const group = groupMetadata[index];
    group.sourceInventorySha256 = inventoryDigest(built.byGroup.get(group.groupId));
  }
  const allShardMetadata = groupMetadata.flatMap(group => group.shards);
  const index = {
    format: 'w03-mods-mapping-ledger.v1',
    entrySchemaVersion: ENTRY_SCHEMA_VERSION,
    source: {
      repoId: MODS_REPO_ID,
      commit,
      pathCount: built.records.length,
      treeInventorySha256: inventoryDigest(built.records),
      contentReadPolicy: {
        restrictedDialogueFilesRead: 0,
        privateLogFilesRead: 0,
        retainedModsFilesRead: 0,
        selectedPublicMarkdownGroups: ['M01', 'M05', 'M06', 'M08-selected'],
      },
    },
    mapping: { mappingStatus: 'planned', actualOutcome: 'not-started', currentCompatibilityInferred: false },
    entryCount: allShardMetadata.reduce((sum, shard) => sum + shard.entryCount, 0),
    groups: groupMetadata,
    shards: allShardMetadata,
    privateToolReceipt: {
      toolCount: 3,
      privateContentAggregateSha256: '8dc9aaae9846847fc102737e0f9fb4b2a352c1d87304e45e53d1b8ab57048fed',
      scheme: 'sha256(JSON.stringify(sha256-git-blob-bytes-in-basename-ascending-order))',
      publicCounterpartOptionSurface: 'same-option-names; source-byte-digests-differ',
      cliExecuted: false,
      behaviorEquivalenceClaimed: false,
      privateLocatorsOrPerFileDigestsPublished: false,
    },
    localModsDeltaReceipt: { preservedUntrackedDocumentCount: 3, publicBodyIncluded: false, aggregateReceiptSha256: '9f0d20261b4d53e2cd595342e474a419dcebb3299a6859bda9fe2984a2babedc' },
  };
  index.shards.sort((a, b) => compare(a.path, b.path));
  await mkdir(path.join(outputRoot, 'shards'), { recursive: true });
  for (const shard of shardFiles) await writeFile(path.join(outputRoot, shard.path.replace(/^mods\//u, '')), shard.data);
  await writeFile(path.join(outputRoot, 'mapping-ledger.json'), Buffer.from(JSON.stringify(index, null, 2) + '\n', 'utf8'));
  const privateSafe = JSON.stringify(index.privateToolReceipt);
  const doc = [
    '# W03 Mods mapping ledger', '',
    'This generated ledger maps fixed-commit source selectors to planned owners. Every row remains `mappingStatus: planned` and `actualOutcome: not-started`; it does not record a migration or content approval.', '',
    `Source pin: Mods repository id \`${MODS_REPO_ID}\`, commit \`${commit}\`, ${built.records.length} tracked paths. The tree and each group have deterministic inventory digests in \`mapping-ledger.json\`.`, '',
    '| Group | Paths | Planned entries | Shards |', '| --- | ---: | ---: | ---: |',
    ...groupMetadata.map(group => `| ${group.groupId} | ${group.sourcePathCount} | ${group.entryCount} | ${group.shards.length} |`), '',
    'M02 dialogue entries are Git-tree metadata only: no dialogue file bytes were read. M04 logs, K01/K02 retained files, and M07 tool source files are also mapped by Git blob metadata only. M01 legacy analysis is not treated as current game data; unverified release IDs stay null. M05 preserves each heading, paragraph, list item, table cell, image occurrence, and spoiler selector without fetching image assets. M06 and mixed M08 references use bounded block/entry selectors. No repeated term is deduplicated across contexts.', '',
    `Private tool receipt: ${privateSafe}. It contains only a three-tool aggregate digest and CLI-surface note; no private locator or per-file digest is published. Three existing untracked Mods documents remain preserved locally; their contents are not copied into this ledger.`, '',
    'This ledger is not a renderer/runtime integration, not a full restore, not a current-compatibility determination, and not publication approval. Rollback points retain the exact source commit/blob. Human review remains pending where the target would create or display game content.', '',
  ].join('\n');
  await writeFile(path.join(outputRoot, 'README.md'), Buffer.from(doc, 'utf8'));
  return { index, shardFiles };
}

async function verifyDocs(root = DOC_ROOT) {
  const indexBytes = await readFile(path.join(root, 'mapping-ledger.json'));
  const index = JSON.parse(indexBytes.toString('utf8'));
  const shards = {};
  for (const shard of index.shards ?? []) shards[shard.path] = await readFile(path.join(root, shard.path.replace(/^mods\//u, '')));
  const issues = validateLedgerSnapshot(index, shards);
  const expectedFiles = new Set(['README.md', 'mapping-ledger.json', 'shards']);
  const actualTop = await readdir(root);
  for (const name of actualTop) if (!expectedFiles.has(name)) issues.push(issue('extra-artifact', `unexpected artifact in ledger root: ${name}`));
  for (const name of expectedFiles) {
    if (!actualTop.includes(name)) issues.push(issue('missing-artifact', `ledger root artifact missing: ${name}`));
  }
  const shardNames = new Set((index.shards ?? []).map(shard => shard.path.split('/').slice(2).join('/')));
  const actualShards = await readdir(path.join(root, 'shards'));
  for (const name of actualShards) if (!shardNames.has(name)) issues.push(issue('extra-shard', `unlisted shard artifact: ${name}`));
  for (const name of shardNames) if (!actualShards.includes(name)) issues.push(issue('missing-shard-file', `shard artifact missing: ${name}`));
  if (issues.length) return { issues, index };
  return { issues: [], index, entryCount: index.entryCount, shardCount: index.shards.length };
}

function main() {
  const args = process.argv.slice(2);
  const option = name => {
    const index = args.indexOf(name);
    return index < 0 ? null : args[index + 1] ?? null;
  };
  if (args.includes('--help')) {
    process.stdout.write('W03 Mods ledger CLI: default mode verifies offline; --generate --repo <fixed Mods clone> --commit <pinned SHA> --out-root <docs/contracts/w03/mods>.\n');
    return 0;
  }
  if (args.includes('--generate')) {
    const repo = option('--repo');
    const commit = option('--commit');
    const outputRoot = option('--out-root');
    if (!repo || !commit || !outputRoot) {
      process.stderr.write('generation requires --repo, --commit, and --out-root\n');
      return 2;
    }
    writeLedger(path.resolve(repo), commit, path.resolve(outputRoot)).then(result => {
      process.stdout.write(JSON.stringify({ status: 'generated', sourcePathCount: result.index.source.pathCount, entryCount: result.index.entryCount, shardCount: result.index.shards.length }) + '\n');
    }).catch(error => {
      process.stderr.write(`generation failed: ${error.message}\n`);
      process.exitCode = 1;
    });
    return undefined;
  }
  verifyDocs().then(result => {
    if (result.issues.length) {
      process.stderr.write(JSON.stringify({ status: 'invalid', issues: result.issues }) + '\n');
      process.exitCode = 1;
      return;
    }
    process.stdout.write(JSON.stringify({ status: 'valid', sourcePathCount: result.index.source.pathCount, entryCount: result.entryCount, shardCount: result.shardCount }) + '\n');
  }).catch(error => {
    process.stderr.write(`verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
  return undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
