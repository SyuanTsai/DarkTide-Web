import { createHash } from 'node:crypto';

const ROOT_FIELDS = ['schema_version', 'package_kind', 'game_version', 'skills', 'weapons', 'marks', 'blessings', 'variants', 'bindings', 'assets', 'routes', 'sources', 'talent_trees'];
const ROW_FIELDS = {
  skill: ['archetype', 'skill_id', 'kind', 'category', 'name_zh_tw', 'effect_zh_tw', 'mechanics_zh_tw', 'claims', 'asset_ids', 'source_ids'],
  weapon: ['weapon_id', 'kind', 'category', 'name_zh_tw', 'model_zh_tw', 'mark_ids', 'claims', 'asset_ids', 'source_ids'],
  mark: ['mark_id', 'weapon_id', 'category', 'name_zh_tw', 'claims', 'asset_ids', 'source_ids'],
  blessing: ['blessing_id', 'category', 'name_zh_tw', 'effect_zh_tw', 'trigger_zh_tw', 'variant_ids', 'asset_ids', 'source_ids'],
  variant: ['variant_id', 'blessing_id', 'weapon_id', 'category', 'effect_zh_tw', 'defined_tiers', 'available_tiers', 'tier_claims', 'asset_ids', 'source_ids']
};
const CLAIM_FIELDS = ['claim_id', 'state', 'value', 'unit', 'unit_note', 'source_ref'];
const TIER_FIELDS = ['tier', 'claims'];
const BINDING_FIELDS = ['blessing_id', 'weapon_id', 'mark_id', 'variant_id', 'trait_item', 'trait_category', 'available_tiers'];
const ASSET_FIELDS = ['asset_id', 'path', 'sha256', 'media_type', 'source_url', 'attribution'];
const SOURCE_FIELDS = ['source_id', 'label', 'url'];
const TALENT_TREE_FIELDS = ['archetype', 'version', 'nodes', 'source_ids'];
const TALENT_TREE_NODE_FIELDS = ['node_id', 'type', 'x', 'y', 'skill_id', 'children'];
const TALENT_TREE_CATALOG_FIELDS = ['archetype', 'version', 'tree_path', 'node_count'];
const TALENT_TREE_FILE_FIELDS = ['schema_version', 'archetype', 'version', 'nodes', 'source_ids', 'sources', 'details'];
const TALENT_TREE_NODE_TYPES = new Set([
  'default', 'ability', 'ability_modifier', 'aura', 'keystone', 'keystone_modifier',
  'start', 'stat', 'tactical', 'tactical_modifier'
]);
const ROUTE_FIELDS = ['route_kind', 'content_kind', 'content_key', 'source_route', 'target_route', 'decision'];
const ATTRIBUTION_FIELDS = ['href', 'text', 'follow_required'];
const ID_PATTERN = /^[a-z0-9_-]+$/;
const SOURCE_ID_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const CLAIM_UNITS = new Set(['percent', 'seconds', 'meters', 'count', 'multiplier', 'game_unit']);
const MEDIA_EXTENSIONS = {
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/svg+xml': ['.svg']
};
const ROUTE_KINDS = new Set(['skill', 'mechanics', 'weapon', 'mark', 'blessing', 'variant']);

function fail(message) { throw new Error(message); }
function isGamesLanternUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'gameslantern.com' || host.endsWith('.gameslantern.com'));
  } catch { return false; }
}
function isReservedIndexRoute(route) {
  const segments = route.split('/').filter(Boolean);
  return route === '/skills/' || route === '/weapons/' || route === '/blessings/' ||
    (segments.length === 2 && segments[0] === 'skills');
}
function validateTierArray(value, label, requireNonempty = false) {
  const seen = new Set();
  let previous = 0;
  for (const tier of array(value, label)) {
    if (!Number.isInteger(tier) || tier < 1 || tier > 4 || tier <= previous) {
      fail(label + ' must contain sorted unique tiers from 1 through 4');
    }
    previous = tier;
    seen.add(tier);
  }
  if (requireNonempty && seen.size === 0) fail(label + ' must be nonempty');
  return seen;
}
function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}
function object(value, label) {
  if (!plain(value)) fail(label + ' must be an object');
  return value;
}
function array(value, label) {
  if (!Array.isArray(value)) fail(label + ' must be an array');
  return value;
}
function exact(value, fields, label) {
  object(value, label);
  const allowed = new Set(fields);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) fail(label + ' has unknown or unsupported field: ' + String(key));
  }
}
function string(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) fail(label + ' must be a nonempty string');
}
function textOrNull(value, label) {
  if (value !== null && typeof value !== 'string') fail(label + ' must be text or null');
  if (typeof value === 'string' && !value.trim()) fail(label + ' must be nonempty text or null');
}
function nameOrNull(value, label) {
  if (value === null) return;
  name(value, label);
}
function name(value, label) {
  string(value, label);
  if (!/\p{Script=Han}/u.test(value)) fail(label + ' must contain Traditional Chinese text');
}
function category(value, label) {
  if (value !== null && (typeof value !== 'string' || !value.trim())) fail(label + ' must be a nonempty category string or null');
}
function safeId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(label + ' is invalid');
}
function safePath(value, label) {
  if (typeof value !== 'string' || !/^\/[a-z0-9/_-]+\/$/.test(value) || value.includes('//') || value.includes('/../') || value.includes('/./')) {
    fail(label + ' is invalid');
  }
}
function copy(value) { return value === undefined ? undefined : structuredClone(value); }
function projectObject(raw, fields, defaults = {}) {
  object(raw, 'content record');
  const out = {};
  for (const field of fields) {
    if (Object.hasOwn(raw, field)) out[field] = copy(raw[field]);
    else if (Object.hasOwn(defaults, field)) out[field] = copy(defaults[field]);
    else out[field] = null;
  }
  return out;
}
function projectClaim(raw) {
  return projectObject(raw, CLAIM_FIELDS, { value: null, unit: null, unit_note: null, source_ref: null });
}
function projectRows(value, kind) {
  return array(value, kind + 's').map(raw => {
    const fields = ROW_FIELDS[kind];
    const defaults = { category: null, claims: [], asset_ids: [], source_ids: [] };
    if (kind === 'skill') Object.assign(defaults, { kind: null, effect_zh_tw: null, mechanics_zh_tw: null });
    if (kind === 'weapon') Object.assign(defaults, { kind: null, model_zh_tw: null, mark_ids: [] });
    if (kind === 'blessing') Object.assign(defaults, { effect_zh_tw: null, trigger_zh_tw: null, variant_ids: [] });
    if (kind === 'variant') Object.assign(defaults, { effect_zh_tw: null, defined_tiers: [], available_tiers: null, tier_claims: [] });
    const row = projectObject(raw, fields, defaults);
    if (fields.includes('claims')) row.claims = array(row.claims, kind + ' claims').map(projectClaim);
    if (Array.isArray(row.asset_ids)) row.asset_ids = [...row.asset_ids];
    if (Array.isArray(row.source_ids)) row.source_ids = [...row.source_ids];
    if (kind === 'weapon' && Array.isArray(row.mark_ids)) row.mark_ids = [...row.mark_ids];
    if (kind === 'blessing' && Array.isArray(row.variant_ids)) row.variant_ids = [...row.variant_ids];
    if (kind === 'variant') {
      row.defined_tiers = Array.isArray(row.defined_tiers) ? [...row.defined_tiers] : row.defined_tiers;
      row.available_tiers = Array.isArray(row.available_tiers) ? [...row.available_tiers] : row.available_tiers;
      row.tier_claims = array(row.tier_claims, 'variant tier_claims').map(rawTier => {
        const tier = projectObject(rawTier, TIER_FIELDS, { claims: [] });
        tier.claims = array(tier.claims, 'tier claims').map(projectClaim);
        return tier;
      });
    }
    if (kind === 'weapon' && row.category === null && typeof row.kind === 'string') row.category = row.kind;
    return row;
  });
}
function projectBindings(value) {
  return array(value, 'bindings').map(raw => {
    const binding = projectObject(raw, BINDING_FIELDS, { trait_item: null, trait_category: null, available_tiers: null });
    if (Array.isArray(binding.available_tiers)) binding.available_tiers = [...binding.available_tiers];
    return binding;
  });
}
function projectAssets(value) {
  return array(value, 'assets').map(raw => {
    const asset = projectObject(raw, ASSET_FIELDS, { source_url: null, attribution: null });
    if (plain(asset.attribution)) asset.attribution = projectObject(asset.attribution, ATTRIBUTION_FIELDS, { href: null, text: null, follow_required: false });
    return asset;
  });
}
function projectRoutes(value) {
  return array(value, 'routes').map(raw => projectObject(raw, ROUTE_FIELDS, { source_route: null }));
}
function projectSources(value) {
  return array(value, 'sources').map(raw => projectObject(raw, SOURCE_FIELDS));
}
function projectTalentTrees(value) {
  return array(value, 'talent_trees').map(raw => {
    const tree = projectObject(raw, TALENT_TREE_FIELDS);
    if (Array.isArray(tree.nodes)) {
      tree.nodes = tree.nodes.map(rawNode => {
        const node = projectObject(rawNode, TALENT_TREE_NODE_FIELDS);
        if (Array.isArray(node.children)) node.children = [...node.children];
        return node;
      });
    }
    if (Array.isArray(tree.source_ids)) tree.source_ids = [...tree.source_ids];
    return tree;
  });
}
function skillId(skill) { return skill.archetype + '/' + skill.skill_id; }
function recordId(kind, row) {
  if (kind === 'skill' || kind === 'mechanics') return skillId(row);
  if (kind === 'weapon') return row.weapon_id;
  if (kind === 'mark') return row.mark_id;
  if (kind === 'blessing') return row.blessing_id;
  if (kind === 'variant') return row.variant_id;
  fail('unsupported content kind: ' + kind);
}
function expectedRoute(kind, row) {
  if (kind === 'skill') return '/skills/' + row.archetype + '/' + row.skill_id + '/';
  if (kind === 'mechanics') return '/skills/' + row.archetype + '/' + row.skill_id + '/mechanics/';
  if (kind === 'weapon') return '/weapons/' + row.weapon_id + '/';
  if (kind === 'mark') return '/weapons/' + row.weapon_id + '/marks/' + row.mark_id + '/';
  if (kind === 'blessing') return '/blessings/' + row.blessing_id + '/';
  if (kind === 'variant') return '/blessings/' + row.blessing_id + '/variants/' + row.variant_id + '/';
  fail('unsupported content kind: ' + kind);
}

export function projectPublicContent(raw) {
  object(raw, 'content candidate');
  if (raw.schema_version !== 1 && raw.schema_version !== 2) fail('unsupported source content schema_version');
  if (raw.package_kind !== 'fixture' && raw.package_kind !== 'published') fail('content candidate package_kind must be fixture or published');
  const gameVersion = raw.game_version === undefined && raw.package_kind === 'fixture' ? 'fixture' : raw.game_version;
  const out = {
    schema_version: 2,
    package_kind: raw.package_kind,
    game_version: copy(gameVersion),
    skills: projectRows(raw.skills ?? [], 'skill'),
    weapons: projectRows(raw.weapons ?? [], 'weapon'),
    marks: projectRows(raw.marks ?? [], 'mark'),
    blessings: projectRows(raw.blessings ?? [], 'blessing'),
    variants: projectRows(raw.variants ?? [], 'variant'),
    bindings: projectBindings(raw.bindings ?? []),
    assets: projectAssets(raw.assets ?? []),
    routes: projectRoutes(raw.routes ?? []),
    sources: projectSources(raw.sources ?? []),
    talent_trees: Object.hasOwn(raw, 'talent_trees') ? projectTalentTrees(raw.talent_trees) : []
  };
  const mechanicsRoutes = new Set(out.routes
    .filter(route => route.route_kind === 'canonical' && route.content_kind === 'mechanics')
    .map(route => route.content_key));
  for (const skill of out.skills) {
    const id = skillId(skill);
    if (!mechanicsRoutes.has(id)) {
      out.routes.push({
        route_kind: 'canonical',
        content_kind: 'mechanics',
        content_key: id,
        source_route: null,
        target_route: expectedRoute('mechanics', skill),
        decision: 'keep'
      });
    }
  }
  return out;
}

function uniqueIndex(rows, idOf, label) {
  const index = new Map();
  for (const row of array(rows, label)) {
    object(row, label + ' record');
    const id = idOf(row);
    if (typeof id !== 'string' || !id) fail(label + ' has an invalid ID');
    if (index.has(id)) fail('duplicate ' + label + ' ID: ' + id);
    index.set(id, row);
  }
  return index;
}
function indexesFor(data) {
  return {
    skills: uniqueIndex(data.skills, skillId, 'skill'),
    weapons: uniqueIndex(data.weapons, row => row.weapon_id, 'weapon'),
    marks: uniqueIndex(data.marks, row => row.mark_id, 'mark'),
    blessings: uniqueIndex(data.blessings, row => row.blessing_id, 'blessing'),
    variants: uniqueIndex(data.variants, row => row.variant_id, 'variant'),
    assets: uniqueIndex(data.assets, row => row.asset_id, 'asset'),
    sources: uniqueIndex(data.sources, row => row.source_id, 'source')
  };
}
function validateClaims(claims, label, sources) {
  const seen = new Set();
  for (const claim of array(claims, label + ' claims')) {
    exact(claim, CLAIM_FIELDS, label + ' claim');
    if (typeof claim.claim_id !== 'string' || !SOURCE_ID_PATTERN.test(claim.claim_id)) fail(label + ' has invalid claim ID');
    if (seen.has(claim.claim_id)) fail('duplicate ' + label + ' claim: ' + claim.claim_id);
    seen.add(claim.claim_id);
    if (claim.state === 'unknown') {
      if (claim.value !== null || claim.unit !== null || claim.unit_note !== null || claim.source_ref !== null) fail(label + ' unknown claim has a value or source');
    } else if (claim.state === 'known') {
      if (typeof claim.value !== 'string' || claim.value.length > 64 || !DECIMAL_PATTERN.test(claim.value) ||
          !CLAIM_UNITS.has(claim.unit) || typeof claim.source_ref !== 'string' ||
          !SOURCE_ID_PATTERN.test(claim.source_ref) || !sources.has(claim.source_ref)) fail(label + ' known claim is invalid or has an unknown public source');
      if (claim.unit === 'game_unit') string(claim.unit_note, label + ' unit_note');
      else if (claim.unit_note !== null) fail(label + ' unit_note must be null for this unit');
    } else fail(label + ' claim has an invalid state');
  }
}
function validateRecordSources(row, packageKind, sources, label) {
  const seen = new Set();
  for (const sourceId of array(row.source_ids, label + ' source_ids')) {
    if (typeof sourceId !== 'string' || !SOURCE_ID_PATTERN.test(sourceId) || !sources.has(sourceId)) fail(label + ' references an unknown public source');
    if (seen.has(sourceId)) fail(label + ' has duplicate source reference');
    seen.add(sourceId);
  }
  if (packageKind === 'published' && seen.size === 0) fail('published ' + label + ' requires at least one public source');
}
function validateRows(data, indexes, packageKind) {
  for (const row of data.skills) {
    exact(row, ROW_FIELDS.skill, 'skill');
    safeId(row.archetype, 'skill archetype'); safeId(row.skill_id, 'skill ID');
    string(row.kind, 'skill kind'); category(row.category, 'skill category'); nameOrNull(row.name_zh_tw, 'skill name_zh_tw');
    textOrNull(row.effect_zh_tw, 'skill effect_zh_tw'); textOrNull(row.mechanics_zh_tw, 'skill mechanics_zh_tw');
    validateClaims(row.claims, 'skill', indexes.sources); validateRecordSources(row, packageKind, indexes.sources, 'skill');
  }
  for (const row of data.weapons) {
    exact(row, ROW_FIELDS.weapon, 'weapon');
    safeId(row.weapon_id, 'weapon ID'); textOrNull(row.kind, 'weapon kind'); category(row.category, 'weapon category');
    nameOrNull(row.name_zh_tw, 'weapon name_zh_tw'); textOrNull(row.model_zh_tw, 'weapon model_zh_tw');
    validateClaims(row.claims, 'weapon', indexes.sources); validateRecordSources(row, packageKind, indexes.sources, 'weapon');
  }
  for (const row of data.marks) {
    exact(row, ROW_FIELDS.mark, 'mark');
    safeId(row.mark_id, 'mark ID'); safeId(row.weapon_id, 'mark weapon_id'); category(row.category, 'mark category');
    nameOrNull(row.name_zh_tw, 'mark name_zh_tw'); validateClaims(row.claims, 'mark', indexes.sources); validateRecordSources(row, packageKind, indexes.sources, 'mark');
  }
  for (const row of data.blessings) {
    exact(row, ROW_FIELDS.blessing, 'blessing');
    safeId(row.blessing_id, 'blessing ID'); category(row.category, 'blessing category');
    name(row.name_zh_tw, 'blessing name_zh_tw'); textOrNull(row.effect_zh_tw, 'blessing effect_zh_tw');
    textOrNull(row.trigger_zh_tw, 'blessing trigger_zh_tw'); validateRecordSources(row, packageKind, indexes.sources, 'blessing');
  }
  for (const row of data.variants) {
    exact(row, ROW_FIELDS.variant, 'variant');
    safeId(row.variant_id, 'variant ID'); safeId(row.blessing_id, 'variant blessing_id');
    safeId(row.weapon_id, 'variant weapon_id'); category(row.category, 'variant category'); textOrNull(row.effect_zh_tw, 'variant effect_zh_tw');
    const tiers = validateTierArray(row.defined_tiers, 'variant defined_tiers', true);
    if (row.available_tiers !== null) {
      for (const tier of validateTierArray(row.available_tiers, 'variant available_tiers')) {
        if (!tiers.has(tier)) fail('variant available_tiers contains an undefined tier');
      }
    }
    const claimedTiers = new Set();
    let previousClaimTier = 0;
    for (const tierClaim of array(row.tier_claims, 'tier_claims')) {
      exact(tierClaim, TIER_FIELDS, 'tier claim');
      if (!Number.isInteger(tierClaim.tier) || !tiers.has(tierClaim.tier) || tierClaim.tier <= previousClaimTier) fail('variant tier claims must be sorted, unique, and defined');
      previousClaimTier = tierClaim.tier;
      claimedTiers.add(tierClaim.tier);
      validateClaims(tierClaim.claims, 'tier ' + tierClaim.tier, indexes.sources);
    }
    validateRecordSources(row, packageKind, indexes.sources, 'variant');
  }
  for (const row of data.bindings) {
    exact(row, BINDING_FIELDS, 'binding');
    for (const field of ['weapon_id', 'mark_id', 'blessing_id', 'variant_id']) safeId(row[field], 'binding ' + field);
    textOrNull(row.trait_item, 'binding trait_item'); textOrNull(row.trait_category, 'binding trait_category');
    if (row.available_tiers !== null) validateTierArray(row.available_tiers, 'binding available_tiers');
  }
}
function validateTalentTrees(trees, skills, sources, packageKind) {
  const archetypes = new Set();
  for (const tree of array(trees, 'talent_trees')) {
    exact(tree, TALENT_TREE_FIELDS, 'talent tree');
    safeId(tree.archetype, 'talent tree archetype');
    if (archetypes.has(tree.archetype)) fail('duplicate talent tree archetype: ' + tree.archetype);
    archetypes.add(tree.archetype);
    if (!Number.isSafeInteger(tree.version) || tree.version < 1) fail('talent tree version must be a positive integer');
    const nodes = array(tree.nodes, 'talent tree nodes');
    if (nodes.length === 0) fail('talent tree nodes must be nonempty');
    const nodeIds = new Set();
    for (const node of nodes) {
      exact(node, TALENT_TREE_NODE_FIELDS, 'talent tree node');
      safeId(node.node_id, 'talent tree node ID');
      if (nodeIds.has(node.node_id)) fail('duplicate talent tree node ID: ' + node.node_id);
      nodeIds.add(node.node_id);
      if (typeof node.type !== 'string' || !TALENT_TREE_NODE_TYPES.has(node.type)) fail('talent tree node type is unsupported');
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) fail('talent tree node coordinate is invalid');
      if (node.skill_id !== null) {
        safeId(node.skill_id, 'talent tree node skill_id');
        if (!skills.has(tree.archetype + '/' + node.skill_id)) fail('talent tree node references a missing same-archetype skill');
      }
      const childIds = new Set();
      for (const childId of array(node.children, 'talent tree node children')) {
        safeId(childId, 'talent tree child node ID');
        if (childIds.has(childId)) fail('talent tree node has a duplicate child reference');
        childIds.add(childId);
      }
    }
    for (const node of nodes) {
      for (const childId of node.children) if (!nodeIds.has(childId)) fail('talent tree child references unknown node: ' + childId);
    }
    validateRecordSources(tree, packageKind, sources, 'talent tree');
  }
}
function validateSources(data) {
  const ids = new Set();
  for (const source of data.sources) {
    exact(source, SOURCE_FIELDS, 'source');
    string(source.source_id, 'source source_id');
    if (!SOURCE_ID_PATTERN.test(source.source_id) || ids.has(source.source_id)) fail('source has invalid or duplicate source_id');
    ids.add(source.source_id);
    string(source.label, 'source label');
    let url;
    try { url = new URL(source.url); } catch { fail('source URL is invalid'); }
    if (url.protocol !== 'https:' || !url.hostname) fail('source URL must use HTTPS');
  }
  return ids;
}
function bytesMatch(bytes, mediaType, packageKind) {
  if (!(bytes instanceof Uint8Array)) return false;
  const at = index => bytes[index];
  if (mediaType === 'image/png') return bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((v, i) => at(i) === v);
  if (mediaType === 'image/webp') return bytes.length >= 12 && Buffer.from(bytes.slice(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.slice(8, 12)).toString('ascii') === 'WEBP';
  if (mediaType === 'image/jpeg') return bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff;
  if (mediaType === 'image/gif') {
    const sig = Buffer.from(bytes.slice(0, 6)).toString('ascii');
    return bytes.length >= 6 && (sig === 'GIF87a' || sig === 'GIF89a');
  }
  if (mediaType === 'image/svg+xml' && packageKind === 'fixture') {
    const text = Buffer.from(bytes).toString('utf8').trim();
    return /^<svg(?:\s|>)/i.test(text) &&
      !/<\s*(?:script|foreignObject)\b/i.test(text) &&
      !/\bon[a-z]+\s*=/i.test(text) &&
      !/(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:|data:)/i.test(text);
  }
  return false;
}
function validateAssets(data, indexes, assetBytes) {
  if (!(assetBytes instanceof Map)) fail('assetBytes must be a Map keyed by asset.path');
  const paths = new Set();
  const localPaths = new Set();
  for (const asset of data.assets) {
    exact(asset, ASSET_FIELDS, 'asset');
    safeId(asset.asset_id, 'asset ID');
    const remote = asset.path === null || asset.sha256 === null || asset.media_type === null;
    if (remote) {
      if (asset.path !== null || asset.sha256 !== null || asset.media_type !== null) fail('remote asset metadata must set path, sha256, and media_type all to null');
      if (!isGithubAttachmentUrl(asset.source_url)) fail('remote asset source_url must be an exact HTTPS GitHub user-attachments UUID URL');
      if (asset.asset_id !== githubAttachmentAssetId(asset.source_url)) fail('remote asset ID must be the SHA-256 of its exact source_url');
      if (asset.attribution !== null) {
        exact(asset.attribution, ATTRIBUTION_FIELDS, 'asset attribution');
        if (asset.attribution.href !== null && !isHttpsUrl(asset.attribution.href)) fail('asset attribution href must use HTTPS');
        textOrNull(asset.attribution.text, 'asset attribution text');
        if (typeof asset.attribution.follow_required !== 'boolean') fail('asset attribution follow_required must be boolean');
      }
      if (!asset.attribution || !isDirectGamesLanternUrl(asset.attribution.href) ||
          asset.attribution.follow_required !== true || typeof asset.attribution.text !== 'string' || !asset.attribution.text.trim()) {
        fail('remote Games Lantern assets require visible direct attribution and follow on every use page');
      }
      continue;
    }
    if (isGithubAttachmentLocation(asset.source_url)) fail('GitHub user-attachment assets must use remote null metadata');
    if (typeof asset.path !== 'string' || !/^icons\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:svg|png|webp|jpe?g|gif)$/.test(asset.path) ||
        asset.path.split('/').some(segment => segment === '.' || segment === '..')) fail('asset path is unsafe or invalid: ' + asset.asset_id);
    if (paths.has(asset.path)) fail('duplicate asset path: ' + asset.path);
    paths.add(asset.path);
    localPaths.add(asset.path);
    if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) fail('asset SHA-256 is invalid: ' + asset.asset_id);
    if (!Object.hasOwn(MEDIA_EXTENSIONS, asset.media_type) || !MEDIA_EXTENSIONS[asset.media_type].some(ext => asset.path.endsWith(ext))) fail('asset media_type does not match its path');
    if (asset.source_url !== null && !isHttpsUrl(asset.source_url)) fail('asset source_url must use HTTPS or null');
    if (asset.attribution !== null) {
      exact(asset.attribution, ATTRIBUTION_FIELDS, 'asset attribution');
      if (asset.attribution.href !== null && !isHttpsUrl(asset.attribution.href)) fail('asset attribution href must use HTTPS or null');
      textOrNull(asset.attribution.text, 'asset attribution text');
      if (typeof asset.attribution.follow_required !== 'boolean') fail('asset attribution follow_required must be boolean');
    }
    const fromGamesLantern = isGamesLanternUrl(asset.source_url);
    const creditsGamesLantern = isGamesLanternUrl(asset.attribution?.href);
    if (fromGamesLantern || creditsGamesLantern) {
      if (!asset.attribution || !isGamesLanternUrl(asset.attribution.href) ||
          asset.attribution.follow_required !== true || typeof asset.attribution.text !== 'string' || !asset.attribution.text.trim()) {
        fail('Games Lantern assets require visible direct attribution on every use page');
      }
    }
    const bytes = assetBytes.get(asset.path);
    if (!bytesMatch(bytes, asset.media_type, data.package_kind)) fail('asset bytes do not match supported media_type for ' + asset.path);
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) fail('asset SHA-256 mismatch for ' + asset.path);
  }
  for (const path of assetBytes.keys()) if (!localPaths.has(path)) fail('assetBytes contains an unlisted local file: ' + path);
  return indexes.assets;
}
function validateRelations(data, indexes) {
  for (const mark of data.marks) {
    const weapon = indexes.weapons.get(mark.weapon_id);
    if (!weapon) fail('mark ' + mark.mark_id + ' references a missing weapon');
    if (!array(weapon.mark_ids, 'weapon mark_ids').includes(mark.mark_id)) fail('mark ' + mark.mark_id + ' is missing from weapon mark_ids');
  }
  for (const weapon of data.weapons) {
    const seen = new Set();
    for (const id of array(weapon.mark_ids, 'weapon mark_ids')) {
      if (seen.has(id)) fail('weapon has duplicate mark reference: ' + id);
      seen.add(id);
      if (indexes.marks.get(id)?.weapon_id !== weapon.weapon_id) fail('mark ' + id + ' has the wrong weapon owner');
    }
  }
  for (const variant of data.variants) {
    const blessing = indexes.blessings.get(variant.blessing_id);
    if (!blessing || !indexes.weapons.has(variant.weapon_id)) fail('variant ' + variant.variant_id + ' references a missing blessing or weapon');
    if (!array(blessing.variant_ids, 'blessing variant_ids').includes(variant.variant_id)) fail('variant ' + variant.variant_id + ' is missing from blessing variant_ids');
  }
  for (const blessing of data.blessings) {
    const seen = new Set();
    for (const id of array(blessing.variant_ids, 'blessing variant_ids')) {
      if (seen.has(id)) fail('blessing has duplicate variant reference: ' + id);
      seen.add(id);
      if (indexes.variants.get(id)?.blessing_id !== blessing.blessing_id) fail('variant ' + id + ' has the wrong blessing owner');
    }
  }
  const bindings = new Set();
  for (const binding of data.bindings) {
    const key = [binding.blessing_id, binding.weapon_id, binding.mark_id, binding.variant_id].join('|');
    if (bindings.has(key)) fail('duplicate binding: ' + key);
    bindings.add(key);
    const mark = indexes.marks.get(binding.mark_id);
    const variant = indexes.variants.get(binding.variant_id);
    if (!indexes.weapons.has(binding.weapon_id) || !indexes.blessings.has(binding.blessing_id)) fail('binding references missing weapon or blessing');
    if (!mark || mark.weapon_id !== binding.weapon_id) fail('binding mark has wrong weapon');
    if (!variant || variant.weapon_id !== binding.weapon_id || variant.blessing_id !== binding.blessing_id) fail('binding variant has wrong weapon or blessing');
    if (binding.available_tiers !== null) for (const tier of binding.available_tiers) {
      if (!variant.defined_tiers.includes(tier) || (variant.available_tiers !== null && !variant.available_tiers.includes(tier))) fail('binding has unavailable variant tier');
    }
  }
}
function getRecord(kind, id, indexes) {
  if (kind === 'skill' || kind === 'mechanics') return indexes.skills.get(id);
  if (kind === 'weapon') return indexes.weapons.get(id);
  if (kind === 'mark') return indexes.marks.get(id);
  if (kind === 'blessing') return indexes.blessings.get(id);
  if (kind === 'variant') return indexes.variants.get(id);
}
function validateRoutes(data, indexes) {
  const canonical = new Map();
  const byContent = new Map();
  const redirectSources = new Set();
  for (const route of data.routes) {
    exact(route, ROUTE_FIELDS, 'route');
    if (!ROUTE_KINDS.has(route.content_kind)) fail('route has unsupported content kind');
    const record = getRecord(route.content_kind, route.content_key, indexes);
    if (!record || recordId(route.content_kind, record) !== route.content_key) fail('route references unknown content');
    safePath(route.target_route, 'route target_route');
    if (route.source_route !== null) safePath(route.source_route, 'route source_route');
    const key = route.content_kind + ':' + route.content_key;
    if (route.route_kind === 'canonical') {
      if (route.source_route !== null) fail('canonical route source_route must be null');
      if (route.decision !== 'keep') fail('canonical route decision must be keep');
      if (route.target_route !== expectedRoute(route.content_kind, record)) fail('route has unexpected canonical path');
      if (canonical.has(route.target_route) || byContent.has(key)) fail('duplicate canonical route: ' + route.target_route);
      canonical.set(route.target_route, route);
      byContent.set(key, route.target_route);
    } else if (route.route_kind === 'redirect') {
      if (route.decision !== 'redirect' || route.source_route === null) fail('redirect requires source_route and redirect decision');
      if (isReservedIndexRoute(route.source_route)) fail('redirect cannot overwrite a category index route');
      if (redirectSources.has(route.source_route)) fail('duplicate redirect source route');
      redirectSources.add(route.source_route);
    } else fail('route has unsupported route_kind');
  }
  for (const [kind, rows] of [['skill', data.skills], ['mechanics', data.skills], ['weapon', data.weapons], ['mark', data.marks], ['blessing', data.blessings], ['variant', data.variants]]) {
    for (const row of rows) {
      const key = kind + ':' + recordId(kind, row);
      if (!byContent.has(key)) fail('missing canonical route for ' + key);
    }
  }
  for (const route of data.routes) {
    if (route.route_kind === 'redirect') {
      const target = byContent.get(route.content_kind + ':' + route.content_key);
      if (!target || route.target_route !== target) fail('redirect target does not match canonical route');
      if (canonical.has(route.source_route)) fail('redirect source collides with canonical route');
    }
  }
  return { canonical, byContent };
}
function validateAssetReferences(data, assets) {
  const referenced = new Set();
  for (const row of [...data.skills, ...data.weapons, ...data.marks, ...data.blessings, ...data.variants]) {
    const seen = new Set();
    for (const id of array(row.asset_ids, 'asset_ids')) {
      if (seen.has(id)) fail('duplicate asset reference: ' + id);
      seen.add(id);
      referenced.add(id);
      if (!assets.has(id)) fail('unknown asset reference: ' + id);
    }
  }
  if (referenced.size !== assets.size) fail('published content contains an unreferenced asset');
}

export function validatePublishedContent(data, { assetBytes = new Map() } = {}) {
  exact(data, ROOT_FIELDS, 'published content');
  if (data.schema_version !== 2) fail('unsupported published content schema_version');
  if (data.package_kind !== 'published' && data.package_kind !== 'fixture') fail('unsupported package_kind');
  string(data.game_version, 'game_version');
  for (const key of ['skills', 'weapons', 'marks', 'blessings', 'variants', 'bindings', 'assets', 'routes', 'sources']) array(data[key], key);
  if (data.package_kind === 'published' &&
      [...['skills', 'weapons', 'marks', 'blessings', 'variants'].map(key => data[key].length), data.sources.length].some(count => count === 0)) {
    fail('published content requires nonempty skills, weapons, marks, blessings, variants, and sources');
  }
  const indexes = indexesFor(data);
  validateSources(data);
  const sourceIds = new Set(indexes.sources.keys());
  validateRows(data, { ...indexes, sources: sourceIds }, data.package_kind);
  validateTalentTrees(Object.hasOwn(data, 'talent_trees') ? data.talent_trees : [], indexes.skills, sourceIds, data.package_kind);
  validateAssetReferences(data, indexes.assets);
  validateAssets(data, indexes, assetBytes);
  validateRelations(data, indexes);
  const routes = validateRoutes(data, indexes);
  return { ...indexes, routes };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
    return out;
  }
  return value;
}
function stableJson(value) { return JSON.stringify(stableValue(value), null, 2) + '\n'; }
function detailPath(kind, row) {
  if (kind === 'skill') return 'details/skills/' + row.archetype + '/' + row.skill_id + '.json';
  if (kind === 'mechanics') return 'details/mechanics/' + row.archetype + '/' + row.skill_id + '.json';
  if (kind === 'weapon') return 'details/weapons/' + row.weapon_id + '.json';
  if (kind === 'mark') return 'details/marks/' + row.mark_id + '.json';
  if (kind === 'blessing') return 'details/blessings/' + row.blessing_id + '.json';
  if (kind === 'variant') return 'details/variants/' + row.variant_id + '.json';
}
function catalogName(kind, row, indexes) {
  return kind === 'variant' ? indexes.blessings.get(row.blessing_id).name_zh_tw : row.name_zh_tw;
}
function catalogEntries(data, indexes, routeIndex) {
  const entries = [];
  const add = (kind, id, row, routeKind, display, assetIds) => {
    entries.push({
      kind, id, name_zh_tw: display, category: row.category,
      route: routeIndex.byContent.get(routeKind + ':' + id),
      detail_path: detailPath(kind, row), asset_ids: [...assetIds].sort()
    });
  };
  for (const row of data.skills) {
    const id = skillId(row);
    add('skill', id, row, 'skill', catalogName('skill', row, indexes), row.asset_ids);
    add('mechanics', id, row, 'mechanics', catalogName('mechanics', row, indexes), row.asset_ids);
  }
  for (const row of data.weapons) add('weapon', row.weapon_id, row, 'weapon', catalogName('weapon', row, indexes), row.asset_ids);
  for (const row of data.marks) add('mark', row.mark_id, row, 'mark', catalogName('mark', row, indexes), row.asset_ids);
  for (const row of data.blessings) add('blessing', row.blessing_id, row, 'blessing', catalogName('blessing', row, indexes), row.asset_ids);
  for (const row of data.variants) add('variant', row.variant_id, row, 'variant', catalogName('variant', row, indexes), row.asset_ids);
  const order = new Map([['skill', 0], ['mechanics', 1], ['weapon', 2], ['mark', 3], ['blessing', 4], ['variant', 5]]);
  entries.sort((a, b) => order.get(a.kind) - order.get(b.kind) || a.id.localeCompare(b.id));
  return entries;
}
function recordSources(row, sourceIndex) {
  const ids = new Set(row.source_ids ?? []);
  const visit = claims => { for (const claim of claims ?? []) if (claim.state === 'known') ids.add(claim.source_ref); };
  visit(row.claims);
  for (const tier of row.tier_claims ?? []) visit(tier.claims);
  return [...ids].map(id => sourceIndex.get(id)).sort((a, b) => a.source_id.localeCompare(b.source_id));
}
function detailRecord(entry, indexes) {
  return entry.kind === 'skill' || entry.kind === 'mechanics'
    ? indexes.skills.get(entry.id)
    : getRecord(entry.kind, entry.id, indexes);
}
function relationName(kind, id, indexes) {
  if (kind === 'skill' || kind === 'mechanics') return indexes.skills.get(id).name_zh_tw;
  if (kind === 'weapon') return indexes.weapons.get(id).name_zh_tw;
  if (kind === 'mark') return indexes.marks.get(id).name_zh_tw;
  if (kind === 'blessing') return indexes.blessings.get(id).name_zh_tw;
  if (kind === 'variant') return indexes.blessings.get(indexes.variants.get(id).blessing_id).name_zh_tw;
}
function makeRelation(kind, id, routeIndex, indexes) {
  return { kind, id, name_zh_tw: relationName(kind, id, indexes), route: routeIndex.byContent.get(kind + ':' + id) };
}
function detailRelations(entry, data, indexes, routeIndex) {
  const related = new Map();
  const add = (kind, id) => related.set(kind + ':' + id, makeRelation(kind, id, routeIndex, indexes));
  const bindings = data.bindings;
  if (entry.kind === 'skill') add('mechanics', entry.id);
  if (entry.kind === 'mechanics') add('skill', entry.id);
  if (entry.kind === 'weapon') {
    for (const id of indexes.weapons.get(entry.id).mark_ids) add('mark', id);
    for (const variant of data.variants.filter(row => row.weapon_id === entry.id)) {
      add('variant', variant.variant_id);
      add('blessing', variant.blessing_id);
    }
  }
  if (entry.kind === 'mark') {
    add('weapon', indexes.marks.get(entry.id).weapon_id);
    for (const b of bindings.filter(b => b.mark_id === entry.id)) { add('blessing', b.blessing_id); add('variant', b.variant_id); }
  }
  if (entry.kind === 'blessing') {
    for (const id of indexes.blessings.get(entry.id).variant_ids) {
      add('variant', id);
      add('weapon', indexes.variants.get(id).weapon_id);
    }
    for (const b of bindings.filter(b => b.blessing_id === entry.id)) add('mark', b.mark_id);
  }
  if (entry.kind === 'variant') {
    const row = indexes.variants.get(entry.id);
    add('blessing', row.blessing_id); add('weapon', row.weapon_id);
    for (const b of bindings.filter(b => b.variant_id === entry.id)) add('mark', b.mark_id);
  }
  return [...related.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}
function detail(entry, data, indexes, routeIndex) {
  const row = detailRecord(entry, indexes);
  const assets = row.asset_ids.map(id => {
    const asset = indexes.assets.get(id);
    return { asset_id: asset.asset_id, path: asset.path, source_url: asset.source_url, attribution: asset.attribution };
  }).sort((a, b) => a.asset_id.localeCompare(b.asset_id));
  return {
    schema_version: 2,
    kind: entry.kind,
    record: row,
    relations: detailRelations(entry, data, indexes, routeIndex),
    assets,
    sources: recordSources(row, indexes.sources)
  };
}

function talentTreeSkillIds(tree) {
  return [...new Set(tree.nodes
    .filter(node => node.skill_id !== null)
    .map(node => tree.archetype + '/' + node.skill_id))].sort((a, b) => a.localeCompare(b));
}
function talentTreeOutput(tree, data, indexes, routeIndex) {
  return {
    schema_version: 2,
    archetype: tree.archetype,
    version: tree.version,
    nodes: tree.nodes,
    source_ids: [...tree.source_ids].sort((a, b) => a.localeCompare(b)),
    sources: recordSources(tree, indexes.sources),
    details: talentTreeSkillIds(tree).map(id => detail({ kind: 'skill', id }, data, indexes, routeIndex))
  };
}
function talentTreeCatalogRows(trees) {
  return [...trees]
    .sort((a, b) => a.archetype.localeCompare(b.archetype))
    .map(tree => ({
      archetype: tree.archetype,
      version: tree.version,
      tree_path: 'trees/' + tree.archetype + '.json',
      node_count: tree.nodes.length
    }));
}
function parsePublicJson(files, path) {
  const text = files.get(path);
  if (typeof text !== 'string') fail('public JSON file is missing or not text: ' + path);
  try { return JSON.parse(text); } catch { fail('public JSON file is invalid: ' + path); }
}
function sameJson(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}
function expectedAssetIds(record) {
  return [...array(record.asset_ids, 'record asset_ids')].sort();
}
function expectedSourceIds(record) {
  const ids = new Set(array(record.source_ids, 'record source_ids'));
  const collect = claims => {
    for (const claim of claims ?? []) if (claim.state === 'known') ids.add(claim.source_ref);
  };
  collect(record.claims);
  for (const tier of record.tier_claims ?? []) collect(tier.claims);
  return [...ids].sort();
}
function isReciprocalRelation(sourceEntry, target) {
  return target.relations.some(relation => relation.kind === sourceEntry.kind && relation.id === sourceEntry.id);
}
function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && Boolean(url.hostname); } catch { return false; }
}
const GITHUB_ATTACHMENT_PATTERN = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function isGithubAttachmentUrl(value) { return typeof value === 'string' && GITHUB_ATTACHMENT_PATTERN.test(value); }
function isGithubAttachmentLocation(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase() === 'github.com' && url.pathname.startsWith('/user-attachments/assets/');
  } catch { return false; }
}
function githubAttachmentAssetId(url) { return 'github-' + createHash('sha256').update(url).digest('hex'); }
function isDirectGamesLanternUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'gameslantern.com' || host === 'darktide.gameslantern.com') &&
      !url.username && !url.password && !url.port && !url.search && !url.hash;
  } catch { return false; }
}
function validateOutputAsset(asset, files, packageKind) {
  exact(asset, ['asset_id', 'path', 'source_url', 'attribution'], 'detail asset');
  safeId(asset.asset_id, 'detail asset_id');
  if (asset.path === null) {
    if (!isGithubAttachmentUrl(asset.source_url)) fail('remote detail asset source_url must be an exact HTTPS GitHub user-attachments UUID URL');
    if (asset.asset_id !== githubAttachmentAssetId(asset.source_url)) fail('remote detail asset ID must match its URL hash');
    if (!asset.attribution) fail('remote Games Lantern detail assets require visible direct attribution');
    exact(asset.attribution, ATTRIBUTION_FIELDS, 'detail asset attribution');
    if (asset.attribution.href !== null && !isHttpsUrl(asset.attribution.href)) fail('detail asset attribution href must use HTTPS or null');
    textOrNull(asset.attribution.text, 'detail asset attribution text');
    if (typeof asset.attribution.follow_required !== 'boolean') fail('detail asset follow_required must be boolean');
    if (!isDirectGamesLanternUrl(asset.attribution.href) || asset.attribution.follow_required !== true ||
        typeof asset.attribution.text !== 'string' || !asset.attribution.text.trim()) {
      fail('remote Games Lantern detail assets require visible direct attribution and follow');
    }
    return;
  }
  if (isGithubAttachmentLocation(asset.source_url)) fail('GitHub user-attachment detail assets must use a null path');
  if (typeof asset.path !== 'string' || !/^icons\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:svg|png|webp|jpe?g|gif)$/.test(asset.path) ||
      asset.path.split('/').some(segment => segment === '.' || segment === '..')) fail('detail asset path is unsafe');
  if (asset.source_url !== null && !isHttpsUrl(asset.source_url)) fail('detail asset source_url must use HTTPS or null');
  if (asset.attribution !== null) {
    exact(asset.attribution, ATTRIBUTION_FIELDS, 'detail asset attribution');
    if (asset.attribution.href !== null && !isHttpsUrl(asset.attribution.href)) fail('detail asset attribution href must use HTTPS or null');
    textOrNull(asset.attribution.text, 'detail asset attribution text');
    if (typeof asset.attribution.follow_required !== 'boolean') fail('detail asset follow_required must be boolean');
  }
  if (isGamesLanternUrl(asset.source_url) || isGamesLanternUrl(asset.attribution?.href)) {
    if (!asset.attribution || !isGamesLanternUrl(asset.attribution.href) ||
        asset.attribution.follow_required !== true || typeof asset.attribution.text !== 'string' || !asset.attribution.text.trim()) {
      fail('Games Lantern detail assets require visible direct attribution');
    }
  }
  const bytes = files.get(asset.path);
  const extension = asset.path.slice(asset.path.lastIndexOf('.') + 1).toLowerCase();
  const mediaType = { svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }[extension];
  if (!bytesMatch(bytes, mediaType, packageKind)) fail('public asset bytes do not match an allowed image signature: ' + asset.path);
}
export function validatePublicFiles(files) {
  if (!(files instanceof Map)) fail('public files must be a Map');
  for (const [path, value] of files) {
    if (typeof path !== 'string' || path.startsWith('/') || path.includes('\\') ||
        path.split('/').some(part => !part || part === '.' || part === '..')) fail('public output path is unsafe');
    if (!(typeof value === 'string' || value instanceof Uint8Array)) fail('public output file must contain text or bytes');
  }
  const catalog = parsePublicJson(files, 'catalog.json');
  exact(catalog, ['schema_version', 'game_version', 'package_kind', 'counts', 'entries', 'redirects', 'talent_trees'], 'catalog');
  if (catalog.schema_version !== 2) fail('catalog schema_version must be 2');
  string(catalog.game_version, 'catalog game_version');
  if (!['fixture', 'published'].includes(catalog.package_kind)) fail('catalog package_kind is invalid');
  const treeMetadata = Object.hasOwn(catalog, 'talent_trees') ? array(catalog.talent_trees, 'catalog talent_trees') : [];
  const treeMetadataByArchetype = new Map();
  for (const metadata of treeMetadata) {
    exact(metadata, TALENT_TREE_CATALOG_FIELDS, 'catalog talent tree');
    safeId(metadata.archetype, 'catalog talent tree archetype');
    if (treeMetadataByArchetype.has(metadata.archetype)) fail('duplicate catalog talent tree archetype');
    treeMetadataByArchetype.set(metadata.archetype, metadata);
    if (!Number.isSafeInteger(metadata.version) || metadata.version < 1) fail('catalog talent tree version must be a positive integer');
    if (metadata.tree_path !== 'trees/' + metadata.archetype + '.json') fail('catalog talent tree_path is invalid');
    if (!Number.isSafeInteger(metadata.node_count) || metadata.node_count < 1) fail('catalog talent tree node_count must be positive');
  }
  if (!sameJson(treeMetadata, [...treeMetadata].sort((a, b) => a.archetype.localeCompare(b.archetype)))) fail('catalog talent_trees must be sorted by archetype');
  exact(catalog.counts, ['skills', 'weapons', 'marks', 'blessings', 'variants', 'mechanics'], 'catalog counts');
  for (const value of Object.values(catalog.counts)) if (!Number.isInteger(value) || value < 0) fail('catalog counts must be nonnegative integers');
  const entries = array(catalog.entries, 'catalog entries');
  const entryByKey = new Map();
  const routeOwners = new Map();
  const details = new Map();
  const expectedFiles = new Set(['catalog.json']);
  for (const metadata of treeMetadata) expectedFiles.add(metadata.tree_path);
  const expectedCounts = { skills: 0, weapons: 0, marks: 0, blessings: 0, variants: 0, mechanics: 0 };
  const allowedKinds = new Set(['skill', 'mechanics', 'weapon', 'mark', 'blessing', 'variant']);
  for (const entry of entries) {
    exact(entry, ['kind', 'id', 'name_zh_tw', 'category', 'route', 'detail_path', 'asset_ids'], 'catalog entry');
    if (!allowedKinds.has(entry.kind)) fail('catalog entry kind is unsupported');
    if (entry.kind === 'skill' || entry.kind === 'mechanics') {
      if (typeof entry.id !== 'string' || !/^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(entry.id)) fail('catalog skill ID is invalid');
    } else safeId(entry.id, 'catalog entry ID');
    if (['skill', 'mechanics', 'weapon', 'mark'].includes(entry.kind)) nameOrNull(entry.name_zh_tw, 'catalog entry name_zh_tw');
    else name(entry.name_zh_tw, 'catalog entry name_zh_tw');
    category(entry.category, 'catalog entry category');
    safePath(entry.route, 'catalog entry route');
    if (typeof entry.detail_path !== 'string' || !/^details\/(?:skills|mechanics)\/[a-z0-9_-]+\/[a-z0-9_-]+\.json$|^details\/(?:weapons|marks|blessings|variants)\/[a-z0-9_-]+\.json$/.test(entry.detail_path)) fail('catalog detail_path is invalid');
    const key = entry.kind + ':' + entry.id;
    if (entryByKey.has(key)) fail('duplicate catalog entry: ' + key);
    if (routeOwners.has(entry.route)) fail('duplicate catalog route: ' + entry.route);
    routeOwners.set(entry.route, key);
    entryByKey.set(key, entry);
    expectedFiles.add(entry.detail_path);
    const expectedCountKey = entry.kind === 'skill' ? 'skills' : entry.kind === 'mechanics' ? 'mechanics' : entry.kind + 's';
    expectedCounts[expectedCountKey]++;
    const detailData = parsePublicJson(files, entry.detail_path);
    exact(detailData, ['schema_version', 'kind', 'record', 'relations', 'assets', 'sources'], 'detail');
    if (detailData.schema_version !== 2 || detailData.kind !== entry.kind) fail('detail schema or kind does not match catalog entry');
    exact(detailData.record, ROW_FIELDS[entry.kind === 'mechanics' ? 'skill' : entry.kind], 'detail record');
    const record = detailData.record;
    const id = recordId(entry.kind, record);
    if (id !== entry.id) fail('detail record identity does not match catalog entry');
    if (expectedRoute(entry.kind, record) !== entry.route) fail('catalog route does not match detail record');
    if (detailPath(entry.kind, record) !== entry.detail_path) fail('catalog detail_path does not match detail record');
    const blessingEntry = entries.find(candidate => candidate.kind === 'blessing' && candidate.id === record.blessing_id);
    const displayName = entry.kind === 'variant' ? blessingEntry?.name_zh_tw : record.name_zh_tw;
    if (entry.name_zh_tw !== displayName || entry.category !== record.category) fail('catalog display name or category does not match detail record');
    const recordAssetIds = expectedAssetIds(record);
    const entryAssetIds = array(entry.asset_ids, 'catalog asset_ids');
    if (new Set(entryAssetIds).size !== entryAssetIds.length || !sameJson(entryAssetIds, recordAssetIds)) fail('catalog asset_ids do not match detail record');
    details.set(key, detailData);
  }
  for (const [key, count] of Object.entries(expectedCounts)) if (catalog.counts[key] !== count) fail('catalog count does not match entries: ' + key);
  if (catalog.package_kind === 'published' &&
      ['skills', 'weapons', 'marks', 'blessings', 'variants'].some(key => expectedCounts[key] === 0)) {
    fail('published content requires nonempty skills, weapons, marks, blessings, and variants');
  }
  for (const entry of entries) {
    if (entry.kind === 'skill' && !entryByKey.has('mechanics:' + entry.id)) fail('catalog skill is missing its mechanics entry');
    if (entry.kind === 'mechanics' && !entryByKey.has('skill:' + entry.id)) fail('catalog mechanics is missing its skill entry');
  }
  const reconstructed = {
    schema_version: 2, package_kind: catalog.package_kind, game_version: catalog.game_version,
    skills: [], weapons: [], marks: [], blessings: [], variants: [], bindings: [],
    assets: [], routes: [], sources: [], talent_trees: []
  };
  const sourceRegistry = new Map();
  const assetRegistry = new Map();
  const outputAssetBytes = new Map();
  for (const detailData of details.values()) {
    const kind = detailData.kind;
    if (kind !== 'mechanics') reconstructed[kind + 's'].push(detailData.record);
    for (const source of array(detailData.sources, 'detail sources')) {
      exact(source, SOURCE_FIELDS, 'detail source');
      const existing = sourceRegistry.get(source.source_id);
      if (existing && !sameJson(existing, source)) fail('source metadata conflicts across detail pages');
      sourceRegistry.set(source.source_id, source);
    }
    for (const asset of array(detailData.assets, 'detail assets')) {
      validateOutputAsset(asset, files, catalog.package_kind);
      const bytes = asset.path === null ? undefined : files.get(asset.path);
      const extension = typeof asset.path === 'string' ? asset.path.slice(asset.path.lastIndexOf('.') + 1).toLowerCase() : '';
      const mediaType = { svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }[extension];
      const remote = asset.path === null;
      const reconstructedAsset = {
        asset_id: asset.asset_id, path: asset.path,
        sha256: remote ? null : bytes instanceof Uint8Array ? createHash('sha256').update(bytes).digest('hex') : '',
        media_type: remote ? null : mediaType, source_url: asset.source_url, attribution: asset.attribution
      };
      const existing = assetRegistry.get(asset.asset_id);
      if (existing && !sameJson(existing, reconstructedAsset)) {
        fail('asset metadata conflicts between detail pages');
      }
      assetRegistry.set(asset.asset_id, reconstructedAsset);
      if (!remote) {
        outputAssetBytes.set(asset.path, bytes);

      }
    }
  }
  const treeOutputs = [];
  const reconstructedTrees = [];
  for (const metadata of treeMetadata) {
    const treeOutput = parsePublicJson(files, metadata.tree_path);
    exact(treeOutput, TALENT_TREE_FILE_FIELDS, 'talent tree file');
    if (treeOutput.schema_version !== 2 || treeOutput.archetype !== metadata.archetype || treeOutput.version !== metadata.version) {
      fail('talent tree file identity does not match catalog metadata');
    }
    const treeNodes = array(treeOutput.nodes, 'talent tree file nodes');
    if (treeNodes.length !== metadata.node_count) fail('catalog talent tree node_count does not match tree file');
    const sourceIds = array(treeOutput.source_ids, 'talent tree file source_ids');
    const sortedSourceIds = [...sourceIds].sort((a, b) => a.localeCompare(b));
    if (!sameJson(sourceIds, sortedSourceIds) || new Set(sourceIds).size !== sourceIds.length) fail('talent tree file source_ids must be sorted and unique');
    const treeSources = array(treeOutput.sources, 'talent tree file sources');
    const treeSourceIdSet = validateSources({ sources: treeSources });
    if (!sameJson([...treeSourceIdSet].sort((a, b) => a.localeCompare(b)), sortedSourceIds)) {
      fail('talent tree file sources do not exactly match source_ids');
    }
    for (const source of treeSources) {
      const existing = sourceRegistry.get(source.source_id);
      if (existing && !sameJson(existing, source)) fail('source metadata conflicts between talent tree and detail pages');
      sourceRegistry.set(source.source_id, source);
    }
    reconstructedTrees.push({
      archetype: treeOutput.archetype,
      version: treeOutput.version,
      nodes: treeNodes,
      source_ids: sourceIds
    });
    treeOutputs.push(treeOutput);
  }
  reconstructed.talent_trees = reconstructedTrees;
  reconstructed.sources = [...sourceRegistry.values()];
  reconstructed.assets = [...assetRegistry.values()];
  reconstructed.routes = entries.map(entry => ({
    route_kind: 'canonical', content_kind: entry.kind, content_key: entry.id,
    source_route: null, target_route: entry.route, decision: 'keep'
  }));
  for (const redirect of catalog.redirects) {
    const owner = routeOwners.get(redirect.target_route);
    if (!owner) fail('catalog redirect target is not a canonical route');
    const separator = owner.indexOf(':');
    reconstructed.routes.push({
      route_kind: 'redirect', content_kind: owner.slice(0, separator),
      content_key: owner.slice(separator + 1), source_route: redirect.source_route,
      target_route: redirect.target_route, decision: 'redirect'
    });
  }
  const reconstructedIndexes = indexesFor(reconstructed);
  const reconstructedSources = validateSources(reconstructed);
  validateRows(reconstructed, { ...reconstructedIndexes, sources: reconstructedSources }, catalog.package_kind);
  validateTalentTrees(reconstructed.talent_trees, reconstructedIndexes.skills, reconstructedSources, catalog.package_kind);
  validateAssetReferences(reconstructed, reconstructedIndexes.assets);
  validateAssets(reconstructed, reconstructedIndexes, outputAssetBytes);
  validateRelations(reconstructed, reconstructedIndexes);
  validateRoutes(reconstructed, reconstructedIndexes);
  for (const treeOutput of treeOutputs) {
    const expectedDetails = talentTreeSkillIds(treeOutput).map(id => {
      const canonical = details.get('skill:' + id);
      if (!canonical) fail('talent tree references an unknown canonical skill detail');
      return canonical;
    });
    if (!sameJson(array(treeOutput.details, 'talent tree file details'), expectedDetails)) {
      fail('talent tree details do not exactly match canonical skill detail payloads');
    }
  }

  const iconFiles = new Set();
  const assetsById = new Map();
  for (const [key, detailData] of details) {
    const row = detailData.record;
    const sourceIds = validateSources({ sources: array(detailData.sources, 'detail sources') });
    validateRecordSources(row, catalog.package_kind, sourceIds, 'detail record');
    validateClaims(row.claims ?? [], 'detail record', sourceIds);
    for (const tier of row.tier_claims ?? []) validateClaims(tier.claims, 'detail tier', sourceIds);
    const expectedIds = expectedSourceIds(row);
    const actualIds = detailData.sources.map(source => source.source_id).sort();
    if (new Set(actualIds).size !== actualIds.length || !sameJson(actualIds, expectedIds)) fail('detail sources do not match record source_ids and claims');
    const relations = array(detailData.relations, 'detail relations');
    const relationKeys = new Set();
    for (const relation of relations) {
      exact(relation, ['kind', 'id', 'name_zh_tw', 'route'], 'detail relation');
      if (!allowedKinds.has(relation.kind)) fail('detail relation kind is unsupported');
      textOrNull(relation.name_zh_tw, 'detail relation name_zh_tw');
      safePath(relation.route, 'detail relation route');
      const relationKey = relation.kind + ':' + relation.id;
      const targetEntry = entryByKey.get(relationKey);
      if (!targetEntry || relationKeys.has(relationKey) || relation.route !== targetEntry.route || relation.name_zh_tw !== targetEntry.name_zh_tw) {
        fail('detail relation is duplicate or does not match a catalog entry');
      }
      relationKeys.add(relationKey);
    }
    const entry = entryByKey.get(key);
    const has = (kind, id) => relationKeys.has(kind + ':' + id);
    if (entry.kind === 'skill' && !has('mechanics', entry.id)) fail('skill detail is missing its mechanics relation');
    if (entry.kind === 'mechanics' && !has('skill', entry.id)) fail('mechanics detail is missing its skill relation');
    if (entry.kind === 'weapon') for (const id of row.mark_ids) if (!has('mark', id)) fail('weapon detail is missing a mark relation');
    if (entry.kind === 'mark' && !has('weapon', row.weapon_id)) fail('mark detail is missing its weapon relation');
    if (entry.kind === 'blessing') for (const id of row.variant_ids) if (!has('variant', id)) fail('blessing detail is missing a variant relation');
    if (entry.kind === 'variant' && (!has('blessing', row.blessing_id) || !has('weapon', row.weapon_id))) fail('variant detail is missing a direct relation');
    for (const relation of relations) {
      const target = details.get(relation.kind + ':' + relation.id);
      if (!target || !isReciprocalRelation(entry, target)) fail('detail relation is not reciprocal');
    }
    const assets = array(detailData.assets, 'detail assets');
    const recordAssetIds = expectedAssetIds(row);
    const detailAssetIds = [];
    for (const asset of assets) {
      detailAssetIds.push(asset.asset_id);
      const existing = assetsById.get(asset.asset_id);
      if (existing && !sameJson(existing, asset)) fail('asset metadata differs between detail pages');
      assetsById.set(asset.asset_id, asset);
      if (asset.path !== null) iconFiles.add(asset.path);
    }
    detailAssetIds.sort();
    if (new Set(detailAssetIds).size !== detailAssetIds.length || !sameJson(detailAssetIds, recordAssetIds)) fail('detail assets do not match record asset_ids');
  }
  for (const [key, detailData] of details) {
    if (key.startsWith('mechanics:')) {
      const skill = details.get('skill:' + key.slice('mechanics:'.length));
      if (!skill || !sameJson(detailData.record, skill.record)) fail('mechanics record must match its skill record');
    }
    if (key.startsWith('weapon:')) {
      for (const candidate of details.values()) if (candidate.kind === 'variant' && candidate.record.weapon_id === detailData.record.weapon_id) {
        if (!detailData.relations.some(relation => relation.kind === 'variant' && relation.id === candidate.record.variant_id) ||
            !detailData.relations.some(relation => relation.kind === 'blessing' && relation.id === candidate.record.blessing_id)) fail('weapon detail is missing direct variant or blessing relation');
      }
    }
    if (key.startsWith('blessing:')) {
      for (const candidate of details.values()) if (candidate.kind === 'variant' && candidate.record.blessing_id === detailData.record.blessing_id) {
        if (!detailData.relations.some(relation => relation.kind === 'weapon' && relation.id === candidate.record.weapon_id)) fail('blessing detail is missing direct weapon relation');
      }
    }
  }
  for (const iconPath of iconFiles) expectedFiles.add(iconPath);
  const redirects = array(catalog.redirects, 'catalog redirects');
  const redirectSources = new Set();
  for (const redirect of redirects) {
    exact(redirect, ['source_route', 'target_route'], 'catalog redirect');
    safePath(redirect.source_route, 'catalog redirect source_route');
    safePath(redirect.target_route, 'catalog redirect target_route');
    if (isReservedIndexRoute(redirect.source_route) || redirectSources.has(redirect.source_route) || routeOwners.has(redirect.source_route)) {
      fail('catalog redirect source is reserved or collides with another route');
    }
    if (!routeOwners.has(redirect.target_route)) fail('catalog redirect target is not a canonical route');
    redirectSources.add(redirect.source_route);
  }
  const orderedRedirects = [...redirects].sort((a, b) => a.source_route.localeCompare(b.source_route));
  if (!sameJson(redirects, orderedRedirects)) fail('catalog redirects must be sorted by source_route');
  if (files.size !== expectedFiles.size || [...files.keys()].some(path => !expectedFiles.has(path))) fail('public output has missing or unreferenced files');
  return { catalog, entries };
}

export function createPublicFiles(data, { assetBytes = new Map() } = {}) {
  const indexes = validatePublishedContent(data, { assetBytes });
  const entries = catalogEntries(data, indexes, indexes.routes);
  const catalog = {
    schema_version: 2,
    game_version: data.game_version,
    package_kind: data.package_kind,
    counts: {
      skills: data.skills.length,
      weapons: data.weapons.length,
      marks: data.marks.length,
      blessings: data.blessings.length,
      variants: data.variants.length,
      mechanics: data.skills.length
    },
    entries,
    redirects: data.routes
      .filter(route => route.route_kind === 'redirect')
      .map(route => ({ source_route: route.source_route, target_route: route.target_route }))
      .sort((a, b) => a.source_route.localeCompare(b.source_route))
  };
  const talentTrees = data.talent_trees ?? [];
  if (talentTrees.length > 0) catalog.talent_trees = talentTreeCatalogRows(talentTrees);
  const files = new Map([['catalog.json', stableJson(catalog)]]);
  for (const entry of entries) files.set(entry.detail_path, stableJson(detail(entry, data, indexes, indexes.routes)));
  for (const tree of [...talentTrees].sort((a, b) => a.archetype.localeCompare(b.archetype))) {
    files.set('trees/' + tree.archetype + '.json', stableJson(talentTreeOutput(tree, data, indexes, indexes.routes)));
  }
  for (const asset of [...data.assets].filter(asset => asset.path !== null).sort((a, b) => a.path.localeCompare(b.path))) files.set(asset.path, new Uint8Array(assetBytes.get(asset.path)));
  validatePublicFiles(files);
  return files;
}

