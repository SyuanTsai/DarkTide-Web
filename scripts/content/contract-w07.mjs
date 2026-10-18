import { createHash } from 'node:crypto';
import { lstat, mkdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeReviewDigests,
  getReviewState,
  loadWebAuthoringInputs,
  validateWebAuthoring,
} from './contract-authoring.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUTHORING_PATH = 'content/authoring/v2/w07-weapons.json';
const OFFICIAL_INPUTS_PATH = 'content/contracts/w07/official-inputs.json';
const SOURCE_DATA_PATH = 'content/contracts/w07/source-v2-snapshot/content/authoring/v2/w07-weapons.json';
const BASELINE_PATH = 'content/contracts/w07/baseline/w01-web-authoring.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const recordKey = ref => String(ref.gameReleaseId) + '\u0000' + String(ref.recordId);
const markdown = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\r', '').replaceAll('\n', '<br>');

function sourceRecord(inputs, ref, expectedKind) {
  const record = inputs.sourceRecordMap.get(recordKey(ref));
  if (!record || (expectedKind && record.kind !== expectedKind)) throw new Error('W07 matrix has an unresolved Source ' + (expectedKind ?? 'record') + ': ' + ref.gameReleaseId + ':' + ref.recordId);
  return record;
}

function typedRef(record) {
  return { recordId: record.recordId, gameReleaseId: record.gameReleaseId, kind: record.kind };
}

function sourceFact(record) {
  return {
    recordId: record.recordId,
    gameReleaseId: record.gameReleaseId,
    kind: record.kind,
    owner: record.owner,
    payload: record.payload,
    sourceRefs: record.sourceRefs,
    evidenceRefs: record.payload?.evidenceRefs ?? null,
    dataCoverage: record.dataCoverage,
  };
}

function statSectionRows(presentation, inputs) {
  return presentation.weaponView.statSections.map((section, sectionIndex) => {
    const target = inputs.authoring.reviewTargets.find(item => item.ownerId === presentation.authoringId && item.fieldPath === '/weaponView/statSections/' + sectionIndex);
    const claims = section.claimRefs.map(ref => sourceFact(sourceRecord(inputs, ref, 'claim')));
    const definitions = section.statDefinitionRefs.map(ref => {
      const definition = sourceRecord(inputs, ref, 'stat-definition');
      const curve = definition.payload.curveRef ? sourceRecord(inputs, { ...definition.payload.curveRef, kind: 'stat-curve' }, 'stat-curve') : null;
      return { definition: sourceFact(definition), curve: curve ? sourceFact(curve) : null };
    });
    return {
      sourceStat: section.sourceStat,
      label: section.label,
      reviewTargetId: target?.targetId ?? null,
      claimRefs: section.claimRefs,
      claims,
      statDefinitionRefs: section.statDefinitionRefs,
      statDefinitions: definitions,
      curveRefs: section.curveRefs,
    };
  });
}

function actionRows(presentation, inputs) {
  return presentation.weaponView.attackProfileRefs.map((ref, index) => {
    const profile = sourceRecord(inputs, ref, 'attack-profile');
    const target = inputs.authoring.reviewTargets.find(item => item.ownerId === presentation.authoringId && item.fieldPath === '/weaponView/attackProfileRefs/' + index);
    return {
      reviewTargetId: target?.targetId ?? null,
      sourceRef: typedRef(profile),
      action: profile.payload.action,
      mode: profile.payload.mode,
      templateKey: profile.payload.templateKey,
      damageProfileRefs: profile.payload.damageProfileRefs,
      sourceBindings: profile.payload.sourceBindings,
      continuations: profile.payload.continuations,
      stickyBindings: profile.payload.stickyBindings,
      dataCoverage: profile.dataCoverage,
      sourceRefs: profile.sourceRefs,
    };
  });
}

function wordingComparison(presentation, baselinePresentation) {
  const oldView = baselinePresentation?.payload?.weaponView ?? {};
  const currentView = presentation.weaponView;
  const rows = [
    ['presentation name', baselinePresentation?.payload?.name, presentation.name],
    ['mark label', oldView.markLabel, currentView.markLabel],
    ['attack heading', oldView.attackHeading, currentView.attackHeading],
    ['comparison heading', oldView.comparisonHeading, currentView.comparisonHeading],
    ['note', oldView.note, currentView.note],
  ];
  const oldSections = new Map((oldView.statSections ?? []).map(section => [section.sourceStat, section.label]));
  for (const section of currentView.statSections) rows.push(['stat label / ' + section.sourceStat, oldSections.get(section.sourceStat), section.label]);
  return rows.map(([field, previous, proposed]) => ({
    field,
    previous: previous ?? null,
    proposed,
    status: previous === proposed ? 'unchanged' : previous === undefined ? 'new' : 'changed',
  }));
}

function assetReferences(value, result = []) {
  if (Array.isArray(value)) for (const item of value) assetReferences(item, result);
  else if (value && typeof value === 'object') {
    if (value.assetRef && typeof value.assetRef.assetId === 'string') result.push(value.assetRef.assetId);
    for (const child of Object.values(value)) assetReferences(child, result);
  }
  return [...new Set(result)];
}

export function buildW07Candidate(inputs) {
  if (inputs?.mode !== 'w07') throw new Error('W07 candidate generation requires mode w07');
  const validation = validateWebAuthoring(inputs.authoring, inputs);
  if (!validation.valid) throw new Error('W07 Web contract is invalid:\n' + validation.issues.map(item => item.path + ': ' + item.message).join('\n'));
  if (inputs.authoring.reviewReceipts.length !== 0) throw new Error('W07 candidate inputs must not contain human review receipts');

  const sourceContract = inputs.sourceContract;
  const sourceRecordsByKind = kind => sourceContract.records.filter(record => record.kind === kind);
  const oldPresentations = new Map(inputs.baseline.records.filter(record => record.kind === 'presentation').map(record => [record.recordId, record]));
  const presentations = inputs.authoring.presentations.map(presentation => {
    const sourceWeapon = sourceRecord(inputs, presentation.weaponView.sourceWeaponRef, 'weapon');
    const oldPresentation = oldPresentations.get(presentation.authoringId);
    const sections = statSectionRows(presentation, inputs);
    const actions = actionRows(presentation, inputs);
    const displaySummary = sourceWeapon.payload.displayedAttacks ?? [];
    return {
      presentationId: presentation.authoringId,
      name: presentation.name,
      nameOfficialSourceId: presentation.nameOfficialSourceId,
      officialLocaleRefs: presentation.nameOfficialLocaleRefs,
      markLabel: presentation.weaponView.markLabel,
      sourceWeaponRef: presentation.weaponView.sourceWeaponRef,
      sourceWeapon: {
        familyId: sourceWeapon.payload.familyId,
        markId: sourceWeapon.payload.markId,
        templateKey: sourceWeapon.payload.templateKey,
        dataCoverage: sourceWeapon.dataCoverage,
        statBindings: (sourceWeapon.payload.statBindings ?? []).map(binding => ({
          statKey: binding.statKey,
          bindingCount: binding.bindings.length,
          bindings: binding.bindings,
        })),
        displaySummary,
        sourceFact: sourceFact(sourceWeapon),
      },
      displayText: {
        attackHeading: presentation.weaponView.attackHeading,
        comparisonHeading: presentation.weaponView.comparisonHeading,
        note: presentation.weaponView.note,
      },
      wordingComparison: wordingComparison(presentation, oldPresentation),
      statSections: sections,
      actionBindings: actions,
      damageProfileRefs: [...new Map(actions.flatMap(action => action.damageProfileRefs ?? []).map(ref => [recordKey(ref), ref])).values()],
    };
  });

  const reviewTargets = inputs.authoring.reviewTargets.map(target => {
    const digests = computeReviewDigests(inputs.authoring, target, inputs);
    return {
      targetId: target.targetId,
      ownerKind: target.ownerKind,
      ownerId: target.ownerId,
      fieldPath: target.fieldPath,
      dimension: target.dimension,
      state: getReviewState(inputs.authoring, target.targetId, inputs),
      targetDigest: digests.targetDigest,
      dependenciesDigest: digests.dependenciesDigest,
    };
  });
  const kindCounts = Object.fromEntries([...new Set(sourceContract.records.map(record => record.kind))]
    .sort((left, right) => left.localeCompare(right))
    .map(kind => [kind, sourceRecordsByKind(kind).length]));
  const officialInputs = inputs.officialInputs.sources.map(source => ({
    officialSourceId: source.officialSourceId,
    entityRef: source.entityRef,
    sourceLocale: source.sourceLocale,
    origin: source.origin,
    resource: source.resource,
    key: source.key,
    sourceHash: source.sourceHash,
    occurrence: source.occurrence,
    sourceText: source.sourceText,
    sourceTextSha256: source.sourceTextSha256,
    segments: source.segments,
    params: source.params,
    resolvedText: source.resolvedText,
    resolvedTextSha256: source.resolvedTextSha256,
  }));
  const linkedClaimIds = new Set(presentations.flatMap(presentation => presentation.statSections.flatMap(section => section.claimRefs.map(ref => recordKey(ref)))));
  const sourceClaims = sourceRecordsByKind('claim').filter(record => linkedClaimIds.has(recordKey(record)));
  const weaponDisplayEvidenceIds = presentations.flatMap(presentation => presentation.sourceWeapon.sourceFact.payload.displayedAttacks ?? [])
    .flatMap(summary => summary.evidenceRefs ?? []).map(recordKey);
  const evidenceIds = new Set([
    ...sourceClaims.flatMap(record => (record.payload.evidenceRefs ?? []).map(recordKey)),
    ...weaponDisplayEvidenceIds,
  ]);
  const sourceEvidence = sourceRecordsByKind('evidence').filter(record => evidenceIds.has(recordKey(record)));
  const states = reviewTargets.reduce((counts, target) => ({ ...counts, [target.state]: (counts[target.state] ?? 0) + 1 }), {});
  const wordingRows = presentations.flatMap(presentation => presentation.wordingComparison.map(row => ({ presentationId: presentation.presentationId, ...row })));
  const assets = assetReferences(inputs.authoring);
  const weaponAssetInventory = inputs.authoring.presentations.map(presentation => {
    const refs = assetReferences(presentation.weaponView);
    return {
      weaponRef: presentation.weaponView.sourceWeaponRef,
      proposedPlacement: 'Weapon identity and mark heading; this is an inventory proposal only and does not implement a renderer.',
      existingReusableAssetRefs: refs,
      imageStatus: refs.length === 0 ? 'MISSING_NO_VERIFIED_REUSABLE_REFERENCE' : 'REFERENCE_PRESENT_FILE_AND_USAGE_REVIEW_REQUIRED',
      repositoryFileStatus: 'NO_IMAGE_FILE_IN_SCOPED_WEB_CHECKOUT',
      licenseStatus: 'NOT_REVIEWED',
      evidenceLimit: 'Only the W07 authoring references and this Web checkout were checked; no external asset repositories, game files, or license terms were reviewed.',
    };
  });
  const matrix = {
    schemaVersion: '1.0.0',
    candidateOnly: true,
    fixtureOnly: false,
    publicationEligible: false,
    gameBuild: 'UNVERIFIED',
    baseline: inputs.webLock.baseline,
    sourcePin: {
      repository: inputs.sourceLock.repository,
      commit: inputs.sourceLock.commit,
      schemaId: inputs.sourceLock.schemaId,
      schemaSha256: inputs.sourceLock.files.schema.sha256,
      dataSha256: inputs.sourceLock.files.data.sha256,
      validatorSha256: inputs.sourceLock.files.validator.sha256,
      snapshot: sourceContract.gameReleases.find(release => release.gameReleaseId === presentations[0].sourceWeaponRef.gameReleaseId)?.snapshot,
      dataPath: SOURCE_DATA_PATH,
      recordCount: sourceContract.records.length,
      recordCountsByKind: kindCounts,
      sourceRefCount: sourceContract.sourceRefs.length,
    },
    authoringInput: { path: AUTHORING_PATH, sha256: inputs.webLock.authoring.sha256 },
    officialInputSnapshot: { path: OFFICIAL_INPUTS_PATH, sha256: inputs.webLock.officialInputs.sha256, sources: officialInputs },
    presentations,
    sourceOwnedClaimFacts: sourceClaims.map(sourceFact),
    sourceOwnedEvidence: sourceEvidence.map(sourceFact),
    sourceOwnedDamageProfiles: sourceRecordsByKind('damage-profile').map(sourceFact),
    sourceOwnedArmorAndTargetProfiles: sourceContract.records.filter(record => ['armor-class', 'target-profile'].includes(record.kind)).map(sourceFact),
    sourceProvenance: sourceContract.sourceRefs.map(source => ({
      sourceId: source.sourceId,
      sourceKind: source.sourceKind,
      repository: source.repository ?? null,
      commit: source.commit ?? null,
      path: source.path ?? null,
      publicUrl: source.publicUrl ?? null,
      gameReleaseId: source.gameReleaseId,
      gameBuild: source.gameBuild,
      snapshot: source.snapshot,
      artifactSha256: source.artifactSha256 ?? null,
      tool: source.tool ?? null,
      safeSummary: source.safeSummary,
    })),
    wordingComparison: {
      changedCount: wordingRows.filter(row => row.status !== 'unchanged').length,
      unchangedCount: wordingRows.filter(row => row.status === 'unchanged').length,
      rows: wordingRows,
    },
    review: {
      receiptCount: inputs.authoring.reviewReceipts.length,
      targetCount: reviewTargets.length,
      states,
      targets: reviewTargets,
    },
    materials: {
      declaredImageAssetCount: assets.length,
      imageAssetIds: assets,
      status: assets.length === 0 ? 'NO_IMAGE_IMPORTED' : 'ASSETS_REQUIRE_LICENSE_REVIEW',
      licenseStatus: 'NOT_REVIEWED',
      weaponInventory: weaponAssetInventory,
      note: 'No W07 weapon image reference is declared. Image availability outside the scoped Web checkout and all usage rights remain unreviewed; no image was downloaded or copied.',
    },
    limitations: [
      { field: 'gameBuild', status: 'UNVERIFIED', reason: 'The selected Source snapshot does not establish an exact Steam build.' },
      { field: 'enemySpecificHitZoneAndCriticalWeakspotMappings', status: 'NOT_IMPORTED', reason: 'W07 does not model enemy-specific hit-zone and critical/weakspot combinations.' },
      { field: 'finalDamageCalculation', status: 'OUT_OF_SCOPE', reason: 'This candidate preserves Source tables and bindings; it does not execute overrides or calculate final damage.' },
      { field: 'imageLicensing', status: 'NOT_REVIEWED', reason: 'No weapon artwork is imported in this candidate.' },
      { field: 'runtimeRenderer', status: 'OUT_OF_SCOPE', reason: 'W11 owns the production UI renderer.' },
    ],
    sourceInventory: sourceContract.records.map(record => ({
      recordId: record.recordId,
      gameReleaseId: record.gameReleaseId,
      kind: record.kind,
      dataCoverage: record.dataCoverage,
      sourceRefs: record.sourceRefs,
    })),
  };
  const markdownBytes = Buffer.from(createReviewMarkdown(matrix), 'utf8');
  const matrixBytes = Buffer.from(JSON.stringify(matrix, null, 2) + '\n', 'utf8');
  return { markdownBytes, matrixBytes, matrix };
}

function formatQuantity(value) {
  if (!value || typeof value !== 'object') return '未提供';
  if (value.status === 'known') return String(value.decimal) + ' ' + String(value.unit);
  if (value.status === 'unknown') return '未知（' + String(value.reasonCode ?? '未提供原因') + '）';
  if (value.status === 'not-applicable') return '不適用';
  return String(value.status ?? '未提供');
}

function formatRange(value) {
  if (!value || typeof value !== 'object') return '未提供';
  if (value.status === 'known') {
    const bounds = (value.inclusive?.min === false ? '(' : '[') + value.min + ', ' + value.max + (value.inclusive?.max === false ? ')' : ']');
    return bounds + ' ' + value.unit + (value.step === undefined ? '' : '，step ' + value.step);
  }
  if (value.status === 'not-applicable') return '不適用';
  return '未知（' + String(value.reasonCode ?? value.status ?? '未提供原因') + '）';
}

function formatParameterRange(value) {
  if (!value || typeof value !== 'object') return '未提供';
  if (value.status === 'known') return String(value.min) + '–' + String(value.max) + ' ' + String(value.unit);
  if (value.status === 'unknown') return '未知（' + String(value.reasonCode ?? '未提供原因') + '）';
  return String(value.status ?? '未提供');
}

function locatorLabel(locator) {
  if (!locator) return 'Source locator 未提供';
  return String(locator.path ?? 'path 未提供') + (locator.line === undefined ? '' : ':' + locator.line) + (locator.fieldPath ? ' — ' + locator.fieldPath : '');
}

function contextLabel(context = {}) {
  const parts = [];
  for (const key of ['weaponStat', 'attackMode', 'profile', 'armorClass', 'condition']) {
    if (context[key] !== undefined) parts.push(key + '=' + JSON.stringify(context[key]));
  }
  if (context.comparisonStat) parts.push('comparison=' + formatQuantity(context.comparisonStat));
  return parts.join('; ') || 'context 未提供';
}

function createReviewMarkdown(matrix) {
  const sourceProfiles = matrix.sourceOwnedDamageProfiles;
  const tablePoints = new Set(sourceProfiles.flatMap(profile => (profile.payload.rawSourceDefinition?.tables ?? [])
    .flatMap(table => table.orderedValues.map(point => table.tableKey + '\u0000' + point.ordinal))));
  const actionCount = matrix.presentations.reduce((count, presentation) => count + presentation.actionBindings.length, 0);
  const sourceWeapons = matrix.presentations.map(presentation => presentation.sourceWeapon.sourceFact);
  const sourceRowCount = sourceWeapons.reduce((count, weapon) => count + (weapon.payload.sourceRows?.length ?? 0), 0);
  const weaponLocatorFields = new Set(sourceWeapons.flatMap(weapon => weapon.payload.statBindings.flatMap(binding => binding.bindings.map(item =>
    item.weaponLocator.sourceRef.sourceId + '\u0000' + item.weaponLocator.path + '\u0000' + item.weaponLocator.fieldPath))));
  const stickyDefinitions = new Set(matrix.presentations.flatMap(presentation => presentation.actionBindings.flatMap(action =>
    (action.stickyBindings ?? []).filter(binding => binding.state === 'defined').map(binding => presentation.sourceWeaponRef.recordId + '\u0000' + (binding.definition?.templateKey ?? binding.tableKey)))));
  const emptyCount = sourceWeapons.reduce((count, weapon) => count + (weapon.payload.emptyTables?.length ?? 0), 0)
    + sourceProfiles.reduce((count, profile) => count + (profile.payload.rawSourceDefinition?.emptyTables?.length ?? 0), 0);
  const lines = [
    '# W07 鏈斧武器審閱候選',
    '',
    '這是待人工檢查的正式化資料候選，不代表內容已核准、已發布或已確認遊戲版本相容。',
    '',
    '## 固定基準與驗證',
    '',
    '- Web contract validation：通過。publicationEligible：false；Source game build：UNVERIFIED。',
    '- Source commit：' + matrix.sourcePin.commit + '；schema/data/validator SHA-256：' + matrix.sourcePin.schemaSha256 + ' / ' + matrix.sourcePin.dataSha256 + ' / ' + matrix.sourcePin.validatorSha256 + '。',
    '- Source input：' + matrix.sourcePin.recordCount + ' records、' + matrix.sourcePin.sourceRefCount + ' provenance refs；固定 cache：' + matrix.sourcePin.dataPath + '。',
    '- W01 accepted baseline：' + matrix.baseline.commit + '，' + matrix.baseline.path + '，raw Git blob ' + matrix.baseline.blobOid + '，SHA-256 ' + matrix.baseline.sha256 + '。',
    '- Official input：' + matrix.officialInputSnapshot.sources.length + ' 筆 EN/native zh-TW 固定 locator；receipt ' + matrix.review.receiptCount + '，review targets ' + matrix.review.targetCount + '（' + Object.entries(matrix.review.states).map(([state, count]) => state + ' ' + count).join('、') + '）。',
    '',
    '## W01 既有文案',
    '',
    '每把武器的名稱、Mk 標籤、攻擊段標題、素質比較標題、note 和既有素質標籤逐欄對照固定 W01 raw blob。沿用 ' + matrix.wordingComparison.unchangedCount + ' 欄，新增或差異 ' + matrix.wordingComparison.changedCount + ' 欄；本候選沒有新增或改寫玩家效果句。完整 old/new 值見矩陣。',
    '',
  ];

  for (const presentation of matrix.presentations) {
    lines.push('## ' + markdown(presentation.name) + ' — ' + markdown(presentation.markLabel));
    lines.push('');
    lines.push('Source weapon `' + markdown(presentation.sourceWeaponRef.recordId) + '`；family `' + markdown(presentation.sourceWeapon.familyId) + '`；mark `' + markdown(presentation.sourceWeapon.markId) + '`；template `' + markdown(presentation.sourceWeapon.templateKey) + '`。');
    lines.push('');
    lines.push('### 比較素質、Source 數值與曲線');
    lines.push('');
    lines.push('| Web 素質標籤 / Source stat | Claim ID | Source property | raw 值／單位 | Source formatter 顯示值／格式 | context |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const section of presentation.statSections) {
      for (const fact of section.claims) {
        const payload = fact.payload;
        lines.push('| ' + markdown(section.label) + ' / `' + markdown(section.sourceStat) + '` | `' + markdown(fact.recordId) + '` | ' + markdown(payload.property) + ' | ' + markdown(formatQuantity(payload.value)) + ' | ' + markdown(formatQuantity(payload.displayValue) + ' / ' + (payload.displayFormat ?? 'format 未提供')) + ' | ' + markdown(contextLabel(payload.context)) + ' |');
      }
    }
    lines.push('');
    for (const section of presentation.statSections) {
      if (section.statDefinitions.length === 0) continue;
      lines.push('#### ' + markdown(section.label) + '（' + markdown(section.sourceStat) + '）');
      lines.push('');
      for (const { definition, curve } of section.statDefinitions) {
        const payload = definition.payload;
        lines.push('- Definition `' + markdown(definition.recordId) + '`；quantity `' + markdown(payload.quantity) + '`；輸入單位 `' + markdown(payload.inputUnit) + '`；輸出單位 `' + markdown(payload.outputUnit) + '`。');
        lines.push('  - Panel range：' + markdown(formatRange(payload.panelInputRange)) + '；theoretical range：' + markdown(formatRange(payload.theoreticalInputRange)) + '；obtainable range：' + markdown(formatRange(payload.obtainableInputRange)) + '。');
        if (curve) {
          const knots = curve.payload.knots.map(point => point.input + ' ' + curve.payload.inputUnit + ' → ' + point.output + ' ' + curve.payload.outputUnit).join('；');
          lines.push('  - Ordered curve points：' + markdown(knots) + '。Interpolation：' + markdown(formatRange(curve.payload.interpolation)) + '；edge policy：' + markdown(formatRange(curve.payload.edgePolicy)) + '。');
        }
      }
      lines.push('');
    }
    const weaponPayload = presentation.sourceWeapon.sourceFact.payload;
    for (const section of presentation.statSections) {
      const statBindings = weaponPayload.statBindings.find(binding => binding.statKey === section.sourceStat)?.bindings ?? [];
      if (statBindings.length) {
        lines.push('#### ' + markdown(section.label) + ' — Source trait parameter inputs');
        lines.push('');
        lines.push('下列 trait parameter range 是 Source trait 模板的輸入範圍，不是面板範圍或掉落範圍。');
        lines.push('');
        lines.push('| Source property | Action / mode | Trait template | Trait parameter range | Weapon locator | Trait locator |');
        lines.push('| --- | --- | --- | --- | --- | --- |');
        for (const binding of statBindings) lines.push('| ' + markdown(binding.property) + ' | ' + markdown([binding.action, binding.mode].filter(Boolean).join(' / ') || '未提供') + ' | ' + markdown(binding.traitTemplateKey ?? '未提供') + ' | ' + markdown(formatParameterRange(binding.traitParameterRange)) + ' | ' + markdown(locatorLabel(binding.weaponLocator)) + ' | ' + markdown(locatorLabel(binding.traitLocator)) + ' |');
        lines.push('');
      }
      const sourceTables = weaponPayload.statTables.filter(table => table.statKey === section.sourceStat);
      if (sourceTables.length) {
        lines.push('#### ' + markdown(section.label) + ' — Source output tables');
        lines.push('');
        lines.push('| Source table | Property | Ordered raw values / units | Source locator |');
        lines.push('| --- | --- | --- | --- |');
        for (const table of sourceTables) for (const property of table.properties) {
          const ordered = property.orderedValues.map(point => point.key + '=' + point.rawValue + ' ' + (typeof property.unit === 'string' ? property.unit : formatQuantity(property.unit))).join('；');
          lines.push('| ' + markdown(table.tableKey) + ' | ' + markdown(property.property) + ' | ' + markdown(ordered) + ' | ' + markdown(locatorLabel(property.sourceLocator)) + ' |');
        }
        lines.push('');
      }
    }
    lines.push('60%／80% 是比較點，不是掉落範圍。raw source 值、displayValue/displayFormat、claim context/basis/evidence，以及 panel/theoretical/obtainable ranges 和 ordered curve points 都按 Source 原值保存；未知插值與邊界規則仍標為未知。');
    lines.push('');
    lines.push('### 遊戲顯示攻擊摘要');
    lines.push('');
    lines.push('以下是獨立的顯示摘要，不表示可達連段。');
    lines.push('');
    lines.push('| 類別 | 模式 | 顯示類型 | 摘要段 | Source refs |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const summary of presentation.sourceWeapon.displaySummary) {
      const segments = (summary.segments ?? []).map(segment => {
        const role = segment.targetRole === 'single-target' ? 'single-target（單體）' : segment.targetRole === 'multi-target-cleave' ? 'multi-target-cleave（群體（順劈））' : segment.targetRole;
        return segment.index + ':' + segment.attackType + '/' + role + '/' + segment.roleProfileKey;
      }).join('；');
      lines.push('| ' + markdown(summary.key) + ' | ' + markdown(summary.mode) + ' | ' + markdown(summary.displayedType) + ' | ' + markdown(segments) + ' | ' + markdown((summary.sourceRefs ?? []).map(ref => ref.sourceId).join(', ')) + ' |');
    }
    lines.push('');
    lines.push('### Source 綁定的動作、分支與接續');
    lines.push('');
    lines.push('動作 profile 是實際 Source action identity。條件與接續只作資料呈現，不執行，也不代表整條連段可達。');
    lines.push('');
    for (const action of presentation.actionBindings) {
      lines.push('#### `' + markdown(action.action) + '` — ' + markdown(action.mode) + ' — `' + markdown(action.sourceRef.recordId) + '`');
      lines.push('');
      lines.push('Damage profile refs：' + markdown((action.damageProfileRefs ?? []).map(ref => ref.recordId).join('；') || '無') + '。');
      lines.push('');
      lines.push('| Branch | Raw Source value | Typed profile ref | Source locator |');
      lines.push('| --- | --- | --- | --- |');
      for (const binding of action.sourceBindings ?? []) lines.push('| ' + markdown(binding.branch) + ' | ' + markdown(binding.rawValue) + ' | `' + markdown(binding.profileRef?.recordId ?? '未綁定') + '` | ' + markdown(locatorLabel(binding.sourceLocator)) + ' |');
      if ((action.sourceBindings ?? []).length === 0) lines.push('| 未提供 | 未提供 | 未提供 | 未提供 |');
      lines.push('');
      lines.push('| Input | From → To | Conditions | Source locator |');
      lines.push('| --- | --- | --- | --- |');
      for (const continuation of action.continuations ?? []) {
        const conditions = (continuation.conditions ?? []).map(condition => condition.fieldPath + '=' + condition.rawValue).join('; ') || 'none recorded';
        lines.push('| ' + markdown(continuation.inputKey) + ' | `' + markdown(continuation.fromAction) + '` → `' + markdown(continuation.toAction) + '` | ' + markdown(conditions) + ' | ' + markdown(locatorLabel(continuation.sourceLocator)) + ' |');
      }
      if ((action.continuations ?? []).length === 0) lines.push('| 未提供 | 未提供 | 未提供 | 未提供 |');
      lines.push('');
      const stickies = action.stickyBindings ?? [];
      if (stickies.length) {
        lines.push('Sticky definitions:');
        for (const sticky of stickies) {
          const definition = sticky.definition;
          lines.push('- ' + markdown(sticky.state) + ' `' + markdown(sticky.tableKey ?? 'key 未提供') + '`；duration ' + markdown(formatQuantity(definition?.duration)) + '；instances ' + markdown(formatQuantity(definition?.instances)) + '（保留來源參數，不代表總命中次數）；locator ' + markdown(locatorLabel(sticky.sourceLocator)) + '。');
        }
        lines.push('');
      }
    }
  }

  lines.push('## 固定官方名稱輸入');
  lines.push('');
  lines.push('| Owner | Locale | Resource / key | Occurrence | Official text | Text SHA-256 |');
  lines.push('| --- | --- | --- | ---: | --- | --- |');
  for (const source of matrix.officialInputSnapshot.sources) lines.push('| `' + markdown(source.entityRef.recordId) + '` | ' + markdown(source.sourceLocale) + ' | ' + markdown(source.resource + ' / ' + (source.key ?? 'unresolved')) + ' | ' + source.occurrence + ' | ' + markdown(source.sourceText) + ' | `' + source.sourceTextSha256 + '` |');
  lines.push('');
  lines.push('zh-TW 使用固定 native official input，沒有把它標記為 Web 新做的 faithful translation。Locator、ordered segments、resolved text 與 hash 逐筆固定在矩陣。');
  lines.push('');
  lines.push('## 範圍與素材盤點');
  lines.push('');
  lines.push('- Source 矩陣完整包含 ' + sourceWeapons.length + ' 個 weapon fact、' + weaponLocatorFields.size + ' 個 distinct weapon stat locator fields、' + sourceRowCount + ' 個 weapon source rows、' + actionCount + ' 個 action profiles、' + sourceProfiles.length + ' 個 damage-profile records、' + tablePoints.size + ' 個依 table key/ordinal 去重的 profile table points、' + stickyDefinitions.size + ' 個 sticky definitions 和 ' + emptyCount + ' 個明確 empty declarations。這些是 Source-owned facts 的唯讀投影，不是第二份 Web mechanics owner。');
  lines.push('- Source game build：UNVERIFIED；敵人專屬 hit-zone 與 critical/weakspot 組合：NOT_IMPORTED；不執行 override，也不計算 final damage。');
  lines.push('');
  lines.push('| Weapon ref | 擬用位置 | 既有可復用引用 | 圖片狀態 | 授權狀態 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const item of matrix.materials.weaponInventory) lines.push('| `' + markdown(item.weaponRef.recordId) + '` | ' + markdown(item.proposedPlacement) + ' | ' + markdown(item.existingReusableAssetRefs.join(', ') || '無；W07 沒有宣告 assetRef') + ' | ' + markdown(item.imageStatus + '；' + item.repositoryFileStatus) + ' | ' + markdown(item.licenseStatus) + ' |');
  lines.push('');
  lines.push('本包固定輸入目前沒有可核實可復用的武器圖；兩把武器均標為缺圖，圖片與授權待查。查核範圍限於 W07 authoring references 與目前 Web checkout；沒有查外部資產庫、遊戲檔案或授權條款，也沒有由其他遊戲素材的使用情況推定武器圖授權。');
  lines.push('');
  lines.push('W08 shared compiler 與 W11 renderer 不在本候選範圍。完整 Source weapon facts/payload、bindings、W01 wording comparison、official inputs、review digests、coverage 與 provenance 均附在 `review-matrix.json`。');
  lines.push('');
  return lines.join('\n');
}

export async function writeW07Candidate(inputs, outRoot) {
  const output = buildW07Candidate(inputs);
  if (typeof outRoot !== 'string' || outRoot.length === 0) throw new TypeError('W07 output root must be a non-empty path');
  const absoluteOutput = path.resolve(outRoot);
  const parent = path.dirname(absoluteOutput);
  const parsedRoot = path.parse(absoluteOutput).root;
  const filesystemRootStat = await lstat(parsedRoot);
  if (!filesystemRootStat.isDirectory() || filesystemRootStat.isSymbolicLink()) throw new Error('W07 output filesystem root is not a plain directory');
  let current = parsedRoot;
  for (const segment of path.relative(parsedRoot, parent).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let parentStat;
    try {
      parentStat = await lstat(current);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('W07 output parent directory does not exist: ' + current);
      throw error;
    }
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('W07 output parent path must contain only plain directories: ' + current);
  }
  try {
    await lstat(absoluteOutput);
    throw new Error('W07 output path already exists; refusing to overwrite: ' + absoluteOutput);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(absoluteOutput);
  const createdFiles = [];
  try {
    const markdownPath = path.join(absoluteOutput, 'review-candidate.md');
    await writeFile(markdownPath, output.markdownBytes, { flag: 'wx' });
    createdFiles.push(markdownPath);
    const matrixPath = path.join(absoluteOutput, 'review-matrix.json');
    await writeFile(matrixPath, output.matrixBytes, { flag: 'wx' });
    createdFiles.push(matrixPath);
  } catch (error) {
    for (const file of createdFiles) await unlink(file).catch(() => {});
    await rmdir(absoluteOutput).catch(() => {});
    throw new Error('W07 candidate write failed without retaining a partial output: ' + error.message);
  }
  return { outputRoot: absoluteOutput, markdownBytes: output.markdownBytes, matrixBytes: output.matrixBytes, matrix: output.matrix };
}

async function main() {
  try {
    const args = process.argv.slice(2);
    let outRoot;
    if (args.length) {
      if (args.length !== 2 || args[0] !== '--out-root' || !args[1] || args[1].startsWith('--')) {
        throw new Error('usage: node scripts/content/contract-w07.mjs [--out-root <new-directory>]');
      }
      outRoot = path.resolve(REPO_ROOT, args[1]);
    }
    const inputs = await loadWebAuthoringInputs({ repoRoot: REPO_ROOT, mode: 'w07' });
    const validation = validateWebAuthoring(inputs.authoring, inputs);
    if (!validation.valid) throw new Error(validation.issues.map(item => item.path + ': ' + item.message).join('\n'));
    if (outRoot) {
      const output = await writeW07Candidate(inputs, outRoot);
      process.stdout.write('W07 authoring validation passed; wrote deterministic candidate files: ' + path.relative(REPO_ROOT, output.outputRoot).replaceAll(path.sep, '/') + ' (review-candidate.md, review-matrix.json). No receipt or publication eligibility was created.\n');
    } else {
      process.stdout.write('W07 authoring contract validation passed: presentations=' + inputs.authoring.presentations.length + ' statGroups=' + inputs.authoring.presentations.reduce((count, item) => count + item.weaponView.statSections.length, 0) + ' actionBindings=' + inputs.authoring.presentations.reduce((count, item) => count + item.weaponView.attackProfileRefs.length, 0) + ' reviewTargets=' + inputs.authoring.reviewTargets.length + ' receipts=0 publicationEligible=false.\n');
    }
  } catch (error) {
    process.stderr.write('W07 authoring contract validation failed: ' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
