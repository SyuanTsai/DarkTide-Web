import assert from 'node:assert/strict';
import test from 'node:test';

import { renderSharedPage } from '../web/shared-render.mjs';

const CURRENT_RELEASE = 'darktide:1.13.4';
const CURRENT_BLESSING_ID = 'darktide:blessing:chainaxe:p1-movement-speed-on-activation';
const RETAINED_ALIAS_ID = 'rev-it-up';
const RETAINED_ALIAS_VARIANT_ID = 'weapon_trait_bespoke_chainaxe_p1_movement_speed_on_activation';

class FakeElement {
  constructor(tagName = 'div') {
    this.nodeType = 1;
    this.tagName = tagName;
    this.childNodes = [];
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this._textContent = '';
    this._className = '';
  }
  append(...nodes) { this.childNodes.push(...nodes); }
  replaceChildren(...nodes) { this.childNodes = [...nodes]; this._textContent = ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener() {}
  focus() {}
  insertBefore(element, before) {
    const index = this.childNodes.indexOf(before);
    if (index < 0) this.childNodes.push(element);
    else this.childNodes.splice(index, 0, element);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const matches = [];
    const visit = element => {
      if (!element || element.nodeType !== 1) return;
      if (matchesSelector(element, selector)) matches.push(element);
      element.childNodes.forEach(visit);
    };
    this.childNodes.forEach(visit);
    return matches;
  }
  set textContent(value) { this._textContent = String(value); this.childNodes = []; }
  get textContent() { return this._textContent + this.childNodes.map(child => child.textContent ?? '').join(''); }
  set className(value) { this._className = String(value); }
  get className() { return this._className; }
  get classList() {
    const classes = new Set(this._className.split(/\s+/u).filter(Boolean));
    return { contains: value => classes.has(value) };
  }
  get children() { return this.childNodes.filter(child => child.nodeType === 1); }
}

function matchesSelector(element, selector) {
  const classMatch = /^\.([\w-]+)/u.exec(selector);
  if (classMatch && !element.classList.contains(classMatch[1])) return false;
  for (const [, dataAttribute] of selector.matchAll(/\[data-([\w-]+)\]/gu)) {
    const datasetKey = dataAttribute.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    if (!Object.hasOwn(element.dataset, datasetKey)) return false;
  }
  return true;
}

function elementsWithClass(root, className) {
  const found = [];
  const visit = element => {
    if (!element || element.nodeType !== 1) return;
    if (element.classList.contains(className)) found.push(element);
    element.childNodes.forEach(visit);
  };
  visit(root);
  return found;
}

function currentDomain() {
  return {
    kind: 'blessings',
    web: {
      presentations: [{
        authoringId: 'current-chainaxe-rev-it-up',
        locale: 'zh-TW',
        entityRef: { gameReleaseId: CURRENT_RELEASE, kind: 'blessing', recordId: CURRENT_BLESSING_ID },
        tierApplicability: [{
          variantRef: { gameReleaseId: CURRENT_RELEASE, kind: 'variant', recordId: 'current-chainaxe-rev-it-up-4' },
          tiers: [4],
        }],
      }],
    },
    source: { records: [] },
  };
}

function retainedBlessingEntries({ includeOrdinaryParent = true } = {}) {
  const entries = [
    {
      kind: 'blessing', id: RETAINED_ALIAS_ID, name_zh_tw: '提速', route: '/blessings/rev-it-up/',
    },
    {
      kind: 'variant', id: RETAINED_ALIAS_VARIANT_ID, name_zh_tw: '提速（鏈斧變體）',
      route: `/blessings/${RETAINED_ALIAS_ID}/variants/${RETAINED_ALIAS_VARIANT_ID}/`,
    },
  ];
  if (includeOrdinaryParent) {
    entries.push(
      { kind: 'blessing', id: 'ordinary-parent', name_zh_tw: '一般祝福', route: '/blessings/ordinary-parent/' },
      { kind: 'variant', id: 'ordinary-variant', name_zh_tw: '一般祝福變體', route: '/blessings/ordinary-parent/variants/ordinary-variant/' },
    );
  }
  return entries;
}

function renderBlessingDirectory({ aliasParentSummary, aliasVariantSummary, ordinaryParentSummary, ordinaryVariantSummary }) {
  const entries = retainedBlessingEntries();
  const summaryEntries = [];
  if (aliasParentSummary !== undefined) summaryEntries.push({ kind: 'blessing', id: RETAINED_ALIAS_ID, summary: aliasParentSummary });
  if (aliasVariantSummary !== undefined) summaryEntries.push({ kind: 'variant', id: RETAINED_ALIAS_VARIANT_ID, summary: aliasVariantSummary });
  if (ordinaryParentSummary !== undefined) summaryEntries.push({ kind: 'blessing', id: 'ordinary-parent', summary: ordinaryParentSummary });
  if (ordinaryVariantSummary !== undefined) summaryEntries.push({ kind: 'variant', id: 'ordinary-variant', summary: ordinaryVariantSummary });
  const historyPackage = {
    catalog: {
      counts: { blessings: 2, variants: 2 },
      entries,
    },
    projection: { gameVersion: '1.13.1', entries: summaryEntries },
  };
  const result = {
    status: 'ready',
    pointer: { game_version: '1.13.4', data_revision: 'a'.repeat(64) },
    manifest: { gameReleaseId: CURRENT_RELEASE },
    domains: [currentDomain()],
    view: {
      getBlessing: () => ({
        status: 'ready', name: '提速 LV4', official: { resolvedText: '特殊動作啟動後效果' },
      }),
    },
  };
  const url = new URL('https://example.test/blessings/');
  const main = new FakeElement('main');
  const buildMeta = new FakeElement('p');
  const documentImpl = {
    head: new FakeElement('head'),
    title: '',
    createElement: tag => new FakeElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = documentImpl;
  globalThis.window = {
    location: { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash },
    history: { replaceState() {} },
  };
  try {
    renderSharedPage({ main, buildMeta, result, url, historyPackage });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  return main;
}

function summaryTexts(row) {
  return elementsWithClass(row, 'shared-history-summary').map(element => element.textContent);
}

test('UnitT10_deduplicates_exactly_equal_parent_and_variant_summaries_for_retained_and_current_alias_rows', () => {
  const sameSummary = '同一段已核實的 1.13.1 效果摘要';
  const page = renderBlessingDirectory({
    aliasParentSummary: sameSummary,
    aliasVariantSummary: sameSummary,
    ordinaryParentSummary: sameSummary,
    ordinaryVariantSummary: sameSummary,
  });
  const aliasRow = elementsWithClass(page, 'shared-current-blessing')
    .find(row => row.dataset.currentBlessingId === CURRENT_BLESSING_ID);
  const ordinaryRow = elementsWithClass(page, 'shared-history-blessing')
    .find(row => row.dataset.retainedBlessingId === 'ordinary-parent');
  assert.deepEqual(summaryTexts(aliasRow), [`1.13.1 留存摘要：${sameSummary}`]);
  assert.deepEqual(summaryTexts(ordinaryRow), [`摘要：${sameSummary}`]);
  assert.match(aliasRow.textContent, /資料基準 1\.13\.1/u);
});

test('UnitT20_keeps_variant_summary_when_its_text_differs_from_the_parent', () => {
  const page = renderBlessingDirectory({
    aliasParentSummary: '父項摘要',
    aliasVariantSummary: '變體有不同條件的摘要',
    ordinaryParentSummary: '父項摘要',
    ordinaryVariantSummary: '變體有不同條件的摘要',
  });
  const aliasRow = elementsWithClass(page, 'shared-current-blessing')
    .find(row => row.dataset.currentBlessingId === CURRENT_BLESSING_ID);
  const ordinaryRow = elementsWithClass(page, 'shared-history-blessing')
    .find(row => row.dataset.retainedBlessingId === 'ordinary-parent');
  assert.deepEqual(summaryTexts(aliasRow), ['1.13.1 留存摘要：父項摘要', '摘要：變體有不同條件的摘要']);
  assert.deepEqual(summaryTexts(ordinaryRow), ['摘要：父項摘要', '摘要：變體有不同條件的摘要']);
});

test('UnitT30_keeps_variant_summary_when_the_parent_has_no_summary', () => {
  const page = renderBlessingDirectory({
    aliasVariantSummary: '父項缺摘要時仍要顯示的變體效果',
    ordinaryVariantSummary: '父項缺摘要時仍要顯示的變體效果',
  });
  const aliasRow = elementsWithClass(page, 'shared-current-blessing')
    .find(row => row.dataset.currentBlessingId === CURRENT_BLESSING_ID);
  const ordinaryRow = elementsWithClass(page, 'shared-history-blessing')
    .find(row => row.dataset.retainedBlessingId === 'ordinary-parent');
  assert.deepEqual(summaryTexts(aliasRow), ['摘要：父項缺摘要時仍要顯示的變體效果']);
  assert.deepEqual(summaryTexts(ordinaryRow), ['摘要：父項缺摘要時仍要顯示的變體效果']);
  assert.match(aliasRow.textContent, /資料基準 1\.13\.1/u);
});
