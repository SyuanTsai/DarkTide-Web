import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture } from '../fixtures/site.mjs';
import { createPublicFiles, projectPublicContent, validatePublicFiles, validatePublishedContent } from '../src/published/contract.mjs';

const iconBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const iconHash = createHash('sha256').update(iconBytes).digest('hex');
const assetBytes = new Map([['icons/sample.svg', iconBytes]]);
const knownClaim = () => ({
  claim_id: 'stability', state: 'known', value: '12.5', unit: 'percent', unit_note: null, source_ref: 'test-source'
});
const unknownClaim = () => ({
  claim_id: 'damage', state: 'unknown', value: null, unit: null, unit_note: null, source_ref: null
});

function completeModel() {
  return {
    schema_version: 2,
    package_kind: 'fixture',
    game_version: 'test-build',
    skills: [{
      archetype: 'veteran', skill_id: 'practice_guard', kind: 'current-talent', category: '技能',
      name_zh_tw: '演示防護', effect_zh_tw: '虛構效果', mechanics_zh_tw: '虛構機制',
      claims: [knownClaim(), unknownClaim()], asset_ids: ['sample-icon'], source_ids: ['test-source']
    }],
    weapons: [{
      weapon_id: 'practice-rifle', kind: 'ranged', category: '遠程', name_zh_tw: '演示步槍', model_zh_tw: null,
      mark_ids: ['practice-rifle-m1'], claims: [], asset_ids: [], source_ids: ['test-source']
    }],
    marks: [{
      mark_id: 'practice-rifle-m1', weapon_id: 'practice-rifle', category: null, name_zh_tw: '演示型',
      claims: [unknownClaim()], asset_ids: [], source_ids: ['test-source']
    }],
    blessings: [{
      blessing_id: 'steady-example', category: '祝福', name_zh_tw: '演示穩定',
      effect_zh_tw: '虛構效果', trigger_zh_tw: null, variant_ids: ['steady-example-rifle'], asset_ids: [], source_ids: ['test-source']
    }],
    variants: [{
      variant_id: 'steady-example-rifle', blessing_id: 'steady-example', weapon_id: 'practice-rifle',
      category: null, effect_zh_tw: null, defined_tiers: [1, 2], available_tiers: [1],
      tier_claims: [{ tier: 1, claims: [knownClaim()] }], asset_ids: [], source_ids: ['test-source']
    }],
    bindings: [{
      blessing_id: 'steady-example', weapon_id: 'practice-rifle', mark_id: 'practice-rifle-m1',
      variant_id: 'steady-example-rifle', trait_item: null, trait_category: null, available_tiers: [1]
    }],
    assets: [{
      asset_id: 'sample-icon', path: 'icons/sample.svg', sha256: iconHash, media_type: 'image/svg+xml',
      source_url: 'https://example.com/icon.svg', attribution: null
    }],
    routes: [
      { route_kind: 'canonical', content_kind: 'skill', content_key: 'veteran/practice_guard', source_route: null, target_route: '/skills/veteran/practice_guard/', decision: 'keep' },
      { route_kind: 'canonical', content_kind: 'mechanics', content_key: 'veteran/practice_guard', source_route: null, target_route: '/skills/veteran/practice_guard/mechanics/', decision: 'keep' },
      { route_kind: 'canonical', content_kind: 'weapon', content_key: 'practice-rifle', source_route: null, target_route: '/weapons/practice-rifle/', decision: 'keep' },
      { route_kind: 'canonical', content_kind: 'mark', content_key: 'practice-rifle-m1', source_route: null, target_route: '/weapons/practice-rifle/marks/practice-rifle-m1/', decision: 'keep' },
      { route_kind: 'canonical', content_kind: 'blessing', content_key: 'steady-example', source_route: null, target_route: '/blessings/steady-example/', decision: 'keep' },
      { route_kind: 'canonical', content_kind: 'variant', content_key: 'steady-example-rifle', source_route: null, target_route: '/blessings/steady-example/variants/steady-example-rifle/', decision: 'keep' }
    ],
    sources: [{ source_id: 'test-source', label: '測試來源', url: 'https://example.com/source' }]
  };
}

function equalFiles(left, right) {
  assert.deepEqual([...left.keys()], [...right.keys()]);
  for (const key of left.keys()) {
    const a = left.get(key);
    const b = right.get(key);
    if (a instanceof Uint8Array || b instanceof Uint8Array) assert.deepEqual(Buffer.from(a), Buffer.from(b));
    else assert.equal(a, b);
  }
}

// Scenario: A complete fictional v2 package has all content, relationships, routes, and verified icon bytes.
// Purpose: Establish the smallest valid model shared by projection, validation, and public file generation.
test('UnitT00_accepts_complete_public_v2_model', () => {
  assert.doesNotThrow(() => validatePublishedContent(completeModel(), { assetBytes }));
});

// Scenario: The legacy fictional fixture includes evidence, a template source ID, and schema v1.
// Purpose: Project old preview data into a clean v2 public fixture without carrying private fields forward.
test('UnitT01_projects_legacy_fixture_through_explicit_allowlist', () => {
  const source = structuredClone(fixture);
  const projected = projectPublicContent(source);
  assert.equal(projected.schema_version, 2);
  assert.equal(projected.package_kind, 'fixture');
  assert.equal(projected.game_version, 'fixture');
  assert.equal(projected.skills[0].evidence, undefined);
  assert.equal(projected.marks[0].template_source_id, undefined);
  assert.equal(projected.routes.some(route => route.content_kind === 'mechanics'), true);
  assert.equal(Object.hasOwn(source.skills[0], 'evidence'), true);
  assert.doesNotThrow(() => validatePublishedContent(projected));
});

// Scenario: A public record contains a review note left by a private authoring workflow.
// Purpose: Fail closed if private or unknown fields make it into the published model.
test('UnitT02_rejects_extra_sensitive_public_fields', () => {
  const data = completeModel();
  data.marks[0].review_notes = 'internal';
  assert.throws(() => validatePublishedContent(data, { assetBytes }), /unknown|unsupported|field/i);
});

// Scenario: A public package declares a schema version that this reader does not understand.
// Purpose: Prevent a newer or malformed schema from being rendered with v2 assumptions.
test('UnitT03_rejects_unknown_schema_version', () => {
  const data = completeModel();
  data.schema_version = 3;
  assert.throws(() => validatePublishedContent(data, { assetBytes }), /schema/i);
});

// Scenario: A mark points to a missing weapon while a weapon lists a mark with a different owner.
// Purpose: Preserve both directions of the source model's ownership relationship.
test('UnitT04_rejects_broken_bidirectional_weapon_mark_links', () => {
  const data = completeModel();
  data.marks[0].weapon_id = 'missing-weapon';
  assert.throws(() => validatePublishedContent(data, { assetBytes }), /mark|weapon|reference/i);
  const reverse = completeModel();
  reverse.weapons[0].mark_ids = [];
  assert.throws(() => validatePublishedContent(reverse, { assetBytes }), /mark|weapon|reference/i);
});

// Scenario: A tier variant refers to a blessing that does not list it back.
// Purpose: Keep variant membership consistent in both directions.
test('UnitT05_rejects_broken_bidirectional_blessing_variant_links', () => {
  const data = completeModel();
  data.blessings[0].variant_ids = [];
  assert.throws(() => validatePublishedContent(data, { assetBytes }), /variant|blessing|reference/i);
});

// Scenario: A known numeric claim references a source absent from the public source list.
// Purpose: Ensure every displayed fact can resolve to a public HTTPS source.
test('UnitT06_rejects_unresolved_claim_source', () => {
  const data = completeModel();
  data.skills[0].claims[0].source_ref = 'private-source';
  assert.throws(() => validatePublishedContent(data, { assetBytes }), /source|reference/i);
});

// Scenario: An asset has no bytes or the bytes do not match its declared digest.
// Purpose: Publish only icon files whose content is present and verified.
test('UnitT07_requires_asset_bytes_and_matching_sha256', () => {
  const data = completeModel();
  assert.throws(() => validatePublishedContent(data), /bytes|asset/i);
  assert.throws(() => validatePublishedContent(data, { assetBytes: new Map([['icons/sample.svg', Buffer.from('<svg><g/></svg>')]]) }), /sha|hash|digest/i);
});

// Scenario: An asset path escapes its public icon directory.
// Purpose: Keep emitted icon files inside safe relative paths.
test('UnitT08_rejects_unsafe_icon_paths', () => {
  const data = completeModel();
  data.assets[0].path = 'icons/../private.svg';
  assert.throws(() => validatePublishedContent(data, { assetBytes }), /path|asset/i);
});

// Scenario: Skill and mechanics routes collide or one of the canonical detail destinations is missing.
// Purpose: Give every skill and its mechanics explanation separate stable public routes.
test('UnitT09_requires_unique_skill_and_mechanics_routes', () => {
  const data = completeModel();
  data.routes = data.routes.filter(route => route.content_kind !== 'mechanics');
  assert.throws(() => validatePublishedContent(data, { assetBytes }), /route|mechanics/i);
  const duplicate = completeModel();
  duplicate.routes[1].target_route = duplicate.routes[0].target_route;
  assert.throws(() => validatePublishedContent(duplicate, { assetBytes }), /duplicate|route/i);
});

// Scenario: A category is present as an empty string while optional descriptive text is unknown.
// Purpose: Accept explicit null knowledge while rejecting empty classification labels.
test('UnitT10_accepts_null_descriptions_and_rejects_empty_category', () => {
  const data = completeModel();
  data.weapons[0].model_zh_tw = null;
  data.marks[0].category = null;
  assert.doesNotThrow(() => validatePublishedContent(data, { assetBytes }));
  data.marks[0].category = '  ';
  assert.throws(() => validatePublishedContent(data, { assetBytes }), /category/i);
});

// Scenario: A content name contains no Chinese characters.
// Purpose: Require human-facing published names in Traditional Chinese rather than IDs or untranslated labels.
test('UnitT11_rejects_non_chinese_public_name', () => {
  const data = completeModel();
  data.weapons[0].name_zh_tw = 'Practice Rifle';
  assert.throws(() => validatePublishedContent(data, { assetBytes }), /name|Chinese|繁中/i);
});

// Scenario: A public asset comes from Games Lantern and is shown on a detail page.
// Purpose: Require the direct attribution link that accompanies every use of a Games Lantern asset.
test('UnitT12_requires_games_lantern_direct_attribution', () => {
  const data = completeModel();
  data.assets[0].source_url = 'https://gameslantern.com/storage/sites/darktide/icons/sample.svgicons/sample.svg';
  data.assets[0].attribution = { href: 'https://www.gameslantern.com/darktide/credits/', text: '資料來源：Games Lantern', follow_required: true };
  assert.doesNotThrow(() => validatePublishedContent(data, { assetBytes }));
  const mirror = completeModel();
  mirror.assets[0].source_url = 'https://cdn.example.com/mirrors/gl-sample.svg';
  mirror.assets[0].attribution = { href: 'https://darktide.gameslantern.com/asset/123', text: '資料來源：Games Lantern', follow_required: true };
  assert.doesNotThrow(() => validatePublishedContent(mirror, { assetBytes }));
  const missing = completeModel();
  missing.assets[0].source_url = 'https://www.gameslantern.com/storage/sites/darktide/sample.svg';
  assert.throws(() => validatePublishedContent(missing, { assetBytes }), /attribution|Games Lantern/i);
  data.assets[0].attribution.href = 'https://example.com/';
  assert.throws(() => validatePublishedContent(data, { assetBytes }), /attribution|Games Lantern/i);
});

// Scenario: The same valid model is compiled twice into public output files.
// Purpose: Guarantee deterministic catalog, details, relations, source links, and icon bytes.
test('InterT00_generates_deterministic_files_with_catalog_detail_consistency', () => {
  const data = completeModel();
  const first = createPublicFiles(data, { assetBytes });
  const second = createPublicFiles(data, { assetBytes });
  equalFiles(first, second);
  const catalog = JSON.parse(first.get('catalog.json'));
  assert.equal(catalog.schema_version, 2);
  assert.equal(catalog.game_version, 'test-build');
  assert.equal(catalog.counts.skills, 1);
  assert.equal(catalog.counts.mechanics, 1);
  assert.equal(catalog.entries.length, 6);
  assert.deepEqual(catalog.redirects, []);
  const skillEntry = catalog.entries.find(entry => entry.kind === 'skill');
  const skillDetail = JSON.parse(first.get(skillEntry.detail_path));
  assert.equal(skillDetail.record.skill_id, 'practice_guard');
  assert.equal(skillDetail.relations.some(relation => relation.kind === 'mechanics' && relation.route === '/skills/veteran/practice_guard/mechanics/'), true);
  const mechanicsEntry = catalog.entries.find(entry => entry.kind === 'mechanics');
  const mechanicsDetail = JSON.parse(first.get(mechanicsEntry.detail_path));
  assert.deepEqual(mechanicsDetail.record, skillDetail.record);
  assert.equal(Buffer.from(first.get('icons/sample.svg')).toString(), iconBytes.toString());
  assert.deepEqual(skillDetail.sources.map(source => source.source_id), ['test-source']);
});

// Scenario: A localized display name changes while the source skill ID remains stable.
// Purpose: Keep detail paths, IDs, and canonical routes stable across name corrections.
test('InterT01_keeps_source_id_routes_and_paths_when_names_change', () => {
  const before = completeModel();
  const after = completeModel();
  after.skills[0].name_zh_tw = '更新後的防護';
  const beforeCatalog = JSON.parse(createPublicFiles(before, { assetBytes }).get('catalog.json'));
  const afterCatalog = JSON.parse(createPublicFiles(after, { assetBytes }).get('catalog.json'));
  const beforeSkill = beforeCatalog.entries.find(entry => entry.kind === 'skill');
  const afterSkill = afterCatalog.entries.find(entry => entry.kind === 'skill');
  assert.equal(afterSkill.id, beforeSkill.id);
  assert.equal(afterSkill.route, beforeSkill.route);
  assert.equal(afterSkill.detail_path, beforeSkill.detail_path);
  assert.equal(afterSkill.name_zh_tw, '更新後的防護');
});

// Scenario: A redirect route names a source path already owned by another canonical page.
// Purpose: Prevent ambiguous aliases in generated public navigation.
test('UnitT13_rejects_route_collision_and_bad_redirect', () => {
  const data = completeModel();
  data.routes.push({
    route_kind: 'redirect', content_kind: 'skill', content_key: 'veteran/practice_guard',
    source_route: '/weapons/practice-rifle/', target_route: '/skills/veteran/practice_guard/', decision: 'redirect'
  });
  assert.throws(() => validatePublishedContent(data, { assetBytes }), /route|collision|duplicate/i);
});

// Scenario: Production content omits per-record sources or includes a synthetic SVG icon.
// Purpose: Require resolved public provenance for every published record and keep fixture-only SVGs out of releases.
test('UnitT14_requires_public_sources_and_rejects_fixture_svg_in_published_content', () => {
  const data = completeModel();
  data.package_kind = 'published';
  data.skills[0].asset_ids = [];
  for (const row of [...data.skills, ...data.weapons, ...data.marks, ...data.blessings, ...data.variants]) {
    row.source_ids = ['test-source'];
  }
  data.assets = [];
  assert.doesNotThrow(() => validatePublishedContent(data));
  data.marks[0].source_ids = [];
  assert.throws(() => validatePublishedContent(data), /source/i);

  const withSvg = completeModel();
  withSvg.package_kind = 'published';
  assert.throws(() => validatePublishedContent(withSvg, { assetBytes }), /bytes|media_type/i);
});

// Scenario: HTML bytes are relabeled as a PNG and carry a matching SHA-256 digest.
// Purpose: Verify actual media signatures so a valid hash cannot disguise active content as an image.
test('UnitT15_rejects_html_disguised_as_png_even_with_matching_hash', () => {
  const data = completeModel();
  const html = Buffer.from('<html><script>bad()</script></html>');
  data.assets[0].path = 'icons/sample.png';
  data.assets[0].media_type = 'image/png';
  data.assets[0].sha256 = createHash('sha256').update(html).digest('hex');
  assert.throws(() => validatePublishedContent(data, { assetBytes: new Map([['icons/sample.png', html]]) }), /bytes|media_type/i);
});

// Scenario: One validation test mutates a known claim's source reference.
// Purpose: Keep complete model factories isolated so later assertions test only their intended risk.
test('InterT02_creates_independent_claims_for_each_model', () => {
  const first = completeModel();
  const second = completeModel();
  first.skills[0].claims[0].source_ref = 'private-source';
  first.variants[0].tier_claims[0].claims[0].source_ref = 'other-private-source';
  assert.equal(second.skills[0].claims[0].source_ref, 'test-source');
  assert.equal(second.variants[0].tier_claims[0].claims[0].source_ref, 'test-source');
});
// Scenario: Tier arrays contain values outside the game range, out of order, or unavailable to the binding.
// Purpose: Keep variant and binding availability aligned to sorted Darktide tiers 1 through 4.
test('UnitT16_rejects_tier_values_out_of_range_unsorted_or_unavailable', () => {
  const cases = [
    data => { data.variants[0].defined_tiers = [5]; },
    data => { data.variants[0].defined_tiers = [2, 1]; },
    data => { data.variants[0].available_tiers = [2, 1]; },
    data => { data.variants[0].available_tiers = [5]; },
    data => { data.variants[0].tier_claims = [{ tier: 2, claims: [] }, { tier: 1, claims: [] }]; },
    data => { data.bindings[0].available_tiers = [5]; },
    data => { data.bindings[0].available_tiers = [2, 1]; },
    data => { data.bindings[0].available_tiers = [2]; }
  ];
  for (const mutate of cases) {
    const data = completeModel();
    mutate(data);
    assert.throws(() => validatePublishedContent(data, { assetBytes }), /tier/i);
  }
});

// Scenario: A published package loses a required public class or its public source registry.
// Purpose: Prevent a successful release build from silently erasing a game content class.
test('UnitT17_requires_all_published_content_classes_and_public_sources', () => {
  const required = ['skills', 'weapons', 'marks', 'blessings', 'variants'];
  for (const field of required) {
    const data = completeModel();
    data.package_kind = 'published';
    data.skills[0].asset_ids = [];
    data.assets = [];
    data[field] = [];
    assert.throws(() => validatePublishedContent(data), /published content requires nonempty/i, field);
  }
  const emptyFixture = {
    schema_version: 2, package_kind: 'fixture', game_version: 'fixture',
    skills: [], weapons: [], marks: [], blessings: [], variants: [], bindings: [],
    assets: [], routes: [], sources: []
  };
  assert.doesNotThrow(() => validatePublishedContent(emptyFixture));
});

// Scenario: A redirect preserves an actual old source URL and points to the same content's canonical route.
// Purpose: Carry validated aliases through catalog generation without inventing old URLs.
test('InterT03_roundtrips_validated_redirect_aliases', () => {
  const data = completeModel();
  const alias = {
    route_kind: 'redirect', content_kind: 'skill', content_key: 'veteran/practice_guard',
    source_route: '/skills/veteran/practice-guard/',
    target_route: '/skills/veteran/practice_guard/', decision: 'redirect'
  };
  data.routes.push(alias);
  const files = createPublicFiles(data, { assetBytes });
  const catalog = JSON.parse(files.get('catalog.json'));
  assert.deepEqual(catalog.redirects, [{ source_route: alias.source_route, target_route: alias.target_route }]);
  const indexAlias = structuredClone(data);
  indexAlias.routes[indexAlias.routes.length - 1].source_route = '/skills/veteran/';
  assert.throws(() => validatePublishedContent(indexAlias, { assetBytes }), /index|route/i);
  const canonicalAlias = structuredClone(data);
  canonicalAlias.routes[0].source_route = '/skills/veteran/old/';
  assert.throws(() => validatePublishedContent(canonicalAlias, { assetBytes }), /canonical|source_route/i);
});

// Scenario: A valid package contains variants but has no mark-specific bindings.
// Purpose: Derive weapon–variant–blessing relations from direct source fields and reserve bindings for mark compatibility.
test('InterT04_derives_reciprocal_variant_relations_without_bindings', () => {
  const data = completeModel();
  data.bindings = [];
  const files = createPublicFiles(data, { assetBytes });
  const catalog = JSON.parse(files.get('catalog.json'));
  const entry = kind => catalog.entries.find(item => item.kind === kind);
  const detailOf = kind => JSON.parse(files.get(entry(kind).detail_path));
  assert.equal(detailOf('weapon').relations.some(relation => relation.kind === 'variant' && relation.id === 'steady-example-rifle'), true);
  assert.equal(detailOf('weapon').relations.some(relation => relation.kind === 'blessing' && relation.id === 'steady-example'), true);
  assert.equal(detailOf('blessing').relations.some(relation => relation.kind === 'weapon' && relation.id === 'practice-rifle'), true);
  assert.equal(detailOf('variant').relations.some(relation => relation.kind === 'weapon' && relation.id === 'practice-rifle'), true);
  assert.equal(detailOf('variant').relations.some(relation => relation.kind === 'blessing' && relation.id === 'steady-example'), true);
  assert.equal(detailOf('variant').relations.some(relation => relation.kind === 'mark'), false);
});

// Scenario: The source has no defensible Traditional Chinese weapon or mark label.
// Purpose: Preserve unknown names as null so the client can display its ID-based placeholder without fabricating a translation.
test('UnitT18_preserves_unknown_weapon_and_mark_names_as_null', () => {
  const data = completeModel();
  data.weapons[0].name_zh_tw = null;
  data.marks[0].name_zh_tw = null;
  const files = createPublicFiles(data, { assetBytes });
  const catalog = JSON.parse(files.get('catalog.json'));
  assert.equal(catalog.entries.find(entry => entry.kind === 'weapon').name_zh_tw, null);
  assert.equal(catalog.entries.find(entry => entry.kind === 'mark').name_zh_tw, null);
  const weapon = catalog.entries.find(entry => entry.kind === 'weapon');
  const weaponDetail = JSON.parse(files.get(weapon.detail_path));
  assert.equal(weaponDetail.relations.find(relation => relation.kind === 'mark').name_zh_tw, null);
});

// Scenario: A skill has no trustworthy Traditional Chinese title in the pinned localization source.
// Purpose: Preserve null through projection, catalog, skill/mechanics details, and relations without inventing a label.
test('InterT08_roundtrips_null_skill_name_through_public_files', () => {
  const data = completeModel();
  data.skills[0].name_zh_tw = null;
  const projected = projectPublicContent(data);
  assert.equal(projected.skills[0].name_zh_tw, null);
  assert.doesNotThrow(() => validatePublishedContent(projected, { assetBytes }));

  const files = createPublicFiles(projected, { assetBytes });
  const report = validatePublicFiles(files);
  const catalog = report.catalog;
  const skillEntry = catalog.entries.find(entry => entry.kind === 'skill');
  const mechanicsEntry = catalog.entries.find(entry => entry.kind === 'mechanics');
  assert.equal(skillEntry.name_zh_tw, null);
  assert.equal(mechanicsEntry.name_zh_tw, null);
  const skillDetail = JSON.parse(files.get(skillEntry.detail_path));
  const mechanicsDetail = JSON.parse(files.get(mechanicsEntry.detail_path));
  assert.equal(skillDetail.record.name_zh_tw, null);
  assert.equal(mechanicsDetail.record.name_zh_tw, null);
  assert.equal(skillDetail.relations.find(relation => relation.kind === 'mechanics').name_zh_tw, null);
  assert.equal(mechanicsDetail.relations.find(relation => relation.kind === 'skill').name_zh_tw, null);
});

// Scenario: A source supplies only the English title "Low Profile" for a skill.
// Purpose: Allow null for untranslated names while continuing to reject English-only zh-TW names.
test('UnitT21_rejects_english_only_skill_name_but_accepts_null', () => {
  const untranslated = completeModel();
  untranslated.skills[0].name_zh_tw = null;
  assert.doesNotThrow(() => validatePublishedContent(projectPublicContent(untranslated), { assetBytes }));

  const englishOnly = completeModel();
  englishOnly.skills[0].name_zh_tw = 'Low Profile';
  assert.throws(() => validatePublishedContent(projectPublicContent(englishOnly), { assetBytes }), /name|Chinese|繁中/i);
});

// Scenario: Generated files are modified after creation or a relation/redirect is malformed.
// Purpose: Validate the public artifact as a coherent, allowlisted package before the static builder consumes it.
test('InterT05_validates_public_files_and_rejects_catalog_relation_and_redirect_tampering', () => {
  const data = completeModel();
  const files = createPublicFiles(data, { assetBytes });
  const report = validatePublicFiles(files);
  assert.equal(report.entries.length, report.catalog.entries.length);

  const wrongCount = new Map(files);
  const catalog = JSON.parse(wrongCount.get('catalog.json'));
  catalog.counts.weapons++;
  wrongCount.set('catalog.json', JSON.stringify(catalog));
  assert.throws(() => validatePublicFiles(wrongCount), /count/i);

  const wrongRelation = new Map(files);
  const skill = report.catalog.entries.find(entry => entry.kind === 'skill');
  const detail = JSON.parse(wrongRelation.get(skill.detail_path));
  detail.relations[0].route = '/weapons/not-the-mechanics/';
  wrongRelation.set(skill.detail_path, JSON.stringify(detail));
  assert.throws(() => validatePublicFiles(wrongRelation), /relation|route/i);

  const withAlias = completeModel();
  withAlias.routes.push({
    route_kind: 'redirect', content_kind: 'skill', content_key: 'veteran/practice_guard',
    source_route: '/skills/veteran/practice-guard/',
    target_route: '/skills/veteran/practice_guard/', decision: 'redirect'
  });
  const badRedirect = new Map(createPublicFiles(withAlias, { assetBytes }));
  const aliasCatalog = JSON.parse(badRedirect.get('catalog.json'));
  aliasCatalog.redirects[0].source_route = '/skills/veteran/';
  badRedirect.set('catalog.json', JSON.stringify(aliasCatalog));
  assert.throws(() => validatePublicFiles(badRedirect), /redirect|reserved|route/i);
});

// Scenario: A Games Lantern image appears on a skill and its mechanics pages.
// Purpose: Keep the visible direct credit attached to every generated page that displays the image.
test('UnitT19_requires_games_lantern_credit_on_each_output_detail', () => {
  const data = completeModel();
  data.assets[0].source_url = 'https://gameslantern.com/storage/sites/darktide/icons/sample.svg';
  data.assets[0].attribution = {
    href: 'https://www.gameslantern.com/darktide/credits/',
    text: '資料來源：Games Lantern',
    follow_required: true
  };
  const files = new Map(createPublicFiles(data, { assetBytes }));
  const catalog = JSON.parse(files.get('catalog.json'));
  for (const entry of catalog.entries) {
    const detail = JSON.parse(files.get(entry.detail_path));
    if (detail.assets.length) {
      detail.assets[0].attribution = null;
      files.set(entry.detail_path, JSON.stringify(detail));
    }
  }
  assert.throws(() => validatePublicFiles(files), /Games Lantern|attribution/i);
});

// Scenario: Generated details contain malformed values, conflicting shared provenance, or no required release classes.
// Purpose: Reuse the source-model semantic validators against the emitted package so tampering cannot bypass release checks.
test('InterT06_revalidates_generated_rows_sources_and_published_class_counts', () => {
  const baseFiles = () => createPublicFiles(completeModel(), { assetBytes });
  const badTier = new Map(baseFiles());
  const tierCatalog = JSON.parse(badTier.get('catalog.json'));
  const variantEntry = tierCatalog.entries.find(entry => entry.kind === 'variant');
  const variant = JSON.parse(badTier.get(variantEntry.detail_path));
  variant.record.defined_tiers = [5];
  variant.record.tier_claims = [];
  badTier.set(variantEntry.detail_path, JSON.stringify(variant));
  assert.throws(() => validatePublicFiles(badTier), /tier/i);

  const badClaim = new Map(baseFiles());
  const skillCatalog = JSON.parse(badClaim.get('catalog.json'));
  const skillEntry = skillCatalog.entries.find(entry => entry.kind === 'skill');
  const skill = JSON.parse(badClaim.get(skillEntry.detail_path));
  skill.record.claims[0].state = 'unreviewed';
  badClaim.set(skillEntry.detail_path, JSON.stringify(skill));
  assert.throws(() => validatePublicFiles(badClaim), /claim/i);

  const conflictingSource = new Map(baseFiles());
  const conflictCatalog = JSON.parse(conflictingSource.get('catalog.json'));
  const mechanicsEntry = conflictCatalog.entries.find(entry => entry.kind === 'mechanics');
  const mechanics = JSON.parse(conflictingSource.get(mechanicsEntry.detail_path));
  mechanics.sources[0].url = 'https://other.example/source';
  conflictingSource.set(mechanicsEntry.detail_path, JSON.stringify(mechanics));
  assert.throws(() => validatePublicFiles(conflictingSource), /source|provenance/i);

  const wrongOwner = new Map(baseFiles());
  const ownerCatalog = JSON.parse(wrongOwner.get('catalog.json'));
  const ownerEntry = ownerCatalog.entries.find(entry => entry.kind === 'variant');
  const owner = JSON.parse(wrongOwner.get(ownerEntry.detail_path));
  owner.record.weapon_id = 'missing-weapon';
  wrongOwner.set(ownerEntry.detail_path, JSON.stringify(owner));
  assert.throws(() => validatePublicFiles(wrongOwner), /weapon|reference|relation/i);

  const emptyPublished = new Map([['catalog.json', JSON.stringify({
    schema_version: 2, game_version: '1.13.1', package_kind: 'published',
    counts: { skills: 0, weapons: 0, marks: 0, blessings: 0, variants: 0, mechanics: 0 },
    entries: [], redirects: []
  })]]);
  assert.throws(() => validatePublicFiles(emptyPublished), /published content requires nonempty/i);
});


 
// Scenario: a variant has a player-facing mechanic description from its own pinned source page.
// Purpose: Preserve that variant-specific explanation through projection and generated detail JSON.
test('UnitT20_projects_and_validates_nullable_variant_effect_text', () => {
  const data = completeModel();
  data.variants[0].effect_zh_tw = '連續命中可提高近戰威力。';
  const projected = projectPublicContent(data);
  assert.equal(projected.variants[0].effect_zh_tw, '連續命中可提高近戰威力。');
  assert.doesNotThrow(() => validatePublishedContent(projected, { assetBytes }));

  const nullable = completeModel();
  const projectedNullable = projectPublicContent(nullable);
  assert.equal(projectedNullable.variants[0].effect_zh_tw, null);
  assert.doesNotThrow(() => validatePublishedContent(projectedNullable, { assetBytes }));

  for (const value of ['', 42, {}]) {
    const invalid = completeModel();
    invalid.variants[0].effect_zh_tw = value;
    assert.throws(() => validatePublishedContent(invalid, { assetBytes }), /effect_zh_tw|variant/i);
  }
});

// Scenario: variant effect text is published in the matching detail record.
// Purpose: Keep the generated detail representation identical to the single source model.
test('InterT07_roundtrips_variant_effect_text_in_detail_record', () => {
  const data = completeModel();
  data.variants[0].effect_zh_tw = '此武器特定變體的效果說明。';
  const files = createPublicFiles(data, { assetBytes });
  const catalog = JSON.parse(files.get('catalog.json'));
  const entry = catalog.entries.find(row => row.kind === 'variant');
  const detail = JSON.parse(files.get(entry.detail_path));
  assert.equal(detail.record.effect_zh_tw, data.variants[0].effect_zh_tw);
  assert.doesNotThrow(() => validatePublicFiles(files));
});
function remoteAttachment(url = 'https://github.com/user-attachments/assets/12345678-1234-4234-9234-123456789abc') {
  const asset_id = 'github-' + createHash('sha256').update(url).digest('hex');
  return {
    asset_id, path: null, sha256: null, media_type: null, source_url: url,
    attribution: { href: 'https://gameslantern.com/storage/sites/darktide/icons/sample.svg', text: '圖片來源：Games Lantern', follow_required: true }
  };
}

function publishedRemoteModel(url) {
  const data = completeModel();
  data.package_kind = 'published';
  const asset = remoteAttachment(url);
  data.assets = [asset];
  data.skills[0].asset_ids = [asset.asset_id];
  return data;
}

// Scenario: A production package references an existing GitHub Issue attachment URL and has no local icon bytes.
// Purpose: Keep the source URL, stable ID, and Games Lantern credit in every detail without copying image files.
test('InterT09_generates_remote_attachment_only_published_package', () => {
  const data = publishedRemoteModel();
  assert.doesNotThrow(() => validatePublishedContent(publishedRemoteModel('https://github.com/user-attachments/assets/12345678-1234-4234-9234-123456789ABC')));
  const subdomainCredit = publishedRemoteModel();
  subdomainCredit.assets[0].attribution.href = 'https://darktide.gameslantern.com/credits/';
  assert.doesNotThrow(() => validatePublishedContent(subdomainCredit));
  assert.doesNotThrow(() => validatePublishedContent(data));
  const files = createPublicFiles(data);
  assert.doesNotThrow(() => validatePublicFiles(files));
  assert.ok([...files.keys()].every(path => path === 'catalog.json' || path.startsWith('details/')));
  assert.ok([...files.values()].every(value => typeof value === 'string'));
  const catalog = JSON.parse(files.get('catalog.json'));
  for (const entry of catalog.entries.filter(entry => entry.kind === 'skill' || entry.kind === 'mechanics')) {
    const detail = JSON.parse(files.get(entry.detail_path));
    assert.deepEqual(Object.keys(detail.assets[0]).sort(), ['asset_id', 'attribution', 'path', 'source_url']);
    assert.equal(detail.assets[0].path, null);
    assert.equal(detail.assets[0].source_url, data.assets[0].source_url);
    assert.equal(detail.assets[0].attribution.href, 'https://gameslantern.com/storage/sites/darktide/icons/sample.svg');
    assert.equal(detail.assets[0].attribution.follow_required, true);
  }
});

// Scenario: A remote image URL or its nullable metadata is malformed.
// Purpose: Accept only the exact HTTPS GitHub user-attachments UUID form and prevent partial remote/local records.
test('UnitT23_rejects_noncanonical_remote_asset_urls_and_partial_metadata', () => {
  const base = 'https://github.com/user-attachments/assets/12345678-1234-4234-9234-123456789abc';
  for (const url of [
    'http://github.com/user-attachments/assets/12345678-1234-4234-9234-123456789abc',
    'https://github.com.evil/user-attachments/assets/12345678-1234-4234-9234-123456789abc',
    'HTTPS://github.com/user-attachments/assets/12345678-1234-4234-9234-123456789abc',
    'https://GITHUB.com/user-attachments/assets/12345678-1234-4234-9234-123456789abc',
    'https://user@github.com/user-attachments/assets/12345678-1234-4234-9234-123456789abc',
    base + '?download=1', base + '#image', base + ':443', base + '/extra',
    'https://github.com/user-attachments/assets/not-a-uuid'
  ]) {
    assert.throws(() => validatePublishedContent(publishedRemoteModel(url)), /remote|attachment|asset source_url/i, url);
  }
  const partial = publishedRemoteModel();
  partial.assets[0].media_type = 'image/png';
  assert.throws(() => validatePublishedContent(partial), /remote|metadata|asset path/i);
  const wrongId = publishedRemoteModel();
  wrongId.assets[0].asset_id = 'github-not-the-url-hash';
  wrongId.skills[0].asset_ids = [wrongId.assets[0].asset_id];
  assert.throws(() => validatePublishedContent(wrongId), /asset|hash|ID/i);
});

// Scenario: A remote GitHub image loses or weakens its required Games Lantern credit.
// Purpose: Require direct visible Games Lantern attribution and follow on every emitted usage page.
test('UnitT24_requires_direct_follow_games_lantern_credit_for_remote_assets', () => {
  const badCredits = [
    null,
    { href: 'https://www.gameslantern.com/darktide/credits/', text: '圖片來源：Games Lantern', follow_required: true },
    { href: 'https://gameslantern.com.evil/storage/sites/darktide/', text: '圖片來源：Games Lantern', follow_required: true },
    { href: 'https://evilgameslantern.com/storage/sites/darktide/', text: '圖片來源：Games Lantern', follow_required: true },
    { href: 'https://user@gameslantern.com/storage/sites/darktide/', text: '圖片來源：Games Lantern', follow_required: true },
    { href: 'https://gameslantern.com:8443/storage/sites/darktide/', text: '圖片來源：Games Lantern', follow_required: true },
    { href: 'https://example.com/credits/', text: '圖片來源：Games Lantern', follow_required: true },
    { href: 'https://gameslantern.com/storage/sites/darktide/icons/sample.svg', text: '', follow_required: true },
    { href: 'https://gameslantern.com/storage/sites/darktide/icons/sample.svg', text: '圖片來源：Games Lantern', follow_required: false }
  ];
  for (const attribution of badCredits) {
    const data = publishedRemoteModel();
    data.assets[0].attribution = attribution;
    assert.throws(() => validatePublishedContent(data), /Games Lantern|attribution|follow/i);
  }
});

// Scenario: The public detail is edited to remove the credit or point at a different host after generation.
// Purpose: Validate every remote asset use site independently of the root source_url.
test('InterT10_rejects_remote_detail_credit_tampering', () => {
  const baseFiles = createPublicFiles(publishedRemoteModel());
  for (const mutate of [
    attribution => { attribution = null; return attribution; },
    attribution => ({ ...attribution, href: 'https://www.gameslantern.com/darktide/credits/' }),
    attribution => ({ ...attribution, follow_required: false })
  ]) {
    const files = new Map(baseFiles);
    const catalog = JSON.parse(files.get('catalog.json'));
    const skill = catalog.entries.find(entry => entry.kind === 'skill');
    const detail = JSON.parse(files.get(skill.detail_path));
    detail.assets[0].attribution = mutate(detail.assets[0].attribution);
    files.set(skill.detail_path, JSON.stringify(detail));
    assert.throws(() => validatePublicFiles(files), /Games Lantern|attribution|follow/i);
  }
});

// Scenario: Asset bytes are supplied for a file absent from the public model.
// Purpose: Reject accidental unlisted local files instead of silently dropping or publishing them.
test('UnitT25_rejects_unlisted_local_asset_bytes', () => {
  const bytes = new Map(assetBytes);
  bytes.set('icons/unlisted.png', Buffer.from('not an image'));
  assert.throws(() => validatePublishedContent(completeModel(), { assetBytes: bytes }), /unlisted|unreferenced|assetBytes/i);
});