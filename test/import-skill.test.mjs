import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { importSkillCandidate } from '../src/content/import-skill.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = text => new TextEncoder().encode(text);

function indexedInput() {
  const player = bytes([
    '# 虛構職業', '<a id="practice-guard"></a>', '### 演示防護(Practice Guard)',
    '- **效果**：這是一段虛構技能效果。', '[詳細資料](practice-guard.md)', '---'
  ].join('\n'));
  const index = bytes('| 技能／程式識別碼 | 分類 |\n|---|---|\n| [演示防護](practice-guard.md) / `practice-guard` | 技能 |');
  const prefix = 'Game Info/releases/test/skills/talents/Veteran/';
  return {
    row: { archetype: 'veteran', id: 'practice-guard', kind: 'current-talent',
      category: '技能', zh: '演示防護' },
    playerSource: { source_id: 'player-source', kind: 'git_file', path: `${prefix}README.md`, sha256: sha(player) },
    indexSource: { source_id: 'index-source', kind: 'git_file', path: `${prefix}SOURCE_INDEX.md`, sha256: sha(index) },
    sourceBytes: new Map([['player-source', player], ['index-source', index]])
  };
}

// Scenario: A fixed index and player section agree with a TSV identity and classification.
// Purpose: Produce an in-memory, explicitly pending skill candidate from verified source fields.
test('UnitT10_imports_indexed_skill_as_pending_candidate', async () => {
  const candidate = await importSkillCandidate(indexedInput());
  assert.equal(candidate.candidate_kind, 'skill-import');
  assert.equal(candidate.review_status, 'pending');
  assert.equal(candidate.name_zh_tw, '演示防護');
  assert.equal(candidate.effect_zh_tw, '效果：這是一段虛構技能效果。');
  assert.equal(candidate.kind, 'current-talent');
  assert.equal(candidate.canonical_route, '/skills/veteran/practice-guard/');
  assert.deepEqual(candidate.source_fields.name_zh_tw,
    { source_id: 'player-source', selector: 'md:anchor:practice-guard:title-zh' });
  assert.deepEqual(candidate.identity_source,
    { source_id: 'player-source', section_id: 'practice-guard' });
  assert.deepEqual(candidate.classification_source,
    { source_id: 'index-source', row_id: 'practice-guard' });
});

// Scenario: A base effect uses its detail link and has no SOURCE_INDEX row.
// Purpose: Import the base-effect classification without inventing an index source.
test('UnitT20_imports_base_effect_without_index_row', async () => {
  const input = indexedInput();
  const player = bytes('## 演示防護(Practice Guard)：基礎效果\n- **效果**：這是一段虛構技能效果。\n[原始碼依據與算例條件](practice-guard.md)\n---');
  input.row.kind = 'base-effect';
  input.row.category = '基礎效果';
  input.row.zh = '演示防護：基礎效果';
  input.playerSource.path = input.playerSource.path.replace('README.md', 'BASE_EFFECTS.md');
  input.playerSource.sha256 = sha(player);
  input.indexSource = null;
  input.sourceBytes.set('player-source', player);
  const candidate = await importSkillCandidate(input);
  assert.equal(candidate.name_zh_tw, input.row.zh);
  assert.equal(candidate.source_fields.effect_zh_tw.selector, 'md:detail:practice-guard:body-text');
  assert.deepEqual(candidate.source_lock_ids, ['player-source']);
  assert.deepEqual(candidate.classification_source,
    { source_id: 'player-source', row_id: 'practice-guard' });
});

// Scenario: A recipe tree has its distinct zero-point description and ordinary recipe rows.
// Purpose: Keep special skill kinds derived from the fixed index category and ID.
test('UnitT25_derives_recipe_and_zero_point_skill_kinds', async () => {
  const recipe = indexedInput();
  recipe.row.id = 'broker_stimm_activation_talent';
  recipe.row.archetype = 'scum';
  recipe.row.category = '興奮劑配方';
  recipe.row.kind = 'zero-point-description';
  recipe.playerSource.path = recipe.playerSource.path.replace('/Veteran/', '/Scum/');
  recipe.indexSource.path = recipe.indexSource.path.replace('/Veteran/', '/Scum/');
  const player = bytes('<a id="broker_stimm_activation_talent"></a>\n### 演示防護(Practice Guard)\n- **效果**：這是一段虛構技能效果。\n[詳細資料](broker_stimm_activation_talent.md)\n---');
  const index = bytes('| [演示防護](broker_stimm_activation_talent.md) / `broker_stimm_activation_talent` | 興奮劑配方 |');
  recipe.playerSource.sha256 = sha(player);
  recipe.indexSource.sha256 = sha(index);
  recipe.sourceBytes.set('player-source', player);
  recipe.sourceBytes.set('index-source', index);
  assert.equal((await importSkillCandidate(recipe)).kind, 'zero-point-description');
  const ordinary = structuredClone(recipe);
  ordinary.row.id = 'broker_recipe_example';
  ordinary.row.kind = 'recipe';
  const ordinaryPlayer = bytes(new TextDecoder().decode(player).replaceAll('broker_stimm_activation_talent', 'broker_recipe_example'));
  const ordinaryIndex = bytes(new TextDecoder().decode(index).replaceAll('broker_stimm_activation_talent', 'broker_recipe_example'));
  ordinary.playerSource.sha256 = sha(ordinaryPlayer);
  ordinary.indexSource.sha256 = sha(ordinaryIndex);
  ordinary.sourceBytes.set('player-source', ordinaryPlayer);
  ordinary.sourceBytes.set('index-source', ordinaryIndex);
  assert.equal((await importSkillCandidate(ordinary)).kind, 'recipe');
});

// Scenario: A TSV classification or name disagrees with fixed source fields.
// Purpose: Refuse a candidate rather than silently trusting stale TSV metadata.
test('UnitT30_rejects_tsv_or_index_field_mismatch', async () => {
  const classification = indexedInput();
  classification.row.category = '鑰石';
  await assert.rejects(() => importSkillCandidate(classification), /category.*mismatch/i);
  const name = indexedInput();
  name.row.zh = '不同名稱';
  await assert.rejects(() => importSkillCandidate(name), /name.*mismatch/i);
});

// Scenario: A source byte stream changes after its lock is declared.
// Purpose: Prevent import from using unverified file contents.
test('UnitT40_rejects_source_hash_drift_before_import', async () => {
  const input = indexedInput();
  input.sourceBytes.set('player-source', bytes('changed'));
  await assert.rejects(() => importSkillCandidate(input), /source.*hash/i);
});

// Scenario: An index lock points to another class or a base effect claims an index.
// Purpose: Keep every classification attached to the correct fixed source path.
test('UnitT50_rejects_mismatched_classification_source', async () => {
  const input = indexedInput();
  input.indexSource.path = input.indexSource.path.replace('/Veteran/', '/Scum/');
  await assert.rejects(() => importSkillCandidate(input), /index source path mismatch/i);
});
