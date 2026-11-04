import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadWebAuthoringInputs, validateWebAuthoring } from './contract-authoring.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
export const canonicalBytes = value => Buffer.from(JSON.stringify(sorted(value)) + '\n');
const ref = record => ({ recordId: record.recordId, gameReleaseId: record.gameReleaseId, kind: record.kind });
const identity = record => record.recordId + '\0' + record.gameReleaseId;
const normalized = value => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
const tokens = text => [...text.matchAll(/\{([^{}:]+):%s\}/g)];

function officialInput({ entityRef, variantRef, tier, locale, text, key, sourceHash, slug, params = [], claims = [] }) {
  const officialSourceId = `official:items:${sourceHash}:${key === null ? 'key-unknown' : 'key-known'}:${locale.toLowerCase()}:1:g-${hash(slug).slice(0, 16)}${tier === undefined ? ':name' : ':tier-' + tier}`;
  const segments = [];
  let offset = 0;
  const add = segment => segments.push({ segmentId: 'segment-' + (segments.length + 1), ...segment,
    sha256: hash(segment.kind === 'text' ? segment.text : segment.token) });
  for (const match of tokens(text)) {
    if (match.index > offset) add({ kind: 'text', text: text.slice(offset, match.index) });
    add({ kind: 'parameter', parameterId: match[1], token: match[0] });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) add({ kind: 'text', text: text.slice(offset) });
  const bound = params.map((param, i) => ({ parameterId: param.name, sourceKey: param.bindingRef.recordId,
    value: param.format === 'signed-percent' ? (claims[i].payload.value.decimal.startsWith('-') ? '' : '+') + claims[i].payload.value.decimal + '%' : claims[i].payload.value.decimal }));
  const resolvedText = text.replace(/\{([^{}:]+):%s\}/g, (_, name) => bound.find(p => p.parameterId === name).value);
  return { officialSourceId, entityRef, origin: 'game-localization', sourceLocale: locale, resource: 'items', key, sourceHash, occurrence: 1,
    ...(tier === undefined ? {} : { bindingContext: { variantRef, tier } }), sourceText: text, sourceTextSha256: hash(text), segments,
    params: bound, resolvedText, resolvedTextSha256: hash(resolvedText) };
}

export function generatePresentations({ candidates, text, approved, baseAuthoring, baseOfficialInputs }) {
  const approvedIds = new Set(approved.recordIds);
  const records = candidates.records.filter(r => r.gameReleaseId === 'darktide:1.13.4');
  const byId = new Map(records.map(r => [r.recordId, r]));
  const traits = new Map();
  for (const trait of text.traits) {
    const key = normalized(trait.traitName.replace(/^weapon_trait_(?:bespoke_)?/, ''));
    if (traits.has(key)) throw new Error('Ambiguous trait identity: ' + trait.traitName);
    traits.set(key, trait);
  }
  const additions = { presentations: [], officialInputs: [], reviewTargets: [] };
  const skipped = [], languageFlags = [];
  const existing = new Set(baseAuthoring.presentations.map(p => p.authoringId));
  const officialIds = new Set(baseOfficialInputs.sources.map(s => s.officialSourceId));
  const targetIds = new Set(baseAuthoring.reviewTargets.map(t => t.targetId));
  const variants = records.filter(r => r.kind === 'blessing-variant' && approvedIds.has(r.recordId)).sort((a, b) => a.recordId.localeCompare(b.recordId, 'en'));
  for (const variant of variants) {
    const blessing = byId.get(variant.payload.blessingRef.recordId);
    const slug = variant.payload.blessingRef.recordId.replace(/^darktide:blessing:/, '').replace(/[^A-Za-z0-9._-]/g, '-');
    const authoringId = 'web:presentation:' + slug;
    if (existing.has(authoringId)) throw new Error('Presentation id collision: ' + authoringId);
    const trait = traits.get(normalized(variant.recordId.replace(/^darktide:blessing-variant:/, '')));
    const skip = (reason, detail) => skipped.push({ recordId: variant.recordId, name: trait?.nameZhTw ?? null, reason, detail });
    const languageFlag = trait && trait.descriptionZhTwTemplate === trait.descriptionEnTemplate && /[A-Za-z]/.test(trait.descriptionZhTwTemplate);
    if (languageFlag) languageFlags.push({ recordId: variant.recordId, name: trait.nameZhTw, reason: 'zh-TW template equals English; preserved verbatim' });
    if (!blessing || !approvedIds.has(blessing.recordId) || !trait || !trait.nameEn || !trait.nameZhTw || !trait.nameHash || !trait.descriptionHash
      || !trait.descriptionEnTemplate || !trait.descriptionZhTwTemplate || !variant.payload.definedTiers?.length) {
      skip('other', 'Missing approved identity, localized text, hash, or defined tiers'); continue;
    }
    const enTokens = tokens(trait.descriptionEnTemplate), zhTokens = tokens(trait.descriptionZhTwTemplate);
    const names = [...new Set([...enTokens, ...zhTokens].map(m => m[1]))].sort();
    if ([trait.descriptionEnTemplate, trait.descriptionZhTwTemplate].some(t => /[{}]/.test(t.replace(/\{([^{}:]+):%s\}/g, '')))
      || names.some(n => !enTokens.some(m => m[1] === n) || !zhTokens.some(m => m[1] === n))) {
      skip('unresolved placeholder', 'Unsupported placeholder syntax or differing locale parameter sets'); continue;
    }
    const claims = records.filter(r => r.kind === 'claim' && approvedIds.has(r.recordId)
      && r.payload.targetRef?.recordId === variant.recordId && r.payload.targetRef.gameReleaseId === variant.gameReleaseId);
    const tiers = [...variant.payload.definedTiers].sort((a, b) => a - b);
    const options = [], newSources = [];
    let failure;
    const entityRef = ref(blessing), variantRef = ref(variant);
    for (const tier of tiers) {
      const params = [], selectedClaims = [];
      for (const name of names) {
        const prefix = 'description.format_values.' + name + '.';
        const matches = claims.filter(c => [prefix + 'display_percent', prefix + 'display_value', prefix + `defined_tier_${tier}_display_percent`, prefix + `defined_tier_${tier}_display_value`].includes(c.payload.property));
        if (matches.length !== 1 || matches[0].payload.value?.status !== 'known') { failure = ['unresolved placeholder', `${name}, tier ${tier}: expected one known approved claim`]; break; }
        const claim = matches[0], value = claim.payload.value;
        if (!/^[a-z0-9][a-z0-9:._-]{1,127}$/.test(claim.recordId)) {
          failure = ['other', `Source claim id exceeds Web stableId constraints: ${claim.recordId}`]; break;
        }
        const percent = claim.payload.property.endsWith('display_percent');
        if (!/^-?\d+(?:\.\d+)?$/.test(value.decimal ?? '') || (percent && value.unit !== 'percent')) {
          failure = ['unsupported unit', `${name}, tier ${tier}: ${value.unit}`]; break;
        }
        params.push({ name, placeholder: `{${name}:%s}`, bindingRef: ref(claim), format: percent ? 'signed-percent' : 'plain-number' });
        selectedClaims.push(claim);
      }
      if (failure) break;
      const sources = ['en', 'zh-TW'].map(locale => officialInput({ entityRef, variantRef, tier, locale, slug,
        key: trait.descriptionKey ?? null, sourceHash: trait.descriptionHash,
        text: locale === 'en' ? trait.descriptionEnTemplate : trait.descriptionZhTwTemplate, params, claims: selectedClaims }));
      newSources.push(...sources);
      options.push({ tier, params, officialLocaleRefs: sources.map(s => ({ officialSourceId: s.officialSourceId, sourceLocale: s.sourceLocale })), detailSections: [] });
    }
    if (failure) { skip(...failure); continue; }
    const nameSources = ['en', 'zh-TW'].map(locale => officialInput({ entityRef, locale, slug,
      key: blessing.payload.nameKey?.status === 'unknown' ? null : trait.nameKey ?? null, sourceHash: trait.nameHash,
      text: locale === 'en' ? trait.nameEn : trait.nameZhTw }));
    const defaultOption = options.at(-1);
    const presentation = { authoringId, entityRef, locale: 'zh-TW', name: trait.nameZhTw,
      nameOfficialSourceId: nameSources[1].officialSourceId, nameOfficialLocaleRefs: nameSources.map(s => ({ officialSourceId: s.officialSourceId, sourceLocale: s.sourceLocale })),
      nameTermRuleRefs: [], official: newSources.find(s => s.officialSourceId === defaultOption.officialLocaleRefs[1].officialSourceId),
      officialLocaleRefs: defaultOption.officialLocaleRefs, errata: [], detailSections: defaultOption.detailSections,
      tierApplicability: [{ variantRef, tiers }], tierPresentations: { variantRef, defaultTier: defaultOption.tier, options } };
    const targets = [['/name', 'content'], ['/tierApplicability', 'context'], ...options.map((_, i) => ['/tierPresentations/options/' + i, 'official'])]
      .map(([fieldPath, dimension]) => ({ targetId: `review:w06:generic:${hash(slug).slice(0, 16)}:${dimension}:${fieldPath.replaceAll('/', ':').toLowerCase()}`,
        ownerKind: 'presentation', ownerId: authoringId, fieldPath, dimension }));
    for (const source of [...nameSources, ...newSources]) {
      if (officialIds.has(source.officialSourceId)) throw new Error('Official input id collision: ' + source.officialSourceId);
      officialIds.add(source.officialSourceId);
    }
    for (const target of targets) {
      if (targetIds.has(target.targetId)) throw new Error('Review target id collision: ' + target.targetId);
      targetIds.add(target.targetId);
    }
    existing.add(authoringId);
    additions.presentations.push(presentation); additions.officialInputs.push(...nameSources, ...newSources); additions.reviewTargets.push(...targets);
  }
  const officialInputs = { ...baseOfficialInputs, sources: [...baseOfficialInputs.sources, ...additions.officialInputs] };
  const authoring = { ...baseAuthoring, officialInputsSha256: hash(canonicalBytes(officialInputs)),
    presentations: [...baseAuthoring.presentations, ...additions.presentations], reviewTargets: [...baseAuthoring.reviewTargets, ...additions.reviewTargets] };
  return { authoring, officialInputs, additions, skipped, languageFlags, packageDigest: hash(canonicalBytes(additions)),
    summary: { approvedVariants: variants.length, generated: additions.presentations.length, skipped: skipped.length,
      skipReasons: Object.fromEntries(['unresolved placeholder', 'unsupported unit', 'other'].map(reason => [reason, skipped.filter(x => x.reason === reason).length])) } };
}

async function readOverlay(kind, digest) {
  if (!/^[a-f0-9]{8,64}$/.test(digest)) throw new Error('Invalid base SHA-256: ' + digest);
  const dir = path.join(ROOT, 'content/contracts/w09/authoring-overlays/w06', kind);
  const files = (await readdir(dir)).filter(f => f.startsWith(digest) && /^[a-f0-9]{64}\.json$/.test(f));
  if (files.length !== 1) throw new Error('Base overlay digest must resolve uniquely: ' + digest);
  const bytes = await readFile(path.join(dir, files[0]));
  if (hash(bytes) + '.json' !== files[0]) throw new Error('Base overlay content hash mismatch');
  return { value: JSON.parse(bytes), digest: hash(bytes) };
}

async function validateOutput(result, candidates, baseAuthoring, baseOfficialInputs) {
  const inputs = await loadWebAuthoringInputs({ repoRoot: ROOT, mode: 'w06' });
  // This is an in-memory overlay compatibility check, not a new Source publication or pin.
  const records = new Map(inputs.sourceContract.records.map(r => [identity(r), r]));
  for (const record of candidates.records) {
    if (records.has(identity(record)) && JSON.stringify(sorted(records.get(identity(record)))) !== JSON.stringify(sorted(record))) throw new Error('Source record collision: ' + record.recordId);
    records.set(identity(record), record);
  }
  const releases = new Map(inputs.sourceContract.gameReleases.map(r => [r.gameReleaseId, r]));
  for (const release of candidates.gameReleases) releases.set(release.gameReleaseId, release);
  inputs.sourceContract = { ...inputs.sourceContract, records: [...records.values()], gameReleases: [...releases.values()], sourceRefs: [...inputs.sourceContract.sourceRefs, ...candidates.sourceRefs] };
  inputs.officialInputs = result.officialInputs;
  inputs.webLock = { ...inputs.webLock, officialInputs: { ...inputs.webLock.officialInputs, sha256: result.authoring.officialInputsSha256 } };
  // W09 composition also projects the active Source pin after applying overlays.
  // Do not rewrite the preserved overlay pin merely for this validation projection.
  const projected = { ...result.authoring, sourcePin: inputs.sourcePin };
  const wholeOverlay = validateWebAuthoring(projected, inputs);
  const baseline = validateWebAuthoring({ ...baseAuthoring, sourcePin: inputs.sourcePin, officialInputsSha256: result.authoring.officialInputsSha256 },
    { ...inputs, officialInputs: baseOfficialInputs });
  const baselineIssues = new Set(baseline.issues.map(issue => JSON.stringify(sorted(issue))));
  const introducedIssues = wholeOverlay.issues.filter(issue => !baselineIssues.has(JSON.stringify(sorted(issue))));
  const additiveContract = { ...projected, presentations: result.additions.presentations, reviewTargets: result.additions.reviewTargets,
    reviewReceipts: [], termLocalizations: [], announcements: [], gameChanges: [], officialTextChanges: [] };
  const validation = validateWebAuthoring(additiveContract, { ...inputs, officialInputs: { ...result.officialInputs, sources: result.additions.officialInputs } });
  const counts = {};
  for (const issue of validation.issues) counts[issue.code] = (counts[issue.code] ?? 0) + 1;
  const wholeCounts = {};
  for (const issue of wholeOverlay.issues) wholeCounts[issue.code] = (wholeCounts[issue.code] ?? 0) + 1;
  return { method: 'validateWebAuthoring(w06) for additions against pinned w06 inputs plus in-memory candidates and releases, with active Source pin projection as in W09. No candidate Source validation or publication asserted.',
    valid: validation.valid, scope: 'new presentations, new official inputs, and new review targets', issueCounts: counts, issues: validation.issues,
    wholeOverlay: { valid: wholeOverlay.valid, issueCounts: wholeCounts, issues: wholeOverlay.issues,
      introducedIssues, introducedIssueCount: introducedIssues.length,
      limitation: 'Legacy w06 snapshot lacks existing overlay dependencies for releases 1.13.3/1.13.4. Full overlay validation requires selected W09 Source packet; no handoff locks changed.' } };
}

async function main() {
  const keys = ['source-repo', 'source-commit', 'approved-package-commit', 'base-authoring', 'base-official-inputs', 'output-dir'];
  const { values } = parseArgs({ options: Object.fromEntries(keys.map(k => [k, { type: 'string' }])), strict: true });
  for (const key of keys) if (!values[key]) throw new Error('Missing --' + key);
  for (const key of ['source-commit', 'approved-package-commit']) if (!/^[a-f0-9]{7,40}$/.test(values[key])) throw new Error('Invalid commit: ' + key);
  const sourceRepo = path.resolve(values['source-repo']);
  const gitBytes = (commit, file) => execFileSync('git', ['-c', 'safe.directory=' + sourceRepo.replaceAll('\\', '/'), '-C', sourceRepo, 'show', commit + ':' + file], { maxBuffer: 128 * 1024 * 1024 });
  const candidateBytes = gitBytes(values['source-commit'], 'content/imports/generic/blessings-candidates.json');
  const textBytes = gitBytes(values['source-commit'], 'content/imports/generic/blessings-text.json');
  const candidates = JSON.parse(candidateBytes), text = JSON.parse(textBytes);
  const approved = JSON.parse(gitBytes(values['approved-package-commit'], 'content/reviews/syp-288-generic-blessings/review-package.json'));
  if (approved.inputSha256?.candidate !== hash(candidateBytes) || approved.inputSha256?.text !== hash(textBytes)) {
    throw new Error('Approved package input hashes differ from the supplied Source blobs');
  }
  const [baseAuthoring, baseOfficial] = await Promise.all([readOverlay('authoring', values['base-authoring']), readOverlay('officialInputs', values['base-official-inputs'])]);
  const result = generatePresentations({ candidates, text, approved, baseAuthoring: baseAuthoring.value, baseOfficialInputs: baseOfficial.value });
  const validation = await validateOutput(result, candidates, baseAuthoring.value, baseOfficial.value);
  const currentBlessings = result.authoring.presentations.filter(p => p.entityRef.kind === 'blessing' && p.entityRef.gameReleaseId === 'darktide:1.13.4');
  const presentationSizes = currentBlessings.map(p => canonicalBytes(p).length);
  const estimate = { method: 'Canonical presentation bytes only, excluding Source records, duplicated official inputs, indexes from other modes, weapons-index, and manifest. Proxy only; full 16/24 MiB route compliance remains for w08 build.',
    maxSingleBlessingPresentationBytes: Math.max(0, ...presentationSizes), allNewPresentationBytes: canonicalBytes(result.additions.presentations).length,
    currentBlessingPresentationsBytes: canonicalBytes(currentBlessings).length,
    presentationProxyBelow16MiB: Math.max(0, ...presentationSizes) < 16 * 1024 * 1024 && canonicalBytes(currentBlessings).length < 16 * 1024 * 1024,
    presentationProxyBelow24MiB: canonicalBytes(currentBlessings).length + Math.max(0, ...presentationSizes) < 24 * 1024 * 1024 };
  const output = path.resolve(values['output-dir']);
  const outputs = {};
  for (const [kind, value] of [['authoring', result.authoring], ['officialInputs', result.officialInputs]]) {
    const bytes = canonicalBytes(value), sha256 = hash(bytes);
    await mkdir(path.join(output, kind), { recursive: true });
    const filename = path.join(output, kind, sha256 + '.json');
    try { await writeFile(filename, bytes, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST' || !(await readFile(filename)).equals(bytes)) throw error; }
    outputs[kind] = { sha256, sizeBytes: bytes.length };
  }
  const report = { schemaVersion: 'syp-288-blessing-presentations/1.0.0', sourceCommit: values['source-commit'], approvedPackageCommit: values['approved-package-commit'],
    baseAuthoring: baseAuthoring.digest, baseOfficialInputs: baseOfficial.digest, packageDigest: result.packageDigest,
    digestMethod: 'SHA-256 of canonical UTF-8 JSON (recursively sorted keys, trailing LF) for {presentations, officialInputs, reviewTargets} additions only',
    presentationIds: result.additions.presentations.map(p => p.authoringId), reviewTargets: result.additions.reviewTargets,
    summary: result.summary, skipped: result.skipped, languageFlags: result.languageFlags, outputs, validation, sizeEstimate: estimate };
  await writeFile(path.join(output, 'review-package.json'), canonicalBytes(report));
  const md = ['# SYP-288 通用祝福 presentation 審閱包', '', `產生 ${result.summary.generated}；跳過 ${result.summary.skipped}；核准 variant ${result.summary.approvedVariants}。`,
    `Package digest: ${result.packageDigest}`, '', '## 跳過原因', ...Object.entries(result.summary.skipReasons).map(([reason, count]) => `- ${reason}: ${count}`),
    '', `繁中模板等同英文：${result.languageFlags.length} 筆（包含跳過項目；保留遊戲資料原文，詳見 JSON）。`,
    'Name key unknown 時使用 null 與 nameHash；description 使用 descriptionKey。既有 reviewReceipts 原樣保留，新增部分沒有 receipt。',
    '', '## 驗證與大小', `validateWebAuthoring issue counts: ${JSON.stringify(validation.issueCounts)}`, validation.method,
    `完整 overlay 在舊 snapshot 的問題：${JSON.stringify(validation.wholeOverlay.issueCounts)}；相對原 overlay 新增問題：${validation.wholeOverlay.introducedIssueCount}。`,
    validation.wholeOverlay.limitation,
    `Authoring: ${outputs.authoring.sizeBytes} bytes；officialInputs: ${outputs.officialInputs.sizeBytes} bytes。`,
    `目前 1.13.4 最大單祝福 presentation: ${estimate.maxSingleBlessingPresentationBytes} bytes；所有目前祝福 presentation（index 代理估計）: ${estimate.currentBlessingPresentationsBytes} bytes。`,
    '上述 presentation 代理估計低於 16/24 MiB；未含 Source、official inputs、weapons-index 與 manifest，實際完整路由限制須由 w08 build 確認。', '', '## 十個範例'];
  for (const p of result.additions.presentations.slice(0, 10)) {
    md.push('', `### ${p.name} (${p.entityRef.recordId})`);
    for (const option of p.tierPresentations.options) md.push(`- Tier ${option.tier}: ${result.additions.officialInputs.find(s => s.officialSourceId === option.officialLocaleRefs.find(r => r.sourceLocale === 'zh-TW').officialSourceId).resolvedText.replace(/[\r\n]+/g, ' ')}`);
  }
  if (md.length > 150) throw new Error('Markdown report exceeds 150 lines');
  await writeFile(path.join(output, 'review-package.md'), md.join('\n') + '\n');
  console.log(JSON.stringify({ summary: result.summary, outputs, validation: validation.issueCounts, estimate }, null, 2));
  if (validation.issues.some(i => !['review-pending'].includes(i.code)) || validation.wholeOverlay.introducedIssueCount) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
