import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderSharedPage } from '../web/shared-render.mjs';

class Element {
  constructor(tag) { this.tagName = tag; this.childNodes = []; this.dataset = {}; this.value = ''; }
  append(...nodes) { this.childNodes.push(...nodes); }
  replaceChildren(...nodes) { this.childNodes = nodes; this.value = ''; }
  removeAttribute() {} setAttribute() {} focus() {}
  set textContent(value) { this.value = String(value); this.childNodes = []; }
  get textContent() { return this.value + this.childNodes.map(n => n.textContent).join(''); }
  querySelector(tag) { return this.childNodes.find(n => n.tagName === tag) ?? null; }
}
function render(route, domains, search = '') {
  const original = globalThis.document;
  globalThis.document = { head: new Element('head'), createElement: tag => new Element(tag), querySelector: () => null, querySelectorAll: () => [] };
  const main = new Element('main'); const url = new URL(`https://example.test/${route}/${search}`);
  try { renderSharedPage({ main, buildMeta: new Element('p'), url, result: { sourceData: true, manifest: { gameVersion: '1.0', dataRevision: 'a'.repeat(64) }, versions: [], domains } }); }
  finally { globalThis.document = original; }
  return main;
}
// Scenario: A new blessing carries an unofficial effect and four nonempty mechanics.
// Purpose: Check rendered labels, ordering, and preservation of the old layout.
test('UnitT10_祝福新舊版面與翻譯標籤', () => {
  const item = { id:'darktide:blessing:test', name:{ zh:'祝福', origin:'official' }, official:{ zh:null,en:'original' }, explanation:{ effect:'效果內容',conditions:'條件內容',calculation:'計算內容',notes:'補充內容',extra:'額外內容' }, errata:[], values:{params:{},tiers:[]} };
  const page = version => render('blessings', [{ kind:'blessing', document:{ schemaVersion:version, items:[item] } }, { kind:'blessings-index', document:{ items:[] } }], '?id=darktide%3Ablessing%3Atest');
  const modern = page('1.1.0').textContent; assert.match(modern, /非官方翻譯/); assert.match(modern, /效果內容.*英文原文.*實際運作機制.*條件內容.*計算內容.*補充內容.*額外內容/);
  const legacy = page('1.0.0').textContent; assert.doesNotMatch(legacy, /非官方翻譯|實際運作機制/); assert.match(legacy, /官方原文.*效果內容/);
  item.official.zh = '官方內容'; assert.doesNotMatch(page('1.1.0').textContent, /非官方翻譯|官方內容/);
});

// Scenario: The terms page receives the captured reference domain.
// Purpose: Display all seven rules as community reference text.
test('InterT20_術語頁呈現七條社群規則', async () => {
  const sidecar = JSON.parse(await readFile(new URL('../content/reference/term-rules/v1.json', import.meta.url)));
  const main = render('terms', [{kind:'terms', document:{items:[]}}, {kind:'term-rules',document:sidecar}]);
  assert.match(main.textContent, /術語譯名規則.*社群譯名規則，非遊戲官方術語/);
  for (const rule of sidecar.rules.rules) assert.ok(main.textContent.includes(`${rule.sourceText} → ${rule.targetText}`));
});
