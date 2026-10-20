import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getReviewState,
  loadWebAuthoringInputs,
  resolveDetailReviewTargets,
  validateWebAuthoring,
} from './contract-authoring.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const W01_AUTHORING_PATH = 'content/w01/web-authoring.json';
const W01_BASELINE = Object.freeze({
  commit: 'b0c52e2f62cc7b08bec275ebc8e8a9d6fbffec30',
  blobOid: 'abd12fff64c1f32c80f59ef6e0d2ecff9cb83593',
  sha256: '038cecd27f151943b54b9cd8487de05cf293011e701580f87a9bd62b061d1513',
});
const SECTION_LABELS = Object.freeze({
  effects: '效果',
  conditions: '條件',
  calculation: '計算',
  notes: '注意事項',
  extra: '補充',
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value);
const recordKey = (gameReleaseId, recordId) => gameReleaseId + '\u0000' + recordId;

export function committedW01(repoRoot) {
  // Read the accepted raw Git blob directly so later implementation commits and shallow history do not move the baseline.
  const bytes = execFileSync('git', ['-C', repoRoot, 'cat-file', 'blob', W01_BASELINE.blobOid], { encoding: null });
  const contentSha256 = sha256(bytes);
  if (contentSha256 !== W01_BASELINE.sha256) throw new Error('Pinned W01 baseline raw Git SHA-256 mismatch');
  return { commit: W01_BASELINE.commit, sha256: contentSha256, value: JSON.parse(bytes.toString('utf8')) };
}

function sourceClaim(ref, releaseId, sourceRecordMap) {
  const recordId = typeof ref === 'string' ? ref : ref?.recordId;
  const gameReleaseId = typeof ref === 'string' ? releaseId : ref?.gameReleaseId;
  if (typeof recordId !== 'string' || typeof gameReleaseId !== 'string') return null;
  const record = sourceRecordMap.get(recordKey(gameReleaseId, recordId));
  if (!record || record.kind !== 'claim') return null;
  return record;
}

function renderDetail(item, releaseId, sourceRecordMap) {
  if (typeof item.text === 'string') return item.text;
  if (!Array.isArray(item.parts)) throw new Error('Detail has neither text nor typed parts: ' + item.itemId);
  return item.parts.map(part => {
    if (part.kind === 'literal') return part.text;
    if (part.kind !== 'unsigned-percent') throw new Error('Unsupported W06 detail part: ' + part.kind);
    const claim = sourceClaim(part.bindingRef, releaseId, sourceRecordMap);
    const value = claim?.payload?.value;
    if (value?.status !== 'known' || value.unit !== 'percent' || typeof value.decimal !== 'string') {
      throw new Error('Cannot render an unvalidated unsigned-percent Source binding: ' + part.bindingRef.recordId);
    }
    return value.decimal + '%';
  }).join('');
}

function claimProjection(refs, releaseId, sourceRecordMap) {
  return (refs ?? []).map(ref => {
    const record = sourceClaim(ref, releaseId, sourceRecordMap);
    if (!record) return { ref };
    const payload = record.payload;
    return {
      recordId: record.recordId,
      gameReleaseId: record.gameReleaseId,
      property: payload.property,
      value: payload.value,
      stageContext: payload.context,
      targetRef: payload.targetRef,
      basis: payload.basis,
      sourceRefs: record.sourceRefs,
      evidenceRefs: payload.evidenceRefs,
    };
  });
}

function termRuleProjection(ruleIds, termRuleMap) {
  return (ruleIds ?? []).map(ruleId => {
    const rule = termRuleMap.get(ruleId);
    if (!rule) throw new Error('Unresolved W06 terminology rule: ' + ruleId);
    return {
      ruleId: rule.ruleId,
      sourceText: rule.sourceText,
      targetText: rule.targetText,
      sourceLine: rule.sourceLine,
      sourceRef: rule.sourceRef,
    };
  });
}

function objectSectionMap(sections) {
  const result = new Map();
  for (const [sectionId, items] of Object.entries(sections ?? {})) result.set(sectionId, new Map(items.map(item => [item.itemId, item])));
  return result;
}

function analysisRefs(presentation, itemId) {
  const refs = ['docs/w01/editorial-copy-review-0.0.13.md'];
  if (presentation.entityRef.kind === 'skill' && itemId.includes('stagger')) refs.push('docs/w01/editorial-copy-review-0.0.10.md');
  return refs;
}

function createReviewMatrix(inputs, baseline) {
  const oldRecords = new Map(baseline.value.records.filter(record => record.kind === 'presentation').map(record => [record.recordId, record]));
  const sourceRecordMap = inputs.sourceRecordMap;
  const termRuleMap = inputs.termRuleMap;
  const rows = [];
  const removed = [];
  for (const presentation of inputs.authoring.presentations) {
    const oldRecord = oldRecords.get(presentation.authoringId);
    if (!oldRecord) throw new Error('W01 baseline presentation is missing: ' + presentation.authoringId);
    const contexts = presentation.tierPresentations
      ? presentation.tierPresentations.options.map((option, optionIndex) => ({
        tier: option.tier,
        optionIndex,
        current: option.detailSections,
        previous: oldRecord.payload.tierPresentations?.options.find(item => item.tier === option.tier)?.detailSections ?? {},
      }))
      : [{ tier: null, optionIndex: null, current: presentation.detailSections, previous: oldRecord.payload.detailSections ?? {} }];
    for (const context of contexts) {
      const previousSections = objectSectionMap(context.previous);
      const seen = new Set();
      for (const [sectionIndex, section] of context.current.entries()) {
        const oldItems = previousSections.get(section.sectionId) ?? new Map();
        for (const [itemIndex, item] of section.items.entries()) {
          seen.add(section.sectionId + '\u0000' + item.itemId);
          const previous = oldItems.get(item.itemId);
          const fieldPath = context.tier === null
            ? '/detailSections/' + sectionIndex + '/items/' + itemIndex
            : '/tierPresentations/options/' + context.optionIndex + '/detailSections/' + sectionIndex + '/items/' + itemIndex;
          const resolution = resolveDetailReviewTargets(inputs.authoring, presentation.authoringId, item, fieldPath);
          const targets = resolution.targets;
          if (resolution.required && targets.length === 0) throw new Error('Review target is missing for W06 detail row: ' + fieldPath);
          const reviewTargets = targets.map(target => ({
            targetId: target.targetId,
            fieldPath: target.fieldPath,
            dimension: target.dimension,
            reviewState: getReviewState(inputs.authoring, target.targetId, inputs),
          }));
          const reviewTargetIds = reviewTargets.map(target => target.targetId);
          const reviewState = reviewTargets.length > 0
            ? aggregateReviewStates(reviewTargets.map(target => target.reviewState))
            : 'not-required';
          const currentText = renderDetail(item, presentation.entityRef.gameReleaseId, sourceRecordMap);
          const previousText = previous ? renderDetail(previous, presentation.entityRef.gameReleaseId, sourceRecordMap) : null;
          const refs = claimProjection(item.claimRefs, presentation.entityRef.gameReleaseId, sourceRecordMap);
          rows.push({
            stableId: presentation.authoringId + (context.tier === null ? '' : '/tier-' + context.tier) + '/' + section.sectionId + '/' + item.itemId,
            itemId: item.itemId,
            presentationId: presentation.authoringId,
            presentationName: presentation.name,
            tier: context.tier,
            sectionId: section.sectionId,
            sectionLabel: SECTION_LABELS[section.sectionId],
            reviewTargetId: reviewTargetIds.length === 1 ? reviewTargetIds[0] : null,
            reviewTargetIds,
            reviewTargets,
            reviewState,
            wordingChange: previousText === null ? 'new' : previousText === currentText ? 'unchanged' : 'changed',
            previousText,
            proposedText: currentText,
            actor: null,
            actorStatus: 'not-recorded-in-the-fixed-Source-claims',
            actionOrProperty: refs.map(ref => ref.property).filter(Boolean),
            targetRefs: refs.map(ref => ref.targetRef).filter(Boolean),
            stageContext: refs.map(ref => ref.stageContext),
            numericClaims: refs.map(ref => ref.value).filter(Boolean),
            verbatimConditionsExceptionsAndNegations: currentText,
            sourceClaims: refs,
            sourceTermRefs: item.termRefs,
            termRules: termRuleProjection(item.termRuleRefs, termRuleMap),
            analysisRefs: analysisRefs(presentation, item.itemId),
          });
        }
      }
      for (const [sectionId, oldItems] of previousSections) {
        for (const oldItem of oldItems.values()) {
          if (!seen.has(sectionId + '\u0000' + oldItem.itemId)) removed.push({
            presentationId: presentation.authoringId,
            tier: context.tier,
            sectionId,
            itemId: oldItem.itemId,
            previousText: renderDetail(oldItem, presentation.entityRef.gameReleaseId, sourceRecordMap),
            status: 'removed-from-W06-candidate',
            analysisRefs: analysisRefs(presentation, oldItem.itemId),
          });
        }
      }
    }
  }
  return {
    schemaVersion: '1.1.0',
    candidateOnly: true,
    publicationEligible: false,
    baseline: { commit: baseline.commit, path: W01_AUTHORING_PATH, sha256: baseline.sha256 },
    sourcePin: {
      repository: inputs.sourceLock.repository,
      commit: inputs.sourceLock.commit,
      schemaId: inputs.sourceLock.schemaId,
      schemaSha256: inputs.sourceLock.files.schema.sha256,
      dataSha256: inputs.sourceLock.files.data.sha256,
      validatorSha256: inputs.sourceLock.files.validator.sha256,
    },
    officialInputs: inputs.officialInputs.sources.map(source => ({
      officialSourceId: source.officialSourceId,
      sourceLocale: source.sourceLocale,
      bindingContext: source.bindingContext ?? null,
      resource: source.resource,
      key: source.key,
      sourceHash: source.sourceHash,
      occurrence: source.occurrence,
      sourceText: source.sourceText,
      sourceTextSha256: source.sourceTextSha256,
      resolvedText: source.resolvedText,
      params: source.params,
    })),
    termRules: inputs.termRules.rules,
    detailRows: rows,
    removedFromCandidate: removed,
    reviewReceiptCount: inputs.authoring.reviewReceipts.length,
    pendingReviewTargetCount: inputs.authoring.reviewTargets.filter(target => getReviewState(inputs.authoring, target.targetId, inputs) === 'pending').length,
  };
}

function aggregateReviewStates(states) {
  const priority = { approved: 0, pending: 1, stale: 2, rejected: 3 };
  if (states.length === 0 || states.some(state => !Object.hasOwn(priority, state))) throw new Error('W06 detail row has an unknown review state');
  return states.reduce((highest, state) => priority[state] > priority[highest] ? state : highest, 'approved');
}

function markdownText(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function createReviewMarkdown(inputs, matrix) {
  const states = inputs.authoring.reviewTargets.reduce((result, target) => {
    const state = getReviewState(inputs.authoring, target.targetId, inputs);
    result[state] = (result[state] ?? 0) + 1;
    return result;
  }, {});
  const lines = [
    '# W06 技能與祝福文案審閱候選',
    '',
    '此文件由固定 W06 輸入產生，供人工檢查；不是人工核准、遊戲版本相容結論或正式發布文件。',
    '',
    '## 驗證結果與界線',
    '',
    '- Web contract validation：通過。',
    '- publicationEligible：false；Source build：UNVERIFIED。',
    '- Review receipts：' + inputs.authoring.reviewReceipts.length + '；目標狀態：' + Object.entries(states).map(([state, count]) => state + ' ' + count).join('、') + '。',
    '- 範圍：顱腦崩裂技能、鏈斧「提速」祝福四階；未匯入武器資料。',
    '- 祝福 nameKey：NOT_VERIFIED；variant weaponRefs：空清單，coverage 為 partial / NOT_IMPORTED。',
    '',
    '## 固定來源與差異',
    '',
    '- W01 accepted wording baseline：' + matrix.baseline.commit + '，' + matrix.baseline.path + '，SHA-256 ' + matrix.baseline.sha256 + '。',
    '- Source：' + matrix.sourcePin.repository + '，commit ' + matrix.sourcePin.commit + '；schema/data/validator SHA-256：' + matrix.sourcePin.schemaSha256 + ' / ' + matrix.sourcePin.dataSha256 + ' / ' + matrix.sourcePin.validatorSha256 + '。',
    '- Official input snapshot：' + inputs.webLock.officialInputs.path + '，SHA-256 ' + inputs.webLock.officialInputs.sha256 + '；' + matrix.officialInputs.length + ' 個固定 EN/zh-TW 輸入。',
    '- 逐句比較：' + matrix.detailRows.length + ' 個 stable detail rows；' + matrix.detailRows.filter(row => row.wordingChange === 'unchanged').length + ' 句逐字沿用、' + matrix.detailRows.filter(row => row.wordingChange !== 'unchanged').length + ' 項新增或差異。差異會逐列顯示；不製造勘誤。',
    '',
    '## 已核實官方原文與解析',
    '',
  ];
  for (const source of matrix.officialInputs) {
    const context = source.bindingContext ? '；tier ' + source.bindingContext.tier : '';
    lines.push('### ' + (source.sourceLocale === 'en' ? 'English' : '繁體中文') + context + ' — ' + source.officialSourceId);
    lines.push('');
    lines.push('- Locator：resource ' + source.resource + '；key ' + (source.key ?? '未解析') + '；sourceHash ' + source.sourceHash + '；occurrence ' + source.occurrence + '。');
    lines.push('- 原文 SHA-256：' + source.sourceTextSha256 + '。');
    lines.push('- 官方原文：');
    lines.push('');
    lines.push(...source.sourceText.split(/\r?\n/).map(line => line.length === 0 ? '' : '  ' + line));
    lines.push('');
    lines.push('- 固定參數解析：' + source.resolvedText);
    lines.push('');
  }
  lines.push('## W01 → W06 逐句清稿與差異');
  lines.push('');
  lines.push('完整欄位、Source claim 值與 evidence、上下文、詞規則、所有 review target ID/路徑/維度/逐項狀態、前後文與狀態見同目錄的 review-matrix.json；單一 target 時保留原 reviewTargetId，多 target 時以 reviewTargetIds 為準，reviewTargetId 為 null。stage/actor/property/target 只按固定 Source 欄位列示；Source 沒有提供的內容保留為空，不另行推定。條件、例外與否定依原句及既有 W01 分析文件檢查。');
  lines.push('');
  for (const row of matrix.detailRows) {
    lines.push('### ' + row.stableId);
    lines.push('');
    lines.push('- Section：' + row.sectionLabel + '；Review targets：' + row.reviewTargets.map(target => target.targetId + ' (' + target.fieldPath + '; ' + target.dimension + '; ' + target.reviewState + ')').join('；') + '；彙總狀態：' + row.reviewState + '；W01 對照：' + row.wordingChange + '。');
    if (row.tier !== null) lines.push('- 綁定階級：' + row.tier + '。');
    lines.push('- W01 原句：' + (row.previousText === null ? '無（新增）' : markdownText(row.previousText)));
    lines.push('- W06 候選：' + markdownText(row.proposedText));
    lines.push('- Source claims：' + (row.sourceClaims.length ? row.sourceClaims.map(claim => claim.recordId + ' (' + claim.property + ' = ' + canonical(claim.value) + '; target ' + claim.targetRef.recordId + '; context ' + canonical(claim.stageContext) + ')').join('；') : '無；沿用既有 W01 分析定位。'));
    lines.push('- 條件／例外／否定：依上列完整句子逐字保留；既有分析：' + row.analysisRefs.join('、') + '。');
    lines.push('- 詞規則：' + (row.termRules.length ? row.termRules.map(rule => rule.ruleId + '「' + rule.sourceText + ' → ' + rule.targetText + '」(' + rule.sourceRef.path + ':' + rule.sourceRef.line + ')').join('；') : '無。'));
    lines.push('');
  }
  if (matrix.removedFromCandidate.length) {
    lines.push('### W01 有、W06 未收錄的句子');
    lines.push('');
    for (const row of matrix.removedFromCandidate) lines.push('- ' + row.presentationId + (row.tier === null ? '' : '/tier-' + row.tier) + '/' + row.sectionId + '/' + row.itemId + '：' + markdownText(row.previousText) + '；既有分析：' + row.analysisRefs.join('、') + '。');
    lines.push('');
  }
  lines.push('## 詞規則來源');
  lines.push('');
  lines.push('規則只供明確引用該 ruleId 的文字審閱；不是 mechanics evidence，也不會全域改寫官方字串。固定 Mods 檔案：commit ' + matrix.termRules[0].sourceRef.commit + '，' + matrix.termRules[0].sourceRef.path + '，SHA-256 ' + matrix.termRules[0].sourceRef.fileSha256 + '。');
  lines.push('');
  for (const rule of matrix.termRules) lines.push('- ' + rule.ruleId + '：' + rule.sourceLine + '（line ' + rule.sourceRef.line + '）。');
  lines.push('');
  lines.push('## 人工審閱');
  lines.push('');
  lines.push('此候選沒有新增或代填 receipt。所有未核准目標保留 pending；輸入變更依既有 review digest 僅使實際相依的目標 stale。');
  lines.push('');
  return lines.join('\n');
}

export function buildW06Candidate(inputs, baseline = committedW01(REPO_ROOT)) {
  const validation = validateWebAuthoring(inputs.authoring, inputs);
  if (!validation.valid) throw new Error(validation.issues.map(item => item.path + ': ' + item.message).join('\n'));
  const matrix = createReviewMatrix(inputs, baseline);
  const markdown = createReviewMarkdown(inputs, matrix);
  const matrixBytes = Buffer.from(JSON.stringify(matrix, null, 2) + '\n', 'utf8');
  return { matrix, markdown, matrixBytes };
}

async function main() {
  try {
    const args = process.argv.slice(2);
    let outputRoot = null;
    if (args.length) {
      if (args.length !== 2 || args[0] !== '--out-root' || !args[1] || args[1].startsWith('--')) {
        throw new Error('usage: node scripts/content/contract-w06.mjs [--out-root <new-directory>]');
      }
      outputRoot = path.resolve(args[1]);
    }
    const inputs = await loadWebAuthoringInputs({ repoRoot: REPO_ROOT, mode: 'w06' });
    const validation = validateWebAuthoring(inputs.authoring, inputs);
    if (!validation.valid) throw new Error(validation.issues.map(item => item.path + ': ' + item.message).join('\n'));
    if (outputRoot === null) {
      process.stdout.write('W06 Web authoring validation passed: presentations=' + inputs.authoring.presentations.length + ' officialInputs=' + inputs.officialInputs.sources.length + ' reviewTargets=' + inputs.authoring.reviewTargets.length + ' publicationEligible=false. No output was written.\n');
      return;
    }
    const baseline = committedW01(REPO_ROOT);
    const { matrix, markdown, matrixBytes } = buildW06Candidate(inputs, baseline);
    await mkdir(outputRoot, { recursive: false });
    await writeFile(path.join(outputRoot, 'review-candidate.md'), markdown, { encoding: 'utf8', flag: 'wx' });
    await writeFile(path.join(outputRoot, 'review-matrix.json'), matrixBytes, { flag: 'wx' });
    process.stdout.write('W06 candidate written after validation: ' + outputRoot + ' (review-candidate.md, review-matrix.json). Existing directories are never overwritten.\n');
  } catch (error) {
    process.stderr.write('W06 candidate command failed: ' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
