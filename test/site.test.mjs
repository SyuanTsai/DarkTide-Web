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
