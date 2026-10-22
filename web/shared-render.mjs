const SECTION_ORDER = ['effects', 'conditions', 'calculation', 'notes', 'extra'];
const SECTION_LABELS = Object.freeze({ effects: '效果', conditions: '條件', calculation: '計算', notes: '補充說明', extra: '額外說明' });
const INPUT_LABELS = Object.freeze({
  light_attack: '輕攻擊', heavy_attack: '重攻擊', special_action: '特殊動作', block: '格擋',
  start_attack: '開始攻擊', dodge: '閃避', push: '推擊', push_follow_up: '推擊後續',
  light_push: '輕推擊', heavy_push: '重推擊',
});
const UNIT_LABELS = Object.freeze({
  percent: '%', ratio: '比例', seconds: '秒', s: '秒', count: '次', meters: '公尺',
  point: '點', 'dodge-count': '次閃避', 'stamina-point': '耐力點',
  'stamina-point-per-second': '耐力點／秒', 'normalized-speed-per-second': '標準化速度／秒',
  'attack-power-point': '攻擊威力點', 'cleave-power-point': '鋸擊威力點',
});
const SOURCE_STAT_LABELS = Object.freeze({
  chainaxe_dps_stat: '傷害輸出', chainaxe_armor_pierce_stat: '破甲',
  chainaxe_mobility_stat: '移動性', chainaxe_defence_stat: '防禦', chainaxe_sawing_stat: '鏈鋸階段',
  damage_stat: '傷害', cleave_stat: '劈砍', impact_stat: '衝擊',
});
const SOURCE_PROPERTY_LABELS = Object.freeze({
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
const ATTACK_MODE_LABELS = Object.freeze({ light: '輕攻擊', heavy: '重攻擊', push: '推擊', block: '格擋', special: '特殊動作' });
const BRANCH_LABELS = Object.freeze({
  normal: '一般分支', abort: '中止分支', 'special-active': '特殊動作啟動分支',
  inner: '內側分支', outer: '外側分支',
});
const QUANTITY_LABELS = Object.freeze({
  'attack-power-distribution': '攻擊威力分布', 'armor-damage-modifier': '護甲傷害修正',
  'damage-profile': '傷害設定', 'dodge-count': '閃避次數',
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
  for (const key of ['id', 'variant', 'tier', 'family', 'mark']) {
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
function renderHome(main, result) {
  setMetadata('首頁', '查閱同版技能、武器與祝福的繁體中文官方資料。', new URL(location.href));
  const hero = node('section', null, 'shared-hero');
  hero.append(node('p', '同版官方資料 · 繁體中文', 'eyebrow'));
  hero.append(node('h1', '查閱技能、武器與祝福資料'));
  hero.append(node('p', '資料先按遊戲版本與完整修訂驗證，再呈現各自的官方文字、數值與條件。', 'shared-lead'));
  const links = node('div', null, 'shared-home-links');
  for (const [href, label] of [['/skills/', '查閱技能'], ['/weapons/', '瀏覽武器'], ['/blessings/', '瀏覽祝福']]) links.append(link(href, label, 'button-link'));
  hero.append(links);
  main.append(hero);
  const note = node('p', `遊戲版本 ${result.pointer.game_version} · 資料修訂 ${result.pointer.data_revision.slice(0, 12)}`, 'version-line');
  main.append(note);
}
function renderSkillPage(main, result, url) {
  const domain = result.domains.find(row => row.kind === 'skills');
  const presentations = getPresentations(domain, 'skill');
  const id = url.searchParams.get('id');
  if (id) {
    const presentation = presentations.find(row => displayRef(row.entityRef) === id);
    const view = presentation && result.view.getSkill(presentation.entityRef);
    if (!view || view.status !== 'ready') {
      setMetadata('技能資料未能確認', '目前無法確認此技能的同版繁體中文資料。', url);
      return renderUnavailable(main, view);
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
  setMetadata('技能與天賦', '依繁體中文名稱查閱已驗證的同版技能資料。', url);
  const header = node('header', null, 'page-intro');
  header.append(node('p', '技能／天賦', 'eyebrow'), node('h1', '技能與天賦'));
  main.append(header);
  const input = renderSearch(main, url.searchParams.get('q') ?? '');
  const list = node('ul', null, 'shared-entry-list');
  for (const presentation of presentations) {
    const view = result.view.getSkill(presentation.entityRef);
    if (view.status !== 'ready') continue;
    const item = node('li', null, 'shared-entry');
    item.dataset.searchName = view.name;
    const anchor = link(paramsUrl('/skills/', { id: presentation.entityRef.recordId }), view.name);
    item.append(anchor, node('p', view.official.resolvedText, 'shared-muted'));
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
function renderSourceConditions(rows) {
  if (!Array.isArray(rows) || !rows.length) return '未記載額外來源條件';
  return rows.map(condition => {
    const key = typeof condition?.fieldPath === 'string' ? condition.fieldPath.split('.').at(-1) : '';
    const value = typeof condition?.rawValue === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(condition.rawValue)
      ? condition.rawValue : null;
    if (value !== null && key === 'chain_time') return `連段時間 ${value} 秒`;
    if (value !== null && key === 'chain_until') return `連段窗口 ${value} 秒`;
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
function renderWeaponSourceDetails(parent, view) {
  const block = node('details', null, 'shared-card shared-expandable shared-source-details');
  block.append(node('summary', '其他來源數值、素質語意與連段條件'));
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
        const values = (property.orderedValues ?? []).map(value => typeof value.decimal === 'string' ? value.decimal : null).filter(Boolean);
        if (!values.length) continue;
        const item = node('li', null, 'shared-source-table-property');
        const armor = armorClassKey(property.property);
        const parts = armor ? [sourceArmorClassNode(armor)] : [];
        parts.push(sourceTokenNode('來源欄位', property.property, 'shared-source-property-key'));
        parts.push(`${localizedSourceProperty(property.property)}：${values.join('、')}${sourceUnit(property.unit)}`);
        appendLabelParts(item, parts);
        list.append(item);
      }
      if (list.children.length) article.append(list);
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
    section.append(node('h3', '來源連段與條件'));
    const list = node('ul', null, 'shared-detail-list');
    for (const row of continuations) {
      const item = node('li', null, 'shared-action-continuation');
      appendLabelParts(item, [sourceActionRouteNode(row.fromAction, row.toAction), sourceInputNode(row.inputKey), renderSourceConditions(row.conditions)]);
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
        appendLabelParts(item, [sourceActionRouteNode(entry.fromAction, entry.toAction), sourceInputNode(entry.inputKey), renderSourceConditions(entry.conditions)]);
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
        article.append(node('p', `來源條件（未執行判定）：${renderSourceConditions([condition])}`, 'shared-attack-runtime-condition'));
      }
      section.append(article);
    }
    block.append(section);
  }
  parent.append(block);
}
function renderWeapon(main, result, view, familyMarks, url) {
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
        ? `連段時間 ${row.rawValue} 秒` : null).filter(Boolean).join('、');
      chainList.append(node('li', `連段輸入：${input}${condition ? `；${condition}` : ''}`));
      chainCount += 1;
    }
  }
  if (!chainCount) chainList.append(node('li', '來源尚未提供可讀的繁體中文連段條件。'));
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
  setMetadata('武器', '依武器家族與型號查閱完整素質、曲線與攻擊連段。', url);
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
    item.append(node('p', '依武器家族選取型號，查看各自的素質、來源曲線與連段資料。', 'shared-muted'));
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

export function renderSharedPage({ main, buildMeta, result, url = new URL(location.href), error = null } = {}) {
  if (!main || !buildMeta) throw new TypeError('main and buildMeta are required');
  main.replaceChildren();
  if (result?.status === 'loading') {
    main.append(node('p', '正在驗證同版共享資料…', 'loading-note'));
    main.setAttribute('aria-busy', 'true');
    return;
  }
  main.removeAttribute('aria-busy');
  if (error || result?.status !== 'ready') {
    setMetadata('資料驗證失敗', '目前無法驗證同版共享資料，因此不顯示混合版本內容。', url);
    renderUnavailable(main, { statusText: '共享資料未能通過驗證。請稍後再試。' });
    return;
  }
  buildMeta.textContent = `遊戲版本 ${result.pointer.game_version} · 資料修訂 ${result.pointer.data_revision.slice(0, 12)}`;
  if (url.pathname.startsWith('/skills/')) renderSkillPage(main, result, url);
  else if (url.pathname.startsWith('/blessings/')) renderBlessingPage(main, result, url);
  else if (url.pathname.startsWith('/weapons/')) renderWeapons(main, result, url);
  else renderHome(main, result);
  main.focus();
}
