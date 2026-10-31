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
function renderOfficial(parent, official) {
  const block = detailBlock('官方繁體中文');
  block.append(node('p', official.resolvedText, 'shared-official-text'));
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
  input.type = 'search'; input.name = 'q'; input.value = query;
  input.autocomplete = 'off'; input.setAttribute('aria-label', '搜尋繁體中文名稱');
  label.append(input);
  parent.append(label);
  return input;
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

function renderHome(main, result) {
  setMetadata('首頁', '查閱同版技能、武器與祝福的繁體中文官方資料。', new URL(location.href));
  const hero = node('section', null, 'shared-hero');
  hero.append(node('p', '同版官方資料 · 繁體中文', 'eyebrow'));
  hero.append(node('h1', '查閱技能、武器與祝福資料'));
  hero.append(node('p', '資料先按遊戲版本與完整修訂驗證，再呈現各自的官方文字、數值與條件。', 'shared-lead'));
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
    const details = [row.category, row.summary].filter(Boolean).join(' · ');
    if (details) item.append(node('p', details, 'shared-muted'));
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
function renderBlessingPage(main, result, url) {
  const domain = result.domains.find(row => row.kind === 'blessings');
  const presentations = getPresentations(domain, 'blessing');
  const id = url.searchParams.get('id');
  if (!id) {
    setMetadata('祝福', '查閱已驗證的繁體中文祝福、變體與各等級資料。', url);
    const header = node('header', null, 'page-intro');
    header.append(node('p', '祝福', 'eyebrow'), node('h1', '祝福'));
    main.append(header);
    const input = renderSearch(main, url.searchParams.get('q') ?? '');
    const list = node('ul', null, 'shared-entry-list');
    for (const presentation of presentations) {
      for (const applicability of presentation.tierApplicability ?? []) {
        const variantRef = applicability.variantRef;
        const tier = applicability.tiers?.includes(4) ? 4 : applicability.tiers?.[0];
        if (!variantRef || !Number.isInteger(tier)) continue;
        const view = result.view.getBlessing({ blessingRef: presentation.entityRef, variantRef, tier });
        if (view.status !== 'ready') continue;
        const item = node('li', null, 'shared-entry'); item.dataset.searchName = view.name;
        item.append(link(paramsUrl('/blessings/', { id: presentation.entityRef.recordId, variant: variantRef.recordId, tier }), `${view.name} · LV${tier}`));
        item.append(node('p', view.official.resolvedText, 'shared-muted'));
        list.append(item);
      }
    }
    main.append(list);
    const applySearch = () => {
      const query = input.value.trim().toLocaleLowerCase('zh-Hant-TW');
      for (const row of list.querySelectorAll('.shared-entry')) row.hidden = !row.dataset.searchName.toLocaleLowerCase('zh-Hant-TW').includes(query);
    };
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
  const applicabilityText = view.applicability?.status === 'verified'
    ? '目前已驗證所選武器適用關係。'
    : '適用武器尚未驗證；此頁只顯示已確認的祝福與等級資料。';
  main.append(node('p', applicabilityText, 'shared-applicability'));
  if (view.obtainableTiers?.status !== 'known') main.append(node('p', '此等級是否可取得尚未確認。', 'shared-muted'));
  renderOfficial(main, view.official);
  renderErrata(main, view.errata);
  renderSections(main, view.sections);
  renderTerms(main, view);
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
    for (const { definition, curve } of definitions) {
      const payload = definition.payload ?? {};
      const article = node('article', null, 'shared-source-stat-definition');
      article.append(node('h4', SOURCE_STAT_LABELS[payload.quantity] ?? '來源素質'));
      if (payload.theoreticalInputRange) article.append(node('p', `理論輸入範圍：${rangeText(payload.theoreticalInputRange, 'theoretical')}。`));
      if (payload.obtainableInputRange) article.append(node('p', `實際可取得範圍：${rangeText(payload.obtainableInputRange, 'obtainable')}。`, 'shared-muted'));
      for (const knot of curve?.payload?.knots ?? []) {
        article.append(node('p', `來源曲線節點：輸入 ${knot.input}${sourceUnit(curve.payload.inputUnit)}，輸出 ${knot.output}${sourceUnit(curve.payload.outputUnit)}。`));
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
function renderWeapon(main, result, view, familyMarks, url) {
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
  if (view.note) main.append(node('p', view.note, 'shared-callout'));
  renderOfficial(main, view.official);
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
  renderSections(main, view.sections);
  renderTerms(main, view);
}
function renderWeapons(main, result, url) {
  const domain = result.domains.find(row => row.kind === 'weapons');
  const records = domain.source.records.filter(row => row.kind === 'weapon' && row.gameReleaseId === result.manifest.gameReleaseId);
  const families = [...new Set(records.map(row => row.payload?.familyId).filter(Boolean))];
  const familyId = url.searchParams.get('family');
  const markId = url.searchParams.get('mark');
  if (url.searchParams.has('family')) {
    const family = result.view.getWeaponFamily(familyId);
    if (family.status !== 'ready') {
      setMetadata('武器家族資料未能確認', '目前無法確認此武器家族的同版繁體中文資料。', url);
      return renderUnavailable(main, family);
    }
    const view = url.searchParams.has('mark') ? family.marks.find(mark => mark.markId === markId) : family.marks[0];
    if (!view) {
      setMetadata('武器型號未能確認', '目前無法確認此武器型號的同版繁體中文資料。', url);
      return renderUnavailable(main, { statusText: '無法確認這個武器型號。' });
    }
    return renderWeapon(main, result, view, family.marks, url);
  }
  setMetadata('武器', '依武器家族與型號查閱素質、來源表與動作資料。', url);
  const header = node('header', null, 'page-intro');
  header.append(node('p', '武器', 'eyebrow'), node('h1', '武器'));
  main.append(header);
  const input = renderSearch(main, url.searchParams.get('q') ?? '');
  const list = node('ul', null, 'shared-entry-list');
  for (const family of families) {
    const view = result.view.getWeaponFamily(family);
    if (view.status !== 'ready') continue;
    const first = view.marks[0];
    const item = node('li', null, 'shared-entry'); item.dataset.searchName = first.name;
    item.append(link(paramsUrl('/weapons/', { family, mark: first.markId }), `${first.name} · ${view.marks.length} 個型號`));
    item.append(node('p', '依武器家族選取型號，查看各自的素質、來源表與動作資料。', 'shared-muted'));
    list.append(item);
  }
  main.append(list);
  const applySearch = () => {
    const query = input.value.trim().toLocaleLowerCase('zh-Hant-TW');
    for (const row of list.querySelectorAll('.shared-entry')) row.hidden = !row.dataset.searchName.toLocaleLowerCase('zh-Hant-TW').includes(query);
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
  main.append(link('/game-changes/', '返回更新紀錄', 'secondary-link'), header);
  main.append(node('p', item.summary, 'shared-change-summary'));
  renderBlessingVariantContext(main, item.blessingVariant);
  const facts = detailBlock('紀錄摘要');
  const category = GAME_CHANGE_TYPE_LABELS[gameChangeType(item)] ?? item.entityKindLabel;
  facts.append(node('p', `類型：${category} · ${item.entityKindLabel}`));
  facts.append(node('p', `遊戲版本：${item.comparison.fromGameVersion} → ${item.comparison.toGameVersion}`));
  facts.append(node('p', `變動類型：${GAME_CHANGE_OPERATION_LABELS[item.operation] ?? '內容變更'}`));
  facts.append(node('p', `驗證方式：${item.verificationLabel ?? '驗證方式未確認'}`));
  facts.append(node('p', `網站資料版本：${result.pointer.content_version}`));
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

function renderGameChanges(main, result, url) {
  const allItems = result.view.getGameChanges({}).items;
  const id = url.searchParams.get('id');
  if (id !== null) {
    const item = allItems.find(row => row.changeId === id);
    return renderGameChangeDetail(main, result, url, item);
  }

  const requestedVersion = url.searchParams.get('version') ?? '';
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
  const versionSelect = node('select'); versionSelect.name = 'version'; versionSelect.setAttribute('aria-label', '遊戲版本');
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
  form.append(versionLabel, typeLabel);
  const submit = node('button', '套用篩選', 'button'); submit.type = 'submit'; form.append(submit);
  main.append(form);

  const filtered = allItems.filter(item => (!requestedVersion || item.gameVersion === requestedVersion)
    && (!requestedType || gameChangeType(item) === requestedType));
  if (!filtered.length) {
    main.append(node('p', allItems.length || requestedVersion || requestedType
      ? '目前篩選條件下沒有已確認的遊戲變動。' : '本次無新增已確認的遊戲變動。', 'shared-change-empty'));
    return;
  }
  const list = node('ul', null, 'shared-entry-list shared-change-list');
  for (const item of filtered) {
    const entry = node('li', null, 'shared-entry shared-change-entry');
    const href = paramsUrl('/game-changes/', { id: item.changeId, ...(requestedVersion ? { version: requestedVersion } : {}), ...(requestedType ? { type: requestedType } : {}) });
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
  historyPackage = null, historyError = null, historyLoading = false, currentError = null } = {}) {
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
  if ((error || result?.status !== 'ready') && isSkillDirectory && historyPackage?.catalog) {
    buildMeta.textContent = `遊戲版本 ${buildMeta.dataset.currentVersion ?? '目前版本'} · 目前資料暫不可用 · 基準資料版本 1.13.1`;
    renderSkillPage(main, null, url, historyPackage, historyError, historyLoading,
      currentError ?? error ?? new Error('current skill data is unavailable'));
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
  else if (url.pathname.startsWith('/blessings/')) renderBlessingPage(main, result, url);
  else if (url.pathname.startsWith('/weapons/')) renderWeapons(main, result, url);
  else if (url.pathname === '/game-changes' || url.pathname.startsWith('/game-changes/')) renderGameChanges(main, result, url);
  else if (url.pathname === '/announcements' || url.pathname.startsWith('/announcements/')) {
    buildMeta.textContent = `公告資料 · 資料修訂 ${result.pointer.data_revision.slice(0, 12)}`;
    renderAnnouncements(main, result, url, buildMeta);
  }
  else renderHome(main, result);
  main.focus();
}
