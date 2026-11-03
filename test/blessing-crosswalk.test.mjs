import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  currentBlessingIdForRetainedVariantId,
  retainedBlessingIdForCurrentId,
} from '../web/shared-render.mjs';

const publishedContent = JSON.parse(await readFile(new URL('../content/published/content.json', import.meta.url), 'utf8'));

function retainedCatalog(content) {
  return {
    entries: [
      ...content.blessings.map(blessing => ({
        kind: 'blessing', id: blessing.blessing_id, route: `/blessings/${blessing.blessing_id}/`,
      })),
      ...content.variants.map(variant => ({
        kind: 'variant', id: variant.variant_id,
        route: `/blessings/${variant.blessing_id}/variants/${variant.variant_id}/`,
      })),
    ],
  };
}

// Scenario: The 1.13.1 retained variants are transformed to current bespoke blessing IDs and resolved through their catalog membership.
// Purpose: Keep the rule-derived crosswalk complete, reversible, and collision-free as W09 publishes every bespoke blessing.
test('UnitT10_MapsAll605RetainedBespokeVariantsWithoutCollisions', () => {
  const catalog = retainedCatalog(publishedContent);
  const currentIds = new Map();

  for (const variant of publishedContent.variants) {
    const currentId = currentBlessingIdForRetainedVariantId(variant.variant_id);
    assert.ok(currentId, `variant ${variant.variant_id} has a current bespoke blessing ID`);
    assert.equal(retainedBlessingIdForCurrentId(currentId, catalog), variant.blessing_id);
    assert.equal(currentIds.has(currentId), false, `current ID ${currentId} is unique`);
    currentIds.set(currentId, variant.variant_id);
  }

  assert.equal(currentIds.size, 605);
});

// Scenario: A malformed current ID or a catalog where the trait appears under multiple retained blessings is supplied.
// Purpose: Fail closed rather than guessing a retained blessing identity.
test('UnitT20_ReturnsNullForUnmappableOrAmbiguousBlessingIds', () => {
  const currentId = 'darktide:blessing:ogryn_thumper:p2-stagger-power';
  const catalog = {
    entries: [
      { kind: 'blessing', id: 'first', route: '/blessings/first/' },
      { kind: 'blessing', id: 'second', route: '/blessings/second/' },
      { kind: 'variant', id: 'weapon_trait_bespoke_ogryn_thumper_p2_stagger_power', route: '/blessings/first/variants/one/' },
      { kind: 'variant', id: 'weapon_trait_bespoke_ogryn_thumper_p2_stagger_power', route: '/blessings/second/variants/two/' },
    ],
  };

  assert.equal(retainedBlessingIdForCurrentId(currentId, catalog), null);
  assert.equal(retainedBlessingIdForCurrentId('darktide:blessing:ogryn_thumper:p2-not-a-match', catalog), null);
  assert.equal(currentBlessingIdForRetainedVariantId('weapon_trait_not_bespoke'), null);
});
