export const RELEASE = 'darktide:test-release';

export const refs = Object.freeze({
  skill: { gameReleaseId: RELEASE, kind: 'skill', recordId: 'darktide:skill:test' },
  termA: { gameReleaseId: RELEASE, kind: 'term', recordId: 'darktide:term:test:context-a' },
  termB: { gameReleaseId: RELEASE, kind: 'term', recordId: 'darktide:term:test:context-b' },
  blessing: { gameReleaseId: RELEASE, kind: 'blessing', recordId: 'darktide:blessing:family:mark:sample' },
  blessingVariant: { gameReleaseId: RELEASE, kind: 'blessing-variant', recordId: 'darktide:blessing-variant:family:mark:sample' },
  weaponIv: { gameReleaseId: RELEASE, kind: 'weapon', recordId: 'darktide:weapon:family:mark-iv' },
  weaponXii: { gameReleaseId: RELEASE, kind: 'weapon', recordId: 'darktide:weapon:family:mark-xii' },
  skillClaim: { gameReleaseId: RELEASE, kind: 'claim', recordId: 'darktide:claim:skill:sample' },
  skillEvidence: { gameReleaseId: RELEASE, kind: 'evidence', recordId: 'darktide:evidence:skill:sample' },
  blessingClaim1: { gameReleaseId: RELEASE, kind: 'claim', recordId: 'darktide:claim:blessing:tier-1' },
  blessingClaim4: { gameReleaseId: RELEASE, kind: 'claim', recordId: 'darktide:claim:blessing:tier-4' },
  blessingDuration: { gameReleaseId: RELEASE, kind: 'claim', recordId: 'darktide:claim:blessing:duration' },
  weaponClaim60: { gameReleaseId: RELEASE, kind: 'claim', recordId: 'darktide:claim:weapon:comparison-60' },
  weaponClaim80: { gameReleaseId: RELEASE, kind: 'claim', recordId: 'darktide:claim:weapon:comparison-80' },
  weaponCurveIv: { gameReleaseId: RELEASE, kind: 'stat-curve', recordId: 'darktide:stat-curve:weapon:mark-iv' },
  weaponCurveXii: { gameReleaseId: RELEASE, kind: 'stat-curve', recordId: 'darktide:stat-curve:weapon:mark-xii' },
  weaponDefinitionIv: { gameReleaseId: RELEASE, kind: 'stat-definition', recordId: 'darktide:stat-definition:weapon:mark-iv' },
  weaponDefinitionXii: { gameReleaseId: RELEASE, kind: 'stat-definition', recordId: 'darktide:stat-definition:weapon:mark-xii' },
  attackIv: { gameReleaseId: RELEASE, kind: 'attack-profile', recordId: 'darktide:attack-profile:weapon:mark-iv:light' },
  attackXii: { gameReleaseId: RELEASE, kind: 'attack-profile', recordId: 'darktide:attack-profile:weapon:mark-xii:heavy' },
});

export const officialIds = Object.freeze({
  skillName: 'official:test:skill-name:zh-tw',
  skillDescription: 'official:test:skill-description:zh-tw',
  blessingName: 'official:test:blessing-name:zh-tw',
  blessingTier1: 'official:test:blessing-tier-1:zh-tw',
  blessingTier4: 'official:test:blessing-tier-4:zh-tw',
  weaponIvName: 'official:test:weapon-mark-iv:zh-tw',
  weaponXiiName: 'official:test:weapon-mark-xii:zh-tw',
});

const segmentSha256 = 'a'.repeat(64);
export const blessingSegmentSha256 = 'e7ce7bad747cd7f5f80ed55eb4fa2ce406dfcfcf1896d4ee771ab92d1d085b78';
const asRecord = (ref, payload = {}) => ({ ...ref, payload });
const officialInput = (officialSourceId, entityRef, sourceText, resolvedText, extra = {}) => ({
  officialSourceId,
  sourceLocale: 'zh-TW',
  entityRef,
  sourceText,
  resolvedText,
  segments: [],
  ...extra,
});
const sourceRef = (recordRef) => ({ gameReleaseId: recordRef.gameReleaseId, recordId: recordRef.recordId });

export function makeSkillDomain({ presentationOverrides = {}, extraRecords = [] } = {}) {
  const presentation = {
    authoringId: 'web:presentation:test-skill',
    entityRef: refs.skill,
    locale: 'zh-TW',
    name: '測試天賦',
    nameOfficialSourceId: officialIds.skillName,
    official: { entityRef: refs.skill, officialSourceId: officialIds.skillDescription },
    errata: [],
    detailSections: [
      { sectionId: 'extra', items: [{ itemId: 'extra-1', text: '補充文字。', termRefs: [refs.termA], termRuleRefs: [] }] },
      { sectionId: 'notes', items: [] },
      { sectionId: 'effects', items: [{ itemId: 'effect-1', text: '效果文字。', termRefs: [refs.termA], termRuleRefs: [] }] },
      { sectionId: 'conditions', items: [{ itemId: 'condition-1', text: '條件文字。', termRefs: [refs.termB], termRuleRefs: [] }] },
      { sectionId: 'calculation', items: [] },
    ],
    ...presentationOverrides,
  };
  return {
    schemaVersion: 'w08-shared-domain/1.0.0',
    kind: 'skills',
    gameReleaseId: RELEASE,
    source: {
      records: [
        asRecord(refs.skill, { termRefs: [refs.termA, refs.termA, refs.termB] }),
        asRecord(refs.termA, { contextKey: 'skill.stats' }),
        asRecord(refs.termB, { contextKey: 'skill.conditions' }),
        asRecord(refs.skillClaim),
        asRecord(refs.skillEvidence),
        ...extraRecords,
      ],
    },
    web: {
      presentations: [presentation],
      officialInputs: {
        sources: [
          officialInput(officialIds.skillName, refs.skill, '測試天賦', '測試天賦'),
          officialInput(officialIds.skillDescription, refs.skill, '官方來源文字。', '官方解析文字。', {
            segments: [{ segmentId: 'description-1', sha256: segmentSha256, text: '官方來源文字。' }],
          }),
        ],
      },
      termLocalizations: [],
    },
  };
}

export function makeTermsDomain() {
  return {
    schemaVersion: 'w08-shared-domain/1.0.0',
    kind: 'terms',
    gameReleaseId: RELEASE,
    source: { records: [
      asRecord(refs.termA, { contextKey: 'skill.stats' }),
      asRecord(refs.termB, { contextKey: 'skill.conditions' }),
    ] },
    web: {
      presentations: [],
      officialInputs: { sources: [] },
      termLocalizations: [
        { termRef: refs.termA, contextKey: 'skill.stats', locale: 'zh-TW', label: '倍率', definition: '這個脈絡中的倍率。' },
        { termRef: refs.termB, contextKey: 'skill.conditions', locale: 'zh-TW', label: '倍率', definition: '這個脈絡中的條件倍率。' },
      ],
    },
  };
}

function blessingOption(tier, displayPercent, officialSourceId, claimRef) {
  const valueText = `+${displayPercent}%`;
  return {
    tier,
    params: [
      { bindingRef: claimRef, format: 'signed-percent', name: 'movement_speed', placeholder: '{movement_speed:%s}' },
      { bindingRef: refs.blessingDuration, format: 'plain-number', name: 'time', placeholder: '{time:%s}' },
    ],
    officialLocaleRefs: [{ officialSourceId, sourceLocale: 'zh-TW' }],
    detailSections: [
      { sectionId: 'extra', items: [] },
      { sectionId: 'conditions', items: [{ itemId: `condition-${tier}`, text: `第 ${tier} 級持續 2 秒。`, termRefs: [], termRuleRefs: [] }] },
      { sectionId: 'calculation', items: [] },
      { sectionId: 'effects', items: [{
        itemId: `effect-${tier}`,
        claimRefs: [claimRef],
        termRefs: [],
        termRuleRefs: [],
        parts: [
          { kind: 'literal', text: '移動速度提高 ' },
          { bindingRef: claimRef, kind: 'unsigned-percent' },
          { kind: 'literal', text: '。' },
        ],
      }] },
      { sectionId: 'notes', items: [{ itemId: `note-${tier}`, text: `第 ${tier} 級備註。`, termRefs: [], termRuleRefs: [] }] },
    ],
    fixtureValueText: valueText,
  };
}

export function makeBlessingDomains({ weaponRefs = [refs.weaponIv], presentationOverrides = {} } = {}) {
  const tier1 = blessingOption(1, 17, officialIds.blessingTier1, refs.blessingClaim1);
  const tier4 = blessingOption(4, 20, officialIds.blessingTier4, refs.blessingClaim4);
  const presentation = {
    authoringId: 'web:presentation:test-blessing',
    entityRef: refs.blessing,
    locale: 'zh-TW',
    name: '提速',
    nameOfficialSourceId: officialIds.blessingName,
    official: { entityRef: refs.blessing, officialSourceId: officialIds.blessingTier4, bindingContext: { tier: 4, variantRef: refs.blessingVariant } },
    errata: [],
    detailSections: [],
    tierApplicability: [{ variantRef: refs.blessingVariant, tiers: [1, 4] }],
    tierPresentations: { defaultTier: 4, options: [tier1, tier4] },
    ...presentationOverrides,
  };
  const tierSource = (officialSourceId, tier, displayPercent) => officialInput(
    officialSourceId,
    refs.blessing,
    `武器特殊啟動後{movement_speed:%s}移動速度，持續{time:%s}秒。`,
    `武器特殊啟動後+${displayPercent}%移動速度，持續2秒。`,
    {
      bindingContext: { tier, variantRef: refs.blessingVariant },
      params: [
        { parameterId: 'movement_speed', sourceKey: tier === 1 ? refs.blessingClaim1.recordId : refs.blessingClaim4.recordId, value: `+${displayPercent}%` },
        { parameterId: 'time', sourceKey: refs.blessingDuration.recordId, value: '2' },
      ],
      ...(tier === 4 ? {
        segments: [{ kind: 'text', segmentId: 'tier-4-official-text', sha256: blessingSegmentSha256, text: '武器特殊啟動後' }],
      } : {}),
    },
  );
  const blessing = {
    schemaVersion: 'w08-shared-domain/1.0.0', kind: 'blessings', gameReleaseId: RELEASE,
    source: { records: [
      asRecord(refs.blessing, { variantRefs: [sourceRef(refs.blessingVariant)] }),
      asRecord(refs.blessingVariant, {
        blessingRef: sourceRef(refs.blessing),
        weaponRefs,
        definedTiers: [1, 4],
        obtainableTiers: { status: 'unknown', reasonCode: 'NOT_VERIFIED' },
        tierValues: [
          { tier: 1, value: { status: 'known', decimal: '0.17', unit: 'ratio' } },
          { tier: 4, value: { status: 'known', decimal: '0.2', unit: 'ratio' } },
        ],
      }),
      asRecord(refs.blessingClaim1, { value: { status: 'known', decimal: '0.17', unit: 'ratio' } }),
      asRecord(refs.blessingClaim4, { value: { status: 'known', decimal: '0.2', unit: 'ratio' } }),
      asRecord(refs.blessingDuration, { value: { status: 'known', decimal: '2', unit: 's' } }),
      asRecord(refs.skillEvidence),
    ] },
    web: {
      presentations: [presentation],
      officialInputs: { sources: [
        officialInput(officialIds.blessingName, refs.blessing, '提速', '提速'),
        tierSource(officialIds.blessingTier1, 1, 17),
        tierSource(officialIds.blessingTier4, 4, 20),
      ] },
      termLocalizations: [],
    },
  };
  return blessing;
}

export function makeWeaponDomain() {
  const weapons = [
    { weaponRef: refs.weaponIv, markId: 'mark-iv', markLabel: 'Mk IV', curveRef: refs.weaponCurveIv, definitionRef: refs.weaponDefinitionIv, attackRef: refs.attackIv, damage: '80' },
    { weaponRef: refs.weaponXii, markId: 'mark-xii', markLabel: 'Mk XII', curveRef: refs.weaponCurveXii, definitionRef: refs.weaponDefinitionXii, attackRef: refs.attackXii, damage: '96' },
  ];
  const sourceRecords = [];
  const presentations = [];
  const officialSources = [];
  for (const row of weapons) {
    const officialSourceId = row.markId === 'mark-iv' ? officialIds.weaponIvName : officialIds.weaponXiiName;
    const claim60 = { ...refs.weaponClaim60, recordId: `${refs.weaponClaim60.recordId}:${row.markId}` };
    const claim80 = { ...refs.weaponClaim80, recordId: `${refs.weaponClaim80.recordId}:${row.markId}` };
    const statSection = {
      label: '傷害',
      sourceStat: `source-stat:${row.markId}`,
      claimRefs: [claim60, claim80],
      curveRefs: [row.curveRef],
      statDefinitionRefs: [row.definitionRef],
    };
    sourceRecords.push(
      asRecord(row.weaponRef, {
        familyId: 'chainaxe-p1',
        markId: row.markId,
        displayedAttacks: [{ key: 'primary', mode: 'light', segments: [{ index: 1, attackType: 'smiter', targetRole: 'single-target' }] }],
        actionContinuations: { primary: [{ action: `action-${row.markId}`, condition: `condition-${row.markId}` }] },
        statBindings: [{ stat: `source-stat:${row.markId}`, binding: row.damage }],
        statTables: [{ tableKey: `table-${row.markId}`, values: [row.damage] }],
      }),
      asRecord(claim60, { comparisonPoint: 60, value: { status: 'known', decimal: row.damage, unit: 'attack-power-point' } }),
      asRecord(claim80, { comparisonPoint: 80, value: { status: 'known', decimal: String(Number(row.damage) + 20), unit: 'attack-power-point' } }),
      asRecord(row.curveRef, { knots: [{ input: '0', output: row.damage }, { input: '1', output: String(Number(row.damage) + 20) }], panelInputRange: { status: 'not-applicable' } }),
      asRecord(row.definitionRef, { quantity: `source-quantity:${row.markId}`, unit: 'attack-power-point' }),
      asRecord(row.attackRef, { weaponRef: sourceRef(row.weaponRef), chain: [`light-${row.markId}`, `heavy-${row.markId}`], condition: `native-condition-${row.markId}` }),
    );
    presentations.push({
      authoringId: `web:presentation:${row.markId}`,
      entityRef: row.weaponRef,
      locale: 'zh-TW',
      name: '突擊鏈斧',
      nameOfficialSourceId: officialSourceId,
      official: { entityRef: row.weaponRef, officialSourceId },
      errata: [],
      detailSections: [],
      weaponView: {
        sourceWeaponRef: row.weaponRef,
        markLabel: row.markLabel,
        attackHeading: '連段',
        comparisonHeading: '比較點',
        note: '數值依來源資料列示。',
        statSections: [statSection],
        attackProfileRefs: [row.attackRef],
      },
    });
    officialSources.push(officialInput(officialSourceId, row.weaponRef, '突擊鏈斧', '突擊鏈斧'));
  }
  return {
    schemaVersion: 'w08-shared-domain/1.0.0', kind: 'weapons', gameReleaseId: RELEASE,
    source: { records: sourceRecords },
    web: { presentations, officialInputs: { sources: officialSources }, termLocalizations: [] },
  };
}

export function makeViewModelDomains({ blessingWeaponRefs = [refs.weaponIv] } = {}) {
  return [
    makeSkillDomain(),
    makeBlessingDomains({ weaponRefs: blessingWeaponRefs }),
    makeWeaponDomain(),
    makeTermsDomain(),
  ];
}

export { segmentSha256 };
