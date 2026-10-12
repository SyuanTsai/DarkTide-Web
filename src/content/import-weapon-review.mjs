import { createHash } from 'node:crypto';
import { validGitSourcePath } from './source-path.mjs';
import { parseJsonSource } from './source-selector.mjs';

const idPattern = /^[a-z][a-z0-9_-]{0,127}$/;
const shaPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const kinds = new Set(['melee', 'ranged']);
const statuses = new Set(['map_ui_template_matched', 'ui_registry_outside_map',
  'ui_missing_registered_template']);
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const ordered = rows => rows.sort((left, right) => compare(left.id, right.id));

function requireId(id, label) {
  if (typeof id !== 'string' || !idPattern.test(id)) throw new Error(`invalid ${label} ID`);
  return id;
}

function candidateIndex(rows, field, label) {
  if (!Array.isArray(rows)) throw new Error(`missing ${label} candidates`);
  const index = new Map();
  for (const row of rows) {
    const id = requireId(row?.[field], label);
    if (row.review_status !== 'pending' || index.has(id)) {
      throw new Error(`invalid or duplicate ${label} candidate: ${id}`);
    }
    index.set(id, row);
  }
  return index;
}

function templateReference(row, required) {
  const fields = [row.template_path, row.template_git_blob, row.template_raw_sha256];
  if (required) {
    if (!validGitSourcePath(fields[0]) || !commitPattern.test(fields[1] ?? '') ||
        !shaPattern.test(fields[2] ?? '')) throw new Error(`invalid mark template reference: ${row.mark_id}`);
  } else if (fields.some(value => value !== null)) {
    throw new Error(`unexpected mark template reference: ${row.mark_id}`);
  }
}

function checkedCount(actual, expected, label) {
  if (!Number.isInteger(expected) || actual !== expected) throw new Error(`weapon queue ${label} count mismatch`);
}

// Joins a fixed technical review receipt to the blessing map in memory; never approves content.
export async function importWeaponReviewCandidates({ queueBytes, queueSha256, sourceCommit, blessingMap } = {}) {
  if (!(queueBytes instanceof Uint8Array) || !shaPattern.test(queueSha256 ?? '') ||
      !commitPattern.test(sourceCommit ?? '')) throw new Error('invalid weapon review queue input');
  const stableBytes = new Uint8Array(queueBytes);
  if (createHash('sha256').update(stableBytes).digest('hex') !== queueSha256) {
    throw new Error('weapon review queue hash drift');
  }
  const queue = parseJsonSource(stableBytes, 'weapon-review-queue');
  if (queue?.queue_schema !== 1 || queue.publication_ready !== false ||
      !Array.isArray(queue.weapons) || !queue.summary ||
      !Array.isArray(queue.registered_marks_absent_from_ui) ||
      !Array.isArray(queue.source_tree_marks_absent_from_registry_and_ui)) {
    throw new Error('invalid or publishable weapon review queue');
  }
  if (queue.source_commit !== sourceCommit) throw new Error('weapon review source commit mismatch');
  if (!queue.input_receipt_sha256 ||
      ['map', 'registry', 'ui', 'stats'].some(name => !shaPattern.test(queue.input_receipt_sha256[name] ?? ''))) {
    throw new Error('weapon review input receipt hashes are missing');
  }
  if (blessingMap?.candidate_kind !== 'blessing-map-import' || blessingMap.review_status !== 'pending') {
    throw new Error('invalid blessing map review candidates');
  }
  const mapWeapons = candidateIndex(blessingMap.weapons, 'weapon_id', 'map weapon');
  const mapMarks = candidateIndex(blessingMap.marks, 'mark_id', 'map mark');
  const seenWeapons = new Set();
  const seenMarks = new Set();
  const statusCounts = {};
  const weapons = [];
  const marks = [];
  for (const row of queue.weapons) {
    const weaponId = requireId(row?.weapon_id, 'UI weapon');
    if (seenWeapons.has(weaponId) || !kinds.has(row.item_kind) || !Array.isArray(row.marks) ||
        row.marks.length === 0 || row.review_status !== 'pending' || row.publish_decision !== 'pending' ||
        row.canonical_route_candidate !== `/weapons/${weaponId}/`) {
      throw new Error(`invalid or duplicate UI weapon: ${weaponId}`);
    }
    seenWeapons.add(weaponId);
    const mappedWeapon = mapWeapons.get(weaponId);
    if (row.in_blessing_map !== Boolean(mappedWeapon) ||
        (mappedWeapon && mappedWeapon.kind !== row.item_kind)) {
      throw new Error(`weapon map ownership mismatch: ${weaponId}`);
    }
    const markIds = [];
    for (const mark of row.marks) {
      const markId = requireId(mark?.mark_id, 'UI mark');
      const status = mark.source_status;
      if (seenMarks.has(markId) || mark.review_status !== 'pending' || !statuses.has(status) ||
          mark.item_kind !== row.item_kind ||
          mark.item_path !== `content/items/weapons/player/${row.item_kind}/${markId}` ||
          !Number.isInteger(mark.ui_item_line) || mark.ui_item_line < 1 ||
          !Number.isInteger(mark.ui_name_line) || mark.ui_name_line < 1) {
        throw new Error(`invalid or duplicate UI mark: ${markId}`);
      }
      seenMarks.add(markId);
      markIds.push(markId);
      const mappedMark = mapMarks.get(markId);
      if (mappedMark) {
        if (status !== 'map_ui_template_matched' || mappedMark.weapon_id !== weaponId ||
            mappedMark.template_file !== mark.template_path || !mappedWeapon) {
          throw new Error(`map mark ownership or template mismatch: ${markId}`);
        }
        if (!Array.isArray(mark.base_stat_category_candidates) ||
            mark.base_stat_category_candidates.length === 0 ||
            mark.base_stat_category_candidates.some(value => !idPattern.test(value)) ||
            !idPattern.test(mark.base_stat_category_parse_rule ?? '')) {
          throw new Error(`invalid mark stat category candidates: ${markId}`);
        }
      } else if (status === 'map_ui_template_matched' ||
          mark.base_stat_category_candidates !== null || mark.base_stat_category_parse_rule !== null) {
        throw new Error(`unmapped mark has map stat evidence: ${markId}`);
      }
      templateReference(mark, status !== 'ui_missing_registered_template');
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      marks.push({ id: markId, mark_id: markId, weapon_id: weaponId,
        name_zh_tw: mappedMark?.name_zh_tw ?? null,
        item_kind: row.item_kind, item_path: mark.item_path,
        template_file: mark.template_path, template_git_blob: mark.template_git_blob,
        template_raw_sha256: mark.template_raw_sha256,
        base_stat_category_candidates: mark.base_stat_category_candidates === null ? null
          : [...mark.base_stat_category_candidates],
        base_stat_category_parse_rule: mark.base_stat_category_parse_rule,
        ui_item_line: mark.ui_item_line, ui_name_line: mark.ui_name_line,
        source_status: status,
        canonical_route_candidate: `/weapons/${weaponId}/marks/${markId}/`,
        source_fields: mappedMark?.source_fields ?? {}, review_status: 'pending',
        publish_decision: 'pending' });
    }
    weapons.push({ id: weaponId, weapon_id: weaponId, kind: row.item_kind,
      name_zh_tw: mappedWeapon?.name_zh_tw ?? null, mark_ids: markIds.sort(compare),
      in_blessing_map: Boolean(mappedWeapon), canonical_route_candidate: row.canonical_route_candidate,
      source_fields: mappedWeapon?.source_fields ?? {}, review_status: 'pending',
      publish_decision: 'pending' });
  }
  for (const [id, row] of mapWeapons) {
    if (!seenWeapons.has(id) || !Array.isArray(row.mark_ids) ||
        row.mark_ids.some(markId => !seenMarks.has(markId) || mapMarks.get(markId)?.weapon_id !== id)) {
      throw new Error(`map weapon or mark missing from UI queue: ${id}`);
    }
  }
  for (const id of mapMarks.keys()) {
    if (!seenMarks.has(id)) throw new Error(`map mark missing from UI queue: ${id}`);
  }
  const unresolvedIds = new Set();
  function unresolved(rows, label) {
    return rows.map(row => {
      const id = requireId(row?.mark_id, label);
      if (seenMarks.has(id) || unresolvedIds.has(id) || row.review_status !== 'pending' ||
          !validGitSourcePath(row.template_path) ||
          !commitPattern.test(row.template_git_blob ?? '') ||
          !shaPattern.test(row.template_raw_sha256 ?? '')) {
        throw new Error(`invalid or duplicate ${label} reference: ${id}`);
      }
      unresolvedIds.add(id);
      return id;
    }).sort(compare);
  }
  const registered = unresolved(queue.registered_marks_absent_from_ui, 'registry-only mark');
  const sourceTree = unresolved(queue.source_tree_marks_absent_from_registry_and_ui, 'source-tree-only mark');
  checkedCount(weapons.length, queue.summary.ui_family_candidates, 'UI family');
  checkedCount(marks.length, queue.summary.ui_mark_candidates, 'UI mark');
  checkedCount(mapWeapons.size, queue.summary.map_weapon_families, 'map weapon');
  checkedCount(weapons.length - mapWeapons.size, queue.summary.ui_only_families, 'UI-only weapon');
  checkedCount(registered.length, queue.summary.registered_marks_absent_from_ui, 'registry-only mark');
  checkedCount(sourceTree.length, queue.summary.source_tree_marks_absent_from_registry_and_ui,
    'source-tree-only mark');
  for (const kind of kinds) {
    checkedCount(weapons.filter(row => row.kind === kind).length,
      queue.summary.item_kind_counts?.[kind] ?? 0, `${kind} weapon`);
  }
  for (const status of statuses) {
    checkedCount(statusCounts[status] ?? 0, queue.summary.mark_source_status_counts?.[status] ?? 0,
      `${status} mark`);
  }
  return { schema_version: 1, candidate_kind: 'weapon-review-import',
    source_commit: sourceCommit, queue_sha256: queueSha256,
    input_receipt_sha256: { ...queue.input_receipt_sha256 },
    counts: { weapons: weapons.length, marks: marks.length, map_weapons: mapWeapons.size,
      ui_only_weapons: weapons.length - mapWeapons.size },
    weapons: ordered(weapons), marks: ordered(marks),
    registered_marks_absent_from_ui: registered,
    source_tree_marks_absent_from_registry_and_ui: sourceTree,
    review_status: 'pending', publication_ready: false };
}
