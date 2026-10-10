import { canonicalize } from '../release/manifest.mjs';
import { validatePackage } from './validate.mjs';
import { validateRecordPublication } from './publication.mjs';

// Minimum fields consumed by the current page renderer. Versioned field
// requirements may demand more evidence, but cannot remove these checks.
const minimumFields = {
  skill: ['/archetype', '/skill_id', '/kind', '/category', '/name_zh_tw', '/effect_zh_tw'],
  weapon: ['/weapon_id', '/kind', '/name_zh_tw', '/mark_ids'],
  mark: ['/mark_id', '/weapon_id', '/name_zh_tw'],
  blessing: ['/blessing_id', '/name_zh_tw', '/effect_zh_tw', '/variant_ids'],
  variant: ['/variant_id', '/blessing_id', '/weapon_id', '/defined_tiers'],
  binding: ['/blessing_id', '/weapon_id', '/mark_id', '/variant_id']
};

async function digest(value) {
  const bytes = new TextEncoder().encode(canonicalize(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(part => part.toString(16).padStart(2, '0')).join('');
}

export async function validateReleaseCandidate(data, context) {
  if (data?.package_kind !== 'release') throw new Error('release candidate must have package_kind release');
  const indexes = validatePackage(data, { allowRelease: true });
  const { taxonomy, fieldRequirements, sourceLocks, rightsLedger, sourceBytes, requireGitApproval = false } = context ?? {};
  if (!taxonomy || taxonomy.version !== data.taxonomy_version ||
      await digest(taxonomy) !== data.taxonomy_sha256) throw new Error('taxonomy hash or version mismatch');
  if (!fieldRequirements || fieldRequirements.version !== data.field_requirement_version ||
      await digest(fieldRequirements) !== data.field_requirement_sha256) throw new Error('field requirement hash or version mismatch');
  for (const [kind, minimum] of Object.entries(minimumFields)) {
    const fields = fieldRequirements.fields?.[kind];
    if (!Array.isArray(fields) || new Set(fields).size !== fields.length || minimum.some(path => !fields.includes(path))) {
      throw new Error(`field requirements omit rendered ${kind} fields`);
    }
    const sourceKinds = fieldRequirements.source_kinds?.[kind];
    if (!sourceKinds || typeof sourceKinds !== 'object' || Array.isArray(sourceKinds) ||
        Object.keys(sourceKinds).some(path => !fields.includes(path)) || fields.some(path => {
          const requiredKinds = sourceKinds[path];
          return !Array.isArray(requiredKinds) || requiredKinds.length === 0 ||
            new Set(requiredKinds).size !== requiredKinds.length ||
            requiredKinds.some(value => !['git_json', 'git_markdown', 'git_tsv'].includes(value));
        })) {
      throw new Error(`source kind requirements are missing or invalid for ${kind}`);
    }
  }
  if (!Array.isArray(taxonomy.skill_kinds) || !Array.isArray(taxonomy.skill_categories) ||
      !Array.isArray(taxonomy.weapon_kinds) ||
      data.skills.some(row => !taxonomy.skill_kinds.includes(row.kind) || !taxonomy.skill_categories.includes(row.category)) ||
      data.weapons.some(row => !taxonomy.weapon_kinds.includes(row.kind))) {
    throw new Error('content uses an unknown taxonomy value');
  }
  for (const field of ['skills', 'weapons', 'marks', 'blessings', 'variants', 'bindings']) {
    if (data[field].length === 0) throw new Error(`release requires ${field}`);
  }
  for (const variant of data.variants) {
    if (!data.bindings.some(binding => binding.variant_id === variant.variant_id)) {
      throw new Error(`variant has no binding: ${variant.variant_id}`);
    }
  }
  for (const row of [...data.skills, ...data.weapons, ...data.marks, ...data.blessings, ...data.variants, ...data.bindings]) {
    if (row.schema_version !== 1 || !Array.isArray(row.evidence) || row.evidence.length === 0 || !Array.isArray(row.asset_ids)) {
      throw new Error('release record has missing schema, evidence, or assets');
    }
  }
  if (data.skills.some(row => row.claims?.length) || data.weapons.some(row => row.claims?.length) ||
      data.marks.some(row => row.claims?.length) || data.variants.some(row => row.tier_claims?.length)) {
    throw new Error('numeric claims are unsupported by this release renderer');
  }
  if (data.marks.some(row => row.asset_ids.length) || data.bindings.some(row => row.asset_ids.length)) {
    throw new Error('mark or binding assets are not rendered');
  }

  const route = (kind, contentKey) => {
    const match = data.routes.find(row => row.content_kind === kind && row.content_key === contentKey);
    if (!match) throw new Error(`missing ${kind} route: ${contentKey}`);
    return match.target_route;
  };
  const shared = { sourceLocks, rightsLedger, sourceBytes, assets: data.assets, requireGitApproval };
  const usedSources = new Set();
  const usedRights = new Set();
  async function check(kind, record, usingRoute, fields = fieldRequirements.fields[kind], includeAssets = true) {
    const result = await validateRecordPublication({
      ...shared, route: usingRoute, record, requiredFieldPaths: fields,
      requiredSourceKindsByField: Object.fromEntries(fields.map(path =>
        [path, fieldRequirements.source_kinds[kind][path]])), includeAssets
    });
    result.source_lock_ids.forEach(id => usedSources.add(id));
    result.rights_ids.forEach(id => usedRights.add(id));
  }

  for (const skill of data.skills) {
    const detail = route('skill', `${skill.archetype}/${skill.skill_id}`);
    await check('skill', skill, detail);
    for (const usingRoute of ['/', '/skills/']) {
      await check('skill', skill, usingRoute, ['/name_zh_tw', '/category'], false);
    }
  }
  for (const weapon of data.weapons) {
    const detail = route('weapon', weapon.weapon_id);
    await check('weapon', weapon, detail);
    await check('weapon', weapon, '/', ['/name_zh_tw'], false);
    await check('weapon', weapon, '/weapons/', ['/name_zh_tw', '/kind'], false);
    for (const binding of data.bindings.filter(row => row.weapon_id === weapon.weapon_id)) {
      await check('weapon', weapon, route('blessing', binding.blessing_id), ['/name_zh_tw'], false);
      await check('weapon', weapon, route('variant', binding.variant_id), ['/name_zh_tw'], false);
    }
  }
  for (const mark of data.marks) {
    await check('mark', mark, route('weapon', mark.weapon_id));
  }
  for (const blessing of data.blessings) {
    const detail = route('blessing', blessing.blessing_id);
    await check('blessing', blessing, detail);
    await check('blessing', blessing, '/', ['/name_zh_tw'], false);
    await check('blessing', blessing, '/blessings/', ['/name_zh_tw'], false);
    for (const binding of data.bindings.filter(row => row.blessing_id === blessing.blessing_id)) {
      await check('blessing', blessing, route('weapon', binding.weapon_id), ['/name_zh_tw'], false);
      await check('blessing', blessing, route('variant', binding.variant_id), ['/name_zh_tw'], false);
    }
  }
  for (const variant of data.variants) {
    await check('variant', variant, route('variant', variant.variant_id));
    await check('variant', variant, route('blessing', variant.blessing_id),
      ['/variant_id', '/blessing_id', '/weapon_id'], false);
  }
  for (const binding of data.bindings) {
    for (const usingRoute of [route('weapon', binding.weapon_id), route('blessing', binding.blessing_id)]) {
      await check('binding', binding, usingRoute);
    }
  }
  const usedAssetIds = new Set([...data.skills, ...data.weapons, ...data.blessings, ...data.variants]
    .flatMap(row => row.asset_ids));
  if (data.assets.some(asset => !usedAssetIds.has(asset.asset_id))) throw new Error('release contains an unused asset');
  const assetPaths = data.assets.map(asset => asset.delivery_path);
  if (new Set(assetPaths).size !== assetPaths.length) throw new Error('duplicate asset delivery path');
  return { indexes, source_lock_ids: [...usedSources].sort(), rights_ids: [...usedRights].sort() };
}
