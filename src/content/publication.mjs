import { validGitSourcePath } from './source-path.mjs';
import { isDeepStrictEqual } from 'node:util';
import { parseJsonSource, readJsonSelector, parseTsvSource, readTsvSelector,
  parseMarkdownSource, readMarkdownSelector } from './source-selector.mjs';

const shaPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const idPattern = /^[a-z][a-z0-9._-]{0,127}$/;

function uniqueIndex(rows, field, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} must be an array`);
  const index = new Map();
  for (const row of rows) {
    const id = row?.[field];
    if (typeof id !== 'string' || !idPattern.test(id)) throw new Error(`${label} has invalid ${field}`);
    if (index.has(id)) throw new Error(`duplicate ${label}: ${id}`);
    index.set(id, row);
  }
  return index;
}

function routeIsValid(route) {
  return route === '/' || (typeof route === 'string' && /^\/[a-z0-9/_-]+\/$/.test(route) && !route.includes('//') && !route.includes('..'));
}

function pointerValue(record, path) {
  if (typeof path !== 'string' || !/^\/(?:[^/~]|~[01]|\/)+$/.test(path)) throw new Error(`invalid field path: ${path}`);
  let value = record;
  for (const segment of path.slice(1).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

function validDecision(decision, label, route, fieldPath = null) {
  if (decision?.status !== 'approved') throw new Error(`${label} approval is missing`);
  for (const field of ['evidence_ref', 'rights_holder', 'scope', 'reviewer', 'reviewed_on']) {
    if (typeof decision[field] !== 'string' || !decision[field].trim()) throw new Error(`${label} approval has no ${field}`);
  }
  if (decision.reason_code !== null) throw new Error(`${label} approval has a reason code`);
  if (!Array.isArray(decision.allowed_routes) || !decision.allowed_routes.includes(route)) {
    throw new Error(`${label} approval excludes route ${route}`);
  }
  if (fieldPath !== null && (!Array.isArray(decision.allowed_field_paths) || !decision.allowed_field_paths.includes(fieldPath))) {
    throw new Error(`${label} approval excludes field ${fieldPath}`);
  }
}

function validateLock(lock) {
  if (lock?.schema_version !== 1 || !idPattern.test(lock.source_id ?? '') || !shaPattern.test(lock.sha256 ?? '') ||
      !Array.isArray(lock.selectors) || lock.selectors.length === 0 ||
      lock.selectors.some(selector => typeof selector !== 'string' || !selector || selector.includes('**')) ||
      new Set(lock.selectors).size !== lock.selectors.length || !idPattern.test(lock.batch_id ?? '')) {
    throw new Error(`invalid source lock: ${lock?.source_id}`);
  }
  if (lock.build_association === 'unknown') {
    if (lock.steam_build_id !== null || lock.build_evidence_id !== null) throw new Error(`source lock has unverified build identity: ${lock.source_id}`);
  } else {
    // Verified build associations require the separate evidence join, which this
    // record-level gate does not yet receive. Fail closed until that join exists.
    throw new Error(`source lock build association needs evidence: ${lock.source_id}`);
  }
  if (lock.kind === 'git_file') {
    if (typeof lock.repository_url !== 'string' || !lock.repository_url.startsWith('https://') ||
        !commitPattern.test(lock.commit_sha ?? '') || typeof lock.path !== 'string' ||
        !validGitSourcePath(lock.path) || lock.source_url !== null) {
      throw new Error(`invalid git source lock: ${lock.source_id}`);
    }
  } else if (lock.kind === 'external_asset') {
    if (typeof lock.source_url !== 'string' || !lock.source_url.startsWith('https://') ||
        lock.repository_url !== null || lock.commit_sha !== null || lock.path !== null) {
      throw new Error(`invalid asset source lock: ${lock.source_id}`);
    }
  } else {
    throw new Error(`unknown source kind: ${lock.source_id}`);
  }
}

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('source bytes must be a byte array');
}

async function hashBytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function validateRecordPublication({
  route, record, requiredFieldPaths, sourceLocks, rightsLedger, sourceBytes,
  requiredSourceKindsByField = null, assets = [], requireGitApproval = false, includeAssets = true
}) {
  if (!routeIsValid(route)) throw new Error('invalid publication route');
  if (!record || typeof record !== 'object' || !Array.isArray(record.evidence) || !Array.isArray(record.asset_ids)) {
    throw new Error('record evidence and asset IDs are required');
  }
  if (!Array.isArray(requiredFieldPaths) || requiredFieldPaths.length === 0 ||
      new Set(requiredFieldPaths).size !== requiredFieldPaths.length) {
    throw new Error('required field paths are missing or duplicated');
  }
  const locks = uniqueIndex(sourceLocks, 'source_id', 'source locks');
  const rights = uniqueIndex(rightsLedger, 'rights_id', 'rights ledger');
  const assetIndex = uniqueIndex(assets, 'asset_id', 'assets');
  if (!(sourceBytes instanceof Map)) throw new Error('source bytes map is required');
  const checkedSources = new Map();
  const parsedJson = new Map();
  const parsedTsv = new Map();
  const parsedMarkdown = new Map();
  const usedRights = new Set();

  async function checkSource(sourceId) {
    const lock = locks.get(sourceId);
    if (!lock) throw new Error(`missing source lock: ${sourceId}`);
    if (!checkedSources.has(sourceId)) {
      validateLock(lock);
      if (!sourceBytes.has(sourceId)) throw new Error(`missing source bytes: ${sourceId}`);
      const stableBytes = new Uint8Array(bytesOf(sourceBytes.get(sourceId)));
      if (await hashBytes(stableBytes) !== lock.sha256) {
        throw new Error(`source hash drift: ${sourceId}`);
      }
      checkedSources.set(sourceId, stableBytes);
    }
    return lock;
  }

  const evidenceByPath = new Map();
  const sourceKindsByPath = new Map();
  const evidenceKeys = new Set();
  for (const evidence of record.evidence) {
    const { field_path: fieldPath, source_id: sourceId, source_selector: selector, rights_id: rightId } = evidence ?? {};
    const key = [fieldPath, sourceId, selector, rightId].join('|');
    if (evidenceKeys.has(key)) throw new Error(`duplicate field evidence: ${fieldPath}`);
    evidenceKeys.add(key);
    if (pointerValue(record, fieldPath) === undefined) throw new Error(`evidence references missing field: ${fieldPath}`);
    if (!requiredFieldPaths.includes(fieldPath)) continue;
    const lock = await checkSource(sourceId);
    if (!lock.selectors.includes(selector)) throw new Error(`source selector is not locked: ${selector}`);
    if (lock.kind !== 'git_file') throw new Error(`unsupported field source kind: ${lock.kind}`);
    let sourceKind;
    if (lock.kind === 'git_file') {
      if (lock.path.toLowerCase().endsWith('.json')) {
        sourceKind = 'git_json';
        if (!parsedJson.has(sourceId)) parsedJson.set(sourceId, parseJsonSource(checkedSources.get(sourceId), sourceId));
        const selected = readJsonSelector(parsedJson.get(sourceId), selector);
        if (!isDeepStrictEqual(selected, pointerValue(record, fieldPath))) {
          throw new Error(`source value differs for ${fieldPath}`);
        }
      } else if (lock.path.toLowerCase().endsWith('.md')) {
        sourceKind = 'git_markdown';
        if (!selector.startsWith('md:')) throw new Error(`unsupported Markdown selector: ${selector}`);
        if (!parsedMarkdown.has(sourceId)) parsedMarkdown.set(sourceId, parseMarkdownSource(checkedSources.get(sourceId), sourceId));
        const selected = readMarkdownSelector(parsedMarkdown.get(sourceId), selector);
        if (selected !== pointerValue(record, fieldPath)) throw new Error(`source value differs for ${fieldPath}`);
      } else if (lock.path.toLowerCase().endsWith('.tsv')) {
        sourceKind = 'git_tsv';
        if (!parsedTsv.has(sourceId)) parsedTsv.set(sourceId, parseTsvSource(checkedSources.get(sourceId), sourceId));
        const selected = readTsvSelector(parsedTsv.get(sourceId), selector, lock.path);
        if (selected !== pointerValue(record, fieldPath)) throw new Error(`source value differs for ${fieldPath}`);
      } else {
        throw new Error(`unsupported Git source selector: ${selector}`);
      }
    }
    const right = rights.get(rightId);
    if (!right || right.schema_version !== 1 || right.subject?.kind !== 'source_field' ||
        right.subject.source_id !== sourceId || right.subject.selector !== selector || right.subject.asset_id !== null) {
      throw new Error(`rights selector mismatch for ${fieldPath}`);
    }
    validDecision(right.local, 'local', route, fieldPath);
    if (requireGitApproval) validDecision(right.git, 'git', route, fieldPath);
    validDecision(right.publish, 'publish', route, fieldPath);
    usedRights.add(rightId);
    if (!evidenceByPath.has(fieldPath)) evidenceByPath.set(fieldPath, []);
    evidenceByPath.get(fieldPath).push(evidence);
    if (!sourceKindsByPath.has(fieldPath)) sourceKindsByPath.set(fieldPath, new Set());
    sourceKindsByPath.get(fieldPath).add(sourceKind);
  }
  for (const path of requiredFieldPaths) {
    const value = pointerValue(record, path);
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      throw new Error(`required field is empty: ${path}`);
    }
    if (!evidenceByPath.has(path)) throw new Error(`evidence missing for ${path}`);
    if (requiredSourceKindsByField?.[path]?.some(kind => !sourceKindsByPath.get(path).has(kind))) {
      throw new Error(`source kind requirement is unmet for ${path}`);
    }
  }

  if (new Set(record.asset_ids).size !== record.asset_ids.length) throw new Error('duplicate asset use');
  for (const assetId of includeAssets ? record.asset_ids : []) {
    const asset = assetIndex.get(assetId);
    if (!asset) throw new Error(`missing asset: ${assetId}`);
    if (asset.schema_version !== 1 || typeof asset.delivery_path !== 'string' ||
        !/^assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:svg|png|webp)$/.test(asset.delivery_path)) {
      throw new Error(`invalid asset delivery path: ${assetId}`);
    }
    const lock = await checkSource(asset.source_id);
    if (lock.kind !== 'external_asset' || asset.source_url !== lock.source_url || asset.source_sha256 !== lock.sha256) {
      throw new Error(`asset source mismatch: ${assetId}`);
    }
    if (asset.rehost_allowed !== true || !Array.isArray(asset.routes) || !asset.routes.includes(route)) {
      throw new Error(`asset route or rehosting not approved: ${assetId}`);
    }
    const right = rights.get(asset.rights_id);
    if (!right || right.schema_version !== 1 || right.subject?.kind !== 'asset' ||
        right.subject.asset_id !== assetId || right.subject.source_id !== asset.source_id) {
      throw new Error(`asset right is missing or mismatched: ${assetId}`);
    }
    validDecision(right.local, 'local asset', route);
    if (requireGitApproval) validDecision(right.git, 'git asset', route);
    validDecision(right.publish, 'publish asset', route);
    usedRights.add(asset.rights_id);
    if (asset.source_url.startsWith('https://darktide.gameslantern.com/')) {
      if (asset.attribution?.href !== 'https://darktide.gameslantern.com/' ||
          asset.attribution.follow_required !== true || !asset.attribution.text?.includes('darktide.gameslantern.com')) {
        throw new Error(`Games Lantern attribution is missing: ${assetId}`);
      }
    }
  }
  return { source_lock_ids: [...checkedSources.keys()].sort(), rights_ids: [...usedRights].sort() };
}
