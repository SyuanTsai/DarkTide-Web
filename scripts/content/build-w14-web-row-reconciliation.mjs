import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { selectJsonPointer, verifyEntryFragment } from './contract-w03-ledger.mjs';
import { validateW14WebRowReconciliation, verifyW03LedgerShard } from './contract-w14-ledger.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const W03_ROOT = path.join(REPO_ROOT, 'docs/contracts/w03');
const W03_LEDGER_SHA256 = 'bdf4b02c278e9dafef9aea00ac8263fe7929b29e9dc0eb90325cf7c55daa2288';
const W03_INPUT_COMMIT = '2816042d4a7380288ac8e73d1058a8accfe5687b';
const W13_CANDIDATE_COMMIT = '100e3c0339078b5ed985e103d0ead818c361feb9';
const W13_CANDIDATE_PATH = 'content/contracts/w09/prepared/w09-1a09e5ffcc1daf5358d2692b9234c9db/candidate.json';
const W13_CANDIDATE_SHA256 = 'd113c63275233a77da6c6b3e55a0f3bac3e617686d3e94d11982a8e4dddc83a1';
const W13_APPROVAL_COMMIT = 'c2a9035376d39298529aea3bbf2b02fccea529d0';
const W13_APPROVAL_PATH = 'content/contracts/w09/reviews/310f5abfdd07cc9b40d99b7bf12a06834c74595be6b1e0da577f7e054794d747/w13-content-approval.json';
const W13_APPROVAL_SHA256 = 'a6b22d112480fe731d72eebdef6b9c86c1b705646fac97614670d655f8bf644d';
const CURRENT_GAME_RELEASE_ID = 'darktide:1.13.2';
const CURRENT_GAME_VERSION = '1.13.2';
const CORE_KINDS = ['skills', 'blessings', 'weapons', 'terms'];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlobOid = bytes => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, 'utf8'), bytes])).digest('hex');
const jsonSha256 = value => sha256(Buffer.from(JSON.stringify(value), 'utf8'));
const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const canonicalSha256 = value => sha256(Buffer.from(canonical(value), 'utf8'));
const decoder = new TextDecoder('utf-8', { fatal: true });
const parseJson = (bytes, label) => {
  try { return JSON.parse(decoder.decode(bytes)); }
  catch (error) { throw new Error(`${label} is not valid UTF-8 JSON: ${error.message}`); }
};
const sameJson = (left, right) => canonical(left) === canonical(right);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function git(args, encoding = null) {
  return execFileSync('git', ['-c', 'core.longpaths=true', ...args], {
    cwd: REPO_ROOT,
    encoding: encoding ?? undefined,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function pinnedBlob(commit, sourcePath, expectedBlobOid, expectedSha256 = null, expectedSize = null) {
  const line = git(['ls-tree', commit, '--', sourcePath], 'utf8').trim();
  const match = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/u.exec(line);
  if (!match || match[2] !== expectedBlobOid || match[3] !== sourcePath) {
    throw new Error(`pinned Git tree does not contain the expected source blob: ${commit}:${sourcePath}`);
  }
  const bytes = Buffer.from(git(['show', `${commit}:${sourcePath}`]));
  if (gitBlobOid(bytes) !== expectedBlobOid) throw new Error(`pinned Git blob bytes differ: ${sourcePath}`);
  if (expectedSha256 && sha256(bytes) !== expectedSha256) throw new Error(`pinned raw SHA256 differs: ${sourcePath}`);
  if (expectedSize !== null && bytes.length !== expectedSize) throw new Error(`pinned byte size differs: ${sourcePath}`);
  return { bytes, gitBlobOid: expectedBlobOid, sizeBytes: bytes.length, sha256: sha256(bytes) };
}

function treeBlobOid(commit, sourcePath) {
  const line = git(['ls-tree', commit, '--', sourcePath], 'utf8').trim();
  const match = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/u.exec(line);
  if (!match || match[3] !== sourcePath) throw new Error(`pinned Git tree does not contain the expected file: ${commit}:${sourcePath}`);
  return match[2];
}

function parseArgs(argv) {
  let outputPath = null;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--output' && argv[index + 1]) outputPath = path.resolve(argv[++index]);
    else throw new Error('usage: node scripts/content/build-w14-web-row-reconciliation.mjs --output <path>');
  }
  if (!outputPath) throw new Error('usage: node scripts/content/build-w14-web-row-reconciliation.mjs --output <path>');
  return outputPath;
}

function pointerTokens(pointer) {
  if (pointer === '') return [];
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new Error(`invalid JSON pointer: ${pointer}`);
  return pointer.slice(1).split('/').map(token => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function escapePointer(token) { return String(token).replace(/~/g, '~0').replace(/\//g, '~1'); }

function readTokens(value, tokens) {
  let current = value;
  for (const token of tokens) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, token)) return undefined;
    current = current[token];
  }
  return current;
}

function stableRef(value) {
  if (!isObject(value) || typeof value.gameReleaseId !== 'string'
    || typeof value.recordId !== 'string' || typeof value.kind !== 'string') return null;
  return JSON.stringify([value.gameReleaseId ?? null, value.kind ?? null, value.recordId ?? null]);
}

function sameOfficialLocator(left, right) {
  const normalizeLocale = value => value === 'zh-tw' ? 'zh-TW' : value;
  return normalizeLocale(left?.sourceLocale) === normalizeLocale(right?.sourceLocale)
    && left?.resource === right?.resource
    && left?.sourceHash === right?.sourceHash
    && (left?.key ?? null) === (right?.key ?? null)
    && left?.occurrence === right?.occurrence
    && (left?.sourceText ?? left?.text) === (right?.text ?? right?.sourceText)
    && (left?.sourceTextSha256 ?? left?.textSha256 ?? left?.sha256) === (right?.sha256 ?? right?.sourceTextSha256 ?? right?.textSha256);
}

function normalizeLocaleCase(value) {
  return typeof value === 'string' ? value.replace(/:zh-TW:/gu, ':zh-tw:') : value;
}

function buildOwnerIndex(domains) {
  const owners = new Map();
  const officialNodes = [];
  for (const domain of domains) {
    const web = domain.document.web ?? {};
    for (const [collection, ownerKind] of [['presentations', 'presentation'], ['termLocalizations', 'term-localization']]) {
      for (const owner of web[collection] ?? []) {
        if (typeof owner.authoringId !== 'string') continue;
        const previous = owners.get(owner.authoringId);
        if (previous) owners.set(owner.authoringId, { ambiguous: true });
        else owners.set(owner.authoringId, { owner, ownerKind, domain: domain.kind });
      }
    }
    for (const source of web.officialInputs?.sources ?? []) {
      officialNodes.push({ domain: domain.kind, source, aliasKind: 'compiled-official-input' });
      for (const parameter of source.params ?? []) {
        if (parameter.officialNameRef?.sourceId) officialNodes.push({
          domain: domain.kind,
          source: parameter.officialNameRef,
          parentSource: source,
          aliasKind: 'compiled-parameter-official-reference',
        });
      }
    }
  }
  return { owners, officialNodes };
}

function exactOfficialNodes(reference, officialNodes) {
  if (reference?.officialName) {
    return officialNodes.filter(node => sameOfficialLocator(node.source, reference.officialName));
  }
  const requestedId = reference?.sourceId;
  if (typeof requestedId !== 'string') return [];
  const requested = normalizeLocaleCase(requestedId);
  const direct = officialNodes.filter(node => {
    const id = node.source.officialSourceId ?? node.source.sourceId;
    return typeof id === 'string' && normalizeLocaleCase(id) === requested;
  });
  if (direct.length) return direct;
  if (/^official:items:863b83e4:key-unknown:(?:en|zh-TW):1$/u.test(requestedId)) {
    return officialNodes.filter(node => normalizeLocaleCase(node.source.officialSourceId ?? '')
      .startsWith(`${requested}:tier-`));
  }
  return [];
}

function getOwnerReferenceSites(owner, sourceId) {
  const sites = [];
  const has = list => Array.isArray(list) && list.some(item => item?.officialSourceId === sourceId || item?.sourceId === sourceId);
  if (has(owner.nameOfficialLocaleRefs) || owner.nameOfficialSourceId === sourceId) {
    sites.push({ semantic: 'name-official-input', reviewPath: '/name', ownerPath: '/name' });
  }
  if (has(owner.officialLocaleRefs)) sites.push({ semantic: 'official-locale-input', reviewPath: '/officialLocaleRefs', ownerPath: '/officialLocaleRefs' });
  if (owner.official?.officialSourceId === sourceId) sites.push({ semantic: 'official-resolved-source', reviewPath: '/officialLocaleRefs', ownerPath: '/official' });
  if ((owner.official?.params ?? []).some(parameter => parameter.sourceKey === sourceId || parameter.officialNameRef?.sourceId === sourceId)) {
    sites.push({ semantic: 'official-parameter-source', reviewPath: '/officialLocaleRefs', ownerPath: '/official/params' });
  }
  for (const [index, option] of (owner.tierPresentations?.options ?? []).entries()) {
    if (has(option.officialLocaleRefs)) sites.push({ semantic: 'tier-option-official-input', reviewPath: `/tierPresentations/options/${index}`, ownerPath: `/tierPresentations/options/${index}`, tier: option.tier ?? null });
    if ((option.params ?? []).some(parameter => parameter.sourceKey === sourceId || parameter.officialNameRef?.sourceId === sourceId)) {
      sites.push({ semantic: 'tier-option-parameter-source', reviewPath: `/tierPresentations/options/${index}`, ownerPath: `/tierPresentations/options/${index}/params`, tier: option.tier ?? null });
    }
  }
  return sites;
}

function buildReceiptIndex(candidate, approval, overlayByMode) {
  const validation = new Map((approval.validation ?? []).map(item => [item.mode, item]));
  if (approval.selected !== false || approval.scopeSha256 !== '310f5abfdd07cc9b40d99b7bf12a06834c74595be6b1e0da577f7e054794d747'
    || !['w06', 'w07'].every(mode => validation.get(mode)?.valid === true && validation.get(mode)?.allApproved === true)) {
    throw new Error('W13 content approval record is not the pinned validated W06/W07 human review input');
  }
  const candidateReceipts = new Map();
  for (const item of candidate.review?.receipts ?? []) {
    const receipt = item.receipt ?? item;
    if (receipt?.targetId) {
      const key = JSON.stringify([item.mode ?? receipt.mode, receipt.targetId]);
      const receipts = candidateReceipts.get(key) ?? [];
      receipts.push(receipt);
      candidateReceipts.set(key, receipts);
    }
  }
  const targets = [];
  for (const item of candidate.review?.targets ?? []) {
    const target = item.target;
    if (!isObject(target) || typeof item.mode !== 'string' || typeof target.targetId !== 'string') continue;
    const candidateReceipt = (candidateReceipts.get(JSON.stringify([item.mode, target.targetId])) ?? [])
      .find(receipt => receipt.targetDigest === item.targetDigest && receipt.dependenciesDigest === item.dependenciesDigest);
    const overlay = overlayByMode.get(item.mode);
    const registration = overlay?.reviewTargets?.find(value => value.targetId === target.targetId);
    const overlayReceiptRecord = overlay?.reviewReceipts?.find(value => {
      const receipt = value.receipt ?? value;
      return receipt.targetId === target.targetId
        && receipt.targetDigest === item.targetDigest
        && receipt.dependenciesDigest === item.dependenciesDigest;
    });
    const overlayReceipt = overlayReceiptRecord?.receipt ?? overlayReceiptRecord;
    const matches = item.state === 'approved'
      && candidateReceipt?.decision === 'approved'
      && candidateReceipt.targetDigest === item.targetDigest
      && candidateReceipt.dependenciesDigest === item.dependenciesDigest
      && registration?.ownerId === target.ownerId
      && registration?.ownerKind === target.ownerKind
      && registration?.fieldPath === target.fieldPath
      && registration?.dimension === target.dimension
      && overlayReceipt?.decision === 'approved'
      && overlayReceipt?.targetDigest === item.targetDigest
      && overlayReceipt?.dependenciesDigest === item.dependenciesDigest;
    targets.push({
      mode: item.mode,
      targetId: target.targetId,
      ownerId: target.ownerId,
      ownerKind: target.ownerKind,
      fieldPath: target.fieldPath,
      dimension: target.dimension,
      targetDigest: item.targetDigest,
      dependenciesDigest: item.dependenciesDigest,
      candidateState: item.state,
      receiptMatchesPinnedOwnerCandidate: matches,
    });
  }
  const webTargets = targets.filter(target => target.ownerKind === 'presentation' || target.ownerKind === 'term-localization');
  if (webTargets.length !== candidate.review.webTargetCount || webTargets.length !== 80
    || webTargets.some(target => !target.receiptMatchesPinnedOwnerCandidate)) {
    throw new Error('pinned W13 Web target count or exact candidate/overlay receipt closure differs');
  }
  return webTargets;
}

function coveringReceiptEvidence(targets, ownerId, ownerKind, reviewPath) {
  return targets.filter(target => target.ownerId === ownerId && target.ownerKind === ownerKind
    && (reviewPath === target.fieldPath || reviewPath.startsWith(`${target.fieldPath}/`))
    && target.receiptMatchesPinnedOwnerCandidate)
    .sort((left, right) => right.fieldPath.length - left.fieldPath.length);
}

function inputOwnerEvidence(node, owners, targets) {
  const source = node.parentSource ?? node.source;
  const ref = source.entityRef ?? source.termRef ?? node.source.entityRef ?? node.source.termRef;
  const matchingOwners = [...owners.values()].filter(item => !item.ambiguous && item.owner
    && stableRef(item.owner.entityRef ?? item.owner.termRef) === stableRef(ref));
  const sourceId = node.parentSource?.officialSourceId ?? node.source.officialSourceId ?? node.source.sourceId;
  const sites = [];
  for (const indexed of matchingOwners) {
    const candidateSourceIds = node.parentSource
      ? [node.source.sourceId, node.parentSource.officialSourceId]
      : [sourceId];
    const matchedSites = candidateSourceIds.flatMap(id => typeof id === 'string'
      ? getOwnerReferenceSites(indexed.owner, id).map(site => ({ ...site, matchedSourceId: id }))
      : []);
    for (const site of matchedSites) {
      const reviewTargets = coveringReceiptEvidence(targets, indexed.owner.authoringId, indexed.ownerKind, site.reviewPath);
      sites.push({
        ownerId: indexed.owner.authoringId,
        ownerKind: indexed.ownerKind,
        domain: indexed.domain,
        sourceId: site.matchedSourceId,
        semantic: site.semantic,
        ownerPath: site.ownerPath,
        reviewPath: site.reviewPath,
        tier: site.tier ?? null,
        reviewTargets,
      });
    }
  }
  return sites;
}

function refEvidence(reference, sourceDocument, officialNodes, owners, targets) {
  const nodes = exactOfficialNodes(reference, officialNodes);
  const uniqueNodes = [...new Map(nodes.map(node => [JSON.stringify([
    node.domain,
    node.source.officialSourceId ?? node.source.sourceId,
    node.parentSource?.officialSourceId ?? null,
  ]), node])).values()];
  const sites = uniqueNodes.flatMap(node => inputOwnerEvidence(node, owners, targets));
  const exactUniqueSource = uniqueNodes.length > 0 && uniqueNodes.every(node =>
    node.aliasKind === 'compiled-official-input' || node.aliasKind === 'compiled-parameter-official-reference');
  const ownerClosure = uniqueNodes.length > 0 && uniqueNodes.every(node => {
    const sourceIds = [node.source.officialSourceId ?? node.source.sourceId, node.parentSource?.officialSourceId].filter(Boolean);
    return sites.some(site => sourceIds.includes(site.sourceId) && site.reviewTargets.length > 0);
  });
  return {
    exactLocatorCount: uniqueNodes.length,
    compiledInputIds: uniqueNodes.map(node => ({
      domain: node.domain,
      officialSourceId: node.source.officialSourceId ?? node.source.sourceId,
      entityRef: node.parentSource?.entityRef ?? node.source.entityRef ?? node.source.termRef ?? null,
      sourceTextSha256: node.source.sourceTextSha256 ?? node.source.textSha256 ?? node.source.sha256 ?? null,
      aliasKind: node.aliasKind,
    })),
    ownerSites: sites,
    exactLocator: exactUniqueSource,
    approvedOwnerClosure: exactUniqueSource && ownerClosure,
  };
}

function candidateOfficialSource(reference, officialNodes, owner, tier = null) {
  const candidates = exactOfficialNodes(reference, officialNodes).filter(node => node.aliasKind === 'compiled-official-input');
  const ownerRef = owner.entityRef ?? owner.termRef;
  const byOwner = candidates.filter(node => stableRef(node.source.entityRef ?? node.source.termRef) === stableRef(ownerRef));
  const selectedTier = tier ?? owner.official?.bindingContext?.tier ?? null;
  if (selectedTier !== null && selectedTier !== undefined) {
    const tierNodes = byOwner.filter(node => (node.source.officialSourceId ?? '').endsWith(`:tier-${selectedTier}`));
    if (tierNodes.length) return tierNodes;
  }
  return byOwner;
}

function mapOfficialPointer(sourceRecord, sourceDocument, sourceValue, pointer, owner, ownerId, ownerKind, officialNodes, allOwners, targets, tierContext) {
  const tokens = pointerTokens(pointer);
  const payloadAt = tokens.indexOf('official');
  if (payloadAt < 0) return null;
  const officialTail = tokens.slice(payloadAt + 1);
  const localeAt = officialTail[0] === 'localizations' ? 1 : -1;
  const locale = localeAt >= 0 ? officialTail[1] : null;
  const oldOfficial = sourceRecord.payload?.official;
  const oldLocalized = locale ? oldOfficial?.localizations?.[locale] : null;
  const sourceRef = (oldLocalized ?? oldOfficial)?.sourceRef ?? oldOfficial?.sourceRef;
  if (typeof sourceRef !== 'string') return { reason: 'legacy-official-source-reference-is-missing' };
  const refs = (sourceDocument.references ?? []).map((item, index) => ({ item, index })).filter(item => item.item.sourceId === sourceRef);
  if (refs.length !== 1) return { reason: 'legacy-official-source-reference-is-not-unique' };
  const ref = refs[0].item;
  const nodes = candidateOfficialSource(ref, officialNodes, owner, tierContext);
  if (!nodes.length) return { reason: 'no-exact-current-compiled-official-input-for-legacy-source-ref' };
  const ownerSites = nodes.flatMap(node => inputOwnerEvidence(node, allOwners, targets))
    .filter(site => site.ownerId === ownerId && site.ownerKind === ownerKind);
  const validSites = ownerSites.filter(site => site.reviewTargets.length > 0);
  if (!validSites.length) return { reason: 'compiled-official-input-has-no-approved-owner-receipt-closure' };
  const currentRootPath = `/${escapePointer('officialInputs')}/sources/${escapePointer(nodes.map(node => node.source.officialSourceId ?? node.source.sourceId).sort()[0])}`;
  const partStart = localeAt >= 0 ? 2 : 0;
  const fieldTokens = officialTail.slice(partStart);
  if (!fieldTokens.length) {
    return {
      ownerId, ownerKind, fieldPath: currentRootPath, targetFieldPath: validSites[0].reviewPath,
      currentValue: nodes[0].source, sourceValue, ownerSites: validSites,
      kind: 'compiled-official-input', metadataOnly: true,
      mappingBasis: 'exact sourceRef/officialName locator to current W13 officialInputs source plus a digest-bound owner review receipt',
    };
  }

  const first = fieldTokens[0];
  if (first === 'sourceRef') {
    return {
      ownerId, ownerKind, fieldPath: `${currentRootPath}/officialSourceId`, targetFieldPath: validSites[0].reviewPath,
      currentValue: nodes[0].source.officialSourceId ?? nodes[0].source.sourceId,
      sourceValue, ownerSites: validSites, kind: 'official-source-identity', metadataOnly: true,
      mappingBasis: 'W03 sourceRef is represented by the exact W13 officialSourceId bound to the approved owner input',
    };
  }
  if (first === 'origin') {
    return {
      ownerId, ownerKind, fieldPath: `${currentRootPath}/origin`, targetFieldPath: validSites[0].reviewPath,
      currentValue: nodes[0].source.origin ?? 'game-localization', sourceValue, ownerSites: validSites,
      kind: 'official-origin-normalization', metadataOnly: true,
      mappingBasis: 'W03 localization origin is normalized by the W13 source-localization input contract',
    };
  }

  let currentValue;
  let fieldPath = currentRootPath;
  let valueTransform = value => value;
  if (first === 'segments' && fieldTokens.length >= 2) {
    const oldSegments = oldLocalized?.segments ?? oldOfficial?.segments ?? [];
    const oldIndex = Number(fieldTokens[1]);
    const oldSegment = Number.isInteger(oldIndex) ? oldSegments[oldIndex] : null;
    if (!oldSegment?.segmentId) return { reason: 'legacy-official-segment-has-no-stable-segment-id' };
    const segmentMatches = nodes.flatMap(node => (node.source.segments ?? []).map((segment, index) => ({ node, segment, index })))
      .filter(item => item.segment.segmentId === oldSegment.segmentId);
    if (segmentMatches.length !== 1) return { reason: 'current-official-segment-id-is-missing-or-ambiguous' };
    const { node, segment, index } = segmentMatches[0];
    const oldField = fieldTokens[2];
    if (!oldField) {
      currentValue = segment;
      fieldPath = `${currentRootPath}/segments/${index}`;
    } else {
      const field = oldField === 'kind' ? 'kind' : oldField === 'text'
        ? (oldSegment.kind === 'template-placeholder' ? 'token' : 'text')
        : oldField;
      fieldPath = `${currentRootPath}/segments/${index}/${field}`;
      currentValue = node.source.segments[index]?.[field];
      if (oldField === 'kind') {
        const aliases = { literal: 'text', 'template-placeholder': 'parameter' };
        valueTransform = value => aliases[value] ?? value;
      }
    }
  } else if (first === 'params' && fieldTokens.length >= 2) {
    const oldParams = oldLocalized?.params ?? oldOfficial?.params ?? [];
    const oldIndex = Number(fieldTokens[1]);
    const oldParam = Number.isInteger(oldIndex) ? oldParams[oldIndex] : null;
    const parameterId = oldParam?.name ?? oldParam?.parameterId;
    if (typeof parameterId !== 'string') return { reason: 'legacy-official-parameter-has-no-stable-name' };
    const matches = nodes.flatMap(node => (node.source.params ?? []).map((param, index) => ({ node, param, index })))
      .filter(item => (item.param.parameterId ?? item.param.name) === parameterId);
    if (matches.length !== 1) return { reason: 'current-official-parameter-id-is-missing-or-ambiguous' };
    const { node, param, index } = matches[0];
    const oldField = fieldTokens[2];
    const fieldAliases = { name: 'parameterId', bindingRef: 'sourceKey' };
    if (oldField === 'status' || oldField === 'format') {
      return {
        ownerId, ownerKind, fieldPath: `${currentRootPath}/params/${index}/sourceKey`, targetFieldPath: validSites[0].reviewPath,
        currentValue: param.sourceKey, sourceValue, ownerSites: validSites, kind: `compiler-parameter-${oldField}-metadata`, metadataOnly: true,
        mappingBasis: `W08 compiler validated the parameter binding; the current official input retains parameterId/sourceKey and the approved owner closure`,
      };
    }
    if (oldField === 'placeholder') {
      const tokenMatches = (node.source.segments ?? []).filter(segment => segment.parameterId === parameterId && segment.kind === 'parameter');
      if (tokenMatches.length !== 1) return { reason: 'current-official-placeholder-token-is-missing-or-ambiguous' };
      currentValue = tokenMatches[0].token;
      fieldPath = `${currentRootPath}/segments/${node.source.segments.indexOf(tokenMatches[0])}/token`;
      return { ownerId, ownerKind, fieldPath, targetFieldPath: validSites[0].reviewPath, currentValue, sourceValue,
        ownerSites: validSites, kind: 'approved-compiled-official-placeholder', reviewTargets: validSites.flatMap(site => site.reviewTargets) };
    }
    const field = fieldAliases[oldField] ?? oldField;
    fieldPath = oldField ? `${currentRootPath}/params/${index}/${field}` : `${currentRootPath}/params/${index}`;
    currentValue = oldField ? node.source.params[index]?.[field] : param;
  } else {
    const fieldAliases = { sourceTextSha256: 'sourceTextSha256' };
    const field = fieldAliases[first] ?? first;
    fieldPath = `${currentRootPath}/${field}`;
    currentValue = nodes[0].source[field];
  }
  if (currentValue === undefined) return { reason: 'mapped-current-official-input-field-is-missing' };
  const nodeValues = validSites.flatMap(site => site.reviewTargets);
  const normalizedSourceValue = valueTransform(sourceValue);
  const sourceNormalization = sameJson(normalizedSourceValue, sourceValue) ? null : {
    rule: 'w03-segment-kind-to-w08-segment-kind',
    from: sourceValue,
    to: normalizedSourceValue,
  };
  return {
    ownerId, ownerKind, fieldPath, targetFieldPath: validSites[0].reviewPath,
    currentValue, sourceValue, normalizedSourceValue, sourceNormalization, ownerSites: validSites,
    kind: 'approved-compiled-official-input-field',
    reviewTargets: nodeValues,
    transformed: sourceNormalization !== null,
  };
}

function mapDetailSectionField(sourceSections, currentSections, suffixTokens, basePath) {
  const oldSectionId = suffixTokens[0];
  const oldSection = sourceSections?.[oldSectionId];
  const matches = (currentSections ?? []).map((section, index) => ({ section, index }))
    .filter(item => item.section.sectionId === oldSectionId);
  if (!oldSection) return { reason: 'stable-detail-section-id-is-missing-or-ambiguous' };
  if (Array.isArray(oldSection) && oldSection.length === 0 && matches.length === 0) {
    return { metadataOnly: true, value: [], path: `${basePath}/${escapePointer(oldSectionId)}` };
  }
  if (matches.length !== 1) return { reason: 'stable-detail-section-id-is-missing-or-ambiguous' };
  if (suffixTokens.length === 1) return { path: `${basePath}/${matches[0].index}`, value: matches[0].section };
  const itemIndex = Number(suffixTokens[1]);
  const sourceItem = Number.isInteger(itemIndex) ? oldSection[itemIndex] : null;
  if (!sourceItem?.itemId) return { reason: 'legacy-detail-item-has-no-stable-item-id' };
  const itemMatches = (matches[0].section.items ?? []).map((item, index) => ({ item, index }))
    .filter(entry => entry.item.itemId === sourceItem.itemId);
  if (itemMatches.length !== 1) return { reason: 'stable-detail-item-id-is-missing-or-ambiguous' };
  const tail = suffixTokens.slice(2);
  if (!tail.length) return { path: `${basePath}/${matches[0].index}/items/${itemMatches[0].index}`, value: itemMatches[0].item, stableItemId: sourceItem.itemId };
  const path = `${basePath}/${matches[0].index}/items/${itemMatches[0].index}/${tail.map(escapePointer).join('/')}`;
  return { path, value: readTokens(itemMatches[0].item, tail), stableItemId: sourceItem.itemId };
}

function mapRecordField(row, sourceDocument, sourceRecord, sourceValue, owners, officialNodes, targets) {
  if (!sourceRecord) return { reason: 'W03 record pointer does not resolve to a source record' };
  const ownerId = sourceRecord.recordId;
  const ownerEntry = owners.get(ownerId);
  if (!ownerEntry || ownerEntry.ambiguous) return { reason: ownerEntry?.ambiguous ? 'current W13 authoring owner is ambiguous' : 'current W13 authoring owner is not present' };
  const { owner, ownerKind } = ownerEntry;
  const pointer = row.selector.locator;
  const tokens = pointerTokens(pointer);
  const relative = tokens.slice(2);
  const field = relative[0];
  const base = { ownerId, ownerKind };
  const metadata = (kind, fieldPath, basis, currentValue) => ({ ...base, kind, fieldPath, currentValue, metadataOnly: true, mappingBasis: basis });

  if (field === 'recordId') return metadata('authoring-owner-identity', '/authoringId', 'W13 compiler maps the exact W03 recordId to the typed Web owner collection', owner.authoringId);
  if (field === 'owner') return metadata('typed-owner-collection', '/authoringId', 'W03 owner is ledger metadata; the W13 owner is encoded by the verified Web collection', owner.authoringId);
  const typedReferencePath = owner.entityRef ? '/entityRef' : '/termRef';
  if (field === 'kind') return metadata('typed-owner-kind', `${typedReferencePath}/kind`, 'W03 record kind is represented by the exact W13 typed owner reference and collection', owner.entityRef?.kind ?? owner.termRef?.kind ?? null);
  if (field === 'reviewState') return metadata('review-state-replaced-by-w09-target-receipts', '/reviewTargets', 'W03 authoring review state is replaced by fixed W13 target and receipt states', 'approved-candidate-review');
  if (field === 'gameReleaseId') return metadata('release-identity', owner.entityRef ? '/entityRef/gameReleaseId' : '/termRef/gameReleaseId', 'W13 owner retains the exact fixed game release identity', owner.entityRef?.gameReleaseId ?? owner.termRef?.gameReleaseId ?? null);
  if (field === 'entityRef') return { ...base, kind: 'typed-entity-reference', fieldPath: typedReferencePath, currentValue: owner.entityRef ?? owner.termRef, metadataOnly: true, mappingBasis: 'W13 typed presentation or term reference preserves exact release/kind/record identity' };
  if (field === 'locale') return metadata('localization-locale', '/locale', 'W13 Web owner retains the exact zh-TW localization locale', owner.locale);
  if (field === 'sourceRefs') {
    if (relative.length === 1 && Array.isArray(sourceRecord.sourceRefs) && sourceRecord.sourceRefs.length === 0) {
      return metadata('empty-source-reference-list', '/officialLocaleRefs', 'The fixed W03 owner has no source references; the W13 owner does not inherit an unrecorded source locator.', []);
    }
    const referenceIndex = Number(relative[1]);
    const oldSourceId = sourceRecord.sourceRefs?.[referenceIndex];
    const matches = (sourceDocument.references ?? []).filter(reference => reference.sourceId === oldSourceId);
    if (matches.length !== 1) return { ...base, reason: 'legacy sourceRef is missing or ambiguous in W03 reference table' };
    const mapped = refEvidence(matches[0], sourceDocument, officialNodes, owners, targets);
    if (!mapped.approvedOwnerClosure) return { ...base, reason: 'legacy sourceRef has no exact current official input and owner review closure', sourceReferenceEvidence: mapped };
    return { ...base, kind: 'official-source-reference', fieldPath: '/officialLocaleRefs', currentValue: mapped.compiledInputIds, metadataOnly: true, mappingBasis: 'exact official source locator and current typed owner reference are covered by fixed W13 review receipts', reviewTargets: mapped.ownerSites.flatMap(site => site.reviewTargets), sourceReferenceEvidence: mapped };
  }
  if (field !== 'payload') return { ...base, reason: 'W03 record field has no current W13 payload mapping' };
  const payload = relative.slice(1);
  if (!payload.length) return metadata('typed-owner-payload', '/', 'W13 owner payload is its validated typed presentation/term collection', owner);

  if (payload[0] === 'errata') {
    if (Array.isArray(sourceValue) && sourceValue.length === 0 && Array.isArray(owner.errata) && owner.errata.length === 0) {
      return metadata('empty-errata-list-normalization', '/errata', 'Both fixed authoring inputs contain no errata entries; no errata content is being inferred or omitted.', owner.errata);
    }
  }

  if (payload[0] === 'official' || payload[0] === 'tierPresentations') {
    let tierContext = null;
    let officialPointer = pointer;
    if (payload[0] === 'tierPresentations') {
      if (payload[1] !== 'options') {
        const field = payload[1];
        if (field === 'defaultTier' && sourceValue === owner.tierPresentations?.defaultTier) {
          return metadata('tier-default-identity', '/tierPresentations/defaultTier', 'The explicit W03 default tier matches the same current tier identity.', owner.tierPresentations.defaultTier);
        }
        if (field === 'variantRef') {
          const current = owner.tierPresentations?.variantRef;
          if (isObject(current) && current.kind === 'blessing-variant' && current.gameReleaseId === CURRENT_GAME_RELEASE_ID
            && (current.recordId === sourceValue || current.recordId === sourceValue?.recordId)) {
            return metadata('tier-variant-identity', '/tierPresentations/variantRef', 'The W03 variant identity matches the exact current-release typed blessing-variant reference.', current);
          }
        }
        return { ...base, reason: 'legacy tier field is outside the stable options collection' };
      }
      const sourceOption = sourceRecord.payload?.tierPresentations?.options?.[Number(payload[2])];
      if (!sourceOption || !Number.isSafeInteger(sourceOption.tier)) return { ...base, reason: 'legacy tier option has no explicit tier identity' };
      tierContext = sourceOption.tier;
      if (payload[3] === 'official') {
        officialPointer = pointer;
        const mapping = mapOfficialPointer(sourceRecord, sourceDocument, sourceValue, officialPointer, owner, ownerId, ownerKind, officialNodes, owners, targets, tierContext);
        if (!mapping || mapping.reason) return { ...base, reason: mapping?.reason ?? 'tier official field is not resolvable' };
        return mapping;
      }
      if (payload[3] === 'params') {
        const sourceParamIndex = Number(payload[4]);
        const sourceParam = Number.isSafeInteger(sourceParamIndex) ? sourceOption.params?.[sourceParamIndex] : null;
        if (!sourceParam || typeof sourceParam.name !== 'string') return { ...base, reason: 'legacy tier parameter has no stable name' };
        const currentOptionMatches = (owner.tierPresentations?.options ?? []).map((option, index) => ({ option, index }))
          .filter(item => item.option.tier === tierContext);
        if (currentOptionMatches.length !== 1) return { ...base, reason: 'current tier option is missing or ambiguous' };
        const currentOption = currentOptionMatches[0];
        const paramMatches = (currentOption.option.params ?? []).map((param, index) => ({ param, index }))
          .filter(item => item.param.name === sourceParam.name);
        if (paramMatches.length !== 1) return { ...base, reason: 'current tier parameter name is missing or ambiguous' };
        const currentParam = paramMatches[0];
        const fieldTokens = payload.slice(5);
        const fieldPath = `/tierPresentations/options/${currentOption.index}/params/${currentParam.index}${fieldTokens.length ? `/${fieldTokens.map(escapePointer).join('/')}` : ''}`;
        const value = readTokens(currentParam.param, fieldTokens);
        if (fieldTokens[0] === 'status' || fieldTokens[0] === 'format') {
          if (!currentParam.param.bindingRef?.recordId || currentParam.param.bindingRef.gameReleaseId !== CURRENT_GAME_RELEASE_ID
            || currentParam.param.bindingRef.kind !== 'claim') return { ...base, reason: 'current tier parameter binding is not an exact typed claim reference' };
          return { ...base, kind: `tier-parameter-${fieldTokens[0]}-metadata`, fieldPath: `${fieldPath.slice(0, fieldPath.lastIndexOf('/'))}/bindingRef`, currentValue: currentParam.param.bindingRef,
            stableTier: tierContext, metadataOnly: true, mappingBasis: 'W08 tier parameter status/format metadata is represented by the exact current-release typed claim binding.' };
        }
        if (value === undefined) return { ...base, reason: 'current tier parameter field is missing' };
        if (fieldTokens[0] === 'bindingRef') {
          const oldBindingId = typeof sourceParam.bindingRef === 'string' ? sourceParam.bindingRef : sourceParam.bindingRef?.recordId;
          if (!isObject(value) || value.recordId !== oldBindingId || value.gameReleaseId !== CURRENT_GAME_RELEASE_ID
            || value.kind !== 'claim') return { ...base, reason: 'tier parameter binding does not exactly match the current typed claim reference' };
        }
        return { ...base, kind: 'tier-parameter-field', fieldPath, currentValue: value, stableTier: tierContext,
          reviewPath: `/tierPresentations/options/${currentOption.index}`, mappingBasis: 'W03 tier and parameter name are exact; current typed parameter binding is matched by exact release/kind/record identity.' };
      }
      if (payload[3] === 'detailSections') {
        const currentOptionMatches = (owner.tierPresentations?.options ?? []).map((option, index) => ({ option, index }))
          .filter(item => item.option.tier === tierContext);
        if (currentOptionMatches.length !== 1) return { ...base, reason: 'current tier option is missing or ambiguous' };
        const mapped = mapDetailSectionField(sourceOption.detailSections, currentOptionMatches[0].option.detailSections,
          payload.slice(4), `/tierPresentations/options/${currentOptionMatches[0].index}/detailSections`);
        if (mapped.reason) return { ...base, reason: mapped.reason };
        if (mapped.metadataOnly) return { ...base, kind: 'empty-tier-detail-section-normalization', fieldPath: mapped.path, currentValue: mapped.value, metadataOnly: true,
          mappingBasis: 'The fixed W03 tier section is empty and W13 omits empty detail sections; no content or source value is inferred.' };
        return {
          ...base,
          kind: 'tier-detail-item',
          fieldPath: mapped.path,
          currentValue: mapped.value,
          stableTier: tierContext,
          stableItemId: mapped.stableItemId ?? null,
          reviewPath: `/tierPresentations/options/${currentOptionMatches[0].index}`,
        };
      }
      const currentOptionMatches = (owner.tierPresentations?.options ?? []).map((option, index) => ({ option, index }))
        .filter(item => item.option.tier === tierContext);
      if (currentOptionMatches.length !== 1) return { ...base, reason: 'current tier option is missing or ambiguous' };
      const currentOption = currentOptionMatches[0];
      const tail = payload.slice(3);
      const path = `/tierPresentations/options/${currentOption.index}${tail.length ? `/${tail.map(escapePointer).join('/')}` : ''}`;
      const value = readTokens(currentOption.option, tail);
      if (value === undefined) return { ...base, reason: 'current tier field is missing from the W13 tier option' };
      return { ...base, kind: 'tier-option-field', fieldPath: path, currentValue: value, stableTier: tierContext, reviewPath: `/tierPresentations/options/${currentOption.index}` };
    }
    const mapping = mapOfficialPointer(sourceRecord, sourceDocument, sourceValue, officialPointer, owner, ownerId, ownerKind, officialNodes, owners, targets, tierContext);
    if (mapping?.reason) return { ...base, reason: mapping.reason };
    return mapping;
  }

  if (payload[0] === 'detailSections') {
    const defaultTier = sourceRecord.payload?.tierPresentations?.defaultTier;
    const tierOptions = owner.tierPresentations?.options ?? [];
    const defaultOptions = Number.isSafeInteger(defaultTier)
      ? tierOptions.map((option, index) => ({ option, index })).filter(item => item.option.tier === defaultTier)
      : [];
    const useDefaultTier = defaultOptions.length === 1 && Array.isArray(owner.tierPresentations?.options);
    const currentSections = useDefaultTier ? defaultOptions[0].option.detailSections : owner.detailSections;
    const basePath = useDefaultTier ? `/tierPresentations/options/${defaultOptions[0].index}/detailSections` : '/detailSections';
    const mapped = mapDetailSectionField(sourceRecord.payload?.detailSections, currentSections, payload.slice(1), basePath);
    if (mapped.reason) return { ...base, reason: mapped.reason };
    if (mapped.metadataOnly) return { ...base, kind: 'empty-detail-section-normalization', fieldPath: mapped.path, currentValue: mapped.value, metadataOnly: true,
      mappingBasis: 'The fixed W03 section is empty and W13 omits empty detail sections; no content or source value is inferred.' };
    return { ...base, kind: 'detail-section-item', fieldPath: mapped.path, currentValue: mapped.value, stableItemId: mapped.stableItemId ?? null,
      ...(useDefaultTier ? { stableTier: defaultTier, reviewPath: `/tierPresentations/options/${defaultOptions[0].index}` } : {}) };
  }
  if (payload[0] === 'weaponView' && payload[1] === 'statSections') {
    const oldIndex = Number(payload[2]);
    const oldSection = sourceRecord.payload?.weaponView?.statSections?.[oldIndex];
    if (!oldSection?.sourceStat) return { ...base, reason: 'legacy weapon stat row has no stable sourceStat identity' };
    const matches = (owner.weaponView?.statSections ?? []).map((section, index) => ({ section, index }))
      .filter(item => item.section.sourceStat === oldSection.sourceStat);
    if (matches.length !== 1) return { ...base, reason: 'current weapon stat sourceStat is missing or ambiguous' };
    const tail = payload.slice(3);
    const path = `/weaponView/statSections/${matches[0].index}${tail.length ? `/${tail.map(escapePointer).join('/')}` : ''}`;
    const value = readTokens(matches[0].section, tail);
    if (value === undefined) return { ...base, reason: 'current weapon stat field is missing' };
    return { ...base, kind: 'weapon-stat-source-field', fieldPath: path, currentValue: value, stableStatId: oldSection.sourceStat };
  }
  const path = `/${payload.map(escapePointer).join('/')}`;
  const value = readTokens(owner, payload);
  if (value === undefined) return { ...base, reason: 'current W13 owner does not contain the mapped payload field' };
  return { ...base, kind: 'typed-presentation-field', fieldPath: path, currentValue: value };
}

function selectOwnerReviewTargets(mapping, ownerId, ownerKind, targets) {
  if (mapping.reviewTargets?.length) return mapping.reviewTargets;
  const reviewPath = mapping.reviewPath ?? mapping.targetFieldPath ?? mapping.fieldPath;
  return reviewPath ? coveringReceiptEvidence(targets, ownerId, ownerKind, reviewPath) : [];
}

function reconcileOne(row, sourceDocument, sourceRecord, sourceValue, ownerIndex, officialNodes, allTargets, candidate, manifest) {
  const base = {
    entryId: row.entryId,
    sourceRowSha256: jsonSha256(row),
    source: row.source,
    selector: row.selector,
    sourceFragment: row.fragment,
    sourceValueJsonSha256: row.fragment.sha256,
    sourceValueCanonicalSha256: canonicalSha256(sourceValue),
  };
  const pointer = row.selector?.locator ?? '';
  if (pointer.startsWith('/announcements/')) {
    return { ...base, disposition: 'deferred-w15', scopeOwner: 'W15', reason: 'W03 announcement rows belong to the separately scoped W15 announcement package; no announcement content is inferred here.', currentMapping: { kind: 'deferred-announcement-scope', currentGameReleaseId: CURRENT_GAME_RELEASE_ID } };
  }
  if (row.source.path === 'source.lock.json') {
    const fileIndex = /^\/artifacts\/(\d+)(?:\/|$)/u.exec(pointer);
    if (fileIndex) {
      const artifactName = typeof sourceValue === 'string' ? sourceValue : null;
      if (artifactName === 'technical.json') {
        const sourcePacket = candidate.source.packetFiles.find(item => item.path === 'technical.json');
        const coreDomains = CORE_KINDS.map(kind => manifest.files.find(item => item.kind === kind && item.path === `domains/${kind}.json`));
        if (!sourcePacket || coreDomains.some(item => !item)) {
          return { ...base, disposition: 'unresolved-current-gap', reason: 'The fixed W09 technical packet or one of the four exact core domain descriptors is missing.', currentMapping: { kind: 'source-technical-packet-incomplete' } };
        }
        const currentMapping = {
          kind: 'source-technical-packet-and-four-core-domains',
          sourceArtifactName: artifactName,
          sourcePacket: { path: sourcePacket.path, sha256: sourcePacket.sha256, sizeBytes: sourcePacket.sizeBytes },
          coreDomains: coreDomains.map(item => ({ kind: item.kind, path: item.path, sha256: item.sha256, sizeBytes: item.sizeBytes })),
          currentManifest: { path: candidate.manifest.path, sha256: candidate.manifest.sha256, dataRevision: manifest.dataRevision },
        };
        return { ...base, disposition: 'metadata-mapped', currentMapping, mappingBasis: 'The W03 technical artifact role maps to the exact W09 Source technical packet descriptor and the four independently pinned current shared core domains; it is not assigned by array position.' };
      }
      if (artifactName === 'game-changes.json') {
        if (manifest.changeIndexPath !== null) return { ...base, disposition: 'unresolved-current-gap', reason: 'The fixed current manifest unexpectedly declares a game-change index for an artifact mapped as absent.', currentMapping: { kind: 'unexpected-current-game-change-index' } };
        const currentMapping = {
          kind: 'legacy-game-change-artifact-not-emitted-by-current-manifest',
          sourceArtifactName: artifactName,
          currentChangeIndex: { path: manifest.changeIndexPath, manifestPath: candidate.manifest.path, manifestSha256: candidate.manifest.sha256, dataRevision: manifest.dataRevision },
        };
        return { ...base, disposition: 'metadata-mapped', currentMapping, mappingBasis: 'The fixed W03 source artifact name is retained. The current W09 manifest explicitly has changeIndexPath=null, so no current game-change document is emitted or inferred.' };
      }
      return { ...base, disposition: 'unresolved-current-gap', reason: 'The fixed W03 source.lock artifact role has no exact W09 role mapping.', currentMapping: { kind: 'unmapped-source-lock-artifact', sourceArtifactName: artifactName } };
    }
    const currentMapping = { kind: 'generated-source-lock-metadata', fieldPath: pointer, sourcePointerSha256: canonicalSha256(sourceValue), targetRelease: { gameVersion: candidate.gameVersion, gameReleaseId: candidate.gameReleaseId, sourceRevision: candidate.source.sourceRevision, manifestSha256: candidate.manifest.sha256 } };
    return { ...base, disposition: 'metadata-mapped', currentMapping, mappingBasis: 'W03 source.lock non-artifact metadata is replaced by the exact W09 release and source manifest identity.' };
  }
  if (row.source.path !== 'content/w01/web-authoring.json') {
    return { ...base, disposition: 'unresolved-current-gap', reason: 'W03 Web owner source path is outside the fixed authoring input inventory.', currentMapping: { kind: 'unrecognized-w03-web-source-path', path: row.source.path } };
  }
  if (['/schemaVersion', '/fixtureOnly', '/gameReleaseId'].includes(pointer)) {
    return {
      ...base,
      disposition: 'metadata-mapped',
      currentMapping: { kind: 'authoring-envelope-metadata', fieldPath: pointer, targetReleaseId: candidate.gameReleaseId, authoringOverlaySha256s: ownerIndex.overlayPins },
      mappingBasis: 'The exact W03 Web authoring file is pinned to the current input commit; compiler metadata is represented by the fixed W13 candidate and verified W06/W07 authoring overlay hashes.',
    };
  }
  if (pointer.startsWith('/references/')) {
    const match = /^\/references\/(\d+)(?:\/(.*))?$/u.exec(pointer);
    const reference = match ? sourceDocument.references?.[Number(match[1])] : null;
    if (!reference) return { ...base, disposition: 'unresolved-current-gap', reason: 'W03 official reference pointer does not resolve.', currentMapping: { kind: 'official-reference-pointer', pointer } };
    const mapping = refEvidence(reference, sourceDocument, officialNodes, ownerIndex.owners, allTargets);
    if (!mapping.approvedOwnerClosure) return { ...base, disposition: 'unresolved-current-gap', reason: 'The W03 official source locator or its current owner receipt closure is missing or ambiguous.', currentMapping: { kind: 'official-reference-crosswalk', sourceId: reference.sourceId, ...mapping } };
    return { ...base, disposition: 'metadata-mapped', currentMapping: { kind: 'official-reference-crosswalk', sourceId: reference.sourceId, ...mapping }, mappingBasis: 'Exact sourceLocale/resource/sourceHash/key/occurrence/text/SHA locator (or fixed tier expansion) resolves to W13 officialInputs and the matching owner has exact human-approved W13 target receipts.' };
  }
  const recordMatch = /^\/records\/(\d+)(?:\/|$)/u.exec(pointer);
  if (!recordMatch) return { ...base, disposition: 'unresolved-current-gap', reason: 'W03 Web row has no recognized source-record or reference selector.', currentMapping: { kind: 'unmapped-w03-web-selector', pointer } };
  const mapping = mapRecordField(row, sourceDocument, sourceRecord, sourceValue, ownerIndex.owners, officialNodes, allTargets);
  if (mapping.reason) return { ...base, disposition: 'unresolved-current-gap', reason: mapping.reason, currentMapping: { kind: 'unresolved-web-record-field', ownerId: mapping.ownerId ?? sourceRecord?.recordId ?? null, ownerKind: mapping.ownerKind ?? null, sourcePointer: pointer, ...mapping } };
  const currentValue = mapping.currentValue;
  const currentValueExists = currentValue !== undefined;
  const rawSourceValue = mapping.sourceValue ?? sourceValue;
  const sourceMatches = currentValueExists && sameJson(rawSourceValue, currentValue);
  const normalizedSourceMatches = currentValueExists && mapping.sourceNormalization !== null
    && mapping.normalizedSourceValue !== undefined && sameJson(mapping.normalizedSourceValue, currentValue);
  if (mapping.metadataOnly === true) {
    return {
      ...base,
      disposition: 'metadata-mapped',
      currentMapping: { kind: mapping.kind, ownerId: mapping.ownerId, ownerKind: mapping.ownerKind, fieldPath: mapping.fieldPath, currentValueCanonicalSha256: currentValueExists ? canonicalSha256(currentValue) : null, sourceValueMatchesCurrent: sourceMatches, ...(mapping.stableTier ? { stableTier: mapping.stableTier } : {}) },
      mappingBasis: mapping.mappingBasis,
      evidence: mapping.reviewTargets?.length ? { ownerCandidateTargets: mapping.reviewTargets } : undefined,
    };
  }
  const reviewTargets = selectOwnerReviewTargets(mapping, mapping.ownerId, mapping.ownerKind, allTargets);
  const allReviewed = reviewTargets.length > 0 && reviewTargets.every(target => target.receiptMatchesPinnedOwnerCandidate);
  if (!currentValueExists || !mapping.fieldPath || !allReviewed) {
    return {
      ...base,
      disposition: 'unresolved-current-gap',
      reason: !currentValueExists ? 'W13 stable target field is absent.' : !mapping.fieldPath ? 'No exact W13 field path was produced.' : 'Mapped W13 field has no exact approved W13 review target/dependency closure.',
      currentMapping: { kind: mapping.kind ?? 'unresolved-web-record-field', ownerId: mapping.ownerId, ownerKind: mapping.ownerKind, fieldPath: mapping.fieldPath ?? null, currentValueCanonicalSha256: currentValueExists ? canonicalSha256(currentValue) : null, sourceValueMatchesCurrent: sourceMatches, stableItemId: mapping.stableItemId ?? null, stableTier: mapping.stableTier ?? null },
    };
  }
  return {
    ...base,
    disposition: sourceMatches ? 'approved-current-reuse' : 'approved-current-rewrite',
    currentMapping: { kind: mapping.kind, ownerId: mapping.ownerId, ownerKind: mapping.ownerKind, fieldPath: mapping.fieldPath, currentValueCanonicalSha256: canonicalSha256(currentValue), sourceValueMatchesCurrent: sourceMatches, normalizedSourceValueMatchesCurrent: normalizedSourceMatches, sourceNormalization: mapping.sourceNormalization ?? null, stableItemId: mapping.stableItemId ?? null, stableStatId: mapping.stableStatId ?? null, stableTier: mapping.stableTier ?? null },
    evidence: { ownerCandidateTargets: reviewTargets },
  };
}

async function loadW03Rows() {
  const ledgerBytes = await readFile(path.join(W03_ROOT, 'mapping-ledger.json'));
  if (sha256(ledgerBytes) !== W03_LEDGER_SHA256) throw new Error('W03 mapping-ledger.json differs from its fixed raw pin');
  const ledger = parseJson(ledgerBytes, 'W03 mapping ledger');
  const relevant = ledger.shards.filter(descriptor => ['web-w01-inputs', 'web-source-lock'].includes(descriptor.groupId));
  const rows = [];
  const shardPins = [];
  for (const descriptor of relevant) {
    const container = await readFile(path.join(W03_ROOT, ...descriptor.path.split('/')));
    const checked = verifyW03LedgerShard(ledger, descriptor, container);
    if (!checked.valid) throw new Error(`W03 shard failed validation: ${descriptor.path}: ${checked.issues[0]?.code}`);
    shardPins.push({ groupId: descriptor.groupId, path: descriptor.path, sizeBytes: container.length, sha256: sha256(container) });
    rows.push(...checked.entries.filter(row => row.owner === 'web'
      && row.scope?.gameReleaseId === CURRENT_GAME_RELEASE_ID
      && row.scope?.releaseScope === 'current-snapshot-candidate'));
  }
  if (rows.length !== 568) throw new Error(`fixed W03 current Web row count differs: ${rows.length}`);
  return { ledgerBytes, ledger, rows, shardPins };
}

async function loadW13Inputs() {
  const candidatePin = pinnedBlob(W13_CANDIDATE_COMMIT, W13_CANDIDATE_PATH,
    'b1250b665088e48da2d383cd50924336fb20f018', W13_CANDIDATE_SHA256, 1059353);
  const candidate = parseJson(candidatePin.bytes, 'W13 owner candidate');
  if (candidate.releaseId !== 'w09-1a09e5ffcc1daf5358d2692b9234c9db'
    || candidate.gameVersion !== CURRENT_GAME_VERSION || candidate.gameReleaseId !== CURRENT_GAME_RELEASE_ID
    || candidate.candidateOnly !== true || candidate.publicationEligible !== false
    || candidate.web?.authoringCommit !== W13_APPROVAL_COMMIT) {
    throw new Error('W13 owner candidate identity or non-publication status differs from fixed inputs');
  }
  const releaseBase = `content/contracts/w09/prepared/${candidate.releaseId}`;
  const manifestGitPath = `${releaseBase}/data/${candidate.manifest.dataRevision}/manifest.json`;
  const manifestPin = pinnedBlob(W13_CANDIDATE_COMMIT, manifestGitPath,
    treeBlobOid(W13_CANDIDATE_COMMIT, manifestGitPath), candidate.manifest.sha256, null);
  const manifest = parseJson(manifestPin.bytes, 'W13 candidate manifest');
  if (manifest.dataRevision !== candidate.manifest.dataRevision || manifest.gameReleaseId !== CURRENT_GAME_RELEASE_ID
    || manifest.gameVersion !== CURRENT_GAME_VERSION || manifest.changeIndexPath !== null
    || candidate.manifest.path !== `/data/${manifest.dataRevision}/manifest.json`) {
    throw new Error('fixed W13 candidate manifest identity differs from the current W03 scope');
  }
  const domains = [];
  for (const kind of CORE_KINDS) {
    const file = manifest.files.find(item => item.kind === kind && item.path === `domains/${kind}.json`);
    if (!file) throw new Error(`W13 manifest is missing its fixed ${kind} core domain`);
    const filePath = `${releaseBase}/data/${manifest.dataRevision}/${file.path}`;
    const pin = pinnedBlob(W13_CANDIDATE_COMMIT, filePath,
      treeBlobOid(W13_CANDIDATE_COMMIT, filePath), file.sha256, file.sizeBytes);
    const document = parseJson(pin.bytes, `W13 ${kind} domain`);
    if (document.kind !== kind || document.gameReleaseId !== CURRENT_GAME_RELEASE_ID) throw new Error(`W13 ${kind} domain identity differs`);
    domains.push({ kind, path: filePath, ...pin, document });
  }

  const approvalPin = pinnedBlob(W13_APPROVAL_COMMIT, W13_APPROVAL_PATH,
    '2e822ed4e9016f85fe16f383877fd24e16e900f5', W13_APPROVAL_SHA256, null);
  const approval = parseJson(approvalPin.bytes, 'W13 content approval record');
  if (approval.scopeSha256 !== '310f5abfdd07cc9b40d99b7bf12a06834c74595be6b1e0da577f7e054794d747'
    || approval.selected !== false || candidate.web?.authoringCommit !== W13_APPROVAL_COMMIT) {
    throw new Error('W13 authoring approval record is not the fixed unselected review input');
  }
  const overlays = [];
  for (const descriptor of approval.authoringOverlay ?? []) {
    if (!descriptor.path.startsWith('content/contracts/w09/authoring-overlays/')) throw new Error('W13 overlay path is outside the fixed authoring overlay root');
    const pin = pinnedBlob(W13_APPROVAL_COMMIT, descriptor.path,
      treeBlobOid(W13_APPROVAL_COMMIT, descriptor.path), descriptor.sha256, descriptor.sizeBytes);
    overlays.push({ descriptor, ...pin, document: parseJson(pin.bytes, `W13 overlay ${descriptor.mode}/${descriptor.target}`) });
  }
  const ownerOverlays = overlays.filter(item => item.descriptor.target === 'authoring');
  const overlayByMode = new Map();
  for (const item of ownerOverlays) {
    if (overlayByMode.has(item.descriptor.mode)) throw new Error(`duplicate W13 authoring overlay mode: ${item.descriptor.mode}`);
    overlayByMode.set(item.descriptor.mode, item.document);
  }
  const validationModes = new Map((approval.validation ?? []).map(item => [item.mode, item]));
  if (!['w06', 'w07'].every(mode => validationModes.get(mode)?.valid === true && validationModes.get(mode)?.allApproved === true)) {
    throw new Error('W13 approval validation does not establish the exact all-approved W06/W07 overlay scopes');
  }
  const targetEvidence = buildReceiptIndex(candidate, approval, overlayByMode);
  return {
    candidate,
    candidatePin,
    manifest,
    manifestPin,
    manifestGitPath,
    approval,
    approvalPin,
    overlays,
    domains,
    targetEvidence,
  };
}

function buildReportRows(sourceRows, sourceBytesByPath, sourceDocuments, ownerIndex, targets, candidate, manifest) {
  const rows = [];
  for (const row of sourceRows) {
    const sourcePin = sourceBytesByPath.get(row.source.path);
    if (!sourcePin) throw new Error(`missing W03 pinned Web source bytes: ${row.source.path}`);
    const fragment = verifyEntryFragment(row, sourcePin.bytes);
    if (!fragment.valid) throw new Error(`W03 fragment binding failed for ${row.entryId}: ${fragment.reason}`);
    if (gitBlobOid(sourcePin.bytes) !== row.source.gitBlobOid) throw new Error(`W03 source blob differs for ${row.entryId}`);
    const sourceDocument = sourceDocuments.get(row.source.path);
    const sourceValue = selectJsonPointer(sourceDocument, row.selector.locator);
    if (sourceValue === undefined) throw new Error(`W03 selector no longer resolves for ${row.entryId}`);
    const recordMatch = /^\/records\/(\d+)(?:\/|$)/u.exec(row.selector?.locator ?? '');
    const sourceRecord = recordMatch ? sourceDocument.records?.[Number(recordMatch[1])] : null;
    const reconciled = reconcileOne(row, sourceDocument, sourceRecord, sourceValue, ownerIndex, ownerIndex.officialNodes, targets, candidate, manifest);
    rows.push(reconciled);
  }
  return rows;
}

function buildOverlayPins(overlays) {
  return overlays.map(item => ({ mode: item.descriptor.mode, target: item.descriptor.target, path: item.descriptor.path, sizeBytes: item.sizeBytes, sha256: item.sha256, gitBlobOid: item.gitBlobOid }));
}

async function main() {
  const outputPath = parseArgs(process.argv.slice(2));
  const { ledgerBytes, ledger, rows: sourceRows, shardPins } = await loadW03Rows();
  const sourceBytesByPath = new Map();
  const sourceDocuments = new Map();
  const sourcePins = [];
  for (const row of sourceRows) {
    if (sourceBytesByPath.has(row.source.path)) continue;
    const pinned = pinnedBlob(W03_INPUT_COMMIT, row.source.path, row.source.gitBlobOid);
    sourceBytesByPath.set(row.source.path, pinned);
    sourceDocuments.set(row.source.path, parseJson(pinned.bytes, `W03 ${row.source.path}`));
    sourcePins.push({ repository: 'Web', commit: W03_INPUT_COMMIT, path: row.source.path, gitBlobOid: pinned.gitBlobOid, sizeBytes: pinned.sizeBytes, sha256: pinned.sha256 });
  }
  const w13 = await loadW13Inputs();
  const ownerIndex = buildOwnerIndex(w13.domains);
  ownerIndex.overlayPins = buildOverlayPins(w13.overlays.filter(item => item.descriptor.target === 'authoring'));
  const rows = buildReportRows(sourceRows, sourceBytesByPath, sourceDocuments, ownerIndex, w13.targetEvidence, w13.candidate, w13.manifest);
  const rowCounts = Object.fromEntries([...new Set(rows.map(row => row.disposition))].sort()
    .map(disposition => [disposition, rows.filter(row => row.disposition === disposition).length]));
  const report = {
    schemaVersion: 'w14.web-current-row-reconciliation.v1',
    status: 'review-candidate-not-approval',
    owner: 'web',
    rowCount: rows.length,
    sourceLedgerSha256: sha256(ledgerBytes),
    candidateOnly: true,
    noApprovalCreated: true,
    summary: {
      byDisposition: rowCounts,
      currentGapCount: rows.filter(row => row.disposition === 'unresolved-current-gap').length,
      deferredW15Count: rows.filter(row => row.disposition === 'deferred-w15').length,
      approvedReceiptBoundRowCount: rows.filter(row => ['approved-current-reuse', 'approved-current-rewrite'].includes(row.disposition)).length,
      metadataMappedCount: rows.filter(row => row.disposition === 'metadata-mapped').length,
    },
    inputBindings: {
      w03Ledger: { repository: 'Web', path: 'docs/contracts/w03/mapping-ledger.json', sha256: sha256(ledgerBytes), rowCount: ledger.entryCount, expectedWebCurrentRows: 568 },
      w03Shards: shardPins,
      w03Sources: sourcePins,
      w13OwnerCandidate: {
        repository: 'Web', commit: W13_CANDIDATE_COMMIT, path: W13_CANDIDATE_PATH,
        gitBlobOid: w13.candidatePin.gitBlobOid, sizeBytes: w13.candidatePin.sizeBytes, sha256: w13.candidatePin.sha256,
        releaseId: w13.candidate.releaseId, contentVersion: w13.candidate.contentVersion,
        gameVersion: w13.candidate.gameVersion, gameReleaseId: w13.candidate.gameReleaseId,
        dataRevision: w13.candidate.manifest.dataRevision, manifestSha256: w13.candidate.manifest.sha256,
        candidateOnly: w13.candidate.candidateOnly, publicationEligible: w13.candidate.publicationEligible,
        selected: false, reviewedWebTargetCount: w13.targetEvidence.length,
      },
      w13Manifest: { repository: 'Web', commit: W13_CANDIDATE_COMMIT, path: w13.manifestGitPath, gitBlobOid: w13.manifestPin.gitBlobOid, sizeBytes: w13.manifestPin.sizeBytes, sha256: w13.manifestPin.sha256, changeIndexPath: w13.manifest.changeIndexPath },
      w13Domains: w13.domains.map(domain => ({ kind: domain.kind, path: domain.path, gitBlobOid: domain.gitBlobOid, sizeBytes: domain.sizeBytes, sha256: domain.sha256 })),
      w13ContentApproval: { repository: 'Web', commit: W13_APPROVAL_COMMIT, path: W13_APPROVAL_PATH, gitBlobOid: w13.approvalPin.gitBlobOid, sizeBytes: w13.approvalPin.sizeBytes, sha256: w13.approvalPin.sha256, scopeSha256: w13.approval.scopeSha256, selected: w13.approval.selected, validation: w13.approval.validation },
      w13AuthoringOverlays: buildOverlayPins(w13.overlays),
    },
    rows,
  };
  const issues = validateW14WebRowReconciliation(report, sourceRows);
  if (issues.length) throw new Error(`generated W14 Web row report failed contract validation: ${issues[0].code} ${issues[0].path}`);
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(outputPath, bytes);
  process.stdout.write(`${JSON.stringify({ outputPath, rowCount: rows.length, summary: report.summary, reportSha256: sha256(bytes) }, null, 2)}\n`);
}

await main();
