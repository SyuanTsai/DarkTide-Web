const key = (kind, id) => `${kind}:${id}`;

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function uniqueIndex(rows, field, name) {
  const index = new Map();
  for (const row of requireArray(rows, name)) {
    const id = row?.[field];
    if (typeof id !== 'string' || !id) throw new Error(`${name} has an invalid ${field}`);
    if (index.has(id)) throw new Error(`duplicate ${name} ${field}: ${id}`);
    index.set(id, row);
  }
  return index;
}

const decimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const sourceIdPattern = /^[a-z][a-z0-9._-]{0,127}$/;
const claimUnits = new Set(['percent', 'seconds', 'meters', 'count', 'multiplier', 'game_unit']);

function validateClaims(claims, label) {
  const seen = new Set();
  for (const claim of requireArray(claims, `${label} numeric claims`)) {
    if (!claim || typeof claim.claim_id !== 'string' || !sourceIdPattern.test(claim.claim_id)) {
      throw new Error(`${label} has invalid numeric claim ID`);
    }
    if (seen.has(claim.claim_id)) throw new Error(`duplicate numeric claim: ${claim.claim_id}`);
    seen.add(claim.claim_id);
    if (claim.state === 'unknown') {
      if (claim.value !== null || claim.unit !== null || claim.unit_note !== null || claim.source_ref !== null) {
        throw new Error(`${label} unknown numeric claim has a value or source`);
      }
    } else if (claim.state === 'known') {
      if (typeof claim.value !== 'string' || claim.value.length > 64 || !decimalPattern.test(claim.value) ||
          !claimUnits.has(claim.unit) || !sourceIdPattern.test(claim.source_ref ?? '') ||
          (claim.unit === 'game_unit' ? typeof claim.unit_note !== 'string' || !claim.unit_note.trim() : claim.unit_note !== null)) {
        throw new Error(`${label} known numeric claim is invalid`);
      }
    } else {
      throw new Error(`${label} numeric claim has invalid state`);
    }
  }
}

export function validatePackage(data, { allowRelease = false } = {}) {
  if (!data || typeof data !== 'object' || data.schema_version !== 1) {
    throw new Error('unsupported content schema_version');
  }
  if (data.package_kind !== 'fixture' && !(allowRelease && data.package_kind === 'release')) {
    throw new Error('release packages are unsupported');
  }

  const skills = new Map();
  for (const skill of requireArray(data.skills, 'skills')) {
    if (!skill?.archetype || !skill?.skill_id) throw new Error('skill identity is missing');
    const id = `${skill.archetype}/${skill.skill_id}`;
    if (skills.has(id)) throw new Error(`duplicate skill: ${id}`);
    skills.set(id, skill);
  }
  const weapons = uniqueIndex(data.weapons, 'weapon_id', 'weapons');
  const marks = uniqueIndex(data.marks, 'mark_id', 'marks');
  const blessings = uniqueIndex(data.blessings, 'blessing_id', 'blessings');
  const variants = uniqueIndex(data.variants, 'variant_id', 'variants');
  const assets = uniqueIndex(data.assets, 'asset_id', 'assets');

  for (const [kind, rows] of [['skill', skills.values()], ['weapon', weapons.values()], ['mark', marks.values()]]) {
    for (const row of rows) validateClaims(row.claims, kind);
  }

  for (const mark of marks.values()) {
    const weapon = weapons.get(mark.weapon_id);
    if (!weapon) throw new Error(`mark ${mark.mark_id} references missing weapon`);
    if (!weapon.mark_ids?.includes(mark.mark_id)) throw new Error(`mark ${mark.mark_id} missing from weapon mark_ids`);
  }
  for (const weapon of weapons.values()) {
    for (const markId of requireArray(weapon.mark_ids, 'weapon mark_ids')) {
      if (marks.get(markId)?.weapon_id !== weapon.weapon_id) throw new Error(`mark ${markId} has wrong weapon`);
    }
  }
  for (const variant of variants.values()) {
    const blessing = blessings.get(variant.blessing_id);
    if (!blessing || !weapons.has(variant.weapon_id)) throw new Error(`variant ${variant.variant_id} has missing blessing or weapon`);
    if (!blessing.variant_ids?.includes(variant.variant_id)) throw new Error(`variant ${variant.variant_id} missing from blessing variant_ids`);
    const tiers = requireArray(variant.defined_tiers, 'defined_tiers');
    const claimTiers = new Set();
    for (const tierClaim of requireArray(variant.tier_claims, 'tier claims')) {
      if (!Number.isInteger(tierClaim?.tier) || !tiers.includes(tierClaim.tier) || claimTiers.has(tierClaim.tier)) {
        throw new Error(`variant ${variant.variant_id} has invalid or duplicate tier claim`);
      }
      claimTiers.add(tierClaim.tier);
      validateClaims(tierClaim.claims, `tier ${tierClaim.tier}`);
    }
    if (variant.available_tiers !== null && variant.available_tiers !== undefined) {
      for (const tier of requireArray(variant.available_tiers, 'available_tiers')) {
        if (!tiers.includes(tier)) throw new Error(`variant ${variant.variant_id} has undefined available tier`);
      }
    }
  }
  for (const blessing of blessings.values()) {
    for (const variantId of requireArray(blessing.variant_ids, 'blessing variant_ids')) {
      if (variants.get(variantId)?.blessing_id !== blessing.blessing_id) throw new Error(`variant ${variantId} has wrong blessing`);
    }
  }
  const bindingKeys = new Set();
  for (const binding of requireArray(data.bindings, 'bindings')) {
    const bindingKey = [binding.blessing_id, binding.weapon_id, binding.mark_id, binding.variant_id].join('|');
    if (bindingKeys.has(bindingKey)) throw new Error(`duplicate binding: ${bindingKey}`);
    bindingKeys.add(bindingKey);
    const mark = marks.get(binding.mark_id);
    const variant = variants.get(binding.variant_id);
    if (!weapons.has(binding.weapon_id) || !blessings.has(binding.blessing_id)) throw new Error('binding references missing weapon or blessing');
    if (!mark || mark.weapon_id !== binding.weapon_id) throw new Error('binding mark has wrong weapon');
    if (!variant || variant.weapon_id !== binding.weapon_id || variant.blessing_id !== binding.blessing_id) {
      throw new Error('binding variant has wrong weapon or blessing');
    }
  }

  const knownContent = new Set([
    ...[...skills.keys()].map(id => key('skill', id)),
    ...[...weapons.keys()].map(id => key('weapon', id)),
    ...[...marks.keys()].map(id => key('mark', id)),
    ...[...blessings.keys()].map(id => key('blessing', id)),
    ...[...variants.keys()].map(id => key('variant', id))
  ]);
  const routes = new Map();
  for (const route of requireArray(data.routes, 'routes')) {
    if (route.route_kind !== 'canonical' || !knownContent.has(key(route.content_kind, route.content_key))) {
      throw new Error('route has unsupported kind or unknown content');
    }
    if (typeof route.target_route !== 'string' || !/^\/[a-z0-9/_-]+\/$/.test(route.target_route) || route.target_route.includes('//')) {
      throw new Error('route has invalid target_route');
    }
    if (routes.has(route.target_route)) throw new Error(`duplicate canonical route: ${route.target_route}`);
    const expected = {
      skill: `/skills/${route.content_key}/`,
      weapon: `/weapons/${route.content_key}/`,
      mark: `/weapons/${marks.get(route.content_key)?.weapon_id}/marks/${route.content_key}/`,
      blessing: `/blessings/${route.content_key}/`,
      variant: `/blessings/${variants.get(route.content_key)?.blessing_id}/variants/${route.content_key}/`
    }[route.content_kind];
    if (route.target_route !== expected) throw new Error(`route for ${route.content_kind} has unexpected path`);
    routes.set(route.target_route, route);
  }
  for (const content of knownContent) {
    if (![...routes.values()].some(route => key(route.content_kind, route.content_key) === content)) {
      throw new Error(`missing canonical route for ${content}`);
    }
  }
  for (const row of [...skills.values(), ...weapons.values(), ...marks.values(), ...blessings.values(), ...variants.values()]) {
    for (const assetId of requireArray(row.asset_ids, 'asset_ids')) {
      if (!assets.has(assetId)) throw new Error(`unknown asset: ${assetId}`);
    }
  }
  for (const asset of assets.values()) {
    const path = data.package_kind === 'release' ? `/${asset.delivery_path}` : asset.path;
    if (typeof path !== 'string' || !/^\/assets\/[a-zA-Z0-9/_-]+\.(?:svg|png|webp)$/.test(path)) {
      throw new Error(`invalid asset path: ${asset.asset_id}`);
    }
    if (asset.attribution?.follow_required && (!asset.attribution.href || !asset.attribution.text)) {
      throw new Error(`incomplete attribution: ${asset.asset_id}`);
    }
    if (asset.source_url?.startsWith('https://darktide.gameslantern.com/')) {
      if (asset.attribution?.href !== 'https://darktide.gameslantern.com/' || asset.attribution.follow_required !== true || !asset.attribution.text) {
        throw new Error(`Games Lantern attribution required: ${asset.asset_id}`);
      }
    }
  }
  return { skills, weapons, marks, blessings, variants, assets, routes };
}
