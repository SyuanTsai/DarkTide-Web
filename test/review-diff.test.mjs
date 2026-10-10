import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotReviewCandidates, diffReviewSnapshots } from '../src/content/review-diff.mjs';

const skill = (effect = '虛構效果') => ({
  schema_version: 1, candidate_kind: 'skill-import', review_status: 'pending',
  archetype: 'veteran', skill_id: 'practice_guard', kind: 'current-talent',
  category: '技能', name_zh_tw: '虛構技能', effect_zh_tw: effect,
  canonical_route: '/skills/veteran/practice_guard/', source_lock_ids: ['player-source']
});
const variant = digest => ({ id: 'steady_variant', variant_id: 'steady_variant',
  blessing_id: 'steady_example', weapon_id: 'practice_rifle',
  numeric_review_hashes: { per_stack_percent: digest },
  review_status: 'pending' });

// Scenario: One skill effect changes between two reviewed source snapshots.
// Purpose: Emit only the field path and digests, never the source text.
test('UnitT10_reports_changed_skill_field_without_text', () => {
  const before = snapshotReviewCandidates({ skills: [skill()] });
  const after = snapshotReviewCandidates({ skills: [skill('另一段虛構效果')] });
  const diff = diffReviewSnapshots(before, after);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.changed.map(row => [row.key, row.fields.map(field => field.path)]),
    [['skill:veteran/practice_guard', ['/effect_zh_tw']]]);
  assert.equal(JSON.stringify(diff).includes('虛構效果'), false);
  assert.match(diff.changed[0].fields[0].before_sha256, /^[a-f0-9]{64}$/);
});

// Scenario: A variant's withheld numeric value changes while its review field name stays fixed.
// Purpose: Surface that numeric review field separately without exposing the value.
test('UnitT20_reports_numeric_review_digest_change', () => {
  const wrap = value => ({ candidate_kind: 'blessing-map-import', review_status: 'pending',
    blessings: [], weapons: [], marks: [], variants: [variant(value)], bindings: [] });
  const before = snapshotReviewCandidates({ blessingMap: wrap('a'.repeat(64)) });
  const after = snapshotReviewCandidates({ blessingMap: wrap('b'.repeat(64)) });
  const diff = diffReviewSnapshots(before, after);
  assert.deepEqual(diff.changed[0].fields.map(field => field.path),
    ['/numeric_review_hashes/per_stack_percent']);
});

// Scenario: A skill is added and another removed without a shared key.
// Purpose: Produce stable review queues for both lifecycle changes.
test('UnitT30_reports_added_and_removed_candidate_ids', () => {
  const before = snapshotReviewCandidates({ skills: [skill()] });
  const next = skill();
  next.skill_id = 'another_skill';
  next.canonical_route = '/skills/veteran/another_skill/';
  const after = snapshotReviewCandidates({ skills: [next] });
  const diff = diffReviewSnapshots(before, after);
  assert.deepEqual(diff.added, ['skill:veteran/another_skill']);
  assert.deepEqual(diff.removed, ['skill:veteran/practice_guard']);
  assert.deepEqual(diff.changed, []);
});

// Scenario: A candidate collection repeats the same composite identity.
// Purpose: Refuse an ambiguous snapshot before reporting update differences.
test('UnitT40_rejects_duplicate_review_candidate_key', () => {
  assert.throws(() => snapshotReviewCandidates({ skills: [skill(), skill()] }), /duplicate.*candidate/i);
});
