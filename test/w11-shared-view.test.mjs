import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSharedViewModel } from '../web/shared-view.mjs';
import {
  RELEASE,
  refs,
  officialIds,
  makeSkillDomain,
  makeTermsDomain,
  makeBlessingDomains,
  makeWeaponDomain,
  makeViewModelDomains,
  segmentSha256,
  blessingSegmentSha256,
} from './w11-shared-view.fixture.mjs';

// Scenario: A skill presentation lists five sections out of order and includes empty sections.
// Purpose: Keep official wording separate from Web details, preserve the five-section order, and omit empty sections.
// Given an exact zh-TW skill and official inputs, When the consumer view is built, Then it returns only nonempty sections in v17 order.
test('UnitT10_keeps_official_text_separate_and_orders_nonempty_skill_sections', () => {
  const view = createSharedViewModel({ domains: [makeSkillDomain()], gameReleaseId: RELEASE });

  const result = view.getSkill(refs.skill);

  assert.equal(result.status, 'ready');
  assert.equal(result.name, '測試天賦');
  assert.deepEqual(result.official, {
    sourceText: '官方來源文字。',
    resolvedText: '官方解析文字。',
    sourceLocale: 'zh-TW',
  });
  assert.deepEqual(result.sections.map((section) => section.sectionId), ['effects', 'conditions', 'extra']);
  assert.deepEqual(result.sections.map((section) => section.heading), ['效果', '條件', '額外說明']);
  assert.deepEqual(result.errata, []);
});

// Scenario: One erratum is anchored to the displayed official segment and another has a stale segment digest.
// Purpose: Keep official wording separate and never display an erratum whose exact source anchor no longer matches.
// Given one exact and one stale source anchor, When the skill view is built, Then only the matching erratum is returned separately.
test('UnitT20_shows_only_errata_with_an_exact_official_segment_anchor', () => {
  const domain = makeSkillDomain({ presentationOverrides: { errata: [
    {
      errataId: 'valid-erratum',
      anchor: { officialSourceId: officialIds.skillDescription, segmentId: 'description-1', segmentSha256 },
      context: { description: '適用範圍', refs: [refs.skillClaim] },
      claimRefs: [refs.skillClaim], evidenceRefs: [refs.skillEvidence], text: '此處另有獨立勘誤。',
    },
    {
      errataId: 'stale-erratum',
      anchor: { officialSourceId: officialIds.skillDescription, segmentId: 'description-1', segmentSha256: 'b'.repeat(64) },
      context: { description: '舊錨點', refs: [refs.skillClaim] },
      claimRefs: [refs.skillClaim], evidenceRefs: [refs.skillEvidence], text: '不可顯示的舊勘誤。',
    },
  ] } });
  const result = createSharedViewModel({ domains: [domain], gameReleaseId: RELEASE }).getSkill(refs.skill);

  assert.equal(result.status, 'ready');
  assert.equal(result.official.resolvedText, '官方解析文字。');
  assert.deepEqual(result.errata.map((row) => row.text), ['此處另有獨立勘誤。']);
});

// Scenario: A skill and its sections repeat a typed term reference while another term has a different context.
// Purpose: Deduplicate the same term in one context without merging distinct contexts that share a Chinese label.
// Given repeated typed refs and two context-specific localizations, When terms are collected, Then only duplicate ref/context pairs collapse.
test('UnitT30_deduplicates_shared_terms_by_typed_ref_and_context', () => {
  const view = createSharedViewModel({ domains: [makeSkillDomain(), makeTermsDomain()], gameReleaseId: RELEASE });

  const result = view.getSkill(refs.skill);

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.terms.map((term) => [term.label, term.contextKey]), [
    ['倍率', 'skill.stats'],
    ['倍率', 'skill.conditions'],
  ]);
  assert.deepEqual(result.terms.map((term) => term.definition), ['這個脈絡中的倍率。', '這個脈絡中的條件倍率。']);
});

// Scenario: The only matching presentation is not zh-TW, though an English official input is present.
// Purpose: Refuse the record with a clear Traditional Chinese status instead of falling back to English.
// Given no zh-TW presentation, When the skill is requested, Then the view is unavailable and contains no English fallback.
test('UnitT40_rejects_missing_zh_tw_without_english_fallback', () => {
  const domain = makeSkillDomain({ presentationOverrides: { locale: 'en', name: 'Test Skill' } });
  domain.web.officialInputs.sources.push({
    officialSourceId: 'official:test:skill-name:en',
    sourceLocale: 'en',
    entityRef: refs.skill,
    sourceText: 'Test Skill',
    resolvedText: 'Test Skill',
    segments: [],
  });
  const result = createSharedViewModel({ domains: [domain], gameReleaseId: RELEASE }).getSkill(refs.skill);

  assert.equal(result.status, 'unavailable');
  assert.match(result.statusText, /繁體中文/);
  assert.equal(result.name, undefined);
});

// Scenario: The same blessing variant is requested at two defined tiers for one exact weapon family and mark.
// Purpose: Switch official text, parameters, tier value, and every detail section as one tier-bound view.
// Given two exact tier options on one linked weapon mark, When tiers 1 and 4 are requested, Then each complete source-backed bundle stays tier-specific.
test('UnitT50_switches_blessing_tier_as_one_exact_family_mark_view', () => {
  const view = createSharedViewModel({ domains: [makeBlessingDomains(), makeWeaponDomain()], gameReleaseId: RELEASE });
  const request = { blessingRef: refs.blessing, variantRef: refs.blessingVariant, familyId: 'chainaxe-p1', markId: 'mark-iv' };

  const tier1 = view.getBlessing({ ...request, tier: 1 });
  const tier4 = view.getBlessing({ ...request, tier: 4 });

  assert.equal(tier1.status, 'ready');
  assert.equal(tier4.status, 'ready');
  assert.equal(tier1.official.resolvedText, '武器特殊啟動後+17%移動速度，持續2秒。');
  assert.equal(tier4.official.resolvedText, '武器特殊啟動後+20%移動速度，持續2秒。');
  assert.deepEqual(tier1.official.params.map((param) => param.value), ['+17%', '2']);
  assert.deepEqual(tier4.official.params.map((param) => param.value), ['+20%', '2']);
  assert.equal(tier1.sourceTierValue.decimal, '0.17');
  assert.equal(tier4.sourceTierValue.decimal, '0.2');
  assert.deepEqual(tier1.sections.map((section) => section.sectionId), ['effects', 'conditions', 'notes']);
  assert.deepEqual(tier4.sections.map((section) => section.sectionId), ['effects', 'conditions', 'notes']);
  assert.deepEqual(tier1.sections[0].items[0].parts.map((part) => part.text ?? part.value), ['移動速度提高 ', '+17%', '。']);
  assert.deepEqual(tier4.sections[0].items[0].parts.map((part) => part.text ?? part.value), ['移動速度提高 ', '+20%', '。']);
  assert.match(tier1.sections[1].items[0].text, /第 1 級/);
  assert.match(tier4.sections[1].items[0].text, /第 4 級/);
});

// Scenario: A blessing query has an unknown tier, conflicting mark/family, or no explicit variant-to-weapon ref.
// Purpose: Never default an unknown level to the highest tier or infer family/mark applicability from identifiers.
// Given unsupported or contradictory identity inputs, When the blessing is requested, Then no implicit tier or weapon binding is selected.
test('UnitT55_rejects_unknown_tier_and_unproven_blessing_weapon_identity', () => {
  const domains = makeViewModelDomains();
  const view = createSharedViewModel({ domains, gameReleaseId: RELEASE });
  const request = { blessingRef: refs.blessing, variantRef: refs.blessingVariant, familyId: 'chainaxe-p1', markId: 'mark-iv' };

  assert.equal(view.getBlessing({ ...request, tier: 3 }).reason, 'unknown-tier');
  assert.equal(view.getBlessing({ ...request, familyId: 'other-family', tier: 1 }).status, 'unavailable');
  assert.equal(view.getBlessing({ ...request, markId: 'mark-xii', tier: 1 }).status, 'unavailable');
  assert.equal(view.getBlessing({ ...request, familyId: 'chainaxe-p1', markId: undefined, tier: 1 }).reason, 'incomplete-weapon-context');
  assert.equal(view.getBlessing({ ...request, blessingRef: { ...refs.blessing, gameReleaseId: 'darktide:1.13.1' }, tier: 1 }).status, 'unavailable');

  const noWeaponLink = createSharedViewModel({
    domains: makeViewModelDomains({ blessingWeaponRefs: [] }),
    gameReleaseId: RELEASE,
  }).getBlessing({ ...request, tier: 1 });
  assert.equal(noWeaponLink.reason, 'family-mark-unverified');
});

// Scenario: A blessing erratum matches the presentation's canonical tier-4 official source while a second anchor is stale.
// Purpose: Show only the exact canonical erratum with its original segment and context, and prevent it from leaking into tier 1.
// Given exact and stale tier-4 anchors, When tier 4 and tier 1 are requested, Then only canonical tier 4 carries the independent erratum.
test('UnitT56_shows_blessing_errata_only_for_its_canonical_official_tier', () => {
  const blessingDomain = makeBlessingDomains({ presentationOverrides: { errata: [
    {
      errataId: 'valid-tier-4-erratum',
      anchor: { officialSourceId: officialIds.blessingTier4, segmentId: 'tier-4-official-text', segmentSha256: blessingSegmentSha256 },
      context: { description: '只適用於第 4 級的官方原句。', refs: [refs.blessingClaim4] },
      claimRefs: [refs.blessingClaim4], evidenceRefs: [refs.skillEvidence], text: '第 4 級另有勘誤。',
    },
    {
      errataId: 'stale-tier-4-erratum',
      anchor: { officialSourceId: officialIds.blessingTier4, segmentId: 'tier-4-official-text', segmentSha256: 'd'.repeat(64) },
      context: { description: '失效錨點。', refs: [refs.blessingClaim4] },
      claimRefs: [refs.blessingClaim4], evidenceRefs: [refs.skillEvidence], text: '不可顯示的勘誤。',
    },
  ] } });
  const view = createSharedViewModel({ domains: [blessingDomain, makeWeaponDomain()], gameReleaseId: RELEASE });
  const query = { blessingRef: refs.blessing, variantRef: refs.blessingVariant, familyId: 'chainaxe-p1', markId: 'mark-iv' };
  const tier4 = view.getBlessing({ ...query, tier: 4 });
  const tier1 = view.getBlessing({ ...query, tier: 1 });

  assert.equal(tier4.status, 'ready');
  assert.deepEqual(tier4.errata.map((row) => row.text), ['第 4 級另有勘誤。']);
  assert.equal(tier4.errata[0].sourceText, '武器特殊啟動後{movement_speed:%s}移動速度，持續{time:%s}秒。');
  assert.equal(tier4.errata[0].sourceSegmentText, '武器特殊啟動後');
  assert.equal(tier4.errata[0].context.description, '只適用於第 4 級的官方原句。');
  assert.equal(tier4.errata[0].anchor.officialSourceId, officialIds.blessingTier4);
  assert.equal(tier1.status, 'ready');
  assert.deepEqual(tier1.errata, []);
});

// Scenario: An exact approved blessing variant and tier have no verified family/mark relationship.
// Purpose: Keep the blessing's official text and detail readable while marking weapon applicability unknown.
// Given a tier query without weapon context, When the blessing is requested, Then the view is ready with no asserted family or mark.
test('UnitT57_shows_exact_blessing_tier_without_claiming_unknown_weapon_applicability', () => {
  const view = createSharedViewModel({ domains: makeViewModelDomains({ blessingWeaponRefs: [] }), gameReleaseId: RELEASE });
  const tier1 = view.getBlessing({ blessingRef: refs.blessing, variantRef: refs.blessingVariant, tier: 1 });
  const tier4 = view.getBlessing({ blessingRef: refs.blessing, variantRef: refs.blessingVariant, tier: 4 });

  assert.equal(tier1.status, 'ready');
  assert.equal(tier4.status, 'ready');
  assert.equal(tier1.official.resolvedText, '武器特殊啟動後+17%移動速度，持續2秒。');
  assert.equal(tier4.official.resolvedText, '武器特殊啟動後+20%移動速度，持續2秒。');
  assert.deepEqual(tier1.applicability, { status: 'unknown', verification: 'unverified', reason: 'weapon-context-not-selected' });
  assert.deepEqual(tier4.applicability, { status: 'unknown', verification: 'unverified', reason: 'weapon-context-not-selected' });
  assert.equal(tier1.familyId, undefined);
  assert.equal(tier1.markId, undefined);
});

// Scenario: Two marks share a weapon family but own separate Source claims, curves, attack chains, and conditions.
// Purpose: Switch the whole mark bundle without cross-mark mixing or turning comparison points into drop bounds.
// Given two marks with independent Source rows, When family and mark views are built, Then every value and attack bundle remains mark-local.
test('UnitT60_keeps_each_weapon_mark_source_bundle_together', () => {
  const view = createSharedViewModel({ domains: [makeWeaponDomain()], gameReleaseId: RELEASE });

  const family = view.getWeaponFamily('chainaxe-p1');
  const markIv = view.getWeapon({ familyId: 'chainaxe-p1', markId: 'mark-iv' });
  const markXii = view.getWeapon({ familyId: 'chainaxe-p1', markId: 'mark-xii' });

  assert.equal(family.status, 'ready');
  assert.deepEqual(family.marks.map((mark) => mark.markLabel), ['Mk IV', 'Mk XII']);
  assert.equal(markIv.status, 'ready');
  assert.equal(markXii.status, 'ready');
  assert.equal(markIv.statSections[0].label, '傷害');
  assert.deepEqual(markIv.statSections[0].claims.map((claim) => claim.payload.comparisonPoint), [60, 80]);
  assert.deepEqual(markXii.statSections[0].claims.map((claim) => claim.payload.comparisonPoint), [60, 80]);
  assert.equal(markIv.statSections[0].claims[0].payload.value.decimal, '80');
  assert.equal(markXii.statSections[0].claims[0].payload.value.decimal, '96');
  assert.equal(markIv.statSections[0].curves[0].payload.knots[0].output, '80');
  assert.equal(markXii.statSections[0].curves[0].payload.knots[0].output, '96');
  assert.equal(markIv.statSections[0].statDefinitions[0].payload.quantity, 'source-quantity:mark-iv');
  assert.equal(markXii.statSections[0].statDefinitions[0].payload.quantity, 'source-quantity:mark-xii');
  assert.equal(markIv.source.statDefinitions[0].curve.recordId, refs.weaponCurveIv.recordId);
  assert.equal(markXii.source.statDefinitions[0].curve.recordId, refs.weaponCurveXii.recordId);
  assert.equal(markIv.source.statDefinitions[0].curve.payload.knots[0].output, '80');
  assert.equal(markXii.source.statDefinitions[0].curve.payload.knots[0].output, '96');
  assert.equal(markIv.source.statBindings[0].binding, '80');
  assert.equal(markXii.source.statBindings[0].binding, '96');
  assert.deepEqual(markIv.source.statTables[0].values, ['80']);
  assert.deepEqual(markXii.source.statTables[0].values, ['96']);
  assert.deepEqual(markIv.attackProfiles[0].payload.chain, ['light-mark-iv', 'heavy-mark-iv']);
  assert.deepEqual(markXii.attackProfiles[0].payload.chain, ['light-mark-xii', 'heavy-mark-xii']);
  assert.equal(markIv.source.actionContinuations.primary[0].condition, 'condition-mark-iv');
  assert.equal(markXii.source.actionContinuations.primary[0].condition, 'condition-mark-xii');
  assert.equal(markIv.dropRange, undefined);
  assert.equal(markXii.dropRange, undefined);
});

// Scenario: A weapon detail section cites repeated typed terms and has valid plus stale official-source anchors.
// Purpose: Preserve context-scoped weapon terminology and show only errata anchored to the canonical official source.
// Given one canonical weapon source segment and a stale digest, When a mark view is built, Then terms deduplicate and only the exact erratum remains.
test('UnitT65_weapon_view_preserves_typed_terms_and_only_exact_canonical_errata', () => {
  const domains = [makeWeaponDomain({ withAnnotations: true }), makeTermsDomain({ withWeaponTerms: true })];
  const result = createSharedViewModel({ domains, gameReleaseId: RELEASE })
    .getWeapon({ familyId: 'chainaxe-p1', markId: 'mark-iv' });

  assert.equal(result.status, 'ready');
  assert.equal(result.official.resolvedText, '同版官方武器描述。');
  assert.deepEqual(result.terms.map((term) => [term.label, term.contextKey, term.definition]), [
    ['攻擊對象', 'weapon.displayed-attacks', '此武器攻擊資料列示的目標類型。'],
  ]);
  assert.deepEqual(result.termRules, [{ ruleId: 'weapon:rule:chain', text: '連段資料依來源列示。' }]);
  assert.deepEqual(result.errata.map((row) => row.text), ['此型號另有獨立勘誤。']);
  assert.equal(result.errata[0].anchor.officialSourceId, officialIds.weaponIvDescription);
  assert.equal(result.errata[0].context.description, '只說明 Mk IV 的名稱範圍。');
});

const approvedPackageDir = process.env.SYP_W11_APPROVED_PACKAGE_DIR;
// Scenario: The fixed isolated candidate has exact pinned bytes but is not a selected or published release.
// Purpose: Re-run the pure model against real approved input without copying its multi-megabyte domains into the repository.
// Given an explicit local package directory, When all four raw domains are checked and viewed, Then skill, tier, and two-mark data pass with unchanged source hashes.
test('InterT10_reads_fixed_candidate_skills_blessing_tiers_and_two_weapon_marks_without_byte_changes', {
  skip: approvedPackageDir ? false : 'Set SYP_W11_APPROVED_PACKAGE_DIR to the isolated fixed candidate directory.',
}, () => {
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const manifestBytes = readFileSync(join(approvedPackageDir, 'manifest.json'));
  assert.equal(hash(manifestBytes), 'bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.dataRevision, '808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62');
  assert.equal(manifest.files.length, 4);

  const domains = [];
  const hashesBefore = new Map();
  let totalBytes = 0;
  for (const file of manifest.files) {
    const bytes = readFileSync(join(approvedPackageDir, file.path));
    assert.equal(bytes.length, file.sizeBytes, `${file.path} size`);
    assert.equal(hash(bytes), file.sha256, `${file.path} SHA-256`);
    totalBytes += bytes.length;
    hashesBefore.set(file.path, hash(bytes));
    domains.push(JSON.parse(bytes.toString('utf8')));
  }
  assert.equal(totalBytes, 7065789);
  const view = createSharedViewModel({ domains, gameReleaseId: manifest.gameReleaseId });

  const skills = domains.find((domain) => domain.kind === 'skills');
  const skill = view.getSkill(skills.web.presentations[0].entityRef);
  assert.equal(skill.status, 'ready', skill.reason);
  assert.equal(skill.sections.length, 5);

  const blessings = domains.find((domain) => domain.kind === 'blessings');
  const blessingPresentation = blessings.web.presentations.find((row) => row.tierApplicability?.length);
  const variantRef = blessingPresentation.tierApplicability[0].variantRef;
  const blessingQuery = { blessingRef: blessingPresentation.entityRef, variantRef };
  const tier1 = view.getBlessing({ ...blessingQuery, tier: 1 });
  const tier4 = view.getBlessing({ ...blessingQuery, tier: 4 });
  assert.equal(tier1.status, 'ready', tier1.reason);
  assert.equal(tier4.status, 'ready', tier4.reason);
  assert.notEqual(tier1.official.resolvedText, tier4.official.resolvedText);
  assert.ok(tier1.sections.length > 0);
  assert.deepEqual(tier1.sections.map((section) => section.sectionId), tier4.sections.map((section) => section.sectionId));
  assert.notDeepEqual(tier1.sections, tier4.sections);
  assert.deepEqual(tier1.applicability, { status: 'unknown', verification: 'unverified', reason: 'weapon-context-not-selected' });
  assert.deepEqual(tier4.applicability, { status: 'unknown', verification: 'unverified', reason: 'weapon-context-not-selected' });

  const weapons = domains.find((domain) => domain.kind === 'weapons');
  const firstPresentation = weapons.web.presentations.find((row) => row.weaponView?.sourceWeaponRef);
  const firstWeapon = weapons.source.records.find((record) => record.kind === 'weapon'
    && record.recordId === firstPresentation.weaponView.sourceWeaponRef.recordId);
  const sameFamily = weapons.source.records.filter((record) => record.kind === 'weapon'
    && record.payload.familyId === firstWeapon.payload.familyId);
  const marks = [...new Map(sameFamily.map((record) => [record.payload.markId, record])).values()].slice(0, 2);
  assert.equal(marks.length, 2);
  for (const record of marks) {
    const result = view.getWeapon({ familyId: record.payload.familyId, markId: record.payload.markId });
    assert.equal(result.status, 'ready', `${record.payload.familyId}/${record.payload.markId}: ${result.reason}`);
    assert.ok(result.statSections.length > 0);
    assert.ok(result.attackProfiles.length > 0);
  }

  for (const file of manifest.files) {
    assert.equal(hash(readFileSync(join(approvedPackageDir, file.path))), hashesBefore.get(file.path), `${file.path} unchanged`);
  }
});
