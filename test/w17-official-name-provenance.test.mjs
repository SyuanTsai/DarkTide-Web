import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSharedViewModel } from '../web/shared-view.mjs';
import { renderSharedPage } from '../web/shared-render.mjs';
import { RELEASE, refs, makeWeaponDomain } from './w11-shared-view.fixture.mjs';

const CURRENT_RELEASE = 'darktide:1.13.4';
const DATA_REVISION = 'e039f650aed9c6742200f488ab93d0721ff9aa1849cfa29ad81f693da9b15a57';
const SOURCE_COMMIT = 'a131860bc24354dfe8842047efe51ce1ceae8e68';
const AUTHORING_COMMIT = '4ace4d76d0788e34c45984bb39c20c130f4ef62a';
const D8D_CANDIDATE_ROOT = new URL('../content/contracts/w09/proposals/d8d430c3f105696a06d4f2af040e095d260546fbae38960d8ec1cb0eb1f56bab/candidate/', import.meta.url);
const PINS = [
  {
    presentationId: 'web:presentation:chainaxe-p1-m1:r1134',
    recordId: 'darktide:weapon:chainaxe:p1-m1',
    familyId: 'chainaxe_p1',
    markId: 'chainaxe_p1_m1',
    markLabel: 'P1-M1',
    name: '突擊鏈斧',
    officialSourceId: 'official:w07:chainaxe-p1-m1:weapon-name:zh-tw:r1134',
    key: 'loc_weapon_family_chainaxe_p1_m1',
    sourceHash: 'ca7da17a',
    sourceTextSha256: '6ac2c3f1cd3bf92c06b4031fcadb4200bc4304c2b77b2b08135b129eb36f4e89',
  },
  {
    presentationId: 'web:presentation:chainaxe-p1-m2:r1134',
    recordId: 'darktide:weapon:chainaxe:p1-m2',
    familyId: 'chainaxe_p1',
    markId: 'chainaxe_p1_m2',
    markLabel: 'P1-M2',
    name: '突擊鏈斧',
    officialSourceId: 'official:w07:chainaxe-p1-m2:weapon-name:zh-tw:r1134',
    key: 'loc_weapon_family_chainaxe_p1_m1',
    sourceHash: 'ca7da17a',
    sourceTextSha256: '6ac2c3f1cd3bf92c06b4031fcadb4200bc4304c2b77b2b08135b129eb36f4e89',
  },
  {
    presentationId: 'web:presentation:lasgun-p1-m1:r1134',
    recordId: 'darktide:weapon:lasgun:p1-m1',
    familyId: 'lasgun_p1',
    markId: 'lasgun_p1_m1',
    markLabel: 'P1-M1',
    name: '步兵鐳射槍',
    officialSourceId: 'official:w13:lasgun-p1-m1:weapon-name:zh-tw:r1134',
    key: 'loc_weapon_family_lasgun_p1_m1',
    sourceHash: 'f93eef0d',
    sourceTextSha256: '691dfad2b858feab456f55f3466c9f0acfa72c8506e7c0c80fa0134b2ee4902a',
  },
];

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
  replaceChildren(...nodes) { this.childNodes = [...nodes]; this._textContent = ''; }
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

function makeResult(pin, mutate = () => {}) {
  const domain = makeWeaponDomain();
  const oldWeaponId = refs.weaponIv.recordId;
  const rewrite = value => {
    if (Array.isArray(value)) {
      for (const item of value) rewrite(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.gameReleaseId === RELEASE) value.gameReleaseId = CURRENT_RELEASE;
    if (value.kind === 'weapon' && value.recordId === oldWeaponId) value.recordId = pin.recordId;
    for (const child of Object.values(value)) rewrite(child);
  };
  rewrite(domain);
  domain.source.records = domain.source.records.filter(record => record.kind !== 'weapon' || record.recordId === pin.recordId);
  const weaponRecord = domain.source.records.find(record => record.kind === 'weapon' && record.recordId === pin.recordId);
  weaponRecord.payload.familyId = pin.familyId;
  weaponRecord.payload.markId = pin.markId;

  const presentation = domain.web.presentations.find(row => row.entityRef.recordId === pin.recordId);
  presentation.authoringId = pin.presentationId;
  presentation.name = pin.name;
  presentation.nameOfficialSourceId = pin.officialSourceId;
  presentation.official = { entityRef: presentation.entityRef, officialSourceId: pin.officialSourceId };
  presentation.weaponView.sourceWeaponRef = presentation.entityRef;
  presentation.weaponView.markLabel = pin.markLabel;
  domain.web.presentations = [presentation];

  const official = {
    officialSourceId: pin.officialSourceId,
    sourceLocale: 'zh-TW',
    entityRef: { gameReleaseId: CURRENT_RELEASE, kind: 'weapon', recordId: pin.recordId },
    origin: 'game-localization',
    resource: 'items',
    key: pin.key,
    sourceHash: pin.sourceHash,
    occurrence: 1,
    sourceText: pin.name,
    sourceTextSha256: pin.sourceTextSha256,
    segments: [{ segmentId: 'segment-1', kind: 'text', text: pin.name, sha256: pin.sourceTextSha256 }],
    params: [],
    resolvedText: pin.name,
    resolvedTextSha256: pin.sourceTextSha256,
  };
  presentation.official = {
    entityRef: official.entityRef,
    officialSourceId: official.officialSourceId,
    origin: official.origin,
    resource: official.resource,
    key: official.key,
    sourceHash: official.sourceHash,
    occurrence: official.occurrence,
    sourceTextSha256: official.sourceTextSha256,
    resolvedTextSha256: official.resolvedTextSha256,
  };
  domain.web.officialInputs.sources = [official];

  const manifest = {
    gameReleaseId: CURRENT_RELEASE,
    gameVersion: '1.13.4',
    contentVersion: '1.13.4.3',
    dataRevision: DATA_REVISION,
    source: {
      repository: 'https://github.com/SyuanTsai/DarkTide-Source-Data',
      commit: SOURCE_COMMIT,
      sourceRevision: '724abb6d8c15c1ff9660fbd9f7b953f1577d3c09602aae3d3af2d2898ca3c5ae',
    },
    web: { authoringCommit: AUTHORING_COMMIT, compilerCommit: '09f0a211346b3119b15d6a255c814ab7fd8aa228' },
  };
  mutate({ domain, official, manifest, presentation });
  const domains = [domain];
  return {
    status: 'ready',
    fixtureOnly: false,
    pointer: { game_version: '1.13.4', content_version: '1.13.4.3', data_revision: manifest.dataRevision },
    manifest,
    domains,
    view: createSharedViewModel({ domains, gameReleaseId: CURRENT_RELEASE }),
  };
}

function renderWeaponPage(result, pin) {
  const main = new FakeElement('main');
  const buildMeta = new FakeElement('p');
  const documentImpl = {
    head: new FakeElement('head'),
    title: '',
    createElement: tag => new FakeElement(tag),
    createTextNode: text => new FakeTextNode(text),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const url = new URL(`/weapons/?family=${encodeURIComponent(pin.familyId)}&mark=${encodeURIComponent(pin.markId)}`, 'https://example.test');
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = documentImpl;
  globalThis.window = {
    location: { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash },
    history: { replaceState() {} },
  };
  try {
    renderSharedPage({ main, buildMeta, result, url });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  return main;
}

function elementsWithClass(root, className) {
  const found = [];
  const visit = element => {
    if (element?.nodeType !== 1) return;
    if (element.className === className) found.push(element);
    element.childNodes.forEach(visit);
  };
  visit(root);
  return found;
}

// Scenario: The approved 1.13.4 names are scoped to fixed Source/Web commits and exact source rows.
// Purpose: Disclose that their text matches the pinned 1.13.2 localization row without implying an independently verified 1.13.4 localization.
// Given each of the three exact 1.13.4 name rows, When its weapon page is rendered, Then only the pinned rows carry the explicit source limitation.
test('UnitT10_marks_the_three_exact_1_13_4_name_rows_against_the_pinned_1_13_2_text', () => {
  for (const pin of PINS) {
    const page = renderWeaponPage(makeResult(pin), pin);
    assert.equal(elementsWithClass(page, 'shared-official-text')[0]?.textContent, pin.name);
    assert.match(page.textContent, /與 1\.13\.2 固定來源文字相同/u);
    assert.match(page.textContent, /未提供獨立 1\.13\.4 原始文字證據/u);
  }
});

// Scenario: A fixed manifest or official-source field no longer matches the reviewed evidence map.
// Purpose: Prevent a changed release, commit, ID, key, source hash, or original-text hash from inheriting the 1.13.2 provenance statement.
// Given a known 1.13.4 source ID with any changed pin, When the page is rendered, Then it states that the source version is unconfirmed and omits the match claim.
test('UnitT20_marks_known_rows_unconfirmed_when_any_fixed_provenance_pin_changes', () => {
  const changes = [
    ({ manifest }) => { manifest.gameReleaseId = 'darktide:1.13.3'; },
    ({ manifest }) => { manifest.dataRevision = 'f'.repeat(64); },
    ({ manifest }) => { manifest.gameVersion = '1.13.3'; },
    ({ manifest }) => { manifest.source.repository += '-changed'; },
    ({ manifest }) => { manifest.source.commit = 'b'.repeat(40); },
    ({ manifest }) => { manifest.source.sourceRevision = 'e'.repeat(64); },
    ({ manifest }) => { manifest.web.authoringCommit = 'c'.repeat(40); },
    ({ manifest }) => { manifest.web.compilerCommit = 'd'.repeat(40); },
    ({ official, presentation }) => {
      const changedId = `${official.officialSourceId}:changed`;
      official.officialSourceId = changedId;
      presentation.nameOfficialSourceId = changedId;
      presentation.official.officialSourceId = changedId;
    },
    ({ presentation }) => { presentation.authoringId += ':changed'; },
    ({ official }) => { official.origin = 'other-localization'; },
    ({ official }) => { official.resource = 'other-resource'; },
    ({ official }) => { official.occurrence = 2; },
    ({ official }) => { official.key += ':changed'; },
    ({ official }) => { official.sourceHash = '00000000'; },
    ({ official }) => { official.sourceTextSha256 = 'd'.repeat(64); },
    ({ official }) => { official.resolvedTextSha256 = 'e'.repeat(64); },
    ({ presentation }) => { presentation.official.key += ':changed'; },
    ({ presentation }) => { presentation.official.sourceHash = '00000000'; },
    ({ presentation }) => { presentation.official.resolvedTextSha256 = 'e'.repeat(64); },
  ];
  for (const mutate of changes) {
    const pin = PINS[0];
    const page = renderWeaponPage(makeResult(pin, mutate), pin);
    assert.match(page.textContent, /來源版本未確認/u);
    assert.doesNotMatch(page.textContent, /與 1\.13\.2 固定來源文字相同/u);
  }
});

// Scenario: A weapon outside the exact 1.13.4 evidence map uses a different official source.
// Purpose: Keep unrelated weapon names on their existing display without mislabeling them as carried over.
// Given an unmapped official source ID, When its weapon page is rendered, Then no 1.13.2 provenance claim or new unknown label is added.
test('UnitT30_leaves_unmapped_weapon_names_on_their_existing_display', () => {
  const pin = { ...PINS[0], familyId: 'unmapped-family', markId: 'unmapped-mark' };
  const page = renderWeaponPage(makeResult(pin), pin);
  assert.equal(elementsWithClass(page, 'shared-official-text')[0]?.textContent, pin.name);
  assert.doesNotMatch(page.textContent, /1\.13\.2 固定來源文字相同|未提供獨立 1\.13\.4|來源版本未確認/u);
});

// Scenario: The pinned d8d candidate files contain the deployed Source and authoring identities.
// Purpose: Exercise the renderer with actual manifest and domain rows instead of relying only on synthetic fixtures.
// Given the three scoped weapons in the candidate manifest, When their pages are rendered, Then each exact row gets the bounded provenance note.
test('UnitT40_renders_the_three_scoped_names_from_the_digest_checked_d8d_candidate', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', D8D_CANDIDATE_ROOT), 'utf8'));
  assert.equal(manifest.dataRevision, DATA_REVISION);
  const domains = manifest.files.map(file => {
    const bytes = readFileSync(new URL(file.path, D8D_CANDIDATE_ROOT));
    assert.equal(bytes.length, file.sizeBytes, `${file.path} size must match the candidate manifest`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `${file.path} digest must match the candidate manifest`);
    return JSON.parse(bytes.toString('utf8'));
  });
  const result = {
    status: 'ready',
    fixtureOnly: false,
    pointer: {
      game_version: manifest.gameVersion,
      content_version: manifest.contentVersion,
      data_revision: manifest.dataRevision,
    },
    manifest,
    domains,
    view: createSharedViewModel({ domains, gameReleaseId: manifest.gameReleaseId }),
  };
  for (const pin of PINS) {
    const page = renderWeaponPage(result, pin);
    assert.equal(elementsWithClass(page, 'shared-official-text')[0]?.textContent, pin.name);
    assert.match(page.textContent, /與 1\.13\.2 固定來源文字相同/u);
    assert.match(page.textContent, /未提供獨立 1\.13\.4 原始文字證據/u);
  }
});
