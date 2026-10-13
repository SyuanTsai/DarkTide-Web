import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertChildPath,
  assertExactKeys,
  assertPlainObject,
  compareUtf8,
  hashNamedFiles,
  jsonBytes,
  parseJson,
  safeRelativePath,
  sha256
} from '../src/static/common.mjs';
import { previewAssets } from './w01-preview-assets.mjs';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
const SOURCE_ARTIFACTS = ['technical.json', 'game-changes.json'];
const DOMAIN_KINDS = ['skills', 'blessings', 'weapons', 'terms', 'game-changes'];
const DOMAIN_DEPENDENCIES = {
  skills: ['terms'],
  blessings: ['weapons', 'terms'],
  weapons: ['terms'],
  terms: [],
  'game-changes': ['skills']
};
const SOURCE_KIND_DOMAIN = {
  skill: 'skills',
  claim: 'skills',
  evidence: 'skills',
  blessing: 'blessings',
  'blessing-variant': 'blessings',
  weapon: 'weapons',
  'stat-definition': 'weapons',
  'stat-curve': 'weapons',
  term: 'terms'
};
const SOURCE_PAYLOAD_KEYS = {
  skill: ['termRef', 'claimRefs'],
  claim: ['targetRef', 'property', 'value', 'context', 'basis', 'evidenceRefs'],
  evidence: ['sourceRef', 'safeSummary'],
  blessing: ['variantRefs'],
  'blessing-variant': ['blessingRef', 'weaponRefs', 'definedTiers', 'obtainableTiers', 'tierValues'],
  weapon: ['familyId', 'markId', 'templateKey', 'statRefs', 'attackProfileRefs', 'dataCoverage', 'armorRefs', 'theoreticalInputRange'],
  'stat-definition': ['quantity', 'inputUnit', 'outputUnit', 'theoreticalInputRange', 'obtainableInputRange', 'curveRef'],
  'stat-curve': ['inputUnit', 'outputUnit', 'knots', 'interpolation', 'edgePolicy'],
  term: ['termKey', 'contextKey', 'technicalDefinitionEn', 'claimRefs']
};
const SOURCE_REQUIRED_PAYLOAD_KEYS = {
  ...SOURCE_PAYLOAD_KEYS,
  weapon: ['familyId', 'markId', 'templateKey', 'statRefs', 'attackProfileRefs', 'dataCoverage']
};
const RECORD_STATES = new Set(['draft', 'pending', 'approved', 'rejected', 'stale']);
const DETAIL_SECTION_KEYS = ['effects', 'conditions', 'calculation', 'notes', 'extra'];
const W01_RUNTIME_OUTPUT_PATHS = new Set(['index.html', 'preview.css', 'preview.js', 'preview.json', 'robots.txt', 'version.json']);

function fail(message) {
  throw new Error(message);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(label + ' must be a non-empty string');
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') fail(label + ' must be a boolean');
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) fail(label + ' must be an array');
  return value;
}

function requireRefList(value, label) {
  requireArray(value, label);
  for (const ref of value) requireString(ref, label + ' reference');
}

function validateDecimal(value, label) {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
    fail(label + ' must preserve a decimal string');
  }
}

function validateTypedValue(value, label) {
  assertPlainObject(value, label);
  if (value.status === 'known' && 'decimal' in value) {
    const allowed = ['status', 'decimal', 'unit', 'step', 'inclusive'].filter(key => key in value);
    assertExactKeys(value, allowed, label);
    validateDecimal(value.decimal, label + '.decimal');
    requireString(value.unit, label + '.unit');
    if ('step' in value) validateDecimal(value.step, label + '.step');
    if ('inclusive' in value && typeof value.inclusive !== 'boolean') fail(label + '.inclusive must be boolean');
    return;
  }
  if (value.status === 'known' && 'min' in value && 'max' in value) {
    const allowed = ['status', 'min', 'max', 'unit', 'step', 'inclusive'].filter(key => key in value);
    assertExactKeys(value, allowed, label);
    validateDecimal(value.min, label + '.min');
    validateDecimal(value.max, label + '.max');
    requireString(value.unit, label + '.unit');
    if ('step' in value) validateDecimal(value.step, label + '.step');
    if ('inclusive' in value && typeof value.inclusive !== 'boolean') fail(label + '.inclusive must be boolean');
    return;
  }
  if (value.status === 'unknown') {
    assertExactKeys(value, ['status', 'reasonCode'], label);
    requireString(value.reasonCode, label + '.reasonCode');
    return;
  }
  if (value.status === 'not-applicable') {
    assertExactKeys(value, ['status'], label);
    return;
  }
  fail(label + ' has an unsupported typed-value shape');
}

function validatePolicy(value, label) {
  assertPlainObject(value, label);
  if (value.status === 'unknown') {
    assertExactKeys(value, ['status', 'reasonCode'], label);
    requireString(value.reasonCode, label + '.reasonCode');
  } else if (value.status === 'known') {
    assertExactKeys(value, ['status', 'value'], label);
    requireString(value.value, label + '.value');
  } else {
    fail(label + ' has an unsupported policy shape');
  }
}

function validateSourcePayload(kind, payload, label) {
  assertPlainObject(payload, label);
  const allowed = SOURCE_PAYLOAD_KEYS[kind];
  const required = SOURCE_REQUIRED_PAYLOAD_KEYS[kind];
  if (Object.keys(payload).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(payload, key))) {
    fail(label + ' has missing or unsupported fields');
  }
  switch (kind) {
    case 'skill':
      requireString(payload.termRef, label + '.termRef');
      requireRefList(payload.claimRefs, label + '.claimRefs');
      break;
    case 'claim': {
      requireString(payload.targetRef, label + '.targetRef');
      requireString(payload.property, label + '.property');
      validateTypedValue(payload.value, label + '.value');
      assertPlainObject(payload.context, label + '.context');
      const contextKeys = ['attackMode', 'charge', 'armorClass', 'targetId', 'hitZone', 'critical', 'weakspot', 'distance'];
      if (Object.keys(payload.context).some(key => !contextKeys.includes(key))) fail(label + '.context has unsupported fields');
      if ('charge' in payload.context) validateTypedValue(payload.context.charge, label + '.context.charge');
      if ('distance' in payload.context) validateTypedValue(payload.context.distance, label + '.context.distance');
      if (!['code-observed', 'code-derived', 'game-tested', 'unknown'].includes(payload.basis)) fail(label + '.basis is unsupported');
      requireRefList(payload.evidenceRefs, label + '.evidenceRefs');
      break;
    }
    case 'evidence':
      requireString(payload.sourceRef, label + '.sourceRef');
      requireString(payload.safeSummary, label + '.safeSummary');
      break;
    case 'blessing':
      requireRefList(payload.variantRefs, label + '.variantRefs');
      break;
    case 'blessing-variant':
      requireString(payload.blessingRef, label + '.blessingRef');
      requireRefList(payload.weaponRefs, label + '.weaponRefs');
      requireArray(payload.definedTiers, label + '.definedTiers');
      if (!payload.definedTiers.length || payload.definedTiers.some(tier => !Number.isInteger(tier) || tier < 1)) fail(label + '.definedTiers must contain positive tiers');
      validateTypedValue(payload.obtainableTiers, label + '.obtainableTiers');
      requireArray(payload.tierValues, label + '.tierValues');
      if (!payload.tierValues.length) fail(label + '.tierValues must not be empty');
      for (const [index, item] of payload.tierValues.entries()) {
        assertExactKeys(item, ['tier', 'value'], label + '.tierValues[' + index + ']');
        if (!Number.isInteger(item.tier) || item.tier < 1) fail(label + '.tierValues tier must be positive');
        validateTypedValue(item.value, label + '.tierValues[' + index + '].value');
      }
      break;
    case 'weapon':
      for (const key of ['familyId', 'markId', 'templateKey']) requireString(payload[key], label + '.' + key);
      for (const key of ['statRefs', 'attackProfileRefs']) requireRefList(payload[key], label + '.' + key);
      if ('armorRefs' in payload) requireRefList(payload.armorRefs, label + '.armorRefs');
      if ('theoreticalInputRange' in payload) validateTypedValue(payload.theoreticalInputRange, label + '.theoreticalInputRange');
      assertExactKeys(payload.dataCoverage, ['status', 'missing'], label + '.dataCoverage');
      if (!['complete', 'partial', 'unknown'].includes(payload.dataCoverage.status)) fail(label + '.dataCoverage.status is unsupported');
      requireArray(payload.dataCoverage.missing, label + '.dataCoverage.missing');
      for (const [index, missing] of payload.dataCoverage.missing.entries()) {
        const keys = ['field', 'reasonCode', ...(Object.hasOwn(missing, 'sourceRef') ? ['sourceRef'] : [])];
        assertExactKeys(missing, keys, label + '.dataCoverage.missing[' + index + ']');
        requireString(missing.field, label + '.dataCoverage.missing.field');
        requireString(missing.reasonCode, label + '.dataCoverage.missing.reasonCode');
        if ('sourceRef' in missing) requireString(missing.sourceRef, label + '.dataCoverage.missing.sourceRef');
      }
      break;
    case 'stat-definition':
      for (const key of ['quantity', 'inputUnit', 'outputUnit', 'curveRef']) requireString(payload[key], label + '.' + key);
      validateTypedValue(payload.theoreticalInputRange, label + '.theoreticalInputRange');
      validateTypedValue(payload.obtainableInputRange, label + '.obtainableInputRange');
      break;
    case 'stat-curve':
      for (const key of ['inputUnit', 'outputUnit']) requireString(payload[key], label + '.' + key);
      requireArray(payload.knots, label + '.knots');
      if (!payload.knots.length) fail(label + '.knots must not be empty');
      for (const [index, knot] of payload.knots.entries()) {
        assertExactKeys(knot, ['x', 'y'], label + '.knots[' + index + ']');
        validateDecimal(knot.x, label + '.knots[' + index + '].x');
        validateDecimal(knot.y, label + '.knots[' + index + '].y');
      }
      validatePolicy(payload.interpolation, label + '.interpolation');
      validatePolicy(payload.edgePolicy, label + '.edgePolicy');
      break;
    case 'term':
      for (const key of ['termKey', 'contextKey', 'technicalDefinitionEn']) requireString(payload[key], label + '.' + key);
      requireRefList(payload.claimRefs, label + '.claimRefs');
      break;
    default:
      fail(label + ' has an unsupported source kind');
  }
}

async function readRequired(directory, name) {
  const relative = safeRelativePath(name, 'input path');
  return readFile(assertChildPath(directory, path.join(directory, ...relative.split('/')), 'input file'));
}

function verifyFilePin(sourceManifest, name, bytes, label) {
  const file = sourceManifest.files.find(entry => entry.path === name);
  if (!file) fail(label + ' is not listed in the pinned Source manifest');
  assertExactKeys(file, ['path', 'sha256', 'sizeBytes'], label + ' manifest row');
  const canonicalBytes = jsonBytes(parseJson(bytes, name));
  if (sha256(canonicalBytes) !== file.sha256 || canonicalBytes.byteLength !== file.sizeBytes) {
    fail('source artifact ' + name + ' hash or size does not match the pinned manifest');
  }
}

function validateRecordEnvelope(record, label, owner) {
  assertExactKeys(record, ['recordId', 'owner', 'kind', 'gameReleaseId', 'payload', 'sourceRefs', 'reviewState'], label);
  requireString(record.recordId, label + '.recordId');
  if (record.owner !== owner) fail(label + '.owner violates the owner contract');
  requireString(record.kind, label + '.kind');
  requireString(record.gameReleaseId, label + '.gameReleaseId');
  assertPlainObject(record.payload, label + '.payload');
  requireRefList(record.sourceRefs, label + '.sourceRefs');
  if (!RECORD_STATES.has(record.reviewState)) fail(label + '.reviewState is unsupported');
}

function validateSourceInput(lock, sourceManifest, technical, gameChanges, webAuthoring) {
  assertExactKeys(lock, ['schemaVersion', 'repository', 'commit', 'sourceRevision', 'manifestSha256', 'gameReleaseId', 'gameVersion', 'artifacts'], 'source.lock.json');
  if (lock.schemaVersion !== '1.0.0' || lock.repository !== SOURCE_REPOSITORY) fail('source.lock.json does not pin the expected Source repository contract');
  if (!/^[a-f0-9]{40}$/.test(lock.commit) || !/^[a-f0-9]{64}$/.test(lock.sourceRevision) || !/^[a-f0-9]{64}$/.test(lock.manifestSha256)) {
    fail('source.lock.json has an invalid revision or digest');
  }
  if (JSON.stringify([...lock.artifacts].sort()) !== JSON.stringify([...SOURCE_ARTIFACTS].sort())) fail('source.lock.json has an unsupported artifact set');

  assertExactKeys(sourceManifest, ['files', 'fixtureOnly', 'gameReleaseId', 'gameVersion', 'publicationEligible', 'schemaVersion', 'sourceRevision'], 'source manifest');
  if (sourceManifest.schemaVersion !== '1.0.0' || sourceManifest.sourceRevision !== lock.sourceRevision ||
      sourceManifest.gameReleaseId !== lock.gameReleaseId || sourceManifest.gameVersion !== lock.gameVersion) {
    fail('pinned Source manifest metadata does not match source.lock.json');
  }
  requireBoolean(sourceManifest.fixtureOnly, 'Source manifest fixtureOnly');
  requireBoolean(sourceManifest.publicationEligible, 'Source manifest publicationEligible');
  requireArray(sourceManifest.files, 'Source manifest files');

  assertExactKeys(technical, ['fixtureOnly', 'gameChanges', 'gameReleaseId', 'gameVersion', 'publicationEligible', 'records', 'schemaVersion', 'sourceRefs', 'sourceRevision'], 'technical.json');
  if (technical.schemaVersion !== '2.0.0' || technical.sourceRevision !== lock.sourceRevision ||
      technical.gameReleaseId !== lock.gameReleaseId || technical.gameVersion !== lock.gameVersion) {
    fail('technical.json metadata does not match the pinned Source package');
  }
  if (technical.fixtureOnly !== sourceManifest.fixtureOnly || technical.publicationEligible !== sourceManifest.publicationEligible) {
    fail('technical.json publication flags do not match the pinned Source manifest');
  }

  assertExactKeys(gameChanges, ['changes', 'fixtureOnly', 'gameReleaseId', 'publicationEligible', 'sourceRevision'], 'game-changes.json');
  if (gameChanges.sourceRevision !== lock.sourceRevision || gameChanges.gameReleaseId !== lock.gameReleaseId ||
      gameChanges.fixtureOnly !== technical.fixtureOnly || gameChanges.publicationEligible !== technical.publicationEligible) {
    fail('game-changes.json metadata does not match the pinned Source package');
  }
  if (JSON.stringify(technical.gameChanges) !== JSON.stringify(gameChanges.changes)) fail('technical.json and game-changes.json contain different change records');
  if (webAuthoring.schemaVersion !== '1.0.0' || webAuthoring.gameReleaseId !== lock.gameReleaseId || webAuthoring.fixtureOnly !== true) {
    fail('Web authoring input must be the pinned W01 fixture-only package');
  }
}

function validateWebAuthoring(authoring, sourceIds, sourceKindById, sourceReferences, gameReleaseId) {
  assertExactKeys(authoring, ['schemaVersion', 'fixtureOnly', 'gameReleaseId', 'references', 'records', 'announcements'], 'web-authoring.json');
  if (authoring.schemaVersion !== '1.0.0' || authoring.fixtureOnly !== true || authoring.gameReleaseId !== gameReleaseId) {
    fail('Web authoring input is not a compatible fixture package');
  }
  requireArray(authoring.records, 'Web authoring records');
  requireArray(authoring.announcements, 'Web authoring announcements');
  const references = validateSourceReferenceClosure([], authoring.references);
  const referenceIds = new Set(references.map(reference => reference.sourceId));
  for (const reference of references) {
    if (sourceReferences.some(source => source.sourceId === reference.sourceId)) fail('source reference has conflicting owners: ' + reference.sourceId);
  }
  const seen = new Set();
  const recordEnvelopeKeys = ['recordId', 'owner', 'kind', 'gameReleaseId', 'entityRef', 'locale', 'sourceRefs', 'payload', 'reviewState'];
  for (const [index, record] of authoring.records.entries()) {
    const label = 'Web authoring record[' + index + ']';
    assertExactKeys(record, recordEnvelopeKeys, label);
    requireString(record.recordId, label + '.recordId');
    if (record.owner !== 'web') fail(label + '.owner violates the owner contract');
    if (!['presentation', 'term-localization'].includes(record.kind)) fail(label + '.kind is unsupported for Web owner');
    if (record.gameReleaseId !== gameReleaseId || record.reviewState !== 'pending') fail(label + ' must remain pending for the fixture release');
    if (record.locale !== 'zh-TW') fail(label + ' requires zh-TW; English fallback is prohibited');
    if (!sourceIds.has(record.entityRef)) fail(label + ' has an unresolved entityRef');
    requireRefList(record.sourceRefs, label + '.sourceRefs');
    for (const sourceRef of record.sourceRefs) if (!referenceIds.has(sourceRef)) fail(label + ' has unresolved Web-owned sourceRef ' + sourceRef);
    assertPlainObject(record.payload, label + '.payload');
    if (seen.has(record.recordId)) fail('duplicate Web authoring recordId ' + record.recordId);
    seen.add(record.recordId);
    if (record.kind === 'presentation') {
      if (!['skill', 'blessing', 'weapon'].includes(sourceKindById.get(record.entityRef))) fail(label + '.entityRef has the wrong owner kind');
      const allowedPayloadKeys = ['name', 'official', 'errata', 'detailSections'].filter(key => Object.hasOwn(record.payload, key));
      assertExactKeys(record.payload, allowedPayloadKeys, label + '.payload');
      requireString(record.payload.name, label + '.name');
      if (Object.hasOwn(record.payload, 'official') !== Object.hasOwn(record.payload, 'errata')) {
        fail(label + ' must provide official text and errata together when present');
      }
      if (Object.hasOwn(record.payload, 'official')) {
        const official = record.payload.official;
        assertExactKeys(official, ['sourceRef', 'sourceLocale', 'resource', 'key', 'occurrence', 'sourceText', 'sourceTextSha256', 'segments', 'params', 'resolvedText', 'resolvedTextSha256', 'localizations'], label + '.official');
        if (!referenceIds.has(official.sourceRef) || !record.sourceRefs.includes(official.sourceRef)) fail(label + '.official.sourceRef must use the Web-owned registry and record sourceRefs');
        requireString(official.sourceLocale, label + '.official.sourceLocale');
        requireString(official.resource, label + '.official.resource');
        requireString(official.key, label + '.official.key');
        if (!Number.isInteger(official.occurrence) || official.occurrence < 1) fail(label + '.official.occurrence must be a positive integer');
        requireString(official.sourceText, label + '.official.sourceText');
        const sourceTextDigest = sha256(Buffer.from(official.sourceText, 'utf8'));
        if (official.sourceTextSha256 !== sourceTextDigest) fail(label + '.official sourceText hash mismatch');
        requireArray(official.segments, label + '.official.segments');
        if (official.segments.length === 0) fail(label + '.official.segments must not be empty');
        const segmentIds = new Set();
        for (const [segmentIndex, segment] of official.segments.entries()) {
          const segmentLabel = label + '.official.segments[' + segmentIndex + ']';
          assertExactKeys(segment, ['segmentId', 'text', 'sha256'], segmentLabel);
          requireString(segment.segmentId, segmentLabel + '.segmentId');
          requireString(segment.text, segmentLabel + '.text');
          if (segmentIds.has(segment.segmentId)) fail(segmentLabel + ' has a duplicate segmentId');
          segmentIds.add(segment.segmentId);
          if (segment.sha256 !== sha256(Buffer.from(segment.text, 'utf8'))) fail(segmentLabel + ' hash mismatch');
        }
        if (official.segments.map(segment => segment.text).join('') !== official.sourceText) fail(label + '.official segments do not preserve sourceText');
        requireArray(official.params, label + '.official.params');
        requireString(official.resolvedText, label + '.official.resolvedText');
        if (official.resolvedTextSha256 !== sha256(Buffer.from(official.resolvedText, 'utf8'))) fail(label + '.official resolvedText hash mismatch');
        assertExactKeys(official.localizations, ['zh-TW'], label + '.official.localizations');
        const localization = official.localizations['zh-TW'];
        assertExactKeys(localization, ['origin', 'text', 'sha256'], label + '.official.localizations.zh-TW');
        if (localization.origin !== 'faithful-translation') fail(label + '.official zh-TW text must be marked as a faithful translation');
        requireString(localization.text, label + '.official.localizations.zh-TW.text');
        if (localization.sha256 !== sha256(Buffer.from(localization.text, 'utf8'))) fail(label + '.official zh-TW hash mismatch');
        requireArray(record.payload.errata, label + '.errata');
        for (const [erratumIndex, erratum] of record.payload.errata.entries()) {
          const erratumLabel = label + '.errata[' + erratumIndex + ']';
          assertExactKeys(erratum, ['erratumId', 'anchor', 'gameReleaseId', 'context', 'problem', 'claimRef', 'evidenceRefs', 'text', 'reviewState'], erratumLabel);
          requireString(erratum.erratumId, erratumLabel + '.erratumId');
          assertExactKeys(erratum.anchor, ['segmentId', 'sourceTextDigest'], erratumLabel + '.anchor');
          const segment = official.segments.find(item => item.segmentId === erratum.anchor.segmentId);
          if (!segment || segment.sha256 !== erratum.anchor.sourceTextDigest) fail(erratumLabel + ' anchor does not bind to an official segment digest');
          if (erratum.gameReleaseId !== gameReleaseId || erratum.reviewState !== 'pending') fail(erratumLabel + ' must remain pending for the fixture release');
          assertPlainObject(erratum.context, erratumLabel + '.context');
          requireString(erratum.problem, erratumLabel + '.problem');
          requireString(erratum.claimRef, erratumLabel + '.claimRef');
          if (!sourceIds.has(erratum.claimRef) || sourceKindById.get(erratum.claimRef) !== 'claim') fail(erratumLabel + ' has an unresolved claimRef');
          requireRefList(erratum.evidenceRefs, erratumLabel + '.evidenceRefs');
          for (const evidenceRef of erratum.evidenceRefs) if (!sourceIds.has(evidenceRef) || sourceKindById.get(evidenceRef) !== 'evidence') fail(erratumLabel + ' has an unresolved evidenceRef');
          requireString(erratum.text, erratumLabel + '.text');
        }
      }
      assertPlainObject(record.payload.detailSections, label + '.detailSections');
      assertExactKeys(record.payload.detailSections, DETAIL_SECTION_KEYS, label + '.detailSections');
      for (const section of DETAIL_SECTION_KEYS) {
        requireArray(record.payload.detailSections[section], label + '.detailSections.' + section);
        for (const [itemIndex, item] of record.payload.detailSections[section].entries()) {
          const itemLabel = label + '.detailSections.' + section + '[' + itemIndex + ']';
          assertPlainObject(item, itemLabel);
          const keys = ['itemId', ...(Object.hasOwn(item, 'text') ? ['text'] : []), ...(Object.hasOwn(item, 'claimRefs') ? ['claimRefs'] : []), ...(Object.hasOwn(item, 'termRef') ? ['termRef'] : [])];
          assertExactKeys(item, keys, itemLabel);
          requireString(item.itemId, itemLabel + '.itemId');
          if (!Object.hasOwn(item, 'text') && !Object.hasOwn(item, 'termRef')) fail(itemLabel + ' needs text or termRef');
          if ('text' in item) requireString(item.text, itemLabel + '.text');
          if ('claimRefs' in item) {
            requireRefList(item.claimRefs, itemLabel + '.claimRefs');
            for (const claimRef of item.claimRefs) if (!sourceIds.has(claimRef) || sourceKindById.get(claimRef) !== 'claim') fail(itemLabel + ' has an unresolved claimRef');
          }
          if ('termRef' in item && (!sourceIds.has(item.termRef) || sourceKindById.get(item.termRef) !== 'term')) fail(itemLabel + ' has an unresolved termRef');
        }
      }
    } else {
      if (sourceKindById.get(record.entityRef) !== 'term') fail(label + '.entityRef must identify a Source term');
      assertExactKeys(record.payload, ['label', 'definition'], label + '.payload');
      requireString(record.payload.label, label + '.label');
      requireString(record.payload.definition, label + '.definition');
    }
  }
  for (const [index, announcement] of authoring.announcements.entries()) {
    const label = 'Web announcement[' + index + ']';
    assertExactKeys(announcement, ['recordId', 'owner', 'kind', 'gameReleaseId', 'locale', 'sourceRefs', 'payload', 'reviewState'], label);
    requireString(announcement.recordId, label + '.recordId');
    if (announcement.owner !== 'web' || announcement.kind !== 'announcement' || announcement.gameReleaseId !== gameReleaseId ||
        announcement.locale !== 'zh-TW' || announcement.reviewState !== 'pending') fail(label + ' must be a pending zh-TW Web announcement');
    requireRefList(announcement.sourceRefs, label + '.sourceRefs');
    for (const sourceRef of announcement.sourceRefs) if (!referenceIds.has(sourceRef)) fail(label + ' has unresolved Web-owned sourceRef ' + sourceRef);
    assertExactKeys(announcement.payload, ['title', 'blocks'], label + '.payload');
    requireString(announcement.payload.title, label + '.payload.title');
    requireArray(announcement.payload.blocks, label + '.payload.blocks');
    if (announcement.payload.blocks.length === 0) fail(label + '.payload.blocks must not be empty');
    const blockIds = new Set();
    for (const [blockIndex, block] of announcement.payload.blocks.entries()) {
      const blockLabel = label + '.payload.blocks[' + blockIndex + ']';
      assertExactKeys(block, ['blockId', 'type', 'text'], blockLabel);
      requireString(block.blockId, blockLabel + '.blockId');
      if (blockIds.has(block.blockId)) fail(blockLabel + ' has a duplicate blockId');
      blockIds.add(block.blockId);
      if (!['heading', 'paragraph'].includes(block.type)) fail(blockLabel + '.type is unsupported for the W01 preview');
      requireString(block.text, blockLabel + '.text');
    }
    if (seen.has(announcement.recordId)) fail('duplicate Web authoring recordId ' + announcement.recordId);
    seen.add(announcement.recordId);
  }
  return { records: authoring.records, announcements: authoring.announcements, references };
}

function validateSourceReferenceClosure(sourceRecords, sourceRefs) {
  const registry = new Map();
  for (const [index, sourceRef] of sourceRefs.entries()) {
    const label = 'Source reference[' + index + ']';
    assertPlainObject(sourceRef, label);
    const keys = ['sourceId', ...(Object.hasOwn(sourceRef, 'fixtureOnly') ? ['fixtureOnly'] : []), ...(Object.hasOwn(sourceRef, 'safeSummary') ? ['safeSummary'] : [])];
    assertExactKeys(sourceRef, keys, label);
    requireString(sourceRef.sourceId, label + '.sourceId');
    if ('fixtureOnly' in sourceRef) requireBoolean(sourceRef.fixtureOnly, label + '.fixtureOnly');
    if ('safeSummary' in sourceRef) requireString(sourceRef.safeSummary, label + '.safeSummary');
    if (registry.has(sourceRef.sourceId)) fail('duplicate Source reference ' + sourceRef.sourceId);
    registry.set(sourceRef.sourceId, sourceRef);
  }
  for (const record of sourceRecords) {
    for (const sourceRef of record.sourceRefs) if (!registry.has(sourceRef)) fail(record.recordId + ' has unresolved sourceRef ' + sourceRef);
    if (record.kind === 'evidence' && !registry.has(record.payload.sourceRef)) fail(record.recordId + ' has unresolved evidence sourceRef ' + record.payload.sourceRef);
    if (record.kind === 'weapon') {
      for (const missing of record.payload.dataCoverage.missing) {
        if (missing.sourceRef && !registry.has(missing.sourceRef)) fail(record.recordId + ' has unresolved dataCoverage sourceRef ' + missing.sourceRef);
      }
    }
  }
  return [...registry.values()].sort((left, right) => compareUtf8(left.sourceId, right.sourceId));
}

function validateDomainReferences(records, kindById) {
  const check = (from, reference, expectedKinds, label) => {
    if (!kindById.has(reference)) fail(from + ' has unresolved ' + label + ' ' + reference);
    const actualKind = kindById.get(reference);
    if (expectedKinds && !expectedKinds.includes(actualKind)) fail(from + ' has invalid ' + label + ' kind ' + actualKind);
  };
  for (const record of records) {
    const payload = record.payload ?? {};
    const refs = (key, expectedKinds) => {
      const value = payload[key];
      if (typeof value === 'string') check(record.recordId, value, expectedKinds, key);
      if (Array.isArray(value)) for (const item of value) check(record.recordId, item, expectedKinds, key);
    };
    switch (record.kind) {
      case 'skill': refs('termRef', ['term']); refs('claimRefs', ['claim']); break;
      case 'claim': refs('targetRef'); refs('evidenceRefs', ['evidence']); break;
      case 'evidence': break;
      case 'blessing': refs('variantRefs', ['blessing-variant']); break;
      case 'blessing-variant': refs('blessingRef', ['blessing']); refs('weaponRefs', ['weapon']); break;
      case 'weapon': refs('statRefs', ['stat-definition']); refs('armorRefs'); refs('attackProfileRefs'); break;
      case 'stat-definition': refs('curveRef', ['stat-curve']); break;
      case 'stat-curve': break;
      case 'term': refs('claimRefs', ['claim']); break;
      case 'presentation': {
        check(record.recordId, record.entityRef, ['skill', 'blessing', 'weapon'], 'entityRef');
        for (const section of Object.values(payload.detailSections ?? {})) {
          for (const item of section) {
            if ('claimRefs' in item) for (const claimRef of item.claimRefs) check(record.recordId, claimRef, ['claim'], 'claimRef');
            if ('termRef' in item) check(record.recordId, item.termRef, ['term'], 'termRef');
          }
        }
        for (const erratum of payload.errata ?? []) {
          check(record.recordId, erratum.claimRef, ['claim'], 'errata claimRef');
          for (const evidenceRef of erratum.evidenceRefs) check(record.recordId, evidenceRef, ['evidence'], 'errata evidenceRef');
        }
        break;
      }
      case 'term-localization': check(record.recordId, record.entityRef, ['term'], 'entityRef'); break;
      case 'game-change': refs('targetRef'); refs('evidenceRefs', ['evidence']); break;
      default: fail(record.recordId + ' has an unsupported shared kind ' + record.kind);
    }
  }
}

function currentCommit(repoRoot) {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^[a-f0-9]{40}$/.test(commit)) return commit;
  } catch {
    // A locally unpacked fixture may not include Git metadata.
  }
  const envCommit = process.env.GITHUB_SHA;
  if (envCommit && /^[a-f0-9]{40}$/.test(envCommit)) return envCommit;
  return 'working-tree';
}

function addOutput(files, name, bytes) {
  safeRelativePath(name, 'output path');
  files.set(name, Buffer.from(bytes));
}

async function readPreviousOutput(outputRoot) {
  let rootInfo;
  try {
    rootInfo = await lstat(outputRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') return { dataFiles: new Map(), runtimePaths: [], retainedData: null };
    throw error;
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) fail('W01 output path must be a real directory');
  if ((await readdir(outputRoot)).length === 0) return { dataFiles: new Map(), runtimePaths: [], retainedData: null };

  let previous;
  try {
    previous = parseJson(await readFile(path.join(outputRoot, 'receipt.json')), 'previous W01 receipt.json');
  } catch {
    fail('existing W01 output has no verifiable receipt; refusing to overwrite it');
  }
  const previousKeys = ['schemaVersion', 'requestKind', 'buildId', 'dataRevision', 'manifestPath', 'manifestSha256', 'source', 'web', 'fixtureOnly', 'publicationEligible', 'formalPublishAllowed', 'deploymentPerformed', 'files'];
  const expectedPreviousKeys = [...previousKeys, ...(Object.hasOwn(previous, 'retainedData') ? ['retainedData'] : [])];
  assertExactKeys(previous, expectedPreviousKeys, 'previous W01 receipt');
  if (previous.schemaVersion !== '1.0.0' || previous.requestKind !== 'isolated-w01-preview-build' || previous.fixtureOnly !== true ||
      previous.publicationEligible !== false || previous.formalPublishAllowed !== false || previous.deploymentPerformed !== false) {
    fail('existing output is not a receipt-verified W01 fixture package');
  }
  requireArray(previous.files, 'previous W01 receipt.files');
  await assertExactOutputInventory(outputRoot, previous.files);

  const dataFiles = new Map();
  const runtimePaths = [];
  for (const [index, row] of previous.files.entries()) {
    const label = 'previous W01 receipt.files[' + index + ']';
    assertExactKeys(row, ['path', 'sizeBytes', 'sha256'], label);
    const relativeName = safeRelativePath(row.path, label + '.path');
    const bytes = await readRequired(outputRoot, relativeName);
    if (bytes.byteLength !== row.sizeBytes || sha256(bytes) !== row.sha256) fail('existing W01 output does not match its receipt: ' + relativeName);
    if (relativeName.startsWith('data/')) {
      if (!/^data\/[a-f0-9]{64}\/.+/.test(relativeName)) fail('existing W01 data path is not content-addressed: ' + relativeName);
      dataFiles.set(relativeName, { row, bytes });
    } else if (W01_RUNTIME_OUTPUT_PATHS.has(relativeName)) {
      runtimePaths.push(relativeName);
    } else {
      fail('existing W01 output contains an unsupported path: ' + relativeName);
    }
  }
  return { dataFiles, runtimePaths, retainedData: previous.retainedData ?? null };
}

async function writeOutputs(outputRoot, files, receipt, previousOutput) {
  for (const name of previousOutput.runtimePaths) {
    await unlink(assertChildPath(outputRoot, path.join(outputRoot, ...safeRelativePath(name).split('/')), 'previous W01 runtime file'));
  }
  if (previousOutput.runtimePaths.length > 0 || previousOutput.dataFiles.size > 0) {
    await unlink(assertChildPath(outputRoot, path.join(outputRoot, 'receipt.json'), 'previous W01 receipt'));
  }
  await mkdir(outputRoot, { recursive: true });
  for (const [name, bytes] of files) {
    const target = assertChildPath(outputRoot, path.join(outputRoot, ...name.split('/')), 'W01 output file');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const receiptBytes = jsonBytes(receipt);
  await writeFile(assertChildPath(outputRoot, path.join(outputRoot, 'receipt.json'), 'W01 receipt'), receiptBytes);
}

export async function buildW01({ repoRoot = SCRIPT_ROOT, outputRoot = path.join(repoRoot, 'dist-w01'), mode = 'preview' } = {}) {
  repoRoot = path.resolve(repoRoot);
  outputRoot = path.resolve(outputRoot);
  if (mode !== 'preview' && mode !== 'formal') fail('mode must be preview or formal');
  if (outputRoot === path.join(repoRoot, 'dist')) fail('W01 output may not overwrite the production dist directory');

  const inputRoot = path.join(repoRoot, 'content', 'w01');
  const sourceRoot = path.join(inputRoot, 'source');
  const lockBytes = await readRequired(repoRoot, 'source.lock.json');
  const sourceManifestBytes = await readRequired(sourceRoot, 'source-manifest.json');
  const technicalBytes = await readRequired(sourceRoot, 'technical.json');
  const gameChangesBytes = await readRequired(sourceRoot, 'game-changes.json');
  const webAuthoringBytes = await readRequired(inputRoot, 'web-authoring.json');
  const lock = parseJson(lockBytes, 'source.lock.json');
  const sourceManifest = parseJson(sourceManifestBytes, 'source-manifest.json');
  const technical = parseJson(technicalBytes, 'technical.json');
  const sourceGameChanges = parseJson(gameChangesBytes, 'game-changes.json');
  const webAuthoring = parseJson(webAuthoringBytes, 'web-authoring.json');

  if (sha256(jsonBytes(sourceManifest)) !== lock.manifestSha256) fail('source manifest hash does not match source.lock.json');
  for (const name of SOURCE_ARTIFACTS) {
    const bytes = name === 'technical.json' ? technicalBytes : gameChangesBytes;
    verifyFilePin(sourceManifest, name, bytes, name);
  }
  validateSourceInput(lock, sourceManifest, technical, sourceGameChanges, webAuthoring);

  if (mode === 'formal') fail('formal publication is blocked: the pinned Source and Web authoring are fixture-only or pending; W01 is a preview compiler');
  if (sourceManifest.publicationEligible !== true || technical.publicationEligible !== true ||
      sourceManifest.fixtureOnly || technical.fixtureOnly || webAuthoring.fixtureOnly ||
      technical.records.some(record => record.reviewState !== 'approved') ||
      webAuthoring.records.some(record => record.reviewState !== 'approved') ||
      webAuthoring.announcements.some(record => record.reviewState !== 'approved')) {
    // The POC deliberately stays publication-ineligible, even when some source rows are approved.
  }

  requireArray(technical.records, 'technical.json records');
  requireArray(technical.sourceRefs, 'technical.json sourceRefs');
  const sourceRecords = technical.records.map((record, index) => {
    const label = 'Source record[' + index + ']';
    validateRecordEnvelope(record, label, 'source');
    if (record.gameReleaseId !== lock.gameReleaseId || !(record.kind in SOURCE_KIND_DOMAIN)) fail(label + ' has an unsupported source kind or release');
    validateSourcePayload(record.kind, record.payload, label + '.payload');
    return record;
  });
  const sourceRefs = validateSourceReferenceClosure(sourceRecords, technical.sourceRefs);
  const sourceIds = new Set();
  const sourceKindById = new Map();
  for (const record of sourceRecords) {
    if (sourceIds.has(record.recordId)) fail('duplicate Source recordId ' + record.recordId);
    sourceIds.add(record.recordId);
    sourceKindById.set(record.recordId, record.kind);
  }
  const webInput = validateWebAuthoring(webAuthoring, sourceIds, sourceKindById, sourceRefs, lock.gameReleaseId);

  const baseRecords = [...sourceRecords];
  const records = [...baseRecords, ...webInput.records];
  const recordIds = new Set();
  const kindById = new Map();
  for (const record of records) {
    if (recordIds.has(record.recordId)) fail('duplicate shared recordId ' + record.recordId);
    recordIds.add(record.recordId);
    kindById.set(record.recordId, record.kind);
    if (record.reviewState !== 'approved') continue;
  }

  const domainRecords = Object.fromEntries(DOMAIN_KINDS.map(kind => [kind, []]));
  for (const record of sourceRecords) domainRecords[SOURCE_KIND_DOMAIN[record.kind]].push(record);
  for (const record of webInput.records) {
    const targetKind = record.kind === 'presentation' ? sourceKindById.get(record.entityRef) : 'term';
    const domain = targetKind === 'skill' ? 'skills' : targetKind === 'blessing' ? 'blessings' : targetKind === 'weapon' ? 'weapons' : 'terms';
    domainRecords[domain].push(record);
  }
  const gameChangeRecords = sourceGameChanges.changes.map((change, index) => {
    const label = 'Source game change[' + index + ']';
    assertExactKeys(change, ['changeId', 'owner', 'gameReleaseId', 'entityKind', 'recordId', 'operation', 'comparison', 'changedFields', 'evidenceRefs', 'verificationMethod', 'reviewState'], label);
    if (change.owner !== 'source' || change.gameReleaseId !== lock.gameReleaseId || !RECORD_STATES.has(change.reviewState)) fail(label + ' violates the Source game-change contract');
    requireString(change.changeId, label + '.changeId');
    requireString(change.entityKind, label + '.entityKind');
    requireString(change.recordId, label + '.recordId');
    requireString(change.operation, label + '.operation');
    requireString(change.verificationMethod, label + '.verificationMethod');
    requireRefList(change.evidenceRefs, label + '.evidenceRefs');
    if (!Array.isArray(change.changedFields)) fail(label + '.changedFields must be an array');
    for (const [fieldIndex, field] of change.changedFields.entries()) {
      assertExactKeys(field, ['field', 'before', 'after'], label + '.changedFields[' + fieldIndex + ']');
      requireString(field.field, label + '.changedFields[' + fieldIndex + '].field');
    }
    return {
      recordId: change.changeId,
      owner: 'source',
      kind: 'game-change',
      gameReleaseId: change.gameReleaseId,
      payload: {
        changeId: change.changeId,
        entityKind: change.entityKind,
        targetRef: change.recordId,
        operation: change.operation,
        comparison: change.comparison,
        changedFields: change.changedFields,
        evidenceRefs: change.evidenceRefs,
        verificationMethod: change.verificationMethod
      },
      sourceRefs: [],
      reviewState: change.reviewState
    };
  });
  domainRecords['game-changes'].push(...gameChangeRecords);

  const allSharedRecords = [...records, ...gameChangeRecords];
  for (const change of gameChangeRecords) {
    if (recordIds.has(change.recordId)) fail('duplicate game-change recordId ' + change.recordId);
    recordIds.add(change.recordId);
    kindById.set(change.recordId, change.kind);
  }
  validateDomainReferences(allSharedRecords, kindById);

  const fixtureOnly = sourceManifest.fixtureOnly || technical.fixtureOnly || webAuthoring.fixtureOnly;
  const publicationEligible = false;
  const authoringCommit = currentCommit(repoRoot);
  const sourceDomains = Object.fromEntries(DOMAIN_KINDS.map(kind => [kind, {
    schemaVersion: '2.0.0',
    gameReleaseId: lock.gameReleaseId,
    gameVersion: lock.gameVersion,
    sourceRevision: lock.sourceRevision,
    fixtureOnly,
    publicationEligible,
    records: domainRecords[kind].sort((left, right) => compareUtf8(left.recordId, right.recordId))
  }]));
  const domainBytes = new Map(DOMAIN_KINDS.map(kind => [kind + '.json', jsonBytes(sourceDomains[kind])]));
  const dataRevision = hashNamedFiles(new Map([
    ['source.lock.json', jsonBytes(lock)],
    ['source/references.json', jsonBytes(sourceRefs)],
    ['web/references.json', jsonBytes(webInput.references)],
    ['web/authoring-commit.txt', Buffer.from(authoringCommit + '\n')],
    ...domainBytes
  ]));
  const fileRows = DOMAIN_KINDS.map(kind => {
    const name = kind + '.json';
    const bytes = domainBytes.get(name);
    return { kind, path: name, sizeBytes: bytes.byteLength, sha256: sha256(bytes), dependencies: DOMAIN_DEPENDENCIES[kind] };
  });
  const manifest = {
    schemaVersion: '2.0.0',
    gameReleaseId: lock.gameReleaseId,
    gameVersion: lock.gameVersion,
    contentVersion: '0.0.1',
    dataRevision,
    fixtureOnly,
    publicationEligible,
    source: {
      owner: 'source',
      repository: lock.repository,
      commit: lock.commit,
      sourceRevision: lock.sourceRevision,
      manifestSha256: lock.manifestSha256,
      references: sourceRefs
    },
    web: {
      owner: 'web',
      authoringCommit,
      compilerCommit: authoringCommit,
      references: webInput.references
    },
    compatibility: {
      dataContractMajor: 2,
      requiredFeatures: ['official-errata-details-v1'],
      gameSnapshotRefs: sourceRefs.map(reference => reference.sourceId)
    },
    files: fileRows,
    changeIndexPath: 'game-changes.json'
  };
  const manifestBytes = jsonBytes(manifest);
  const manifestSha256 = sha256(manifestBytes);
  const manifestPath = 'data/' + dataRevision + '/manifest.json';
  const versionManifestPath = '/' + manifestPath;
  const release = {
    game_version: lock.gameVersion,
    content_version: '0.0.1',
    data_revision: dataRevision,
    manifest_path: versionManifestPath,
    manifest_sha256: manifestSha256
  };
  const versionWithoutBuildId = {
    schema_version: 2,
    data_revision: dataRevision,
    build_id: '',
    game_version: lock.gameVersion,
    package_kind: 'fixture',
    game_releases: [release]
  };
  const previewBytes = jsonBytes({ fixtureOnly, publicationEligible, announcements: webInput.announcements });
  const baseFiles = new Map([
    ['index.html', Buffer.from(previewAssets.html, 'utf8')],
    ['preview.css', Buffer.from(previewAssets.css, 'utf8')],
    ['preview.js', Buffer.from(previewAssets.js, 'utf8')],
    ['preview.json', previewBytes],
    ['robots.txt', Buffer.from('User-agent: *\nDisallow: /\n', 'utf8')],
    ['version-template.json', jsonBytes(versionWithoutBuildId)],
    [manifestPath, manifestBytes],
    ...[...domainBytes].map(([name, bytes]) => ['data/' + dataRevision + '/' + name, bytes])
  ]);
  const buildId = hashNamedFiles(baseFiles);
  const version = { ...versionWithoutBuildId, build_id: buildId };
  const versionBytes = jsonBytes(version);
  const outputFiles = new Map(baseFiles);
  outputFiles.delete('version-template.json');
  addOutput(outputFiles, 'version.json', versionBytes);
  const previousOutput = await readPreviousOutput(outputRoot);
  for (const [name, previousFile] of previousOutput.dataFiles) {
    const currentBytes = outputFiles.get(name);
    if (currentBytes && !currentBytes.equals(previousFile.bytes)) fail('new W01 build conflicts with an existing immutable data URL: ' + name);
    if (!currentBytes) addOutput(outputFiles, name, previousFile.bytes);
  }
  const receiptFileRows = [...outputFiles].map(([name, bytes]) => ({ path: name, sizeBytes: bytes.byteLength, sha256: sha256(bytes) }))
    .sort((left, right) => compareUtf8(left.path, right.path));
  const receipt = {
    schemaVersion: '1.0.0',
    requestKind: 'isolated-w01-preview-build',
    buildId,
    dataRevision,
    manifestPath,
    manifestSha256,
    source: { repository: lock.repository, commit: lock.commit, sourceRevision: lock.sourceRevision, manifestSha256: lock.manifestSha256 },
    web: { authoringCommit },
    fixtureOnly,
    publicationEligible,
    formalPublishAllowed: false,
    deploymentPerformed: false,
    files: receiptFileRows,
    ...(previousOutput.retainedData ? { retainedData: previousOutput.retainedData } : {})
  };

  await writeOutputs(outputRoot, outputFiles, receipt, previousOutput);
  const result = { buildId, dataRevision, manifestSha256, manifestPath, outputRoot, receipt };
  return result;
}

export async function assertExactOutputInventory(outputRoot, fileRows) {
  const expectedOutputPaths = new Set([...fileRows.map(entry => entry.path), 'receipt.json']);
  if (expectedOutputPaths.size !== fileRows.length + 1) fail('W01 receipt contains duplicate output paths');
  const seenOutputPaths = new Set();
  for (const relativeName of await readdir(outputRoot, { recursive: true })) {
    const absolute = path.join(outputRoot, relativeName);
    const fileInfo = await lstat(absolute);
    if (fileInfo.isSymbolicLink()) fail('W01 output may not contain symbolic links: ' + relativeName);
    if (!fileInfo.isFile()) continue;
    const normalizedName = relativeName.replaceAll(path.sep, '/');
    if (!expectedOutputPaths.has(normalizedName)) fail('W01 output contains an unlisted file: ' + normalizedName);
    seenOutputPaths.add(normalizedName);
  }
  if (seenOutputPaths.size !== expectedOutputPaths.size) fail('W01 output is missing a receipt-listed file');
}

export async function verifyW01Package(outputRoot = path.join(SCRIPT_ROOT, 'dist-w01')) {
  outputRoot = path.resolve(outputRoot);
  const receiptBytes = await readFile(path.join(outputRoot, 'receipt.json'));
  const receipt = parseJson(receiptBytes, 'W01 receipt.json');
  assertExactKeys(receipt, ['schemaVersion', 'requestKind', 'buildId', 'dataRevision', 'manifestPath', 'manifestSha256', 'source', 'web', 'fixtureOnly', 'publicationEligible', 'formalPublishAllowed', 'deploymentPerformed', 'files', 'retainedData'], 'W01 receipt');
  if (receipt.requestKind !== 'isolated-w01-preview-build' || receipt.fixtureOnly !== true || receipt.publicationEligible !== false ||
      receipt.formalPublishAllowed !== false || receipt.deploymentPerformed !== false) fail('W01 receipt is not a quarantined preview build');
  const retainedManifest = parseJson(await readFile(path.join(SCRIPT_ROOT, 'docs', 'w01', 'retained-preview-manifest.json')), 'retained preview manifest');
  assertExactKeys(retainedManifest, ['schemaVersion', 'baselineCommit', 'dataRevision', 'fileCount', 'totalBytes', 'files'], 'retained preview manifest');
  assertExactKeys(receipt.retainedData, ['baselineCommit', 'dataRevision', 'fileCount', 'totalBytes', 'inventorySha256'], 'W01 retainedData receipt');
  const retainedRows = receipt.files.filter(entry => entry.path.startsWith('data/' + retainedManifest.dataRevision + '/'));
  const expectedRows = [...retainedManifest.files].sort((left, right) => compareUtf8(left.path, right.path));
  const actualRows = [...retainedRows].sort((left, right) => compareUtf8(left.path, right.path));
  if (retainedManifest.schemaVersion !== '1.0.0' || retainedManifest.baselineCommit !== '8a4b3db2b1e835f0757f387ca89a19b9092b35ee' ||
      retainedManifest.dataRevision !== '0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b' ||
      retainedManifest.fileCount !== 2277 || retainedManifest.totalBytes !== 9709542 ||
      receipt.retainedData.baselineCommit !== retainedManifest.baselineCommit ||
      receipt.retainedData.dataRevision !== retainedManifest.dataRevision ||
      receipt.retainedData.fileCount !== retainedManifest.fileCount ||
      receipt.retainedData.totalBytes !== retainedManifest.totalBytes ||
      receipt.retainedData.inventorySha256 !== sha256(jsonBytes(retainedManifest)) ||
      JSON.stringify(actualRows) !== JSON.stringify(expectedRows)) {
    fail('W01 receipt does not retain the exact pinned predeployment data inventory');
  }
  for (const entry of receipt.files) {
    assertExactKeys(entry, ['path', 'sizeBytes', 'sha256'], 'W01 receipt file row');
    const bytes = await readRequired(outputRoot, entry.path);
    const fileInfo = await lstat(assertChildPath(outputRoot, path.join(outputRoot, ...safeRelativePath(entry.path).split('/')), 'receipt file'));
    if (bytes.byteLength !== entry.sizeBytes || fileInfo.size !== entry.sizeBytes || sha256(bytes) !== entry.sha256) {
      fail('W01 output file does not match receipt: ' + entry.path);
    }
  }
  await assertExactOutputInventory(outputRoot, receipt.files);

  const version = parseJson(await readFile(path.join(outputRoot, 'version.json')), 'version.json');
  if (version.schema_version !== 2 || version.build_id !== receipt.buildId || version.data_revision !== receipt.dataRevision ||
      version.package_kind !== 'fixture' || !Array.isArray(version.game_releases) || version.game_releases.length !== 1) {
    fail('W01 version.json does not match the quarantined build receipt or D v2 contract');
  }
  const manifestBytes = await readFile(path.join(outputRoot, ...safeRelativePath(receipt.manifestPath).split('/')));
  if (sha256(manifestBytes) !== receipt.manifestSha256) fail('W01 manifest hash does not match the build receipt');
  const manifest = parseJson(manifestBytes, 'W01 manifest');
  const release = version.game_releases[0];
  if (release.data_revision !== receipt.dataRevision || release.content_version !== '0.0.1' ||
      release.manifest_path !== '/' + receipt.manifestPath || release.manifest_sha256 !== receipt.manifestSha256 ||
      release.game_version !== manifest.gameVersion) fail('W01 game_releases entry does not match the D v2 manifest contract');
  if (manifest.schemaVersion !== '2.0.0' || manifest.compatibility?.dataContractMajor !== 2 ||
      JSON.stringify(manifest.compatibility?.requiredFeatures) !== JSON.stringify(['official-errata-details-v1']) ||
      manifest.changeIndexPath !== 'game-changes.json' || manifest.fixtureOnly !== true || manifest.publicationEligible !== false ||
      manifest.files.length !== 5 || manifest.files.some((file, index) => file.kind !== DOMAIN_KINDS[index] || file.path !== file.kind + '.json')) {
    fail('W01 package does not match the D v2 contract or exact five quarantined shared domains');
  }
  return { buildId: receipt.buildId, dataRevision: receipt.dataRevision, fileCount: receipt.files.length, fixtureOnly: true };
}

function parseCliArgs(args) {
  const options = { mode: 'preview', outputRoot: path.join(SCRIPT_ROOT, 'dist-w01') };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--formal' && !seen.has(arg)) {
      seen.add(arg);
      options.mode = 'formal';
    } else if (arg === '--output' && !seen.has(arg) && args[index + 1]) {
      seen.add(arg);
      options.outputRoot = path.resolve(args[++index]);
    } else {
      fail('Usage: node scripts/w01-build.mjs [--formal] [--output path]');
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildW01(parseCliArgs(process.argv.slice(2)));
    process.stdout.write('Built isolated W01 fixture preview build_id=' + result.buildId + ' data_revision=' + result.dataRevision + ' output=' + result.outputRoot + '\n');
  } catch (error) {
    process.stderr.write('W01 preview build failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = error?.message?.startsWith('Usage:') ? 2 : 1;
  }
}
