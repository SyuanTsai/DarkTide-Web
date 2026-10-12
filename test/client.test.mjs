import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../fixtures/site.mjs';
import { createPublicFiles, projectPublicContent } from '../src/published/contract.mjs';
import {
  assetPresentation,
  canonicalRoute,
  createDataClient,
  createNavigationController,
  displayName,
  displayCategory,
  filterEntries,
  mechanicsItems,
  makeRedirectUrl,
  pageEntries,
  readListState,
  resolveCatalogRoute,
  validateCatalog,
  validateDetail,
  validateTalentTree,
  writeListState
} from '../web/client.mjs';

const build = {
  schema_version: 2,
  data_revision: 'a'.repeat(64),
  build_id: 'b'.repeat(64),
  game_version: 'fixture',
  package_kind: 'fixture'
};

function publicFiles() {
  return createPublicFiles(projectPublicContent(structuredClone(fixture)));
}

function catalog() {
  const result = JSON.parse(publicFiles().get('catalog.json'));
  result.redirects ??= [];
  return result;
}

function detailFor(entry) {
  return JSON.parse(publicFiles().get(entry.detail_path));
}

function weaponEntry(data = catalog()) {
  return data.entries.find(row => row.kind === 'weapon');
}

function jsonResponse(value, status = 200, contentType = 'application/json; charset=utf-8') {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': contentType } });
}

// Scenario: Each supported content kind is assigned its canonical route from its identity and owner.
// Purpose: Preserve public deep links and prevent cross-kind links from colliding.
test('UnitT00_builds_canonical_routes_for_skills_mechanics_weapons_and_relations', () => {
  assert.equal(canonicalRoute('skill', 'veteran/practice-guard'), '/skills/veteran/practice-guard/');
  assert.equal(canonicalRoute('mechanics', 'veteran/practice-guard'), '/skills/veteran/practice-guard/mechanics/');
  assert.equal(canonicalRoute('weapon', 'practice-rifle'), '/weapons/practice-rifle/');
  assert.equal(canonicalRoute('mark', 'practice-rifle-m1', { weapon_id: 'practice-rifle', mark_id: 'practice-rifle-m1' }), '/weapons/practice-rifle/marks/practice-rifle-m1/');
  assert.equal(canonicalRoute('blessing', 'steady-example'), '/blessings/steady-example/');
  assert.equal(canonicalRoute('variant', 'steady-example-rifle', { blessing_id: 'steady-example', variant_id: 'steady-example-rifle' }), '/blessings/steady-example/variants/steady-example-rifle/');
});

// Scenario: A projected fixture is emitted by the production public-file generator and loaded by the client validator.
// Purpose: Keep the browser contract aligned with the real schema-v2 catalog and detail paths.
test('InterT00_accepts_catalog_and_details_from_public_contract_generator', () => {
  const files = publicFiles();
  const generatedCatalog = JSON.parse(files.get('catalog.json'));
  assert.equal(generatedCatalog.schema_version, 2);
  assert.deepEqual(Object.keys(generatedCatalog.counts).sort(), ['blessings', 'marks', 'mechanics', 'skills', 'variants', 'weapons']);
  assert.deepEqual(generatedCatalog.redirects, []);
  assert.doesNotThrow(() => validateCatalog(generatedCatalog, build));
  for (const row of generatedCatalog.entries) {
    const detail = JSON.parse(files.get(row.detail_path));
    assert.doesNotThrow(() => validateDetail(detail, row, generatedCatalog));
  }
});

// Scenario: Catalog entries contain a route collision, unsafe detail path, or inconsistent count.
// Purpose: Keep data lookup tied to canonical identity and prevent incomplete catalogs from looking valid.
test('UnitT10_rejects_catalog_route_collisions_unsafe_paths_and_wrong_counts', () => {
  const valid = catalog();
  const wrongRoute = structuredClone(valid);
  weaponEntry(wrongRoute).route = '/weapons/other-rifle/';
  assert.throws(() => validateCatalog(wrongRoute, build), /route/i);
  const duplicateRoute = structuredClone(valid);
  duplicateRoute.entries[1].route = duplicateRoute.entries[0].route;
  assert.throws(() => validateCatalog(duplicateRoute, build), /route/i);
  const unsafePath = structuredClone(valid);
  weaponEntry(unsafePath).detail_path = '../other/catalog.json';
  assert.throws(() => validateCatalog(unsafePath, build), /path/i);
  const wrongCount = structuredClone(valid);
  wrongCount.counts.weapons += 1;
  assert.throws(() => validateCatalog(wrongCount, build), /count/i);
});

// Scenario: A catalog redirect points to a canonical detail while a visitor has query and hash state.
// Purpose: Restore legacy URLs with replaceState semantics and preserve the visitor's current context.
test('UnitT15_resolves_safe_catalog_aliases_and_preserves_query_and_hash', () => {
  const data = catalog();
  data.redirects = [{ source_route: '/weapons/old-rifle/', target_route: weaponEntry(data).route }];
  assert.doesNotThrow(() => validateCatalog(data, build));
  assert.deepEqual(resolveCatalogRoute('/weapons/old-rifle/', data), {
    type: 'redirect', target_route: weaponEntry(data).route
  });
  const oldUrl = new URL('https://example.test/weapons/old-rifle/?q=步槍&page=2#marks');
  assert.equal(makeRedirectUrl(oldUrl, weaponEntry(data).route).href,
    'https://example.test/weapons/practice-rifle/?q=%E6%AD%A5%E6%A7%8D&page=2#marks');
  const unknownTarget = catalog();
  unknownTarget.redirects = [{ source_route: '/weapons/old-rifle/', target_route: '/weapons/missing/' }];
  assert.throws(() => validateCatalog(unknownTarget, build), /redirect/i);
  const listOverride = catalog();
  listOverride.redirects = [{ source_route: '/skills/', target_route: weaponEntry(listOverride).route }];
  assert.throws(() => validateCatalog(listOverride, build), /redirect|list/i);
});

// Scenario: A blessing category combines melee and ranged items and is selected by its raw category key.
// Purpose: Display the combined category in Traditional Chinese while preserving existing values and filter behavior.
test('UnitT17_translates_mixed_category_and_preserves_other_values', () => {
  assert.equal(displayCategory('melee'), '近戰武器');
  assert.equal(displayCategory('ranged'), '遠程武器');
  assert.equal(displayCategory('mixed'), '近戰與遠程武器');
  assert.equal(displayCategory(null), null);
  assert.equal(displayCategory(''), '');
  assert.equal(displayCategory(fixture.skills[0].category), '示範分類');
  assert.equal(displayCategory('unknown-category'), 'unknown-category');

  const url = new URL('https://example.test/blessings/?filter=mixed');
  const state = readListState(url);
  assert.equal(state.filter, 'mixed');
  const mixedEntry = { kind: 'blessing', id: 'mixed-blessing', category: 'mixed' };
  const meleeEntry = { kind: 'blessing', id: 'melee-blessing', category: 'melee' };
  assert.deepEqual(filterEntries([mixedEntry, meleeEntry], state), [mixedEntry]);
  assert.equal(writeListState(url, { filter: state.filter }).searchParams.get('filter'), 'mixed');
});
// Scenario: A public record has a null Chinese display name but retains its stable source ID.
// Purpose: Keep the record visible, searchable by ID, and clearly marked without inventing a translation.
test('UnitT18_displays_and_searches_records_with_unknown_names_by_id', () => {
  const data = catalog();
  const mark = data.entries.find(row => row.kind === 'mark');
  const unnamed = { ...mark, name_zh_tw: null };
  assert.doesNotThrow(() => validateCatalog({ ...data, entries: data.entries.map(row => row === mark ? unnamed : row) }, build));
  assert.equal(displayName(unnamed.name_zh_tw, unnamed.id), `名稱待確認（${unnamed.id}）`);
  assert.deepEqual(filterEntries([unnamed], { q: unnamed.id }), [unnamed]);
});

// Scenario: A translated skill title is unavailable but its stable archetype/skill ID remains public.
// Purpose: Keep null skill labels valid in catalog/details and searchable/displayable by ID.
test('UnitT19_keeps_untranslated_skill_visible_and_searchable_by_id', () => {
  const model = structuredClone(fixture);
  model.skills[0].name_zh_tw = null;
  const files = createPublicFiles(projectPublicContent(model));
  const data = JSON.parse(files.get('catalog.json'));
  assert.doesNotThrow(() => validateCatalog(data, build));

  const skill = data.entries.find(row => row.kind === 'skill');
  const mechanics = data.entries.find(row => row.kind === 'mechanics');
  assert.equal(skill.name_zh_tw, null);
  assert.equal(mechanics.name_zh_tw, null);
  assert.equal(displayName(skill.name_zh_tw, skill.id), '名稱待確認（veteran/practice-guard）');
  assert.deepEqual(filterEntries([skill], { q: 'veteran/practice-guard' }), [skill]);
  for (const entry of [skill, mechanics]) {
    const detail = JSON.parse(files.get(entry.detail_path));
    assert.equal(detail.record.name_zh_tw, null);
    assert.doesNotThrow(() => validateDetail(detail, entry, data));
  }
});

// Scenario: A blessing variant detail has an image but no record name, while its catalog entry supplies a name.
// Purpose: Keep the rendered image, alt text, and visible HTTPS credit valid without absent record fields.
test('UnitT25_prepares_variant_asset_with_catalog_name_and_visible_credit', () => {
  const entry = { kind: 'variant', id: 'steady-example-rifle', name_zh_tw: '穩定射擊（步槍）' };
  const record = { variant_id: entry.id, blessing_id: 'steady-example', defined_tiers: [1, 2, 3, 4] };
  const view = assetPresentation(build.data_revision, entry, record, {
    path: 'assets/icons/steady.svg', source_url: null,
    attribution: { href: 'https://example.test/asset', text: '示範圖片來源' }
  });
  assert.deepEqual(view, {
    src: `/data/${build.data_revision}/assets/icons/steady.svg`,
    alt: '穩定射擊（步槍）',
    credit: { href: 'https://example.test/asset', label: '示範圖片來源' }
  });
  assert.equal(assetPresentation(build.data_revision, { ...entry, name_zh_tw: null }, { ...record, name_zh_tw: null }, {
    path: 'assets/icons/steady.svg', source_url: null, attribution: null
  }).alt, `名稱待確認（${entry.id}）`);
});
// Scenario: A visitor searches a catalog, filters a category, changes pages, then presses Back.
// Purpose: Keep URL state and visible results synchronized across browser history.
test('UnitT20_reads_filters_pages_and_writes_search_state_in_the_url', () => {
  const url = new URL('https://example.test/weapons/?q=rifle&filter=ranged&page=2');
  const state = readListState(url);
  assert.deepEqual(state, { q: 'rifle', filter: 'ranged', page: 2 });
  const entries = [
    { kind: 'weapon', id: 'practice-rifle', category: 'ranged', name_zh_tw: '演示步槍' },
    { kind: 'weapon', id: 'practice-blade', category: 'melee', name_zh_tw: '演示刀' },
    { kind: 'weapon', id: 'assault-rifle', category: 'ranged', name_zh_tw: '突擊步槍' }
  ];
  const filtered = filterEntries(entries, { ...state, q: '演示步槍', page: 1 });
  assert.deepEqual(filtered.map(row => row.id), ['practice-rifle']);
  assert.deepEqual(pageEntries(entries, 2, 1).map(row => row.id), ['practice-blade']);
  const changed = writeListState(url, { q: 'blade', filter: 'melee', page: 1 });
  assert.equal(changed.pathname, '/weapons/');
  assert.equal(changed.searchParams.get('q'), 'blade');
  assert.equal(changed.searchParams.get('filter'), 'melee');
  assert.equal(changed.searchParams.get('page'), '1');
});

// Scenario: A visitor opens a catalog and forces a retry after a transient failure.
// Purpose: Read only the build-locked revision and bypass cached responses on explicit retry.
test('UnitT30_fetches_locked_revision_and_forces_fresh_catalog_on_retry', async () => {
  const calls = [];
  const client = createDataClient({ build, fetchImpl: async (url, init = {}) => {
    calls.push({ url, init });
    return jsonResponse(catalog());
  } });
  await client.loadCatalog();
  await client.loadCatalog({ force: true });
  assert.equal(calls[0].url, `/data/${build.data_revision}/catalog.json`);
  assert.equal(calls[0].init.cache, undefined);
  assert.equal(calls[1].init.cache, 'reload');
});

// Scenario: A detail JSON is returned with HTML or malformed JSON instead of the declared public schema.
// Purpose: Prevent error pages and incompatible data from being rendered as content.
test('UnitT35_rejects_non_json_content_type_and_bad_schema', async () => {
  const client = createDataClient({ build, fetchImpl: async () => new Response('<html>error</html>', {
    headers: { 'content-type': 'text/html' }
  }) });
  await assert.rejects(client.loadCatalog(), /content.type|JSON/i);
  const malformedClient = createDataClient({ build, fetchImpl: async () => jsonResponse({ ...catalog(), schema_version: 3 }) });
  await assert.rejects(malformedClient.loadCatalog(), /schema/i);
});

// Scenario: A detail URL is missing after the deployment has advanced to a new build.
// Purpose: Detect stale data URLs without silently mixing revisions and retain the current deep link.
test('UnitT40_turns_old_revision_404_into_url_preserving_update_notice', async () => {
  const calls = [];
  const newerVersion = { ...build, data_revision: 'c'.repeat(64), build_id: 'd'.repeat(64) };
  const client = createDataClient({
    build,
    getLocationHref: () => 'https://example.test/weapons/practice-rifle/?q=步槍&page=3#detail',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url === '/version.json') return jsonResponse(newerVersion);
      return new Response(null, { status: 404 });
    }
  });
  await assert.rejects(client.loadDetail(weaponEntry()), error => {
    assert.equal(error.name, 'UpdateAvailableError');
    assert.equal(error.location, '/weapons/practice-rifle/?q=%E6%AD%A5%E6%A7%8D&page=3#detail');
    return true;
  });
  assert.equal(calls[0].url, `/data/${build.data_revision}/details/weapons/practice-rifle.json`);
  assert.equal(calls[1].url, '/version.json');
  assert.equal(calls[1].init.cache, 'no-store');
});

// Scenario: A data 404 occurs while the current version endpoint reports the same build.
// Purpose: Keep an ordinary missing-data error retryable without displaying a false update notice.
test('UnitT45_keeps_same_build_404_as_retryable_data_error', async () => {
  const client = createDataClient({ build, fetchImpl: async (url) => url === '/version.json'
    ? jsonResponse(build)
    : new Response(null, { status: 404 }) });
  await assert.rejects(client.loadDetail(weaponEntry()), error => {
    assert.notEqual(error.name, 'UpdateAvailableError');
    assert.equal(error.retryable, true);
    return true;
  });
});

// Scenario: Two route loads finish in reverse order after a visitor quickly changes pages.
// Purpose: Prevent an old promise from replacing the currently selected route.
test('UnitT50_ignores_late_result_from_superseded_navigation', async () => {
  const pending = new Map();
  const rendered = [];
  const controller = createNavigationController({
    load: route => new Promise(resolve => pending.set(route, resolve)),
    render: state => { if (state.type === 'loaded') rendered.push(state.route); }
  });
  const first = controller.navigate('/weapons/first/');
  const second = controller.navigate('/weapons/second/');
  pending.get('/weapons/second/')('second');
  await second;
  pending.get('/weapons/first/')('first');
  await first;
  assert.deepEqual(rendered, ['/weapons/second/']);
});

// Scenario: A slow alias resolution completes after a newer route has rendered.
// Purpose: Prevent stale loads from replacing the current browser URL or rendered page.
test('UnitT55_does_not_commit_stale_alias_after_newer_navigation', async () => {
  const pending = new Map();
  const rendered = [];
  let currentUrl = '/legacy-a/';
  const controller = createNavigationController({
    load: (route, { isCurrent }) => new Promise(resolve => pending.set(route, resolve)).then(result => {
      if (result.redirect && isCurrent()) currentUrl = result.redirect;
      return result.page;
    }),
    render: state => { if (state.type === 'loaded') rendered.push(state.value); }
  });
  const first = controller.navigate('alias-A');
  currentUrl = '/weapons/B/';
  const second = controller.navigate('route-B');
  pending.get('route-B')({ page: 'B' });
  await second;
  pending.get('alias-A')({ page: 'A', redirect: '/weapons/A/' });
  await first;
  assert.equal(currentUrl, '/weapons/B/');
  assert.deepEqual(rendered, ['B']);
});



// Scenario: A published remote GitHub attachment has no local file path and carries the required Games Lantern credit.
// Purpose: Prefer the approved original image URL while preserving the per-use visible source credit.
test('UnitT26_prefers_approved_original_image_without_revision_path', () => {
  const data = catalog();
  const originalEntry = weaponEntry(data);
  const asset = {
    asset_id: 'github-example',
    path: null,
    source_url: 'https://github.com/user-attachments/assets/12345678-1234-4234-9234-123456789AbC',
    attribution: {
      href: 'https://gameslantern.com/storage/sites/darktide/weapon-icon.png',
      text: '圖示 © Games Lantern',
      follow_required: true
    }
  };
  const entry = { ...originalEntry, asset_ids: [asset.asset_id] };
  const detail = { ...detailFor(originalEntry), assets: [asset] };
  assert.doesNotThrow(() => validateDetail(detail, entry));
  assert.deepEqual(assetPresentation(build.data_revision, entry, detail.record, asset), {
    src: asset.attribution.href,
    alt: entry.name_zh_tw,
    credit: { href: asset.attribution.href, label: asset.attribution.text }
  });
});

// Scenario: Remote assets have a malformed attachment URL, incomplete local/remote fields, or missing/invalid Games Lantern credit.
// Purpose: Reject data that would bypass remote URL safety or silently omit the required attribution.
test('UnitT27_rejects_invalid_remote_attachment_and_missing_gameslantern_credit', () => {
  const data = catalog();
  const originalEntry = weaponEntry(data);
  const validUrl = 'https://github.com/user-attachments/assets/12345678-1234-4234-9234-123456789abc';
  const validCredit = {
    href: 'https://darktide.gameslantern.com/weapons/example',
    text: '圖示 © Games Lantern',
    follow_required: true
  };
  const cases = [
    { label: 'evil host', source_url: 'https://evil.example/user-attachments/assets/12345678-1234-4234-9234-123456789abc', attribution: validCredit },
    { label: 'credentials', source_url: 'https://user@github.com/user-attachments/assets/12345678-1234-4234-9234-123456789abc', attribution: validCredit },
    { label: 'query', source_url: validUrl + '?download=1', attribution: validCredit },
    { label: 'fragment', source_url: validUrl + '#icon', attribution: validCredit },
    { label: 'non UUID', source_url: 'https://github.com/user-attachments/assets/not-a-uuid', attribution: validCredit },
    { label: 'missing credit', source_url: validUrl, attribution: null },
    { label: 'wrong credit host', source_url: validUrl, attribution: { ...validCredit, href: 'https://example.test/credit' } },
    { label: 'lookalike Games Lantern host', source_url: validUrl, attribution: { ...validCredit, href: 'https://evil.gameslantern.com/credit' } },
    { label: 'credit query', source_url: validUrl, attribution: { ...validCredit, href: 'https://gameslantern.com/storage/sites/darktide/icon.png?download=1' } },
    { label: 'credit fragment', source_url: validUrl, attribution: { ...validCredit, href: 'https://gameslantern.com/storage/sites/darktide/icon.png#source' } },
    { label: 'not followable', source_url: validUrl, attribution: { ...validCredit, follow_required: false } },
    { label: 'partial remote tuple', path: 'assets/icons/local.png', source_url: validUrl, attribution: validCredit }
  ];
  for (const invalid of cases) {
    const asset = {
      asset_id: 'remote-' + invalid.label.replaceAll(' ', '-'),
      path: invalid.path ?? null,
      source_url: invalid.source_url,
      attribution: invalid.attribution
    };
    const entry = { ...originalEntry, asset_ids: [asset.asset_id] };
    const detail = { ...detailFor(originalEntry), assets: [asset] };
    assert.throws(() => validateDetail(detail, entry), undefined, invalid.label);
  }
});

// Scenario: A legacy local fixture asset has a relative path and optional source metadata.
// Purpose: Keep existing local fixture previews working alongside remote published attachments.
test('UnitT28_preserves_local_fixture_asset_presentation', () => {
  const entry = { kind: 'variant', id: 'steady-example-rifle', name_zh_tw: '穩定射擊（步槍）' };
  const record = { variant_id: entry.id, blessing_id: 'steady-example' };
  const asset = { asset_id: 'local-icon', path: 'assets/icons/local.svg', source_url: null, attribution: null };
  assert.deepEqual(assetPresentation(build.data_revision, entry, record, asset), {
    src: '/data/' + build.data_revision + '/assets/icons/local.svg',
    alt: entry.name_zh_tw,
    credit: null
  });
});
// Scenario: A skill has mechanics written as multiple lines with blank lines and inconsistent whitespace.
// Purpose: Render concise list items without inventing or retaining empty entries.
test('UnitT60_splits_mechanics_into_trimmed_nonempty_items', () => {
  assert.deepEqual(mechanicsItems(null), []);
  assert.deepEqual(mechanicsItems(undefined), []);
  assert.deepEqual(mechanicsItems(''), []);
  assert.deepEqual(mechanicsItems('  第一項  \r\n\n 第二項\n\t第三項 \r'), ['第一項', '第二項', '第三項']);
  assert.deepEqual(mechanicsItems('持續 0.5 秒。命中刷新。\n最多 3 層。'), ['持續 0.5 秒。', '命中刷新。', '最多 3 層。']);
  assert.deepEqual(mechanicsItems('Increase 1.5 seconds. Keep 2.0 stacks; next.'), ['Increase 1.5 seconds. Keep 2.0 stacks; next.']);
});

// Scenario: A blessing lists two variants in a deliberate order while their requests complete in reverse order.
// Purpose: Load only exact catalog variants, validate their blessing owner, preserve record order, and forward force.
test('UnitT65_loads_blessing_variant_details_in_record_order', async () => {
  const bundle = blessingLevelFixture();
  const calls = [];
  const completed = [];
  const dataRoot = '/data/' + build.data_revision + '/';
  const client = createDataClient({
    build,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === dataRoot + 'catalog.json') return jsonResponse(bundle.data);
      const variant = [...bundle.variantDetails].find(([id]) => url.endsWith('/details/variants/' + id + '.json'));
      if (!variant) return new Response(null, { status: 404 });
      const [id, detail] = variant;
      await new Promise(resolve => setTimeout(resolve, id === bundle.extraEntry.id ? 15 : 0));
      completed.push(id);
      return jsonResponse(detail);
    }
  });
  await client.loadCatalog();
  assert.equal(typeof client.loadBlessingLevels, 'function');

  const levels = await client.loadBlessingLevels(bundle.blessingDetail, { force: true });
  assert.deepEqual(levels.map(row => row.record.variant_id), [bundle.extraEntry.id, bundle.originalEntry.id]);
  assert.deepEqual(completed, [bundle.originalEntry.id, bundle.extraEntry.id]);
  const detailCalls = calls.filter(call => call.url.includes('/details/variants/'));
  assert.deepEqual(detailCalls.map(call => call.options), [{ cache: 'reload' }, { cache: 'reload' }]);
});

// Scenario: A blessing detail references a variant absent from the validated catalog or a fetched variant omits its owner relation.
// Purpose: Reject stale, unrelated, or unlisted variant details instead of showing them under the wrong blessing.
test('UnitT66_rejects_unlisted_or_wrong_owner_blessing_variants', async () => {
  const bundle = blessingLevelFixture();
  const dataRoot = '/data/' + build.data_revision + '/';
  const calls = [];
  const client = createDataClient({
    build,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === dataRoot + 'catalog.json') return jsonResponse(bundle.data);
      const variant = [...bundle.variantDetails].find(([id]) => url.endsWith('/details/variants/' + id + '.json'));
      return jsonResponse(variant?.[1] ?? {});
    }
  });
  await client.loadCatalog();
  assert.equal(typeof client.loadBlessingLevels, 'function');

  const unlisted = structuredClone(bundle.blessingDetail);
  unlisted.record.variant_ids = ['missing-variant'];
  unlisted.relations = unlisted.relations.filter(row => row.kind !== 'variant');
  await assert.rejects(client.loadBlessingLevels(unlisted), /catalog|variant/i);
  assert.equal(calls.some(url => url.includes('/details/variants/')), false);

  const missingOwner = structuredClone(bundle.variantDetails.get(bundle.extraEntry.id));
  missingOwner.relations = missingOwner.relations.filter(row => row.kind !== 'blessing');
  bundle.variantDetails.set(bundle.extraEntry.id, missingOwner);
  await assert.rejects(client.loadBlessingLevels(bundle.blessingDetail), /blessing|owner|relation/i);
});

// Scenario: A variant request fails after the blessing detail has loaded.
// Purpose: Preserve normal request and retry errors instead of silently returning a partial blessing level list.
test('UnitT67_propagates_blessing_variant_request_errors', async () => {
  const bundle = blessingLevelFixture();
  const dataRoot = '/data/' + build.data_revision + '/';
  const client = createDataClient({
    build,
    fetchImpl: async (url) => {
      if (url === dataRoot + 'catalog.json') return jsonResponse(bundle.data);
      if (url.includes('/details/variants/')) return new Response(null, { status: 503 });
      return new Response(null, { status: 404 });
    }
  });
  await client.loadCatalog();
  await assert.rejects(client.loadBlessingLevels(bundle.blessingDetail), /503|request failed/i);
});

// Scenario: A catalog optionally describes skill tree JSON files for supported archetypes.
// Purpose: Accept valid metadata and reject unsafe paths, duplicate owners, and invalid node counts.
test('UnitT70_validates_optional_talent_tree_catalog_metadata', () => {
  const { data } = talentTreeFixture();
  assert.doesNotThrow(() => validateCatalog(data, build));

  const invalid = [
    value => { value.talent_trees = {}; },
    value => { value.talent_trees[0].tree_path = '../private.json'; },
    value => { value.talent_trees[0].tree_path = 'trees/other.json'; },
    value => { value.talent_trees[0].node_count = -1; },
    value => { value.talent_trees[0].node_count = 1.5; },
    value => { value.talent_trees[0].version = ''; },
    value => { value.talent_trees[0].version = '19'; },
    value => { value.talent_trees[0].version = 0; },
    value => { value.talent_trees[0].version = 1.5; },
    value => { value.talent_trees.push({ ...value.talent_trees[0] }); }
  ];
  for (const mutate of invalid) {
    const candidate = structuredClone(data);
    mutate(candidate);
    assert.throws(() => validateCatalog(candidate, build), /tree|talent|path|count|version/i);
  }
});

// Scenario: A tree includes connected nodes, two links to one skill, source metadata, and its deduplicated detail.
// Purpose: Accept valid layouts while rejecting unsafe coordinates, node relationships, skill ownership, and detail sets.
test('UnitT75_validates_talent_tree_structure_and_skill_details', () => {
  const { data, metadata, tree } = talentTreeFixture();
  assert.deepEqual(validateTalentTree(tree, metadata, data), tree);

  const invalid = [
    value => { value.nodes[1].node_id = value.nodes[0].node_id; },
    value => { value.nodes[0].children = ['missing_node']; },
    value => { value.nodes[0].x = Number.POSITIVE_INFINITY; },
    value => { value.nodes[0].y = Number.NaN; },
    value => { value.nodes[0].type = 'unknown_type'; },
    value => { value.nodes[1].skill_id = 'other-class/foreign-skill'; },
    value => { value.details = []; },
    value => { value.details.push(structuredClone(value.details[0])); },
    value => { value.version = 'different-version'; },
    value => { value.source_ids = ['missing-source']; }
  ];
  for (const mutate of invalid) {
    const candidate = structuredClone(tree);
    mutate(candidate);
    assert.throws(() => validateTalentTree(candidate, metadata, data), /tree|node|skill|detail|source|version/i);
  }
});

// Scenario: A tree metadata entry points to a valid JSON document for the active build revision.
// Purpose: Load validated tree data through the build-locked path and honor explicit cache refreshes.
test('UnitT80_loads_validated_tree_from_catalog_metadata', async () => {
  const { data, metadata, tree } = talentTreeFixture();
  const calls = [];
  const dataRoot = '/data/' + build.data_revision + '/';
  const client = createDataClient({
    build,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === dataRoot + 'catalog.json') return jsonResponse(data);
      if (url === dataRoot + metadata.tree_path) return jsonResponse(tree);
      return new Response(null, { status: 404 });
    }
  });
  const loadedCatalog = await client.loadCatalog();
  assert.equal(typeof client.loadTree, 'function');
  const result = await client.loadTree(loadedCatalog.talent_trees[0], { force: true });
  assert.deepEqual(result, tree);
  assert.deepEqual(calls.map(call => call.url), [dataRoot + 'catalog.json', dataRoot + metadata.tree_path]);
  assert.deepEqual(calls[1].options, { cache: 'reload' });

  await assert.rejects(client.loadTree({ ...metadata, tree_path: '../private.json' }), /catalog|path|tree/i);
  assert.equal(calls.length, 2);
});

// Scenario: A talent tree is missing after the site advances, or the server returns a non-JSON tree response.
// Purpose: Reuse stale-build detection and reject malformed tree payloads before they reach the view.
test('UnitT85_loadTree_handles_stale_revision_and_rejects_non_json', async () => {
  const { data, metadata } = talentTreeFixture();
  const dataRoot = '/data/' + build.data_revision + '/';
  const newerVersion = { ...build, data_revision: 'c'.repeat(64), build_id: 'd'.repeat(64) };
  const staleClient = createDataClient({
    build,
    fetchImpl: async (url) => {
      if (url === dataRoot + 'catalog.json') return jsonResponse(data);
      if (url === '/version.json') return jsonResponse(newerVersion);
      return new Response(null, { status: 404 });
    }
  });
  await staleClient.loadCatalog();
  await assert.rejects(staleClient.loadTree(metadata), error => error.name === 'UpdateAvailableError');

  const malformedClient = createDataClient({
    build,
    fetchImpl: async (url) => url === dataRoot + 'catalog.json'
      ? jsonResponse(data)
      : new Response('<html>not json</html>', { headers: { 'content-type': 'text/html' } })
  });
  await malformedClient.loadCatalog();
  await assert.rejects(malformedClient.loadTree(metadata), /non.JSON|content.type/i);
});

function blessingLevelFixture() {
  const data = catalog();
  const blessingEntry = data.entries.find(entry => entry.kind === 'blessing');
  const originalEntry = data.entries.find(entry => entry.kind === 'variant');
  const extraEntry = {
    ...originalEntry,
    id: 'steady-example-alt',
    route: '/blessings/steady-example/variants/steady-example-alt/',
    detail_path: 'details/variants/steady-example-alt.json'
  };
  data.entries.push(extraEntry);
  data.counts.variants += 1;

  const blessingDetail = structuredClone(detailFor(blessingEntry));
  blessingDetail.record.variant_ids = [extraEntry.id, originalEntry.id];
  blessingDetail.relations.push({
    kind: 'variant', id: extraEntry.id, name_zh_tw: extraEntry.name_zh_tw, route: extraEntry.route
  });
  const originalDetail = structuredClone(detailFor(originalEntry));
  const extraDetail = structuredClone(originalDetail);
  extraDetail.record.variant_id = extraEntry.id;
  return {
    data, blessingDetail, originalEntry, extraEntry,
    variantDetails: new Map([[originalEntry.id, originalDetail], [extraEntry.id, extraDetail]])
  };
}

function talentTreeFixture() {
  const data = catalog();
  const metadata = {
    archetype: 'veteran', version: 19,
    tree_path: 'trees/veteran.json', node_count: 3
  };
  data.talent_trees = [metadata];
  const skillEntry = data.entries.find(entry => entry.kind === 'skill' && entry.id.startsWith(metadata.archetype + '/'));
  const tree = {
    schema_version: 2,
    archetype: metadata.archetype,
    version: metadata.version,
    nodes: [
      { node_id: 'node_a', type: 'start', x: 0, y: 0, skill_id: null, children: ['node_b'] },
      { node_id: 'node_b', type: 'ability', x: 1.5, y: 2, skill_id: 'practice-guard', children: ['node_c'] },
      { node_id: 'node_c', type: 'default', x: 2, y: 3, skill_id: 'practice-guard', children: [] }
    ],
    source_ids: [],
    sources: [],
    details: [detailFor(skillEntry)]
  };
  return { data, metadata, tree };
}
