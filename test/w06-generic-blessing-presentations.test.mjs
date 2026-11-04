import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePresentations } from '../scripts/content/w06-generic-blessing-presentations.mjs';
import { applyApprovedReceipts } from '../scripts/content/w06-generic-blessing-presentations-apply.mjs';
import { getReviewState } from '../scripts/content/contract-authoring.mjs';

function fixture() {
  const record = (kind, payload) => ({ recordId: `darktide:${kind}:gun:p1-test`, kind, gameReleaseId: 'darktide:1.13.4', payload });
  const blessing = record('blessing', { nameKey: { status: 'unknown' } });
  const variant = record('blessing-variant', { blessingRef: blessing, definedTiers: [1, 4] });
  const claims = ['power', 'time'].map((key, i) => ({ ...record('claim', {
    targetRef: variant, property: `description.format_values.${key}.display_${i ? 'value' : 'percent'}`,
    value: { status: 'known', decimal: i ? '2' : '12.5', unit: i ? 'second' : 'percent' },
  }), recordId: `darktide:claim:test-${key}` }));
  return {
    candidates: { records: [blessing, variant, ...claims] }, approved: { recordIds: [blessing.recordId, variant.recordId, ...claims.map(x => x.recordId)] },
    text: { traits: [{ traitName: 'weapon_trait_bespoke_gun_p1_test', nameEn: 'Test', nameZhTw: '測試', nameHash: '12345678', nameKey: 'name', descriptionHash: '87654321', descriptionKey: 'desc', descriptionEnTemplate: '{power:%s} for {time:%s}s', descriptionZhTwTemplate: '{power:%s}，持續{time:%s}秒', unresolvedPlaceholders: [] }] },
    baseAuthoring: { presentations: [], reviewTargets: [], reviewReceipts: [] }, baseOfficialInputs: { sources: [] },
  };
}

// Scenario: all placeholders have known claims. Purpose: preserve tier coverage and native provenance.
test('UnitT10_complete_bindings_generate_all_defined_tiers', () => {
  const result = generatePresentations(fixture());
  assert.equal(result.additions.presentations.length, 1);
  const p = result.additions.presentations[0];
  assert.deepEqual(p.tierPresentations.options.map(x => x.tier), [1, 4]);
  assert.equal(result.additions.officialInputs.length, 6);
  assert.equal(result.additions.officialInputs[0].key, null);
  assert.deepEqual(result.authoring.reviewReceipts, []);
});

// Scenario: a placeholder lacks a known claim. Purpose: prevent partial presentations.
test('UnitT20_unknown_placeholder_skips_entire_variant', () => {
  const f = fixture(); f.candidates.records.pop();
  const r = generatePresentations(f);
  assert.equal(r.additions.presentations.length, 0);
  assert.equal(r.skipped[0].reason, 'unresolved placeholder');
  assert.equal(r.additions.officialInputs.length, 0);
});

// Scenario: signed percentages and plain values are substituted. Purpose: match validator formatting exactly.
test('UnitT30_formats_percent_and_number', () => {
  const f = fixture();
  assert.equal(generatePresentations(f).additions.presentations[0].official.resolvedText, '+12.5%，持續2秒');
  f.candidates.records[2].payload.value.decimal = '-2';
  assert.equal(generatePresentations(f).additions.presentations[0].official.resolvedText, '-2%，持續2秒');
});

// Scenario: a generated id already exists. Purpose: prevent overwriting approved authoring.
test('UnitT40_existing_id_collision_fails', () => {
  const f = fixture(); f.baseAuthoring.presentations.push({ authoringId: 'web:presentation:gun-p1-test' });
  assert.throws(() => generatePresentations(f), /collision/);
});

// Scenario: identical inputs are generated twice. Purpose: make review digests reproducible.
test('UnitT50_identical_inputs_have_identical_digest', () => {
  const f = fixture();
  assert.equal(generatePresentations(f).packageDigest, generatePresentations(f).packageDigest);
});

// Scenario: a display claim uses an incompatible unit. Purpose: avoid implying unsupported units.
test('UnitT60_unsupported_percent_unit_skips', () => {
  const f = fixture(); f.candidates.records[2].payload.value.unit = 'ratio';
  assert.equal(generatePresentations(f).skipped[0].reason, 'unsupported unit');
});

// Scenario: seconds and different tier values coexist with existing entries. Purpose: protect binding and preservation.
test('UnitT70_tier_claims_and_existing_entries_are_preserved', () => {
  const f = fixture();
  f.candidates.records[3].payload.value.unit = 's';
  const claim = f.candidates.records[2];
  claim.payload.property = 'description.format_values.power.defined_tier_1_display_percent';
  const last = structuredClone(claim);
  last.recordId += '-four'; last.payload.property = 'description.format_values.power.defined_tier_4_display_percent';
  last.payload.value.decimal = '20'; f.candidates.records.push(last); f.approved.recordIds.push(last.recordId);
  f.baseAuthoring.reviewReceipts.push({ preserved: true });
  f.baseOfficialInputs.sources.push({ officialSourceId: 'official:existing', untouched: true });
  const before = structuredClone(f);
  const r = generatePresentations(f);
  assert.deepEqual(r.additions.presentations[0].tierPresentations.options.map(o => o.params[0].bindingRef.recordId), [claim.recordId, last.recordId]);
  assert.equal(r.additions.presentations[0].official.resolvedText, '+20%，持續2秒');
  assert.deepEqual(r.authoring.reviewReceipts, before.baseAuthoring.reviewReceipts);
  assert.deepEqual(r.officialInputs.sources[0], before.baseOfficialInputs.sources[0]);
  assert.deepEqual(f, before);
});

// Scenario: a referenced Source id cannot fit Web schema. Purpose: report rather than emit invalid bindings.
test('UnitT80_overlong_claim_id_is_reported_as_other', () => {
  const f = fixture(), claim = f.candidates.records[2];
  claim.recordId = 'darktide:claim:' + 'a'.repeat(128); f.approved.recordIds.push(claim.recordId);
  const r = generatePresentations(f);
  assert.equal(r.additions.presentations.length, 0);
  assert.equal(r.skipped[0].reason, 'other');
});

// Scenario: approval or digest differs. Purpose: reject before any output can be written.
test('UnitT90_invalid_approval_or_digest_fails_without_mutation', () => {
  const generated = generatePresentations(fixture());
  const approval = { decision: 'approved', reviewer: { kind: 'human', id: 'reviewer' }, reviewedAt: '2026-01-01T00:00:00Z', reviewedPackage: { packageDigest: generated.packageDigest } };
  const before = structuredClone(generated.authoring);
  for (const bad of [{ ...approval, decision: 'rejected' }, { ...approval, reviewedPackage: { packageDigest: 'wrong' } }]) {
    assert.throws(() => applyApprovedReceipts({ ...generated, approval: bad, packageDigest: generated.packageDigest, inputs: {} }));
    assert.deepEqual(generated.authoring, before);
  }
});

// Scenario: an approved added target and an existing receipt. Purpose: create a current receipt without altering existing receipts.
test('UnitT95_approved_additions_preserve_existing_receipts', () => {
  const f = fixture(), generated = generatePresentations(f);
  const existing = { targetId: 'old', unchanged: true };
  generated.authoring.reviewReceipts.push(existing);
  const records = f.candidates.records;
  const inputs = { mode: 'w06', sourceContract: { records }, sourceRecordMap: new Map(records.map(r => [r.gameReleaseId + '\0' + r.recordId, r])), officialInputs: generated.officialInputs, termRules: { rules: [] }, sourceValidator: { computeReviewDigests: () => ({ targetDigest: 'a', dependenciesDigest: 'b' }) } };
  const approval = { decision: 'approved', reviewer: { kind: 'human', id: 'reviewer' }, reviewedAt: '2026-01-01T00:00:00Z', reviewedPackage: { packageDigest: generated.packageDigest } };
  const result = applyApprovedReceipts({ ...generated, approval, packageDigest: generated.packageDigest, inputs });
  assert.deepEqual(result.reviewReceipts[0], existing);
  for (const target of generated.additions.reviewTargets) assert.equal(getReviewState(result, target.targetId, inputs), 'approved');
});
