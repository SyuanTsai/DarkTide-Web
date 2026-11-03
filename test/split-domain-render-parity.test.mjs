import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { computeDataRevision, validateManifest } from '../scripts/content/contract-release.mjs';
import { createSharedClient } from '../web/shared-client.mjs';
import { renderSharedPage } from '../web/shared-render.mjs';
import { installTestLocation, jsonResponse } from './w11-shared-client.fixture.mjs';
import { makeCompiledGameChangesPackage } from './w12-shared-view.fixture.mjs';
import { makeCompiledAnnouncementFixture } from './w13-announcement-fixture.mjs';

const MAX_PACKAGE_BYTES = 24 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

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
    this.className = '';
    this.value = '';
    this.classList = { contains: name => this.className.split(/\s+/u).includes(name) };
  }
  append(...nodes) { this.childNodes.push(...nodes); }
  prepend(...nodes) { this.childNodes.unshift(...nodes); }
  appendChild(node) { this.childNodes.push(node); return node; }
  replaceChildren(...nodes) { this.childNodes = nodes; this._textContent = ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener() {}
  focus() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  insertBefore(node, before) {
    const index = this.childNodes.indexOf(before);
    if (index < 0) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    return node;
  }
  set textContent(value) { this._textContent = String(value); this.childNodes = []; }
  get textContent() { return this._textContent + this.childNodes.map(node => node.textContent ?? '').join(''); }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get options() { return this.children.filter(node => node.tagName === 'option'); }
}

function snapshotNode(node) {
  if (node.nodeType === 3) return { text: node.textContent };
  const properties = {};
  for (const key of ['href', 'rel', 'name', 'type', 'method', 'action', 'value', 'selected', 'open']) {
    if (node[key] !== undefined && node[key] !== '' && node[key] !== false) properties[key] = node[key];
  }
  return {
    tag: node.tagName,
    className: node.className,
    attributes: [...node.attributes].sort(([left], [right]) => left.localeCompare(right)),
    dataset: Object.fromEntries(Object.entries(node.dataset).sort(([left], [right]) => left.localeCompare(right))),
    properties,
    text: node._textContent,
    children: node.childNodes.map(snapshotNode),
  };
}

function collectInternalHrefs(node, result = new Set()) {
  if (node?.nodeType === 1 && typeof node.href === 'string' && node.href.startsWith('/')) result.add(node.href);
  for (const child of node?.childNodes ?? []) collectInternalHrefs(child, result);
  return result;
}

function renderSnapshot(result, route) {
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
  const url = new URL(route, 'https://example.test');
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousHistory = globalThis.history;
  globalThis.document = documentImpl;
  globalThis.window = {
    location: { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash },
    history: { replaceState() {} },
  };
  globalThis.history = globalThis.window.history;
  try {
    renderSharedPage({ main, buildMeta, result, url });
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousHistory === undefined) delete globalThis.history; else globalThis.history = previousHistory;
  }
  return {
    hrefs: [...collectInternalHrefs(main)].sort(),
    snapshot: {
    title: documentImpl.title,
    main: snapshotNode(main),
    buildMeta: snapshotNode(buildMeta),
    },
  };
}

function clientPackage({ manifest, manifestBytes, files, fixtureOnly = false }) {
  validateManifest(manifest);
  const pointer = {
    game_version: manifest.gameVersion,
    content_version: manifest.contentVersion,
    data_revision: manifest.dataRevision,
    manifest_path: `/data/${manifest.dataRevision}/manifest.json`,
    manifest_sha256: sha256(manifestBytes),
  };
  const responses = new Map([[pointer.manifest_path, manifestBytes]]);
  const sharedFiles = [{ path: pointer.manifest_path, size_bytes: manifestBytes.byteLength, sha256: pointer.manifest_sha256 }];
  for (const file of manifest.files) {
    const bytes = files.get(file.path);
    assert.ok(bytes, `package is missing ${file.path}`);
    responses.set(`/data/${manifest.dataRevision}/${file.path}`, bytes);
    sharedFiles.push({
      path: `/data/${manifest.dataRevision}/${file.path}`,
      size_bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  const build = {
    shared_game_version: manifest.gameVersion,
    shared_data_revision: manifest.dataRevision,
    game_releases: [pointer],
    shared_files: sharedFiles,
  };
  if (fixtureOnly) Object.assign(build, {
    shared_package_kind: 'fixture',
    shared_fixture_only: true,
    fixture_id: 'synthetic-split-domain-render-parity',
  });
  return {
    fixtureOnly,
    manifest,
    manifestBytes,
    files,
    build,
    responses,
  };
}

function packageFromCompiled(compiled) {
  const manifest = structuredClone(compiled.manifest);
  return clientPackage({
    manifest,
    manifestBytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'),
    files: new Map(compiled.files),
    fixtureOnly: true,
  });
}

function legacyPackageFromSplit(split) {
  const manifest = structuredClone(split.manifest);
  const files = new Map();
  const shardKinds = new Set(['weapons-index', 'weapon-family', 'blessings-index', 'blessing']);
  const familyRows = manifest.files.filter(file => file.kind === 'weapon-family');
  const blessingRows = manifest.files.filter(file => file.kind === 'blessing');
  assert.equal(familyRows.length, 1, 'the synthetic legacy projection requires one weapon family');
  assert.equal(blessingRows.length, 1, 'the synthetic legacy projection requires one blessing');

  for (const file of manifest.files) if (!shardKinds.has(file.kind)) files.set(file.path, split.files.get(file.path));
  const legacyRows = [];
  for (const [kind, filePath, sourceRow] of [
    ['weapons', 'domains/weapons.json', familyRows[0]],
    ['blessings', 'domains/blessings.json', blessingRows[0]],
  ]) {
    const document = JSON.parse(split.files.get(sourceRow.path).toString('utf8'));
    document.kind = kind;
    const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n', 'utf8');
    files.set(filePath, bytes);
    legacyRows.push({ kind, path: filePath, sizeBytes: bytes.byteLength, sha256: sha256(bytes), dependencies: [] });
  }
  manifest.compatibility.requiredFeatures = manifest.compatibility.requiredFeatures
    .filter(feature => feature !== 'split-weapon-blessing-domains-v1');
  manifest.files = [
    ...manifest.files.filter(file => !shardKinds.has(file.kind)),
    ...legacyRows,
  ].sort((left, right) => left.path.localeCompare(right.path, 'en'));
  manifest.dataRevision = computeDataRevision(manifest);
  return clientPackage({
    manifest,
    manifestBytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'),
    files,
    fixtureOnly: split.fixtureOnly,
  });
}

async function loadRoute(pkg, route) {
  const calls = [];
  const fetchImpl = async url => {
    const parsed = new URL(url);
    calls.push(parsed.pathname);
    const bytes = pkg.responses.get(parsed.pathname);
    return jsonResponse(parsed.href, bytes ?? Buffer.from('{}'), { status: bytes ? 200 : 404 });
  };
  const url = new URL(route, 'https://web.test');
  const result = await createSharedClient({ build: pkg.build, fetchImpl }).load({
    pathname: url.pathname,
    search: url.search,
  });
  const rawPaths = [...result.rawFiles.keys()].sort();
  assert.deepEqual([...calls].sort(), rawPaths, `${route} fetches exactly its returned manifest/domain closure`);
  const sizeBytes = [...result.rawFiles.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
  assert.ok(sizeBytes <= MAX_PACKAGE_BYTES, `${route} closure exceeds 24 MiB: ${sizeBytes}`);
  const rowsByPath = new Map(result.manifest.files.map(file => [
    `/data/${result.manifest.dataRevision}/${file.path}`,
    file,
  ]));
  return {
    result,
    closure: rawPaths.filter(filePath => filePath !== result.pointer.manifest_path).map(filePath => {
      const file = rowsByPath.get(filePath);
      return `${file.kind}:${file.path}`;
    }),
    sizeBytes,
  };
}

function comparableResult(result) {
  return { ...result, pointer: { ...result.pointer, data_revision: '0'.repeat(64) } };
}

function linkedDetailRoutes(hrefs) {
  const detailKeys = new Map([
    ['/skills/', 'id'],
    ['/weapons/', 'family'],
    ['/blessings/', 'id'],
    ['/game-changes/', 'id'],
    ['/announcements/', 'id'],
  ]);
  const routes = [];
  for (const href of hrefs) {
    const url = new URL(href, 'https://web.test');
    const key = detailKeys.get(url.pathname);
    if (key && url.searchParams.has(key)) routes.push(url.pathname + url.search);
  }
  return routes;
}

function packageRouteInventory(pkg) {
  const routes = new Set();
  for (const file of pkg.manifest.files) {
    const bytes = pkg.files.get(file.path);
    if (!bytes) continue;
    const domain = JSON.parse(bytes.toString('utf8'));
    if (file.kind === 'skills') {
      for (const presentation of domain.web?.presentations ?? []) {
        if (presentation.entityRef?.kind === 'skill' && presentation.entityRef.recordId) {
          routes.add(`/skills/?id=${encodeURIComponent(presentation.entityRef.recordId)}`);
        }
      }
    } else if (file.kind === 'weapon-family' || file.kind === 'weapons') {
      const weapons = (domain.source?.records ?? []).filter(record => record.kind === 'weapon');
      for (const familyId of new Set(weapons.map(record => record.payload?.familyId).filter(Boolean))) {
        routes.add(`/weapons/?family=${encodeURIComponent(familyId)}`);
        for (const markId of weapons.filter(record => record.payload?.familyId === familyId)
          .map(record => record.payload?.markId).filter(Boolean)) {
          routes.add(`/weapons/?family=${encodeURIComponent(familyId)}&mark=${encodeURIComponent(markId)}`);
        }
      }
    } else if (file.kind === 'blessing' || file.kind === 'blessings') {
      for (const record of domain.source?.records ?? []) if (record.kind === 'blessing') {
        routes.add(`/blessings/?id=${encodeURIComponent(record.recordId)}`);
      }
    } else if (file.kind === 'game-changes') {
      for (const item of [...domain.web.gameChanges, ...domain.web.officialTextChanges]) {
        routes.add(`/game-changes/?id=${encodeURIComponent(item.changeId)}`);
      }
    } else if (file.kind === 'announcements') {
      for (const item of domain.web.announcements) routes.add(`/announcements/?id=${encodeURIComponent(item.announcementId)}`);
    }
  }
  return [...routes].sort();
}

async function assertAllRouteParity(t, legacy, split, label) {
  assert.equal(split.manifest.gameReleaseId, legacy.manifest.gameReleaseId);
  const pending = [
    '/', '/skills/', '/terms/', '/weapons/', '/blessings/', '/game-changes/', '/announcements/',
    ...packageRouteInventory(split),
  ];
  const seen = new Set();
  const report = new Map();
  while (pending.length) {
    const route = pending.shift();
    if (seen.has(route)) continue;
    seen.add(route);
    const [legacyLoaded, splitLoaded] = await Promise.all([
      loadRoute(legacy, route),
      loadRoute(split, route),
    ]);
    const legacyRendered = renderSnapshot(comparableResult(legacyLoaded.result), route);
    const splitRendered = renderSnapshot(comparableResult(splitLoaded.result), route);
    assert.deepEqual(splitRendered.snapshot, legacyRendered.snapshot, `${label} ${route}`);
    assert.deepEqual(splitRendered.hrefs, legacyRendered.hrefs, `${label} ${route} links`);
    report.set(route, { closure: splitLoaded.closure, sizeBytes: splitLoaded.sizeBytes });
    for (const linkedRoute of linkedDetailRoutes(splitRendered.hrefs)) if (!seen.has(linkedRoute)) pending.push(linkedRoute);
  }
  for (const [route, row] of report) t.diagnostic(`${label} ${route} ${row.sizeBytes} bytes [${row.closure.join(', ')}]`);
  return report;
}

test('UnitT10_real_client_selection_preserves_all_rendered_routes_for_split_and_legacy_packages', async t => {
  installTestLocation(t);
  const gameChangesSplit = packageFromCompiled(await makeCompiledGameChangesPackage());
  const gameChangesReport = await assertAllRouteParity(
    t, legacyPackageFromSplit(gameChangesSplit), gameChangesSplit, 'game-changes fixture');
  assert.ok([...gameChangesReport].some(([route]) => route.startsWith('/game-changes/?id=')),
    'the real rendered game-change links are covered');

  const announcementSplit = packageFromCompiled((await makeCompiledAnnouncementFixture()).compiled);
  const announcementReport = await assertAllRouteParity(
    t, legacyPackageFromSplit(announcementSplit), announcementSplit, 'announcement fixture');
  assert.ok([...announcementReport].some(([route]) => route.startsWith('/announcements/?id=')),
    'the real rendered announcement links are covered');
});

async function readCandidatePackage(root) {
  const envelope = JSON.parse(await readFile(path.join(root, 'candidate.json'), 'utf8'));
  const manifestPath = path.join(root, ...envelope.manifest.path.replace(/^\//u, '').split('/'));
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const files = new Map();
  for (const file of manifest.files) {
    files.set(file.path, await readFile(path.join(path.dirname(manifestPath), ...file.path.split('/'))));
  }
  return clientPackage({ manifest, manifestBytes, files });
}

test('InterT20_current_W08_split_and_legacy_packages_use_real_client_selection_on_all_routes', {
  skip: process.env.SYP_SPLIT_PARITY_LEGACY_DIR && process.env.SYP_SPLIT_PARITY_SPLIT_DIR
    ? false : 'Set both SYP_SPLIT_PARITY_LEGACY_DIR and SYP_SPLIT_PARITY_SPLIT_DIR.',
}, async t => {
  installTestLocation(t);
  const legacy = await readCandidatePackage(process.env.SYP_SPLIT_PARITY_LEGACY_DIR);
  const split = await readCandidatePackage(process.env.SYP_SPLIT_PARITY_SPLIT_DIR);
  const report = await assertAllRouteParity(t, legacy, split, 'current W08');
  assert.ok([...report].some(([route]) => route.startsWith('/weapons/?family=')), 'current W08 covers every linked family');
  assert.ok([...report].some(([route]) => route.includes('&mark=')), 'current W08 covers every linked mark');
  assert.ok([...report].some(([route]) => route.startsWith('/blessings/?id=')), 'current W08 covers every linked blessing');
});
