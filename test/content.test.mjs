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
