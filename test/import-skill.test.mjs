import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { importSkillCandidate, importSkillCandidates } from '../src/content/import-skill.mjs';

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

function withMechanicsSource() {
  const input = indexedInput();
  const mechanics = bytes('# 演示防護：原始碼依據\n\n這段尚未審核的機制正文不應出現在匯入候選。');
  input.mechanicsSource = {
    source_id: 'mechanics-source', kind: 'git_file',
    path: input.playerSource.path.replace('README.md', 'practice-guard.md'),
    sha256: sha(mechanics)
  };
  input.sourceBytes.set('mechanics-source', mechanics);
  return input;
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

// Scenario: A fixed mechanics Markdown blob belongs to the indexed skill.
// Purpose: Carry only its verified source coordinate and candidate route into review.
test('UnitT15_imports_locked_mechanics_coordinate_without_body_text', async () => {
  const candidate = await importSkillCandidate(withMechanicsSource());
  assert.equal(candidate.mechanics_route_candidate, '/skills/veteran/practice-guard/mechanics/');
  assert.deepEqual(candidate.mechanics_source, {
    source_id: 'mechanics-source',
    path: 'Game Info/releases/test/skills/talents/Veteran/practice-guard.md',
    sha256: candidate.mechanics_source.sha256
  });
  assert.ok(candidate.source_lock_ids.includes('mechanics-source'));
  assert.doesNotMatch(JSON.stringify(candidate), /尚未審核的機制正文/);
  assert.equal(candidate.review_status, 'pending');
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

// Scenario: The mechanics lock points to another skill, has a stale hash, or lacks bytes.
// Purpose: Refuse to attach a plausible but unverified mechanics file to a skill.
test('UnitT45_rejects_wrong_or_unverified_mechanics_source', async () => {
  const wrongPath = withMechanicsSource();
  wrongPath.mechanicsSource.path = wrongPath.mechanicsSource.path.replace('practice-guard.md', 'other-skill.md');
  await assert.rejects(() => importSkillCandidate(wrongPath), /mechanics.*path/i);
  const wrongHash = withMechanicsSource();
  wrongHash.mechanicsSource.sha256 = '0'.repeat(64);
  await assert.rejects(() => importSkillCandidate(wrongHash), /source.*hash/i);
  const missingBytes = withMechanicsSource();
  missingBytes.sourceBytes.delete('mechanics-source');
  await assert.rejects(() => importSkillCandidate(missingBytes), /missing.*source/i);
});

// Scenario: An index lock points to another class or a base effect claims an index.
// Purpose: Keep every classification attached to the correct fixed source path.
test('UnitT50_rejects_mismatched_classification_source', async () => {
  const input = indexedInput();
  input.indexSource.path = input.indexSource.path.replace('/Veteran/', '/Scum/');
  await assert.rejects(() => importSkillCandidate(input), /index source path mismatch/i);
});

function batchInput() {
  const input = indexedInput();
  const player = bytes([
    '<a id="second-skill"></a>', '### 第二技能(Second Skill)',
    '- **效果**：第二筆虛構效果。', '[詳細資料](second-skill.md)', '---',
    '<a id="practice-guard"></a>', '### 演示防護(Practice Guard)',
    '- **效果**：這是一段虛構技能效果。', '[詳細資料](practice-guard.md)', '---'
  ].join('\n'));
  const index = bytes([
    '| [第二技能](second-skill.md) / `second-skill` | 技能 |',
    '| [演示防護](practice-guard.md) / `practice-guard` | 技能 |'
  ].join('\n'));
  input.playerSource.sha256 = sha(player);
  input.indexSource.sha256 = sha(index);
  input.sourceBytes.set('player-source', player);
  input.sourceBytes.set('index-source', index);
  const second = { ...input.row, id: 'second-skill', zh: '第二技能' };
  return { entries: [
    { row: second, playerSource: input.playerSource, indexSource: input.indexSource },
    { row: input.row, playerSource: input.playerSource, indexSource: input.indexSource }
  ], sourceBytes: input.sourceBytes };
}

// Scenario: Two skills share one locked README and index but arrive in reverse ID order.
// Purpose: Return a deterministic set of pending candidates without saving source text.
test('UnitT60_imports_batch_in_stable_composite_key_order', async () => {
  const input = batchInput();
  const candidates = await importSkillCandidates(input);
  assert.deepEqual(candidates.map(candidate => candidate.skill_id), ['practice-guard', 'second-skill']);
  assert.ok(candidates.every(candidate => candidate.review_status === 'pending'));
  assert.equal(input.entries[0].row.id, 'second-skill');
});

// Scenario: A batch repeats the same archetype and skill ID.
// Purpose: Reject a route collision before returning any candidate collection.
test('UnitT70_rejects_duplicate_skill_identity_in_batch', async () => {
  const input = batchInput();
  input.entries.push({ ...input.entries[1] });
  await assert.rejects(() => importSkillCandidates(input), /duplicate.*skill/i);
});

// Scenario: Two archetypes legitimately reuse one raw skill ID in separate source files.
// Purpose: Preserve the archetype and ID pair as the unique batch identity.
test('UnitT75_accepts_shared_raw_id_across_archetypes', async () => {
  const first = indexedInput();
  const second = indexedInput();
  second.row.archetype = 'arbites';
  second.playerSource = { ...second.playerSource, source_id: 'arbites-player',
    path: second.playerSource.path.replace('/Veteran/', '/Arbites/') };
  second.indexSource = { ...second.indexSource, source_id: 'arbites-index',
    path: second.indexSource.path.replace('/Veteran/', '/Arbites/') };
  const candidates = await importSkillCandidates({
    entries: [
      { row: first.row, playerSource: first.playerSource, indexSource: first.indexSource },
      { row: second.row, playerSource: second.playerSource, indexSource: second.indexSource }
    ],
    sourceBytes: new Map([...first.sourceBytes,
      ['arbites-player', second.sourceBytes.get('player-source')],
      ['arbites-index', second.sourceBytes.get('index-source')]])
  });
  assert.deepEqual(candidates.map(item => `${item.archetype}/${item.skill_id}`),
    ['arbites/practice-guard', 'veteran/practice-guard']);
});

// Scenario: A later row has a TSV name that disagrees with its fixed Markdown title.
// Purpose: Keep the batch atomic instead of exposing a partially imported set.
test('UnitT80_rejects_entire_batch_when_one_skill_drifts', async () => {
  const input = batchInput();
  input.entries[0].row = { ...input.entries[0].row, zh: '錯誤名稱' };
  await assert.rejects(() => importSkillCandidates(input), /name.*mismatch/i);
});
