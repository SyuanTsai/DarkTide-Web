const HISTORY_PATH = '/history/1.13.1/';
const MANIFEST_PATH = `${HISTORY_PATH}manifest.json`;
const PROJECTION_PATH = `${HISTORY_PATH}player-index.json`;
const HISTORY_SCHEMA = 'w14.historical-player-index.v1';
const FIXED_MANIFEST_BYTES = 4470;
const FIXED_MANIFEST_SHA256 = '8b6786c6fdbf984b4bb94caadd502d794a0d1211b47a6493dff60463b73164ec';
const FIXED_PROJECTION_BYTES = 766979;
const FIXED_PROJECTION_SHA256 = '0a9d143d7174f7516bd59b0928c4e06b372480e408ffe7e2fe52f4906a34c6bb';
const FIXED_SOURCE_SHA256 = '3f3c24874004d67aa7e03b045ca5f9a7409a0bea3e9136247852c26ec2c34bcc';
const KINDS = new Set(['skill', 'weapon', 'blessing', 'mark', 'variant']);
const KIND_LABELS = Object.freeze({ skill: '技能', weapon: '武器', blessing: '祝福', mark: '武器型號', variant: '祝福變體' });
const MAX_MANIFEST_BYTES = 64_000;
const MAX_PROJECTION_BYTES = 2_000_000;
const Han = /[\u3400-\u9fff]/u;

function fail(message) { throw new Error(message); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function decodeJson(bytes, label) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail(`${label} is not valid UTF-8`); }
  try { return JSON.parse(text); }
  catch { fail(`${label} is not valid JSON`); }
}

function toHex(bytes) { return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join(''); }

async function digest(cryptoApi, bytes) {
  if (!cryptoApi?.subtle?.digest) fail('history reader requires Web Crypto SHA-256');
  return toHex(await cryptoApi.subtle.digest('SHA-256', bytes));
}

async function readBoundedJson(response, expectedUrl, maxBytes, label) {
  if (!response || !response.ok) fail(`${label} HTTP ${response?.status ?? 'unavailable'}`);
  if (response.redirected === true || response.url !== expectedUrl.href) fail(`${label} did not retain its same-origin final URL`);
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?)?\s*$/iu.test(contentType)) {
    fail(`${label} has an invalid JSON content type`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) fail(`${label} has no bounded response stream`);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      size += chunk.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        fail(`${label} exceeds its fixed byte bound`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function checkEntry(entry, index) {
  if (!isObject(entry) || !KINDS.has(entry.kind) || typeof entry.id !== 'string' || !entry.id ||
      typeof entry.name !== 'string' || !Han.test(entry.name)) fail(`history entry ${index} has no localized identity`);
  const fieldSets = {
    skill: ['category', 'id', 'kind', 'name', 'summary'],
    weapon: ['category', 'id', 'kind', 'name', 'relatedNames'],
    blessing: ['category', 'id', 'kind', 'name', 'relatedCount', 'summary', 'trigger'],
    mark: ['id', 'kind', 'name', 'parentName'],
    variant: ['category', 'definedTiers', 'id', 'kind', 'name', 'summary'],
  };
  const expected = fieldSets[entry.kind];
  if (Object.keys(entry).sort().join('\0') !== expected.slice().sort().join('\0')) fail(`history entry ${index} has unsupported fields`);
  for (const field of ['category', 'summary', 'trigger', 'parentName']) {
    if (entry[field] !== undefined && entry[field] !== null && typeof entry[field] !== 'string') fail(`history entry ${index} has an invalid ${field}`);
    if (typeof entry[field] === 'string' && !Han.test(entry[field])) fail(`history entry ${index} has a nonlocalized ${field}`);
  }
  if (entry.relatedNames !== undefined && (!Array.isArray(entry.relatedNames) || entry.relatedNames.some(name => typeof name !== 'string' || !Han.test(name)))) {
    fail(`history entry ${index} has invalid related names`);
  }
  if (entry.relatedCount !== undefined && (!Number.isSafeInteger(entry.relatedCount) || entry.relatedCount < 0)) fail(`history entry ${index} has an invalid related count`);
  if (entry.definedTiers !== undefined && (!Array.isArray(entry.definedTiers) || entry.definedTiers.some(tier => !Number.isInteger(tier) || tier < 1 || tier > 4))) {
    fail(`history entry ${index} has invalid defined tiers`);
  }
}

function checkManifest(manifest) {
  if (!isObject(manifest) || Object.keys(manifest).sort().join('\0') !== [
    'fullPlayerSnapshot', 'gameVersion', 'projection', 'projectionReport', 'schemaVersion', 'source', 'technicalSourceRepository',
  ].sort().join('\0')) fail('historical manifest has unsupported fields');
  if (manifest.schemaVersion !== HISTORY_SCHEMA || manifest.gameVersion !== '1.13.1' ||
      !isObject(manifest.source) || manifest.source.gameVersion !== '1.13.1' ||
      manifest.source.repository !== 'SyuanTsai/DarkTide-Web' || manifest.source.path !== 'content/published/content.json' ||
      manifest.source.sha256 !== FIXED_SOURCE_SHA256 || manifest.source.byteLength !== 3956394 ||
      manifest.source.commit !== '61f1dcda6cb80fb1ee2bf595b3b9a082825a912f' ||
      !isObject(manifest.projection) || manifest.projection.path !== 'player-index.json' ||
      manifest.projection.byteLength !== FIXED_PROJECTION_BYTES || manifest.projection.sha256 !== FIXED_PROJECTION_SHA256 ||
      manifest.fullPlayerSnapshot !== 'https://github.com/SyuanTsai/DarkTide-Web/releases/download/site-61f1dcda6cb80fb1ee2bf595b3b9a082825a912f-39541306251-1/static-site.tar.gz' ||
      manifest.technicalSourceRepository !== 'https://github.com/SyuanTsai/DarkTide-Source-Data') {
    fail('historical manifest does not match the fixed 1.13.1 player package');
  }
  const source = new URL(manifest.fullPlayerSnapshot);
  const technical = new URL(manifest.technicalSourceRepository);
  if (source.protocol !== 'https:' || source.hostname !== 'github.com' || technical.protocol !== 'https:' || technical.hostname !== 'github.com') {
    fail('historical source links are not fixed HTTPS links');
  }
}

function checkProjection(projection, manifest) {
  if (!isObject(projection) || Object.keys(projection).sort().join('\0') !== ['counts', 'entries', 'gameVersion', 'schemaVersion'].sort().join('\0') ||
      projection.schemaVersion !== HISTORY_SCHEMA || projection.gameVersion !== '1.13.1' || !Array.isArray(projection.entries) ||
      !isObject(projection.counts)) fail('historical player projection has an invalid schema');
  const ids = new Set();
  const counts = { skills: 0, weapons: 0, blessings: 0, marks: 0, variants: 0 };
  for (const [index, entry] of projection.entries.entries()) {
    checkEntry(entry, index);
    const key = `${entry.kind}\0${entry.id}`;
    if (ids.has(key)) fail(`history projection duplicates identity ${entry.kind}`);
    ids.add(key);
    counts[entry.kind + 's'] += 1;
  }
  if (JSON.stringify(projection.counts) !== JSON.stringify(manifest.projectionReport.sourceCounts) ||
      JSON.stringify(counts) !== JSON.stringify(manifest.projection.counts)) fail('historical player counts do not match the verified entries');
  return projection;
}

export async function loadW14HistoryPackage({ fetchImpl = globalThis.fetch, cryptoApi = globalThis.crypto, pageUrl = globalThis.location?.href } = {}) {
  if (typeof fetchImpl !== 'function' || typeof pageUrl !== 'string') fail('history reader requires a page URL and fetch implementation');
  let page;
  try { page = new URL(pageUrl); } catch { fail('history page URL is invalid'); }
  if (!['http:', 'https:'].includes(page.protocol) || !page.hostname || page.username || page.password) fail('history page URL must have a local web origin');
  const manifestUrl = new URL(MANIFEST_PATH, page.origin);
  const projectionUrl = new URL(PROJECTION_PATH, page.origin);
  const init = { method: 'GET', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-cache', headers: { Accept: 'application/json' } };
  const manifestResponse = await fetchImpl(manifestUrl.href, init);
  const manifestBytes = await readBoundedJson(manifestResponse, manifestUrl, MAX_MANIFEST_BYTES, 'historical manifest');
  if (manifestBytes.byteLength !== FIXED_MANIFEST_BYTES || await digest(cryptoApi, manifestBytes) !== FIXED_MANIFEST_SHA256) {
    fail('historical manifest bytes differ from the fixed 1.13.1 package');
  }
  const manifest = decodeJson(manifestBytes, 'historical manifest');
  checkManifest(manifest);
  const projectionResponse = await fetchImpl(projectionUrl.href, init);
  const projectionBytes = await readBoundedJson(projectionResponse, projectionUrl, MAX_PROJECTION_BYTES, 'historical player projection');
  if (projectionBytes.byteLength !== FIXED_PROJECTION_BYTES || await digest(cryptoApi, projectionBytes) !== FIXED_PROJECTION_SHA256 ||
      await digest(cryptoApi, projectionBytes) !== manifest.projection.sha256) {
    fail('historical player projection digest or byte length differs from the fixed package');
  }
  const projection = checkProjection(decodeJson(projectionBytes, 'historical player projection'), manifest);
  return { manifest, projection };
}

function textElement(documentImpl, tag, text, className = '') {
  const element = documentImpl.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function setMetadata(documentImpl, url, title, description, detailId = null) {
  documentImpl.title = `${title}｜黑潮繁體資料庫`;
  let descriptionMeta = documentImpl.querySelector('meta[name="description"]');
  if (!descriptionMeta) { descriptionMeta = documentImpl.createElement('meta'); descriptionMeta.name = 'description'; documentImpl.head.append(descriptionMeta); }
  descriptionMeta.content = description;
  let canonical = documentImpl.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = documentImpl.createElement('link'); canonical.rel = 'canonical'; documentImpl.head.append(canonical); }
  const canonicalUrl = new URL(HISTORY_PATH, url.origin);
  if (detailId) canonicalUrl.searchParams.set('id', detailId);
  canonical.href = canonicalUrl.href;
}

function makeHistoryLink(documentImpl, href, label, className = '') {
  const link = textElement(documentImpl, 'a', label, className);
  link.href = href;
  return link;
}

function findKind(entry, kind) { return !kind || kind === 'all' || entry.kind === kind; }

export function renderW14HistoryPage({ main, buildMeta, documentImpl = globalThis.document, url = new URL(globalThis.location.href), result = null, error = null }) {
  if (!main || !documentImpl) throw new TypeError('history renderer requires the page main element and document');
  main.replaceChildren();
  for (const link of documentImpl.querySelectorAll('.primary-nav a[aria-current="page"]')) link.removeAttribute('aria-current');
  documentImpl.querySelector('.primary-nav a[href="/history/1.13.1/"]')?.setAttribute('aria-current', 'page');

  if (error) {
    const title = '歷史資料目前無法載入';
    setMetadata(documentImpl, url, title, '1.13.1 歷史資料無法載入。');
    const section = textElement(documentImpl, 'section', '', 'history-page');
    section.append(textElement(documentImpl, 'h1', title), textElement(documentImpl, 'p', '歷史資料驗證失敗，請稍後再試。', 'history-error'));
    main.append(section);
    return;
  }
  if (!result) {
    const section = textElement(documentImpl, 'section', '', 'history-page');
    section.append(textElement(documentImpl, 'h1', '正在載入 1.13.1 歷史資料…'));
    main.append(section);
    return;
  }
  const requestedVersion = url.searchParams.get('version');
  if (requestedVersion && requestedVersion !== '1.13.1') {
    setMetadata(documentImpl, url, '找不到歷史版本', '此歷史入口只包含 1.13.1。');
    const unavailable = textElement(documentImpl, 'section', '', 'history-page history-error');
    unavailable.append(textElement(documentImpl, 'h1', '此歷史入口只包含 1.13.1。'));
    unavailable.append(makeHistoryLink(documentImpl, HISTORY_PATH, '返回 1.13.1 歷史資料', 'button-link'));
    main.append(unavailable);
    return;
  }

  const section = textElement(documentImpl, 'section', '', 'history-page');
  const itemId = url.searchParams.get('id');
  const kind = url.searchParams.get('type') ?? 'all';
  if (kind !== 'all' && !KINDS.has(kind)) {
    setMetadata(documentImpl, url, '找不到歷史分類', '指定的歷史資料分類無效。');
    section.append(textElement(documentImpl, 'h1', '找不到歷史分類'), textElement(documentImpl, 'p', '請返回歷史資料目錄選擇有效分類。'));
    section.append(makeHistoryLink(documentImpl, HISTORY_PATH, '返回 1.13.1 歷史資料', 'button-link'));
    main.append(section);
    return;
  }
  if (itemId !== null) {
    const entry = result.projection.entries.find(row => row.id === itemId && findKind(row, kind));
    if (!entry) {
      setMetadata(documentImpl, url, '找不到歷史項目', '指定的 1.13.1 歷史項目不存在。');
      section.append(textElement(documentImpl, 'h1', '找不到歷史項目'), textElement(documentImpl, 'p', '此歷史項目不存在；目前資料不會代替它顯示。'));
      section.append(makeHistoryLink(documentImpl, HISTORY_PATH, '返回歷史資料目錄', 'button-link'));
      main.append(section);
      return;
    }
    setMetadata(documentImpl, url, entry.name, `${entry.name} 的 1.13.1 歷史資料。`, itemId);
    section.append(
      makeHistoryLink(documentImpl, HISTORY_PATH, '返回 1.13.1 歷史資料目錄', 'secondary-link'),
      textElement(documentImpl, 'p', '歷史版本 1.13.1', 'history-badge'),
      textElement(documentImpl, 'h1', entry.name),
      textElement(documentImpl, 'p', KIND_LABELS[entry.kind], 'history-kind'),
    );
    if (entry.parentName) section.append(textElement(documentImpl, 'p', `所屬：${entry.parentName}`));
    if (entry.category) section.append(textElement(documentImpl, 'p', `分類：${entry.category}`));
    if (entry.summary) section.append(textElement(documentImpl, 'p', entry.summary, 'history-summary'));
    if (entry.trigger) section.append(textElement(documentImpl, 'p', `觸發條件：${entry.trigger}`));
    if (entry.relatedNames?.length) section.append(textElement(documentImpl, 'p', `相關型號：${entry.relatedNames.join('、')}`));
    if (Number.isSafeInteger(entry.relatedCount)) section.append(textElement(documentImpl, 'p', `已整理變體：${entry.relatedCount} 項`));
    if (entry.definedTiers?.length) section.append(textElement(documentImpl, 'p', `來源定義階級：${entry.definedTiers.map(tier => `LV${tier}`).join('、')}；此欄不代表目前可取得性。`));
  } else {
    const query = url.searchParams.get('q')?.trim() ?? '';
    setMetadata(documentImpl, url, '1.13.1 歷史資料', '查閱 1.13.1 歷史技能、武器、祝福與其已整理的玩家摘要。');
    section.append(
      textElement(documentImpl, 'p', '歷史資料 · 1.13.1', 'history-badge'),
      textElement(documentImpl, 'h1', '1.13.1 歷史資料'),
      textElement(documentImpl, 'p', '此頁只供查閱舊版玩家摘要，不是目前遊戲版本，也不會代替目前資料。', 'history-notice'),
    );
    const form = textElement(documentImpl, 'form', '', 'history-filters');
    form.method = 'get';
    form.action = HISTORY_PATH;
    const searchLabel = textElement(documentImpl, 'label', '搜尋名稱或繁中摘要');
    searchLabel.htmlFor = 'history-query';
    const search = textElement(documentImpl, 'input');
    search.id = 'history-query'; search.name = 'q'; search.type = 'search'; search.value = query; search.autocomplete = 'off';
    searchLabel.append(search);
    const kindLabel = textElement(documentImpl, 'label', '資料類型');
    kindLabel.htmlFor = 'history-kind';
    const select = documentImpl.createElement('select'); select.id = 'history-kind'; select.name = 'type';
    for (const [value, label] of [['all', '全部'], ...Object.entries(KIND_LABELS)]) {
      const option = textElement(documentImpl, 'option', label); option.value = value; option.selected = kind === value; select.append(option);
    }
    kindLabel.append(select);
    const submit = textElement(documentImpl, 'button', '搜尋'); submit.type = 'submit';
    form.append(searchLabel, kindLabel, submit);
    section.append(form);
    const normalizedQuery = query.toLocaleLowerCase('zh-TW');
    const rows = result.projection.entries.filter(entry => findKind(entry, kind) &&
      (!normalizedQuery || [entry.name, entry.category, entry.summary, entry.trigger, entry.parentName, ...(entry.relatedNames ?? [])]
        .filter(Boolean).join(' ').toLocaleLowerCase('zh-TW').includes(normalizedQuery)));
    section.append(textElement(documentImpl, 'p', `找到 ${rows.length} 筆歷史資料`, 'history-result-count'));
    const list = textElement(documentImpl, 'ul', '', 'history-results');
    for (const row of rows) {
      const item = documentImpl.createElement('li');
      const link = makeHistoryLink(documentImpl, `${HISTORY_PATH}?${new URLSearchParams({ id: row.id, type: row.kind })}`, row.name);
      const details = [KIND_LABELS[row.kind], row.category, row.summary].filter(Boolean).join(' · ');
      item.append(link, textElement(documentImpl, 'p', details));
      list.append(item);
    }
    if (!rows.length) section.append(textElement(documentImpl, 'p', '沒有符合條件的 1.13.1 歷史摘要。', 'history-empty'));
    else section.append(list);
    section.append(textElement(documentImpl, 'p', `原始輸入有 ${result.manifest.projection.excludedCounts.skills + result.manifest.projection.excludedCounts.weapons + result.manifest.projection.excludedCounts.marks} 筆沒有可沿用的繁中名稱，因此未顯示；沒有以英文名稱補值。`, 'history-coverage-note'));
  }
  const sources = documentImpl.createElement('section');
  sources.className = 'history-sources';
  sources.append(textElement(documentImpl, 'h2', '歷史來源'));
  sources.append(
    makeHistoryLink(documentImpl, result.manifest.source.staticBackup.releaseUrl, '查看已驗證的 1.13.1 網站備份版本'),
    makeHistoryLink(documentImpl, result.manifest.fullPlayerSnapshot, '下載原公開靜態網站備份'),
    makeHistoryLink(documentImpl,
      `https://github.com/${result.manifest.source.repository}/blob/${result.manifest.source.commit}/${result.manifest.source.path}`,
      '查看已核對的 1.13.1 發布資料來源'),
    makeHistoryLink(documentImpl, result.manifest.technicalSourceRepository, '前往 Source 技術資料專案'),
  );
  section.append(sources);
  main.append(section);
}

export { HISTORY_PATH as W14_HISTORY_PATH };
