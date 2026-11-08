import { renderSharedPage } from '../web/shared-render.mjs';
export class Element {
  constructor(tag) { this.tagName=tag; this.childNodes=[]; this.dataset={}; this.value=''; this.attributes={}; }
  append(...nodes) { this.childNodes.push(...nodes); }
  replaceChildren(...nodes) { this.childNodes=nodes; this.value=''; }
  removeAttribute() {} setAttribute(k,v) { this.attributes[k]=v; } focus() {}
  set textContent(v) { this.value=String(v); this.childNodes=[]; }
  get textContent() { return this.value+this.childNodes.map(x=>x.textContent).join(''); }
  querySelector(tag) { return this.childNodes.find(x=>x.tagName===tag) ?? null; }
}
export function renderWeapon(item, family, blessings, schemaVersion='1.1.0') {
  const old=globalThis.document;
  globalThis.document={head:new Element('head'),createElement:tag=>new Element(tag),querySelector:()=>null,querySelectorAll:()=>[]};
  const main=new Element('main');
  const url=new URL(`https://example.test/weapons/?family=${encodeURIComponent(item.values.family)}&id=${encodeURIComponent(item.id)}&version=1.13.4`);
  try { renderSharedPage({main,buildMeta:new Element('p'),url,result:{sourceData:true,manifest:{gameVersion:'1.13.4',dataRevision:'a'.repeat(64)},versions:[],domains:[{kind:'weapons-index',document:{items:family}},{kind:'weapon-family',document:{schemaVersion,items:[item]}},{kind:'blessings-index',document:{items:blessings}}]}}); }
  finally {globalThis.document=old;}
  return main;
}
export function allNodes(root) {return [root,...root.childNodes.flatMap(allNodes)];}
