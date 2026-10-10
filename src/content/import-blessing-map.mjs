import { validGitSourcePath } from './source-path.mjs';
import { parseJsonSource } from './source-selector.mjs';

const idPattern = /^[a-z][a-z0-9_-]{0,127}$/;
const shaPattern = /^[a-f0-9]{64}$/;
const ordered = rows => rows.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

function requireId(value, label) {
  if (!idPattern.test(value ?? '')) throw new Error(`invalid ${label} ID`);
  return value;
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing ${label} text`);
  return value;
}

function indexed(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`missing ${label} array`);
  const byId = new Map();
  rows.forEach((row, index) => {
    const id = requireId(row?.id, label);
    if (byId.has(id)) throw new Error(`duplicate ${label} ID: ${id}`);
    byId.set(id, { row, index });
  });
  return byId;
}

function tiers(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (!Array.isArray(value) || value.some(tier => !Number.isInteger(tier) || tier < 1 || tier > 4) ||
      value.some((tier, index) => index > 0 && value[index - 1] >= tier)) {
    throw new Error(`invalid ${label} tiers`);
  }
  return [...value];
}

const evidence = (sourceId, selector) => ({ source_id: sourceId, selector });

// Selects fixed-map fields and relationships for review only; no claims or rights are approved.
export async function importBlessingMapCandidates({ sourceLock, sourceBytes } = {}) {
  if (sourceLock?.kind !== 'git_file' || !idPattern.test(sourceLock.source_id ?? '') ||
      !validGitSourcePath(sourceLock.path) || !sourceLock.path.endsWith('/BLESSING_WEAPON_MAP.json') ||
      !shaPattern.test(sourceLock.sha256 ?? '') || !(sourceBytes instanceof Map) ||
      !(sourceBytes.get(sourceLock.source_id) instanceof Uint8Array)) {
    throw new Error('invalid or missing blessing map source');
  }
  const stableBytes = new Uint8Array(sourceBytes.get(sourceLock.source_id));
  const digest = await crypto.subtle.digest('SHA-256', stableBytes);
  const actual = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  if (actual !== sourceLock.sha256) throw new Error('blessing map hash drift');
  const map = parseJsonSource(stableBytes, sourceLock.source_id);
  if (map?.schema_version !== 1) throw new Error('unsupported blessing map schema');
  const blessingIndex = indexed(map.blessings, 'blessing');
  const weaponIndex = indexed(map.weapons, 'weapon');
  const variantIndex = indexed(map.variants, 'variant');
  if (!Array.isArray(map.bindings)) throw new Error('missing binding array');
  const marks = new Map();
  for (const [weaponId, { row: weapon, index: weaponIndexNumber }] of weaponIndex) {
    if (!['melee', 'ranged'].includes(weapon.kind)) throw new Error(`invalid weapon kind: ${weaponId}`);
    requireText(weapon.name_zh_tw, `weapon ${weaponId} name`);
    if (!Array.isArray(weapon.marks)) throw new Error(`missing weapon marks: ${weaponId}`);
    weapon.marks.forEach((mark, markIndex) => {
      const markId = requireId(mark?.id, 'mark');
      if (marks.has(markId)) throw new Error(`duplicate mark ID: ${markId}`);
      requireText(mark.name, `mark ${markId} name`);
      if (!validGitSourcePath(mark.template_file)) throw new Error(`invalid mark template path: ${markId}`);
      marks.set(markId, { row: mark, index: markIndex, weaponId, weaponIndex: weaponIndexNumber });
    });
  }
  for (const [blessingId, { row }] of blessingIndex) {
    requireText(row.name_zh_tw, `blessing ${blessingId} name`);
    requireText(row.effect, `blessing ${blessingId} effect`);
    if (!['melee', 'ranged', 'mixed'].includes(row.kind)) throw new Error(`invalid blessing kind: ${blessingId}`);
  }
  for (const [variantId, { row }] of variantIndex) {
    if (!blessingIndex.has(row.blessing_id) || !weaponIndex.has(row.weapon_id)) {
      throw new Error(`variant ${variantId} has missing blessing or weapon`);
    }
    const defined = tiers(row.defined_tiers, `variant ${variantId} defined`);
    if (defined.length === 0) throw new Error(`variant ${variantId} has no defined tier`);
    const available = tiers(row.available_tiers, `variant ${variantId} available`, true);
    if (available?.some(tier => !defined.includes(tier))) {
      throw new Error(`variant ${variantId} has undefined available tier`);
    }
    if (!row.values || typeof row.values !== 'object' || Array.isArray(row.values)) {
      throw new Error(`variant ${variantId} has invalid numeric review fields`);
    }
  }
  const bindingKeys = new Set();
  const boundVariants = new Set();
  const bindings = map.bindings.map((row, index) => {
    const ids = ['blessing_id', 'weapon_id', 'mark_id', 'variant_id'].map(field => requireId(row?.[field], `binding ${field}`));
    const [blessingId, weaponId, markId, variantId] = ids;
    const bindingKey = ids.join('|');
    if (bindingKeys.has(bindingKey)) throw new Error(`duplicate binding: ${bindingKey}`);
    bindingKeys.add(bindingKey);
    const mark = marks.get(markId);
    const variant = variantIndex.get(variantId)?.row;
    if (!blessingIndex.has(blessingId) || !weaponIndex.has(weaponId) ||
        !mark || mark.weaponId !== weaponId || !variant ||
        variant.blessing_id !== blessingId || variant.weapon_id !== weaponId) {
      throw new Error(`binding mark or variant relationship mismatch: ${bindingKey}`);
    }
    const available = tiers(row.available_tiers, `binding ${bindingKey} available`, true);
    if (available?.some(tier => !variant.defined_tiers.includes(tier))) {
      throw new Error(`binding ${bindingKey} has undefined available tier`);
    }
    if (row.trait_item !== null && !validGitSourcePath(row.trait_item)) {
      throw new Error(`binding trait item path is invalid: ${bindingKey}`);
    }
    if (row.trait_category !== null) requireId(row.trait_category, 'binding trait category');
    boundVariants.add(variantId);
    return { ...Object.fromEntries(['blessing_id', 'weapon_id', 'mark_id', 'variant_id'].map(field => [field, row[field]])),
      trait_item: row.trait_item, trait_category: row.trait_category,
      available_tiers: available,
      source_fields: { trait_item: evidence(sourceLock.source_id, `json:/bindings/${index}/trait_item`),
        trait_category: evidence(sourceLock.source_id, `json:/bindings/${index}/trait_category`),
        available_tiers: evidence(sourceLock.source_id, `json:/bindings/${index}/available_tiers`) },
      review_status: 'pending' };
  });
  for (const variantId of variantIndex.keys()) {
    if (!boundVariants.has(variantId)) throw new Error(`variant ${variantId} has no binding`);
  }
  const blessings = ordered([...blessingIndex].map(([id, { row, index }]) => ({
    id, blessing_id: id, kind: row.kind, name_zh_tw: row.name_zh_tw,
    effect_zh_tw: row.effect,
    variant_ids: [...variantIndex.values()].filter(item => item.row.blessing_id === id).map(item => item.row.id).sort(),
    canonical_route: `/blessings/${id}/`,
    source_fields: { name_zh_tw: evidence(sourceLock.source_id, `json:/blessings/${index}/name_zh_tw`),
      effect_zh_tw: evidence(sourceLock.source_id, `json:/blessings/${index}/effect`) },
    review_status: 'pending', asset_ids: []
  })));
  const weapons = ordered([...weaponIndex].map(([id, { row, index }]) => ({
    id, weapon_id: id, kind: row.kind, name_zh_tw: row.name_zh_tw,
    mark_ids: row.marks.map(mark => mark.id).sort(), canonical_route: `/weapons/${id}/`,
    source_fields: { name_zh_tw: evidence(sourceLock.source_id, `json:/weapons/${index}/name_zh_tw`) },
    review_status: 'pending', asset_ids: []
  })));
  const markCandidates = ordered([...marks].map(([id, item]) => ({
    id, mark_id: id, weapon_id: item.weaponId, name_zh_tw: item.row.name,
    template_file: item.row.template_file,
    source_fields: { name_zh_tw: evidence(sourceLock.source_id,
      `json:/weapons/${item.weaponIndex}/marks/${item.index}/name`),
    template_file: evidence(sourceLock.source_id,
      `json:/weapons/${item.weaponIndex}/marks/${item.index}/template_file`) },
    review_status: 'pending', asset_ids: []
  })));
  const variants = ordered([...variantIndex].map(([id, { row, index }]) => ({
    id, variant_id: id, blessing_id: row.blessing_id, weapon_id: row.weapon_id,
    defined_tiers: [...row.defined_tiers], available_tiers: row.available_tiers === null ? null : [...row.available_tiers],
    numeric_review_fields: Object.keys(row.values).sort(), tier_claims: [],
    canonical_route: `/blessings/${row.blessing_id}/variants/${id}/`,
    source_fields: { defined_tiers: evidence(sourceLock.source_id, `json:/variants/${index}/defined_tiers`),
      available_tiers: evidence(sourceLock.source_id, `json:/variants/${index}/available_tiers`) },
    review_status: 'pending', asset_ids: []
  })));
  bindings.sort((a, b) => {
    const left = [a.blessing_id, a.weapon_id, a.mark_id, a.variant_id].join('|');
    const right = [b.blessing_id, b.weapon_id, b.mark_id, b.variant_id].join('|');
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return {
    schema_version: 1, candidate_kind: 'blessing-map-import', review_status: 'pending',
    source_lock_id: sourceLock.source_id,
    counts: { blessings: blessings.length, weapons: weapons.length, marks: markCandidates.length,
      variants: variants.length, bindings: bindings.length },
    blessings, weapons, marks: markCandidates, variants, bindings
  };
}
