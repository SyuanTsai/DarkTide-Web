const ANNOUNCEMENT_ID = /^[a-z0-9][a-z0-9:._-]{1,127}$/u;
const SAFE_LINK_PATH = /^\/(?!\/)[^\s<>"'`]+$/u;

function fail(message) {
  throw new Error(message);
}

function stableId(prefix, counter) {
  const id = `${prefix}:block:${counter}`;
  if (!ANNOUNCEMENT_ID.test(id)) fail('announcement block id prefix is invalid');
  return id;
}

function appendText(runs, value) {
  if (!value) return;
  const last = runs.at(-1);
  if (last?.kind === 'text') last.text += value;
  else runs.push({ kind: 'text', text: value });
}

function compactRun(kind, children) {
  return children.every(child => child.kind === 'text')
    ? { kind, text: plainText(children) }
    : { kind, children };
}

function closingIndex(source, marker, start) {
  let index = source.indexOf(marker, start);
  while (index >= 0) {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor--) slashes++;
    if (slashes % 2 === 0) return index;
    index = source.indexOf(marker, index + marker.length);
  }
  return -1;
}

function matchingParen(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === '\\') { index++; continue; }
    if (source[index] === '(') depth++;
    else if (source[index] === ')' && --depth === 0) return index;
  }
  return -1;
}

function resolveHref(rawHref, resolveLink) {
  const href = typeof resolveLink === 'function' ? resolveLink(rawHref) : rawHref;
  if (typeof href !== 'string') fail('announcement link has an unsafe URL');
  if (SAFE_LINK_PATH.test(href)) return href;
  let parsed;
  try { parsed = new URL(href); } catch { fail('announcement link has an unsafe URL'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    fail('announcement link has an unsafe URL');
  }
  return parsed.href;
}

function parseInline(source, resolveLink) {
  const runs = [];
  for (let index = 0; index < source.length;) {
    if (source[index] === '\\' && index + 1 < source.length) {
      appendText(runs, source[index + 1]);
      index += 2;
      continue;
    }
    if (source[index] === '!' && source[index + 1] === '[') fail('unsupported inline image syntax');
    if (source[index] === '[') {
      const labelEnd = closingIndex(source, ']', index + 1);
      if (labelEnd >= 0 && source[labelEnd + 1] === '(') {
        const hrefEnd = matchingParen(source, labelEnd + 1);
        if (hrefEnd < 0) fail('announcement Markdown contains an unclosed link');
        const label = source.slice(index + 1, labelEnd);
        const rawHref = source.slice(labelEnd + 2, hrefEnd).trim();
        if (!label || !rawHref || /\s/u.test(rawHref)) fail('announcement Markdown link is malformed');
        const children = parseInline(label, resolveLink);
        const link = compactRun('link', children);
        link.href = resolveHref(rawHref, resolveLink);
        runs.push(link);
        index = hrefEnd + 1;
        continue;
      }
    }
    if (source[index] === '`') {
      const marker = source[index] === '`' && source[index + 1] === '`' ? '``' : '`';
      const end = closingIndex(source, marker, index + marker.length);
      if (end >= 0) {
        runs.push({ kind: 'code', text: source.slice(index + marker.length, end) });
        index = end + marker.length;
        continue;
      }
    }
    const marker = source.startsWith('**', index) || source.startsWith('__', index)
      ? source.slice(index, index + 2)
      : (source[index] === '*' || source[index] === '_') ? source[index] : null;
    if (marker) {
      const end = closingIndex(source, marker, index + marker.length);
      const hasContent = end > index + marker.length;
      const leftBoundary = index === 0 || !/\S/u.test(source[index - 1]);
      const rightBoundary = end === source.length - marker.length || !/\S/u.test(source[end + marker.length] ?? '');
      const validEmphasis = marker === '*' || marker === '**' || (leftBoundary && rightBoundary);
      if (hasContent && validEmphasis) {
        const kind = marker.length === 2 ? 'strong' : 'emphasis';
        runs.push(compactRun(kind, parseInline(source.slice(index + marker.length, end), resolveLink)));
        index = end + marker.length;
        continue;
      }
    }
    const autoLink = source.slice(index).match(/^https:\/\/[^\s<>]+/u)?.[0];
    if (autoLink) {
      const href = autoLink.replace(/[.,，。！!？?;；]+$/u, '');
      const trailing = autoLink.slice(href.length);
      if (href) runs.push({ kind: 'link', href: resolveHref(href, resolveLink), children: [{ kind: 'text', text: href }] });
      appendText(runs, trailing);
      index += autoLink.length;
      continue;
    }
    appendText(runs, source[index]);
    index++;
  }
  return runs;
}

function plainText(runs) {
  return runs.map(run => run.kind === 'break' ? '\n'
    : run.children ? plainText(run.children)
      : run.text ?? '').join('');
}

function splitTableRow(line) {
  let source = line.trim();
  if (source.startsWith('|')) source = source.slice(1);
  if (source.endsWith('|') && !source.endsWith('\\|')) source = source.slice(0, -1);
  const cells = [];
  let value = '';
  let code = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '\\' && index + 1 < source.length) {
      value += source[++index];
    } else if (char === '`') {
      code = !code;
      value += char;
    } else if (char === '|' && !code) {
      cells.push(value.trim());
      value = '';
    } else value += char;
  }
  cells.push(value.trim());
  return cells;
}

function tableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line);
}

function parseW15Blocks(lines, state, options, start = 0, endAt = null, lineOffset = 0) {
  const blocks = [];
  let index = start;
  const pushOccurrence = (blockId, kind, location) => state.occurrences.push({ blockId, kind, location });
  const id = () => stableId(options.idPrefix, ++state.nextId);

  const parseInlineBlock = (kind, value, extra = {}) => {
    const parts = value.split('\n');
    const inline = [];
    parts.forEach((part, partIndex) => {
      if (partIndex) inline.push({ kind: 'break' });
      inline.push(...parseInline(part, options.resolveLink));
    });
    return { blockId: id(), kind, text: plainText(inline), inline, ...extra };
  };

  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trimEnd();
    if (endAt && line === endAt) return { blocks, next: index + 1 };
    if (!line.trim()) { index++; continue; }
    if (line === '</details>' || line === '</summary>') fail('announcement Markdown has an unmatched spoiler tag');

    const details = line.match(/^\s*<details>\s*$/u);
    if (details) {
      const summaryIndex = index + 1;
      if (summaryIndex >= lines.length || !/^\s*<summary>[^<]+<\/summary>\s*$/u.test(lines[summaryIndex])) {
        fail('announcement spoiler must begin with a plain summary');
      }
      const summary = lines[summaryIndex].match(/^\s*<summary>([^<]+)<\/summary>\s*$/u)[1].trim();
      const parsed = parseW15Blocks(lines, state, options, summaryIndex + 1, '</details>');
      if (parsed.next <= summaryIndex + 1) fail('announcement spoiler is not closed');
      const block = { blockId: id(), kind: 'spoiler', label: summary, blocks: parsed.blocks };
      blocks.push(block);
      pushOccurrence(block.blockId, block.kind, { sourceLineStart: index + 1 + lineOffset, sourceLineEnd: parsed.next + lineOffset });
      index = parsed.next;
      continue;
    }
    if (/^\s*</u.test(line)) fail('unsupported raw HTML in announcement Markdown');

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (heading) {
      const block = parseInlineBlock('heading', heading[2], { level: heading[1].length });
      blocks.push(block);
      pushOccurrence(block.blockId, block.kind, { sourceLine: index + 1 + lineOffset });
      index++;
      continue;
    }

    const image = line.match(/^\s*!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)\s*$/u);
    if (image) {
      const [, alt, sourceUri] = image;
      const asset = options.assetsByUrl.get(sourceUri);
      let block;
      if (!asset && options.allowUnpinnedAssets) {
        block = { blockId: id(), kind: 'image', sourceUri, alt };
        state.assetOccurrences.push({ sourceUri, alt, blockId: block.blockId });
      } else {
        if (!asset) fail(`announcement image metadata missing for source URL: ${sourceUri}`);
        const normalized = {
          assetId: asset.assetId, mediaType: asset.mediaType, alt: asset.alt,
          sourceUri: asset.sourceUri, sha256: asset.sha256, sizeBytes: asset.sizeBytes,
        };
        if (normalized.sourceUri !== sourceUri) fail('announcement image metadata URL differs from the source occurrence');
        const previous = state.assets.get(normalized.assetId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) fail('announcement image asset metadata conflicts');
        state.assets.set(normalized.assetId, normalized);
        block = { blockId: id(), kind: 'image', assetRef: { assetId: normalized.assetId }, alt };
        state.assetOccurrences.push({ sourceUri, alt, blockId: block.blockId, assetId: normalized.assetId });
      }
      blocks.push(block);
      pushOccurrence(block.blockId, block.kind, { index: blocks.length - 1, sourceLine: index + 1 + lineOffset, sourceUri });
      index++;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && tableSeparator(lines[index + 1])) {
      const sourceLineStart = index + 1 + lineOffset;
      const sourceRows = [{ text: line, sourceLine: index + 1 + lineOffset }];
      index += 2;
      while (index < lines.length && /^\s*\|.*\|\s*$/u.test(lines[index])) {
        sourceRows.push({ text: lines[index], sourceLine: index + 1 + lineOffset });
        index++;
      }
      const rows = sourceRows.map(({ text: row, sourceLine }, rowIndex) => ({
        header: rowIndex === 0,
        cells: splitTableRow(row).map((text, columnIndex) => {
          const cellId = id();
          const inline = parseInline(text, options.resolveLink);
          pushOccurrence(cellId, 'table-cell', { row: rowIndex, column: columnIndex, sourceLine, sourceCellIndex: columnIndex + 1 });
          return { blockId: cellId, text: plainText(inline), inline };
        }),
      }));
      const block = { blockId: id(), kind: 'table', rows };
      blocks.push(block);
      pushOccurrence(block.blockId, block.kind, { sourceLineStart, sourceLineEnd: sourceRows.at(-1).sourceLine });
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/u);
    if (quote) {
      const sourceLineStart = index + 1 + lineOffset;
      const quoteLines = [];
      while (index < lines.length) {
        const next = lines[index].trimEnd();
        const match = next.match(/^\s*>\s?(.*)$/u);
        if (!match) break;
        quoteLines.push(match[1]);
        index++;
      }
      const parsedQuote = parseW15Blocks(quoteLines, state, options, 0, null, sourceLineStart - 1);
      const block = { blockId: id(), kind: 'quote', blocks: parsedQuote.blocks };
      blocks.push(block);
      pushOccurrence(block.blockId, block.kind, { sourceLineStart, sourceLineEnd: index + lineOffset });
      continue;
    }

    const marker = raw.match(/^( *)([-+*]|\d+[.)])\s+(.+)$/u);
    if (marker) {
      const sourceLineStart = index + 1 + lineOffset;
      const listResult = parseW15List(lines, index, state, options, marker[1].length, lineOffset);
      blocks.push(listResult.block);
      pushOccurrence(listResult.block.blockId, 'list', { sourceLineStart, sourceLineEnd: listResult.next + lineOffset });
      index = listResult.next;
      continue;
    }

    if (/^\s*(```|~~~)/u.test(line)) fail('unsupported fenced code block in announcement Markdown');
    if (/^\s*(?:---|\*\*\*|___)\s*$/u.test(line)) fail('unsupported thematic break in announcement Markdown');

    const sourceLineStart = index + 1 + lineOffset;
    const paragraphLines = [line.trim()];
    index++;
    while (index < lines.length && lines[index].trim()) {
      const next = lines[index].trimEnd();
      if (/^\s*(?:#{1,6}\s|>|!\[|<|`{3}|~{3})/u.test(next)
        || /^( *)(?:[-+*]|\d+[.)])\s+/u.test(next)
        || (next.includes('|') && index + 1 < lines.length && tableSeparator(lines[index + 1]))) break;
      paragraphLines.push(next.trim());
      index++;
    }
    const block = parseInlineBlock('paragraph', paragraphLines.join('\n'));
    blocks.push(block);
    pushOccurrence(block.blockId, block.kind, { sourceLineStart, sourceLineEnd: index + lineOffset });
  }

  if (endAt) fail('announcement spoiler is not closed');
  return { blocks, next: index };
}

function parseW15List(lines, start, state, options, baseIndent, lineOffset = 0) {
  const listMarker = raw => raw.match(/^( *)([-+*]|\d+[.)])\s+(.+)$/u);
  const first = listMarker(lines[start]);
  const ordered = /^\d/u.test(first[2]);
  const items = [];
  let index = start;
  while (index < lines.length) {
    const marker = listMarker(lines[index]);
    if (!marker || marker[1].length < baseIndent) break;
    if (marker[1].length === baseIndent) {
      if ((/^\d/u.test(marker[2])) !== ordered) break;
      const itemId = stableId(options.idPrefix, ++state.nextId);
      const inline = parseInline(marker[3].trim(), options.resolveLink);
      const item = { blockId: itemId, text: plainText(inline), inline, children: [] };
      state.occurrences.push({ blockId: itemId, kind: 'list-item', location: { sourceLine: index + 1 + lineOffset } });
      items.push(item);
      index++;
      while (index < lines.length) {
        if (!lines[index].trim()) {
          if (index + 1 < lines.length && listMarker(lines[index + 1])?.[1].length > baseIndent) { index++; continue; }
          break;
        }
        const nestedMarker = listMarker(lines[index]);
        const indent = (lines[index].match(/^ */u)?.[0].length ?? 0);
        if (nestedMarker && indent > baseIndent) {
          const nested = parseW15List(lines, index, state, options, indent, lineOffset);
          item.children.push(nested.block);
          index = nested.next;
          continue;
        }
        if (!nestedMarker && indent > baseIndent) {
          const continuation = lines[index].slice(baseIndent + 2).trim();
          if (continuation) {
            const childId = stableId(options.idPrefix, ++state.nextId);
            const childInline = parseInline(continuation, options.resolveLink);
            const child = { blockId: childId, kind: 'paragraph', text: plainText(childInline), inline: childInline };
            item.children.push(child);
            state.occurrences.push({ blockId: childId, kind: 'paragraph', location: { sourceLine: index + 1 + lineOffset } });
          }
          index++;
          continue;
        }
        break;
      }
    } else {
      break;
    }
  }
  if (!items.length) fail('announcement list could not be parsed');
  const listId = stableId(options.idPrefix, ++state.nextId);
  return { block: { blockId: listId, kind: 'list', ordered, items }, next: index };
}

/** Parse the fixed W15 plain-Markdown subset into closed typed announcement data. */
export function parseW15AnnouncementMarkdown(markdown, { idPrefix, assetsByUrl = new Map(), resolveLink, allowUnpinnedAssets = false } = {}) {
  if (typeof markdown !== 'string' || !markdown.trim()) fail('announcement Markdown must be non-empty text');
  if (typeof idPrefix !== 'string' || !ANNOUNCEMENT_ID.test(`${idPrefix}:block:1`)) fail('announcement block id prefix is invalid');
  if (!(assetsByUrl instanceof Map)) fail('announcement image metadata must be a Map');
  const normalized = markdown.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  const state = { nextId: 0, occurrences: [], assets: new Map(), assetOccurrences: [] };
  const parsed = parseW15Blocks(normalized.split('\n'), state, { idPrefix, assetsByUrl, resolveLink, allowUnpinnedAssets });
  return { blocks: parsed.blocks, occurrences: state.occurrences, assets: [...state.assets.values()], assetOccurrences: state.assetOccurrences };
}
