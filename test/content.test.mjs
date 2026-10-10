import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../fixtures/site.mjs';
import { validatePackage } from '../src/content/validate.mjs';

// Scenario: A fictional three-category package has one complete weapon–blessing binding.
// Purpose: Keep local previews possible while retaining relationship checks.
test('UnitT10_accepts_complete_fictional_fixture', () => {
  assert.doesNotThrow(() => validatePackage(structuredClone(fixture)));
});

// Scenario: A binding names a mark belonging to a different weapon.
// Purpose: Prevent a plausible-looking but incorrect weapon–blessing page.
test('UnitT20_rejects_binding_with_wrong_mark_owner', () => {
  const data = structuredClone(fixture);
  data.marks[0].weapon_id = 'another-weapon';
  assert.throws(() => validatePackage(data), /mark.*weapon/i);
});

// Scenario: Two records claim the same canonical URL.
// Purpose: Ensure a build never silently overwrites a content page.
test('UnitT30_rejects_duplicate_canonical_route', () => {
  const data = structuredClone(fixture);
  data.routes[1].target_route = data.routes[0].target_route;
  assert.throws(() => validatePackage(data), /duplicate.*route/i);
});

// Scenario: A real source ID contains underscores and is used in its canonical skill URL.
// Purpose: Accept the source ID alphabet while preserving the exact route-to-record join.
test('UnitT35_accepts_underscores_in_canonical_source_id_route', () => {
  const data = structuredClone(fixture);
  data.skills[0].skill_id = 'practice_guard';
  data.routes[0].content_key = 'veteran/practice_guard';
  data.routes[0].target_route = '/skills/veteran/practice_guard/';
  assert.doesNotThrow(() => validatePackage(data));
});

// Scenario: A mark declares a canonical page nested under its owning weapon.
// Purpose: Give each mark a unique validated destination for its own claims and relations.
test('UnitT37_accepts_owned_mark_canonical_route', () => {
  const data = structuredClone(fixture);
  assert.doesNotThrow(() => validatePackage(data));
});

// Scenario: A mark route is placed under a different weapon ID.
// Purpose: Reject a URL that misstates which weapon owns the mark.
test('UnitT38_rejects_mark_route_with_wrong_weapon', () => {
  const data = structuredClone(fixture);
  data.routes.find(route => route.content_kind === 'mark').target_route =
    '/weapons/another-weapon/marks/practice-rifle-m1/';
  assert.throws(() => validatePackage(data), /route.*mark|mark.*route/i);
});

// Scenario: A mark record has no route despite appearing under a weapon.
// Purpose: Ensure every published mark can be opened at its own canonical URL.
test('UnitT39_rejects_mark_without_canonical_route', () => {
  const data = structuredClone(fixture);
  data.routes = data.routes.filter(route => route.content_kind !== 'mark');
  assert.throws(() => validatePackage(data), /missing canonical route for mark/i);
});

// Scenario: The fictional package is mislabeled as a release.
// Purpose: Keep demonstration text out of a deployable release.
test('UnitT40_rejects_fixture_as_release', () => {
  const data = structuredClone(fixture);
  data.package_kind = 'release';
  assert.throws(() => validatePackage(data), /release.*unsupported/i);
});

// Scenario: A skill claims the category index URL as its own canonical URL.
// Purpose: Prevent a content page from overwriting the navigation page.
test('UnitT50_rejects_canonical_route_overwriting_category_index', () => {
  const data = structuredClone(fixture);
  data.routes[0].target_route = '/skills/';
  assert.throws(() => validatePackage(data), /route.*skill|skill.*route/i);
});

// Scenario: A Games Lantern icon is attached without its required source credit.
// Purpose: Keep use-page attribution compulsory for covered icons.
test('UnitT60_rejects_uncredited_games_lantern_icon', () => {
  const data = structuredClone(fixture);
  data.skills[0].asset_ids = ['sample-icon'];
  data.assets = [{ asset_id: 'sample-icon', path: '/assets/sample.svg', alt: '示範圖示', source_url: 'https://darktide.gameslantern.com/storage/sites/darktide/exporter/talents/sample.webp' }];
  assert.throws(() => validatePackage(data), /attribution/i);
});

// Scenario: The same blessing–weapon–mark–variant relation is listed twice.
// Purpose: Avoid duplicate links and ambiguous content joins.
test('UnitT70_rejects_duplicate_binding', () => {
  const data = structuredClone(fixture);
  data.bindings.push(structuredClone(data.bindings[0]));
  assert.throws(() => validatePackage(data), /duplicate.*binding/i);
});

// Scenario: A fictional mark has a fixed decimal claim and a separate unknown claim.
// Purpose: Accept exact values without making an unknown value look like zero.
test('UnitT80_accepts_known_and_unknown_numeric_claims', () => {
  const data = structuredClone(fixture);
  data.marks[0].claims = [
    { claim_id: 'stability', state: 'known', value: '12.5', unit: 'percent', unit_note: null, source_ref: 'fixture-source' },
    { claim_id: 'damage', state: 'unknown', value: null, unit: null, unit_note: null, source_ref: null }
  ];
  assert.doesNotThrow(() => validatePackage(data));
});

// Scenario: A mark claim contains an inferred number, invalid decimal, or duplicate ID.
// Purpose: Reject ambiguous numeric data before a page can display it.
test('UnitT90_rejects_unverified_or_malformed_numeric_claims', () => {
  const known = { claim_id: 'stability', state: 'known', value: '12.5', unit: 'percent', unit_note: null, source_ref: 'fixture-source' };
  for (const invalid of [
    { ...known, source_ref: null },
    { ...known, value: 'NaN' },
    { ...known, value: 12.5 },
    { ...known, state: 'unknown' }
  ]) {
    const data = structuredClone(fixture);
    data.marks[0].claims = [invalid];
    assert.throws(() => validatePackage(data), /numeric claim/i);
  }
  const data = structuredClone(fixture);
  data.marks[0].claims = [known, known];
  assert.throws(() => validatePackage(data), /duplicate numeric claim/i);
});

// Scenario: A tier claim names a tier absent from its variant.
// Purpose: Keep numeric claims attached to the exact defined tier.
test('UnitT100_rejects_numeric_claim_on_undefined_tier', () => {
  const data = structuredClone(fixture);
  data.variants[0].tier_claims = [{ tier: 2, claims: [] }];
  assert.throws(() => validatePackage(data), /tier claim/i);
});
