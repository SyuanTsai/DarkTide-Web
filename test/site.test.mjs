import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../fixtures/site.mjs';
import { renderSite } from '../src/site/render.mjs';

// Scenario: A valid fictional package is rendered without remote data.
// Purpose: Prove all three primary routes and the two-way relationship are present.
test('UnitT10_renders_three_categories_and_two_way_links', () => {
  const files = renderSite(structuredClone(fixture));
  assert.ok(files.has('index.html'));
  assert.ok(files.has('skills/veteran/practice-guard/index.html'));
  assert.ok(files.has('weapons/practice-rifle/index.html'));
  assert.ok(files.has('blessings/steady-example/index.html'));
  assert.match(files.get('weapons/practice-rifle/index.html'), /href="\/blessings\/steady-example\/"/);
  assert.match(files.get('blessings/steady-example/index.html'), /href="\/weapons\/practice-rifle\/"/);
});

// Scenario: The homepage is rendered from a package with detail records.
// Purpose: Keep the entry page focused on category navigation at catalog scale.
test('UnitT11_home_links_to_catalogs_without_listing_every_record', () => {
  const home = renderSite(structuredClone(fixture)).get('index.html');
  for (const route of ['/skills/', '/weapons/', '/blessings/']) assert.ok(home.includes(`href="${route}"`));
  assert.doesNotMatch(home, /href="\/(?:skills|weapons|blessings)\/[^\"]+\/"/);
  assert.doesNotMatch(home, /演示防護|演示步槍|演示穩定/);
});

// Scenario: Skills from two archetypes arrive in reverse archetype order.
// Purpose: Provide stable, keyboard-usable class sections without client-side code.
test('UnitT12_groups_skill_catalog_by_archetype_with_jump_links', () => {
  const data = structuredClone(fixture);
  data.skills.push({ ...data.skills[0], archetype: 'arbites', name_zh_tw: '演示執法' });
  data.routes.push({ ...data.routes[0], content_key: 'arbites/practice-guard',
    target_route: '/skills/arbites/practice-guard/' });
  const catalog = renderSite(data).get('skills/index.html');
  assert.match(catalog, /aria-label="職業跳轉"/);
  assert.ok(catalog.indexOf('職業：arbites') < catalog.indexOf('職業：veteran'));
  assert.match(catalog, /href="#skill-group-1"/);
  assert.match(catalog, /id="skill-group-1"/);
  assert.match(catalog, /href="\/skills\/arbites\/practice-guard\/"/);
  assert.match(catalog, /href="\/skills\/veteran\/practice-guard\/"/);
});

// Scenario: A ranged weapon is followed by a melee weapon in the source package.
// Purpose: Group the weapon catalog by type while retaining both detail routes.
test('UnitT13_groups_weapon_catalog_by_kind_with_jump_links', () => {
  const data = structuredClone(fixture);
  data.weapons.push({ ...data.weapons[0], weapon_id: 'practice-blade', kind: 'melee',
    name_zh_tw: '演示刀', mark_ids: ['practice-blade-m1'] });
  data.marks.push({ ...data.marks[0], mark_id: 'practice-blade-m1', weapon_id: 'practice-blade' });
  data.routes.push({ ...data.routes.find(row => row.content_kind === 'weapon'),
    content_key: 'practice-blade', target_route: '/weapons/practice-blade/' });
  data.routes.push({ ...data.routes.find(row => row.content_kind === 'mark'),
    content_key: 'practice-blade-m1', target_route: '/weapons/practice-blade/marks/practice-blade-m1/' });
  const catalog = renderSite(data).get('weapons/index.html');
  assert.match(catalog, /aria-label="武器類型跳轉"/);
  assert.ok(catalog.indexOf('近戰武器') < catalog.indexOf('遠程武器'));
  assert.match(catalog, /href="#weapon-group-1"/);
  assert.match(catalog, /id="weapon-group-1"/);
  assert.match(catalog, /href="\/weapons\/practice-blade\/"/);
  assert.match(catalog, /href="\/weapons\/practice-rifle\/"/);
  assert.doesNotMatch(catalog, />ranged<|>melee</);
});

// Scenario: A valid fictional package is rendered for an unknown route.
// Purpose: Give visitors a navigable Traditional Chinese error page without indexing it.
test('UnitT15_renders_navigable_noindex_not_found_page', () => {
  const page = renderSite(structuredClone(fixture)).get('404.html');
  assert.match(page, /<html lang="zh-Hant-TW">/);
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.match(page, /找不到頁面/);
  for (const route of ['/', '/skills/', '/weapons/', '/blessings/']) {
    assert.ok(page.includes(`href="${route}"`));
  }
});

// Scenario: An icon with a required attribution is used on one page.
// Purpose: Keep its visible direct follow link on that page's initial HTML.
test('UnitT20_renders_attribution_on_each_using_page', () => {
  const data = structuredClone(fixture);
  data.skills[0].asset_ids = ['sample-icon'];
  data.assets = [{ asset_id: 'sample-icon', path: '/assets/sample.svg', alt: '示範圖示', attribution: { text: 'Icons obtained with permission from darktide.gameslantern.com', href: 'https://darktide.gameslantern.com/', follow_required: true } }];
  const page = renderSite(data).get('skills/veteran/practice-guard/index.html');
  assert.match(page, /href="https:\/\/darktide\.gameslantern\.com\/"/);
  assert.match(page, /Icons obtained with permission/);
  assert.doesNotMatch(page, /rel="[^"]*(?:nofollow|ugc|sponsored)/);
  assert.doesNotMatch(page, /<meta name="robots" content="[^"]*nofollow/);
});

// Scenario: The exact same fixed fixture is rendered twice.
// Purpose: Prevent timestamps or process state from changing build inputs.
test('UnitT30_renders_deterministic_file_bytes', () => {
  const first = [...renderSite(structuredClone(fixture))];
  const second = [...renderSite(structuredClone(fixture))];
  assert.deepEqual(first, second);
});

// Scenario: A fictional mark has its own canonical route under the owning weapon.
// Purpose: Expose mark-specific claims and applicable blessings through a resolvable page.
test('UnitT35_renders_mark_detail_with_weapon_and_blessing_links', () => {
  const data = structuredClone(fixture);
  const files = renderSite(data);
  const weapon = files.get('weapons/practice-rifle/index.html');
  const mark = files.get('weapons/practice-rifle/marks/practice-rifle-m1/index.html');
  assert.match(weapon, /href="\/weapons\/practice-rifle\/marks\/practice-rifle-m1\/"/);
  assert.match(mark, /演示型/);
  assert.match(mark, /href="\/weapons\/practice-rifle\/"/);
  assert.match(mark, /href="\/blessings\/steady-example\/"/);
});

// Scenario: Every locally generated page is checked after rendering the fixture.
// Purpose: Catch navigation paths that do not resolve to another generated file.
test('UnitT40_renders_only_resolvable_internal_links', () => {
  const files = renderSite(structuredClone(fixture));
  for (const [name, body] of files) {
    if (!name.endsWith('.html')) continue;
    for (const match of body.matchAll(/href="(\/[^"]*)"/g)) {
      const target = match[1] === '/' ? 'index.html' : match[1].endsWith('/') ? `${match[1].slice(1)}index.html` : match[1].slice(1);
      assert.ok(files.has(target), `${name} links to missing ${match[1]}`);
    }
  }
});

// Scenario: A fictional weapon and two marks carry fixed and unknown numeric claims.
// Purpose: Show mark values under their own mark without implying they apply to the weapon.
test('UnitT50_renders_numeric_claims_at_their_record_level', () => {
  const data = structuredClone(fixture);
  data.weapons[0].claims = [{ claim_id: 'capacity', state: 'known', value: '30', unit: 'count', unit_note: null, source_ref: 'fixture-source' }];
  data.marks[0].claims = [{ claim_id: 'stability', state: 'known', value: '12.5', unit: 'percent', unit_note: null, source_ref: 'fixture-source' }];
  data.weapons[0].mark_ids.push('practice-rifle-m2');
  data.marks.push({ ...structuredClone(data.marks[0]), mark_id: 'practice-rifle-m2', name_zh_tw: '演示二型', claims: [
    { claim_id: 'stability', state: 'unknown', value: null, unit: null, unit_note: null, source_ref: null }
  ] });
  data.routes.push({ route_kind: 'canonical', content_kind: 'mark',
    content_key: 'practice-rifle-m2', source_route: null,
    target_route: '/weapons/practice-rifle/marks/practice-rifle-m2/', decision: 'keep' });
  const page = renderSite(data).get('weapons/practice-rifle/index.html');
  assert.match(page, /容量|capacity/);
  assert.match(page, /30.*個/);
  assert.match(page, /演示型[\s\S]*12\.5.*%[\s\S]*演示二型[\s\S]*尚未確認/);
});

// Scenario: A fictional blessing variant defines one tier claim while available tiers remain unknown.
// Purpose: Display a verified tier value without claiming that the tier is currently obtainable.
test('UnitT60_renders_tier_claim_without_inventing_availability', () => {
  const data = structuredClone(fixture);
  data.variants[0].tier_claims = [{ tier: 1, claims: [
    { claim_id: 'stability', state: 'known', value: '5', unit: 'percent', unit_note: null, source_ref: 'fixture-source' }
  ] }];
  const page = renderSite(data).get('blessings/steady-example/variants/steady-example-rifle/index.html');
  assert.match(page, /可用階級：尚未確認/);
  assert.match(page, /第 1 階[\s\S]*stability[\s\S]*5%/);
});
