const SECTION_ORDER = Object.freeze([
  ['effects', '效果'],
  ['conditions', '條件'],
  ['calculation', '計算'],
  ['notes', '補充說明'],
  ['extra', '額外說明'],
]);

const UNAVAILABLE_TEXT = Object.freeze({
  missing: '目前沒有可用的繁體中文資料。',
  identity: '目前無法確認這筆資料的遊戲版本或對應內容。',
  official: '目前缺少同版本的繁體中文官方來源文字。',
  variant: '目前無法確認這個祝福變體適用於所選武器。',
  tier: '目前沒有這個等級的資料。',
  weapon: '目前沒有這個武器家族與種類的繁體中文資料。',
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function refKey(ref, fallbackKind) {
  if (!isObject(ref)) return null;
  const gameReleaseId = ref.gameReleaseId;
  const kind = ref.kind ?? fallbackKind;
  const recordId = ref.recordId;
  if (typeof gameReleaseId !== 'string' || !gameReleaseId || typeof kind !== 'string' || !kind || typeof recordId !== 'string' || !recordId) {
    return null;
  }
  return `${gameReleaseId}\u0000${kind}\u0000${recordId}`;
}

function sameRef(left, right, fallbackKind) {
  const leftKey = refKey(left, fallbackKind);
  return leftKey !== null && leftKey === refKey(right, fallbackKind);
}

function isDisplayText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function unavailable(reason, category = 'missing') {
  return {
    status: 'unavailable',
    reason,
    statusText: UNAVAILABLE_TEXT[category] ?? UNAVAILABLE_TEXT.missing,
  };
}

function addConsistent(map, conflicts, key, value) {
  if (conflicts.has(key)) return;
  if (!map.has(key)) {
    map.set(key, value);
    return;
  }
  if (JSON.stringify(map.get(key)) !== JSON.stringify(value)) {
    map.delete(key);
    conflicts.add(key);
  }
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isHumanReceipt(receipt) {
  return isObject(receipt) && receipt.reviewer?.kind === 'human'
    && isDisplayText(receipt.reviewer.id);
}

function isKnownGameBuild(value) {
  return isDisplayText(value) && !/^(?:UNVERIFIED|UNKNOWN|UNAVAILABLE|N\/A)$/iu.test(value.trim());
}

function isGameVersion(value) {
  return typeof value === 'string' && /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(value);
}

function safePublicHttps(value) {
  if (!isDisplayText(value) || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    if ([...url.searchParams.keys()].some(key => /(?:token|secret|password|signature|auth|api[-_]?key)/iu.test(key))) return null;
    return url.href;
  } catch {
    return null;
  }
}

const ANNOUNCEMENT_ID = /^[a-z0-9][a-z0-9:._-]{1,127}$/u;
const ANNOUNCEMENT_SHA256 = /^[a-f0-9]{64}$/u;
const ANNOUNCEMENT_ASSET_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);

function announcementKeys(value, keys, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  const allowed = new Set(keys);
  if (keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.has(key))) {
    throw new Error(`${label} contains an invalid shape`);
  }
}

function announcementText(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20_000
      || /<!--|-->|<!doctype\b|<\s*\/?\s*[a-z][^>]*>/iu.test(value)) {
    throw new Error(`${label} must be safe plain text`);
  }
  return value;
}

function announcementRunText(value, label) {
  if (typeof value !== 'string' || value.length > 20_000
      || /<!--|-->|<!doctype\b|<\s*\/?\s*[a-z][^>]*>/iu.test(value)) {
    throw new Error(`${label} must be safe announcement text`);
  }
  return value;
}

function safeAnnouncementHref(value) {
  if (!isDisplayText(value) || value.length > 2048 || /[\u0000-\u001f\u007f\\]/u.test(value)) return null;
  if (value.startsWith('/') && !value.startsWith('//')) {
    try {
      const url = new URL(value, 'https://darktide.invalid');
      if (url.origin !== 'https://darktide.invalid' || url.hash) return null;
      if (url.pathname === '/terms/' && !url.search) return value;
      if (url.pathname !== '/announcements/' || [...url.searchParams.keys()].some(key => key !== 'id')
          || url.searchParams.getAll('id').length !== 1
          || !ANNOUNCEMENT_ID.test(url.searchParams.get('id') ?? '')) return null;
      return value;
    } catch { return null; }
  }
  return safePublicHttps(value);
}

function announcementBlockId(value, seen, label) {
  if (typeof value !== 'string' || !ANNOUNCEMENT_ID.test(value) || seen.has(value)) {
    throw new Error(`${label} is invalid or duplicated`);
  }
  seen.add(value);
  return value;
}

function validateAnnouncementInline(runs, label, depth = 0) {
  if (!Array.isArray(runs) || runs.length === 0 || depth > 16) throw new Error(`${label} inline runs are invalid`);
  return runs.map((run, index) => {
    const runLabel = `${label} inline run ${index}`;
    if (!isObject(run) || typeof run.kind !== 'string') throw new Error(`${runLabel} is invalid`);
    if (['text', 'strong', 'emphasis', 'code'].includes(run.kind) && Object.hasOwn(run, 'text')) {
      announcementKeys(run, ['kind', 'text'], runLabel);
      return { kind: run.kind, text: announcementRunText(run.text, `${runLabel} text`) };
    }
    if (['strong', 'emphasis'].includes(run.kind) && Array.isArray(run.children)) {
      announcementKeys(run, ['kind', 'children'], runLabel);
      return { kind: run.kind, children: validateAnnouncementInline(run.children, runLabel, depth + 1) };
    }
    if (run.kind === 'link' && Object.hasOwn(run, 'href')) {
      const href = safeAnnouncementHref(run.href);
      if (!href) throw new Error(`${runLabel} has an unsafe URL`);
      if (Object.hasOwn(run, 'text')) {
        announcementKeys(run, ['kind', 'href', 'text'], runLabel);
        return { kind: 'link', href, text: announcementText(run.text, `${runLabel} text`) };
      }
      announcementKeys(run, ['kind', 'href', 'children'], runLabel);
      return { kind: 'link', href, children: validateAnnouncementInline(run.children, runLabel, depth + 1) };
    }
    if (run.kind === 'break') {
      announcementKeys(run, ['kind'], runLabel);
      return { kind: 'break' };
    }
    throw new Error(`${runLabel} has an unsupported kind`);
  });
}

function flattenAnnouncementInline(runs) {
  return runs.map(run => run.kind === 'break' ? '\n'
    : run.children ? flattenAnnouncementInline(run.children) : run.text ?? '').join('');
}

function validateAnnouncementBlocks(blocks, assets, seenIds, depth = 0) {
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > 500 || depth > 8) {
    throw new Error('announcement blocks exceed the supported structure');
  }
  return blocks.map((block, index) => {
    const label = `announcement block ${index}`;
    if (!isObject(block) || typeof block.kind !== 'string') throw new Error(`${label} is invalid`);
    const blockId = announcementBlockId(block.blockId, seenIds, `${label} id`);
    if (block.kind === 'heading' || block.kind === 'paragraph') {
      const allowed = block.kind === 'heading' ? ['blockId', 'kind', 'text', 'level', 'inline'] : ['blockId', 'kind', 'text', 'inline'];
      announcementKeys(block, allowed.filter(key => key === 'blockId' || key === 'kind' || key === 'text' || Object.hasOwn(block, key)), label);
      const text = announcementText(block.text, `${label} text`);
      const inline = block.inline ? validateAnnouncementInline(block.inline, label) : undefined;
      if (inline && flattenAnnouncementInline(inline) !== text) throw new Error(`${label} inline runs differ from their plain-text value`);
      if (block.kind === 'heading' && block.level !== undefined && (!Number.isInteger(block.level) || block.level < 1 || block.level > 6)) {
        throw new Error(`${label} heading level is invalid`);
      }
      return { blockId, kind: block.kind, text, ...(block.kind === 'heading' && block.level !== undefined ? { level: block.level } : {}), ...(inline ? { inline } : {}) };
    }
    if (block.kind === 'quote') {
      announcementKeys(block, ['blockId', 'kind', 'blocks'], label);
      return { blockId, kind: 'quote', blocks: validateAnnouncementBlocks(block.blocks, assets, seenIds, depth + 1) };
    }
    if (block.kind === 'link') {
      announcementKeys(block, ['blockId', 'kind', 'text', 'href'], label);
      const href = safePublicHttps(block.href);
      if (!href) throw new Error(`${label} has an unsafe URL`);
      return { blockId, kind: 'link', text: announcementText(block.text, `${label} text`), href };
    }
    if (block.kind === 'list') {
      announcementKeys(block, ['blockId', 'kind', 'ordered', 'items'], label);
      if (typeof block.ordered !== 'boolean' || !Array.isArray(block.items) || block.items.length === 0 || block.items.length > 500) {
        throw new Error(`${label} list is invalid`);
      }
      return {
        blockId, kind: 'list', ordered: block.ordered,
        items: block.items.map((item, itemIndex) => {
          const itemLabel = `${label} item ${itemIndex}`;
          announcementKeys(item, ['blockId', 'text', ...(Object.hasOwn(item, 'inline') ? ['inline'] : []), ...(Object.hasOwn(item, 'children') ? ['children'] : [])], itemLabel);
          const text = announcementText(item.text, `${itemLabel} text`);
          const inline = item.inline ? validateAnnouncementInline(item.inline, itemLabel) : undefined;
          if (inline && flattenAnnouncementInline(inline) !== text) throw new Error(`${itemLabel} inline runs differ from their plain-text value`);
          const children = item.children?.length ? validateAnnouncementBlocks(item.children, assets, seenIds, depth + 1) : undefined;
          return { blockId: announcementBlockId(item.blockId, seenIds, `${itemLabel} id`), text, ...(inline ? { inline } : {}), ...(children ? { children } : {}) };
        }),
      };
    }
    if (block.kind === 'table') {
      announcementKeys(block, ['blockId', 'kind', 'rows'], label);
      if (!Array.isArray(block.rows) || block.rows.length === 0 || block.rows.length > 200) throw new Error(`${label} table is invalid`);
      return {
        blockId, kind: 'table',
        rows: block.rows.map((row, rowIndex) => {
          const rowLabel = `${label} row ${rowIndex}`;
          announcementKeys(row, ['cells', ...(Object.hasOwn(row, 'header') ? ['header'] : [])], rowLabel);
          if (row.header !== undefined && typeof row.header !== 'boolean') throw new Error(`${rowLabel} header marker is invalid`);
          if (!Array.isArray(row.cells) || row.cells.length === 0 || row.cells.length > 40) throw new Error(`${rowLabel} cells are invalid`);
          return { ...(row.header !== undefined ? { header: row.header === true } : {}), cells: row.cells.map((cell, cellIndex) => {
            const cellLabel = `${rowLabel} cell ${cellIndex}`;
            announcementKeys(cell, ['blockId', 'text', ...(Object.hasOwn(cell, 'inline') ? ['inline'] : [])], cellLabel);
            const text = announcementText(cell.text, `${cellLabel} text`);
            const inline = cell.inline ? validateAnnouncementInline(cell.inline, cellLabel) : undefined;
            if (inline && flattenAnnouncementInline(inline) !== text) throw new Error(`${cellLabel} inline runs differ from their plain-text value`);
            return { blockId: announcementBlockId(cell.blockId, seenIds, `${cellLabel} id`), text, ...(inline ? { inline } : {}) };
          }) };
        }),
      };
    }
    if (block.kind === 'image') {
      announcementKeys(block, ['blockId', 'kind', 'assetRef', 'alt'], label);
      announcementKeys(block.assetRef, ['assetId'], `${label} asset reference`);
      if (typeof block.assetRef.assetId !== 'string' || !assets.has(block.assetRef.assetId)) {
        throw new Error(`${label} references an undeclared asset`);
      }
      return { blockId, kind: 'image', assetId: block.assetRef.assetId, alt: announcementText(block.alt, `${label} alt`) };
    }
    if (block.kind === 'spoiler') {
      announcementKeys(block, ['blockId', 'kind', 'label', 'blocks'], label);
      return {
        blockId, kind: 'spoiler', label: announcementText(block.label, `${label} label`),
        blocks: validateAnnouncementBlocks(block.blocks, assets, seenIds, depth + 1),
      };
    }
    throw new Error(`${label} has an unsupported kind`);
  });
}

function validateAnnouncement(row, gameReleaseId) {
  announcementKeys(row, ['announcementId', 'scope', 'publishedOn', 'revision', 'source', 'blocks', 'assets', ...(Object.hasOwn(row ?? {}, 'title') ? ['title'] : []), ...(row?.scope === 'gameplay' ? ['gameReleaseId'] : [])], 'announcement');
  if (typeof row.announcementId !== 'string' || !ANNOUNCEMENT_ID.test(row.announcementId)) throw new Error('announcement id is invalid');
  if (!['site', 'gameplay', 'official-document'].includes(row.scope)) throw new Error('announcement scope is invalid');
  if (row.scope === 'gameplay' && row.gameReleaseId !== gameReleaseId) throw new Error('announcement targets a different game release');
  if (row.scope !== 'gameplay' && Object.hasOwn(row, 'gameReleaseId')) throw new Error('non-gameplay announcement contains a game release pin');
  if (row.scope === 'site' && row.source?.kind !== 'site-owner') throw new Error('site announcement source owner is invalid');
  if (row.scope !== 'site' && row.source?.kind !== 'official-game-source') throw new Error('official game announcement source owner is invalid');
  if (row.scope === 'official-document' && !safePublicHttps(row.source?.locator)) throw new Error('official game announcement source locator is invalid');
  if (row.scope === 'official-document' && !isDisplayText(row.title)) throw new Error('official-document title is invalid');
  const date = row.publishedOn;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(date)
      || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('announcement date is invalid');
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('announcement revision is invalid');
  announcementKeys(row.source, ['kind', 'locator', 'sha256'], 'announcement source');
  if ((row.scope === 'site' && row.source.kind !== 'site-owner')
      || (row.scope === 'gameplay' && row.source.kind !== 'official-game-source')
      || !ANNOUNCEMENT_SHA256.test(row.source.sha256)) throw new Error('announcement source identity is invalid');
  const sourceLocator = announcementText(row.source.locator, 'announcement source locator');
  if (!Array.isArray(row.assets) || row.assets.length > 100) throw new Error('announcement assets are invalid');
  const assets = new Map();
  for (const asset of row.assets) {
    announcementKeys(asset, ['assetId', 'mediaType', 'alt', 'sourceUri', 'sha256', 'sizeBytes'], 'announcement asset');
    if (typeof asset.assetId !== 'string' || !ANNOUNCEMENT_ID.test(asset.assetId) || assets.has(asset.assetId)
        || !ANNOUNCEMENT_ASSET_TYPES.has(asset.mediaType) || !ANNOUNCEMENT_SHA256.test(asset.sha256)
        || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 1) throw new Error('announcement asset identity is invalid');
    const sourceUri = safePublicHttps(asset.sourceUri);
    if (!sourceUri) throw new Error('announcement asset URL is unsafe');
    assets.set(asset.assetId, {
      assetId: asset.assetId, mediaType: asset.mediaType,
      alt: announcementText(asset.alt, 'announcement asset alt'), sourceUri,
      sha256: asset.sha256, sizeBytes: asset.sizeBytes,
    });
  }
  const blocks = validateAnnouncementBlocks(row.blocks, assets, new Set());
  return {
    announcementId: row.announcementId,
    scope: row.scope,
    ...(row.title !== undefined ? { title: announcementText(row.title, 'announcement title') } : {}),
    ...(row.scope === 'gameplay' ? { gameReleaseId: row.gameReleaseId } : {}),
    publishedOn: date,
    revision: row.revision,
    source: { kind: row.source.kind, locator: sourceLocator, sha256: row.source.sha256 },
    blocks,
    assets: [...assets.values()],
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function verificationLabel(method) {
  return ({
    'code-observed': '程式觀察',
    'code-derived': '程式推導',
    'game-tested': '遊戲實測',
    'official-document': '官方文件',
    'official-patch-note': '官方更新說明',
    'official-text-comparison': '官方字串比對',
  })[method] ?? '驗證方式未確認';
}

function addTerms(target, refs, recordByKey, localizations, gameReleaseId) {
  if (!Array.isArray(refs)) return;
  for (const ref of refs) {
    const key = refKey(ref, 'term');
    if (!key || ref.gameReleaseId !== gameReleaseId) continue;
    const record = recordByKey.get(key);
    const contextKey = record?.payload?.contextKey;
    if (!record || !isDisplayText(contextKey)) continue;
    const localized = localizations.filter((row) => row?.locale === 'zh-TW'
      && row?.contextKey === contextKey
      && sameRef(row.termRef, ref, 'term')
      && isDisplayText(row.label)
      && isDisplayText(row.definition));
    if (localized.length !== 1) continue;
    const dedupeKey = `${key}\u0000${contextKey}`;
    if (target.has(dedupeKey)) continue;
    target.set(dedupeKey, {
      termRef: { gameReleaseId, kind: 'term', recordId: record.recordId },
      contextKey,
      label: localized[0].label,
      definition: localized[0].definition,
    });
  }
}

function orderedSections(sections, { resolveParts, terms, recordByKey, localizations, termRules, gameReleaseId } = {}) {
  if (!Array.isArray(sections)) return { ok: false, sections: [] };
  const byId = new Map();
  for (const section of sections) {
    if (!isObject(section) || typeof section.sectionId !== 'string' || !Array.isArray(section.items)) return { ok: false, sections: [] };
    if (!SECTION_ORDER.some(([sectionId]) => sectionId === section.sectionId) || byId.has(section.sectionId)) return { ok: false, sections: [] };
    byId.set(section.sectionId, section);
  }

  const result = [];
  for (const [sectionId, heading] of SECTION_ORDER) {
    const section = byId.get(sectionId);
    if (!section || section.items.length === 0) continue;
    const items = [];
    for (const item of section.items) {
      if (!isObject(item)) return { ok: false, sections: [] };
      const viewItem = {};
      if (typeof item.itemId === 'string') viewItem.itemId = item.itemId;
      if (typeof item.text === 'string') viewItem.text = item.text;
      if (Array.isArray(item.parts)) {
        const resolved = resolveParts ? resolveParts(item.parts) : item.parts.map((part) => ({ ...part }));
        if (!resolved) return { ok: false, sections: [] };
        viewItem.parts = resolved;
      }
      if (Array.isArray(item.claimRefs)) viewItem.claimRefs = item.claimRefs.map((ref) => ({ ...ref }));
      if (Array.isArray(item.termRefs)) {
        viewItem.termRefs = item.termRefs.map((ref) => ({ ...ref }));
        addTerms(terms, item.termRefs, recordByKey, localizations, gameReleaseId);
      }
      if (Array.isArray(item.termRuleRefs)) {
        viewItem.termRuleRefs = item.termRuleRefs.slice();
        for (const ruleId of item.termRuleRefs) {
          const rule = termRules.get(ruleId);
          if (rule) terms.set(`rule\u0000${ruleId}`, { ruleId, text: rule.targetText });
        }
      }
      items.push(viewItem);
    }
    result.push({ sectionId, heading, items });
  }
  return { ok: true, sections: result };
}

function findOfficial(officialSources, officialSourceId, entityRef, gameReleaseId, bindingContext) {
  if (!isDisplayText(officialSourceId)) return null;
  const matches = officialSources.filter((row) => row?.officialSourceId === officialSourceId
    && row?.sourceLocale === 'zh-TW'
    && sameRef(row.entityRef, entityRef)
    && row.entityRef?.gameReleaseId === gameReleaseId
    && isDisplayText(row.sourceText)
    && isDisplayText(row.resolvedText)
    && (!bindingContext || (row.bindingContext?.tier === bindingContext.tier
      && sameRef(row.bindingContext?.variantRef, bindingContext.variantRef, 'blessing-variant'))));
  return matches.length === 1 ? matches[0] : null;
}

function officialView(source) {
  return {
    sourceText: source.sourceText,
    resolvedText: source.resolvedText,
    sourceLocale: source.sourceLocale,
  };
}

function officialInputIdentity(source) {
  return {
    origin: source.origin,
    resource: source.resource,
    key: source.key,
    ...(isDisplayText(source.sourceHash) ? { sourceHash: source.sourceHash } : {}),
    occurrence: source.occurrence,
    sourceTextSha256: source.sourceTextSha256,
    resolvedTextSha256: source.resolvedTextSha256,
  };
}

function officialInputParameters(source) {
  if (!Array.isArray(source?.params)) return null;
  const result = [];
  for (const parameter of source.params) {
    if (!isObject(parameter) || !isDisplayText(parameter.parameterId) || !isDisplayText(parameter.sourceKey)
        || typeof parameter.value !== 'string') return null;
    result.push({ parameterId: parameter.parameterId, sourceKey: parameter.sourceKey, value: parameter.value });
  }
  return result;
}

function displayParts(parts, bindingRows, valueByBindingKey) {
  const result = [];
  for (const part of parts) {
    if (!isObject(part)) return null;
    if (part.kind === 'literal') {
      if (!isDisplayText(part.text) && part.text !== '') return null;
      result.push({ kind: 'text', text: part.text });
      continue;
    }
    const bindingKey = refKey(part.bindingRef, 'claim');
    const binding = bindingRows.find((row) => refKey(row.bindingRef, 'claim') === bindingKey);
    if (!bindingKey || !binding || !valueByBindingKey.has(bindingKey)) return null;
    result.push({
      kind: part.kind,
      name: binding.name ?? binding.parameterId,
      format: binding.format,
      value: valueByBindingKey.get(bindingKey),
    });
  }
  return result;
}

function resolveRecords(refs, expectedKind, gameReleaseId, recordByKey) {
  if (!Array.isArray(refs)) return null;
  const records = [];
  for (const ref of refs) {
    const key = refKey(ref, expectedKind);
    const record = key && ref.gameReleaseId === gameReleaseId ? recordByKey.get(key) : null;
    if (!record || record.kind !== expectedKind || record.gameReleaseId !== gameReleaseId) return null;
    records.push(record);
  }
  return records;
}

/**
 * Build a read-only consumer view over validated W08 shared-domain objects.
 * The caller supplies one already-validated game release; no source metadata is fetched or executed.
 */
export function createSharedViewModel({ domains, gameReleaseId, fixtureOnly = false } = {}) {
  if (!Array.isArray(domains) || typeof gameReleaseId !== 'string' || !gameReleaseId) {
    throw new TypeError('domains and gameReleaseId are required');
  }
  if (typeof fixtureOnly !== 'boolean') throw new TypeError('fixtureOnly must be a boolean');

  const recordByKey = new Map();
  const sourceRecordByKey = new Map();
  const recordConflicts = new Set();
  const sourceRecordConflicts = new Set();
  const presentations = [];
  const officialSourceById = new Map();
  const officialSourceConflicts = new Set();
  const termLocalizations = [];
  const termRules = new Map();
  const gameChangeRows = [];
  const officialTextChangeRows = [];
  const announcementRows = [];
  const sourceGameReleases = new Map();
  const sourceGameReleaseConflicts = new Set();
  const sourceSnapshots = new Map();
  const sourceSnapshotConflicts = new Set();
  const sourceReviewReceipts = [];
  const webReviewTargets = [];
  const webReviewReceipts = [];
  const sourceRefByKey = new Map();
  const sourceRefConflicts = new Set();
  for (const domain of domains) {
    if (!isObject(domain) || domain.gameReleaseId !== gameReleaseId) continue;
    if (Array.isArray(domain.source?.records)) {
      for (const record of domain.source.records) {
        const key = refKey(record);
        if (!key || !isObject(record.payload)) continue;
        addConsistent(sourceRecordByKey, sourceRecordConflicts, key, record);
        if (record.gameReleaseId !== gameReleaseId) continue;
        addConsistent(recordByKey, recordConflicts, key, record);
      }
    }
    if (Array.isArray(domain.web?.presentations)) presentations.push(...domain.web.presentations);
    if (Array.isArray(domain.web?.officialInputs?.sources)) {
      for (const source of domain.web.officialInputs.sources) {
        if (typeof source?.officialSourceId === 'string') {
          addConsistent(officialSourceById, officialSourceConflicts, source.officialSourceId, source);
        }
      }
    }
    if (Array.isArray(domain.web?.termLocalizations)) termLocalizations.push(...domain.web.termLocalizations);
    if (Array.isArray(domain.web?.gameChanges)) gameChangeRows.push(...domain.web.gameChanges);
    if (Array.isArray(domain.web?.officialTextChanges)) officialTextChangeRows.push(...domain.web.officialTextChanges);
    if (Array.isArray(domain.web?.announcements)) announcementRows.push(...domain.web.announcements);
    if (Array.isArray(domain.web?.reviewTargets)) webReviewTargets.push(...domain.web.reviewTargets);
    if (Array.isArray(domain.web?.reviewReceipts)) webReviewReceipts.push(...domain.web.reviewReceipts);
    if (Array.isArray(domain.source?.reviewReceipts)) sourceReviewReceipts.push(...domain.source.reviewReceipts);
    for (const sourceRef of domain.source?.sourceRefs ?? []) {
      if (isDisplayText(sourceRef?.sourceId) && isDisplayText(sourceRef?.gameReleaseId)) {
        addConsistent(sourceRefByKey, sourceRefConflicts,
          `${sourceRef.gameReleaseId}\u0000${sourceRef.sourceId}`, sourceRef);
      }
    }
    for (const release of domain.source?.gameReleases ?? []) {
      if (typeof release?.gameReleaseId === 'string') {
        addConsistent(sourceGameReleases, sourceGameReleaseConflicts, release.gameReleaseId, release);
        if (isObject(release.snapshot) && isDisplayText(release.snapshot.snapshotId)) {
          addConsistent(sourceSnapshots, sourceSnapshotConflicts,
            `${release.gameReleaseId}\u0000${release.snapshot.snapshotId}`, release.snapshot);
        }
      }
    }
    for (const row of domain.source?.sourceSnapshots ?? []) {
      if (isObject(row) && isDisplayText(row.gameReleaseId) && isObject(row.snapshot)
          && isDisplayText(row.snapshot.snapshotId)) {
        addConsistent(sourceSnapshots, sourceSnapshotConflicts,
          `${row.gameReleaseId}\u0000${row.snapshot.snapshotId}`, row.snapshot);
      }
    }
    const rules = domain.web?.termRules?.rules;
    if (Array.isArray(rules)) {
      for (const rule of rules) {
        if (isDisplayText(rule?.ruleId) && isDisplayText(rule?.targetText)) termRules.set(rule.ruleId, rule);
      }
    }
  }
  const officialSources = [...officialSourceById.entries()]
    .filter(([id]) => !officialSourceConflicts.has(id))
    .map(([, source]) => source);

  const getRecord = (ref, expectedKind) => {
    const key = refKey(ref, expectedKind);
    const record = key && ref.gameReleaseId === gameReleaseId ? recordByKey.get(key) : null;
    return record && record.kind === (ref.kind ?? expectedKind) ? record : null;
  };

  const getSourceRecord = (ref, expectedKind) => {
    const key = refKey(ref, expectedKind);
    const record = key ? sourceRecordByKey.get(key) : null;
    return record && record.kind === (ref.kind ?? expectedKind) ? record : null;
  };

  const getPresentation = (ref) => {
    const rows = presentations.filter((row) => row?.locale === 'zh-TW' && sameRef(row.entityRef, ref)
      && row.entityRef?.gameReleaseId === gameReleaseId);
    return rows.length === 1 ? rows[0] : null;
  };

  const hasApprovedSourceRecord = (record) => {
    if (!record || record.reviewState !== 'approved' || !Array.isArray(record.reviewTargets)
        || record.reviewTargets.length === 0) return false;
    return record.reviewTargets.every(target => {
      const matches = sourceReviewReceipts.filter(receipt => receipt?.decision === 'approved'
        && receipt.target?.gameReleaseId === record.gameReleaseId
        && receipt.target?.recordId === record.recordId
        && receipt.target?.fieldPath === target.fieldPath
        && receipt.target?.dimension === target.dimension
        && isSha256(receipt.targetDigest) && isSha256(receipt.dependenciesDigest)
        && isHumanReceipt(receipt));
      return matches.length > 0;
    });
  };

  const hasApprovedWebOwner = (ownerKind, ownerId, fieldPath = null) => {
    const rows = webReviewTargets.filter(row => row?.target?.ownerKind === ownerKind
      && row.target.ownerId === ownerId
      && (fieldPath === null || row.target.fieldPath === fieldPath));
    if (rows.length === 0) return false;
    return rows.every(row => row.state === 'approved' && isSha256(row.targetDigest)
      && isSha256(row.dependenciesDigest)
      && webReviewReceipts.some(receiptRow => receiptRow?.mode === row.mode
        && receiptRow.receipt?.targetId === row.target.targetId
        && receiptRow.receipt.decision === 'approved'
        && receiptRow.receipt.targetDigest === row.targetDigest
        && receiptRow.receipt.dependenciesDigest === row.dependenciesDigest
        && isHumanReceipt(receiptRow.receipt)));
  };

  const announcementIds = new Set();
  const announcements = announcementRows.map(row => {
    const item = validateAnnouncement(row, gameReleaseId);
    if (announcementIds.has(item.announcementId)) throw new Error('announcement identity is duplicated');
    announcementIds.add(item.announcementId);
    if (!fixtureOnly && !hasApprovedWebOwner('announcement', item.announcementId, '/blocks')) {
      throw new Error(`formal announcement is not approved: ${item.announcementId}`);
    }
    return deepFreeze(item);
  }).sort((left, right) => right.publishedOn.localeCompare(left.publishedOn)
    || right.revision - left.revision || left.announcementId.localeCompare(right.announcementId));

  const getAnnouncements = () => ({ status: 'ready', items: announcements.slice() });
  const getAnnouncement = announcementId => announcements.find(item => item.announcementId === announcementId) ?? null;

  const getEntityPresentation = (ref) => {
    const matches = presentations.filter(row => row?.locale === 'zh-TW' && sameRef(row.entityRef, ref)
      && isDisplayText(row.name));
    if (matches.length !== 1 || !hasApprovedWebOwner('presentation', matches[0].authoringId, '/name')) return null;
    return matches[0];
  };

  const findSourceRecord = (ref) => {
    if (!isObject(ref) || !isDisplayText(ref.gameReleaseId) || !isDisplayText(ref.recordId)) return null;
    const conflictedIdentity = [...sourceRecordConflicts].some(key => {
      const [gameReleaseId, kind, recordId] = key.split('\u0000');
      return gameReleaseId === ref.gameReleaseId && recordId === ref.recordId
        && (ref.kind === undefined || ref.kind === kind);
    });
    if (conflictedIdentity) return null;
    const matches = [...sourceRecordByKey.values()].filter(record => record.gameReleaseId === ref.gameReleaseId
      && record.recordId === ref.recordId && (ref.kind === undefined || record.kind === ref.kind));
    return matches.length === 1 ? matches[0] : null;
  };

  const getLocalizedSubject = (record, visiting = new Set()) => {
    if (!record) return null;
    const key = refKey(record);
    if (!key || visiting.has(key)) return null;
    const nextVisiting = new Set(visiting).add(key);
    if (['skill', 'blessing', 'weapon'].includes(record.kind)) {
      const ref = { gameReleaseId: record.gameReleaseId, kind: record.kind, recordId: record.recordId };
      const presentation = getEntityPresentation(ref);
      return presentation ? { ref, name: presentation.name } : null;
    }
    if (record.kind === 'term') {
      const rows = termLocalizations.filter(row => row?.locale === 'zh-TW'
        && sameRef(row.termRef, record, 'term') && isDisplayText(row.label)
        && hasApprovedWebOwner('term-localization', row.authoringId, '/label'));
      return rows.length === 1
        ? { ref: { gameReleaseId: record.gameReleaseId, kind: 'term', recordId: record.recordId }, name: rows[0].label }
        : null;
    }

    let parents = [];
    if (record.kind === 'claim') {
      const parent = findSourceRecord(record.payload.targetRef);
      if (parent) parents = [parent];
    } else if (record.kind === 'blessing-variant') {
      const parent = findSourceRecord(record.payload.blessingRef);
      if (parent) parents = [parent];
    } else if (record.kind === 'stat-definition') {
      const ref = { gameReleaseId: record.gameReleaseId, kind: record.kind, recordId: record.recordId };
      parents = [...sourceRecordByKey.values()].filter(candidate => candidate.kind === 'weapon'
        && candidate.payload.statRefs?.some(item => sameRef(item, ref, 'stat-definition')));
    } else if (record.kind === 'stat-curve') {
      const definitions = [...sourceRecordByKey.values()].filter(candidate => candidate.kind === 'stat-definition'
        && sameRef(candidate.payload.curveRef, record, 'stat-curve'));
      const definitionRefs = new Set(definitions.map(item => refKey(item)));
      parents = [...sourceRecordByKey.values()].filter(candidate => candidate.kind === 'weapon'
        && candidate.payload.statRefs?.some(item => definitionRefs.has(refKey(item, 'stat-definition'))));
    }
    const uniqueParents = new Map(parents.map(parent => [refKey(parent), parent]).filter(([key]) => key));
    if (uniqueParents.size !== 1) return null;
    return getLocalizedSubject([...uniqueParents.values()][0], nextVisiting);
  };

  const sameCompleteSnapshotPins = (left, right) => isObject(left) && isObject(right)
    && /^[a-f0-9]{40}$/u.test(left.commit ?? '')
    && left.commit === right.commit
    && isSha256(left.manifestSha256) && left.manifestSha256 === right.manifestSha256
    && isSha256(left.contentSha256) && left.contentSha256 === right.contentSha256;

  const matchesComparisonSnapshot = (releaseId, snapshot, targetReleaseId, targetSnapshotId) => {
    if (releaseId !== targetReleaseId || !isDisplayText(snapshot?.snapshotId)) return false;
    if (snapshot.snapshotId === targetSnapshotId) return true;

    const aliasKey = `${releaseId}\u0000${snapshot.snapshotId}`;
    const targetKey = `${targetReleaseId}\u0000${targetSnapshotId}`;
    if (sourceSnapshotConflicts.has(aliasKey) || sourceSnapshotConflicts.has(targetKey)) return false;
    const registeredAlias = sourceSnapshots.get(aliasKey);
    const registeredTarget = sourceSnapshots.get(targetKey);
    return sameCompleteSnapshotPins(snapshot, registeredAlias)
      && sameCompleteSnapshotPins(registeredAlias, registeredTarget);
  };

  const projectEvidence = (refs, comparison) => {
    if (!Array.isArray(refs)) return [];
    const output = [];
    for (const ref of refs) {
      const evidenceRecord = findSourceRecord({ ...ref, kind: ref?.kind ?? 'evidence' });
      if (!evidenceRecord || evidenceRecord.kind !== 'evidence') continue;
      const pointer = evidenceRecord.payload?.sourceRef;
      if (!isDisplayText(pointer?.gameReleaseId) || !isDisplayText(pointer?.sourceId)
          || pointer.gameReleaseId !== evidenceRecord.gameReleaseId) continue;
      const sourceKey = `${pointer.gameReleaseId}\u0000${pointer.sourceId}`;
      if (sourceRefConflicts.has(sourceKey)) continue;
      const source = sourceRefByKey.get(sourceKey);
      if (!source) continue;
      const sourceSnapshot = source.snapshot;
      const snapshotId = sourceSnapshot?.snapshotId;
      const releaseId = source.gameReleaseId;
      const matchesComparison = matchesComparisonSnapshot(
        releaseId, sourceSnapshot, comparison.fromGameReleaseId, comparison.fromSnapshotId,
      ) || matchesComparisonSnapshot(
        releaseId, sourceSnapshot, comparison.toGameReleaseId, comparison.toSnapshotId,
      );
      if (!matchesComparison) continue;
      const publicUrl = safePublicHttps(source.publicUrl);
      output.push({
        kindLabel: ({ 'code-observed': '程式碼證據', 'code-derived': '程式推導證據', 'game-tested': '遊戲測試證據' })[
          evidenceRecord.payload.evidenceKind
        ] ?? '來源證據',
        source: publicUrl ? {
          publicUrl,
          repository: safePublicHttps(source.repository),
          path: typeof source.path === 'string' && /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u.test(source.path)
            ? source.path : null,
          gameReleaseId: releaseId,
          gameBuild: isKnownGameBuild(source.gameBuild) ? source.gameBuild : null,
          snapshot: isDisplayText(snapshotId) ? {
            snapshotId,
            commit: /^[a-f0-9]{40}$/u.test(source.snapshot?.commit ?? '') ? source.snapshot.commit : null,
          } : null,
          commit: /^[a-f0-9]{40}$/u.test(source.commit ?? '') ? source.commit : null,
        } : null,
      });
    }
    return output;
  };

  const getSkill = (skillRef) => {
    const record = getRecord(skillRef, 'skill');
    if (!record) return unavailable('unknown-skill', 'identity');
    const presentation = getPresentation(skillRef);
    if (!presentation || !isDisplayText(presentation.name)) return unavailable('missing-zh-tw-skill', 'missing');
    const nameSource = findOfficial(officialSources, presentation.nameOfficialSourceId, skillRef, gameReleaseId);
    const descriptionSource = findOfficial(officialSources, presentation.official?.officialSourceId, skillRef, gameReleaseId);
    if (!nameSource || !descriptionSource) return unavailable('missing-zh-tw-official-skill-text', 'official');

    const termViews = new Map();
    addTerms(termViews, record.payload.termRefs, recordByKey, termLocalizations, gameReleaseId);
    const sectionsResult = orderedSections(presentation.detailSections, {
      terms: termViews,
      recordByKey,
      localizations: termLocalizations,
      termRules,
      gameReleaseId,
    });
    if (!sectionsResult.ok) return unavailable('invalid-skill-sections', 'missing');
    return {
      status: 'ready',
      name: presentation.name,
      official: officialView(descriptionSource),
      nameOfficial: officialView(nameSource),
      errata: exactErrata(presentation.errata, descriptionSource),
      sections: sectionsResult.sections,
      terms: [...termViews.values()].filter((term) => term.termRef),
      termRules: [...termViews.values()].filter((term) => term.ruleId),
    };
  };

  const getBlessing = ({ blessingRef, variantRef, familyId, markId, tier } = {}) => {
    const parent = getRecord(blessingRef, 'blessing');
    const variant = getRecord(variantRef, 'blessing-variant');
    if (!parent || !variant || !sameRef(variant.payload?.blessingRef, blessingRef, 'blessing')
      || !Array.isArray(parent.payload?.variantRefs)
      || !parent.payload.variantRefs.some((ref) => sameRef(ref, variantRef, 'blessing-variant'))) {
      return unavailable('unknown-blessing-variant', 'identity');
    }
    const presentation = getPresentation(blessingRef);
    if (!presentation || !isDisplayText(presentation.name)) return unavailable('missing-zh-tw-blessing', 'missing');
    const nameSource = findOfficial(officialSources, presentation.nameOfficialSourceId, blessingRef, gameReleaseId);
    if (!nameSource) return unavailable('missing-zh-tw-blessing-name', 'official');
    if (!Number.isInteger(tier) || tier < 1) return unavailable('unknown-tier', 'tier');

    const applicability = Array.isArray(presentation.tierApplicability)
      ? presentation.tierApplicability.find((row) => sameRef(row?.variantRef, variantRef, 'blessing-variant'))
      : null;
    const option = presentation.tierPresentations?.options?.filter((row) => row?.tier === tier) ?? [];
    const variantTiers = variant.payload?.definedTiers;
    if (!applicability || !Array.isArray(applicability.tiers) || !applicability.tiers.includes(tier)
      || !Array.isArray(variantTiers) || !variantTiers.includes(tier) || option.length !== 1) {
      return unavailable('unknown-tier', 'tier');
    }

    const hasFamilyContext = familyId !== undefined;
    const hasMarkContext = markId !== undefined;
    if (hasFamilyContext !== hasMarkContext
      || (hasFamilyContext && (!isDisplayText(familyId) || !isDisplayText(markId)))) {
      return unavailable('incomplete-weapon-context', 'variant');
    }
    const hasWeaponContext = hasFamilyContext && hasMarkContext;
    if (hasWeaponContext) {
      const weapons = [...recordByKey.values()].filter((record) => record?.kind === 'weapon'
        && record.gameReleaseId === gameReleaseId
        && record.payload?.familyId === familyId
        && record.payload?.markId === markId);
      if (weapons.length !== 1) return unavailable('family-mark-unverified', 'variant');
      const weapon = weapons[0];
      const weaponLink = Array.isArray(variant.payload?.weaponRefs)
        && variant.payload.weaponRefs.some((ref) => sameRef(ref, weapon, 'weapon'));
      if (!weaponLink) return unavailable('family-mark-unverified', 'variant');
    }

    const tierOption = option[0];
    const officialRef = Array.isArray(tierOption.officialLocaleRefs)
      ? tierOption.officialLocaleRefs.filter((row) => row?.sourceLocale === 'zh-TW')
      : [];
    if (officialRef.length !== 1) return unavailable('missing-zh-tw-tier-text', 'official');
    const officialSource = findOfficial(
      officialSources,
      officialRef[0].officialSourceId,
      blessingRef,
      gameReleaseId,
      { tier, variantRef },
    );
    if (!officialSource || !Array.isArray(tierOption.params) || !Array.isArray(officialSource.params)) {
      return unavailable('missing-zh-tw-tier-text', 'official');
    }
    const canonicalOfficialSource = presentation.official?.officialSourceId === officialSource.officialSourceId
      ? findOfficial(
        officialSources,
        presentation.official.officialSourceId,
        blessingRef,
        gameReleaseId,
        presentation.official.bindingContext,
      )
      : null;

    const valueByBindingKey = new Map();
    const displayedParams = [];
    for (const binding of tierOption.params) {
      const bindingKey = refKey(binding?.bindingRef, 'claim');
      const sourceKey = binding?.bindingRef?.recordId;
      const parameterId = binding?.parameterId ?? binding?.name;
      if (!bindingKey || !sourceKey || !parameterId) return unavailable('invalid-tier-binding', 'official');
      const parameterRows = officialSource.params.filter((row) => row?.sourceKey === sourceKey
        && row?.parameterId === parameterId && isDisplayText(row.value));
      if (parameterRows.length !== 1) return unavailable('missing-tier-parameter', 'official');
      valueByBindingKey.set(bindingKey, parameterRows[0].value);
      displayedParams.push({
        parameterId,
        name: binding.name ?? parameterId,
        format: binding.format,
        value: parameterRows[0].value,
      });
    }

    const termViews = new Map();
    const sectionsResult = orderedSections(tierOption.detailSections, {
      resolveParts: (parts) => displayParts(parts, tierOption.params, valueByBindingKey),
      terms: termViews,
      recordByKey,
      localizations: termLocalizations,
      termRules,
      gameReleaseId,
    });
    if (!sectionsResult.ok) return unavailable('invalid-blessing-sections', 'missing');
    const tierValueRows = Array.isArray(variant.payload.tierValues)
      ? variant.payload.tierValues.filter((row) => row?.tier === tier)
      : [];
    if (tierValueRows.length !== 1) return unavailable('missing-tier-source-value', 'missing');

    return {
      status: 'ready',
      name: presentation.name,
      nameOfficial: officialView(nameSource),
      ...(hasWeaponContext ? { familyId, markId } : {}),
      tier,
      variantRef: { ...variantRef },
      applicability: hasWeaponContext
        ? { status: 'verified', familyId, markId }
        : { status: 'unknown', verification: 'unverified', reason: 'weapon-context-not-selected' },
      definedTiers: variantTiers.slice(),
      obtainableTiers: variant.payload.obtainableTiers ?? { status: 'unknown' },
      official: { ...officialView(officialSource), params: displayedParams },
      sourceTierValue: tierValueRows[0].value,
      sections: sectionsResult.sections,
      errata: canonicalOfficialSource ? exactErrata(presentation.errata, canonicalOfficialSource) : [],
      terms: [...termViews.values()].filter((term) => term.termRef),
      termRules: [...termViews.values()].filter((term) => term.ruleId),
    };
  };

  const getWeapon = ({ familyId, markId } = {}) => {
    const weaponMatches = [...recordByKey.values()].filter((record) => record?.kind === 'weapon'
      && record.gameReleaseId === gameReleaseId
      && record.payload?.familyId === familyId
      && record.payload?.markId === markId);
    if (weaponMatches.length !== 1) return unavailable('unknown-weapon-mark', 'weapon');
    const weapon = weaponMatches[0];
    const weaponRef = { gameReleaseId, kind: 'weapon', recordId: weapon.recordId };
    const presentation = getPresentation(weaponRef);
    if (!presentation || !isDisplayText(presentation.name) || !isObject(presentation.weaponView)
      || !isDisplayText(presentation.weaponView.markLabel)
      || !sameRef(presentation.weaponView.sourceWeaponRef, weaponRef)) {
      return unavailable('missing-zh-tw-weapon-presentation', 'weapon');
    }
    const nameSource = findOfficial(officialSources, presentation.nameOfficialSourceId, weaponRef, gameReleaseId);
    const canonicalOfficialSource = findOfficial(officialSources, presentation.official?.officialSourceId, weaponRef, gameReleaseId);
    if (!nameSource || !canonicalOfficialSource) return unavailable('missing-zh-tw-weapon-name', 'official');
    const view = presentation.weaponView;
    if (!Array.isArray(view.statSections) || !Array.isArray(view.attackProfileRefs)) return unavailable('invalid-weapon-presentation', 'weapon');
    const statSections = [];
    for (const section of view.statSections) {
      const claims = resolveRecords(section.claimRefs ?? [], 'claim', gameReleaseId, recordByKey);
      const curves = resolveRecords(section.curveRefs ?? [], 'stat-curve', gameReleaseId, recordByKey);
      const definitions = resolveRecords(section.statDefinitionRefs ?? [], 'stat-definition', gameReleaseId, recordByKey);
      if (!isDisplayText(section.label) || !claims || !curves || !definitions) return unavailable('incomplete-weapon-stat-bundle', 'weapon');
      statSections.push({
        label: section.label,
        sourceStat: section.sourceStat,
        claims,
        curves,
        statDefinitions: definitions,
      });
    }
    const attackProfiles = resolveRecords(view.attackProfileRefs, 'attack-profile', gameReleaseId, recordByKey);
    if (!attackProfiles) return unavailable('incomplete-weapon-attack-bundle', 'weapon');
    if (!Array.isArray(weapon.payload.statRefs) || weapon.payload.statRefs.length === 0) {
      return unavailable('incomplete-weapon-stat-definition-bundle', 'weapon');
    }
    const weaponStatDefinitions = resolveRecords(weapon.payload.statRefs, 'stat-definition', gameReleaseId, recordByKey);
    if (!weaponStatDefinitions) return unavailable('incomplete-weapon-stat-definition-bundle', 'weapon');
    const sourceStatDefinitions = [];
    for (const definition of weaponStatDefinitions) {
      const curveRef = definition.payload?.curveRef;
      if (!curveRef) return unavailable('incomplete-weapon-stat-curve-bundle', 'weapon');
      const curves = resolveRecords([{ ...curveRef, kind: 'stat-curve' }], 'stat-curve', gameReleaseId, recordByKey);
      if (!curves) return unavailable('incomplete-weapon-stat-curve-bundle', 'weapon');
      sourceStatDefinitions.push({ definition, curve: curves[0] ?? null });
    }
    const termViews = new Map();
    addTerms(termViews, weapon.payload.termRefs, recordByKey, termLocalizations, gameReleaseId);
    const sectionResult = orderedSections(presentation.detailSections ?? [], {
      terms: termViews, recordByKey, localizations: termLocalizations, termRules, gameReleaseId,
    });
    if (!sectionResult.ok) return unavailable('invalid-weapon-sections', 'weapon');
    return {
      status: 'ready',
      name: presentation.name,
      official: officialView(canonicalOfficialSource),
      errata: canonicalOfficialSource ? exactErrata(presentation.errata, canonicalOfficialSource) : [],
      familyId,
      markId,
      markLabel: view.markLabel,
      attackHeading: view.attackHeading,
      comparisonHeading: view.comparisonHeading,
      note: view.note,
      sections: sectionResult.sections,
      terms: [...termViews.values()].filter((term) => term.termRef),
      termRules: [...termViews.values()].filter((term) => term.ruleId),
      statSections,
      attackProfiles,
      source: {
        dataCoverage: weapon.dataCoverage,
        displayedAttacks: weapon.payload.displayedAttacks,
        actionContinuations: weapon.payload.actionContinuations,
        statBindings: weapon.payload.statBindings,
        statTables: weapon.payload.statTables,
        statDefinitions: sourceStatDefinitions,
        statTableSemantics: weapon.payload.statTableSemantics,
        sourceRows: weapon.payload.sourceRows,
      },
    };
  };

  const getWeaponFamily = (familyId) => {
    const weaponRecords = [...recordByKey.values()].filter((record) => record?.kind === 'weapon'
      && record.gameReleaseId === gameReleaseId && record.payload?.familyId === familyId);
    const markIds = [...new Set(weaponRecords.map((record) => record.payload.markId).filter(isDisplayText))];
    if (markIds.length === 0) return unavailable('unknown-weapon-family', 'weapon');
    const marks = [];
    for (const markId of markIds) {
      const weapon = getWeapon({ familyId, markId });
      if (weapon.status !== 'ready') return weapon;
      marks.push(weapon);
    }
    return { status: 'ready', familyId, marks };
  };

  const entityName = (ref) => getEntityPresentation(ref)?.name ?? null;

  const projectBlessingVariant = (record) => {
    if (record?.kind !== 'blessing-variant' || !hasApprovedSourceRecord(record)) return null;
    const payload = record.payload;
    const definedTiers = payload.definedTiers;
    if (!Array.isArray(definedTiers) || definedTiers.length === 0
        || definedTiers.some(tier => !Number.isSafeInteger(tier) || tier < 1)
        || new Set(definedTiers).size !== definedTiers.length) return null;

    const obtainable = payload.obtainableTiers;
    const obtainableTiers = obtainable?.status === 'known' && Array.isArray(obtainable.tiers)
      && new Set(obtainable.tiers).size === obtainable.tiers.length
      && obtainable.tiers.every(tier => definedTiers.includes(tier))
      ? { status: 'known', tiers: obtainable.tiers.slice() }
      : { status: 'unknown' };

    const weaponRefs = payload.weaponRefs;
    let weaponApplicability = { status: 'unknown', weapons: [] };
    if (Array.isArray(weaponRefs) && weaponRefs.length > 0) {
      const weapons = [];
      for (const ref of weaponRefs) {
        const weapon = findSourceRecord(ref);
        const subject = weapon?.kind === 'weapon' ? getLocalizedSubject(weapon) : null;
        if (!weapon || !subject) {
          weapons.length = 0;
          break;
        }
        weapons.push({
          weaponRef: { ...subject.ref },
          name: subject.name,
        });
      }
      if (weapons.length === weaponRefs.length) weaponApplicability = { status: 'identified', weapons };
    }
    return {
      variantRef: { gameReleaseId: record.gameReleaseId, kind: 'blessing-variant', recordId: record.recordId },
      definedTiers: definedTiers.slice(),
      obtainableTiers,
      weaponApplicability,
    };
  };

  const getGameChanges = ({ gameVersion, entityKind } = {}) => {
    const items = [];
    for (const row of gameChangeRows) {
      if (row?.owner !== 'source' || row.changeKind !== 'source-technical'
          || typeof row.changeId !== 'string' || !isObject(row.summary)
          || row.summary.locale !== 'zh-TW' || !isDisplayText(row.summary.text)) continue;
      const sourceRecord = getSourceRecord(row.sourceRef, 'game-change');
      if (!sourceRecord || sourceRecord.recordId !== row.changeId
          || !hasApprovedSourceRecord(sourceRecord)
          || !hasApprovedWebOwner('game-change', row.changeId)) continue;
      const payload = sourceRecord.payload;
      const comparison = payload.comparison;
      const entityRef = payload.entityRef;
      if (!isObject(entityRef) || !isDisplayText(entityRef.gameReleaseId) || !isDisplayText(entityRef.recordId)
          || !isDisplayText(payload.operation) || !isObject(comparison)
          || !isDisplayText(comparison.fromGameReleaseId) || !isDisplayText(comparison.toGameReleaseId)
          || !isGameVersion(comparison.fromGameVersion) || !isGameVersion(comparison.toGameVersion)
          || !isKnownGameBuild(comparison.fromGameBuild) || !isKnownGameBuild(comparison.toGameBuild)
          || !isDisplayText(comparison.fromSnapshotId) || !isDisplayText(comparison.toSnapshotId)
          || sourceRecord.gameReleaseId !== comparison.toGameReleaseId
          || entityRef.gameReleaseId !== comparison.toGameReleaseId) continue;
      const fromRelease = sourceGameReleases.get(comparison.fromGameReleaseId);
      const toRelease = sourceGameReleases.get(comparison.toGameReleaseId);
      const fromSnapshotKey = `${comparison.fromGameReleaseId}\u0000${comparison.fromSnapshotId}`;
      const toSnapshotKey = `${comparison.toGameReleaseId}\u0000${comparison.toSnapshotId}`;
      if (sourceGameReleaseConflicts.has(comparison.fromGameReleaseId)
          || sourceGameReleaseConflicts.has(comparison.toGameReleaseId)
          || !fromRelease || !toRelease
          || comparison.toGameVersion !== toRelease.gameVersion
          || comparison.toGameBuild !== toRelease.gameBuild
          || sourceSnapshotConflicts.has(fromSnapshotKey) || sourceSnapshotConflicts.has(toSnapshotKey)
          || !sourceSnapshots.has(fromSnapshotKey) || !sourceSnapshots.has(toSnapshotKey)
          || !isKnownGameBuild(toRelease.gameBuild)) continue;
      if (comparison.fromGameVersion !== fromRelease.gameVersion
          || comparison.fromGameBuild !== fromRelease.gameBuild || !isKnownGameBuild(fromRelease.gameBuild)) continue;
      const fromSnapshot = sourceSnapshots.get(fromSnapshotKey);
      const toSnapshot = sourceSnapshots.get(toSnapshotKey);
      const target = findSourceRecord(entityRef);
      if (!target) continue;
      const targetRef = { gameReleaseId: target.gameReleaseId, kind: target.kind, recordId: target.recordId };
      const displaySubject = getLocalizedSubject(target);
      const rowEntityName = row.entityName;
      const hasReviewedEntityName = isObject(rowEntityName) && rowEntityName.locale === 'zh-TW'
        && isDisplayText(rowEntityName.text) && isSha256(rowEntityName.textSha256)
        && hasApprovedWebOwner('game-change', row.changeId, '/entityName');
      if ((!displaySubject && !hasReviewedEntityName) || (rowEntityName !== undefined && !hasReviewedEntityName)) continue;
      const changedFields = Array.isArray(payload.changedFields) ? payload.changedFields : [];
      const fieldSummaries = Array.isArray(row.fieldSummaries) ? row.fieldSummaries : [];
      const summariesByField = new Map();
      for (const field of fieldSummaries) {
        if (!isObject(field) || !isDisplayText(field.field) || !isDisplayText(field.summary)
            || summariesByField.has(field.field)) { summariesByField.clear(); break; }
        summariesByField.set(field.field, field);
      }
      if (summariesByField.size !== changedFields.length
          || changedFields.some(field => !isObject(field) || !summariesByField.has(field.field))) continue;
      const collectionReviewed = hasApprovedWebOwner('game-change', row.changeId, '/fieldSummaries');
      const fields = [];
      let fieldTranslationsValid = true;
      for (const field of changedFields) {
        const wording = summariesByField.get(field.field);
        if (field.valueKind === 'modifier-rule-reference') {
          const beforePath = '/fieldSummaries/' + fieldSummaries.indexOf(wording) + '/beforeRule';
          const afterPath = '/fieldSummaries/' + fieldSummaries.indexOf(wording) + '/afterRule';
          const beforeApproved = collectionReviewed || hasApprovedWebOwner('game-change', row.changeId, beforePath);
          const afterApproved = collectionReviewed || hasApprovedWebOwner('game-change', row.changeId, afterPath);
          if (!beforeApproved || !afterApproved
              || !isObject(wording.beforeRule) || wording.beforeRule.locale !== 'zh-TW'
              || !isDisplayText(wording.beforeRule.text) || !isSha256(wording.beforeRule.textSha256)
              || !isObject(wording.afterRule) || wording.afterRule.locale !== 'zh-TW'
              || !isDisplayText(wording.afterRule.text) || !isSha256(wording.afterRule.textSha256)) {
            fieldTranslationsValid = false;
            break;
          }
          fields.push({
            field: field.field,
            valueKind: field.valueKind,
            beforeRule: wording.beforeRule.text,
            afterRule: wording.afterRule.text,
            summary: wording.summary,
          });
        } else {
          if (wording.beforeRule !== undefined || wording.afterRule !== undefined) {
            fieldTranslationsValid = false;
            break;
          }
          fields.push({ ...field, summary: wording.summary });
        }
      }
      if (!fieldTranslationsValid) continue;
      const sourceSupersedes = payload.supersedesChangeRef;
      const sourceSupersedesId = sourceSupersedes === undefined ? null
        : isObject(sourceSupersedes) && (!sourceSupersedes.kind || sourceSupersedes.kind === 'game-change')
          && isDisplayText(sourceSupersedes.recordId) ? sourceSupersedes.recordId : null;
      const webSupersedesId = row.supersedesChangeId === undefined ? null
        : isDisplayText(row.supersedesChangeId) ? row.supersedesChangeId : null;
      if ((sourceSupersedes !== undefined && sourceSupersedesId === null)
          || (row.supersedesChangeId !== undefined && webSupersedesId === null)
          || (sourceSupersedesId && webSupersedesId && sourceSupersedesId !== webSupersedesId)) continue;
      const blessingVariant = target.kind === 'blessing-variant' ? projectBlessingVariant(target) : null;
      items.push({
        changeId: row.changeId,
        owner: 'source',
        changeKind: 'source-technical',
        gameVersion: comparison.toGameVersion,
        entityKind: target.kind,
        entityKindLabel: ({
          skill: '技能', claim: '數值或條件', blessing: '祝福', 'blessing-variant': '祝福變體',
          weapon: '武器', 'stat-definition': '武器素質', 'stat-curve': '武器曲線', term: '術語',
        })[target.kind] ?? '遊戲內容',
        entityRef: targetRef,
        entityName: hasReviewedEntityName ? rowEntityName.text : displaySubject.name,
        displayEntityRef: { ...(displaySubject?.ref ?? targetRef) },
        operation: payload.operation,
        comparison: {
          ...comparison,
          fromSnapshotCommit: /^[a-f0-9]{40}$/u.test(fromSnapshot?.commit ?? '') ? fromSnapshot.commit : null,
          toSnapshotCommit: /^[a-f0-9]{40}$/u.test(toSnapshot?.commit ?? '') ? toSnapshot.commit : null,
        },
        summary: row.summary.text,
        changedFields: fields,
        ...(blessingVariant ? { blessingVariant } : {}),
        evidence: projectEvidence(payload.evidenceRefs, comparison),
        verificationMethod: payload.verificationMethod,
        verificationLabel: verificationLabel(payload.verificationMethod),
        supersedesChangeId: sourceSupersedesId ?? webSupersedesId,
        sourceRecordId: sourceRecord.recordId,
      });
    }

    for (const row of officialTextChangeRows) {
      if (row?.owner !== 'web' || row.changeKind !== 'official-text'
          || typeof row.changeId !== 'string' || !isObject(row.summary)
          || row.summary.locale !== 'zh-TW' || !isDisplayText(row.summary.text)
          || !hasApprovedWebOwner('official-text-change', row.changeId)) continue;
      const fromRelease = sourceGameReleases.get(row.fromGameReleaseId);
      const toRelease = sourceGameReleases.get(row.toGameReleaseId);
      const target = findSourceRecord(row.entityRef);
      const beforeSources = officialSources.filter(source => source?.officialSourceId === row.fromOfficialSourceId);
      const afterSources = officialSources.filter(source => source?.officialSourceId === row.toOfficialSourceId);
      const displaySubject = getLocalizedSubject(target);
      const beforeParams = beforeSources.length === 1 ? officialInputParameters(beforeSources[0]) : null;
      const afterParams = afterSources.length === 1 ? officialInputParameters(afterSources[0]) : null;
      if (sourceGameReleaseConflicts.has(row.fromGameReleaseId) || sourceGameReleaseConflicts.has(row.toGameReleaseId)
          || !fromRelease || !toRelease || !target || !displaySubject
          || !isKnownGameBuild(fromRelease.gameBuild) || !isKnownGameBuild(toRelease.gameBuild)
          || !isDisplayText(fromRelease.snapshot?.snapshotId) || !isDisplayText(toRelease.snapshot?.snapshotId)
          || beforeSources.length !== 1 || afterSources.length !== 1
          || !isDisplayText(beforeSources[0].sourceText) || !isDisplayText(afterSources[0].sourceText)
          || !isDisplayText(beforeSources[0].resolvedText) || !isDisplayText(afterSources[0].resolvedText)
          || beforeParams === null || afterParams === null) continue;
      const entityKind = row.entityRef.kind;
      items.push({
        changeId: row.changeId,
        owner: 'web',
        changeKind: 'official-text',
        gameVersion: toRelease.gameVersion,
        entityKind,
        entityKindLabel: ({ skill: '技能', blessing: '祝福', weapon: '武器' })[displaySubject.ref.kind] ?? '遊戲內容',
        entityRef: { ...row.entityRef },
        entityName: displaySubject.name,
        displayEntityRef: { ...displaySubject.ref },
        operation: row.operation,
        comparison: {
          fromGameReleaseId: fromRelease.gameReleaseId,
          fromGameVersion: fromRelease.gameVersion,
          fromGameBuild: fromRelease.gameBuild,
          fromSnapshotId: fromRelease.snapshot.snapshotId,
          fromSnapshotCommit: /^[a-f0-9]{40}$/u.test(fromRelease.snapshot.commit ?? '') ? fromRelease.snapshot.commit : null,
          toGameReleaseId: toRelease.gameReleaseId,
          toGameVersion: toRelease.gameVersion,
          toGameBuild: toRelease.gameBuild,
          toSnapshotId: toRelease.snapshot.snapshotId,
          toSnapshotCommit: /^[a-f0-9]{40}$/u.test(toRelease.snapshot.commit ?? '') ? toRelease.snapshot.commit : null,
        },
        summary: row.summary.text,
        officialText: {
          before: {
            text: beforeSources[0].sourceText,
            resolvedText: beforeSources[0].resolvedText,
            params: beforeParams,
            sourceLocale: beforeSources[0].sourceLocale,
            officialSourceId: row.fromOfficialSourceId,
            sourceIdentity: officialInputIdentity(beforeSources[0]),
          },
          after: {
            text: afterSources[0].sourceText,
            resolvedText: afterSources[0].resolvedText,
            params: afterParams,
            sourceLocale: afterSources[0].sourceLocale,
            officialSourceId: row.toOfficialSourceId,
            sourceIdentity: officialInputIdentity(afterSources[0]),
          },
        },
        evidence: [],
        verificationLabel: '官方字串比對',
        supersedesChangeId: isDisplayText(row.supersedesChangeId) ? row.supersedesChangeId : null,
      });
    }

    const itemById = new Map(items.map(item => [item.changeId, item]));
    for (const item of items) {
      const chain = [];
      const seen = new Set([item.changeId]);
      let predecessorId = item.supersedesChangeId;
      while (isDisplayText(predecessorId) && !seen.has(predecessorId) && chain.length < 16) {
        seen.add(predecessorId);
        const previous = itemById.get(predecessorId);
        if (!previous) break;
        chain.push({ changeId: previous.changeId, summary: previous.summary, operation: previous.operation });
        predecessorId = previous.supersedesChangeId;
      }
      item.correctionChain = chain;
    }

    const filtered = items.filter(item => (gameVersion === undefined || item.gameVersion === gameVersion)
      && (entityKind === undefined || item.entityKind === entityKind || item.displayEntityRef?.kind === entityKind));
    filtered.sort((left, right) => left.changeId < right.changeId ? -1 : left.changeId > right.changeId ? 1 : 0);
    return { status: 'ready', items: filtered };
  };

  return Object.freeze({ gameReleaseId, getSkill, getBlessing, getWeapon, getWeaponFamily, getGameChanges, getAnnouncements, getAnnouncement });
}

function exactErrata(errata, officialSource) {
  if (!Array.isArray(errata) || !Array.isArray(officialSource.segments)) return [];
  const result = [];
  for (const row of errata) {
    const anchor = row?.anchor;
    if (anchor?.officialSourceId !== officialSource.officialSourceId || !isDisplayText(anchor.segmentId)) continue;
    const segment = officialSource.segments.filter((candidate) => candidate?.segmentId === anchor.segmentId);
    if (segment.length !== 1) continue;
    const digest = segment[0].sha256 ?? segment[0].segmentSha256;
    if (typeof digest !== 'string' || digest !== anchor.segmentSha256 || !isDisplayText(row.text)) continue;
    result.push({
      errataId: row.errataId,
      text: row.text,
      sourceText: officialSource.sourceText,
      sourceSegmentText: segment[0].text ?? segment[0].token ?? null,
      context: {
        description: row.context?.description,
        refs: Array.isArray(row.context?.refs) ? row.context.refs.map((ref) => ({ ...ref })) : [],
      },
      anchor: {
        officialSourceId: anchor.officialSourceId,
        segmentId: anchor.segmentId,
        segmentSha256: anchor.segmentSha256,
      },
      claimRefs: Array.isArray(row.claimRefs) ? row.claimRefs.map((ref) => ({ ...ref })) : [],
      evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs.map((ref) => ({ ...ref })) : [],
    });
  }
  return result;
}
