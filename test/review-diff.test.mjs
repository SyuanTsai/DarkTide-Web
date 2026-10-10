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

const mapWithWeapon = () => ({ candidate_kind: 'blessing-map-import', review_status: 'pending',
  blessings: [], variants: [], bindings: [],
  weapons: [{ weapon_id: 'practice_rifle', mark_ids: ['practice_rifle_m1'], review_status: 'pending' }],
  marks: [{ mark_id: 'practice_rifle_m1', weapon_id: 'practice_rifle', review_status: 'pending' }] });
const uiWeaponReview = () => ({ candidate_kind: 'weapon-review-import', review_status: 'pending',
  publication_ready: false,
  weapons: [
    { weapon_id: 'practice_rifle', mark_ids: ['practice_rifle_m1'], name_zh_tw: '虛構步槍', review_status: 'pending', publish_decision: 'pending' },
    { weapon_id: 'practice_knife', mark_ids: ['practice_knife_m1'], name_zh_tw: null, review_status: 'pending', publish_decision: 'pending' }
  ],
  marks: [
    { mark_id: 'practice_rifle_m1', weapon_id: 'practice_rifle', review_status: 'pending', publish_decision: 'pending' },
    { mark_id: 'practice_knife_m1', weapon_id: 'practice_knife', review_status: 'pending', publish_decision: 'pending' }
  ] });

// Scenario: A UI catalog adds a weapon and mark beyond the blessing map.
// Purpose: Track their identities without duplicating map weapon and mark keys or exposing names.
test('UnitT50_snapshots_enriched_weapon_review_once_per_identity', () => {
  const before = snapshotReviewCandidates({ blessingMap: mapWithWeapon() });
  const after = snapshotReviewCandidates({ blessingMap: mapWithWeapon(), weaponReview: uiWeaponReview() });
  assert.deepEqual(after.entries.map(row => row.key), [
    'mark:practice_knife_m1', 'mark:practice_rifle_m1',
    'weapon:practice_knife', 'weapon:practice_rifle'
  ]);
  const diff = diffReviewSnapshots(before, after);
  assert.deepEqual(diff.added, ['mark:practice_knife_m1', 'weapon:practice_knife']);
  assert.deepEqual(diff.changed.map(row => row.key), ['mark:practice_rifle_m1', 'weapon:practice_rifle']);
  assert.equal(JSON.stringify(after).includes('虛構步槍'), false);
});

// Scenario: A supplied UI catalog omits a weapon or mark already present in the map.
// Purpose: Refuse a partial catalog before it can hide known review identities.
test('UnitT60_rejects_weapon_review_missing_map_identity', () => {
  const missingWeapon = uiWeaponReview();
  missingWeapon.weapons = missingWeapon.weapons.filter(row => row.weapon_id !== 'practice_rifle');
  missingWeapon.marks = missingWeapon.marks.filter(row => row.weapon_id !== 'practice_rifle');
  assert.throws(() => snapshotReviewCandidates({ blessingMap: mapWithWeapon(), weaponReview: missingWeapon }),
    /weapon.*review|review.*weapon/i);
  const missingMark = uiWeaponReview();
  missingMark.marks = missingMark.marks.filter(row => row.mark_id !== 'practice_rifle_m1');
  missingMark.weapons[0].mark_ids = [];
  assert.throws(() => snapshotReviewCandidates({ blessingMap: mapWithWeapon(), weaponReview: missingMark }),
    /(?:weapon|mark).*review/i);
});

// Scenario: A weapon review snapshot is incorrectly marked publishable.
// Purpose: Prevent approval state from being laundered through the digest queue.
test('UnitT70_rejects_publishable_weapon_review_snapshot', () => {
  const review = uiWeaponReview();
  review.publication_ready = true;
  assert.throws(() => snapshotReviewCandidates({ weaponReview: review }), /weapon review candidates are invalid/i);
});

// Scenario: An individual mark is relabeled approved inside an otherwise pending catalog.
// Purpose: Keep a field-digest snapshot from silently accepting a publication decision.
test('UnitT75_rejects_approved_mark_inside_pending_review', () => {
  const review = uiWeaponReview();
  review.marks[0].publish_decision = 'approved';
  assert.throws(() => snapshotReviewCandidates({ weaponReview: review }), /mark review relation/i);
});
