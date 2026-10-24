import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WEB_AUTHORING_SCHEMA_ID = 'urn:darktide-web:web-authoring:2.0.0';
export const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
export const SOURCE_SCHEMA_ID = SOURCE_REPOSITORY + '/content/schema/v2/source-contract.schema.json';
export const PRESENTATION_KINDS = Object.freeze(['skill', 'blessing', 'weapon', 'catalog', 'curio', 'perk', 'classification']);
export const DETAIL_SECTION_ORDER = Object.freeze(['effects', 'conditions', 'calculation', 'notes', 'extra']);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_FILES = Object.freeze({
  schema: 'content/schema/v2/source-contract.schema.json',
  fixture: 'content/fixtures/v2/representative-source.json',
  validator: 'scripts/content/contract-validator.mjs',
});
const OFFICIAL_INPUT_PATH = 'content/fixtures/v2/web-authoring/official-inputs.json';
const WEB_FIXTURE_PATH = 'content/fixtures/v2/web-authoring/representative.json';
const SOURCE_LOCK_PATH = 'content/contracts/source-v2.lock.json';
const WEB_LOCK_PATH = 'content/contracts/web-authoring.lock.json';
const W06_SOURCE_LOCK_PATH = 'content/contracts/w06/source-v2.lock.json';
const W06_WEB_LOCK_PATH = 'content/contracts/w06/web-authoring.lock.json';
const W06_AUTHORING_PATH = 'content/authoring/v2/w06-skills-blessings.json';
const W06_OFFICIAL_INPUT_PATH = 'content/contracts/w06/official-inputs.json';
const W06_TERM_RULES_PATH = 'content/terms/w06-rules.json';
const W06_TERM_SOURCE = Object.freeze({
  commit: '241ad76ce62330472aa423055a5b85db59bb6c0d',
  path: 'Referneces/Translation.md',
  fileSha256: 'fb60e9e8b7beb81765ca50acb3483b9a10e3148e82f630bdf43878a8e45543a0',
});
const W07_SOURCE_LOCK_PATH = 'content/contracts/w07/source-v2.lock.json';
const W07_WEB_LOCK_PATH = 'content/contracts/w07/web-authoring.lock.json';
const W07_AUTHORING_PATH = 'content/authoring/v2/w07-weapons.json';
const W07_OFFICIAL_INPUT_PATH = 'content/contracts/w07/official-inputs.json';
const W07_BASELINE_PATH = 'content/contracts/w07/baseline/w01-web-authoring.json';
const W07_BASELINE_LOCK_PATH = 'content/contracts/w07/baseline/w01-baseline.lock.json';
const W07_OFFICIAL_INPUT_SHA256 = 'f81406e85643fc0cdcf618d5a092b6dc6379404b0679d9b080a92b77510d504e';
const W07_BASELINE = Object.freeze({
  commit: '829eaee4b66b783463487749500b00f9736aab13',
  path: 'content/w01/web-authoring.json',
  blobOid: 'abd12fff64c1f32c80f59ef6e0d2ecff9cb83593',
  cachePath: W07_BASELINE_PATH,
  sha256: '038cecd27f151943b54b9cd8487de05cf293011e701580f87a9bd62b061d1513',
});
const W07_BASELINE_LOCK = Object.freeze({
  schemaVersion: '1.0.0',
  commit: W07_BASELINE.commit,
  path: W07_BASELINE.path,
  blobOid: W07_BASELINE.blobOid,
  sha256: W07_BASELINE.sha256,
});
const W06_SOURCE_FILES = Object.freeze({
  schema: 'content/schema/v2/source-contract.schema.json',
  data: 'content/authoring/v2/w06-skills-blessings.json',
  validator: 'scripts/content/contract-validator.mjs',
});
const W07_SOURCE_FILES = Object.freeze({
  schema: 'content/schema/v2/source-contract.schema.json',
  data: 'content/authoring/v2/w07-weapons.json',
  validator: 'scripts/content/contract-validator.mjs',
});
const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const compareLexical = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort(compareLexical).map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const sha256 = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value), 'utf8').digest('hex');
const keyOf = ref => String(ref.gameReleaseId) + '\u0000' + String(ref.recordId);
const issue = (issues, at, message, code = 'contract') => issues.push({ path: at || '/', code, message });
const pointerEscape = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');

function pointerGet(value, pointer) {
  if (pointer === '') return { exists: true, value };
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return { exists: false };
  let cursor = value;
  for (const part of pointer.slice(1).split('/').map(piece => piece.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (!cursor || typeof cursor !== 'object' || !hasOwn(cursor, part)) return { exists: false };
    cursor = cursor[part];
  }
  return { exists: true, value: cursor };
}

function pointerResolve(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let cursor = root;
  for (const part of ref.slice(2).split('/').map(piece => piece.replaceAll('~1', '/').replaceAll('~0', '~'))) cursor = cursor?.[part];
  return cursor;
}

function validateSchemaValue(value, fragment, root, at, issues, depth = 0) {
  if (depth > 80) return issue(issues, at, 'schema recursion limit exceeded', 'schema-depth');
  if (fragment === true || fragment == null) return;
  if (fragment === false) return issue(issues, at, 'value is forbidden by schema', 'schema-false');
  if (!isObject(fragment)) return issue(issues, at, 'schema node is not an object', 'schema-shape');
  if (fragment.$ref) {
    const target = pointerResolve(root, fragment.$ref);
    if (!target) issue(issues, at, 'unresolved schema reference: ' + fragment.$ref, 'schema-ref');
    else validateSchemaValue(value, target, root, at, issues, depth + 1);
  }
  if (Array.isArray(fragment.allOf)) for (const part of fragment.allOf) validateSchemaValue(value, part, root, at, issues, depth + 1);
  if (Array.isArray(fragment.oneOf)) {
    const matches = fragment.oneOf.filter(part => {
      const branchIssues = [];
      validateSchemaValue(value, part, root, at, branchIssues, depth + 1);
      return branchIssues.length === 0;
    }).length;
    if (matches !== 1) issue(issues, at, 'value must match exactly one oneOf branch', 'schema-oneOf');
  }
  if (Array.isArray(fragment.anyOf)) {
    const matches = fragment.anyOf.some(part => {
      const branchIssues = [];
      validateSchemaValue(value, part, root, at, branchIssues, depth + 1);
      return branchIssues.length === 0;
    });
    if (!matches) issue(issues, at, 'value must match at least one anyOf branch', 'schema-anyOf');
  }
  if (fragment.not) {
    const forbidden = [];
    validateSchemaValue(value, fragment.not, root, at, forbidden, depth + 1);
    if (forbidden.length === 0) issue(issues, at, 'value matches a forbidden schema', 'schema-not');
  }
  if (fragment.if) {
    const conditionIssues = [];
    validateSchemaValue(value, fragment.if, root, at, conditionIssues, depth + 1);
    const branch = conditionIssues.length === 0 ? fragment.then : fragment.else;
    if (branch) validateSchemaValue(value, branch, root, at, issues, depth + 1);
  }
  if (fragment.const !== undefined && canonical(value) !== canonical(fragment.const)) issue(issues, at, 'value differs from required constant', 'schema-const');
  if (Array.isArray(fragment.enum) && !fragment.enum.some(item => canonical(item) === canonical(value))) issue(issues, at, 'value is not in the allowed set', 'schema-enum');
  if (fragment.type) {
    const types = { object: isObject(value), array: Array.isArray(value), string: typeof value === 'string', integer: Number.isInteger(value), number: typeof value === 'number' && Number.isFinite(value), boolean: typeof value === 'boolean', null: value === null };
    const wanted = Array.isArray(fragment.type) ? fragment.type : [fragment.type];
    if (!wanted.some(type => types[type] === true)) {
      issue(issues, at, 'value has the wrong JSON type', 'schema-type');
      return;
    }
  }
  if (typeof value === 'string') {
    if (fragment.minLength !== undefined && [...value].length < fragment.minLength) issue(issues, at, 'string is shorter than minLength', 'schema-minLength');
    if (fragment.maxLength !== undefined && [...value].length > fragment.maxLength) issue(issues, at, 'string exceeds maxLength', 'schema-maxLength');
    if (fragment.pattern && !new RegExp(fragment.pattern, 'u').test(value)) issue(issues, at, 'string does not match pattern', 'schema-pattern');
    if (fragment.format === 'uri') {
      try { new URL(value); } catch { issue(issues, at, 'string is not a URI', 'schema-format'); }
    }
  }
  if (typeof value === 'number') {
    if (fragment.minimum !== undefined && value < fragment.minimum) issue(issues, at, 'number is less than minimum', 'schema-minimum');
    if (fragment.maximum !== undefined && value > fragment.maximum) issue(issues, at, 'number is greater than maximum', 'schema-maximum');
  }
  if (Array.isArray(value)) {
    if (fragment.minItems !== undefined && value.length < fragment.minItems) issue(issues, at, 'array has fewer than minItems', 'schema-minItems');
    if (fragment.maxItems !== undefined && value.length > fragment.maxItems) issue(issues, at, 'array has more than maxItems', 'schema-maxItems');
    if (fragment.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const encoded = canonical(item);
        if (seen.has(encoded)) { issue(issues, at, 'array items are not unique', 'schema-uniqueItems'); break; }
        seen.add(encoded);
      }
    }
    if (fragment.items) value.forEach((item, index) => validateSchemaValue(item, fragment.items, root, at + '/' + index, issues, depth + 1));
  }
  if (isObject(value)) {
    for (const required of fragment.required ?? []) if (!hasOwn(value, required)) issue(issues, at + '/' + pointerEscape(required), 'required property is missing', 'schema-required');
    for (const [name, child] of Object.entries(value)) {
      if (fragment.properties && hasOwn(fragment.properties, name)) validateSchemaValue(child, fragment.properties[name], root, at + '/' + pointerEscape(name), issues, depth + 1);
      else if (fragment.additionalProperties === false) issue(issues, at + '/' + pointerEscape(name), 'unexpected property', 'schema-additionalProperties');
      else if (isObject(fragment.additionalProperties)) validateSchemaValue(child, fragment.additionalProperties, root, at + '/' + pointerEscape(name), issues, depth + 1);
    }
  }
}

export function assertWebAuthoringSchemaParity(schema) {
  const errors = [];
  if (schema?.$schema !== 'https://json-schema.org/draft/2020-12/schema') errors.push('schema must declare JSON Schema 2020-12');
  if (schema?.$id !== WEB_AUTHORING_SCHEMA_ID) errors.push('schema id differs from the authoring validator');
  const contract = schema?.$defs?.contract;
  if (!contract || contract.properties?.contractKind?.const !== 'web-authoring' || contract.properties?.publicationEligible?.const !== false) errors.push('schema contract root does not match the non-publishable Web authoring contract');
  if (contract?.additionalProperties !== false) errors.push('schema contract root must reject unowned fields');
  if (canonical(schema?.$defs?.detailSection?.properties?.sectionId?.enum ?? []) !== canonical(DETAIL_SECTION_ORDER)) errors.push('schema detail section order vocabulary differs from the validator');
  const detailSections = schema?.$defs?.presentation?.properties?.detailSections;
  if (detailSections?.maxItems !== DETAIL_SECTION_ORDER.length || hasOwn(detailSections ?? {}, 'minItems')) errors.push('schema detail sections must permit an ordered subset of the fixed section vocabulary');
  for (const kind of ['list', 'table', 'image', 'spoiler']) {
    const blockSchema = schema?.$defs?.announcementBlock?.oneOf?.find(branch => branch.properties?.kind?.const === kind);
    if (!blockSchema) errors.push('schema announcement blocks omit the ' + kind + ' occurrence type');
  }
  const kinds = schema?.$defs?.presentationEntityRef?.properties?.kind?.enum ?? [];
  if (canonical([...kinds].sort(compareLexical)) !== canonical([...PRESENTATION_KINDS].sort(compareLexical))) errors.push('schema presentation kinds differ from the validated owner set');
  if (!schema?.$defs?.weaponView || schema?.$defs?.presentation?.properties?.weaponView?.$ref !== '#/$defs/weaponView') errors.push('schema presentation weaponView must use the typed Source-reference model');
  if (schema?.$defs?.officialInputSnapshot?.additionalProperties !== false) errors.push('official input snapshot must be closed');
  if (errors.length) throw new Error('Web schema/validator parity failure: ' + errors.join('; '));
  return true;
}

async function readJson(root, relativePath) {
  const bytes = await readFile(path.join(root, relativePath));
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(relativePath + ' contains invalid UTF-8 byte sequence'); }
  try { return { bytes, value: JSON.parse(text) }; }
  catch (error) { throw new Error(relativePath + ' is not valid UTF-8 JSON: ' + error.message); }
}

function requireSha(value, label) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) throw new Error(label + ' must be a lowercase SHA-256');
}

function expectedSourcePin(lock, mode = 'fixture') {
  const isFixture = mode === 'fixture';
  return {
    repository: lock.repository,
    commit: lock.commit,
    schemaId: lock.schemaId,
    schemaSha256: lock.files.schema.sha256,
    [isFixture ? 'fixtureSha256' : 'dataSha256']: lock.files[isFixture ? 'fixture' : 'data'].sha256,
    validatorSha256: lock.files.validator.sha256,
  };
}

async function loadSourceContract({ repoRoot, snapshotRoot, sourceRoot, mode = 'fixture' }) {
  const isFixture = mode === 'fixture';
  const isW06 = mode === 'w06';
  const isW07 = mode === 'w07';
  const lockPath = isW06 ? W06_SOURCE_LOCK_PATH : isW07 ? W07_SOURCE_LOCK_PATH : SOURCE_LOCK_PATH;
  const files = isW06 ? W06_SOURCE_FILES : isW07 ? W07_SOURCE_FILES : SOURCE_FILES;
  const dataKey = isFixture ? 'fixture' : 'data';
  const lock = (await readJson(repoRoot, lockPath)).value;
  if (!isObject(lock) || lock.schemaVersion !== '1.0.0' || lock.repository !== SOURCE_REPOSITORY || lock.schemaId !== SOURCE_SCHEMA_ID || !COMMIT_RE.test(lock.commit ?? '')) {
    throw new Error('pinned Source contract lock has an invalid identity');
  }
  for (const name of Object.keys(files)) {
    const entry = lock.files?.[name];
    if (!isObject(entry) || entry.path !== files[name]) throw new Error('pinned Source contract lock has an unexpected ' + name + ' path');
    requireSha(entry.sha256, 'pinned Source ' + name + ' hash');
  }
  const sourceBytes = {};
  for (const [name, relativePath] of Object.entries(files)) {
    const bytes = await readFile(path.join(snapshotRoot, relativePath));
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== lock.files[name].sha256) throw new Error('pinned Source snapshot hash mismatch: ' + relativePath);
    sourceBytes[name] = bytes;
  }
  let actualCommit = null;
  if (sourceRoot) {
    const actualRoot = await realpath(sourceRoot);
    try { actualCommit = execFileSync('git', ['-C', actualRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
    catch (error) { throw new Error('cannot read Source checkout commit: ' + error.message); }
    if (actualCommit !== lock.commit) throw new Error('Source checkout commit differs from the pinned Source lock');
    for (const [name, relativePath] of Object.entries(files)) {
      const bytes = !isFixture
        ? execFileSync('git', ['-C', actualRoot, 'show', lock.commit + ':' + relativePath], { encoding: null })
        : await readFile(path.join(actualRoot, relativePath));
      if (createHash('sha256').update(bytes).digest('hex') !== lock.files[name].sha256) {
        throw new Error('Source checkout differs from pinned bytes: ' + relativePath);
      }
    }
  }
  const schema = JSON.parse(sourceBytes.schema.toString('utf8'));
  const sourceContract = JSON.parse(sourceBytes[dataKey].toString('utf8'));
  const sourceValidator = await import(pathToFileURL(path.join(snapshotRoot, files.validator)).href);
  if (sourceValidator.CONTRACT_SCHEMA_ID !== lock.schemaId) throw new Error('Source validator schema id differs from the lock');
  sourceValidator.assertSchemaValidatorParity(schema);
  const sourceValidation = sourceValidator.validateSourceContract(sourceContract, { schema });
  if (!sourceValidation.valid) throw new Error('pinned Source representative fixture is invalid: ' + sourceValidation.issues.map(item => item.message).join('; '));
  if (sourceContract.fixtureOnly !== isFixture || sourceContract.publicationEligible !== false) {
    throw new Error(isFixture ? 'pinned Source fixture must remain synthetic and non-publishable' : 'pinned Source data must remain non-fixture and non-publishable');
  }
  return {
    sourceLock: lock, sourceContract, sourceSchema: schema, sourceValidator, sourceValidation,
    sourceCheck: { matchesPinnedSnapshot: sourceRoot ? true : null, commit: actualCommit },
  };
}

export async function loadWebAuthoringInputs({ repoRoot = REPO_ROOT, sourceSnapshotRoot, sourceRoot, mode = 'fixture' } = {}) {
  if (!['fixture', 'w06', 'w07'].includes(mode)) throw new Error('Web authoring mode must be fixture, w06, or w07');
  const isW06 = mode === 'w06';
  const isW07 = mode === 'w07';
  const absoluteRoot = await realpath(repoRoot);
  const snapshotRoot = sourceSnapshotRoot
    ? await realpath(sourceSnapshotRoot)
    : path.join(absoluteRoot, isW06 ? 'content/contracts/w06/source-v2-snapshot' : isW07 ? 'content/contracts/w07/source-v2-snapshot' : 'content/contracts/source-v2-snapshot');
  const authoringPath = isW06 ? W06_AUTHORING_PATH : isW07 ? W07_AUTHORING_PATH : WEB_FIXTURE_PATH;
  const officialPath = isW06 ? W06_OFFICIAL_INPUT_PATH : isW07 ? W07_OFFICIAL_INPUT_PATH : OFFICIAL_INPUT_PATH;
  const webLockPath = isW06 ? W06_WEB_LOCK_PATH : isW07 ? W07_WEB_LOCK_PATH : WEB_LOCK_PATH;
  const [schemaFile, authoringFile, officialFile, webLockFile, sourceInfo, termRulesFile, baselineFile, baselineLockFile] = await Promise.all([
    readJson(absoluteRoot, 'content/schema/v2/web-authoring.schema.json'),
    readJson(absoluteRoot, authoringPath),
    readJson(absoluteRoot, officialPath),
    readJson(absoluteRoot, webLockPath),
    loadSourceContract({ repoRoot: absoluteRoot, snapshotRoot, sourceRoot, mode }),
    isW06 ? readJson(absoluteRoot, W06_TERM_RULES_PATH) : Promise.resolve(null),
    isW07 ? readJson(absoluteRoot, W07_BASELINE_PATH) : Promise.resolve(null),
    isW07 ? readJson(absoluteRoot, W07_BASELINE_LOCK_PATH) : Promise.resolve(null),
  ]);
  const schema = schemaFile.value;
  assertWebAuthoringSchemaParity(schema);
  const webLock = webLockFile.value;
  const authoringLock = webLock;
  if (!isObject(webLock) || webLock.schemaVersion !== '1.0.0'
    || authoringLock?.officialInputs?.path !== officialPath
    || (isW06 && (authoringLock?.authoring?.path !== W06_AUTHORING_PATH || authoringLock?.termRules?.path !== W06_TERM_RULES_PATH))
    || (isW07 && (authoringLock?.authoring?.path !== W07_AUTHORING_PATH || canonical(authoringLock?.baseline) !== canonical(W07_BASELINE)))) {
    throw new Error('Web authoring lock has an invalid official-input identity');
  }
  if (isW07 && authoringLock.officialInputs.sha256 !== W07_OFFICIAL_INPUT_SHA256) {
    throw new Error('W07 official input hash differs from the fixed reviewed snapshot');
  }
  requireSha(authoringLock.officialInputs.sha256, 'pinned official-input hash');
  const actualOfficialHash = createHash('sha256').update(officialFile.bytes).digest('hex');
  if (actualOfficialHash !== authoringLock.officialInputs.sha256) throw new Error('pinned official input snapshot hash mismatch');
  if (isW06) {
    requireSha(authoringLock.authoring.sha256, 'pinned W06 authoring hash');
    if (createHash('sha256').update(authoringFile.bytes).digest('hex') !== authoringLock.authoring.sha256) throw new Error('pinned W06 authoring hash mismatch');
    requireSha(authoringLock.termRules.sha256, 'pinned W06 term-rules hash');
    if (createHash('sha256').update(termRulesFile.bytes).digest('hex') !== authoringLock.termRules.sha256) throw new Error('pinned W06 term-rules hash mismatch');
  }
  if (isW07) {
    requireSha(authoringLock.authoring.sha256, 'pinned W07 authoring hash');
    if (createHash('sha256').update(authoringFile.bytes).digest('hex') !== authoringLock.authoring.sha256) throw new Error('pinned W07 authoring hash mismatch');
    const baselineSha256 = createHash('sha256').update(baselineFile.bytes).digest('hex');
    if (baselineSha256 !== W07_BASELINE.sha256 || baselineFile.value?.schemaVersion !== '1.0.0' || !Array.isArray(baselineFile.value?.records)
      || canonical(baselineLockFile.value) !== canonical(W07_BASELINE_LOCK)) {
      throw new Error('pinned W01 baseline raw-blob cache differs from its fixed identity');
    }
  }
  if (authoringFile.value.officialInputsSha256 !== authoringLock.officialInputs.sha256) throw new Error('authoring officialInputsSha256 differs from the pinned input snapshot');
  const officialIssues = [];
  validateSchemaValue(officialFile.value, schema, schema, '', officialIssues);
  if (officialIssues.length) throw new Error('pinned official input snapshot violates schema: ' + officialIssues.map(item => item.path + ' ' + item.message).join('; '));
  if (officialFile.value.fixtureOnly !== (mode === 'fixture')) throw new Error('official input snapshot fixtureOnly mode differs from the selected authoring mode');
  if (isW06) {
    const rules = termRulesFile.value;
    if (!isObject(rules) || rules.schemaVersion !== '1.0.0' || rules.fixtureOnly !== false || rules.publicationEligible !== false || !Array.isArray(rules.rules)) {
      throw new Error('pinned W06 terminology rules have an invalid non-fixture identity');
    }
    const seenRuleIds = new Set();
    for (const [index, rule] of rules.rules.entries()) {
      if (!isObject(rule) || typeof rule.ruleId !== 'string' || typeof rule.sourceText !== 'string' || typeof rule.targetText !== 'string'
        || !isObject(rule.sourceRef) || typeof rule.sourceRef.commit !== 'string' || typeof rule.sourceRef.path !== 'string'
        || !Number.isInteger(rule.sourceRef.line) || !SHA256_RE.test(rule.sourceRef.fileSha256 ?? '')
        || rule.sourceRef.commit !== W06_TERM_SOURCE.commit || rule.sourceRef.path !== W06_TERM_SOURCE.path
        || rule.sourceRef.fileSha256 !== W06_TERM_SOURCE.fileSha256
        || rule.sourceLine !== '- ' + rule.sourceText + ' - ' + rule.targetText) {
        throw new Error('pinned W06 terminology rule is missing fixed wording provenance at /rules/' + index);
      }
      if (seenRuleIds.has(rule.ruleId)) throw new Error('pinned W06 terminology rule id is duplicated: ' + rule.ruleId);
      seenRuleIds.add(rule.ruleId);
    }
  }
  const sourcePin = expectedSourcePin(sourceInfo.sourceLock, mode);
  if (canonical(authoringFile.value.sourcePin) !== canonical(sourcePin)) throw new Error('authoring Source pin differs from the fixed Source lock');
  return {
    repoRoot: absoluteRoot, mode, schema, authoring: authoringFile.value, officialInputs: officialFile.value, baseline: baselineFile?.value ?? null,
    officialInputsBytes: officialFile.bytes, webLock, sourcePin, termRules: termRulesFile?.value ?? null, ...sourceInfo,
    sourceRecordMap: new Map(sourceInfo.sourceContract.records.map(record => [keyOf(record), record])),
    sourceReleaseMap: new Map(sourceInfo.sourceContract.gameReleases.map(release => [release.gameReleaseId, release])),
  };
}

function textHashMatches(text, digest) {
  return typeof text === 'string' && digest === sha256(text);
}

function uniqueBy(items, keyOfItem, label, issues, at) {
  const seen = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const key = keyOfItem(items[index]);
    if (seen.has(key)) issue(issues, at + '/' + index, 'duplicate ' + label + ': ' + key, 'duplicate-id');
    seen.add(key);
  }
}

function collectRecordRefs(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRecordRefs(item, output);
  } else if (isObject(value)) {
    if (typeof value.recordId === 'string' && typeof value.gameReleaseId === 'string' && typeof value.kind === 'string') output.push(value);
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'recordId' && key !== 'gameReleaseId' && key !== 'kind') collectRecordRefs(child, output);
    }
  }
  return output;
}

function resolveSourceRecord(ref, expectedKind, ownerRelease, inputs, issues, at) {
  const record = inputs.sourceRecordMap.get(keyOf(ref));
  if (!record) {
    issue(issues, at, 'Source record reference is unresolved: ' + ref.gameReleaseId + ':' + ref.recordId, 'dangling-ref');
    return null;
  }
  if (record.kind !== ref.kind || (expectedKind && record.kind !== expectedKind)) {
    issue(issues, at, 'Source record kind does not match the typed reference', 'wrong-kind-ref');
    return null;
  }
  if (ownerRelease && ref.gameReleaseId !== ownerRelease) {
    const compatibility = ref.compatibilityRef;
    const compatibilityRecord = compatibility && inputs.sourceRecordMap.get(keyOf(compatibility));
    if (!compatibilityRecord || compatibility.kind !== 'release-compatibility' || compatibilityRecord.kind !== 'release-compatibility') {
      issue(issues, at, 'cross-release reference requires a typed compatibility record', 'cross-release-ref');
      return null;
    }
    const relation = compatibilityRecord.payload;
    if (compatibility.gameReleaseId !== ownerRelease || relation.fromGameReleaseId !== ref.gameReleaseId || relation.toGameReleaseId !== ownerRelease) {
      issue(issues, at, 'compatibility record does not cover the referenced release pair', 'cross-release-ref');
      return null;
    }
  } else if (ref.compatibilityRef) {
    issue(issues, at, 'same-release reference must not carry compatibility evidence', 'unexpected-compatibility-ref');
    return null;
  }
  return record;
}

function validateOfficialInput(source, inputs, issues, at) {
  const params = new Map(source.params.map(param => [param.parameterId, param]));
  if (params.size !== source.params.length) issue(issues, at + '/params', 'official parameter ids must be unique', 'duplicate-id');
  for (const [index, param] of source.params.entries()) if (param.officialNameRef) {
    const name = param.officialNameRef;
    const nameAt = at + '/params/' + index + '/officialNameRef';
    if (name.sourceLocale !== source.sourceLocale) issue(issues, nameAt + '/sourceLocale', 'embedded official name reference must use the input locale', 'official-name-locale');
    if (name.key === null && !name.sourceHash) issue(issues, nameAt + '/sourceHash', 'an embedded official name without a localization key requires its fixed source hash', 'official-locator');
    if (!textHashMatches(name.text, name.textSha256)) issue(issues, nameAt + '/textSha256', 'embedded official name text hash mismatch', 'hash-mismatch');
  }
  uniqueBy(source.segments, segment => segment.segmentId, 'official segment id', issues, at + '/segments');
  const usedParams = new Set();
  const sourceParts = [];
  const renderedParts = [];
  for (let index = 0; index < source.segments.length; index += 1) {
    const segment = source.segments[index];
    const segmentAt = at + '/segments/' + index;
    const segmentBytes = segment.kind === 'text' ? segment.text : segment.token;
    if (!textHashMatches(segmentBytes, segment.sha256)) issue(issues, segmentAt + '/sha256', 'official segment bytes do not match their hash', 'hash-mismatch');
    if (segment.kind === 'text') {
      sourceParts.push(segment.text);
      renderedParts.push(segment.text);
    } else {
      const parameter = params.get(segment.parameterId);
      if (!parameter) {
        issue(issues, segmentAt + '/parameterId', 'official parameter binding is missing', 'parameter-binding');
        sourceParts.push(segment.token);
        renderedParts.push(segment.token);
      } else {
        usedParams.add(segment.parameterId);
        sourceParts.push(segment.token);
        renderedParts.push(parameter.value);
      }
    }
  }
  for (const param of source.params) if (!usedParams.has(param.parameterId)) issue(issues, at + '/params', 'official parameter has no ordered segment binding: ' + param.parameterId, 'parameter-binding');
  const expectedSourceText = sourceParts.join('');
  const expectedResolvedText = renderedParts.join('');
  if (source.sourceText !== expectedSourceText) issue(issues, at + '/sourceText', 'sourceText differs from ordered official segments', 'source-text');
  if (!textHashMatches(source.sourceText, source.sourceTextSha256)) issue(issues, at + '/sourceTextSha256', 'official sourceText hash mismatch', 'hash-mismatch');
  if (source.resolvedText !== expectedResolvedText) issue(issues, at + '/resolvedText', 'resolvedText differs from bound official parameters', 'parameter-binding');
  if (!textHashMatches(source.resolvedText, source.resolvedTextSha256)) issue(issues, at + '/resolvedTextSha256', 'official resolvedText hash mismatch', 'hash-mismatch');
  resolveSourceRecord(source.entityRef, source.entityRef.kind, source.entityRef.gameReleaseId, inputs, issues, at + '/entityRef');
  if (!inputs.sourceReleaseMap.has(source.entityRef.gameReleaseId)) issue(issues, at + '/entityRef/gameReleaseId', 'official input references an unknown game release', 'unknown-release');
}

function ownerObject(contract, target) {
  const collection = {
    presentation: ['presentations', 'authoringId'],
    'term-localization': ['termLocalizations', 'authoringId'],
    announcement: ['announcements', 'announcementId'],
    'game-change': ['gameChanges', 'changeId'],
    'official-text-change': ['officialTextChanges', 'changeId'],
  }[target.ownerKind];
  if (!collection) return null;
  return contract[collection[0]].find(item => item[collection[1]] === target.ownerId) ?? null;
}

function validateReceiptAndTargetShapes(contract, issues) {
  uniqueBy(contract.reviewTargets, item => item.targetId, 'review target id', issues, '/reviewTargets');
  const targets = new Map(contract.reviewTargets.map(target => [target.targetId, target]));
  const targetScopes = new Set();
  for (const [index, target] of contract.reviewTargets.entries()) {
    const at = '/reviewTargets/' + index;
    const scopeKey = [target.ownerKind, target.ownerId, target.fieldPath, target.dimension].join('\u0000');
    if (targetScopes.has(scopeKey)) issue(issues, at, 'duplicate review target scope for the same owner, field path, and dimension', 'duplicate-review-scope');
    targetScopes.add(scopeKey);
    const owner = ownerObject(contract, target);
    if (!owner) {
      issue(issues, at + '/ownerId', 'review target owner does not exist', 'dangling-owner');
      continue;
    }
    if (!pointerGet(owner, target.fieldPath).exists) issue(issues, at + '/fieldPath', 'review field path does not exist on its owner', 'review-path');
    const allowed = {
      official: target.ownerKind === 'presentation' && (
        target.fieldPath === '/official'
        || target.fieldPath === '/officialLocaleRefs'
        || /^\/tierPresentations\/options\/\d+(?:\/officialLocaleRefs)?$/.test(target.fieldPath)
      ),
      translation: target.ownerKind === 'presentation' && target.fieldPath === '/faithfulTranslation',
      content: (target.ownerKind === 'presentation' && (
        ['/name', '/detailSections', '/errata', '/tierApplicability'].includes(target.fieldPath)
        || /^\/weaponView\/(?:markLabel|attackHeading|comparisonHeading|note)$/.test(target.fieldPath)
        || /^\/weaponView\/statSections\/\d+$/.test(target.fieldPath)
        || /^\/weaponView\/attackProfileRefs\/\d+$/.test(target.fieldPath)
        || /^\/detailSections\/\d+\/items\/\d+(?:\/text|\/parts(?:\/\d+(?:\/text)?)?)?$/.test(target.fieldPath)
        || /^\/tierPresentations\/options\/\d+(?:\/detailSections(?:\/\d+\/items(?:\/\d+(?:\/text|\/parts(?:\/\d+(?:\/text)?)?)?)?)?)?$/.test(target.fieldPath)
        || /^\/errata\/\d+\/text$/.test(target.fieldPath)
      )) || (target.ownerKind === 'term-localization' && ['/label', '/definition'].includes(target.fieldPath))
        || (target.ownerKind === 'game-change' && (target.fieldPath === '/fieldSummaries' || /^\/fieldSummaries\/\d+\/summary$/.test(target.fieldPath))),
      context: (target.ownerKind === 'presentation' && (target.fieldPath === '/tierApplicability' || /^\/errata\/\d+\/context(?:\/description)?$/.test(target.fieldPath)))
        || (target.ownerKind === 'term-localization' && target.fieldPath === '/contextKey'),
      errata: target.ownerKind === 'presentation' && target.fieldPath === '/errata',
      announcement: target.ownerKind === 'announcement' && target.fieldPath === '/blocks',
      'game-change': ['game-change', 'official-text-change'].includes(target.ownerKind) && target.fieldPath === '/summary',
      identity: (target.ownerKind === 'presentation' && target.fieldPath === '/entityRef') || (target.ownerKind === 'term-localization' && target.fieldPath === '/termRef'),
    }[target.dimension] ?? false;
    if (!allowed) issue(issues, at + '/dimension', 'review dimension does not match an allowed owner field', 'review-dimension');
  }
  const receiptKeys = new Set();
  for (const [index, receipt] of contract.reviewReceipts.entries()) {
    const at = '/reviewReceipts/' + index;
    if (!targets.has(receipt.targetId)) issue(issues, at + '/targetId', 'review receipt target does not exist', 'dangling-review');
    const key = [receipt.targetId, receipt.targetDigest, receipt.dependenciesDigest, receipt.reviewedAt].join('\u0000');
    if (receiptKeys.has(key)) issue(issues, at, 'duplicate review receipt entry', 'duplicate-review');
    receiptKeys.add(key);
    if (!Number.isFinite(Date.parse(receipt.reviewedAt))) issue(issues, at + '/reviewedAt', 'review timestamp is not a valid UTC date', 'review-time');
  }
}

function isForbiddenRemoteKey(value, at, issues) {
  const forbidden = new Set(['selector', 'selectorProgram', 'regex', 'matcherProgram', 'javascript', 'wasm', 'htmlTemplate', 'formula', 'expression', 'modImpact', 'checkedConsumers', 'matchedDependencies', 'actionRequired', 'suggestedActions', 'verificationChecklist']);
  const walk = (node, pointer) => {
    if (Array.isArray(node)) node.forEach((item, index) => walk(item, pointer + '/' + index));
    else if (isObject(node)) for (const [key, child] of Object.entries(node)) {
      if (forbidden.has(key)) issue(issues, pointer + '/' + pointerEscape(key), 'remote selectors, executable fields, and MOD impact fields are outside this contract', 'forbidden-field');
      walk(child, pointer + '/' + pointerEscape(key));
    }
  };
  walk(value, at);
}

function collectAnnouncementOccurrences(blocks, blockIds, assetRefs, at) {
  for (const [index, block] of blocks.entries()) {
    const blockAt = at + '/' + index;
    blockIds.push({ blockId: block.blockId, path: blockAt + '/blockId' });
    if (block.kind === 'list') {
      for (const [itemIndex, item] of block.items.entries()) blockIds.push({ blockId: item.blockId, path: blockAt + '/items/' + itemIndex + '/blockId' });
    } else if (block.kind === 'table') {
      for (const [rowIndex, row] of block.rows.entries()) {
        for (const [cellIndex, cell] of row.cells.entries()) blockIds.push({ blockId: cell.blockId, path: blockAt + '/rows/' + rowIndex + '/cells/' + cellIndex + '/blockId' });
      }
    } else if (block.kind === 'image') {
      assetRefs.push({ assetId: block.assetRef.assetId, path: blockAt + '/assetRef/assetId' });
    } else if (block.kind === 'spoiler') {
      collectAnnouncementOccurrences(block.blocks, blockIds, assetRefs, blockAt + '/blocks');
    }
  }
}

function officialTextContent(source) {
  return {
    sourceText: source.sourceText,
    segments: source.segments.map(segment => segment.kind === 'text'
      ? { kind: 'text', text: segment.text }
      : { kind: 'parameter', parameterId: segment.parameterId, token: segment.token }),
    params: source.params.map(param => ({
      parameterId: param.parameterId,
      sourceKey: param.sourceKey,
      value: param.value,
      ...(param.officialNameRef ? { officialNameRef: param.officialNameRef } : {}),
    })),
    resolvedText: source.resolvedText,
  };
}

function sameSourceOwner(left, right) {
  return left?.recordId === right?.recordId
    && left?.gameReleaseId === right?.gameReleaseId
    && left?.kind === right?.kind;
}

function sourceRefKey(ref) {
  return String(ref?.gameReleaseId) + '\u0000' + String(ref?.recordId) + '\u0000' + String(ref?.kind);
}

function refsMatchSet(actual, expected) {
  if (actual.length !== expected.length) return false;
  const expectedKeys = new Set(expected.map(sourceRefKey));
  return expectedKeys.size === expected.length && actual.every(ref => expectedKeys.has(sourceRefKey(ref)));
}

function refsMatchOrder(actual, expected) {
  return actual.length === expected.length && actual.every((ref, index) => sourceRefKey(ref) === sourceRefKey(expected[index]));
}

function hasNonemptyText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function reviewTargetCount(contract, ownerKind, ownerId, fieldPath, dimension) {
  return contract.reviewTargets.filter(target => target.ownerKind === ownerKind
    && target.ownerId === ownerId && target.fieldPath === fieldPath && target.dimension === dimension).length;
}

function hasUniqueReviewTarget(contract, ownerKind, ownerId, fieldPath, dimension) {
  return reviewTargetCount(contract, ownerKind, ownerId, fieldPath, dimension) === 1;
}

function hasAnyUniqueReviewTarget(contract, ownerKind, ownerId, fieldPaths, dimension) {
  return fieldPaths.some(fieldPath => hasUniqueReviewTarget(contract, ownerKind, ownerId, fieldPath, dimension));
}

function typedSourceRef(ref, kind) {
  return ref && typeof ref === 'object' ? { ...ref, kind: ref.kind ?? kind } : ref;
}

function uniqueTypedRefs(refs, kind) {
  return [...new Map(refs.filter(Boolean).map(ref => {
    const typed = typedSourceRef(ref, kind);
    return [sourceRefKey(typed), typed];
  })).values()];
}

function validateW07CurveRecord(definition, curve, issues, at) {
  const curvePayload = curve.payload;
  const knots = curvePayload.knots ?? [];
  if (definition.payload.curveMapping?.schemaVersion === 'w07-stat-curve-mapping/1.0.0') {
    const mapping = definition.payload.curveMapping;
    const normalizedKnots = curvePayload.inputUnit === 'ratio'
      && knots.length === 2
      && knots[0].input === '0' && knots[0].sourceOrdinal === 1
      && knots[1].input === '1' && knots[1].sourceOrdinal === 2
      && knots.every(point => point.rawEndpoint !== undefined && point.rawEndpoint !== null && point.sourceLocator);
    if (!normalizedKnots) issue(issues, at + '/payload/knots', 'weapon stat curves must preserve raw ordinal endpoints while exposing normalized ratio t=0 and t=1', 'weapon-curve-normalized-endpoints');
    if (curvePayload.panelInputRange?.status !== 'not-applicable') issue(issues, at + '/payload/panelInputRange', 'profile curve t is not a panel input range', 'weapon-curve-range-scope');
    if (mapping.rawProfileParameter?.referenceEndpoints?.min !== '0'
      || mapping.rawProfileParameter?.referenceEndpoints?.max !== '1'
      || mapping.rawProfileParameter?.referenceEndpoints?.scope !== 'reference-endpoints-only') {
      issue(issues, '/records/' + definition.recordId + '/payload/curveMapping/rawProfileParameter/referenceEndpoints', 'raw profile knots define reference endpoints only', 'weapon-curve-domain');
    }
    if (curvePayload.interpolation?.value !== 'linear' || !curvePayload.interpolation?.sourceLocator) {
      issue(issues, at + '/payload/interpolation', 'pinned Source math callsite establishes linear interpolation', 'weapon-curve-interpolation');
    }
    if (curvePayload.edgePolicy?.value !== 'extrapolate'
      || curvePayload.edgePolicy?.scope !== 'math.lerp function only'
      || !curvePayload.edgePolicy?.sourceLocator
      || !Array.isArray(curvePayload.callsiteLocators) || curvePayload.callsiteLocators.length === 0) {
      issue(issues, at + '/payload/edgePolicy', 'math.lerp extrapolation must be scoped to the function and backed by its callsite locators', 'weapon-curve-edge-policy');
    }
    const traitRange = mapping.traitParameter?.range;
    if (definition.payload.panelInputRange?.status !== 'not-applicable'
      || !traitRange || canonical(definition.payload.theoreticalInputRange) !== canonical(traitRange)) {
      issue(issues, '/records/' + definition.recordId + '/payload/theoreticalInputRange', 'stat definition theoretical range must preserve the selected trait-template t interval, separately from raw profile t endpoints', 'weapon-curve-range-scope');
    }
    if (definition.payload.obtainableInputRange?.status !== 'unknown'
      || definition.payload.obtainableInputRange?.reasonCode !== 'NOT_EXPOSED_BY_SOURCE') {
      issue(issues, '/records/' + definition.recordId + '/payload/obtainableInputRange', 'Source does not expose the attainable item-stat range', 'weapon-curve-range-scope');
    }
    const evidence = definition.payload.rangeEvidence;
    if (!Array.isArray(evidence?.checkedSources) || evidence.checkedSources.length === 0
      || !evidence.serverBoundary || !evidence.impact) {
      issue(issues, '/records/' + definition.recordId + '/payload/rangeEvidence', 'unexposed attainable range must retain its checked-source and server-boundary evidence', 'weapon-curve-range-evidence');
    }
    if (mapping.outerItemRating?.panelComparisonRange?.scope !== 'comparison-metadata-only'
      || mapping.outerItemRating?.panelComparisonRange?.min !== '0'
      || mapping.outerItemRating?.panelComparisonRange?.max !== '1'
      || mapping.outerItemRating?.obtainableRange?.reasonCode !== 'NOT_EXPOSED_BY_SOURCE'
      || mapping.rawProfileParameter?.callerDomain?.reasonCode !== 'CALLER_DOMAIN_NOT_PROVEN'
      || mapping.rawProfileParameter?.selectedWeaponTweakPath?.status !== 'known') {
      issue(issues, '/records/' + definition.recordId + '/payload/curveMapping', 'outer comparison metadata, selected weapon tweak clamp, and arbitrary caller domain must remain distinct', 'weapon-curve-mapping-scope');
    }
    return;
  }
  const validKnots = curvePayload.inputUnit === 'ratio'
    && knots.length === 2
    && knots[0].input === '0' && knots[0].sourceOrdinal === 1
    && knots[1].input === '1' && knots[1].sourceOrdinal === 2
    && knots.every(point => point.rawEndpoint !== undefined && point.rawEndpoint !== null && point.sourceLocator);
  if (!validKnots) issue(issues, at + '/payload/knots', 'weapon stat curves must preserve raw ordinal endpoints while exposing normalized ratio t=0 and t=1', 'weapon-curve-normalized-endpoints');
  const domain = curvePayload.nominalInputDomain;
  if (domain?.min !== '0' || domain?.max !== '1' || domain?.unit !== 'ratio' || domain?.meaning !== 'normalized-reference-endpoints-only') {
    issue(issues, at + '/payload/nominalInputDomain', 'curve nominal domain must describe normalized reference endpoints only', 'weapon-curve-domain');
  }
  if (curvePayload.interpolation?.status !== 'known' || curvePayload.interpolation?.value !== 'linear') {
    issue(issues, at + '/payload/interpolation', 'pinned Source math callsite establishes linear interpolation', 'weapon-curve-interpolation');
  }
  if (curvePayload.edgePolicy?.status !== 'known' || curvePayload.edgePolicy?.value !== 'extrapolate'
    || !curvePayload.edgePolicyScope || !Array.isArray(curvePayload.callsiteLocators) || curvePayload.callsiteLocators.length === 0) {
    issue(issues, at + '/payload/edgePolicy', 'math.lerp extrapolation must be scoped to the function and backed by its callsite locators', 'weapon-curve-edge-policy');
  }

  const definitionPayload = definition.payload;
  if (definitionPayload.panelInputRange?.status !== 'not-applicable') {
    issue(issues, '/records/' + definition.recordId + '/payload/panelInputRange', 'raw table endpoints are not a panel range', 'weapon-curve-range-scope');
  }
  const theoretical = definitionPayload.theoreticalInputRange;
  if (theoretical?.min !== '0' || theoretical?.max !== '1' || theoretical?.unit !== 'ratio') {
    issue(issues, '/records/' + definition.recordId + '/payload/theoreticalInputRange', 'theoretical range must retain the normalized curve reference domain', 'weapon-curve-range-scope');
  }
  if (definitionPayload.obtainableInputRange?.status !== 'unknown'
    || definitionPayload.obtainableInputRange?.reasonCode !== 'NOT_EXPOSED_BY_SOURCE') {
    issue(issues, '/records/' + definition.recordId + '/payload/obtainableInputRange', 'Source does not expose the attainable item-rating range', 'weapon-curve-range-scope');
  }
  const evidence = definitionPayload.rangeEvidence;
  if (!Array.isArray(evidence?.checkedSources) || evidence.checkedSources.length === 0
    || evidence.serverBoundary === undefined || evidence.serverBoundary === null
    || evidence.impact === undefined || evidence.impact === null) {
    issue(issues, '/records/' + definition.recordId + '/payload/rangeEvidence', 'unexposed attainable range must retain its checked-source and server-boundary evidence', 'weapon-curve-range-evidence');
  }
}

function validateW07CurveMappings(weapon, statDefinitionRecords, releaseId, inputs, issues, at) {
  const definitions = new Map(statDefinitionRecords.map(record => [keyOf(record), record]));
  for (const [groupIndex, group] of (weapon.payload.statBindings ?? []).entries()) {
    for (const [bindingIndex, binding] of (group.bindings ?? []).entries()) {
      const mapping = binding.curveMapping;
      if (!mapping) continue;
      const mappingAt = at + '/payload/statBindings/' + groupIndex + '/bindings/' + bindingIndex + '/curveMapping';
      if (mapping.schemaVersion === 'w07-stat-curve-mapping/1.0.0') {
        const statDefinition = [...definitions.values()].find(definition => definition.payload.curveMapping
          && canonical(definition.payload.curveMapping) === canonical(mapping));
        if (!statDefinition) {
          issue(issues, mappingAt, 'curve mapping must match a pinned stat definition owned by this weapon and claim closure', 'weapon-curve-mapping-owner');
        }
        const outer = mapping.outerItemRating;
        const trait = mapping.traitParameter;
        const profile = mapping.rawProfileParameter;
        const knownRange = range => range?.status === 'known' && range.unit === 'ratio'
          && typeof range.min === 'string' && typeof range.max === 'string'
          && range.inclusive?.min === true && range.inclusive?.max === true;
        if (mapping.schemaVersion !== 'w07-stat-curve-mapping/1.0.0'
          || outer?.quantityKind !== 'normalized-item-stat-value' || outer.unit !== 'ratio'
          || outer.panelComparisonRange?.min !== '0' || outer.panelComparisonRange?.max !== '1'
          || outer.panelComparisonRange?.scope !== 'comparison-metadata-only'
          || outer.obtainableRange?.status !== 'unknown' || outer.obtainableRange?.reasonCode !== 'NOT_EXPOSED_BY_SOURCE'
          || !Array.isArray(outer.sourceLocators) || outer.sourceLocators.length === 0
          || trait?.quantityKind !== 'trait-template-t' || trait.unit !== 'ratio' || !knownRange(trait.range)
          || !Array.isArray(trait.sourceLocators) || trait.sourceLocators.length === 0
          || profile?.quantityKind !== 'normalized-profile-t' || profile.unit !== 'ratio'
          || profile.referenceEndpoints?.min !== '0' || profile.referenceEndpoints?.max !== '1'
          || profile.callerDomain?.status !== 'unknown' || profile.callerDomain?.reasonCode !== 'CALLER_DOMAIN_NOT_PROVEN'
          || profile.selectedWeaponTweakPath?.status !== 'known'
          || profile.selectedWeaponTweakPath?.accumulatorRange?.min !== '0'
          || profile.selectedWeaponTweakPath?.accumulatorRange?.max !== '1'
          || profile.selectedWeaponTweakPath?.accumulatorRange?.unit !== 'ratio'
          || profile.selectedWeaponTweakPath?.fallbacks?.emptyPath !== '0'
          || profile.selectedWeaponTweakPath?.fallbacks?.defaultTraitValue !== '0.5'
          || profile.selectedWeaponTweakPath?.fallbacks?.defaultProfileLerpValue !== '0.5'
          || !Array.isArray(profile.selectedWeaponTweakPath?.sourceLocators)
          || profile.selectedWeaponTweakPath.sourceLocators.length === 0
          || !Array.isArray(profile.sourceLocators) || profile.sourceLocators.length === 0) {
          issue(issues, mappingAt, 'curve mapping must preserve the three distinct item, trait, and raw-profile coordinates with their evidence', 'weapon-curve-mapping-scope');
        }
        continue;
      }
      const statRef = typedSourceRef(mapping.statRef, 'stat-definition');
      const curveRef = typedSourceRef(mapping.curveRef, 'stat-curve');
      const stat = resolveSourceRecord(statRef, 'stat-definition', releaseId, inputs, issues, mappingAt + '/statRef');
      const curve = resolveSourceRecord(curveRef, 'stat-curve', releaseId, inputs, issues, mappingAt + '/curveRef');
      const ownedDefinition = definitions.get(keyOf(statRef));
      if (!stat || !ownedDefinition || stat.recordId !== ownedDefinition.recordId || stat.gameReleaseId !== ownedDefinition.gameReleaseId) {
        issue(issues, mappingAt + '/statRef', 'curve mapping must identify a stat definition owned by this weapon', 'weapon-curve-mapping-owner');
      }
      if (stat?.payload.curveRef && sourceRefKey({ ...stat.payload.curveRef, kind: 'stat-curve' }) !== sourceRefKey(curveRef)) {
        issue(issues, mappingAt + '/curveRef', 'curve mapping must retain the curve linked by its stat definition', 'weapon-curve-mapping-owner');
      }
      if (typeof mapping.baseStatKey !== 'string' || mapping.baseStatKey.trim() === '') {
        issue(issues, mappingAt + '/baseStatKey', 'curve mapping requires the Source base-stat identity', 'weapon-curve-mapping-owner');
      }
      if (mapping.itemRatingRange?.status !== 'unknown' || mapping.itemRatingRange?.reasonCode !== 'NOT_EXPOSED_BY_SOURCE') {
        issue(issues, mappingAt + '/itemRatingRange', 'attainable item-rating range must remain unknown where Source does not expose it', 'weapon-curve-range-scope');
      }
      if (canonical(mapping.traitParameterRange) !== canonical(binding.traitParameterRange)) {
        issue(issues, mappingAt + '/traitParameterRange', 'curve mapping must retain this trait binding’s exact parameter range', 'weapon-curve-mapping-owner');
      }
      if (!Array.isArray(mapping.mappingLocators) || mapping.mappingLocators.length === 0) {
        issue(issues, mappingAt + '/mappingLocators', 'outer item-rating to trait-parameter mapping requires source locators', 'weapon-curve-mapping-locator');
      }
    }
  }
}

function canonicalActionInputKey(value) {
  return typeof value === 'string' ? value.split('.', 1)[0] : null;
}

function validateW07StatSemanticsCoverage(weapon, issues, at) {
  const sourceGroups = weapon.payload.statBindings ?? [];
  const semanticGroups = Array.isArray(weapon.payload.statTableSemantics) ? weapon.payload.statTableSemantics : [];
  const sourceStatKeys = new Set(sourceGroups.map(group => group.statKey));
  const semanticStatKeys = new Set();
  for (const [groupIndex, semanticGroup] of semanticGroups.entries()) {
    const groupAt = at + '/statTableSemantics/' + groupIndex;
    if (semanticStatKeys.has(semanticGroup.statKey)) {
      issue(issues, groupAt + '/statKey', 'each Source stat group must have one semantic group', 'weapon-stat-semantics-coverage');
    }
    semanticStatKeys.add(semanticGroup.statKey);
    if (!sourceStatKeys.has(semanticGroup.statKey)) {
      issue(issues, groupAt + '/statKey', 'semantic groups cannot introduce a property group absent from Source statBindings', 'weapon-stat-semantics-coverage');
      continue;
    }
    const expectedProperties = new Set(sourceGroups.find(group => group.statKey === semanticGroup.statKey).bindings.map(binding => binding.property));
    const semanticRows = Array.isArray(semanticGroup.bindings) ? semanticGroup.bindings : [];
    const counts = new Map();
    for (const row of semanticRows) counts.set(row.property, (counts.get(row.property) ?? 0) + 1);
    for (const property of expectedProperties) {
      if (counts.get(property) !== 1) {
        issue(issues, groupAt + '/bindings', 'each unique Source stat-binding property must have exactly one semantic or explicit checked row: ' + property, 'weapon-stat-semantics-coverage');
      }
    }
    for (const property of counts.keys()) {
      if (!expectedProperties.has(property)) {
        issue(issues, groupAt + '/bindings', 'semantic rows cannot introduce a property absent from Source statBindings: ' + property, 'weapon-stat-semantics-coverage');
      }
    }
  }
  for (const group of sourceGroups) {
    if (!semanticStatKeys.has(group.statKey)) {
      issue(issues, at + '/statTableSemantics', 'every Source stat group requires a semantic group that accounts for its properties: ' + group.statKey, 'weapon-stat-semantics-coverage');
    }
  }
}

function validateW07R6ActionProfileClosure(weapon, profiles, releaseId, inputs, issues, at) {
  validateW07StatSemanticsCoverage(weapon, issues, at + '/payload');
  const resolution = weapon.payload.actionProfileResolution;
  const base = at + '/actionProfileResolution';
  const inputSetup = resolution.inputSetup;
  const inputEntries = Array.isArray(inputSetup?.inputEntries) ? inputSetup.inputEntries : [];
  const declaredInputs = new Set(inputEntries.map(entry => canonicalActionInputKey(entry.inputKey)).filter(Boolean));
  const inputRows = [
    ...inputEntries.map(entry => [entry.inputKey, entry.sourceLocator]),
    ...(weapon.payload.actionContinuations ?? []).map(edge => [edge.inputKey, edge.sourceLocator]),
  ];
  const validateInput = (key, locator, path) => {
    if (!declaredInputs.has(canonicalActionInputKey(key)) || !locator) {
      issue(issues, path, 'action input must resolve through the selected setup while preserving its full source key and locator', 'weapon-action-resolution-input');
    }
  };
  if (!inputSetup || typeof inputSetup.setupKey !== 'string' || typeof inputSetup.inheritedSetupKey !== 'string'
    || !inputSetup.hierarchyRaw || !Array.isArray(inputSetup.setupSources) || inputSetup.setupSources.length === 0
    || !Array.isArray(inputSetup.inputEntries)) {
    issue(issues, base + '/inputSetup', 'weapon action resolution must preserve the selected and inherited setups, hierarchy, source rows, and merged inputs', 'weapon-resolution-input-setup');
  }
  for (const [index, entry] of inputEntries.entries()) {
    if (!entry || typeof entry.inputKey !== 'string' || typeof entry.rawValue !== 'string'
      || !['base-template', 'default-setup', 'weapon-mid-setup'].includes(entry.origin) || !entry.sourceLocator) {
      issue(issues, base + '/inputSetup/inputEntries/' + index, 'input rows must retain a declared origin, raw value, and source locator', 'weapon-resolution-input-setup');
    }
  }
  if (new Set(inputEntries.map(entry => canonicalActionInputKey(entry.inputKey))).size !== inputEntries.length) {
    issue(issues, base + '/inputSetup/inputEntries', 'canonical input setup keys must be unique', 'weapon-resolution-input-setup');
  }

  const localActions = Array.isArray(resolution.localActions) ? resolution.localActions : [];
  const fallbackActions = Array.isArray(resolution.fallbackActions) ? resolution.fallbackActions : [];
  const allActions = [...localActions, ...fallbackActions];
  const actionKeys = new Set(allActions.map(row => row.action));
  if (!Array.isArray(resolution.localActions) || !Array.isArray(resolution.fallbackActions)) {
    issue(issues, base, 'weapon resolution requires both local and fallback action rows', 'weapon-resolution-actions');
  }
  if (resolution.executionPolicy !== 'static-only; functions not executed') {
    issue(issues, base + '/executionPolicy', 'generator facts must remain static and must not execute functions', 'weapon-resolution-condition');
  }
  for (const [name, rows] of [['localActions', localActions], ['fallbackActions', fallbackActions]]) {
    if (new Set(rows.map(row => row.action)).size !== rows.length) issue(issues, base + '/' + name, 'action identities must be unique within each origin', 'weapon-resolution-action-duplicate');
    for (const [index, row] of rows.entries()) {
      const rowAt = base + '/' + name + '/' + index;
      if (typeof row.action !== 'string' || !row.rawSource || typeof row.rawSource.rawValue !== 'string'
        || !row.rawSource.sourceLocator || !row.sourceRange || row.sourceRange.path !== row.rawSource.sourceLocator.path
        || row.sourceRange.line > row.sourceRange.endLine) {
        issue(issues, rowAt, 'action rows must preserve their raw source and complete containing source range', 'weapon-resolution-actions');
      }
      if (row.startInput !== null && row.startInput !== undefined) {
        if (typeof row.startInput.inputKey !== 'string' || !row.startInput.sourceLocator) {
          issue(issues, rowAt + '/startInput', 'direct start input must be an exact source-backed object or null', 'weapon-resolution-input');
        } else validateInput(row.startInput.inputKey, row.startInput.sourceLocator, rowAt + '/startInput');
      }
    }
  }

  const edges = Array.isArray(weapon.payload.actionContinuations) ? weapon.payload.actionContinuations : [];
  for (const [index, edge] of edges.entries()) {
    if (!actionKeys.has(edge.fromAction) || !actionKeys.has(edge.toAction)) {
      issue(issues, at + '/payload/actionContinuations/' + index, 'literal continuation endpoints must resolve to declared actions', 'weapon-action-target-resolution');
    }
    validateInput(edge.inputKey, edge.sourceLocator, at + '/payload/actionContinuations/' + index + '/inputKey');
  }

  const profileActionNames = new Set(profiles.map(profile => profile.payload.action));
  for (const action of profileActionNames) {
    if (localActions.filter(row => row.action === action).length + fallbackActions.filter(row => row.action === action).length !== 1) {
      issue(issues, base, 'each attack profile must resolve to exactly one local or fallback action: ' + action, 'weapon-resolution-action-missing');
    }
  }

  const generatorGroups = Array.isArray(resolution.actionGenerators) ? resolution.actionGenerators : [];
  const generatorByKey = new Map();
  for (const [groupIndex, group] of generatorGroups.entries()) {
    const groupAt = base + '/actionGenerators/' + groupIndex;
    const definitions = Array.isArray(group.definitions) ? group.definitions : [];
    if (typeof group.generatorKey !== 'string' || definitions.length === 0
      || definitions.some(definition => definition.generatorKey !== group.generatorKey)
      || definitions.some((definition, index) => index > 0 && definition.definitionIndex <= definitions[index - 1].definitionIndex)
      || definitions.at(-1)?.definitionIndex !== group.effectiveDefinitionIndex) {
      issue(issues, groupAt, 'generator definitions must retain source order and select the last definition as effective', 'weapon-generator-effective-definition');
    }
    generatorByKey.set(group.generatorKey, group);
    for (const [definitionIndex, definition] of definitions.entries()) {
      const definitionAt = groupAt + '/definitions/' + definitionIndex;
      if (!Number.isInteger(definition.definitionIndex) || !Number.isInteger(definition.endLine)
        || definition.endLine < definition.sourceLocator?.line || typeof definition.rawValue !== 'string'
        || !definition.sourceLocator || !['action-settings', 'continuation-list'].includes(definition.returnKind)
        || !Array.isArray(definition.generatedActions) || !Array.isArray(definition.generatedContinuations)) {
        issue(issues, definitionAt, 'generator definition must preserve its complete source span and closed return shape', 'weapon-generator-definition');
      }
      for (const [actionIndex, generated] of (definition.generatedActions ?? []).entries()) {
        if (!actionKeys.has(generated.actionKey)) issue(issues, definitionAt + '/generatedActions/' + actionIndex + '/actionKey', 'generated action settings must bind an already-declared action node', 'weapon-action-target-resolution');
        for (const input of [generated.startInput, generated.stopInput]) if (input) validateInput(input, definition.sourceLocator, definitionAt + '/generatedActions/' + actionIndex);
        for (const [edgeIndex, edge] of (generated.continuationEdges ?? []).entries()) {
          if (!actionKeys.has(edge.actionKey)) issue(issues, definitionAt + '/generatedActions/' + actionIndex + '/continuationEdges/' + edgeIndex, 'generated continuation must resolve to a declared action node', 'weapon-action-target-resolution');
          if (edge.inputKey) validateInput(edge.inputKey, edge.sourceLocator, definitionAt + '/generatedActions/' + actionIndex + '/continuationEdges/' + edgeIndex + '/inputKey');
        }
      }
      for (const [edgeIndex, edge] of (definition.generatedContinuations ?? []).entries()) {
        if (!actionKeys.has(edge.actionKey)) issue(issues, definitionAt + '/generatedContinuations/' + edgeIndex + '/actionKey', 'generated continuation must resolve to a declared action node', 'weapon-action-target-resolution');
        if (edge.inputKey) validateInput(edge.inputKey, edge.sourceLocator, definitionAt + '/generatedContinuations/' + edgeIndex + '/inputKey');
      }
    }
  }

  const bindings = Array.isArray(resolution.generatorBindings) ? resolution.generatorBindings : [];
  for (const [bindingIndex, binding] of bindings.entries()) {
    const bindingAt = base + '/generatorBindings/' + bindingIndex;
    const group = generatorByKey.get(binding.generatorKey);
    const row = allActions.find(action => action.action === binding.ownerAction);
    const ownerRange = binding.ownerActionRange;
    const callsite = binding.callsite?.sourceLocator;
    if (!group || !row || !ownerRange || !callsite || ownerRange.path !== callsite.path
      || ownerRange.path !== row.sourceRange?.path
      || ownerRange.line !== row.sourceRange?.line || ownerRange.endLine !== row.sourceRange?.endLine
      || callsite.line < ownerRange.line || callsite.line > ownerRange.endLine
      || typeof binding.callsite.rawValue !== 'string') {
      issue(issues, bindingAt, 'generator callsite must be bound to the exact containing action source range', 'weapon-generator-owner-range');
      continue;
    }
    const effective = group.definitions.find(definition => definition.definitionIndex === group.effectiveDefinitionIndex);
    if (!effective || binding.returnKind !== effective.returnKind) {
      issue(issues, bindingAt + '/returnKind', 'generator binding return kind must match its effective source definition', 'weapon-generator-return-kind');
    }
    if (binding.returnKind === 'continuation-list') {
      if (binding.assignedActionKey !== 'wield') issue(issues, bindingAt + '/assignedActionKey', 'continuation-list generators bind the wield slot', 'weapon-generator-assigned-action');
    } else if (!actionKeys.has(binding.assignedActionKey)) {
      issue(issues, bindingAt + '/assignedActionKey', 'action-settings generator must resolve to a declared action node', 'weapon-generator-assigned-action');
    }
  }

  const currentTargets = inputs.sourceContract.records.filter(record => record.gameReleaseId === releaseId
    && record.kind === 'target-profile' && record.payload.sourceStatic?.breedType === 'minion');
  const expectedTargets = currentTargets.map(record => ({ recordId: record.recordId, gameReleaseId: record.gameReleaseId, kind: 'target-profile' }));
  const expectedArmor = new Map();
  const validateArmorIdentity = (ref, rawValue, sourceLocator, targetAt, fieldName) => {
    const armorAt = targetAt + '/' + fieldName;
    if (!ref || typeof rawValue !== 'string' || !sourceLocator) {
      issue(issues, armorAt, 'armor identity, exact raw enum access, and locator must be preserved together', 'weapon-target-static-facts');
      return;
    }
    const rawKey = /^armor_types\.([A-Za-z0-9_]+)$/u.exec(rawValue)?.[1];
    const armor = resolveSourceRecord(typedSourceRef(ref, 'armor-class'), 'armor-class', releaseId, inputs, issues, armorAt + 'Ref');
    if (!rawKey || armor?.payload.sourceStatic?.classKey !== rawKey) {
      issue(issues, armorAt, 'armor enum access must resolve to the exact referenced armor-class identity', 'weapon-target-static-facts');
    }
  };
  for (const [targetIndex, target] of currentTargets.entries()) {
    const staticFacts = target.payload.sourceStatic;
    const targetAt = base + '/targetProfiles/' + target.recordId;
    if (!staticFacts || staticFacts.schemaVersion !== 'minion-hit-schema/1.0.0'
      || !staticFacts.registryLocator || !staticFacts.breedLocator || !staticFacts.baseArmorLocator
      || typeof staticFacts.baseArmorRawValue !== 'string' || !staticFacts.baseArmorClassRef
      || !staticFacts.rawHitZones || typeof staticFacts.rawHitZones.rawValue !== 'string'
      || !Array.isArray(staticFacts.hitZones) || !Array.isArray(staticFacts.weakspotTypes)
      || !Array.isArray(staticFacts.armorOverrides) || !Array.isArray(staticFacts.damageMultipliers)
      || !Array.isArray(staticFacts.unresolvedZoneReferences)) {
      issue(issues, targetAt, 'target profiles must preserve raw static registry, armor, hit-zone, and relationship facts', 'weapon-target-static-facts');
      continue;
    }
    validateArmorIdentity(staticFacts.baseArmorClassRef, staticFacts.baseArmorRawValue, staticFacts.baseArmorLocator, targetAt, 'baseArmorClass');
    const toughnessFields = [staticFacts.toughnessArmorClassRef, staticFacts.toughnessArmorRawValue, staticFacts.toughnessArmorLocator];
    if (toughnessFields.some(value => value !== undefined && value !== null)) {
      validateArmorIdentity(staticFacts.toughnessArmorClassRef, staticFacts.toughnessArmorRawValue, staticFacts.toughnessArmorLocator, targetAt, 'toughnessArmorClass');
    }
    const armorRefs = [staticFacts.baseArmorClassRef, staticFacts.toughnessArmorClassRef,
      ...staticFacts.armorOverrides.map(row => row.armorClassRef)].filter(Boolean);
    for (const ref of armorRefs) expectedArmor.set(keyOf(ref), typedSourceRef(ref, 'armor-class'));
    const zones = new Set(staticFacts.hitZones.map(zone => zone.zoneId));
    if (new Set(staticFacts.hitZones.map(zone => zone.zoneId)).size !== staticFacts.hitZones.length) {
      issue(issues, targetAt + '/hitZones', 'hit-zone identities must be unique within a target profile', 'weapon-target-static-facts');
    }
    for (const [zoneIndex, zone] of staticFacts.hitZones.entries()) {
      if (typeof zone.zoneId !== 'string' || !zone.rawSource?.sourceLocator || typeof zone.rawSource.rawValue !== 'string'
        || !Array.isArray(zone.actors) || typeof zone.actorsRawValue !== 'string' || !zone.actorsLocator
        || !Array.isArray(zone.otherRawFields)) {
        issue(issues, targetAt + '/hitZones/' + zoneIndex, 'hit-zone rows must preserve actors and the complete raw fragment', 'weapon-target-static-facts');
      }
    }
    for (const relationship of [...staticFacts.weakspotTypes, ...staticFacts.armorOverrides, ...staticFacts.damageMultipliers]) {
      if (!zones.has(relationship.zoneId) && !staticFacts.unresolvedZoneReferences.some(row => row.zoneId === relationship.zoneId)) {
        issue(issues, targetAt, 'zone relationships must resolve to an imported zone or retain an explicit unresolved reference', 'weapon-target-static-facts');
      }
    }
    for (const reference of staticFacts.unresolvedZoneReferences) if (!reference.sourceLocator || !reference.fieldPath || !reference.zoneId || !reference.rawValue) {
      issue(issues, targetAt + '/unresolvedZoneReferences', 'unresolved relationship rows must retain their exact field, raw token, and source locator', 'weapon-target-static-facts');
    }
  }
  if (currentTargets.length === 0) issue(issues, base, 'action profiles must bind the pinned static minion registry', 'weapon-target-registry-missing');
  const expectedRules = inputs.sourceContract.records.filter(record => record.gameReleaseId === releaseId
    && record.kind === 'modifier-rule' && record.payload.sourceBranchModel?.schemaVersion === 'static-combat-relations/1');
  const expectedRuleRefs = expectedRules.map(record => ({ recordId: record.recordId, gameReleaseId: record.gameReleaseId, kind: 'modifier-rule' }));

  const verifyClosureRefs = (actual, expected, kind, refAt, code, message) => {
    if (!Array.isArray(actual)) {
      issue(issues, refAt, message, code);
      return;
    }
    const typed = actual.map(ref => typedSourceRef(ref, kind));
    const keys = typed.map(keyOf);
    if (new Set(keys).size !== typed.length || typed.some(ref => ref.gameReleaseId !== releaseId)
      || !refsMatchSet(typed, expected)) issue(issues, refAt, message, code);
    typed.forEach((ref, index) => resolveSourceRecord(ref, kind, releaseId, inputs, issues, refAt + '/' + index));
  };

  for (const [index, profile] of profiles.entries()) {
    const profileAt = at + '/attackProfileRefs/' + index;
    const action = profile.payload.action;
    const actionResolution = profile.payload.actionResolution;
    const origin = actionResolution?.origin;
    const ownerRows = origin === 'weapon-template' ? localActions : origin === 'base-template-settings' ? fallbackActions : [];
    const matchingRows = ownerRows.filter(row => row.action === action);
    const owner = matchingRows.length === 1 ? matchingRows[0] : null;
    if (!actionResolution || !owner) {
      issue(issues, profileAt + '/actionResolution', 'each action profile must bind exactly one Source action row', 'weapon-action-resolution-required');
      continue;
    }
    if (canonical(actionResolution.startInput ?? null) !== canonical(owner.startInput ?? null)) {
      issue(issues, profileAt + '/actionResolution/startInput', 'direct start input must match the exact owning action row, including an explicitly absent input', 'weapon-action-resolution-input');
    }
    if (actionResolution.startInput) validateInput(actionResolution.startInput.inputKey, actionResolution.startInput.sourceLocator, profileAt + '/actionResolution/startInput');
    const incoming = edges.filter(edge => edge.toAction === action);
    if (!Array.isArray(actionResolution.entryBindings) || canonical(actionResolution.entryBindings) !== canonical(incoming)) {
      issue(issues, profileAt + '/actionResolution/entryBindings', 'incoming entry bindings must preserve every full literal continuation row in source order', 'weapon-action-entry-binding');
    }
    const outgoingInputsByKey = new Map();
    for (const edge of edges.filter(edge => edge.fromAction === action)) {
      if (!outgoingInputsByKey.has(edge.inputKey)) {
        outgoingInputsByKey.set(edge.inputKey, { inputKey: edge.inputKey, role: 'continuation', sourceLocator: edge.sourceLocator });
      }
    }
    const expectedBindings = [
      ...(actionResolution.startInput ? [{ inputKey: actionResolution.startInput.inputKey, role: 'start-input', sourceLocator: actionResolution.startInput.sourceLocator }] : []),
      ...outgoingInputsByKey.values(),
    ];
    if (!Array.isArray(actionResolution.inputBindings) || canonical(actionResolution.inputBindings) !== canonical(expectedBindings)) {
      issue(issues, profileAt + '/actionResolution/inputBindings', 'action input bindings must exactly represent its direct start input and outgoing literal continuation inputs', 'weapon-action-resolution-input');
    }
    for (const [bindingIndex, binding] of (actionResolution.inputBindings ?? []).entries()) validateInput(binding.inputKey, binding.sourceLocator, profileAt + '/actionResolution/inputBindings/' + bindingIndex);
    if (actionResolution.targetApplicability !== 'all-static-registry-minion-hit-schemas') issue(issues, profileAt + '/actionResolution/targetApplicability', 'action applicability must retain the static minion hit-schema scope', 'weapon-target-applicability');
    if (canonical(actionResolution.branchBindings ?? []) !== canonical(profile.payload.sourceBindings ?? [])) issue(issues, profileAt + '/actionResolution/branchBindings', 'profile branch bindings must match Source profile refs exactly', 'weapon-action-branch-coverage');
    for (const [branchIndex, branch] of (actionResolution.branchBindings ?? []).entries()) resolveSourceRecord(typedSourceRef(branch.profileRef, 'damage-profile'), 'damage-profile', releaseId, inputs, issues, profileAt + '/actionResolution/branchBindings/' + branchIndex + '/profileRef');
    for (const [conditionIndex, condition] of (actionResolution.runtimeConditions ?? []).entries()) {
      if (condition.execution !== 'not-evaluated' || typeof condition.rawValue !== 'string' || !condition.sourceLocator || !condition.fieldPath) {
        issue(issues, profileAt + '/actionResolution/runtimeConditions/' + conditionIndex, 'runtime conditions must remain raw descriptive Source facts', 'weapon-action-runtime-condition');
      }
    }
    verifyClosureRefs(profile.payload.targetProfileRefs, expectedTargets, 'target-profile', profileAt + '/targetProfileRefs', 'weapon-target-coverage', 'attack profile must bind every current-release static minion target exactly once');
    verifyClosureRefs(profile.payload.armorClassRefs, [...expectedArmor.values()], 'armor-class', profileAt + '/armorClassRefs', 'weapon-armor-coverage', 'attack profile armor refs must exactly match base, toughness, and hit-zone override closure');
    verifyClosureRefs(profile.payload.modifierRuleRefs, expectedRuleRefs, 'modifier-rule', profileAt + '/modifierRuleRefs', 'weapon-modifier-rule-coverage', 'attack profile modifier refs must exactly match the current-release static relation records');
  }

  const closure = resolution.staticClosure ?? {};
  const actionSettings = bindings.filter(binding => binding.returnKind === 'action-settings').length;
  const generatedEdges = bindings.reduce((count, binding) => {
    const definition = generatorByKey.get(binding.generatorKey)?.definitions?.find(row => row.definitionIndex === generatorByKey.get(binding.generatorKey)?.effectiveDefinitionIndex);
    return count + (definition?.generatedContinuations?.length ?? 0)
      + (definition?.generatedActions ?? []).reduce((sum, row) => sum + (row.continuationEdges?.length ?? 0), 0);
  }, 0);
  const expectedProfiles = profiles.reduce((count, profile) => count + (profile.payload.actionResolution?.branchBindings?.length ?? 0), 0);
  if (closure.localActionCount !== localActions.length || closure.fallbackActionCount !== fallbackActions.length
    || closure.profileBindingCount !== expectedProfiles || closure.literalContinuationEdgeCount !== edges.length
    || closure.generatedActionSettingsCount !== actionSettings || closure.generatedContinuationEdgeCount !== generatedEdges
    || closure.inputEntryCount !== inputEntries.length) {
    issue(issues, base + '/staticClosure', 'static closure counts must match the preserved actions, literal and generated edges, profile bindings, and merged inputs', 'weapon-resolution-closure-count');
  }
}

function validateW07ActionProfileClosure(weapon, profiles, releaseId, inputs, issues, at) {
  const resolution = weapon.payload.actionProfileResolution;
  if (!resolution) {
    const hasNotImported = (record, field) => {
      if (record?.dataCoverage?.status !== 'partial' || !Array.isArray(record.dataCoverage.missing)) return false;
      const markers = record.dataCoverage.missing.filter(item => item?.field === field);
      return markers.length === 1 && markers[0]?.reasonCode === 'NOT_IMPORTED';
    };
    const rangedModes = new Set(['hipfire', 'ads']);
    const supportsExplicitlyUnresolvedRangedProfile = hasNotImported(weapon, '/payload/actionProfileResolution')
      && profiles.length > 0
      && profiles.every(profile => rangedModes.has(profile.payload.mode)
        && !profile.payload.actionResolution
        && hasNotImported(profile, '/payload/actionResolution'));
    if (supportsExplicitlyUnresolvedRangedProfile) return;
    issue(issues, at + '/actionProfileResolution', 'W07 weapon facts require the pinned Source action-resolution closure', 'weapon-resolution-required');
    return;
  }
  if (resolution.executionPolicy === 'static-only; functions not executed') {
    validateW07R6ActionProfileClosure(weapon, profiles, releaseId, inputs, issues, at);
    return;
  }

  const inputSetup = resolution.inputSetup;
  const inputEntries = inputSetup?.inputEntries ?? [];
  const inputKeys = new Set(inputEntries.map(entry => entry.inputKey));
  if (!inputSetup || typeof inputSetup.setupKey !== 'string' || typeof inputSetup.inheritedSetupKey !== 'string'
    || !Array.isArray(inputSetup.sourceLocators) || !inputSetup.hierarchyRaw || !Array.isArray(inputSetup.inputEntries)) {
    issue(issues, at + '/actionProfileResolution/inputSetup', 'weapon action resolution requires the fixed input setup and its source entries', 'weapon-resolution-input-setup');
  }
  for (const [index, entry] of inputEntries.entries()) {
    if (typeof entry.inputKey !== 'string' || typeof entry.rawValue !== 'string' || !entry.sourceLocator) {
      issue(issues, at + '/actionProfileResolution/inputSetup/inputEntries/' + index, 'input entries must preserve their key, raw value, and source locator', 'weapon-resolution-input-setup');
    }
  }
  if (new Set(inputEntries.map(entry => entry.inputKey)).size !== inputEntries.length) {
    issue(issues, at + '/actionProfileResolution/inputSetup/inputEntries', 'input setup keys must be unique', 'weapon-resolution-input-setup');
  }
  if (!Array.isArray(resolution.localActions) || !Array.isArray(resolution.fallbackActions)) {
    issue(issues, at + '/actionProfileResolution', 'weapon action resolution requires both local and base-template fallback action lists', 'weapon-resolution-actions');
  }
  if (resolution.conditionExecution !== 'not-evaluated') {
    issue(issues, at + '/actionProfileResolution/conditionExecution', 'runtime conditions must remain descriptive and not evaluated', 'weapon-resolution-condition');
  }

  const localActions = resolution.localActions ?? [];
  const fallbackActions = resolution.fallbackActions ?? [];
  const allActions = [...localActions, ...fallbackActions];
  for (const [name, entries] of [['localActions', localActions], ['fallbackActions', fallbackActions]]) {
    for (const [index, entry] of entries.entries()) {
      if (typeof entry.action !== 'string' || !entry.sourceLocator
        || (entry.startInput !== undefined && (typeof entry.startInput !== 'string' || !entry.startInputSourceLocator))) {
        issue(issues, at + '/actionProfileResolution/' + name + '/' + index, 'action rows must preserve their identity, optional start input, and source locators', 'weapon-resolution-actions');
      }
    }
  }
  const profileActionNames = new Set(profiles.map(profile => profile.payload.action));
  for (const action of profileActionNames) {
    if (localActions.filter(entry => entry.action === action).length + fallbackActions.filter(entry => entry.action === action).length === 0) {
      issue(issues, at + '/actionProfileResolution', 'every Source attack profile must resolve to a local or fallback action: ' + action, 'weapon-resolution-action-missing');
    }
  }
  for (const [name, entries] of [['localActions', localActions], ['fallbackActions', fallbackActions]]) {
    if (new Set(entries.map(entry => entry.action)).size !== entries.length) {
      issue(issues, at + '/actionProfileResolution/' + name, 'each action origin list must have unique action keys', 'weapon-resolution-action-duplicate');
    }
  }

  const expectedTargetProfiles = inputs.sourceContract.records
    .filter(record => record.gameReleaseId === releaseId && record.kind === 'target-profile' && record.payload.sourceStatic?.breedType === 'minion')
    .map(record => ({ recordId: record.recordId, gameReleaseId: record.gameReleaseId, kind: 'target-profile' }));
  const expectedArmorClasses = new Map();
  const expectedModifierRules = new Map();
  for (const targetRef of expectedTargetProfiles) {
    const target = inputs.sourceRecordMap.get(keyOf(targetRef));
    const sourceStatic = target?.payload.sourceStatic;
    if (!sourceStatic || !sourceStatic.rawHitZones || typeof sourceStatic.rawHitZones.rawValue !== 'string'
      || !Array.isArray(sourceStatic.hitZones) || sourceStatic.hitZones.length === 0
      || !Array.isArray(sourceStatic.unresolvedZoneReferences)) {
      issue(issues, at + '/actionProfileResolution', 'each imported minion target profile requires its Source static hit-zone facts', 'weapon-target-static-facts');
      continue;
    }
    const armorRefs = [sourceStatic.baseArmorClassRef,
      sourceStatic.toughnessArmorClassRef,
      ...sourceStatic.hitZones.map(zone => zone.armorOverrideRef).filter(Boolean)];
    for (const ref of uniqueTypedRefs(armorRefs, 'armor-class')) expectedArmorClasses.set(sourceRefKey(ref), ref);
    const ruleRefs = [
      ...(sourceStatic.armorRuleRefs ?? []),
      ...(sourceStatic.weakspotRuleRefs ?? []),
      ...(sourceStatic.critFinesseRuleRefs ?? []),
    ];
    for (const ref of uniqueTypedRefs(ruleRefs, 'modifier-rule')) expectedModifierRules.set(sourceRefKey(ref), ref);

    for (const [zoneIndex, zone] of sourceStatic.hitZones.entries()) {
      const zoneAt = at + '/actionProfileResolution/targetProfiles/' + target.recordId + '/hitZones/' + zoneIndex;
      if (typeof zone.zoneId !== 'string' || !zone.zoneId || !Array.isArray(zone.actors)
        || typeof zone.actorsRawValue !== 'string'
        || !zone.rawSource || typeof zone.rawSource.rawValue !== 'string'
        || !Array.isArray(zone.hitZoneDamageMultiplierRows)) {
        issue(issues, zoneAt, 'hit-zone facts must preserve the zone identity, resolved and raw actors, raw source fragment, and damage-multiplier rows', 'weapon-target-static-facts');
      }
      if (zone.baseArmorClassRef) issue(issues, zoneAt + '/baseArmorClassRef', 'base armor identity belongs to the target profile; a hit-zone may only declare an override', 'weapon-target-armor-binding');
      if (zone.armorOverrideRef) resolveSourceRecord(typedSourceRef(zone.armorOverrideRef, 'armor-class'), 'armor-class', releaseId, inputs, issues, zoneAt + '/armorOverrideRef');
    }
    resolveSourceRecord(typedSourceRef(sourceStatic.baseArmorClassRef, 'armor-class'), 'armor-class', releaseId, inputs, issues, at + '/actionProfileResolution/targetProfiles/' + target.recordId + '/baseArmorClassRef');
    const toughnessFields = [sourceStatic.toughnessArmorClassRef, sourceStatic.toughnessArmorLocator, sourceStatic.toughnessArmorRawValue];
    if (toughnessFields.some(value => value !== undefined && value !== null)) {
      if (!sourceStatic.toughnessArmorClassRef || !sourceStatic.toughnessArmorLocator || typeof sourceStatic.toughnessArmorRawValue !== 'string') {
        issue(issues, at + '/actionProfileResolution/targetProfiles/' + target.recordId + '/toughnessArmorClassRef', 'toughness armor identity, raw value, and locator must be preserved together', 'weapon-target-static-facts');
      } else {
        resolveSourceRecord(typedSourceRef(sourceStatic.toughnessArmorClassRef, 'armor-class'), 'armor-class', releaseId, inputs, issues, at + '/actionProfileResolution/targetProfiles/' + target.recordId + '/toughnessArmorClassRef');
      }
    }
    for (const [referenceIndex, reference] of sourceStatic.unresolvedZoneReferences.entries()) {
      if (!reference || !reference.sourceLocator) {
        issue(issues, at + '/actionProfileResolution/targetProfiles/' + target.recordId + '/unresolvedZoneReferences/' + referenceIndex, 'unresolved zone references must retain their Source locator', 'weapon-target-static-facts');
      }
    }
    for (const [name, refs] of [['armorRuleRefs', sourceStatic.armorRuleRefs], ['weakspotRuleRefs', sourceStatic.weakspotRuleRefs], ['critFinesseRuleRefs', sourceStatic.critFinesseRuleRefs]]) {
      for (const [refIndex, ref] of (refs ?? []).entries()) resolveSourceRecord(typedSourceRef(ref, 'modifier-rule'), 'modifier-rule', releaseId, inputs, issues, at + '/actionProfileResolution/targetProfiles/' + target.recordId + '/' + name + '/' + refIndex);
    }
  }
  if (expectedTargetProfiles.length === 0) {
    issue(issues, at + '/actionProfileResolution', 'action profiles must resolve to the pinned static minion hit-zone registry', 'weapon-target-registry-missing');
  }

  for (const [index, profile] of profiles.entries()) {
    const profileAt = at + '/attackProfileRefs/' + index;
    const action = profile.payload.action;
    const actionResolution = profile.payload.actionResolution;
    if (!actionResolution) {
      issue(issues, profileAt + '/actionResolution', 'each Source attack profile requires a narrow action-specific resolution', 'weapon-action-resolution-required');
      continue;
    }
    if (!['weapon-template', 'base-template-settings'].includes(actionResolution.origin)) {
      issue(issues, profileAt + '/actionResolution/origin', 'action origin must identify a weapon-local or base-template action', 'weapon-action-resolution-origin');
    }
    const ownerActions = actionResolution.origin === 'weapon-template' ? localActions : fallbackActions;
    const matchingOwnerActions = ownerActions.filter(entry => entry.action === action);
    if (matchingOwnerActions.length !== 1) {
      issue(issues, profileAt + '/actionResolution/origin', 'action must resolve to exactly one matching local or fallback action', 'weapon-action-resolution-origin');
    } else if (matchingOwnerActions[0].startInput && matchingOwnerActions[0].startInput !== actionResolution.startInput?.inputKey) {
      issue(issues, profileAt + '/actionResolution/startInput', 'action start input differs from its fixed local or fallback action row', 'weapon-action-resolution-input');
    }
    const startInputKey = actionResolution.startInput?.inputKey;
    if (typeof startInputKey !== 'string' || !inputKeys.has(startInputKey) || !actionResolution.startInput?.sourceLocator) {
      issue(issues, profileAt + '/actionResolution/startInput', 'action start input must resolve in the selected input setup', 'weapon-action-resolution-input');
    }
    const bindings = actionResolution.inputBindings ?? [];
    if (!Array.isArray(actionResolution.inputBindings)) issue(issues, profileAt + '/actionResolution/inputBindings', 'action input bindings must be present, including an empty array when none apply', 'weapon-action-resolution-input');
    for (const [bindingIndex, binding] of bindings.entries()) {
      if (!inputKeys.has(binding.inputKey) || !binding.sourceLocator) issue(issues, profileAt + '/actionResolution/inputBindings/' + bindingIndex + '/inputKey', 'action input binding must resolve in the selected input setup and retain its source locator', 'weapon-action-resolution-input');
      if (!['start-input', 'continuation'].includes(binding.role)) issue(issues, profileAt + '/actionResolution/inputBindings/' + bindingIndex + '/role', 'input binding role is unsupported', 'weapon-action-resolution-input');
    }
    if (!bindings.some(binding => binding.inputKey === startInputKey && binding.role === 'start-input')) {
      issue(issues, profileAt + '/actionResolution/inputBindings', 'the start input must be represented by a start-input binding', 'weapon-action-resolution-input');
    }
    if (actionResolution.targetApplicability !== 'all-static-registry-minion-hit-schemas') {
      issue(issues, profileAt + '/actionResolution/targetApplicability', 'attack target applicability must identify the imported static minion registry', 'weapon-target-applicability');
    }

    const expectedTargets = expectedTargetProfiles;
    const sourceTargetRefs = profile.payload.targetProfileRefs ?? [];
    const actualTargets = uniqueTypedRefs(sourceTargetRefs, 'target-profile');
    if (actualTargets.length !== sourceTargetRefs.length || !refsMatchSet(actualTargets, expectedTargets)) {
      issue(issues, profileAt + '/targetProfileRefs', 'every attack profile must bind the complete pinned minion target-profile registry exactly once', 'weapon-target-coverage');
    }
    const expectedArmorRefs = [...expectedArmorClasses.values()];
    const sourceArmorRefs = profile.payload.armorClassRefs ?? [];
    const actualArmorRefs = uniqueTypedRefs(sourceArmorRefs, 'armor-class');
    if (actualArmorRefs.length !== sourceArmorRefs.length || !refsMatchSet(actualArmorRefs, expectedArmorRefs)) {
      issue(issues, profileAt + '/armorClassRefs', 'attack profile armor-class refs must exactly match its target-profile closure', 'weapon-armor-coverage');
    }
    const expectedRuleRefs = [...expectedModifierRules.values()];
    const sourceRuleRefs = profile.payload.modifierRuleRefs ?? [];
    const actualRuleRefs = uniqueTypedRefs(sourceRuleRefs, 'modifier-rule');
    if (actualRuleRefs.length !== sourceRuleRefs.length || !refsMatchSet(actualRuleRefs, expectedRuleRefs)) {
      issue(issues, profileAt + '/modifierRuleRefs', 'attack profile modifier-rule refs must exactly match its target-profile closure', 'weapon-modifier-rule-coverage');
    }
    for (const [refIndex, ref] of (profile.payload.targetProfileRefs ?? []).entries()) resolveSourceRecord(typedSourceRef(ref, 'target-profile'), 'target-profile', releaseId, inputs, issues, profileAt + '/targetProfileRefs/' + refIndex);
    for (const [refIndex, ref] of (profile.payload.armorClassRefs ?? []).entries()) resolveSourceRecord(typedSourceRef(ref, 'armor-class'), 'armor-class', releaseId, inputs, issues, profileAt + '/armorClassRefs/' + refIndex);
    for (const [refIndex, ref] of (profile.payload.modifierRuleRefs ?? []).entries()) resolveSourceRecord(typedSourceRef(ref, 'modifier-rule'), 'modifier-rule', releaseId, inputs, issues, profileAt + '/modifierRuleRefs/' + refIndex);

    const branches = actionResolution.branchBindings ?? [];
    if (!Array.isArray(actionResolution.branchBindings)) issue(issues, profileAt + '/actionResolution/branchBindings', 'action branch bindings must be present, including an empty array when none apply', 'weapon-action-branch-coverage');
    if (canonical(branches) !== canonical(profile.payload.sourceBindings ?? [])) {
      issue(issues, profileAt + '/actionResolution/branchBindings', 'action-resolution branches must match the Source profile bindings exactly', 'weapon-action-branch-coverage');
    }
    for (const [branchIndex, branch] of branches.entries()) {
      resolveSourceRecord(typedSourceRef(branch.profileRef, 'damage-profile'), 'damage-profile', releaseId, inputs, issues, profileAt + '/actionResolution/branchBindings/' + branchIndex + '/profileRef');
    }
    if (!Array.isArray(actionResolution.runtimeConditions)) issue(issues, profileAt + '/actionResolution/runtimeConditions', 'runtime condition facts must be present, including an empty array when none apply', 'weapon-action-runtime-condition');
    for (const [conditionIndex, condition] of (actionResolution.runtimeConditions ?? []).entries()) {
      if (condition.execution !== 'not-evaluated' || typeof condition.rawValue !== 'string' || typeof condition.fieldPath !== 'string' || !condition.sourceLocator) {
        issue(issues, profileAt + '/actionResolution/runtimeConditions/' + conditionIndex, 'runtime conditions must preserve their source predicate without evaluation', 'weapon-action-runtime-condition');
      }
    }
  }

  const expectedActionCount = new Set(allActions.map(entry => entry.action)).size;
  const expectedProfileBindings = profiles.reduce((count, profile) => count + (profile.payload.actionResolution?.branchBindings?.length ?? 0), 0);
  const closure = resolution.staticClosure ?? {};
  if (closure.actionCount !== expectedActionCount
    || closure.profileBindingCount !== expectedProfileBindings
    || closure.continuationEdgeCount !== (weapon.payload.actionContinuations ?? []).length
    || closure.inputEntryCount !== inputEntries.length) {
    issue(issues, at + '/actionProfileResolution/staticClosure', 'static closure counts must match the imported action, profile, continuation, and input-entry facts', 'weapon-resolution-closure-count');
  }
}

function detailItemHasContent(item) {
  if (hasNonemptyText(item.text)) return true;
  return (item.parts ?? []).some(part => part.kind !== 'literal' || hasNonemptyText(part.text));
}

export function resolveDetailReviewTargets(contract, ownerId, item, itemPath) {
  const required = detailItemHasContent(item);
  const scopes = new Set([itemPath]);
  const tierItemPath = itemPath.match(/^(\/tierPresentations\/options\/(\d+))\/detailSections\/(\d+)\/items\/(\d+)$/);
  if (tierItemPath) {
    scopes.add(tierItemPath[1]);
    scopes.add(tierItemPath[1] + '/detailSections');
    scopes.add(tierItemPath[1] + '/detailSections/' + tierItemPath[3] + '/items');
  } else if (/^\/detailSections\/\d+\/items\/\d+$/.test(itemPath)) {
    scopes.add('/detailSections');
  }
  if (typeof item.text === 'string') scopes.add(itemPath + '/text');
  const allParts = (item.parts ?? []).map((part, index) => ({ part, index }));
  if (allParts.length > 0) {
    scopes.add(itemPath + '/parts');
    for (const { part, index } of allParts) {
      scopes.add(itemPath + '/parts/' + index);
      if (part.kind === 'literal') scopes.add(itemPath + '/parts/' + index + '/text');
    }
  }
  const relevantParts = (item.parts ?? []).map((part, index) => ({ part, index }))
    .filter(({ part }) => part.kind !== 'literal' || hasNonemptyText(part.text));

  const targets = contract.reviewTargets.filter(target => target.ownerKind === 'presentation'
    && target.ownerId === ownerId && target.dimension === 'content' && scopes.has(target.fieldPath));
  const targetPaths = new Set(targets.map(target => target.fieldPath));
  const broadScopes = [itemPath];
  if (tierItemPath) broadScopes.push(tierItemPath[1], tierItemPath[1] + '/detailSections', tierItemPath[1] + '/detailSections/' + tierItemPath[3] + '/items');
  else if (/^\/detailSections\/\d+\/items\/\d+$/.test(itemPath)) broadScopes.push('/detailSections');
  let covered = !required;
  if (required) {
    covered = broadScopes.some(fieldPath => targetPaths.has(fieldPath));
    if (!covered && hasNonemptyText(item.text)) covered = targetPaths.has(itemPath + '/text');
    if (!covered && relevantParts.length > 0) {
      covered = targetPaths.has(itemPath + '/parts') || relevantParts.every(({ part, index }) =>
        targetPaths.has(itemPath + '/parts/' + index)
        || (part.kind === 'literal' && targetPaths.has(itemPath + '/parts/' + index + '/text')));
    }
  }
  return { targets, covered, required };
}

function detailItemHasReviewCoverage(contract, ownerId, item, itemPath) {
  return resolveDetailReviewTargets(contract, ownerId, item, itemPath).covered;
}

function detailSectionsHaveReviewCoverage(contract, ownerId, sections, basePath) {
  for (const [sectionIndex, section] of sections.entries()) {
    for (const [itemIndex, item] of section.items.entries()) if (detailItemHasContent(item)) {
      const itemPath = basePath + '/' + sectionIndex + '/items/' + itemIndex;
      if (!resolveDetailReviewTargets(contract, ownerId, item, itemPath).covered) return false;
    }
  }
  return true;
}

function validateRequiredReviewCoverage(contract, issues) {
  const requireTarget = (ownerKind, ownerId, fieldPaths, dimension, issuePath, description) => {
    if (!hasAnyUniqueReviewTarget(contract, ownerKind, ownerId, fieldPaths, dimension)) {
      issue(issues, issuePath, description, 'review-coverage');
    }
  };

  for (const [index, presentation] of contract.presentations.entries()) {
    const at = '/presentations/' + index;
    const ownerId = presentation.authoringId;
    if (hasNonemptyText(presentation.official?.resolvedText)) {
      if (presentation.tierPresentations?.options?.length) {
        for (const [optionIndex] of presentation.tierPresentations.options.entries()) {
          const base = '/tierPresentations/options/' + optionIndex;
          requireTarget('presentation', ownerId, [base, base + '/officialLocaleRefs'], 'official', at + base, 'each non-empty tier official presentation requires a matching review target');
        }
      } else {
        requireTarget('presentation', ownerId, ['/official', '/officialLocaleRefs'], 'official', at + '/official', 'non-empty official content requires an official review target');
      }
    }
    if (hasNonemptyText(presentation.name)) {
      requireTarget('presentation', ownerId, ['/name'], 'content', at + '/name', 'non-empty presentation names require a content review target');
    }
    if (hasNonemptyText(presentation.faithfulTranslation?.text)) {
      requireTarget('presentation', ownerId, ['/faithfulTranslation'], 'translation', at + '/faithfulTranslation', 'non-empty faithful translations require a translation review target');
    }

    const tierModel = presentation.tierPresentations;
    const tierDefaultIndex = tierModel?.options?.findIndex(option => option.tier === tierModel.defaultTier) ?? -1;
    const tierDefault = tierDefaultIndex >= 0 ? tierModel.options[tierDefaultIndex] : null;
    const defaultDetailsAlias = tierDefault
      && canonical(presentation.detailSections) === canonical(tierDefault.detailSections)
      && detailSectionsHaveReviewCoverage(contract, ownerId, tierDefault.detailSections, '/tierPresentations/options/' + tierDefaultIndex + '/detailSections');
    if (!defaultDetailsAlias && !detailSectionsHaveReviewCoverage(contract, ownerId, presentation.detailSections, '/detailSections')) {
      const missing = presentation.detailSections.flatMap((section, sectionIndex) => section.items.map((item, itemIndex) => ({ item, itemPath: '/detailSections/' + sectionIndex + '/items/' + itemIndex })))
        .find(({ item, itemPath }) => detailItemHasContent(item) && !detailItemHasReviewCoverage(contract, ownerId, item, itemPath));
      issue(issues, at + (missing?.itemPath ?? '/detailSections'), 'non-empty detail content requires a whole-section, item, text, or complete-parts review target', 'review-coverage');
    }

    for (const [optionIndex, option] of (tierModel?.options ?? []).entries()) {
      const base = '/tierPresentations/options/' + optionIndex + '/detailSections';
      if (!detailSectionsHaveReviewCoverage(contract, ownerId, option.detailSections, base)) {
        const missing = option.detailSections.flatMap((section, sectionIndex) => section.items.map((item, itemIndex) => ({ item, itemPath: base + '/' + sectionIndex + '/items/' + itemIndex })))
          .find(({ item, itemPath }) => detailItemHasContent(item) && !detailItemHasReviewCoverage(contract, ownerId, item, itemPath));
        issue(issues, at + (missing?.itemPath ?? base), 'non-empty tier detail content requires a whole-section, item, text, or complete-parts review target', 'review-coverage');
      }
    }

    const wholeErrataHasReviewCoverage = ['errata', 'content'].some(dimension =>
      hasUniqueReviewTarget(contract, 'presentation', ownerId, '/errata', dimension));
    if (presentation.errata.length > 0 && !wholeErrataHasReviewCoverage) {
      for (const [errataIndex, erratum] of presentation.errata.entries()) {
        const errataPath = '/errata/' + errataIndex;
        if (hasNonemptyText(erratum.text)) requireTarget('presentation', ownerId, [errataPath + '/text'], 'content', at + errataPath + '/text', 'non-empty errata text requires a content review target');
        if (hasNonemptyText(erratum.context?.description)) requireTarget('presentation', ownerId, [errataPath + '/context', errataPath + '/context/description'], 'context', at + errataPath + '/context', 'non-empty errata context requires a context review target');
        else if (erratum.context?.refs?.length) requireTarget('presentation', ownerId, [errataPath + '/context'], 'context', at + errataPath + '/context', 'non-empty errata context references require a context review target');
      }
    }
    if (presentation.tierApplicability.length > 0) {
      requireTarget('presentation', ownerId, ['/tierApplicability'], 'context', at + '/tierApplicability', 'non-empty tier applicability requires a context review target');
    }

    const view = presentation.weaponView;
    if (view) {
      for (const field of ['markLabel', 'attackHeading', 'comparisonHeading', 'note']) if (hasNonemptyText(view[field])) {
        requireTarget('presentation', ownerId, ['/weaponView/' + field], 'content', at + '/weaponView/' + field, 'non-empty weapon view text requires a content review target');
      }
      for (const [sectionIndex, section] of (view.statSections ?? []).entries()) if (section) {
        requireTarget('presentation', ownerId, ['/weaponView/statSections/' + sectionIndex], 'content', at + '/weaponView/statSections/' + sectionIndex, 'non-empty weapon stat sections require an individual content review target');
      }
      for (const [profileIndex, profile] of (view.attackProfileRefs ?? []).entries()) if (profile) {
        requireTarget('presentation', ownerId, ['/weaponView/attackProfileRefs/' + profileIndex], 'content', at + '/weaponView/attackProfileRefs/' + profileIndex, 'weapon action bindings require individual content review targets');
      }
    }
  }

  for (const [index, localization] of contract.termLocalizations.entries()) {
    const at = '/termLocalizations/' + index;
    if (hasNonemptyText(localization.label)) requireTarget('term-localization', localization.authoringId, ['/label'], 'content', at + '/label', 'non-empty term labels require a content review target');
    if (hasNonemptyText(localization.definition)) requireTarget('term-localization', localization.authoringId, ['/definition'], 'content', at + '/definition', 'non-empty term definitions require a content review target');
    if (hasNonemptyText(localization.contextKey)) requireTarget('term-localization', localization.authoringId, ['/contextKey'], 'context', at + '/contextKey', 'non-empty term contexts require a context review target');
  }

  for (const [index, announcement] of contract.announcements.entries()) {
    if (announcement.blocks?.length > 0) {
      requireTarget('announcement', announcement.announcementId, ['/blocks'], 'announcement', '/announcements/' + index + '/blocks', 'non-empty announcements require a blocks review target');
    }
  }

  for (const [index, change] of contract.gameChanges.entries()) {
    const at = '/gameChanges/' + index;
    if (hasNonemptyText(change.summary?.text)) {
      requireTarget('game-change', change.changeId, ['/summary'], 'game-change', at + '/summary', 'non-empty game-change summaries require a matching review target');
    }
    if (change.fieldSummaries?.length > 0) {
      const wholeCollection = hasUniqueReviewTarget(contract, 'game-change', change.changeId, '/fieldSummaries', 'content');
      const everyField = change.fieldSummaries.every((_, fieldIndex) => hasUniqueReviewTarget(
        contract, 'game-change', change.changeId, '/fieldSummaries/' + fieldIndex + '/summary', 'content',
      ));
      if (!wholeCollection && !everyField) {
        issue(issues, at + '/fieldSummaries', 'non-empty game-change field summaries require a whole-collection or complete per-field review target set', 'review-coverage');
      }
    }
  }

  for (const [index, change] of contract.officialTextChanges.entries()) {
    if (hasNonemptyText(change.summary?.text)) {
      requireTarget('official-text-change', change.changeId, ['/summary'], 'game-change', '/officialTextChanges/' + index + '/summary', 'non-empty official-text-change summaries require a matching review target');
    }
  }
}

function validateWeaponView(presentation, contract, inputs, issues, at) {
  const view = presentation.weaponView;
  if (!view) {
    issue(issues, at + '/weaponView', 'W07 weapon presentation requires a Source-bound weapon view', 'weapon-view-required');
    return;
  }
  const releaseId = presentation.entityRef.gameReleaseId;
  if (presentation.entityRef.kind !== 'weapon') issue(issues, at + '/entityRef/kind', 'W07 weapon view owner must be a weapon', 'weapon-view-owner');
  const weapon = resolveSourceRecord(view.sourceWeaponRef, 'weapon', releaseId, inputs, issues, at + '/weaponView/sourceWeaponRef');
  if (!sameSourceOwner(view.sourceWeaponRef, presentation.entityRef)) issue(issues, at + '/weaponView/sourceWeaponRef', 'weapon view must follow the presentation weapon and release', 'weapon-view-owner');
  if (!weapon) return;

  const sourceBindings = weapon.payload.statBindings ?? [];
  const sourceStatKeys = sourceBindings.map(binding => binding.statKey);
  if (new Set(sourceStatKeys).size !== sourceStatKeys.length) issue(issues, at + '/weaponView/statSections', 'Source weapon stat bindings must have unique stat keys', 'weapon-stat-source');
  const viewStatKeys = view.statSections.map(section => section.sourceStat);
  if (new Set(viewStatKeys).size !== viewStatKeys.length) issue(issues, at + '/weaponView/statSections', 'weapon view stat groups must not duplicate a Source stat key', 'weapon-stat-duplicate');
  if (canonical(viewStatKeys) !== canonical(sourceStatKeys)) issue(issues, at + '/weaponView/statSections', 'weapon view must retain the complete Source stat group set in source order', 'weapon-stat-coverage');

  const sourceClaims = new Map((weapon.payload.claimRefs ?? []).map(ref => [String(ref.gameReleaseId) + '\u0000' + String(ref.recordId), inputs.sourceRecordMap.get(keyOf(ref))]));
  const statDefinitionRecords = (weapon.payload.statRefs ?? []).map(ref => inputs.sourceRecordMap.get(keyOf({ ...ref, kind: 'stat-definition' }))).filter(Boolean);
  const expectedReviewTargets = [];
  for (const [sectionIndex, section] of view.statSections.entries()) {
    const sectionAt = at + '/weaponView/statSections/' + sectionIndex;
    const claimsForStat = [...sourceClaims.values()].filter(record => record?.kind === 'claim' && record.payload.context?.weaponStat === section.sourceStat);
    const expectedClaimRefs = claimsForStat.map(record => ({ recordId: record.recordId, gameReleaseId: record.gameReleaseId, kind: 'claim' }));
    const actualClaims = [];
    for (const [refIndex, ref] of section.claimRefs.entries()) {
      const claim = resolveSourceRecord(ref, 'claim', releaseId, inputs, issues, sectionAt + '/claimRefs/' + refIndex);
      if (claim) {
        actualClaims.push(ref);
        if (claim.payload.context?.weaponStat !== section.sourceStat) issue(issues, sectionAt + '/claimRefs/' + refIndex, 'claim belongs to a different Source weapon stat group', 'weapon-stat-claim');
        if (claim.payload.context?.weaponRef?.recordId !== weapon.recordId || claim.payload.context?.weaponRef?.gameReleaseId !== weapon.gameReleaseId) issue(issues, sectionAt + '/claimRefs/' + refIndex, 'claim context belongs to a different Source weapon', 'weapon-stat-claim');
      }
    }
    if (!refsMatchSet(actualClaims, expectedClaimRefs)) issue(issues, sectionAt + '/claimRefs', 'stat group claim refs must exactly match the Source weapon claims for this stat', 'weapon-stat-coverage');

    const claimKeys = new Set(expectedClaimRefs.map(sourceRefKey));
    const expectedDefinitions = statDefinitionRecords.filter(record => (record.payload.claimRefs ?? []).some(ref => claimKeys.has(sourceRefKey({ ...ref, kind: 'claim' }))));
    const expectedDefinitionRefs = expectedDefinitions.map(record => ({ recordId: record.recordId, gameReleaseId: record.gameReleaseId, kind: 'stat-definition' }));
    const actualDefinitions = [];
    for (const [refIndex, ref] of section.statDefinitionRefs.entries()) {
      const definition = resolveSourceRecord(ref, 'stat-definition', releaseId, inputs, issues, sectionAt + '/statDefinitionRefs/' + refIndex);
      if (definition) actualDefinitions.push(ref);
    }
    if (!refsMatchSet(actualDefinitions, expectedDefinitionRefs)) issue(issues, sectionAt + '/statDefinitionRefs', 'stat definitions must match the Source definitions linked to this stat group', 'weapon-stat-definition');

    const expectedCurves = expectedDefinitions.map(record => record.payload.curveRef).filter(Boolean).map(ref => ({ ...ref, kind: 'stat-curve' }));
    const actualCurves = [];
    for (const [refIndex, ref] of section.curveRefs.entries()) {
      const curve = resolveSourceRecord(ref, 'stat-curve', releaseId, inputs, issues, sectionAt + '/curveRefs/' + refIndex);
      if (curve) {
        actualCurves.push(ref);
        if (weapon.payload.actionProfileResolution) {
          const linkedDefinition = expectedDefinitions.find(definition => sourceRefKey({ ...definition.payload.curveRef, kind: 'stat-curve' }) === sourceRefKey(ref));
          if (linkedDefinition) validateW07CurveRecord(linkedDefinition, curve, issues, '/records/' + curve.recordId);
        }
      }
    }
    if (!refsMatchSet(actualCurves, expectedCurves)) issue(issues, sectionAt + '/curveRefs', 'curve refs must match the curves of this Source stat group', 'weapon-stat-curve');
    expectedReviewTargets.push('/weaponView/statSections/' + sectionIndex);
  }

  if (weapon.payload.actionProfileResolution) {
    validateW07CurveMappings(weapon, statDefinitionRecords, releaseId, inputs, issues, '/records/' + weapon.recordId);
  }

  const expectedProfiles = (weapon.payload.attackProfileRefs ?? []).map(ref => ({ ...ref, kind: 'attack-profile' }));
  const actualProfiles = [];
  const resolvedProfiles = [];
  for (const [refIndex, ref] of view.attackProfileRefs.entries()) {
    const profile = resolveSourceRecord(ref, 'attack-profile', releaseId, inputs, issues, at + '/weaponView/attackProfileRefs/' + refIndex);
    if (profile) {
      actualProfiles.push(ref);
      resolvedProfiles.push(profile);
      if (profile.payload.weaponRef?.recordId !== weapon.recordId || profile.payload.weaponRef?.gameReleaseId !== weapon.gameReleaseId) issue(issues, at + '/weaponView/attackProfileRefs/' + refIndex, 'attack profile belongs to a different Source weapon mark', 'weapon-action-owner');
      if (profile.payload.templateKey !== weapon.payload.templateKey) issue(issues, at + '/weaponView/attackProfileRefs/' + refIndex, 'attack profile template differs from the selected Source weapon template', 'weapon-action-template');
    }
    expectedReviewTargets.push('/weaponView/attackProfileRefs/' + refIndex);
  }
  if (!refsMatchOrder(actualProfiles, expectedProfiles)) issue(issues, at + '/weaponView/attackProfileRefs', 'weapon view must retain every Source action profile in source order for the selected mark', 'weapon-action-coverage');
  validateW07ActionProfileClosure(weapon, resolvedProfiles, releaseId, inputs, issues, at + '/weaponView');

  for (const field of ['markLabel', 'attackHeading', 'comparisonHeading', 'note']) if (hasNonemptyText(view[field])) expectedReviewTargets.push('/weaponView/' + field);
  for (const fieldPath of expectedReviewTargets) {
    if (!contract.reviewTargets.some(target => target.ownerKind === 'presentation' && target.ownerId === presentation.authoringId && target.dimension === 'content' && target.fieldPath === fieldPath)) {
      issue(issues, at + fieldPath, 'weapon view requires a separate review target for each stat group, action binding, and displayed label', 'weapon-review-target');
    }
  }
  if (contract.reviewTargets.some(target => target.ownerKind === 'presentation' && target.ownerId === presentation.authoringId && target.fieldPath === '/weaponView')) {
    issue(issues, at + '/weaponView', 'weapon mechanics review targets must be scoped to individual stat groups and action bindings', 'weapon-review-scope');
  }
}

function validateOfficialLocaleRefs(refs, presentation, officialById, issues, at, expectedContext = null) {
  const locales = new Map();
  for (const [index, ref] of refs.entries()) {
    const refAt = at + '/' + index;
    if (locales.has(ref.sourceLocale)) issue(issues, refAt + '/sourceLocale', 'official locale refs must have unique locales', 'official-locale-duplicate');
    locales.set(ref.sourceLocale, ref.officialSourceId);
    const source = officialById.get(ref.officialSourceId);
    if (!source) {
      issue(issues, refAt + '/officialSourceId', 'official locale ref is missing from the fixed source snapshot', 'official-locale-missing');
      continue;
    }
    if (source.sourceLocale !== ref.sourceLocale) issue(issues, refAt + '/sourceLocale', 'official locale ref differs from the fixed source locale', 'official-locale-mismatch');
    if (!sameSourceOwner(source.entityRef, presentation.entityRef)) issue(issues, refAt + '/officialSourceId', 'official locale source belongs to another presentation entity', 'official-owner');
    if (expectedContext) {
      if (!source.bindingContext
        || !sameSourceOwner(source.bindingContext.variantRef, expectedContext.variantRef)
        || source.bindingContext.tier !== expectedContext.tier) {
        issue(issues, refAt + '/officialSourceId', 'official source is not bound to this variant and tier', 'official-tier-context');
      }
    } else if (source.bindingContext) {
      issue(issues, refAt + '/officialSourceId', 'unselected official locale source has an unexpected tier context', 'official-tier-context');
    }
  }
  if (!locales.has('en') || !locales.has('zh-TW')) issue(issues, at, 'both official English and zh-TW source inputs are required', 'official-locales-required');
  return locales;
}

function formatClaimParameter(param, claim) {
  const known = claim?.payload?.value;
  if (known?.status !== 'known' || typeof known.decimal !== 'string') return null;
  if (param.format === 'signed-percent' && known.unit === 'percent'
    && /^-?\d+(?:\.\d+)?$/.test(known.decimal)) {
    return known.decimal.startsWith('-') ? known.decimal + '%' : '+' + known.decimal + '%';
  }
  if (param.format === 'plain-number' && /^-?\d+(?:\.\d+)?$/.test(known.decimal)) return known.decimal;
  return null;
}

function validateDetailSections(sections, presentation, inputs, officialById, issues, at, expectedTier = null) {
  const seenSections = new Set();
  let previousSectionIndex = -1;
  const itemIds = [];
  for (const [sectionIndex, section] of sections.entries()) {
    const sectionAt = at + '/' + sectionIndex;
    const declaredIndex = DETAIL_SECTION_ORDER.indexOf(section.sectionId);
    if (declaredIndex <= previousSectionIndex || seenSections.has(section.sectionId)) {
      issue(issues, sectionAt + '/sectionId', 'detail sections must be a unique ordered subset of the five fixed sections', 'section-order');
    }
    seenSections.add(section.sectionId);
    previousSectionIndex = declaredIndex;
    for (const [itemIndex, item] of section.items.entries()) {
      const itemAt = sectionAt + '/items/' + itemIndex;
      itemIds.push(item.itemId);
      for (const [refIndex, ref] of item.claimRefs.entries()) resolveSourceRecord(ref, 'claim', presentation.entityRef.gameReleaseId, inputs, issues, itemAt + '/claimRefs/' + refIndex);
      for (const [refIndex, ref] of item.termRefs.entries()) resolveSourceRecord(ref, 'term', presentation.entityRef.gameReleaseId, inputs, issues, itemAt + '/termRefs/' + refIndex);
      for (const [ruleIndex, ruleId] of (item.termRuleRefs ?? []).entries()) {
        if (!inputs.termRuleMap?.has(ruleId)) issue(issues, itemAt + '/termRuleRefs/' + ruleIndex, 'terminology rule reference is unresolved', 'term-rule-ref');
      }
      for (const [partIndex, part] of (item.parts ?? []).entries()) if (part.kind === 'unsigned-percent') {
        const claim = resolveSourceRecord(part.bindingRef, 'claim', presentation.entityRef.gameReleaseId, inputs, issues, itemAt + '/parts/' + partIndex + '/bindingRef');
        const value = claim?.payload?.value;
        if (claim && (value?.status !== 'known' || value.unit !== 'percent'
          || typeof value.decimal !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.decimal))) {
          issue(issues, itemAt + '/parts/' + partIndex + '/bindingRef', 'unsigned-percent parts require a known non-negative decimal Source claim with unit percent', 'unsigned-percent-source');
        }
        if (!item.claimRefs.some(ref => keyOf(ref) === keyOf(part.bindingRef))) issue(issues, itemAt + '/parts/' + partIndex + '/bindingRef', 'typed detail part binding must also be retained in parent claimRefs', 'part-claim-binding');
        if (expectedTier) {
          const tierParameter = expectedTier.params.find(param => param.format === 'signed-percent');
          if (!tierParameter || keyOf(tierParameter.bindingRef) !== keyOf(part.bindingRef)) issue(issues, itemAt + '/parts/' + partIndex + '/bindingRef', 'tier display part must bind to the selected tier display claim', 'tier-claim-binding');
          if (claim && (claim.payload.targetRef.recordId !== expectedTier.variantRef.recordId
            || claim.payload.targetRef.gameReleaseId !== expectedTier.variantRef.gameReleaseId)) {
            issue(issues, itemAt + '/parts/' + partIndex + '/bindingRef', 'tier display part claim does not prove the selected tier value', 'tier-claim-binding');
          }
        }
      }
    }
  }
  uniqueBy(itemIds.map(itemId => ({ itemId })), item => item.itemId, 'detail item id', issues, at);
  return itemIds;
}

function validateTierPresentations(presentation, inputs, officialById, issues, at) {
  const model = presentation.tierPresentations;
  if (!model) return;
  if (presentation.entityRef.kind !== 'blessing') issue(issues, at + '/tierPresentations', 'tier presentations are only valid for blessings', 'tier-owner');
  const variant = resolveSourceRecord(model.variantRef, 'blessing-variant', presentation.entityRef.gameReleaseId, inputs, issues, at + '/tierPresentations/variantRef');
  if (!variant) return;
  if (variant.payload.blessingRef.recordId !== presentation.entityRef.recordId
    || variant.payload.blessingRef.gameReleaseId !== presentation.entityRef.gameReleaseId) {
    issue(issues, at + '/tierPresentations/variantRef', 'tier variant belongs to another blessing', 'tier-owner');
  }
  const definedTiers = [...variant.payload.definedTiers].sort((a, b) => a - b);
  const options = new Map();
  for (const [index, option] of model.options.entries()) {
    const optionAt = at + '/tierPresentations/options/' + index;
    if (options.has(option.tier)) issue(issues, optionAt + '/tier', 'tier option is duplicated', 'tier-duplicate');
    options.set(option.tier, option);
    if (!variant.payload.definedTiers.includes(option.tier)) issue(issues, optionAt + '/tier', 'tier option is not defined by the Source variant', 'tier-range');
    const context = { variantRef: model.variantRef, tier: option.tier };
    const localeIds = validateOfficialLocaleRefs(option.officialLocaleRefs, presentation, officialById, issues, optionAt + '/officialLocaleRefs', context);
    const sources = [...localeIds.values()].map(id => officialById.get(id)).filter(Boolean);
    const paramsByName = new Map();
    for (const [paramIndex, param] of option.params.entries()) {
      const paramAt = optionAt + '/params/' + paramIndex;
      if (paramsByName.has(param.name)) issue(issues, paramAt + '/name', 'tier parameter names must be unique', 'duplicate-id');
      paramsByName.set(param.name, param);
      const claim = resolveSourceRecord(param.bindingRef, 'claim', presentation.entityRef.gameReleaseId, inputs, issues, paramAt + '/bindingRef');
      if (!claim) continue;
      if (claim.payload.targetRef.recordId !== model.variantRef.recordId
        || claim.payload.targetRef.gameReleaseId !== model.variantRef.gameReleaseId) issue(issues, paramAt + '/bindingRef', 'tier parameter claim belongs to another variant', 'tier-claim-binding');
      const expectedValue = formatClaimParameter(param, claim);
      if (expectedValue === null) issue(issues, paramAt + '/bindingRef', 'tier parameter claim does not match the selected Source tier and unit', 'tier-claim-binding');
      for (const source of sources) {
        const segmentBound = source.segments.some(segment => segment.kind === 'parameter'
          && segment.parameterId === param.name && segment.token === param.placeholder);
        const sourceParam = source.params.find(entry => entry.sourceKey === param.bindingRef.recordId);
        if (!segmentBound || !sourceParam || sourceParam.value !== expectedValue) issue(issues, paramAt, 'official parameter is not resolved from this tier-bound Source claim', 'official-tier-parameter');
      }
    }
    if (new Set(option.params.map(param => param.bindingRef.recordId)).size !== option.params.length) {
      issue(issues, optionAt + '/params', 'each tier parameter must retain its own Source claim identity', 'tier-claim-binding');
    }
    for (const source of sources) {
      const expectedSourceKeys = new Set(option.params.map(param => param.bindingRef.recordId));
      if (new Set(source.params.map(param => param.sourceKey)).size !== source.params.length) {
        issue(issues, optionAt + '/params', 'fixed official source parameter bindings must be unique', 'official-tier-parameter');
      }
      for (const sourceParam of source.params) if (!expectedSourceKeys.has(sourceParam.sourceKey)) {
        issue(issues, optionAt + '/params', 'fixed official source contains a parameter without a selected-tier Source claim binding', 'official-tier-parameter');
      }
      if (source.params.length !== expectedSourceKeys.size) issue(issues, optionAt + '/params', 'fixed official source parameters do not cover the selected-tier Source claims exactly', 'official-tier-parameter');
    }
    validateDetailSections(option.detailSections, presentation, inputs, officialById, issues, optionAt + '/detailSections', { ...context, params: option.params });
  }
  if (canonical([...options.keys()].sort((a, b) => a - b)) !== canonical(definedTiers)) issue(issues, at + '/tierPresentations/options', 'tier options must cover exactly the defined Source tiers', 'tier-range');
  if (!options.has(model.defaultTier) || !variant.payload.definedTiers.includes(model.defaultTier)) issue(issues, at + '/tierPresentations/defaultTier', 'default tier must be a defined tier with a presentation option', 'tier-default');
  const defaultOption = options.get(model.defaultTier);
  if (defaultOption) {
    if (canonical(presentation.detailSections) !== canonical(defaultOption.detailSections)) issue(issues, at + '/detailSections', 'default presentation details must equal the selected default-tier details', 'tier-default-details');
    if (canonical(presentation.officialLocaleRefs ?? []) !== canonical(defaultOption.officialLocaleRefs)) issue(issues, at + '/officialLocaleRefs', 'default official locale refs must equal the selected default-tier sources', 'tier-default-official');
    const zhId = defaultOption.officialLocaleRefs.find(ref => ref.sourceLocale === 'zh-TW')?.officialSourceId;
    if (zhId !== presentation.official.officialSourceId) issue(issues, at + '/official', 'primary official input must be the selected default-tier zh-TW source', 'tier-default-official');
  }
}

function validateWebSemantic(contract, inputs, issues) {
  inputs.sourceRecordMap = new Map(inputs.sourceContract.records.map(record => [keyOf(record), record]));
  inputs.sourceReleaseMap = new Map(inputs.sourceContract.gameReleases.map(release => [release.gameReleaseId, release]));
  inputs.termRuleMap = new Map((inputs.termRules?.rules ?? []).map(rule => [rule.ruleId, rule]));
  const officialById = new Map(inputs.officialInputs.sources.map(source => [source.officialSourceId, source]));
  const officialIds = new Set();
  const officialLocators = new Set();
  for (const [index, source] of inputs.officialInputs.sources.entries()) {
    const at = '/official-inputs/sources/' + index;
    if (officialIds.has(source.officialSourceId)) issue(issues, at + '/officialSourceId', 'official source id must be unique', 'duplicate-id');
    officialIds.add(source.officialSourceId);
    if (source.key === null && !source.sourceHash) issue(issues, at + '/sourceHash', 'an official source without a localization key requires its fixed source hash', 'official-locator');
    const locator = canonical({
      gameReleaseId: source.entityRef.gameReleaseId,
      recordId: source.entityRef.recordId,
      origin: source.origin,
      sourceLocale: source.sourceLocale,
      resource: source.resource,
      key: source.key,
      sourceHash: source.key === null ? source.sourceHash : null,
      occurrence: source.occurrence,
      bindingContext: source.bindingContext ?? null,
    });
    if (officialLocators.has(locator)) issue(issues, at, 'official source locator occurrence is duplicated', 'duplicate-locator');
    officialLocators.add(locator);
    validateOfficialInput(source, inputs, issues, at);
    if (source.bindingContext) {
      const variant = resolveSourceRecord(source.bindingContext.variantRef, 'blessing-variant', source.entityRef.gameReleaseId, inputs, issues, at + '/bindingContext/variantRef');
      if (source.entityRef.kind !== 'blessing') issue(issues, at + '/bindingContext', 'tier-bound official inputs must belong to a blessing', 'official-tier-owner');
      if (variant && (!variant.payload.definedTiers.includes(source.bindingContext.tier)
        || variant.payload.blessingRef.recordId !== source.entityRef.recordId
        || variant.payload.blessingRef.gameReleaseId !== source.entityRef.gameReleaseId)) {
        issue(issues, at + '/bindingContext', 'official input tier context does not match its Source blessing variant', 'official-tier-context');
      }
    }
  }

  uniqueBy(contract.presentations, item => item.authoringId, 'authoring id', issues, '/presentations');
  for (const [index, presentation] of contract.presentations.entries()) {
    const at = '/presentations/' + index;
    const entity = resolveSourceRecord(presentation.entityRef, presentation.entityRef.kind, presentation.entityRef.gameReleaseId, inputs, issues, at + '/entityRef');
    if (!PRESENTATION_KINDS.includes(presentation.entityRef.kind) || (entity && !PRESENTATION_KINDS.includes(entity.kind))) issue(issues, at + '/entityRef/kind', 'Source kind cannot be presented by this contract', 'wrong-kind-ref');
    const fixedOfficial = officialById.get(presentation.official.officialSourceId);
    if (!fixedOfficial || canonical(fixedOfficial) !== canonical(presentation.official)) issue(issues, at + '/official', 'official bytes differ from the fixed official input snapshot', 'fixed-official-input');
    if (presentation.official.entityRef.recordId !== presentation.entityRef.recordId || presentation.official.entityRef.gameReleaseId !== presentation.entityRef.gameReleaseId || presentation.official.entityRef.kind !== presentation.entityRef.kind) {
      issue(issues, at + '/official/entityRef', 'official input is bound to a different entity or release', 'official-owner');
    }
    if (presentation.faithfulTranslation) {
      if (presentation.faithfulTranslation.sourceId !== presentation.official.officialSourceId) issue(issues, at + '/faithfulTranslation/sourceId', 'faithful translation must name its official source input', 'translation-source');
      if (!textHashMatches(presentation.faithfulTranslation.text, presentation.faithfulTranslation.textSha256)) issue(issues, at + '/faithfulTranslation/textSha256', 'faithful translation hash mismatch', 'hash-mismatch');
    } else if (!['w06', 'w07'].includes(inputs.mode) || presentation.official.sourceLocale !== presentation.locale) {
      issue(issues, at + '/faithfulTranslation', 'translation may be omitted only when the selected official input is already in the presentation locale', 'translation-required');
    }
    if (['w06', 'w07'].includes(inputs.mode)) {
      const selectedModeLabel = inputs.mode.toUpperCase();
      if (presentation.official.sourceLocale !== presentation.locale) issue(issues, at + '/official/sourceLocale', selectedModeLabel + ' presentation must select its native official locale', 'official-locale');
      if (!presentation.nameOfficialSourceId) issue(issues, at + '/nameOfficialSourceId', selectedModeLabel + ' presentation name must cite a native official name input', 'official-name-source');
      const nameSource = officialById.get(presentation.nameOfficialSourceId);
      if (!nameSource || nameSource.sourceLocale !== presentation.locale || nameSource.resolvedText !== presentation.name
        || !sameSourceOwner(nameSource.entityRef, presentation.entityRef)) {
        issue(issues, at + '/nameOfficialSourceId', 'presentation name differs from its fixed native official name input', 'official-name-source');
      }
      if (!presentation.nameOfficialLocaleRefs) issue(issues, at + '/nameOfficialLocaleRefs', selectedModeLabel + ' presentation must retain both official locale name inputs', 'official-locales-required');
      else {
        const nameLocales = validateOfficialLocaleRefs(presentation.nameOfficialLocaleRefs, presentation, officialById, issues, at + '/nameOfficialLocaleRefs');
        if (nameLocales.get('zh-TW') !== presentation.nameOfficialSourceId) issue(issues, at + '/nameOfficialSourceId', 'selected name source must be the fixed zh-TW official name input', 'official-name-source');
        if (inputs.mode === 'w06') {
          const entityRecord = inputs.sourceRecordMap.get(keyOf(presentation.entityRef));
          const sourceNameKey = entityRecord?.payload?.nameKey;
          for (const { sourceLocale, officialSourceId } of presentation.nameOfficialLocaleRefs) {
            const fixedName = officialById.get(officialSourceId);
            if (typeof sourceNameKey === 'string' && fixedName?.key !== sourceNameKey) {
              issue(issues, at + '/nameOfficialLocaleRefs', 'official name locator differs from the verified Source nameKey', 'official-name-source');
            }
            if (isObject(sourceNameKey) && sourceNameKey.status === 'unknown' && fixedName?.key !== null) {
              issue(issues, at + '/nameOfficialLocaleRefs', 'unverified Source nameKey cannot be replaced with a claimed localization key', 'official-name-source');
            }
            if (fixedName && fixedName.sourceLocale !== sourceLocale) issue(issues, at + '/nameOfficialLocaleRefs', 'official name source locale differs from its fixed locale ref', 'official-name-locale');
          }
        }
      }
      if (!presentation.officialLocaleRefs) issue(issues, at + '/officialLocaleRefs', selectedModeLabel + ' presentation must retain both official locale inputs', 'official-locales-required');
      else {
        const defaultContext = presentation.tierPresentations
          ? { variantRef: presentation.tierPresentations.variantRef, tier: presentation.tierPresentations.defaultTier }
          : null;
        const locales = validateOfficialLocaleRefs(presentation.officialLocaleRefs, presentation, officialById, issues, at + '/officialLocaleRefs', defaultContext);
        if (locales.get('zh-TW') !== presentation.official.officialSourceId) issue(issues, at + '/official', 'primary official input must use the fixed zh-TW locale ref', 'official-locale');
      }
      if (inputs.mode === 'w06') {
        for (const [ruleIndex, ruleId] of (presentation.nameTermRuleRefs ?? []).entries()) {
          if (!inputs.termRuleMap.has(ruleId)) issue(issues, at + '/nameTermRuleRefs/' + ruleIndex, 'terminology rule reference is unresolved', 'term-rule-ref');
        }
      }
    }
    validateDetailSections(presentation.detailSections, presentation, inputs, officialById, issues, at + '/detailSections');
    const errataIds = [];
    for (const [errataIndex, erratum] of presentation.errata.entries()) {
      errataIds.push(erratum.errataId);
      const official = officialById.get(erratum.anchor.officialSourceId);
      const segment = official?.segments.find(item => item.segmentId === erratum.anchor.segmentId);
      if (erratum.anchor.officialSourceId !== presentation.official.officialSourceId
        || official?.entityRef.recordId !== presentation.entityRef.recordId
        || official?.entityRef.gameReleaseId !== presentation.entityRef.gameReleaseId
        || official?.entityRef.kind !== presentation.entityRef.kind) {
        issue(issues, at + '/errata/' + errataIndex + '/anchor', 'errata anchor must belong to this presentation official source, entity, and release', 'errata-owner');
      }
      if (!segment || segment.sha256 !== erratum.anchor.segmentSha256) issue(issues, at + '/errata/' + errataIndex + '/anchor', 'errata anchor does not match an exact official source segment', 'errata-anchor');
      for (const [refIndex, ref] of erratum.claimRefs.entries()) resolveSourceRecord(ref, 'claim', presentation.entityRef.gameReleaseId, inputs, issues, at + '/errata/' + errataIndex + '/claimRefs/' + refIndex);
      for (const [refIndex, ref] of erratum.evidenceRefs.entries()) resolveSourceRecord(ref, 'evidence', presentation.entityRef.gameReleaseId, inputs, issues, at + '/errata/' + errataIndex + '/evidenceRefs/' + refIndex);
      for (const [refIndex, ref] of erratum.context.refs.entries()) resolveSourceRecord(ref, ref.kind, presentation.entityRef.gameReleaseId, inputs, issues, at + '/errata/' + errataIndex + '/context/refs/' + refIndex);
    }
    uniqueBy(errataIds.map(errataId => ({ errataId })), item => item.errataId, 'errata id', issues, at + '/errata');
    if (presentation.tierApplicability.length && presentation.entityRef.kind !== 'blessing') issue(issues, at + '/tierApplicability', 'tier applicability is only valid for blessing presentations', 'tier-owner');
    for (const [tierIndex, entry] of presentation.tierApplicability.entries()) {
      const variant = resolveSourceRecord(entry.variantRef, 'blessing-variant', presentation.entityRef.gameReleaseId, inputs, issues, at + '/tierApplicability/' + tierIndex + '/variantRef');
      if (variant) {
        const defined = variant.payload.definedTiers;
        if (variant.payload.blessingRef.recordId !== presentation.entityRef.recordId || variant.payload.blessingRef.gameReleaseId !== presentation.entityRef.gameReleaseId) issue(issues, at + '/tierApplicability/' + tierIndex + '/variantRef', 'blessing variant belongs to another blessing', 'tier-owner');
        for (const tier of entry.tiers) if (!defined.includes(tier)) issue(issues, at + '/tierApplicability/' + tierIndex + '/tiers', 'tier is not defined by the referenced Source variant: ' + tier, 'tier-range');
      }
    }
    if (inputs.mode === 'w06') validateTierPresentations(presentation, inputs, officialById, issues, at);
    if (inputs.mode === 'w07') validateWeaponView(presentation, contract, inputs, issues, at);
  }

  uniqueBy(contract.termLocalizations, item => item.authoringId, 'term localization id', issues, '/termLocalizations');
  for (const [index, localization] of contract.termLocalizations.entries()) {
    const term = resolveSourceRecord(localization.termRef, 'term', localization.termRef.gameReleaseId, inputs, issues, '/termLocalizations/' + index + '/termRef');
    if (term && term.payload.contextKey !== localization.contextKey) issue(issues, '/termLocalizations/' + index + '/contextKey', 'localized term context differs from its Source term', 'term-context');
  }

  uniqueBy(contract.announcements, item => item.announcementId, 'announcement id', issues, '/announcements');
  for (const [index, announcement] of contract.announcements.entries()) {
    const at = '/announcements/' + index;
    if (announcement.scope === 'site' && announcement.source.kind !== 'site-owner') issue(issues, at + '/source/kind', 'site announcements must use the Web site-owner source', 'announcement-owner');
    if (announcement.scope === 'gameplay') {
      if (announcement.source.kind !== 'official-game-source') issue(issues, at + '/source/kind', 'gameplay announcements must cite an official game source', 'announcement-owner');
      if (!inputs.sourceReleaseMap.has(announcement.gameReleaseId)) issue(issues, at + '/gameReleaseId', 'gameplay announcement references an unknown release', 'unknown-release');
    }
    if (!Number.isFinite(Date.parse(announcement.publishedOn + 'T00:00:00Z'))) issue(issues, at + '/publishedOn', 'announcement date is invalid', 'announcement-date');
    uniqueBy(announcement.assets, asset => asset.assetId, 'announcement asset id', issues, at + '/assets');
    const nestedBlockIds = [];
    const assetRefs = [];
    collectAnnouncementOccurrences(announcement.blocks, nestedBlockIds, assetRefs, at + '/blocks');
    uniqueBy(nestedBlockIds, item => item.blockId, 'announcement block id', issues, at + '/blocks');
    const assetIds = new Set(announcement.assets.map(asset => asset.assetId));
    for (const ref of assetRefs) if (!assetIds.has(ref.assetId)) issue(issues, ref.path, 'announcement image references an undeclared asset', 'dangling-asset');
  }

  const sourceChangeIds = new Set();
  uniqueBy(contract.gameChanges, item => item.changeId, 'Source game change id', issues, '/gameChanges');
  for (const [index, change] of contract.gameChanges.entries()) {
    const at = '/gameChanges/' + index;
    const sourceChange = resolveSourceRecord(change.sourceRef, 'game-change', change.sourceRef.gameReleaseId, inputs, issues, at + '/sourceRef');
    if (sourceChange) {
      if (change.changeId !== sourceChange.recordId) issue(issues, at + '/changeId', 'Web summary must reuse the Source game-change id', 'game-change-id');
      if (change.sourceRef.gameReleaseId !== sourceChange.gameReleaseId) issue(issues, at + '/sourceRef/gameReleaseId', 'game-change summary points to a different Source release', 'game-change-owner');
      sourceChangeIds.add(sourceChange.recordId);
      const sourceFields = new Set((sourceChange.payload.changedFields ?? []).map(item => item.field));
      for (const [fieldIndex, fieldSummary] of change.fieldSummaries.entries()) {
        if (!sourceFields.has(fieldSummary.field)) issue(issues, at + '/fieldSummaries/' + fieldIndex + '/field', 'field summary must name a field present in the referenced Source game change', 'game-change-field');
      }
    }
    if (!textHashMatches(change.summary.text, change.summary.textSha256)) issue(issues, at + '/summary/textSha256', 'game-change summary hash mismatch', 'hash-mismatch');
    uniqueBy(change.fieldSummaries, item => item.field, 'game-change field summary', issues, at + '/fieldSummaries');
  }

  uniqueBy(contract.officialTextChanges, item => item.changeId, 'official text change id', issues, '/officialTextChanges');
  const officialChangeIds = new Set();
  for (const [index, change] of contract.officialTextChanges.entries()) {
    const at = '/officialTextChanges/' + index;
    officialChangeIds.add(change.changeId);
    if (sourceChangeIds.has(change.changeId)) issue(issues, at + '/changeId', 'Web official-text id collides with a Source game-change id', 'change-id-collision');
    const fromRelease = inputs.sourceReleaseMap.get(change.fromGameReleaseId);
    const toRelease = inputs.sourceReleaseMap.get(change.toGameReleaseId);
    if (!fromRelease || !toRelease) issue(issues, at, 'official text change references an unknown Source release', 'unknown-release');
    else if (fromRelease.releaseOrder >= toRelease.releaseOrder) issue(issues, at, 'official text comparison must move forward across releases', 'release-order');
    else if (fromRelease.gameVersion === toRelease.gameVersion && fromRelease.gameBuild === toRelease.gameBuild) issue(issues, at, 'same-version/build source revisions cannot be presented as a game update', 'same-source-update');
    else if (canonical(fromRelease.snapshot) === canonical(toRelease.snapshot)) issue(issues, at, 'the compared releases must have distinct verified source snapshots', 'same-source-update');
    const from = officialById.get(change.fromOfficialSourceId);
    const to = officialById.get(change.toOfficialSourceId);
    if (!from || !to) issue(issues, at, 'official text change must cite two fixed official input records', 'official-change-source');
    else {
      if (from.entityRef.gameReleaseId !== change.fromGameReleaseId || to.entityRef.gameReleaseId !== change.toGameReleaseId) issue(issues, at, 'official input releases do not match the declared comparison', 'official-change-release');
      if (from.entityRef.recordId !== change.entityRef.recordId || to.entityRef.recordId !== change.entityRef.recordId || from.entityRef.kind !== change.entityRef.kind || to.entityRef.kind !== change.entityRef.kind) issue(issues, at + '/entityRef', 'official comparison must follow the same stable entity across both releases', 'official-change-entity');
      if (canonical(officialTextContent(from)) === canonical(officialTextContent(to))) issue(issues, at, 'unchanged official text and parameter bindings cannot be presented as an official text change', 'same-official-text');
    }
    if (!textHashMatches(change.summary.text, change.summary.textSha256)) issue(issues, at + '/summary/textSha256', 'official text change summary hash mismatch', 'hash-mismatch');
    if (change.operation === 'correction' && !change.supersedesChangeId) issue(issues, at + '/supersedesChangeId', 'official-text correction must link its prior change', 'correction-chain');
  }
  const allChangeIds = new Set([...sourceChangeIds, ...officialChangeIds]);
  const edges = new Map();
  for (const change of [...contract.gameChanges, ...contract.officialTextChanges]) if (change.supersedesChangeId) {
    if (!allChangeIds.has(change.supersedesChangeId)) issue(issues, '/change', 'supersedesChangeId must resolve to a change in this contract', 'dangling-change');
    edges.set(change.changeId, change.supersedesChangeId);
  }
  for (const start of edges.keys()) {
    const seen = new Set([start]);
    let current = edges.get(start);
    while (current) {
      if (seen.has(current)) { issue(issues, '/change', 'change correction chain contains a cycle', 'change-cycle'); break; }
      seen.add(current);
      current = edges.get(current);
    }
  }

  validateRequiredReviewCoverage(contract, issues);
  validateReceiptAndTargetShapes(contract, issues);
  isForbiddenRemoteKey(contract, '', issues);
}

export function validateWebAuthoring(contract, inputs) {
  const issues = [];
  if (!inputs?.schema || !inputs?.sourceContract || !inputs?.officialInputs) {
    return { valid: false, issues: [{ path: '/', code: 'missing-inputs', message: 'fixed Web, Source, and official inputs are required' }], publicationEligible: false };
  }
  validateSchemaValue(contract, inputs.schema, inputs.schema, '', issues);
  if (issues.length) return { valid: false, issues, publicationEligible: false };
  if (contract.publicationEligible !== false) issue(issues, '/publicationEligible', 'contract validation never grants publication eligibility', 'publication-guard');
  if (contract.fixtureOnly !== (inputs.mode === 'fixture')) issue(issues, '/fixtureOnly', 'Web fixtureOnly mode differs from the selected pinned inputs', 'fixture-mode');
  if (inputs.sourceValidation?.valid !== true) issue(issues, '/sourcePin', 'fixed Source contract is not valid', 'source-contract');
  const pin = expectedSourcePin(inputs.sourceLock, inputs.mode);
  if (canonical(contract.sourcePin) !== canonical(pin)) issue(issues, '/sourcePin', 'Source technical owner pin differs from the verified lock', 'source-pin');
  if (contract.officialInputsSha256 !== inputs.webLock.officialInputs.sha256) issue(issues, '/officialInputsSha256', 'official input digest differs from the fixed safe snapshot', 'official-input-pin');
  validateWebSemantic(contract, inputs, issues);
  return { valid: issues.length === 0, issues, publicationEligible: false };
}

function targetOwner(contract, target) {
  const owner = ownerObject(contract, target);
  if (!owner) throw new Error('Unknown review target owner: ' + target.ownerId);
  const field = pointerGet(owner, target.fieldPath);
  if (!field.exists) throw new Error('Review field path does not exist: ' + target.fieldPath);
  return { owner, value: field.value };
}

function reviewSourceValue(target, owner, value) {
  if (target.ownerKind === 'presentation') {
    if (target.fieldPath === '/name' && owner.nameTermRuleRefs) return { termRuleRefs: owner.nameTermRuleRefs };
    const itemMatch = target.fieldPath.match(/^\/(?:tierPresentations\/options\/(\d+)\/)?detailSections\/(\d+)\/items\/(\d+)(?:\/(?:text|parts(?:\/\d+(?:\/text)?)?))?$/);
    if (itemMatch) {
      const tierOptionIndex = itemMatch[1] === undefined ? null : Number(itemMatch[1]);
      const sectionIndex = Number(itemMatch[2]);
      const itemIndex = Number(itemMatch[3]);
      const sections = tierOptionIndex === null
        ? owner.detailSections
        : owner.tierPresentations?.options[tierOptionIndex]?.detailSections;
      const item = sections?.[sectionIndex]?.items[itemIndex];
      return item ? { claimRefs: item.claimRefs, termRefs: item.termRefs, termRuleRefs: item.termRuleRefs } : value;
    }
    const errataMatch = target.fieldPath.match(/^\/errata\/(\d+)\/(?:text|context(?:\/description)?)$/);
    if (errataMatch) return owner.errata[Number(errataMatch[1])] ?? value;
  }
  return value;
}

function w07ActionTargetProjection(target, owner, inputs) {
  if (inputs.mode !== 'w07' || target.ownerKind !== 'presentation') return null;
  const match = target.fieldPath.match(/^\/weaponView\/attackProfileRefs\/(\d+)$/);
  if (!match) return null;
  const profileRef = owner.weaponView?.attackProfileRefs?.[Number(match[1])];
  const profile = profileRef && inputs.sourceRecordMap.get(keyOf(profileRef));
  const weaponRef = owner.weaponView?.sourceWeaponRef;
  const weapon = weaponRef && inputs.sourceRecordMap.get(keyOf(weaponRef));
  const actionResolution = profile?.payload.actionResolution;
  const weaponResolution = weapon?.payload.actionProfileResolution;
  if (!profile || !weapon || !actionResolution || !weaponResolution) return null;

  const inputKeys = new Set([
    actionResolution.startInput?.inputKey,
    ...(actionResolution.inputBindings ?? []).map(binding => binding.inputKey),
    ...(actionResolution.entryBindings ?? []).map(binding => binding.inputKey),
  ].filter(value => typeof value === 'string'));
  const inputSetup = weaponResolution.inputSetup ?? {};
  const canonicalInputKeys = new Set([...inputKeys].map(canonicalActionInputKey));
  const selectedInputEntries = (inputSetup.inputEntries ?? []).filter(entry => canonicalInputKeys.has(canonicalActionInputKey(entry.inputKey)));
  const actionRows = actionResolution.origin === 'weapon-template'
    ? weaponResolution.localActions ?? []
    : weaponResolution.fallbackActions ?? [];
  const selectedOriginRows = actionRows.filter(entry => entry.action === profile.payload.action
    && (!entry.origin || entry.origin === actionResolution.origin));
  const selectedGeneratorBindings = (weaponResolution.generatorBindings ?? [])
    .filter(binding => binding.ownerAction === profile.payload.action);
  const selectedGeneratorKeys = new Set(selectedGeneratorBindings.map(binding => binding.generatorKey));
  const selectedGenerators = (weaponResolution.actionGenerators ?? []).filter(group => selectedGeneratorKeys.has(group.generatorKey))
    .map(group => ({
      generatorKey: group.generatorKey,
      effectiveDefinitionIndex: group.effectiveDefinitionIndex,
      definition: group.definitions?.find(definition => definition.definitionIndex === group.effectiveDefinitionIndex) ?? null,
    }));
  return {
    profile,
    value: {
      sourceActionProfileRef: { recordId: profile.recordId, gameReleaseId: profile.gameReleaseId, kind: profile.kind },
      actionResolution,
      inputSetup: {
        setupKey: inputSetup.setupKey ?? null,
        inheritedSetupKey: inputSetup.inheritedSetupKey ?? null,
        hierarchyRaw: inputSetup.hierarchyRaw ?? null,
        inputEntries: selectedInputEntries,
      },
      originRows: selectedOriginRows,
      generatorBindings: selectedGeneratorBindings,
      effectiveGenerators: selectedGenerators,
    },
  };
}

function w07StatTargetProjection(target, owner, inputs) {
  if (inputs.mode !== 'w07' || target.ownerKind !== 'presentation') return null;
  const match = target.fieldPath.match(/^\/weaponView\/statSections\/(\d+)$/);
  if (!match) return null;
  const section = owner.weaponView?.statSections?.[Number(match[1])];
  const weaponRef = owner.weaponView?.sourceWeaponRef;
  const weapon = weaponRef && inputs.sourceRecordMap.get(keyOf(weaponRef));
  if (!section || !weapon) return null;
  const sourceGroup = weapon.payload.statBindings?.find(binding => binding.statKey === section.sourceStat);
  if (!sourceGroup) return null;
  const sourceRows = (weapon.payload.sourceRows ?? []).filter(row => {
    const fieldPath = row.sourceLocator?.fieldPath;
    const prefix = 'weapon_template.base_stats.' + section.sourceStat;
    return typeof fieldPath === 'string' && (fieldPath === prefix || fieldPath.startsWith(prefix + '.'));
  });
  const statTables = (weapon.payload.statTables ?? []).filter(table => table.statKey === section.sourceStat);
  const statTableSemantics = (weapon.payload.statTableSemantics ?? []).filter(item => item.statKey === section.sourceStat);
  const bindings = (sourceGroup.bindings ?? []).map(binding => ({
    property: binding.property,
    action: binding.action ?? null,
    mode: binding.mode ?? null,
    traitTemplateKey: binding.traitTemplateKey ?? null,
    traitParameterRange: binding.traitParameterRange ?? null,
    weaponLocator: binding.weaponLocator,
    traitLocator: binding.traitLocator,
    curveMapping: binding.curveMapping ?? null,
  }));
  return {
    bindings,
    value: {
      sourceWeaponRef: { recordId: weapon.recordId, gameReleaseId: weapon.gameReleaseId, kind: weapon.kind },
      statKey: sourceGroup.statKey,
      bindings,
      sourceRows,
      statTables,
      statTableSemantics,
    },
  };
}

function reviewDependencyRefs(target, owner, value, inputs) {
  const refs = collectRecordRefs(reviewSourceValue(target, owner, value), []);
  if (target.ownerKind === 'game-change') refs.push(owner.sourceRef);
  if (target.ownerKind === 'presentation') {
    const ownerKey = keyOf(owner.entityRef);
    for (let index = refs.length - 1; index >= 0; index -= 1) if (keyOf(refs[index]) === ownerKey) refs.splice(index, 1);
  }
  const actionProjection = w07ActionTargetProjection(target, owner, inputs);
  if (actionProjection) {
    const payload = actionProjection.profile.payload;
    refs.push(...collectRecordRefs(actionProjection.value.actionResolution, []));
    refs.push(...(payload.actionResolution?.branchBindings ?? []).map(binding => typedSourceRef(binding.profileRef, 'damage-profile')));
    refs.push(...uniqueTypedRefs(payload.targetProfileRefs ?? [], 'target-profile'));
    refs.push(...uniqueTypedRefs(payload.armorClassRefs ?? [], 'armor-class'));
    refs.push(...uniqueTypedRefs(payload.modifierRuleRefs ?? [], 'modifier-rule'));
  }
  const statProjection = w07StatTargetProjection(target, owner, inputs);
  if (statProjection) {
    for (const binding of statProjection.bindings) {
      if (!binding.curveMapping) continue;
      if (binding.curveMapping.statRef) refs.push(typedSourceRef(binding.curveMapping.statRef, 'stat-definition'));
      if (binding.curveMapping.curveRef) refs.push(typedSourceRef(binding.curveMapping.curveRef, 'stat-curve'));
    }
  }
  const unique = new Map();
  for (const ref of refs) unique.set(keyOf(ref), ref);
  return [...unique.values()].sort((left, right) => compareLexical(keyOf(left), keyOf(right)));
}

function releaseReviewProjection(sourceContract, gameReleaseId) {
  const release = sourceContract.gameReleases.find(item => item.gameReleaseId === gameReleaseId);
  if (!release) throw new Error('Review dependency release does not resolve: ' + gameReleaseId);
  return {
    gameReleaseId: release.gameReleaseId,
    gameVersion: release.gameVersion,
    gameBuild: release.gameBuild,
    releaseOrder: release.releaseOrder,
    snapshot: {
      snapshotId: release.snapshot.snapshotId,
      manifestSha256: release.snapshot.manifestSha256,
      contentSha256: release.snapshot.contentSha256,
    },
  };
}

function presentationUsesOfficialInput(target, owner) {
  return target.ownerKind === 'presentation' && (
    ['official', 'translation', 'errata'].includes(target.dimension)
    || (target.fieldPath === '/name' && Boolean(owner.nameOfficialSourceId))
    || target.fieldPath === '/detailSections'
    || target.fieldPath.startsWith('/detailSections/')
    || target.fieldPath === '/tierPresentations'
    || target.fieldPath.startsWith('/tierPresentations/')
    || target.fieldPath === '/errata'
    || target.fieldPath.startsWith('/errata/')
  );
}

function officialSourceIdsForTarget(target, owner) {
  if (target.dimension === 'translation') return [owner.faithfulTranslation.sourceId];
  if (target.fieldPath === '/officialLocaleRefs') return owner.officialLocaleRefs?.map(ref => ref.officialSourceId) ?? [owner.official.officialSourceId];
  if (target.fieldPath === '/name') {
    if (owner.nameOfficialLocaleRefs) return owner.nameOfficialLocaleRefs.map(ref => ref.officialSourceId);
    if (owner.nameOfficialSourceId) return [owner.nameOfficialSourceId];
  }
  const tierMatch = target.fieldPath.match(/^\/tierPresentations\/options\/(\d+)/);
  if (tierMatch) {
    const option = owner.tierPresentations?.options[Number(tierMatch[1])];
    return option?.officialLocaleRefs?.map(ref => ref.officialSourceId) ?? [owner.official.officialSourceId];
  }
  if (owner.officialLocaleRefs && (target.fieldPath === '/detailSections' || target.fieldPath.startsWith('/detailSections/'))) {
    return owner.officialLocaleRefs.map(ref => ref.officialSourceId);
  }
  if (target.fieldPath === '/tierPresentations' || target.fieldPath.startsWith('/tierPresentations/')) {
    return owner.officialLocaleRefs?.map(ref => ref.officialSourceId) ?? [owner.official.officialSourceId];
  }
  return [owner.official.officialSourceId];
}

function officialSourceClaimRefs(target, owner, inputs, sourceRecordMap) {
  if (inputs.mode !== 'w06' || target.ownerKind !== 'presentation' || target.dimension !== 'official') return [];
  const refs = new Map();
  for (const officialId of new Set(officialSourceIdsForTarget(target, owner))) {
    const fixed = inputs.officialInputs.sources.find(source => source.officialSourceId === officialId);
    if (!fixed) continue;
    for (const param of fixed.params ?? []) {
      if (param.officialNameRef || typeof param.sourceKey !== 'string') continue;
      const ref = { recordId: param.sourceKey, gameReleaseId: owner.entityRef.gameReleaseId, kind: 'claim' };
      const record = sourceRecordMap.get(keyOf(ref));
      if (record?.kind === 'claim') refs.set(keyOf(ref), ref);
    }
  }
  return [...refs.values()].sort((left, right) => compareLexical(keyOf(left), keyOf(right)));
}

function collectTermRuleIds(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectTermRuleIds(item, output);
  } else if (isObject(value)) {
    for (const key of ['termRuleRefs', 'nameTermRuleRefs']) {
      if (Array.isArray(value[key])) for (const id of value[key]) if (typeof id === 'string') output.add(id);
    }
    for (const child of Object.values(value)) collectTermRuleIds(child, output);
  }
  return output;
}

function announcementAssetOccurrences(blocks, assets, output = []) {
  const assetMap = new Map(assets.map(asset => [asset.assetId, asset]));
  for (const block of blocks) {
    if (block.kind === 'image') output.push(assetMap.get(block.assetRef.assetId) ?? { assetId: block.assetRef.assetId });
    else if (block.kind === 'spoiler') announcementAssetOccurrences(block.blocks, assets, output);
  }
  return output;
}

export function computeReviewDigests(contract, target, inputs) {
  const { owner, value } = targetOwner(contract, target);
  const dependencies = [];
  const sourceContract = inputs.sourceContract;
  const sourceRecordMap = inputs.sourceRecordMap ?? new Map(sourceContract.records.map(record => [keyOf(record), record]));
  if (presentationUsesOfficialInput(target, owner)) {
    for (const officialId of new Set(officialSourceIdsForTarget(target, owner))) {
      const fixed = inputs.officialInputs.sources.find(source => source.officialSourceId === officialId);
      if (!fixed) throw new Error('Fixed official source is missing for review target ' + target.targetId);
      dependencies.push({ kind: 'official-input', value: fixed });
    }
  }
  if (target.ownerKind === 'presentation' && target.dimension !== 'translation') {
    dependencies.push({ kind: 'presentation-identity', value: owner.entityRef });
  }
  const fieldSummaryMatch = target.ownerKind === 'game-change' && target.fieldPath.match(/^\/fieldSummaries\/(\d+)\/summary$/);
  if (fieldSummaryMatch) {
    const fieldSummary = owner.fieldSummaries?.[Number(fieldSummaryMatch[1])];
    if (typeof fieldSummary?.field !== 'string' || fieldSummary.field.trim() === '') {
      throw new Error('Game-change field summary review dependency has no field identity: ' + target.targetId);
    }
    dependencies.push({ kind: 'game-change-field-summary-binding', field: fieldSummary.field });
  }
  for (const ruleId of collectTermRuleIds(reviewSourceValue(target, owner, value))) {
    const rule = inputs.termRules?.rules?.find(item => item.ruleId === ruleId);
    if (!rule) throw new Error('Terminology rule dependency does not resolve: ' + ruleId);
    dependencies.push({ kind: 'term-rule', value: rule });
  }
  if (target.ownerKind === 'term-localization') {
    const term = sourceRecordMap.get(keyOf(owner.termRef));
    if (!term || term.kind !== 'term') throw new Error('Review dependency term does not resolve: ' + owner.termRef.gameReleaseId + ':' + owner.termRef.recordId);
    dependencies.push({
      kind: 'term-identity-context',
      value: {
        recordId: term.recordId,
        gameReleaseId: term.gameReleaseId,
        kind: term.kind,
        termKey: term.payload.termKey,
        contextKey: term.payload.contextKey,
      },
    });
    if (target.fieldPath === '/definition') {
      const digest = inputs.sourceValidator.computeReviewDigests(sourceContract, {
        recordId: term.recordId,
        gameReleaseId: term.gameReleaseId,
        fieldPath: '/payload/technicalDefinitionEn',
      });
      dependencies.push({
        kind: 'source-term-definition',
        recordId: term.recordId,
        gameReleaseId: term.gameReleaseId,
        targetDigest: digest.targetDigest,
        dependenciesDigest: digest.dependenciesDigest,
      });
    }
  }
  if (target.ownerKind === 'announcement') {
    dependencies.push({ kind: 'announcement-source', scope: owner.scope, source: owner.source });
    if (owner.scope === 'gameplay') dependencies.push({ kind: 'game-release', value: releaseReviewProjection(sourceContract, owner.gameReleaseId) });
    if (target.fieldPath === '/blocks') dependencies.push({ kind: 'announcement-assets', value: announcementAssetOccurrences(owner.blocks, owner.assets) });
  }
  if (target.ownerKind === 'official-text-change') {
    const from = inputs.officialInputs.sources.find(source => source.officialSourceId === owner.fromOfficialSourceId);
    const to = inputs.officialInputs.sources.find(source => source.officialSourceId === owner.toOfficialSourceId);
    if (!from || !to) throw new Error('Fixed official comparison source is missing for review target ' + target.targetId);
    dependencies.push({ kind: 'official-text-comparison', entityRef: owner.entityRef, operation: owner.operation, fromOfficialSourceId: owner.fromOfficialSourceId, toOfficialSourceId: owner.toOfficialSourceId, fromGameReleaseId: owner.fromGameReleaseId, toGameReleaseId: owner.toGameReleaseId, supersedesChangeId: owner.supersedesChangeId ?? null });
    dependencies.push({ kind: 'official-input', side: 'from', value: from });
    dependencies.push({ kind: 'official-input', side: 'to', value: to });
    dependencies.push({ kind: 'game-release', side: 'from', value: releaseReviewProjection(sourceContract, owner.fromGameReleaseId) });
    dependencies.push({ kind: 'game-release', side: 'to', value: releaseReviewProjection(sourceContract, owner.toGameReleaseId) });
  }
  const actionProjection = w07ActionTargetProjection(target, owner, inputs);
  if (actionProjection) dependencies.push({ kind: 'weapon-action-resolution-row', value: actionProjection.value });
  const statProjection = w07StatTargetProjection(target, owner, inputs);
  if (statProjection) dependencies.push({ kind: 'weapon-stat-curve-mapping-row', value: statProjection.value });
  const refs = reviewDependencyRefs(target, owner, value, inputs);
  refs.push(...officialSourceClaimRefs(target, owner, inputs, sourceRecordMap));
  const uniqueRefs = new Map(refs.map(ref => [keyOf(ref), ref]));
  for (const ref of [...uniqueRefs.values()].sort((left, right) => compareLexical(keyOf(left), keyOf(right)))) {
    const sourceRecord = sourceRecordMap.get(keyOf(ref));
    if (!sourceRecord || sourceRecord.kind !== ref.kind) throw new Error('Review dependency does not resolve: ' + ref.gameReleaseId + ':' + ref.recordId);
    const digest = inputs.sourceValidator.computeReviewDigests(sourceContract, {
      recordId: ref.recordId, gameReleaseId: ref.gameReleaseId, fieldPath: '/payload',
    });
    dependencies.push({ kind: 'source-record', recordId: ref.recordId, gameReleaseId: ref.gameReleaseId, recordKind: ref.kind, targetDigest: digest.targetDigest, dependenciesDigest: digest.dependenciesDigest });
    if (ref.compatibilityRef) {
      const compatibility = sourceRecordMap.get(keyOf(ref.compatibilityRef));
      if (!compatibility) throw new Error('Review dependency compatibility record is missing');
      const compatibilityDigest = inputs.sourceValidator.computeReviewDigests(sourceContract, {
        recordId: compatibility.recordId, gameReleaseId: compatibility.gameReleaseId, fieldPath: '/payload',
      });
      dependencies.push({ kind: 'source-record', recordId: compatibility.recordId, gameReleaseId: compatibility.gameReleaseId, recordKind: compatibility.kind, targetDigest: compatibilityDigest.targetDigest, dependenciesDigest: compatibilityDigest.dependenciesDigest });
    }
  }
  dependencies.sort((left, right) => compareLexical(canonical(left), canonical(right)));
  return {
    targetDigest: sha256({
      targetId: target.targetId,
      ownerKind: target.ownerKind,
      ownerId: target.ownerId,
      fieldPath: target.fieldPath,
      dimension: target.dimension,
      value,
    }),
    dependenciesDigest: sha256(dependencies),
  };
}

export function createReviewReceipt(contract, target, { sourceContract, officialInputs, sourceValidator, sourceRecordMap, termRules, mode, reviewer, reviewedAt } = {}) {
  if (!reviewer || reviewer.kind !== 'human' || typeof reviewer.id !== 'string' || reviewer.id.trim() === '') throw new Error('A named human reviewer is required');
  if (typeof reviewedAt !== 'string' || !Number.isFinite(Date.parse(reviewedAt)) || !reviewedAt.endsWith('Z')) throw new Error('reviewedAt must be a valid UTC timestamp');
  if (!contract.reviewTargets.some(item => canonical(item) === canonical(target))) throw new Error('Review receipt target must exactly match a registered target');
  const inputs = { sourceContract, officialInputs, sourceValidator, sourceRecordMap, termRules, mode };
  const { targetDigest, dependenciesDigest } = computeReviewDigests(contract, target, inputs);
  return { targetId: target.targetId, targetDigest, dependenciesDigest, decision: 'approved', reviewer: structuredClone(reviewer), reviewedAt };
}

export function getReviewState(contract, targetId, inputs) {
  const target = contract.reviewTargets.find(item => item.targetId === targetId);
  if (!target) throw new Error('Unknown review target: ' + targetId);
  const current = computeReviewDigests(contract, target, inputs);
  const receipts = contract.reviewReceipts.filter(item => item.targetId === targetId);
  if (!receipts.length) return 'pending';
  const matching = receipts.filter(item => item.targetDigest === current.targetDigest && item.dependenciesDigest === current.dependenciesDigest);
  if (!matching.length) return 'stale';
  let latestInstant = [];
  for (const receipt of matching) {
    if (latestInstant.length === 0) {
      latestInstant = [receipt];
      continue;
    }
    const order = compareUtcInstants(receipt.reviewedAt, latestInstant[0].reviewedAt);
    if (order > 0) latestInstant = [receipt];
    else if (order === 0) latestInstant.push(receipt);
  }
  const decisions = new Set(latestInstant.map(receipt => receipt.decision));
  if (decisions.has('rejected') || decisions.size !== 1) return 'rejected';
  return latestInstant[0].decision;
}

function compareUtcInstants(left, right) {
  const leftParts = left.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.([0-9]+))?Z$/);
  const rightParts = right.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.([0-9]+))?Z$/);
  if (!leftParts || !rightParts) return compareLexical(left, right);
  const leftWholeSecond = Date.parse(leftParts[1] + 'Z');
  const rightWholeSecond = Date.parse(rightParts[1] + 'Z');
  if (!Number.isFinite(leftWholeSecond) || !Number.isFinite(rightWholeSecond)) return compareLexical(left, right);
  const wholeSecondsOrder = leftWholeSecond === rightWholeSecond ? 0 : leftWholeSecond < rightWholeSecond ? -1 : 1;
  if (wholeSecondsOrder !== 0) return wholeSecondsOrder;
  const leftFraction = (leftParts[2] ?? '').replace(/0+$/, '');
  const rightFraction = (rightParts[2] ?? '').replace(/0+$/, '');
  const length = Math.max(leftFraction.length, rightFraction.length);
  for (let index = 0; index < length; index += 1) {
    const leftDigit = leftFraction[index] ?? '0';
    const rightDigit = rightFraction[index] ?? '0';
    if (leftDigit !== rightDigit) return leftDigit < rightDigit ? -1 : 1;
  }
  return 0;
}

async function main() {
  try {
    const args = process.argv.slice(2);
    let sourceRoot;
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] !== '--source-root' || !args[index + 1] || args[index + 1].startsWith('--') || sourceRoot) {
        throw new Error('usage: node scripts/content/contract-authoring.mjs [--source-root <Source-checkout>]');
      }
      sourceRoot = path.resolve(args[index + 1]);
      index += 1;
    }
    const inputs = await loadWebAuthoringInputs({ repoRoot: REPO_ROOT, sourceRoot });
    const result = validateWebAuthoring(inputs.authoring, inputs);
    if (!result.valid) throw new Error(result.issues.map(item => item.path + ': ' + item.message).join('\n'));
    process.stdout.write('Web authoring contract validation passed: presentations=' + inputs.authoring.presentations.length + ' sourceRecords=' + inputs.sourceContract.records.length + ' fixtureOnly=' + String(inputs.authoring.fixtureOnly) + ' publicationEligible=false. No runtime/compiler integration is implied.\n');
  } catch (error) {
    process.stderr.write('Web authoring contract validation failed: ' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
