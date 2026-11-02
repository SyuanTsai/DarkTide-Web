import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedViewModel } from '../web/shared-view.mjs';
import { renderSharedPage } from '../web/shared-render.mjs';
import { RELEASE, refs, makeWeaponDomain } from './w11-shared-view.fixture.mjs';

class FakeTextNode {
  constructor(text) { this.nodeType = 3; this.textContent = String(text); }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.nodeType = 1;
    this.tagName = tagName;
    this.childNodes = [];
    this.attributes = new Map();
    this.dataset = {};
    this._textContent = '';
  }
  append(...nodes) { this.childNodes.push(...nodes); }
  replaceChildren(...nodes) { this.childNodes = nodes; this._textContent = ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener() {}
  focus() {}
  querySelectorAll() { return []; }
  insertBefore(node, before) {
    const index = this.childNodes.indexOf(before);
    if (index < 0) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
  }
  set textContent(value) { this._textContent = String(value); this.childNodes = []; }
  get textContent() { return this._textContent + this.childNodes.map(node => node.textContent ?? '').join(''); }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
}

function renderContext() {
  const main = new FakeElement('main');
  const buildMeta = new FakeElement('p');
  const head = new FakeElement('head');
  const documentImpl = {
    head,
    title: '',
    createElement: tag => new FakeElement(tag),
    createTextNode: text => new FakeTextNode(text),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return { main, buildMeta, documentImpl };
}

function elementsWithClass(root, className) {
  const result = [];
  const visit = element => {
    if (element?.nodeType !== 1) return;
    if (element.className === className) result.push(element);
    element.childNodes.forEach(visit);
  };
  visit(root);
  return result;
}

function incompleteFamilyResult() {
  const domain = makeWeaponDomain();
  for (const record of domain.source.records.filter(row => row.kind === 'weapon')) {
    record.payload.templateKey = record.payload.markId;
  }
  domain.web.presentations = domain.web.presentations.filter(
    presentation => presentation.entityRef.recordId !== refs.weaponXii.recordId,
  );
  return {
    status: 'ready',
    fixtureOnly: true,
    pointer: { game_version: '1.13.4', data_revision: 'f'.repeat(64) },
    manifest: { gameReleaseId: RELEASE },
    domains: [domain],
    view: createSharedViewModel({ domains: [domain], gameReleaseId: RELEASE }),
  };
}

function renderRoute(result, pathname) {
  const context = renderContext();
  const pageUrl = new URL(pathname, 'https://example.test');
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = context.documentImpl;
  globalThis.window = {
    location: { href: pageUrl.href, pathname: pageUrl.pathname, search: pageUrl.search, hash: pageUrl.hash },
    history: { replaceState() {} },
  };
  try {
    renderSharedPage({
      main: context.main,
      buildMeta: context.buildMeta,
      result,
      url: pageUrl,
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  return context.main;
}

// Scenario: A family has one complete mark and a sibling Source mark without a Web presentation.
// Purpose: Verify the actual renderer keeps the ready mark visible while the missing mark stays explicitly unknown and contributes no values.
// Given the partial family fixture, When the ready or missing mark route is rendered, Then the ready details remain intact and the missing ID is fail-closed.
test('UnitT10_renders_ready_weapon_mark_and_keeps_missing_sibling_unresolved', () => {
  const result = incompleteFamilyResult();

  const readyMarkPage = renderRoute(result, '/weapons/?family=chainaxe-p1&mark=mark-iv');
  const readyMarkText = readyMarkPage.textContent;
  assert.equal(elementsWithClass(readyMarkPage, 'shared-official-text')[0]?.textContent, '突擊鏈斧');
  assert.match(readyMarkText, /mark-xii/u, 'the sibling ID remains visible on the ready mark page');
  assert.match(readyMarkText, /尚無|尚未確認|無法確認|待確認/u, 'the sibling is explicitly labeled as unverified');
  assert.doesNotMatch(readyMarkText, /\b96\b/u, 'the missing sibling contributes no values');

  const familyDirectory = renderRoute(result, '/weapons/');
  assert.match(familyDirectory.textContent, /突擊鏈斧 · 2 個型號/u, 'the directory count includes the known unresolved mark identity');
  assert.match(familyDirectory.textContent, /尚無已驗證詳情的型號 ID：mark-xii/u, 'the directory lists the unresolved mark ID');

  const missingMarkPage = renderRoute(result, '/weapons/?family=chainaxe-p1&mark=mark-xii');
  const failure = elementsWithClass(missingMarkPage, 'shared-failure')[0];
  assert.ok(failure, 'a mark without a verified presentation remains fail-closed');
  assert.match(missingMarkPage.textContent, /mark-xii/u, 'direct navigation identifies the unresolved mark');
  assert.match(missingMarkPage.textContent, /尚無|尚未確認|無法確認|待確認/u, 'direct navigation labels the mark as unknown');
  assert.doesNotMatch(missingMarkPage.textContent, /\b96\b/u, 'direct navigation never shows another mark\'s values');
});

// Scenario: No mark in a known family has a valid Web presentation.
// Purpose: Keep the existing fail-closed boundary when no verified family details are available.
// Given a family with every mark presentation removed, When a mark route is rendered, Then no official weapon text or source values are shown.
test('UnitT20_keeps_family_fail_closed_when_no_mark_is_ready', () => {
  const result = incompleteFamilyResult();
  result.domains[0].web.presentations = [];
  result.view = createSharedViewModel({ domains: result.domains, gameReleaseId: RELEASE });

  const page = renderRoute(result, '/weapons/?family=chainaxe-p1&mark=mark-iv');

  assert.ok(elementsWithClass(page, 'shared-failure').length > 0);
  assert.equal(elementsWithClass(page, 'shared-official-text').length, 0);
  assert.doesNotMatch(page.textContent, /\b80\b|\b96\b/u);
});
