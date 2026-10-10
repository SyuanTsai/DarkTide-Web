import { validGitSourcePath } from './source-path.mjs';
import { parseMarkdownSource, readMarkdownSelector } from './source-selector.mjs';

const identityPattern = /^[a-z][a-z0-9_-]{0,127}$/;
const shaPattern = /^[a-f0-9]{64}$/;
const archetypes = new Set(['arbites', 'ogryn', 'psyker', 'scum', 'skitarii', 'veteran', 'zealot']);

async function lockedLines(lock, sourceBytes) {
  if (lock?.kind !== 'git_file' || !identityPattern.test(lock.source_id ?? '') ||
      !validGitSourcePath(lock.path) || !shaPattern.test(lock.sha256 ?? '') ||
      !(sourceBytes instanceof Map) || !(sourceBytes.get(lock.source_id) instanceof Uint8Array)) {
    throw new Error(`invalid or missing skill source: ${lock?.source_id}`);
  }
  const stableBytes = new Uint8Array(sourceBytes.get(lock.source_id));
  const digest = await crypto.subtle.digest('SHA-256', stableBytes);
  const actual = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  if (actual !== lock.sha256) throw new Error(`skill source hash drift: ${lock.source_id}`);
  return parseMarkdownSource(stableBytes, lock.source_id);
}

function indexedClassification(lines, skillId) {
  const matches = [];
  for (const line of lines) {
    const row = /^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\/\s*`([^`]+)`\s*\|\s*([^|]+)\|/.exec(line);
    if (row && row[2] === `${skillId}.md` && row[3] === skillId) {
      matches.push({ name: row[1], category: row[4].trim() });
    }
  }
  if (matches.length !== 1 || !matches[0].category) throw new Error(`skill index row missing or ambiguous: ${skillId}`);
  const category = matches[0].category;
  const kind = skillId === 'veteran_combat_ability_stance' ? 'zero-point-default'
    : category === '興奮劑配方' && skillId === 'broker_stimm_activation_talent' ? 'zero-point-description'
    : category === '興奮劑配方' ? 'recipe' : 'current-talent';
  return { ...matches[0], kind };
}

// Produces a review candidate only. Rights and game-mechanics claims are separate gates.
export async function importSkillCandidate({ row, playerSource, indexSource, sourceBytes } = {}) {
  const { archetype, id: skillId } = row ?? {};
  if (!archetypes.has(archetype) || !identityPattern.test(skillId ?? '') ||
      typeof row.kind !== 'string' || typeof row.category !== 'string' || typeof row.zh !== 'string') {
    throw new Error('skill TSV identity or fields are invalid');
  }
  const directory = archetype[0].toUpperCase() + archetype.slice(1);
  const prefix = `/skills/talents/${directory}/`;
  const path = playerSource?.path;
  if (typeof path !== 'string' || !path.includes(prefix) ||
      !(path.endsWith(`${prefix}README.md`) || path.endsWith(`${prefix}BASE_EFFECTS.md`))) {
    throw new Error(`skill player source path mismatch: ${skillId}`);
  }
  const base = path.endsWith('/BASE_EFFECTS.md');
  const mode = base ? 'detail' : 'anchor';
  const lines = await lockedLines(playerSource, sourceBytes);
  const nameSelector = `md:${mode}:${skillId}:title-zh`;
  const effectSelector = `md:${mode}:${skillId}:body-text`;
  const name = readMarkdownSelector(lines, nameSelector);
  const effect = readMarkdownSelector(lines, effectSelector);
  let classification;
  if (base) {
    if (indexSource !== null) throw new Error(`base skill must not claim an index row: ${skillId}`);
    classification = { kind: 'base-effect', category: '基礎效果' };
  } else {
    if (indexSource?.path !== path.replace(/README\.md$/, 'SOURCE_INDEX.md')) {
      throw new Error(`skill index source path mismatch: ${skillId}`);
    }
    classification = indexedClassification(await lockedLines(indexSource, sourceBytes), skillId);
    if (classification.name !== name) throw new Error(`skill index name mismatch: ${skillId}`);
  }
  if (row.kind !== classification.kind) throw new Error(`skill kind mismatch: ${skillId}`);
  if (row.category !== classification.category) throw new Error(`skill category mismatch: ${skillId}`);
  if (row.zh !== name) throw new Error(`skill name mismatch: ${skillId}`);
  return {
    schema_version: 1,
    candidate_kind: 'skill-import',
    review_status: 'pending',
    archetype,
    skill_id: skillId,
    kind: classification.kind,
    category: classification.category,
    name_zh_tw: name,
    effect_zh_tw: effect,
    canonical_route: `/skills/${archetype}/${skillId}/`,
    source_lock_ids: [...new Set([playerSource.source_id, indexSource?.source_id].filter(Boolean))].sort(),
    identity_source: { source_id: playerSource.source_id, section_id: skillId },
    classification_source: { source_id: base ? playerSource.source_id : indexSource.source_id, row_id: skillId },
    source_fields: {
      name_zh_tw: { source_id: playerSource.source_id, selector: nameSelector },
      effect_zh_tw: { source_id: playerSource.source_id, selector: effectSelector }
    },
    claims: [],
    asset_ids: []
  };
}
