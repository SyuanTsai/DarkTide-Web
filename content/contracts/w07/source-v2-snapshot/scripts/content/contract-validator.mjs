import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CONTRACT_VERSION = '2.0.0';
export const CONTRACT_SCHEMA_ID = 'https://github.com/SyuanTsai/DarkTide-Source-Data/content/schema/v2/source-contract.schema.json';
export const CONTRACT_RECORD_KINDS = Object.freeze([
  'skill', 'blessing', 'blessing-variant', 'weapon', 'attack-profile', 'stat-definition', 'stat-curve',
  'damage-profile', 'armor-class', 'target-profile', 'modifier-rule', 'claim', 'evidence', 'term', 'catalog',
  'curio', 'perk', 'classification', 'game-change', 'release-compatibility'
]);
export const CONTRACT_UNITS = Object.freeze([
  'ratio', 'percent', 's', 'm', 'damage', 'impact', 'point', 'rating',
  'attack-power-point', 'stamina-point', 'stamina-point-per-second', 'dodge-count', 'instance-count',
  'normalized-speed-per-second', 'item-stat-rating', 'expertise-level', 'expertise-level-per-rank'
]);
export const CONTRACT_UNKNOWN_REASONS = Object.freeze([
  'NOT_VERIFIED', 'SOURCE_UNAVAILABLE', 'CONFLICTING_EVIDENCE', 'NOT_EXPOSED_BY_SOURCE', 'CALLER_DOMAIN_NOT_PROVEN'
]);

const KIND_PAYLOADS = Object.freeze({
  skill: 'skillPayload', blessing: 'blessingPayload', 'blessing-variant': 'blessingVariantPayload',
  weapon: 'weaponPayload', 'attack-profile': 'attackProfilePayload', 'stat-definition': 'statDefinitionPayload',
  'stat-curve': 'statCurvePayload', 'damage-profile': 'damageProfilePayload', 'armor-class': 'armorClassPayload',
  'target-profile': 'targetProfilePayload', 'modifier-rule': 'modifierRulePayload', claim: 'claimPayload',
  evidence: 'evidencePayload', term: 'termPayload', catalog: 'catalogPayload', curio: 'curioPayload',
  perk: 'perkPayload', classification: 'classificationPayload', 'game-change': 'gameChangePayload',
  'release-compatibility': 'releaseCompatibilityPayload'
});
const REVIEW_DIMENSIONS = Object.freeze(['technical', 'evidence', 'context', 'identity', 'compatibility']);
const BACKLINK_FIELDS = new Set(['claimRefs', 'targetRef', 'blessingRef', 'weaponRefs', 'weaponRef']);
const DIGEST_BACKLINK_FIELDS = new Set(['claimRefs']);
const IDENTITY_REFERENCE_FIELDS = new Set(['targetRef', 'blessingRef', 'weaponRef', 'weaponRefs', 'entityRef', 'predecessorRef', 'parentRef', 'classificationRef']);
const IDENTITY_PAYLOAD_FIELDS = Object.freeze({
  skill: ['nameKey', 'applicability'],
  blessing: ['nameKey'],
  'blessing-variant': ['blessingRef', 'weaponRefs', 'definedTiers', 'obtainableTiers'],
  weapon: ['familyId', 'markId', 'templateKey'],
  'attack-profile': ['familyId', 'markId', 'itemKey', 'templateKey', 'action', 'mode', 'charge', 'contexts'],
  'stat-definition': ['quantity', 'inputUnit', 'outputUnit'],
  'stat-curve': ['inputUnit', 'outputUnit', 'interpolation', 'edgePolicy'],
  'damage-profile': ['profileKey'],
  'armor-class': ['classKey', 'classificationRef'],
  'target-profile': ['profileKey'],
  'modifier-rule': ['ruleKey', 'triggerText', 'operation', 'stackingGroup', 'exclusions'],
  claim: ['property', 'targetRef', 'context', 'basis'],
  evidence: ['evidenceKind', 'sourceRef', 'safeSummary'],
  term: ['termKey', 'contextKey'],
  catalog: ['catalogKey'],
  curio: ['nameKey'],
  perk: ['nameKey'],
  classification: ['taxonomy', 'code', 'labelEn', 'parentRef'],
  'game-change': ['comparison', 'entityRef', 'operation'],
  'release-compatibility': ['fromGameReleaseId', 'toGameReleaseId']
});
const REF_EXPECTED_KINDS = Object.freeze({
  claimRefs: new Set(['claim']), evidenceRefs: new Set(['evidence']), termRefs: new Set(['term']),
  statRefs: new Set(['stat-definition']), attackProfileRefs: new Set(['attack-profile']),
  damageProfileRefs: new Set(['damage-profile']), targetProfileRefs: new Set(['target-profile']),
  armorRef: new Set(['armor-class']), classificationRef: new Set(['classification']),
  curveRef: new Set(['stat-curve']), ruleRef: new Set(['modifier-rule']), weaponRefs: new Set(['weapon']),
  blessingRef: new Set(['blessing']), variantRefs: new Set(['blessing-variant']), perkRefs: new Set(['perk']),
  predecessorRef: new Set(['weapon']), supersedesChangeRef: new Set(['game-change']), parentRef: new Set(['classification']),
  weaponRef: new Set(['weapon']), attackProfileRef: new Set(['attack-profile']), targetProfileRef: new Set(['target-profile']),
  damageProfileRef: new Set(['damage-profile']), profileRef: new Set(['damage-profile']), parentProfileRef: new Set(['damage-profile']),
  armorClassRef: new Set(['armor-class']), armorClassRefs: new Set(['armor-class']),
  baseArmorClassRef: new Set(['armor-class']), toughnessArmorClassRef: new Set(['armor-class']),
  armorRuleRefs: new Set(['modifier-rule']), weakspotRuleRefs: new Set(['modifier-rule']),
  critFinesseRuleRefs: new Set(['modifier-rule']), variantRef: new Set(['blessing-variant']), talentRefs: new Set(['skill']),
  blessingVariantRefs: new Set(['blessing-variant']), modifierRuleRefs: new Set(['modifier-rule']), statRef: new Set(['stat-definition'])
});
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA_RELATIVE = path.join('content', 'schema', 'v2', 'source-contract.schema.json');
const FIXTURE_RELATIVE = path.join('content', 'fixtures', 'v2', 'representative-source.json');

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : canonical(value), 'utf8').digest('hex');
const compareLexical = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const pointerEscape = (value) => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const toPointer = (parts) => `/${parts.map(pointerEscape).join('/')}`;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const jsonEqual = (left, right) => canonical(left) === canonical(right);

export async function loadContractSchema({ sourceRoot = REPO_ROOT } = {}) {
  return JSON.parse(await readFile(path.join(sourceRoot, SCHEMA_RELATIVE), 'utf8'));
}

export async function loadRepresentativeFixture({ sourceRoot = REPO_ROOT } = {}) {
  return JSON.parse(await readFile(path.join(sourceRoot, FIXTURE_RELATIVE), 'utf8'));
}

function pointerGet(object, pointer) {
  if (pointer === '') return { exists: true, value: object };
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return { exists: false };
  const parts = pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let value = object;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !hasOwn(value, part)) return { exists: false };
    value = value[part];
  }
  return { exists: true, value };
}

function resolvePointer(root, ref) {
  if (!ref.startsWith('#/')) return undefined;
  return ref.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, key) => value?.[key], root);
}

function schemaMatches(value, fragment, root) {
  const issues = [];
  validateSchemaValue(value, fragment, root, '', issues, new Set());
  return issues.length === 0;
}

function validateSchemaValue(value, schema, root, pointer, issues, refStack) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.$ref) {
    const target = resolvePointer(root, schema.$ref);
    if (!target) issues.push({ path: pointer || '/', code: 'schema-ref', message: `Unresolved schema reference ${schema.$ref}` });
    else if (!refStack.has(schema.$ref)) {
      const next = new Set(refStack); next.add(schema.$ref);
      validateSchemaValue(value, target, root, pointer, issues, next);
    }
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const valid = types.some((type) => type === 'null' ? value === null
      : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : type === 'array' ? Array.isArray(value)
          : type === 'integer' ? Number.isInteger(value)
            : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
              : typeof value === type);
    if (!valid) { issues.push({ path: pointer || '/', code: 'schema-type', message: `Expected ${types.join('|')}` }); return; }
  }
  if (hasOwn(schema, 'const') && !jsonEqual(value, schema.const)) issues.push({ path: pointer || '/', code: 'schema-const', message: 'Value does not match const' });
  if (schema.enum && !schema.enum.some((item) => jsonEqual(value, item))) issues.push({ path: pointer || '/', code: 'schema-enum', message: 'Value is not in the allowed enum' });
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((branch) => schemaMatches(value, branch, root)).length;
    if (matches !== 1) issues.push({ path: pointer || '/', code: 'schema-oneOf', message: `Expected exactly one matching alternative; found ${matches}` });
  }
  for (const branch of schema.allOf ?? []) validateSchemaValue(value, branch, root, pointer, issues, refStack);
  if (schema.if) {
    const condition = schemaMatches(value, schema.if, root);
    if (condition && schema.then) validateSchemaValue(value, schema.then, root, pointer, issues, refStack);
    if (!condition && schema.else) validateSchemaValue(value, schema.else, root, pointer, issues, refStack);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) issues.push({ path: pointer || '/', code: 'schema-minLength', message: `String is shorter than ${schema.minLength}` });
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) issues.push({ path: pointer || '/', code: 'schema-maxLength', message: `String exceeds ${schema.maxLength} characters` });
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) issues.push({ path: pointer || '/', code: 'schema-pattern', message: 'String does not match its required pattern' });
    if (schema.format === 'date-time' && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(value) || Number.isNaN(Date.parse(value)))) {
      issues.push({ path: pointer || '/', code: 'schema-format', message: 'Expected ISO date-time with timezone' });
    }
    if (schema.format === 'uri' && !isHttpsUri(value)) issues.push({ path: pointer || '/', code: 'schema-format', message: 'Expected a safe HTTPS URI' });
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push({ path: pointer || '/', code: 'schema-minimum', message: `Value is below ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) issues.push({ path: pointer || '/', code: 'schema-maximum', message: `Value is above ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push({ path: pointer || '/', code: 'schema-minItems', message: `Array requires at least ${schema.minItems} entries` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push({ path: pointer || '/', code: 'schema-maxItems', message: `Array allows at most ${schema.maxItems} entries` });
    if (schema.uniqueItems) {
      const values = value.map(canonical);
      if (new Set(values).size !== values.length) issues.push({ path: pointer || '/', code: 'schema-uniqueItems', message: 'Array entries must be unique' });
    }
    if (schema.items) value.forEach((item, index) => validateSchemaValue(item, schema.items, root, `${pointer}/${index}`, issues, refStack));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!hasOwn(value, key)) issues.push({ path: pointer || '/', code: 'schema-required', message: `Missing required property ${key}` });
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (hasOwn(value, key)) validateSchemaValue(value[key], childSchema, root, `${pointer}/${pointerEscape(key)}`, issues, refStack);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push({ path: `${pointer}/${pointerEscape(key)}`, code: 'schema-additionalProperties', message: 'Property is not allowed here' });
    }
  }
}

function isHttpsUri(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

export function assertSchemaValidatorParity(schema) {
  const errors = [];
  if (schema.$id !== CONTRACT_SCHEMA_ID) errors.push('schema $id differs from the validator interface');
  if (schema.properties?.schemaVersion?.const !== CONTRACT_VERSION) errors.push('schema version differs from the validator interface');
  const record = schema.$defs?.record;
  const schemaKinds = record?.properties?.kind?.enum ?? [];
  if (!jsonEqual(schemaKinds, CONTRACT_RECORD_KINDS)) errors.push('record kind enum differs from semantic validator kinds');
  const schemaUnits = schema.$defs?.unit?.enum ?? [];
  if (!jsonEqual(schemaUnits, CONTRACT_UNITS)) errors.push('unit enum differs from semantic validator units');
  const unknownReasons = schema.$defs?.unknownValue?.properties?.reasonCode?.enum ?? [];
  if (!jsonEqual(unknownReasons, CONTRACT_UNKNOWN_REASONS)) errors.push('unknown reason enum differs from semantic validator reasons');
  const schemaBranches = new Map((record?.allOf ?? []).map((branch) => [
    branch.if?.properties?.kind?.const,
    branch.then?.properties?.payload?.$ref?.split('/').at(-1)
  ]));
  for (const [kind, payload] of Object.entries(KIND_PAYLOADS)) if (schemaBranches.get(kind) !== payload) errors.push(`schema payload branch for ${kind} differs from semantic validator`);
  if (Object.keys(KIND_PAYLOADS).length !== schemaBranches.size) errors.push('schema has missing or extra payload branches');
  const required = new Set(record?.required ?? []);
  for (const field of ['recordId', 'kind', 'owner', 'gameReleaseId', 'payload', 'sourceRefs', 'dataCoverage', 'reviewTargets', 'reviewState']) {
    if (!required.has(field)) errors.push(`record schema does not require ${field}`);
  }
  return errors;
}

function decimalParts(value) {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer, rawFraction = ''] = unsigned.split('.');
  const fraction = rawFraction.replace(/0+$/u, '');
  const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/u, '') || '0';
  return { negative: negative && digits !== '0', digits: BigInt(digits), scale: fraction.length };
}

function compareDecimal(left, right) {
  const a = decimalParts(left); const b = decimalParts(right);
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const scale = Math.max(a.scale, b.scale);
  const av = a.digits * (10n ** BigInt(scale - a.scale)) * (a.negative ? -1n : 1n);
  const bv = b.digits * (10n ** BigInt(scale - b.scale)) * (b.negative ? -1n : 1n);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function typedValueEqual(left, right) {
  if (!left || !right || left.status !== right.status) return false;
  if (left.status !== 'known') return jsonEqual(left, right);
  const leftKeys = Object.keys(left).sort(); const rightKeys = Object.keys(right).sort();
  if (!jsonEqual(leftKeys, rightKeys)) return false;
  const decimalKeys = new Set(['decimal', 'min', 'max', 'step']);
  return leftKeys.every((key) => decimalKeys.has(key)
    ? compareDecimal(left[key], right[key]) === 0
    : jsonEqual(left[key], right[key]));
}

function releaseKey(releaseId) { return releaseId; }
function recordKey(recordId, releaseId) { return `${releaseId}\u0000${recordId}`; }
function receiptKey(target) { return `${recordKey(target.recordId, target.gameReleaseId)}\u0000${target.fieldPath}\u0000${target.dimension}`; }

function walkObjects(value, visit, parentKey = '') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) walkObjects(item, visit, parentKey); return; }
  visit(value, parentKey);
  for (const [key, child] of Object.entries(value)) walkObjects(child, visit, key);
}

function getAllRecordRefs(record) {
  const edges = [];
  walkObjects(record.payload, (item, parentKey) => {
    if (typeof item.recordId === 'string' && typeof item.gameReleaseId === 'string') edges.push({ ref: item, field: parentKey });
  });
  return edges;
}

function getRecordRefEdges(record) { return getAllRecordRefs(record).filter(({ field }) => !BACKLINK_FIELDS.has(field)); }

function reviewProjection(value, { omitClaimRefs = false } = {}) {
  if (Array.isArray(value)) return value.map((child) => reviewProjection(child, { omitClaimRefs }));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !omitClaimRefs || !DIGEST_BACKLINK_FIELDS.has(key))
    .map(([key, child]) => [key, reviewProjection(child, { omitClaimRefs })]));
}

function identityPayloadProjection(item) {
  const payload = item.payload ?? {};
  const fields = IDENTITY_PAYLOAD_FIELDS[item.kind] ?? [];
  const projected = Object.fromEntries(fields.filter((field) => hasOwn(payload, field)).map((field) => [field, payload[field]]));
  if (item.kind === 'target-profile' && Array.isArray(payload.hitZones)) {
    projected.hitZones = payload.hitZones.map(({ zoneId, armorRef, weakspot, critEligible }) => ({ zoneId, armorRef, weakspot, critEligible }));
  }
  if (item.kind === 'damage-profile' && payload.rawSourceDefinition?.parentProfileRef) {
    projected.parentProfileRef = payload.rawSourceDefinition.parentProfileRef;
  }
  if (item.kind === 'damage-profile' && Array.isArray(payload.segments)) {
    projected.segments = payload.segments.map(({ segmentId, quantity, hitZone, conditions }) => ({ segmentId, quantity, hitZone, conditions }));
  }
  return reviewProjection(projected, { omitClaimRefs: true });
}

function releaseReviewProjection(release) {
  if (!release) return null;
  const projected = structuredClone(release);
  delete projected.snapshot.commit;
  return projected;
}

function normalizeVerifiedPublicCodePermalink(source) {
  if (source.sourceKind !== 'public-code'
    || typeof source.repository !== 'string'
    || typeof source.publicUrl !== 'string'
    || typeof source.path !== 'string'
    || !/^[a-f0-9]{40}$/iu.test(source.commit ?? '')
    || source.snapshot?.commit !== source.commit
    || source.path.startsWith('/')
    || source.path.includes('\\')
    || source.path.split('/').some((part) => part === '.' || part === '..')) return source.publicUrl;

  try {
    const repository = new URL(source.repository);
    const permalink = new URL(source.publicUrl);
    if (repository.protocol !== 'https:' || permalink.protocol !== 'https:'
      || repository.username || repository.password || permalink.username || permalink.password
      || repository.origin !== 'https://github.com'
      || repository.pathname.replace(/\/+$/u, '') !== '/Aussiemon/Darktide-Source-Code'
      || repository.origin !== permalink.origin || repository.search || repository.hash) return source.publicUrl;

    const repositoryPath = repository.pathname.replace(/\/+$/u, '');
    const prefix = `${repositoryPath}/blob/`;
    if (!permalink.pathname.startsWith(prefix)) return source.publicUrl;
    const commitStart = prefix.length;
    const commitEnd = permalink.pathname.indexOf('/', commitStart);
    if (commitEnd < 0 || permalink.pathname.slice(commitStart, commitEnd) !== source.commit) return source.publicUrl;
    const permalinkPath = decodeURIComponent(permalink.pathname.slice(commitEnd + 1));
    if (permalinkPath !== source.path) return source.publicUrl;

    const pathStart = source.publicUrl.indexOf(permalink.pathname, source.publicUrl.indexOf('://') + 3);
    if (pathStart < 0) return source.publicUrl;
    const normalizedPath = `${permalink.pathname.slice(0, commitStart)}<source-commit>${permalink.pathname.slice(commitEnd)}`;
    return `${source.publicUrl.slice(0, pathStart)}${normalizedPath}${source.publicUrl.slice(pathStart + permalink.pathname.length)}`;
  } catch {
    return source.publicUrl;
  }
}

function sourceReviewProjection(source) {
  const projected = structuredClone(source);
  delete projected.commit;
  delete projected.snapshot.commit;
  if (hasOwn(projected, 'publicUrl')) projected.publicUrl = normalizeVerifiedPublicCodePermalink(source);
  return projected;
}

function collectSourceLinks(record) {
  const links = [...(record.sourceRefs ?? [])];
  for (const missing of record.dataCoverage?.missing ?? []) if (missing.sourceRef) links.push(missing.sourceRef);
  walkObjects(record.payload, (item) => { if (typeof item.sourceId === 'string' && typeof item.gameReleaseId === 'string') links.push(item); });
  return links;
}

function expectedKindIssue(field, targetKind) {
  const allowed = REF_EXPECTED_KINDS[field];
  if (allowed && !allowed.has(targetKind)) return `Reference ${field} must point to ${[...allowed].join(' or ')}, not ${targetKind}`;
  if (field === 'targetRef' && ['claim', 'evidence', 'game-change', 'release-compatibility'].includes(targetKind)) return `Claim targetRef cannot point to ${targetKind}`;
  if (field === 'entityRef' && ['claim', 'evidence', 'game-change', 'release-compatibility'].includes(targetKind)) return `entityRef cannot point to ${targetKind}`;
  return null;
}

function getReviewNode(contract, target) {
  const record = contract.records.find((item) => item.recordId === target.recordId && item.gameReleaseId === target.gameReleaseId);
  if (record) return { item: record, listName: 'records' };
  const tombstone = contract.tombstones.find((item) => item.recordId === target.recordId && item.gameReleaseId === target.gameReleaseId);
  if (tombstone) return { item: tombstone, listName: 'tombstones' };
  return null;
}

function dependencyClosure(contract, rootItem, recordMap, sourceMap, releaseMap) {
  const visited = new Map();
  const rootKey = recordKey(rootItem.recordId, rootItem.gameReleaseId);
  const visitItem = (item, mode = 'full', isTombstone = false, followClaimRefs = mode === 'full') => {
    const key = recordKey(item.recordId, item.gameReleaseId);
    const modeRank = mode === 'full' ? 2 : 1;
    const expandsClaimRefs = mode === 'full' && (key === rootKey || followClaimRefs);
    const previous = visited.get(key);
    if (previous && previous.modeRank >= modeRank && (!expandsClaimRefs || previous.expandsClaimRefs)) return;
    const links = collectSourceLinks(item);
    const sourceRefs = links.map((link) => sourceMap.get(`${link.gameReleaseId}\u0000${link.sourceId}`)).filter(Boolean);
    const release = releaseMap.get(item.gameReleaseId);
    visited.set(key, {
      key: `${item.gameReleaseId}:${item.recordId}`,
      mode,
      modeRank,
      expandsClaimRefs,
      isRoot: key === rootKey,
      item,
      isTombstone,
      release,
      sourceRefs: sourceRefs.sort((a, b) => compareLexical(a.sourceId, b.sourceId))
    });
    for (const link of links) if (link.compatibilityRef) visit(recordMap.get(recordKey(link.compatibilityRef, item.gameReleaseId)), 'full');
    const recordRefs = mode === 'identity'
      ? getAllRecordRefs({ ...item, payload: identityPayloadProjection(item) })
      : getAllRecordRefs(item);
    if (!isTombstone) for (const { ref, field } of recordRefs) {
      const followsClaimDependency = expandsClaimRefs && DIGEST_BACKLINK_FIELDS.has(field);
      if (DIGEST_BACKLINK_FIELDS.has(field) && !followsClaimDependency) continue;
      const identityEdge = IDENTITY_REFERENCE_FIELDS.has(field);
      if (mode === 'identity' && identityEdge) {
        if (ref.compatibilityRef) visit(recordMap.get(recordKey(ref.compatibilityRef, item.gameReleaseId)), 'full');
        visit(recordMap.get(recordKey(ref.recordId, ref.gameReleaseId)), 'identity', false);
        continue;
      }
      const targetMode = identityEdge ? 'identity' : 'full';
      // A comparison stat contributes its own typed value definition, but its claimRefs are
      // sibling claims. Other full entity/applicability refs keep their forward claim closure.
      const followsTargetClaims = expandsClaimRefs && targetMode === 'full' && field !== 'statRef';
      visit(recordMap.get(recordKey(ref.recordId, ref.gameReleaseId)), targetMode, followsTargetClaims);
      if (ref.compatibilityRef) visit(recordMap.get(recordKey(ref.compatibilityRef, item.gameReleaseId)), 'full');
    }
  };
  const visit = (record, mode = 'full', followClaimRefs = mode === 'full') => { if (record) visitItem(record, mode, false, followClaimRefs); };
  visitItem(rootItem, 'full', !rootItem.payload);
  return [...visited.values()].sort((a, b) => compareLexical(a.key, b.key));
}

export function computeReviewDigests(contract, target) {
  const found = getReviewNode(contract, target);
  if (!found) throw new Error(`Unknown review target ${target.gameReleaseId}:${target.recordId}`);
  const field = pointerGet(found.item, target.fieldPath);
  if (!field.exists) throw new Error(`Review field path does not exist: ${target.fieldPath}`);
  const recordMap = new Map(contract.records.map((item) => [recordKey(item.recordId, item.gameReleaseId), item]));
  const sourceMap = new Map(contract.sourceRefs.map((item) => [`${item.gameReleaseId}\u0000${item.sourceId}`, item]));
  const releaseMap = new Map(contract.gameReleases.map((release) => [release.gameReleaseId, release]));
  const deps = dependencyClosure(contract, found.item, recordMap, sourceMap, releaseMap);
  return {
    targetDigest: sha256(field.value),
    dependenciesDigest: sha256(deps.map(({ key, mode, expandsClaimRefs, item, isTombstone, release, sourceRefs }) => ({
      key,
      dependencyMode: mode,
      kind: isTombstone ? 'tombstone' : item.kind,
      owner: item.owner ?? 'source',
      payload: mode === 'identity' ? identityPayloadProjection(item) : reviewProjection(item.payload ?? null, { omitClaimRefs: !expandsClaimRefs }),
      aliases: item.aliases ?? [],
      sourceLinks: reviewProjection(item.sourceRefs ?? [], { omitClaimRefs: true }),
      dataCoverage: reviewProjection(item.dataCoverage ?? null, { omitClaimRefs: true }),
      reviewTargets: item.reviewTargets ?? [],
      tombstoneReason: item.reason ?? null,
      release: releaseReviewProjection(release),
      sourceRefs: sourceRefs.map(sourceReviewProjection)
    })))
  };
}

export function createReviewReceipt(contract, target, { decision = 'approved', reviewer, reviewedAt } = {}) {
  if (!reviewer || reviewer.kind !== 'human' || typeof reviewer.id !== 'string') throw new Error('A named human reviewer is required');
  if (!REVIEW_DIMENSIONS.includes(target.dimension)) throw new Error('Unsupported review dimension');
  const digests = computeReviewDigests(contract, target);
  return { target: structuredClone(target), ...digests, decision, reviewer: structuredClone(reviewer), reviewedAt };
}

function deriveReviewState(item, receiptsByKey, contract, issues, itemPath) {
  const targets = item.reviewTargets ?? [];
  const wanted = new Map(targets.map((target) => [receiptKey({ recordId: item.recordId, gameReleaseId: item.gameReleaseId, ...target }), target]));
  if (wanted.size !== targets.length) issues.push({ path: `${itemPath}/reviewTargets`, code: 'duplicate-review-target', message: 'Review target pairs must be unique' });
  let count = 0; let stale = false; let rejected = false; let allApproved = true;
  for (const [key, target] of wanted) {
    const receipt = receiptsByKey.get(key);
    if (!receipt) { allApproved = false; continue; }
    count += 1;
    try {
      const actual = computeReviewDigests(contract, { recordId: item.recordId, gameReleaseId: item.gameReleaseId, ...target });
      if (actual.targetDigest !== receipt.targetDigest || actual.dependenciesDigest !== receipt.dependenciesDigest) stale = true;
    } catch { stale = true; }
    if (receipt.decision === 'rejected') rejected = true;
    if (receipt.decision !== 'approved') allApproved = false;
  }
  let state = 'pending';
  if (stale) state = 'stale';
  else if (rejected) state = 'rejected';
  else if (targets.length > 0 && allApproved) state = 'approved';
  else if (count === 0 && item.reviewState === 'draft') state = 'draft';
  return state;
}

function validateProvenance(contract, releaseMap, issues) {
  const sourceSnapshotsById = new Map();
  const knownSnapshotIds = new Map();
  for (const release of releaseMap.values()) {
    knownSnapshotIds.set(release.snapshot.snapshotId, { gameReleaseId: release.gameReleaseId, snapshot: release.snapshot, kind: 'release' });
  }
  for (const [index, sourceSnapshot] of (contract.sourceSnapshots ?? []).entries()) {
    const base = `/sourceSnapshots/${index}`;
    const snapshotId = sourceSnapshot.snapshot?.snapshotId;
    const release = releaseMap.get(sourceSnapshot.gameReleaseId);
    if (!release) issues.push({ path: `${base}/gameReleaseId`, code: 'unknown-source-snapshot-release', message: 'Source snapshot refers to an undeclared game release' });
    const previous = knownSnapshotIds.get(snapshotId);
    if (previous) {
      const sameMetadata = jsonEqual(previous.snapshot, sourceSnapshot.snapshot);
      const code = sameMetadata ? 'duplicate-source-snapshot' : 'source-snapshot-id-conflict';
      const message = sameMetadata ? 'Snapshot IDs must be unique across releases and source snapshots' : 'A snapshot ID cannot identify different metadata';
      issues.push({ path: `${base}/snapshot/snapshotId`, code, message });
      continue;
    }
    knownSnapshotIds.set(snapshotId, { gameReleaseId: sourceSnapshot.gameReleaseId, snapshot: sourceSnapshot.snapshot, kind: 'source' });
    sourceSnapshotsById.set(snapshotId, sourceSnapshot);
  }
  const sourceMap = new Map();
  for (const [index, source] of contract.sourceRefs.entries()) {
    const base = `/sourceRefs/${index}`;
    const key = `${source.gameReleaseId}\u0000${source.sourceId}`;
    if (sourceMap.has(key)) issues.push({ path: base, code: 'duplicate-source', message: 'Source IDs must be unique within a game release' });
    sourceMap.set(key, source);
    const release = releaseMap.get(source.gameReleaseId);
    if (!release) issues.push({ path: `${base}/gameReleaseId`, code: 'unknown-release', message: 'Source refers to an undeclared game release' });
    else {
      if (source.gameBuild !== release.gameBuild) issues.push({ path: `${base}/gameBuild`, code: 'build-mismatch', message: 'Source build must match its declared game release' });
      const sourceSnapshot = sourceSnapshotsById.get(source.snapshot?.snapshotId);
      if (sourceSnapshot) {
        if (sourceSnapshot.gameReleaseId !== source.gameReleaseId) {
          issues.push({ path: `${base}/snapshot/snapshotId`, code: 'source-snapshot-release', message: 'Source snapshot must belong to the source game release' });
        }
        if (!jsonEqual(source.snapshot, sourceSnapshot.snapshot)) {
          issues.push({ path: `${base}/snapshot`, code: 'source-snapshot-mismatch', message: 'Source snapshot metadata must exactly match the declared source snapshot' });
        }
        if (source.sourceKind === 'public-code' && (!source.commit || !source.snapshot?.commit)) {
          issues.push({ path: `${base}/snapshot/commit`, code: 'source-snapshot-commit-required', message: 'Alternate public-code snapshots require both source and snapshot commits' });
        }
      } else if (!jsonEqual(source.snapshot, release.snapshot)) {
        issues.push({ path: `${base}/snapshot`, code: 'snapshot-mismatch', message: 'Source snapshot must match its declared game release snapshot or an exact same-release source snapshot' });
      }
    }
    if (source.sourceKind === 'private-derived' && ['repository', 'publicUrl', 'commit', 'path'].some((field) => hasOwn(source, field))) {
      issues.push({ path: base, code: 'private-locator', message: 'Private-derived provenance carries only safe IDs, digests, version/build, tool and summary; private locators are forbidden' });
    }
    if (source.repository && !isHttpsUri(source.repository)) issues.push({ path: `${base}/repository`, code: 'unsafe-uri', message: 'Repository locator must be public HTTPS' });
    if (source.publicUrl && !isHttpsUri(source.publicUrl)) issues.push({ path: `${base}/publicUrl`, code: 'unsafe-uri', message: 'Public source URL must be HTTPS without embedded credentials' });
    if (source.path && (source.path.startsWith('/') || source.path.includes('\\') || source.path.split('/').some((part) => part === '.' || part === '..'))) {
      issues.push({ path: `${base}/path`, code: 'unsafe-path', message: 'Source path must be repository-relative without dot segments or backslashes' });
    }
    if (source.commit && source.snapshot?.commit && source.commit !== source.snapshot.commit) issues.push({ path: `${base}/commit`, code: 'commit-mismatch', message: 'Source commit and snapshot commit must agree when both are supplied' });
  }
  return sourceMap;
}
function validateReleaseSet(contract, issues) {
  const releaseMap = new Map(); const orders = new Set(); const snapshots = new Set();
  for (const [index, release] of contract.gameReleases.entries()) {
    const base = `/gameReleases/${index}`;
    if (releaseMap.has(release.gameReleaseId)) issues.push({ path: `${base}/gameReleaseId`, code: 'duplicate-release', message: 'gameReleaseId must be unique' });
    if (orders.has(release.releaseOrder)) issues.push({ path: `${base}/releaseOrder`, code: 'duplicate-release-order', message: 'releaseOrder must be unique' });
    if (snapshots.has(release.snapshot.snapshotId)) issues.push({ path: `${base}/snapshot/snapshotId`, code: 'duplicate-snapshot', message: 'Snapshot IDs must be unique' });
    releaseMap.set(releaseKey(release.gameReleaseId), release);
    orders.add(release.releaseOrder); snapshots.add(release.snapshot.snapshotId);
  }
  return releaseMap;
}

function validateRecordIdentityAndCoverage(contract, releaseMap, sourceMap, issues) {
  const recordMap = new Map(); const idKinds = new Map(); const recordIds = new Set(); const aliases = new Map();
  const tombstoneKeys = new Set();
  for (const [index, record] of contract.records.entries()) {
    const base = `/records/${index}`;
    const key = recordKey(record.recordId, record.gameReleaseId);
    if (recordMap.has(key)) issues.push({ path: base, code: 'duplicate-record', message: 'Composite (recordId,gameReleaseId) must be unique' });
    recordMap.set(key, record); recordIds.add(record.recordId);
    if (!releaseMap.has(record.gameReleaseId)) issues.push({ path: `${base}/gameReleaseId`, code: 'unknown-release', message: 'Record release is not declared' });
    const oldKind = idKinds.get(record.recordId);
    if (oldKind && oldKind !== record.kind) issues.push({ path: `${base}/kind`, code: 'identity-kind-change', message: `Stable ID ${record.recordId} cannot change kind from ${oldKind} to ${record.kind}` });
    idKinds.set(record.recordId, record.kind);
    if (/(?:^|[.:_-])v?\d+\.\d+\.\d+(?:$|[.:_-])/iu.test(record.recordId)) issues.push({ path: `${base}/recordId`, code: 'versioned-id', message: 'Stable record IDs must not embed game-release versions' });
    for (const alias of record.aliases ?? []) {
      if (aliases.has(alias) && aliases.get(alias) !== record.recordId) issues.push({ path: `${base}/aliases`, code: 'duplicate-alias', message: `Alias ${alias} is already attached to another stable ID` });
      aliases.set(alias, record.recordId);
    }
    const expectedState = deriveReviewState(record, new Map(), contract, issues, base);
    void expectedState;
    const coverage = record.dataCoverage;
    if (record.kind === "blessing" && record.payload.nameKey?.status === "unknown") {
      const nameKeyCoverage = (coverage.missing ?? []).find((item) => item.field === "/payload/nameKey");
      if (record.payload.nameKey.reasonCode !== "NOT_VERIFIED"
        || coverage.status === "complete"
        || nameKeyCoverage?.reasonCode !== "NOT_VERIFIED") {
        issues.push({ path: base + "/payload/nameKey", code: "unknown-blessing-name-key-coverage", message: "An unknown blessing nameKey must be NOT_VERIFIED and match non-complete coverage for /payload/nameKey" });
      }
    }
    const missingPaths = new Set();
    for (const [missingIndex, missing] of (coverage?.missing ?? []).entries()) {
      const p = `${base}/dataCoverage/missing/${missingIndex}`;
      if (missingPaths.has(missing.field)) issues.push({ path: `${p}/field`, code: 'duplicate-coverage', message: 'Coverage field paths must be unique' });
      missingPaths.add(missing.field);
      const value = pointerGet(record, missing.field);
      if (missing.reasonCode === 'NOT_IMPORTED') {
        if (value.exists && !(Array.isArray(value.value) && value.value.length === 0)) issues.push({ path: `${p}/reasonCode`, code: 'not-imported-present', message: 'NOT_IMPORTED is only valid for a missing or empty declared field, never a populated value' });
      } else if (value.exists && value.value && typeof value.value === 'object' && value.value.status === 'unknown') {
        if (value.value.reasonCode !== missing.reasonCode) issues.push({ path: `${p}/reasonCode`, code: 'coverage-unknown-mismatch', message: 'Unknown typed value reason must agree with its coverage entry' });
      }
    }
    if ((coverage?.status === 'complete') !== ((coverage?.missing?.length ?? 0) === 0)) issues.push({ path: `${base}/dataCoverage/status`, code: 'coverage-status', message: 'complete coverage requires no missing fields; incomplete coverage requires at least one' });
    for (const link of collectSourceLinks(record)) validateSourceLink(record, link, sourceMap, contract, releaseMap, issues, base);
  }
  for (const [index, record] of contract.records.entries()) {
    validateNumericPayload(record, `/records/${index}`, issues, recordMap);
  }
  for (const alias of aliases.keys()) if (recordIds.has(alias) && aliases.get(alias) !== alias) issues.push({ path: '/records', code: 'alias-record-id-collision', message: `Alias ${alias} collides with another stable record ID` });
  for (const [index, tombstone] of contract.tombstones.entries()) {
    const base = `/tombstones/${index}`; const key = recordKey(tombstone.recordId, tombstone.gameReleaseId);
    if (tombstoneKeys.has(key)) issues.push({ path: base, code: 'duplicate-tombstone', message: 'Tombstone composite identity must be unique' });
    tombstoneKeys.add(key);
    if (recordMap.has(key)) issues.push({ path: base, code: 'tombstone-record-conflict', message: 'A tombstoned ID cannot also have a record in the same release' });
    const previous = [...recordMap.values()].filter((record) => record.recordId === tombstone.recordId).sort((a, b) => releaseMap.get(a.gameReleaseId)?.releaseOrder - releaseMap.get(b.gameReleaseId)?.releaseOrder);
    const tombstoneRelease = releaseMap.get(tombstone.gameReleaseId);
    if (!tombstoneRelease || previous.length === 0 || !previous.some((record) => (releaseMap.get(record.gameReleaseId)?.releaseOrder ?? Infinity) < tombstoneRelease.releaseOrder)) {
      issues.push({ path: base, code: 'orphan-tombstone', message: 'A tombstone must follow a prior release containing the stable ID' });
    }
    if (previous.some((record) => (releaseMap.get(record.gameReleaseId)?.releaseOrder ?? -Infinity) > (tombstoneRelease?.releaseOrder ?? Infinity))) issues.push({ path: base, code: 'reused-id-after-tombstone', message: 'Stable ID cannot be reused after a tombstone' });
    for (const link of tombstone.sourceRefs ?? []) validateSourceLink(tombstone, link, sourceMap, contract, releaseMap, issues, base);
  }
  return { recordMap, idKinds, aliases };
}

function validateSourceLink(record, link, sourceMap, contract, releaseMap, issues, base) {
  const source = sourceMap.get(`${link.gameReleaseId}\u0000${link.sourceId}`);
  if (!source) { issues.push({ path: base, code: 'dangling-source', message: `Unknown sourceRef ${link.gameReleaseId}:${link.sourceId}` }); return; }
  const current = record.gameReleaseId;
  if (link.gameReleaseId === current) {
    if (link.compatibilityRef) issues.push({ path: base, code: 'unneeded-compatibility', message: 'Same-release source refs must not carry compatibilityRef' });
    return;
  }
  validateCompatibility(link.compatibilityRef, current, link.gameReleaseId, contract, releaseMap, issues, base);
}

function validateCompatibility(compatibilityRef, currentReleaseId, targetReleaseId, contract, releaseMap, issues, base) {
  if (!compatibilityRef) { issues.push({ path: base, code: 'cross-release-without-compatibility', message: 'Cross-release references require an explicit compatibility record' }); return; }
  const compatibility = contract.records.find((record) => record.recordId === compatibilityRef && record.gameReleaseId === currentReleaseId);
  if (!compatibility || compatibility.kind !== 'release-compatibility') { issues.push({ path: base, code: 'invalid-compatibility-ref', message: 'compatibilityRef must name a release-compatibility record in the referring release' }); return; }
  const { fromGameReleaseId, toGameReleaseId } = compatibility.payload;
  if (!releaseMap.has(targetReleaseId) || !releaseMap.has(currentReleaseId) || fromGameReleaseId !== targetReleaseId || toGameReleaseId !== currentReleaseId) {
    issues.push({ path: base, code: 'compatibility-pair-mismatch', message: 'Compatibility record must explicitly compare the referenced release to the referring release' });
  }
}

function validateNumericPayload(record, base, issues, recordMap) {
  const visit = (value, pointer) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${pointer}/${index}`)); return; }
    if (value.status === 'known' && value.decimal !== undefined) {
      if (!CONTRACT_UNITS.includes(value.unit)) issues.push({ path: `${pointer}/unit`, code: 'missing-unit', message: 'Known numeric values require a supported unit' });
    }
    if (value.min !== undefined && value.max !== undefined && value.unit && value.inclusive && value.step !== undefined) {
      if (compareDecimal(value.min, value.max) > 0) issues.push({ path: pointer, code: 'inverted-range', message: 'Range minimum cannot exceed maximum' });
      if (compareDecimal(value.step, '0') < 0) issues.push({ path: `${pointer}/step`, code: 'negative-step', message: 'Range step cannot be negative' });
      if (compareDecimal(value.min, value.max) === 0 && !(value.inclusive.min && value.inclusive.max)) issues.push({ path: pointer, code: 'empty-range', message: 'A point range must include both endpoints' });
    }
    if (value.reasonCode === 'NOT_IMPORTED') issues.push({ path: `${pointer}/reasonCode`, code: 'not-imported-as-unknown', message: 'NOT_IMPORTED is coverage-only and cannot be an unknown value reason' });
    for (const [key, child] of Object.entries(value)) visit(child, `${pointer}/${pointerEscape(key)}`);
  };
  visit(record.payload, `${base}/payload`);
  const payload = record.payload;
  if (record.kind === 'stat-curve') {
    for (let index = 1; index < payload.knots.length; index += 1) {
      if (compareDecimal(payload.knots[index - 1].input, payload.knots[index].input) >= 0) issues.push({ path: `${base}/payload/knots/${index}/input`, code: 'curve-order', message: 'Curve inputs must be strictly increasing' });
    }
  }
  if (record.kind === 'stat-definition') {
    const curve = payload.curveRef && recordMap.get(recordKey(payload.curveRef.recordId, payload.curveRef.gameReleaseId));
    for (const field of ['panelInputRange', 'theoreticalInputRange', 'obtainableInputRange']) {
      const range = payload[field];
      if (range.status === 'known' && range.unit !== payload.inputUnit) issues.push({ path: `${base}/payload/${field}/unit`, code: 'stat-input-unit', message: 'Known panel, theoretical and obtainable ranges must use inputUnit' });
    }
    if (curve && curve.kind === 'stat-curve' && (curve.payload.inputUnit !== payload.inputUnit || curve.payload.outputUnit !== payload.outputUnit)) issues.push({ path: `${base}/payload/curveRef`, code: 'curve-unit-mismatch', message: 'Stat definition and referenced curve units must agree' });
  }
  if (record.kind === 'armor-class') {
    for (const [index, entry] of (payload.damageTypes ?? []).entries()) {
      if (entry.multiplier.status === 'known' && !['ratio', 'percent'].includes(entry.multiplier.unit)) issues.push({ path: `${base}/payload/damageTypes/${index}/multiplier/unit`, code: 'armor-multiplier-unit', message: 'Armor multipliers must use ratio or percent' });
    }
  }
  if (record.kind === 'blessing-variant') {
    const defined = new Set(payload.definedTiers);
    if (payload.obtainableTiers.status === 'known') {
      for (const tier of payload.obtainableTiers.tiers) if (!defined.has(tier)) issues.push({ path: `${base}/payload/obtainableTiers/tiers`, code: 'tier-not-defined', message: `Obtainable tier ${tier} must also be defined` });
    }
    const values = new Set();
    for (const [index, tierValue] of payload.tierValues.entries()) {
      if (!defined.has(tierValue.tier)) issues.push({ path: `${base}/payload/tierValues/${index}/tier`, code: 'tier-not-defined', message: `Tier value ${tierValue.tier} must be defined` });
      if (values.has(tierValue.tier)) issues.push({ path: `${base}/payload/tierValues/${index}/tier`, code: 'duplicate-tier-value', message: 'Each tier may have one value only' });
      values.add(tierValue.tier);
    }
  }
  if (record.kind === 'target-profile' && Array.isArray(payload.hitZones)) {
    for (const [zoneIndex, zone] of payload.hitZones.entries()) {
      const pairs = new Set();
      for (const [multiplierIndex, multiplier] of zone.damageMultipliers.entries()) {
        const key = `${multiplier.critical}:${multiplier.weakspot}`;
        if (pairs.has(key)) issues.push({ path: `${base}/payload/hitZones/${zoneIndex}/damageMultipliers/${multiplierIndex}`, code: 'duplicate-hit-modifier', message: 'Each critical/weakspot modifier pair must be unique per hit zone' });
        pairs.add(key);
      }
    }
  }
}

function validateContextAndComparisonSemantics(contract, recordMap, issues) {
  const contextContainers = new Set(['context', 'contexts', 'conditions', 'applicability']);
  for (const [recordIndex, record] of contract.records.entries()) {
    if (!record || !record.payload || typeof record.payload !== 'object') continue;
    const base = `/records/${recordIndex}`;
    const targetRef = record.kind === 'claim' ? record.payload.targetRef : null;
    const inferredVariant = targetRef && typeof targetRef === 'object'
      ? recordMap.get(recordKey(targetRef.recordId, targetRef.gameReleaseId)) : null;
    const visit = (value, pointer, isContext = false) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${pointer}/${index}`, isContext)); return; }
      if (isContext && value.tier !== undefined) {
        const hasVariantRef = hasOwn(value, 'variantRef');
        const variantRef = hasVariantRef ? value.variantRef : null;
        const explicitVariant = variantRef && typeof variantRef === 'object'
          ? recordMap.get(recordKey(variantRef.recordId, variantRef.gameReleaseId)) : null;
        const mayInferFromClaim = !hasVariantRef && record.kind === 'claim' && inferredVariant?.kind === 'blessing-variant';
        const variant = hasVariantRef ? explicitVariant : (mayInferFromClaim ? inferredVariant : null);
        if (!hasVariantRef && !mayInferFromClaim) {
          issues.push({ path: `${pointer}/variantRef`, code: 'context-tier-needs-variant', message: 'A context tier requires a blessing variant reference or a claim targeting one' });
        } else if (variant?.kind === 'blessing-variant' && Array.isArray(variant.payload?.definedTiers) &&
          !variant.payload.definedTiers.includes(value.tier)) {
          issues.push({ path: `${pointer}/tier`, code: 'context-tier-not-defined', message: `Context tier ${value.tier} is not defined for its blessing variant` });
        }
      }
      if (Array.isArray(value.statComparisons)) {
        for (const [index, comparison] of value.statComparisons.entries()) {
          const statRef = comparison && typeof comparison === 'object' ? comparison.statRef : null;
          const stat = statRef && typeof statRef === 'object'
            ? recordMap.get(recordKey(statRef.recordId, statRef.gameReleaseId)) : null;
          if (stat?.kind === 'stat-definition' && comparison.inputUnit !== stat.payload?.inputUnit) {
            issues.push({ path: `${pointer}/statComparisons/${index}/inputUnit`, code: 'stat-comparison-unit', message: 'Stat comparison inputUnit must match the referenced stat definition' });
          }
        }
      }
      for (const [key, child] of Object.entries(value)) {
        visit(child, `${pointer}/${pointerEscape(key)}`, isContext || contextContainers.has(key));
      }
    };
    visit(record.payload, `${base}/payload`);
  }
}

function validateW07SourceLocators(record, sourceMap, issues) {
  const visit = (value, pointer) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach((child, index) => visit(child, pointer + "/" + index)); return; }
    if (value.sourceRef && typeof value.path === 'string' && Number.isInteger(value.line)) {
      const locator = value;
      const key = locator.sourceRef.gameReleaseId + "\u0000" + locator.sourceRef.sourceId;
      const source = sourceMap.get(key);
      if (!source || locator.sourceRef.gameReleaseId !== record.gameReleaseId || source.sourceKind !== "public-code" || source.path !== locator.path) {
        issues.push({ path: pointer, code: "w07-locator-provenance", message: "W07 source locators must match a same-release public-code source path" });
      }
      if (!record.sourceRefs.some((link) => link.sourceId === locator.sourceRef.sourceId && link.gameReleaseId === locator.sourceRef.gameReleaseId)) {
        issues.push({ path: pointer + "/sourceRef", code: "w07-locator-unlisted", message: "W07 source locator must also appear in the record sourceRefs" });
      }
      if (locator.endLine !== undefined && locator.endLine < locator.line) {
        issues.push({ path: pointer + "/endLine", code: "w07-locator-line-range", message: "A source locator endLine cannot precede its line" });
      }
    }
    for (const [key, child] of Object.entries(value)) visit(child, pointer + "/" + pointerEscape(key));
  };
  visit(record.payload, "/records/" + record.recordId + "/payload");
}
function validateW07CurveMapping(mapping, pointer, issues, expectedTraitRange) {
  if (!mapping) return;
  const outerItemRating = mapping.outerItemRating;
  if (outerItemRating.quantityKind !== "normalized-item-stat-value" || outerItemRating.unit !== "ratio"
    || outerItemRating.panelComparisonRange?.min !== "0" || outerItemRating.panelComparisonRange?.max !== "1"
    || outerItemRating.panelComparisonRange?.scope !== "comparison-metadata-only"
    || outerItemRating.obtainableRange?.status !== "unknown"
    || outerItemRating.obtainableRange?.reasonCode !== "NOT_EXPOSED_BY_SOURCE") {
    issues.push({ path: pointer + "/outerItemRating", code: "w07-item-rating-range", message: "The normalized item value, comparison metadata and unexposed server range must remain distinct" });
  }
  const traitRange = mapping.traitParameter.range;
  if (traitRange.unit !== "ratio" || traitRange.inclusive?.min !== true || traitRange.inclusive?.max !== true
    || compareDecimal(traitRange.min, traitRange.max) > 0) {
    issues.push({ path: pointer + "/traitParameter/range", code: "w07-trait-parameter-range", message: "Trait parameter t must retain an ordered inclusive ratio interval" });
  }
  if (expectedTraitRange && !jsonEqual(traitRange, expectedTraitRange)) {
    issues.push({ path: pointer + "/traitParameter/range", code: "w07-trait-parameter-binding", message: "Curve mapping trait t range must match its owning Source trait binding" });
  }
  const profile = mapping.rawProfileParameter;
  if (profile.callerDomain.status !== "unknown" || profile.callerDomain.reasonCode !== "CALLER_DOMAIN_NOT_PROVEN") {
    issues.push({ path: pointer + "/rawProfileParameter/callerDomain", code: "w07-profile-caller-domain", message: "The call-site domain must remain explicitly unproven" });
  }
  const selectedPath = profile.selectedWeaponTweakPath;
  if (selectedPath?.status !== 'known' || selectedPath.accumulatorRange?.min !== '0'
    || selectedPath.accumulatorRange?.max !== '1' || selectedPath.accumulatorRange?.unit !== 'ratio'
    || selectedPath.accumulatorRange?.inclusive?.min !== true || selectedPath.accumulatorRange?.inclusive?.max !== true
    || selectedPath.fallbacks?.emptyPath !== '0' || selectedPath.fallbacks?.defaultTraitValue !== '0.5'
    || selectedPath.fallbacks?.defaultProfileLerpValue !== '0.5') {
    issues.push({ path: pointer + '/rawProfileParameter/selectedWeaponTweakPath', code: 'w07-selected-tweak-domain', message: 'Only the selected-weapon tweak accumulation path has the proven clamped normalized t interval and fixed fallback values' });
  }
}

function validateW07StaticTarget(record, base, recordMap, issues) {
  const sourceStatic = record.payload.sourceStatic;
  if (!sourceStatic) return;
  const zoneIds = new Set();
  for (const [zoneIndex, zone] of (sourceStatic.hitZones ?? []).entries()) {
    if (zoneIds.has(zone.zoneId)) {
      issues.push({ path: `${base}/sourceStatic/hitZones/${zoneIndex}/zoneId`, code: "w07-target-zone-duplicate", message: "W07 static hit-zone identities must be unique within a target profile" });
    }
    zoneIds.add(zone.zoneId);
  }
  const armorRef = sourceStatic.baseArmorClassRef;
  const armor = armorRef && recordMap.get(recordKey(armorRef.recordId, armorRef.gameReleaseId));
  if (!armor || armor.kind !== "armor-class" || armor.gameReleaseId !== record.gameReleaseId) {
    issues.push({ path: `${base}/sourceStatic/baseArmorClassRef`, code: "w07-target-base-armor-binding", message: "A W07 target base armor reference must resolve to a same-release typed armor-class record" });
  } else if (sourceStatic.baseArmorRawValue !== `armor_types.${armor.payload.sourceStatic?.classKey}`) {
    issues.push({ path: `${base}/sourceStatic/baseArmorRawValue`, code: "w07-target-base-armor-value", message: "The target base armor raw value must match the exact armor_types access token for its typed armor identity" });
  }
  const toughnessFields = ["toughnessArmorClassRef", "toughnessArmorRawValue", "toughnessArmorLocator"].filter((field) => hasOwn(sourceStatic, field));
  if (toughnessFields.length !== 0 && toughnessFields.length !== 3) {
    issues.push({ path: `${base}/sourceStatic`, code: "w07-target-toughness-armor-pair", message: "Toughness armor reference, raw value and locator must be supplied together" });
  }
  if (sourceStatic.toughnessArmorClassRef) {
    validateW07StaticArmorReference(sourceStatic.toughnessArmorClassRef, sourceStatic.toughnessArmorRawValue, record,
      recordMap, `${base}/sourceStatic/toughnessArmorClassRef`, issues);
  }
  const unresolvedRows = sourceStatic.unresolvedZoneReferences ?? [];
  const mappingRows = [
    ['hit_zone_weakspot_types', sourceStatic.weakspotTypes ?? []],
    ['hitzone_armor_override', sourceStatic.armorOverrides ?? []],
    ['hitzone_damage_multiplier', sourceStatic.damageMultipliers ?? []]
  ].flatMap(([fieldPath, rows]) => rows.map((row) => ({ fieldPath, row })));
  const unresolvedIdentity = (fieldPath, row) => ({
    fieldPath,
    zoneId: row.zoneId,
    rawValue: row.rawValue,
    sourceLocator: row.sourceLocator
  });
  for (const [listName, rows] of [["weakspotTypes", sourceStatic.weakspotTypes ?? []], ["armorOverrides", sourceStatic.armorOverrides ?? []], ["damageMultipliers", sourceStatic.damageMultipliers ?? []]]) {
    for (const [rowIndex, row] of rows.entries()) {
      if (listName === 'armorOverrides') {
        validateW07StaticArmorReference(row.armorClassRef, row.rawValue, record, recordMap,
          `${base}/sourceStatic/${listName}/${rowIndex}/armorClassRef`, issues);
      }
      if (listName === 'damageMultipliers' && /^-?\d+(?:\.\d+)?$/u.test(row.rawValue)
        && compareDecimal(row.rawValue, row.decimal) !== 0) {
        issues.push({ path: `${base}/sourceStatic/${listName}/${rowIndex}/decimal`, code: 'w07-target-multiplier-value', message: 'A typed hit-zone multiplier must preserve its exact numeric source value' });
      }
      if (listName === 'damageMultipliers') {
        const numericRawValue = /^-?\d+(?:\.\d+)?$/u.test(row.rawValue);
        if (numericRawValue && row.resolvedConstant !== undefined) {
          issues.push({ path: `${base}/sourceStatic/${listName}/${rowIndex}/resolvedConstant`, code: 'w07-target-multiplier-constant-shape', message: 'A numeric multiplier use must not carry a local-constant resolution' });
        }
        if (!numericRawValue) {
          const resolved = row.resolvedConstant;
          const declaration = typeof resolved?.rawValue === 'string'
            ? resolved.rawValue.match(/^\s*local\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/u)
            : null;
          const useLocator = row.sourceLocator;
          const declarationLocator = resolved?.sourceLocator;
          const sameSourceFile = useLocator && declarationLocator
            && useLocator.path === declarationLocator.path
            && useLocator.sourceRef?.sourceId === declarationLocator.sourceRef?.sourceId
            && useLocator.sourceRef?.gameReleaseId === declarationLocator.sourceRef?.gameReleaseId;
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(row.rawValue)
            || !resolved || resolved.symbol !== row.rawValue
            || !declaration || declaration[1] !== row.rawValue
            || compareDecimal(declaration[2], resolved.decimal) !== 0
            || compareDecimal(resolved.decimal, row.decimal) !== 0
            || !sameSourceFile) {
            issues.push({ path: `${base}/sourceStatic/${listName}/${rowIndex}/resolvedConstant`, code: 'w07-target-multiplier-constant', message: 'A symbolic multiplier must retain the exact same-file local decimal declaration and typed value' });
          }
        }
      }
      if (!zoneIds.has(row.zoneId)) {
        const sourceField = listName === "weakspotTypes" ? "hit_zone_weakspot_types"
          : listName === "armorOverrides" ? "hitzone_armor_override" : "hitzone_damage_multiplier";
        const expected = unresolvedIdentity(sourceField, row);
        const matches = unresolvedRows.filter((unresolved) => jsonEqual(unresolved, expected));
        if (matches.length !== 1) {
          issues.push({ path: `${base}/sourceStatic/${listName}/${rowIndex}`, code: "w07-target-zone-binding", message: "Every orphan mapping must have exactly one unresolved row matching its field, zone, raw value and complete source locator" });
        }
      }
    }
  }
  const seenUnresolved = new Set();
  for (const [index, unresolved] of unresolvedRows.entries()) {
    if (zoneIds.has(unresolved.zoneId)) {
      issues.push({ path: `${base}/sourceStatic/unresolvedZoneReferences/${index}/zoneId`, code: "w07-target-unresolved-zone", message: "A declared hit-zone must not also be marked unresolved" });
    }
    const identity = JSON.stringify(canonical(unresolved));
    if (seenUnresolved.has(identity)) {
      issues.push({ path: `${base}/sourceStatic/unresolvedZoneReferences/${index}`, code: 'w07-target-unresolved-duplicate', message: 'Unresolved zone references must be unique by exact raw row identity' });
    }
    seenUnresolved.add(identity);
    const matches = mappingRows.filter(({ fieldPath, row }) => jsonEqual(unresolved, unresolvedIdentity(fieldPath, row)));
    if (matches.length !== 1) {
      issues.push({ path: `${base}/sourceStatic/unresolvedZoneReferences/${index}`, code: 'w07-target-unresolved-map-binding', message: 'Each unresolved zone row must match exactly one typed raw mapping row' });
    }
  }
}

function typedRefKey(ref) {
  return ref && typeof ref.recordId === 'string' && typeof ref.gameReleaseId === 'string'
    ? recordKey(ref.recordId, ref.gameReleaseId)
    : '';
}

function canonicalActionInputKey(inputKey) {
  return typeof inputKey === 'string' ? inputKey.split('.', 1)[0] : '';
}

function validateW07RefClosure(actualRefs, expectedRefs, pointer, codePrefix, releaseId, issues) {
  const refs = Array.isArray(actualRefs) ? actualRefs : [];
  const keys = refs.map(typedRefKey);
  if (keys.some((key) => !key) || refs.some((ref) => ref.gameReleaseId !== releaseId) || new Set(keys).size !== keys.length) {
    issues.push({ path: pointer, code: `${codePrefix}-duplicate`, message: 'W07 closure references must be valid, same-release and unique before set comparison' });
  }
  const expectedKeys = [...new Set(expectedRefs.map(typedRefKey))].sort();
  if (JSON.stringify([...new Set(keys)].sort()) !== JSON.stringify(expectedKeys)) {
    issues.push({ path: pointer, code: `${codePrefix}-closure`, message: 'Same-release W07 references must match the complete source-static closure' });
  }
}

function validateW07StaticArmorReference(ref, rawValue, record, recordMap, pointer, issues, tokenStyle = 'armor-types') {
  const target = ref && recordMap.get(typedRefKey(ref));
  const expectedRaw = target?.payload?.sourceStatic?.classKey;
  const rawMatches = tokenStyle === 'quoted-class'
    ? rawValue === JSON.stringify(expectedRaw)
    : rawValue === `armor_types.${expectedRaw}`;
  if (!target || target.kind !== 'armor-class' || target.gameReleaseId !== record.gameReleaseId
    || !expectedRaw || !rawMatches) {
    issues.push({ path: pointer, code: 'w07-static-armor-reference', message: tokenStyle === 'quoted-class'
      ? 'A Havoc override must resolve to a same-release armor-class record and preserve its exact quoted class-key token'
      : 'A static armor reference must resolve to a same-release armor-class record and preserve its exact armor_types access token' });
  }
}

function validateW07ModifierRule(record, base, recordMap, issues) {
  const model = record.payload.sourceBranchModel;
  if (!model) return;
  const requiredDependencies = {
    'armor-type-resolution': [
      ['scripts/utilities/attack/armor.lua', 25, 74],
      ['scripts/settings/havoc/havoc_mutator_local_settings.lua', 514, 525]
    ],
    'weakspot-type-resolution': [
      ['scripts/utilities/attack/weakspot.lua', 9, 44],
      ['scripts/settings/damage/weakspot_settings.lua', 4, 27]
    ],
    'finesse-crit-boost': [
      ['scripts/utilities/attack/damage_calculation.lua', 672, 785],
      ['scripts/settings/damage/weakspot_settings.lua', 4, 27],
      ['scripts/settings/damage/power_level_settings.lua', 142, 151],
      ['scripts/settings/damage/power_level_settings.lua', 172, 194],
      ['scripts/settings/damage/power_level_settings.lua', 123, 137],
      ['scripts/utilities/attack/damage_calculation.lua', 208, 217],
      ['scripts/utilities/attack/damage_calculation.lua', 700, 704],
      ['scripts/utilities/attack/damage_calculation.lua', 795, 834]
    ]
  }[model.relationKey] ?? [];
  const dependencies = model.rawDependencies ?? [];
  const coversLines = (path, firstLine, lastLine) => {
    const spans = dependencies
      .filter(({ sourceLocator }) => sourceLocator.path === path)
      .map(({ sourceLocator }) => ({ start: sourceLocator.line, end: sourceLocator.endLine }))
      .sort((left, right) => left.start - right.start || left.end - right.end);
    let nextLine = firstLine;
    for (const span of spans) {
      if (span.end < nextLine) continue;
      if (span.start > nextLine) break;
      nextLine = Math.max(nextLine, span.end + 1);
      if (nextLine > lastLine) return true;
    }
    return false;
  };
  for (const [path, firstLine, lastLine] of requiredDependencies) {
    if (!coversLines(path, firstLine, lastLine)) {
      issues.push({ path: base + '/sourceBranchModel/rawDependencies', code: 'w07-modifier-dependency-coverage', message: 'The ' + model.relationKey + ' relation must retain complete raw line coverage for ' + path + ':' + firstLine + '-' + lastLine });
    }
  }
  const expectedHavocOverrides = model.relationKey === 'armor-type-resolution' ? 10 : 0;
  if ((model.havocOverrides ?? []).length !== expectedHavocOverrides) {
    issues.push({ path: `${base}/sourceBranchModel/havocOverrides`, code: 'w07-modifier-havoc-coverage', message: `The ${model.relationKey} relation must retain exactly ${expectedHavocOverrides} pinned Havoc override rows` });
  }
  const seenDependencies = new Set();
  for (const [index, dependency] of dependencies.entries()) {
    const identity = JSON.stringify(canonical(dependency));
    if (seenDependencies.has(identity)) {
      issues.push({ path: `${base}/sourceBranchModel/rawDependencies/${index}`, code: 'w07-modifier-dependency-duplicate', message: 'Raw dependencies must be unique by exact source locator and raw value' });
    }
    seenDependencies.add(identity);
  }
  const seen = new Set();
  for (const [index, override] of (model.havocOverrides ?? []).entries()) {
    const key = `${override.zoneId}\u0000${typedRefKey(override.armorClassRef)}`;
    if (seen.has(key)) {
      issues.push({ path: `${base}/sourceBranchModel/havocOverrides/${index}`, code: 'w07-modifier-override-duplicate', message: 'Static havoc overrides must be unique by zone and armor class' });
    }
    seen.add(key);
    validateW07StaticArmorReference(override.armorClassRef, override.rawValue, record, recordMap,
      `${base}/sourceBranchModel/havocOverrides/${index}/armorClassRef`, issues, 'quoted-class');
  }
}

function validateW07PanelPreviewRules(record, base, issues) {
  const rules = record.payload.panelPreviewRules;
  if (!rules) return;
  const expected = [
    ['perStatIncrementCap', '0.8', 'ratio'],
    ['itemBudget', '380', 'item-stat-rating'],
    ['expertiseBudget.expertiseMultiplier', '10', 'expertise-level-per-rank'],
    ['expertiseBudget.maxExpertise', '500', 'expertise-level'],
    ['displayCap', '100', 'percent']
  ];
  for (const [fieldPath, decimal, unit] of expected) {
    const value = fieldPath.split('.').reduce((current, key) => current?.[key], rules);
    if (value?.decimal !== decimal || value?.unit !== unit) {
      issues.push({ path: base + '/panelPreviewRules/' + fieldPath.replaceAll('.', '/'), code: 'w07-panel-preview-value', message: 'The client preview ' + fieldPath + ' must retain its pinned value and unit' });
    }
  }
  const branchKeys = (rules.conditionalBranches ?? []).map((branch) => branch.key);
  if (new Set(branchKeys).size !== 2 || !branchKeys.includes('no-current-item-total') || !branchKeys.includes('current-item-total-present')) {
    issues.push({ path: base + '/panelPreviewRules/conditionalBranches', code: 'w07-panel-preview-branches', message: 'Both mutually distinct preview allocation branches must be represented' });
  }
  if (rules.expertiseBudget?.formula !== 'expertise_increase / expertise_multiplier * 6'
    || rules.expertiseBudget?.capByRemainingItemBudget !== true || rules.expertiseBudget?.lowerBound !== '0'
    || !rules.perStatIncrementCap?.override?.panelCaller
    || rules.perStatIncrementCap.override.fieldPath !== 'Items.preview_stats_change.max_stat_value') {
    issues.push({ path: base + '/panelPreviewRules', code: 'w07-panel-preview-allocation', message: 'Conditional preview defaults and caller override must remain explicit' });
  }
  if (rules.obtainableRange?.status !== 'unknown' || rules.obtainableRange?.reasonCode !== 'NOT_EXPOSED_BY_SOURCE') {
    issues.push({ path: `${base}/panelPreviewRules/obtainableRange`, code: 'w07-panel-preview-obtainable-range', message: 'Client preview defaults do not establish an obtainable game-side range' });
  }
}

function validateW07ActionResolution(record, base, recordMap, contract, issues) {
  const payload = record.payload;
  const resolution = payload.actionResolution;
  if (!resolution) return;
  if (!jsonEqual(resolution.branchBindings, payload.sourceBindings ?? [])) {
    issues.push({ path: `${base}/actionResolution/branchBindings`, code: 'w07-action-branch-binding', message: 'Static action branches must exactly preserve their typed sourceBindings' });
  }
  const weapon = payload.weaponRef && recordMap.get(typedRefKey(payload.weaponRef));
  const weaponResolution = weapon?.payload?.actionProfileResolution;
  if (!weapon || weapon.kind !== 'weapon' || weapon.gameReleaseId !== record.gameReleaseId || !weaponResolution) {
    issues.push({ path: `${base}/weaponRef`, code: 'w07-action-weapon-resolution', message: 'A W07 action resolution must resolve to its same-release weapon resolution record' });
    return;
  }
  const local = (weaponResolution.localActions ?? []).find((item) => item.action === payload.action);
  const fallback = (weaponResolution.fallbackActions ?? []).find((item) => item.action === payload.action);
  const actionRow = local ?? fallback;
  const expectedOrigin = local ? 'weapon-template' : fallback ? 'base-template-settings' : undefined;
  const expectedStartInput = actionRow?.startInput ?? null;
  if (!actionRow || resolution.origin !== expectedOrigin
    || !jsonEqual(resolution.startInput, expectedStartInput)) {
    issues.push({ path: `${base}/actionResolution/startInput`, code: 'w07-action-start-input-binding', message: 'The action start input and origin must match the owning weapon static action row' });
    return;
  }
  const declaredInputs = new Set((weaponResolution.inputSetup?.inputEntries ?? [])
    .map((entry) => canonicalActionInputKey(entry.inputKey)));
  const checkInput = (inputKey, pointer) => {
    if (!declaredInputs.has(canonicalActionInputKey(inputKey))) {
      issues.push({ path: pointer, code: 'w07-action-input-unknown', message: 'Every action input key must resolve to an entry in the owning weapon input setup' });
    }
  };
  if (resolution.startInput) checkInput(resolution.startInput.inputKey, `${base}/actionResolution/startInput/inputKey`);
  const startInputs = (resolution.inputBindings ?? []).filter((binding) => binding.role === 'start-input');
  const expectedStartBindingCount = resolution.startInput ? 1 : 0;
  if (startInputs.length !== expectedStartBindingCount
    || (resolution.startInput && startInputs[0]?.inputKey !== resolution.startInput.inputKey)) {
    issues.push({ path: `${base}/actionResolution/inputBindings`, code: 'w07-action-input-binding', message: 'Exactly one input binding must identify the resolved start input' });
  }
  const continuationKeys = new Set((payload.continuations ?? []).map((item) => item.inputKey));
  const resolvedContinuationKeys = (resolution.inputBindings ?? []).filter((binding) => binding.role === 'continuation').map((binding) => binding.inputKey);
  if (new Set(resolvedContinuationKeys).size !== resolvedContinuationKeys.length
    || continuationKeys.size !== resolvedContinuationKeys.length
    || [...continuationKeys].some((key) => !resolvedContinuationKeys.includes(key))) {
    issues.push({ path: `${base}/actionResolution/inputBindings`, code: 'w07-action-continuation-binding', message: 'Continuation inputs must match the action continuation rows without duplicates' });
  }
  for (const [index, binding] of (resolution.inputBindings ?? []).entries()) {
    checkInput(binding.inputKey, `${base}/actionResolution/inputBindings/${index}/inputKey`);
  }
  const expectedEntryBindings = (weapon.payload.actionContinuations ?? []).filter((edge) => edge.toAction === payload.action);
  if (!jsonEqual(resolution.entryBindings, expectedEntryBindings)) {
    issues.push({ path: `${base}/actionResolution/entryBindings`, code: 'w07-action-entry-binding', message: 'Action entry bindings must preserve every exact ordered incoming weapon continuation row' });
  }
  for (const [index, binding] of (resolution.entryBindings ?? []).entries()) {
    checkInput(binding.inputKey, `${base}/actionResolution/entryBindings/${index}/inputKey`);
  }

  const staticTargets = contract.records.filter((item) => item.kind === 'target-profile'
    && item.gameReleaseId === record.gameReleaseId && item.payload.sourceStatic?.breedType === 'minion');
  validateW07RefClosure(payload.targetProfileRefs, staticTargets.map((item) => ({ recordId: item.recordId, gameReleaseId: item.gameReleaseId })),
    `${base}/targetProfileRefs`, 'w07-action-target', record.gameReleaseId, issues);

  const expectedArmorRefs = [];
  for (const targetProfile of staticTargets) {
    const sourceStatic = targetProfile.payload.sourceStatic;
    expectedArmorRefs.push(sourceStatic.baseArmorClassRef);
    if (sourceStatic.toughnessArmorClassRef) expectedArmorRefs.push(sourceStatic.toughnessArmorClassRef);
    for (const override of sourceStatic.armorOverrides ?? []) expectedArmorRefs.push(override.armorClassRef);
  }
  validateW07RefClosure(payload.armorClassRefs, expectedArmorRefs, `${base}/armorClassRefs`, 'w07-action-armor', record.gameReleaseId, issues);
  const expectedRuleRefs = contract.records.filter((item) => item.kind === 'modifier-rule'
    && item.gameReleaseId === record.gameReleaseId && item.payload.sourceBranchModel)
    .map((item) => ({ recordId: item.recordId, gameReleaseId: item.gameReleaseId }));
  validateW07RefClosure(payload.modifierRuleRefs, expectedRuleRefs, `${base}/modifierRuleRefs`, 'w07-action-rule', record.gameReleaseId, issues);
}

function validateW07WeaponActionClosure(record, base, contract, recordMap, issues) {
  const resolution = record.payload.actionProfileResolution;
  if (!resolution) return;
  if (!record.payload.panelPreviewRules) {
    issues.push({ path: `${base}/panelPreviewRules`, code: 'w07-panel-preview-required', message: 'A W07 weapon resolution must retain the separate client preview bounds and unknown game-side obtainable range' });
  }
  const counts = resolution.staticClosure;
  if (!counts) return;
  const inputEntries = resolution.inputSetup?.inputEntries ?? [];
  const inputKeys = inputEntries.map((entry) => canonicalActionInputKey(entry.inputKey));
  const declaredInputKeys = new Set(inputKeys);
  const setupSources = resolution.inputSetup?.setupSources ?? [];
  const sameLocatorSource = (left, right) => left?.path === right?.path
    && left?.sourceRef?.sourceId === right?.sourceRef?.sourceId
    && left?.sourceRef?.gameReleaseId === right?.sourceRef?.gameReleaseId;
  const hasSetupSource = (locator, predicate) => setupSources.some((source) => sameLocatorSource(source.sourceLocator, locator)
    && predicate(source.sourceLocator?.fieldPath ?? '', source.rawValue ?? ''));
  for (const [index, inputKey] of inputKeys.entries()) {
    if (!inputKey || inputKeys.indexOf(inputKey) !== index) {
      issues.push({ path: `${base}/actionProfileResolution/inputSetup/inputEntries/${index}/inputKey`, code: 'w07-action-input-duplicate', message: 'Weapon input setup entries must have unique non-empty canonical input keys' });
    }
    const entry = inputEntries[index];
    const entryAt = `${base}/actionProfileResolution/inputSetup/inputEntries/${index}`;
    if (entry.origin === 'weapon-mid-setup') {
      const inherited = entry.inheritedDefinition;
      const inheritedLocator = inherited?.sourceLocator;
      const entryLocator = entry.sourceLocator;
      const inheritedField = inheritedLocator?.fieldPath ?? '';
      const overrideField = entryLocator?.fieldPath ?? '';
      const inheritedPrefixes = [
        `${resolution.inputSetup?.inheritedSetupKey}.action_inputs.${inputKey}`,
        `base_template_settings.action_inputs.${inputKey}`
      ];
      const matchesInheritedPath = inheritedPrefixes.some((prefix) => inheritedField === prefix || inheritedField.startsWith(prefix + '.'));
      const parentTablePrefix = inheritedPrefixes.map((prefix) => prefix.slice(0, prefix.lastIndexOf('.')));
      const hasParentSetup = hasSetupSource(inheritedLocator, (fieldPath, rawValue) =>
        parentTablePrefix.includes(fieldPath) && typeof inherited?.rawValue === 'string' && rawValue.includes(inherited.rawValue));
      const expectedOverrideField = `weapon_template.action_inputs.${inputKey}.buffer_time`;
      const hasOverrideSetupRow = hasSetupSource(entryLocator, (fieldPath, rawValue) => fieldPath === expectedOverrideField && rawValue === entry.rawValue);
      if (!inherited || !matchesInheritedPath || !hasParentSetup || overrideField !== expectedOverrideField
        || !hasOverrideSetupRow || sameLocatorSource(inheritedLocator, entryLocator) && inheritedField === overrideField) {
        issues.push({ path: entryAt, code: 'w07-action-input-override-provenance', message: 'A weapon-mid input override must preserve the inherited same-key base/default definition and bind a distinct buffer_time override source row' });
      }
    } else if (entry.inheritedDefinition !== undefined) {
      issues.push({ path: entryAt + '/inheritedDefinition', code: 'w07-action-input-override-provenance', message: 'Only a weapon-mid-setup input override may carry inheritedDefinition' });
    }
  }
  const checkDeclaredInput = (inputKey, pointer) => {
    if (!declaredInputKeys.has(canonicalActionInputKey(inputKey))) {
      issues.push({ path: pointer, code: 'w07-action-input-unknown', message: 'Every static action input must resolve to an entry in this weapon input setup' });
    }
  };
  for (const [index, action] of (resolution.localActions ?? []).entries()) {
    if (action.startInput) checkDeclaredInput(action.startInput.inputKey, `${base}/actionProfileResolution/localActions/${index}/startInput/inputKey`);
  }
  const attackProfileRefs = record.payload.attackProfileRefs ?? [];
  const seenAttackProfileRefs = new Set();
  for (const [index, ref] of attackProfileRefs.entries()) {
    const key = typedRefKey(ref);
    if (ref.gameReleaseId !== record.gameReleaseId) {
      issues.push({ path: `${base}/attackProfileRefs/${index}`, code: 'w07-action-profile-ref-release', message: 'W07 weapon action-profile bindings must point into the same game release' });
    }
    if (seenAttackProfileRefs.has(key)) {
      issues.push({ path: `${base}/attackProfileRefs/${index}`, code: 'w07-action-profile-ref-duplicate', message: 'W07 weapon action-profile bindings must be unique by typed record reference' });
    }
    seenAttackProfileRefs.add(key);
  }
  const boundProfiles = (record.payload.attackProfileRefs ?? [])
    .filter((ref) => ref.gameReleaseId === record.gameReleaseId)
    .map((ref) => recordMap.get(typedRefKey(ref)))
    .filter((profile) => profile?.kind === 'attack-profile' && profile.gameReleaseId === record.gameReleaseId);
  const expectedReturnKind = (key) => key === 'generate_wield_chain_actions' ? 'continuation-list' : 'action-settings';
  const assignedKeys = {
    generate_unwield_action: 'action_unwield',
    generate_wield_chain_actions: 'wield',
    generate_inspect_action: 'action_inspect',
    generate_inspect_3p_action: 'action_inspect_3p'
  };
  const effectiveDefinitions = new Map();
  const seenGeneratorKeys = new Set();
  for (const [generatorIndex, generator] of (resolution.actionGenerators ?? []).entries()) {
    const definitions = generator.definitions ?? [];
    let previousIndex = 0;
    let previousEndLine = 0;
    const indices = new Set();
    if (seenGeneratorKeys.has(generator.generatorKey)) {
      issues.push({ path: base + '/actionProfileResolution/actionGenerators/' + generatorIndex, code: 'w07-generator-definition-identity', message: 'Each generator key must have one ordered definition group' });
    }
    seenGeneratorKeys.add(generator.generatorKey);
    for (const [definitionIndex, definition] of definitions.entries()) {
      const expectedKind = expectedReturnKind(generator.generatorKey);
      if (definition.generatorKey !== generator.generatorKey || indices.has(definition.definitionIndex)
        || definition.definitionIndex <= previousIndex || definition.sourceLocator.line <= previousEndLine
        || definition.endLine < definition.sourceLocator.line || definition.returnKind !== expectedKind) {
        issues.push({ path: base + '/actionProfileResolution/actionGenerators/' + generatorIndex + '/definitions/' + definitionIndex, code: 'w07-generator-definition-identity', message: 'Generator definitions must retain ordered non-overlapping source ranges and the source-declared return kind' });
      }
      if ((expectedKind === 'continuation-list' && (definition.generatedActions.length !== 0 || definition.generatedContinuations.length === 0))
        || (expectedKind === 'action-settings' && (definition.generatedContinuations.length !== 0 || definition.generatedActions.length === 0))) {
        issues.push({ path: base + '/actionProfileResolution/actionGenerators/' + generatorIndex + '/definitions/' + definitionIndex, code: 'w07-generator-return-shape', message: 'Generated rows must preserve whether the function returns a continuation list or action settings' });
      }
      for (const [actionIndex, action] of definition.generatedActions.entries()) {
        if (action.startInput) checkDeclaredInput(action.startInput, `${base}/actionProfileResolution/actionGenerators/${generatorIndex}/definitions/${definitionIndex}/generatedActions/${actionIndex}/startInput`);
        if (action.stopInput) checkDeclaredInput(action.stopInput, `${base}/actionProfileResolution/actionGenerators/${generatorIndex}/definitions/${definitionIndex}/generatedActions/${actionIndex}/stopInput`);
        for (const [edgeIndex, edge] of action.continuationEdges.entries()) {
          if (edge.inputKey) checkDeclaredInput(edge.inputKey, `${base}/actionProfileResolution/actionGenerators/${generatorIndex}/definitions/${definitionIndex}/generatedActions/${actionIndex}/continuationEdges/${edgeIndex}/inputKey`);
        }
      }
      for (const [edgeIndex, edge] of definition.generatedContinuations.entries()) {
        if (edge.inputKey) checkDeclaredInput(edge.inputKey, `${base}/actionProfileResolution/actionGenerators/${generatorIndex}/definitions/${definitionIndex}/generatedContinuations/${edgeIndex}/inputKey`);
      }
      indices.add(definition.definitionIndex);
      previousIndex = definition.definitionIndex;
      previousEndLine = definition.endLine;
    }
    const lastDefinition = definitions.at(-1);
    if (!lastDefinition || generator.effectiveDefinitionIndex !== lastDefinition.definitionIndex) {
      issues.push({ path: base + '/actionProfileResolution/actionGenerators/' + generatorIndex + '/effectiveDefinitionIndex', code: 'w07-generator-effective-definition', message: 'The effective generator definition must be the final ordered source definition' });
    } else {
      effectiveDefinitions.set(generator.generatorKey, lastDefinition);
    }
  }
  let generatedActionSettingsCount = 0;
  let generatedContinuationEdgeCount = 0;
  const actionRows = [
    ...(resolution.localActions ?? []),
    ...(resolution.fallbackActions ?? [])
  ];
  const actionRowsByName = new Map();
  for (const [index, action] of actionRows.entries()) {
    const rows = actionRowsByName.get(action.action) ?? [];
    rows.push(action);
    actionRowsByName.set(action.action, rows);
    if (!action.sourceRange || !action.rawSource?.sourceLocator
      || action.sourceRange.path !== action.rawSource.sourceLocator.path
      || action.rawSource.sourceLocator.line < action.sourceRange.line
      || action.rawSource.sourceLocator.line > action.sourceRange.endLine) {
      issues.push({ path: `${base}/actionProfileResolution/${index < resolution.localActions.length ? 'localActions' : 'fallbackActions'}/${index < resolution.localActions.length ? index : index - resolution.localActions.length}/sourceRange`, code: 'w07-action-owner-range', message: 'Each declared action row must retain a source range containing its raw action locator' });
    }
  }
  const actionKeys = new Set(actionRowsByName.keys());
  const seenCallsites = new Set();
  for (const [bindingIndex, binding] of (resolution.generatorBindings ?? []).entries()) {
    const definition = effectiveDefinitions.get(binding.generatorKey);
    const expectedKind = expectedReturnKind(binding.generatorKey);
    const callsiteKey = [binding.generatorKey, binding.callsite.sourceLocator.path, binding.callsite.sourceLocator.line, binding.callsite.sourceLocator.fieldPath].join('\u0000');
    if (seenCallsites.has(callsiteKey)) {
      issues.push({ path: base + '/actionProfileResolution/generatorBindings/' + bindingIndex, code: 'w07-generator-binding-duplicate', message: 'Generator callsite bindings must be unique by source location and function' });
    }
    seenCallsites.add(callsiteKey);
    if (!definition || binding.returnKind !== expectedKind || definition.returnKind !== expectedKind
      || !actionKeys.has(binding.ownerAction)) {
      issues.push({ path: base + '/actionProfileResolution/generatorBindings/' + bindingIndex, code: 'w07-generator-definition-binding', message: 'Each generator callsite must bind the effective definition, return kind and a declared owner action' });
      continue;
    }
    const ownerRows = actionRowsByName.get(binding.ownerAction) ?? [];
    const ownerRange = ownerRows.length === 1 ? ownerRows[0].sourceRange : undefined;
    const callsite = binding.callsite.sourceLocator;
    const ownerRangeContainsCallsite = ownerRange
      && jsonEqual(binding.ownerActionRange, ownerRange)
      && ownerRange.sourceRef?.sourceId === callsite.sourceRef?.sourceId
      && ownerRange.sourceRef?.gameReleaseId === callsite.sourceRef?.gameReleaseId
      && ownerRange.path === callsite.path
      && callsite.line >= ownerRange.line
      && callsite.line <= ownerRange.endLine;
    if (!ownerRangeContainsCallsite) {
      issues.push({ path: base + '/actionProfileResolution/generatorBindings/' + bindingIndex + '/ownerActionRange', code: 'w07-generator-owner-range', message: 'A generator callsite must fall within the exact same-release source range of its declared owner action' });
    }
    if (binding.assignedActionKey !== assignedKeys[binding.generatorKey]) {
      issues.push({ path: base + '/actionProfileResolution/generatorBindings/' + bindingIndex + '/assignedActionKey', code: 'w07-generator-assigned-action', message: 'The generator assignment must preserve the source-declared action or continuation slot identity' });
    }
    if (expectedKind === 'continuation-list') {
      generatedContinuationEdgeCount += definition.generatedContinuations.length;
    } else {
      if (!definition.generatedActions.some((action) => action.actionKey === binding.assignedActionKey)
        || !actionKeys.has(binding.assignedActionKey)) {
        issues.push({ path: base + '/actionProfileResolution/generatorBindings/' + bindingIndex + '/assignedActionKey', code: 'w07-generator-assigned-action', message: 'An action-settings generator assignment must match its declared generated action' });
      }
      generatedActionSettingsCount += definition.generatedActions.length;
      generatedContinuationEdgeCount += definition.generatedActions.reduce((total, action) => total + action.continuationEdges.length, 0);
    }
  }
  for (const [index, edge] of (record.payload.actionContinuations ?? []).entries()) {
    checkDeclaredInput(edge.inputKey, `${base}/actionContinuations/${index}/inputKey`);
    if (!actionKeys.has(edge.fromAction) || !actionKeys.has(edge.toAction)) {
      issues.push({ path: `${base}/actionContinuations/${index}`, code: 'w07-action-target-resolution', message: 'Literal continuation endpoints must resolve to declared actions in this weapon' });
    }
  }
  for (const [generatorIndex, generator] of (resolution.actionGenerators ?? []).entries()) {
    for (const [definitionIndex, definition] of (generator.definitions ?? []).entries()) {
      for (const [actionIndex, action] of definition.generatedActions.entries()) {
        if (!actionKeys.has(action.actionKey)) {
          issues.push({ path: `${base}/actionProfileResolution/actionGenerators/${generatorIndex}/definitions/${definitionIndex}/generatedActions/${actionIndex}/actionKey`, code: 'w07-action-target-resolution', message: 'Generated action settings must bind to a declared weapon action slot' });
        }
        for (const [edgeIndex, edge] of action.continuationEdges.entries()) {
          if (!actionKeys.has(edge.actionKey)) {
            issues.push({ path: `${base}/actionProfileResolution/actionGenerators/${generatorIndex}/definitions/${definitionIndex}/generatedActions/${actionIndex}/continuationEdges/${edgeIndex}/actionKey`, code: 'w07-action-target-resolution', message: 'Generated continuation targets must resolve to declared actions in this weapon' });
          }
        }
      }
      for (const [edgeIndex, edge] of definition.generatedContinuations.entries()) {
        if (!actionKeys.has(edge.actionKey)) {
          issues.push({ path: `${base}/actionProfileResolution/actionGenerators/${generatorIndex}/definitions/${definitionIndex}/generatedContinuations/${edgeIndex}/actionKey`, code: 'w07-action-target-resolution', message: 'Generated continuation targets must resolve to declared actions in this weapon' });
        }
      }
    }
  }
  const expectedCounts = {
    localActionCount: resolution.localActions.length,
    fallbackActionCount: resolution.fallbackActions.length,
    profileBindingCount: boundProfiles.reduce((total, profile) => total + (profile.payload.sourceBindings?.length ?? 0), 0),
    literalContinuationEdgeCount: (record.payload.actionContinuations ?? []).length,
    generatedActionSettingsCount,
    generatedContinuationEdgeCount,
    inputEntryCount: resolution.inputSetup.inputEntries.length
  };
  for (const [field, expected] of Object.entries(expectedCounts)) {
    if (counts[field] !== expected) {
      issues.push({ path: `${base}/actionProfileResolution/staticClosure/${field}`, code: 'w07-action-closure-count', message: `Static closure count must match its declared source rows (${expected})` });
    }
  }
}

function validateW07ArmorClass(record, base, issues) {
  const sourceStatic = record.payload.sourceStatic;
  if (sourceStatic && record.payload.classKey !== undefined && sourceStatic.classKey !== record.payload.classKey) {
    issues.push({ path: `${base}/sourceStatic/classKey`, code: "w07-armor-class-identity", message: "The static enum identity must match the armor-class record key" });
  }
  if (sourceStatic) {
    const rawKey = sourceStatic.enumRawValue.match(/^(['"])([A-Za-z0-9_]+)\1$/u)?.[2];
    if (!rawKey || rawKey !== sourceStatic.classKey) {
      issues.push({ path: `${base}/sourceStatic/enumRawValue`, code: 'w07-armor-class-enum-binding', message: 'Static armor identity must preserve the exact quoted class declaration matching classKey' });
    }
  }
}

function validateW07StatCurve(record, base, issues) {
  const payload = record.payload;
  if (!hasOwn(payload, "callsiteLocators")) return;
  if (payload.inputUnit !== "ratio" || payload.panelInputRange?.status !== "not-applicable") {
    issues.push({ path: base, code: "w07-curve-input-axis", message: "W07 profile curves use normalized internal t and have no direct panel input range" });
  }
  if (payload.knots.length !== 2) {
    issues.push({ path: `${base}/knots`, code: "w07-curve-endpoints", message: "W07 raw profile projection retains exactly the two proven source endpoints" });
  } else {
    for (const [index, expectedInput] of ["0", "1"].entries()) {
      const knot = payload.knots[index];
      if (knot.input !== expectedInput || knot.sourceOrdinal !== index + 1 || knot.rawEndpoint !== knot.output
        || (index > 0 && compareDecimal(payload.knots[index - 1].output, knot.output) === 0 && payload.knots[index - 1].rawEndpoint !== knot.rawEndpoint)) {
        issues.push({ path: `${base}/knots/${index}`, code: "w07-curve-endpoint-binding", message: "Each normalized endpoint must preserve its matching ordinal raw value" });
      }
    }
  }
  if (payload.interpolation.value !== "linear" || payload.edgePolicy.value !== "extrapolate"
    || payload.edgePolicy.scope !== "math.lerp function only") {
    issues.push({ path: base, code: "w07-curve-interpolation-policy", message: "Only the pinned linear interpolation and local math.lerp extrapolation behavior are represented" });
  }
}

function validateW07StatDefinition(record, base, recordMap, issues) {
  const payload = record.payload;
  if (!payload.curveMapping) return;
  validateW07CurveMapping(payload.curveMapping, `${base}/curveMapping`, issues, payload.theoreticalInputRange);
  if (payload.panelInputRange.status !== "not-applicable") {
    issues.push({ path: `${base}/panelInputRange`, code: "w07-stat-panel-range", message: "The W07 curve parameter is internal and is not a player panel range" });
  }
  if (payload.obtainableInputRange.status !== "unknown" || payload.obtainableInputRange.reasonCode !== "NOT_EXPOSED_BY_SOURCE") {
    issues.push({ path: `${base}/obtainableInputRange`, code: "w07-stat-obtainable-range", message: "The backend item-rating range is not exposed by the selected Source paths" });
  }
  if (!payload.rangeEvidence) {
    issues.push({ path: `${base}/rangeEvidence`, code: "w07-stat-range-evidence", message: "Checked Source paths and the server-side boundary must accompany an unexposed item range" });
  }
  const curve = recordMap.get(recordKey(payload.curveRef.recordId, payload.curveRef.gameReleaseId));
  if (!curve || curve.kind !== "stat-curve" || curve.gameReleaseId !== record.gameReleaseId
    || curve.payload.inputUnit !== "ratio") {
    issues.push({ path: `${base}/curveRef`, code: "w07-stat-curve-binding", message: "A W07 normalized profile mapping must reference a same-release ratio-axis stat curve" });
  }
}
function sourceProfileKeyFromLiteral(rawValue) {
  let token = String(rawValue);
  const quoted = token.match(/^(['"])(.*)\1$/);
  if (quoted) token = quoted[2];
  else if (/^['"]|['"]$/.test(token)) return undefined;
  if (/^[A-Za-z0-9_]+$/.test(token)) return token;
  return token.match(/^(?:DamageProfileTemplates|damage_profiles)\.([A-Za-z0-9_]+)$/)?.[1];
}
function validateRawDamageProfileProvenance(record, sourceMap, recordMap, issues, base) {
  const raw = record.payload.rawSourceDefinition;
  if (!raw) return;
  const checkSource = (sourceRef, sourcePath, pointer) => {
    const key = sourceRef && sourceRef.gameReleaseId + String.fromCharCode(0) + sourceRef.sourceId;
    const source = key && sourceMap.get(key);
    if (!source || sourceRef.gameReleaseId !== record.gameReleaseId || source.sourceKind !== 'public-code'
      || source.path !== sourcePath
      || !record.sourceRefs.some((link) => link.sourceId === sourceRef.sourceId && link.gameReleaseId === sourceRef.gameReleaseId)) {
      issues.push({ path: pointer, code: 'damage-profile-source-provenance', message: 'Raw damage profile header and leaves must match declared same-release public-code sources and record sourceRefs' });
    }
  };
  checkSource(raw.sourceRef, raw.path, base + '/rawSourceDefinition');
  for (const [index, leaf] of raw.leaves.entries()) {
    const hasSourceRef = Object.prototype.hasOwnProperty.call(leaf, 'sourceRef');
    const hasPath = Object.prototype.hasOwnProperty.call(leaf, 'path');
    if (hasSourceRef !== hasPath) {
      issues.push({ path: base + '/rawSourceDefinition/leaves/' + index, code: 'damage-profile-source-provenance', message: 'A raw profile leaf source override must provide both sourceRef and path' });
    } else if (hasSourceRef) {
      checkSource(leaf.sourceRef, leaf.path, base + '/rawSourceDefinition/leaves/' + index);
    }
  }
  const parentLeaf = raw.leaves.find((leaf) => leaf.fieldPath.endsWith('.parent_template_name'));
  if (!parentLeaf) {
    if (raw.parentProfileRef) issues.push({ path: base + '/rawSourceDefinition/parentProfileRef', code: 'damage-profile-parent-binding', message: 'A typed parent profile reference requires a raw parent_template_name declaration' });
    return;
  }
  const parentKey = sourceProfileKeyFromLiteral(parentLeaf.rawValue);
  const parentRef = raw.parentProfileRef;
  const parent = parentRef && recordMap.get(recordKey(parentRef.recordId, parentRef.gameReleaseId));
  if (!parentRef || !parent || parent.kind !== 'damage-profile' || parent.gameReleaseId !== record.gameReleaseId || parent.payload.profileKey !== parentKey) {
    issues.push({ path: base + '/rawSourceDefinition/parentProfileRef', code: 'damage-profile-parent-binding', message: 'A raw parent_template_name requires a same-release typed damage-profile reference with the matching profile key' });
  }
}
function validateW07BoostCurveSemantics(record, base, issues) {
  const raw = record.payload.rawSourceDefinition;
  if (!raw) return;
  const tableKey = 'PowerLevelSettings.boost_curves.default';
  const tableRows = Array.isArray(raw.tables) ? raw.tables : [];
  const boostTables = tableRows
    .map((table, index) => ({ table, index }))
    .filter(({ table }) => table?.tableKey === tableKey);
  const boostLeaves = (Array.isArray(raw.leaves) ? raw.leaves : []).filter((leaf) =>
    leaf.fieldPath?.endsWith('.boost_curve') && String(leaf.rawValue).replace(/^(['"])(.*)\1$/u, '$2') === tableKey);
  const pointer = `${base}/rawSourceDefinition/tables`;
  const report = (path, message) => issues.push({
    path,
    code: 'w07-boost-curve-semantics',
    message
  });

  for (const [index, table] of tableRows.entries()) {
    if (table?.curveSemantics !== undefined && table.tableKey !== tableKey) {
      report(`${pointer}/${index}/curveSemantics`, 'Only the pinned five-point damage boost table may carry W07 boost-curve semantics');
    }
  }
  if (boostLeaves.length > 0 && boostTables.length !== 1) {
    report(pointer, 'A raw reference to the default damage boost curve requires exactly one typed table projection');
  }
  if (boostTables.length > 1) {
    report(pointer, 'The pinned default damage boost curve may be projected only once per damage profile');
  }

  for (const { table, index } of boostTables) {
    const tablePointer = `${pointer}/${index}`;
    const semantics = table.curveSemantics;
    if (!semantics) {
      report(`${tablePointer}/curveSemantics`, 'The five-point default damage boost table requires its normalized axis, interpolation and caller bounds');
      continue;
    }
    const expectedInputs = ['0', '0.25', '0.5', '0.75', '1'];
    const axis = semantics.referenceAxis ?? {};
    const caller = semantics.callerInput ?? {};
    const interpolation = semantics.interpolation ?? {};
    const knots = Array.isArray(semantics.knots) ? semantics.knots : [];
    const orderedValues = Array.isArray(table.orderedValues) ? table.orderedValues : [];
    const knotMatches = knots.length === expectedInputs.length
      && knots.every((knot, knotIndex) => knot.sourceOrdinal === knotIndex + 1
        && knot.input === expectedInputs[knotIndex]
        && orderedValues[knotIndex]?.ordinal === knotIndex + 1);
    const referenceAxisMatches = axis.min === '0' && axis.max === '1'
      && axis.minInclusive === true && axis.maxInclusive === true && axis.unit === 'ratio';
    const callerMatches = caller.min === '0' && caller.minInclusive === false
      && caller.max === '1' && caller.maxInclusive === true && caller.unit === 'ratio'
      && caller.predicate === 'finesse_boost_amount > 0'
      && caller.transform === 'math.min(finesse_boost_amount, 1)';
    const expectedLocator = (locator, line, endLine, fieldPath) => locator
      && locator.path === 'scripts/utilities/attack/damage_calculation.lua'
      && locator.line === line && locator.endLine === endLine && locator.fieldPath === fieldPath
      && locator.sourceRef?.gameReleaseId === record.gameReleaseId;
    const axisLocators = Array.isArray(axis.sourceLocators) ? axis.sourceLocators : [];
    const callerLocators = Array.isArray(caller.sourceLocators) ? caller.sourceLocators : [];
    const axisLocatorMatches = axisLocators.length === 1
      && expectedLocator(axisLocators[0], 208, 217, 'source.five_point_damage_boost_curve_indexing_and_interpolation');
    const interpolationLocatorMatches = interpolation.value === 'piecewise-linear'
      && expectedLocator(interpolation.sourceLocator, 208, 217, 'source.five_point_damage_boost_curve_indexing_and_interpolation');
    const callerLocatorMatches = callerLocators.length === 1
      && expectedLocator(callerLocators[0], 700, 704, 'source.finesse_boost_amount_cap_and_positive_amount_gate');
    const outputTableMatches = table.unit === 'ratio'
      && orderedValues.length === expectedInputs.length
      && orderedValues.every((point, pointIndex) => point.ordinal === pointIndex + 1
        && /^-?\d+(?:\.\d+)?$/u.test(String(point.rawValue))
        && typeof point.decimal === 'string'
        && /^-?\d+(?:\.\d+)?$/u.test(point.decimal)
        && compareDecimal(String(point.rawValue), point.decimal) === 0);
    if (!referenceAxisMatches || !callerMatches || !knotMatches
      || !axisLocatorMatches || !interpolationLocatorMatches || !callerLocatorMatches
      || !outputTableMatches) {
      report(`${tablePointer}/curveSemantics`, 'The boost curve must preserve five ordered ratio outputs, the exact normalized reference axis, linear interpolation, and the separately evidenced (0,1] caller gate');
    }
    if (table.sourceLocator?.path !== 'scripts/settings/damage/power_level_settings.lua'
      || !table.sourceLocator.fieldPath?.startsWith('power_level_settings.boost_curves.default.')) {
      report(`${tablePointer}/sourceLocator`, 'The default boost table must retain its pinned PowerLevelSettings source locator');
    }
  }
}
function validateW07StatSemanticsCoverage(record, base, issues) {
  const sourceGroups = record.payload.statBindings ?? [];
  const semanticGroups = record.payload.statTableSemantics;
  const sourceByStat = new Map();
  const semanticsByStat = new Map();
  for (const [index, group] of sourceGroups.entries()) {
    const existing = sourceByStat.get(group.statKey) ?? [];
    existing.push({ group, index });
    sourceByStat.set(group.statKey, existing);
  }
  if (!Array.isArray(semanticGroups)) {
    issues.push({ path: `${base}/statTableSemantics`, code: 'w07-stat-semantics-coverage', message: 'A weapon with source stat bindings must type every stat-property binding in statTableSemantics' });
    return;
  }
  for (const [index, group] of semanticGroups.entries()) {
    const existing = semanticsByStat.get(group.statKey) ?? [];
    existing.push({ group, index });
    semanticsByStat.set(group.statKey, existing);
  }
  const statKeys = new Set([...sourceByStat.keys(), ...semanticsByStat.keys()]);
  for (const statKey of statKeys) {
    const sourceMatches = sourceByStat.get(statKey) ?? [];
    const semanticMatches = semanticsByStat.get(statKey) ?? [];
    const pointer = semanticMatches.length === 1
      ? `${base}/statTableSemantics/${semanticMatches[0].index}/bindings`
      : `${base}/statTableSemantics`;
    const expectedProperties = new Set(sourceMatches.flatMap(({ group }) => group.bindings.map((binding) => binding.property)));
    const semanticRows = semanticMatches.flatMap(({ group }) => group.bindings.map((binding) => binding.property));
    const actualProperties = new Set(semanticRows);
    const hasDuplicateProperties = actualProperties.size !== semanticRows.length;
    const isExact = sourceMatches.length === 1 && semanticMatches.length === 1
      && !hasDuplicateProperties
      && expectedProperties.size === actualProperties.size
      && [...expectedProperties].every((property) => actualProperties.has(property));
    if (!isExact) {
      issues.push({ path: pointer, code: 'w07-stat-semantics-coverage', message: 'Each W07 stat key must have exactly one semantic group covering every distinct source binding property exactly once, with no extra properties' });
    }
  }
}
function validateW07WeaponSemantics(contract, issues) {
  const sourceMap = new Map(contract.sourceRefs.map((source) => [`${source.gameReleaseId}\u0000${source.sourceId}`, source]));
  const recordMap = new Map(contract.records.map((candidate) => [recordKey(candidate.recordId, candidate.gameReleaseId), candidate]));
  for (const [index, record] of contract.records.entries()) {
    const base = `/records/${index}/payload`;
    const hasW07SourceLocators = ['weapon', 'attack-profile', 'damage-profile'].includes(record.kind)
      || (record.kind === 'stat-curve' && hasOwn(record.payload, 'callsiteLocators'))
      || (record.kind === 'stat-definition' && hasOwn(record.payload, 'curveMapping'))
      || (record.kind === 'armor-class' && hasOwn(record.payload, 'sourceStatic'))
      || (record.kind === 'target-profile' && hasOwn(record.payload, 'sourceStatic'))
      || (record.kind === 'modifier-rule' && hasOwn(record.payload, 'sourceBranchModel'));
    if (hasW07SourceLocators) validateW07SourceLocators(record, sourceMap, issues);
    if (record.kind === 'weapon') validateW07WeaponActionClosure(record, base, contract, recordMap, issues);
    if (record.kind === 'weapon' && hasOwn(record.payload, 'panelPreviewRules')) validateW07PanelPreviewRules(record, base, issues);
    if (record.kind === 'attack-profile') validateW07ActionResolution(record, base, recordMap, contract, issues);
    if (record.kind === 'armor-class' && record.payload.sourceStatic) validateW07ArmorClass(record, base, issues);
    if (record.kind === 'target-profile' && record.payload.sourceStatic) validateW07StaticTarget(record, base, recordMap, issues);
    if (record.kind === 'modifier-rule' && record.payload.sourceBranchModel) validateW07ModifierRule(record, base, recordMap, issues);
    if (record.kind === 'stat-curve' && hasOwn(record.payload, 'callsiteLocators')) validateW07StatCurve(record, base, issues);
    if (record.kind === 'stat-definition' && hasOwn(record.payload, 'curveMapping')) validateW07StatDefinition(record, base, recordMap, issues);
    if (record.kind === 'weapon' && Array.isArray(record.payload.statTableSemantics)) {
      for (const [statIndex, stat] of record.payload.statTableSemantics.entries()) {
        for (const [bindingIndex, binding] of stat.bindings.entries()) {
          if (binding.quantityKind === 'movement-curve-modifier' && binding.unit?.status !== 'not-applicable') {
            issues.push({
              path: `${base}/statTableSemantics/${statIndex}/bindings/${bindingIndex}/unit`,
              code: 'w07-stat-semantic-unit',
              message: 'A movement-curve property name is a selector, so its table-value unit must be not-applicable; the bound trait t range remains separately typed'
            });
          }
        }
      }
    }
    const hasW07WeaponSemantics = record.kind === 'weapon'
      && (hasOwn(record.payload, 'panelPreviewRules')
        || Array.isArray(record.payload.actionProfileResolution?.actionGenerators));
    if (hasW07WeaponSemantics && Array.isArray(record.payload.statBindings)) {
      validateW07StatSemanticsCoverage(record, base, issues);
    }
    if (record.kind === 'weapon' && Array.isArray(record.payload.statBindings)) {
      const seenStatKeys = new Set();
      for (const [statIndex, statBinding] of record.payload.statBindings.entries()) {
        const statBase = `${base}/statBindings/${statIndex}`;
        if (seenStatKeys.has(statBinding.statKey)) {
          issues.push({ path: `${statBase}/statKey`, code: 'duplicate-weapon-stat-binding', message: 'A weapon stat key may have one source binding group only' });
        }
        seenStatKeys.add(statBinding.statKey);
        const seenBindings = new Set();
        for (const [bindingIndex, binding] of statBinding.bindings.entries()) {
          const bindingBase = `${statBase}/bindings/${bindingIndex}`;
          const bindingKey = `${binding.property}\u0000${binding.action ?? ''}\u0000${binding.profileKey ?? ''}\u0000${binding.armorClass ?? ''}`;
          if (seenBindings.has(bindingKey)) {
            issues.push({ path: bindingBase, code: 'duplicate-weapon-stat-property-binding', message: 'A weapon stat binding cannot repeat the same property/action/profile/armor context' });
          }
          seenBindings.add(bindingKey);
          if (binding.traitParameterRange.status === 'known'
            && compareDecimal(binding.traitParameterRange.min, binding.traitParameterRange.max) > 0) {
            issues.push({ path: `${bindingBase}/traitParameterRange`, code: 'weapon-stat-range-inverted', message: 'Raw trait parameter minimum cannot exceed maximum' });
          }
          if (binding.curveMapping) {
            const expectedRange = binding.traitParameterRange.status === 'known'
              ? { status: 'known', min: binding.traitParameterRange.min, max: binding.traitParameterRange.max, unit: binding.traitParameterRange.unit,
                inclusive: { min: true, max: true } }
              : binding.traitParameterRange;
            validateW07CurveMapping(binding.curveMapping, `${bindingBase}/curveMapping`, issues, expectedRange);
          }
          const statFieldPrefix = `weapon_template.base_stats.${statBinding.statKey}`;
          if (binding.weaponLocator.fieldPath !== statFieldPrefix && !binding.weaponLocator.fieldPath.startsWith(`${statFieldPrefix}.`)) {
            issues.push({ path: `${bindingBase}/weaponLocator/fieldPath`, code: 'weapon-stat-source-field', message: 'Weapon stat locator must address the declared weapon base stat' });
          }
          if (binding.action) {
            const fieldSegments = binding.weaponLocator.fieldPath.split('.');
            const statKeyIndex = fieldSegments.indexOf(statBinding.statKey);
            const damageIndex = statKeyIndex >= 0 && fieldSegments[statKeyIndex + 1] === 'damage' ? statKeyIndex + 1 : -1;
            const actionMatchesPath = damageIndex >= 0 && fieldSegments[damageIndex + 1] === binding.action;
            const templateProfiles = (record.payload.attackProfileRefs ?? [])
              .map((profileRef) => recordMap.get(recordKey(profileRef.recordId, profileRef.gameReleaseId)))
              .filter((profile) => profile?.kind === 'attack-profile' && hasOwn(profile.payload, 'templateKey'));
            const actionMatchesProfile = templateProfiles.length === 0 || templateProfiles.some((profile) =>
              profile.gameReleaseId === record.gameReleaseId
              && profile.payload.action === binding.action
              && (binding.mode === undefined || profile.payload.mode === binding.mode));
            if (!actionMatchesPath || !actionMatchesProfile) {
              issues.push({ path: bindingBase + '/action', code: 'weapon-stat-action-binding', message: 'A stat action binding must address an exact supported action segment in the weapon template field path' });
            }
          }
          const traitFieldPath = binding.traitLocator.fieldPath;
          const traitRoot = binding.traitTemplateKey;
          if (!traitFieldPath.endsWith('.' + binding.traitTemplateKey)
            && traitFieldPath !== traitRoot && !traitFieldPath.startsWith(traitRoot + '.')) {
            issues.push({ path: bindingBase + '/traitLocator/fieldPath', code: 'weapon-stat-trait-field', message: 'Trait locator must address the declared trait template key' });
          }
          for (const locatorField of ['weaponLocator', 'traitLocator']) {
            const locator = binding[locatorField];
            const source = sourceMap.get(`${locator.sourceRef.gameReleaseId}\u0000${locator.sourceRef.sourceId}`);
            if (!source) continue;
            if (locator.sourceRef.gameReleaseId !== record.gameReleaseId || source.sourceKind !== 'public-code' || source.path !== locator.path) {
              issues.push({ path: `${bindingBase}/${locatorField}`, code: 'weapon-stat-locator-provenance', message: 'Stat mapping locators must match a same-release public-code source path' });
            }
            if (!record.sourceRefs.some((sourceLink) => sourceLink.sourceId === locator.sourceRef.sourceId && sourceLink.gameReleaseId === locator.sourceRef.gameReleaseId)) {
              issues.push({ path: `${bindingBase}/${locatorField}/sourceRef`, code: 'weapon-stat-locator-unlisted', message: 'Stat mapping sources must also be declared by the weapon record' });
            }
          }
          for (const [claimIndex, claimRef] of (binding.claimRefs ?? []).entries()) {
            const claim = recordMap.get(recordKey(claimRef.recordId, claimRef.gameReleaseId));
            if (!claim || claim.kind !== 'claim') continue;
            const contextWeaponRef = claim.payload.context?.weaponRef;
            if (claim.gameReleaseId !== record.gameReleaseId
              || claim.payload.property !== binding.property
              || claim.payload.context?.weaponStat !== statBinding.statKey
              || (binding.mode !== undefined && claim.payload.context?.attackMode !== binding.mode)
              || (binding.profileKey !== undefined && claim.payload.context?.profile !== binding.profileKey)
              || (binding.armorClass !== undefined && claim.payload.context?.armorClass !== binding.armorClass)
              || contextWeaponRef?.recordId !== record.recordId
              || contextWeaponRef?.gameReleaseId !== record.gameReleaseId) {
              issues.push({ path: `${bindingBase}/claimRefs/${claimIndex}`, code: 'weapon-stat-claim-binding', message: 'Mapped claims must match the stat key, property and owning weapon context' });
            }
          }
        }
      }
    }
    if (record.kind === 'claim' && record.payload.context?.damageProfileRef) {
      const ref = record.payload.context.damageProfileRef;
      const profile = recordMap.get(recordKey(ref.recordId, ref.gameReleaseId));
      if (!profile || profile.kind !== 'damage-profile' || profile.payload.profileKey !== record.payload.context.profile) {
        issues.push({ path: base + '/context/damageProfileRef', code: 'claim-damage-profile-binding', message: 'Claim damageProfileRef must identify the profile named by its existing context.profile' });
      }
    }
    if (record.kind === 'damage-profile' && record.payload.rawSourceDefinition) {
      validateRawDamageProfileProvenance(record, sourceMap, recordMap, issues, base);
      validateW07BoostCurveSemantics(record, base, issues);
    }
    if (record.kind === 'attack-profile') {
      for (const [bindingIndex, sticky] of (record.payload.stickyBindings ?? []).entries()) {
        if (sticky.state !== 'defined') continue;
        const definition = sticky.definition;
        if (definition.duration.unit !== 's') {
          issues.push({ path: base + '/stickyBindings/' + bindingIndex + '/definition/duration/unit', code: 'sticky-duration-unit', message: 'Sticky duration is measured in seconds' });
        }
        if (definition.instances.unit !== 'instance-count') {
          issues.push({ path: base + '/stickyBindings/' + bindingIndex + '/definition/instances/unit', code: 'sticky-instance-unit', message: 'Sticky instances are measured as an instance count' });
        }
        const curve = definition.movementCurve;
        if (curve.startModifier.unit !== 'ratio') {
          issues.push({ path: base + '/stickyBindings/' + bindingIndex + '/definition/movementCurve/startModifier/unit', code: 'sticky-curve-modifier-unit', message: 'Sticky movement start modifier must use ratio units' });
        }
        for (const [pointIndex, point] of curve.points.entries()) {
          if (point.t.unit !== 's') {
            issues.push({ path: base + '/stickyBindings/' + bindingIndex + '/definition/movementCurve/points/' + pointIndex + '/t/unit', code: 'sticky-curve-time-unit', message: 'Sticky movement curve t coordinates are measured in seconds' });
          }
          if (point.modifier.unit !== 'ratio') {
            issues.push({ path: base + '/stickyBindings/' + bindingIndex + '/definition/movementCurve/points/' + pointIndex + '/modifier/unit', code: 'sticky-curve-modifier-unit', message: 'Sticky movement curve modifiers must use ratio units' });
          }
        }
      }
    }
    if (record.kind === 'attack-profile' && Array.isArray(record.payload.sourceBindings)) {
      const listedProfiles = record.payload.damageProfileRefs ?? [];
      for (const [sourceBindingIndex, sourceBinding] of record.payload.sourceBindings.entries()) {
        const expectedKey = sourceProfileKeyFromLiteral(sourceBinding.rawValue);
        const typedProfile = recordMap.get(recordKey(sourceBinding.profileRef.recordId, sourceBinding.profileRef.gameReleaseId));
        const isListed = listedProfiles.some((profileRef) =>
          profileRef.recordId === sourceBinding.profileRef.recordId
          && profileRef.gameReleaseId === sourceBinding.profileRef.gameReleaseId);
        if (!typedProfile || typedProfile.kind !== 'damage-profile'
          || typedProfile.gameReleaseId !== record.gameReleaseId
          || !expectedKey
          || typedProfile.payload.profileKey !== expectedKey
          || !isListed) {
          issues.push({ path: base + '/sourceBindings/' + sourceBindingIndex + '/profileRef', code: 'attack-source-binding-profile', message: 'An action source binding profileRef must match its pinned raw profile key and appear in damageProfileRefs' });
        }
      }
    }
    const isW07RawTableOwner = (record.kind === 'weapon' && Array.isArray(record.payload.statTables))
      || (record.kind === 'damage-profile' && hasOwn(record.payload, 'rawSourceDefinition'));
    if (isW07RawTableOwner) {
      const tableCollections = record.kind === 'weapon'
        ? (record.payload.statTables ?? []).flatMap((table, tableIndex) => (table.properties ?? []).map((property, propertyIndex) => ({
          points: property.orderedValues ?? [],
          path: base + '/statTables/' + tableIndex + '/properties/' + propertyIndex + '/orderedValues'
        })))
        : (record.payload.rawSourceDefinition?.tables ?? []).map((table, tableIndex) => ({
          points: table.orderedValues ?? [],
          path: base + '/rawSourceDefinition/tables/' + tableIndex + '/orderedValues'
        }));
      for (const collection of tableCollections) {
        for (const [pointIndex, point] of collection.points.entries()) {
          const rawValue = String(point.rawValue);
          const hasDecimal = Object.prototype.hasOwnProperty.call(point, 'decimal');
          const rawIsDecimal = /^-?\d+(?:\.\d+)?$/.test(rawValue);
          if (hasDecimal && (!rawIsDecimal || compareDecimal(rawValue, point.decimal) !== 0)) {
            issues.push({ path: collection.path + '/' + pointIndex + '/decimal', code: 'w07-raw-decimal-binding', message: 'A typed table decimal must match a numeric raw value and cannot decorate a nonnumeric token' });
          }
        }
      }
    }
    if (record.kind === 'attack-profile' && hasOwn(record.payload, 'templateKey')) {
      const linkedWeapons = contract.records.filter((weapon) => weapon.kind === 'weapon'
        && weapon.gameReleaseId === record.gameReleaseId
        && weapon.payload.familyId === record.payload.familyId
        && weapon.payload.markId === record.payload.markId
        && weapon.payload.templateKey === record.payload.templateKey
        && weapon.payload.attackProfileRefs.some((ref) => ref.recordId === record.recordId && ref.gameReleaseId === record.gameReleaseId));
      if (linkedWeapons.length !== 1) {
        issues.push({ path: `${base}/templateKey`, code: 'attack-profile-template-binding', message: 'A templateKey attack profile must be referenced by exactly one same-release weapon with matching family, mark and template keys' });
      }
    }
    if (record.kind !== 'claim' || !hasOwn(record.payload, 'displayValue')) continue;
    const { value, displayValue, displayFormat } = record.payload;
    if (value?.status !== 'known' || typeof value.decimal !== 'string' || !Number.isFinite(Number(value.decimal))) {
      issues.push({ path: `${base}/displayValue`, code: 'display-value-source', message: 'A formatted display value requires a known finite numeric claim value' });
      continue;
    }
    const numeric = Number(value.decimal);
    let expectedDecimal;
    let expectedUnit;
    if (displayFormat === 'fixed-2' || displayFormat === 'fixed-2-signed') {
      expectedDecimal = numeric.toFixed(2);
      expectedUnit = value.unit;
    } else if (displayFormat === 'percentage-fixed-2' && value.unit === 'ratio') {
      expectedDecimal = (numeric * 100).toFixed(2);
      expectedUnit = 'percent';
    } else if (displayFormat === 'multiplier-percent-fixed-2-signed' && value.unit === 'ratio') {
      expectedDecimal = ((numeric - 1) * 100).toFixed(2);
      expectedUnit = 'percent';
    } else if (displayFormat === 'floor-fixed-2') {
      expectedDecimal = Math.floor(numeric).toFixed(2);
      expectedUnit = value.unit;
    } else {
      issues.push({ path: `${base}/displayFormat`, code: 'display-format-unit', message: 'Display format is incompatible with the source value unit' });
      continue;
    }
    if (displayValue.unit !== expectedUnit) {
      issues.push({ path: `${base}/displayValue/unit`, code: 'display-unit-mismatch', message: `Display unit must be ${expectedUnit} for ${displayFormat}` });
    }
    if (displayValue.decimal !== expectedDecimal) {
      issues.push({ path: `${base}/displayValue/decimal`, code: 'display-value-mismatch', message: `Display decimal must be ${expectedDecimal} for ${displayFormat}` });
    }
  }
}
function validateReferences(contract, releaseMap, recordMap, sourceMap, issues) {
  for (const [index, record] of contract.records.entries()) {
    const base = `/records/${index}`;
    for (const { ref, field } of getAllRecordRefs(record)) {
      const target = recordMap.get(recordKey(ref.recordId, ref.gameReleaseId));
      if (!target) { issues.push({ path: base, code: 'dangling-record-ref', message: `Unknown record ref ${ref.gameReleaseId}:${ref.recordId}` }); continue; }
      const wrongKind = expectedKindIssue(field, target.kind);
      if (wrongKind) issues.push({ path: base, code: 'wrong-kind-ref', message: wrongKind });
      if (target.gameReleaseId !== record.gameReleaseId) validateCompatibility(ref.compatibilityRef, record.gameReleaseId, target.gameReleaseId, contract, releaseMap, issues, base);
      else if (ref.compatibilityRef) issues.push({ path: base, code: 'unneeded-compatibility', message: 'Same-release record refs must not carry compatibilityRef' });
    }
    const sourceLinks = collectSourceLinks(record);
    for (const link of sourceLinks) {
      if (link.gameReleaseId !== record.gameReleaseId && link.compatibilityRef) validateCompatibility(link.compatibilityRef, record.gameReleaseId, link.gameReleaseId, contract, releaseMap, issues, base);
    }
  }
  validateReferenceKinds(contract, recordMap, issues);
  validateReferenceCycles(contract, recordMap, issues);
}

function validateReferenceKinds(contract, recordMap, issues) {
  for (const [index, record] of contract.records.entries()) {
    walkObjects(record.payload, (item, field) => {
      if (typeof item.recordId !== 'string' || typeof item.gameReleaseId !== 'string') return;
      const target = recordMap.get(recordKey(item.recordId, item.gameReleaseId));
      if (!target) return;
      const wrong = expectedKindIssue(field, target.kind);
      if (wrong && !issues.some((issue) => issue.code === 'wrong-kind-ref' && issue.message === wrong)) issues.push({ path: `/records/${index}/payload`, code: 'wrong-kind-ref', message: wrong });
    });
  }
}

function validateReferenceCycles(contract, recordMap, issues) {
  const visiting = new Set(); const visited = new Set();
  const visit = (record) => {
    const key = recordKey(record.recordId, record.gameReleaseId);
    if (visiting.has(key)) { issues.push({ path: `/records`, code: 'reference-cycle', message: `Reference dependency cycle includes ${record.gameReleaseId}:${record.recordId}` }); return; }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const { ref } of getRecordRefEdges(record)) {
      const target = recordMap.get(recordKey(ref.recordId, ref.gameReleaseId));
      if (target) visit(target);
    }
    visiting.delete(key); visited.add(key);
  };
  for (const record of contract.records) visit(record);
}

function validateCompatibilityAndChanges(contract, releaseMap, recordMap, issues) {
  for (const [index, record] of contract.records.entries()) {
    const base = `/records/${index}`;
    if (record.kind === 'release-compatibility') {
      const { fromGameReleaseId, toGameReleaseId } = record.payload;
      const from = releaseMap.get(fromGameReleaseId); const to = releaseMap.get(toGameReleaseId);
      if (!from || !to || fromGameReleaseId === toGameReleaseId || toGameReleaseId !== record.gameReleaseId || from.releaseOrder >= to.releaseOrder) {
        issues.push({ path: `${base}/payload`, code: 'invalid-compatibility', message: 'Compatibility must compare a declared earlier release to this record release' });
      }
    }
    if (record.kind === 'game-change') {
      const compare = record.payload.comparison;
      const from = releaseMap.get(compare.fromGameReleaseId); const to = releaseMap.get(compare.toGameReleaseId);
      if (!from || !to || compare.fromGameReleaseId === compare.toGameReleaseId || to.gameReleaseId !== record.gameReleaseId || from.releaseOrder >= to.releaseOrder) {
        issues.push({ path: `${base}/payload/comparison`, code: 'invalid-change-release', message: 'Game change must compare a declared earlier release to its declared target release' });
      }
      else {
        for (const [key, actual] of [['fromGameVersion', from.gameVersion], ['toGameVersion', to.gameVersion], ['fromGameBuild', from.gameBuild], ['toGameBuild', to.gameBuild], ['fromSnapshotId', from.snapshot.snapshotId], ['toSnapshotId', to.snapshot.snapshotId]]) {
          if (compare[key] !== actual) issues.push({ path: `${base}/payload/comparison/${key}`, code: 'change-comparison-mismatch', message: `Comparison ${key} must match game release metadata` });
        }
        if (from.snapshot.snapshotId === to.snapshot.snapshotId
          || (from.snapshot.manifestSha256 === to.snapshot.manifestSha256 && from.snapshot.contentSha256 === to.snapshot.contentSha256)) {
          issues.push({ path: `${base}/payload/comparison`, code: 'invalid-change-snapshot', message: 'Game change must compare distinct snapshots with different manifest or content digests' });
        }
      }
      if (record.payload.operation === 'modified') for (const [fieldIndex, field] of record.payload.changedFields.entries()) {
        if (typedValueEqual(field.before, field.after)) issues.push({ path: `${base}/payload/changedFields/${fieldIndex}`, code: 'unchanged-game-change-field', message: 'A modified game-change field must have distinct before and after values' });
      }
      const entity = record.payload.entityRef && recordMap.get(recordKey(record.payload.entityRef.recordId, record.payload.entityRef.gameReleaseId));
      if (entity && entity.gameReleaseId !== compare.toGameReleaseId) issues.push({ path: `${base}/payload/entityRef`, code: 'change-entity-release', message: 'Game change entity must be resolved at the target game release' });
    }
  }
}

function validateGameTestEvidence(contract, recordMap, sourceMap, issues) {
  const hasGameTestEvidence = (record, releaseId) => (record.payload.evidenceRefs ?? []).some((ref) => {
    const evidence = recordMap.get(recordKey(ref.recordId, ref.gameReleaseId));
    if (!evidence || evidence.kind !== 'evidence' || evidence.gameReleaseId !== releaseId
      || evidence.payload.evidenceKind !== 'game-tested') return false;
    const sourceRef = evidence.payload.sourceRef;
    const source = sourceMap.get(`${sourceRef.gameReleaseId}\u0000${sourceRef.sourceId}`);
    return sourceRef.gameReleaseId === evidence.gameReleaseId && source?.sourceKind === 'game-test';
  });

  for (const [index, record] of contract.records.entries()) {
    const base = `/records/${index}`;
    if (record.kind === 'evidence' && record.payload.evidenceKind === 'game-tested') {
      const sourceRef = record.payload.sourceRef;
      const source = sourceMap.get(`${sourceRef.gameReleaseId}\u0000${sourceRef.sourceId}`);
      if (source?.sourceKind !== 'game-test' || sourceRef.gameReleaseId !== record.gameReleaseId) {
        issues.push({ path: `${base}/payload/sourceRef`, code: 'game-test-source-required', message: 'Game-tested evidence must identify a game-test source for its own release' });
      }
    }
    const claimRequiresGameTest = record.kind === 'claim' && record.payload.basis === 'game-tested';
    const changeRequiresGameTest = record.kind === 'game-change' && record.payload.verificationMethod === 'game-tested';
    if (claimRequiresGameTest || changeRequiresGameTest) {
      const requiredReleaseId = changeRequiresGameTest ? record.payload.comparison.toGameReleaseId : record.gameReleaseId;
      if (!hasGameTestEvidence(record, requiredReleaseId)) {
        issues.push({ path: `${base}/payload/evidenceRefs`, code: 'game-test-evidence-required', message: 'Game-tested claims and changes require game-tested evidence backed by a same-release game-test source; code-only evidence cannot support that basis' });
      }
    }
  }
}

function validateCoverageAndEmptyCollections(contract, issues) {
  const requireWhenEmpty = new Map([
    ['payload.statRefs', 'stat data'], ['payload.attackProfileRefs', 'attack-profile data'],
    ['payload.damageProfileRefs', 'damage-profile data'], ['payload.targetProfileRefs', 'target-profile data'],
    ['payload.claimRefs', 'claim data'], ['payload.evidenceRefs', 'evidence data'], ['payload.variantRefs', 'variant data'],
    ['payload.perkRefs', 'perk data'], ['payload.entries', 'catalog entries'], ['payload.knots', 'curve table'],
    ['payload.segments', 'damage segments'], ['payload.hitZones', 'target hit zones'], ['payload.damageTypes', 'armor damage types'],
    ['payload.changedFields', 'game change fields'], ['payload.tierValues', 'tier values']
  ]);
  for (const [index, record] of contract.records.entries()) {
    const base = `/records/${index}`;
    for (const [pathSuffix, label] of requireWhenEmpty) {
      const path = `/${pathSuffix.replaceAll('.', '/')}`;
      const found = pointerGet(record, path);
      if (found.exists && Array.isArray(found.value) && found.value.length === 0) {
        const covered = record.dataCoverage.missing.some((item) => item.field === path && item.reasonCode === 'NOT_IMPORTED');
        if (!covered) issues.push({ path: `${base}${path}`, code: 'empty-required-collection', message: `Empty ${label} must be explicitly marked NOT_IMPORTED in dataCoverage` });
      }
    }
  }
}

function validateReceipts(contract, releaseMap, recordMap, issues) {
  const receiptsByKey = new Map();
  for (const [index, receipt] of contract.reviewReceipts.entries()) {
    const base = `/reviewReceipts/${index}`; const key = receiptKey(receipt.target);
    if (receiptsByKey.has(key)) issues.push({ path: base, code: 'duplicate-review-receipt', message: 'Only one current receipt is allowed for each target and dimension' });
    receiptsByKey.set(key, receipt);
    if (!releaseMap.has(receipt.target.gameReleaseId)) issues.push({ path: `${base}/target/gameReleaseId`, code: 'unknown-review-release', message: 'Review target release is not declared' });
    if (!getReviewNode(contract, receipt.target)) issues.push({ path: `${base}/target`, code: 'unknown-review-target', message: 'Review receipt target does not exist' });
    const targetItem = getReviewNode(contract, receipt.target)?.item;
    const declared = targetItem?.reviewTargets?.some((target) => target.fieldPath === receipt.target.fieldPath && target.dimension === receipt.target.dimension);
    if (!declared) issues.push({ path: `${base}/target`, code: 'undeclared-review-target', message: 'Receipt must match a required field-and-dimension target' });
    const node = getReviewNode(contract, receipt.target);
    if (node) {
      const field = pointerGet(node.item, receipt.target.fieldPath);
      if (!field.exists) issues.push({ path: `${base}/target/fieldPath`, code: 'missing-review-field', message: 'Review fieldPath must resolve within the target' });
      else {
        try {
          const expected = computeReviewDigests(contract, receipt.target);
          if (receipt.targetDigest !== expected.targetDigest || receipt.dependenciesDigest !== expected.dependenciesDigest) {
            // Staleness is a state transition, not an invalid receipt shape.
          }
        } catch (error) { issues.push({ path: base, code: 'receipt-digest', message: `Cannot compute deterministic receipt digest: ${error.message}` }); }
      }
    }
    if (receipt.reviewer.kind !== 'human' || /^(?:system|automation|fixture|ai|assistant)$/iu.test(receipt.reviewer.id)) issues.push({ path: `${base}/reviewer`, code: 'non-human-reviewer', message: 'Review receipts must identify a human reviewer, not a service or fixture' });
  }
  for (const [index, record] of contract.records.entries()) {
    const base = `/records/${index}`; const derived = deriveReviewState(record, receiptsByKey, contract, issues, base);
    if (record.reviewState !== derived) issues.push({ path: `${base}/reviewState`, code: 'review-state-mismatch', message: `reviewState must be derived as ${derived} from current field/dimension receipts` });
  }
  for (const [index, tombstone] of contract.tombstones.entries()) {
    const base = `/tombstones/${index}`; const derived = deriveReviewState(tombstone, receiptsByKey, contract, issues, base);
    if (tombstone.reviewState !== derived) issues.push({ path: `${base}/reviewState`, code: 'review-state-mismatch', message: `tombstone reviewState must be derived as ${derived} from current receipts` });
  }
  return receiptsByKey;
}

function validateDeclaredReviewTargets(contract, issues) {
  for (const [listName, items] of [['records', contract.records], ['tombstones', contract.tombstones]]) {
    for (const [itemIndex, item] of (items ?? []).entries()) {
      for (const [targetIndex, target] of (item.reviewTargets ?? []).entries()) {
        const fieldPath = target?.fieldPath;
        if (typeof fieldPath !== 'string' || !fieldPath.startsWith('/') || !pointerGet(item, fieldPath).exists) {
          issues.push({
            path: `/${listName}/${itemIndex}/reviewTargets/${targetIndex}/fieldPath`,
            code: 'missing-review-field',
            message: 'Every declared review target fieldPath must resolve within its record or tombstone'
          });
        }
      }
    }
  }
}

export function validateSourceContract(contract, { schema, sourceRoot = REPO_ROOT } = {}) {
  const issues = [];
  let loadedSchema = schema;
  try { loadedSchema ??= JSON.parse(requireSchemaText(sourceRoot)); }
  catch (error) { return { valid: false, issues: [{ path: '/', code: 'schema-load', message: error.message }], publicationEligible: false, recordCount: 0 }; }
  validateSchemaValue(contract, loadedSchema, loadedSchema, '', issues, new Set());
  for (const message of assertSchemaValidatorParity(loadedSchema)) issues.push({ path: '/content/schema/v2/source-contract.schema.json', code: 'schema-validator-parity', message });
  if (!contract || typeof contract !== 'object') return { valid: false, issues, publicationEligible: false, recordCount: 0 };
  if (issues.some((issue) => issue.code.startsWith('schema-'))) {
    const schemaSha256 = sha256(loadedSchema); const contractSha256 = sha256(contract);
    const receiptCore = { schemaId: loadedSchema.$id, schemaVersion: contract.schemaVersion ?? null, contractSha256, result: 'invalid', publicationEligible: false };
    return {
      valid: false, issues, recordCount: Array.isArray(contract.records) ? contract.records.length : 0,
      releaseCount: Array.isArray(contract.gameReleases) ? contract.gameReleases.length : 0,
      sourceRefCount: Array.isArray(contract.sourceRefs) ? contract.sourceRefs.length : 0,
      publicationEligible: false, contractSha256, schemaSha256,
      validationReceipt: { ...receiptCore, algorithm: 'sha256', receiptSha256: sha256(receiptCore) }
    };
  }
  const releaseMap = validateReleaseSet(contract, issues);
  const sourceMap = validateProvenance(contract, releaseMap, issues);
  const { recordMap } = validateRecordIdentityAndCoverage(contract, releaseMap, sourceMap, issues);
  validateReferences(contract, releaseMap, recordMap, sourceMap, issues);
  validateContextAndComparisonSemantics(contract, recordMap, issues);
  validateW07WeaponSemantics(contract, issues);
  validateGameTestEvidence(contract, recordMap, sourceMap, issues);
  validateCompatibilityAndChanges(contract, releaseMap, recordMap, issues);
  validateCoverageAndEmptyCollections(contract, issues);
  validateDeclaredReviewTargets(contract, issues);
  validateReceipts(contract, releaseMap, recordMap, issues);
  const derivedPublicationEligible = issues.length === 0 && !contract.fixtureOnly
    && contract.records.every((record) => record.reviewState === 'approved')
    && contract.tombstones.every((item) => item.reviewState === 'approved');
  if (contract.publicationEligible !== derivedPublicationEligible) issues.push({ path: '/publicationEligible', code: 'publication-state-mismatch', message: `publicationEligible must be ${derivedPublicationEligible} based on fixture and review state` });
  const contractSha256 = sha256(contract);
  const schemaSha256 = sha256(loadedSchema);
  const receiptCore = {
    schemaId: loadedSchema.$id,
    schemaVersion: contract.schemaVersion,
    contractSha256,
    result: issues.length === 0 ? 'valid' : 'invalid',
    publicationEligible: derivedPublicationEligible
  };
  const validationReceipt = { ...receiptCore, algorithm: 'sha256', receiptSha256: sha256(receiptCore) };
  return {
    valid: issues.length === 0,
    issues,
    recordCount: contract.records.length,
    releaseCount: contract.gameReleases.length,
    sourceRefCount: contract.sourceRefs.length,
    publicationEligible: derivedPublicationEligible,
    contractSha256,
    schemaSha256,
    validationReceipt
  };
}

function requireSchemaText(sourceRoot) {
  return readFileSync(path.join(sourceRoot, SCHEMA_RELATIVE), 'utf8');
}

export async function validateSourceContractFromDisk(contract, { sourceRoot = REPO_ROOT } = {}) {
  const schema = await loadContractSchema({ sourceRoot });
  return validateSourceContract(contract, { schema, sourceRoot });
}

async function runCli(argv) {
  if (!argv.includes('--check')) throw new Error('Usage: node scripts/content/contract-validator.mjs --check [--source-root <repo-root>]');
  let sourceRoot = REPO_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source-root') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--source-root requires a directory');
      sourceRoot = path.resolve(value); index += 1;
    } else if (!['--check'].includes(argv[index])) throw new Error(`Unknown argument: ${argv[index]}`);
  }
  const schemaBytes = await readFile(path.join(sourceRoot, SCHEMA_RELATIVE));
  const fixtureBytes = await readFile(path.join(sourceRoot, FIXTURE_RELATIVE));
  const schema = JSON.parse(schemaBytes.toString('utf8'));
  const fixture = JSON.parse(fixtureBytes.toString('utf8'));
  const result = validateSourceContract(fixture, { schema, sourceRoot });
  const output = {
    schemaId: schema.$id,
    schemaFileSha256: sha256(schemaBytes.toString('utf8')),
    fixturePath: FIXTURE_RELATIVE.replaceAll('\\', '/'),
    fixtureFileSha256: sha256(fixtureBytes.toString('utf8')),
    ...result
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
}
