import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSharedClient, loadSharedRelease } from '../web/shared-client.mjs';
import { createSharedViewModel } from '../web/shared-view.mjs';
import { renderSharedPage } from '../web/shared-render.mjs';
import { makeBlessingDomains, makeTermsDomain, RELEASE, refs } from './w11-shared-view.fixture.mjs';
import { makeCompiledGameChangesPackage } from './w12-shared-view.fixture.mjs';
import { makeCompiledAnnouncementFixture } from './w13-announcement-fixture.mjs';
import { computeDataRevision } from '../scripts/content/contract-release.mjs';
import { installTestLocation, makeSharedPackage, responseFetch } from './w11-shared-client.fixture.mjs';

const sorted = values => [...values].sort();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const requestedDomainNames = calls => calls
  .map(call => new URL(call.url).pathname.split('/').at(-1))
  .filter(name => name.endsWith('.json') && name !== 'manifest.json')
  .map(name => name.slice(0, -'.json'.length));

function rebindPackage(pack, mutateManifest) {
  const manifest = structuredClone(pack.manifest);
  mutateManifest(manifest);
  manifest.dataRevision = computeDataRevision(manifest);
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const pointer = {
    ...pack.pointer,
    data_revision: manifest.dataRevision,
    manifest_path: `/data/${manifest.dataRevision}/manifest.json`,
    manifest_sha256: sha256(manifestBytes),
  };
  const build = {
    ...pack.build,
    shared_data_revision: manifest.dataRevision,
    game_releases: pack.build.game_releases.map(row => row.game_version === pointer.game_version ? pointer : row),
    shared_files: [
      { path: pointer.manifest_path, size_bytes: manifestBytes.byteLength, sha256: pointer.manifest_sha256 },
      ...manifest.files.map(file => ({
        path: `/data/${manifest.dataRevision}/${file.path}`,
        size_bytes: file.sizeBytes,
        sha256: file.sha256,
      })),
    ],
  };
  const responses = new Map([[pointer.manifest_path, manifestBytes]]);
  for (const [path, bytes] of pack.domainBytes) responses.set(`/data/${manifest.dataRevision}/${path}`, bytes);
  return { ...pack, build, pointer, manifest, manifestBytes, responses };
}

// Scenario: A browser visits each shared route in a build whose manifest pins all core domains.
// Purpose: Load only route-required domains while keeping the exact version manifest as the first request.
// Given a fixed shared build, When each route is loaded, Then skills, weapons, blessings, updates, and home have the reviewed minimal domain sets.
test('UnitT10_loads_only_the_current_route_domain_set', async t => {
  installTestLocation(t);
  const coreKinds = ['blessings', 'skills', 'terms', 'weapons'];
  const cases = [
    ['/', coreKinds, false],
    ['/skills/', ['skills', 'terms'], false],
    ['/skills/psyker/psyker_brain_burst_improved/', ['skills', 'terms'], false],
    ['/weapons/', coreKinds, false],
    ['/blessings/', coreKinds, false],
    ['/game-changes/', [...coreKinds, 'game-changes'], true],
  ];

  for (const [pathname, expected, withGameChanges] of cases) await t.test(pathname, async () => {
    const pack = makeSharedPackage({ extraGameChanges: withGameChanges });
    const calls = [];
    const client = createSharedClient({ build: pack.build, fetchImpl: responseFetch(pack.responses, { calls }) });

    const result = await client.load({ pathname });

    assert.equal(result.status, 'ready');
    assert.deepEqual(sorted(result.domains.map(domain => domain.kind)), sorted(expected));
    assert.deepEqual(sorted(requestedDomainNames(calls)), sorted(expected));
    assert.equal(calls.filter(call => new URL(call.url).pathname.endsWith('/manifest.json')).length, 1);
    assert.ok(calls.every(call => call.init.redirect === 'error' && call.init.credentials === 'omit'));
  });
});

// Scenario: The skills route's file declares an additional core-domain dependency in the exact manifest.
// Purpose: Resolve transitive manifest dependencies on top of the skills route's minimum source and localization domains.
// Given a re-sealed manifest where skills depends on blessings, When the skills page loads, Then that declared dependency is fetched and weapons remain unrequested.
test('UnitT20_loads_route_domains_and_their_declared_dependency_closure', async t => {
  installTestLocation(t);
  const pack = rebindPackage(makeSharedPackage(), manifest => {
    const skills = manifest.files.find(file => file.kind === 'skills');
    skills.dependencies = [manifest.files.find(file => file.kind === 'blessings').path];
  });
  const calls = [];
  const client = createSharedClient({ build: pack.build, fetchImpl: responseFetch(pack.responses, { calls }) });

  const result = await client.load({ pathname: '/skills/' });

  assert.equal(result.status, 'ready');
  assert.deepEqual(sorted(result.domains.map(domain => domain.kind)), ['blessings', 'skills', 'terms']);
  assert.deepEqual(sorted(requestedDomainNames(calls)), ['blessings', 'skills', 'terms']);
  assert.ok(result.rawFiles.has(`/data/${result.manifest.dataRevision}/skills.json`));
  assert.ok(result.rawFiles.has(`/data/${result.manifest.dataRevision}/blessings.json`));
  assert.ok(!result.rawFiles.has(`/data/${result.manifest.dataRevision}/weapons.json`));
});

// Scenario: A split package also contains an optional announcements domain.
// Purpose: A weapon-list route must fetch only the index named by the split loading contract.
test('UnitT25_split_weapon_list_does_not_fetch_unrelated_optional_domains', async t => {
  installTestLocation(t);
  const fixture = await makeCompiledAnnouncementFixture();
  const calls = [];
  const client = createSharedClient({ build: fixture.build, fetchImpl: responseFetch(fixture.responses, { calls }) });

  const result = await client.load({ pathname: '/weapons/' });

  assert.deepEqual(result.domains.map(domain => domain.kind), ['weapons-index']);
  const announcementFile = result.manifest.files.find(file => file.kind === 'announcements');
  assert.ok(!result.rawFiles.has(`/data/${result.manifest.dataRevision}/${announcementFile.path}`));
  assert.deepEqual(requestedDomainNames(calls), ['weapons-index']);
});

test('UnitT26_split_routes_fetch_exactly_the_contract_files', async t => {
  installTestLocation(t);
  const fixture = await makeCompiledAnnouncementFixture();
  const cases = [
    ['/weapons/', '', ['weapons-index']],
    ['/weapons/', '?family=fixture-family&mark=fixture-mark', ['blessings-index', 'fixture-family', 'weapons-index']],
    ['/blessings/', '', ['blessings-index']],
    ['/blessings/', '?id=fixture%3Ablessing%3Aalpha', ['blessings-index', 'fixture-blessing-alpha', 'weapons-index']],
    ['/skills/', '', ['skills', 'terms']],
    ['/announcements/', '', ['announcements']],
  ];

  for (const [pathname, search, expected] of cases) await t.test(pathname + search, async () => {
    const calls = [];
    const client = createSharedClient({ build: fixture.build, fetchImpl: responseFetch(fixture.responses, { calls }) });
    const result = await client.load({ pathname, search });

    assert.equal(result.status, 'ready');
    assert.deepEqual(sorted(requestedDomainNames(calls)), sorted(expected));
  });
});

// Scenario: A selected domain is served with bytes that differ from the exact build and manifest pins.
// Purpose: Preserve fail-closed byte length and SHA-256 checks even when only one route domain is fetched.
// Given a skills route and a tampered skills response, When the client loads that route, Then it rejects without returning a partial view.
test('UnitT30_rejects_tampered_route_domain_bytes', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage();
  const calls = [];
  const fetchImpl = responseFetch(pack.responses, { calls, alter: (path, bytes) => {
    if (!path.endsWith('/skills.json')) return null;
    return Buffer.concat([bytes, Buffer.from(' ')]);
  } });
  const client = createSharedClient({ build: pack.build, fetchImpl });

  await assert.rejects(client.load({ pathname: '/skills/' }), /domain bytes do not match|byte limit/i);
  const requested = requestedDomainNames(calls);
  assert.ok(requested.includes('skills'));
  assert.ok(!requested.includes('blessings') && !requested.includes('weapons'));
});

// Scenario: A manifest-listed but route-unrequested domain is omitted from the trusted build file pins.
// Purpose: Keep the selected manifest bound to the complete package metadata before any route-specific fetch.
// Given a skills route and a build missing the weapons pin, When the route is loaded, Then the client rejects instead of accepting an incomplete package identity.
test('UnitT40_rejects_a_missing_unrequested_domain_pin', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage();
  const build = {
    ...pack.build,
    shared_files: pack.build.shared_files.filter(row => !row.path.endsWith('/weapons.json')),
  };
  const calls = [];
  const client = createSharedClient({ build, fetchImpl: responseFetch(pack.responses, { calls }) });

  await assert.rejects(client.load({ pathname: '/skills/' }), /pin|manifest/i);
  assert.equal(calls.filter(call => new URL(call.url).pathname.endsWith('/manifest.json')).length, 1);
  assert.ok(!requestedDomainNames(calls).includes('weapons'));
});

// Scenario: A caller reuses a verified cache with a pointer that changes only its content version.
// Purpose: Bind every manifest identity field to the cache so a stale manifest cannot be returned under a different pointer.
// Given one cache populated from a fixed build, When content_version changes while the data revision and manifest digest stay fixed, Then the client rejects the conflicting pointer.
test('UnitT45_rejects_a_changed_content_version_on_a_reused_cache', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage();
  const cache = { identity: null, manifestPromise: null, domainPromises: new Map(), domainValues: new Map() };
  const fetchImpl = responseFetch(pack.responses);

  await loadSharedRelease({ build: pack.build, fetchImpl, cache, pathname: '/skills/' });
  const changedBuild = structuredClone(pack.build);
  changedBuild.game_releases[0].content_version = '1.13.2.2';

  await assert.rejects(
    loadSharedRelease({ build: changedBuild, fetchImpl, cache, pathname: '/skills/' }),
    /different release pointer/u,
  );
});

// Scenario: The visitor moves from the lazy skills page to a route that keeps the existing full-core behavior.
// Purpose: Accumulate verified domains and single-flight the shared manifest, terms domain, and full route package.
// Given one client for an immutable build tuple, When skills and weapons loads overlap and a later route is requested, Then each file is fetched once and the later view retains earlier verified domains.
test('UnitT50_accumulates_verified_domains_and_deduplicates_concurrent_route_loads', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage();
  const calls = [];
  const normalFetch = responseFetch(pack.responses, { calls });
  const fetchImpl = async (url, init) => {
    if (new URL(url).pathname.endsWith('/skills.json')) await new Promise(resolve => setTimeout(resolve, 5));
    return normalFetch(url, init);
  };
  const client = createSharedClient({ build: pack.build, fetchImpl });

  const [skillsResult, weaponsResult] = await Promise.all([
    client.load({ pathname: '/skills/' }),
    client.load({ pathname: '/weapons/' }),
  ]);
  const accumulated = await client.load({ pathname: '/weapons/' });

  assert.ok(['skills', 'terms'].every(kind => skillsResult.domains.some(domain => domain.kind === kind)));
  assert.ok(['blessings', 'skills', 'terms', 'weapons'].every(kind => weaponsResult.domains.some(domain => domain.kind === kind)));
  assert.deepEqual(sorted(accumulated.domains.map(domain => domain.kind)), ['blessings', 'skills', 'terms', 'weapons']);
  assert.equal(calls.filter(call => new URL(call.url).pathname.endsWith('/manifest.json')).length, 1);
  assert.deepEqual(sorted(requestedDomainNames(calls)), ['blessings', 'skills', 'terms', 'weapons']);
  for (const kind of ['blessings', 'skills', 'terms', 'weapons']) {
    assert.equal(calls.filter(call => new URL(call.url).pathname.endsWith(`/${kind}.json`)).length, 1, `${kind} is fetched once`);
  }
});

// Scenario: A skills domain fails its pinned byte check once, then a forced retry returns the exact package bytes.
// Purpose: Evict rejected file promises so explicit retries can recover without weakening integrity verification.
// Given one client and a stable manifest pin, When its first selected skills response is altered and the next attempt is forced, Then the first fails and the exact retry succeeds.
test('UnitT80_force_retry_recovers_after_a_failed_route_domain', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage();
  const calls = [];
  let tamper = true;
  const fetchImpl = responseFetch(pack.responses, { calls, alter: (path, bytes) => {
    if (tamper && path.endsWith('/skills.json')) return Buffer.concat([bytes, Buffer.from(' ')]);
    return null;
  } });
  const client = createSharedClient({ build: pack.build, fetchImpl });

  await assert.rejects(client.load({ pathname: '/skills/' }), /domain bytes do not match|byte limit/i);
  tamper = false;
  const retry = await client.load({ pathname: '/skills/', force: true });

  assert.equal(retry.status, 'ready');
  assert.deepEqual(sorted(retry.domains.map(domain => domain.kind)), ['skills', 'terms']);
  assert.equal(calls.filter(call => new URL(call.url).pathname.endsWith('/skills.json')).length, 2);
});

// Scenario: A caller aborts a stalled manifest request and then retries the same fixed build with a working transport.
// Purpose: Preserve caller cancellation, abort the in-flight request signal, and leave the cached promise retryable.
// Given a client whose first request stalls, When the caller aborts and retries, Then the first load rejects with AbortError and the second returns a verified release.
test('UnitT90_abort_cancels_the_caller_request_and_allows_a_fresh_retry', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage();
  const calls = [];
  const normalFetch = responseFetch(pack.responses, { calls });
  let firstRequest = true;
  let observedSignal;
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const fetchImpl = (url, init) => {
    if (!firstRequest) return normalFetch(url, init);
    firstRequest = false;
    observedSignal = init.signal;
    startedResolve();
    return new Promise(() => {});
  };
  const client = createSharedClient({ build: pack.build, fetchImpl });
  const controller = new AbortController();
  const pending = client.load({ pathname: '/skills/', signal: controller.signal });

  await started;
  controller.abort();
  await assert.rejects(pending, /abort/i);

  assert.equal(observedSignal.aborted, true);
  const retry = await client.load({ pathname: '/skills/', force: true });
  assert.equal(retry.status, 'ready');
});

// Scenario: A blessing page displays its approved tier without a selected family/mark, while a game-change record names another domain's subject.
// Purpose: Keep blessing applicability unknown until selected and require all semantic subject domains for the update index.
// Given the existing typed fixtures, When the blessing and change views are assembled, Then the blessing remains readable without a weapon presentation and the update name appears only with its cross-domain presentation closure.
test('UnitT60_preserves_blessing_unknowns_and_game_change_cross_domain_names', async () => {
  const blessingDomain = makeBlessingDomains();
  const blessingView = createSharedViewModel({ domains: [blessingDomain, makeTermsDomain()], gameReleaseId: RELEASE });
  const blessing = blessingView.getBlessing({
    blessingRef: refs.blessing,
    variantRef: refs.blessingVariant,
    tier: 1,
  });
  assert.equal(blessing.status, 'ready');
  assert.deepEqual(blessing.applicability, {
    status: 'unknown', verification: 'unverified', reason: 'weapon-context-not-selected',
  });

  const compiled = await makeCompiledGameChangesPackage({ changeTargetKind: 'blessing-variant' });
  const index = compiled.domains.find(domain => domain.kind === 'game-changes');
  const releaseId = index.gameReleaseId;
  const indexOnly = createSharedViewModel({ domains: [index], gameReleaseId: releaseId });
  const indexOnlyResult = indexOnly.getGameChanges({ gameVersion: '1.0.1', entityKind: 'blessing' });
  const completeView = createSharedViewModel({ domains: compiled.domains, gameReleaseId: releaseId });
  const completeResult = completeView.getGameChanges({ gameVersion: '1.0.1', entityKind: 'blessing' });

  assert.equal(indexOnlyResult.items.some(item => item.owner === 'source'), false,
    'an index alone cannot invent a cross-domain display name');
  const change = completeResult.items.find(item => item.owner === 'source');
  assert.ok(change);
  assert.equal(change.entityName, '合成祝福範例');
  assert.equal(change.blessingVariant.weaponApplicability.weapons[0].name, '合成武器範例');
});

class FakeElement {
  constructor(tagName, text = '') {
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this._text = text;
    this.className = '';
    this.value = '';
  }
  get textContent() { return this._text + this.children.map(child => child.textContent ?? '').join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.children.push(item); return item; }
  replaceChildren(...items) { this._text = ''; this.children = items; }
  insertBefore(item, before) {
    const index = this.children.indexOf(before);
    this.children.splice(index < 0 ? this.children.length : index, 0, item);
    return item;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener() {}
  querySelectorAll() { return []; }
  focus() {}
}

// Scenario: Current skills fail integrity validation while the independent 1.13.1 history package is already verified.
// Purpose: Keep the existing explicit history fallback visible instead of turning a current-domain error into a blank page.
// Given verified retained skill search data and a current shared error, When the shared renderer handles the route, Then retained rows remain searchable and the current-data warning stays explicit.
test('UnitT70_keeps_verified_history_visible_when_current_route_domains_fail', t => {
  const priorDocument = globalThis.document;
  const priorWindow = globalThis.window;
  const priorHistory = globalThis.history;
  const head = new FakeElement('head');
  globalThis.document = {
    title: '',
    head,
    createElement: tag => new FakeElement(tag),
    createTextNode: text => new FakeElement('#text', String(text)),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.window = { location: new URL('https://web.test/skills/') };
  globalThis.history = { pushState() {}, replaceState() {} };
  t.after(() => {
    if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument;
    if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow;
    if (priorHistory === undefined) delete globalThis.history; else globalThis.history = priorHistory;
  });

  const main = new FakeElement('main');
  const buildMeta = new FakeElement('p');
  const historyPackage = {
    projection: {
      gameVersion: '1.13.1',
      entries: [{ kind: 'skill', id: 'psyker/psyker_brain_burst_improved', name: 'Brain Burst Improved' }],
    },
    catalog: {
      entries: [{ kind: 'skill', id: 'psyker/psyker_brain_burst_improved', name_zh_tw: '留存技能名稱', route: '/skills/psyker/psyker_brain_burst_improved/' }],
      talent_trees: [],
    },
  };

  renderSharedPage({
    main,
    buildMeta,
    url: new URL('https://web.test/skills/'),
    error: new Error('current skills domain failed verification'),
    currentError: new Error('current skills domain failed verification'),
    historyPackage,
  });

  assert.match(main.textContent, /留存技能名稱/u);
  assert.match(main.textContent, /目前版本技能資料未能載入/u);
  assert.match(buildMeta.textContent, /基準資料版本 1\.13\.1/u);
});
