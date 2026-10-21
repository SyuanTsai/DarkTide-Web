const CONTENT_KINDS = new Set(['skill', 'mechanics', 'weapon', 'mark', 'blessing', 'variant']);
const COUNT_FIELDS = ['skills', 'weapons', 'marks', 'blessings', 'variants', 'mechanics'];
const ID_SEGMENT = /^[a-z0-9_-]+$/;
const DATA_REVISION = /^[a-f0-9]{64}$/;
const DATA_PATH_SEGMENT = /^[a-zA-Z0-9_.-]+$/;
const GITHUB_ATTACHMENT_URL = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const TALENT_NODE_TYPES = new Set([
  'default', 'ability', 'ability_modifier', 'aura', 'keystone', 'keystone_modifier',
  'start', 'stat', 'tactical', 'tactical_modifier'
]);
const TALENT_NODE_ID = /^[a-z0-9_-]+$/;
const SOURCE_ID = /^[a-z][a-z0-9._-]{0,127}$/;
function fail(message, name = 'PublicDataError') {
  const error = new Error(message);
  error.name = name;
  error.retryable = name !== 'InvalidPublicDataError';
  return error;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(`${label} must be an object`, 'InvalidPublicDataError');
}

function requireSafeId(id, label) {
  if (typeof id !== 'string' || !id || !id.split('/').every(part => ID_SEGMENT.test(part))) {
    throw fail(`${label} has an invalid ID`, 'InvalidPublicDataError');
  }
}

function requireCanonicalPath(route, label = 'route') {
  if (typeof route !== 'string' || !route.startsWith('/') || route.includes('//') || route.includes('\\') ||
      route.includes('?') || route.includes('#') || /%(?:2f|5c|2e)/i.test(route) ||
      !/^\/(?:[a-z0-9_-]+\/)*$/.test(route)) {
    throw fail(`${label} is not a safe local route`, 'InvalidPublicDataError');
  }
}

function requireRelativePath(path, label, { leadingSlash = false, extension = null } = {}) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('?') || path.includes('#') ||
      /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) {
    throw fail(`${label} is not a safe relative path`, 'InvalidPublicDataError');
  }
  const relative = leadingSlash ? path.replace(/^\//, '') : path;
  const segments = relative.split('/');
  if (segments.some(part => !part || part === '.' || part === '..' || !DATA_PATH_SEGMENT.test(part))) {
    throw fail(`${label} is not a safe relative path`, 'InvalidPublicDataError');
  }
  if (extension && !relative.toLowerCase().endsWith(extension)) throw fail(`${label} has an invalid extension`, 'InvalidPublicDataError');
  return relative;
}

function isGithubAttachmentUrl(value) {
  return typeof value === 'string' && GITHUB_ATTACHMENT_URL.test(value);
}

function looksLikeGithubAttachment(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith('/user-attachments/assets/');
  } catch { return false; }
}

function requireGamesLanternAttribution(attribution) {
  requireObject(attribution, 'remote asset attribution');
  let url;
  try { url = new URL(attribution.href); } catch { throw fail('remote asset attribution URL is invalid', 'InvalidPublicDataError'); }
  if (url.protocol !== 'https:' || !['gameslantern.com', 'darktide.gameslantern.com'].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash ||
      typeof attribution.text !== 'string' || !attribution.text.trim() || attribution.follow_required !== true) {
    throw fail('remote asset must include a visible, followable Games Lantern credit', 'InvalidPublicDataError');
  }
}

function splitSkillId(id) {
  const parts = id.split('/');
  if (parts.length !== 2) throw fail('skill identity must be archetype/skill_id', 'InvalidPublicDataError');
  return parts;
}

export function canonicalRoute(kind, id, record = null) {
  requireSafeId(id, kind);
  if (kind === 'skill' || kind === 'mechanics') {
    const [archetype, skillId] = splitSkillId(id);
    return `/skills/${archetype}/${skillId}/${kind === 'mechanics' ? 'mechanics/' : ''}`;
  }
  if (kind === 'weapon') return `/weapons/${id}/`;
  if (kind === 'blessing') return `/blessings/${id}/`;
  if (kind === 'mark') {
    requireObject(record, 'mark record');
    requireSafeId(record.weapon_id, 'mark weapon_id');
    if (record.mark_id !== id) throw fail('mark identity does not match its record', 'InvalidPublicDataError');
    return `/weapons/${record.weapon_id}/marks/${id}/`;
  }
  if (kind === 'variant') {
    requireObject(record, 'variant record');
    requireSafeId(record.blessing_id, 'variant blessing_id');
    if (record.variant_id !== id) throw fail('variant identity does not match its record', 'InvalidPublicDataError');
    return `/blessings/${record.blessing_id}/variants/${id}/`;
  }
  throw fail(`unsupported content kind: ${kind}`, 'InvalidPublicDataError');
}

function catalogRouteMatches(entry) {
  if (entry.kind === 'skill' || entry.kind === 'mechanics' || entry.kind === 'weapon' || entry.kind === 'blessing') {
    return entry.route === canonicalRoute(entry.kind, entry.id);
  }
  const parts = entry.route.split('/').filter(Boolean);
  if (entry.kind === 'mark') return parts.length === 4 && parts[0] === 'weapons' && parts[2] === 'marks' && parts[3] === entry.id;
  if (entry.kind === 'variant') return parts.length === 4 && parts[0] === 'blessings' && parts[2] === 'variants' && parts[3] === entry.id;
  return false;
}

function isReservedListRoute(route, catalog) {
  if (route === '/' || route === '/skills/' || route === '/weapons/' || route === '/blessings/') return true;
  const match = /^\/skills\/([a-z0-9_-]+)\/$/.exec(route);
  return Boolean(match && catalog.entries.some(entry => entry.kind === 'skill' && entry.id.startsWith(`${match[1]}/`)));
}

function expectedCatalogIdentity(kind, record) {
  if (kind === 'skill' || kind === 'mechanics') return `${record.archetype}/${record.skill_id}`;
  if (kind === 'weapon') return record.weapon_id;
  if (kind === 'mark') return record.mark_id;
  if (kind === 'blessing') return record.blessing_id;
  if (kind === 'variant') return record.variant_id;
  return null;
}

function validateTalentTreeMetadata(metadata) {
  requireObject(metadata, 'talent tree metadata');
  if (typeof metadata.archetype !== 'string' || !TALENT_NODE_ID.test(metadata.archetype) ||
      !Number.isSafeInteger(metadata.version) || metadata.version <= 0) {
    throw fail('talent tree metadata has an invalid archetype or version', 'InvalidPublicDataError');
  }
  const treePath = requireRelativePath(metadata.tree_path, 'talent tree path', { extension: '.json' });
  if (treePath !== `trees/${metadata.archetype}.json`) {
    throw fail('talent tree metadata path does not match its archetype', 'InvalidPublicDataError');
  }
  if (!Number.isSafeInteger(metadata.node_count) || metadata.node_count <= 0) {
    throw fail('talent tree metadata node_count is invalid', 'InvalidPublicDataError');
  }
  return metadata;
}

function sameTalentTreeMetadata(left, right) {
  return left?.archetype === right?.archetype && left?.version === right?.version &&
    left?.tree_path === right?.tree_path && left?.node_count === right?.node_count;
}
export function validateCatalog(catalog, build) {
  requireObject(build, 'build context');
  requireObject(catalog, 'catalog');
  if (build.schema_version !== 2 || catalog.schema_version !== 2) throw fail('unsupported catalog schema version', 'InvalidPublicDataError');
  if (!DATA_REVISION.test(build.data_revision ?? '') || !DATA_REVISION.test(build.build_id ?? '')) {
    throw fail('build context has an invalid data revision or build ID', 'InvalidPublicDataError');
  }
  if (typeof build.game_version !== 'string' || !build.game_version || !['published', 'fixture'].includes(build.package_kind)) {
    throw fail('build context is incomplete', 'InvalidPublicDataError');
  }
  if (catalog.game_version !== build.game_version || catalog.package_kind !== build.package_kind) {
    throw fail('catalog does not match the build context', 'InvalidPublicDataError');
  }
  requireObject(catalog.counts, 'catalog counts');
  for (const field of COUNT_FIELDS) {
    if (!Number.isSafeInteger(catalog.counts[field]) || catalog.counts[field] < 0) {
      throw fail(`catalog count ${field} is invalid`, 'InvalidPublicDataError');
    }
  }
  if (catalog.counts.mechanics !== catalog.counts.skills) throw fail('catalog mechanics count does not match skills count', 'InvalidPublicDataError');
  if (!Array.isArray(catalog.entries)) throw fail('catalog entries must be an array', 'InvalidPublicDataError');
  if (!Array.isArray(catalog.redirects)) throw fail('catalog redirects must be an array', 'InvalidPublicDataError');
  if (catalog.talent_trees !== undefined) {
    if (!Array.isArray(catalog.talent_trees)) throw fail('catalog talent_trees must be an array', 'InvalidPublicDataError');
    const archetypes = new Set();
    const treePaths = new Set();
    for (const metadata of catalog.talent_trees) {
      validateTalentTreeMetadata(metadata);
      if (archetypes.has(metadata.archetype) || treePaths.has(metadata.tree_path)) {
        throw fail('catalog talent tree metadata contains duplicate archetypes or paths', 'InvalidPublicDataError');
      }
      archetypes.add(metadata.archetype);
      treePaths.add(metadata.tree_path);
    }
  }

  const byRoute = new Map();
  const identities = new Set();
  const detailPaths = new Set();
  const countByKind = Object.fromEntries(COUNT_FIELDS.map(field => [field, 0]));
  for (const entry of catalog.entries) {
    requireObject(entry, 'catalog entry');
    if (!CONTENT_KINDS.has(entry.kind)) throw fail('catalog entry has an unsupported kind', 'InvalidPublicDataError');
    requireSafeId(entry.id, `${entry.kind} entry`);
    if ((entry.kind === 'skill' || entry.kind === 'mechanics') && entry.id.split('/').length !== 2) {
      throw fail(`${entry.kind} entry has an invalid identity`, 'InvalidPublicDataError');
    }
    if (entry.kind !== 'skill' && entry.kind !== 'mechanics' && entry.id.includes('/')) {
      throw fail(`${entry.kind} entry has an invalid identity`, 'InvalidPublicDataError');
    }
    if (entry.name_zh_tw !== null && (typeof entry.name_zh_tw !== 'string' || !entry.name_zh_tw.trim())) {
      throw fail('catalog entry name must be text or null', 'InvalidPublicDataError');
    }
    if (entry.category !== null && (typeof entry.category !== 'string' || !entry.category.trim())) {
      throw fail('catalog entry category must be text or null', 'InvalidPublicDataError');
    }
    requireCanonicalPath(entry.route, `${entry.kind} route`);
    if (!catalogRouteMatches(entry)) throw fail(`catalog route does not match ${entry.kind} identity`, 'InvalidPublicDataError');
    const identity = `${entry.kind}:${entry.id}`;
    if (identities.has(identity)) throw fail(`catalog has duplicate identity ${identity}`, 'InvalidPublicDataError');
    if (byRoute.has(entry.route)) throw fail(`catalog has duplicate route ${entry.route}`, 'InvalidPublicDataError');
    identities.add(identity);
    byRoute.set(entry.route, entry);
    const detailPath = requireRelativePath(entry.detail_path, 'catalog detail path', { extension: '.json' });
    if (!detailPath.startsWith('details/')) throw fail('catalog detail path must be under details/', 'InvalidPublicDataError');
    if (detailPaths.has(detailPath)) throw fail(`catalog has duplicate detail path ${detailPath}`, 'InvalidPublicDataError');
    detailPaths.add(detailPath);
    if (!Array.isArray(entry.asset_ids) || entry.asset_ids.some(id => typeof id !== 'string' || !id)) {
      throw fail('catalog asset_ids must be an array of IDs', 'InvalidPublicDataError');
    }
    countByKind[entry.kind === 'mechanics' ? 'mechanics' : `${entry.kind}s`] += 1;
  }
  for (const field of COUNT_FIELDS) {
    if (countByKind[field] !== catalog.counts[field]) throw fail(`catalog count ${field} does not match entries`, 'InvalidPublicDataError');
  }

  for (const metadata of catalog.talent_trees ?? []) {
    if (!catalog.entries.some(entry => entry.kind === 'skill' && entry.id.startsWith(metadata.archetype + '/'))) {
      throw fail('talent tree metadata references an archetype without catalog skills', 'InvalidPublicDataError');
    }
  }
  const redirectSources = new Set();
  const canonicalRoutes = new Set(byRoute.keys());
  for (const redirect of catalog.redirects) {
    requireObject(redirect, 'catalog redirect');
    requireCanonicalPath(redirect.source_route, 'redirect source route');
    requireCanonicalPath(redirect.target_route, 'redirect target route');
    if (redirectSources.has(redirect.source_route) || canonicalRoutes.has(redirect.source_route) || isReservedListRoute(redirect.source_route, catalog)) {
      throw fail('catalog redirect source is duplicate or overrides a canonical/list route', 'InvalidPublicDataError');
    }
    if (!byRoute.has(redirect.target_route)) throw fail('catalog redirect target is not a canonical entry route', 'InvalidPublicDataError');
    if (redirect.source_route === redirect.target_route) throw fail('catalog redirect points to itself', 'InvalidPublicDataError');
    redirectSources.add(redirect.source_route);
  }
  return catalog;
}

function detailIdentityMatches(entry, record) {
  return expectedCatalogIdentity(entry.kind, record) === entry.id;
}

function relationRouteMatches(relation) {
  if (!CONTENT_KINDS.has(relation.kind)) return false;
  try {
    requireSafeId(relation.id, 'relation');
    requireCanonicalPath(relation.route, 'relation route');
    if (relation.kind === 'skill' || relation.kind === 'mechanics' || relation.kind === 'weapon' || relation.kind === 'blessing') {
      return relation.route === canonicalRoute(relation.kind, relation.id);
    }
    const parts = relation.route.split('/').filter(Boolean);
    if (relation.kind === 'mark') return parts.length === 4 && parts[0] === 'weapons' && parts[2] === 'marks' && parts[3] === relation.id;
    if (relation.kind === 'variant') return parts.length === 4 && parts[0] === 'blessings' && parts[2] === 'variants' && parts[3] === relation.id;
  } catch {
    return false;
  }
  return false;
}

export function validateDetail(detail, entry, catalog = null) {
  requireObject(detail, 'detail');
  requireObject(entry, 'catalog entry');
  if (detail.schema_version !== 2 || detail.kind !== entry.kind) throw fail('detail schema or kind does not match catalog', 'InvalidPublicDataError');
  requireObject(detail.record, 'detail record');
  if (!detailIdentityMatches(entry, detail.record)) throw fail('detail record identity does not match catalog entry', 'InvalidPublicDataError');
  let expectedRoute;
  try { expectedRoute = canonicalRoute(entry.kind, entry.id, detail.record); }
  catch (error) { throw error; }
  if (expectedRoute !== entry.route) throw fail('detail canonical route does not match catalog entry', 'InvalidPublicDataError');
  if (!Array.isArray(detail.relations) || !Array.isArray(detail.assets) || !Array.isArray(detail.sources)) {
    throw fail('detail relations, assets, and sources must be arrays', 'InvalidPublicDataError');
  }
  const relationKeys = new Set();
  for (const relation of detail.relations) {
    requireObject(relation, 'detail relation');
    if (!relationRouteMatches(relation) || (relation.name_zh_tw !== null && typeof relation.name_zh_tw !== 'string')) {
      throw fail('detail relation has an invalid kind, ID, name, or route', 'InvalidPublicDataError');
    }
    const target = catalog?.entries.find(row => row.kind === relation.kind && row.id === relation.id);
    if (catalog && (!target || target.route !== relation.route || target.name_zh_tw !== relation.name_zh_tw)) {
      throw fail('detail relation does not match the catalog', 'InvalidPublicDataError');
    }
    const key = `${relation.kind}:${relation.id}`;
    if (relationKeys.has(key)) throw fail('detail contains duplicate relations', 'InvalidPublicDataError');
    relationKeys.add(key);
  }
  const assetIds = new Set();
  for (const asset of detail.assets) {
    requireObject(asset, 'detail asset');
    if (typeof asset.asset_id !== 'string' || !asset.asset_id || assetIds.has(asset.asset_id)) throw fail('detail asset ID is invalid or duplicated', 'InvalidPublicDataError');
    if (asset.path === null) {
      if (!isGithubAttachmentUrl(asset.source_url)) throw fail('remote asset URL is not an exact GitHub attachment URL', 'InvalidPublicDataError');
      requireGamesLanternAttribution(asset.attribution);
    } else {
      if (looksLikeGithubAttachment(asset.source_url)) throw fail('GitHub attachment assets must use a null local path', 'InvalidPublicDataError');
      requireRelativePath(asset.path, 'detail asset path', { leadingSlash: true });
      if (asset.source_url !== null && asset.source_url !== undefined) {
        let sourceUrl;
        try { sourceUrl = new URL(asset.source_url); } catch { throw fail('asset source URL is invalid', 'InvalidPublicDataError'); }
        if (sourceUrl.protocol !== 'https:') throw fail('asset source URL must use HTTPS', 'InvalidPublicDataError');
      }
      if (asset.attribution !== null && asset.attribution !== undefined) {
        requireObject(asset.attribution, 'asset attribution');
        let attributionUrl;
        try { attributionUrl = new URL(asset.attribution.href); } catch { throw fail('asset attribution URL is invalid', 'InvalidPublicDataError'); }
        if (attributionUrl.protocol !== 'https:' || typeof asset.attribution.text !== 'string' || !asset.attribution.text.trim()) {
          throw fail('asset attribution must include HTTPS link and visible text', 'InvalidPublicDataError');
        }
      }
    }
    assetIds.add(asset.asset_id);
  }
  if (entry.asset_ids.some(id => !assetIds.has(id)) || assetIds.size !== entry.asset_ids.length) {
    throw fail('detail assets do not match catalog asset_ids', 'InvalidPublicDataError');
  }
  for (const source of detail.sources) {
    requireObject(source, 'detail source');
    if (typeof source.source_id !== 'string' || typeof source.label !== 'string' || !source.label.trim()) {
      throw fail('detail source is missing an ID or label', 'InvalidPublicDataError');
    }
    let sourceUrl;
    try { sourceUrl = new URL(source.url); } catch { throw fail('detail source URL is invalid', 'InvalidPublicDataError'); }
    if (sourceUrl.protocol !== 'https:') throw fail('detail source URL must use HTTPS', 'InvalidPublicDataError');
  }
  return detail;
}

export function validateTalentTree(tree, metadata, catalog) {
  requireObject(tree, 'talent tree');
  requireObject(catalog, 'catalog');
  validateTalentTreeMetadata(metadata);
  if (!Array.isArray(catalog.talent_trees) ||
      !catalog.talent_trees.some(candidate => sameTalentTreeMetadata(candidate, metadata))) {
    throw fail('talent tree metadata is not declared by the catalog', 'InvalidPublicDataError');
  }
  if (tree.schema_version !== 2 || tree.archetype !== metadata.archetype || tree.version !== metadata.version) {
    throw fail('talent tree schema, archetype, or version does not match its metadata', 'InvalidPublicDataError');
  }
  if (!Array.isArray(tree.nodes) || tree.nodes.length !== metadata.node_count) {
    throw fail('talent tree node count does not match its metadata', 'InvalidPublicDataError');
  }
  if (!Array.isArray(tree.source_ids) || !Array.isArray(tree.sources) || !Array.isArray(tree.details)) {
    throw fail('talent tree source IDs, sources, and details must be arrays', 'InvalidPublicDataError');
  }

  const nodeIds = new Set();
  const children = [];
  const expectedSkills = new Set();
  for (const node of tree.nodes) {
    requireObject(node, 'talent tree node');
    if (typeof node.node_id !== 'string' || !TALENT_NODE_ID.test(node.node_id) || nodeIds.has(node.node_id)) {
      throw fail('talent tree node ID is invalid or duplicated', 'InvalidPublicDataError');
    }
    if (typeof node.type !== 'string' || !TALENT_NODE_TYPES.has(node.type)) {
      throw fail('talent tree node type is unsupported', 'InvalidPublicDataError');
    }
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      throw fail('talent tree node coordinates must be finite numbers', 'InvalidPublicDataError');
    }
    if (!Object.hasOwn(node, 'skill_id') || (node.skill_id !== null &&
        (typeof node.skill_id !== 'string' || !TALENT_NODE_ID.test(node.skill_id)))) {
      throw fail('talent tree node skill_id is invalid', 'InvalidPublicDataError');
    }
    if (node.skill_id !== null) {
      const skillIdentity = `${metadata.archetype}/${node.skill_id}`;
      const skillEntry = catalog.entries.find(entry => entry.kind === 'skill' && entry.id === skillIdentity);
      if (!skillEntry) throw fail('talent tree node references a skill outside its archetype', 'InvalidPublicDataError');
      expectedSkills.add(skillIdentity);
    }
    if (!Array.isArray(node.children)) throw fail('talent tree node children must be an array', 'InvalidPublicDataError');
    const childIds = new Set();
    for (const childId of node.children) {
      if (typeof childId !== 'string' || !TALENT_NODE_ID.test(childId) || childIds.has(childId)) {
        throw fail('talent tree child node ID is invalid or duplicated', 'InvalidPublicDataError');
      }
      childIds.add(childId);
      children.push(childId);
    }
    nodeIds.add(node.node_id);
  }
  if (children.some(childId => !nodeIds.has(childId))) {
    throw fail('talent tree contains a child reference to a missing node', 'InvalidPublicDataError');
  }

  const sourceIds = new Set();
  for (const sourceId of tree.source_ids) {
    if (typeof sourceId !== 'string' || !SOURCE_ID.test(sourceId) || sourceIds.has(sourceId)) {
      throw fail('talent tree source_ids contains an invalid or duplicate ID', 'InvalidPublicDataError');
    }
    sourceIds.add(sourceId);
  }
  const sourceRows = new Set();
  for (const source of tree.sources) {
    requireObject(source, 'talent tree source');
    if (typeof source.source_id !== 'string' || !SOURCE_ID.test(source.source_id) ||
        typeof source.label !== 'string' || !source.label.trim() || sourceRows.has(source.source_id)) {
      throw fail('talent tree source is missing a unique ID or label', 'InvalidPublicDataError');
    }
    let sourceUrl;
    try { sourceUrl = new URL(source.url); }
    catch { throw fail('talent tree source URL is invalid', 'InvalidPublicDataError'); }
    if (sourceUrl.protocol !== 'https:' || !sourceUrl.hostname) {
      throw fail('talent tree source URL must use HTTPS', 'InvalidPublicDataError');
    }
    sourceRows.add(source.source_id);
  }
  if (sourceRows.size !== sourceIds.size || [...sourceRows].some(sourceId => !sourceIds.has(sourceId))) {
    throw fail('talent tree source_ids do not match source records', 'InvalidPublicDataError');
  }

  const skillDetails = new Set();
  for (const detail of tree.details) {
    requireObject(detail, 'talent tree skill detail');
    requireObject(detail.record, 'talent tree skill detail record');
    if (detail.kind !== 'skill' || detail.record.archetype !== metadata.archetype ||
        typeof detail.record.skill_id !== 'string' || !TALENT_NODE_ID.test(detail.record.skill_id)) {
      throw fail('talent tree detail must be a skill from the same archetype', 'InvalidPublicDataError');
    }
    const skillIdentity = `${metadata.archetype}/${detail.record.skill_id}`;
    const skillEntry = catalog.entries.find(entry => entry.kind === 'skill' && entry.id === skillIdentity);
    if (!skillEntry || !expectedSkills.has(skillIdentity) || skillDetails.has(skillIdentity)) {
      throw fail('talent tree details contain an extra or duplicate skill', 'InvalidPublicDataError');
    }
    validateDetail(detail, skillEntry, catalog);
    skillDetails.add(skillIdentity);
  }
  if (skillDetails.size !== expectedSkills.size || [...expectedSkills].some(skillId => !skillDetails.has(skillId))) {
    throw fail('talent tree details do not exactly match its linked skills', 'InvalidPublicDataError');
  }
  return tree;
}
export function resolveCatalogRoute(pathname, catalog) {
  const direct = catalog.entries.find(entry => entry.route === pathname);
  if (direct) return { type: 'entry', entry: direct };
  const redirect = catalog.redirects.find(row => row.source_route === pathname);
  if (redirect) return { type: 'redirect', target_route: redirect.target_route };
  if (pathname === '/') return { type: 'home' };
  if (pathname === '/skills/') return { type: 'list', kind: 'skills' };
  if (pathname === '/weapons/') return { type: 'list', kind: 'weapons' };
  if (pathname === '/blessings/') return { type: 'list', kind: 'blessings' };
  const archetype = /^\/skills\/([a-z0-9_-]+)\/$/.exec(pathname)?.[1];
  if (archetype && catalog.entries.some(entry => entry.kind === 'skill' && entry.id.startsWith(`${archetype}/`))) {
    return { type: 'list', kind: 'skills', archetype };
  }
  return { type: 'not-found' };
}

export function makeRedirectUrl(currentUrl, targetRoute) {
  requireCanonicalPath(targetRoute, 'redirect target route');
  const url = new URL(currentUrl instanceof URL ? currentUrl.href : currentUrl, 'https://local.invalid');
  url.pathname = targetRoute;
  return url;
}

export function readListState(input) {
  const url = input instanceof URL ? input : new URL(input, 'https://local.invalid');
  const parsedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
  return {
    q: (url.searchParams.get('q') ?? '').trim(),
    filter: (url.searchParams.get('filter') ?? '').trim(),
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  };
}

export function writeListState(input, patch) {
  const url = new URL(input instanceof URL ? input.href : input, 'https://local.invalid');
  const previous = readListState(url);
  const next = { ...previous, ...patch };
  const query = String(next.q ?? '').trim();
  const filter = String(next.filter ?? '').trim();
  const page = Number.isSafeInteger(Number(next.page)) && Number(next.page) > 0 ? Number(next.page) : 1;
  if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
  if (filter) url.searchParams.set('filter', filter); else url.searchParams.delete('filter');
  url.searchParams.set('page', String(page));
  return url;
}

export function displayName(name, id) {
  if (typeof name === 'string' && name.trim()) return name;
  return `名稱待確認（${String(id ?? '未知 ID')}）`;
}

const categoryLabels = new Map([
  ['melee', '近戰武器'], ['ranged', '遠程武器'], ['mixed', '近戰與遠程武器']
]);

export function displayCategory(value) {
  return categoryLabels.get(value) ?? value;
}

export function mechanicsItems(value) {
  if (typeof value !== 'string') return [];
  const lineFeed = String.fromCharCode(10);
  const carriageReturn = String.fromCharCode(13);
  const normalized = value
    .replaceAll(carriageReturn + lineFeed, lineFeed)
    .replaceAll(carriageReturn, lineFeed);
  const items = [];
  for (const line of normalized.split(lineFeed)) {
    let start = 0;
    let period = line.search(/[。；]/);
    while (period !== -1) {
      const item = line.slice(start, period + 1).trim();
      if (item) items.push(item);
      start = period + 1;
      const next = line.slice(start).search(/[。；]/);
      period = next === -1 ? -1 : start + next;
    }
    const remainder = line.slice(start).trim();
    if (remainder) items.push(remainder);
  }
  return items;
}
export function assetAltText(entry, record) {
  return displayName(entry?.name_zh_tw ?? record?.name_zh_tw, entry?.id);
}

function fold(value) { return String(value ?? '').toLocaleLowerCase('zh-TW'); }

export function filterEntries(entries, state = {}) {
  const query = fold(state.q).trim();
  const category = String(state.filter ?? '').trim();
  return entries.filter(entry => {
    if (category && entry.category !== category) return false;
    if (!query) return true;
    return [entry.name_zh_tw, entry.id, entry.category, entry.kind].some(value => fold(value).includes(query));
  });
}

export function pageEntries(entries, page = 1, pageSize = 24) {
  const safeSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 24;
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  return entries.slice((safePage - 1) * safeSize, safePage * safeSize);
}

export function revisionAssetUrl(dataRevision, assetPath) {
  if (!DATA_REVISION.test(dataRevision ?? '')) throw fail('asset data revision is invalid', 'InvalidPublicDataError');
  const safePath = requireRelativePath(assetPath, 'asset path', { leadingSlash: true });
  return `/data/${dataRevision}/${safePath.split('/').map(encodeURIComponent).join('/')}`;
}

function isGamesLanternStorageImageUrl(value) {
  return typeof value === 'string' &&
    /^https:\/\/(?:gameslantern\.com|darktide\.gameslantern\.com)\/storage\/sites\/darktide\/[a-zA-Z0-9_./-]+\.(?:webp|png|jpe?g)$/.test(value) &&
    !value.split('/').some(segment => segment === '.' || segment === '..');
}

export function assetPresentation(dataRevision, entry, record, asset) {
  const creditUrl = asset.attribution?.href ?? asset.source_url;
  const credit = typeof creditUrl === 'string' && creditUrl.startsWith('https://')
    ? { href: creditUrl, label: asset.attribution?.text ?? '圖片來源' }
    : null;
  return {
    src: asset.path === null && isGithubAttachmentUrl(asset.source_url)
      ? (isGamesLanternStorageImageUrl(asset.attribution?.href) ? asset.attribution.href : asset.source_url)
      : revisionAssetUrl(dataRevision, asset.path),
    alt: assetAltText(entry, record),
    credit
  };
}

function responseError(message, status = null) {
  const error = fail(message);
  error.status = status;
  error.code = status === 404 ? 'not_found' : 'request_failed';
  return error;
}

async function responseJson(response, label) {
  if (response.status === 404) throw responseError(`${label} was not found`, 404);
  if (!response.ok) throw responseError(`${label} request failed (${response.status})`, response.status);
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|\s*$)/i.test(contentType)) {
    throw fail(`${label} response has a non-JSON Content-Type`, 'InvalidPublicDataError');
  }
  try { return await response.json(); }
  catch (error) { throw fail(`${label} response is invalid JSON: ${error.message}`, 'InvalidPublicDataError'); }
}

function currentLocationPath(href) {
  try {
    const url = new URL(href ?? '/', 'https://local.invalid');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/'; }
}

function validateVersion(version) {
  requireObject(version, 'version response');
  if (version.schema_version !== 2 || !DATA_REVISION.test(version.data_revision ?? '') ||
      !DATA_REVISION.test(version.build_id ?? '') || typeof version.game_version !== 'string' ||
      !['published', 'fixture'].includes(version.package_kind)) {
    throw fail('version response has an unsupported schema or invalid identity', 'InvalidPublicDataError');
  }
  return version;
}

export function createDataClient({ build, fetchImpl = globalThis.fetch, getLocationHref = () => globalThis.location?.href ?? '/' }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (!build || !DATA_REVISION.test(build.data_revision ?? '')) throw fail('build context has an invalid data revision', 'InvalidPublicDataError');
  let loadedCatalog = null;
  const dataRoot = `/data/${build.data_revision}/`;

  async function getJson(url, force, label) {
    let response;
    try { response = await fetchImpl(url, force ? { cache: 'reload' } : undefined); }
    catch (error) { throw responseError(`${label} request failed: ${error.message}`); }
    return responseJson(response, label);
  }

  async function checkStaleRevision(originalError) {
    if (originalError.status !== 404) throw originalError;
    let version;
    try {
      const response = await fetchImpl('/version.json', { cache: 'no-store' });
      version = validateVersion(await responseJson(response, 'version.json'));
    } catch {
      throw originalError;
    }
    const mismatch = version.data_revision !== build.data_revision || version.build_id !== build.build_id ||
      version.game_version !== build.game_version || version.package_kind !== build.package_kind;
    if (mismatch) {
      const update = fail('The published data has changed. Reload this page to continue.', 'UpdateAvailableError');
      update.location = currentLocationPath(getLocationHref());
      update.version = version;
      throw update;
    }
    throw originalError;
  }

  const client = {
    async hasBuildUpdate() {
      try {
        const response = await fetchImpl('/version.json', { cache: 'no-store' });
        const version = validateVersion(await responseJson(response, 'version.json'));
        return version.build_id !== build.build_id || version.data_revision !== build.data_revision ||
          version.game_version !== build.game_version || version.package_kind !== build.package_kind;
      } catch { return null; }
    },
    async loadCatalog({ force = false } = {}) {
      try {
        const result = await getJson(`${dataRoot}catalog.json`, force, 'catalog.json');
        loadedCatalog = validateCatalog(result, build);
        return loadedCatalog;
      } catch (error) { return checkStaleRevision(error); }
    },
    async loadDetail(entry, { force = false } = {}) {
      requireObject(entry, 'catalog entry');
      const relative = requireRelativePath(entry.detail_path, 'catalog detail path', { extension: '.json' });
      if (!relative.startsWith('details/')) throw fail('catalog detail path must be under details/', 'InvalidPublicDataError');
      try {
        const result = await getJson(`${dataRoot}${relative.split('/').map(encodeURIComponent).join('/')}`, force, entry.detail_path);
        return validateDetail(result, entry, loadedCatalog);
      } catch (error) { return checkStaleRevision(error); }
    },
    async loadBlessingLevels(detail, { force = false } = {}) {
      if (!loadedCatalog) throw fail('catalog must be loaded before blessing levels', 'InvalidPublicDataError');
      requireObject(detail, 'blessing detail');
      requireObject(detail.record, 'blessing record');
      if (detail.kind !== 'blessing' || typeof detail.record.blessing_id !== 'string') {
        throw fail('blessing levels require a blessing detail', 'InvalidPublicDataError');
      }
      const blessingId = detail.record.blessing_id;
      const blessingEntry = loadedCatalog.entries.find(entry => entry.kind === 'blessing' && entry.id === blessingId);
      if (!blessingEntry) throw fail('blessing detail has no exact catalog owner', 'InvalidPublicDataError');
      validateDetail(detail, blessingEntry, loadedCatalog);
      if (!Array.isArray(detail.record.variant_ids)) {
        throw fail('blessing variant_ids must be an array', 'InvalidPublicDataError');
      }
      const variantIds = new Set();
      const variantEntries = detail.record.variant_ids.map(variantId => {
        if (typeof variantId !== 'string' || !TALENT_NODE_ID.test(variantId) || variantIds.has(variantId)) {
          throw fail('blessing variant_ids contains an invalid or duplicate ID', 'InvalidPublicDataError');
        }
        variantIds.add(variantId);
        const entry = loadedCatalog.entries.find(candidate => candidate.kind === 'variant' && candidate.id === variantId);
        if (!entry) throw fail(`blessing variant ${variantId} is not in the catalog`, 'InvalidPublicDataError');
        const expectedRoute = canonicalRoute('variant', variantId, { blessing_id: blessingId, variant_id: variantId });
        const relation = detail.relations.find(candidate => candidate.kind === 'variant' && candidate.id === variantId);
        if (entry.route !== expectedRoute || !relation || relation.route !== entry.route) {
          throw fail(`blessing variant ${variantId} has an invalid owner relation`, 'InvalidPublicDataError');
        }
        return entry;
      });
      return Promise.all(variantEntries.map(async entry => {
        const variantDetail = await client.loadDetail(entry, { force });
        if (variantDetail.kind !== 'variant' || variantDetail.record.variant_id !== entry.id ||
            variantDetail.record.blessing_id !== blessingId) {
          throw fail(`variant ${entry.id} does not belong to blessing ${blessingId}`, 'InvalidPublicDataError');
        }
        const ownerRelation = variantDetail.relations.find(relation => relation.kind === 'blessing' && relation.id === blessingId);
        if (!ownerRelation || ownerRelation.route !== blessingEntry.route) {
          throw fail(`variant ${entry.id} is missing its blessing owner relation`, 'InvalidPublicDataError');
        }
        return variantDetail;
      }));
    },
    async loadTree(metadata, { force = false } = {}) {
      if (!loadedCatalog) throw fail('catalog must be loaded before talent trees', 'InvalidPublicDataError');
      validateTalentTreeMetadata(metadata);
      const catalogMetadata = loadedCatalog.talent_trees?.find(candidate => candidate.archetype === metadata.archetype);
      if (!catalogMetadata || !sameTalentTreeMetadata(catalogMetadata, metadata)) {
        throw fail('talent tree metadata is not declared by the loaded catalog', 'InvalidPublicDataError');
      }
      const relative = requireRelativePath(metadata.tree_path, 'talent tree path', { extension: '.json' });
      if (!relative.startsWith('trees/')) throw fail('talent tree path must be under trees/', 'InvalidPublicDataError');
      try {
        const result = await getJson(`${dataRoot}${relative.split('/').map(encodeURIComponent).join('/')}`, force, metadata.tree_path);
        return validateTalentTree(result, metadata, loadedCatalog);
      } catch (error) { return checkStaleRevision(error); }
    }
  };
  return client;
}
export function createNavigationController({ load, render }) {
  let generation = 0;
  return {
    async navigate(route) {
      const current = ++generation;
      render({ type: 'loading', route });
      try {
        const value = await load(route, { isCurrent: () => current === generation });
        if (current === generation) render({ type: 'loaded', route, value });
      } catch (error) {
        if (current === generation) render({ type: 'error', route, error });
      }
      return current === generation;
    },
    invalidate() { generation += 1; }
  };
}


export function preferredSkillView(url, hasTree) {
  const explicit = url.searchParams.get('view');
  const listQuery = ['q','filter','page'].some(key=>url.searchParams.has(key));
  return hasTree && explicit !== 'list' && (explicit === 'tree' || !listQuery) ? 'tree' : 'list';
}

// Only an explicitly identified weapon title is presentation noise. Conditions and values remain part of identity.
export function groupBlessingEffects(levels, catalog) {
  const groups = new Map();
  for (const detail of levels) {
    const r = detail.record;
    const weapon = catalog.entries.find(e => e.kind === 'weapon' && e.id === r.weapon_id);
    let effect = r.effect_zh_tw?.trim() ?? null;
    const colon = effect?.search(/[:：]/) ?? -1;
    if (colon >= 0 && weapon?.name_zh_tw && (effect.slice(0, colon) === weapon.name_zh_tw ||
      (effect.slice(0, colon).startsWith(weapon.name_zh_tw + ' ') && /\bMk\s/.test(effect.slice(0, colon))))) {
      effect = effect.slice(colon + 1).trim();
    }
    const tiers = [...(r.tier_claims ?? [])].sort((a,b)=>a.tier-b.tier).map(t => ({
      tier: t.tier, claims: [...t.claims].map(x => ({id:x.claim_id,state:x.state,value:x.value,unit:x.unit,note:x.unit_note})).sort((a,b)=>a.id.localeCompare(b.id))
    }));
    const key = JSON.stringify([effect,r.defined_tiers,tiers]);
    if (!groups.has(key)) groups.set(key,{effect,record:r,levels:[]});
    groups.get(key).levels.push(detail);
  }
  return [...groups.values()];
}

export function blessingAvailabilityNote(records) {
  return records.some(record => !Array.isArray(record.available_tiers))
    ? '以下為來源定義的等級與數值；各等級在遊戲內是否可取得，尚未核實。'
    : null;
}

export function browsingRelations(kind, relations) {
  const target = kind === 'blessing' ? 'weapon' : kind === 'weapon' ? 'blessing' : null;
  if (!target) return relations;
  const seen = new Set();
  return relations.filter(row => {
    if (row.kind !== target || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}
