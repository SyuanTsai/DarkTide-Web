import { sourceItemPresentation, sourceChangeValueText, createSharedViewModel, validateAnnouncement } from './shared-view.mjs';

export function blessingListTier(applicability) {
  return applicability.tiers?.includes(4) ? 4 : applicability.tiers?.[0];
}

const SECTION_ORDER = ['effects', 'conditions', 'calculation', 'notes', 'extra'];
const SECTION_LABELS = Object.freeze({ effects: '效果', conditions: '條件', calculation: '計算', notes: '補充說明', extra: '額外說明' });
const INPUT_LABELS = Object.freeze({
  light_attack: '輕攻擊', heavy_attack: '重攻擊', special_action: '特殊動作', block: '格擋',
  start_attack: '開始攻擊', dodge: '閃避', push: '推擊', push_follow_up: '推擊後續',
  light_push: '輕推擊', heavy_push: '重推擊', shoot_pressed: '射擊輸入', zoom_shoot: '機瞄射擊輸入', weapon_special: '特殊動作輸入',
});
const UNIT_LABELS = Object.freeze({
  percent: '%', ratio: '比例', seconds: '秒', s: '秒', count: '次', meters: '公尺',
  point: '點', 'dodge-count': '次閃避', 'stamina-point': '耐力點',
  'stamina-point-per-second': '耐力點／秒', 'normalized-speed-per-second': '標準化速度／秒', 'instance-count': '彈藥單位',
  'attack-power-point': '攻擊威力點', 'cleave-power-point': '鋸擊威力點',
});
const SOURCE_STAT_LABELS = Object.freeze({
  chainaxe_dps_stat: '傷害輸出', chainaxe_armor_pierce_stat: '破甲',
  chainaxe_mobility_stat: '移動性', chainaxe_defence_stat: '防禦', chainaxe_sawing_stat: '鏈鋸階段',
  damage_stat: '傷害', cleave_stat: '劈砍', impact_stat: '衝擊',
  ammunition_clips: '彈匣容量', ammunition_reserve: '備用彈藥容量',
});
const SOURCE_PROPERTY_LABELS = Object.freeze({
  ammunition_usage: '每次射擊消耗', allow_shots_with_less_than_required_ammo: '彈藥不足需求量時仍允許射擊',
  activation_time: '特殊動作啟動時間', total_time: '動作總時長', chain_time: '動作銜接時間',
  range: '來源 range 欄位', fire_mode: '射擊模式',
  ammunition_clips: '彈匣容量', ammunition_reserve: '備用彈藥容量',
  consecutive_dodges_reset: '連續閃避重置時間', distance_scale: '閃避距離係數',
  diminishing_return_distance_modifier: '閃避距離衰減係數', diminishing_return_start: '衰減起始閃避次數',
  diminishing_return_limit: '衰減閃避上限', speed_modifier: '移動速度修正',
  stamina_modifier: '耐力修正', sprint_cost_per_second: '衝刺耐力消耗',
  'block_cost_default.inner': '格擋耐力消耗（內側）', 'block_cost_default.outer': '格擋耐力消耗（外側）',
  push_cost: '推擊耐力消耗', sprint_forward_deceleration: '向前衝刺減速',
  sprint_sideway_acceleration: '側向衝刺加速', sprint_sideway_deceleration: '側向衝刺減速',
  sprint_forward_acceleration: '向前衝刺加速', sprint_speed_mod: '衝刺速度修正',
  attack: '攻擊威力', damage: '傷害', armor_damage_modifier: '護甲傷害修正',
});
const TARGET_ROLE_LABELS = Object.freeze({
  'single-target': '單一目標', 'multi-target-cleave': '多目標劈砍',
});
const ATTACK_MODE_LABELS = Object.freeze({ light: '輕攻擊', heavy: '重攻擊', push: '推擊', block: '格擋', special: '特殊動作', hipfire: '腰射', ads: '機瞄' });
const BRANCH_LABELS = Object.freeze({
  normal: '一般分支', abort: '中止分支', 'special-active': '特殊動作啟動分支',
  inner: '內側分支', outer: '外側分支',
});
const QUANTITY_LABELS = Object.freeze({
  'attack-power-distribution': '攻擊威力分布', 'armor-damage-modifier': '護甲傷害修正',
  'damage-profile': '傷害設定', 'dodge-count': '閃避次數',
});
export const SHARED_ANNOUNCEMENT_ROUTING_CAPABILITY = 'shared-announcement-routing-v1';
const GAME_CHANGE_TYPE_LABELS = Object.freeze({ skill: '技能', blessing: '祝福', weapon: '武器', other: '其他' });
const GAME_CHANGE_OPERATION_LABELS = Object.freeze({
  added: '新增', removed: '移除', modified: '調整', correction: '更正',
});
const GAME_CHANGE_UNIT_LABELS = Object.freeze({
  ratio: '比例', percent: '%', s: '秒', m: '公尺', damage: '傷害', impact: '衝擊', point: '點',
  rating: '評級', 'attack-power-point': '攻擊威力點', 'stamina-point': '耐力點',
  'stamina-point-per-second': '耐力點／秒', 'dodge-count': '次閃避',
  'instance-count': '次', 'normalized-speed-per-second': '標準化速度／秒',
  'item-stat-rating': '物品素質評級', 'expertise-level': '專精等級',
  'expertise-level-per-rank': '每階專精等級',
});

function node(tag, value = null, className = '') {
  const result = document.createElement(tag);
  if (value !== null && value !== undefined) result.textContent = String(value);
  if (className) result.className = className;
  return result;
}

export function retainedNameProvenanceRows(nameProvenance) {
  const rows = [];
  const append = (label, value) => {
    if (typeof value === 'string' && value.trim()) rows.push([label, value]);
  };
  append('型號 ID', nameProvenance?.sourceMarkId);
  const historyEvidence = nameProvenance?.historyEvidence;
  if (typeof historyEvidence?.repository === 'string' && typeof historyEvidence?.commit === 'string'
      && typeof historyEvidence?.path === 'string') {
    append('留存資料來源', `${historyEvidence.repository}@${historyEvidence.commit}:${historyEvidence.path}`);
  }
  append('留存來源 SHA-256', historyEvidence?.sourceSha256);
  return rows;
}

const RAW_ATTACK_POWER_FIELD = /(?:^|\.)power_distribution\.attack(?:\.\d+|\[\d+\])?$/u;

export function isRawAttackPowerDistributionDefinition(definition, curve, curveSourceRefs = []) {
  const quantity = definition?.payload?.quantity;
  const curveRef = definition?.payload?.curveRef;
  const payload = curve?.payload;
  const knots = payload?.knots;
  if (definition?.kind !== 'stat-definition' || typeof quantity !== 'string' || !RAW_ATTACK_POWER_FIELD.test(quantity)
      || curve?.kind !== 'stat-curve' || definition.gameReleaseId !== curve.gameReleaseId
      || curveRef?.recordId !== curve.recordId || curveRef?.gameReleaseId !== curve.gameReleaseId
      || payload?.inputUnit !== 'ratio' || payload?.outputUnit !== 'attack-power-point'
      || !Array.isArray(knots) || knots.length === 0) return false;

  const pinnedSourcePaths = new Set(curveSourceRefs
    .filter(ref => typeof ref?.sourceId === 'string' && ref.gameReleaseId === curve.gameReleaseId && typeof ref.path === 'string')
    .map(ref => `${ref.gameReleaseId}\u0000${ref.sourceId}\u0000${ref.path}`));
  return knots.every(knot => {
    const locator = knot?.sourceLocator;
    const sourceRef = locator?.sourceRef;
    return typeof knot?.rawEndpoint === 'string' && knot.rawEndpoint.trim() !== ''
      && typeof locator?.path === 'string' && typeof locator.fieldPath === 'string'
      && RAW_ATTACK_POWER_FIELD.test(locator.fieldPath)
      && sourceRef?.gameReleaseId === curve.gameReleaseId && typeof sourceRef.sourceId === 'string'
      && pinnedSourcePaths.has(`${sourceRef.gameReleaseId}\u0000${sourceRef.sourceId}\u0000${locator.path}`);
  });
}
function link(href, label, className = '') {
  const result = node('a', label, className);
  result.href = href;
  return result;
}
function safeOfficialResourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password
        || [...url.searchParams.keys()].some(key => /(?:token|secret|password|signature|auth|api[-_]?key)/iu.test(key))) return null;
    return url.href;
  } catch { return null; }
}
function safeAnnouncementResourceUrl(value) {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) {
    try {
      const url = new URL(value, 'https://darktide.invalid');
      if (url.origin !== 'https://darktide.invalid' || url.hash) return null;
      if (url.pathname === '/terms/' && !url.search) return value;
      if (url.pathname === '/announcements/' && [...url.searchParams.keys()].every(key => key === 'id')
          && url.searchParams.getAll('id').length === 1
          && /^[a-z0-9][a-z0-9:._-]{1,127}$/u.test(url.searchParams.get('id') ?? '')) return value;
      return null;
    } catch { return null; }
  }
  return safeOfficialResourceUrl(value);
}
function sharedChangeIndexHref(result) {
  const revision = result?.pointer?.data_revision;
  const filePath = result?.manifest?.changeIndexPath;
  if (!/^[a-f0-9]{64}$/u.test(revision ?? '') || typeof filePath !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/u.test(filePath)
      || filePath.includes('%') || filePath.includes('\\')
      || filePath.split('/').some(part => !part || part === '.' || part === '..')) return null;
  return `/data/${revision}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
}
function paramsUrl(path, values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null) params.set(key, String(value));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
function detailBlock(title) {
  const section = node('section', null, 'shared-card');
  section.append(node('h2', title));
  return section;
}
function setMetadata(title, description, url) {
  document.title = `${title}｜黑潮繁體資料庫`;
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) { meta = node('meta'); meta.name = 'description'; document.head.append(meta); }
  meta.content = description;
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = node('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
  const canonicalParams = new URLSearchParams();
  for (const key of ['id', 'variant', 'tier', 'family', 'mark', 'version', 'type']) {
    const value = url.searchParams.get(key);
    if (value !== null) canonicalParams.set(key, value);
  }
  const canonicalQuery = canonicalParams.toString();
  canonical.href = `${url.origin}${url.pathname}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
  for (const item of document.querySelectorAll('.primary-nav a')) {
    const active = item.pathname === url.pathname || (item.pathname !== '/' && url.pathname.startsWith(item.pathname));
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
}
function renderSections(parent, sections) {
  const byId = new Map(sections.map(section => [section.sectionId, section]));
  const available = SECTION_ORDER.filter(sectionId => byId.get(sectionId)?.items?.length);
  if (!available.length) return;
  const details = node('details', null, 'shared-card shared-expandable shared-detail-sections');
  details.append(node('summary', '詳細說明'));
  details.open = true;
  const content = node('div', null, 'shared-detail-section-list');
  for (const sectionId of SECTION_ORDER) {
    const section = byId.get(sectionId);
    if (!section?.items?.length) continue;
    const block = node('section', null, 'shared-detail-section');
    block.append(node('h3', SECTION_LABELS[sectionId]));
    const list = node('ul', null, 'shared-detail-list');
    for (const item of section.items) {
      const row = node('li');
      if (Array.isArray(item.parts)) {
        for (const part of item.parts) row.append(document.createTextNode(part.text ?? part.value ?? ''));
      } else if (typeof item.text === 'string') row.textContent = item.text;
      if (Array.isArray(item.termRuleRefs) && item.termRuleRefs.length) {
        row.dataset.termRuleCount = String(item.termRuleRefs.length);
      }
      list.append(row);
    }
    block.append(list);
    content.append(block);
  }
  details.append(content);
  parent.append(details);
}
// The 1.13.2 comparison rows were checked in W07 officialInputs 555d2bec… and the fixed W09 request/lock c882e473….
// Bind the comparison to these exact displayed/source strings and row identities, not to a whole-package revision that may advance for unrelated data.
const CHAINAXE_OFFICIAL_NAME_KEY = 'loc_weapon_family_chainaxe_p1_m1';
const CHAINAXE_OFFICIAL_NAME_SOURCE_HASH = 'ca7da17a';
const CHAINAXE_OFFICIAL_NAME_TEXT = '突擊鏈斧';
const CHAINAXE_OFFICIAL_NAME_TEXT_SHA256 = '6ac2c3f1cd3bf92c06b4031fcadb4200bc4304c2b77b2b08135b129eb36f4e89';
const OFFICIAL_WEAPON_NAME_PROVENANCE_PINS = new Map([
  ['chainaxe_p1\u0000chainaxe_p1_m1', {
    recordId: 'darktide:weapon:chainaxe:p1-m1',
    presentationId: 'web:presentation:chainaxe-p1-m1:r1134',
    officialSourceId: 'official:w07:chainaxe-p1-m1:weapon-name:zh-tw:r1134',
    key: CHAINAXE_OFFICIAL_NAME_KEY,
    sourceHash: CHAINAXE_OFFICIAL_NAME_SOURCE_HASH,
    sourceText: CHAINAXE_OFFICIAL_NAME_TEXT,
    sourceTextSha256: CHAINAXE_OFFICIAL_NAME_TEXT_SHA256,
    resolvedTextSha256: CHAINAXE_OFFICIAL_NAME_TEXT_SHA256,
  }],
  ['chainaxe_p1\u0000chainaxe_p1_m2', {
    recordId: 'darktide:weapon:chainaxe:p1-m2',
    presentationId: 'web:presentation:chainaxe-p1-m2:r1134',
    officialSourceId: 'official:w07:chainaxe-p1-m2:weapon-name:zh-tw:r1134',
    key: CHAINAXE_OFFICIAL_NAME_KEY,
    sourceHash: CHAINAXE_OFFICIAL_NAME_SOURCE_HASH,
    sourceText: CHAINAXE_OFFICIAL_NAME_TEXT,
    sourceTextSha256: CHAINAXE_OFFICIAL_NAME_TEXT_SHA256,
    resolvedTextSha256: CHAINAXE_OFFICIAL_NAME_TEXT_SHA256,
  }],
  ['lasgun_p1\u0000lasgun_p1_m1', {
    recordId: 'darktide:weapon:lasgun:p1-m1',
    presentationId: 'web:presentation:lasgun-p1-m1:r1134',
    officialSourceId: 'official:w13:lasgun-p1-m1:weapon-name:zh-tw:r1134',
    key: 'loc_weapon_family_lasgun_p1_m1',
    sourceHash: 'f93eef0d',
    sourceText: '步兵鐳射槍',
    sourceTextSha256: '691dfad2b858feab456f55f3466c9f0acfa72c8506e7c0c80fa0134b2ee4902a',
    resolvedTextSha256: '691dfad2b858feab456f55f3466c9f0acfa72c8506e7c0c80fa0134b2ee4902a',
  }],
]);

function weaponNameProvenance(result, view) {
  const pin = OFFICIAL_WEAPON_NAME_PROVENANCE_PINS.get(`${view.familyId}\u0000${view.markId}`);
  if (!pin) return null;
  const manifest = result?.manifest;
  const manifestMatches = manifest?.gameReleaseId === 'darktide:1.13.4'
    && manifest.gameVersion === '1.13.4'
    && manifest.source?.repository === 'https://github.com/SyuanTsai/DarkTide-Source-Data';
  const domain = result?.domains?.find(row => row.kind === 'weapons' || row.kind === 'weapon-family');
  const records = domain?.source?.records?.filter(row => row?.kind === 'weapon' && row.recordId === pin.recordId) ?? [];
  const presentations = domain?.web?.presentations?.filter(row => row?.authoringId === pin.presentationId) ?? [];
  const sources = domain?.web?.officialInputs?.sources?.filter(row => row?.officialSourceId === pin.officialSourceId) ?? [];
  if (records.length !== 1 || presentations.length !== 1 || sources.length !== 1) return 'unconfirmed';

  const record = records[0];
  const presentation = presentations[0];
  const source = sources[0];
  const expectedRef = { gameReleaseId: 'darktide:1.13.4', kind: 'weapon', recordId: pin.recordId };
  const presentationOfficial = presentation.official;
  const identityMatches = record.gameReleaseId === expectedRef.gameReleaseId
    && record.payload?.familyId === view.familyId
    && record.payload?.markId === view.markId
    && presentation.entityRef?.gameReleaseId === expectedRef.gameReleaseId
    && presentation.entityRef?.kind === expectedRef.kind
    && presentation.entityRef?.recordId === expectedRef.recordId
    && presentation.locale === 'zh-TW'
    && presentation.name === pin.sourceText
    && presentation.nameOfficialSourceId === pin.officialSourceId
    && presentationOfficial?.entityRef?.gameReleaseId === expectedRef.gameReleaseId
    && presentationOfficial?.entityRef?.kind === expectedRef.kind
    && presentationOfficial?.entityRef?.recordId === expectedRef.recordId
    && presentationOfficial?.officialSourceId === pin.officialSourceId
    && presentationOfficial?.origin === 'game-localization'
    && presentationOfficial?.resource === 'items'
    && presentationOfficial?.key === pin.key
    && presentationOfficial?.sourceHash === pin.sourceHash
    && presentationOfficial?.occurrence === 1
    && presentationOfficial?.sourceTextSha256 === pin.sourceTextSha256
    && presentationOfficial?.resolvedTextSha256 === pin.resolvedTextSha256
    && source.entityRef?.gameReleaseId === expectedRef.gameReleaseId
    && source.entityRef?.kind === expectedRef.kind
    && source.entityRef?.recordId === expectedRef.recordId
    && source.sourceLocale === 'zh-TW'
    && source.origin === 'game-localization'
    && source.resource === 'items'
    && source.officialSourceId === pin.officialSourceId
    && source.key === pin.key
    && source.sourceHash === pin.sourceHash
    && source.occurrence === 1
    && source.sourceText === pin.sourceText
    && source.resolvedText === pin.sourceText
    && source.sourceTextSha256 === pin.sourceTextSha256
    && source.resolvedTextSha256 === pin.resolvedTextSha256
    && source.sourceText === source.resolvedText
    && view.name === pin.sourceText
    && view.official?.sourceText === pin.sourceText
    && view.official?.resolvedText === pin.sourceText;
  return manifestMatches && identityMatches ? 'matches-fixed-1.13.2-text' : 'unconfirmed';
}

function renderOfficial(parent, official, nameProvenance = null) {
  const block = detailBlock('官方繁體中文');
  block.append(node('p', official.resolvedText, 'shared-official-text'));
  if (nameProvenance === 'matches-fixed-1.13.2-text') {
    block.append(node('p', '與 1.13.2 固定來源文字相同；未提供獨立 1.13.4 原始文字證據。', 'shared-official-name-provenance'));
  } else if (nameProvenance === 'unconfirmed') {
    block.append(node('p', '來源版本未確認。', 'shared-official-name-provenance'));
  }
  if (official.sourceText && official.sourceText !== official.resolvedText) {
    const source = node('details', null, 'shared-source-text');
    source.append(node('summary', '查看官方原始字串'));
    source.append(node('p', official.sourceText));
    block.append(source);
  }
  parent.append(block);
}
function renderErrata(parent, rows) {
  if (!rows?.length) return;
  const block = detailBlock('獨立勘誤');
  for (const row of rows) {
    const article = node('article', null, 'shared-erratum');
    article.append(node('p', row.text));
    if (row.context?.description) article.append(node('p', row.context.description, 'shared-muted'));
    block.append(article);
  }
  parent.append(block);
}
function renderTerms(parent, result) {
  if (!result.terms?.length && !result.termRules?.length) return;
  const block = detailBlock('術語');
  const seen = new Set();
  for (const term of result.terms ?? []) {
    const key = `${term.termRef?.recordId ?? ''}\u0000${term.contextKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = node('p');
    row.append(node('strong', `${term.label}：`), document.createTextNode(term.definition));
    block.append(row);
  }
  for (const rule of result.termRules ?? []) {
    if (typeof rule.text === 'string' && rule.text.trim()) block.append(node('p', rule.text));
  }
  parent.append(block);
}
function renderUnavailable(main, result) {
  const section = node('section', null, 'shared-failure');
  section.setAttribute('role', 'status');
  section.append(node('h1', '目前無法顯示這筆共享資料'));
  section.append(node('p', result?.statusText ?? '目前無法確認這份同版資料。'));
  main.append(section);
}
function labelText(value, fallback) { return typeof value === 'string' && value.trim() ? value : fallback; }
function renderSearch(parent, query) {
  const label = node('label', '搜尋繁體中文名稱', 'shared-search-label');
  const input = node('input');
  input.id = 'shared-search'; input.type = 'search'; input.name = 'q'; input.value = query;
  input.autocomplete = 'off'; input.setAttribute('aria-label', '搜尋繁體中文名稱');
  label.append(input);
  parent.append(label);
  return input;
}
function syncSharedSearchQuery(input) {
  const url = new URL(window.location.href);
  const query = input.value.trim();
  if (query) url.searchParams.set('q', query);
  else url.searchParams.delete('q');
  const path = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (path !== current) window.history.replaceState(null, '', path);
}
function displayRef(ref) { return ref?.recordId; }
function getPresentations(domain, kind) {
  return (domain?.web?.presentations ?? []).filter(row => row?.locale === 'zh-TW' && row.entityRef?.kind === kind);
}
const SKILL_ARCHETYPE_LABELS = Object.freeze({
  veteran: '老兵', zealot: '狂信徒', psyker: '靈能者', ogryn: '歐格林', arbites: '法務官',
  scum: '巢都渣滓', skitarii: '護教軍',
});

export function skillArchetypeFromId(id) {
  if (typeof id !== 'string') return null;
  return /^([a-z0-9_-]+)\/[a-z0-9_-]+$/u.exec(id)?.[1]
    ?? /^darktide:skill:([a-z0-9_-]+):[a-z0-9_-]+$/u.exec(id)?.[1]
    ?? null;
}

const CURRENT_SKILL_ID_BY_LEGACY_ID = Object.freeze({
  'psyker/psyker_brain_burst_improved': 'darktide:skill:psyker:brain-burst-improved',
});

export function currentSkillIdForLegacyId(id) {
  return typeof id === 'string' && Object.hasOwn(CURRENT_SKILL_ID_BY_LEGACY_ID, id)
    ? CURRENT_SKILL_ID_BY_LEGACY_ID[id]
    : null;
}

export function historySkillSearchRows(projection, catalog) {
  if (projection?.gameVersion !== '1.13.1' || !Array.isArray(projection.entries) || !Array.isArray(catalog?.entries)) return [];
  return projection.entries.filter(entry => entry?.kind === 'skill').map(entry => {
    const archetype = skillArchetypeFromId(entry.id);
    const catalogEntry = catalog.entries.find(row => row?.kind === 'skill' && row.id === entry.id);
    if (!archetype || typeof entry.name !== 'string' || !catalogEntry || typeof catalogEntry.route !== 'string') return null;
    return {
      archetype,
      id: entry.id,
      legacyId: entry.id,
      currentId: currentSkillIdForLegacyId(entry.id),
      name: catalogEntry.name_zh_tw ?? entry.name,
      category: typeof entry.category === 'string' ? entry.category : '',
      summary: typeof entry.summary === 'string' ? entry.summary : '',
      searchText: [entry.name, entry.id, entry.category, entry.summary].filter(Boolean).join(' '),
      href: catalogEntry.route,
      source: 'legacy',
    };
  }).filter(Boolean);
}

export function combineSkillSearchRows(currentRows, historyRows) {
  const historyByCurrentId = new Map();
  for (const historyRow of historyRows) {
    if (historyRow.currentId) historyByCurrentId.set(historyRow.currentId, historyRow);
  }
  const consumedHistoryIds = new Set();
  const rows = currentRows.map(currentRow => {
    const historyRow = historyByCurrentId.get(currentRow.id);
    if (!historyRow) return currentRow;
    consumedHistoryIds.add(historyRow.id);
    return {
      ...currentRow,
      legacyId: historyRow.id,
      searchText: [currentRow.searchText, historyRow.searchText].filter(Boolean).join(' '),
      source: 'current-and-legacy',
    };
  });
  for (const historyRow of historyRows) {
    if (!consumedHistoryIds.has(historyRow.id)) rows.push(historyRow);
  }
  return rows;
}

export function filterSkillSearchRows(rows, { query = '', archetype = '' } = {}) {
  const normalizedQuery = String(query).trim().toLocaleLowerCase('zh-Hant-TW');
  return rows.filter(row => (!archetype || row.archetype === archetype)
    && (!normalizedQuery || row.searchText.toLocaleLowerCase('zh-Hant-TW').includes(normalizedQuery)));
}

function normalizeSkillDescription(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(/\r\n?/gu, '\n')
    .split('\n').map(line => line.trimEnd()).join('\n').trim();
}

export function shouldRenderSkillMechanics(effect, mechanics) {
  const normalizedMechanics = normalizeSkillDescription(mechanics);
  return Boolean(normalizedMechanics) && normalizedMechanics !== normalizeSkillDescription(effect);
}

function renderHome(main, result) {
  setMetadata('首頁', '依各頁標示的遊戲版本與修訂，查閱技能、武器與祝福資料。', new URL(location.href));
  const hero = node('section', null, 'shared-hero');
  hero.append(node('p', '依版本查閱 · 繁體中文', 'eyebrow'));
  hero.append(node('h1', '查閱技能、武器與祝福資料'));
  hero.append(node('p', '各項資料依頁面標示的遊戲版本與修訂呈現；1.13.1 留存內容尚未逐項核對目前版本。', 'shared-lead'));
  const links = node('div', null, 'shared-home-links');
  for (const [href, label] of [['/skills/', '查閱技能'], ['/weapons/', '瀏覽武器'], ['/blessings/', '瀏覽祝福'], ['/game-changes/', '查看遊戲更新紀錄'], ['/announcements/', '閱讀公告']]) links.append(link(href, label, 'button-link'));
  hero.append(links);
  main.append(hero);
  const note = node('p', `遊戲版本 ${result.pointer.game_version} · 資料修訂 ${result.pointer.data_revision.slice(0, 12)}`, 'version-line');
  main.append(note);
}
function renderSkillPage(main, result, url, historyPackage = null, historyError = null, historyLoading = false, currentError = null) {
  const currentReady = result?.status === 'ready';
  const domain = result?.domains?.find(row => row.kind === 'skills');
  const presentations = currentReady ? getPresentations(domain, 'skill') : [];
  const id = url.searchParams.get('id');
  if (id) {
    const presentation = presentations.find(row => displayRef(row.entityRef) === id);
    const view = presentation && result.view.getSkill(presentation.entityRef);
    if (!view || view.status !== 'ready') {
      setMetadata('技能資料未能確認', '目前無法確認此技能的同版繁體中文資料。', url);
      return renderUnavailable(main, view ?? { statusText: currentError
        ? '目前版本技能資料未能載入，請稍後重試。'
        : '目前無法確認此技能的同版繁體中文資料。' });
    }
    setMetadata(view.name, view.official.resolvedText, url);
    const header = node('header', null, 'page-intro');
    header.append(node('p', '技能／天賦', 'eyebrow'), node('h1', view.name));
    main.append(link('/skills/', '返回技能清單', 'secondary-link'), header);
    renderOfficial(main, view.official);
    renderErrata(main, view.errata);
    renderSections(main, view.sections);
    renderTerms(main, view);
    return;
  }
  const historyRows = historySkillSearchRows(historyPackage?.projection, historyPackage?.catalog);
  const currentRows = presentations.flatMap(presentation => {
    const view = result.view.getSkill(presentation.entityRef);
    if (view.status !== 'ready') return [];
    const skillId = displayRef(presentation.entityRef);
    return [{
      archetype: skillArchetypeFromId(skillId),
      id: skillId,
      name: view.name,
      category: '',
      summary: view.official.resolvedText,
      searchText: [view.name, skillId, view.official.resolvedText].filter(Boolean).join(' '),
      href: paramsUrl('/skills/', { id: skillId }),
      source: 'current',
    }];
  });
  const rows = combineSkillSearchRows(currentRows, historyRows);
  setMetadata('技能與天賦', '查閱已核對的目前版本技能與留存的技能資料。', url);
  const header = node('header', null, 'page-intro');
  header.append(node('p', '技能／天賦', 'eyebrow'), node('h1', '技能與天賦'));
  main.append(header);
  const versionNote = node('p',
    '技能搜尋以已驗證的 1.13.1 索引與原詳情為基準；已逐項核對的目前版本項目合併並優先顯示。',
    'shared-skill-version-note');
  versionNote.setAttribute('role', 'note');
  main.append(versionNote);
  if (historyError) {
    const unavailable = node('p', '1.13.1 技能索引或詳情目錄未能驗證；目前可用的技能仍可搜尋。', 'shared-skill-history-unavailable');
    unavailable.setAttribute('role', 'status');
    main.append(unavailable);
  } else if (historyLoading) {
    const loading = node('p', '正在驗證既有技能索引與詳情目錄…', 'shared-skill-history-loading');
    loading.setAttribute('role', 'status');
    main.append(loading);
  }
  if (currentError) {
    const unavailable = node('p', '目前版本技能資料未能載入；已驗證的既有技能仍可搜尋。', 'shared-skill-current-unavailable');
    unavailable.setAttribute('role', 'status');
    main.append(unavailable);
  }

  const treeMetadata = historyPackage?.catalog?.talent_trees;
  if (Array.isArray(treeMetadata) && treeMetadata.length > 0) {
    const treeLinks = node('nav', null, 'shared-talent-tree-links');
    treeLinks.setAttribute('aria-label', '職業天賦樹');
    treeLinks.append(node('h2', '瀏覽職業天賦樹'));
    for (const metadata of treeMetadata) {
      const archetype = metadata?.archetype;
      if (typeof archetype !== 'string' || archetype.length === 0) continue;
      const label = SKILL_ARCHETYPE_LABELS[archetype] ?? `職業：${archetype}`;
      treeLinks.append(link(`/skills/${encodeURIComponent(archetype)}/?view=tree`, `${label}天賦樹`, 'button-link'));
    }
    main.append(treeLinks);
  } else if (historyPackage?.catalog && !historyError && !historyLoading) {
    const unavailable = node('p', '這份已驗證的技能目錄沒有可用的職業天賦樹資料。', 'shared-talent-tree-unavailable');
    unavailable.setAttribute('role', 'status');
    main.append(unavailable);
  }

  const filters = node('form', null, 'shared-skill-filters');
  filters.method = 'get';
  filters.action = '/skills/';
  const searchLabel = node('label', '搜尋技能名稱或摘要', 'shared-search-label');
  const input = node('input');
  input.id = 'shared-skill-query'; input.name = 'q'; input.type = 'search';
  input.value = url.searchParams.get('q') ?? ''; input.autocomplete = 'off';
  input.setAttribute('aria-label', '搜尋技能名稱或摘要');
  searchLabel.append(input);

  const archetypeLabel = node('label', '職業', 'shared-skill-filter-label');
  const archetypeSelect = node('select');
  archetypeSelect.id = 'shared-skill-archetype'; archetypeSelect.name = 'archetype';
  archetypeSelect.setAttribute('aria-label', '職業');
  const requestedArchetype = url.searchParams.get('archetype') ?? '';
  const allArchetypes = [...new Set(rows.map(row => row.archetype).filter(Boolean))].sort();
  const archetypeOptions = [['', '全部職業'], ...allArchetypes.map(archetype => [archetype, SKILL_ARCHETYPE_LABELS[archetype] ?? `職業：${archetype}`])];
  for (const [value, label] of archetypeOptions) {
    const option = node('option', label); option.value = value;
    if (value === requestedArchetype) option.selected = true;
    archetypeSelect.append(option);
  }
  archetypeLabel.append(archetypeSelect);
  const submit = node('button', '搜尋', 'shared-skill-search-submit');
  submit.type = 'submit';
  filters.append(searchLabel, archetypeLabel, submit);
  main.append(filters);

  const list = node('ul', null, 'shared-entry-list');
  const listItems = rows.map(row => {
    const item = node('li', null, 'shared-entry');
    item.dataset.archetype = row.archetype ?? '';
    item.dataset.skillId = row.id;
    item.dataset.searchText = row.searchText.toLocaleLowerCase('zh-Hant-TW');
    item.append(link(row.href, row.name));
    if (row.category) item.append(node('p', row.category, 'shared-muted'));
    if (row.summary) {
      const summary = row.source === 'legacy' ? `1.13.1 留存摘要：${row.summary}` : row.summary;
      item.append(node('p', summary, 'shared-muted'));
    }
    list.append(item);
    return { row, item };
  });
  main.append(list);
  const count = node('p', '', 'shared-skill-result-count');
  count.setAttribute('role', 'status');
  main.insertBefore(count, list);
  const applyFilters = () => {
    const matches = filterSkillSearchRows(rows, {
      query: input.value,
      archetype: archetypeSelect.value,
    });
    const matchSet = new Set(matches);
    for (const { row, item } of listItems) item.hidden = !matchSet.has(row);
    count.textContent = `找到 ${matches.length} 項技能`;
  };
  const updateUrl = push => {
    const next = new URL(window.location.href);
    next.searchParams.delete('version');
    const values = { q: input.value.trim(), archetype: archetypeSelect.value };
    for (const [key, value] of Object.entries(values)) {
      if (value) next.searchParams.set(key, value);
      else next.searchParams.delete(key);
    }
    const nextPath = `${next.pathname}${next.search}${next.hash}`;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextPath !== currentPath) {
      if (push) history.pushState(null, '', nextPath);
      else history.replaceState(null, '', nextPath);
    }
    applyFilters();
  };
  input.addEventListener('input', () => updateUrl(false));
  archetypeSelect.addEventListener('change', () => updateUrl(true));
  filters.addEventListener('submit', event => { event.preventDefault(); updateUrl(true); });
  applyFilters();
}
const RETAINED_GAME_VERSION = '1.13.1';
const RETAINED_STATIC_REVISION = '0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b';
function retainedSummaryIndex(historyPackage) {
  const projection = historyPackage?.projection;
  if (projection?.gameVersion !== RETAINED_GAME_VERSION || !Array.isArray(projection.entries)) return new Map();
  return new Map(projection.entries
    .filter(entry => ['blessing', 'variant'].includes(entry?.kind)
      && typeof entry.id === 'string' && typeof entry.summary === 'string' && entry.summary.trim())
    .map(entry => [`${entry.kind}\u0000${entry.id}`, entry.summary]));
}
function appendRetainedSummary(parent, summaryIndex, kind, id, label = '摘要：', parentSummary = null) {
  const summary = summaryIndex.get(`${kind}\u0000${id}`);
  if (summary && summary !== parentSummary) parent.append(node('p', `${label}${summary}`, 'shared-history-summary'));
  return summary ?? null;
}
const BESPOKE_RETAINED_VARIANT_ID = /^weapon_trait_bespoke_(.+)_p([1-9]\d*)_(.+)$/u;
const BESPOKE_CURRENT_BLESSING_ID = /^darktide:blessing:(.+):p([1-9]\d*)-(.+)$/u;

export function currentBlessingIdForRetainedVariantId(variantId) {
  if (typeof variantId !== 'string') return null;
  const match = BESPOKE_RETAINED_VARIANT_ID.exec(variantId);
  if (!match) return null;
  const [, family, tier, suffix] = match;
  return `darktide:blessing:${family}:p${tier}-${suffix.replaceAll('_', '-')}`;
}

function retainedVariantIdForCurrentBlessingId(currentId) {
  if (typeof currentId !== 'string') return null;
  const match = BESPOKE_CURRENT_BLESSING_ID.exec(currentId);
  if (!match) return null;
  const [, family, tier, suffix] = match;
  return `weapon_trait_bespoke_${family}_p${tier}_${suffix.replaceAll('-', '_')}`;
}

export function retainedBlessingIdForCurrentId(currentId, catalog) {
  const variantId = retainedVariantIdForCurrentBlessingId(currentId);
  if (!variantId || !Array.isArray(catalog?.entries)) return null;
  const blessingIds = new Set(catalog.entries
    .filter(entry => entry?.kind === 'blessing' && typeof entry.id === 'string')
    .map(entry => entry.id));
  const matches = new Set();
  for (const entry of catalog.entries) {
    if (entry?.kind !== 'variant' || entry.id !== variantId || typeof entry.route !== 'string') continue;
    const retainedBlessingId = /^\/blessings\/([^/]+)\/variants\//u.exec(entry.route)?.[1];
    if (retainedBlessingId && blessingIds.has(retainedBlessingId)) matches.add(retainedBlessingId);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function retainedName(entry) {
  return typeof entry?.name_zh_tw === 'string' && entry.name_zh_tw.trim()
    ? entry.name_zh_tw : `名稱待確認（${entry?.id ?? '未知 ID'}）`;
}

function retainedNote(kind, historyPackage, historyError, historyLoading) {
  const section = node('section', null, 'shared-history-catalog');
  section.dataset.retainedGameVersion = RETAINED_GAME_VERSION;
  if (historyPackage?.catalog) {
    section.dataset.catalogRevision = historyPackage.catalog.data_revision ?? RETAINED_STATIC_REVISION;
    const counts = historyPackage.catalog.counts;
    const description = kind === 'weapons'
      ? `目錄合併目前已驗證項目與 1.13.1 留存資料：共 ${counts.weapons} 個留存武器家族、${counts.marks} 個型號。缺少繁中名稱的項目仍以識別碼顯示；部分武器的數值資料尚未整理，留存資料也未逐項核對目前版本。`
      : `目錄合併目前已驗證項目與 1.13.1 留存資料：共 ${counts.blessings} 個留存祝福、${counts.variants} 個變體。各變體連到其詳情，等級與適用關係按各項資料基準標示；不代表已逐項核對目前版本。`;
    section.append(node('p', description, 'shared-history-note'));
  } else if (historyLoading) {
    section.append(node('p', '目前版本目錄已載入；正在讀取 1.13.1 留存目錄與詳情索引。', 'shared-skill-history-loading'));
  } else {
    section.append(node('p', historyError
      ? '1.13.1 留存目錄目前無法讀取；此處只顯示目前版本已驗證資料。'
      : '尚無可用的 1.13.1 留存目錄。', 'shared-skill-history-unavailable'));
  }
  return section;
}

function entrySearchText(entry, extra = []) {
  return [entry?.name_zh_tw, entry?.id, ...extra].filter(value => typeof value === 'string').join(' ').toLocaleLowerCase('zh-Hant-TW');
}

function retainedFamilies(catalog) {
  return (catalog?.entries ?? []).filter(entry => entry.kind === 'weapon');
}

function retainedMarksByFamily(catalog) {
  const groups = new Map();
  for (const entry of catalog?.entries ?? []) {
    if (entry.kind !== 'mark') continue;
    const familyId = /^\/weapons\/([^/]+)\/marks\//u.exec(entry.route)?.[1];
    if (!familyId) continue;
    const rows = groups.get(familyId) ?? [];
    rows.push(entry);
    groups.set(familyId, rows);
  }
  return groups;
}

export function countUnifiedWeaponMarks(currentTemplateKeys, retainedMarks) {
  const identities = new Set();
  for (const key of Array.isArray(currentTemplateKeys) ? currentTemplateKeys : []) {
    if (typeof key === 'string' && key.trim()) identities.add(key);
  }
  for (const mark of Array.isArray(retainedMarks) ? retainedMarks : []) {
    if (typeof mark?.id === 'string' && mark.id.trim()) identities.add(mark.id);
  }
  return identities.size;
}

export function currentWeaponMarkIdentities(familyRecords, currentMarks) {
  const templateKeysByMark = new Map();
  for (const record of Array.isArray(familyRecords) ? familyRecords : []) {
    const markId = record?.payload?.markId;
    const templateKey = record?.payload?.templateKey;
    if (typeof markId !== 'string' || !markId.trim()
        || typeof templateKey !== 'string' || !templateKey.trim()) continue;
    const keys = templateKeysByMark.get(markId) ?? new Set();
    keys.add(templateKey);
    templateKeysByMark.set(markId, keys);
  }
  const marks = Array.isArray(currentMarks) ? currentMarks : [];
  const uniqueTemplateKeys = new Map();
  const candidateKeys = marks.map(mark => {
    const markId = mark?.markId;
    if (typeof markId !== 'string' || !markId.trim()) return null;
    const keys = templateKeysByMark.get(markId);
    if (!keys || keys.size !== 1) return null;
    const [key] = keys;
    uniqueTemplateKeys.set(key, (uniqueTemplateKeys.get(key) ?? 0) + 1);
    return key;
  });
  return marks.map((mark, index) => {
    const markId = mark?.markId;
    if (typeof markId !== 'string' || !markId.trim()) return null;
    const key = candidateKeys[index];
    return key && uniqueTemplateKeys.get(key) === 1 ? key : markId;
  }).filter(Boolean);
}

function currentNativeMarkIndexByFamily(records, result) {
  const groups = new Map();
  const split = result?.domains?.some(domain => domain.kind === 'weapons-index');
  for (const record of records) {
    const templateKey = record.payload?.templateKey;
    const familyId = record.payload?.familyId;
    const ready = split
      ? result?.view?.getWeaponListFamily(familyId)?.marks?.some(mark => mark.markId === record.payload?.markId)
      : result?.view?.getWeapon({ familyId, markId: record.payload?.markId })?.status === 'ready';
    if (typeof templateKey !== 'string' || typeof familyId !== 'string'
        || !ready) continue;
    const rows = groups.get(familyId) ?? new Map();
    rows.set(templateKey, { familyId, markId: record.payload.markId });
    groups.set(familyId, rows);
  }
  return groups;
}

function renderHistoryWeaponLinks(parent, familyEntry, marks, currentMarksByTemplate = null) {
  const linkList = node('ul', null, 'shared-history-links');
  for (const mark of marks) {
    const currentMark = currentMarksByTemplate?.get(mark.id);
    const item = node('li', null, 'shared-history-mark-row');
    item.dataset.retainedMarkId = mark.id;
    item.append(link(currentMark
      ? paramsUrl('/weapons/', { family: currentMark.familyId, mark: currentMark.markId })
      : mark.route, retainedName(mark), currentMark ? 'shared-current-identity-link' : 'shared-history-link'));
    item.append(node('small', currentMark
      ? '名稱資料基準 1.13.1；已按相同武器識別對應目前型號。'
      : '資料基準 1.13.1 · 未逐項核對目前版本。', 'shared-history-basis'));
    linkList.append(item);
  }
  if (familyEntry) {
    const item = node('li', null, 'shared-history-family-detail');
    item.dataset.retainedFamilyDetailId = familyEntry.id;
    item.append(link(familyEntry.route, `查看 1.13.1 留存詳情：${retainedName(familyEntry)}`, 'shared-history-link'));
    linkList.prepend(item);
  }
  parent.append(linkList);
}

function retainedRelationsStatus(text, state) {
  const status = node('p', text, 'shared-history-note shared-retained-relations-status');
  status.dataset.state = state;
  status.setAttribute('role', 'status');
  return status;
}

function renderRetainedWeaponDetail(main, catalog, familyId, currentMarksByTemplate, retainedDetail = null,
  { historyError = null, historyLoading = false } = {}) {
  if (!catalog?.entries) {
    if (!historyLoading && !historyError) return;
    const section = node('section', null, 'shared-retained-weapon-detail');
    section.id = 'retained-weapon-relations';
    section.append(node('h2', '1.13.1 留存資料'));
    section.append(retainedRelationsStatus(historyLoading
      ? '正在載入 1.13.1 留存型號與祝福關聯；目前版本資料可先使用。'
      : '目前無法載入 1.13.1 留存關聯；目前版本資料可先使用，請稍後重試。',
    historyLoading ? 'loading' : 'error'));
    main.append(section);
    return;
  }
  const familyEntry = catalog?.entries.find(entry => entry.kind === 'weapon' && entry.id === familyId);
  const section = node('section', null, 'shared-retained-weapon-detail');
  section.id = 'retained-weapon-relations';
  if (!familyEntry) {
    section.append(node('h2', '1.13.1 留存資料'));
    section.append(node('p', '未找到相同武器識別的留存家族；沒有依相似名稱配對 1.13.1 資料。', 'shared-history-note'));
    main.append(section);
    return;
  }
  section.append(node('h2', '同家族已留存的型號與詳情'));
  section.append(node('p', '目前詳情優先顯示已驗證的來源資料；下列留存型號以 1.13.1 為基準，未逐項核對目前版本。', 'shared-history-note'));
  const marks = retainedMarksByFamily(catalog).get(familyId) ?? [];
  renderHistoryWeaponLinks(section, familyEntry, marks, currentMarksByTemplate);
  if (historyLoading && !retainedDetail) {
    section.append(retainedRelationsStatus('正在載入這個家族的 1.13.1 祝福關聯。', 'loading'));
  } else if (historyError && !retainedDetail) {
    section.append(retainedRelationsStatus('1.13.1 留存詳情未能載入；上方目前型號與已驗證資料仍可使用，請稍後重試。', 'error'));
  } else if (!retainedDetail) {
    section.append(retainedRelationsStatus('目前沒有可用的 1.13.1 家族詳情。', 'unavailable'));
  }
  const blessings = [...new Map((retainedDetail?.relations ?? [])
    .filter(relation => relation.kind === 'blessing')
    .map(relation => [relation.id, relation])).values()];
  if (blessings.length) {
    const list = node('ul', null, 'shared-history-links shared-retained-weapon-blessings');
    for (const blessing of blessings) {
      const item = node('li', null, 'shared-history-blessing-relation');
      item.dataset.retainedBlessingId = blessing.id;
      item.append(link(blessing.route, retainedName({ id: blessing.id, name_zh_tw: blessing.name_zh_tw }), 'shared-history-link'));
      item.append(node('small', '適用關係資料基準 1.13.1 · 未逐項核對目前版本。', 'shared-history-basis'));
      list.append(item);
    }
    section.append(node('h3', `1.13.1 留存的祝福關聯（${blessings.length}）`), list);
  } else if (retainedDetail) {
    section.append(node('p', '此 1.13.1 留存詳情沒有列出可顯示的祝福關聯。', 'shared-history-note'));
  }
  main.append(section);
}

function renderRetainedBlessingIdentity(main, historyPackage, retainedDetail, blessingId) {
  const catalog = historyPackage?.catalog;
  const entry = catalog?.entries.find(row => row.kind === 'blessing' && row.id === blessingId);
  if (!entry) return;
  const section = node('section', null, 'shared-retained-blessing-detail');
  section.append(node('h2', '同一祝福的留存資料'));
  section.append(node('p', '下列資料基準為 1.13.1，未逐項核對目前版本；請依目前頁面優先使用已驗證的同版來源。', 'shared-history-note'));
  section.append(link(entry.route, `1.13.1「${retainedName(entry)}」完整詳情、舊版適用關係與等級`, 'shared-history-link'));
  const variants = catalog.entries.filter(row => row.kind === 'variant'
    && row.route.startsWith(`${entry.route}variants/`));
  if (variants.length) {
    const list = node('ul', null, 'shared-history-variants');
    for (const variant of variants) {
      const item = node('li', null, 'shared-history-variant-row');
      item.dataset.retainedVariantId = variant.id;
      item.append(link(variant.route, retainedName(variant), 'shared-history-link'));
      list.append(item);
    }
    section.append(node('p', `${variants.length} 個 1.13.1 變體詳情`, 'shared-muted'), list);
  }
  if (retainedDetail?.relations?.length) {
    const weapons = retainedDetail.relations.filter(row => row.kind === 'weapon');
    if (weapons.length) {
      const list = node('ul', null, 'shared-history-links');
      for (const weapon of weapons) {
        const item = node('li', null, 'shared-history-weapon-link');
        item.append(link(weapon.route, retainedName({ id: weapon.id, name_zh_tw: weapon.name_zh_tw }), 'shared-history-link'));
        list.append(item);
      }
      section.append(node('h3', '1.13.1 適用武器資料'), list);
    }
  }
  main.append(section);
}

function renderBlessingHistory(main, result, url, historyPackage, historyError, historyLoading, currentItems) {
  const section = retainedNote('blessings', historyPackage, historyError, historyLoading);
  const list = main.querySelector('.shared-entry-list');
  if (!historyPackage?.catalog) { main.insertBefore(section, list); return; }
  const catalog = historyPackage.catalog;
  const summaryIndex = retainedSummaryIndex(historyPackage);
  const blessings = catalog.entries.filter(entry => entry.kind === 'blessing');
  const variants = catalog.entries.filter(entry => entry.kind === 'variant');
  const variantsByBlessing = new Map();
  for (const entry of variants) {
    const blessingId = /^\/blessings\/([^/]+)\/variants\//u.exec(entry.route)?.[1];
    if (!blessingId) continue;
    const rows = variantsByBlessing.get(blessingId) ?? [];
    rows.push(entry);
    variantsByBlessing.set(blessingId, rows);
  }
  const mappedRetainedIds = new Set();
  for (const presentation of currentItems) {
    const currentId = displayRef(presentation.entityRef);
    const retainedId = retainedBlessingIdForCurrentId(currentId, catalog);
    if (!retainedId || mappedRetainedIds.has(retainedId)) continue;
    const oldEntry = blessings.find(entry => entry.id === retainedId);
    if (!oldEntry) continue;
    mappedRetainedIds.add(retainedId);
    const item = [...main.querySelectorAll('.shared-current-blessing[data-current-blessing-id]')]
      .find(row => row.dataset.currentBlessingId === currentId && !row.dataset.retainedBlessingId);
    if (!item) continue;
    item.dataset.retainedBlessingId = retainedId;
    const related = variantsByBlessing.get(oldEntry.id) ?? [];
    item.dataset.searchName = entrySearchText({ name_zh_tw: oldEntry.name_zh_tw, id: currentId }, [oldEntry.id,
      ...related.flatMap(row => [row.name_zh_tw, row.id])]);
    const alias = node('p', null, 'shared-history-alias');
    alias.append(link(oldEntry.route, `資料基準 1.13.1 · ${retainedName(oldEntry)} 詳情、舊版適用關係與等級`, 'shared-history-link'));
    item.append(alias);
    const parentSummary = appendRetainedSummary(item, summaryIndex, 'blessing', oldEntry.id, '1.13.1 留存摘要：');
    appendRetainedVariants(item, related, summaryIndex, parentSummary);
  }
  for (const entry of blessings) {
    if (mappedRetainedIds.has(entry.id)) continue;
    const item = node('li', null, 'shared-entry shared-history-blessing');
    const related = variantsByBlessing.get(entry.id) ?? [];
    item.dataset.retainedBlessingId = entry.id;
    item.dataset.searchName = entrySearchText(entry, related.flatMap(row => [row.name_zh_tw, row.id]));
    item.append(link(entry.route, retainedName(entry), 'shared-history-link'));
    item.append(node('small', '資料基準 1.13.1 · 未逐項核對目前版本', 'shared-history-basis'));
    const parentSummary = appendRetainedSummary(item, summaryIndex, 'blessing', entry.id);
    appendRetainedVariants(item, related, summaryIndex, parentSummary);
    list.append(item);
  }
  main.insertBefore(section, list);
}

function appendRetainedVariants(parent, variants, summaryIndex, parentSummary = null) {
  if (!variants.length) return;
  const list = node('ul', null, 'shared-history-variants');
  for (const variant of variants) {
    const variantItem = node('li', null, 'shared-history-variant-row');
    variantItem.dataset.retainedVariantId = variant.id;
    variantItem.dataset.searchName = entrySearchText(variant);
    variantItem.append(link(variant.route, `變體詳情：${retainedName(variant)}`, 'shared-history-link'));
    appendRetainedSummary(variantItem, summaryIndex, 'variant', variant.id, '摘要：', parentSummary);
    list.append(variantItem);
  }
  parent.append(node('small', `${variants.length} 個 1.13.1 變體／等級詳情`, 'shared-muted'), list);
}

function renderBlessingPage(main, result, url, historyPackage = null, historyError = null, historyLoading = false, retainedBlessingDetail = null) {
  const domain = result?.status === 'ready'
    ? result.domains.find(row => row.kind === 'blessings-index') ?? result.domains.find(row => row.kind === 'blessings')
    : null;
  const presentations = getPresentations(domain, 'blessing');
  const id = url.searchParams.get('id');
  if (!id) {
    setMetadata('祝福', '查閱已驗證的繁體中文祝福、變體與各等級資料。', url);
    const header = node('header', null, 'page-intro');
    header.append(node('p', '祝福', 'eyebrow'), node('h1', '祝福'));
    main.append(header);
    const input = renderSearch(main, url.searchParams.get('q') ?? '');
    const list = node('ul', null, 'shared-entry-list');
    const currentItems = [...presentations];
    const presentedIds = new Set(presentations.map(row => displayRef(row.entityRef)));
    for (const presentation of presentations) {
      for (const applicability of presentation.tierApplicability ?? []) {
        const variantRef = applicability.variantRef;
        const tier = blessingListTier(applicability);
        if (!variantRef || !Number.isInteger(tier)) continue;
        const view = result?.status === 'ready'
          ? domain.kind === 'blessings-index'
            ? result.view.getBlessingListItem({ blessingRef: presentation.entityRef, variantRef, tier })
            : result.view.getBlessing({ blessingRef: presentation.entityRef, variantRef, tier })
          : null;
        if (view?.status !== 'ready') continue;
        const item = node('li', null, 'shared-entry shared-current-blessing'); item.dataset.searchName = entrySearchText({ name_zh_tw: view.name, id: presentation.entityRef.recordId });
        item.dataset.currentBlessingId = presentation.entityRef.recordId;
        item.append(link(paramsUrl('/blessings/', { id: presentation.entityRef.recordId, variant: variantRef.recordId, tier }), `${view.name} · LV${tier}`));
        item.append(node('p', view.official.resolvedText, 'shared-muted'));
        list.append(item);
      }
    }
    const currentRecords = domain?.source.records.filter(row => row.kind === 'blessing'
      && row.gameReleaseId === result.manifest.gameReleaseId) ?? [];
    for (const record of currentRecords) {
      if (presentedIds.has(record.recordId)) continue;
      const item = node('li', null, 'shared-entry shared-current-blessing shared-current-blessing-unknown');
      item.dataset.currentBlessingId = record.recordId;
      item.dataset.searchName = entrySearchText({ name_zh_tw: null, id: record.recordId });
      item.append(node('strong', retainedName({ id: record.recordId }), 'shared-unverified-name'));
      item.append(node('p', '目前來源尚未提供可核實的繁中名稱、適用武器或等級詳情。', 'shared-muted'));
      list.append(item);
      currentItems.push({ entityRef: { recordId: record.recordId, kind: 'blessing' } });
    }
    main.append(list);
    const applySearch = () => {
      syncSharedSearchQuery(input);
      const query = input.value.trim().toLocaleLowerCase('zh-Hant-TW');
      for (const row of main.querySelectorAll('.shared-entry[data-search-name]')) {
        const directMatch = row.dataset.searchName.toLocaleLowerCase('zh-Hant-TW').includes(query);
        if (row.classList.contains('shared-history-blessing')) {
          const variantRows = [...row.querySelectorAll('.shared-history-variant-row')];
          const variantMatch = variantRows.some(variant => variant.dataset.searchName.toLocaleLowerCase('zh-Hant-TW').includes(query));
          row.hidden = !(directMatch || variantMatch);
          for (const variant of variantRows) variant.hidden = !variant.dataset.searchName.toLocaleLowerCase('zh-Hant-TW').includes(query);
        } else row.hidden = !directMatch;
      }
    };
    renderBlessingHistory(main, result, url, historyPackage, historyError, historyLoading, currentItems);
    input.addEventListener('input', applySearch);
    applySearch();
    return;
  }
  const presentation = presentations.find(row => displayRef(row.entityRef) === id);
  const variantId = url.searchParams.get('variant');
  const applicability = presentation?.tierApplicability?.find(row => row.variantRef?.recordId === variantId)
    ?? (variantId ? null : presentation?.tierApplicability?.[0]);
  const tiers = applicability?.tiers ?? [];
  const hasTierQuery = url.searchParams.has('tier');
  const tierParam = url.searchParams.get('tier');
  const requestedTier = /^[1-4]$/u.test(tierParam ?? '') ? Number(tierParam) : null;
  const tier = hasTierQuery
    ? (tiers.includes(requestedTier) ? requestedTier : null)
    : (tiers.includes(4) ? 4 : tiers[0]);
  const view = presentation && applicability && Number.isInteger(tier)
    ? result.view.getBlessing({ blessingRef: presentation.entityRef, variantRef: applicability.variantRef, tier }) : null;
  if (!view || view.status !== 'ready') {
    setMetadata('祝福資料未能確認', '目前無法確認此祝福的同版繁體中文變體或等級。', url);
    return renderUnavailable(main, view);
  }
  const blessingCanonicalUrl = new URL(url.href);
  blessingCanonicalUrl.searchParams.set('variant', applicability.variantRef.recordId);
  blessingCanonicalUrl.searchParams.set('tier', String(tier));
  setMetadata(view.name, view.official.resolvedText, blessingCanonicalUrl);
  const header = node('header', null, 'page-intro');
  header.append(node('p', '祝福', 'eyebrow'), node('h1', view.name));
  main.append(link('/blessings/', '返回祝福清單', 'secondary-link'), header);
  if (presentation.tierApplicability.length > 1) {
    const variantNav = node('nav', null, 'shared-tab-list'); variantNav.setAttribute('aria-label', '祝福變體');
    for (const row of presentation.tierApplicability) {
      const rowTier = row.tiers?.includes(4) ? 4 : row.tiers?.[0];
      const anchor = link(paramsUrl('/blessings/', { id, variant: row.variantRef.recordId, tier: rowTier }), `變體 ${variantNav.children.length + 1}`);
      if (row.variantRef.recordId === applicability.variantRef.recordId) anchor.setAttribute('aria-current', 'page');
      variantNav.append(anchor);
    }
    main.append(variantNav);
  }
  const tierGroup = node('nav', null, 'shared-tab-list'); tierGroup.setAttribute('aria-label', '祝福等級');
  for (const option of tiers) {
    const anchor = link(paramsUrl('/blessings/', { id, variant: applicability.variantRef.recordId, tier: option }), `LV${option}`);
    if (option === tier) anchor.setAttribute('aria-current', 'page');
    tierGroup.append(anchor);
  }
  main.append(tierGroup);
  renderOfficial(main, view.official);
  renderErrata(main, view.errata);
  renderSections(main, view.sections);
  renderTerms(main, view);
  const applicabilityText = view.applicability?.status === 'verified'
    ? '目前已驗證所選武器適用關係。'
    : '適用武器尚未驗證；此頁只顯示已確認的祝福與等級資料。';
  main.append(node('p', applicabilityText, 'shared-applicability'));
  if (view.obtainableTiers?.status !== 'known') main.append(node('p', '此等級是否可取得尚未確認。', 'shared-muted'));
  renderRetainedBlessingIdentity(main, historyPackage, retainedBlessingDetail,
    retainedBlessingIdForCurrentId(id, historyPackage?.catalog));
}
function sourceDecimal(value) {
  if (!value || value.status !== 'known' || typeof value.decimal !== 'string') return '來源數值未確認';
  return `${value.decimal}${sourceUnit(value.unit)}`;
}
function sourceUnit(unit) {
  if (typeof unit !== 'string' || !unit) return '';
  return UNIT_LABELS[unit] ? ` ${UNIT_LABELS[unit]}` : '（來源單位未提供繁中標籤）';
}
function sourceInputLabel(value) {
  if (typeof value !== 'string') return null;
  return INPUT_LABELS[value.split('.')[0]] ?? null;
}
function armorClassKey(property) {
  return typeof property === 'string' ? property.match(/\[armor_types\.([a-z_]+)\]/u)?.[1] ?? null : null;
}
function sourceArmorClassNode(classKey) {
  const label = node('span', null, 'shared-source-armor-class');
  label.append(document.createTextNode('來源護甲類別 '), node('code', classKey), document.createTextNode('（尚無已確認顯示名）'));
  return label;
}
function sourceTokenNode(label, value, className) {
  if (typeof value !== 'string' || !value) return null;
  const wrapper = node('span');
  wrapper.append(document.createTextNode(`${label} `), node('code', value, className));
  return wrapper;
}
function sourcePropertyLocationNode(property) {
  if (typeof property !== 'string' || !property) return null;
  const details = node('details', null, 'shared-source-location');
  details.append(node('summary', '來源定位'), node('code', property, 'shared-source-property-key'));
  return details;
}
function sourceActionRouteNode(fromAction, toAction) {
  if (typeof fromAction !== 'string' || typeof toAction !== 'string') return node('span', '來源動作路徑未完整提供');
  const route = node('span', null, 'shared-action-route');
  route.append(document.createTextNode('來源動作 '), node('code', fromAction, 'shared-action-from'),
    document.createTextNode(' → '), node('code', toAction, 'shared-action-to'));
  return route;
}
function sourceInputNode(inputKey) {
  const label = sourceInputLabel(inputKey) ?? '來源輸入';
  const wrapper = node('span');
  wrapper.append(document.createTextNode(`${label} `));
  if (typeof inputKey === 'string') wrapper.append(node('code', inputKey, 'shared-action-input'));
  return wrapper;
}
function appendLabelParts(parent, parts) {
  parts.filter(part => part !== null && part !== undefined && part !== '').forEach((part, index) => {
    if (index) parent.append(document.createTextNode(' · '));
    parent.append(typeof part === 'string' ? document.createTextNode(part) : part);
  });
}
function localizedSourceProperty(property) {
  if (typeof property !== 'string') return '來源數值';
  if (property.includes('armor_damage_modifier')) return '護甲傷害修正';
  if (property.includes('chainaxe_sawing_stat')) return '鏈鋸階段攻擊威力';
  if (property.includes('power_distribution.attack')) return '攻擊威力';
  const normalized = property.replace(/\[[^\]]*\]/gu, '').split('.').filter(Boolean).join('.');
  return SOURCE_PROPERTY_LABELS[normalized] ?? SOURCE_PROPERTY_LABELS[normalized.split('.').at(-1)] ?? '來源數值';
}
function sourceClaimLabelParts(claim, index) {
  const payload = claim.payload ?? {};
  const context = payload.context ?? {};
  const parts = [];
  if (context.attackMode === 'light') parts.push('輕攻擊');
  else if (context.attackMode === 'heavy') parts.push('重攻擊');
  const armor = armorClassKey(payload.property);
  if (armor) parts.push(sourceArmorClassNode(armor));
  if (typeof context.profile === 'string') parts.push(sourceTokenNode('來源傷害設定', context.profile, 'shared-source-profile-key'));
  if (SOURCE_STAT_LABELS[context.weaponStat]) parts.push(SOURCE_STAT_LABELS[context.weaponStat]);
  const comparison = context.comparisonStat;
  if (comparison?.status === 'known' && typeof comparison.decimal === 'string') parts.push(`面板比較點 ${comparison.decimal}%`);
  parts.push(localizedSourceProperty(payload.property));
  if (typeof payload.property === 'string') parts.push(sourcePropertyLocationNode(payload.property));
  return parts.length ? parts : [`來源數值 ${index + 1}`];
}
function renderSourceConditions(rows, ranged = false) {
  if (!Array.isArray(rows) || !rows.length) return '未記載額外來源條件';
  return rows.map(condition => {
    const key = typeof condition?.fieldPath === 'string' ? condition.fieldPath.split('.').at(-1) : '';
    const value = typeof condition?.rawValue === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(condition.rawValue)
      ? condition.rawValue : null;
    if (value !== null && key === 'chain_time') return `${ranged ? '動作銜接時間' : '連段時間'} ${value} 秒`;
    if (value !== null && key === 'chain_until') return `${ranged ? '動作銜接窗口' : '連段窗口'} ${value} 秒`;
    if (value !== null) return `其他來源條件值 ${value}`;
    return '另有來源條件（原始值不作程式解讀）';
  }).join('；');
}
function rangeText(range, type = 'range') {
  if (!range || range.status === 'unknown') return type === 'obtainable' ? '來源未提供實際可取得範圍' : '來源範圍未知';
  if (range.status === 'not-applicable') return '來源未列此範圍';
  if (range.status !== 'known' || typeof range.min !== 'string' || typeof range.max !== 'string') return '來源範圍未確認';
  return `${range.min} 至 ${range.max}${sourceUnit(range.unit)}`;
}
function decodedSourceRowValue(rawValue) {
  if (typeof rawValue !== 'string') return rawValue;
  if (rawValue.startsWith('"')) {
    try {
      const value = JSON.parse(rawValue);
      if (typeof value === 'string') return value;
    } catch { /* Keep source text literal; never evaluate it. */ }
  }
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  return rawValue;
}
function rangedSourceRowDisplay(row) {
  const fieldPath = row?.sourceLocator?.fieldPath;
  if (typeof fieldPath !== 'string' || typeof row.rawValue !== 'string') return null;
  const value = decodedSourceRowValue(row.rawValue);
  const number = typeof value === 'number' || (typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(value))
    ? String(value) : null;
  const mode = fieldPath.includes('.action_shoot_hip.') ? '腰射' : fieldPath.includes('.action_shoot_zoomed.') ? '機瞄' : null;
  const property = fieldPath.split('.').at(-1);
  if (fieldPath.startsWith('weapon_template.displayed_attacks.') && property === 'fire_mode') {
    return { label: '射擊模式', text: value === 'semi_auto' ? '半自動' : null, value: String(value) };
  }
  if (fieldPath.startsWith('weapon_template.displayed_attacks.') && property === 'type') {
    const labels = { hipfire: '腰射', ads: '機瞄', flashlight: '手電筒' };
    return { label: fieldPath.includes('.special.') ? '特殊動作' : '射擊姿勢', text: labels[value] ?? null, value: String(value) };
  }
  if (mode && property === 'ammunition_usage' && number !== null) {
    return { label: `${mode}每次射擊消耗`, text: `${number} 彈藥單位`, value: number };
  }
  if (mode && property === 'allow_shots_with_less_than_required_ammo' && typeof value === 'boolean') {
    return { label: `${mode}彈藥不足需求量時仍允許射擊`, text: value ? '是' : '否', value: String(value) };
  }
  if (mode && property === 'total_time' && number !== null) {
    return { label: `${mode}動作總時長`, text: `${number} 秒`, value: number };
  }
  if (mode && property === 'chain_time' && number !== null) {
    return { label: `${mode}動作銜接時間`, text: `${number} 秒`, value: number };
  }
  if (property === 'activation_time' && number !== null) {
    return { label: '特殊動作啟動時間', text: `${number} 秒`, value: number };
  }
  if (/^hitscan_templates\.[A-Za-z0-9_]+\.range$/u.test(fieldPath) && number !== null) {
    return { label: '命中掃描範圍', text: `${number}（來源未提供單位）`, value: number };
  }
  const labels = { kind: '動作種類', start_input: '動作輸入', primary_action: '主要攻擊動作', secondary_action: '次要攻擊動作',
    weapon_handling_template: '武器處理模板', ammo_template: '彈藥模板', flashlight_template: '手電筒模板' };
  const enumLabels = { shoot_hit_scan: '命中掃描射擊', immediate_single_shot: '單次即時射擊', shoot_pressed: '射擊輸入',
    zoom_shoot: '機瞄射擊輸入', weapon_special: '特殊動作輸入', action_shoot_hip: '腰射動作',
    action_shoot_zoomed: '機瞄動作', action_toggle_flashlight: '切換手電筒動作' };
  return { label: labels[property] ?? '來源欄位', text: enumLabels[value] ?? null, value: String(value) };
}
function renderRangedSourceRows(parent, view) {
  if (!(view.attackProfiles ?? []).some(profile => ['hipfire', 'ads'].includes(profile.payload?.mode))) return;
  const rows = (view.source.sourceRows ?? []).map(row => ({ row, display: rangedSourceRowDisplay(row) })).filter(item => item.display);
  if (!rows.length) return;
  const section = node('section', null, 'shared-ranged-source-rows');
  section.append(node('h3', '射擊、彈藥與動作來源欄位'));
  const list = node('ul', null, 'shared-detail-list');
  for (const { row, display } of rows) {
    const item = node('li', null, 'shared-ranged-source-row');
    item.append(document.createTextNode(`${display.label}：`));
    if (display.text !== null) item.append(document.createTextNode(display.text));
    else item.append(node('code', display.value, 'shared-source-row-value'));
    const locator = row.sourceLocator?.fieldPath;
    if (typeof locator === 'string') item.append(document.createTextNode(' · '), node('code', locator, 'shared-source-property-key'));
    list.append(item);
  }
  section.append(list);
  parent.append(section);
}
function renderWeaponSourceDetails(parent, view) {
  const hasRangedProfile = (view.attackProfiles ?? []).some(profile => ['hipfire', 'ads'].includes(profile.payload?.mode));
  const block = node('details', null, 'shared-card shared-expandable shared-source-details');
  block.append(node('summary', hasRangedProfile ? '其他來源數值、素質語意與射擊條件' : '其他來源數值、素質語意與連段條件'));
  const tables = view.source.statTables ?? [];
  if (tables.length) {
    const section = node('section', null, 'shared-source-tables');
    section.append(node('h3', '武器素質來源表'));
    for (const [tableIndex, table] of tables.entries()) {
      const article = node('section', null, 'shared-source-table');
      const tableLabel = SOURCE_STAT_LABELS[table.statKey] ?? `其他素質 ${tableIndex + 1}`;
      const heading = node('h4');
      appendLabelParts(heading, [tableLabel,
        sourceTokenNode('素質代碼', table.statKey, 'shared-source-table-stat-key'),
        sourceTokenNode('來源表', table.tableKey, 'shared-source-table-key')]);
      article.append(heading);
      const list = node('ul', null, 'shared-detail-list');
      for (const property of table.properties ?? []) {
        const values = (property.orderedValues ?? []).map(value => {
          const decimal = typeof value.decimal === 'string' ? value.decimal : null;
          if (!decimal) return null;
          if (value.key === 'lerp_basic') return `基礎模板端點 ${decimal}`;
          if (value.key === 'lerp_perfect') return `完美模板端點 ${decimal}`;
          return `來源值 ${value.key} ${decimal}`;
        }).filter(Boolean);
        if (!values.length) continue;
        const item = node('li', null, 'shared-source-table-property');
        const armor = armorClassKey(property.property);
        const parts = armor ? [sourceArmorClassNode(armor)] : [];
        parts.push(sourceTokenNode('來源欄位', property.property, 'shared-source-property-key'));
        const hasTemplateEndpoints = (property.orderedValues ?? []).some(value => value.key === 'lerp_basic' || value.key === 'lerp_perfect');
        const qualifier = hasTemplateEndpoints ? '（模板端點不代表實際可取得範圍）' : '';
        parts.push(`${localizedSourceProperty(property.property)}${qualifier}：${values.join('；')}${sourceUnit(property.unit)}`);
        appendLabelParts(item, parts);
        list.append(item);
      }
      if (list.children.length) article.append(list);
      section.append(article);
    }
    block.append(section);
  }
  const definitions = view.source.statDefinitions ?? [];
  if (definitions.length) {
    const section = node('section', null, 'shared-source-stat-definitions');
    section.append(node('h3', '來源素質定義與曲線'));
    for (const { definition, curve, curveSourceRefs = [] } of definitions) {
      const payload = definition.payload ?? {};
      const article = node('article', null, 'shared-source-stat-definition');
      const isRawAttackPowerDistribution = isRawAttackPowerDistributionDefinition(definition, curve, curveSourceRefs);
      article.append(node('h4', isRawAttackPowerDistribution
        ? '來源攻擊威力分布（非最終傷害）'
        : SOURCE_STAT_LABELS[payload.quantity] ?? '來源素質'));
      if (payload.quantity) article.append(node('p', `來源欄位：${payload.quantity}`, 'shared-source-field'));
      if (isRawAttackPowerDistribution) {
        article.append(node('p', '以下是原始程式碼的攻擊威力曲線端點，不是武器面板數值或最終傷害；遊戲實際輸入與可取得範圍尚未確認。', 'shared-muted'));
      }
      if (payload.theoreticalInputRange) article.append(node('p', `理論輸入範圍：${rangeText(payload.theoreticalInputRange, 'theoretical')}。`));
      if (payload.obtainableInputRange) article.append(node('p', `實際可取得範圍：${rangeText(payload.obtainableInputRange, 'obtainable')}。`, 'shared-muted'));
      for (const knot of curve?.payload?.knots ?? []) {
        article.append(node('p', `來源曲線節點：輸入 ${knot.input}${sourceUnit(curve.payload.inputUnit)}，輸出 ${knot.output}${sourceUnit(curve.payload.outputUnit)}。`));
        const locator = knot.sourceLocator;
        if (locator?.path && locator?.line && locator?.fieldPath) {
          article.append(node('p', `原始來源：${locator.path}:${locator.line} · ${locator.fieldPath}`, 'shared-muted'));
        }
      }
      const curveSourcePaths = new Set((curve?.payload?.knots ?? []).map(knot => knot.sourceLocator?.path).filter(Boolean));
      for (const sourceRef of curveSourceRefs.filter(ref => curveSourcePaths.has(ref.path))) {
        if (sourceRef.repository && sourceRef.commit) article.append(node('p', `來源固定版本：${sourceRef.repository}@${sourceRef.commit}`, 'shared-muted'));
      }
      section.append(article);
    }
    block.append(section);
  }
  const semantics = view.source.statTableSemantics ?? [];
  if (semantics.length) {
    const section = node('section', null, 'shared-source-semantics');
    section.append(node('h3', '來源素質語意與範圍'));
    let index = 0;
    for (const row of semantics) {
      const title = SOURCE_STAT_LABELS[row.statKey] ?? `素質語意 ${index + 1}`;
      for (const binding of row.bindings ?? []) {
        const item = node('article', null, 'shared-source-semantic');
        const quantity = QUANTITY_LABELS[binding.quantityKind];
        const heading = node('h4');
        appendLabelParts(heading, [title, quantity,
          sourceTokenNode('素質代碼', row.statKey, 'shared-source-semantic-stat-key'),
          sourceTokenNode('來源群組', row.groupKey, 'shared-source-semantic-group-key'),
          sourceTokenNode('來源欄位', binding.property, 'shared-source-semantic-property-key'),
          sourceTokenNode('量類代碼', binding.quantityKind, 'shared-source-semantic-quantity')]);
        item.append(heading);
        item.append(node('p', `理論輸入範圍：${rangeText(binding.theoreticalInputRange, 'theoretical')}。`));
        item.append(node('p', `實際可取得範圍：${rangeText(binding.obtainableInputRange, 'obtainable')}。`, 'shared-muted'));
        section.append(item);
        index += 1;
      }
    }
    block.append(section);
  }
  renderRangedSourceRows(block, view);
  const missingRows = view.source.dataCoverage?.missing ?? [];
  if (missingRows.length) {
    const section = node('section', null, 'shared-source-coverage');
    section.append(node('h3', '來源涵蓋與未匯入欄位'));
    const list = node('ul', null, 'shared-detail-list');
    for (const row of missingRows) {
      const item = node('li', null, 'shared-source-coverage-row');
      item.append(document.createTextNode(row.reasonCode === 'NOT_IMPORTED' ? '來源明示未匯入' : '來源欄位未完整提供'));
      if (typeof row.field === 'string') item.append(document.createTextNode(' · '), node('code', row.field));
      list.append(item);
    }
    section.append(list);
    block.append(section);
  }
  const displayedAttacks = view.source.displayedAttacks ?? [];
  if (displayedAttacks.length) {
    const section = node('section', null, 'shared-displayed-attacks');
    section.append(node('h3', '遊戲顯示的攻擊段'));
    const list = node('ul', null, 'shared-detail-list');
    for (const attack of displayedAttacks) {
      const mode = attack.mode === 'light' ? '輕攻擊' : attack.mode === 'heavy' ? '重攻擊' : null;
      for (const segment of attack.segments ?? []) {
        const role = TARGET_ROLE_LABELS[segment.targetRole] ?? '來源用途未有繁中標籤';
        const item = node('li', null, 'shared-displayed-attack-segment');
        item.append(document.createTextNode(`${mode ?? '來源攻擊'}第 ${segment.index} 段：${role}`));
        if (typeof segment.attackType === 'string') item.append(document.createTextNode(' · 來源攻擊類型 '), node('code', segment.attackType));
        list.append(item);
      }
    }
    section.append(list);
    block.append(section);
  }
  const continuations = view.source.actionContinuations ?? [];
  if (continuations.length) {
    const section = node('section', null, 'shared-source-continuations');
    section.append(node('h3', hasRangedProfile ? '來源動作銜接與條件' : '來源連段與條件'));
    const list = node('ul', null, 'shared-detail-list');
    for (const row of continuations) {
      const item = node('li', null, 'shared-action-continuation');
      appendLabelParts(item, [sourceActionRouteNode(row.fromAction, row.toAction), sourceInputNode(row.inputKey), renderSourceConditions(row.conditions, hasRangedProfile)]);
      list.append(item);
    }
    section.append(list);
    block.append(section);
  }
  const profiles = view.attackProfiles ?? [];
  if (profiles.length) {
    const section = node('section', null, 'shared-source-profiles');
    section.append(node('h3', '來源攻擊設定與條件'));
    for (const profile of profiles) {
      const resolution = profile.payload?.actionResolution ?? {};
      const article = node('article', null, 'shared-source-profile');
      const mode = ATTACK_MODE_LABELS[profile.payload?.mode] ?? '來源攻擊設定';
      const heading = node('h4');
      appendLabelParts(heading, [mode,
        sourceTokenNode('攻擊設定', profile.recordId, 'shared-attack-profile-key'),
        sourceTokenNode('動作', profile.payload?.action, 'shared-attack-action')]);
      article.append(heading);
      const entries = resolution.entryBindings ?? [];
      for (const entry of entries) {
        const item = node('p', null, 'shared-attack-profile-binding shared-attack-profile-entry');
        appendLabelParts(item, [sourceActionRouteNode(entry.fromAction, entry.toAction), sourceInputNode(entry.inputKey), renderSourceConditions(entry.conditions, hasRangedProfile)]);
        article.append(item);
      }
      const branches = resolution.branchBindings ?? [];
      for (const branch of branches) {
        const label = BRANCH_LABELS[branch.branch] ?? '來源分支';
        const item = node('p', null, 'shared-attack-profile-binding shared-attack-profile-branch');
        appendLabelParts(item, [label,
          sourceTokenNode('分支', branch.branch, 'shared-branch-key'),
          sourceTokenNode('來源值', branch.rawValue, 'shared-branch-value'),
          sourceTokenNode('對應傷害設定', branch.profileRef?.recordId, 'shared-branch-profile-ref'),
          '保留來源對應，不執行程式邏輯']);
        article.append(item);
      }
      for (const binding of resolution.inputBindings ?? []) {
        const input = sourceInputLabel(binding.inputKey);
        if (input) article.append(node('p', `入口接續：${input}`, 'shared-attack-input'));
      }
      const runtimeConditions = resolution.runtimeConditions ?? [];
      for (const condition of runtimeConditions) {
        article.append(node('p', `來源條件（未執行判定）：${renderSourceConditions([condition], hasRangedProfile)}`, 'shared-attack-runtime-condition'));
      }
      section.append(article);
    }
    block.append(section);
  }
  parent.append(block);
}
function renderWeapon(main, result, view, familyMarks, url, showRetainedRelationsLink = false, unresolvedMarkIds = []) {
  const hasRangedProfile = (view.attackProfiles ?? []).some(profile => ['hipfire', 'ads'].includes(profile.payload?.mode));
  const weaponCanonicalUrl = new URL(url.href);
  weaponCanonicalUrl.searchParams.set('family', view.familyId);
  weaponCanonicalUrl.searchParams.set('mark', view.markId);
  setMetadata(view.name, view.note ?? '已驗證的武器素質與連段資料。', weaponCanonicalUrl);
  const header = node('header', null, 'page-intro');
  header.append(node('p', '武器', 'eyebrow'), node('h1', view.name), node('p', view.markLabel, 'shared-muted'));
  main.append(link('/weapons/', '返回武器清單', 'secondary-link'), header);
  const tabs = node('nav', null, 'shared-tab-list'); tabs.setAttribute('aria-label', '武器型號');
  for (const mark of familyMarks) {
    const anchor = link(paramsUrl('/weapons/', { family: view.familyId, mark: mark.markId }), mark.markLabel);
    if (mark.markId === view.markId) anchor.setAttribute('aria-current', 'page');
    tabs.append(anchor);
  }
  main.append(tabs);
  if (unresolvedMarkIds.length) {
    const section = node('section', null, 'shared-unresolved-weapon-marks');
    section.append(node('h2', '尚未確認的其他型號'));
    const list = node('ul', null, 'shared-detail-list');
    for (const markId of unresolvedMarkIds) {
      list.append(node('li', `型號 ID ${markId}：尚無已驗證的繁體中文詳情。`));
    }
    section.append(list);
    main.append(section);
  }
  if (showRetainedRelationsLink) {
    main.append(link('#retained-weapon-relations', '查看 1.13.1 留存資料與關聯', 'secondary-link'));
  }
  if (view.official) renderOfficial(main, view.official, weaponNameProvenance(result, view));
  renderSections(main, view.sections);
  renderTerms(main, view);
  if (view.note) main.append(node('p', view.note, 'shared-callout'));
  if (view.nameProvenance) {
    const provenance = detailBlock('名稱來源');
    provenance.append(node('p', `名稱沿用 ${view.nameProvenance.sourceGameVersion} 留存資料，並依相同型號 ID 與模板路徑連結至 ${view.nameProvenance.currentGameVersion} 原始碼；名稱未逐項核對目前版本。`));
    const list = node('dl', null, 'shared-source-list');
    for (const [label, value] of retainedNameProvenanceRows(view.nameProvenance)) {
      list.append(node('dt', label), node('dd', value));
    }
    main.append(provenance, list);
  }
  renderErrata(main, view.errata);
  for (const section of view.statSections) {
    const block = detailBlock(section.label);
    const list = node('dl', null, 'shared-stat-list');
    section.claims.forEach((claim, index) => {
      const value = claim.payload?.displayValue?.status === 'known' ? claim.payload.displayValue : claim.payload?.value;
      const dt = node('dt');
      appendLabelParts(dt, sourceClaimLabelParts(claim, index));
      const dd = node('dd', sourceDecimal(value));
      list.append(dt, dd);
    });
    for (const curve of section.curves) {
      const knots = curve.payload?.knots;
      if (!Array.isArray(knots)) continue;
      for (const [index, knot] of knots.entries()) {
        list.append(node('dt', `來源曲線節點 ${index + 1} · 輸入 ${knot.input}${sourceUnit(curve.payload.inputUnit)}`), node('dd', sourceDecimal({ status: 'known', decimal: knot.output, unit: curve.payload.outputUnit })));
      }
    }
    for (const [index, definition] of section.statDefinitions.entries()) {
      const payload = definition.payload ?? {};
      if (payload.theoreticalInputRange) {
        list.append(node('dt', `理論輸入範圍 ${index + 1}`), node('dd', rangeText(payload.theoreticalInputRange, 'theoretical')));
      }
      if (payload.obtainableInputRange) {
        list.append(node('dt', `實際可取得範圍 ${index + 1}`), node('dd', rangeText(payload.obtainableInputRange, 'obtainable')));
      }
    }
    if (!list.children.length) list.append(node('dt', '來源資料'), node('dd', '目前沒有可顯示的數值。'));
    block.append(list);
    main.append(block);
  }
  const attacks = detailBlock(view.attackHeading ?? '攻擊段');
  let chainCount = 0;
  const chainList = node('ul', null, 'shared-detail-list');
  for (const profile of view.attackProfiles) {
    const entries = profile.payload?.actionResolution?.entryBindings;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const input = sourceInputLabel(entry.inputKey);
      if (!input) continue;
      const condition = (entry.conditions ?? []).map(row => row.fieldPath?.endsWith('chain_time') && /^\d+(?:\.\d+)?$/u.test(row.rawValue)
        ? `${hasRangedProfile ? '動作銜接時間' : '連段時間'} ${row.rawValue} 秒` : null).filter(Boolean).join('、');
      chainList.append(node('li', `${hasRangedProfile ? '動作銜接輸入' : '連段輸入'}：${input}${condition ? `；${condition}` : ''}`));
      chainCount += 1;
    }
  }
  if (!chainCount) chainList.append(node('li', hasRangedProfile
    ? '此版本尚未匯入高階動作解析；下方保留已固定的攻擊模式與來源欄位。'
    : '來源尚未提供可讀的繁體中文連段條件。'));
  attacks.append(chainList);
  main.append(attacks);
  renderWeaponSourceDetails(main, view);
}
function renderWeapons(main, result, url, historyPackage = null, historyError = null, historyLoading = false, retainedWeaponDetail = null) {
  const domain = result?.status === 'ready'
    ? result.domains.find(row => row.kind === 'weapons-index') ?? result.domains.find(row => row.kind === 'weapons')
    : null;
  const records = domain?.source.records.filter(row => row.kind === 'weapon' && row.gameReleaseId === result.manifest.gameReleaseId) ?? [];
  const families = [...new Set(records.map(row => row.payload?.familyId).filter(Boolean))];
  const familyId = url.searchParams.get('family');
  const markId = url.searchParams.get('mark');
  if (url.searchParams.has('family')) {
    const family = result?.status === 'ready' ? result.view.getWeaponFamily(familyId) : null;
    if (family?.status !== 'ready') {
      setMetadata('武器家族資料未能確認', '目前無法確認此武器家族的同版繁體中文資料。', url);
      return renderUnavailable(main, family);
    }
    const view = url.searchParams.has('mark') ? family.marks.find(mark => mark.markId === markId) : family.marks[0];
    if (!view) {
      setMetadata('武器型號未能確認', '目前無法確認此武器型號的同版繁體中文資料。', url);
      return renderUnavailable(main, { statusText: `型號 ID ${markId} 尚無已驗證的繁體中文詳情。` });
    }
    renderWeapon(main, result, view, family.marks, url,
      Boolean(historyLoading || historyError || historyPackage?.catalog), family.unresolvedMarkIds ?? []);
    renderRetainedWeaponDetail(main, historyPackage?.catalog, familyId,
      currentNativeMarkIndexByFamily(records, result).get(familyId), retainedWeaponDetail,
      { historyError, historyLoading });
    return;
  }
  setMetadata('武器', '依武器家族與型號查閱素質、來源表與動作資料。', url);
  const header = node('header', null, 'page-intro');
  header.append(node('p', '武器', 'eyebrow'), node('h1', '武器'));
  main.append(header);
  const input = renderSearch(main, url.searchParams.get('q') ?? '');
  const list = node('ul', null, 'shared-entry-list');
  const currentNativeMarkIndex = currentNativeMarkIndexByFamily(records, result);
  const oldCatalog = historyPackage?.catalog;
  const oldFamilies = retainedFamilies(oldCatalog);
  const oldFamilyById = new Map(oldFamilies.map(entry => [entry.id, entry]));
  const oldMarksByFamily = retainedMarksByFamily(oldCatalog);
  for (const family of families) {
    const view = domain.kind === 'weapons-index'
      ? result.view.getWeaponListFamily(family)
      : result.view.getWeaponFamily(family);
    const familyRecords = records.filter(record => record.payload?.familyId === family);
    const firstRecord = familyRecords[0];
    if (!firstRecord) continue;
    const currentPresentation = domain.web.presentations.find(row => row?.locale === 'zh-TW'
      && row?.entityRef?.kind === 'weapon' && row.entityRef.recordId === firstRecord.recordId);
    const retainedFamily = oldFamilyById.get(family);
    const retainedMarks = oldMarksByFamily.get(family) ?? [];
    const currentReady = view.status === 'ready';
    const currentName = currentReady ? view.marks[0].name : currentPresentation?.name;
    const unresolvedMarkIds = currentReady ? view.unresolvedMarkIds ?? [] : [];
    const currentMarkNames = currentReady
      ? [...view.marks.map(mark => mark.name), ...unresolvedMarkIds]
      : familyRecords.map(record => record.payload?.markId);
    const item = node('li', null, 'shared-entry shared-weapon-family'); item.dataset.searchName = entrySearchText({ name_zh_tw: currentName, id: family }, [
      ...currentMarkNames, retainedFamily?.name_zh_tw, ...retainedMarks.flatMap(mark => [mark.name_zh_tw, mark.id]),
    ]);
    item.dataset.currentFamilyId = family;
    if (retainedFamily) item.dataset.retainedWeaponId = retainedFamily.id;
    if (currentReady) {
      const first = view.marks[0];
      const currentMarkIdentities = currentWeaponMarkIdentities(familyRecords, [
        ...view.marks,
        ...unresolvedMarkIds.map(markId => ({ markId })),
      ]);
      const markCount = countUnifiedWeaponMarks(currentMarkIdentities, retainedMarks);
      item.append(link(paramsUrl('/weapons/', { family, mark: first.markId }), `${first.name} · ${markCount} 個型號`));
      item.append(node('p', retainedFamily
        ? '此家族的目前版與 1.13.1 識別相同；型號依已核對的武器識別對應。'
        : '依武器家族選取型號，查看目前版本已驗證的素質、來源表與動作資料。', 'shared-muted'));
      if (unresolvedMarkIds.length) {
        item.append(node('p', `尚無已驗證詳情的型號 ID：${unresolvedMarkIds.join('、')}`, 'shared-muted'));
      }
    } else {
      item.append(node('strong', retainedName({ id: family, name_zh_tw: currentName }), 'shared-current-weapon-name'));
      item.append(node('p', '目前版本已收錄此武器識別，但尚無可顯示的已驗證詳情。', 'shared-muted'));
    }
    if (retainedFamily) {
      renderHistoryWeaponLinks(item, retainedFamily, retainedMarks, currentNativeMarkIndex.get(family));
    }
    list.append(item);
  }
  main.append(list);
  if (oldCatalog) {
    const section = retainedNote('weapons', historyPackage, historyError, historyLoading);
    const oldOnly = oldFamilies.filter(entry => !families.includes(entry.id));
    for (const entry of oldOnly) {
      const item = node('li', null, 'shared-entry shared-weapon-family shared-retained-weapon');
      const marks = oldMarksByFamily.get(entry.id) ?? [];
      item.dataset.retainedWeaponId = entry.id;
      item.dataset.searchName = entrySearchText(entry, marks.flatMap(mark => [mark.name_zh_tw, mark.id]));
      item.append(link(entry.route, retainedName(entry), 'shared-history-link'));
      const markCount = countUnifiedWeaponMarks([], marks);
      item.append(node('small', `資料基準 1.13.1 · 未逐項核對目前版本 · ${markCount} 個留存型號`, 'shared-history-basis'));
      renderHistoryWeaponLinks(item, null, marks);
      list.append(item);
    }
    main.insertBefore(section, list);
  } else {
    main.insertBefore(retainedNote('weapons', historyPackage, historyError, historyLoading), list);
  }
  const applySearch = () => {
    syncSharedSearchQuery(input);
    const query = input.value.trim().toLocaleLowerCase('zh-Hant-TW');
    for (const row of main.querySelectorAll('.shared-entry[data-search-name]')) {
      row.hidden = !row.dataset.searchName.toLocaleLowerCase('zh-Hant-TW').includes(query);
    }
  };
  input.addEventListener('input', applySearch);
  applySearch();
}

function gameChangeType(item) {
  const kind = item?.displayEntityRef?.kind;
  if (['skill', 'blessing', 'weapon'].includes(kind)) return kind;
  return typeof item?.entityKindLabel === 'string' && item.entityKindLabel.trim() ? 'other' : null;
}

const DECIMAL_VALUE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
function formatGameChangeValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '未提供可比較值';
  if (value.status === 'unknown') return '尚未確認';
  if (value.status === 'not-applicable') return '不適用';
  if (value.status !== 'known') return '數值格式未能確認';
  const unitLabel = GAME_CHANGE_UNIT_LABELS[value.unit];
  if (!unitLabel) return '單位未能確認';
  const formatDecimal = decimal => `${decimal}${unitLabel === '%' ? '%' : ''}`;
  const suffix = unitLabel === '%' ? '' : ` ${unitLabel}`;
  if (typeof value.decimal === 'string' && DECIMAL_VALUE.test(value.decimal)) {
    return `${formatDecimal(value.decimal)}${suffix}`;
  }
  if (typeof value.min === 'string' && DECIMAL_VALUE.test(value.min)
      && typeof value.max === 'string' && DECIMAL_VALUE.test(value.max)
      && value.inclusive && typeof value.inclusive.min === 'boolean'
      && typeof value.inclusive.max === 'boolean'
      && typeof value.step === 'string' && DECIMAL_VALUE.test(value.step)) {
    const min = formatDecimal(value.min);
    const max = formatDecimal(value.max);
    const step = formatDecimal(value.step);
    const interval = `${value.inclusive.min ? '含下限' : '不含下限'}、${value.inclusive.max ? '含上限' : '不含上限'}`;
    return `${min}–${max}${suffix}（${interval}；步進 ${step}）`;
  }
  return '數值格式未能確認';
}

function formatGameChangeSide(field, side) {
  const wording = field?.valueKind === 'modifier-rule-reference' ? field?.[side + 'Rule'] : null;
  return typeof wording === 'string' && wording.trim() ? wording : formatGameChangeValue(field?.[side]);
}

export { formatGameChangeSide, formatGameChangeValue };

function renderChangeComparison(parent, comparison) {
  const details = node('details', null, 'shared-card shared-change-comparison');
  details.append(node('summary', '比較版本與來源身分'));
  const list = node('dl', null, 'shared-change-identities');
  const pairs = [
    ['前版遊戲版本', comparison.fromGameVersion], ['前版遊戲 build', comparison.fromGameBuild],
    ['前版 snapshot', comparison.fromSnapshotId], ['前版 commit', comparison.fromSnapshotCommit],
    ['後版遊戲版本', comparison.toGameVersion], ['後版遊戲 build', comparison.toGameBuild],
    ['後版 snapshot', comparison.toSnapshotId], ['後版 commit', comparison.toSnapshotCommit],
  ];
  for (const [label, value] of pairs) {
    if (typeof value !== 'string' || !value.trim()) continue;
    list.append(node('dt', label), node('dd', value, 'shared-change-identity-value'));
  }
  details.append(list);
  parent.append(details);
}

function renderChangeEvidence(parent, evidence) {
  const block = detailBlock('公開來源證據');
  const rows = Array.isArray(evidence) ? evidence : [];
  if (!rows.length) block.append(node('p', '此筆紀錄沒有可公開連結的來源位置。', 'shared-muted'));
  for (const row of rows) {
    const article = node('article', null, 'shared-change-evidence');
    article.append(node('h3', row.kindLabel ?? '來源證據'));
    const source = row.source;
    if (!source?.publicUrl) {
      article.append(node('p', '來源位置未公開。', 'shared-muted'));
    } else {
      const url = (() => { try { return new URL(source.publicUrl); } catch { return null; } })();
      if (url?.protocol === 'https:' && !url.username && !url.password) {
        const anchor = link(url.href, '開啟公開來源', 'shared-source-link');
        anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
        article.append(anchor);
      } else article.append(node('p', '來源連結未能確認。', 'shared-muted'));
      const metadata = [];
      if (source.repository) metadata.push(['來源儲存庫', source.repository]);
      if (source.path) metadata.push(['來源檔案', source.path]);
      if (source.gameBuild) metadata.push(['來源 build', source.gameBuild]);
      if (source.snapshot?.snapshotId) metadata.push(['來源 snapshot', source.snapshot.snapshotId]);
      if (source.snapshot?.commit ?? source.commit) metadata.push(['來源 commit', source.snapshot?.commit ?? source.commit]);
      if (metadata.length) {
        const list = node('dl', null, 'shared-change-identities');
        for (const [label, value] of metadata) list.append(node('dt', label), node('dd', value, 'shared-change-identity-value'));
        article.append(list);
      }
    }
    block.append(article);
  }
  parent.append(block);
}

function renderChangeFields(parent, item, result) {
  if (item.changeKind === 'official-text') {
    const block = detailBlock('官方原文字串變化');
    const fixedDataHref = sharedChangeIndexHref(result);
    const originLabels = {
      'game-localization': '遊戲本地化資料',
      'official-patch-notes': '官方更新說明',
      'official-ui': '官方介面資料',
    };
    for (const [label, value] of [['前版官方原文', item.officialText?.before], ['後版官方原文', item.officialText?.after]]) {
      if (!value || typeof value.resolvedText !== 'string') continue;
      const row = node('article', null, 'shared-change-value');
      row.append(node('h3', label), node('p', value.resolvedText, 'shared-official-text'));
      const params = Array.isArray(value.params) ? value.params : [];
      if (value.text !== value.resolvedText || params.length) {
        const template = node('details', null, 'shared-official-template');
        template.append(node('summary', '原始字串模板與參數定位'));
        if (typeof value.text === 'string') template.append(node('p', value.text, 'shared-source-template'));
        if (params.length) {
          const parameterList = node('dl', null, 'shared-change-identities');
          for (const parameter of params) {
            parameterList.append(
              node('dt', '參數識別'), node('dd', parameter.parameterId, 'shared-change-identity-value'),
              node('dt', '來源鍵'), node('dd', parameter.sourceKey, 'shared-change-identity-value'),
              node('dt', '固定代入值'), node('dd', parameter.value, 'shared-change-identity-value'),
            );
          }
          template.append(parameterList);
        }
        row.append(template);
      }
      row.append(node('p', `來源識別：${value.officialSourceId}`, 'shared-muted'));
      const identity = value.sourceIdentity ?? {};
      const metadata = node('dl', null, 'shared-change-identities');
      const addMetadata = (caption, text) => {
        if (text === undefined || text === null || text === '') return;
        metadata.append(node('dt', caption), node('dd', String(text), 'shared-change-identity-value'));
      };
      addMetadata('來源類別', originLabels[identity.origin] ?? '官方輸入來源');
      const resourceUrl = safeOfficialResourceUrl(identity.resource);
      metadata.append(node('dt', '來源資源'));
      const resourceValue = node('dd', null, 'shared-change-identity-value');
      if (resourceUrl) {
        const anchor = link(resourceUrl, '開啟固定來源資源', 'shared-source-link');
        anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
        resourceValue.append(anchor);
      } else resourceValue.textContent = identity.resource ?? '未提供';
      metadata.append(resourceValue);
      addMetadata('來源鍵', identity.key === null ? '未使用固定鍵' : identity.key);
      addMetadata('來源 hash', identity.sourceHash);
      addMetadata('來源出現序號', Number.isSafeInteger(identity.occurrence) ? identity.occurrence : null);
      addMetadata('原文字串 SHA-256', identity.sourceTextSha256);
      addMetadata('解析文字 SHA-256', identity.resolvedTextSha256);
      row.append(metadata);
      if (fixedDataHref) {
        const fixedDataLink = link(fixedDataHref, '檢視同版固定共享資料檔', 'shared-source-link');
        fixedDataLink.target = '_blank'; fixedDataLink.rel = 'noopener noreferrer';
        row.append(fixedDataLink);
      }
      block.append(row);
    }
    parent.append(block);
    return;
  }
  const block = detailBlock('變更前後');
  const fields = Array.isArray(item.changedFields) ? item.changedFields : [];
  if (!fields.length) block.append(node('p', '此紀錄沒有可顯示的欄位值。', 'shared-muted'));
  for (const field of fields) {
    const row = node('article', null, 'shared-change-value');
    row.append(node('h3', field.summary));
    const values = node('div', null, 'shared-change-before-after');
    const before = node('p'); before.append(node('strong', '前：'), document.createTextNode(formatGameChangeSide(field, 'before')));
    const after = node('p'); after.append(node('strong', '後：'), document.createTextNode(formatGameChangeSide(field, 'after')));
    values.append(before, after);
    row.append(values);
    if (field.context?.locale === 'zh-TW' && typeof field.context.text === 'string' && field.context.text.trim()) {
      row.append(node('p', field.context.text, 'shared-change-context'));
    }
    block.append(row);
  }
  parent.append(block);
}

function renderCorrectionChain(parent, item) {
  const chain = Array.isArray(item.correctionChain) ? item.correctionChain : [];
  if (!item.supersedesChangeId && !chain.length) return;
  const block = detailBlock('紀錄更正鏈');
  if (chain.length) {
    const list = node('ul', null, 'shared-change-corrections');
    for (const previous of chain) {
      const row = node('li');
      row.append(link(paramsUrl('/game-changes/', { id: previous.changeId }), `前一筆紀錄：${previous.summary}`));
      list.append(row);
    }
    block.append(list);
  } else if (item.supersedesChangeId) {
    block.append(link(paramsUrl('/game-changes/', { id: item.supersedesChangeId }), '查看被更正的前一筆紀錄'));
  }
  parent.append(block);
}

function renderBlessingVariantContext(parent, context) {
  if (!context || !Array.isArray(context.definedTiers) || context.definedTiers.length === 0) return;
  const section = node('section', null, 'shared-change-blessing-variant');
  section.append(node('h2', '祝福變體來源資料'));
  section.append(node('p', `來源定義階級：${context.definedTiers.map(tier => `LV${tier}`).join('、')}`));
  if (context.obtainableTiers?.status === 'known' && Array.isArray(context.obtainableTiers.tiers)) {
    section.append(node('p', `來源列出的可取得階級：${context.obtainableTiers.tiers.map(tier => `LV${tier}`).join('、')}`));
  } else {
    section.append(node('p', '可取得階級尚未確認。', 'shared-muted'));
  }
  if (context.weaponApplicability?.status === 'identified' && Array.isArray(context.weaponApplicability.weapons)) {
    const names = context.weaponApplicability.weapons.map(weapon => weapon.name).filter(value => typeof value === 'string' && value);
    if (names.length) section.append(node('p', `來源列出的適用武器：${names.join('、')}`));
    else section.append(node('p', '適用武器關係尚未確認。', 'shared-muted'));
  } else {
    section.append(node('p', '適用武器關係尚未確認。', 'shared-muted'));
  }
  parent.append(section);
}

function renderGameChangeDetail(main, result, url, item) {
  if (!item) {
    setMetadata('遊戲變動紀錄未能確認', '目前沒有可驗證的繁體中文遊戲變動紀錄。', url);
    return renderUnavailable(main, { statusText: '找不到這筆已確認的遊戲變動紀錄。' });
  }
  setMetadata(item.entityName, `${item.gameVersion} 遊戲內容變動：${item.summary}`, url);
  const header = node('header', null, 'page-intro');
  header.append(node('p', '遊戲版本更新紀錄', 'eyebrow'), node('h1', item.entityName));
  const back = new URL(url); back.searchParams.delete('id');
  main.append(link(back.pathname + back.search, '返回更新紀錄', 'secondary-link'), header);
  main.append(node('p', item.summary, 'shared-change-summary'));
  renderBlessingVariantContext(main, item.blessingVariant);
  const facts = detailBlock('紀錄摘要');
  const category = GAME_CHANGE_TYPE_LABELS[gameChangeType(item)] ?? item.entityKindLabel;
  facts.append(node('p', `類型：${category} · ${item.entityKindLabel}`));
  facts.append(node('p', `遊戲版本：${item.comparison.fromGameVersion} → ${item.comparison.toGameVersion}`));
  facts.append(node('p', `變動類型：${GAME_CHANGE_OPERATION_LABELS[item.operation] ?? '內容變更'}`));
  facts.append(node('p', `驗證方式：${item.verificationLabel ?? '驗證方式未確認'}`));
  facts.append(node('p', `網站資料版本：${result.sourceData ? result.manifest.dataRevision : result.pointer.content_version}`));
  if (result.sourceData) facts.append(node('p', `Source-Data commit：${result.manifest.source.commit}`));
  main.append(facts);
  renderChangeFields(main, item, result);
  renderChangeComparison(main, item.comparison);
  renderChangeEvidence(main, item.evidence);
  renderCorrectionChain(main, item);
}

function compareGameVersions(left, right) {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return b[index] - a[index];
  return 0;
}

export function sourceChangesFilter(url, items) {
  const version = url.searchParams.get('changes_version') ?? '';
  const type = url.searchParams.get('type') ?? '';
  return items.filter(item => (!version || item.gameVersion === version) && (!type || gameChangeType(item) === type));
}

function renderGameChanges(main, result, url) {
  const allItems = result.view.getGameChanges({}).items;
  const id = url.searchParams.get('id');
  if (id !== null) {
    const item = allItems.find(row => row.changeId === id);
    return renderGameChangeDetail(main, result, url, item);
  }

  const versionKey = result.sourceData ? 'changes_version' : 'version';
  const requestedVersion = url.searchParams.get(versionKey) ?? '';
  const requestedType = url.searchParams.get('type') ?? '';
  const versions = [...new Set([result.pointer.game_version, ...allItems.map(row => row.gameVersion)])].sort(compareGameVersions);
  const types = ['skill', 'blessing', 'weapon'];
  if (allItems.some(item => gameChangeType(item) === 'other')) types.push('other');
  if ((requestedVersion && !versions.includes(requestedVersion)) || (requestedType && !types.includes(requestedType))) {
    setMetadata('遊戲更新篩選未能確認', '目前無法確認這個版本或項目類型篩選。', url);
    return renderUnavailable(main, { statusText: '請選擇清單中可用的遊戲版本與項目類型。' });
  }
  setMetadata('遊戲版本更新紀錄', '查閱已確認的官方遊戲內容差異、比較版本與公開來源。', url);
  const header = node('header', null, 'page-intro');
  header.append(node('p', '同版共享資料 · 已確認內容', 'eyebrow'), node('h1', '遊戲版本更新紀錄'));
  main.append(header);
  const form = node('form', null, 'shared-change-filters');
  form.method = 'get'; form.action = '/game-changes/';
  const versionLabel = node('label', '遊戲版本');
  const versionSelect = node('select'); versionSelect.name = versionKey; versionSelect.setAttribute('aria-label', '遊戲版本');
  versionSelect.append(node('option', '全部版本')); versionSelect.options[0].value = '';
  for (const version of versions) {
    const option = node('option', version); option.value = version;
    if (version === requestedVersion) option.selected = true;
    versionSelect.append(option);
  }
  versionLabel.append(versionSelect);
  const typeLabel = node('label', '項目類型');
  const typeSelect = node('select'); typeSelect.name = 'type'; typeSelect.setAttribute('aria-label', '項目類型');
  typeSelect.append(node('option', '全部類型')); typeSelect.options[0].value = '';
  for (const type of types) {
    const option = node('option', GAME_CHANGE_TYPE_LABELS[type]); option.value = type;
    if (type === requestedType) option.selected = true;
    typeSelect.append(option);
  }
  typeLabel.append(typeSelect);
  if (result.sourceData) { const input = node('input'); input.type = 'hidden'; input.name = 'version'; input.value = result.manifest.gameVersion; form.append(input); }
  form.append(versionLabel, typeLabel);
  const submit = node('button', '套用篩選', 'button'); submit.type = 'submit'; form.append(submit);
  main.append(form);

  const filtered = result.sourceData ? sourceChangesFilter(url, allItems) : allItems.filter(item => (!requestedVersion || item.gameVersion === requestedVersion)
    && (!requestedType || gameChangeType(item) === requestedType));
  if (!filtered.length) {
    main.append(node('p', allItems.length || requestedVersion || requestedType
      ? '目前篩選條件下沒有已確認的遊戲變動。' : '本次無新增已確認的遊戲變動。', 'shared-change-empty'));
    return;
  }
  const list = node('ul', null, 'shared-entry-list shared-change-list');
  for (const item of filtered) {
    const entry = node('li', null, 'shared-entry shared-change-entry');
    const href = paramsUrl('/game-changes/', { id: item.changeId, ...(result.sourceData ? { version: result.manifest.gameVersion } : {}), ...(requestedVersion ? { [versionKey]: requestedVersion } : {}), ...(requestedType ? { type: requestedType } : {}) });
    entry.append(link(href, item.entityName));
    entry.append(node('p', `${item.gameVersion} · ${GAME_CHANGE_TYPE_LABELS[gameChangeType(item)] ?? '其他'} · ${item.verificationLabel ?? '驗證方式未確認'}`, 'shared-muted'));
    entry.append(node('p', item.summary));
    list.append(entry);
  }
  main.append(list);
}

function announcementTitle(item) {
  return item.title ?? item.blocks.find(block => block.kind === 'heading')?.text ?? `公告 ${item.publishedOn}`;
}

function renderAnnouncementMetadata(parent, item) {
  const list = node('dl', null, 'shared-announcement-meta');
  const sourceKind = item.source.kind === 'site-owner' ? '網站維護者' : '官方遊戲來源';
  for (const [label, value] of [
    ['發布日期', item.publishedOn],
    ['來源', `${sourceKind} · ${item.source.locator}`],
    ['修訂版本', String(item.revision)],
  ]) {
    const row = node('div');
    const detail = node('dd');
    if (label === '來源') {
      const sourceHref = safeOfficialResourceUrl(item.source.locator);
      detail.append(document.createTextNode(sourceKind + ' · '));
      if (sourceHref) {
        const sourceAnchor = link(sourceHref, item.source.locator);
        sourceAnchor.rel = 'noopener noreferrer';
        detail.append(sourceAnchor);
      } else detail.append(document.createTextNode(item.source.locator));
    } else detail.textContent = value;
    row.append(node('dt', label), detail);
    list.append(row);
  }
  parent.append(list);
}

function appendAnnouncementInline(parent, runs) {
  for (const run of runs) {
    if (run.kind === 'break') {
      parent.append(document.createElement('br'));
      continue;
    }
    if (run.kind === 'text') {
      parent.append(document.createTextNode(run.text));
      continue;
    }
    if (run.kind === 'link') {
      const href = safeAnnouncementResourceUrl(run.href);
      if (!href) throw new Error('validated announcement contains an unsafe inline link');
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.rel = 'noopener noreferrer';
      if (run.children) appendAnnouncementInline(anchor, run.children);
      else anchor.textContent = run.text;
      parent.append(anchor);
      continue;
    }
    const tag = ({ strong: 'strong', emphasis: 'em', code: 'code' })[run.kind];
    if (!tag) throw new Error('announcement renderer received an unsupported inline run');
    const element = document.createElement(tag);
    if (run.children) appendAnnouncementInline(element, run.children);
    else element.textContent = run.text;
    parent.append(element);
  }
}

function renderAnnouncementBlocks(parent, blocks, assets, headingState = { firstHeading: true }) {
  for (const block of blocks) {
    if (block.kind === 'heading') {
      if (headingState.titlePending && block.text === headingState.title) {
        headingState.titlePending = false;
        continue;
      }
      headingState.titlePending = false;
      const headingLevel = headingState.firstHeading ? 1 : Math.min(6, Math.max(2, (block.level ?? 1) + (headingState.hasTitle ? 1 : 0)));
      const heading = node('h' + headingLevel, null, 'shared-announcement-heading');
      if (block.inline) appendAnnouncementInline(heading, block.inline);
      else heading.textContent = block.text;
      headingState.firstHeading = false;
      heading.dataset.blockId = block.blockId;
      parent.append(heading);
    } else if (block.kind === 'paragraph') {
      const paragraph = node('p', null, 'shared-announcement-paragraph');
      if (block.inline) appendAnnouncementInline(paragraph, block.inline);
      else paragraph.textContent = block.text;
      paragraph.dataset.blockId = block.blockId;
      parent.append(paragraph);
    } else if (block.kind === 'link') {
      const href = safeAnnouncementResourceUrl(block.href);
      if (!href) throw new Error('validated announcement contains an unsafe link');
      const anchor = link(href, block.text, 'shared-announcement-link');
      anchor.dataset.blockId = block.blockId;
      anchor.rel = 'noopener noreferrer';
      parent.append(anchor);
    } else if (block.kind === 'list') {
      const list = node(block.ordered ? 'ol' : 'ul', null, 'shared-announcement-items');
      list.dataset.blockId = block.blockId;
      for (const item of block.items) {
        const row = node('li');
        if (item.inline) appendAnnouncementInline(row, item.inline);
        else row.textContent = item.text;
        row.dataset.blockId = item.blockId;
        if (item.children?.length) renderAnnouncementBlocks(row, item.children, assets, headingState);
        list.append(row);
      }
      parent.append(list);
    } else if (block.kind === 'table') {
      const wrapper = node('div', null, 'shared-announcement-table-wrap');
      wrapper.dataset.blockId = block.blockId;
      const table = node('table', null, 'shared-announcement-table');
      const head = node('thead');
      const body = node('tbody');
      for (const [rowIndex, row] of block.rows.entries()) {
        const tableRow = node('tr');
        for (const cell of row.cells) {
          const tableCell = node(row.header ? 'th' : 'td');
          if (row.header) tableCell.scope = 'col';
          if (cell.inline) appendAnnouncementInline(tableCell, cell.inline);
          else tableCell.textContent = cell.text;
          tableCell.dataset.blockId = cell.blockId;
          tableRow.append(tableCell);
        }
        if (row.header && rowIndex === 0) head.append(tableRow);
        else body.append(tableRow);
      }
      if (head.childElementCount) table.append(head);
      table.append(body);
      wrapper.append(table);
      parent.append(wrapper);
    } else if (block.kind === 'quote') {
      const quote = node('blockquote', null, 'shared-announcement-quote');
      quote.dataset.blockId = block.blockId;
      renderAnnouncementBlocks(quote, block.blocks, assets, headingState);
      parent.append(quote);
    } else if (block.kind === 'image') {
      const asset = assets.get(block.assetId);
      if (!asset) throw new Error('validated announcement image lost its asset reference');
      const sourceUri = safeOfficialResourceUrl(asset.sourceUri);
      if (!sourceUri) throw new Error('validated announcement contains an unsafe image URL');
      const figure = node('figure', null, 'shared-announcement-figure');
      figure.dataset.blockId = block.blockId;
      figure.dataset.assetId = asset.assetId;
      const image = node('img');
      image.src = sourceUri;
      image.alt = block.alt;
      image.loading = 'lazy';
      image.decoding = 'async';
      figure.append(image);
      parent.append(figure);
    } else if (block.kind === 'spoiler') {
      const details = node('details', null, 'shared-announcement-spoiler');
      details.dataset.blockId = block.blockId;
      const summary = node('summary', block.label);
      const content = node('div', null, 'shared-announcement-spoiler-content');
      content.id = `announcement-${block.blockId}-content`;
      summary.setAttribute('aria-controls', content.id);
      details.append(summary, content);
      renderAnnouncementBlocks(content, block.blocks, assets, headingState);
      parent.append(details);
    } else {
      throw new Error('announcement renderer received an unsupported block');
    }
  }
}

function renderAnnouncements(main, result, url, buildMeta) {
  const announcementResult = result.view.getAnnouncements();
  const items = announcementResult.status === 'ready' ? announcementResult.items : [];
  if (url.searchParams.has('id')) {
    const id = url.searchParams.get('id');
    const item = result.view.getAnnouncement(id);
    if (!item) {
      setMetadata('公告未能確認', '目前沒有可確認的同版公告。', url);
      main.append(node('h1', '公告未能確認'), node('p', '目前沒有可確認的同版公告。', 'shared-announcement-empty'));
      main.append(link('/announcements/', '返回公告清單', 'secondary-link'));
      return;
    }
    const title = announcementTitle(item);
    setMetadata(title, `${item.publishedOn} · 修訂版本 ${item.revision} · ${item.source.locator}`, url);
    if (item.scope === 'official-document') buildMeta.textContent = `官方公告 · 發布日期 ${item.publishedOn}`;
    main.append(link('/announcements/', '返回公告清單', 'secondary-link'));
    renderAnnouncementMetadata(main, item);
    const article = node('article', null, 'shared-announcement-content');
    article.dataset.announcementId = item.announcementId;
    const assets = new Map(item.assets.map(asset => [asset.assetId, asset]));
    const headingState = item.title
      ? { firstHeading: false, hasTitle: true, title: item.title, titlePending: true }
      : { firstHeading: true, hasTitle: false, title: null, titlePending: false };
    if (item.title) article.append(node('h1', item.title, 'shared-announcement-heading'));
    if (item.scope === 'official-document') article.append(node('p', '官方公告', 'shared-announcement-scope-note'));
    renderAnnouncementBlocks(article, item.blocks, assets, headingState);
    if (!article.querySelector('h1')) article.prepend(node('h1', title, 'shared-announcement-heading'));
    main.append(article);
    return;
  }

  setMetadata('公告', '查閱已驗證的公告、發布日期、來源與修訂資料。', url);
  const header = node('header', null, 'page-intro');
  header.append(node('p', '網站公告', 'eyebrow'), node('h1', '公告'));
  main.append(header);
  if (items.length === 0) {
    main.append(node('p', '目前沒有已確認的公告。', 'shared-announcement-empty'));
    return;
  }
  const list = node('ul', null, 'shared-entry-list shared-announcement-list');
  for (const item of items) {
    const entry = node('li', null, 'shared-entry shared-announcement-entry');
    entry.dataset.announcementId = item.announcementId;
    entry.append(link(paramsUrl('/announcements/', { id: item.announcementId }), announcementTitle(item)));
    entry.append(node('p', `${item.publishedOn} · 修訂版本 ${item.revision}`, 'shared-muted'));
    entry.append(node('p', item.source.locator, 'shared-announcement-source'));
    list.append(entry);
  }
  main.append(list);
}

export function renderSharedPage({ main, buildMeta, result, url = new URL(location.href), error = null,
  historyPackage = null, historyError = null, historyLoading = false, currentError = null, currentLoading = false,
  retainedBlessingDetail = null, retainedWeaponDetail = null } = {}) {
  if (result?.sourceData === true) return renderSourcePage({ main, buildMeta, result, url });
  if (!main || !buildMeta) throw new TypeError('main and buildMeta are required');
  main.replaceChildren();
  buildMeta.textContent = '';
  if (result?.status === 'loading') {
    main.append(node('p', '正在驗證同版共享資料…', 'loading-note'));
    main.setAttribute('aria-busy', 'true');
    return;
  }
  main.removeAttribute('aria-busy');
  const isSkillDirectory = url.pathname === '/skills/' && !url.searchParams.has('id');
  const isWeaponDirectory = url.pathname === '/weapons/' && !url.searchParams.has('family');
  const isBlessingDirectory = url.pathname === '/blessings/' && !url.searchParams.has('id');
  const isRetainedDirectory = isWeaponDirectory || isBlessingDirectory;
  if ((error || result?.status !== 'ready') && isSkillDirectory && historyPackage?.catalog) {
    buildMeta.textContent = `遊戲版本 ${buildMeta.dataset.currentVersion ?? '目前版本'} · 目前資料暫不可用 · 基準資料版本 1.13.1`;
    renderSkillPage(main, null, url, historyPackage, historyError, historyLoading,
      currentError ?? error ?? new Error('current skill data is unavailable'));
    main.focus();
    return;
  }
  if ((error || result?.status !== 'ready') && isRetainedDirectory && historyPackage?.catalog) {
    const currentVersion = buildMeta.dataset.currentVersion ?? '目前版本';
    const currentStatus = currentLoading ? '目前資料載入中' : '目前資料暫不可用';
    buildMeta.textContent = `遊戲版本 ${currentVersion} · ${currentStatus} · 基準資料版本 ${RETAINED_GAME_VERSION}`;
    if (isWeaponDirectory) renderWeapons(main, null, url, historyPackage, historyError, historyLoading);
    else renderBlessingPage(main, null, url, historyPackage, historyError, historyLoading);
    main.focus();
    return;
  }
  if (error || result?.status !== 'ready') {
    setMetadata('資料驗證失敗', '目前無法驗證同版共享資料，因此不顯示混合版本內容。', url);
    renderUnavailable(main, { statusText: '共享資料未能通過驗證。請稍後再試。' });
    return;
  }
  buildMeta.textContent = `遊戲版本 ${result.pointer.game_version} · 資料修訂 ${result.pointer.data_revision.slice(0, 12)}`;
  if (result.fixtureOnly === true) {
    const notice = node('p', '不可發布的資料預覽；此處版本標記僅供驗證。', 'shared-muted shared-preview-notice');
    notice.setAttribute('role', 'status');
    main.append(notice);
  }
  if (url.pathname.startsWith('/skills/')) renderSkillPage(main, result, url, historyPackage, historyError, historyLoading, currentError);
  else if (url.pathname.startsWith('/blessings/')) renderBlessingPage(main, result, url, historyPackage, historyError, historyLoading, retainedBlessingDetail);
  else if (url.pathname.startsWith('/weapons/')) renderWeapons(main, result, url, historyPackage, historyError, historyLoading, retainedWeaponDetail);
  else if (url.pathname === '/game-changes' || url.pathname.startsWith('/game-changes/')) renderGameChanges(main, result, url);
  else if (url.pathname === '/announcements' || url.pathname.startsWith('/announcements/')) {
    buildMeta.textContent = `公告資料 · 資料修訂 ${result.pointer.data_revision.slice(0, 12)}`;
    renderAnnouncements(main, result, url, buildMeta);
  }
  else renderHome(main, result);
  main.focus();
}

function renderSourceItem(parent, item, schemaVersion) {
  const p = sourceItemPresentation(item, schemaVersion);
  const article = node('article', null, 'shared-entry'); article.dataset.itemId = item.id;
  article.append(node('h2', p.name));
  if (p.unofficial) article.append(node('p', '非官方譯名', 'shared-muted'));
  if (!p.modern && (p.official.zh || p.official.en)) {
    const official = node('section', null, 'source-official'); official.append(node('h3', '官方原文'));
    if (p.official.zh) official.append(node('p', p.official.zh));
    if (p.official.en) { const details = node('details'); details.append(node('summary', '英文原文'), node('p', p.official.en)); official.append(details); }
    article.append(official);
  }
  if (p.modern) {
    const effect = node('section', null, 'source-effect'); const heading = node('h3', '效果');
    if (p.effectOrigin === 'unofficial-translation') { const badge = node('span', '非官方翻譯', 'source-effect-origin'); badge.dataset.effectOrigin = p.effectOrigin; heading.append(badge); }
    effect.append(heading, node('p', item.explanation.effect));
    if (p.effectOrigin === 'unofficial-translation') effect.append(node('p', '遊戲沒有提供繁體中文官方文字，此段由 AI 翻譯，僅供參考。', 'shared-muted'));
    if (p.official.en) { const details = node('details'); details.append(node('summary', '英文原文'), node('p', p.official.en)); effect.append(details); }
    article.append(effect);
    const mechanics = p.sections.filter(section => section.key !== 'effect');
    if (mechanics.length) { const block = node('section'); block.append(node('h3', '實際運作機制')); for (const section of mechanics) { const sub = node('section'); sub.dataset.section = section.key; sub.append(node('h4', section.label), node('p', section.text)); block.append(sub); } article.append(block); }
  }
  if (p.errata.length) {
    const errata = node('section', null, 'source-errata'); errata.append(node('h3', '勘誤'));
    for (const row of p.errata) errata.append(node('p', `${row.official} → ${row.corrected}`));
    article.append(errata);
  }
  if (!p.modern) for (const section of p.sections) { const block = node('section'); block.dataset.section = section.key; block.append(node('h3', section.label), node('p', section.text)); article.append(block); }
  const parameters = (parent, params) => { const list = node('dl'); for (const p of params) list.append(node('dt', p.key), node('dd', `${p.value}${p.unit ? ` ${UNIT_LABELS[p.unit] ?? p.unit}` : ''}`)); parent.append(list); };
  parameters(article, p.params);
  for (const tier of p.tiers) { const block=node('section'); block.append(node('h3',tier.label)); parameters(block,tier.params);article.append(block); }
  if (item.values.mark) article.append(node('p', `型號：${item.values.mark}`));
  if (item.values.nodeType) {
    const labels={ability:'能力',ability_modifier:'能力強化',aura:'光環',keystone:'關鍵天賦',keystone_modifier:'關鍵天賦強化',tactical:'戰術',tactical_modifier:'戰術強化',stat:'屬性',start:'起點',default:'預設',broker_stimm:'興奮劑'};
    article.append(node('p', `${labels[item.values.nodeType] ?? '天賦'} · 點數 ${item.values.maxPoints}`));
    for(const id of item.values.parents) { const route = new URL(location.href); route.searchParams.set('id',id); article.append(link(route.pathname+route.search,'前置天賦')); }
  }
  for(const bar of item.values.bars ?? []) { const block=node('section'); block.append(node('h3',bar.name.zh || '武器素質')); for(const stat of bar.stats) block.append(node('p', `${stat.name.zh || '素質'}：${stat.min}–${stat.max}`));article.append(block); }
  for(const action of item.values.actions ?? []) if(action.name.zh) article.append(node('p',action.name.zh));
  parent.append(article);
}

export function renderSourceNotFound(main, url) {
  main.replaceChildren(); main.removeAttribute('aria-busy');
  main.append(node('h1', '找不到'), node('p', '找不到此網址對應的項目。可能沒有唯一對應，或此版本未提供該項目。'));
  const domain = url.pathname.split('/')[1];
  main.append(link(`/${domain}/`, '返回列表'));
  setMetadata('找不到', '找不到此網址對應的項目。', url);
  main.focus();
}

function renderSourcePage({ main, buildMeta, result, url }) {
  main.replaceChildren(); main.removeAttribute('aria-busy');
  buildMeta.textContent = `遊戲版本 ${result.manifest.gameVersion} · 資料修訂 ${result.manifest.dataRevision.slice(0,12)}`;
  const versionNav=node('nav',null,'source-data-nav');versionNav.setAttribute('aria-label','遊戲版本');
  for(const pointer of result.versions) {const target=new URL(url);target.searchParams.set('version',pointer.game_version);versionNav.append(link(target.pathname+target.search,pointer.game_version));}
  main.append(versionNav);
  const domain = kind => result.domains.find(d=>d.kind===kind)?.document;
  const route = url.pathname.split('/')[1];
  if(route==='announcements') {
    const items=(domain('announcements')?.items ?? []).map(item=>validateAnnouncement(item,`darktide:${result.manifest.gameVersion}`));
    renderAnnouncements(main,{...result,view:{getAnnouncements:()=>({status:'ready',items}),getAnnouncement:id=>items.find(i=>i.announcementId===id)}},url,buildMeta);
  } else if(route==='game-changes') {
    const changes=domain('game-changes');
    if(changes?.web) {
      const view=createSharedViewModel({domains:[changes],gameReleaseId:changes.gameReleaseId});
      renderGameChanges(main,{...result,view},url);
    } else {
      main.append(node('h1','遊戲變更紀錄'));
      if(!changes?.changes?.length) main.append(node('p','此版本尚無遊戲變更紀錄','source-changes-empty'));
      for(const change of changes?.changes ?? []) {
        const article=node('article');article.append(node('h2',`${({added:'新增',removed:'移除',changed:'變動'})[change.type]}：${change.name?.zh || change.current?.name?.zh || change.previous?.name?.zh || '名稱待確認'}`));
        for(const field of change.fields ?? []) article.append(node('p',`${field.path}：${sourceChangeValueText(field.previous)} → ${sourceChangeValueText(field.current)}`));main.append(article);
      }
    }
  } else if(['skills','weapons','blessings','terms'].includes(route)) {
    if (url.pathname !== `/${route}/` && url.pathname !== `/${route}`) return renderSourceNotFound(main, url);
    const labels={skills:'技能／天賦',weapons:'武器',blessings:'祝福',terms:'術語'};main.append(node('h1',labels[route]));
    const indexItems = domain(`${route}-index`)?.items ?? [];
    let items = route==='weapons' ? result.domains.filter(d=>d.kind==='weapon-family').flatMap(d=>d.document.items) : route==='blessings' ? result.domains.filter(d=>d.kind==='blessing').flatMap(d=>d.document.items) : domain(route)?.items ?? [];
    const id = url.searchParams.get('id');
    if (url.searchParams.has('id')) {
      if (!id || !items.some(i => i.id === id)) return renderSourceNotFound(main, url);
    }
    const version=url.searchParams.get('version');
    const href=params=>`/${route}/?${new URLSearchParams({...params,...(version?{version}:{})})}`;
    const name=item=>`${item.name.zh || '名稱待確認'}${item.name.origin==='glossary'?'（非官方譯名）':''}`;
    if(route==='weapons') {
      const family=url.searchParams.get('family');const nav=node('nav',null,'source-data-nav');nav.setAttribute('aria-label','武器型號');
      for(const f of [...new Set(indexItems.map(i=>i.family))]) nav.append(link(href({family:f}),name(indexItems.find(i=>i.family===f))));
      main.append(nav); if(family) items=items.filter(i=>i.values.family===family);
      else if (!url.searchParams.has('id')) {
        if (url.searchParams.has('mark')) return renderSourceNotFound(main, url);
        main.focus();return;
      }
      if (url.searchParams.has('mark')) {
        const mark = url.searchParams.get('mark');
        items = items.filter(i => i.key === mark || i.values.mark === mark || i.id === mark);
      }
      if (!items.length) return renderSourceNotFound(main, url);
    }
    if(route==='skills') {
      const classes={psyker:'靈能者',veteran:'老兵',zealot:'狂信徒',ogryn:'歐格林',arbites:'法務官',scum:'巢都渣滓',skitarii:'護教軍'};
      const nav=node('nav',null,'source-data-nav');nav.setAttribute('aria-label','職業與天賦樹');
      for(const key of [...new Set(items.map(i=>`${i.values.archetype}\0${i.values.tree}`))]) {const [archetype,tree]=key.split('\0');nav.append(link(href({archetype,tree}),`${classes[archetype] ?? '職業'}／天賦樹`));}
      main.append(nav);if(url.searchParams.has('archetype'))items=items.filter(i=>i.values.archetype===url.searchParams.get('archetype'));
      if(url.searchParams.has('tree'))items=items.filter(i=>i.values.tree===url.searchParams.get('tree'));
    }
    if(route==='terms') {
      const rules = domain('term-rules')?.rules?.rules ?? [];
      if (rules.length) { const section = node('section'); section.append(node('h2', '術語譯名規則'), node('p', '社群譯名規則，非遊戲官方術語')); const list = node('ul'); for (const rule of rules) list.append(node('li', `${rule.sourceText} → ${rule.targetText}`)); section.append(list); main.append(section); }
      const nav=node('nav',null,'source-data-nav');nav.setAttribute('aria-label','術語分類');const labels={keyword:'關鍵字',class:'職業','skill-type':'技能類型','weapon-type':'武器類型','weapon-stat':'武器素質','weapon-perk':'武器特長',quality:'品質',curio:'珍品','curio-perk':'珍品特長','curio-trait':'珍品特性','mortis-buff':'死神試煉增益'};
      for(const category of [...new Set(items.map(i=>i.values.category))])nav.append(link(href({category}),labels[category]??'其他'));main.append(nav);
      if(url.searchParams.has('category'))items=items.filter(i=>i.values.category===url.searchParams.get('category'));
    }
    if (url.searchParams.has('id')) {
      items = items.filter(i => i.id === id);
      if (!items.length) return renderSourceNotFound(main, url);
    }
    if(route==='blessings'&&!id) {const list=node('ul',null,'shared-entry-list');for(const item of indexItems){const row=node('li',null,'shared-entry');row.append(link(href({id:item.id}),name(item)));list.append(row);}main.append(list);main.focus();return;}
    for(const item of items) {if(!id)main.append(link(href({id:item.id,...(item.values.family?{family:item.values.family}:{})}),item.name.zh || '名稱待確認'));const document = result.domains.find(d => d.document.items?.includes(item))?.document;renderSourceItem(main,item,document?.schemaVersion);}
    if(!items.length)main.append(node('p','目前沒有可顯示的資料。'));
  } else {
    main.append(node('h1','黑潮繁體資料庫'));
    for(const [route,label] of [['skills','技能'],['weapons','武器'],['blessings','祝福'],['terms','術語'],['game-changes','遊戲變更紀錄'],['announcements','公告']])main.append(link(`/${route}/?version=${result.manifest.gameVersion}`,label));
  }
  setMetadata(main.querySelector('h1')?.textContent ?? '黑潮繁體資料庫','繁體中文遊戲資料',url);
  main.focus();
}
