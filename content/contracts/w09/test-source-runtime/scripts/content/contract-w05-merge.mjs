import { createHash } from 'node:crypto';

const REGISTRY_KEYS = Object.freeze({
  gameReleases: (item) => [requiredString(item.gameReleaseId, 'gameReleaseId')],
  sourceSnapshots: (item) => [requiredString(item.snapshot && item.snapshot.snapshotId, 'snapshot.snapshotId')],
  sourceRefs: (item) => [requiredString(item.gameReleaseId, 'gameReleaseId'), requiredString(item.sourceId, 'sourceId')],
  records: (item) => [requiredString(item.gameReleaseId, 'gameReleaseId'), requiredString(item.recordId, 'recordId')],
  tombstones: (item) => [requiredString(item.gameReleaseId, 'gameReleaseId'), requiredString(item.recordId, 'recordId')],
  reviewReceipts: (item) => {
    if (!isPlainObject(item.target)) throw new Error('malformed reviewReceipts registry key: target must be an object');
    return [
      requiredString(item.target.gameReleaseId, 'target.gameReleaseId'),
      requiredString(item.target.recordId, 'target.recordId'),
      requiredString(item.target.fieldPath, 'target.fieldPath'),
      requiredString(item.target.dimension, 'target.dimension')
    ];
  }
});

const OPTIONAL_REGISTRIES = new Set(['sourceSnapshots']);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('malformed registry key: ' + label + ' must be a non-empty string');
  return value;
}

export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertSafeJsonValue(value, label = 'value') {
  const active = new WeakSet();
  const visit = (node, location) => {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) throw new Error(label + ' contains a non-finite number at ' + (location || '/'));
      return;
    }
    if (typeof node !== 'object') throw new Error(label + ' is not JSON data at ' + (location || '/'));
    if (active.has(node)) throw new Error(label + ' contains a circular reference at ' + (location || '/'));
    active.add(node);
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, location + '/' + index));
    } else {
      if (!isPlainObject(node)) throw new Error(label + ' contains a non-plain object at ' + (location || '/'));
      for (const [key, child] of Object.entries(node)) {
        if (UNSAFE_KEYS.has(key)) throw new Error('unsafe object key ' + JSON.stringify(key) + ' at ' + (location || '/'));
        visit(child, location + '/' + escapePointer(key));
      }
    }
    active.delete(node);
  };
  visit(value, '');
  return value;
}

export function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort(compareLexical).map((key) => [key, sortJsonValue(value[key])]));
  }
  return value;
}

export function canonicalJsonString(value) {
  assertSafeJsonValue(value);
  return JSON.stringify(sortJsonValue(value));
}

export function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJsonString(value), 'utf8').digest('hex');
}

function compareLexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapePointer(value) {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function cloneSlot(slot) {
  return slot.present ? { present: true, value: structuredClone(slot.value) } : { present: false };
}

function assertSlot(slot, label) {
  if (!isPlainObject(slot) || typeof slot.present !== 'boolean') throw new Error(label + ' must be a presence slot');
  if (slot.present) {
    if (!Object.hasOwn(slot, 'value')) throw new Error(label + ' is missing its value');
    assertSafeJsonValue(slot.value, label);
  }
}

function equalSlots(left, right) {
  if (left.present !== right.present) return false;
  return !left.present || canonicalJsonString(left.value) === canonicalJsonString(right.value);
}

function makeConflict({ registry, entityKey, path, baseline, authoring, candidate }) {
  const conflict = { code: 'three-way-conflict' };
  if (registry !== undefined) conflict.registry = registry;
  conflict.entityKey = entityKey;
  conflict.path = path;
  conflict.baseline = cloneSlot(baseline);
  conflict.authoring = cloneSlot(authoring);
  conflict.candidate = cloneSlot(candidate);
  return conflict;
}

export function mergeThreeWayValue({ baseline, authoring, candidate }, {
  registry,
  entityKey = 'contract',
  path = ''
} = {}) {
  assertSlot(baseline, 'baseline');
  assertSlot(authoring, 'authoring');
  assertSlot(candidate, 'candidate');

  if (equalSlots(authoring, candidate)) return { value: cloneSlot(authoring), conflicts: [] };
  if (equalSlots(authoring, baseline)) return { value: cloneSlot(candidate), conflicts: [] };
  if (equalSlots(candidate, baseline)) return { value: cloneSlot(authoring), conflicts: [] };

  const canRecurse = authoring.present && candidate.present
    && isPlainObject(authoring.value) && isPlainObject(candidate.value)
    && (!baseline.present || isPlainObject(baseline.value));
  if (canRecurse) {
    const baseObject = baseline.present ? baseline.value : {};
    const authorObject = authoring.value;
    const candidateObject = candidate.value;
    const keys = [...new Set([
      ...Object.keys(baseObject),
      ...Object.keys(authorObject),
      ...Object.keys(candidateObject)
    ])].sort(compareLexical);
    const mergedObject = {};
    const conflicts = [];
    for (const key of keys) {
      const child = mergeThreeWayValue({
        baseline: Object.hasOwn(baseObject, key) ? { present: true, value: baseObject[key] } : { present: false },
        authoring: Object.hasOwn(authorObject, key) ? { present: true, value: authorObject[key] } : { present: false },
        candidate: Object.hasOwn(candidateObject, key) ? { present: true, value: candidateObject[key] } : { present: false }
      }, {
        registry,
        entityKey,
        path: path + '/' + escapePointer(key)
      });
      conflicts.push(...child.conflicts);
      if (child.value.present) mergedObject[key] = child.value.value;
    }
    return { value: { present: true, value: mergedObject }, conflicts };
  }

  return {
    value: cloneSlot(baseline),
    conflicts: [makeConflict({ registry, entityKey, path, baseline, authoring, candidate })]
  };
}

function registryKey(registry, item) {
  return JSON.stringify(REGISTRY_KEYS[registry](item));
}

function registryItems(registry, value, documentName) {
  if (value === undefined && OPTIONAL_REGISTRIES.has(registry)) return new Map();
  if (!Array.isArray(value)) throw new Error(documentName + '.' + registry + ' must be an array');
  const items = new Map();
  for (const item of value) {
    if (!isPlainObject(item)) throw new Error(documentName + '.' + registry + ' entries must be objects');
    let key;
    try { key = registryKey(registry, item); }
    catch (error) { throw new Error('malformed ' + registry + ' registry key: ' + error.message); }
    if (items.has(key)) throw new Error('duplicate ' + registry + ' registry key ' + key + ' in ' + documentName);
    items.set(key, item);
  }
  return items;
}

function mergeRegistry(registry, documents) {
  const maps = documents.map((document, index) => registryItems(registry, document[registry], ['baseline', 'authoring', 'candidate'][index]));
  const allKeys = [...new Set(maps.flatMap((items) => [...items.keys()]))].sort(compareLexical);
  const merged = [];
  const conflicts = [];
  for (const key of allKeys) {
    const slots = maps.map((items) => items.has(key)
      ? { present: true, value: items.get(key) }
      : { present: false });
    const result = mergeThreeWayValue({
      baseline: slots[0],
      authoring: slots[1],
      candidate: slots[2]
    }, {
      registry,
      entityKey: registry + ':' + key,
      path: ''
    });
    conflicts.push(...result.conflicts);
    if (result.value.present) merged.push(result.value.value);
  }
  return { value: merged, conflicts };
}

function neutralizeDerivedState(document) {
  const copy = structuredClone(document);
  copy.publicationEligible = false;
  for (const item of [...copy.records, ...copy.tombstones]) {
    const hasReceipt = copy.reviewReceipts.some((receipt) =>
      receipt.target.gameReleaseId === item.gameReleaseId && receipt.target.recordId === item.recordId);
    if (hasReceipt || item.reviewState !== 'draft') item.reviewState = 'pending';
  }
  return copy;
}

function assertContractDocument(document, label) {
  if (!isPlainObject(document)) throw new Error(label + ' must be a contract object');
  assertSafeJsonValue(document, label);
  for (const registry of Object.keys(REGISTRY_KEYS)) {
    if (!Object.hasOwn(document, registry) && OPTIONAL_REGISTRIES.has(registry)) continue;
    if (!Array.isArray(document[registry])) throw new Error(label + '.' + registry + ' must be an array');
    registryItems(registry, document[registry], label);
  }
}

export function mergeContractDocuments({ baseline, authoring, candidate } = {}) {
  const documents = [
    ['baseline', baseline],
    ['authoring', authoring],
    ['candidate', candidate]
  ].map(([label, document]) => {
    assertContractDocument(document, label);
    return neutralizeDerivedState(document);
  });

  const [base, author, next] = documents;
  const rootKeys = [...new Set([...Object.keys(base), ...Object.keys(author), ...Object.keys(next)])].sort(compareLexical);
  const merged = {};
  const conflicts = [];
  for (const key of rootKeys) {
    if (Object.hasOwn(REGISTRY_KEYS, key)) {
      const result = mergeRegistry(key, documents);
      merged[key] = result.value;
      conflicts.push(...result.conflicts);
      continue;
    }
    const result = mergeThreeWayValue({
      baseline: Object.hasOwn(base, key) ? { present: true, value: base[key] } : { present: false },
      authoring: Object.hasOwn(author, key) ? { present: true, value: author[key] } : { present: false },
      candidate: Object.hasOwn(next, key) ? { present: true, value: next[key] } : { present: false }
    }, { registry: 'contract', entityKey: 'contract', path: '/' + escapePointer(key) });
    conflicts.push(...result.conflicts);
    if (result.value.present) merged[key] = result.value.value;
  }

  conflicts.sort((left, right) => compareLexical(left.registry || '', right.registry || '')
    || compareLexical(left.entityKey, right.entityKey)
    || compareLexical(left.path, right.path));
  return conflicts.length > 0 ? { merged: null, conflicts } : { merged, conflicts: [] };
}