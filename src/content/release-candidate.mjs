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

const decimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const supportedSourceKinds = new Set(['git_json', 'git_markdown', 'git_tsv']);
const numericUnits = new Set(['percent', 'seconds', 'meters', 'count', 'multiplier', 'game_unit']);

function compareDecimals(left, right) {
  const places = Math.max((left.split('.')[1] ?? '').length, (right.split('.')[1] ?? '').length);
  const scaled = value => {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const magnitude = BigInt(`${whole}${fraction.padEnd(places, '0')}`);
    return negative ? -magnitude : magnitude;
  };
  const a = scaled(left);
  const b = scaled(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function numericRequirements(kind, record, taxonomy, fieldRequirements) {
  const paths = [];
  const kindsByPath = {};
  const claimRows = kind === 'variant' ? record.tier_claims.flatMap((tierRow, tierIndex) => {
    const tierPath = `/tier_claims/${tierIndex}/tier`;
    paths.push(tierPath);
    return tierRow.claims.map((claim, claimIndex) => ({ claim,
      prefix: `/tier_claims/${tierIndex}/claims/${claimIndex}` }));
  }) : (record.claims ?? []).map((claim, claimIndex) => ({ claim, prefix: `/claims/${claimIndex}` }));
  if (claimRows.length === 0 && paths.length === 0) return { paths, kindsByPath };
  const policy = fieldRequirements.numeric_claims;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('numeric claims are unsupported without versioned policy');
  }
  for (const { claim, prefix } of claimRows) {
    const rule = taxonomy.numeric_claims?.[kind]?.[claim.claim_id];
    if (!rule || rule.scope !== kind || rule.variability !== 'fixed' ||
        !numericUnits.has(rule.unit) || (claim.state === 'known' && rule.unit !== claim.unit) ||
        typeof rule.min !== 'string' || !decimalPattern.test(rule.min) || rule.min.length > 64 ||
        typeof rule.max !== 'string' || !decimalPattern.test(rule.max) || rule.max.length > 64 ||
        compareDecimals(rule.min, rule.max) > 0) {
      throw new Error(`numeric claim lacks a fixed domain rule: ${claim.claim_id}`);
    }
    if (claim.state === 'known' &&
        (compareDecimals(claim.value, rule.min) < 0 || compareDecimals(claim.value, rule.max) > 0)) {
      throw new Error(`numeric claim is outside its domain range: ${claim.claim_id}`);
    }
    if (claim.state === 'known' && !record.evidence.some(evidence =>
      evidence.field_path === `${prefix}/value` && evidence.source_id === claim.source_ref)) {
      throw new Error(`numeric claim source_ref has no value evidence: ${claim.claim_id}`);
    }
    for (const field of ['claim_id', 'state', ...(claim.state === 'known' ?
      ['value', 'unit', ...(claim.unit === 'game_unit' ? ['unit_note'] : [])] : [])]) {
      paths.push(`${prefix}/${field}`);
    }
  }
  for (const path of paths) {
    const field = path.endsWith('/tier') ? 'tier' : path.slice(path.lastIndexOf('/') + 1);
    const required = policy[field];
    if (!Array.isArray(required) || required.length === 0 || new Set(required).size !== required.length ||
        required.some(value => !supportedSourceKinds.has(value))) {
      throw new Error(`numeric source kind requirement is missing or invalid: ${field}`);
    }
    kindsByPath[path] = required;
  }
  return { paths, kindsByPath };
}

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
            requiredKinds.some(value => !supportedSourceKinds.has(value));
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
  const numericByRecord = new WeakMap();
  for (const [kind, rows] of [['skill', data.skills], ['weapon', data.weapons],
    ['mark', data.marks], ['variant', data.variants]]) {
    for (const row of rows) numericByRecord.set(row, numericRequirements(kind, row, taxonomy, fieldRequirements));
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
  async function check(kind, record, usingRoute, fields = null, includeAssets = true) {
    const numeric = fields === null ? numericByRecord.get(record) : null;
    const requiredFields = fields ?? [...fieldRequirements.fields[kind], ...(numeric?.paths ?? [])];
    const result = await validateRecordPublication({
      ...shared, route: usingRoute, record, requiredFieldPaths: requiredFields,
      requiredSourceKindsByField: Object.fromEntries(requiredFields.map(path =>
        [path, fieldRequirements.source_kinds[kind][path] ?? numeric?.kindsByPath[path]])), includeAssets
    });
    result.source_lock_ids.forEach(id => usedSources.add(id));
    result.rights_ids.forEach(id => usedRights.add(id));
  }

  for (const skill of data.skills) {
    const detail = route('skill', `${skill.archetype}/${skill.skill_id}`);
    await check('skill', skill, detail);
    await check('skill', skill, '/skills/', ['/archetype'], false);
    await check('skill', skill, `/skills/${skill.archetype}/`,
      ['/archetype', '/name_zh_tw', '/category'], false);
  }
  for (const weapon of data.weapons) {
    const detail = route('weapon', weapon.weapon_id);
    await check('weapon', weapon, detail);
    await check('weapon', weapon, '/weapons/', ['/name_zh_tw', '/kind'], false);
    for (const binding of data.bindings.filter(row => row.weapon_id === weapon.weapon_id)) {
      await check('weapon', weapon, route('blessing', binding.blessing_id), ['/name_zh_tw'], false);
      await check('weapon', weapon, route('variant', binding.variant_id), ['/name_zh_tw'], false);
    }
  }
  for (const mark of data.marks) {
    await check('mark', mark, route('weapon', mark.weapon_id));
    const detail = route('mark', mark.mark_id);
    await check('mark', mark, detail);
    const weapon = indexes.weapons.get(mark.weapon_id);
    await check('weapon', weapon, detail, ['/name_zh_tw'], false);
    for (const binding of data.bindings.filter(row => row.mark_id === mark.mark_id)) {
      const blessing = indexes.blessings.get(binding.blessing_id);
      await check('blessing', blessing, detail, ['/name_zh_tw'], false);
      await check('binding', binding, detail);
    }
  }
  for (const blessing of data.blessings) {
    const detail = route('blessing', blessing.blessing_id);
    await check('blessing', blessing, detail);
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
