import { createHash } from 'node:crypto';
import { canonicalize } from '../release/manifest.mjs';

const shaPattern = /^[a-f0-9]{64}$/;
const hash = value => createHash('sha256').update(canonicalize(value)).digest('hex');
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function flatten(value, path, fields) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
    for (const [name, child] of Object.entries(value)) {
      flatten(child, `${path}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`, fields);
    }
  } else {
    fields[path] = hash(value);
  }
}

function recordKey(kind, row) {
  if (kind === 'skill') return `${row.archetype}/${row.skill_id}`;
  if (kind === 'binding') return [row.blessing_id, row.weapon_id, row.mark_id, row.variant_id].join('/');
  return row[`${kind}_id`];
}

// Stores only review identities and field digests; source text remains in memory.
export function snapshotReviewCandidates({ skills = [], blessingMap = null } = {}) {
  if (!Array.isArray(skills) || skills.some(row => row?.candidate_kind !== 'skill-import' || row.review_status !== 'pending')) {
    throw new Error('skill review candidates are invalid');
  }
  if (blessingMap !== null && (blessingMap?.candidate_kind !== 'blessing-map-import' ||
      blessingMap.review_status !== 'pending')) {
    throw new Error('blessing map review candidates are invalid');
  }
  const entries = [];
  const seen = new Set();
  function add(kind, row) {
    if (!row || typeof row !== 'object' || row.review_status !== 'pending') {
      throw new Error(`invalid ${kind} review candidate`);
    }
    const id = recordKey(kind, row);
    if (typeof id !== 'string' || !id || id.includes('undefined')) throw new Error(`invalid ${kind} review identity`);
    const key = `${kind}:${id}`;
    if (seen.has(key)) throw new Error(`duplicate review candidate: ${key}`);
    seen.add(key);
    const fieldHashes = {};
    flatten(row, '', fieldHashes);
    entries.push({ key, field_hashes: Object.fromEntries(Object.entries(fieldHashes).sort(([a], [b]) => compare(a, b))) });
  }
  skills.forEach(row => add('skill', row));
  if (blessingMap !== null) {
    for (const [collection, kind] of [
      ['blessings', 'blessing'], ['weapons', 'weapon'], ['marks', 'mark'],
      ['variants', 'variant'], ['bindings', 'binding']
    ]) {
      if (!Array.isArray(blessingMap[collection])) throw new Error(`missing ${collection} review candidates`);
      blessingMap[collection].forEach(row => add(kind, row));
    }
  }
  entries.sort((a, b) => compare(a.key, b.key));
  return { schema_version: 1, snapshot_kind: 'review-candidate-digests', entries };
}

function checkedEntries(snapshot) {
  if (snapshot?.schema_version !== 1 || snapshot.snapshot_kind !== 'review-candidate-digests' ||
      !Array.isArray(snapshot.entries)) throw new Error('invalid review snapshot');
  const records = new Map();
  for (const row of snapshot.entries) {
    if (typeof row?.key !== 'string' || !row.key || records.has(row.key) ||
        !row.field_hashes || typeof row.field_hashes !== 'object' || Array.isArray(row.field_hashes) ||
        Object.keys(row.field_hashes).some(path => !path.startsWith('/') || !shaPattern.test(row.field_hashes[path]))) {
      throw new Error('invalid or duplicate review snapshot entry');
    }
    records.set(row.key, row.field_hashes);
  }
  return records;
}

export function diffReviewSnapshots(before, after) {
  const oldRows = checkedEntries(before);
  const newRows = checkedEntries(after);
  const added = [...newRows.keys()].filter(key => !oldRows.has(key)).sort(compare);
  const removed = [...oldRows.keys()].filter(key => !newRows.has(key)).sort(compare);
  const changed = [];
  for (const key of [...newRows.keys()].filter(value => oldRows.has(value)).sort(compare)) {
    const oldFields = oldRows.get(key);
    const newFields = newRows.get(key);
    const fields = [...new Set([...Object.keys(oldFields), ...Object.keys(newFields)])].sort(compare)
      .filter(path => oldFields[path] !== newFields[path])
      .map(path => ({ path, before_sha256: oldFields[path] ?? null, after_sha256: newFields[path] ?? null }));
    if (fields.length) changed.push({ key, fields });
  }
  return { schema_version: 1, added, removed, changed,
    unresolved_count: added.length + removed.length + changed.length };
}
