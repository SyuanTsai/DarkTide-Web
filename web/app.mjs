import {
  createDataClient,
  createNavigationController,
  assetPresentation,
  displayName,
  displayCategory,
  filterEntries,
  mechanicsItems,
  groupBlessingEffects,
  blessingAvailabilityNote,
  browsingRelations,
  preferredSkillView,
  makeRedirectUrl,
  pageEntries,
  readListState,
  resolveCatalogRoute,
  writeListState
} from './client.mjs';
import { createSharedClient, hasSharedContext } from './shared-client.mjs';
import { renderSharedPage } from './shared-render.mjs';

const main = document.getElementById('main');
const buildMeta = document.getElementById('build-meta');
const build = window.__BUILD__;
const pageSize = 18;
const labels = {
  skill: '技能／天賦', mechanics: '技能機制', weapon: '武器', mark: '武器型號',
  blessing: '祝福', variant: '祝福等級'
};
const archetypeLabels = {
  veteran: '老兵', zealot: '狂信徒', psyker: '靈能者', ogryn: '歐格林', arbites: '法務官',
  scum: '巢都渣滓', skitarii: '護教軍'
};
const legacyClaimLabels = {
  damage: '傷害', stability: '穩定度', attack_speed: '攻擊速度', reload_speed: '裝填速度',
  critical_chance: '致命一擊機率', critical_damage: '致命一擊傷害', capacity: '彈藥容量',
  cleave_damage: '穿透傷害', impact: '衝擊力', range: '射程', radius: '範圍', duration: '持續時間',
};
const numericClaimLabels = {
  // Static mirror of the numeric mapper labels; the later spread wins on duplicate IDs.
  'active-duration-seconds': '生效持續時間',
  'active-retrigger-gate-seconds': '再次觸發間隔',
  'base-cooldown-seconds': '基礎冷卻時間',
  'base-max-toughness-percent': '基礎最大韌性百分比',
  'base-multiplier': '基礎倍率',
  'base-perfect-block-window-seconds': '完美格擋判定時間',
  'bleed-duration-seconds': '流血持續時間',
  'bleed-tick-interval-seconds': '流血傷害間隔',
  'child-duration-seconds': '子效果持續時間',
  'clip-step-percent': '彈匣階段百分比',
  'cooldown-duration-seconds': '冷卻持續時間',
  'cooldown-seconds': '冷卻時間',
  'cover-release-duration-seconds': '離開掩體所需時間',
  'damage-and-decay-interval-seconds': '傷害與衰減間隔',
  'default-combo-reset-duration-after-ended-action-seconds': '招式結束後連段重置時間',
  'display-cleave-percent': '劈砍百分比',
  'display-per-layer-percent': '每層百分比',
  'display-percent': '顯示百分比',
  'displayed-reduction-percent': '減少百分比',
  'duration-and-retrigger-lockout-seconds': '持續與重新觸發鎖定時間',
  'duration-before-decay-seconds': '衰減前持續時間',
  'duration-per-stack-seconds': '每層持續時間',
  'duration-seconds': '持續時間',
  'enemy-stun-duration-seconds': '敵人暈眩時間',
  'full-10-step-time-seconds': '完成十階段所需時間',
  'full-stack-bonus-percent': '滿層加成百分比',
  'interval-seconds': '觸發間隔',
  'max-stacks': '最多層數',
  'max-five-step-reduction-percent': '五階段最大減少百分比',
  'max-normal-branch-stagger-duration-multiplier': '一般分支最大硬直時間倍率',
  'max-step-multiplier': '最大階段倍率',
  'max-step-total-time-reduction-percent': '最大階段總時間減少百分比',
  'melee-rending-vs-staggered-multiplier': '對失衡敵人的近戰破甲倍率',
  'natural-recovery-interval-seconds': '自然回復間隔',
  'neutral-multiplier': '中性狀態倍率',
  'non-lockout-multiplier': '非鎖定期間倍率',
  'overdamage-multiplier': '超額傷害倍率',
  'per-stack-percent': '每層百分比加成',
  'per-stack-remaining-slow-multiplier': '每層剩餘緩速倍率',
  'per-stack-slow-reduction-percent': '每層緩速減少百分比',
  'reduction-percent': '減少百分比',
  'shared-bleed-duration-seconds': '共用流血持續時間',
  'shared-bleed-tick-and-decay-interval-seconds': '共用流血跳傷與衰減間隔',
  'shared-duration': '共用效果持續時間',
  'shared-idle-decay-interval-seconds': '靜止時層數衰減間隔',
  'shared-idle-duration-seconds': '靜止時效果持續時間',
  'shared-stack-decay-seconds': '共用層數衰減時間',
  'shared-tier-radius-percent': '共用等級範圍百分比',
  'step-percent': '每階段百分比',
  'target-buff-duration-seconds': '目標增益持續時間',
  'target-debuff-duration-seconds': '目標減益持續時間',
  'target-duration-seconds': '目標效果持續時間',
  'tier-active-duration-seconds': '等級生效持續時間',
  'tier-cleave-bonus-percent': '等級劈砍加成百分比',
  'tier-cooldown-seconds': '等級冷卻時間',
  'tier-duration-seconds': '等級持續時間',
  'tier-fov-multiplier': '等級視野倍率',
  'windup-interval-seconds': '蓄力間隔',
  'duration-per-stack-seconds-by-tier': '各等級每層持續時間',
  'duration-seconds-by-tier': '各等級持續時間',
  'cooldown-seconds-by-tier': '各等級冷卻時間',
  'active-duration-seconds-by-tier': '各等級生效持續時間',
  'cooldown-duration-seconds-by-tier': '各等級冷卻持續時間',
  'display-percent-by-tier': '各等級顯示百分比',
  'displayed-reduction-percent-by-tier': '各等級減少百分比',
  'tier-cooldown-seconds-by-tier': '各等級冷卻時間',
  'tier-duration-seconds-by-tier': '各等級持續時間',
  'power-per-stack': '每層近戰威力加成',
  'refresh-duration': '命中刷新時間',
  'critical-chance-per-stack': '每層爆擊率加成',
  'weakspot-extra-damage': '近戰弱點額外傷害加成',
  'eligible-prior-kills': '有效先前擊殺上限',
  'close-range-damage-per-stack': '每層近距離傷害加成',
  'bullets-transferred': '每次暴擊轉移發數',
  'maximum-critical-shots': '暴擊延續發數上限',
  'toughness-per-step': '每步觸發的基礎最大韌性百分比'
};
const claimLabels = { ...legacyClaimLabels, ...numericClaimLabels };
const unitLabels = { percent: '%', seconds: '秒', meters: '公尺', count: '個', multiplier: '倍', game_unit: '' };

function element(tag, text = null, className = '') {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function unknownText(value, fallback = '尚未確認') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function setSeo(title, description, { noindex = false } = {}) {
  document.title = `${title}｜黑潮繁體資料庫`;
  let descriptionMeta = document.querySelector('meta[name="description"]');
  if (!descriptionMeta) {
    descriptionMeta = element('meta');
    descriptionMeta.name = 'description';
    document.head.append(descriptionMeta);
  }
  descriptionMeta.content = description;
  let robots = document.querySelector('meta[name="robots"]');
  if (noindex && !robots) {
    robots = element('meta');
    robots.name = 'robots';
    document.head.append(robots);
  }
  if (robots) {
    if (noindex) robots.content = 'noindex';
    else robots.remove();
  }
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = element('link');
    canonical.rel = 'canonical';
    document.head.append(canonical);
  }
  const current = new URL(window.location.href);
  canonical.href = `${current.origin}${current.pathname}`;
  for (const link of document.querySelectorAll('.primary-nav a')) {
    const selected = current.pathname === link.pathname ||
      (link.pathname !== '/' && current.pathname.startsWith(link.pathname));
    if (selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function makeLink(href, label, className = '') {
  const link = element('a', label, className);
  link.href = href;
  return link;
}

function makeButton(label, onClick, secondary = false) {
  const button = element('button', label, secondary ? 'button secondary' : 'button');
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function intro(kicker, title, description) {
  const section = element('section', null, 'page-intro');
  section.append(element('p', kicker, 'eyebrow'));
  section.append(element('h1', title));
  section.append(element('p', description));
  return section;
}

function panel(title) {
  const section = element('section', null, 'detail-section');
  section.append(element('h2', title));
  return section;
}

function textValue(value, fallback = '尚未確認') {
  const paragraph = element('p', unknownText(value, fallback), value == null ? 'unknown' : 'data-text');
  return paragraph;
}

function mechanicsList(value) {
  const items = mechanicsItems(value);
  if (!items.length) return textValue(null);
  const list = element('ul', null, 'mechanics-list');
  for (const item of items) list.append(element('li', item, 'data-text'));
  return list;
}

function buildFooter(catalog) {
  const counts = catalog.counts;
  buildMeta.textContent = `遊戲版本 ${build.game_version} · 資料版本 ${build.data_revision.slice(0, 12)} · 技能 ${counts.skills} · 武器 ${counts.weapons} · 祝福 ${counts.blessings}`;
}

function renderHome(catalog) {
  setSeo('首頁', '依職業查閱技能與機制，查閱武器、祝福及其關聯。');
  const hero = element('section', null, 'hero');
  hero.append(element('p', '社群資料庫 · 繁體中文', 'eyebrow'));
  hero.append(element('h1', '在技能、武器與祝福之間，找到清楚的路徑。'));
  hero.append(element('p', '依職業查閱技能與機制，查閱武器、祝福效果與彼此關聯。', 'hero-copy'));
  const links = element('div', null, 'hero-links');
  links.append(makeLink('/skills/', '探索技能 ↗', 'button-link'));
  links.append(makeLink('/weapons/', '瀏覽武器 ↗', 'button-link'));
  links.append(makeLink('/blessings/', '查詢祝福 ↗', 'button-link'));
  hero.append(links);
  main.append(hero);

  const categories = element('section', null, 'category-grid');
  const rows = [
    { route: '/skills/', title: '技能與機制', count: catalog.counts.skills, note: '依職業與分類查閱技能和獨立機制說明。' },
    { route: '/weapons/', title: '武器', count: catalog.counts.weapons, note: '按武器查閱資訊與可用祝福。' },
    { route: '/blessings/', title: '祝福', count: catalog.counts.blessings, note: '查閱祝福效果、適用武器與等級數值。' }
  ];
  for (const row of rows) {
    const card = element('section', null, 'surface category-card');
    const heading = element('h2');
    heading.append(makeLink(row.route, row.title));
    card.append(heading, element('p', row.note));
    const count = element('p', null, 'count');
    count.append(element('strong', row.count), document.createTextNode(' 筆資料'));
    card.append(count);
    categories.append(card);
  }
  main.append(categories);
  const version = element('p', `遊戲版本 ${build.game_version} · 資料版本 ${build.data_revision.slice(0, 12)}`, 'version-line');
  main.append(version);
  buildFooter(catalog);
}

function sortEntries(rows) {
  return [...rows].sort((left, right) => {
    const a = unknownText(left.name_zh_tw, left.id);
    const b = unknownText(right.name_zh_tw, right.id);
    return a.localeCompare(b, 'zh-Hant-TW') || left.id.localeCompare(right.id);
  });
}

function archetypeTitle(id) {
  return archetypeLabels[id] ?? `職業：${id}`;
}

function listDescription(kind, archetype) {
  if (kind === 'skills' && archetype) return `查閱${archetypeTitle(archetype)}的技能、分類與機制說明。`;
  if (kind === 'skills') return '依職業查閱技能與各自的機制說明。';
  if (kind === 'weapons') return '按武器類別瀏覽武器，並查看可用祝福。';
  return '瀏覽祝福效果、適用武器與已知等級。';
}

function renderListIcon(item, group, entry) {
  const visual = element('div', null, 'entry-icon');
  const placeholder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  placeholder.setAttribute('viewBox', '0 0 32 32');
  placeholder.setAttribute('role', 'img');
  placeholder.setAttribute('aria-label', '通用技能圖示');
  const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  symbol.setAttribute('d', 'M16 3 27 8v9c0 6-11 12-11 12S5 23 5 17V8Z M16 9v13 M10 15h12');
  placeholder.append(symbol);
  visual.append(placeholder);
  item.append(visual);
  item.dataset.iconState = entry.asset_ids.length ? 'loading' : 'generic';
  visual.title = entry.asset_ids.length ? '正在載入技能圖片' : '通用技能圖示（尚無對應的專屬圖示）';
  if (!entry.asset_ids.length) return;
  dataClient.loadDetail(entry).then(detail => {
    if (!item.isConnected) return;
    const asset = detail.assets[0];
    if (!asset) { item.dataset.iconState = 'generic'; return; }
    const presentation = assetPresentation(build.data_revision, entry, detail.record, asset);
    const image = element('img');
    image.alt = presentation.alt; image.loading = 'eager'; image.decoding = 'async'; image.hidden = true;
    image.addEventListener('load', () => {
      placeholder.setAttribute('hidden', ''); image.hidden = false; item.dataset.iconState = 'loaded';
      visual.title = presentation.alt;
    }, { once: true });
    image.addEventListener('error', () => {
      item.dataset.iconState = 'generic'; visual.title = '圖片暫時無法載入，顯示通用技能圖示';
    }, { once: true });
    image.src = presentation.src; visual.append(image);
    if (presentation.credit) {
      const credit = makeLink(presentation.credit.href, presentation.credit.label, 'entry-icon-credit');
      credit.target = '_blank'; credit.rel = 'noopener'; group.append(credit);
    }
  }).catch(() => {
    if (!item.isConnected) return;
    item.dataset.iconState = 'generic'; visual.title = '圖片暫時無法載入，顯示通用技能圖示';
  });
}

function renderSkillDirectory(catalog, url) {
  const skills = catalog.entries.filter(entry => entry.kind === 'skill');
  const state = readListState(url);
  const archetypes = [...new Set(skills.map(entry => entry.id.split('/')[0]))].sort();
  const classRows = archetypes.map(id => ({
    ...skills.find(entry => entry.id.startsWith(`${id}/`)),
    id,
    category: id,
    display_name: archetypeTitle(id),
    route: `/skills/${id}/`,
    class_count: skills.filter(entry => entry.id.startsWith(`${id}/`)).length,
    name_zh_tw: `${archetypeTitle(id)} ${skills.filter(entry => entry.id.startsWith(`${id}/`)).map(entry => entry.name_zh_tw ?? entry.id).join(' ')}`
  }));
  const matches = filterEntries(classRows, state);
  const maxPage = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.min(state.page, maxPage);
  if (page !== state.page) history.replaceState(null, '', writeListState(url, { page }).href);
  const shown = pageEntries(matches, page, pageSize);
  const grid = element('ul', null, 'entry-list');
  for (const row of shown) {
    const item = element('li', null, 'entry-card');
    const group = element('div');
    group.append(makeLink(row.route, row.display_name));
    group.append(element('small', `${row.class_count} 項技能`));
    item.append(group, element('span', '↗', 'entry-arrow'));
    grid.append(item);
  }
  return { entries: classRows, matches, shown, state: { ...state, page }, grid, countLabel: '職業' };
}

function renderListPage(page, catalog, locationUrl) {
  const { kind, archetype } = page;
  const pageTitle = kind === 'skills' ? (archetype ? archetypeTitle(archetype) : '技能') : kind === 'weapons' ? '武器' : '祝福';
  setSeo(pageTitle, listDescription(kind, archetype));
  main.append(intro(kind === 'skills' ? '技能目錄' : kind === 'weapons' ? '武器目錄' : '祝福目錄', pageTitle, listDescription(kind, archetype)));

  if (kind === 'skills' && archetype) {
    const metadata = catalog.talent_trees?.find(row => row.archetype === archetype);
    if (metadata) {
      const views = element('nav', null, 'view-switch');
      views.setAttribute('aria-label', '技能檢視');
      for (const [view, label] of [['list', '清單'], ['tree', '天賦樹']]) {
        const url = new URL(locationUrl);
        url.searchParams.set('view', view);
        const link = makeLink(url.pathname + url.search, label, 'button secondary');
        if (preferredSkillView(locationUrl, true) === view) link.setAttribute('aria-current', 'page');
        views.append(link);
      }
      main.append(views);
      if (page.tree) { renderTalentTree(page.tree, catalog); buildFooter(catalog); return; }
    }
  }
  let listResult;
  if (kind === 'skills' && !archetype) {
    listResult = renderSkillDirectory(catalog, locationUrl);
  } else {
    const entryKind = kind === 'skills' ? 'skill' : kind === 'weapons' ? 'weapon' : 'blessing';
    let source = catalog.entries.filter(entry => entry.kind === entryKind);
    if (archetype) source = source.filter(entry => entry.id.startsWith(`${archetype}/`));
    const state = readListState(locationUrl);
    const categories = [...new Set(source.map(entry => entry.category).filter(value => typeof value === 'string' && value.trim()))]
      .sort((a, b) => a.localeCompare(b, 'zh-Hant-TW'));
    const matches = filterEntries(source, state);
    const maxPage = Math.max(1, Math.ceil(matches.length / pageSize));
    const pageNumber = Math.min(state.page, maxPage);
    if (pageNumber !== state.page) history.replaceState(null, '', writeListState(locationUrl, { page: pageNumber }).href);
    listResult = {
      entries: source,
      matches,
      shown: pageEntries(sortEntries(matches), pageNumber, pageSize),
      state: { ...state, page: pageNumber },
      categories,
      countLabel: '筆資料'
    };
  }

  const form = element('form', null, 'toolbar');
  const queryField = element('div', null, 'field');
  const queryLabel = element('label', '搜尋');
  const queryId = `search-${kind}-${archetype ?? 'all'}`;
  queryLabel.htmlFor = queryId;
  const query = element('input');
  query.id = queryId;
  query.name = 'q';
  query.type = 'search';
  query.autocomplete = 'off';
  query.placeholder = '輸入名稱或關鍵字';
  query.value = listResult.state.q;
  queryField.append(queryLabel, query);

  const filterField = element('div', null, 'field');
  const filterLabel = element('label', kind === 'skills' && !archetype ? '職業篩選' : '分類篩選');
  const filterId = `filter-${kind}-${archetype ?? 'all'}`;
  filterLabel.htmlFor = filterId;
  const select = element('select');
  select.id = filterId;
  select.name = 'filter';
  const allOption = element('option', kind === 'skills' && !archetype ? '全部職業' : '全部分類');
  allOption.value = '';
  select.append(allOption);
  const options = kind === 'skills' && !archetype
    ? [...new Set(listResult.entries.map(row => row.id))].sort().map(id => ({ value: id, label: archetypeTitle(id) }))
    : (listResult.categories ?? []).map(value => ({ value, label: displayCategory(value) }));
  for (const option of options) {
    const node = element('option', option.label);
    node.value = option.value;
    select.append(node);
  }
  select.value = listResult.state.filter;
  filterField.append(filterLabel, select);
  const submit = element('button', '套用', 'button');
  submit.type = 'submit';
  form.append(queryField, filterField, submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const next = writeListState(new URL(window.location.href), { q: query.value, filter: select.value, page: 1 });
    history.pushState(null, '', next.href);
    showCurrentPage();
  });
  select.addEventListener('change', () => {
    const next = writeListState(new URL(window.location.href), { q: query.value, filter: select.value, page: 1 });
    history.pushState(null, '', next.href);
    showCurrentPage();
  });
  main.append(form);

  const resultNote = element('p', `找到 ${listResult.matches.length} ${listResult.countLabel}`, 'result-note');
  main.append(resultNote);
  if (!listResult.matches.length) {
    const empty = element('section', null, 'empty-state');
    empty.append(element('h2', listResult.state.q || listResult.state.filter ? '沒有符合條件的資料' : '目前沒有資料'));
    empty.append(element('p', listResult.state.q || listResult.state.filter ? '試著調整搜尋文字或篩選條件。' : '這個目錄目前沒有可顯示的項目。'));
    main.append(empty);
    return;
  }

  if (kind === 'skills' && !archetype) {
    const grid = listResult.grid ?? element('ul', null, 'entry-list');
    for (const row of listResult.shown) {
      if (row.kind) continue;
      const item = element('li', null, 'entry-card');
      const group = element('div');
      group.append(makeLink(row.route, row.display_name));
      group.append(element('small', `${row.class_count} 項技能`));
      item.append(group, element('span', '↗', 'entry-arrow'));
      grid.append(item);
    }
    main.append(grid);
  } else {
    const grid = element('ul', null, 'entry-list');
    for (const entry of listResult.shown) {
      const item = element('li', null, 'entry-card');
      const group = element('div');
      group.append(makeLink(entry.route, displayName(entry.name_zh_tw, entry.id)));
      const note = entry.category ?? (entry.kind === 'skill' ? '技能' : entry.kind === 'weapon' ? '武器' : '祝福');
      group.append(element('small', displayCategory(note)));
      if (entry.kind === 'skill') {
        const mechanics = catalog.entries.find(row => row.kind === 'mechanics' && row.id === entry.id);
        if (mechanics) group.append(makeLink(mechanics.route, '機制說明', 'secondary-link'));
      }
      if (entry.kind === 'skill') renderListIcon(item, group, entry);
      item.append(group, element('span', '↗', 'entry-arrow'));
      grid.append(item);
    }
    main.append(grid);
  }
  appendPagination(listResult, locationUrl);
}

function appendPagination(result, currentUrl) {
  const totalPages = Math.max(1, Math.ceil(result.matches.length / pageSize));
  if (totalPages <= 1) return;
  const nav = element('nav', null, 'pagination');
  nav.setAttribute('aria-label', '資料頁碼');
  const addPage = (page, label, current = false) => {
    if (current) {
      const span = element('span', label);
      span.setAttribute('aria-current', 'page');
      nav.append(span);
    } else {
      const url = writeListState(currentUrl, { ...result.state, page });
      nav.append(makeLink(`${url.pathname}${url.search}${url.hash}`, label));
    }
  };
  if (result.state.page > 1) addPage(result.state.page - 1, '上一頁');
  const start = Math.max(1, result.state.page - 2);
  const end = Math.min(totalPages, result.state.page + 2);
  for (let page = start; page <= end; page += 1) addPage(page, String(page), page === result.state.page);
  if (result.state.page < totalPages) addPage(result.state.page + 1, '下一頁');
  main.append(nav);
}

function renderClaims(parent, claims, title) {
  if (!Array.isArray(claims) || !claims.length) return;
  const section = panel(title);
  const list = element('dl', null, 'claim-list');
  for (const claim of claims) {
    const row = element('div', null, 'claim-row');
    row.append(element('dt', claimLabels[claim.claim_id] ?? claim.claim_id));
    const value = claim.state === 'unknown' || claim.value == null
      ? '尚未確認'
      : `${claim.value}${unitLabels[claim.unit] ?? ''}${claim.unit === 'game_unit' && claim.unit_note ? ` ${claim.unit_note}` : ''}`;
    row.append(element('dd', value, claim.state === 'unknown' ? 'unknown' : ''));
    list.append(row);
  }
  section.append(list);
  parent.append(section);
}

function renderAssets(parent, detail, record, entry) {
  if (!detail.assets.length) return;
  const section = panel('相關圖示');
  const grid = element('div', null, 'asset-grid');
  for (const asset of detail.assets) {
    const presentation = assetPresentation(build.data_revision, entry, record, asset);
    const figure = element('figure', null, 'asset-figure');
    const name = presentation.alt;
    const image = element('img');
    image.src = presentation.src;
    image.alt = name;
    image.loading = 'lazy';
    const missing = element('div', `圖片暫時無法載入：${name}`, 'asset-missing');
    missing.hidden = true;
    image.addEventListener('error', () => {
      image.remove();
      missing.hidden = false;
    }, { once: true });
    const caption = element('figcaption');
    if (presentation.credit) {
      const credit = makeLink(presentation.credit.href, presentation.credit.label, 'asset-credit');
      credit.target = '_blank';
      credit.rel = 'noopener';
      caption.append(credit);
    } else {
      caption.append(element('span', '圖片來源尚未確認', 'unknown'));
    }
    figure.append(image, missing, caption);
    grid.append(figure);
  }
  section.append(grid);
  parent.append(section);
}

function renderRelations(parent, relations) {
  if (!relations.length) return;
  const section = panel('關聯資料');
  const list = element('ul', null, 'relation-list');
  for (const relation of relations) {
    const item = element('li');
    const title = labels[relation.kind] ?? '相關資料';
    item.append(element('span', `${title}：`));
    item.append(makeLink(relation.route, displayName(relation.name_zh_tw, relation.id)));
    list.append(item);
  }
  section.append(list);
  parent.append(section);
}

function renderSources(parent, sources) {
  if (!sources.length) return;
  const section = panel('資料來源');
  const list = element('ul', null, 'source-list');
  for (const source of sources) {
    const item = element('li');
    const link = makeLink(source.url, unknownText(source.label, '來源連結'));
    link.target = '_blank';
    link.rel = 'noopener';
    item.append(link);
    list.append(item);
  }
  section.append(list);
  parent.append(section);
}

function detailSummary(entry, record) {
  if (entry.kind === 'skill') return record.effect_zh_tw;
  if (entry.kind === 'mechanics') return record.mechanics_zh_tw ?? record.effect_zh_tw;
  if (entry.kind === 'blessing') return record.effect_zh_tw;
  if (entry.kind === 'weapon') return record.model_zh_tw;
  if (entry.kind === 'mark') return displayCategory(record.category);
  if (entry.kind === 'variant') return record.effect_zh_tw;
  return null;
}

function renderBlessingLevels(parent, levels, catalog, commonEffect) {
  const section = panel('祝福等級');
  section.classList.add('blessing-levels');
  const groups = groupBlessingEffects(levels, catalog);
  if (!groups.length) { section.append(element('p', '來源未提供等級資料。', 'unknown')); parent.append(section); return; }
  const content = element('div', null, 'blessing-selected-effect');
  const lookup = new Map();
  let selection;
  if (groups.length > 1) {
    section.append(element('p', '此祝福的效果、條件或等級數值會隨武器不同。'));
    const field = element('div', null, 'field');
    const label = element('label', '選擇武器'); label.htmlFor = 'blessing-weapon';
    selection = element('select'); selection.id = 'blessing-weapon';
    for (const group of groups) for (const detail of group.levels) {
      const r = detail.record;
      const weapon = catalog.entries.find(e => e.kind === 'weapon' && e.id === r.weapon_id);
      const option = element('option', weapon ? displayName(weapon.name_zh_tw, weapon.id) : r.weapon_id);
      option.value = r.variant_id; selection.append(option); lookup.set(r.variant_id, group);
    }
    field.append(label,selection); section.append(field);
  } else section.append(element('p', '適用武器的效果與等級數值相同，以下統一顯示。', 'result-note'));
  function show(group) {
    content.replaceChildren();
    const card = element('section', null, 'level-card');
    card.dataset.variantIds = group.levels.map(d=>d.record.variant_id).join(' ');
    card.dataset.variantId = selection?.value ?? group.record.variant_id;
    card.dataset.weaponId = group.levels.find(d=>d.record.variant_id===card.dataset.variantId)?.record.weapon_id ?? group.record.weapon_id;
    const availabilityNote = blessingAvailabilityNote(group.levels.map(detail => detail.record));
    if (availabilityNote) card.append(element('p', availabilityNote, 'tier-availability result-note'));
    if (group.effect && group.effect.trim() !== commonEffect?.trim()) { card.append(element('h3', groups.length > 1 ? '此武器的效果' : '等級效果'), mechanicsList(group.effect)); }
    const tiers = group.record.defined_tiers ?? [];
    const claims = new Map((group.record.tier_claims ?? []).map(t=>[t.tier,t.claims]));
    const ids = [...new Set([...claims.values()].flat().filter(x=>x.state==='known').map(x=>x.claim_id))];
    if (ids.length) {
      const table = element('table', null, 'tier-table');
      table.append(element('caption', '各等級數值'));
      const head = element('tr'); head.append(element('th','效果'));
      for (const tier of tiers) head.append(element('th','等級 '+tier));
      const thead = element('thead'); thead.append(head);table.append(thead);
      const body = element('tbody');
      for (const id of ids) {
        const row = element('tr'); const label=element('th',claimLabels[id] ?? id);label.scope='row';row.append(label);
        for (const tier of tiers) {
          const claim=claims.get(tier)?.find(x=>x.claim_id===id && x.state==='known');
          row.append(element('td', claim ? claim.value+(['bullets-transferred','maximum-critical-shots'].includes(claim.claim_id) ? '發' : unitLabels[claim.unit] ?? '')+(claim.unit==='game_unit' && claim.unit_note ? ' '+claim.unit_note : '') : '未收錄'));
        }
        body.append(row);
      }
      table.append(body);const wrap=element('div',null,'tier-table-scroll');wrap.append(table);card.append(wrap);
    } else card.append(element('p', '等級 '+tiers.join('、')+' 的效果請見上述說明。'));
    const missing = [...new Set([...claims.values()].flat().filter(x=>x.state!=='known').map(x=>claimLabels[x.claim_id] ?? x.claim_id))];
    if (missing.length) {
      const disclosure=element('details',null,'data-limitations');
      disclosure.append(element('summary', '資料限制：'+missing.length+' 項數值未核實'));
      disclosure.append(element('p', '來源未核實：'+missing.join('、')+'。這些數值未列入上表，也不代表數值為零。'));
      card.append(disclosure);
    }
    content.append(card);
  }
  selection?.addEventListener('change',()=>show(lookup.get(selection.value)));
  show(groups[0]);section.append(content);parent.append(section);
}

function renderTalentTree(tree, catalog) {
  const controls = element('div', null, 'tree-controls');
  const zoomLabel = element('label', '縮放');
  zoomLabel.htmlFor = 'tree-zoom';
  const zoom = element('input');
  zoom.type = 'range'; zoom.id = 'tree-zoom'; zoom.min = '50'; zoom.max = '150'; zoom.step = '5'; zoom.value = '100';
  const zoomValue = element('output', '100%');
  zoomValue.htmlFor = zoom.id;
  controls.append(zoomLabel, zoom, zoomValue);
  main.append(controls, element('p', '點選節點查看效果與機制。可縮放或在樹內捲動；連線顯示原始天賦結構。', 'result-note'));
  const layout = element('div', null, 'tree-layout');
  const viewport = element('div', null, 'tree-viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', '天賦樹，可水平與垂直捲動');
  const canvas = element('div', null, 'tree-canvas');
  const minX = Math.min(...tree.nodes.map(row => row.x)) - 80;
  const minY = Math.min(...tree.nodes.map(row => row.y)) - 80;
  const width = Math.max(...tree.nodes.map(row => row.x)) - minX + 80;
  const height = Math.max(...tree.nodes.map(row => row.y)) - minY + 80;
  const nodeMap = new Map(tree.nodes.map(row => [row.node_id, row]));
  const entryMap = new Map(catalog.entries.filter(row => row.kind === 'skill').map(row => [row.id, row]));
  const details = new Map(tree.details.map(row => [row.record.skill_id, row]));
  const namespace = 'http://www.w3.org/2000/svg';
  const lines = document.createElementNS(namespace, 'svg');
  lines.setAttribute('aria-hidden', 'true');
  lines.classList.add('tree-lines');
  const edgeElements = [];
  const buttons = [];
  let scale = 1;
  const spacing = 1.25;
  const selectedPanel = panel('技能詳情');
  selectedPanel.id = 'tree-detail-panel';
  selectedPanel.classList.add('tree-detail');
  selectedPanel.tabIndex = -1;
  selectedPanel.setAttribute('aria-live', 'polite');
  selectedPanel.append(element('p', '選擇樹上的節點，查看技能效果與條列機制。', 'unknown'));
  for (const node of tree.nodes) {
    for (const childId of node.children) {
      const child = nodeMap.get(childId);
      const line = document.createElementNS(namespace, 'line');
      line.dataset.sourceNode = node.node_id; line.dataset.targetNode = childId;
      lines.append(line);
      edgeElements.push({ line, node, child });
    }
  }
  canvas.append(lines);
  for (const node of tree.nodes) {
    const entry = node.skill_id ? entryMap.get(tree.archetype + '/' + node.skill_id) : null;
    const detail = details.get(node.skill_id);
    const name = entry ? displayName(entry.name_zh_tw, entry.id) : node.type === 'start' ? '天賦樹起點' : displayName(null, node.skill_id ?? node.node_id);
    const button = element('button', null, 'talent-node');
    button.type = 'button';
    button.dataset.nodeId = node.node_id;
    button.dataset.nodeType = node.type;
    button.setAttribute('aria-label', name);
    button.setAttribute('aria-pressed', 'false');
    button.title = name;
    const fallback = document.createElementNS(namespace, 'svg');
    fallback.classList.add('talent-icon-fallback');
    fallback.setAttribute('viewBox', '0 0 32 32');
    fallback.setAttribute('aria-hidden', 'true');
    const symbol = document.createElementNS(namespace, 'path');
    symbol.setAttribute('d', node.type === 'start'
      ? 'M16 3 27 8v9c0 6-11 12-11 12S5 23 5 17V8Z M16 9v13 M10 15h12'
      : 'M16 4 20 12 28 16 20 20 16 28 12 20 4 16 12 12Z');
    fallback.append(symbol);
    button.append(fallback);
    if (detail?.assets.length) {
      const asset = detail.assets[0];
      const image = element('img');
      image.alt = ''; image.loading = 'eager'; image.decoding = 'async'; image.hidden = true;
      image.addEventListener('load', () => { fallback.setAttribute('hidden', ''); image.hidden = false; }, { once: true });
      image.addEventListener('error', () => { image.hidden = true; }, { once: true });
      image.src = assetPresentation(build.data_revision, entry, detail.record, asset).src;
      button.append(image);
    }
    button.addEventListener('click', () => {
      for (const row of buttons) row.button.setAttribute('aria-pressed', row.button === button ? 'true' : 'false');
      selectedPanel.replaceChildren(element('h2', name));
      if (detail && entry) {
        selectedPanel.append(element('h3', '技能效果'), mechanicsList(detail.record.effect_zh_tw));
        if (detail.record.mechanics_zh_tw) selectedPanel.append(element('h3', '機制說明'), mechanicsList(detail.record.mechanics_zh_tw));
        selectedPanel.append(makeLink(entry.route, '開啟技能詳情', 'button secondary'));
        renderAssets(selectedPanel, detail, detail.record, entry);
      } else selectedPanel.append(element('p', node.type === 'start' ? '此節點為天賦樹起點。' : '此節點的技能資料尚未確認。', 'unknown'));
      if (window.matchMedia('(max-width: 900px)').matches) { selectedPanel.scrollIntoView({ block: 'nearest' }); selectedPanel.focus({ preventScroll: true }); }
    });
    canvas.append(button); buttons.push({ button, node });
  }
  function resize() {
    scale = Number(zoom.value) / 100;
    zoomValue.textContent = zoom.value + '%';
    canvas.style.width = width * scale * spacing + 'px'; canvas.style.height = height * scale * spacing + 'px';
    lines.setAttribute('width', width * scale * spacing); lines.setAttribute('height', height * scale * spacing);
    for (const { button, node } of buttons) {
      const size = (node.type === 'stat' ? 50 : node.type === 'start' ? 96 : 72) * scale;
      button.style.width = size + 'px'; button.style.height = size + 'px';
      button.style.left = (node.x - minX) * scale * spacing + 'px'; button.style.top = (node.y - minY) * scale * spacing + 'px';
    }
    for (const { line, node, child } of edgeElements) {
      line.setAttribute('x1', (node.x - minX) * scale * spacing); line.setAttribute('y1', (node.y - minY) * scale * spacing);
      line.setAttribute('x2', (child.x - minX) * scale * spacing); line.setAttribute('y2', (child.y - minY) * scale * spacing);
    }
  }
  zoom.addEventListener('input', resize); resize();
  viewport.append(canvas); layout.append(viewport, selectedPanel); main.append(layout);
  viewport.scrollLeft = Math.max(0, (width * scale * spacing - viewport.clientWidth) / 2);
  const credit = makeLink('https://darktide.gameslantern.com/', '圖示素材來源：Games Lantern', 'asset-credit');
  if (tree.details.some(detail => detail.assets.some(asset => asset.path === null))) main.append(credit);
  renderSources(main, tree.sources);
}

function renderDetailPage(page, catalog) {
  const { entry, detail } = page;
  const record = detail.record;
  const title = displayName(entry.name_zh_tw, entry.id);
  setSeo(title, `${labels[entry.kind]}：${title}`);
  const backRoute = entry.kind === 'skill' || entry.kind === 'mechanics'
    ? `/skills/${record.archetype}/`
    : entry.kind === 'weapon' || entry.kind === 'mark' ? '/weapons/' : '/blessings/';
  const breadcrumb = element('nav', null, 'breadcrumb');
  breadcrumb.setAttribute('aria-label', '所在位置');
  breadcrumb.append(makeLink('/', '首頁'), document.createTextNode(' / '), makeLink(backRoute, labels[entry.kind]), document.createTextNode(' / '));
  main.append(breadcrumb);

  const heading = element('header', null, 'detail-heading');
  heading.append(element('p', labels[entry.kind], 'eyebrow'));
  heading.append(element('h1', title));
  main.append(heading);

  const grid = element('div', null, 'detail-grid');
  const primary = element('div', null, 'detail-column');
  const summary = entry.kind === 'mark' && !record.category
    ? displayCategory(catalog.entries.find(e=>e.kind==='weapon' && e.id===record.weapon_id)?.category)
    : detailSummary(entry, record);
  const summaryTitle = entry.kind === 'mechanics' ? (record.mechanics_zh_tw ? '機制說明' : '技能效果（來源未另提供機制說明）') : entry.kind === 'weapon' ? '武器資訊' : entry.kind === 'mark' ? '型號分類' : entry.kind === 'skill' ? '技能效果' : entry.kind === 'blessing' ? '祝福效果' : '內容說明';
  const summaryPanel = panel(summaryTitle);
  if (entry.kind === 'weapon' && !summary) summaryPanel.append(element('p', title));
  else summaryPanel.append(['skill', 'mechanics', 'blessing', 'variant'].includes(entry.kind) ? mechanicsList(summary) : textValue(summary));
  if (entry.kind === 'weapon') {
    const weaponCategory = displayCategory(record.category ?? record.kind ?? null);
    summaryPanel.append(element('p', `武器類別：${unknownText(weaponCategory)}`, weaponCategory == null ? 'unknown' : ''));
  }
  if (entry.kind === 'blessing' && record.trigger_zh_tw) summaryPanel.append(element('p', `觸發條件：${unknownText(record.trigger_zh_tw)}`, record.trigger_zh_tw == null ? 'unknown' : ''));
  primary.append(summaryPanel);
  if (entry.kind !== 'mechanics') renderClaims(primary, record.claims, entry.kind === 'weapon' ? '武器數值' : entry.kind === 'mark' ? '型號數值' : '技能數值');
  if (entry.kind === 'variant') {
    renderBlessingLevels(primary, [detail], catalog, record.effect_zh_tw);
  }
  if (entry.kind === 'blessing') renderBlessingLevels(primary, page.levels ?? [], catalog, record.effect_zh_tw);
  renderAssets(primary, detail, record, entry);
  renderRelations(primary, browsingRelations(entry.kind, detail.relations));
  renderSources(primary, detail.sources);
  grid.append(primary);
  const aside = element('aside', null, 'detail-column');
  const about = panel('關於這筆資料');
  about.append(element('p', `資料類別：${labels[entry.kind]}`));
  if (record.category != null && entry.kind !== 'mechanics') {
    const category = displayCategory(record.category);
    about.append(element('p', `分類：${unknownText(category)}`, category == null ? 'unknown' : ''));
  }
  const back = makeLink(backRoute, '返回目錄', 'button secondary');
  about.append(back);
  aside.append(about);
  grid.append(aside);
  main.append(grid);
  buildFooter(catalog);
}

function renderNotFound() {
  setSeo('找不到頁面', '這個網址沒有對應的資料。請從目錄重新查找。', { noindex: true });
  const section = element('section', null, 'error-state');
  section.append(element('p', '404 · 找不到頁面', 'eyebrow'));
  section.append(element('h1', '找不到這筆資料'));
  section.append(element('p', '這個網址沒有對應的資料，或目錄中尚未收錄。'));
  const actions = element('div', null, 'error-actions');
  actions.append(makeLink('/', '回到首頁', 'button-link'));
  actions.append(makeLink('/skills/', '技能目錄', 'button secondary'));
  actions.append(makeLink('/weapons/', '武器目錄', 'button secondary'));
  actions.append(makeLink('/blessings/', '祝福目錄', 'button secondary'));
  section.append(actions);
  main.append(section);
}

function renderError(error) {
  setSeo(error.name === 'UpdateAvailableError' ? '資料已有更新' : '資料載入失敗', '資料目前無法顯示。', { noindex: true });
  const section = element('section', null, 'error-state');
  if (error.name === 'UpdateAvailableError') {
    section.append(element('p', '資料版本已更新', 'eyebrow'));
    section.append(element('h1', '請重新載入目前頁面'));
    section.append(element('p', '目前網址指向的資料版本已更新。重新載入後會使用新版資料，並保留這個頁面位置。'));
    const link = makeLink(error.location ?? window.location.href, '重新載入目前頁面', 'button-link');
    link.dataset.fullReload = 'true';
    section.append(link);
  } else {
    section.append(element('p', '暫時無法讀取', 'eyebrow'));
    section.append(element('h1', '資料載入失敗'));
    section.append(element('p', '可能是網路中斷或資料格式暫時無法讀取。請重試。'));
    section.append(makeButton('重試', () => showCurrentPage(true)));
    const home = makeLink('/', '回到首頁', 'button secondary');
    section.append(home);
  }
  main.append(section);
}

function renderState(state) {
  main.replaceChildren();
  if (state.type === 'loading') {
    setSeo('載入中', '正在讀取資料。', { noindex: true });
    const note = element('p', '正在載入資料…', 'loading-note');
    note.setAttribute('role', 'status');
    main.append(note);
    return;
  }
  if (state.type === 'error') {
    renderError(state.error);
    return;
  }
  const page = state.value;
  if (page.type === 'reloading') { main.append(element('p', '正在載入新版網站…', 'loading-note')); return; }
  if (page.type === 'not-found') {
    renderNotFound();
    main.focus();
    return;
  }
  if (page.type === 'home') renderHome(page.catalog);
  else if (page.type === 'list') renderListPage(page, page.catalog, new URL(window.location.href));
  else renderDetailPage(page, page.catalog);
  main.focus();
}

let loadedCatalog = null;
const dataClient = createDataClient({ build });

async function readCatalog(force) {
  if (!force && loadedCatalog) return loadedCatalog;
  loadedCatalog = await dataClient.loadCatalog({ force });
  return loadedCatalog;
}

async function loadCurrentLocation(request, { isCurrent } = {}) {
  const url = new URL(request.href, window.location.origin);
  if (await dataClient.hasBuildUpdate() && (!isCurrent || isCurrent())) {
    window.location.replace(url.href);
    return { type: 'reloading' };
  }
  const catalog = await readCatalog(request.force);
  let route = resolveCatalogRoute(url.pathname, catalog);
  if (route.type === 'redirect') {
    if (isCurrent && !isCurrent()) return { type: 'not-found', catalog };
    const destination = makeRedirectUrl(url, route.target_route);
    history.replaceState(null, '', `${destination.pathname}${destination.search}${destination.hash}`);
    url.pathname = destination.pathname;
    route = resolveCatalogRoute(url.pathname, catalog);
  }
  if (route.type === 'home') return { type: 'home', catalog };
  if (route.type === 'list') {
    const metadata = route.kind === 'skills' && route.archetype && preferredSkillView(url, true) === 'tree'
      ? catalog.talent_trees?.find(row => row.archetype === route.archetype) : null;
    const tree = metadata ? await dataClient.loadTree(metadata, { force: request.force }) : null;
    return { ...route, catalog, tree };
  }
  if (route.type === 'entry') {
    const detail = await dataClient.loadDetail(route.entry, { force: request.force });
    const levels = route.entry.kind === 'blessing'
      ? await dataClient.loadBlessingLevels(detail, { force: request.force }) : null;
    return { type: 'detail', entry: route.entry, detail, catalog, levels };
  }
  return { type: 'not-found', catalog };
}

const navigation = createNavigationController({ load: loadCurrentLocation, render: renderState });
const sharedMode = hasSharedContext(build);
const sharedClient = sharedMode ? createSharedClient({ build }) : null;
let sharedLoadPromise = null;
let sharedNavigationGeneration = 0;

async function showSharedPage(force = false) {
  const generation = ++sharedNavigationGeneration;
  const url = new URL(window.location.href);
  if (force || !sharedLoadPromise) sharedLoadPromise = sharedClient.load();
  if (!sharedLoadPromise) {
    renderSharedPage({ main, buildMeta, url, error: new Error('shared load unavailable') });
    return;
  }
  if (sharedLoadPromise && !sharedLoadPromise.result) {
    renderSharedPage({ main, buildMeta, url, result: { status: 'loading' } });
  }
  try {
    const result = await sharedLoadPromise;
    if (generation !== sharedNavigationGeneration) return;
    sharedLoadPromise.result = result;
    renderSharedPage({ main, buildMeta, result, url });
  } catch (error) {
    if (generation !== sharedNavigationGeneration) return;
    sharedLoadPromise = null;
    renderSharedPage({ main, buildMeta, url, error });
  }
}

function showCurrentPage(force = false) {
  if (sharedMode) return showSharedPage(force);
  const request = { href: window.location.href, force };
  return navigation.navigate(request);
}

window.addEventListener('popstate', () => showCurrentPage());
document.addEventListener('click', event => {
  const link = event.target.closest?.('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      link.target === '_blank' || link.hasAttribute('download') || link.dataset.fullReload === 'true') return;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return;
  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
  event.preventDefault();
  history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
  showCurrentPage();
});

if (!sharedMode && buildMeta && build && typeof build.data_revision === 'string') {
  buildMeta.textContent = `遊戲版本 ${unknownText(build.game_version)} · 資料版本 ${build.data_revision.slice(0, 12)}`;
}
showCurrentPage();






