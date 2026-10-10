export function parseJsonSource(bytes, sourceId) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`invalid JSON source bytes: ${sourceId}`);
  }
}

export function readJsonSelector(document, selector) {
  if (typeof selector !== 'string' || !selector.startsWith('json:/')) {
    throw new Error(`invalid JSON selector: ${selector}`);
  }
  let value = document;
  for (const encoded of selector.slice('json:/'.length).split('/')) {
    if (!encoded || /~(?![01])/.test(encoded)) throw new Error(`invalid JSON selector: ${selector}`);
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(value)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
        throw new Error(`missing JSON selector: ${selector}`);
      }
    } else if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      throw new Error(`missing JSON selector: ${selector}`);
    }
    value = value[key];
  }
  return value;
}

export function parseTsvSource(bytes, sourceId) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { throw new Error(`invalid TSV source bytes: ${sourceId}`); }
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closed = false;
  function finishField() {
    row.push(field);
    field = '';
    closed = false;
  }
  function finishRow() {
    finishField();
    records.push(row);
    row = [];
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === '\t') {
      finishField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r') {
        if (text[index + 1] !== '\n') throw new Error(`invalid TSV line ending: ${sourceId}`);
        index++;
      }
      finishRow();
    } else if (char === '"' && !closed && field === '') {
      quoted = true;
    } else if (closed || char === '"') {
      throw new Error(`invalid TSV quoting: ${sourceId}`);
    } else field += char;
  }
  if (quoted) throw new Error(`invalid TSV quoting: ${sourceId}`);
  if (row.length || field || closed) finishRow();
  const [header, ...values] = records;
  if (!header || header.length < 2 || header.some(name => !/^[a-z][a-z0-9_]*$/.test(name)) ||
      new Set(header).size !== header.length || !header.includes('id')) {
    throw new Error(`invalid TSV header: ${sourceId}`);
  }
  const idIndex = header.indexOf('id');
  const rows = new Map();
  for (const value of values) {
    if (value.length !== header.length) throw new Error(`invalid TSV column count: ${sourceId}`);
    const id = value[idIndex];
    if (!/^[a-z][a-z0-9._-]{0,127}$/.test(id)) throw new Error(`invalid TSV id: ${sourceId}`);
    if (rows.has(id)) throw new Error(`duplicate TSV id: ${id}`);
    rows.set(id, Object.fromEntries(header.map((name, index) => [name, value[index]])));
  }
  return { header, rows };
}

export function readTsvSelector(document, selector, sourcePath) {
  const matchPath = /^docs\/darktide-skills\/(arbites|ogryn|psyker|scum|skitarii|veteran|zealot)\.tsv$/.exec(sourcePath ?? '');
  if (!matchPath) throw new Error(`invalid TSV source path: ${sourcePath}`);
  if (selector === 'tsv:archetype') return matchPath[1];
  const match = /^tsv:row:([a-z][a-z0-9._-]{0,127}):([a-z][a-z0-9_]*)$/.exec(selector ?? '');
  if (!match) throw new Error(`invalid TSV selector: ${selector}`);
  const [, id, field] = match;
  const row = document?.rows?.get(id);
  if (!row) throw new Error(`missing TSV row: ${id}`);
  if (!document.header.includes(field)) throw new Error(`missing TSV field: ${field}`);
  return row[field];
}

export function parseMarkdownSource(bytes, sourceId) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).split(/\r?\n/);
  } catch {
    throw new Error(`invalid Markdown source bytes: ${sourceId}`);
  }
}

export function readMarkdownSelector(lines, selector) {
  const match = /^md:(anchor|detail):([a-z][a-z0-9_-]{0,127}):(title-zh|body-text)$/.exec(selector ?? '');
  if (!match) throw new Error(`invalid Markdown selector: ${selector}`);
  const [, mode, sectionId, field] = match;
  let headingIndex;
  let end;
  if (mode === 'anchor') {
    const anchorLine = `<a id="${sectionId}"></a>`;
    const positions = lines.flatMap((line, index) => line.trim() === anchorLine ? [index] : []);
    if (positions.length !== 1) throw new Error(`Markdown anchor is missing or ambiguous: ${sectionId}`);
    const start = positions[0] + 1;
    end = start;
    while (end < lines.length && lines[end].trim() !== '---' && !/^<a id=/.test(lines[end].trim())) end++;
    headingIndex = lines.findIndex((line, index) => index >= start && index < end && /^#{2,4}\s+\S/.test(line));
  } else {
    const detailLink = `](${sectionId}.md)`;
    const positions = lines.flatMap((line, index) => line.includes(detailLink) ? [index] : []);
    if (positions.length !== 1) throw new Error(`Markdown detail is missing or ambiguous: ${sectionId}`);
    end = positions[0] + 1;
    headingIndex = -1;
    for (let index = positions[0] - 1; index >= 0; index--) {
      if (lines[index].trim() === '---') break;
      if (/^#{2,3}\s+\S/.test(lines[index])) { headingIndex = index; break; }
    }
  }
  if (headingIndex < 0) throw new Error(`Markdown section has no heading: ${sectionId}`);
  const title = lines[headingIndex].replace(/^#{2,4}\s+/, '').trim();
  if (field === 'title-zh') {
    const name = title.replace(/(?:\([^()]*\)|（[^（）]*）)(?=：|$)/, '').trim();
    if (!name) throw new Error(`Markdown title is empty: ${sectionId}`);
    return name;
  }
  const bullets = [];
  for (const original of lines.slice(headingIndex + 1, end)) {
    const line = original.trim();
    if (/^####\s+\S/.test(line)) break;
    if (!line || /^<img\b[^>]*>$/.test(line) || /^\[(?:詳細資料|原始碼依據與算例條件)\]\(/.test(line)) continue;
    const bullet = /^-\s+(.+)$/.exec(line);
    if (!bullet) throw new Error(`unsupported Markdown body line: ${sectionId}`);
    const plain = bullet[1].replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_all, label, target) => {
      if (!/^[a-zA-Z0-9._/-]+(?:#[a-zA-Z0-9_-]+)?$/.test(target) ||
          target.split(/[\/#]/).includes('..')) throw new Error(`unsupported Markdown body link: ${sectionId}`);
      return label;
    });
    if (/<[^>]*>|\[[^\]]+\]\(/.test(plain)) {
      throw new Error(`unsupported Markdown body line: ${sectionId}`);
    }
    bullets.push(plain.replace(/\*\*|`/g, ''));
  }
  if (bullets.length === 0) throw new Error(`Markdown body is empty: ${sectionId}`);
  return bullets.join('\n');
}
